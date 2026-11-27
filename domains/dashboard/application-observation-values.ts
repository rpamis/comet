import { createHash } from 'node:crypto';

export const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
export const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, item]) => [k, canonical(item)]),
        )
      : v;
export const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex');

/** SDK 的领取凭据不能进入 JSON 预览或浏览器缓存。 */
export function sanitizeApplicationObservation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeApplicationObservation);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(?:claimToken|token|apiKey|api_key|password|secret|credentials?|authorization)$/iu.test(
              key,
            ),
        )
        .map(([key, item]) => [key, sanitizeApplicationObservation(item)]),
    );
  return value;
}
