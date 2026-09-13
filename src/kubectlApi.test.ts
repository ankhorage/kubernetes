import { expect, it } from 'bun:test';

import { createSubprocessKubernetesCommandRunner } from './features/workload-reconciliation/adapters/createSubprocessKubernetesCommandRunner';
import type {
  KubernetesCommandRequest,
  KubernetesCommandResult,
  KubernetesCommandRunner,
  KubernetesResource,
} from './index';
import { createKubectlKubernetesApi } from './index';

const ownership = {
  'app.kubernetes.io/managed-by': 'ankhorage-infra',
  'ankhorage.com/project': 'sample',
};

it('lists only owned resources and compares the exact last-applied shape', async () => {
  const runner = new RecordingRunner();
  const namespace = createResource('Namespace', 'sample-local', undefined, {
    status: { phase: 'Active' },
  });
  const desiredDeployment = createResource('Deployment', 'api', 'sample-local', {
    spec: { replicas: 1 },
  });
  const liveDeployment = createResource('Deployment', 'api', 'sample-local', {
    annotations: {
      ...desiredDeployment.metadata.annotations,
      'kubectl.kubernetes.io/last-applied-configuration': JSON.stringify(desiredDeployment),
    },
    spec: { replicas: 1, revisionHistoryLimit: 10 },
    status: { availableReplicas: 1 },
  });
  runner.responses.push(success(namespace), success({ items: [liveDeployment] }));
  const api = createKubectlKubernetesApi({ context: 'sample-local', runner });

  const resources = await api.listOwnedAsync({
    namespace: 'sample-local',
    labels: ownership,
  });

  expect(resources).toEqual([withoutStatus(namespace), desiredDeployment]);
  expect(runner.requests.map(({ arguments: arguments_ }) => arguments_)).toEqual([
    [
      '--context',
      'sample-local',
      'get',
      'namespace',
      'sample-local',
      '--ignore-not-found=true',
      '-o',
      'json',
    ],
    [
      '--context',
      'sample-local',
      'get',
      'configmaps,secrets,persistentvolumeclaims,deployments.apps,services,ingresses.networking.k8s.io',
      '--namespace',
      'sample-local',
      '-l',
      'ankhorage.com/project=sample,app.kubernetes.io/managed-by=ankhorage-infra',
      '-o',
      'json',
    ],
  ]);
});

it('returns an empty owned set before the workload namespace exists', async () => {
  const runner = new RecordingRunner();
  runner.responses.push(success(''));
  const api = createKubectlKubernetesApi({ context: 'sample-local', runner });

  const resources = await api.listOwnedAsync({ namespace: 'new-environment', labels: ownership });

  expect(resources).toEqual([]);
  expect(runner.requests).toHaveLength(1);
});

it('applies manifests only through stdin and deletes one exact identity', async () => {
  const runner = new RecordingRunner();
  runner.responses.push(success({}), success({}));
  const api = createKubectlKubernetesApi({ context: 'sample-local', runner });
  const secret = createResource('Secret', 'api-secret', 'sample-local', {
    stringData: { token: 'SENTINEL_SECRET' },
  });

  await api.applyAsync(secret);
  await api.deleteAsync({
    apiVersion: 'v1',
    kind: 'Secret',
    name: 'api-secret',
    namespace: 'sample-local',
  });

  expect(runner.requests[0]?.arguments).toEqual(['--context', 'sample-local', 'apply', '-f', '-']);
  expect(runner.requests[0]?.stdin).toContain('SENTINEL_SECRET');
  expect(runner.requests[0]?.arguments.join(' ')).not.toContain('SENTINEL_SECRET');
  expect(runner.requests[1]?.arguments).toEqual([
    '--context',
    'sample-local',
    'delete',
    'Secret/api-secret',
    '--ignore-not-found=true',
    '--namespace',
    'sample-local',
  ]);
});

