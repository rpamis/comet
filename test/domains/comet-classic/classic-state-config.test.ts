import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import {
  ensureClassicRuntimeRun,
  reconcileClassicRuntimeRun,
} from '../../../domains/comet-classic/classic-runtime-run.js';
import { readClassicState } from '../../../domains/comet-classic/classic-store.js';

describe('Classic atomic configuration', () => {
  let root: string;
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(args),
    );
  const stateFile = () => path.join(root, 'openspec/changes/demo/.comet.yaml');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-config-'));
    await prepareClassicLegacyProject(root);
    expect((await cli('state', 'init', 'demo', 'full')).exitCode).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('updates related decisions together and returns the committed values', async () => {
    const result = await cli(
      'state',
      'set',
      'demo',
      'build_mode',
      'executing-plans',
      'tdd_mode',
      'direct',
      'review_mode',
      'standard',
      '--json',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const expected = { build_mode: 'executing-plans', tdd_mode: 'direct', review_mode: 'standard' };
    expect(parse(await fs.readFile(stateFile(), 'utf8'))).toMatchObject(expected);
    expect(JSON.parse(result.stdout!).data).toMatchObject({ change: 'demo', updated: expected });
  });

  it('sets autonomous explicitly in an atomic configuration without changing defaults', async () => {
    expect(parse(await fs.readFile(stateFile(), 'utf8')).build_mode).toBeNull();
    const result = await cli(
      'state',
      'set',
      'demo',
      'build_mode',
      'autonomous',
      'tdd_mode',
      'direct',
      'review_mode',
      'standard',
      '--json',
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parse(await fs.readFile(stateFile(), 'utf8'))).toMatchObject({
      build_mode: 'autonomous',
      tdd_mode: 'direct',
      review_mode: 'standard',
    });
    expect((await readClassicState(path.dirname(stateFile()))).classic).toMatchObject({
      buildMode: 'autonomous',
      directOverride: null,
    });
  });

  it.each([
    ['review_mode', 'invalid'],
    ['check_epoch', '10'],
    ['phase', 'build'],
    ['plan', '../outside.md'],
    ['build_mode', 'direct'],
    ['tdd_mode'],
  ])('rejects the entire update for invalid trailing arguments %j', async (...trailing) => {
    const before = await fs.readFile(stateFile(), 'utf8');
    const result = await cli('state', 'set', 'demo', 'build_mode', 'executing-plans', ...trailing);
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile(stateFile(), 'utf8')).toBe(before);
  });

  it('serializes concurrent updates without dropping unrelated fields', async () => {
    const results = await Promise.all([
      cli('state', 'set', 'demo', 'build_mode', 'executing-plans', 'tdd_mode', 'direct'),
      cli('state', 'set', 'demo', 'review_mode', 'thorough', 'verify_mode', 'full'),
    ]);
    for (const result of results) expect(result.exitCode, result.stderr).toBe(0);
    expect(parse(await fs.readFile(stateFile(), 'utf8'))).toMatchObject({
      build_mode: 'executing-plans',
      tdd_mode: 'direct',
      review_mode: 'thorough',
      verify_mode: 'full',
    });
  });

  it('returns fresh structured entry configuration after a configuration change', async () => {
    const first = await cli('state', 'check', 'demo', 'open', '--json');
    expect(first.exitCode).toBe(0);
    expect(JSON.parse(first.stdout!).data).toMatchObject({
      change: 'demo',
      phase: 'open',
      requestedPhase: 'open',
      configuration: { buildMode: null },
      checks: { blocked: false },
    });
    expect((await cli('state', 'set', 'demo', 'build_mode', 'executing-plans')).exitCode).toBe(0);
    for (const args of [
      ['check', 'demo', 'open'],
      ['next', 'demo'],
    ]) {
      const result = await cli('state', ...args, '--json');
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout!).data.configuration.buildMode).toBe('executing-plans');
    }
  });

  it('does not reuse a stale configuration passed to evidence reconciliation', async () => {
    const directory = path.dirname(stateFile());
    await ensureClassicRuntimeRun(directory);
    const stale = await readClassicState(directory);
    expect((await cli('state', 'set', 'demo', 'review_mode', 'thorough')).exitCode).toBe(0);
    const result = await reconcileClassicRuntimeRun(directory, stale);
    expect(result.context.classic.reviewMode).toBe('thorough');
    expect((await readClassicState(directory)).classic?.reviewMode).toBe('thorough');
  });

  it('keeps scale advisory and preserves a previously selected verification depth', async () => {
    await cli('state', 'set', 'demo', 'verify_mode', 'full');
    const before = await fs.readFile(stateFile(), 'utf8');
    const result = await cli('state', 'scale', 'demo', '--json');
    expect(result.exitCode, result.stdout).toBe(0);
    expect(JSON.parse(result.stdout!).data).toMatchObject({
      recommendation: 'light',
      selected: 'full',
    });
    expect(await fs.readFile(stateFile(), 'utf8')).toBe(before);
  });

  it('lists stable tasks and serializes completion without losing another task update', async () => {
    const taskFile = path.join(root, 'openspec/changes/demo/tasks.md');
    await fs.writeFile(taskFile, '- [ ] one\n- [ ] two\n');
    const assigned = await cli('state', 'tasks', 'demo', '--assign-ids', '--json');
    expect(assigned.exitCode, assigned.stdout).toBe(0);
    const { tasks, revision } = JSON.parse(assigned.stdout!).data;
    const premature = await cli(
      'state',
      'task-complete',
      'demo',
      tasks[0].id,
      '--expect',
      revision,
    );
    expect(premature.exitCode).not.toBe(0);
    await fs.writeFile(
      stateFile(),
      (await fs.readFile(stateFile(), 'utf8')).replace('phase: open', 'phase: build'),
    );
    const completed = await Promise.all(
      tasks.map((task: { id: string }) =>
        cli('state', 'task-complete', 'demo', task.id, '--expect', revision, '--json'),
      ),
    );
    for (const result of completed) expect(result.exitCode, result.stdout).toBe(0);
    const listing = JSON.parse((await cli('state', 'tasks', 'demo', '--json')).stdout!).data;
    expect(listing.progress).toEqual({ total: 2, completed: 2 });
    expect(listing.revision).toBe(revision);
    const renamed = (await fs.readFile(taskFile, 'utf8')).replace('one', 'changed');
    await fs.writeFile(taskFile, renamed);
    const stale = await cli('state', 'task-complete', 'demo', tasks[0].id, '--expect', revision);
    expect(stale.exitCode).not.toBe(0);
    expect(await fs.readFile(taskFile, 'utf8')).toBe(renamed);
  });
});
