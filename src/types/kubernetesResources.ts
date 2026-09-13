import type {
  InfraControlPlaneCredentialRef,
  InfraOwnedResource,
  InfraPlanAction,
  InfraResourceStatus,
  InfraSecretReference,
} from '@ankhorage/contracts/infra';

export type KubernetesPrivilegedReference =
  InfraSecretReference | (InfraControlPlaneCredentialRef & { readonly key: string });

export type KubernetesSecretValueSegment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'reference'; readonly reference: KubernetesPrivilegedReference };

export interface KubernetesResourceMetadata {
  readonly name: string;
  readonly namespace?: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
}

export interface KubernetesResource {
  readonly apiVersion: string;
  readonly kind: string;
  readonly metadata: KubernetesResourceMetadata;
  readonly data?: Readonly<Record<string, string>>;
  readonly stringData?: Readonly<Record<string, string>>;
  readonly spec?: Readonly<Record<string, unknown>>;
}

export interface KubernetesResourceReference {
  readonly apiVersion: string;
  readonly kind: string;
  readonly name: string;
  readonly namespace?: string;
}

export interface KubernetesOwnershipQuery {
  readonly namespace: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface KubernetesResourceObservation {
  readonly state: InfraResourceStatus['state'];
  readonly detail?: string;
  /** Values that are explicitly safe to expose through Infra public outputs. */
  readonly publicOutputs?: Readonly<Record<string, string | number | boolean>>;
}

/** Generic Kubernetes API boundary implemented from already authenticated cluster access. */
export interface KubernetesApi {
  listOwnedAsync(query: KubernetesOwnershipQuery): Promise<readonly KubernetesResource[]>;
  applyAsync(resource: KubernetesResource, signal?: AbortSignal): Promise<void>;
  deleteAsync(resource: KubernetesResourceReference, signal?: AbortSignal): Promise<void>;
  observeAsync(
    resource: KubernetesResourceReference,
    signal?: AbortSignal,
  ): Promise<KubernetesResourceObservation>;
  waitUntilReadyAsync(
    resource: KubernetesResourceReference,
    options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal },
  ): Promise<KubernetesResourceObservation>;
}

export interface KubernetesSecretBinding {
  readonly resource: KubernetesResourceReference;
  readonly key: string;
  readonly segments: readonly KubernetesSecretValueSegment[];
}

export interface KubernetesDesiredResource {
  readonly resource: KubernetesResource;
  readonly owner: InfraOwnedResource;
}

/** Serializable desired resources contain references, never resolved secret values. */
export interface KubernetesProjection {
  readonly resources: readonly KubernetesDesiredResource[];
  readonly secretBindings: readonly KubernetesSecretBinding[];
}

export interface KubernetesPreparedChange {
  readonly action: InfraPlanAction;
  readonly desired?: KubernetesDesiredResource;
  readonly actual?: KubernetesResource;
}

export interface KubernetesResolvedWorkloadValues {
  readonly environment: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
  readonly secrets: readonly KubernetesSecretTarget[];
}

export interface KubernetesSecretTarget {
  readonly key: string;
  readonly segments: readonly KubernetesSecretValueSegment[];
  readonly target:
    | { readonly kind: 'environment'; readonly name: string }
    | { readonly kind: 'file'; readonly path: string };
}

export interface KubernetesWorkloadProjection {
  readonly resources: readonly KubernetesDesiredResource[];
  readonly secretBindings: readonly KubernetesSecretBinding[];
}

export interface KubernetesPreparedChanges {
  readonly changes: readonly KubernetesPreparedChange[];
  readonly projection: KubernetesProjection;
}
