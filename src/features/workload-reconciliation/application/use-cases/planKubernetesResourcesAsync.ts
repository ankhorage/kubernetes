import type { InfraPlanAction, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { prepareKubernetesChangesAsync } from './prepareKubernetesChangesAsync';

/*** Produce a side-effect-free Kubernetes reconciliation plan. */
export async function planKubernetesResourcesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraPlanAction[]>> {
  const prepared = await prepareKubernetesChangesAsync(options, request);
  return prepared.ok
    ? { ok: true, value: prepared.value.changes.map(({ action }) => action), diagnostics: [] }
    : prepared;
}
