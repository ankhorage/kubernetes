import type { InfraDiagnostic, InfraWorkloadSpec } from '@ankhorage/contracts/infra';

/*** Validate portable invariants required for deterministic Kubernetes projection. */
export function validateKubernetesWorkloads(
  workloads: readonly InfraWorkloadSpec[],
): readonly InfraDiagnostic[] {
  const diagnostics: InfraDiagnostic[] = [];
  const ids = new Set<string>();
  for (const workload of workloads) {
    if (ids.has(workload.id)) {
      diagnostics.push({
        severity: 'error',
        code: 'kubernetes-workload-duplicate',
        message: `Workload ID ${workload.id} is duplicated.`,
      });
    }
    ids.add(workload.id);
    for (const dependency of Object.keys(workload.dependsOn ?? {}).sort()) {
      if (!workloads.some((candidate) => candidate.id === dependency)) {
        diagnostics.push({
          severity: 'error',
          code: 'kubernetes-workload-dependency-missing',
          message: `Workload ${workload.id} depends on missing workload ${dependency}.`,
        });
      }
    }
  }
  return diagnostics;
}
