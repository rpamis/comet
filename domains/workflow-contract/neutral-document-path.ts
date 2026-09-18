/**
 * Neutral document paths: documentation-like project files that Comet keeps
 * outside implementation writes and check inputs by default, so editing a
 * README or a docs page cannot invalidate recorded evidence or a verified
 * candidate on its own.
 *
 * A path is neutral when it carries a documentation extension at the
 * repository root or inside a documentation directory, or matches a root
 * license/credits file, and does not fall inside a caller-declared protected
 * prefix. Comet formal artifacts are always passed as protected prefixes;
 * they stay fully bound regardless of this default. Explicit declarations
 * that bind stricter scopes (check-policy `files`, strict config modes) keep
 * their exact semantics — neutrality is a default, not an override.
 */

/**
 * Root-level neutrality stays narrower than directory-level neutrality:
 * root `.txt`/`.rst` files are common command inputs (fixtures, data files),
 * so only Markdown and license/credits files are neutral at the root.
 */
const ROOT_DOCUMENTATION_EXTENSIONS = new Set(['.md', '.markdown']);
const DIRECTORY_DOCUMENTATION_EXTENSIONS = new Set(['.md', '.markdown', '.rst', '.txt']);
const DOCUMENTATION_ROOT_DIRECTORIES = new Set(['docs', 'doc', 'documentation', '.github']);
const ROOT_DOCUMENT_NAME_PATTERNS = [/^LICENSE(?:[.-]|$)/u, /^NOTICE$/u, /^AUTHORS$/u];

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function isProtected(normalized: string, protectedPrefixes: readonly string[]): boolean {
  for (const rawPrefix of protectedPrefixes) {
    const prefix = normalizeRelative(rawPrefix).replace(/\/+$/u, '');
    if (prefix && (normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
  }
  return false;
}

/**
 * @param relativePath project-relative path with `/` separators.
 * @param protectedPrefixes project-relative prefixes that always stay bound,
 *   even when their files would otherwise look like documentation.
 */
export function isNeutralDocumentPath(
  relativePath: string,
  protectedPrefixes: readonly string[] = [],
): boolean {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || normalized.endsWith('/')) return false;
  if (isProtected(normalized, protectedPrefixes)) return false;
  const segments = normalized.split('/');
  const name = segments[segments.length - 1]!;
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  if (segments.length === 1) {
    return (
      ROOT_DOCUMENTATION_EXTENSIONS.has(extension) ||
      ROOT_DOCUMENT_NAME_PATTERNS.some((pattern) => pattern.test(name))
    );
  }
  return (
    DOCUMENTATION_ROOT_DIRECTORIES.has(segments[0]!) &&
    DIRECTORY_DOCUMENTATION_EXTENSIONS.has(extension)
  );
}
