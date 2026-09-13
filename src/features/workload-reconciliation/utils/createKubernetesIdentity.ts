import type { InfraResourceIdentity } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../types/kubernetesDriver';

/*** Create a runtime-owned Infra identity without provider-specific assumptions. */
export function createKubernetesIdentity(
  request: KubernetesDriverRequest,
  resourceId: string,
): InfraResourceIdentity {
  return {
    projectId: request.context.projectId,
    environment: request.context.environment,
    adapter: request.ownerAdapter,
    resourceId,
  };
}
