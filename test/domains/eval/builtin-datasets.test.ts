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
  await fs.writeFile(
    path.join(task, 'task.toml'),
    '[agent]\ntimeout_sec=1800\n[environment]\nmcp_servers=[]\n[verifier]\nimport_path="workbuddy_bench.judge:CompositeVerifier"\n',
  );
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
  expect(first.tasks[0].supported).toBe(true);
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

async function datasetFixture(metadata: string, instruction = 'Write /outputs/result.json.') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-dataset-policy-'));
  roots.push(root);
  const task = path.join(root, 'tasks/example');
  await fs.mkdir(path.join(task, 'environment'), { recursive: true });
  await fs.mkdir(path.join(task, 'verifier'));
  await fs.writeFile(path.join(task, 'task.md'), `---\n${metadata}\n---\n${instruction}`);
  await fs.writeFile(
    path.join(task, 'environment/Dockerfile'),
    'FROM python:3.12\nWORKDIR /root\n',
  );
  await fs.writeFile(path.join(task, 'verifier/test.sh'), 'exit 0\n');
  return root;
}

it('binds finite per-task budgets, resources and candidate directories before execution', async () => {
  const root = await datasetFixture(
    'agent:\n  timeout_sec: 900\nenvironment:\n  cpus: 8\n  memory_mb: 4096\n  storage_mb: 10240\n  network_mode: public\n  build_timeout_sec: 600\nverifier:\n  env:\n    REPO_ID: example/repo\n  hardening:\n    cleanup_conftests: true',
  );
  const plan = await inspectBuiltinDataset({ dataset: 'skillsbench', datasetRoot: root });
  expect(plan.tasks[0].execution).toMatchObject({
    timeoutSeconds: 3600,
    buildTimeoutSeconds: 1800,
    cpus: 8,
    memoryMb: 4096,
    storageMb: 10240,
    networkMode: 'public',
    verifier: { env: { REPO_ID: 'example/repo' }, cleanupConftests: true },
  });
  expect(plan.tasks[0].execution.candidateDirectories).toContain('/outputs');
  expect(plan.tasks[0].instructionHash).toMatch(/^sha256:/);
});

it('rejects unsupported dataset execution conditions rather than silently dropping them', async () => {
  const root = await datasetFixture('environment:\n  network_mode: no-network');
  const plan = await inspectBuiltinDataset({ dataset: 'skillsbench', datasetRoot: root });
  expect(plan.tasks[0].supported).toBe(false);
  expect(plan.tasks[0].reason).toMatch(/网络/);
});

it('binds Native verification mode in the collected plan without exposing it to Goal', async () => {
  const root = await datasetFixture('agent:\n  timeout_sec: 900');
  const options = { dataset: 'skillsbench', datasetRoot: root };
  const standard = await inspectBuiltinDataset(options);
  const bugfree = await inspectBuiltinDataset({ ...options, verifyMode: 'bugfree' });
  expect(standard.verifyMode).toBe('standard');
  expect(bugfree.verifyMode).toBe('bugfree');
  expect(bugfree.contentHash).not.toBe(standard.contentHash);
  expect(bugfree.comparisonHash).toBe(standard.comparisonHash);
  expect(bugfree.tasks).toEqual(standard.tasks);
  await expect(
    inspectBuiltinDataset({ ...options, datasetTreatment: 'goal', verifyMode: 'bugfree' }),
  ).rejects.toThrow('Goal');
});

it('checks WorkBuddy tests-only restrictions per treatment without changing the grader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workbuddy-scope-'));
  roots.push(root);
  const task = path.join(root, 'tasks/testing-hard-router_matching');
  await fs.mkdir(path.join(task, 'environment'), { recursive: true });
  await fs.mkdir(path.join(task, 'tests'));
  await fs.mkdir(path.join(root, 'shared'));
  await fs.writeFile(path.join(root, 'dataset.toml'), '[dataset]\nid="example"\n');
  await fs.writeFile(
    path.join(task, 'task.toml'),
    '[agent]\ntimeout_sec=1800\n[environment]\nmcp_servers=[]\n[verifier]\nimport_path="workbuddy_bench.judge:CompositeVerifier"\n',
  );
  await fs.writeFile(path.join(task, 'instruction.md'), 'Only change tests/.');
  await fs.writeFile(
    path.join(task, 'environment/Dockerfile'),
    'FROM python:3.12\nWORKDIR /workspace\n',
  );
  await fs.writeFile(path.join(task, 'tests/verifier.toml'), 'checks=[]\n');
  const options = { dataset: 'workbuddy-code', datasetRoot: root };
  expect((await inspectBuiltinDataset(options)).tasks[0]).toMatchObject({ supported: false });
  expect(
    (await inspectBuiltinDataset({ ...options, datasetTreatment: 'goal' })).tasks[0].supported,
  ).toBe(true);
  for (const id of [
    'testing-medium-format_errors',
    'testing-medium-option_resolution',
    'testing-medium-request_builder',
    'repo_understanding-hard-example',
  ]) {
    const directory = path.join(root, 'tasks', id);
    await fs.cp(task, directory, { recursive: true });
    if (id.startsWith('repo_understanding'))
      await fs.writeFile(
        path.join(directory, 'tests/verifier.toml'),
        'type="repo_understanding"\n',
      );
    expect((await inspectBuiltinDataset({ ...options, task: id })).tasks[0].supported).toBe(false);
    expect(
      (await inspectBuiltinDataset({ ...options, task: id, datasetTreatment: 'goal' })).tasks[0]
        .supported,
    ).toBe(true);
  }
});
