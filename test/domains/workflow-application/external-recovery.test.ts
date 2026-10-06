import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRuntime,
  type RuntimeAction,
  type RuntimeOutcome,
} from '../../../domains/engine/runtime.js';
import {
  createApplicationSkillExecutor,
  loadWorkflowApplication,
  reconcileApplicationSkill,
  type SkillExecutionHost,
} from '../../../domains/workflow-application/index.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import { startIsolatedExternalService } from '../../helpers/isolated-external-service.mjs';

describe('isolated external operation recovery through the SDK', () => {
  let root: string;
  let credential: string;
  let service: Awaited<ReturnType<typeof startIsolatedExternalService>> | undefined;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-external-recovery-'));
    credential = `fixture-secret-${randomUUID()}`;
  });
  afterEach(async () => {
    await service?.close();
    service = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });

  function outcome(action: RuntimeAction, output: unknown): RuntimeOutcome {
    return {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      outcomeId: `${action.id}:prepare`,
      status: 'succeeded',
      output,
    };
  }

  async function fixture(firstRequestFault: 'drop-before' | 'drop-after') {
    service = await startIsolatedExternalService({ credential, firstRequestFault });
    const client = service.client;
    const disk = await createDiskApplication(root, { external: true });
    let application = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
    const host: SkillExecutionHost = {
      id: 'local-skill',
      capabilities: ['skill-script'],
      authorize: async ({ run, binding }) =>
        run.waits[0].decision?.choice === 'multi-session' &&
        binding.authorizationFrom === 'approve',
      invokeSkill: async ({ action }) => {
        const input = action.input as { input: { topic: string } };
        const result = await client.execute({
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          topic: input.input.topic,
        });
        return result.outcome;
      },
      reconcile: async ({ action }) => client.query(action.id),
    };
    const runtimeFor = () =>
      createRuntime({
        ...application.implementation,
        executors: [createApplicationSkillExecutor(application, host)],
        store: application.store,
      });
    let runtime = runtimeFor();
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'Actual topic' },
    });
    const prepare = run.actions[0];
    run = await runtime.claim({
      runId: run.runId,
      actionId: prepare.id,
      attempt: prepare.attempt,
      inputHash: prepare.inputHash,
      executorId: 'preparation',
      claimToken: `${prepare.id}:claim`,
      capabilities: [],
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: outcome(run.actions[0], { scope: 'report' }),
    });
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'user-confirmation',
      choice: 'multi-session',
    });
    const actionId = run.actions[1].id;
    return {
      host,
      client,
      actionId,
      get application() {
        return application;
      },
      get runtime() {
        return runtime;
      },
      command: { runId: run.runId, actionId, executorId: host.id },
      async reload() {
        application = await loadWorkflowApplication({
          file: disk.file,
          projectRoot: root,
          runId: run.runId,
        });
        runtime = runtimeFor();
      },
    };
  }

  async function assertCredentialIsEphemeral(run: unknown) {
    expect(JSON.stringify(run)).not.toContain(credential);
    async function inspectFiles(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await inspectFiles(file);
        else if (entry.isFile())
          expect(await fs.readFile(file, 'utf8'), file).not.toContain(credential);
      }
    }
    await inspectFiles(root);
  }

  it('queries a completed operation after the HTTP return is lost and records the original Outcome once', async () => {
    const f = await fixture('drop-after');
    await expect(f.runtime.execute(f.command)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    const unknown = await f.runtime.inspect('report');
    const originalAction = unknown.actions[1];
    expect(originalAction.status).toBe('unknown');
    expect(await f.client.stats()).toMatchObject({ executionCount: 1, executionRequests: 1 });
    await f.reload();
    expect((await f.runtime.inspect('report')).actions[1]).toEqual(originalAction);
    await expect(f.runtime.execute(f.command)).rejects.toMatchObject({
      code: 'ACTION_ALREADY_CLAIMED',
    });
    const queried = await f.client.query(f.actionId);
    const reconciled = await reconcileApplicationSkill(f.application, f.host, unknown, f.actionId);
    if (reconciled.resolution !== 'executed') throw new Error('Expected actual service Outcome');
    expect(reconciled.outcome).toEqual(queried.outcome);
    expect(reconciled.outcome).toMatchObject({
      actionId: originalAction.id,
      attempt: originalAction.attempt,
      inputHash: originalAction.inputHash,
      claimToken: originalAction.claim!.token,
    });
    const completed = await f.runtime.recordOutcome({
      runId: 'report',
      outcome: reconciled.outcome,
    });
    expect(completed.status).toBe('completed');
    expect(await f.runtime.recordOutcome({ runId: 'report', outcome: reconciled.outcome })).toEqual(
      completed,
    );
    expect(completed.actions[1].receipts).toHaveLength(1);
    expect(await f.client.stats()).toMatchObject({ executionCount: 1, executionRequests: 1 });
    await assertCredentialIsEphemeral(completed);
  });

  it('requires service not-executed evidence before retrying the same Action and executes only once', async () => {
    const f = await fixture('drop-before');
    await expect(f.runtime.execute(f.command)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    const unknown = await f.runtime.inspect('report');
    const originalAction = unknown.actions[1];
    expect(await f.client.stats()).toMatchObject({ executionCount: 0, executionRequests: 1 });
    await expect(
      f.runtime.retry({ runId: 'report', actionId: f.actionId, attempt: originalAction.attempt }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    expect(await f.runtime.inspect('report')).toEqual(unknown);
    await f.reload();
    const reconciled = await reconcileApplicationSkill(f.application, f.host, unknown, f.actionId);
    if (reconciled.resolution !== 'not-executed')
      throw new Error('Expected authoritative absence evidence');
    expect(JSON.parse(reconciled.evidence)).toMatchObject({
      serviceId: service!.serviceId,
      actionId: f.actionId,
      resolution: 'not-executed',
      executionCount: 0,
    });
    const retried = await f.runtime.retry({
      runId: 'report',
      actionId: f.actionId,
      attempt: originalAction.attempt,
      expectedRevision: unknown.revision,
      reconciliation: reconciled,
    });
    expect(retried.actions[1]).toMatchObject({
      id: originalAction.id,
      attempt: 2,
      status: 'pending',
      inputHash: originalAction.inputHash,
      reconciliations: [{ attempt: 1, resolution: 'not-executed', evidence: reconciled.evidence }],
    });
    expect(retried.actions[1].claim).toBeUndefined();
    const completed = await f.runtime.execute(f.command);
    expect(completed.status).toBe('completed');
    expect(completed.actions).toHaveLength(2);
    expect(completed.actions[1].outcome?.attempt).toBe(2);
    expect(await f.client.stats()).toMatchObject({ executionCount: 1, executionRequests: 2 });
    await assertCredentialIsEphemeral(completed);
  });

  it('blocks before dispatch without reconciliation and preserves an unknown operation if that capability is later lost', async () => {
    const f = await fixture('drop-after');
    const reconcile = f.host.reconcile;
    delete f.host.reconcile;
    await expect(f.runtime.execute(f.command)).rejects.toMatchObject({
      code: 'RECONCILIATION_REQUIRED',
    });
    expect((await f.runtime.inspect('report')).actions[1]).toMatchObject({
      status: 'pending',
      attempt: 1,
    });
    expect(await f.client.stats()).toMatchObject({ executionCount: 0, executionRequests: 0 });
    f.host.reconcile = reconcile;
    await expect(f.runtime.execute(f.command)).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    const unknown = await f.runtime.inspect('report');
    delete f.host.reconcile;
    await expect(
      reconcileApplicationSkill(f.application, f.host, unknown, f.actionId),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    expect(await f.runtime.inspect('report')).toEqual(unknown);
    expect(await f.client.stats()).toMatchObject({ executionCount: 1, executionRequests: 1 });
    await assertCredentialIsEphemeral(unknown);
  });
});
