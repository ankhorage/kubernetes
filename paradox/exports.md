# Public API

## createKubernetesDriver

Kind: `function`
Module: `src/features/workload-reconciliation/composition/createKubernetesDriver.ts`
Source: `src/features/workload-reconciliation/composition/createKubernetesDriver.ts:12:1`

Create the shared Kubernetes workload driver entrypoint.

Kubernetes is an implementation dependency for runtime adapters, not a selectable Infra
provider. Workload projection and reconciliation operations are added at this boundary in the
driver implementation phase.

### Signatures

- `() => KubernetesDriver`
  - returns: `KubernetesDriver`

## KubernetesDriver

Kind: `type`
Module: `src/types/kubernetesDriver.ts`
Source: `src/types/kubernetesDriver.ts:2:1`

### Members

| Name | Kind     | Type           | Required | Description |
| ---- | -------- | -------------- | -------- | ----------- |
| kind | property | `"kubernetes"` | yes      |             |
