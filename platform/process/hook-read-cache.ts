/**
 * Process-local memoization for the high-frequency Hook path.
 *
 * Each PreToolUse Hook invocation is a fresh Node process, but within that
 * single process the same project-rooted reads are repeated several times:
 * `inspectCometHook` resolves the workflow owner (reads config + current
 * selection + enumerates active changes), then delegates to a Guard that
 * re-enumerates the same active changes and re-resolves the current change
 * (spawning `git` again). These reads are immutable for the lifetime of one
 * Hook decision, so memoizing them per projectRoot eliminates the redundant
 * IO and `git` forks without any cross-invocation consistency risk — the
 * cache dies with the process.
 *
 * The cache is opt-in: only the Hook entry point activates it, and only the
 * Hook-path read functions consult it. CLI commands, writes, and Native
 * receipt/hash verification never go through this cache. This module lives
 * in `platform/` so every domain can share it without creating import
 * cycles (no domain dependency on a higher layer).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface CacheEntry {
  value: unknown;
}

interface HookReadCacheScope {
  entries: Map<string, CacheEntry>;
  active: boolean;
}

const scopes = new AsyncLocalStorage<HookReadCacheScope>();

function currentScope(): HookReadCacheScope | null {
  const scope = scopes.getStore();
  return scope?.active ? scope : null;
}

/** Discard the current decision's reads before a Runtime mutation. */
export function invalidateHookReadCache(): void {
  currentScope()?.entries.clear();
}

/**
 * Run `work` with a per-invocation read cache active. Reads issued through
 * `memoizedHookRead` during `work` are cached by their argument key for the
 * duration of the call. The cache is dropped as soon as `work` settles, so it
 * never leaks across Hook invocations or into CLI command paths.
 */
export async function runWithHookReadCache<T>(work: () => Promise<T>): Promise<T> {
  if (currentScope() !== null) {
    // Nested activation: reuse the outer scope rather than splitting caches.
    return work();
  }
  const scope: HookReadCacheScope = { entries: new Map(), active: true };
  return scopes.run(scope, async () => {
    try {
      return await work();
    } finally {
      scope.active = false;
      scope.entries.clear();
    }
  });
}

function cacheKey(factoryName: string, args: readonly unknown[]): string {
  let key = factoryName;
  for (const arg of args) {
    key += '\u0000' + (typeof arg === 'string' ? arg : JSON.stringify(arg));
  }
  return key;
}

/**
 * Memoize an async factory for the duration of the active Hook read cache.
 *
 * When no cache is active (CLI paths, tests that bypass the Hook entry), the
 * factory runs unchanged on every call — preserving exact current behavior.
 * When a cache is active, the first call with a given argument tuple stores
 * the in-flight promise; concurrent and repeat callers within the same Hook
 * decision share that single result. Rejections are not cached, so a
 * transient failure still retries on the next call.
 */
export function memoizedHookRead<TArgs extends unknown[], TResult>(
  factoryName: string,
  factory: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs): Promise<TResult> => {
    const scope = currentScope();
    if (scope === null) {
      return factory(...args);
    }
    const key = cacheKey(`async:${factoryName}`, args);
    const existing = scope.entries.get(key);
    if (existing) {
      return existing.value as Promise<TResult>;
    }
    const promise = factory(...args).catch((error) => {
      // Do not cache failures; a later caller in the same Hook may succeed
      // after a transient race, and caching an error would propagate it to
      // every shared caller even if they could have recovered.
      if (scope.entries.get(key)?.value === promise) scope.entries.delete(key);
      throw error;
    });
    scope.entries.set(key, { value: promise });
    return promise as Promise<TResult>;
  };
}

/**
 * Memoize a synchronous factory for the duration of the active Hook read
 * cache. Mirrors {@link memoizedHookRead} for non-async reads such as the
 * `git rev-parse` branch probe, which is the single most expensive sync call
 * on the Hook path.
 */
export function memoizedHookReadSync<TArgs extends unknown[], TResult>(
  factoryName: string,
  factory: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs): TResult => {
    const scope = currentScope();
    if (scope === null) {
      return factory(...args);
    }
    const key = cacheKey(`sync:${factoryName}`, args);
    const existing = scope.entries.get(key);
    if (existing) {
      return existing.value as TResult;
    }
    const result = factory(...args);
    scope.entries.set(key, { value: result });
    return result;
  };
}
