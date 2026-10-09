import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import { classicSdkNextAction } from '../../../domains/comet-classic/classic-sdk-status.js';
import { withCometRuntimeMetrics } from '../../../platform/process/runtime-metrics.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function preparedChange(
  options: { git?: boolean; profile?: string; isolation?: string } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-sdk-read-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  if (options.git) execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const created = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
    runClassicCli([
      'state',
      'init',
      'demo',
      options.profile ?? 'tweak',
      '--runtime',
      'sdk',
      ...(options.isolation ? ['--isolation', options.isolation] : []),
      '--json',
    ]),
  );
  expect(created.exitCode, created.stderr).toBe(0);
  return {
    root,
    store: createClassicSdkStateStore(root),
    stateFile: path.join(root, 'openspec/changes/demo/.comet.yaml'),
    markerFile: path.join(root, '.comet/runtime/state-projections/classic/demo.json'),
  };
}

describe('Classic SDK read work budgets', () => {
  it('reads multiple fields in one projection while preserving single-field output', async () => {
    const { root, stateFile } = await preparedChange();
    const cli = (fields: string[]) =>
      runClassicCli(['state', 'get', 'demo', ...fields, '--json'], undefined, {
        projectRoot: root,
        invocationCwd: root,
      });
    const reads = vi.spyOn(fs, 'open');
    const fields = ['phase', 'workflow', 'build_mode', 'tdd_mode', 'review_mode', 'plan'];
    const result = await cli(fields);
    expect(result.exitCode, result.stdout).toBe(0);
    const output = JSON.parse(result.stdout!);
    expect(output.data).toEqual({
      change: 'demo',
      fields: {
        phase: 'open',
        workflow: 'tweak',
        build_mode: 'direct',
        tdd_mode: 'direct',
        review_mode: 'off',
        plan: 'null',
      },
    });
    expect(output.stdout).toBe(
      'phase=open\nworkflow=tweak\nbuild_mode=direct\ntdd_mode=direct\nreview_mode=off\nplan=null\n',
    );
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(JSON.parse((await cli(['phase'])).stdout!).stdout).toBe('open\n');
    expect((await cli(['phase', 'phase'])).exitCode).toBe(1);
    expect((await cli(['phase', '--unknown'])).exitCode).toBe(1);
  });

  it('returns SDK entry and recovery continuation from the same inspected Run', async () => {
    const { root, stateFile, store } = await preparedChange();
    const before = (await store.read('demo'))!;
    const expected = {
      kind: 'action',
      stepId: 'tweak.open',
      actionId: before.actions[0].id,
      attempt: before.actions[0].attempt,
      inputHash: before.actions[0].inputHash,
      ref: before.actions[0].ref,
    };
    const reads = vi.spyOn(fs, 'open');
    for (const suffix of [[], ['--recover']]) {
      reads.mockClear();
      const result = await runClassicCli(
        ['state', 'check', 'demo', 'open', ...suffix, '--json'],
        undefined,
        { projectRoot: root, invocationCwd: root },
      );
      expect(result.exitCode, result.stdout).toBe(0);
      expect(JSON.parse(result.stdout!).data).toMatchObject({
        run: { id: before.runId, revision: before.revision },
        nextAction: expected,
      });
      expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    }
  });

  it('prioritizes reconciliation over another pending Action without mutating the Run', async () => {
    const { store } = await preparedChange();
    const run = (await store.read('demo'))!;
    const pending = run.actions[0];
    const unresolved = { ...pending, id: 'interrupted', status: 'unknown' as const };
    const observed = { ...run, actions: [pending, unresolved] };
    expect(classicSdkNextAction(observed)).toMatchObject({
      kind: 'reconcile',
      actionId: 'interrupted',
    });
    expect(observed.actions).toEqual([pending, unresolved]);
    expect(classicSdkNextAction({ ...observed, status: 'completed' })).toEqual({ kind: 'done' });
  });

  it('reads stable state once without rewriting either projection', async () => {
    const { store, stateFile, markerFile } = await preparedChange();
    const before = await store.read('demo');
    const timestamp = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(stateFile, timestamp, timestamp);
    await fs.utimes(markerFile, timestamp, timestamp);
    const reads = vi.spyOn(fs, 'open');
    const renames = vi.spyOn(fs, 'rename');
    expect(await store.read('demo')).toEqual(before);
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
    expect((await fs.stat(stateFile)).mtimeMs).toBe(timestamp.getTime());
    expect((await fs.stat(markerFile)).mtimeMs).toBe(timestamp.getTime());
  });

  it('does not probe Git while projecting a Run that has no branch binding', async () => {
    const { store } = await preparedChange({ profile: 'full' });
    const { result, metrics } = await withCometRuntimeMetrics(() => store.read('demo'));
    expect(result?.state).toMatchObject({ isolation: null, boundBranch: null });
    expect(metrics.gitCommands).toBe(0);
  });

  it('skips projection-only branch probes while entry checks still reject branch drift', async () => {
    const { root, store, stateFile } = await preparedChange({ git: true, isolation: 'current' });
    const before = (await store.read('demo'))!;
    expect(before.state).toMatchObject({ isolation: 'current', boundBranch: 'main' });
    const stable = await withCometRuntimeMetrics(() => store.read('demo'));
    expect(stable.result).toEqual(before);
    expect(stable.metrics.gitCommands).toBe(0);

    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: root });
    const drifted = await withCometRuntimeMetrics(() => store.read('demo'));
    expect(drifted.result).toEqual(before);
    expect(drifted.metrics.gitCommands).toBe(0);
    const reads = vi.spyOn(fs, 'open');
    const checked = await withClassicCommandContext(
      { projectRoot: root, invocationCwd: root },
      () => runClassicCli(['state', 'check', 'demo', 'open', '--json']),
    );
    expect(checked.exitCode).toBe(1);
    expect(JSON.stringify(JSON.parse(checked.stdout!).data)).toMatch(
      /bound to branch.*main.*other/u,
    );
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(await store.read('demo')).toEqual(before);
  });

  it('imports user settings once, advances its marker, and still rejects Runtime-owned edits', async () => {
    const { store, stateFile, markerFile } = await preparedChange();
    const before = (await store.read('demo'))!;
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace(/^language: en$/mu, 'language: zh-CN'));
    const renames = vi.spyOn(fs, 'rename');
    const imported = (await store.read('demo'))!;
    expect(imported.revision).toBe(before.revision + 1);
    expect(imported.state).toMatchObject({ language: 'zh-CN' });
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      1,
    );
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(imported.revision);
    renames.mockClear();
    expect((await store.read('demo'))?.revision).toBe(imported.revision);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
    await fs.writeFile(
      stateFile,
      (await fs.readFile(stateFile, 'utf8')).replace(/^phase: .*$/mu, 'phase: archive'),
    );
    await expect(store.read('demo')).rejects.toThrow(/Runtime-owned field/u);
  });

  it('rejects a stale CAS and repairs a missing marker without changing revision', async () => {
    const { store, markerFile } = await preparedChange();
    const before = (await store.read('demo'))!;
    expect(
      await store.compareAndSwap('demo', before.revision + 1, {
        ...before,
        revision: before.revision + 2,
      }),
    ).toBe(false);
    await fs.rm(markerFile);
    expect((await store.read('demo'))?.revision).toBe(before.revision);
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(before.revision);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an equal-content projection marker replaced by a symlink',
    async () => {
      const { root, store, markerFile } = await preparedChange();
      await store.read('demo');
      const target = path.join(root, 'copied-marker.json');
      const source = await fs.readFile(markerFile, 'utf8');
      await fs.writeFile(target, source);
      await fs.rm(markerFile);
      await fs.symlink(target, markerFile);
      await expect(store.read('demo')).rejects.toThrow(/symbolic link/u);
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    },
  );
});
