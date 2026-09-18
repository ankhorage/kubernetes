import type { InfraCredentialPort } from '@ankhorage/contracts/infra';

/** Create a complete execution-only credential boundary for Kubernetes tests. */
export function createCredentialPort(
  values: Readonly<Record<string, string>> = {},
): InfraCredentialPort {
  return {
    findAsync: () => Promise.resolve({ ok: true, value: null, diagnostics: [] }),
    resolveAsync: () => Promise.resolve({ ok: true, value: values, diagnostics: [] }),
    persistAsync: () => Promise.resolve({ ok: true, value: null, diagnostics: [] }),
  };
}
