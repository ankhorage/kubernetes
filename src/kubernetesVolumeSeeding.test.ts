import type { InfraExecutionContext, InfraWorkloadSpec } from '@ankhorage/contracts/infra';
import { expect, it } from 'bun:test';

import { projectKubernetesResourcesAsync } from './index';

it('projects an idempotent fail-closed init container for image-seeded persistence', async () => {
  const projected = await projectKubernetesResourcesAsync({
    context: createExecutionContext(),
    ownerAdapter: 'k3s',
    workloads: [createWorkload('image')],
  });

  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  const deployment = projected.value.resources.find(
    ({ resource }) => resource.kind === 'Deployment',
  );
  expect(deployment?.resource).toMatchObject({
    spec: {
      template: {
        spec: {
          initContainers: [
            {
              name: 'seed-config',
              image: 'supabase/postgres:17.6.1.136',
              command: ['/bin/sh', '-c'],
              env: [
                { name: 'ANKHORAGE_SEED_SOURCE', value: '/etc/postgresql-custom' },
                { name: 'ANKHORAGE_SEED_TARGET', value: '/ankhorage/image-seed-target' },
                { name: 'ANKHORAGE_SEED_MARKER', value: '.ankhorage-image-seeded' },
              ],
              volumeMounts: [{ name: 'volume-config', mountPath: '/ankhorage/image-seed-target' }],
            },
          ],
        },
      },
    },
  });
  expect(JSON.stringify(deployment?.resource)).toContain(
    'Refusing to seed non-empty persistent volume without ownership marker.',
  );
});

it('does not add init containers for ordinary persistent volumes', async () => {
  const projected = await projectKubernetesResourcesAsync({
    context: createExecutionContext(),
    ownerAdapter: 'k3s',
    workloads: [createWorkload(undefined)],
  });

  expect(projected.ok).toBe(true);
  if (!projected.ok) return;
  const deployment = projected.value.resources.find(
    ({ resource }) => resource.kind === 'Deployment',
  );
  expect(JSON.stringify(deployment?.resource)).not.toContain('initContainers');
});

/*** Create a portable persistence fixture with optional image initialization. */
function createWorkload(seed: 'image' | undefined): InfraWorkloadSpec {
  return {
    id: 'database',
    artifact: { kind: 'image', image: 'supabase/postgres:17.6.1.136' },
    persistence: [
      {
        id: 'config',
        mountPath: '/etc/postgresql-custom',
        sizeGiB: 1,
        ...(seed === undefined ? {} : { seed }),
        retention: 'retain',
      },
    ],
  };
}

/*** Create the runtime-neutral execution context used by volume projection tests. */
function createExecutionContext(): InfraExecutionContext {
  return {
    projectId: 'sample',
    environment: 'production',
    desired: {
      deployment: {
        compute: { provider: 'hetzner', location: 'nbg1' },
        runtime: { provider: 'k3s' },
      },
    },
    credentials: {
      resolveAsync: () => Promise.resolve({ ok: true, value: {}, diagnostics: [] }),
    },
    secrets: {
      resolveAsync: () => Promise.resolve({ ok: true, value: '', diagnostics: [] }),
    },
  };
}
