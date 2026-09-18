import type {
  InfraExecutionContext,
  InfraResourceIdentity,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';
import { isInfraAdapterDescriptor } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createKubernetesDriver, projectKubernetesResourcesAsync } from './index';
import { FakeKubernetesApi } from './kubernetesApi.test';

it('projects deterministic standard resources without claiming a provider identity', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const first = await driver.projectAsync(createRequest());
  const second = await driver.projectAsync(createRequest());
  const standalone = await projectKubernetesResourcesAsync(createRequest());

  expect(first).toEqual(second);
  expect(standalone).toEqual(first);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.value.resources.map(({ resource }) => resource.kind)).toEqual([
    'Namespace',
    'ConfigMap',
    'Secret',
    'PersistentVolumeClaim',
    'Deployment',
    'Service',
    'Ingress',
  ]);
  expect(JSON.stringify(first.value)).not.toContain('resolved-secret-value');
  expect(first.value.secretBindings).toHaveLength(2);
  expect('infraAdapterDescriptor' in (await import('./index'))).toBe(false);
  expect(isInfraAdapterDescriptor(driver)).toBe(false);
});

it('reconciles deterministically and prunes only non-persistent owned resources', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createRequest();
  const firstPlan = await driver.planAsync(request);
  expect(firstPlan.ok && firstPlan.value.every(({ operation }) => operation === 'create')).toBe(
    true,
  );

  const first = await driver.reconcileAsync(request);
  expect(first.ok).toBe(true);
  expect(
    api.applied.some(
      (resource) => resource.stringData?.['env-api-key'] === 'resolved-secret-value',
    ),
  ).toBe(true);
  expect(api.resources.some((resource) => resource.metadata.name === 'unrelated')).toBe(true);

  const secondPlan = await driver.planAsync(request);
  expect(secondPlan.ok && secondPlan.value.every(({ operation }) => operation === 'noop')).toBe(
    true,
  );

  const deploymentIndex = api.resources.findIndex(({ kind }) => kind === 'Deployment');
  const deployment = api.resources.at(deploymentIndex);
  if (deployment === undefined) throw new Error('Expected the reconciled Deployment fixture.');
  api.resources.splice(deploymentIndex, 1, {
    ...deployment,
    spec: { ...deployment.spec, replicas: 2 },
  });
  const updatePlan = await driver.planAsync(request);
  expect(
    updatePlan.ok &&
      updatePlan.value.some(
        ({ operation, owner }) => operation === 'update' && owner.resourceId === 'workload:api',
      ),
  ).toBe(true);
  expect((await driver.reconcileAsync(request)).ok).toBe(true);

  const stalePlan = await driver.planAsync({ ...request, workloads: [] });
  expect(stalePlan.ok).toBe(true);
  if (!stalePlan.ok) return;
  api.resources.reverse();
  const reorderedStalePlan = await driver.planAsync({ ...request, workloads: [] });
  expect(reorderedStalePlan).toEqual(stalePlan);
  expect(stalePlan.value.some(({ operation }) => operation === 'delete')).toBe(true);
  expect(stalePlan.value.some(({ operation }) => operation === 'retain')).toBe(true);
  await driver.reconcileAsync({ ...request, workloads: [] });
  expect(api.deleted.map(({ kind }) => kind).join(',')).toBe(
    'Ingress,Service,Deployment,ConfigMap,Secret',
  );
  expect(api.resources.some((resource) => resource.metadata.name === 'unrelated')).toBe(true);
});

it('reports readiness, rollout status and safe public outputs', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api, defaultReadinessTimeoutSeconds: 12 });
  const request = createRequest();
  await driver.reconcileAsync(request);

  const readiness = await driver.waitUntilReadyAsync(request);
  expect(readiness.ok).toBe(true);
  expect(api.waits.every(({ timeoutSeconds }) => timeoutSeconds === 12)).toBe(true);
  const status = await driver.statusAsync(request);
  expect(status.ok && status.value.every(({ state }) => state === 'ready')).toBe(true);
  const outputs = await driver.outputsAsync(request);
  expect(outputs.ok).toBe(true);
  if (!outputs.ok) return;
  expect(outputs.value).toEqual([
    {
      owner: {
        projectId: 'sample',
        environment: 'local',
        adapter: 'minikube',
        resourceId: 'service:api',
      },
      name: 'endpoint',
      visibility: 'public',
      value: 'https://api.example.ch',
    },
  ]);
});

it('requires exact confirmation and explicit persistent-resource deletion', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createRequest();
  expect((await driver.reconcileAsync(request)).ok).toBe(true);

  const rejected = await driver.removeAsync(request, {
    projectId: 'wrong',
    environment: 'local',
    confirmation: { projectId: 'wrong', environment: 'local' },
    persistence: { policy: 'retain' },
  });
  expect(rejected.ok).toBe(false);

  const retained = await driver.removeAsync(request, createRetainedDestroyRequest());
  expect(retained.ok && retained.value.resources.some(({ persistent }) => persistent)).toBe(true);
  expect(api.deleted.some(({ kind }) => kind === 'Namespace')).toBe(false);

  const volumeIdentity: InfraResourceIdentity = {
    projectId: 'sample',
    environment: 'local',
    adapter: 'minikube',
    resourceId: 'volume:api:data',
  };
  const deleted = await driver.removeAsync(request, {
    ...createRetainedDestroyRequest(),
    persistence: { policy: 'delete', confirmedResources: [volumeIdentity] },
  });
  expect(deleted.ok).toBe(true);
  expect(api.deleted.some(({ kind }) => kind === 'PersistentVolumeClaim')).toBe(true);
});

