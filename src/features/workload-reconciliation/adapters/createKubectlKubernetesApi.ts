import type {
  KubectlKubernetesApiOptions,
  KubernetesCommandResult,
  KubernetesCommandRunner,
} from '../../../types/kubectl';
import type {
  KubernetesApi,
  KubernetesOwnershipQuery,
  KubernetesResource,
  KubernetesResourceObservation,
  KubernetesResourceReference,
} from '../../../types/kubernetesResources';
import { createSubprocessKubernetesCommandRunner } from './createSubprocessKubernetesCommandRunner';
import {
  labelsInclude,
  observeKubectlResource,
  parseKubectlJsonRecord,
  parseKubectlResourceList,
  parseOptionalKubectlResource,
} from './kubectlResource';
import { observeKubectlDeploymentPodFailureAsync } from './observeKubectlDeploymentPodFailureAsync';

const NAMESPACED_RESOURCE_TYPES = [
  'configmaps',
  'secrets',
  'persistentvolumeclaims',
  'deployments.apps',
  'services',
  'ingresses.networking.k8s.io',
].join(',');
const DEFAULT_CRASH_LOOP_RECOVERY_GRACE_SECONDS = 30;

/***
 * Create a concrete Kubernetes API backed by an authenticated kubectl context.
 *
 * Commands are executed as argv arrays without a shell. Secret manifests are supplied only on
 * standard input and are never included in errors or observations.
 *
 * @readme
 */
export function createKubectlKubernetesApi(options: KubectlKubernetesApiOptions): KubernetesApi {
  if (options.context.trim().length === 0) {
    throw new TypeError('kubectl requires a non-empty authenticated context.');
  }
  const runner = options.runner ?? createSubprocessKubernetesCommandRunner();
  const executable = options.executable ?? 'kubectl';
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  const crashLoopRecoveryGraceSeconds =
    options.crashLoopRecoveryGraceSeconds ?? DEFAULT_CRASH_LOOP_RECOVERY_GRACE_SECONDS;
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError('kubectl pollIntervalMs must be a non-negative integer.');
  }
  if (!Number.isInteger(crashLoopRecoveryGraceSeconds) || crashLoopRecoveryGraceSeconds < 0) {
    throw new TypeError('kubectl crashLoopRecoveryGraceSeconds must be a non-negative integer.');
  }
  const command = createCommand(runner, executable, options.context);
  return {
    listOwnedAsync: (query) => listOwnedAsync(command, query),
    applyAsync: (resource, signal) => applyAsync(command, resource, signal),
    deleteAsync: (resource, signal) => deleteAsync(command, resource, signal),
    observeAsync: (resource, signal) => observeAsync(command, resource, signal),
    waitUntilReadyAsync: (resource, waitOptions) =>
      waitUntilReadyAsync(
        command,
        resource,
        waitOptions,
        pollIntervalMs,
        crashLoopRecoveryGraceSeconds * 1_000,
      ),
  };
}

interface KubectlCommand {
  runAsync(
    arguments_: readonly string[],
    options?: { readonly stdin?: string; readonly signal?: AbortSignal },
  ): Promise<KubernetesCommandResult>;
}

