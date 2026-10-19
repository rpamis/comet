import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { createRuntime, type WorkflowRun } from '../../../domains/engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import { nativeSdkArchiveFinalizeExecutor } from '../../../domains/comet-native/native-sdk-archive.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function interruptedArchive() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-doctor-ownership-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({ paths, name: 'portable-neighbor', language: 'en' });
  const name = 'sdk-archive';
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(path.join(changeDir, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nPreserve the workflow.\n# Scope\nThe workflow.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'specs/workflow/spec.md'),
    '# Workflow\nThe workflow resumes without losing confirmed work.\n',
  );
  const application = defineNativeWorkflowApplication();
  const runtime = createRuntime({
    store: createNativeSdkStateStore(root),
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
  let run = await runtime.start({
    runId: name,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
      createdAt: '2026-09-24T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    }),
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: name,
    format: 'sdk',
    application: 'native',
    runId: name,
  });
  const succeed = async (output: unknown, sessionId?: string) => {
    const action = run.actions.at(-1)!;
    const context = { requestId: action.id, projectRoot: root };
    const claimed = await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId,
      claimToken: action.id,
      context,
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.at(-1)!.claim!.token,
        outcomeId: action.id,
        status: 'succeeded',
        output,
      },
      context,
    });
  };
  const approve = async () => {
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: name,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: wait.id,
      choice: 'approved',
    });
  };
  const execute = async (executorId: string) => {
    run = await runtime.execute({
      runId: name,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { requestId: executorId, projectRoot: root },
    });
  };
  const proposal = () =>
    collectNativeSdkShapeProposal({ paths, state: run.state as unknown as NativePortableState });
  await succeed(await proposal());
  await approve();
  await succeed(await proposal());
  await succeed(
    {
      summary: 'Preserved the workflow.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: '2026-09-24T01:00:00.000Z',
      verificationChecks: [],
    },
    'builder-session',
  );
  await execute('comet-native-checks');
  await succeed(
    {
      candidateId: (run.state as unknown as NativePortableState).builder_handoff!.candidate_id,
      verifierExecutionRef: 'verifier-session',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the workflow.' }],
          risks: [],
          summary: 'All acceptance scenarios passed.',
        },
      },
    },
    'verifier-session',
  );
  for (const executor of [
    'comet-native-report',
    'comet-native-report-revalidate',
    'comet-native-archive-preflight',
    'comet-native-archive-apply',
  ]) {
    if (run.waits.at(-1)?.stepId === 'verify.confirm' && run.waits.at(-1)?.status === 'pending')
      await approve();
    await execute(executor);
  }
  vi.spyOn(nativeSdkArchiveFinalizeExecutor, 'execute').mockRejectedValueOnce(
    new Error('Host lost before finalization'),
  );
  await expect(execute('comet-native-archive-finalize')).rejects.toThrow('EXECUTION_UNKNOWN');
  const interrupted: WorkflowRun = await runtime.inspect(name);
  expect(interrupted.actions.at(-1)).toMatchObject({
    stepId: 'archive.finalize',
    status: 'unknown',
  });
  const transactionFile = path.join(paths.transactionsDir, `portable-archive-${name}.json`);
  const transaction = await fs.readFile(transactionFile, 'utf8');
  expect(JSON.parse(transaction)).toMatchObject({ status: 'specs-applied' });
  return { root, paths, name, runtime, interrupted, transactionFile, transaction };
}

describe('Native doctor SDK transaction ownership', () => {
  it.each([
    { scope: 'named', repair: false },
    { scope: 'named', repair: true },
    { scope: 'project', repair: false },
    { scope: 'project', repair: true },
  ])(
    'preserves an unknown finalizer for $scope doctor (repair=$repair)',
    async ({ scope, repair }) => {
      const fixture = await interruptedArchive();
      const { root, name, runtime, interrupted, transactionFile, transaction } = fixture;
      const result = await nativeDoctorCommand(
        [...(scope === 'named' ? [name] : []), ...(repair ? ['--repair'] : [])],
        root,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.data).toMatchObject({ healthy: false });
      const data = result.data as Record<string, unknown>;
      const diagnosed =
        scope === 'named'
          ? data
          : (data.changes as Array<Record<string, unknown>>).find(
              (change) => change.change === name,
            );
      expect(diagnosed).toMatchObject({
        workflow: 'native-sdk',
        runtimeFormat: 'sdk',
        healthy: false,
        repaired: false,
        findings: expect.arrayContaining([
          expect.objectContaining({
            code: 'sdk-action-outcome-unresolved',
            actionId: interrupted.actions.at(-1)!.id,
            stepId: 'archive.finalize',
            repairCommand: `comet native archive ${name} --recover`,
          }),
          expect.objectContaining({ code: 'sdk-archive-transaction-incomplete' }),
        ]),
      });
      if (scope === 'project' && repair) expect(data.repairedPortableTransactions).toEqual([]);
      expect(await runtime.inspect(name)).toEqual(interrupted);
      expect(await fs.readFile(transactionFile, 'utf8')).toBe(transaction);
    },
  );

  it('keeps an invalid SDK transaction blocked instead of selecting portable repair', async () => {
    const { root, name, runtime, interrupted, transactionFile } = await interruptedArchive();
    const malformed = '{interrupted transaction';
    await fs.writeFile(transactionFile, malformed);
    for (const args of [[name, '--repair'], ['--repair']]) {
      const result = await nativeDoctorCommand(args, root);
      expect(result.exitCode).not.toBe(0);
      expect(result.data).toMatchObject({
        healthy: false,
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'sdk-transaction-invalid' }),
        ]),
      });
      expect(await runtime.inspect(name)).toEqual(interrupted);
      expect(await fs.readFile(transactionFile, 'utf8')).toBe(malformed);
    }
  });
});
