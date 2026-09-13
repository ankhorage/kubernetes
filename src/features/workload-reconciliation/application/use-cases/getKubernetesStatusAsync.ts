import type { InfraResourceStatus, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { getKubernetesOwnershipQuery } from '../../utils/getKubernetesOwnershipQuery';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';

/*** Read provider-neutral status for every safely identified Infra-owned resource. */
export async function getKubernetesStatusAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  try {
    const resources = await options.api.listOwnedAsync(getKubernetesOwnershipQuery(request));
    const statuses: InfraResourceStatus[] = [];
    for (const resource of resources) {
      const owner = readKubernetesOwnedResource(resource, request);
      if (owner === undefined) continue;
      const observation = await options.api.observeAsync(
        getKubernetesResourceReference(resource),
        request.context.signal,
      );
      statuses.push({
        owner: owner.identity,
        state: observation.state,
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
      });
    }
    return { ok: true, value: statuses, diagnostics: [] };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-status-failed',
          message: 'Kubernetes resource status could not be read.',
        },
      ],
    };
  }
}
