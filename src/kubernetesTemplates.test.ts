import type { InfraExecutionContext, InfraWorkloadSpec } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { createKubernetesDriver } from './index';
import { createCredentialPort } from './infraExecutionContextFixtures.test';
import { FakeKubernetesApi } from './kubernetesApi.test';

it('materializes privileged templates only at apply and keeps public templates public', async () => {
  const api = new FakeKubernetesApi();
  const driver = createKubernetesDriver({ api });
  const request = createTemplateRequest();
  const projection = await driver.projectAsync(request);

  expect(projection.ok).toBe(true);
  if (!projection.ok) return;
  expect(JSON.stringify(projection.value)).not.toContain('resolved-secret-value');
  const deployment = projection.value.resources.find(
    ({ resource }) => resource.kind === 'Deployment',
  );
  expect(JSON.stringify(deployment)).toContain('https://api.example.test/auth/v1');
  expect(projection.value.secretBindings.some(({ segments }) => segments.length === 3)).toBe(true);

  const reconciled = await driver.reconcileAsync(request);
  expect(reconciled.ok).toBe(true);
  expect(
    api.applied.some(
      (resource) =>
        resource.stringData?.['env-database-url'] ===
        'postgres://postgres:resolved-secret-value@db:5432/postgres',
    ),
  ).toBe(true);
  expect(JSON.stringify(reconciled)).not.toContain('resolved-secret-value');
});

/*** Create a runtime request covering public and privileged template segments. */
function createTemplateRequest() {
  const workload: InfraWorkloadSpec = {
    id: 'api',
    artifact: { kind: 'image', image: 'registry.example/api@sha256:abc' },
    environment: {
      PUBLIC_URL: {
        kind: 'template',
        segments: [
          { kind: 'literal', value: 'https://' },
          { kind: 'output', resourceId: 'service:gateway', output: 'host' },
          { kind: 'literal', value: '/auth/v1' },
        ],
      },
      DATABASE_URL: {
        kind: 'template',
        segments: [
          { kind: 'literal', value: 'postgres://postgres:' },
          { kind: 'secret', reference: createSecretReference() },
          { kind: 'literal', value: '@db:5432/postgres' },
        ],
      },
    },
  };
  return {
    context: createExecutionContext(),
    ownerAdapter: 'minikube' as const,
    workloads: [workload],
    availableOutputs: [
      {
        owner: {
          projectId: 'sample',
          environment: 'local' as const,
          adapter: 'supabase' as const,
          resourceId: 'service:gateway',
        },
        name: 'host',
        visibility: 'public' as const,
        value: 'api.example.test',
      },
    ],
  };
}

/*** Create an execution context whose secret resolver remains outside projections. */
function createExecutionContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'local',
    desired: {
      deployment: {
        compute: { provider: 'local' },
        runtime: { provider: 'docker-compose' },
      },
    },
    credentials: createCredentialPort(),
    secrets: {
      resolveAsync: () =>
        Promise.resolve({ ok: true, value: 'resolved-secret-value', diagnostics: [] }),
    },
  };
}

/*** Create a canonical test secret reference. */
function createSecretReference() {
  return {
    source: 'secret-store' as const,
    projectId: 'sample',
    environment: 'local' as const,
    ref: 'database-password',
    key: 'value',
  };
}
