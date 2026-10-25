import type {
  InfraResourceIdentity,
  InfraResult,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver.js';
import type { KubernetesWorkloadProjection } from '../../../../types/kubernetesResources.js';
import { toKubernetesName } from '../../utils/toKubernetesName.js';
import { createKubernetesController } from './createKubernetesController.js';
import { createKubernetesExposure } from './createKubernetesExposure.js';
import { createKubernetesPrerequisites } from './createKubernetesPrerequisites.js';
import { resolveKubernetesWorkloadValues } from './resolveKubernetesWorkloadValues.js';

/*** Project one workload while retaining dependency-first resource ordering. */
export function projectKubernetesWorkload(
  request: KubernetesDriverRequest,
  input: ProjectKubernetesWorkloadInput,
): InfraResult<KubernetesWorkloadProjection> {
  const workloadName = toKubernetesName(input.workload.id);
  const values = resolveKubernetesWorkloadValues(request.availableOutputs ?? [], input.workload);
  if (!values.ok) return values;
  const prerequisites = createKubernetesPrerequisites(request, {
    namespace: input.namespace,
    namespaceOwner: input.namespaceOwner,
    workloadName,
    workload: input.workload,
    values: values.value,
  });
  const declaredDependencies = Object.keys(input.workload.dependsOn ?? {})
    .sort()
    .flatMap((id) => {
      const owner = input.workloadOwners.get(id);
      return owner === undefined ? [] : [owner];
    });
  const controller = createKubernetesController(request, {
    namespace: input.namespace,
    workloadName,
    workload: input.workload,
    values: values.value,
    dependsOn: [...prerequisites.owners, ...declaredDependencies],
  });
  const exposure = createKubernetesExposure(request, {
    namespace: input.namespace,
    workloadName,
    workload: input.workload,
    controller: controller.owner.identity,
  });
  return {
    ok: true,
    value: {
      resources: [...prerequisites.resources, controller, ...exposure],
      secretBindings: prerequisites.secretBindings,
    },
    diagnostics: [],
  };
}

export interface ProjectKubernetesWorkloadInput {
  readonly namespace: string;
  readonly namespaceOwner: InfraResourceIdentity;
  readonly workloadOwners: ReadonlyMap<string, InfraResourceIdentity>;
  readonly workload: InfraWorkloadSpec;
}
