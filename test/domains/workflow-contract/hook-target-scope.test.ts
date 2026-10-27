import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';

import { scopeCometHookTargets } from '../../../domains/workflow-contract/hook-target-scope.js';

describe('scopeCometHookTargets', () => {
  let root: string;
  let externalRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-scope-project-'));
    externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-scope-external-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(externalRoot, { recursive: true, force: true });
  });

  it('keeps missing project files in scope and relative escapes out of scope', async () => {
    await expect(
      scopeCometHookTargets(root, [
        'src/new-file.ts',
        '..secret.ts',
        path.join('...cache', 'note.md'),
        path.join('..', 'memory.md'),
      ]),
    ).resolves.toEqual({
      projectTargets: ['src/new-file.ts', '..secret.ts', path.join('...cache', 'note.md')],
      externalTargets: [path.join('..', 'memory.md')],
    });
  });

  it('does not attribute non-file resource addresses to a project', async () => {
    await expect(
      scopeCometHookTargets(root, [
        'agent:/Main',
        'proc:/worker/kill',
        'xd:/report_issue',
        'src/new-file.ts',
      ]),
    ).resolves.toEqual({ projectTargets: ['src/new-file.ts'], externalTargets: [] });
  });

  it('keeps canonical and Windows short-name project targets in scope', async () => {
    const shortRoot =
      process.platform === 'win32'
        ? execFileSync('cmd.exe', ['/d', '/c', 'for %I in (.) do @echo %~sI'], {
            cwd: root,
            encoding: 'utf8',
            windowsVerbatimArguments: true,
          }).trim()
        : root;
    const target = path.join(shortRoot, 'src', 'new-file.ts');
    await expect(scopeCometHookTargets(await fs.realpath(root), [target])).resolves.toEqual({
      projectTargets: [target],
      externalTargets: [],
    });
  });

  it('treats a project path redirected through a symlink or junction as external', async () => {
    const linkedDir = path.join(root, 'linked-memory');
    await fs.symlink(externalRoot, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      scopeCometHookTargets(root, [path.join('linked-memory', 'note.md')]),
    ).resolves.toEqual({
      projectTargets: [],
      externalTargets: [path.join('linked-memory', 'note.md')],
    });
  });
});
