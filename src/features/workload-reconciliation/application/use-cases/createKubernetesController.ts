import type {
  InfraResourceIdentity,
  InfraWorkloadHealthSpec,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesResolvedWorkloadValues,
  KubernetesSecretTarget,
} from '../../../../types/kubernetesResources';
import { createKubernetesDesiredResource } from '../../utils/createKubernetesDesiredResource';
import { toKubernetesName } from '../../utils/toKubernetesName';

/*** Create the standard Kubernetes workload controller and pod template. */
export function createKubernetesController(
  request: KubernetesDriverRequest,
  input: CreateKubernetesControllerInput,
): KubernetesDesiredResource {
  const labels = { 'app.kubernetes.io/name': input.workloadName };
  return createKubernetesDesiredResource(request, {
    resourceId: `workload:${input.workload.id}`,
    dependsOn: input.dependsOn,
    resource: {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: input.workloadName,
        namespace: input.namespace,
        labels,
        annotations: {},
      },
      spec: {
        replicas: input.workload.replicas ?? 1,
        selector: { matchLabels: labels },
        template: {
          metadata: { labels },
          spec: {
            containers: [createContainer(input.workloadName, input.workload, input.values)],
            volumes: createVolumes(input.workloadName, input.workload, input.values),
          },
        },
      },
    },
  });
}

export interface CreateKubernetesControllerInput {
  readonly namespace: string;
  readonly workloadName: string;
  readonly workload: InfraWorkloadSpec;
  readonly values: KubernetesResolvedWorkloadValues;
  readonly dependsOn: readonly InfraResourceIdentity[];
}

/*** Create the portable container projection. */
function createContainer(
  name: string,
  workload: InfraWorkloadSpec,
  values: KubernetesResolvedWorkloadValues,
): Readonly<Record<string, unknown>> {
  const { resources, health } = workload;
  return {
    name,
    image: workload.artifact.image,
    ...(workload.command === undefined ? {} : { command: workload.command }),
    ...(workload.args === undefined ? {} : { args: workload.args }),
    env: createEnvironment(name, values),
    ports: (workload.ports ?? []).map((port) => ({
      name: toKubernetesName(port.name),
      containerPort: port.port,
      protocol: (port.protocol ?? 'tcp').toUpperCase(),
    })),
    volumeMounts: createVolumeMounts(workload, values),
    ...(resources === undefined ? {} : { resources: createResources(resources) }),
    ...(health === undefined
      ? {}
      : { readinessProbe: createProbe(health), livenessProbe: createProbe(health) }),
  };
}

/*** Create literal and secret-backed environment entries. */
function createEnvironment(
  name: string,
  values: KubernetesResolvedWorkloadValues,
): readonly Readonly<Record<string, unknown>>[] {
  return [
    ...Object.entries(values.environment).map(([key, value]) => ({ name: key, value })),
    ...values.secrets.filter(isEnvironmentSecret).map((secret) => ({
      name: secret.target.name,
      valueFrom: { secretKeyRef: { name: `${name}-secrets`, key: secret.key } },
    })),
  ];
}

/*** Create Kubernetes request quantities from portable workload resources. */
function createResources(
  resources: NonNullable<InfraWorkloadSpec['resources']>,
): Readonly<Record<string, unknown>> {
  return {
    requests: {
      ...(resources.cpuMillis === undefined ? {} : { cpu: `${resources.cpuMillis}m` }),
      ...(resources.memoryMiB === undefined ? {} : { memory: `${resources.memoryMiB}Mi` }),
    },
  };
}

/*** Project portable health intent into Kubernetes probe fields. */
function createProbe(health: InfraWorkloadHealthSpec): Readonly<Record<string, unknown>> {
  const timing = {
    ...(health.intervalSeconds === undefined ? {} : { periodSeconds: health.intervalSeconds }),
    ...(health.timeoutSeconds === undefined ? {} : { timeoutSeconds: health.timeoutSeconds }),
    ...(health.failureThreshold === undefined ? {} : { failureThreshold: health.failureThreshold }),
  };
  if (health.kind === 'http') {
    return { ...timing, httpGet: { port: health.port, path: health.path } };
  }
  if (health.kind === 'tcp') return { ...timing, tcpSocket: { port: health.port } };
  return { ...timing, exec: { command: health.command } };
}

/*** Create pod volumes for files and persistence. */
function createVolumes(
  name: string,
  workload: InfraWorkloadSpec,
  values: KubernetesResolvedWorkloadValues,
): readonly Readonly<Record<string, unknown>>[] {
  return [
    ...(Object.keys(values.files).length === 0
      ? []
      : [{ name: 'config-files', configMap: { name: `${name}-config` } }]),
    ...(values.secrets.some((secret) => secret.target.kind === 'file')
      ? [{ name: 'secret-files', secret: { secretName: `${name}-secrets` } }]
      : []),
    ...(workload.persistence ?? []).map((volume) => ({
      name: `volume-${toKubernetesName(volume.id)}`,
      persistentVolumeClaim: { claimName: `${name}-${toKubernetesName(volume.id)}` },
    })),
  ];
}

/*** Create exact file and persistence mount points. */
function createVolumeMounts(
  workload: InfraWorkloadSpec,
  values: KubernetesResolvedWorkloadValues,
): readonly Readonly<Record<string, unknown>>[] {
  return [
    ...Object.keys(values.files).map((path, index) => ({
      name: 'config-files',
      mountPath: path,
      subPath: `file-${index}`,
      readOnly: true,
    })),
    ...values.secrets.filter(isFileSecret).map((secret) => ({
      name: 'secret-files',
      mountPath: secret.target.path,
      subPath: secret.key,
      readOnly: true,
    })),
    ...(workload.persistence ?? []).map((volume) => ({
      name: `volume-${toKubernetesName(volume.id)}`,
      mountPath: volume.mountPath,
    })),
  ];
}

/*** Narrow a secret target to an environment entry. */
function isEnvironmentSecret(secret: KubernetesSecretTarget): secret is KubernetesSecretTarget & {
  readonly target: { readonly kind: 'environment'; readonly name: string };
} {
  return secret.target.kind === 'environment';
}

/*** Narrow a secret target to a mounted file. */
function isFileSecret(secret: KubernetesSecretTarget): secret is KubernetesSecretTarget & {
  readonly target: { readonly kind: 'file'; readonly path: string };
} {
  return secret.target.kind === 'file';
}
