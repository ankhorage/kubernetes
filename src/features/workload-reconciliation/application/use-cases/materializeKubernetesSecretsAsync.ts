import type { InfraDiagnostic, InfraResult } from '@ankhorage/contracts/infra';

import type { KubernetesDriverRequest } from '../../../../types/kubernetesDriver';
import type {
  KubernetesDesiredResource,
  KubernetesProjection,
} from '../../../../types/kubernetesResources';
import { getKubernetesResourceKey } from '../../utils/getKubernetesResourceKey';

/*** Resolve referenced secrets into ephemeral Kubernetes apply resources. */
export async function materializeKubernetesSecretsAsync(
  request: KubernetesDriverRequest,
  projection: KubernetesProjection,
): Promise<InfraResult<readonly KubernetesDesiredResource[]>> {
  const values = new Map<string, Record<string, string>>();
  const diagnostics: InfraDiagnostic[] = [];

  for (const binding of projection.secretBindings) {
    const resolved =
      binding.reference.source === 'secret-store'
        ? await request.context.secrets.resolveAsync(binding.reference)
        : await resolveCredentialValueAsync(request, binding.reference);
    if (!resolved.ok) {
      diagnostics.push(...resolved.diagnostics);
      continue;
    }
    const resourceValues = values.get(getKubernetesResourceKey(binding.resource)) ?? {};
    resourceValues[binding.key] = resolved.value;
    values.set(getKubernetesResourceKey(binding.resource), resourceValues);
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };

  return {
    ok: true,
    value: projection.resources.map((desired) => {
      const secretValues = values.get(desired.owner.externalId ?? '');
      if (secretValues === undefined) return desired;
      return {
        ...desired,
        resource: { ...desired.resource, stringData: secretValues },
      };
    }),
    diagnostics: [],
  };
}

async function resolveCredentialValueAsync(
  request: KubernetesDriverRequest,
  reference: Extract<
    KubernetesProjection['secretBindings'][number]['reference'],
    { source: 'control-plane' }
  >,
): Promise<InfraResult<string>> {
  const resolved = await request.context.credentials.resolveAsync(reference);
  if (!resolved.ok) return resolved;
  const value = resolved.value[reference.key];
  return value === undefined
    ? {
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'kubernetes-credential-key-missing',
            message: 'A required control-plane credential field is missing.',
          },
        ],
      }
    : { ok: true, value, diagnostics: [] };
}
