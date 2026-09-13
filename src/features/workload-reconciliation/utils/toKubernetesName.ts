/*** Convert an arbitrary stable identifier into a deterministic Kubernetes DNS label. */
export function toKubernetesName(value: string): string {
  const normalized =
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'resource';

  if (normalized.length <= 63) return normalized;

  const suffix = hash(value).toString(36).padStart(7, '0').slice(-7);
  return `${normalized.slice(0, 55).replace(/-+$/g, '')}-${suffix}`;
}

/*** Produce a stable non-cryptographic suffix used only for Kubernetes name uniqueness. */
function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}
