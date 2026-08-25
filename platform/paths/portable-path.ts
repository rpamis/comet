import path from 'node:path';

/**
 * Resolve a path while honoring Windows drive and UNC roots even when a
 * portable path is inspected on a POSIX host (for example, in CI).
 */
export function resolvePortablePath(...segments: string[]): string {
  if (segments.length === 0) return path.resolve();

  if (path.win32.isAbsolute(segments[0])) {
    const resolved = path.win32.resolve(...segments);
    return process.platform === 'win32' ? resolved : resolved.replace(/\\/gu, '/');
  }

  return path.resolve(...segments);
}
