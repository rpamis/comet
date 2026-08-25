import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePortablePath } from '../../platform/paths/portable-path.js';

describe('portable path resolution', () => {
  it('does not resolve a Windows drive path against the host working directory', () => {
    expect(resolvePortablePath('D:/project', '.worktrees', 'parent-integration')).toBe(
      path.join('D:/project', '.worktrees', 'parent-integration'),
    );
  });
});
