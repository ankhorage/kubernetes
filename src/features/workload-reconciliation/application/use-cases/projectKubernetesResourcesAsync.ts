import type { InfraResult } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesProjection,
  KubernetesSecretBinding,
} from '../../../../types/kubernetesResources';
import { createKubernetesDesiredResource } from '../../utils/createKubernetesDesiredResource';
import { createKubernetesIdentity } from '../../utils/createKubernetesIdentity';
import { getKubernetesOwnershipQuery } from '../../utils/getKubernetesOwnershipQuery';
import { projectKubernetesWorkload } from './projectKubernetesWorkload';
import { validateKubernetesWorkloads } from './validateKubernetesWorkloads';

/***
 * Project portable workload desired state into deterministic standard Kubernetes resources.
 *
 * Resolved secret values are deliberately absent. The projection carries only references for
 * runtime materialization immediately before apply.
 *
 * @readme
 */
export function projectKubernetesResourcesAsync(
  request: KubernetesDriverRequest,
): Promise<InfraResult<KubernetesProjection>> {
  const validation = validateKubernetesWorkloads(request.workloads);
  if (validation.length > 0) return Promise.resolve({ ok: false, diagnostics: validation });

  const { namespace } = getKubernetesOwnershipQuery(request);
  const namespaceResource = createNamespace(request, namespace);
  const workloadOwners = new Map(
    request.workloads.map((workload) => [
      workload.id,
      createKubernetesIdentity(request, `workload:${workload.id}`),
    ]),
  );
  const resources: KubernetesDesiredResource[] = [namespaceResource];
  const secretBindings: KubernetesSecretBinding[] = [];
  for (const workload of request.workloads) {
    const projected = projectKubernetesWorkload(request, {
      namespace,
      namespaceOwner: namespaceResource.owner.identity,
      workloadOwners,
      workload,
    });
    if (!projected.ok) return Promise.resolve(projected);
    resources.push(...projected.value.resources);
    secretBindings.push(...projected.value.secretBindings);
  }
  return Promise.resolve({
    ok: true,
    value: { resources, secretBindings },
    diagnostics: [],
  });
}

/*** Create the environment namespace before all namespaced resources. */
function createNamespace(
  request: KubernetesDriverRequest,
  namespace: string,
): KubernetesDesiredResource {
  return createKubernetesDesiredResource(request, {
    resourceId: `namespace:${namespace}`,
    resource: {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace, labels: {}, annotations: {} },
    },
  });
}
