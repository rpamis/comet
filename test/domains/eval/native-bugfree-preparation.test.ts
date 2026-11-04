import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import {
  assertFrozenBugfreeFiles,
  checkFrozenBugfreeProject,
  assembleFrozenBugfreeTasks,
  frozenBugfreeMetrics,
  scoreFrozenBugfreeVerdict,
  type FrozenBugfreeDataset,
} from '../../helpers/native-bugfree-benchmark.js';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import { prepareFrozenSupervisorCandidate } from '../../helpers/native-bugfree-supervisor.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const read = async () =>
  JSON.parse(
    await fs.readFile('test/fixtures/native-bugfree-eval/frozen.json', 'utf8'),
  ) as FrozenBugfreeDataset;

it('prepares the same defective Supervisor parent in standard mode without weakening its checks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-frozen-standard-'));
  roots.push(root);
  const entry = (await read()).cases.find((entry) => entry.id === 'F24')!;
  const prepared = await prepareFrozenSupervisorCandidate(
    root,
    entry.files,
    entry.requirements,
    entry.baselineFiles,
    'standard',
  );
  expect(prepared.run.input).toMatchObject({ verifyMode: 'standard' });
  expect(prepared.context).toBeUndefined();
  expect(prepared.task.claimRequest.runId).toBe(prepared.run.runId);
  const checked = prepared.run.actions
    .filter((action) => action.stepId === 'verify.checks')
    .at(-1)!;
  expect(checked.status).toBe('succeeded');
  expect(checked.outcome?.output).toMatchObject({
    checks: [{ id: 'parent-syntax', status: 'passed' }],
  });
}, 180000);

it('replays every frozen candidate and reference repair using hidden deterministic truth', async () => {
  const dataset = await read();
  expect(dataset.cases).toHaveLength(24);
  expect(dataset.cases.filter((entry) => entry.expectedVerdict === 'pass')).toHaveLength(12);
  expect(dataset.flows).toHaveLength(6);
  for (const entry of dataset.cases) {
    assertFrozenBugfreeFiles(entry.files, entry.fileHashes);
    if (entry.baselineFiles)
      assertFrozenBugfreeFiles(entry.baselineFiles, entry.baselineFileHashes!);
    expect(createHash('sha256').update(entry.oracle).digest('hex')).toBe(entry.oracleSha256);
    expect(
      await checkFrozenBugfreeProject(
        entry.files,
        entry.oracle,
        entry.boundary,
        entry.requirements,
        entry.baselineFiles,
      ),
      entry.id,
    ).toBe(entry.expectedVerdict);
  }
  for (const entry of dataset.flows) {
    assertFrozenBugfreeFiles(entry.initialFiles, entry.initialFileHashes);
    assertFrozenBugfreeFiles(entry.referenceFiles, entry.referenceFileHashes);
    expect(createHash('sha256').update(entry.oracle).digest('hex')).toBe(entry.oracleSha256);
    expect(await checkFrozenBugfreeProject(entry.referenceFiles, entry.oracle), entry.id).toBe(
      'pass',
    );
    expect(await checkFrozenBugfreeProject(entry.initialFiles, entry.oracle), entry.id).toBe(
      entry.kind === 'first-pass' ? 'pass' : 'fail',
    );
  }
}, 300000);

it('collects all frozen workspaces through the public CLI offline without leaking hidden truth', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-bugfree-eval-prep-'));
  roots.push(root);
  const { skill, manifest, tasks } = await assembleFrozenBugfreeTasks(root, await read());
  expect(await fs.readFile(path.join(skill, 'comet-native/SKILL.md'), 'utf8')).toBe(
    await fs.readFile('assets/skills/comet-native/SKILL.md', 'utf8'),
  );
  expect(await fs.stat(path.join(skill, 'comet/reference/host-check.md'))).toBeTruthy();
  const output = execFileSync(
    process.execPath,
    [path.resolve('bin/comet.js'), 'eval', manifest, '--project', root, '--collect'],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        UV_OFFLINE: '1',
        UV_NO_SYNC: '1',
        HTTP_PROXY: 'http://127.0.0.1:9',
        HTTPS_PROXY: 'http://127.0.0.1:9',
      },
    },
  );
  for (const task of tasks) expect(output).toContain(task.name);
  expect(output).toContain('Tasks:');
  for (const task of tasks) {
    const files = await fs.readdir(path.join(skill, task.workspace));
    expect(files).not.toContain('frozen.json');
    expect(files).not.toContain('oracle.cjs');
  }
  expect(await fs.stat(path.join(root, '.comet/eval/generated')).catch(() => null)).toBeNull();
  expect(JSON.stringify(tasks)).not.toContain('expectedVerdict');
});

it('preserves missing telemetry and scores failures separately from completion', () => {
  expect(frozenBugfreeMetrics({}, {})).toMatchObject({
    inputTokens: null,
    totalTokens: null,
    verifyActiveMs: null,
    cost: null,
  });
  expect(
    frozenBugfreeMetrics(
      {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        reasoning_tokens: 3,
        cache_read_input_tokens: 2,
      },
      { verifyActiveMs: 200 },
    ),
  ).toMatchObject({
    totalTokens: 15,
    reasoningTokens: 3,
    cachedReadTokens: 2,
    verifyActiveMs: 200,
  });
  expect(scoreFrozenBugfreeVerdict('fail', { verdict: 'pass', completed: true })).toMatchObject({
    correct: false,
    falseNegative: true,
  });
  expect(scoreFrozenBugfreeVerdict('pass', { verdict: 'blocked', completed: true }).correct).toBe(
    false,
  );
  expect(scoreFrozenBugfreeVerdict('fail', { verdict: 'fail', completed: false }).correct).toBe(
    false,
  );
});
