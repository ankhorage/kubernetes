import type {
  InfraDiagnostic,
  InfraOutput,
  InfraResult,
  InfraWorkloadScalarValue,
  InfraWorkloadSpec,
  InfraWorkloadValue,
} from '@ankhorage/contracts/infra';

import type {
  KubernetesResolvedWorkloadValues,
  KubernetesSecretTarget,
  KubernetesSecretValueSegment,
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
  for (const [index, [path, value]] of Object.entries(workload.files ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .entries()) {
    assignValue(
      outputs,
      value,
      { kind: 'file', path },
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
  const segments = value.kind === 'template' ? value.segments : [value];
  const resolved = segments.map((segment) => resolveSegment(outputs, segment, diagnostics));
  if (resolved.some((segment) => segment === undefined)) return;
  const complete = resolved.filter(
    (segment): segment is KubernetesSecretValueSegment => segment !== undefined,
  );
  if (complete.every((segment) => segment.kind === 'literal')) {
    Object.assign(publicValues, {
      [publicKey]: complete.map(({ value }) => value).join(''),
    });
    return;
  }
  secrets.push({ key: toKubernetesName(key), segments: complete, target });
}

/*** Resolve one scalar segment without materializing privileged content. */
function resolveSegment(
  outputs: readonly InfraOutput[],
  value: InfraWorkloadScalarValue,
  diagnostics: InfraDiagnostic[],
): KubernetesSecretValueSegment | undefined {
  if (value.kind === 'literal') return value;
  if (value.kind === 'secret') return { kind: 'reference', reference: value.reference };
  if (value.kind === 'credential') {
    return { kind: 'reference', reference: { ...value.reference, key: value.key } };
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
    return undefined;
  }
  return output.visibility === 'secret'
    ? { kind: 'reference', reference: output.reference }
    : { kind: 'literal', value: String(output.value) };
}
