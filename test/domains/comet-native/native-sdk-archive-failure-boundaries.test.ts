import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as nativeDomain from '../../../domains/comet-native/index.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  nativeProjectPaths,
  ensureNativeDirectories,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  createRuntime,
  createFileRuntimeStore,
  createMemoryRuntimeStore,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import {
  registerSdkChangeOwner,
  COMET_CHANGE_OWNER_SCHEMA,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { refreshNativeSdkVerificationReport } from '../../../domains/comet-native/native-sdk-report.js';
import { archiveNativeSdkChange } from '../../../domains/comet-native/native-sdk-archive-command.js';
import { nativeSdkArchiveFinalizeExecutor } from '../../../domains/comet-native/native-sdk-archive.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
type NativeApplication = ReturnType<typeof nativeDomain.defineNativeWorkflowApplication>;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function expectArchiveFailure(
  operation: ReturnType<typeof archiveNativeSdkChange>,
  expected?: string | RegExp,
) {
  let message: string;
  try {
    const result = await operation;
    expect(result.exitCode, JSON.stringify(result)).toBe(73);
    expect(result.error?.code).toBe('blocked');
    message = result.error!.message;
  } catch (error) {
    if (!(error instanceof Error) || error.name === 'AssertionError') throw error;
    message = error.message;
  }
  if (typeof expected === 'string') expect(message).toContain(expected);
  else if (expected) expect(message).toMatch(expected);
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-sdk-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const config = defaultProjectConfig('docs', 'en');
  await writeProjectConfig(root, {
    ...config,
    native: { ...config.native, document_writes: 'revert' },
  });
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, 'sdk-shape');
  await fs.mkdir(changeDir);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    `# Outcome
Ship the selected workflow.
# Scope
Preserve the selected workflow.
## Directory structure
### Modified
- domains/workflow.ts: preserve workflow recovery.
# Non-goals
None.
# Acceptance examples
- The selected workflow resumes.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
  );
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe selected workflow resumes without losing confirmed work.\n',
  );
  return {
    root,
    paths,
    changeDir,
    initialState: createNativePortableState({
      name: 'sdk-shape',
      language: 'en',
      createdAt: '2026-09-24T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    }),
  };
}
function nativeApplication(version: '4' = '4'): NativeApplication {
  return nativeDomain.defineNativeWorkflowApplication(version);
}
function collectProposal(
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>,
  state: NativePortableState,
  materializeTargets = false,
) {
  const collect = (nativeDomain as Record<string, unknown>).collectNativeSdkShapeProposal;
  expect(collect).toBeTypeOf('function');
  return (
    collect as (options: {
      paths: typeof paths;
      state: NativePortableState;
      materializeTargets?: boolean;
    }) => Promise<unknown>
  )({ paths, state, materializeTargets });
}
async function platformFixtureChecks(root: string) {
  const actual = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    cwd: root,
    windowsHide: true,
  });
  expect(actual.status).toBe(0);
  return [
    {
      name: 'Actual harmless Node fixture command',
      result: 'passed',
      note: 'Actual exit 0; SIMULATED Agent protocol acceptance, no model or product evaluation.',
    },
  ];
}
async function succeedLatestAction(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  output: unknown,
  root: string,
  receipt: string,
  sessionId?: string,
) {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const value = output as Record<string, unknown>;
    if (
      (value.response as { kind?: string } | undefined)?.kind === 'final-result' &&
      !Object.hasOwn(value, 'checks')
    )
      output = { ...value, checks: await platformFixtureChecks(root) };
  }
  const action = run.actions.at(-1)!;
  const context = { requestId: receipt, projectRoot: root };
  const claimed = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    ...(sessionId ? { sessionId } : {}),
    claimToken: receipt,
    context,
  });
  return runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: claimed.actions.at(-1)!.claim!.token,
      outcomeId: receipt,
      status: 'succeeded',
      output,
    },
    context,
  });
}
async function preparedShape(
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  application = nativeApplication(),
  beforeShape?: (root: string) => Promise<void>,
) {
  const fixtureData = await fixture();
  await beforeShape?.(fixtureData.root);
  const store =
    storeKind === 'sdk'
      ? createNativeSdkStateStore(fixtureData.root)
      : storeKind === 'file'
        ? createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(resolveWorkspaceRuntimeRootSync(fixtureData.root), 'sdk-runs'),
          })
        : createMemoryRuntimeStore<WorkflowRun>();
  const runtime = createRuntime({
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    validators: application.validators,
    stateValidators: application.stateValidators,
    commandValidators: application.commandValidators,
    executors: application.executors,
  });
  let run = await runtime.start({
    runId: storeKind === 'sdk' ? 'sdk-shape' : 'native-sdk-shape',
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name: 'sdk-shape', artifactRootRef: 'docs' },
    initialState: fixtureData.initialState,
  });
  if (storeKind === 'sdk') {
    await registerSdkChangeOwner(fixtureData.root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: 'sdk-shape',
      format: 'sdk',
      application: 'native',
      runId: run.runId,
    });
  }
  run = await succeedLatestAction(
    runtime,
    run,
    await collectProposal(fixtureData.paths, fixtureData.initialState),
    fixtureData.root,
    'shape-proposal',
  );
  return { ...fixtureData, application, store, runtime, run };
}
async function dispatchedVerifier(
  verificationChecks: unknown[] = [],
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  application = nativeApplication(),
  executeChecks = true,
  beforeChecks?: (root: string) => Promise<void>,
  beforeShape?: (root: string) => Promise<void>,
  requireIndependentReview = true,
) {
  const prepared = await preparedShape(storeKind, application, beforeShape);
  const { root, paths, runtime } = prepared;
  const shapeWait = prepared.run.waits.at(-1)!;
  let run = await runtime.resolveWait({
    runId: prepared.run.runId,
    waitId: shapeWait.id,
    proposalHash: shapeWait.proposalHash,
    decisionId: 'shape-approved',
    choice: 'approved',
  });
  run = await succeedLatestAction(
    runtime,
    run,
    {
      summary: 'Implemented the selected workflow.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: await platformFixtureChecks(root),
      requireIndependentReview,
      knownLimits: [],
      review: null,
      submittedAt: '2026-09-24T01:00:00.000Z',
    },
    root,
    'builder-candidate',
    'builder-session-1',
  );
  await beforeChecks?.(root);
  return { ...prepared, run };
}
async function awaitingArchiveApplication(
  storeKind: 'memory' | 'file' | 'sdk' = 'memory',
  beforePreflight?: (options: { root: string; run: WorkflowRun }) => void | Promise<void>,
  stopBeforePreflight = false,
  prepareProject?: (root: string) => Promise<void>,
  application = nativeApplication(),
  beforeShape?: (root: string) => Promise<void>,
  verificationChecks: unknown[] = [],
) {
  const prepared = await dispatchedVerifier(
    verificationChecks,
    storeKind,
    application,
    true,
    undefined,
    async (root) => {
      await beforeShape?.(root);
      await prepareProject?.(root);
    },
  );
  const { root, runtime } = prepared;
  let run = prepared.run;
  run = await succeedLatestAction(
    runtime,
    run,
    {
      candidateId: (run.state as NativePortableState).builder_handoff!.candidate_id,
      verifierExecutionRef: 'verifier-session-1',
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified the selected workflow.' }],
          risks: [],
          summary: 'All acceptance scenarios passed.',
        },
      },
    },
    root,
    'verifier-result',
    'verifier-session-1',
  );
  await refreshNativeSdkVerificationReport(root, run);
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'verification-approved',
    choice: 'approved',
  });
  if (!stopBeforePreflight) {
    await beforePreflight?.({ root, run });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'native-archive-preflight', projectRoot: root },
    });
  }
  return { ...prepared, run };
}
async function initializeArchiveGit(root: string) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await fs.writeFile(path.join(root, 'implementation.js'), 'export const result = true;');
  execFileSync('git', ['add', 'implementation.js'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
}
async function interruptArchiveFinalization(
  point:
    | 'report'
    | 'report-journal'
    | 'move'
    | 'move-journal'
    | 'portable-receipt'
    | 'runtime-receipt'
    | 'cleanup',
) {
  const prepared = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    initializeArchiveGit,
    undefined,
  );
  const { root, paths, runtime } = prepared;
  let run = await runtime.execute({
    runId: prepared.run.runId,
    actionId: prepared.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'interrupt-finalize-apply', projectRoot: root },
  });
  const action = run.actions.at(-1)!;
  const context = { requestId: 'interrupt-finalize', projectRoot: root };
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-archive-finalize',
    claimToken: 'original-finalize-owner',
    context,
  });
  const applied = run.outputs['archive.execute'].value as {
    transactionId: string;
    archiveRef: string;
  };
  const archiveDir = path.join(paths.archiveDir, applied.archiveRef);
  const transactionFile = path.join(paths.transactionsDir, `portable-archive-${run.runId}.json`);
  const atomic = await import('../../../domains/comet-native/native-atomic-file.js');
  const originalJson = atomic.atomicWriteJson;
  const originalText = atomic.atomicWriteText;
  const originalRename = fs.rename;
  const originalRm = fs.rm;
  if (point === 'report') await fs.rm(path.join(prepared.changeDir, 'verification.md'));
  let interrupted = false;
  const fail = () => {
    interrupted = true;
    throw Object.assign(new Error(`Injected finalize interruption: ${point}`), { code: 'EIO' });
  };
  vi.spyOn(atomic, 'atomicWriteJson').mockImplementation(async (file, value, options) => {
    const status = (value as { status?: string }).status;
    if (
      !interrupted &&
      ((file === transactionFile && point === 'report-journal' && status === 'report-aligned') ||
        (file === transactionFile && point === 'move-journal' && status === 'moved') ||
        (point === 'runtime-receipt' &&
          file.includes(`${path.sep}sdk-archive-receipts${path.sep}`)))
    )
      fail();
    return originalJson(file, value, options);
  });
  vi.spyOn(atomic, 'atomicWriteText').mockImplementation(async (file, text, options) => {
    if (
      !interrupted &&
      ((point === 'report' && file === path.join(prepared.changeDir, 'verification.md')) ||
        (point === 'portable-receipt' &&
          file === path.join(archiveDir, 'comet-state.yaml') &&
          text.includes('archive_receipt:')))
    )
      fail();
    return originalText(file, text, options);
  });
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (!interrupted && point === 'move' && source === prepared.changeDir) fail();
    return originalRename(source, target);
  });
  vi.spyOn(fs, 'rm').mockImplementation(async (file, options) => {
    if (!interrupted && point === 'cleanup' && file === transactionFile) fail();
    return originalRm(file, options);
  });
  if (point === 'report') {
    const actual = await nativeSdkArchiveFinalizeExecutor.execute(
      run.actions.at(-1)!,
      context,
      run,
    );
    expect(actual.status).toBe('succeeded');
  } else
    await expect(
      nativeSdkArchiveFinalizeExecutor.execute(run.actions.at(-1)!, context, run),
    ).rejects.toThrow('Injected finalize interruption');
  expect(interrupted).toBe(true);
  vi.restoreAllMocks();
  run = await runtime.markUnknown({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    reason: `Original host exited at ${point}`,
  });
  return { ...prepared, run, action: run.actions.at(-1)!, applied, archiveDir, transactionFile };
}
it.each([
  'report',
  'report-journal',
  'move',
  'move-journal',
  'portable-receipt',
  'runtime-receipt',
  'cleanup',
] as const)(
  'resumes the original finalize after interruption at %s without replaying applied side effects',
  async (point) => {
    const f = await interruptArchiveFinalization(point);
    const originalTransaction =
      point === 'report'
        ? { id: f.applied.transactionId }
        : JSON.parse(await fs.readFile(f.transactionFile, 'utf8'));
    const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
    const spec = await fs.readFile(specFile, 'utf8');
    const specStat = await fs.stat(specFile);
    const originalRename = fs.rename;
    const moves: unknown[] = [];
    vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (source === f.changeDir) moves.push([source, target]);
      return originalRename(source, target);
    });
    const recovered = await archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(recovered.exitCode, JSON.stringify(recovered)).toBe(0);
    expect(recovered.data).toMatchObject({
      historicalRecovery: point === 'report',
      resumedFinalization: point !== 'report',
      currentImplementationRevalidated: false,
    });
    const completed = await f.runtime.inspect(f.run.runId);
    expect(completed.status).toBe('completed');
    expect(completed.actions.at(-1)).toMatchObject({
      id: f.action.id,
      attempt: f.action.attempt,
      inputHash: f.action.inputHash,
      claim: f.action.claim,
      status: 'succeeded',
    });
    expect(completed.actions.filter((action) => action.stepId === 'archive.execute')).toHaveLength(
      1,
    );
    expect(completed.outputs['archive.finalize'].value).toMatchObject({
      transactionId: originalTransaction.id,
    });
    expect(moves).toHaveLength(['report-journal', 'move'].includes(point) ? 1 : 0);
    expect(await fs.readFile(specFile, 'utf8')).toBe(spec);
    expect((await fs.stat(specFile)).mtimeMs).toBe(specStat.mtimeMs);
    await expect(fs.access(f.transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    const again = await archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    });
    expect(again.exitCode).toBe(0);
    expect(again.data).toMatchObject({ alreadyArchived: true, historicalRecovery: true });
    expect((await f.runtime.inspect(f.run.runId)).revision).toBe(completed.revision);
  },
);
it.each(['transaction-id', 'spec-cursor'])(
  'preserves the interrupted finalize when %s no longer matches its original evidence',
  async (drift) => {
    const f = await interruptArchiveFinalization('move-journal');
    const transaction = await fs.readFile(f.transactionFile, 'utf8');
    const files: Record<string, string> = {
      implementation: path.join(f.root, 'implementation.js'),
      material: path.join(f.archiveDir, 'brief.md'),
      spec: path.join(f.paths.specsDir, 'workflow/spec.md'),
      report: path.join(f.archiveDir, 'verification.md'),
      'transaction-id': f.transactionFile,
      'spec-cursor': f.transactionFile,
    };
    const file = files[drift];
    const original = await fs.readFile(file, 'utf8');
    const changed =
      drift === 'transaction-id'
        ? JSON.stringify({ ...JSON.parse(original), id: '00000000-0000-4000-8000-000000000000' })
        : drift === 'spec-cursor'
          ? JSON.stringify({ ...JSON.parse(original), next_spec_index: 0 })
          : `${original}\nChanged after interruption.\n`;
    await fs.writeFile(file, changed);
    await expectArchiveFailure(
      archiveNativeSdkChange({
        projectRoot: f.root,
        name: f.run.runId,
        dryRun: false,
        recover: true,
        confirmed: false,
      }),
    );
    expect(await fs.readFile(file, 'utf8')).toBe(changed);
    expect(await fs.readFile(f.transactionFile, 'utf8')).toBe(
      file === f.transactionFile ? changed : transaction,
    );
    expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
    await fs.writeFile(file, original);
    expect(
      (
        await archiveNativeSdkChange({
          projectRoot: f.root,
          name: f.run.runId,
          dryRun: false,
          recover: true,
          confirmed: false,
        })
      ).exitCode,
    ).toBe(0);
  },
);
it('does not overwrite a changed pre-finalization report while resuming the original finalize', async () => {
  const f = await interruptArchiveFinalization('move');
  const reportFile = path.join(f.changeDir, 'verification.md');
  const changed = '# User report\nUnconfirmed report change.\n';
  await fs.writeFile(reportFile, changed);
  const recovered = await archiveNativeSdkChange({
    projectRoot: f.root,
    name: f.run.runId,
    dryRun: false,
    recover: true,
    confirmed: false,
  });
  expect(recovered.exitCode, JSON.stringify(recovered)).toBe(0);
  expect(await fs.readFile(path.join(f.archiveDir, 'verification.md'), 'utf8')).toBe(changed);
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toMatchObject({
    id: f.action.id,
    attempt: f.action.attempt,
    claim: f.action.claim,
    status: 'succeeded',
  });
});
it('rejects a rewritten frozen transaction even when the canonical Spec matches that rewrite', async () => {
  const f = await interruptArchiveFinalization('move-journal');
  const specFile = path.join(f.paths.specsDir, 'workflow/spec.md');
  const transaction = JSON.parse(await fs.readFile(f.transactionFile, 'utf8'));
  const content = '# Workflow\nThis replacement was never confirmed.\n';
  transaction.spec_changes[0].content = content;
  transaction.spec_changes[0].result_hash = createHash('sha256').update(content).digest('hex');
  transaction.spec_changes[0].capability = 'foreign-capability';
  await fs.writeFile(f.transactionFile, JSON.stringify(transaction));
  await fs.writeFile(specFile, content);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /Spec|事务|transaction/,
  );
  expect(await fs.readFile(specFile, 'utf8')).toBe(content);
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
});
it('keeps recovery blocked when neither the original transaction nor a complete receipt survived', async () => {
  const f = await interruptArchiveFinalization('move-journal');
  await fs.rm(f.transactionFile);
  await expectArchiveFailure(
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: f.run.runId,
      dryRun: false,
      recover: true,
      confirmed: false,
    }),
    /completion record/,
  );
  expect((await f.runtime.inspect(f.run.runId)).actions.at(-1)).toEqual(f.action);
  await expect(fs.access(f.transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
});
