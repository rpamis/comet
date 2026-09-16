import { createHash } from 'node:crypto';

/**
 * One bound input of a recorded check. `p` is a repository-relative path with
 * `/` separators; entries prefixed with `\u0000git:` bind repository metadata
 * (HEAD or an index stage) rather than a worktree file, which cannot collide
 * with a real path. `h` is the sha256 hex of the bound content, `s` the file
 * size in bytes and `m` the modification time in nanoseconds; all three are
 * null for missing files and metadata entries.
 */
export interface CheckManifestEntry {
  p: string;
  h: string;
  s: number | null;
  m: string | null;
}

export interface CheckManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function serializeCheckManifest(entries: readonly CheckManifestEntry[]): string {
  return [...entries]
    .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
    .map((entry) =>
      JSON.stringify({
        p: entry.p,
        h: entry.h,
        s: entry.s ?? null,
        m: entry.m ?? null,
      }),
    )
    .join('\n');
}

export function checkManifestHash(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

export function parseCheckManifest(serialized: string): CheckManifestEntry[] {
  const entries: CheckManifestEntry[] = [];
  for (const line of serialized.split('\n')) {
    if (!line) continue;
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid check manifest entry');
    const { p, h, s, m } = value as Record<string, unknown>;
    if (typeof p !== 'string' || !p || typeof h !== 'string' || !h)
      throw new Error('Invalid check manifest entry');
    if (s !== null && typeof s !== 'number') throw new Error('Invalid check manifest entry');
    if (m !== null && typeof m !== 'string') throw new Error('Invalid check manifest entry');
    entries.push({ p, h, s, m });
  }
  return entries;
}

/**
 * Compares a recorded baseline against the current snapshot. Differences are
 * decided by content hash only: a touched file with unchanged content and a
 * matching stat identity never appears here because the collector reuses the
 * baseline hash without rereading.
 */
export function diffCheckManifests(
  baseline: readonly CheckManifestEntry[],
  current: readonly CheckManifestEntry[],
): CheckManifestDiff {
  const base = new Map(baseline.map((entry) => [entry.p, entry]));
  const curr = new Map(current.map((entry) => [entry.p, entry]));
  const sort = (paths: Iterable<string>) => [...paths].sort();
  return {
    added: sort([...curr.keys()].filter((p) => !base.has(p))),
    removed: sort([...base.keys()].filter((p) => !curr.has(p))),
    changed: sort([...base.keys()].filter((p) => curr.has(p) && base.get(p)!.h !== curr.get(p)!.h)),
  };
}

export function hasGlobCharacters(value: string): boolean {
  return /[*?]/u.test(value);
}

type PolicyPatternToken =
  | { kind: 'literal'; value: string }
  | { kind: 'question' | 'star' | 'globstar' | 'globstar-slash' };

/**
 * Matches `/`-separated repository-relative paths against one declared policy
 * pattern: `*` stays within a path segment, `**` crosses segments, and a
 * leading `**` followed by a slash matches zero or more leading directories.
 * The token automaton mirrors the workflow snapshot matcher so both surfaces
 * accept the same patterns.
 */
export function compileCheckPolicyPattern(pattern: string): (relative: string) => boolean {
  const tokens: PolicyPatternToken[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        tokens.push({ kind: 'globstar-slash' });
      } else {
        tokens.push({ kind: 'globstar' });
      }
    } else if (character === '*') {
      tokens.push({ kind: 'star' });
    } else if (character === '?') {
      tokens.push({ kind: 'question' });
    } else {
      tokens.push({ kind: 'literal', value: character });
    }
  }

  const epsilonClosure = (positions: ReadonlySet<number>): Set<number> => {
    const closure = new Set(positions);
    const pending = [...positions];
    while (pending.length > 0) {
      const position = pending.pop()!;
      const token = tokens[position];
      if (
        token &&
        (token.kind === 'star' || token.kind === 'globstar' || token.kind === 'globstar-slash') &&
        !closure.has(position + 1)
      ) {
        closure.add(position + 1);
        pending.push(position + 1);
      }
    }
    return closure;
  };

  return (relative: string): boolean => {
    let positions = epsilonClosure(new Set([0]));
    for (const character of relative) {
      const next = new Set<number>();
      for (const position of positions) {
        const token = tokens[position];
        if (!token) continue;
        if (token.kind === 'literal' && token.value === character) {
          next.add(position + 1);
        } else if (token.kind === 'question' && character !== '/') {
          next.add(position + 1);
        } else if (token.kind === 'star' && character !== '/') {
          next.add(position);
        } else if (token.kind === 'globstar') {
          next.add(position);
        } else if (token.kind === 'globstar-slash') {
          next.add(position);
          if (character === '/') next.add(position + 1);
        }
      }
      positions = epsilonClosure(next);
      if (positions.size === 0) return false;
    }
    return epsilonClosure(positions).has(tokens.length);
  };
}
