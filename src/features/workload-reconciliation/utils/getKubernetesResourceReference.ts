import type {
  KubernetesResource,
  KubernetesResourceReference,
} from '../../../types/kubernetesResources';

/*** Return the immutable Kubernetes identity of a desired or observed resource. */
export function getKubernetesResourceReference(
  resource: KubernetesResource,
): KubernetesResourceReference {
  return {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    name: resource.metadata.name,
    ...(resource.metadata.namespace === undefined
      ? {}
      : { namespace: resource.metadata.namespace }),
  };
}
