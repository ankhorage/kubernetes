import type { KubernetesResourceReference } from '../../../types/kubernetesResources';

/*** Build a stable comparison key for a Kubernetes resource identity. */
export function getKubernetesResourceKey(resource: KubernetesResourceReference): string {
  return [resource.apiVersion, resource.kind, resource.namespace ?? '', resource.name].join('/');
}
