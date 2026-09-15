# @ankhorage/kubernetes

## 0.7.2

### Patch Changes

- 37db3df: Gate Kubernetes reconciliation on readiness-relevant workload dependencies so dependent resources are not applied before their dependencies are ready.

## 0.7.1

### Patch Changes

- c334787: Fail fast on terminal Kubernetes workload readiness failures and share one timeout budget across the readiness run.

## 0.7.0

### Minor Changes

- 2d8c1c9: Project an optional published workload port as an exact Kubernetes host port.

## 0.6.0

### Minor Changes

- ad29e61: Materialize workload templates containing privileged segments only at the Kubernetes apply boundary.

## 0.5.0

### Minor Changes

- dc009b7: Materialize keyed control-plane credentials only at the Kubernetes API apply boundary.

## 0.4.0

### Minor Changes

- e3c0081: Add a shell-free, authenticated kubectl API adapter for concrete Kubernetes runtime integrations.

## 0.3.0

### Minor Changes

- cc70cf4: Export the API-independent Kubernetes desired-resource projection for complete pre-cluster runtime planning and consume the current Contracts runtime boundary.

## 0.2.0

### Minor Changes

- 77fdbe4: Implement provider-neutral Kubernetes workload projection, reconciliation, lifecycle status, outputs, readiness, runtime secret materialization, and safe owned-resource removal.

## 0.1.0

### Minor Changes

- 198dfe9: Publish the initial provider-neutral infrastructure package foundation.

## 0.0.0

Initial unpublished package state.
