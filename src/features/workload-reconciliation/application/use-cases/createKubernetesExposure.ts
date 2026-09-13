import type {
  InfraResourceIdentity,
  InfraWorkloadPort,
  InfraWorkloadSpec,
} from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver';
import type { KubernetesDesiredResource } from '../../../../types/kubernetesResources';
import { createKubernetesDesiredResource } from '../../utils/createKubernetesDesiredResource';
import { toKubernetesName } from '../../utils/toKubernetesName';

/*** Create Services and optional Ingress from portable port and exposure intent. */
export function createKubernetesExposure(
  request: KubernetesDriverRequest,
  input: CreateKubernetesExposureInput,
): readonly KubernetesDesiredResource[] {
  const service = createService(request, input);
  if (service === undefined) return [];
  const ingress = createIngress(request, input, service.owner.identity);
  return ingress === undefined ? [service] : [service, ingress];
}

export interface CreateKubernetesExposureInput {
  readonly namespace: string;
  readonly workloadName: string;
  readonly workload: InfraWorkloadSpec;
  readonly controller: InfraResourceIdentity;
}

/*** Create the stable service boundary for declared workload ports. */
function createService(
  request: KubernetesDriverRequest,
  input: CreateKubernetesExposureInput,
): KubernetesDesiredResource | undefined {
  const ports = input.workload.ports ?? [];
  if (ports.length === 0) return undefined;
  const hasIngress =
    input.workload.exposure === 'public' && request.context.desired.networking?.domain;
  return createKubernetesDesiredResource(request, {
    resourceId: `service:${input.workload.id}`,
    dependsOn: [input.controller],
    resource: {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: input.workloadName,
        namespace: input.namespace,
        labels: {},
        annotations: {},
      },
      spec: {
        type: input.workload.exposure === 'public' && !hasIngress ? 'LoadBalancer' : 'ClusterIP',
        selector: { 'app.kubernetes.io/name': input.workloadName },
        ports: ports.map(createServicePort),
      },
    },
  });
}

/*** Project one generic port into a Service port. */
function createServicePort(port: InfraWorkloadPort): Readonly<Record<string, unknown>> {
  return {
    name: toKubernetesName(port.name),
    port: port.port,
    targetPort: toKubernetesName(port.name),
    protocol: (port.protocol ?? 'tcp').toUpperCase(),
  };
}

/*** Create ingress only when public hostname intent and a TCP port both exist. */
function createIngress(
  request: KubernetesDriverRequest,
  input: CreateKubernetesExposureInput,
  service: InfraResourceIdentity,
): KubernetesDesiredResource | undefined {
  const domain = request.context.desired.networking?.domain;
  const port = (input.workload.ports ?? []).find(
    (candidate) => (candidate.protocol ?? 'tcp') === 'tcp',
  );
  if (input.workload.exposure !== 'public' || domain === undefined || port === undefined) {
    return undefined;
  }
  return createKubernetesDesiredResource(request, {
    resourceId: `ingress:${input.workload.id}`,
    dependsOn: [service],
    resource: {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: input.workloadName,
        namespace: input.namespace,
        labels: {},
        annotations: {},
      },
      spec: {
        rules: [
          {
            host: domain,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: input.workloadName,
                      port: { name: toKubernetesName(port.name) },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });
}
