import type {
  InfraDestroyRequest,
  InfraExecutionContext,
  InfraResourceIdentity,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createKubernetesDriver } from './index';
import { createCredentialPort } from './infraExecutionContextFixtures.test';
import { FakeKubernetesApi } from './kubernetesApi.test';

it('requires explicit resource confirmation before deleting retained persistence', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createRequest();
  expect((await driver.reconcileAsync(request)).ok).toBe(true);

  const retained = await driver.removeAsync(request, createDestroyRequest({ policy: 'retain' }));
  expect(retained.ok).toBe(true);
  expect(api.deleted.some(({ kind }) => kind === 'PersistentVolumeClaim')).toBe(false);
  expect(api.deleted.some(({ kind }) => kind === 'Namespace')).toBe(false);

  const volumeIdentity = createVolumeIdentity();
  const deleted = await driver.removeAsync(
    request,
    createDestroyRequest({ policy: 'delete', confirmedResources: [volumeIdentity] }),
  );
  expect(deleted.ok).toBe(true);
  expect(deleted.ok && deleted.value.resources).toEqual([]);
  expect(api.deleted.some(({ kind }) => kind === 'PersistentVolumeClaim')).toBe(true);
  expect(api.deleted.some(({ kind }) => kind === 'Namespace')).toBe(true);
});

function createRequest() {
  const workload: InfraWorkloadSpec = {
    id: 'database',
    artifact: { kind: 'image', image: 'postgres:17' },
    persistence: {
      data: {
        id: 'data',
        mountPath: '/var/lib/postgresql/data',
        sizeGiB: 20,
        retention: 'retain',
      },
    },
  };
  return {
    context: createExecutionContext(),
    ownerAdapter: 'minikube' as const,
    workloads: [workload],
  };
}

function createExecutionContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'production',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'minikube', profile: 'sample' },
      },
      networking: {},
    },
    credentials: createCredentialPort(),
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: 'unused', diagnostics: [] }),
    },
  };
}

function createDestroyRequest(
  persistence: InfraDestroyRequest['persistence'],
): InfraDestroyRequest {
  return {
    projectId: 'sample',
    environment: 'production',
    confirmation: { projectId: 'sample', environment: 'production' },
    persistence,
  };
}

function createVolumeIdentity(): InfraResourceIdentity {
  return {
    projectId: 'sample',
    environment: 'production',
    adapter: 'minikube',
    resourceId: 'volume:database:data',
  };
}
