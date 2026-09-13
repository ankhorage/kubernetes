import type { InfraOwnedResource, InfraResourceIdentity } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesResource,
} from '../../../types/kubernetesResources';
import { KUBERNETES_OWNERSHIP } from '../constants';
import { getKubernetesResourceKey } from './getKubernetesResourceKey';
import { getKubernetesResourceReference } from './getKubernetesResourceReference';
import { toKubernetesName } from './toKubernetesName';

/*** Attach canonical Infra ownership to a standard Kubernetes desired resource. */
export function createKubernetesDesiredResource(
  request: KubernetesDriverRequest,
  input: CreateKubernetesDesiredResourceInput,
): KubernetesDesiredResource {
  const identity: InfraResourceIdentity = {
    projectId: request.context.projectId,
    environment: request.context.environment,
    adapter: request.ownerAdapter,
    resourceId: input.resourceId,
  };
  const dependsOn = input.dependsOn ?? [];
  const resource: KubernetesResource = {
    ...input.resource,
    metadata: {
      ...input.resource.metadata,
      labels: {
        ...input.resource.metadata.labels,
        [KUBERNETES_OWNERSHIP.managedByLabel]: KUBERNETES_OWNERSHIP.managedByValue,
        [KUBERNETES_OWNERSHIP.projectLabel]: toKubernetesName(request.context.projectId),
        [KUBERNETES_OWNERSHIP.environmentLabel]: request.context.environment,
      },
      annotations: {
        ...input.resource.metadata.annotations,
        [KUBERNETES_OWNERSHIP.projectAnnotation]: request.context.projectId,
        [KUBERNETES_OWNERSHIP.environmentAnnotation]: request.context.environment,
        [KUBERNETES_OWNERSHIP.adapterAnnotation]: request.ownerAdapter,
        [KUBERNETES_OWNERSHIP.resourceAnnotation]: input.resourceId,
        [KUBERNETES_OWNERSHIP.persistentAnnotation]: String(input.persistent ?? false),
        [KUBERNETES_OWNERSHIP.retentionAnnotation]: input.retention ?? 'retain',
        [KUBERNETES_OWNERSHIP.dependenciesAnnotation]: JSON.stringify(
          dependsOn.map((dependency) => dependency.resourceId),
        ),
      },
    },
  };

  const owner: InfraOwnedResource = {
    identity,
    externalId: getKubernetesResourceKey(getKubernetesResourceReference(resource)),
    persistent: input.persistent ?? false,
    retention: input.retention ?? 'retain',
    dependsOn,
  };
  return { resource, owner };
}

interface CreateKubernetesDesiredResourceInput {
  readonly resourceId: string;
  readonly resource: KubernetesResource;
  readonly persistent?: boolean;
  readonly retention?: InfraOwnedResource['retention'];
  readonly dependsOn?: readonly InfraResourceIdentity[];
}
