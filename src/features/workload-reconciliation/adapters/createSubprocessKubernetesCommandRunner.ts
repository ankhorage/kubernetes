import { spawn } from 'node:child_process';

import type {
  KubernetesCommandRequest,
  KubernetesCommandResult,
  KubernetesCommandRunner,
} from '../../../types/kubectl';

/*** Create the concrete shell-free subprocess boundary used by kubectl operations. */
export function createSubprocessKubernetesCommandRunner(): KubernetesCommandRunner {
  return { runAsync };
}

/*** Execute one argv-safe command while keeping standard input out of diagnostics. */
function runAsync(request: KubernetesCommandRequest): Promise<KubernetesCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.executable, [...request.arguments], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) =>
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
    child.stdin.end(request.stdin);
  });
}
