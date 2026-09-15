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
const DEFAULT_READINESS_TIMEOUT_SECONDS = 300;

/*** Wait dependency-first for required Kubernetes resources to report ready. */
export async function waitForKubernetesReadinessAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  const projection = await projectKubernetesResourcesAsync(request);
  if (!projection.ok) return projection;

  const timeoutSeconds =
    options.defaultReadinessTimeoutSeconds ?? DEFAULT_READINESS_TIMEOUT_SECONDS;
  const deadline = Date.now() + timeoutSeconds * 1_000;
  try {
    const statuses: InfraResourceStatus[] = [];
    for (const desired of projection.value.resources) {
      if (!READINESS_KINDS.has(desired.resource.kind)) continue;
      const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      const observation =
        remainingSeconds === 0
          ? {
              state: 'degraded' as const,
              detail: 'The shared Kubernetes readiness deadline expired.',
            }
          : await options.api.waitUntilReadyAsync(
              getKubernetesResourceReference(desired.resource),
              {
                timeoutSeconds: remainingSeconds,
                ...(request.context.signal === undefined
                  ? {}
                  : { signal: request.context.signal }),
              },
            );
      statuses.push({
        owner: desired.owner.identity,
        state: observation.state,
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
      });
      if (observation.state !== 'ready') {
        const detail = observation.detail === undefined ? '' : ` ${observation.detail}`;
        const diagnostic: InfraDiagnostic = {
          severity: 'error',
          code: 'kubernetes-readiness-failed',
          message: `Kubernetes resource ${desired.owner.identity.resourceId} is ${observation.state}.${detail}`,
          owner: desired.owner.identity,
        };
        return { ok: false, diagnostics: [diagnostic] };
      }
    }
    return { ok: true, value: statuses, diagnostics: [] };
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
