import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evalCommand } from '../../../app/commands/eval.js';
import { vi } from 'vitest';
import {
  listBuiltinDatasets,
  inspectBuiltinDataset,
} from '../../../domains/eval/builtin-datasets.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
it('lists pinned datasets without preparing workloads', () => {
  expect(listBuiltinDatasets().map((item) => item.id)).toEqual(['workbuddy-code', 'skillsbench']);
  expect(listBuiltinDatasets()[1].revision).toHaveLength(40);
});
it('requires the WorkBuddy dataset contract and binds its content before a model can start', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workbuddy-contract-'));
  roots.push(root);
  const task = path.join(root, 'tasks/example');
  await fs.mkdir(path.join(task, 'environment'), { recursive: true });
  await fs.mkdir(path.join(task, 'tests'));
  await fs.mkdir(path.join(root, 'shared'));
  await fs.writeFile(path.join(task, 'task.toml'), '[agent]\ntimeout_sec=1800\n');
  await fs.writeFile(path.join(task, 'instruction.md'), 'Fix the bug.');
  await fs.writeFile(
    path.join(task, 'environment/Dockerfile'),
    'FROM python:3.12\nWORKDIR /workspace',
  );
  await fs.writeFile(path.join(task, 'tests/verifier.toml'), 'checks=[]\n');
  const options = { dataset: 'workbuddy-code', datasetRoot: root, task: 'example' };
  await expect(inspectBuiltinDataset(options)).rejects.toThrow('dataset.toml');
  await fs.writeFile(path.join(root, 'dataset.toml'), '[dataset]\nid="example"\nversion="1.0"\n');
  const first = await inspectBuiltinDataset(options);
  expect(first.datasetConfigHash).toMatch(/^sha256:/u);
  await fs.appendFile(path.join(root, 'dataset.toml'), '\n# changed scoring contract\n');
  const changed = await inspectBuiltinDataset(options);
  expect(changed.datasetConfigHash).not.toBe(first.datasetConfigHash);
  expect(changed.contentHash).not.toBe(first.contentHash);
});
it('preserves SkillsBench instructions, fractional rewards and isolated verifier identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dataset-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'tasks/example/environment'), { recursive: true });
  await fs.mkdir(path.join(root, 'tasks/example/verifier'));
  await fs.writeFile(
    path.join(root, 'tasks/example/task.md'),
    '---\nname: example\nagent:\n  timeout_sec: 900\nenvironment:\n  workdir: /app\n---\nWrite {literal} JSON.',
  );
  await fs.writeFile(
    path.join(root, 'tasks/example/environment/Dockerfile'),
    'FROM python:3.12\nWORKDIR /app\n',
  );
  await fs.writeFile(
    path.join(root, 'tasks/example/verifier/test.sh'),
    'echo 0.75 > /logs/verifier/reward.txt',
  );
  const plan = await inspectBuiltinDataset({
    dataset: 'skillsbench',
    datasetRoot: root,
    task: 'example',
  });
  expect(plan.tasks[0].instruction).toBe('Write {literal} JSON.');
  expect(plan.tasks[0].workdir).toBe('/app');
  expect(plan.tasks[0].contentHash).toMatch(/^sha256:/);
  const goal = await inspectBuiltinDataset({
    dataset: 'skillsbench',
    datasetRoot: root,
    task: 'example',
    datasetTreatment: 'goal',
  });
  expect(goal.treatment).toBe('CLAUDE_CODE_GOAL');
  expect(goal.contentHash).toBe(plan.contentHash);
  expect(goal.tasks).toEqual(plan.tasks);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(
      await evalCommand(undefined, {
        dataset: 'skillsbench',
        datasetRoot: root,
        task: 'example',
        collect: true,
      }),
    ).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0]).treatment).toBe('COMET_NATIVE_SDK_CURRENT');
    expect(
      await evalCommand(undefined, {
        dataset: 'skillsbench',
        datasetRoot: root,
        task: 'example',
        datasetTreatment: 'goal',
        collect: true,
      }),
    ).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0]).treatment).toBe('CLAUDE_CODE_GOAL');
    await expect(
      evalCommand(undefined, {
        dataset: 'skillsbench',
        datasetRoot: root,
        datasetTreatment: 'goal',
        agent: 'codex',
        collect: true,
      }),
    ).rejects.toThrow(/Claude Code/);
    expect(await fs.readdir(root)).toEqual(['tasks']);
  } finally {
    log.mockRestore();
  }
  const previous = plan.contentHash;
  await fs.appendFile(path.join(root, 'tasks/example/verifier/test.sh'), '\nexit 1');
  expect(
    (await inspectBuiltinDataset({ dataset: 'skillsbench', datasetRoot: root, task: 'example' }))
      .contentHash,
  ).not.toBe(previous);
  await expect(
    inspectBuiltinDataset({ dataset: 'skillsbench', datasetRoot: root, task: '../escape' }),
  ).rejects.toThrow();
});
