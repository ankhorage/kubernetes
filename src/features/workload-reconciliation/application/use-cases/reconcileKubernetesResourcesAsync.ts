import type {
  InfraOwnedResource,
  InfraReconcileResult,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';
import { getKubernetesOutputsAsync } from './getKubernetesOutputsAsync';
import { prepareKubernetesChangesAsync } from './prepareKubernetesChangesAsync';

/*** Apply desired changes and prune only obsolete, non-persistent Infra-owned resources. */
export async function reconcileKubernetesResourcesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  const prepared = await prepareKubernetesChangesAsync(options, request);
  if (!prepared.ok) return prepared;

  try {
    const retained: InfraOwnedResource[] = [];
    for (const change of prepared.value.changes) {
      if (
        (change.action.operation === 'create' || change.action.operation === 'update') &&
        change.desired !== undefined
      ) {
        await options.api.applyAsync(change.desired.resource, request.context.signal);
      }
      if (change.action.operation === 'delete' && change.actual !== undefined) {
        await options.api.deleteAsync(
          getKubernetesResourceReference(change.actual),
          request.context.signal,
        );
      }
      if (change.action.operation === 'retain' && change.actual !== undefined) {
        const owner = readKubernetesOwnedResource(change.actual, request);
        if (owner !== undefined) retained.push(owner);
      }
    }

    const outputs = await getKubernetesOutputsAsync(options, request);
    if (!outputs.ok) return outputs;
    return {
      ok: true,
      value: {
        resources: [...prepared.value.projection.resources.map(({ owner }) => owner), ...retained],
        outputs: outputs.value,
      },
      diagnostics: [],
    };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-reconcile-failed',
          message: 'Kubernetes resources could not be reconciled safely.',
        },
      ],
    };
  }
}