it('maps standard readiness, timeout and public ingress output', async () => {
  const runner = new RecordingRunner();
  runner.responses.push(
    success(
      createResource('Deployment', 'api', 'sample-local', {
        generation: 2,
        spec: { replicas: 1 },
        status: { availableReplicas: 0, observedGeneration: 1 },
      }),
    ),
    success(
      createResource('Deployment', 'api', 'sample-local', {
        generation: 2,
        spec: { replicas: 1 },
        status: { availableReplicas: 1, observedGeneration: 2 },
      }),
    ),
    success(
      createResource('Ingress', 'api', 'sample-local', {
        spec: { rules: [{ host: 'api.example.ch' }] },
      }),
    ),
    success(''),
  );
  const api = createKubectlKubernetesApi({
    context: 'sample-local',
    runner,
    pollIntervalMs: 0,
  });
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    name: 'api',
    namespace: 'sample-local',
  };

  expect(await api.waitUntilReadyAsync(deployment, { timeoutSeconds: 1 })).toEqual({
    state: 'ready',
  });
  expect(
    await api.observeAsync({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      name: 'api',
      namespace: 'sample-local',
    }),
  ).toEqual({ state: 'ready', publicOutputs: { endpoint: 'https://api.example.ch' } });
  expect(await api.observeAsync(deployment)).toEqual({ state: 'absent' });
});

it('sanitizes kubectl failures without exposing manifest input or provider stderr', async () => {
  const runner = new RecordingRunner();
  runner.responses.push({ exitCode: 1, stdout: '', stderr: 'SENTINEL_PROVIDER_ERROR' });
  const api = createKubectlKubernetesApi({ context: 'sample-local', runner });
  const secret = createResource('Secret', 'api-secret', 'sample-local', {
    stringData: { token: 'SENTINEL_SECRET' },
  });

  const error = await api.applyAsync(secret).catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error('Expected a sanitized kubectl error.');
  expect(error.message).toBe('kubectl command failed.');
  expect(error.message).not.toContain('SENTINEL');
});

it('executes the concrete subprocess boundary without a shell', async () => {
  const runner = createSubprocessKubernetesCommandRunner();
  const result = await runner.runAsync({
    executable: process.execPath,
    arguments: [
      '-e',
      "let value = ''; process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value.toUpperCase()));",
    ],
    stdin: 'process-boundary',
  });

  expect(result).toEqual({ exitCode: 0, stdout: 'PROCESS-BOUNDARY', stderr: '' });
});

class RecordingRunner implements KubernetesCommandRunner {
  readonly requests: KubernetesCommandRequest[] = [];
  readonly responses: KubernetesCommandResult[] = [];

  runAsync(request: KubernetesCommandRequest): Promise<KubernetesCommandResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('Missing kubectl fixture response.');
    return Promise.resolve(response);
  }
}

/*** Create a successful command fixture with JSON output. */
function success(value: unknown): KubernetesCommandResult {
  return {
    exitCode: 0,
    stdout: typeof value === 'string' ? value : JSON.stringify(value),
    stderr: '',
  };
}

/*** Create one live Kubernetes API fixture with optional server-owned fields. */
function createResource(
  kind: string,
  name: string,
  namespace: string | undefined,
  options: {
    readonly annotations?: Readonly<Record<string, string>>;
    readonly generation?: number;
    readonly data?: Readonly<Record<string, string>>;
    readonly stringData?: Readonly<Record<string, string>>;
    readonly spec?: Readonly<Record<string, unknown>>;
    readonly status?: Readonly<Record<string, unknown>>;
  },
) {
  return {
    apiVersion:
      kind === 'Deployment' ? 'apps/v1' : kind === 'Ingress' ? 'networking.k8s.io/v1' : 'v1',
    kind,
    metadata: {
      name,
      ...(namespace === undefined ? {} : { namespace }),
      labels: ownership,
      annotations: options.annotations ?? {},
      ...(options.generation === undefined ? {} : { generation: options.generation }),
    },
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.stringData === undefined ? {} : { stringData: options.stringData }),
    ...(options.spec === undefined ? {} : { spec: options.spec }),
    ...(options.status === undefined ? {} : { status: options.status }),
  };
}

/*** Remove server-owned status fields from a resource fixture. */
function withoutStatus(resource: ReturnType<typeof createResource>): KubernetesResource {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: {
      name: resource.metadata.name,
      ...('namespace' in resource.metadata ? { namespace: resource.metadata.namespace } : {}),
      labels: resource.metadata.labels,
      annotations: resource.metadata.annotations,
    },
    ...('data' in resource ? { data: resource.data } : {}),
    ...('stringData' in resource ? { stringData: resource.stringData } : {}),
    ...('spec' in resource ? { spec: resource.spec } : {}),
  };
}
