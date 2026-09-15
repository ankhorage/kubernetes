import type {
  InfraDestroyRequest,
  InfraOwnedResource,
  InfraReconcileResult,
  InfraResourceIdentity,
  InfraResult,
} from '@ankhorage/contracts/infra';

import type {
  KubernetesDriverOptions,
  KubernetesDriverRequest,
} from '../../../../types/kubernetesDriver';
import { getKubernetesOwnershipQuery } from '../../utils/getKubernetesOwnershipQuery';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { readKubernetesOwnedResource } from '../../utils/readKubernetesOwnedResource';
import { sortKubernetesResourcesForRemoval } from '../../utils/sortKubernetesResourcesForRemoval';

/*** Remove owned resources in reverse dependency order while enforcing persistence authorization. */
export async function removeKubernetesResourcesAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
  destroy: InfraDestroyRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  if (!isConfirmed(request, destroy)) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-destroy-unconfirmed',
          message:
            'Kubernetes removal requires matching explicit project and environment confirmation.',
        },
      ],
    };
  }

  try {
    return await performRemovalAsync(options, request, destroy);
  } catch {
    return {
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'kubernetes-remove-failed',
          message: 'Kubernetes resources could not be removed safely.',
        },
      ],
    };
  }
}

/*** Execute the already-confirmed removal against the narrow owned-resource selector. */
async function performRemovalAsync(
  options: KubernetesDriverOptions,
  request: KubernetesDriverRequest,
  destroy: InfraDestroyRequest,
): Promise<InfraResult<InfraReconcileResult>> {
  const observed = await options.api.listOwnedAsync(getKubernetesOwnershipQuery(request));
  const owned = observed.flatMap((resource) => {
    const owner = readKubernetesOwnedResource(resource, request);
    return owner === undefined ? [] : [{ resource, owner }];
  });
  const retained: InfraOwnedResource[] = [];
  const retainNamespace = owned.some(({ owner }) => owner.persistent && !canDelete(owner, destroy));
  for (const { resource, owner } of sortKubernetesResourcesForRemoval(owned)) {
    if ((resource.kind === 'Namespace' && retainNamespace) || !canDelete(owner, destroy)) {
      retained.push(owner);
      continue;
    }
    await options.api.deleteAsync(getKubernetesResourceReference(resource), request.context.signal);
  }
  return { ok: true, value: { resources: retained, outputs: [] }, diagnostics: [] };
}

/*** Confirm request identity at both destroy boundaries. */
function isConfirmed(request: KubernetesDriverRequest, destroy: InfraDestroyRequest): boolean {
  return (
    destroy.projectId === request.context.projectId &&
    destroy.environment === request.context.environment &&
    destroy.confirmation.projectId === request.context.projectId &&
    destroy.confirmation.environment === request.context.environment
  );
}

/*** Delete persistent data only when the exact resource has explicit deletion authorization. */
function canDelete(owner: InfraOwnedResource, destroy: InfraDestroyRequest): boolean {
  if (!owner.persistent) return true;
  return (
    destroy.persistence.policy === 'delete' &&
    destroy.persistence.confirmedResources.some((identity) =>
      identitiesEqual(identity, owner.identity),
    )
  );
}

/*** Compare canonical resource identities without object-reference assumptions. */
function identitiesEqual(left: InfraResourceIdentity, right: InfraResourceIdentity): boolean {
  return (
    left.projectId === right.projectId &&
    left.environment === right.environment &&
    left.adapter === right.adapter &&
    left.resourceId === right.resourceId
  );
}
