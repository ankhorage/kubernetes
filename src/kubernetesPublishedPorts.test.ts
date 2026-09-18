import type { InfraExecutionContext, InfraWorkloadSpec } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createCredentialPort } from './infraExecutionContextFixtures.test';
import { createKubernetesDriver } from './index';
import { FakeKubernetesApi } from './kubernetesApi.test';

it('projects an optional published workload port as an exact Kubernetes host port', async () => {
  const driver = createKubernetesDriver({ api: new FakeKubernetesApi() });
  const workload: InfraWorkloadSpec = {
    id: 'api',
    artifact: { kind: 'image', image: 'registry.example/api@sha256:abc' },
    exposure: 'public',
    ports: { http: { port: 8080, publishedPort: 18_080 } },
  };
  const projected = await driver.projectAsync(createRequest(workload));
  const unpublished = await driver.projectAsync(
    createRequest({ ...workload, ports: { http: { port: 8080 } } }),
  );

  expect(projected.ok).toBe(true);
  expect(JSON.stringify(projected)).toContain('"hostPort":18080');
  expect(JSON.stringify(unpublished)).not.toContain('hostPort');
});

/*** Create the minimal driver request for one workload projection. */
function createRequest(workload: InfraWorkloadSpec) {
  const context: InfraExecutionContext = {
    projectId: 'sample',
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
  return { context, ownerAdapter: 'minikube' as const, workloads: [workload] };
}