it('fails closed when runtime secret materialization fails', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createRequest();
  const failed = await driver.reconcileAsync({
    ...request,
    context: {
      ...request.context,
      secrets: {
        resolveAsync: () =>
          Promise.resolve({
            ok: false as const,
            diagnostics: [
              {
                severity: 'error' as const,
                code: 'secret-unavailable',
                message: 'Secret unavailable.',
              },
            ],
          }),
      },
    },
  });

  expect(failed.ok).toBe(false);
  expect(api.applied).toHaveLength(0);
});

it('materializes one keyed bootstrap credential only at the Kubernetes apply boundary', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createCredentialRequest('bootstrap-token');
  const projection = await driver.projectAsync(request);

  expect(JSON.stringify(projection)).not.toContain('bootstrap-token');
  expect(
    projection.ok &&
      projection.value.secretBindings.some(({ segments }) =>
        segments.some(
          (segment) =>
            segment.kind === 'reference' &&
            segment.reference.source === 'control-plane' &&
            segment.reference.name === 'DEPLOYMENT' &&
            segment.reference.key === 'token',
        ),
      ),
  ).toBe(true);

  const reconciled = await driver.reconcileAsync(request);
  expect(reconciled.ok).toBe(true);
  expect(
    api.applied.some((resource) => resource.stringData?.['env-deploy-token'] === 'bootstrap-token'),
  ).toBe(true);
  expect(JSON.stringify(reconciled)).not.toContain('bootstrap-token');
});

it('fails closed when a keyed bootstrap credential field is missing', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const failed = await driver.reconcileAsync(createCredentialRequest(undefined));

  expect(failed.ok).toBe(false);
  expect(
    !failed.ok &&
      failed.diagnostics.some(({ code }) => code === 'kubernetes-credential-key-missing'),
  ).toBe(true);
  expect(api.applied).toHaveLength(0);
});

/*** Create a complete generic workload request used by the API-boundary fixture. */
function createRequest() {
  const workload: InfraWorkloadSpec = {
    id: 'api',
    artifact: { kind: 'image', image: 'registry.example/api@sha256:abc' },
    ports: { http: { port: 8080 } },
    environment: {
      MODE: { kind: 'literal', value: 'test' },
      API_KEY: { kind: 'secret', reference: createSecretReference('api-key') },
    },
    files: {
      '/etc/app/config.json': { kind: 'literal', value: '{}' },
      '/etc/app/credential': {
        kind: 'secret',
        reference: createSecretReference('credential'),
      },
    },
    persistence: {
      data: { id: 'data', mountPath: '/data', sizeGiB: 1, retention: 'delete-on-destroy' },
    },
    health: { kind: 'http', port: 8080, path: '/health' },
    resources: { cpuMillis: 100, memoryMiB: 128 },
    exposure: 'public',
  };
  return {
    context: createExecutionContext(),
    ownerAdapter: 'minikube' as const,
    workloads: [workload],
  };
}

/*** Create the execution context without a technology-specific runtime fixture. */
function createExecutionContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
      networking: { domain: 'api.example.ch' },
    },
    credentials: {
      resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
    },
    secrets: {
      resolveAsync: () =>
        Promise.resolve({
          ok: true,
          value: 'resolved-secret-value',
          diagnostics: [],
        }),
    },
  };
}

/*** Create a workload that consumes one keyed control-plane credential. */
function createCredentialRequest(token: string | undefined) {
  const request = createRequest();
  const [workload] = request.workloads;
  if (workload === undefined) throw new Error('Expected the workload fixture.');
  const credentials: Readonly<Record<string, string>> = token === undefined ? {} : { token };
  return {
    ...request,
    context: {
      ...request.context,
      credentials: {
        resolveAsync: () =>
          Promise.resolve({
            ok: true as const,
            value: credentials,
            diagnostics: [],
          }),
      },
    },
    workloads: [
      {
        ...workload,
        environment: {
          ...workload.environment,
          DEPLOY_TOKEN: {
            kind: 'credential' as const,
            reference: { source: 'control-plane' as const, name: 'DEPLOYMENT' },
            key: 'token',
          },
        },
      },
    ],
  };
}

/*** Create one canonical secret reference. */
function createSecretReference(ref: string) {
  return {
    source: 'secret-store' as const,
    projectId: 'sample',
    environment: 'local' as const,
    ref,
    key: 'value',
  };
}

/*** Create a confirmed destruction request with retained persistence. */
function createRetainedDestroyRequest() {
  return {
    projectId: 'sample',
    environment: 'local' as const,
    confirmation: { projectId: 'sample', environment: 'local' as const },
    persistence: { policy: 'retain' as const },
  };
}
