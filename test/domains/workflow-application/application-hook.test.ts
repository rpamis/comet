import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { createScopeCycleApplication } from '../../helpers/workflow-application.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-default-hook-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function fixture(custom = false, scope = 'shared.txt') {
  const disk = await createScopeCycleApplication(root, true);
  disk.manifest.skills[0].adapter.scope = [scope];
  (disk.manifest as typeof disk.manifest & { rule: string }).rule = 'rules/workflow-guard.md';
  await fs.mkdir(path.join(disk.packageRoot, 'rules'));
  await fs.writeFile(
    path.join(disk.packageRoot, 'rules/workflow-guard.md'),
    '# Application rule\n\nFollow the actual SDK Run.\n',
  );
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  if (custom) {
    const source = await fs.readFile(path.join(disk.packageRoot, 'application.mjs'), 'utf8');
    await fs.writeFile(
      path.join(disk.packageRoot, 'application.mjs'),
      source.replace(
        'return { workflows:',
        'return { inspectHook: () => ({allowed:true,reason:"custom"}), workflows:',
      ),
    );
  }
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId: 'default-hook',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'actual' },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions[0].id,
    executorId: 'tool-host',
  });
  const inspect = (state: typeof run, refs: string[]) =>
    loaded.implementation.inspectHook!(state, {
      intent: 'write',
      toolName: 'Write',
      targets: refs.map((ref) => path.join(root, ref)),
    });
  return { disk, loaded, runtime, run, inspect };
}
it('provides a default Guard and grants only the currently claimed, approved Skill write scope', async () => {
  const f = await fixture();
  expect(typeof f.loaded.implementation.inspectHook).toBe('function');
  expect(await f.inspect(f.run, ['shared.txt'])).toMatchObject({ allowed: false });
  const wait = f.run.waits[0];
  let run = await f.runtime.resolveWait({
    runId: f.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'fixture-approve',
    choice: 'approved',
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: false });
  const action = run.actions.find((action) => action.status === 'pending')!;
  run = await f.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    claimToken: 'fixture-claim',
    capabilities: ['skill-script'],
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: true });
  expect(await f.inspect(run, ['other.txt'])).toMatchObject({ allowed: false });
  expect(await f.inspect(run, ['shared.txt', '.comet/runtime/forged.json'])).toMatchObject({
    allowed: false,
  });
  run = await f.runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: 'fixture lost result',
  });
  expect(await f.inspect(run, ['shared.txt'])).toMatchObject({ allowed: false });
});

it('a claimed root write scope still cannot modify host Rule carriers', async () => {
  const f = await fixture(true, '.');
  const wait = f.run.waits[0];
  let run = await f.runtime.resolveWait({
    runId: f.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'root-scope-fixture',
    choice: 'approved',
  });
  const action = run.actions.find((action) => action.status === 'pending')!;
  run = await f.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    claimToken: 'root-fixture',
    capabilities: ['skill-script'],
  });
  expect(await f.inspect(run, ['normal.txt'])).toMatchObject({ allowed: true });
  for (const ref of ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'])
    expect(await f.inspect(run, [ref])).toMatchObject({ allowed: false });
});
it('custom Guards cannot grant writes to SDK state, fixed packages or unapproved Skill scopes', async () => {
  const f = await fixture(true);
  for (const ref of [
    '.comet/runtime/forged.json',
    '.comet/current-change.json',
    'package/application.mjs',
    'AGENTS.md',
    'AGENTS.override.md',
    'CLAUDE.md',
    'shared.txt',
  ])
    expect(await f.inspect(f.run, [ref])).toMatchObject({ allowed: false });
  expect(await f.inspect(f.run, ['.comet/requests/inspect.json'])).toMatchObject({ allowed: true });
});
it('requires the declared application Rule to exist within the fixed package', async () => {
  const f = await fixture();
  await fs.rm(path.join(f.disk.packageRoot, 'rules/workflow-guard.md'));
  await expect(loadWorkflowApplication({ file: f.disk.file, projectRoot: root })).rejects.toThrow(
    /规则|Rule/,
  );
});
