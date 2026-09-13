import type {
  InfraDiagnostic,
  InfraOutput,
  InfraResult,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import type {
  KubernetesResolvedWorkloadValues,
  KubernetesSecretTarget,
} from '../../../../types/kubernetesResources';
import { toKubernetesName } from '../../utils/toKubernetesName';

/*** Resolve public outputs while retaining privileged workload values as secret references. */
export function resolveKubernetesWorkloadValues(
  outputs: readonly InfraOutput[],
  workload: InfraWorkloadSpec,
): InfraResult<KubernetesResolvedWorkloadValues> {
  const environment: Record<string, string> = {};
  const files: Record<string, string> = {};
  const secrets: KubernetesSecretTarget[] = [];
  const diagnostics: InfraDiagnostic[] = [];

  for (const [name, value] of Object.entries(workload.environment ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    assignValue(
      outputs,
      value,
      { kind: 'environment', name },
      environment,
      secrets,
      diagnostics,
      `env-${name}`,
    );
  }
  for (const [index, file] of (workload.files ?? []).entries()) {
    assignValue(
      outputs,
      file.content,
      { kind: 'file', path: file.path },
      files,
      secrets,
      diagnostics,
      `file-${index}`,
    );
  }

  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : { ok: true, value: { environment, files, secrets }, diagnostics: [] };
}

/*** Assign one portable value without resolving privileged content. */
function assignValue(
  outputs: readonly InfraOutput[],
  value: InfraWorkloadValue,
  target: KubernetesSecretTarget['target'],
  publicValues: Record<string, string>,
  secrets: KubernetesSecretTarget[],
  diagnostics: InfraDiagnostic[],
  key: string,
): void {
  const publicKey = target.kind === 'environment' ? target.name : target.path;
  if (value.kind === 'literal') {
    Object.assign(publicValues, { [publicKey]: value.value });
    return;
  }
  if (value.kind === 'secret') {
    secrets.push({ key: toKubernetesName(key), reference: value.reference, target });
    return;
  }

  const matches = outputs.filter(
    (output) => output.owner.resourceId === value.resourceId && output.name === value.output,
  );
  const [output] = matches;
  if (matches.length !== 1 || output === undefined) {
    diagnostics.push({
      severity: 'error',
      code: 'kubernetes-output-unresolved',
      message: `Workload output ${value.resourceId}.${value.output} did not resolve uniquely.`,
    });
    return;
  }
  if (output.visibility === 'secret') {
    secrets.push({ key: toKubernetesName(key), reference: output.reference, target });
    return;
  }
  Object.assign(publicValues, { [publicKey]: String(output.value) });
}
