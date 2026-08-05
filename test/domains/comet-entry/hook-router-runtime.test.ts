import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';

const router = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs');

describe('packaged Hook Router worktree isolation', () => {
  let primary: string;
  let secondary: string;

  beforeEach(async () => {
    primary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-router-runtime-primary-'));
    secondary = path.join(
      os.tmpdir(),
      `comet-router-runtime-secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const git = (...args: string[]) =>
      spawnSync('git', ['-C', primary, ...args], { encoding: 'utf8', timeout: 20_000 });
    expect(git('init', '-b', 'master').status).toBe(0);
    expect(git('config', 'user.email', 'router@example.com').status).toBe(0);
    expect(git('config', 'user.name', 'Router Test').status).toBe(0);
    await fs.writeFile(path.join(primary, 'README.md'), '# worktree\n');
    expect(git('add', 'README.md').status).toBe(0);
    expect(git('commit', '-m', 'initial').status).toBe(0);
    expect(git('worktree', 'add', secondary, '-b', 'feature/router-runtime').status).toBe(0);
  });

  afterEach(async () => {
    spawnSync('git', ['-C', primary, 'worktree', 'remove', '--force', secondary], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    await fs.rm(secondary, { recursive: true, force: true });
    await fs.rm(primary, { recursive: true, force: true });
  });

  async function configureChange(
    projectRoot: string,
    name: string,
    phase: 'shape' | 'build',
  ): Promise<void> {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    const change = await createNativeChange({
      paths,
      name,
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    change.phase = phase;
    await writeNativeChange(paths, change);
    await selectNativeChange(paths, name);
  }

  it('uses the linked worktree state even when the installed command still names the primary root', async () => {
    await configureChange(primary, 'primary-shape', 'shape');
    await configureChange(secondary, 'secondary-build', 'build');
    const payload = JSON.stringify({
      tool_name: 'Write',
      cwd: secondary,
      tool_input: { file_path: 'src/app.ts' },
    });

    const linked = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      { cwd: primary, input: payload, encoding: 'utf8', timeout: 20_000 },
    );
    const primaryRequest = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      {
        cwd: primary,
        input: JSON.stringify({
          tool_name: 'Write',
          cwd: primary,
          tool_input: { file_path: 'src/app.ts' },
        }),
        encoding: 'utf8',
        timeout: 20_000,
      },
    );

    expect(linked.status, linked.stderr).toBe(0);
    expect(primaryRequest.status).toBe(2);
    expect(primaryRequest.stderr).toContain('primary-shape');
  });

  it('enforces Native Shape for raw Codex apply_patch input', async () => {
    await configureChange(primary, 'raw-patch-shape', 'shape');
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/app.ts',
      '@@',
      '-old',
      '+new',
      '*** End Patch',
    ].join('\n');

    const result = spawnSync(
      process.execPath,
      [router, '--platform', 'codex', '--project-root', primary],
      { cwd: primary, input: patch, encoding: 'utf8', timeout: 20_000 },
    );

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('raw-patch-shape');
    expect(result.stderr).toContain('only allowed in build');
  });
});
