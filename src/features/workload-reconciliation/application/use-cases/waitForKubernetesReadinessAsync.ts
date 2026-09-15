import type { InfraDiagnostic, InfraResourceStatus, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesResourceObservation,
} from '../../../../types/kubernetesResources';
import {
  KUBERNETES_DEFAULT_READINESS_TIMEOUT_SECONDS,
  KUBERNETES_READINESS_KINDS,
} from '../../constants';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { projectKubernetesResourcesAsync } from './projectKubernetesResourcesAsync';

/*** Wait dependency-first for required Kubernetes resources to report ready. */
export async function waitForKubernetesReadinessAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<readonly InfraResourceStatus[]>> {
  const projection = await projectKubernetesResourcesAsync(request);
  if (!projection.ok) return projection;

  const timeoutSeconds =
    options.defaultReadinessTimeoutSeconds ?? KUBERNETES_DEFAULT_READINESS_TIMEOUT_SECONDS;
  const deadline = Date.now() + timeoutSeconds * 1_000;
  try {
    const statuses: InfraResourceStatus[] = [];
    for (const desired of projection.value.resources) {
      if (!KUBERNETES_READINESS_KINDS.has(desired.resource.kind)) continue;
      const observation = await waitForDesiredResourceAsync(options, request, desired, deadline);
      statuses.push(createReadinessStatus(desired, observation));
      if (observation.state !== 'ready') {
        return { ok: false, diagnostics: [createReadinessDiagnostic(desired, observation)] };
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

/*** Wait for one resource within the remaining shared readiness deadline. */
async function waitForDesiredResourceAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
  desired: KubernetesDesiredResource,
  deadline: number,
): Promise<KubernetesResourceObservation> {
  const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
  if (remainingSeconds === 0) {
    return {
      state: 'degraded',
      detail: 'The shared Kubernetes readiness deadline expired.',
    };
  }
  return options.api.waitUntilReadyAsync(getKubernetesResourceReference(desired.resource), {
    timeoutSeconds: remainingSeconds,
    ...(request.context.signal === undefined ? {} : { signal: request.context.signal }),
  });
}

/*** Map one observation to the resource status returned by the driver. */
function createReadinessStatus(
  desired: KubernetesDesiredResource,
  observation: KubernetesResourceObservation,
): InfraResourceStatus {
  return {
    owner: desired.owner.identity,
    state: observation.state,
    ...(observation.detail === undefined ? {} : { detail: observation.detail }),
  };
}

/*** Create the first actionable readiness diagnostic for dependency-first failure. */
function createReadinessDiagnostic(
  desired: KubernetesDesiredResource,
  observation: KubernetesResourceObservation,
): InfraDiagnostic {
  const detail = observation.detail === undefined ? '' : ` ${observation.detail}`;
  return {
    severity: 'error',
    code: 'kubernetes-readiness-failed',
    message: `Kubernetes resource ${desired.owner.identity.resourceId} is ${observation.state}.${detail}`,
    owner: desired.owner.identity,
  };
}
