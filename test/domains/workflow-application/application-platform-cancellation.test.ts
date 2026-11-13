import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createRuntime, type WorkflowRun } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { createScopeCycleApplication } from '../../helpers/workflow-application.js';
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function root() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cross-scope-'));
  roots.push(directory);
  return directory;
}
async function fixture(
  projectRoot: string,
  id: string,
  scope = 'shared.txt',
  runId = 'same-run',
  workspaceRoot?: string,
) {
  const packageDirectory = path.join(projectRoot, id);
  await fs.mkdir(packageDirectory);
  const disk = await createScopeCycleApplication(packageDirectory, true);
  disk.manifest.id = id;
  disk.manifest.skills[0].adapter.scope = [scope];
  if (workspaceRoot) {
    for (const binding of disk.manifest.bindings) binding.workspaceFrom = 'input.workspaceRoot';
    disk.manifest.skills[0].adapter.inputSchema = { type: 'object' };
  }
  await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
  const loaded = await loadWorkflowApplication({ file: disk.file, projectRoot });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  let run = await runtime.start({
    runId,
    workflow: { id: 'editorial', version: '1' },
    input: { topic: id, ...(workspaceRoot ? { workspaceRoot } : {}) },
  });
  run = await runtime.execute({ runId, actionId: run.actions[0].id, executorId: 'tool-host' });
  run = await runtime.resolveWait({
    runId,
    waitId: run.waits[0].id,
    proposalHash: run.waits[0].proposalHash,
    decisionId: `${id}-approval`,
    choice: 'approved',
  });
  const action = run.actions.at(-1)!;
  const request = {
    runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'local-skill',
    capabilities: ['skill-script'],
  };
  return { disk, loaded, runtime, run, action, request };
}

import { projectWorkflowApplicationRun } from '../../../domains/workflow-application/run-view.js';
import { applicationActionHoldsScope } from '../../../domains/workflow-application/skill-executor.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
async function cancelFixture() {
  const project = await root(),
    alpha = await fixture(project, 'alpha'),
    beta = await fixture(project, 'beta');
  const claimed = await alpha.runtime.claim({
    ...alpha.request,
    claimToken: 'SIMULATED original platform claim',
  });
  const action = claimed.actions.at(-1)!;
  expect(action.type).toBe('invoke_skill');
  const request = path.join(project, 'SIMULATED-cancel.json');
  await fs.writeFile(
    request,
    JSON.stringify({
      operation: 'cancel',
      runId: claimed.runId,
      reason: 'SIMULATED USER cancels platform task',
    }),
  );
  const result = await runtimeDispatchCommand(
    { applicationFile: alpha.disk.file, projectRoot: project, request },
    { invocationCwd: project, output: 'compact' },
  );
  expect(result.exitCode).toBe(0);
  const run = result.response.data as WorkflowRun;
  expect(run.status).toBe('cancelled');
  const cancelled = run.actions.find((a) => a.id === action.id)!;
  expect(cancelled).toMatchObject({ status: 'cancelled', claim: action.claim });
  expect(cancelled.cancellation).toBeUndefined();
  expect(cancelled.executionStop).toBeUndefined();
  return { project, alpha, beta, run, action: cancelled, result };
}
it('releases a cancelled platform invoke_skill across a cold application reload without a stoppedActions handshake', async () => {
  const f = await cancelFixture();
  const reload = await loadWorkflowApplication({ file: f.beta.disk.file, projectRoot: f.project });
  const runtime = createRuntime({ ...reload.implementation, store: reload.store });
  const outcome = await runtime.claim(f.beta.request).then(
    (run) => ({ accepted: true, run }),
    (error) => ({
      accepted: false,
      error: { code: error.code, message: error.message, blockedRunIds: error.blockedRunIds },
    }),
  );
  expect(outcome).toMatchObject({ accepted: true });
  expect(applicationActionHoldsScope(f.action)).toBe(false);
  expect(await f.alpha.runtime.inspect(f.run.runId)).toEqual(f.run);
  await expect(fs.stat(path.join(f.project, 'shared.txt'))).rejects.toThrow();
});
it('shows cancelled platform invoke_skill as done in the actual compact dispatch response without stop confirmation', async () => {
  const f = await cancelFixture();
  const projection = projectWorkflowApplicationRun(f.alpha.loaded, f.run);
  expect(f.result.cliResponse.data.continuation.mode).toBe('done');
  expect(projection.continuation.mode).toBe('done');
  expect(JSON.stringify(projection)).not.toMatch(
    /stoppedActions|confirmStoppedRequest|actual-stop-evidence/u,
  );
});
it('keeps generic claimed call_tool cancellation conservative without altering its original claim', async () => {
  const project = await root(),
    f = await fixture(project, 'owned-tool');
  const run = await f.runtime.start({
      runId: 'SIMULATED-owned-call-tool',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'SIMULATED actual owned tool boundary' },
    }),
    action = run.actions[0];
  expect(action.type).toBe('call_tool');
  const claimed = await f.runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'tool-host',
      claimToken: 'SIMULATED original owned-tool claim',
    }),
    cancelled = await f.runtime.cancel({
      runId: run.runId,
      reason: 'SIMULATED USER cancels scheduling only',
    }),
    original = cancelled.actions.find((a) => a.id === action.id)!;
  expect(original.claim).toEqual(claimed.actions.find((a) => a.id === action.id)!.claim);
  expect(applicationActionHoldsScope(original)).toBe(true);
  expect(projectWorkflowApplicationRun(f.loaded, cancelled).continuation.mode).toBe('reconcile');
});
