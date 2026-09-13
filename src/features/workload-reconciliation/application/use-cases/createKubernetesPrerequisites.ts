import type { InfraResourceIdentity, InfraWorkloadSpec } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesResolvedWorkloadValues,
  KubernetesSecretBinding,
} from '../../../../types/kubernetesResources';
import { createKubernetesDesiredResource } from '../../utils/createKubernetesDesiredResource';
import { getKubernetesResourceReference } from '../../utils/getKubernetesResourceReference';
import { toKubernetesName } from '../../utils/toKubernetesName';

/*** Create config, secret and persistent-volume prerequisites in dependency order. */
export function createKubernetesPrerequisites(
  request: KubernetesDriverRequest,
  input: CreateKubernetesPrerequisitesInput,
): KubernetesPrerequisites {
  const resources: KubernetesDesiredResource[] = [];
  const owners: InfraResourceIdentity[] = [input.namespaceOwner];
  const configMap = createConfigMap(request, input);
  if (configMap !== undefined) {
    resources.push(configMap);
    owners.push(configMap.owner.identity);
  }
  const secret = createSecret(request, input);
  if (secret !== undefined) {
    resources.push(secret.resource);
    owners.push(secret.resource.owner.identity);
  }
  for (const volume of input.workload.persistence ?? []) {
    const claim = createPersistentVolumeClaim(request, input, volume);
    resources.push(claim);
    owners.push(claim.owner.identity);
  }
  return { resources, owners, secretBindings: secret?.bindings ?? [] };
}

export interface CreateKubernetesPrerequisitesInput {
  readonly namespace: string;
  readonly namespaceOwner: InfraResourceIdentity;
  readonly workloadName: string;
  readonly workload: InfraWorkloadSpec;
  readonly values: KubernetesResolvedWorkloadValues;
}

export interface KubernetesPrerequisites {
  readonly resources: readonly KubernetesDesiredResource[];
  readonly owners: readonly InfraResourceIdentity[];
  readonly secretBindings: readonly KubernetesSecretBinding[];
}

/*** Create portable file configuration without secret content. */
function createConfigMap(
  request: KubernetesDriverRequest,
  input: CreateKubernetesPrerequisitesInput,
): KubernetesDesiredResource | undefined {
  if (Object.keys(input.values.files).length === 0) return undefined;
  const data = Object.fromEntries(
    Object.values(input.values.files).map((value, index) => [`file-${index}`, value]),
  );
  return createKubernetesDesiredResource(request, {
    resourceId: `config:${input.workloadName}`,
    dependsOn: [input.namespaceOwner],
    resource: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: {
        name: `${input.workloadName}-config`,
        namespace: input.namespace,
        labels: {},
        annotations: {},
      },
      data,
    },
  });
}

/*** Create a value-free Secret skeleton plus runtime-only materialization bindings. */
function createSecret(
  request: KubernetesDriverRequest,
  input: CreateKubernetesPrerequisitesInput,
):
  | {
      readonly resource: KubernetesDesiredResource;
      readonly bindings: readonly KubernetesSecretBinding[];
    }
  | undefined {
  if (input.values.secrets.length === 0) return undefined;
  const resource = createKubernetesDesiredResource(request, {
    resourceId: `secret:${input.workloadName}`,
    dependsOn: [input.namespaceOwner],
    resource: {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: `${input.workloadName}-secrets`,
        namespace: input.namespace,
        labels: {},
        annotations: {},
      },
    },
  });
  const reference = getKubernetesResourceReference(resource.resource);
  return {
    resource,
    bindings: input.values.secrets.map((secret) => ({
      resource: reference,
      key: secret.key,
      reference: secret.reference,
    })),
  };
}

/*** Create one persistent volume claim from portable capacity and retention intent. */
function createPersistentVolumeClaim(
  request: KubernetesDriverRequest,
  input: CreateKubernetesPrerequisitesInput,
  volume: NonNullable<InfraWorkloadSpec['persistence']>[number],
): KubernetesDesiredResource {
  const volumeName = toKubernetesName(volume.id);
  return createKubernetesDesiredResource(request, {
    resourceId: `volume:${input.workloadName}:${volume.id}`,
    persistent: true,
    retention: volume.retention,
    dependsOn: [input.namespaceOwner],
    resource: {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: `${input.workloadName}-${volumeName}`,
        namespace: input.namespace,
        labels: {},
        annotations: {},
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: { requests: { storage: `${volume.sizeGiB}Gi` } },
      },
    },
  });
}