/*** Bind an executable and exact kubeconfig context to every kubectl invocation. */
function createCommand(
  runner: KubernetesCommandRunner,
  executable: string,
  context: string,
): KubectlCommand {
  return {
    runAsync: (arguments_, options = {}) =>
      runner.runAsync({
        executable,
        arguments: ['--context', context, ...arguments_],
        ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
  };
}

/*** List only resources selected by the driver's namespace and ownership labels. */
async function listOwnedAsync(
  command: KubectlCommand,
  query: KubernetesOwnershipQuery,
): Promise<readonly KubernetesResource[]> {
  const selector = Object.entries(query.labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  const namespace = await command.runAsync(
    ['get', 'namespace', query.namespace, '--ignore-not-found=true', '-o', 'json'],
    signalOption(query.signal),
  );
  ensureSuccess(namespace);
  if (namespace.stdout.trim().length === 0) return [];
  const namespaced = await command.runAsync(
    [
      'get',
      NAMESPACED_RESOURCE_TYPES,
      '--namespace',
      query.namespace,
      '-l',
      selector,
      '-o',
      'json',
    ],
    signalOption(query.signal),
  );
  ensureSuccess(namespaced);
  return [
    ...parseOptionalKubectlResource(namespace.stdout).filter((resource) =>
      labelsInclude(resource.metadata.labels, query.labels),
    ),
    ...parseKubectlResourceList(namespaced.stdout),
  ];
}

/*** Apply one exact resource through standard input so values never enter argv. */
async function applyAsync(
  command: KubectlCommand,
  resource: KubernetesResource,
  signal?: AbortSignal,
): Promise<void> {
  const result = await command.runAsync(['apply', '-f', '-'], {
    stdin: JSON.stringify(resource),
    ...(signal === undefined ? {} : { signal }),
  });
  ensureSuccess(result);
}

/*** Delete one exact resource identity and tolerate an already absent resource. */
async function deleteAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  signal?: AbortSignal,
): Promise<void> {
  const result = await command.runAsync(
    [
      'delete',
      `${resource.kind}/${resource.name}`,
      '--ignore-not-found=true',
      ...(resource.namespace === undefined ? [] : ['--namespace', resource.namespace]),
    ],
    signalOption(signal),
  );
  ensureSuccess(result);
}

/*** Read one live resource and map its standard readiness and public endpoint state. */
async function observeAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  signal?: AbortSignal,
): Promise<KubernetesResourceObservation> {
  const result = await command.runAsync(
    [
      'get',
      `${resource.kind}/${resource.name}`,
      ...(resource.namespace === undefined ? [] : ['--namespace', resource.namespace]),
      '--ignore-not-found=true',
      '-o',
      'json',
    ],
    signalOption(signal),
  );
  ensureSuccess(result);
  if (result.stdout.trim().length === 0) return { state: 'absent' };
  return observeKubectlResource(parseKubectlJsonRecord(result.stdout));
}

/*** Poll live resource state until ready, persistent failure or timeout. */
async function waitUntilReadyAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  pollIntervalMs: number,
  crashLoopRecoveryGraceMilliseconds: number,
): Promise<KubernetesResourceObservation> {
  const deadline = Date.now() + options.timeoutSeconds * 1_000;
  return pollReadinessAsync(
    command,
    resource,
    options,
    pollIntervalMs,
    crashLoopRecoveryGraceMilliseconds,
    deadline,
  );
}

/*** Poll one resource while preserving a bounded CrashLoopBackOff recovery window. */
async function pollReadinessAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  pollIntervalMs: number,
  crashLoopRecoveryGraceMilliseconds: number,
  deadline: number,
  crashLoopStartedAt?: number,
): Promise<KubernetesResourceObservation> {
  const observed = await observeAsync(command, resource, options.signal);
  if (observed.state === 'ready' || observed.state === 'failed') return observed;
  const failure =
    observed.state === 'pending' && resource.kind === 'Deployment'
      ? await observeKubectlDeploymentPodFailureAsync(command, resource, options.signal)
      : undefined;
  if (failure !== undefined && !failure.recoverable) return failure.observation;

  const now = Date.now();
  const nextCrashLoopStartedAt =
    failure?.recoverable === true ? (crashLoopStartedAt ?? now) : undefined;
  if (
    failure !== undefined &&
    nextCrashLoopStartedAt !== undefined &&
    now - nextCrashLoopStartedAt >= crashLoopRecoveryGraceMilliseconds
  ) {
    return failure.observation;
  }
  if (now >= deadline) {
    return {
      state: 'degraded',
      detail: `Timed out waiting for ${resource.kind}/${resource.name}.`,
    };
  }
  await delayAsync(Math.min(pollIntervalMs, Math.max(0, deadline - now)), options.signal);
  return pollReadinessAsync(
    command,
    resource,
    options,
    pollIntervalMs,
    crashLoopRecoveryGraceMilliseconds,
    deadline,
    nextCrashLoopStartedAt,
  );
}

/*** Throw a sanitized failure that never includes stdin, stdout or stderr content. */
function ensureSuccess(result: KubernetesCommandResult): void {
  if (result.exitCode !== 0) throw new Error('kubectl command failed.');
}

/*** Build an optional signal bag without assigning undefined. */
function signalOption(signal?: AbortSignal): { readonly signal?: AbortSignal } {
  return signal === undefined ? {} : { signal };
}

/*** Wait between API observations and abort promptly when requested. */
function delayAsync(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return new Promise((resolve) => setTimeout(resolve, milliseconds));
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/*** Normalize an AbortSignal reason to an Error for predictable rejection handling. */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('kubectl operation aborted.');
}
