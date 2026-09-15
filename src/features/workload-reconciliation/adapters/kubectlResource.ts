import type {
  KubernetesResource,
  KubernetesResourceObservation,
} from '../../../types/kubernetesResources';

const LAST_APPLIED_ANNOTATION = 'kubectl.kubernetes.io/last-applied-configuration';

/*** Parse a kubectl list response into comparison-safe desired resource shapes. */
export function parseKubectlResourceList(value: string): readonly KubernetesResource[] {
  const parsed = parseKubectlJsonRecord(value);
  const items = getValue(parsed, 'items');
  if (!Array.isArray(items)) throw new Error('kubectl returned an invalid resource list.');
  return items.map(parseComparisonResource);
}

/*** Parse an optional single-resource response. */
export function parseOptionalKubectlResource(value: string): readonly KubernetesResource[] {
  return value.trim().length === 0 ? [] : [parseComparisonResource(parseKubectlJsonRecord(value))];
}

/*** Parse one JSON object returned by kubectl. */
export function parseKubectlJsonRecord(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Use the canonical sanitized error below.
  }
  throw new Error('kubectl returned invalid JSON.');
}

/*** Map standard Kubernetes status fields without exposing Secret data. */
export function observeKubectlResource(
  resource: Readonly<Record<string, unknown>>,
): KubernetesResourceObservation {
  const kind = readString(resource, 'kind');
  const metadata = readRecord(resource, 'metadata');
  const spec = optionalRecord(resource, 'spec');
  const status = optionalRecord(resource, 'status');
  const publicOutputs = readPublicOutputs(kind, spec, status);
  if (kind === 'Deployment') {
    return observeDeployment(metadata, spec, status, publicOutputs);
  }
  if (kind === 'PersistentVolumeClaim') {
    const phase = optionalString(status, 'phase');
    return withOutputs(phase === 'Bound' ? 'ready' : phase === 'Lost' ? 'failed' : 'pending');
  }
  if (kind === 'Namespace') {
    const phase = optionalString(status, 'phase');
    return withOutputs(
      phase === 'Active' ? 'ready' : phase === 'Terminating' ? 'failed' : 'pending',
    );
  }
  return withOutputs('ready', publicOutputs);
}

/*** Match a required subset of labels without dynamic object-property access. */
export function labelsInclude(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(expected).every(([expectedKey, expectedValue]) =>
    Object.entries(actual).some(
      ([actualKey, actualValue]) => actualKey === expectedKey && actualValue === expectedValue,
    ),
  );
}

/*** Map Deployment replicas, generation and terminal rollout conditions to readiness. */
function observeDeployment(
  metadata: Readonly<Record<string, unknown>>,
  spec: Readonly<Record<string, unknown>> | undefined,
  status: Readonly<Record<string, unknown>> | undefined,
  publicOutputs: Readonly<Record<string, string>> | undefined,
): KubernetesResourceObservation {
  const desired = readNumber(spec, 'replicas') ?? 1;
  const available = readNumber(status, 'availableReplicas') ?? 0;
  const generation = readNumber(metadata, 'generation') ?? 0;
  const observedGeneration = readNumber(status, 'observedGeneration') ?? 0;
  const ready = available >= desired && observedGeneration >= generation;
  const failure = ready ? undefined : readDeploymentFailure(status);
  return withOutputs(
    ready ? 'ready' : failure === undefined ? 'pending' : 'failed',
    publicOutputs,
    failure,
  );
}

/*** Prefer kubectl's exact last-applied shape to avoid server-default drift during planning. */
function parseComparisonResource(value: unknown): KubernetesResource {
  const applied = readLastApplied(value);
  if (applied === undefined) return parseResource(value);
  try {
    return parseResource(JSON.parse(applied));
  } catch {
    throw new Error('kubectl returned an invalid last-applied resource.');
  }
}

/*** Read kubectl's comparison annotation before stripping bookkeeping metadata. */
function readLastApplied(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = optionalRecord(value, 'metadata');
  const annotations = optionalStringRecord(metadata, 'annotations');
  return annotations === undefined
    ? undefined
    : getStringValue(annotations, LAST_APPLIED_ANNOTATION);
}

/*** Parse the generic resource fields owned by the shared Kubernetes driver. */
function parseResource(value: unknown): KubernetesResource {
  if (!isRecord(value)) throw new Error('kubectl returned an invalid resource.');
  const metadata = readRecord(value, 'metadata');
  const namespace = optionalString(metadata, 'namespace');
  const data = optionalStringRecord(value, 'data');
  const stringData = optionalStringRecord(value, 'stringData');
  const spec = optionalRecord(value, 'spec');
  return {
    apiVersion: readString(value, 'apiVersion'),
    kind: readString(value, 'kind'),
    metadata: {
      name: readString(metadata, 'name'),
      ...(namespace === undefined ? {} : { namespace }),
      labels: optionalStringRecord(metadata, 'labels') ?? {},
      annotations: withoutLastApplied(optionalStringRecord(metadata, 'annotations') ?? {}),
    },
    ...(data === undefined ? {} : { data }),
    ...(stringData === undefined ? {} : { stringData }),
    ...(spec === undefined ? {} : { spec }),
  };
}

