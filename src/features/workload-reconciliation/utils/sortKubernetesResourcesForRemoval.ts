import type { InfraOwnedResource } from '@ankhorage/contracts/infra';

import type { KubernetesResource } from '../../../types/kubernetesResources';

export interface OwnedKubernetesResource {
  readonly resource: KubernetesResource;
  readonly owner: InfraOwnedResource;
}

/*** Sort owned resources deterministically with dependents before their dependencies. */
export function sortKubernetesResourcesForRemoval(
  resources: readonly OwnedKubernetesResource[],
): readonly OwnedKubernetesResource[] {
  const remaining = new Map(resources.map((item) => [item.owner.identity.resourceId, item]));
  const ordered: OwnedKubernetesResource[] = [];
  while (remaining.size > 0) {
    const leaves = [...remaining.values()]
      .filter(
        ({ owner }) =>
          ![...remaining.values()].some(({ owner: candidate }) =>
            candidate.dependsOn.some(({ resourceId }) => resourceId === owner.identity.resourceId),
          ),
      )
      .sort(compareResourceKeys);
    const selected = leaves.at(0) ?? [...remaining.values()].sort(compareResourceKeys).at(0);
    if (selected === undefined) break;
    ordered.push(selected);
    remaining.delete(selected.owner.identity.resourceId);
  }
  return ordered;
}

/*** Compare owned resources by stable external resource identity. */
function compareResourceKeys(
  left: OwnedKubernetesResource,
  right: OwnedKubernetesResource,
): number {
  return (left.owner.externalId ?? '').localeCompare(right.owner.externalId ?? '');
}
