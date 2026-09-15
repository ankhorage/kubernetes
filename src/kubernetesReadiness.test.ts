import type { InfraExecutionContext, InfraWorkloadSpec } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import type {
  KubernetesApi,
  KubernetesCommandRequest,
  KubernetesCommandResult,
  KubernetesCommandRunner,
  KubernetesDriverRequest,
  KubernetesOwnershipQuery,
  KubernetesResource,
  KubernetesResourceObservation,
  KubernetesResourceReference,
} from './index';
import { createKubectlKubernetesApi, createKubernetesDriver } from './index';

it('shares one readiness deadline and stops at the first failed dependency', async () => {
  const api = new FailingReadinessApi();
  const driver = createKubernetesDriver({ api, defaultReadinessTimeoutSeconds: 2 });

  const result = await driver.waitUntilReadyAsync(createRequest());

  expect(result.ok).toBe(false);
  expect(api.waits).toEqual([2, 1, 1]);
  expect(
    !result.ok &&
      result.diagnostics.some(
        ({ message }) =>
          message ===
          'Kubernetes resource workload:api is failed. Pod api-7d9 container api is CrashLoopBackOff.',
      ),
  ).toBe(true);
});

it('detects a persistent crash-looping Deployment Pod before the readiness timeout', async () => {
  const runner = new RecordingRunner([
    success(createPendingDeployment()),
    success('api-7d9\tRunning\tapi=CrashLoopBackOff;\n'),
  ]);
  const api = createKubectlKubernetesApi({
    context: 'sample-local',
    runner,
    pollIntervalMs: 0,
    crashLoopRecoveryGraceSeconds: 0,
  });

  const observation = await api.waitUntilReadyAsync(createDeploymentReference(), {
    timeoutSeconds: 300,
  });

  expect(observation).toEqual({
    state: 'failed',
    detail: 'Pod api-7d9 container api is CrashLoopBackOff.',
  });
  expect(runner.requests).toHaveLength(2);
  expect(runner.requests[1]?.arguments).toContain('app.kubernetes.io/name=api');
});

it('allows a transient crash-looping Deployment Pod to recover within the grace period', async () => {
  const runner = new RecordingRunner([
    success(createPendingDeployment()),
    success('api-7d9\tRunning\tapi=CrashLoopBackOff;\n'),
    success(createPendingDeployment()),
    success(''),
    success(createReadyDeployment()),
  ]);
  const api = createKubectlKubernetesApi({
    context: 'sample-local',
    runner,
    pollIntervalMs: 0,
    crashLoopRecoveryGraceSeconds: 1,
  });

  const observation = await api.waitUntilReadyAsync(createDeploymentReference(), {
    timeoutSeconds: 1,
  });

  expect(observation).toEqual({ state: 'ready' });
  expect(runner.requests).toHaveLength(5);
});

it('keeps non-recoverable startup failures immediately fatal', async () => {
  const runner = new RecordingRunner([
    success(createPendingDeployment()),
    success('api-7d9\tRunning\tapi=ImagePullBackOff;\n'),
  ]);
  const api = createKubectlKubernetesApi({
    context: 'sample-local',
    runner,
    pollIntervalMs: 0,
    crashLoopRecoveryGraceSeconds: 30,
  });

  const observation = await api.waitUntilReadyAsync(createDeploymentReference(), {
    timeoutSeconds: 300,
  });

  expect(observation).toEqual({
    state: 'failed',
    detail: 'Pod api-7d9 container api is ImagePullBackOff.',
  });
  expect(runner.requests).toHaveLength(2);
});

it('maps terminal Deployment conditions to sanitized failure detail', async () => {
  const runner = new RecordingRunner([
    success({
      ...createPendingDeployment(),
      status: {
        availableReplicas: 0,
        observedGeneration: 1,
        conditions: [
          {
            type: 'Progressing',
            status: 'False',
            reason: 'ProgressDeadlineExceeded',
            message: 'SENTINEL_PROVIDER_DETAIL',
          },
        ],
      },
    }),
  ]);
  const api = createKubectlKubernetesApi({ context: 'sample-local', runner });

  const observation = await api.observeAsync(createDeploymentReference());

  expect(observation).toEqual({
    state: 'failed',
    detail: 'Deployment is ProgressDeadlineExceeded.',
  });
  expect(JSON.stringify(observation)).not.toContain('SENTINEL');
});

class FailingReadinessApi implements KubernetesApi {
  readonly waits: number[] = [];

  listOwnedAsync(_query: KubernetesOwnershipQuery): Promise<readonly KubernetesResource[]> {
    return Promise.resolve([]);
  }

  applyAsync(_resource: KubernetesResource, _signal?: AbortSignal): Promise<void> {
    return Promise.resolve();
  }

  deleteAsync(_resource: KubernetesResourceReference, _signal?: AbortSignal): Promise<void> {
    return Promise.resolve();
  }

  observeAsync(
    _resource: KubernetesResourceReference,
    _signal?: AbortSignal,
  ): Promise<KubernetesResourceObservation> {
    return Promise.resolve({ state: 'ready' });
  }

  async waitUntilReadyAsync(
    _resource: KubernetesResourceReference,
    options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  ): Promise<KubernetesResourceObservation> {
    const waitIndex = this.waits.length;
    this.waits.push(options.timeoutSeconds);
    if (waitIndex === 0) await delayAsync(1_100);
    return waitIndex === 2
      ? {
          state: 'failed',
          detail: 'Pod api-7d9 container api is CrashLoopBackOff.',
        }
      : { state: 'ready' };
  }
}

class RecordingRunner implements KubernetesCommandRunner {
  readonly requests: KubernetesCommandRequest[] = [];
  readonly responses: KubernetesCommandResult[] = [];

  constructor(responses: readonly KubernetesCommandResult[]) {
    this.responses.push(...responses);
  }

  runAsync(request: KubernetesCommandRequest): Promise<KubernetesCommandResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('Missing kubectl fixture response.');
    return Promise.resolve(response);
  }
}

/*** Create one readiness request containing dependency-ordered public persistent workload resources. */
function createRequest(): KubernetesDriverRequest {
  const context: InfraExecutionContext = {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'minikube' },
      },
      networking: { domain: 'api.example.ch' },
    },
    credentials: {
      resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
    },
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }),
    },
  };
  const workload: InfraWorkloadSpec = {
    id: 'api',
    artifact: { kind: 'image', image: 'registry.example/api@sha256:abc' },
    ports: [{ name: 'http', port: 8080 }],
    persistence: [{ id: 'data', mountPath: '/data', sizeGiB: 1, retention: 'retain' }],
    exposure: 'public',
  };
  return { context, ownerAdapter: 'minikube', workloads: [workload] };
}

/*** Create one pending live Deployment fixture. */
function createPendingDeployment() {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'api',
      namespace: 'sample-local',
      labels: {},
      annotations: {},
      generation: 1,
    },
    spec: { replicas: 1 },
    status: { availableReplicas: 0, observedGeneration: 1 },
  };
}

/*** Create one ready live Deployment fixture. */
function createReadyDeployment() {
  return {
    ...createPendingDeployment(),
    status: { availableReplicas: 1, observedGeneration: 1 },
  };
}

/*** Create the matching Deployment reference. */
function createDeploymentReference(): KubernetesResourceReference {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    name: 'api',
    namespace: 'sample-local',
  };
}

/*** Create one successful command fixture with JSON or preformatted output. */
function success(value: unknown): KubernetesCommandResult {
  return {
    exitCode: 0,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: '',
  };
}

/*** Wait for the requested deterministic test interval. */
function delayAsync(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
