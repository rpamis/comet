import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeNewCommand } from '../../../domains/comet-native/native-new-command.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  NATIVE_PORTABLE_STATE_FILE,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import {
  parseNativePortableState,
  readNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

describe('Native portable child worktree discovery', () => {
  const repositories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      repositories.splice(0).map(async (root) => {
        const worktree = path.join(root, '.worktrees', 'child');
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: root,
            stdio: 'ignore',
          });
        } catch {
          // The child worktree may not have been created before the failure.
        }
        await fs.rm(root, { recursive: true, force: true });
      }),
    );
  });

  it('creates a child when the inherited parent Portable v4 state is large', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-child-overflow-'));
    repositories.push(root);
    git(root, ['init', '-b', 'integration']);
    git(root, ['config', 'user.email', 'native@example.test']);
    git(root, ['config', 'user.name', 'Native Test']);
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    await fs.writeFile(
      path.join(root, '.gitignore'),
      '.comet/runtime/\n.comet/current-change.json\n',
    );
    await fs.writeFile(path.join(root, 'README.md'), '# Native child overflow regression\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'seed repository']);

    expect((await nativeNewCommand(['parent'], root)).exitCode).toBe(0);
    const config = await readProjectConfig(root);
    const paths = await nativeProjectPaths(root, config!.native.artifact_root);
    const stateFile = path.join(
      nativePortableChangeDir(paths, 'parent'),
      NATIVE_PORTABLE_STATE_FILE,
    );
    const state = await readNativePortableState(stateFile);
    const oversized = parseNativePortableState({
      ...state,
      acceptance: [
        {
          id: 'A1',
          source: 'brief.md',
          text: 'x'.repeat(270 * 1024),
          result: 'pending',
          reason: null,
        },
      ],
    });
    await writeNativePortableState(stateFile, oversized, { containedRoot: paths.nativeRoot });
    expect((await fs.stat(stateFile)).size).toBeGreaterThan(256 * 1024);
    git(root, ['add', 'docs/comet/changes/parent/comet-state.yaml']);
    git(root, ['commit', '-m', 'persist oversized parent state']);

    const child = await nativeNewCommand(
      ['child', '--isolation', 'worktree', '--target-branch', 'integration'],
      root,
    );
    expect(child.exitCode).toBe(0);
  });
});
