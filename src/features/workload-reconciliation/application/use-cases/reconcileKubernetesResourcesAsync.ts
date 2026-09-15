import type {
  InfraDiagnostic,
  InfraOwnedResource,
  InfraReconcileResult,
  InfraResult,
} from '@ankhorage/contracts/infra';

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
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';
import { getKubernetesOutputsAsync } from './getKubernetesOutputsAsync';
import { prepareKubernetesChangesAsync } from './prepareKubernetesChangesAsync';

/*** Apply desired changes dependency-first and prune only obsolete, non-persistent Infra resources. */
export async function reconcileKubernetesResourcesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  const prepared = await prepareKubernetesChangesAsync(options, request);
  if (!prepared.ok) return prepared;

  const desiredByResourceId = new Map(
    prepared.value.projection.resources.map((desired) => [desired.owner.identity.resourceId, desired]),
  );
  const timeoutSeconds =
    options.defaultReadinessTimeoutSeconds ?? KUBERNETES_DEFAULT_READINESS_TIMEOUT_SECONDS;
  const deadline = Date.now() + timeoutSeconds * 1_000;

  try {
    const retained: InfraOwnedResource[] = [];
    for (const change of prepared.value.changes) {
      if (
        (change.action.operation === 'create' || change.action.operation === 'update') &&
        change.desired !== undefined
      ) {
        const dependencyFailure = await waitForDependenciesAsync(
          options,
          request,
          change.desired,
          desiredByResourceId,
          deadline,
        );
        if (dependencyFailure !== undefined) {
          return { ok: false, diagnostics: [dependencyFailure] };
        }
        await options.api.applyAsync(change.desired.resource, request.context.signal);
      }
      if (change.action.operation === 'delete' && change.actual !== undefined) {
        await options.api.deleteAsync(
          getKubernetesResourceReference(change.actual),
          request.context.signal,
        );
      }
      if (change.action.operation === 'retain' && change.actual !== undefined) {
        const owner = readKubernetesOwnedResource(change.actual, request);
        if (owner !== undefined) retained.push(owner);
      }
    }

    const outputs = await getKubernetesOutputsAsync(options, request);
    if (!outputs.ok) return outputs;
    return {
      ok: true,
      value: {
        resources: [...prepared.value.projection.resources.map(({ owner }) => owner), ...retained],
        outputs: outputs.value,
      },
      diagnostics: [],
    };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-reconcile-failed',
          message: 'Kubernetes resources could not be reconciled safely.',
        },
      ],
    };
  }
}

/*** Wait for readiness-relevant dependencies before applying one desired Kubernetes resource. */
async function waitForDependenciesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
  desired: KubernetesDesiredResource,
  desiredByResourceId: ReadonlyMap<string, KubernetesDesiredResource>,
  deadline: number,
): Promise<InfraDiagnostic | undefined> {
  for (const dependencyOwner of desired.owner.dependsOn) {
    const dependency = desiredByResourceId.get(dependencyOwner.resourceId);
    if (dependency === undefined || !KUBERNETES_READINESS_KINDS.has(dependency.resource.kind)) {
      continue;
    }
    const observation = await waitForDependencyAsync(options, request, dependency, deadline);
    if (observation.state !== 'ready') {
      return createDependencyReadinessDiagnostic(dependency, observation);
    }
  }
  return undefined;
}

/*** Wait for one dependency within the reconciliation pass shared readiness deadline. */
function waitForDependencyAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
  dependency: KubernetesDesiredResource,
  deadline: number,
): Promise<KubernetesResourceObservation> {
  const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
  if (remainingSeconds === 0) {
    return Promise.resolve({
      state: 'degraded',
      detail: 'The shared Kubernetes readiness deadline expired.',
    });
  }
  return options.api.waitUntilReadyAsync(getKubernetesResourceReference(dependency.resource), {
    timeoutSeconds: remainingSeconds,
    ...(request.context.signal === undefined ? {} : { signal: request.context.signal }),
  });
}

/*** Create an actionable diagnostic for a dependency that did not become ready. */
function createDependencyReadinessDiagnostic(
  dependency: KubernetesDesiredResource,
  observation: KubernetesResourceObservation,
): InfraDiagnostic {
  const detail = observation.detail === undefined ? '' : ` ${observation.detail}`;
  return {
    severity: 'error',
    code: 'kubernetes-dependency-readiness-failed',
    message: `Kubernetes dependency ${dependency.owner.identity.resourceId} is ${observation.state}.${detail}`,
    owner: dependency.owner.identity,
  };
}
