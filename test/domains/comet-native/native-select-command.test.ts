import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inspectDiscoveredNativeStatus = vi.hoisted(() => vi.fn());

vi.mock('../../../domains/comet-native/native-status-discovery.js', () => ({
  inspectDiscoveredNativeStatus,
}));

import { nativeSelectCommand } from '../../../domains/comet-native/native-select-command.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';

describe('Native select command branches', () => {
  let projectRoot: string;
  let worktreeRoot: string;
  const roots: string[] = [];

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-select-primary-'));
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-select-worktree-'));
    roots.push(projectRoot, worktreeRoot);
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    await writeProjectConfig(worktreeRoot, defaultProjectConfig('docs'));
    execFileSync('git', ['init', '--quiet'], { cwd: projectRoot, stdio: 'ignore' });
    inspectDiscoveredNativeStatus.mockReset();
  });

  async function seedChange(root: string, name = 'demo') {
    const paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name, language: 'en' });
    return paths;
  }

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  it('returns the full discovered status projection and routes into the owning workspace', async () => {
    await seedChange(worktreeRoot);
    inspectDiscoveredNativeStatus.mockImplementation(async (options) => {
      options.onSelectedRoot?.(worktreeRoot);
      return {
        schema: 'comet.native.status.v2',
        name: 'demo',
        phase: 'build',
        status: 'active',
        stateVersion: 7,
        workspace: { projectRoot: worktreeRoot },
        continuation: { schema: 'comet.native.continuation.v2', action: 'advance-children' },
      };
    });

    const result = await nativeSelectCommand(['demo'], projectRoot);
    expect(result).toMatchObject({
      command: 'select',
      exitCode: 0,
      executionCwd: worktreeRoot,
      data: {
        selected: 'demo',
        phase: 'build',
        stateVersion: 7,
        workspace: { projectRoot: worktreeRoot },
        continuation: { action: 'advance-children' },
      },
    });
    const selection = await readCometCurrentSelection(worktreeRoot);
    expect(selection).toMatchObject({
      status: 'selected',
      selection: { workflow: 'native', change: 'demo' },
    });
  });

  it('keeps the invoking root when discovery does not route elsewhere', async () => {
    await seedChange(projectRoot);
    inspectDiscoveredNativeStatus.mockImplementation(async () => ({
      schema: 'comet.native.status.v2',
      name: 'demo',
      phase: 'build',
      continuation: { schema: 'comet.native.continuation.v2', action: 'builder-handoff' },
    }));

    await expect(nativeSelectCommand(['demo'], projectRoot)).resolves.toMatchObject({
      exitCode: 0,
      data: { selected: 'demo', continuation: { action: 'builder-handoff' } },
    });
    const selection = await readCometCurrentSelection(projectRoot);
    expect(selection).toMatchObject({
      status: 'selected',
      selection: { workflow: 'native', change: 'demo' },
    });
  });
});
