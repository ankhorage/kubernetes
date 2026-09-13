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

/** Process boundary used by the concrete kubectl adapter without invoking a shell. */
export interface KubernetesCommandRunner {
  runAsync(request: KubernetesCommandRequest): Promise<KubernetesCommandResult>;
}

export interface KubectlKubernetesApiOptions {
  /** Exact authenticated kubeconfig context selected by the owning runtime adapter. */
  readonly context: string;
  readonly executable?: string;
  readonly runner?: KubernetesCommandRunner;
  readonly pollIntervalMs?: number;
}

export type KubectlKubernetesApi = KubernetesApi;
