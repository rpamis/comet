import '../../helpers/isolated-agent-home.js';
import { spawnSync } from 'node:child_process';
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
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), {
    recursive: true,
  });
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
    workflow: {
      id: application.workflow.id,
      version: application.workflow.version,
    },
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
          acceptance: [
            {
              id: 'A1',
              result: 'passed',
              reason: 'Verified the selected workflow.',
            },
          ],
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

it('rejects an occupied Archive target before applying current SDK Specs or accepting done state', async () => {
  const f = await awaitingArchiveApplication('sdk', undefined, true),
    state = f.run.state as NativePortableState;
  const target = path.join(
    f.paths.archiveDir,
    state.verification!.completed_at.slice(0, 10) + '-' + state.name,
  );
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, 'user.txt'), 'original target');
  const before = await f.runtime.inspect(f.run.runId);
  const result = await archiveNativeSdkChange({
    projectRoot: f.root,
    name: f.run.runId,
    dryRun: false,
    recover: false,
    confirmed: false,
  });
  expect(result.exitCode).toBe(73);
  expect((await f.runtime.inspect(f.run.runId)).state).toEqual(before.state);
  expect(
    (await f.runtime.inspect(f.run.runId)).actions.some(
      (a) => a.stepId === 'archive.execute' && a.status === 'succeeded',
    ),
  ).toBe(false);
  await expect(fs.readFile(path.join(f.paths.specsDir, 'workflow/spec.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await fs.readFile(path.join(target, 'user.txt'), 'utf8')).toBe('original target');
});
