import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
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
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
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

import * as atomic from '../../../domains/comet-native/native-atomic-file.js';
it('recovers a rejected create-Spec Archive result without republishing canonical Specs', async () => {
  await ensureCliBuilt(path.resolve('.'));
  const application = nativeApplication();
  const f = await awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    undefined,
    application,
    initializeArchiveGit,
  );
  const pending = f.run.actions.at(-1)!;
  const executor = application.executors.find(
    (entry) => entry.id === 'comet-native-archive-apply',
  )!;
  const claimed = await f.runtime.claim({
    runId: f.run.runId,
    actionId: pending.id,
    attempt: pending.attempt,
    inputHash: pending.inputHash,
    executorId: executor.id,
    claimToken: 'actual-create-spec-apply',
    context: { projectRoot: f.root, requestId: 'claim-create-spec-apply' },
  });
  const action = claimed.actions.find((entry) => entry.id === pending.id)!;
  const result = await executor.execute(
    action,
    { projectRoot: f.root, requestId: 'actual-create-spec-apply' },
    claimed,
  );
  const canonical = path.join(f.paths.specsDir, 'workflow/spec.md');
  const content = await fs.readFile(canonical, 'utf8');
  const identity = await fs.stat(canonical, { bigint: true });
  expect((claimed.state as NativePortableState).spec_changes).toMatchObject([
    { capability: 'workflow', operation: 'create' },
  ]);
  // Inject a malformed transport result after the real executor wrote the Spec.
  // This is deterministic rejection coverage, not a captured 0.5.2 failure.
  await expect(
    f.runtime.recordOutcome({
      runId: claimed.runId,
      context: { projectRoot: f.root, requestId: 'rejected-create-spec-apply' },
      outcome: {
        ...result,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: 'SIMULATED-corrupt-transport-result',
        output: { ...(result.output as Record<string, string | number>), specCount: -1 },
      },
    }),
  ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  const before = await f.runtime.inspect(claimed.runId);
  expect(before.actions.at(-1)?.rejectedOutcomes).toHaveLength(1);
  const recoverArgs = [
    'native',
    'archive',
    claimed.runId,
    '--recover',
    '--project-root',
    f.root,
    '--json',
  ];
  let nextArgs = recoverArgs;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cli = spawnSync(process.execPath, [path.resolve('dist/app/cli/index.js'), ...nextArgs], {
      cwd: f.root,
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
      env: { ...process.env, COMET_DAEMON: 'off', COMET_SKIP_UPDATE_CHECK: '1' },
    });
    expect(cli.status, cli.stderr || cli.stdout).toBe(0);
    const response = JSON.parse(cli.stdout);
    if (attempt === 0) {
      expect(response.data.recoveredAction).toMatchObject({
        id: action.id,
        stepId: 'archive.execute',
      });
      const continuation = response.data.continuation.commandArgs;
      expect(continuation.slice(0, 4)).toEqual(['comet', 'native', 'archive', claimed.runId]);
      expect(continuation).not.toContain('--recover');
      nextArgs = continuation.slice(1);
    } else nextArgs = recoverArgs;
    expect(await fs.readFile(canonical, 'utf8')).toBe(content);
    expect(await fs.stat(canonical, { bigint: true })).toMatchObject({
      dev: identity.dev,
      ino: identity.ino,
      mtimeNs: identity.mtimeNs,
      size: identity.size,
    });
  }
  const completed = await f.runtime.inspect(claimed.runId);
  expect(completed.status).toBe('completed');
  expect(completed.waits).toEqual(before.waits);
  expect(completed.actions.filter((entry) => entry.stepId === 'archive.execute')).toHaveLength(1);
  expect(completed.actions.find((entry) => entry.id === action.id)).toMatchObject({
    status: 'succeeded',
    claim: action.claim,
    rejectedOutcomes: before.actions.at(-1)!.rejectedOutcomes,
  });
});
import { requireFileSymlink } from '../../helpers/file-symlink.js';
async function multiCapabilityArchive(git = true) {
  return awaitingArchiveApplication(
    'sdk',
    undefined,
    false,
    undefined,
    nativeApplication(),
    async (root) => {
      if (git) await initializeArchiveGit(root);
      else await fs.writeFile(path.join(root, 'implementation.js'), 'export const result=true;');
      for (const [ref, content] of [
        ['docs/comet/specs/workflow/spec.md', '# Previous workflow\nOriginal workflow.\n'],
        ['docs/comet/specs/secondary/spec.md', '# Previous secondary\nOriginal secondary.\n'],
        [
          'docs/comet/changes/sdk-shape/specs/secondary/spec.md',
          '# Secondary\nApproved secondary.\n',
        ],
        ['docs/comet/changes/sdk-shape/specs/sessions/spec.md', '# Sessions\nApproved sessions.\n'],
      ]) {
        await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
        await fs.writeFile(path.join(root, ref), content);
      }
    },
  );
}
it.each(['interrupted-apply', 'foreign-finalize-capability'] as const)(
  'keeps all original capability operations and claims through current Archive %s',
  async (scenario) => {
    const f = await multiCapabilityArchive();
    let run = f.run;
    expect(
      (run.state as NativePortableState).spec_changes.map((c) => ({
        capability: c.capability,
        operation: c.operation,
      })),
    ).toEqual([
      { capability: 'secondary', operation: 'modify' },
      { capability: 'sessions', operation: 'create' },
      { capability: 'workflow', operation: 'modify' },
    ]);
    const originalWaits = structuredClone(run.waits);
    const transactionFile = path.join(
      f.paths.transactionsDir,
      'portable-archive-' + run.runId + '.json',
    );
    const originalApply = run.actions.at(-1)!;
    let firstStat;
    if (scenario === 'interrupted-apply') {
      const original = atomic.atomicWriteText;
      let hit = false;
      vi.spyOn(atomic, 'atomicWriteText').mockImplementation(async (file, text, options) => {
        if (!hit && file === path.join(f.paths.specsDir, 'sessions/spec.md')) {
          hit = true;
          throw Object.assign(new Error('Injected second capability write failure'), {
            code: 'EIO',
          });
        }
        return original(file, text, options);
      });
      await expect(
        f.runtime.execute({
          runId: run.runId,
          actionId: originalApply.id,
          executorId: 'comet-native-archive-apply',
          context: { projectRoot: f.root, requestId: 'actual-multi-op-apply' },
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
      expect(hit).toBe(true);
      vi.restoreAllMocks();
      run = await f.runtime.inspect(run.runId);
      expect(run.actions.at(-1)?.status).toBe('unknown');
      const saved = JSON.parse(await fs.readFile(transactionFile, 'utf8'));
      expect(saved.next_spec_index).toBe(1);
      firstStat = await fs.stat(path.join(f.paths.specsDir, 'secondary/spec.md'));
      const originalClaim = run.actions.at(-1)!.claim;
      expect(
        (
          await archiveNativeSdkChange({
            projectRoot: f.root,
            name: run.runId,
            dryRun: false,
            recover: true,
            confirmed: false,
          })
        ).exitCode,
      ).toBe(0);
      run = await f.runtime.inspect(run.runId);
      expect(run.actions.find((a) => a.id === originalApply.id)).toMatchObject({
        status: 'succeeded',
        claim: originalClaim,
      });
      expect((await fs.stat(path.join(f.paths.specsDir, 'secondary/spec.md'))).mtimeMs).toBe(
        firstStat.mtimeMs,
      );
    } else {
      run = await f.runtime.execute({
        runId: run.runId,
        actionId: originalApply.id,
        executorId: 'comet-native-archive-apply',
        context: { projectRoot: f.root, requestId: 'actual-multi-op-apply' },
      });
      const a = run.actions.at(-1)!;
      run = await f.runtime.claim({
        runId: run.runId,
        actionId: a.id,
        attempt: a.attempt,
        inputHash: a.inputHash,
        executorId: 'comet-native-archive-finalize',
        claimToken: 'original-multi-finalize',
        context: { projectRoot: f.root, requestId: 'actual-multi-finalize' },
      });
      run = await f.runtime.markUnknown({
        runId: run.runId,
        actionId: a.id,
        attempt: a.attempt,
        reason: 'SIMULATED interruption before original finalize result.',
      });
      const before = run.actions.at(-1),
        original = await fs.readFile(transactionFile, 'utf8'),
        j = JSON.parse(original);
      j.spec_changes[0].capability = 'foreign-secondary';
      const altered = JSON.stringify(j);
      await fs.writeFile(transactionFile, altered);
      await expectArchiveFailure(
        archiveNativeSdkChange({
          projectRoot: f.root,
          name: run.runId,
          dryRun: false,
          recover: true,
          confirmed: false,
        }),
        /Spec|transaction|事务/,
      );
      expect((await f.runtime.inspect(run.runId)).actions.at(-1)).toEqual(before);
      expect(await fs.readFile(transactionFile, 'utf8')).toBe(altered);
      await fs.writeFile(transactionFile, original);
      expect(
        (
          await archiveNativeSdkChange({
            projectRoot: f.root,
            name: run.runId,
            dryRun: false,
            recover: true,
            confirmed: false,
          })
        ).exitCode,
      ).toBe(0);
    }
    if ((await f.runtime.inspect(run.runId)).status !== 'completed')
      expect(
        (
          await archiveNativeSdkChange({
            projectRoot: f.root,
            name: run.runId,
            dryRun: false,
            recover: false,
            confirmed: false,
          })
        ).exitCode,
      ).toBe(0);
    const final = await f.runtime.inspect(run.runId);
    expect(final.status).toBe('completed');
    expect(final.waits).toEqual(originalWaits);
    expect(final.actions.filter((a) => a.stepId === 'archive.execute')).toHaveLength(1);
    for (const [cap, text] of [
      ['secondary', '# Secondary\nApproved secondary.\n'],
      ['sessions', '# Sessions\nApproved sessions.\n'],
      ['workflow', '# Workflow\nThe selected workflow resumes without losing confirmed work.\n'],
    ])
      expect(await fs.readFile(path.join(f.paths.specsDir, cap, 'spec.md'), 'utf8')).toBe(text);
  },
);
it.for(['untracked-update', 'non-git-update'])(
  'rejects a file symlink backup at the current Archive boundary (%s)',
  async (kind, context) => {
    await requireFileSymlink(context);
    const f = await multiCapabilityArchive(kind !== 'non-git-update');
    const run = await f.runtime.execute({
      runId: f.run.runId,
      actionId: f.run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-apply',
      context: { projectRoot: f.root, requestId: 'actual-backup-symlink-archive-apply' },
    });
    const transactionFile = path.join(
        f.paths.transactionsDir,
        'portable-archive-' + run.runId + '.json',
      ),
      transactionBefore = await fs.readFile(transactionFile, 'utf8'),
      j = JSON.parse(transactionBefore);
    const backup = path.join(f.root, 'original-specs.json'),
      link = path.join(f.root, 'linked-original-specs.json');
    await fs.writeFile(
      backup,
      JSON.stringify({
        schema: 'comet.native.archive-originals.v1',
        runId: run.runId,
        transactionId: j.id,
        files: [],
      }),
    );
    await fs.symlink(backup, link, 'file');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    const before = await f.runtime.inspect(run.runId);
    await expectArchiveFailure(
      archiveNativeSdkChange({
        projectRoot: f.root,
        name: run.runId,
        dryRun: false,
        recover: false,
        confirmed: false,
        legacySpecBackup: link,
      }),
      /symbolic|symlink|regular file/i,
    );
    expect(await f.runtime.inspect(run.runId)).toEqual(before);
    expect(await fs.readFile(transactionFile, 'utf8')).toBe(transactionBefore);
  },
);

it('rejects malformed original-backup inputs without changing the current Archive or blocking its normal continuation', async () => {
  const f = await multiCapabilityArchive();
  const run = await f.runtime.execute({
    runId: f.run.runId,
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { projectRoot: f.root, requestId: 'current-input-boundary-apply' },
  });
  const transactionFile = path.join(
      f.paths.transactionsDir,
      'portable-archive-' + run.runId + '.json',
    ),
    originalWal = await fs.readFile(transactionFile, 'utf8'),
    journal = JSON.parse(originalWal),
    file = path.join(f.root, 'original-input.json'),
    before = await f.runtime.inspect(run.runId),
    valid = {
      schema: 'comet.native.archive-originals.v1',
      runId: run.runId,
      transactionId: journal.id,
      files: [],
    };
  const call = (ref = file) =>
    archiveNativeSdkChange({
      projectRoot: f.root,
      name: run.runId,
      dryRun: false,
      recover: false,
      confirmed: false,
      legacySpecBackup: ref,
    });
  for (const invalid of [
    { ...valid, unknown: true },
    { ...valid, runId: 'foreign-run' },
    { ...valid, transactionId: 'foreign-transaction' },
    {
      ...valid,
      files: [
        { ref: 'docs/comet/specs/secondary/spec.md', content: 'old' },
        { ref: 'docs/comet/specs/secondary/spec.md', content: 'old' },
      ],
    },
  ]) {
    const text = JSON.stringify(invalid);
    await fs.writeFile(file, text);
    await expectArchiveFailure(call(), /schema|runId|transactionId|唯一 ref/);
    expect(await fs.readFile(file, 'utf8')).toBe(text);
    expect(await f.runtime.inspect(run.runId)).toEqual(before);
    expect(await fs.readFile(transactionFile, 'utf8')).toBe(originalWal);
  }
  await fs.writeFile(file, ' '.repeat(8 * 1024 * 1024 + 1));
  await expectArchiveFailure(call(), /JSON|Unexpected end/i);
  expect(await f.runtime.inspect(run.runId)).toEqual(before);
  await expectArchiveFailure(
    call('../outside-originals.json'),
    /path|relative|outside|escape|\.\./i,
  );
  expect(await fs.readFile(transactionFile, 'utf8')).toBe(originalWal);
  expect(await f.runtime.inspect(run.runId)).toEqual(before);
  expect(
    (
      await archiveNativeSdkChange({
        projectRoot: f.root,
        name: run.runId,
        dryRun: false,
        recover: false,
        confirmed: false,
      })
    ).exitCode,
  ).toBe(0);
  const completed = await f.runtime.inspect(run.runId);
  expect(completed.status).toBe('completed');
  expect(completed.waits).toEqual(before.waits);
  expect(completed.actions.filter((a) => a.stepId === 'archive.execute')).toHaveLength(1);
});

import { createNativeLegacyArchiveOverlay } from '../../../domains/comet-native/native-archive-legacy-overlay.js';
it.each(['escaping-ref', 'foreign-ref', 'invented-original'] as const)(
  'rejects %s in original materials of an actual published Archive WAL',
  async (kind) => {
    const frozen = JSON.parse(
      await fs.readFile(
        path.resolve(
          'test/fixtures/native-052-sdk-archive-upgrade/archive-finalize-running-before-move.json',
        ),
        'utf8',
      ),
    );
    const file = frozen.runtimeMaterials.files.find((f: { ref: string }) =>
      f.ref.replaceAll('\\', '/').startsWith('native/transactions/'),
    );
    const journal = JSON.parse(Buffer.from(file.bytesBase64, 'base64').toString('utf8'));
    expect(journal.spec_changes).toHaveLength(1);
    expect(journal.spec_changes[0]).toMatchObject({
      capability: 'workflow',
      operation: 'create',
      expected_target_hash: null,
    });
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'actual-published-originals-reader-'));
    roots.push(root);
    const paths = await nativeProjectPaths(root, 'docs');
    const before = JSON.stringify(journal),
      originalRun = JSON.stringify(frozen.run);
    const canonical = path
      .relative(root, path.join(paths.specsDir, 'workflow/spec.md'))
      .replaceAll('\\', '/');
    const valid = createNativeLegacyArchiveOverlay({
      paths,
      transaction: journal,
      originals: new Map(),
    });
    expect(valid.get(canonical)).toMatchObject({ text: null });
    const ref =
      kind === 'escaping-ref'
        ? '../escape/spec.md'
        : kind === 'foreign-ref'
          ? 'docs/comet/specs/extra/spec.md'
          : canonical;
    expect(() =>
      createNativeLegacyArchiveOverlay({
        paths,
        transaction: journal,
        originals: new Map([[ref, 'Invented original that was never present.']]),
      }),
    ).toThrow(kind === 'invented-original' ? /原本不存在/ : /不属于原 Archive 事务/);
    expect(JSON.stringify(journal)).toBe(before);
    expect(JSON.stringify(frozen.run)).toBe(originalRun);
    expect(await fs.readdir(root)).toEqual([]);
  },
);
