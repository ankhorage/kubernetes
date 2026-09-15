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

const NAMESPACED_RESOURCE_TYPES = [
  'configmaps',
  'secrets',
  'persistentvolumeclaims',
  'deployments.apps',
  'services',
  'ingresses.networking.k8s.io',
].join(',');
const DEPLOYMENT_POD_LABEL = 'app.kubernetes.io/name';
const TERMINAL_POD_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'CreateContainerConfigError',
  'CreateContainerError',
  'ErrImagePull',
  'ImagePullBackOff',
  'InvalidImageName',
  'RunContainerError',
]);
const POD_FAILURE_JSON_PATH = [
  '{range .items[*]}',
  '{.metadata.name}{"\\t"}',
  '{.status.phase}{"\\t"}',
  '{range .status.initContainerStatuses[*]}',
  '{.name}{"="}{.state.waiting.reason}{";"}',
  '{end}',
  '{range .status.containerStatuses[*]}',
  '{.name}{"="}{.state.waiting.reason}{";"}',
  '{end}',
  '{range .status.ephemeralContainerStatuses[*]}',
  '{.name}{"="}{.state.waiting.reason}{";"}',
  '{end}{"\\n"}',
  '{end}',
].join('');

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
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 0) {
    throw new TypeError('kubectl pollIntervalMs must be a non-negative integer.');
  }
  const command = createCommand(runner, executable, options.context);
  return {
    listOwnedAsync: (query) => listOwnedAsync(command, query),
    applyAsync: (resource, signal) => applyAsync(command, resource, signal),
    deleteAsync: (resource, signal) => deleteAsync(command, resource, signal),
    observeAsync: (resource, signal) => observeAsync(command, resource, signal),
    waitUntilReadyAsync: (resource, waitOptions) =>
      waitUntilReadyAsync(command, resource, waitOptions, pollIntervalMs),
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

/*** Poll live resource state until ready, terminal failure or timeout. */
async function waitUntilReadyAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  pollIntervalMs: number,
): Promise<KubernetesResourceObservation> {
  const deadline = Date.now() + options.timeoutSeconds * 1_000;
  for (;;) {
    const observed = await observeAsync(command, resource, options.signal);
    const observation =
      observed.state === 'pending' && resource.kind === 'Deployment'
        ? ((await observeDeploymentPodFailureAsync(command, resource, options.signal)) ?? observed)
        : observed;
    if (observation.state === 'ready' || observation.state === 'failed') return observation;
    if (Date.now() >= deadline) {
      return {
        state: 'degraded',
        detail: `Timed out waiting for ${resource.kind}/${resource.name}.`,
      };
    }
    await delayAsync(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), options.signal);
  }
}

/*** Inspect Pods belonging to one pending Deployment for actionable startup failures. */
async function observeDeploymentPodFailureAsync(
  command: KubectlCommand,
  resource: KubernetesResourceReference,
  signal?: AbortSignal,
): Promise<KubernetesResourceObservation | undefined> {
  const result = await command.runAsync(
    [
      'get',
      'pods',
      ...(resource.namespace === undefined ? [] : ['--namespace', resource.namespace]),
      '-l',
      `${DEPLOYMENT_POD_LABEL}=${resource.name}`,
      '-o',
      `jsonpath=${POD_FAILURE_JSON_PATH}`,
    ],
    signalOption(signal),
  );
  ensureSuccess(result);
  return parseDeploymentPodFailure(result.stdout);
}

/*** Parse only sanitized Pod identity, phase and waiting-reason fields. */
function parseDeploymentPodFailure(value: string): KubernetesResourceObservation | undefined {
  return value
    .split('\n')
    .map(parsePodFailureLine)
    .find(
      (observation): observation is KubernetesResourceObservation => observation !== undefined,
    );
}

/*** Map one sanitized Pod status line to a terminal readiness observation when applicable. */
function parsePodFailureLine(line: string): KubernetesResourceObservation | undefined {
  const [podName = '', phase = '', statuses = ''] = line.trim().split('\t');
  if (podName.length === 0) return undefined;
  if (phase === 'Failed') return { state: 'failed', detail: `Pod ${podName} failed.` };
  const failure = statuses
    .split(';')
    .map((status) => status.split('=', 2))
    .find(([, reason]) => reason !== undefined && TERMINAL_POD_WAITING_REASONS.has(reason));
  const [containerName, reason] = failure ?? [];
  if (containerName === undefined || reason === undefined) return undefined;
  return {
    state: 'failed',
    detail: `Pod ${podName} container ${containerName} is ${reason}.`,
  };
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