/*** Read one terminal Deployment condition without exposing provider-controlled messages. */
function readDeploymentFailure(
  status: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const conditions = getValue(status, 'conditions');
  if (!isUnknownArray(conditions)) return undefined;
  const failure = conditions.filter(isRecord).find((condition) => {
    const type = optionalString(condition, 'type');
    const conditionStatus = optionalString(condition, 'status');
    const reason = optionalString(condition, 'reason');
    return (
      (type === 'ReplicaFailure' && conditionStatus === 'True') ||
      (type === 'Progressing' &&
        conditionStatus === 'False' &&
        reason === 'ProgressDeadlineExceeded')
    );
  });
  if (failure === undefined) return undefined;
  return `Deployment is ${optionalString(failure, 'reason') ?? 'DeploymentFailure'}.`;
}

/*** Read only endpoint values that Kubernetes explicitly exposes as public routing state. */
function readPublicOutputs(
  kind: string,
  spec: Readonly<Record<string, unknown>> | undefined,
  status: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (kind === 'Ingress') {
    const rules = getValue(spec, 'rules');
    const firstRule = isUnknownArray(rules) ? rules.at(0) : undefined;
    const host = isRecord(firstRule) ? optionalString(firstRule, 'host') : undefined;
    return host === undefined ? undefined : { endpoint: `https://${host}` };
  }
  if (kind !== 'Service') return undefined;
  const loadBalancer = optionalRecord(status, 'loadBalancer');
  const ingress = getValue(loadBalancer, 'ingress');
  const firstIngress = isUnknownArray(ingress) ? ingress.at(0) : undefined;
  if (!isRecord(firstIngress)) return undefined;
  const endpoint = optionalString(firstIngress, 'hostname') ?? optionalString(firstIngress, 'ip');
  return endpoint === undefined ? undefined : { endpoint };
}

/*** Add optional public outputs and sanitized detail to a resource observation. */
function withOutputs(
  state: KubernetesResourceObservation['state'],
  publicOutputs?: Readonly<Record<string, string>>,
  detail?: string,
): KubernetesResourceObservation {
  return {
    state,
    ...(detail === undefined ? {} : { detail }),
    ...(publicOutputs === undefined ? {} : { publicOutputs }),
  };
}

/*** Remove kubectl's bookkeeping annotation from driver-owned comparison metadata. */
function withoutLastApplied(
  annotations: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(annotations).filter(([key]) => key !== LAST_APPLIED_ANNOTATION),
  );
}

/*** Narrow an unknown value to a plain record. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/*** Narrow an unknown value to an array whose entries remain unknown. */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/*** Read a property through entry iteration to avoid trusting dynamic object prototypes. */
function getValue(value: Readonly<Record<string, unknown>> | undefined, key: string): unknown {
  const entry =
    value === undefined ? undefined : Object.entries(value).find(([name]) => name === key);
  return entry?.at(1);
}

/*** Read one required string field. */
function readString(value: Readonly<Record<string, unknown>>, key: string): string {
  const item = getValue(value, key);
  if (typeof item !== 'string' || item.length === 0) {
    throw new Error('kubectl returned an invalid resource field.');
  }
  return item;
}

/*** Read one optional string field. */
function optionalString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const item = getValue(value, key);
  if (item === undefined) return undefined;
  if (typeof item !== 'string') throw new Error('kubectl returned an invalid resource field.');
  return item;
}

/*** Read one required record field. */
function readRecord(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const item = getValue(value, key);
  if (!isRecord(item)) throw new Error('kubectl returned an invalid resource field.');
  return item;
}

/*** Read one optional record field. */
function optionalRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  const item = getValue(value, key);
  if (item === undefined) return undefined;
  if (!isRecord(item)) throw new Error('kubectl returned an invalid resource field.');
  return item;
}

/*** Read one optional finite number field. */
function readNumber(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): number | undefined {
  const item = getValue(value, key);
  return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

/*** Read one optional string record field. */
function optionalStringRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, string>> | undefined {
  const item = getValue(value, key);
  if (item === undefined) return undefined;
  if (!isRecord(item)) throw new Error('kubectl returned an invalid string record.');
  const entries: [string, string][] = [];
  for (const [entryKey, entryValue] of Object.entries(item)) {
    if (typeof entryValue !== 'string') {
      throw new Error('kubectl returned an invalid string record.');
    }
    entries.push([entryKey, entryValue]);
  }
  return Object.fromEntries(entries);
}

/*** Read a string value from a validated string record. */
function getStringValue(value: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.entries(value)
    .find(([entryKey]) => entryKey === key)
    ?.at(1);
}
