import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import {
  resolveProjectName,
  resolveProjectIdentity,
  resolveStableProjectId,
  resolveStableProjectIdAsync,
  stableProjectId,
  withProjectIdentityScope,
} from '../../platform/paths/project-identity.js';

describe('project identity', () => {
  it.each([true, false])(
    'shares identity and name within one request (origin=%s)',
    async (origin) => {
      const runGit = vi.fn((_root: string, args: readonly string[]) => {
        if (args[0] === 'remote') {
          if (origin) return 'https://example.com/team/My.Comet.git';
          throw new Error('no origin');
        }
        return '.git';
      });
      await withProjectIdentityScope(async () => {
        const id = resolveStableProjectId('D:/repo', { runGit });
        await Promise.resolve();
        expect(resolveStableProjectId('D:/repo', { runGit })).toBe(id);
        expect(resolveProjectName('D:/repo', { runGit })).toBe(origin ? 'My.Comet' : 'repo');
        expect(runGit).toHaveBeenCalledTimes(origin ? 1 : 2);
      });
    },
  );

  it('reobserves a changed origin in the next request and isolates concurrent scopes', async () => {
    let remote = 'https://example.com/team/first.git';
    const runGit = vi.fn(() => remote);
    const first = withProjectIdentityScope(() => resolveStableProjectId('D:/repo', { runGit }));
    remote = 'https://example.com/team/second.git';
    const second = withProjectIdentityScope(() => resolveStableProjectId('D:/repo', { runGit }));
    expect(first).not.toBe(second);
    await Promise.all(
      [1, 2].map(() =>
        withProjectIdentityScope(async () => {
          resolveProjectName('D:/repo', { runGit });
          await Promise.resolve();
          resolveStableProjectId('D:/repo', { runGit });
        }),
      ),
    );
    expect(runGit).toHaveBeenCalledTimes(4);
  });

  it('does not keep stale observations in detached work after the request finishes', async () => {
    let remote = 'https://example.com/first.git';
    const runGit = vi.fn(() => remote);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let detached!: Promise<string>;
    const first = withProjectIdentityScope(() => {
      detached = gate.then(() => resolveStableProjectId('D:/repo', { runGit }));
      return resolveStableProjectId('D:/repo', { runGit });
    });
    remote = 'https://example.com/second.git';
    release();
    expect(await detached).not.toBe(first);
    expect(runGit).toHaveBeenCalledTimes(2);
  });
  it('prefers the origin and keeps the id stable across local paths', () => {
    const runGit = (_root: string, args: readonly string[]) => {
      if (args[0] === 'remote') return 'https://example.com/team/comet.git';
      throw new Error('not used');
    };

    expect(resolveProjectIdentity('D:/worktree-a', { runGit })).toBe(
      'https://example.com/team/comet',
    );
    expect(resolveStableProjectId('D:/worktree-a', { runGit })).toBe(
      resolveStableProjectId('D:/worktree-b', { runGit }),
    );
    expect(resolveProjectName('D:/worktree-a', { runGit })).toBe('comet');
  });

  it('uses the shared git directory before a path fallback', () => {
    const runGit = (_root: string, args: readonly string[]) => {
      if (args[0] === 'remote') throw new Error('no remote');
      return '.git';
    };
    expect(resolveProjectIdentity('D:/repo', { runGit })).toBe('d:/repo');
  });

  it('produces a safe readable id', () => {
    expect(stableProjectId('https://example.com/team/My.Comet.git')).toMatch(
      /^my\.comet-[a-f0-9]{8}$/u,
    );
  });

  it('handles long runs of boundary separators in names and paths', () => {
    const dashes = '-'.repeat(50_000);
    const slashes = '/'.repeat(50_000);
    expect(stableProjectId(`https://example.com/team/${dashes}project${dashes}`)).toMatch(
      /^project-[a-f0-9]{8}$/u,
    );
    const runGit = () => `https://example.com/team/project${slashes}`;
    expect(resolveProjectIdentity('D:/repo', { runGit })).toBe('https://example.com/team/project');
    expect(resolveProjectName('D:/repo', { runGit })).toBe('project');
  });
});

describe('bounded asynchronous project identity', () => {
  it('matches path, shared Git directory, and changed origin identities', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-identity-async-'));
    const options = { signal: new AbortController().signal, timeoutMs: 1_000 };
    try {
      expect(await resolveStableProjectIdAsync(root, options)).toBe(resolveStableProjectId(root));
      execFileSync('git', ['init', '-q', root]);
      expect(await resolveStableProjectIdAsync(root, options)).toBe(resolveStableProjectId(root));
      execFileSync('git', [
        '-C',
        root,
        'remote',
        'add',
        'origin',
        'https://example.invalid/first.git',
      ]);
      const first = await resolveStableProjectIdAsync(root, options);
      expect(first).toBe(resolveStableProjectId(root));
      execFileSync('git', [
        '-C',
        root,
        'remote',
        'set-url',
        'origin',
        'https://example.invalid/second.git',
      ]);
      expect(await resolveStableProjectIdAsync(root, options)).toBe(resolveStableProjectId(root));
      expect(await resolveStableProjectIdAsync(root, options)).not.toBe(first);
      await expect(
        resolveStableProjectIdAsync(root, { signal: AbortSignal.abort(), timeoutMs: 100 }),
      ).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
