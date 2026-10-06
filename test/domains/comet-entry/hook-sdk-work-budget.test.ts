import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inspectCometHook } from '../../../domains/comet-entry/hook-router.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { selectCurrentChange } from '../../../domains/comet-classic/classic-current-change.js';
import * as classicSdk from '../../../domains/comet-classic/classic-sdk-status.js';
import * as classicLayout from '../../../domains/comet-classic/classic-layout.js';
import * as nativeSdk from '../../../domains/comet-native/native-runtime-ownership.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { clearCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';

const write = (targets: string[]) => ({ intent: 'write' as const, toolName: 'Write', targets });

describe('Hook SDK request work budget', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-sdk-budget-'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Hook Test']);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'hook@example.test']);
    await fs.writeFile(path.join(root, 'README.md'), '# Project\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'initial'], { stdio: 'ignore' });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads one Classic SDK snapshot for owner, branch validation and multi-target guard', async () => {
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.mkdir(path.join(root, 'openspec', 'changes'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
    const initialized = await classicStateCommand(
      ['init', 'sdk-hook', 'hotfix', '--runtime', 'sdk', '--isolation', 'current'],
      { json: false, invocationCwd: root, projectRoot: root },
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    await selectCurrentChange(root, 'sdk-hook');
    const inspect = vi.spyOn(classicSdk, 'inspectClassicSdkRun');
    const layout = vi.spyOn(classicLayout, 'assertClassicLayoutWritable');
    for (let count = 1; count <= 2; count += 1) {
      await expect(
        runWithHookReadCache(() =>
          inspectCometHook(root, write(['README.md', 'openspec/changes/sdk-hook/proposal.md'])),
        ),
      ).resolves.toMatchObject({ allowed: true, phase: 'open' });
      expect(inspect).toHaveBeenCalledTimes(count);
      expect(layout).toHaveBeenCalledTimes(count);
    }
    await expect(
      runWithHookReadCache(() =>
        inspectCometHook(root, write(['openspec/changes/archive/2026-10-06-sdk-hook/README.md'])),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('shares Native SDK discovery with an inferred selected guard, then refreshes the next request', async () => {
    const initialized = await runNativeCli([
      'new',
      'sdk-hook',
      '--runtime',
      'sdk',
      '--project-root',
      root,
      '--json',
    ]);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    await clearCometCurrentSelection(root);
    const inspect = vi.spyOn(nativeSdk, 'inspectNativeSdkRun');
    for (let count = 1; count <= 2; count += 1) {
      await expect(
        runWithHookReadCache(() => inspectCometHook(root, write(['README.md']))),
      ).resolves.toMatchObject({ allowed: true, phase: 'shape' });
      expect(inspect).toHaveBeenCalledTimes(count);
    }
  });
});
