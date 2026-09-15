import type { KubernetesCommandResult } from '../../../types/kubectl';
import type {
  KubernetesResourceObservation,
  KubernetesResourceReference,
} from '../../../types/kubernetesResources';

const DEPLOYMENT_POD_LABEL = 'app.kubernetes.io/name';
const STARTUP_FAILURE_POD_WAITING_REASONS = new Set([
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

interface KubectlPodCommand {
  runAsync(
    arguments_: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<KubernetesCommandResult>;
}

interface DeploymentPodFailure {
  readonly observation: KubernetesResourceObservation;
  readonly recoverable: boolean;
}

/*** Inspect Pods belonging to one pending Deployment for actionable startup failures. */
export async function observeKubectlDeploymentPodFailureAsync(
  command: KubectlPodCommand,
  resource: KubernetesResourceReference,
  signal?: AbortSignal,
): Promise<DeploymentPodFailure | undefined> {
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
    signal === undefined ? {} : { signal },
  );
  if (result.exitCode !== 0) throw new Error('kubectl command failed.');
  return parseDeploymentPodFailure(result.stdout);
}

/*** Parse only sanitized Pod identity, phase and waiting-reason fields. */
function parseDeploymentPodFailure(value: string): DeploymentPodFailure | undefined {
  return value
    .split('\n')
    .map(parsePodFailureLine)
    .find((failure): failure is DeploymentPodFailure => failure !== undefined);
}

/*** Map one sanitized Pod status line to a readiness failure when applicable. */
function parsePodFailureLine(line: string): DeploymentPodFailure | undefined {
  const [podName = '', phase = '', statuses = ''] = line.trim().split('\t');
  if (podName.length === 0) return undefined;
  if (phase === 'Failed') {
    return {
      observation: { state: 'failed', detail: `Pod ${podName} failed.` },
      recoverable: false,
    };
  }
  const failure = statuses
    .split(';')
    .map((status) => status.split('=', 2))
    .find(([, reason]) =>
      reason === undefined ? false : STARTUP_FAILURE_POD_WAITING_REASONS.has(reason),
    );
  const [containerName, reason] = failure ?? [];
  if (containerName === undefined || reason === undefined) return undefined;
  return {
    observation: {
      state: 'failed',
      detail: `Pod ${podName} container ${containerName} is ${reason}.`,
    },
    recoverable: reason === 'CrashLoopBackOff',
  };
}
