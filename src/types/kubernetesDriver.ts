/** Public non-provider driver boundary composed by Kubernetes runtime adapters. */
export interface KubernetesDriver {
  readonly kind: 'kubernetes';
}
