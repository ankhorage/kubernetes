import type { KubernetesResource } from '../../../types/kubernetesResources';

/*** Compare desired and observed Kubernetes resources while ignoring server-owned metadata. */
export function areKubernetesResourcesEquivalent(
  desired: KubernetesResource,
  actual: KubernetesResource,
): boolean {
  return stableSerialize(normalize(desired)) === stableSerialize(normalize(actual));
}

/*** Normalize write-only Secret data and recursively order object keys. */
function normalize(resource: KubernetesResource): unknown {
  const { stringData } = resource;
  const data =
    stringData === undefined
      ? resource.data
      : Object.fromEntries(
          Object.entries(stringData).map(([key, value]) => [
            key,
            Buffer.from(value).toString('base64'),
          ]),
        );
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: {
      name: resource.metadata.name,
      ...(resource.metadata.namespace === undefined
        ? {}
        : { namespace: resource.metadata.namespace }),
      labels: resource.metadata.labels,
      annotations: resource.metadata.annotations,
    },
    ...(data === undefined ? {} : { data }),
    ...(resource.spec === undefined ? {} : { spec: resource.spec }),
  };
}

/*** Serialize plain Kubernetes desired data with stable recursive key ordering. */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
