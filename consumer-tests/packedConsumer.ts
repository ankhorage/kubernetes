import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const consumerDirectory = mkdtempSync(join(tmpdir(), 'ankhorage-kubernetes-consumer-'));
let archivePath: string | undefined;

try {
  const packOutput = execFileSync('bun', ['pm', 'pack'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  const archiveName = /(?:^|\n)([^\n]+\.tgz)(?:\n|$)/.exec(packOutput)?.[1];
  if (archiveName === undefined)
    throw new Error('Packing @ankhorage/kubernetes produced no archive.');

  archivePath = join(repositoryRoot, archiveName);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@ankhorage/kubernetes': `file:${archivePath}` },
    }),
  );
  writeFileSync(
    join(consumerDirectory, 'consumer.ts'),
    "import type { KubernetesDriver } from '@ankhorage/kubernetes';\nconst driver: KubernetesDriver | undefined = undefined;\nvoid driver;\n",
  );

  execFileSync(
    'bun',
    ['install', '--ignore-scripts', '--cache-dir', join(tmpdir(), 'kubernetes-bun-cache')],
    {
      cwd: consumerDirectory,
      stdio: 'inherit',
    },
  );
  execFileSync('bun', ['--eval', "await import('@ankhorage/kubernetes');"], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  });
  execFileSync(
    'node',
    ['--input-type=module', '--eval', "await import('@ankhorage/kubernetes');"],
    {
      cwd: consumerDirectory,
      stdio: 'inherit',
    },
  );
  execFileSync(
    join(repositoryRoot, 'node_modules/.bin/tsc'),
    [
      '--noEmit',
      '--module',
      'ESNext',
      '--moduleResolution',
      'bundler',
      '--target',
      'ES2022',
      'consumer.ts',
    ],
    { cwd: consumerDirectory, stdio: 'inherit' },
  );
} finally {
  rmSync(consumerDirectory, { recursive: true, force: true });
  if (archivePath !== undefined) rmSync(archivePath, { force: true });
}
