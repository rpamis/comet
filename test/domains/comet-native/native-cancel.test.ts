import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultProjectConfig } from '../../../domains/comet-native/native-config.js';
import { createNativeSdkChange } from '../../../domains/comet-native/native-sdk-create.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { runNativeCliDetailed } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import { writeCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';

describe('Native cancel command', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-cancel-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function createChange(name: string) {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await createNativeSdkChange({
      paths,
      name,
      language: 'en',
      initialProjectConfig: defaultProjectConfig('docs'),
      workspaceBinding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });
    return paths;
  }

  async function runCli(args: string[]) {
    const result = await runNativeCliDetailed(args, { invocationCwd: projectRoot });
    return result.dispatch;
  }

  it('cancels an SDK change, keeps its code, and clears the current selection', async () => {
    const paths = await createChange('drop-me');
    const briefPath = path.join(paths.changesDir, 'drop-me', 'brief.md');
    await fs.writeFile(briefPath, '# Brief\n\nKept implementation note.\n', 'utf8');
    await writeCometCurrentSelection(projectRoot, {
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'drop-me',
      branch: null,
    });

    const result = await runCli(['cancel', 'drop-me', '--reason', 'shipped elsewhere', '--json']);
    expect(result.command).toBe('cancel');
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      change: 'drop-me',
      cancelled: true,
      status: 'cancelled',
      reason: 'shipped elsewhere',
      codeRetained: true,
      workspaceRetained: true,
    });

    const { run } = await inspectNativeSdkRun(projectRoot, 'drop-me');
    expect(run.status).toBe('cancelled');
    expect(run.reason).toBe('shipped elsewhere');
    await expect(fs.readFile(briefPath, 'utf8')).resolves.toContain('Kept implementation note.');

    const selectionFile = path.join(projectRoot, '.comet', 'current-change.json');
    const selectionSource = await fs.readFile(selectionFile, 'utf8').catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (selectionSource !== null) {
      expect(JSON.parse(selectionSource).change).not.toBe('drop-me');
    }
  });

  it('is idempotent: cancelling an already cancelled change reports the retained state', async () => {
    await createChange('twice');
    await runCli(['cancel', 'twice', '--json']);
    const second = await runCli(['cancel', 'twice', '--json']);
    expect(second.exitCode).toBe(0);
    expect(second.data).toMatchObject({
      change: 'twice',
      alreadyCancelled: true,
      cancelled: true,
      codeRetained: true,
    });
  });

  it('dry-run reports the plan without changing the Run', async () => {
    await createChange('plan-only');
    const before = (await inspectNativeSdkRun(projectRoot, 'plan-only')).run;

    const result = await runCli(['cancel', 'plan-only', '--dry-run', '--json']);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      change: 'plan-only',
      dryRun: true,
      willCancel: true,
      retained: { code: true, commits: true, workspace: true, branches: true },
    });

    const after = (await inspectNativeSdkRun(projectRoot, 'plan-only')).run;
    expect(after.status).toBe(before.status);
    expect(after.revision).toBe(before.revision);
  });

  it('removes a quiet cancelled change from the discovered status page', async () => {
    await createChange('listed');
    await runCli(['cancel', 'listed', '--json']);

    const status = await runCli(['status', '--json']);
    expect(status.exitCode).toBe(0);
    const page = status.data as { items?: Array<{ name: string }>; total?: number };
    expect(page.items?.some((item) => item.name === 'listed')).toBe(false);
    expect(page.total).toBe(0);

    const named = await runCli(['status', 'listed', '--json']);
    expect(named.exitCode).toBe(0);
    expect(named.data).toMatchObject({ name: 'listed', status: 'cancelled' });
  });

  it('rejects unknown and non-SDK change names with an actionable error', async () => {
    const result = await runCli(['cancel', 'ghost', '--json']);
    expect(result.exitCode).not.toBe(0);
    expect(result.error?.message).toContain('not owned by an SDK Run');
  });

  it('requires a change name', async () => {
    const result = await runCli(['cancel', '--json']);
    expect(result.exitCode).toBe(64);
    expect(result.error?.message).toContain('cancel requires a change name');
  });
});
