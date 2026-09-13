# Public API

## createKubernetesDriver

Kind: `function`
Module: `src/features/workload-reconciliation/composition/createKubernetesDriver.ts`
Source: `src/features/workload-reconciliation/composition/createKubernetesDriver.ts:19:1`

Create the shared Kubernetes workload driver entrypoint.

Kubernetes is an implementation dependency for runtime adapters, not a selectable Infra
provider. The supplied API port is already authenticated cluster access; the driver adds only
standard Kubernetes workload projection and lifecycle semantics.

### Signatures

- `(options: KubernetesDriverOptions) => KubernetesDriver`
  - options: `KubernetesDriverOptions`
  - returns: `KubernetesDriver`

## KubernetesApi

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:45:1`

### Members

| Name                | Kind   | Type                                                                                                                                                              | Required | Description |
| ------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| applyAsync          | method | `(resource: KubernetesResource, signal?: AbortSignal) => Promise<void>`                                                                                           | yes      |             |
| deleteAsync         | method | `(resource: KubernetesResourceReference, signal?: AbortSignal) => Promise<void>`                                                                                  | yes      |             |
| listOwnedAsync      | method | `(query: KubernetesOwnershipQuery) => Promise<readonly KubernetesResource[]>`                                                                                     | yes      |             |
| observeAsync        | method | `(resource: KubernetesResourceReference, signal?: AbortSignal) => Promise<KubernetesResourceObservation>`                                                         | yes      |             |
| waitUntilReadyAsync | method | `(resource: KubernetesResourceReference, options: { readonly timeoutSeconds: number; readonly signal?: AbortSignal; }) => Promise<KubernetesResourceObservation>` | yes      |             |

## KubernetesDesiredResource

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:65:1`

### Members

| Name     | Kind     | Type                 | Required | Description |
| -------- | -------- | -------------------- | -------- | ----------- |
| owner    | property | `InfraOwnedResource` | yes      |             |
| resource | property | `KubernetesResource` | yes      |             |

## KubernetesDriver

Kind: `type`
Module: `src/types/kubernetesDriver.ts`
Source: `src/types/kubernetesDriver.ts:29:1`

### Members

| Name                | Kind     | Type                                                                                                             | Required | Description |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| kind                | property | `"kubernetes"`                                                                                                   | yes      |             |
| outputsAsync        | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<readonly InfraOutput[]>>`                             | yes      |             |
| planAsync           | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<readonly InfraPlanAction[]>>`                         | yes      |             |
| projectAsync        | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<KubernetesProjection>>`                               | yes      |             |
| reconcileAsync      | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<InfraReconcileResult>>`                               | yes      |             |
| removeAsync         | method   | `(request: KubernetesDriverRequest, destroy: InfraDestroyRequest) => Promise<InfraResult<InfraReconcileResult>>` | yes      |             |
| statusAsync         | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<readonly InfraResourceStatus[]>>`                     | yes      |             |
| waitUntilReadyAsync | method   | `(request: KubernetesDriverRequest) => Promise<InfraResult<readonly InfraResourceStatus[]>>`                     | yes      |             |

## KubernetesDriverOptions

Kind: `type`
Module: `src/types/kubernetesDriver.ts`
Source: `src/types/kubernetesDriver.ts:15:1`

### Members

| Name                           | Kind     | Type                  | Required | Description |
| ------------------------------ | -------- | --------------------- | -------- | ----------- |
| api                            | property | `KubernetesApi`       | yes      |             |
| defaultReadinessTimeoutSeconds | property | `number \| undefined` | no       |             |

## KubernetesDriverRequest

Kind: `type`
Module: `src/types/kubernetesDriver.ts`
Source: `src/types/kubernetesDriver.ts:20:1`

### Members

| Name             | Kind     | Type                                                                                                                    | Required | Description |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| availableOutputs | property | `readonly InfraOutput[] \| undefined`                                                                                   | no       |             |
| context          | property | `InfraExecutionContext`                                                                                                 | yes      |             |
| namespace        | property | `string \| undefined`                                                                                                   | no       |             |
| ownerAdapter     | property | `"local" \| "hetzner" \| "minikube" \| "k3s" \| "docker-compose" \| "supabase" \| "cerbos" \| "r2" \| "supabase-vault"` | yes      |             |
| workloads        | property | `readonly InfraWorkloadSpec[]`                                                                                          | yes      |             |

## KubernetesOwnershipQuery

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:31:1`

### Members

| Name      | Kind     | Type                               | Required | Description |
| --------- | -------- | ---------------------------------- | -------- | ----------- |
| labels    | property | `Readonly<Record<string, string>>` | yes      |             |
| namespace | property | `string`                           | yes      |             |
| signal    | property | `AbortSignal \| undefined`         | no       |             |

## KubernetesProjection

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:71:1`

### Members

| Name           | Kind     | Type                                   | Required | Description |
| -------------- | -------- | -------------------------------------- | -------- | ----------- |
| resources      | property | `readonly KubernetesDesiredResource[]` | yes      |             |
| secretBindings | property | `readonly KubernetesSecretBinding[]`   | yes      |             |

## KubernetesResource

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:15:1`

### Members

| Name       | Kind     | Type                                             | Required | Description |
| ---------- | -------- | ------------------------------------------------ | -------- | ----------- |
| apiVersion | property | `string`                                         | yes      |             |
| data       | property | `Readonly<Record<string, string>> \| undefined`  | no       |             |
| kind       | property | `string`                                         | yes      |             |
| metadata   | property | `KubernetesResourceMetadata`                     | yes      |             |
| spec       | property | `Readonly<Record<string, unknown>> \| undefined` | no       |             |
| stringData | property | `Readonly<Record<string, string>> \| undefined`  | no       |             |

## KubernetesResourceMetadata

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:8:1`

### Members

| Name        | Kind     | Type                               | Required | Description |
| ----------- | -------- | ---------------------------------- | -------- | ----------- |
| annotations | property | `Readonly<Record<string, string>>` | yes      |             |
| labels      | property | `Readonly<Record<string, string>>` | yes      |             |
| name        | property | `string`                           | yes      |             |
| namespace   | property | `string \| undefined`              | no       |             |

## KubernetesResourceObservation

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:37:1`

### Members

| Name          | Kind     | Type                                                                                                 | Required | Description |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------- | -------- | ----------- |
| detail        | property | `string \| undefined`                                                                                | no       |             |
| publicOutputs | property | `Readonly<Record<string, string \| number \| boolean>> \| undefined`                                 | no       |             |
| state         | property | `"absent" \| "pending" \| "ready" \| "degraded" \| "stopped" \| "retained" \| "failed" \| "unknown"` | yes      |             |

## KubernetesResourceReference

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:24:1`

### Members

| Name       | Kind     | Type                  | Required | Description |
| ---------- | -------- | --------------------- | -------- | ----------- |
| apiVersion | property | `string`              | yes      |             |
| kind       | property | `string`              | yes      |             |
| name       | property | `string`              | yes      |             |
| namespace  | property | `string \| undefined` | no       |             |

## KubernetesSecretBinding

Kind: `type`
Module: `src/types/kubernetesResources.ts`
Source: `src/types/kubernetesResources.ts:59:1`

### Members

| Name      | Kind     | Type                          | Required | Description |
| --------- | -------- | ----------------------------- | -------- | ----------- |
| key       | property | `string`                      | yes      |             |
| reference | property | `InfraSecretReference`        | yes      |             |
| resource  | property | `KubernetesResourceReference` | yes      |             |
