import type {
  InfraAdapterId,
  InfraDestroyRequest,
  InfraExecutionContext,
  InfraOutput,
  InfraPlanAction,
  InfraReconcileResult,
  InfraResourceStatus,
  InfraResult,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import type { KubernetesApi, KubernetesProjection } from './kubernetesResources';

export interface KubernetesDriverOptions {
  readonly api: KubernetesApi;
  readonly defaultReadinessTimeoutSeconds?: number;
}

export interface KubernetesDriverRequest {
  readonly context: InfraExecutionContext;
  /** The composing runtime adapter remains the canonical Infra resource owner. */
  readonly ownerAdapter: InfraAdapterId;
  readonly workloads: readonly InfraWorkloadSpec[];
  readonly availableOutputs?: readonly InfraOutput[];
  readonly namespace?: string;
}

export interface KubernetesDriver {
  readonly kind: 'kubernetes';
  projectAsync(request: KubernetesDriverRequest): Promise<InfraResult<KubernetesProjection>>;
  planAsync(request: KubernetesDriverRequest): Promise<InfraResult<readonly InfraPlanAction[]>>;
  reconcileAsync(request: KubernetesDriverRequest): Promise<InfraResult<InfraReconcileResult>>;
  removeAsync(
    request: KubernetesDriverRequest,
    destroy: InfraDestroyRequest,
  ): Promise<InfraResult<InfraReconcileResult>>;
  statusAsync(
    request: KubernetesDriverRequest,
  ): Promise<InfraResult<readonly InfraResourceStatus[]>>;
  waitUntilReadyAsync(
    request: KubernetesDriverRequest,
  ): Promise<InfraResult<readonly InfraResourceStatus[]>>;
  outputsAsync(request: KubernetesDriverRequest): Promise<InfraResult<readonly InfraOutput[]>>;
}
