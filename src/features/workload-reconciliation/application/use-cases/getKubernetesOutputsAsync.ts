import type { InfraOutput, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { getKubernetesOwnershipQuery } from '../../utils/getKubernetesOwnershipQuery';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';

/*** Read safe public outputs exposed by Infra-owned Kubernetes resources. */
export async function getKubernetesOutputsAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraOutput[]>> {
  try {
    const resources = await options.api.listOwnedAsync(getKubernetesOwnershipQuery(request));
    const outputs: InfraOutput[] = [];
    for (const resource of resources) {
      const owner = readKubernetesOwnedResource(resource, request);
      if (owner === undefined) continue;
      const observation = await options.api.observeAsync(
        getKubernetesResourceReference(resource),
        request.context.signal,
      );
      for (const [name, value] of Object.entries(observation.publicOutputs ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        outputs.push({ owner: owner.identity, name, visibility: 'public', value });
      }
    }
    return { ok: true, value: outputs, diagnostics: [] };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-outputs-failed',
          message: 'Kubernetes public outputs could not be read.',
        },
      ],
    };
  }
}
