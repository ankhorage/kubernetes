import type { InfraOwnedResource, InfraResourceIdentity } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../types/kubernetesDriver';
import type { KubernetesResource } from '../../../types/kubernetesResources';
import { KUBERNETES_OWNERSHIP } from '../constants';
import { getKubernetesResourceKey } from './getKubernetesResourceKey';
import { getKubernetesResourceReference } from './getKubernetesResourceReference';

/*** Read trusted ownership metadata, rejecting resources outside the active Infra identity. */
export function readKubernetesOwnedResource(
  resource: KubernetesResource,
  request: KubernetesDriverRequest,
): InfraOwnedResource | undefined {
  const { annotations } = resource.metadata;
  if (
    annotations[KUBERNETES_OWNERSHIP.projectAnnotation] !== request.context.projectId ||
    annotations[KUBERNETES_OWNERSHIP.environmentAnnotation] !== request.context.environment ||
    annotations[KUBERNETES_OWNERSHIP.adapterAnnotation] !== request.ownerAdapter
  ) {
    return undefined;
  }

  const resourceId = annotations[KUBERNETES_OWNERSHIP.resourceAnnotation];
  if (resourceId === undefined || resourceId.length === 0) return undefined;

  const identity: InfraResourceIdentity = {
    projectId: request.context.projectId,
    environment: request.context.environment,
    adapter: request.ownerAdapter,
    resourceId,
  };
  const dependencies = readDependencies(
    annotations[KUBERNETES_OWNERSHIP.dependenciesAnnotation],
    identity,
  );
  if (dependencies === undefined) return undefined;

  return {
    identity,
    externalId: getKubernetesResourceKey(getKubernetesResourceReference(resource)),
    persistent: annotations[KUBERNETES_OWNERSHIP.persistentAnnotation] === 'true',
    retention:
      annotations[KUBERNETES_OWNERSHIP.retentionAnnotation] === 'delete-on-destroy'
        ? 'delete-on-destroy'
        : 'retain',
    dependsOn: dependencies,
  };
}

/*** Decode dependency IDs without trusting arbitrary serialized identity objects. */
function readDependencies(
  value: string | undefined,
  identity: InfraResourceIdentity,
): readonly InfraResourceIdentity[] | undefined {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      return undefined;
    }
    return parsed.map((resourceId) => ({ ...identity, resourceId }));
  } catch {
    return undefined;
  }
}
