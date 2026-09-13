import type { KubernetesDriverRequest } from '../../../types/kubernetesDriver';
import type { KubernetesOwnershipQuery } from '../../../types/kubernetesResources';
import { KUBERNETES_OWNERSHIP } from '../constants';
import { toKubernetesName } from './toKubernetesName';

/*** Build the narrow ownership selector used for every read and prune operation. */
export function getKubernetesOwnershipQuery(
  request: KubernetesDriverRequest,
): KubernetesOwnershipQuery {
  return {
    namespace:
      request.namespace ??
      toKubernetesName(`${request.context.projectId}-${request.context.environment}`),
    labels: {
      [KUBERNETES_OWNERSHIP.managedByLabel]: KUBERNETES_OWNERSHIP.managedByValue,
      [KUBERNETES_OWNERSHIP.projectLabel]: toKubernetesName(request.context.projectId),
      [KUBERNETES_OWNERSHIP.environmentLabel]: request.context.environment,
    },
    ...(request.context.signal === undefined ? {} : { signal: request.context.signal }),
  };
}
