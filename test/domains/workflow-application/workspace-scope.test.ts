import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { assertApplicationSkillExecutionScope } from '../../../domains/workflow-application/skill-executor.js';
import { createScopeCycleApplication } from '../../helpers/workflow-application.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(shared = false, mixed = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workspace-scope-'));
  roots.push(root);
  const git = (argv: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...argv],
      { cwd: root, stdio: 'pipe' },
    );
  git(['init', '-b', 'main']);
  git(['commit', '--allow-empty', '-m', 'base']);
  const leftRoot = path.join(root, 'left');
  const rightRoot = path.join(root, 'right');
  git(['worktree', 'add', '-b', 'left', leftRoot]);
  git(['worktree', 'add', '-b', 'right', rightRoot]);
  const disk = await createScopeCycleApplication(root, false);
  disk.manifest.skills[0].adapter.inputSchema = {
    type: 'object',
    required: ['input', 'activation'],
    properties: {
      input: { type: 'object', required: ['topic'], properties: { topic: { type: 'string' } } },
      activation: {
        type: 'object',
        required: ['workspaceRoot'],
        properties: { workspaceRoot: { type: 'string' } },
      },
    },
  };
  for (const binding of disk.manifest.bindings) binding.workspaceFrom = 'activation.workspaceRoot';
  if (mixed) delete disk.manifest.bindings[0].workspaceFrom;
  if (shared) disk.manifest.skills[0].adapter.scope = [path.join(root, 'shared.txt')];
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const module = path.join(disk.packageRoot, 'application.mjs');
  let source = await fs.readFile(module, 'utf8');
  if (mixed) source = source.replace(',{"from":"repair","to":"fork"}', '');
  source = source.replace(
    'export function createApplication',
    "workflow.initialState = {}; workflow.stateSchema = {type:'object'}; workflow.transitionHandler = {id:'workspaces',version:'1'};\nexport function createApplication",
  );
  source = source.replace(
    "path.join(projectRoot, 'shared.txt')",
    shared
      ? "path.join(projectRoot, 'shared.txt')"
      : "path.join(action.input.activation.workspaceRoot, 'shared.txt')",
  );
  source = source.replace(
    'transitionHandlers: []',
    `transitionHandlers: [{id:'workspaces',version:'1',apply:({run,event}) => {
    if(event.stepId === 'fork') return {state:run.state,next:['left','right'].map(stepId => ({stepId,input:{
      workspaceRoot:run.input[stepId+'Root']}}))};
    const choice = event.kind === 'wait-resolved' ? event.choice : event.outcome?.status;
    return {state:run.state,next:workflow.transitions.filter(edge => edge.from === event.stepId && (!edge.on || edge.on === choice)).map(edge => edge.to)};
  }}]`,
  );
  await fs.writeFile(module, source);
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'workspaces',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Actual topic', leftRoot, rightRoot },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'tool-host',
  });
  const wait = run.waits[0];
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'user-approval',
    choice: 'approved',
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'tool-host',
  });
  return { root, disk, loaded, runtime, run, leftRoot, rightRoot };
}
it('writes independently in two actual Git worktrees after the same approval', async () => {
  const f = await fixture();
  const [left, right] = f.run.actions.filter((action) => action.status === 'pending');
  const run = await f.runtime.claim({
    runId: f.run.runId,
    actionId: left.id,
    attempt: left.attempt,
    inputHash: left.inputHash,
    executorId: 'local-skill',
    capabilities: ['skill-script'],
    claimToken: 'left-claim',
  });
  await f.runtime.execute({ runId: run.runId, actionId: right.id, executorId: 'local-skill' });
  expect(await fs.readFile(path.join(f.rightRoot, 'shared.txt'), 'utf8')).toBe('right\n');
  expect(
    (await f.runtime.inspect(run.runId)).actions.find((action) => action.id === left.id),
  ).toMatchObject({ status: 'running', claim: { token: 'left-claim' } });
  await expect(fs.access(path.join(f.leftRoot, 'shared.txt'))).rejects.toThrow();
  const claimed = run.actions.find((action) => action.id === left.id)!;
  const skill = f.loaded.skills.get('writer')!;
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [path.join(skill.root, 'scripts/run.mjs'), JSON.stringify(claimed.input)],
      { encoding: 'utf8' },
    ),
  );
  await fs.appendFile(path.join(f.leftRoot, 'shared.txt'), 'left\n');
  await f.runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: claimed.id,
      attempt: claimed.attempt,
      inputHash: claimed.inputHash,
      claimToken: claimed.claim!.token,
      outcomeId: 'left-result',
      status: 'succeeded',
      output,
    },
  });
  expect(await fs.readFile(path.join(f.leftRoot, 'shared.txt'), 'utf8')).toBe('left\n');
  expect(await fs.readFile(path.join(f.rightRoot, 'shared.txt'), 'utf8')).toBe('right\n');
});
it('rejects the same absolute file shared by different worktrees and retains unknown work', async () => {
  const f = await fixture(true);
  const [left, right] = f.run.actions.filter((action) => action.status === 'pending');
  await expect(
    f.runtime.execute({ runId: f.run.runId, actionId: right.id, executorId: 'local-skill' }),
  ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
  expect(
    (await f.runtime.inspect(f.run.runId)).actions.find((action) => action.id === right.id)?.status,
  ).toBe('pending');
  // 旧宿主的未知执行必须继续占用原共享范围。
  const unknown = {
    ...left,
    status: 'unknown' as const,
    claim: { executorId: 'local-skill', token: 'original' },
  };
  expect(() =>
    assertApplicationSkillExecutionScope(
      f.loaded,
      {
        ...f.run,
        actions: f.run.actions.map((action) => (action.id === left.id ? unknown : action)),
      },
      right,
    ),
  ).toThrow('并行冲突');
});
it('rejects mixed workspace declarations before treating the same directory as isolated', async () => {
  const f = await fixture();
  const right = f.run.actions.find((action) => action.stepId === 'right')!;
  const mixed = {
    manifest: {
      ...f.loaded.manifest,
      bindings: f.loaded.manifest.bindings.map((binding) =>
        binding.stepId === 'left' ? { ...binding, workspaceFrom: undefined } : binding,
      ),
    },
    skills: f.loaded.skills,
  };
  const sameDirectory = {
    ...f.run,
    actions: f.run.actions.map((action) =>
      action.stepId === 'left' ? { ...action, input: right.input } : action,
    ),
  };
  expect(() => assertApplicationSkillExecutionScope(mixed, sameDirectory, right)).toThrow('工作区');
  await expect(fixture(false, true)).rejects.toThrow('工作区');
});
