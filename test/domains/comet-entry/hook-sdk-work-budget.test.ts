import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCometHookRouterGuard } from '../../../domains/comet-entry/hook-router-guard-entry.js';
import {
  inspectCometHook,
  inspectCometRuntimeWriteTargets,
} from '../../../domains/comet-entry/hook-router.js';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { selectCurrentChange } from '../../../domains/comet-classic/classic-current-change.js';
import * as targetScope from '../../../domains/workflow-contract/hook-target-scope.js';
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

  it('shares Runtime target checks only for the same project and relative root', async () => {
    const other = path.join(root, 'other-worktree');
    await fs.mkdir(other);
    const checks = vi.spyOn(targetScope, 'isCometHookTargetWithin');
    await runWithHookReadCache(async () => {
      const request = write(['.comet/runtime/state.json']);
      expect(await inspectCometRuntimeWriteTargets(root, request, other)).toBeNull();
      const reads = checks.mock.calls.length;
      expect(reads).toBeGreaterThan(0);
      expect(await inspectCometRuntimeWriteTargets(root, request, other)).toBeNull();
      expect(checks).toHaveBeenCalledTimes(reads);
      expect(await inspectCometRuntimeWriteTargets(root, request, root)).toMatchObject({
        allowed: false,
      });
      expect(checks.mock.calls.length).toBeGreaterThan(reads);
      expect(await inspectCometRuntimeWriteTargets(other, request, other)).toMatchObject({
        allowed: false,
      });
    });
  });

  it('reads selection once per full Hook request and refreshes after replacement', async () => {
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
    const selection = path.join(root, '.comet/current-change.json');
    const counts = { open: 0, lstat: 0, realpath: 0 };
    for (const operation of ['open', 'lstat', 'realpath'] as const) {
      const original = fs[operation].bind(fs);
      vi.spyOn(fs, operation).mockImplementation(((...args: unknown[]) => {
        if (String(args[0]) === selection) counts[operation]++;
        return (original as (...args: unknown[]) => unknown)(...args);
      }) as never);
    }
    const request = { ...write(['README.md']), cwd: root };
    await expect(
      runCometHookRouterGuard({ platformId: 'codex', projectRoot: root }, request),
    ).resolves.toMatchObject({ allowed: true, phase: 'shape' });
    expect(counts).toEqual({ open: 1, lstat: 3, realpath: 3 });
    await fs.writeFile(selection, '{invalid');
    await expect(
      runCometHookRouterGuard({ platformId: 'codex', projectRoot: root }, request),
    ).rejects.toThrow('invalid JSON');
    expect(counts).toEqual({ open: 2, lstat: 6, realpath: 6 });
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
