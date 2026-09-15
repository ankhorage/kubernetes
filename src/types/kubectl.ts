import type { KubernetesApi } from './kubernetesResources';

export interface KubernetesCommandRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly stdin?: string;
  readonly signal?: AbortSignal;
}

export interface KubernetesCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Shell-free process boundary for kubectl-specific CLI commands. */
export interface KubernetesCommandRunner {
  runAsync(request: KubernetesCommandRequest): Promise<KubernetesCommandResult>;
}

export interface KubectlKubernetesApiOptions {
  /** Exact authenticated kubeconfig context selected by the owning runtime adapter. */
  readonly context: string;
  readonly executable?: string;
  readonly runner?: KubernetesCommandRunner;
  readonly pollIntervalMs?: number;
  /** Grace period for transient Deployment CrashLoopBackOff recovery before readiness fails. */
  readonly crashLoopRecoveryGraceSeconds?: number;
}

export type KubectlKubernetesApi = KubernetesApi;
