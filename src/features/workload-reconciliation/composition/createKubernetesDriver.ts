import type { KubernetesDriver } from '../../../types/kubernetesDriver';

/***
 * Create the shared Kubernetes workload driver entrypoint.
 *
 * Kubernetes is an implementation dependency for runtime adapters, not a selectable Infra
 * provider. Workload projection and reconciliation operations are added at this boundary in the
 * driver implementation phase.
 *
 * @readme
 */
export function createKubernetesDriver(): KubernetesDriver {
  return { kind: 'kubernetes' };
}
