import type { NativePortableText } from './native-portable-types.js';

export const DEFAULT_NATIVE_PORTABLE_TEXT_BYTES = 16 * 1024;

function assertByteBudget(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Native portable text byte budget must be a non-negative safe integer');
  }
}

/**
 * Keep a UTF-8-safe diagnostic preview. This budget applies only to display text;
 * callers must never pass IDs, enums, counters, paths, or acceptance collections here.
 */
export function toNativePortableText(
  value: string,
  maxBytes = DEFAULT_NATIVE_PORTABLE_TEXT_BYTES,
): NativePortableText {
  if (typeof value !== 'string') throw new Error('Native portable text must be a string');
  assertByteBudget(maxBytes);
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { text: value, truncated: false };

  let text = '';
  let bytes = 0;
  for (const character of value) {
    const width = Buffer.byteLength(character, 'utf8');
    if (bytes + width > maxBytes) break;
    text += character;
    bytes += width;
  }
  return { text, truncated: true };
}
