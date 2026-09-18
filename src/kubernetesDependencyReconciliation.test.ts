import type { InfraExecutionContext, InfraWorkloadSpec } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import type {
  KubernetesResource,
  KubernetesResourceObservation,
  KubernetesResourceReference,
} from './index';
import { createKubernetesDriver } from './index';
import { createCredentialPort } from './infraExecutionContextFixtures.test';
import { FakeKubernetesApi } from './kubernetesApi.test';

it('waits for a workload dependency before applying the dependent Deployment', async () => {
  const api = new DependencyRecordingApi();
  const driver = createKubernetesDriver({ api, defaultReadinessTimeoutSeconds: 30 });

  const result = await driver.reconcileAsync(createDependencyRequest());

  expect(result.ok).toBe(true);
  expect(api.events.indexOf('apply:Deployment:database')).toBeGreaterThan(-1);
  expect(api.events.indexOf('wait:Deployment:database')).toBeGreaterThan(
    api.events.indexOf('apply:Deployment:database'),
  );
  expect(api.events.indexOf('apply:Deployment:api')).toBeGreaterThan(
    api.events.indexOf('wait:Deployment:database'),
  );
});

it('does not apply a workload when its dependency fails readiness', async () => {
  const api = new DependencyRecordingApi('database');
  const driver = createKubernetesDriver({ api, defaultReadinessTimeoutSeconds: 30 });

  const result = await driver.reconcileAsync(createDependencyRequest());

  expect(result.ok).toBe(false);
  expect(api.events).not.toContain('apply:Deployment:api');
  expect(
    !result.ok &&
      result.diagnostics.some(
        ({ code, owner }) =>
          code === 'kubernetes-dependency-readiness-failed' &&
          owner?.resourceId === 'workload:database',
      ),
  ).toBe(true);
});

class DependencyRecordingApi extends FakeKubernetesApi {
  readonly events: string[] = [];

  constructor(private readonly failedDeployment?: string) {
    super();
  }

  override applyAsync(resource: KubernetesResource, _signal?: AbortSignal): Promise<void> {
    this.events.push(`apply:${resource.kind}:${resource.metadata.name}`);
    return super.applyAsync(resource);
  }

  override waitUntilReadyAsync(
    resource: KubernetesResourceReference,
    options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  ): Promise<KubernetesResourceObservation> {
    this.events.push(`wait:${resource.kind}:${resource.name}`);
    if (resource.kind === 'Deployment' && resource.name === this.failedDeployment) {
      return Promise.resolve({ state: 'failed', detail: 'Dependency failed readiness.' });
    }
    return super.waitUntilReadyAsync(resource, options);
  }
}

/*** Create two workloads whose second Deployment requires the first to be ready. */
function createDependencyRequest() {
  const database: InfraWorkloadSpec = {
    id: 'database',
    artifact: { kind: 'image', image: 'registry.example/database@sha256:abc' },
    health: { kind: 'tcp', port: 5432 },
  };
  const api: InfraWorkloadSpec = {
    id: 'api',
    artifact: { kind: 'image', image: 'registry.example/api@sha256:def' },
    dependsOn: { database: true },
  };
  return {
    context: createExecutionContext(),
    ownerAdapter: 'minikube' as const,
    workloads: [database, api],
  };
}

/*** Create one local execution context for dependency reconciliation tests. */
function createExecutionContext(): InfraExecutionContext {
  return {
    projectId: 'dependency-test',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'minikube' },
      },
    },
    credentials: createCredentialPort(),
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }),
    },
  };
}
