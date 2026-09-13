import type { InfraPlanAction, InfraResult } from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesPreparedChange,
  KubernetesPreparedChanges,
  KubernetesResource,
} from '../../../../types/kubernetesResources';
import { areKubernetesResourcesEquivalent } from '../../utils/areKubernetesResourcesEquivalent';
import { getKubernetesOwnershipQuery } from '../../utils/getKubernetesOwnershipQuery';
import { getKubernetesResourceKey } from '../../utils/getKubernetesResourceKey';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';
import { sortKubernetesResourcesForRemoval } from '../../utils/sortKubernetesResourcesForRemoval';
import { materializeKubernetesSecretsAsync } from './materializeKubernetesSecretsAsync';
import { projectKubernetesResourcesAsync } from './projectKubernetesResourcesAsync';

/*** Prepare deterministic create, update, no-op, retain and stale-delete changes. */
export async function prepareKubernetesChangesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
): Promise<InfraResult<KubernetesPreparedChanges>> {
  try {
    const projection = await projectKubernetesResourcesAsync(request);
    if (!projection.ok) return projection;
    const materialized = await materializeKubernetesSecretsAsync(request, projection.value);
    if (!materialized.ok) return materialized;
    const observed = await options.api.listOwnedAsync(getKubernetesOwnershipQuery(request));
    const desiredChanges = createDesiredChanges(materialized.value, observed);
    const desiredKeys = new Set(materialized.value.map(({ owner }) => owner.externalId ?? ''));
    const staleChanges = createStaleChanges(request, observed, desiredKeys);
    const changes = [...desiredChanges, ...staleChanges];
    return { ok: true, value: { changes, projection: projection.value }, diagnostics: [] };
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-plan-failed',
          message: 'Kubernetes desired and observed resources could not be compared safely.',
        },
      ],
    };
  }
}

/*** Compare desired resources against the observed resource map. */
function createDesiredChanges(
  desiredResources: readonly KubernetesDesiredResource[],
  observed: readonly KubernetesResource[],
): readonly KubernetesPreparedChange[] {
  const actual = new Map(
    observed.map((resource) => [
      getKubernetesResourceKey(getKubernetesResourceReference(resource)),
      resource,
    ]),
  );
  return desiredResources.map((desired) => {
    const current = actual.get(desired.owner.externalId ?? '');
    const operation =
      current === undefined
        ? 'create'
        : areKubernetesResourcesEquivalent(desired.resource, current)
          ? 'noop'
          : 'update';
    return {
      action: createAction(desired.owner.identity, desired.owner.dependsOn, operation),
      desired,
      ...(current === undefined ? {} : { actual: current }),
    };
  });
}

/*** Identify obsolete owned resources without admitting malformed ownership metadata. */
function createStaleChanges(
  request: KubernetesDriverRequest,
  observed: readonly KubernetesResource[],
  desiredKeys: ReadonlySet<string>,
): readonly KubernetesPreparedChange[] {
  const stale = observed.flatMap((resource) => {
    const key = getKubernetesResourceKey(getKubernetesResourceReference(resource));
    if (desiredKeys.has(key)) return [];
    const owner = readKubernetesOwnedResource(resource, request);
    if (owner === undefined) return [];
    return [{ resource, owner }];
  });
  return sortKubernetesResourcesForRemoval(stale).map(({ resource, owner }) => ({
    action: createAction(owner.identity, owner.dependsOn, owner.persistent ? 'retain' : 'delete'),
    actual: resource,
  }));
}

/*** Create one non-secret plan action. */
function createAction(
  owner: InfraPlanAction['owner'],
  dependsOn: InfraPlanAction['dependsOn'],
  operation: InfraPlanAction['operation'],
): InfraPlanAction {
  return {
    owner,
    operation,
    impact: operation === 'delete' ? 'interrupts-service' : 'none',
    detail: `Kubernetes resource ${owner.resourceId}: ${operation}.`,
    dependsOn,
  };
}
