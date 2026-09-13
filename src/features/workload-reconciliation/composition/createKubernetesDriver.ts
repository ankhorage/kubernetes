import type { KubernetesDriver, KubernetesDriverOptions } from '../../../types/kubernetesDriver';
import { getKubernetesOutputsAsync } from '../application/use-cases/getKubernetesOutputsAsync';
import { getKubernetesStatusAsync } from '../application/use-cases/getKubernetesStatusAsync';
import { planKubernetesResourcesAsync } from '../application/use-cases/planKubernetesResourcesAsync';
import { projectKubernetesResourcesAsync } from '../application/use-cases/projectKubernetesResourcesAsync';
import { reconcileKubernetesResourcesAsync } from '../application/use-cases/reconcileKubernetesResourcesAsync';
import { removeKubernetesResourcesAsync } from '../application/use-cases/removeKubernetesResourcesAsync';
import { waitForKubernetesReadinessAsync } from '../application/use-cases/waitForKubernetesReadinessAsync';

/***
 * Create the shared Kubernetes workload driver entrypoint.
 *
 * Kubernetes is an implementation dependency for runtime adapters, not a selectable Infra
 * provider. The supplied API port is already authenticated cluster access; the driver adds only
 * standard Kubernetes workload projection and lifecycle semantics.
 *
 * @readme
 */
export function createKubernetesDriver(options: KubernetesDriverOptions): KubernetesDriver {
  return {
    kind: 'kubernetes',
    projectAsync: projectKubernetesResourcesAsync,
    planAsync: (request) => planKubernetesResourcesAsync(options, request),
    reconcileAsync: (request) => reconcileKubernetesResourcesAsync(options, request),
    removeAsync: (request, destroy) => removeKubernetesResourcesAsync(options, request, destroy),
    statusAsync: (request) => getKubernetesStatusAsync(options, request),
    waitUntilReadyAsync: (request) => waitForKubernetesReadinessAsync(options, request),
    outputsAsync: (request) => getKubernetesOutputsAsync(options, request),
  };
}
