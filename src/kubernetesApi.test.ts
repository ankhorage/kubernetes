import type {
  KubernetesApi,
  KubernetesOwnershipQuery,
  KubernetesResource,
  KubernetesResourceObservation,
  KubernetesResourceReference,
} from './index';

/** Generic in-memory Kubernetes API fixture proving the driver needs no named local runtime. */
export class FakeKubernetesApi implements KubernetesApi {
  readonly applied: KubernetesResource[] = [];
  readonly deleted: KubernetesResourceReference[] = [];
  readonly waits: { readonly timeoutSeconds: number }[] = [];
  readonly resources: KubernetesResource[] = [
    {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'unrelated', namespace: 'sample-local', labels: {}, annotations: {} },
    },
  ];

  listOwnedAsync(query: KubernetesOwnershipQuery): Promise<readonly KubernetesResource[]> {
    return Promise.resolve(
      this.resources.filter((resource) => labelsInclude(resource.metadata.labels, query.labels)),
    );
  }

  applyAsync(resource: KubernetesResource): Promise<void> {
    this.applied.push(resource);
    const normalized = materializeStoredSecret(resource);
    const index = this.resources.findIndex((candidate) => referencesEqual(candidate, resource));
    if (index === -1) this.resources.push(normalized);
    else this.resources.splice(index, 1, normalized);
    return Promise.resolve();
  }

  deleteAsync(resource: KubernetesResourceReference): Promise<void> {
    this.deleted.push(resource);
    const index = this.resources.findIndex((candidate) => referencesEqual(candidate, resource));
    if (index >= 0) this.resources.splice(index, 1);
    return Promise.resolve();
  }

  observeAsync(resource: KubernetesResourceReference): Promise<KubernetesResourceObservation> {
    return Promise.resolve({
      state: 'ready',
      ...(resource.kind === 'Service'
        ? { publicOutputs: { endpoint: 'https://api.example.ch' } }
        : {}),
    });
  }

  waitUntilReadyAsync(
    _resource: KubernetesResourceReference,
    options: { readonly timeoutSeconds: number },
  ): Promise<KubernetesResourceObservation> {
    this.waits.push(options);
    return Promise.resolve({ state: 'ready' });
  }
}

/*** Match label records without dynamic object-property access. */
function labelsInclude(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(expected).every(([expectedKey, expectedValue]) =>
    Object.entries(actual).some(
      ([actualKey, actualValue]) => actualKey === expectedKey && actualValue === expectedValue,
    ),
  );
}

/*** Store write-only Secret values in the shape returned by the Kubernetes API. */
function materializeStoredSecret(resource: KubernetesResource): KubernetesResource {
  if (resource.stringData === undefined) return resource;
  return {
    ...resource,
    data: Object.fromEntries(
      Object.entries(resource.stringData).map(([key, value]) => [
        key,
        Buffer.from(value).toString('base64'),
      ]),
    ),
    stringData: undefined,
  };
}

/*** Compare resources by standard Kubernetes identity fields. */
function referencesEqual(
  left: KubernetesResource,
  right: KubernetesResource | KubernetesResourceReference,
): boolean {
  return (
    left.apiVersion === right.apiVersion &&
    left.kind === right.kind &&
    left.metadata.name === ('metadata' in right ? right.metadata.name : right.name) &&
    left.metadata.namespace === ('metadata' in right ? right.metadata.namespace : right.namespace)
  );
}
