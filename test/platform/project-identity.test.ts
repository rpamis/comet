import { describe, expect, it } from 'vitest';

import {
  resolveProjectName,
  resolveProjectIdentity,
  resolveStableProjectId,
  stableProjectId,
} from '../../platform/paths/project-identity.js';

describe('project identity', () => {
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
});
