import type { InfraDiagnostic, InfraResourceStatus, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { projectKubernetesResourcesAsync } from './projectKubernetesResourcesAsync';

const READINESS_KINDS = new Set([
  'Namespace',
  'PersistentVolumeClaim',
  'Deployment',
  'Service',
  'Ingress',
]);

/*** Wait dependency-first for required Kubernetes resources to report ready. */
export async function waitForKubernetesReadinessAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  const projection = await projectKubernetesResourcesAsync(request);
  if (!projection.ok) return projection;

  try {
    const statuses: InfraResourceStatus[] = [];
    const diagnostics: InfraDiagnostic[] = [];
    for (const desired of projection.value.resources) {
      if (!READINESS_KINDS.has(desired.resource.kind)) continue;
      const observation = await options.api.waitUntilReadyAsync(
        getKubernetesResourceReference(desired.resource),
        {
          timeoutSeconds: options.defaultReadinessTimeoutSeconds ?? 300,
          ...(request.context.signal === undefined ? {} : { signal: request.context.signal }),
        },
      );
      statuses.push({
        owner: desired.owner.identity,
        state: observation.state,
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
      });
      if (observation.state !== 'ready') {
        diagnostics.push({
          severity: 'error',
          code: 'kubernetes-readiness-failed',
          message: `Kubernetes resource ${desired.owner.identity.resourceId} is ${observation.state}.`,
          owner: desired.owner.identity,
        });
      }
    }
    return diagnostics.length > 0
      ? { ok: false, diagnostics }
      : { ok: true, value: statuses, diagnostics: [] };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-readiness-failed',
          message: 'Kubernetes readiness could not be established.',
        },
      ],
    };
  }
}
