import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import * as nativeDomain from '../../../domains/comet-native/index.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { removeNativeWorkspaceConfig } from '../../../domains/comet-native/native-workspace-config.js';
import { nativeSupervisorStateFile } from '../../../domains/comet-native/native-supervisor-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  createMemoryRuntimeStore,
  createFileRuntimeStore,
  createRuntime,
  type DefineWorkflowOptions,
  type RuntimeValidator,
  type RuntimeStateValidator,
  type RuntimeExecutor,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../../../domains/engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

type NativeApplication = {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  validators: readonly RuntimeValidator[];
  stateValidators: readonly RuntimeStateValidator[];
  executors: readonly RuntimeExecutor[];
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-sdk-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
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

function nativeApplication(): NativeApplication {
  const define = (nativeDomain as Record<string, unknown>).defineNativeWorkflowApplication;
  expect(define).toBeTypeOf('function');
  return (define as () => NativeApplication)();
}

function collectProposal(
  paths: Awaited<ReturnType<typeof nativeProjectPaths>>,
  state: NativePortableState,
) {
  const collect = (nativeDomain as Record<string, unknown>).collectNativeSdkShapeProposal;
  expect(collect).toBeTypeOf('function');
  return (
    collect as (options: { paths: typeof paths; state: NativePortableState }) => Promise<unknown>
  )({ paths, state });
}

async function succeedLatestAction(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  output: unknown,
  root: string,
  receipt: string,
  sessionId?: string,
) {
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

async function preparedShape(storeKind: 'memory' | 'file' = 'memory') {
  const fixtureData = await fixture();
  const application = nativeApplication();
  const store =
    storeKind === 'file'
      ? createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(fixtureData.root, '.comet', 'runtime', 'sdk-runs'),
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
    runId: 'native-sdk-shape',
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name: 'sdk-shape', artifactRootRef: 'docs' },
    initialState: fixtureData.initialState,
  });
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
  storeKind: 'memory' | 'file' = 'memory',
) {
  const prepared = await preparedShape(storeKind);
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
    await collectProposal(paths, run.state as NativePortableState),
    root,
    'shape-revalidated',
  );
  run = await succeedLatestAction(
    runtime,
    run,
    {
      summary: 'Implemented the selected workflow.',
      addressedAcceptanceIds: ['A1'],
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: '2026-09-24T01:00:00.000Z',
      verificationChecks,
    },
    root,
    'builder-candidate',
    'builder-session-1',
  );
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-checks',
    context: { requestId: 'native-check-execution', projectRoot: root },
  });
  return { ...prepared, run };
}

async function awaitingArchiveApplication(storeKind: 'memory' | 'file' = 'memory') {
  const prepared = await dispatchedVerifier([], storeKind);
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
  for (const [executorId, requestId] of [
    ['comet-native-report', 'native-report'],
    ['comet-native-report-revalidate', 'native-report-revalidate'],
    ['comet-native-archive-preflight', 'native-archive-preflight'],
  ]) {
    if (run.waits.at(-1)?.stepId === 'verify.confirm' && run.waits.at(-1)?.status === 'pending') {
      const wait = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'verification-approved',
        choice: 'approved',
      });
    }
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { requestId, projectRoot: root },
    });
  }
  return { ...prepared, run };
}

async function awaitingArchiveFinalization(storeKind: 'memory' | 'file' = 'memory') {
  const prepared = await awaitingArchiveApplication(storeKind);
  const run = await prepared.runtime.execute({
    runId: prepared.run.runId,
    actionId: prepared.run.actions.at(-1)!.id,
    executorId: 'comet-native-archive-apply',
    context: { requestId: 'native-archive-apply', projectRoot: prepared.root },
  });
  return { ...prepared, run };
}

describe('Native SDK Workflow Application', () => {
  it('keeps the candidate and checks when a claimed Verifier execution fails, then waits after repeated failures', async () => {
    const { root, runtime, run: dispatched } = await dispatchedVerifier([], 'file');
    const candidateId = (dispatched.state as NativePortableState).builder_handoff!.candidate_id;
    let run = dispatched;
    for (let index = 1; index <= 3; index += 1) {
      const action = run.actions.at(-1)!;
      expect(action).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      const context = { requestId: `verifier-execution-failure-${index}`, projectRoot: root };
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId: `verifier-session-${index}`,
        claimToken: `verifier-claim-${index}`,
        context,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: claimed.actions.find((entry) => entry.id === action.id)!.claim!.token,
          outcomeId: `verifier-execution-failure-${index}`,
          status: 'failed',
          output: { summary: 'The host confirmed that the Verifier task failed.' },
        },
        context,
      });
      expect(run.state).toMatchObject({
        builder_handoff: { candidate_id: candidateId },
        loop: { execution_failure_count: index },
      });
      expect(run.outputs['verify.checks']).toMatchObject({ value: { candidateId } });
      if (index < 3) {
        expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
      }
    }
    expect(run.state).toMatchObject({ phase: 'verify', status: 'blocked' });
    expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.retry', status: 'pending' });
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'user-approved-verifier-retry',
      choice: 'retry',
    });
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'active',
      builder_handoff: { candidate_id: candidateId },
      loop: { execution_failure_count: 0 },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    run = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-4',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: (run.state as NativePortableState).loop.attempt,
            verdict: 'pass',
            acceptance: [
              { id: 'A1', result: 'passed', reason: 'The retry verified the workflow.' },
            ],
            risks: [],
            summary: 'The independent retry passed.',
          },
        },
      },
      root,
      'verifier-retry-result',
      'verifier-session-4',
    );
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
  });

  it('records document-backed Shape acceptance in the SDK Run before asking the user', async () => {
    const { run } = await preparedShape();
    expect(run.actions[0]).toMatchObject({ stepId: 'shape.prepare', type: 'call_tool' });
    expect(run.state).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      document_constraints_version: 1,
      acceptance: [{ source: 'brief.md', text: 'The selected workflow resumes.' }],
    });
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'shape.confirm',
      status: 'pending',
      choices: ['approved', 'rejected'],
    });
  });

  it('confirms a Supervisor child plan and coordination mode in the same SDK Run', async () => {
    const { root, paths, changeDir, initialState } = await fixture();
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: []
`,
    );
    const application = nativeApplication();
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    let run = await runtime.start({
      runId: 'supervisor-sdk-shape',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { name: 'sdk-shape', artifactRootRef: 'docs' },
      initialState,
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, initialState),
      root,
      'supervisor-shape-proposal',
    );
    const wait = run.waits.at(-1)!;
    expect(wait).toMatchObject({
      stepId: 'supervisor.shape.confirm',
      choices: ['multi-session', 'single-session', 'rejected'],
    });
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'supervisor-choice',
      choice: 'multi-session',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'supervisor-shape-revalidated',
    );
    expect(run.state).toMatchObject({
      phase: 'build',
      coordination_mode: 'multi-session',
      children_contract_hash: expect.any(String),
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.prepare',
      type: 'call_tool',
    });
  });

  it('repairs failed Supervisor Children and serializes integration after independent verification', async () => {
    const { root, paths, changeDir } = await fixture();
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: []
`,
    );
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', 'add', '-A'],
      {
        cwd: root,
        stdio: 'ignore',
      },
    );
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'baseline',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const initialState = createNativePortableState({
      name: 'sdk-shape',
      language: 'en',
      workspace: {
        isolation: 'current',
        change_branch: branch,
        target_branch: branch,
        finish: null,
      },
    });
    const application = nativeApplication();
    const createSupervisorRuntime = () =>
      createRuntime({
        store: createFileRuntimeStore<WorkflowRun>({
          rootDir: path.join(root, '.comet', 'runtime', 'sdk-runs', 'native'),
        }),
        workflows: [application.workflow],
        transitionHandlers: [application.transitionHandler],
        validators: application.validators,
        stateValidators: application.stateValidators,
        commandValidators: application.commandValidators,
        executors: application.executors,
      });
    let runtime = createSupervisorRuntime();
    let run = await runtime.start({
      runId: 'supervisor-sdk-build',
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { name: 'sdk-shape', artifactRootRef: 'docs' },
      initialState,
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, initialState),
      root,
      'shape-plan',
    );
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'use-multi-session',
      choice: 'multi-session',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-current',
    );
    const prepare = run.actions.at(-1)!;
    expect(prepare.stepId).toBe('supervisor.prepare');
    run = await runtime.execute({
      runId: run.runId,
      actionId: prepare.id,
      executorId: 'native-supervisor-prepare',
      context: { requestId: 'prepare-integration', projectRoot: root },
    });
    const preparations = run.actions.filter(
      (action) => action.stepId === 'supervisor.child.prepare',
    );
    expect(
      preparations.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).toEqual(['api', 'ui']);
    for (const action of preparations) {
      run = await runtime.execute({
        runId: run.runId,
        actionId: action.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: `prepare-${action.id}`, projectRoot: root },
      });
    }
    const builders = run.actions.filter((action) => action.stepId === 'supervisor.child.builder');
    expect(builders).toHaveLength(2);
    expect(
      builders.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).toEqual(['api', 'ui']);
    expect(
      builders.map(
        (action) => (action.input as { activation: { worktree: string } }).activation.worktree,
      ),
    ).toEqual([
      path.join(root, '.worktrees', 'sdk-shape-api'),
      path.join(root, '.worktrees', 'sdk-shape-ui'),
    ]);
    await expect(fs.access(nativeSupervisorStateFile(paths, 'sdk-shape'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    let lateUiCandidateCommit: string | null = null;
    async function reportChildAction(
      action: (typeof run.actions)[number],
      output: unknown,
      receipt: string,
      sessionId: string,
    ) {
      const context = { requestId: receipt, projectRoot: root };
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId,
        claimToken: receipt,
        context,
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: claimed.actions.find((candidate) => candidate.id === action.id)!.claim!.token,
          outcomeId: receipt,
          status: 'succeeded',
          output,
        },
        context,
      });
    }
    for (const child of ['api', 'ui']) {
      const childWorktree = path.join(root, '.worktrees', `sdk-shape-${child}`);
      await fs.writeFile(path.join(childWorktree, `${child}.txt`), `${child} implemented\n`);
      await fs.writeFile(path.join(childWorktree, 'shared.txt'), `${child} implementation\n`);
      execFileSync('git', ['add', `${child}.txt`, 'shared.txt'], {
        cwd: childWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          `${child} candidate`,
        ],
        { cwd: childWorktree, stdio: 'ignore' },
      );
      let candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: childWorktree,
        encoding: 'utf8',
      }).trim();
      const childAction = (stepId: string) =>
        run.actions.find(
          (action) =>
            action.stepId === stepId &&
            action.status === 'pending' &&
            (action.input as { activation?: { child?: string } }).activation?.child === child,
        )!;
      await reportChildAction(
        childAction('supervisor.child.builder'),
        {
          candidateCommit,
          verificationChecks: [
            {
              id: `${child}-check`,
              name: `${child} check`,
              executable: process.execPath,
              argv: ['-e', child === 'api' ? 'process.exit(1)' : 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        `${child}-builder-result`,
        `${child}-builder-session`,
      );
      const check = childAction('supervisor.child.checks');
      run = await runtime.execute({
        runId: run.runId,
        actionId: check.id,
        executorId: 'comet-native-checks',
        context: { requestId: `${child}-checks`, projectRoot: root },
      });
      if (child === 'api') {
        expect(run.actions.find((action) => action.id === check.id)?.status).toBe('failed');
        expect(childAction('supervisor.child.builder')).toMatchObject({
          input: {
            activation: {
              child: 'api',
              worktree: childWorktree,
              failedCheckActionId: check.id,
            },
          },
        });
        await fs.appendFile(path.join(childWorktree, 'api.txt'), 'API check repaired\n');
        execFileSync('git', ['add', 'api.txt'], { cwd: childWorktree, stdio: 'ignore' });
        execFileSync(
          'git',
          [
            '-c',
            'user.name=Comet Test',
            '-c',
            'user.email=comet-test@example.com',
            'commit',
            '-m',
            'repair api',
          ],
          { cwd: childWorktree, stdio: 'ignore' },
        );
        candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: childWorktree,
          encoding: 'utf8',
        }).trim();
        await reportChildAction(
          childAction('supervisor.child.builder'),
          {
            candidateCommit,
            verificationChecks: [
              {
                id: 'api-repair-check',
                name: 'API repair check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
          'api-repair-builder-result',
          'api-repair-builder-session',
        );
        run = await runtime.execute({
          runId: run.runId,
          actionId: childAction('supervisor.child.checks').id,
          executorId: 'comet-native-checks',
          context: { requestId: 'api-repair-checks', projectRoot: root },
        });
      }
      if (child === 'ui') {
        const failedVerifier = childAction('supervisor.child.verifier');
        await reportChildAction(
          failedVerifier,
          {
            candidateCommit,
            verdict: 'fail',
            evidence: {
              summary: 'The UI still misses the acceptance example.',
              checks: ['ui-check'],
              acceptance: [
                { id: 'child:ui', result: 'failed', reason: 'The UI behavior is incomplete.' },
              ],
            },
          },
          'ui-verifier-failed',
          'ui-verifier-failed-session',
        );
        expect(childAction('supervisor.child.builder')).toMatchObject({
          input: {
            activation: {
              child: 'ui',
              worktree: childWorktree,
              failedVerifierActionId: failedVerifier.id,
            },
          },
        });
        await fs.appendFile(path.join(childWorktree, 'ui.txt'), 'UI acceptance repaired\n');
        execFileSync('git', ['add', 'ui.txt'], { cwd: childWorktree, stdio: 'ignore' });
        execFileSync(
          'git',
          [
            '-c',
            'user.name=Comet Test',
            '-c',
            'user.email=comet-test@example.com',
            'commit',
            '-m',
            'repair ui',
          ],
          { cwd: childWorktree, stdio: 'ignore' },
        );
        candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: childWorktree,
          encoding: 'utf8',
        }).trim();
        await reportChildAction(
          childAction('supervisor.child.builder'),
          {
            candidateCommit,
            verificationChecks: [
              {
                id: 'ui-repair-check',
                name: 'UI repair check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
          'ui-repair-builder-result',
          'ui-repair-builder-session',
        );
        run = await runtime.execute({
          runId: run.runId,
          actionId: childAction('supervisor.child.checks').id,
          executorId: 'comet-native-checks',
          context: { requestId: 'ui-repair-checks', projectRoot: root },
        });
      }
      if (child === 'ui') {
        lateUiCandidateCommit = candidateCommit;
        continue;
      }
      await reportChildAction(
        childAction('supervisor.child.verifier'),
        {
          candidateCommit,
          verdict: 'pass',
          integrationChecks: [
            {
              id: `${child}-integration`,
              name: `${child} integration check`,
              executable: process.execPath,
              argv: ['-e', child === 'api' ? 'process.exit(1)' : 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
          evidence: {
            summary: `Independent ${child} review passed.`,
            checks: [child === 'ui' ? 'ui-repair-check' : 'api-repair-check'],
            acceptance: [{ id: `child:${child}`, result: 'passed', reason: `Reviewed ${child}.` }],
          },
        },
        `${child}-verifier-result`,
        `${child}-verifier-session`,
      );
    }
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(1);
    const firstIntegration = run.actions.find(
      (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: firstIntegration.id,
      executorId: 'native-supervisor-integrate',
      context: { requestId: 'first-integration', projectRoot: root },
    });
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(0);
    const firstChecks = run.actions.find(
      (action) =>
        action.stepId === 'supervisor.child.integration-checks' && action.status === 'pending',
    )!;
    run = await runtime.execute({
      runId: run.runId,
      actionId: firstChecks.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'first-integration-checks', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === firstChecks.id)?.status).toBe('failed');
    const pendingRepair = run.actions.at(-1)!;
    expect(pendingRepair).toMatchObject({
      stepId: 'supervisor.child.integration-repair',
      status: 'pending',
    });
    expect(lateUiCandidateCommit).toMatch(/^[a-f0-9]{40}$/u);
    const lateUiVerifier = run.actions.find(
      (action) =>
        action.stepId === 'supervisor.child.verifier' &&
        action.status === 'pending' &&
        (action.input as { activation?: { child?: string } }).activation?.child === 'ui',
    )!;
    await reportChildAction(
      lateUiVerifier,
      {
        candidateCommit: lateUiCandidateCommit,
        verdict: 'pass',
        integrationChecks: [
          {
            id: 'ui-integration',
            name: 'UI integration check',
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
        evidence: {
          summary: 'Independent UI review passed.',
          checks: ['ui-repair-check'],
          acceptance: [{ id: 'child:ui', result: 'passed', reason: 'Reviewed UI.' }],
        },
      },
      'late-ui-verifier-result',
      'late-ui-verifier-session',
    );
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(0);
    const integrationWorktree = path.join(root, '.worktrees', 'sdk-shape-integration');
    await fs.writeFile(path.join(integrationWorktree, 'integration-repair.txt'), 'repaired\n');
    execFileSync('git', ['add', 'integration-repair.txt'], {
      cwd: integrationWorktree,
      stdio: 'ignore',
    });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'repair integration',
      ],
      { cwd: integrationWorktree, stdio: 'ignore' },
    );
    const repairCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const repair = run.actions.find((action) => action.id === pendingRepair.id)!;
    await reportChildAction(
      repair,
      {
        summary: 'Repaired the integration check.',
        integrationCommit: repairCommit,
        integrationChecks: [
          {
            id: 'api-integration-repair',
            name: 'API integration repair check',
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef: '.',
            timeoutMs: 10000,
            repeatable: true,
          },
        ],
      },
      'integration-repair-result',
      'integration-repair-session',
    );
    const repairedCheck = run.actions.at(-1)!;
    expect(repairedCheck).toMatchObject({ stepId: 'supervisor.child.integration-checks' });
    run = await runtime.execute({
      runId: run.runId,
      actionId: repairedCheck.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'integration-repair-checks', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === repairedCheck.id)?.status).toBe('succeeded');
    expect(
      run.actions.filter(
        (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
      ),
    ).toHaveLength(1);
    const uiIntegration = run.actions.find(
      (action) => action.stepId === 'supervisor.child.integrate' && action.status === 'pending',
    )!;
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const integrationBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const driftCommit = execFileSync(
      'git',
      ['commit-tree', `${baseCommit}^{tree}`, '-p', baseCommit, '-m', 'unexpected branch drift'],
      { cwd: integrationWorktree, encoding: 'utf8' },
    ).trim();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, driftCommit, baseCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: uiIntegration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'ui-integration-drift', projectRoot: root },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    expect(() =>
      execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      }),
    ).toThrow();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, baseCommit, driftCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    run = await runtime.retry({
      runId: run.runId,
      actionId: uiIntegration.id,
      attempt: uiIntegration.attempt,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { branchHead: baseCommit, mergeHeadAbsent: true },
      },
    });
    await expect(
      runtime.execute({
        runId: run.runId,
        actionId: uiIntegration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'ui-integration-conflict', projectRoot: root },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    runtime = createSupervisorRuntime();
    run = await runtime.inspect(run.runId);
    const conflicted = run.actions.find((action) => action.id === uiIntegration.id)!;
    expect(conflicted.status).toBe('unknown');
    expect(
      execFileSync('git', ['rev-parse', 'MERGE_HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim(),
    ).toBe(lateUiCandidateCommit);
    await fs.writeFile(path.join(integrationWorktree, 'shared.txt'), 'API and UI integrated\n');
    execFileSync('git', ['add', 'shared.txt'], { cwd: integrationWorktree, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet-test@example.com',
        'commit',
        '-m',
        'resolve UI integration',
      ],
      { cwd: integrationWorktree, stdio: 'ignore' },
    );
    const mergedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: integrationWorktree,
      encoding: 'utf8',
    }).trim();
    const forgedMerge = execFileSync(
      'git',
      [
        'commit-tree',
        `${mergedCommit}^{tree}`,
        '-p',
        driftCommit,
        '-p',
        lateUiCandidateCommit!,
        '-m',
        'merge on unverified base',
      ],
      { cwd: integrationWorktree, encoding: 'utf8' },
    ).trim();
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, forgedMerge, mergedCommit],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    await expect(
      runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: conflicted.id,
          attempt: conflicted.attempt,
          inputHash: conflicted.inputHash,
          claimToken: conflicted.claim!.token,
          outcomeId: 'ui-integration-wrong-base',
          status: 'succeeded',
          output: {
            child: 'ui',
            candidateCommit: lateUiCandidateCommit,
            baseCommit: driftCommit,
            integrationCommit: forgedMerge,
            integrationBranch,
            integrationWorktree,
          },
        },
        context: { requestId: 'ui-integration-wrong-base', projectRoot: root },
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    execFileSync(
      'git',
      ['update-ref', `refs/heads/${integrationBranch}`, mergedCommit, forgedMerge],
      {
        cwd: integrationWorktree,
        stdio: 'ignore',
      },
    );
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: conflicted.id,
        attempt: conflicted.attempt,
        inputHash: conflicted.inputHash,
        claimToken: conflicted.claim!.token,
        outcomeId: 'ui-integration-resolved',
        status: 'succeeded',
        output: {
          child: 'ui',
          candidateCommit: lateUiCandidateCommit,
          baseCommit,
          integrationCommit: mergedCommit,
          integrationBranch,
          integrationWorktree,
        },
      },
      context: { requestId: 'ui-integration-resolved', projectRoot: root },
    });
    expect(run.actions.find((action) => action.id === uiIntegration.id)?.status).toBe('succeeded');
    const finalChecks = run.actions.at(-1)!;
    expect(finalChecks.stepId).toBe('supervisor.child.integration-checks');
    run = await runtime.execute({
      runId: run.runId,
      actionId: finalChecks.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'ui-integration-checks', projectRoot: root },
    });
    expect(run.actions.at(-1)?.stepId).toBe('supervisor.parent.builder');
  });

  it.each([
    'normal',
    'partial-recovery',
    'branch-lock-recovery',
    'delivery-recovery',
    'target-drift',
  ] as const)(
    'handles parent repair, delivery, and cleanup after Supervisor DAG restart (%s)',
    async (scenario) => {
      const { root, paths, changeDir } = await fixture();
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        `schema: comet.native.children.v2
children:
  - name: api
    summary: Build the API
    depends_on: []
  - name: ui
    summary: Build the UI
    depends_on: [api]
`,
      );
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Comet Test'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'comet-test@example.com'], {
        cwd: root,
        stdio: 'ignore',
      });
      execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'baseline',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      const initialState = createNativePortableState({
        name: 'sdk-shape',
        language: 'en',
        workspace: {
          isolation: 'current',
          change_branch: branch,
          target_branch: branch,
          finish: null,
        },
      });
      const application = nativeApplication();
      const createSupervisorRuntime = () =>
        createRuntime({
          store: createFileRuntimeStore<WorkflowRun>({
            rootDir: path.join(root, '.comet', 'runtime', 'sdk-runs', 'native'),
          }),
          workflows: [application.workflow],
          transitionHandlers: [application.transitionHandler],
          validators: application.validators,
          stateValidators: application.stateValidators,
          commandValidators: application.commandValidators,
          executors: application.executors,
        });
      let runtime = createSupervisorRuntime();
      let run = await runtime.start({
        runId: 'sdk-shape',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState,
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, initialState),
        root,
        'candidate-shape-plan',
      );
      const wait = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'candidate-multi-session',
        choice: 'multi-session',
      });
      run = await succeedLatestAction(
        runtime,
        run,
        await collectProposal(paths, run.state as NativePortableState),
        root,
        'candidate-shape-current',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-prepare',
        context: { requestId: 'candidate-integration', projectRoot: root },
      });
      const childPrepare = run.actions.find(
        (action) => action.stepId === 'supervisor.child.prepare',
      )!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: childPrepare.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: 'candidate-child', projectRoot: root },
      });
      const builder = run.actions.find((action) => action.stepId === 'supervisor.child.builder')!;
      const childWorktree = path.join(root, '.worktrees', 'sdk-shape-api');
      await fs.writeFile(path.join(childWorktree, 'api.txt'), 'API implemented\n');
      await fs.mkdir(path.join(childWorktree, 'api-subdir'));
      await fs.writeFile(path.join(childWorktree, 'api-subdir', 'marker.txt'), 'ready\n');
      execFileSync('git', ['add', 'api.txt', 'api-subdir/marker.txt'], {
        cwd: childWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'api candidate',
        ],
        { cwd: childWorktree, stdio: 'ignore' },
      );
      const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: childWorktree,
        encoding: 'utf8',
      }).trim();
      const claimed = await runtime.claim({
        runId: run.runId,
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        executorId: 'native-host',
        sessionId: 'builder-api-session',
        claimToken: 'builder-api-claim',
        context: { requestId: 'builder-api-claim', projectRoot: root },
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: builder.id,
          attempt: builder.attempt,
          inputHash: builder.inputHash,
          claimToken: claimed.actions.find((action) => action.id === builder.id)!.claim!.token,
          outcomeId: 'builder-api-result',
          status: 'succeeded',
          output: {
            candidateCommit,
            verificationChecks: [
              {
                id: 'api-check',
                name: 'API candidate check',
                executable: process.execPath,
                argv: ['-e', 'process.exit(0)'],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
        },
        context: { requestId: 'builder-api-result', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.checks',
        type: 'call_tool',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-check-execution', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.verifier',
        type: 'handoff',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      const verifier = run.actions.at(-1)!;
      const verifierClaim = await runtime.claim({
        runId: run.runId,
        actionId: verifier.id,
        attempt: verifier.attempt,
        inputHash: verifier.inputHash,
        executorId: 'native-host',
        sessionId: 'verifier-api-session',
        claimToken: 'verifier-api-claim',
        context: { requestId: 'verifier-api-claim', projectRoot: root },
      });
      run = await runtime.recordOutcome({
        runId: run.runId,
        outcome: {
          actionId: verifier.id,
          attempt: verifier.attempt,
          inputHash: verifier.inputHash,
          claimToken: verifierClaim.actions.find((action) => action.id === verifier.id)!.claim!
            .token,
          outcomeId: 'verifier-api-result',
          status: 'succeeded',
          output: {
            candidateCommit,
            verdict: 'pass',
            integrationChecks: [
              {
                id: 'api-integration',
                name: 'API integration check',
                executable: process.execPath,
                argv: [
                  '-e',
                  "const fs=require('node:fs');if(fs.readFileSync('marker.txt','utf8').trim()!=='repaired')process.exit(1)",
                ],
                cwdRef: 'api-subdir',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
            evidence: {
              summary: 'Independent API review passed.',
              checks: ['api-check'],
              acceptance: [
                { id: 'child:api', result: 'passed', reason: 'Reviewed the API behavior.' },
              ],
            },
          },
        },
        context: { requestId: 'verifier-api-result', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integrate',
        type: 'call_tool',
        input: { activation: { child: 'api', candidateCommit, worktree: childWorktree } },
      });
      const integration = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: integration.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'integrate-api', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === integration.id)).toMatchObject({
        status: 'succeeded',
        outcome: {
          output: { child: 'api', candidateCommit, integrationCommit: expect.any(String) },
        },
      });
      const integrationWorktree = path.join(root, '.worktrees', 'sdk-shape-integration');
      expect(() =>
        execFileSync('git', ['merge-base', '--is-ancestor', candidateCommit, 'HEAD'], {
          cwd: integrationWorktree,
          stdio: 'ignore',
        }),
      ).not.toThrow();
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-checks',
        type: 'call_tool',
      });
      const integrationChecks = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: integrationChecks.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-integration-checks', projectRoot: root },
      });
      expect(run.actions.find((action) => action.id === integrationChecks.id)).toMatchObject({
        status: 'failed',
        outcome: { output: { checks: [{ id: 'api-integration', status: 'failed' }] } },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-repair',
        type: 'handoff',
        input: { activation: { child: 'api', failedCheckActionId: integrationChecks.id } },
      });
      await fs.writeFile(path.join(integrationWorktree, 'api-subdir', 'marker.txt'), 'repaired\n');
      execFileSync('git', ['add', 'api-subdir/marker.txt'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'repair api integration',
        ],
        { cwd: integrationWorktree, stdio: 'ignore' },
      );
      const integrationRepairCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Fixed API integration behavior.',
          integrationCommit: integrationRepairCommit,
          integrationChecks: [
            {
              id: 'api-integration',
              name: 'API integration check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(fs.readFileSync('marker.txt','utf8').trim()!=='repaired')process.exit(1)",
              ],
              cwdRef: 'api-subdir',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'api-integration-repair-result',
        'api-integration-repair-session',
      );
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.integration-checks',
        input: {
          activation: {
            child: 'api',
            integrationCommit: integrationRepairCommit,
            repairActionId: expect.any(String),
          },
        },
      });
      const repairedIntegrationChecks = run.actions.at(-1)!;
      run = await runtime.execute({
        runId: run.runId,
        actionId: repairedIntegrationChecks.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'api-integration-repair-checks', projectRoot: root },
      });
      expect(
        run.actions.find((action) => action.id === repairedIntegrationChecks.id),
      ).toMatchObject({
        status: 'succeeded',
        outcome: { output: { checks: [{ id: 'api-integration', status: 'passed' }] } },
      });
      const integratedHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.prepare',
        type: 'call_tool',
        input: { activation: { child: 'ui', targetCommit: integratedHead } },
      });
      runtime = createSupervisorRuntime();
      run = await runtime.inspect(run.runId);
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.child.prepare',
        status: 'pending',
        input: { activation: { child: 'ui', targetCommit: integratedHead } },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-child-prepare',
        context: { requestId: 'prepare-ui', projectRoot: root },
      });
      const uiWorktree = path.join(root, '.worktrees', 'sdk-shape-ui');
      await fs.writeFile(path.join(uiWorktree, 'ui.txt'), 'UI implemented\n');
      execFileSync('git', ['add', 'ui.txt'], { cwd: uiWorktree, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'ui candidate'], { cwd: uiWorktree, stdio: 'ignore' });
      const uiCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: uiWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateCommit: uiCommit,
          verificationChecks: [
            {
              id: 'ui-check',
              name: 'UI candidate check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'ui-builder-result',
        'builder-ui-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'ui-checks', projectRoot: root },
      });
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateCommit: uiCommit,
          verdict: 'pass',
          integrationChecks: [
            {
              id: 'ui-integration',
              name: 'UI integration check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
          evidence: {
            summary: 'Independent UI review passed.',
            checks: ['ui-check'],
            acceptance: [{ id: 'child:ui', result: 'passed', reason: 'Reviewed UI behavior.' }],
          },
        },
        root,
        'ui-verifier-result',
        'verifier-ui-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'native-supervisor-integrate',
        context: { requestId: 'integrate-ui', projectRoot: root },
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'ui-integration-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: { activation: { integrationCommit: expect.any(String) } },
      });
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Integrated API and UI candidates.',
          addressedAcceptanceIds: ['A1'],
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T04:00:00.000Z',
          verificationChecks: [
            {
              id: 'parent-check',
              name: 'Parent integration check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('api.txt')||!fs.existsSync('ui.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-builder-result',
        'parent-builder-session',
      );
      expect(run.state).toMatchObject({
        phase: 'verify',
        builder_handoff: { builder_execution_ref: 'parent-builder-session' },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', type: 'handoff' });
      const parentCandidateId = (run.state as NativePortableState).builder_handoff!.candidate_id;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: parentCandidateId,
          verifierExecutionRef: 'parent-verifier-session',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [
              {
                id: 'parent-extra',
                name: 'Verifier-requested parent check',
                executable: process.execPath,
                argv: [
                  '-e',
                  "const fs=require('node:fs');if(!fs.existsSync('api.txt')||!fs.existsSync('ui.txt'))process.exit(1)",
                ],
                cwdRef: '.',
                timeoutMs: 10000,
                repeatable: true,
              },
            ],
          },
        },
        root,
        'parent-verifier-request',
        'parent-verifier-session',
      );
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.requested-checks' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-extra-check', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
      const failedParentVerifier = run.actions.at(-1)!;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: parentCandidateId,
          verifierExecutionRef: 'parent-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'fail',
              acceptance: [
                { id: 'A1', result: 'failed', reason: 'The parent integration needs a repair.' },
              ],
              risks: [],
              summary: 'Repair the parent integration before delivery.',
            },
          },
        },
        root,
        'parent-verifier-failed',
        'parent-verifier-session',
      );
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: { activation: { failedVerifierActionId: failedParentVerifier.id } },
      });
      await fs.writeFile(path.join(integrationWorktree, 'parent-repair.txt'), 'Parent repaired\n');
      execFileSync('git', ['add', 'parent-repair.txt'], {
        cwd: integrationWorktree,
        stdio: 'ignore',
      });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet-test@example.com',
          'commit',
          '-m',
          'repair parent integration',
        ],
        { cwd: integrationWorktree, stdio: 'ignore' },
      );
      const repairedCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationWorktree,
        encoding: 'utf8',
      }).trim();
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Repaired the parent integration.',
          addressedAcceptanceIds: ['A1'],
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T05:00:00.000Z',
          candidateCommit: repairedCommit,
          verificationChecks: [
            {
              id: 'parent-repair-check',
              name: 'Parent repair check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('parent-repair.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-repair-builder-result',
        'parent-repair-builder-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-repair-checks', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
      const repairedState = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: repairedState.builder_handoff!.candidate_id,
          verifierExecutionRef: 'parent-repair-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: repairedState.loop.iteration,
              attempt: repairedState.loop.attempt,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'API and UI work together.' }],
              risks: [],
              summary: 'Parent integration passed independent verification.',
            },
          },
        },
        root,
        'parent-verifier-result',
        'parent-repair-verifier-session',
      );
      expect(run.state).toMatchObject({
        phase: 'verify',
        status: 'await-user',
        verification_result: 'pass',
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', type: 'call_tool' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'parent-report', projectRoot: root },
      });
      expect(run.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
      const rejectedConfirmation = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: rejectedConfirmation.id,
        proposalHash: rejectedConfirmation.proposalHash,
        decisionId: 'parent-user-rejected',
        choice: 'rejected',
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.builder',
        type: 'handoff',
        input: {
          activation: {
            integrationCommit: repairedCommit,
            rejectedDecisionId: 'parent-user-rejected',
          },
        },
      });
      run = await succeedLatestAction(
        runtime,
        run,
        {
          summary: 'Updated the parent candidate after user feedback.',
          addressedAcceptanceIds: ['A1'],
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-09-26T06:00:00.000Z',
          candidateCommit: repairedCommit,
          verificationChecks: [
            {
              id: 'parent-final-check',
              name: 'Parent final check',
              executable: process.execPath,
              argv: [
                '-e',
                "const fs=require('node:fs');if(!fs.existsSync('parent-repair.txt'))process.exit(1)",
              ],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
        root,
        'parent-final-builder-result',
        'parent-final-builder-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-checks',
        context: { requestId: 'parent-final-checks', projectRoot: root },
      });
      const finalParentState = run.state as NativePortableState;
      run = await succeedLatestAction(
        runtime,
        run,
        {
          candidateId: finalParentState.builder_handoff!.candidate_id,
          verifierExecutionRef: 'parent-final-verifier-session',
          response: {
            kind: 'final-result',
            result: {
              iteration: finalParentState.loop.iteration,
              attempt: finalParentState.loop.attempt,
              verdict: 'pass',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Final parent candidate passed.' },
              ],
              risks: [],
              summary: 'Final parent candidate passed independent verification.',
            },
          },
        },
        root,
        'parent-final-verifier-result',
        'parent-final-verifier-session',
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report',
        context: { requestId: 'parent-final-report', projectRoot: root },
      });
      const parentConfirmation = run.waits.at(-1)!;
      run = await runtime.resolveWait({
        runId: run.runId,
        waitId: parentConfirmation.id,
        proposalHash: parentConfirmation.proposalHash,
        decisionId: 'parent-verification-approved',
        choice: 'approved',
      });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-report-revalidate',
        context: { requestId: 'parent-report-revalidate', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.parent.deliver',
        type: 'call_tool',
      });
      if (scenario === 'target-drift') {
        const approvedTargetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        execFileSync('git', ['commit', '--allow-empty', '-m', 'drift before delivery'], {
          cwd: root,
          stdio: 'ignore',
        });
        const concurrentTargetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        expect(concurrentTargetCommit).not.toBe(approvedTargetCommit);
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: run.actions.at(-1)!.id,
            executorId: 'native-supervisor-parent-deliver',
            context: { requestId: 'parent-delivery-after-target-drift', projectRoot: root },
          }),
        ).rejects.toThrow(/已保留执行归属/);
        const blockedDelivery = await runtime.inspect(run.runId);
        expect(blockedDelivery.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.parent.deliver',
          status: 'unknown',
          reason: expect.stringMatching(/target branch changed after Shape confirmation/),
        });
        expect(
          execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        ).toBe(concurrentTargetCommit);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recoverDelivery = () =>
          nativeDomain.runNativeCliDetailed([
            'archive',
            'sdk-shape',
            '--recover',
            '--json',
            '--project-root',
            root,
          ]);
        const driftedRecovery = await recoverDelivery();
        expect(driftedRecovery.dispatch.exitCode).not.toBe(0);
        expect(driftedRecovery.dispatch.error?.message).toMatch(/target branch changed/);
        execFileSync(
          'git',
          ['update-ref', `refs/heads/${branch}`, approvedTargetCommit, concurrentTargetCommit],
          { cwd: root, stdio: 'ignore' },
        );
        const notDeliveredRecovery = await recoverDelivery();
        expect(notDeliveredRecovery.dispatch.exitCode).not.toBe(0);
        expect(notDeliveredRecovery.dispatch.error?.message).toMatch(/has not received/);
        expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
        return;
      }
      if (scenario === 'delivery-recovery') {
        const deliveryAction = run.actions.at(-1)!;
        const deliveryContext = { requestId: 'parent-delivery', projectRoot: root };
        const claimedDelivery = await runtime.claim({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: deliveryAction.attempt,
          inputHash: deliveryAction.inputHash,
          executorId: 'native-supervisor-parent-deliver',
          claimToken: 'parent-delivery-owner',
          context: deliveryContext,
        });
        const deliveryExecutor = application.executors.find(
          (executor) => executor.id === 'native-supervisor-parent-deliver',
        )!;
        const delivered = await deliveryExecutor.execute(
          claimedDelivery.actions.at(-1)!,
          deliveryContext,
          claimedDelivery,
        );
        expect(delivered.status).toBe('succeeded');
        await runtime.markUnknown({
          runId: run.runId,
          actionId: deliveryAction.id,
          attempt: deliveryAction.attempt,
          reason: 'Host stopped after fast-forward delivery',
        });
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      } else {
        run = await runtime.execute({
          runId: run.runId,
          actionId: run.actions.at(-1)!.id,
          executorId: 'native-supervisor-parent-deliver',
          context: { requestId: 'parent-delivery', projectRoot: root },
        });
      }
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', type: 'call_tool' });
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      ).toBe(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: integrationWorktree,
          encoding: 'utf8',
        }).trim(),
      );
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-preflight',
        context: { requestId: 'parent-archive-preflight', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.execute' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-apply',
        context: { requestId: 'parent-archive-apply', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize' });
      run = await runtime.execute({
        runId: run.runId,
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-native-archive-finalize',
        context: { requestId: 'parent-archive-finalize', projectRoot: root },
      });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'supervisor.cleanup',
        type: 'call_tool',
      });
      const cleanupAction = run.actions.at(-1)!;
      if (scenario === 'normal' || scenario === 'delivery-recovery') {
        run = await runtime.execute({
          runId: run.runId,
          actionId: cleanupAction.id,
          executorId: 'native-supervisor-cleanup',
          context: { requestId: 'parent-cleanup', projectRoot: root },
        });
      } else if (scenario === 'branch-lock-recovery') {
        const branchLock = path.join(
          root,
          '.git',
          'refs',
          'heads',
          'comet',
          'supervisor',
          'sdk-shape',
          'api.lock',
        );
        await fs.mkdir(path.dirname(branchLock), { recursive: true });
        await fs.writeFile(branchLock, 'Simulated concurrent Git ref update.\n');
        await expect(
          runtime.execute({
            runId: run.runId,
            actionId: cleanupAction.id,
            executorId: 'native-supervisor-cleanup',
            context: { requestId: 'parent-cleanup-with-ref-lock', projectRoot: root },
          }),
        ).rejects.toThrow(/已保留执行归属/);
        const interrupted = await runtime.inspect(run.runId);
        expect(interrupted.actions.at(-1)).toMatchObject({
          stepId: 'supervisor.cleanup',
          status: 'unknown',
          reason: expect.stringMatching(/lock/),
        });
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).not.toContain(integrationWorktree.replaceAll('\\', '/'));
        expect(
          execFileSync('git', ['branch', '--list', 'comet/supervisor/sdk-shape/api'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
        ).toBe('comet/supervisor/sdk-shape/api');
        await fs.unlink(branchLock);
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      } else {
        const cleanupContext = { requestId: 'parent-cleanup', projectRoot: root };
        const claimedCleanup = await runtime.claim({
          runId: run.runId,
          actionId: cleanupAction.id,
          attempt: cleanupAction.attempt,
          inputHash: cleanupAction.inputHash,
          executorId: 'native-supervisor-cleanup',
          claimToken: 'parent-cleanup-owner',
          context: cleanupContext,
        });
        const cleanupExecutor = application.executors.find(
          (executor) => executor.id === 'native-supervisor-cleanup',
        )!;
        const deliveredCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        execFileSync('git', ['commit', '--allow-empty', '-m', 'simulate target drift'], {
          cwd: root,
          stdio: 'ignore',
        });
        const driftCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        await expect(
          cleanupExecutor.execute(claimedCleanup.actions.at(-1)!, cleanupContext, claimedCleanup),
        ).rejects.toThrow(/verified delivery/);
        execFileSync('git', ['update-ref', `refs/heads/${branch}`, deliveredCommit, driftCommit], {
          cwd: root,
          stdio: 'ignore',
        });
        const untracked = path.join(integrationWorktree, 'preserve-user-work.txt');
        await fs.writeFile(untracked, 'Do not remove this worktree.\n');
        await expect(
          cleanupExecutor.execute(claimedCleanup.actions.at(-1)!, cleanupContext, claimedCleanup),
        ).rejects.toThrow(/changed worktree/);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        await fs.unlink(untracked);
        const firstChildWorktree = path.join(root, '.worktrees', 'sdk-shape-api');
        await removeNativeWorkspaceConfig(firstChildWorktree);
        execFileSync('git', ['worktree', 'remove', firstChildWorktree], {
          cwd: root,
          stdio: 'ignore',
        });
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).not.toContain(firstChildWorktree.replaceAll('\\', '/'));
        await runtime.markUnknown({
          runId: run.runId,
          actionId: cleanupAction.id,
          attempt: cleanupAction.attempt,
          reason: 'Host stopped after removing the first Child worktree',
        });
        await registerSdkChangeOwner(root, {
          schema: COMET_CHANGE_OWNER_SCHEMA,
          workflow: 'native',
          change: 'sdk-shape',
          format: 'sdk',
          application: 'native',
          runId: run.runId,
        });
        execFileSync('git', ['commit', '--allow-empty', '-m', 'drift during cleanup recovery'], {
          cwd: root,
          stdio: 'ignore',
        });
        const concurrentDriftCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        }).trim();
        const blockedRecovery = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(blockedRecovery.dispatch.exitCode).not.toBe(0);
        expect(blockedRecovery.dispatch.error?.message).toMatch(/verified delivery/);
        expect(
          execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8' }),
        ).toContain(integrationWorktree.replaceAll('\\', '/'));
        expect((await runtime.inspect(run.runId)).actions.at(-1)?.status).toBe('unknown');
        execFileSync(
          'git',
          ['update-ref', `refs/heads/${branch}`, deliveredCommit, concurrentDriftCommit],
          { cwd: root, stdio: 'ignore' },
        );
        const recovered = await nativeDomain.runNativeCliDetailed([
          'archive',
          'sdk-shape',
          '--recover',
          '--json',
          '--project-root',
          root,
        ]);
        expect(recovered.dispatch.exitCode, recovered.output).toBe(0);
        runtime = createSupervisorRuntime();
        run = await runtime.inspect(run.runId);
      }
      expect(run.status).toBe('completed');
      const remainingWorktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(remainingWorktrees).not.toContain(integrationWorktree);
      expect(remainingWorktrees).not.toContain(path.join(root, '.worktrees', 'sdk-shape-api'));
      expect(remainingWorktrees).not.toContain(path.join(root, '.worktrees', 'sdk-shape-ui'));
      expect(
        execFileSync('git', ['branch', '--list', 'comet/supervisor/sdk-shape/*'], {
          cwd: root,
          encoding: 'utf8',
        }).trim(),
      ).toBe('');
      expect((await fs.readFile(path.join(root, 'api.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
        'API implemented\n',
      );
      expect((await fs.readFile(path.join(root, 'ui.txt'), 'utf8')).replaceAll('\r\n', '\n')).toBe(
        'UI implemented\n',
      );
      expect(
        (await fs.readFile(path.join(root, 'parent-repair.txt'), 'utf8')).replaceAll('\r\n', '\n'),
      ).toBe('Parent repaired\n');
      await expect(fs.access(nativeSupervisorStateFile(paths, 'sdk-shape'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rejects an incomplete formal brief before proposing Shape confirmation', async () => {
    const { paths, changeDir, initialState } = await fixture();
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Scope\nThe selected workflow.\n# Acceptance examples\n- The selected workflow resumes.\n',
    );
    await expect(collectProposal(paths, initialState)).rejects.toThrow(/brief-section-missing/);
  });

  it('enters Build through a host handoff only after revalidating the approved Shape', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'shape.revalidate', type: 'call_tool' });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    expect(run.state).toMatchObject({
      phase: 'build',
      status: 'active',
      loop: { stage: 'building' },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', type: 'handoff' });
  });

  it('returns an unclaimed Build change to Shape when removing an existing capability', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    await fs.mkdir(path.join(paths.specsDir, 'retired'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'retired', 'spec.md'), '# Retired\n');
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });

    const dispatched = await runtime.dispatchCommand({
      runId: run.runId,
      expectedRevision: run.revision,
      commandId: 'remove-retired',
      name: 'remove-capability',
      input: {
        capability: 'retired',
        expectedStateVersion: (run.state as NativePortableState).state_version,
      },
      context: { requestId: 'remove-retired', projectRoot: root },
    });
    const action = dispatched.actions.at(-1)!;
    const removed = await runtime.execute({
      runId: run.runId,
      actionId: action.id,
      executorId: 'comet-native-remove',
      context: { requestId: 'remove-retired-execute', projectRoot: root },
    });

    expect(
      dispatched.actions.find((candidate) => candidate.stepId === 'build.builder'),
    ).toMatchObject({
      status: 'cancelled',
    });
    expect(removed.state).toMatchObject({
      phase: 'shape',
      status: 'active',
      spec_changes: [
        { capability: 'retired', operation: 'remove', source: null },
        { capability: 'workflow', operation: 'create', source: 'specs/workflow/spec.md' },
      ],
      loop: { stage: 'shape', next_action: 'prepare-shape-confirmation' },
      acceptance: [],
    });
    expect(removed.actions.at(-1)).toMatchObject({ stepId: 'shape.prepare', status: 'pending' });
  });

  it('returns Verify to Shape through a persisted requirements revision command', async () => {
    const { root, runtime, run: verifying } = await dispatchedVerifier([]);
    expect(verifying.state).toMatchObject({ phase: 'verify' });
    const state = verifying.state as NativePortableState;
    const dispatched = await runtime.dispatchCommand({
      runId: verifying.runId,
      expectedRevision: verifying.revision,
      commandId: 'revise-acceptance',
      name: 'revise-requirements',
      input: {
        reason: 'The acceptance criteria changed.',
        expectedStateVersion: state.state_version,
      },
      context: { requestId: 'revise-acceptance', projectRoot: root },
    });
    const revised = await runtime.execute({
      runId: verifying.runId,
      actionId: dispatched.actions.at(-1)!.id,
      executorId: 'comet-native-revise-requirements',
      context: { requestId: 'revise-acceptance-execute', projectRoot: root },
    });

    expect(dispatched.actions.find((action) => action.stepId === 'verify.verifier')).toMatchObject({
      status: 'cancelled',
    });
    expect(revised.state).toMatchObject({
      phase: 'shape',
      status: 'active',
      loop: { stage: 'shape', next_action: 'prepare-shape-confirmation' },
      acceptance: [],
      builder_handoff: null,
      verification: null,
    });
    expect((revised.state as NativePortableState).history.at(-1)?.summary).toMatchObject({
      text: 'The acceptance criteria changed.',
    });
    expect(revised.actions.at(-1)).toMatchObject({ stepId: 'shape.prepare', status: 'pending' });
  });

  it('allows requirements revision before Archive applies Specs but rejects it afterwards', async () => {
    const beforeApply = await awaitingArchiveApplication();
    expect(beforeApply.run.actions.at(-1)).toMatchObject({
      stepId: 'archive.execute',
      status: 'pending',
    });
    const current = beforeApply.run.state as NativePortableState;
    const dispatched = await beforeApply.runtime.dispatchCommand({
      runId: beforeApply.run.runId,
      expectedRevision: beforeApply.run.revision,
      commandId: 'revise-before-archive-apply',
      name: 'revise-requirements',
      input: {
        reason: 'The target behavior changed.',
        expectedStateVersion: current.state_version,
      },
      context: { requestId: 'revise-before-archive-apply', projectRoot: beforeApply.root },
    });
    const revised = await beforeApply.runtime.execute({
      runId: beforeApply.run.runId,
      actionId: dispatched.actions.at(-1)!.id,
      executorId: 'comet-native-revise-requirements',
      context: { requestId: 'revise-before-archive-apply-execute', projectRoot: beforeApply.root },
    });
    expect(revised.state).toMatchObject({ phase: 'shape', status: 'active' });

    const afterApply = await awaitingArchiveFinalization();
    const applied = afterApply.run.state as NativePortableState;
    await expect(
      afterApply.runtime.dispatchCommand({
        runId: afterApply.run.runId,
        expectedRevision: afterApply.run.revision,
        commandId: 'revise-after-archive-apply',
        name: 'revise-requirements',
        input: {
          reason: 'The target behavior changed.',
          expectedStateVersion: applied.state_version,
        },
        context: { requestId: 'revise-after-archive-apply', projectRoot: afterApply.root },
      }),
    ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
    expect(await afterApply.runtime.inspect(afterApply.run.runId)).toEqual(afterApply.run);
  });

  it('records a claimed Builder handoff as a candidate before scheduling independent checks', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    run = await succeedLatestAction(
      runtime,
      run,
      {
        summary: 'Implemented the selected workflow.',
        addressedAcceptanceIds: ['A1'],
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T01:00:00.000Z',
      },
      root,
      'builder-candidate',
      'builder-session-1',
    );
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'active',
      builder_handoff: {
        builder_execution_ref: 'builder-session-1',
        identity_provider: 'skill-coordinated',
        addressed_acceptance_ids: ['A1'],
      },
    });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.checks', type: 'call_tool' });
  });

  it('executes the Builder-bound check plan before dispatching an independent Verifier', async () => {
    const { root, paths, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    let run = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    run = await succeedLatestAction(
      runtime,
      run,
      await collectProposal(paths, run.state as NativePortableState),
      root,
      'shape-revalidated',
    );
    run = await succeedLatestAction(
      runtime,
      run,
      {
        summary: 'Implemented the selected workflow.',
        addressedAcceptanceIds: ['A1'],
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T01:00:00.000Z',
        verificationChecks: [
          {
            id: 'focused',
            name: 'Focused check',
            executable: process.execPath,
            argv: ['-e', 'process.stdout.write("sdk-check-ok")'],
            cwdRef: '.',
            timeoutMs: 5_000,
            repeatable: true,
          },
        ],
      },
      root,
      'builder-candidate',
      'builder-session-1',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'native-check-execution', projectRoot: root },
    });
    const output = run.outputs['verify.checks'].value as {
      checks: Array<{ status: string; logRef: string }>;
    };
    expect(output.checks).toMatchObject([{ status: 'passed' }]);
    expect(await fs.readFile(path.join(root, output.checks[0].logRef), 'utf8')).toContain(
      'sdk-check-ok',
    );
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', type: 'handoff' });
  });

  it('requires user confirmation before Archiving an independently verified Skill-coordinated pass', async () => {
    const { root, paths, changeDir, runtime, run: ready } = await dispatchedVerifier();
    let run = ready;
    const candidateId = (run.state as NativePortableState).builder_handoff!.candidate_id;
    run = await succeedLatestAction(
      runtime,
      run,
      {
        candidateId,
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
    expect(run.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      verification: {
        assurance: 'skill-coordinated',
        verifier_execution_ref: 'verifier-session-1',
        verdict: 'pass',
      },
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'verify.report',
      type: 'call_tool',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'native-report', projectRoot: root },
    });
    expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain(
      'All acceptance scenarios passed.',
    );
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'verify.confirm',
      status: 'pending',
    });
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'verification-approved',
      choice: 'approved',
    });
    expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'verify.revalidate',
      type: 'call_tool',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report-revalidate',
      context: { requestId: 'native-report-revalidate', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'archive', status: 'active' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.prepare', type: 'call_tool' });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-preflight',
      context: { requestId: 'native-archive-preflight', projectRoot: root },
    });
    expect(run.outputs['archive.prepare'].value).toMatchObject({ ready: true });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.execute', type: 'call_tool' });
    expect(await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8')).toContain(
      `generated_from_state_version: ${(run.state as NativePortableState).state_version}`,
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-apply',
      context: { requestId: 'native-archive-apply', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'archive', status: 'done', archived: true });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize', type: 'call_tool' });
    expect(await fs.readFile(path.join(paths.specsDir, 'workflow', 'spec.md'), 'utf8')).toContain(
      'The selected workflow resumes without losing confirmed work.',
    );
    const archiveRef = (run.outputs['archive.execute'].value as { archiveRef: string }).archiveRef;
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-archive-finalize',
      context: { requestId: 'native-archive-finalize', projectRoot: root },
    });
    expect(run.status).toBe('completed');
    expect(await fs.stat(path.join(paths.archiveDir, archiveRef))).toBeDefined();
    await expect(fs.stat(changeDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.readFile(path.join(paths.archiveDir, archiveRef, 'verification.md'), 'utf8'),
    ).toContain(
      `generated_from_state_version: ${(run.state as NativePortableState).state_version}`,
    );
  });

  it('recovers a completed Archive move after restart without executing it again', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveFinalization('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-finalize',
      claimToken: 'archive-finalize-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-finalize',
    )!;
    await executor.execute(claimed.actions.at(-1)!, context, claimed);
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped after the Archive move',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(root, '.comet', 'runtime', 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>).recoverNativeSdkArchiveOutcome;
    expect(recover).toBeTypeOf('function');
    const recovered = await (
      recover as (options: {
        runtime: typeof restarted;
        runId: string;
        projectRoot: string;
      }) => Promise<WorkflowRun>
    )({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.status).toBe('completed');
    expect(recovered.actions.at(-1)).toMatchObject({
      stepId: 'archive.finalize',
      status: 'succeeded',
    });
    const archiveRef = (recovered.outputs['archive.execute'].value as { archiveRef: string })
      .archiveRef;
    expect(await fs.stat(path.join(paths.archiveDir, archiveRef))).toBeDefined();
  });

  it('recovers applied Archive Specs after restart without creating another transaction', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveApplication('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-apply-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-apply',
      claimToken: 'archive-apply-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-apply',
    )!;
    const executed = await executor.execute(claimed.actions.at(-1)!, context, claimed);
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped after applying canonical Specs',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(root, '.comet', 'runtime', 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>)
      .recoverNativeSdkArchiveOutcome as (options: {
      runtime: typeof restarted;
      runId: string;
      projectRoot: string;
    }) => Promise<WorkflowRun>;
    const recovered = await recover({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.actions.at(-1)).toMatchObject({
      stepId: 'archive.finalize',
      status: 'pending',
    });
    expect(recovered.outputs['archive.execute'].value).toEqual(executed.output);
    expect(await fs.readFile(path.join(paths.specsDir, 'workflow', 'spec.md'), 'utf8')).toContain(
      'The selected workflow resumes without losing confirmed work.',
    );
  });

  it('resumes the same frozen Archive transaction when its Spec progress write was lost', async () => {
    const {
      root,
      paths,
      application,
      runtime,
      run: pending,
    } = await awaitingArchiveApplication('file');
    const action = pending.actions.at(-1)!;
    const context = { requestId: 'archive-partial-crash', projectRoot: root };
    const claimed = await runtime.claim({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'comet-native-archive-apply',
      claimToken: 'archive-partial-owner',
      context,
    });
    const executor = application.executors.find(
      (entry) => entry.id === 'comet-native-archive-apply',
    )!;
    const completed = await executor.execute(claimed.actions.at(-1)!, context, claimed);
    const [journalName] = (await fs.readdir(paths.transactionsDir)).filter((name) =>
      name.startsWith('portable-archive-'),
    );
    const journalFile = path.join(paths.transactionsDir, journalName);
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(
      journalFile,
      JSON.stringify({ ...journal, status: 'prepared', next_spec_index: 0 }),
    );
    await runtime.markUnknown({
      runId: pending.runId,
      actionId: action.id,
      attempt: action.attempt,
      reason: 'Host stopped before journaling the applied Spec',
    });
    const restarted = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(root, '.comet', 'runtime', 'sdk-runs'),
      }),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
      executors: application.executors,
    });
    const recover = (nativeDomain as Record<string, unknown>)
      .recoverNativeSdkArchiveOutcome as (options: {
      runtime: typeof restarted;
      runId: string;
      projectRoot: string;
    }) => Promise<WorkflowRun>;
    const recovered = await recover({
      runtime: restarted,
      runId: pending.runId,
      projectRoot: root,
    });
    expect(recovered.outputs['archive.execute'].value).toEqual(completed.output);
    expect(recovered.actions.at(-1)).toMatchObject({ stepId: 'archive.finalize' });
    const after = JSON.parse(await fs.readFile(journalFile, 'utf8')) as Record<string, unknown>;
    expect(after).toMatchObject({
      id: journal.id,
      status: 'specs-applied',
      next_spec_index: 1,
    });
  });

  it('returns a failed independent Verifier result to Build for a new candidate', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const run = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'fail',
            acceptance: [{ id: 'A1', result: 'failed', reason: 'Resume lost confirmed work.' }],
            risks: [],
            summary: 'The selected workflow failed acceptance.',
          },
        },
      },
      root,
      'verifier-failed',
      'verifier-session-1',
    );
    expect(run.state).toMatchObject({ phase: 'build', status: 'active' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'build.builder', type: 'handoff' });
    expect(run.waits.some((wait) => wait.stepId === 'verify.confirm')).toBe(false);
  });

  it('accepts an independent Verifier for a new candidate after the prior candidate failed', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const failed = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'fail',
            acceptance: [{ id: 'A1', result: 'failed', reason: 'First candidate failed.' }],
            risks: [],
            summary: 'Build another candidate.',
          },
        },
      },
      root,
      'first-verifier-failed',
      'verifier-session-1',
    );
    const rebuilt = await succeedLatestAction(
      runtime,
      failed,
      {
        summary: 'Implemented the corrected candidate.',
        addressedAcceptanceIds: ['A1'],
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: '2026-09-24T02:00:00.000Z',
        verificationChecks: [],
      },
      root,
      'second-builder-candidate',
      'builder-session-2',
    );
    const checked = await runtime.execute({
      runId: rebuilt.runId,
      actionId: rebuilt.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'second-candidate-checks', projectRoot: root },
    });
    const state = checked.state as NativePortableState;
    const verified = await succeedLatestAction(
      runtime,
      checked,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-2',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Corrected candidate passed.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'second-verifier-passed',
      'verifier-session-2',
    );
    expect(verified.actions.at(-1)).toMatchObject({ stepId: 'verify.report' });
    expect(verified.state).toMatchObject({ verification_result: 'pass' });
  });

  it('runs Verifier-requested checks before accepting a final result from the same execution', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'requested',
              name: 'Verifier requested check',
              executable: process.execPath,
              argv: ['-e', 'process.stdout.write("verified")'],
              cwdRef: '.',
              timeoutMs: 5_000,
              repeatable: true,
            },
          ],
        },
      },
      root,
      'verifier-requested-checks',
      'verifier-session-1',
    );
    expect(requested.actions.at(-1)).toMatchObject({
      stepId: 'verify.requested-checks',
      type: 'call_tool',
    });
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-requested-check-execution', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({
      stepId: 'verify.verifier',
      type: 'handoff',
    });
    const verified = await succeedLatestAction(
      runtime,
      checked,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Requested check passed.' }],
            risks: [],
            summary: 'Passed with the requested check.',
          },
        },
      },
      root,
      'verifier-final-after-checks',
      'verifier-session-1',
    );
    expect(verified.state).toMatchObject({ phase: 'verify', verification_result: 'pass' });
    expect(verified.actions.at(-1)).toMatchObject({ stepId: 'verify.report' });
    expect(verified.actions.filter((action) => action.stepId === 'verify.verifier')).toHaveLength(
      2,
    );
  });

  it('rejects a Verifier pass after a requested Runtime check failed', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'failing',
              name: 'Failing Runtime check',
              executable: process.execPath,
              argv: ['-e', 'process.exit(1)'],
              cwdRef: '.',
              timeoutMs: 5_000,
              repeatable: true,
            },
          ],
        },
      },
      root,
      'verifier-failing-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-failing-check', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Claimed pass.' }],
              risks: [],
              summary: 'Claimed pass despite failed check.',
            },
          },
        },
        root,
        'verifier-invalid-pass',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('rejects a conflicting command reused under the same Verifier check ID', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("first")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [check],
        },
      },
      root,
      'verifier-first-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-first-request-execution', projectRoot: root },
    });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [{ ...check, argv: ['-e', 'process.stdout.write("different")'] }],
          },
        },
        root,
        'verifier-conflicting-request',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('rejects a Verifier check ID that conflicts with a required Runtime check', async () => {
    const {
      root,
      runtime,
      run: ready,
    } = await dispatchedVerifier([
      {
        id: 'required',
        name: 'Required check',
        executable: process.execPath,
        argv: ['-e', 'process.stdout.write("required")'],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    ]);
    await expect(
      succeedLatestAction(
        runtime,
        ready,
        {
          candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
          verifierExecutionRef: 'verifier-session-1',
          response: {
            kind: 'request-checks',
            iteration: 1,
            attempt: 1,
            checks: [
              {
                id: 'required',
                name: 'Different check',
                executable: process.execPath,
                argv: ['-e', 'process.stdout.write("different")'],
                cwdRef: '.',
                timeoutMs: 5_000,
                repeatable: true,
              },
            ],
          },
        },
        root,
        'verifier-conflicts-with-required',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('rejects a second Verifier request that contains no new checks', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("verified")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-first-equivalent-request',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-first-equivalent-check', projectRoot: root },
    });
    await expect(
      succeedLatestAction(
        runtime,
        checked,
        {
          candidateId,
          verifierExecutionRef: 'verifier-session-1',
          response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
        },
        root,
        'verifier-repeated-equivalent-request',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('lets a new Verifier session reuse requested checks after the prior session fails', async () => {
    const { root, runtime, run: ready } = await dispatchedVerifier();
    const candidateId = (ready.state as NativePortableState).builder_handoff!.candidate_id;
    const check = {
      id: 'requested',
      name: 'Verifier requested check',
      executable: process.execPath,
      argv: ['-e', 'process.stdout.write("verified")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    };
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-request-before-failure',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'requested-check-before-failure', projectRoot: root },
    });
    const action = checked.actions.at(-1)!;
    const context = { requestId: 'verifier-failed-after-request', projectRoot: root };
    const claimed = await runtime.claim({
      runId: checked.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'verifier-session-1',
      claimToken: 'verifier-failed-after-request',
      context,
    });
    const failed = await runtime.recordOutcome({
      runId: checked.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.find((entry) => entry.id === action.id)!.claim!.token,
        outcomeId: 'verifier-failed-after-request',
        status: 'failed',
        output: { summary: 'The host confirmed this Verifier session failed.' },
      },
      context,
    });
    expect(failed.outputs['verify.requested-checks']).toMatchObject({
      value: { candidateId, checks: [{ id: 'requested', status: 'passed' }] },
    });
    const resumed = await succeedLatestAction(
      runtime,
      failed,
      {
        candidateId,
        verifierExecutionRef: 'verifier-session-2',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: (failed.state as NativePortableState).loop.attempt,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Checked by the new Verifier.' }],
            risks: [],
            summary: 'The new Verifier accepted the candidate.',
          },
        },
      },
      root,
      'verifier-after-request-retry',
      'verifier-session-2',
    );
    expect(resumed.actions.at(-1)).toMatchObject({ stepId: 'verify.report', status: 'pending' });
  });

  it('reuses a completed non-repeatable Runtime check requested by the Verifier', async () => {
    const check = {
      id: 'required',
      name: 'One-shot check',
      executable: process.execPath,
      argv: ['-e', 'require("node:fs").appendFileSync("sdk-check-count.txt", "x")'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: false,
    };
    const { root, runtime, run: ready } = await dispatchedVerifier([check]);
    expect(await fs.readFile(path.join(root, 'sdk-check-count.txt'), 'utf8')).toBe('x');
    const requested = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: { kind: 'request-checks', iteration: 1, attempt: 1, checks: [check] },
      },
      root,
      'verifier-reuses-required-check',
      'verifier-session-1',
    );
    const checked = await runtime.execute({
      runId: requested.runId,
      actionId: requested.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'verifier-reused-check', projectRoot: root },
    });
    expect(checked.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier' });
    expect(await fs.readFile(path.join(root, 'sdk-check-count.txt'), 'utf8')).toBe('x');
  });

  it('asks for fresh approval when the verification report changes before revalidation', async () => {
    const { root, changeDir, runtime, run: ready } = await dispatchedVerifier();
    let run = await succeedLatestAction(
      runtime,
      ready,
      {
        candidateId: (ready.state as NativePortableState).builder_handoff!.candidate_id,
        verifierExecutionRef: 'verifier-session-1',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
            risks: [],
            summary: 'Passed.',
          },
        },
      },
      root,
      'verifier-result',
      'verifier-session-1',
    );
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report',
      context: { requestId: 'native-report', projectRoot: root },
    });
    await fs.appendFile(path.join(changeDir, 'verification.md'), '\nUnexpected edit.\n');
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: 'verification-approved',
      choice: 'approved',
    });
    run = await runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-report-revalidate',
      context: { requestId: 'native-report-revalidate', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'verify', status: 'await-user' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.report', type: 'call_tool' });
    expect(run.actions.some((action) => action.stepId === 'archive.prepare')).toBe(false);
  });

  it('rejects a Verifier pass when a required check log changed after dispatch', async () => {
    const { root, runtime, run } = await dispatchedVerifier([
      {
        id: 'focused',
        name: 'Focused check',
        executable: process.execPath,
        argv: ['-e', 'process.stdout.write("sdk-check-ok")'],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    ]);
    const checkOutput = run.outputs['verify.checks'].value as {
      checks: Array<{ logRef: string }>;
    };
    await fs.appendFile(path.join(root, checkOutput.checks[0].logRef), 'tampered');
    await expect(
      succeedLatestAction(
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
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Verified.' }],
              risks: [],
              summary: 'Passed.',
            },
          },
        },
        root,
        'verifier-after-tamper',
        'verifier-session-1',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
  });

  it('does not enter Build when Shape documents change after approval', async () => {
    const { root, paths, changeDir, runtime, run: prepared } = await preparedShape();
    const wait = prepared.waits.at(-1)!;
    const approved = await runtime.resolveWait({
      runId: prepared.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'shape-approved',
      choice: 'approved',
    });
    const briefFile = path.join(changeDir, 'brief.md');
    const brief = await fs.readFile(briefFile, 'utf8');
    await fs.writeFile(
      briefFile,
      brief.replace('Preserve the selected workflow.', 'Preserve a different workflow.'),
    );
    await expect(
      succeedLatestAction(
        runtime,
        approved,
        await collectProposal(paths, approved.state as NativePortableState),
        root,
        'shape-stale',
      ),
    ).rejects.toThrow(/OUTCOME_REJECTED/);
    const current = await runtime.inspect(approved.runId);
    expect(current.state).toMatchObject({ phase: 'shape', status: 'await-user' });
    expect(current.actions.some((action) => action.stepId === 'build.builder')).toBe(false);
  });

  it('rejects an incomplete Native state before the SDK Run is created', async () => {
    const { initialState } = await fixture();
    const application = nativeApplication();
    const runtime = createRuntime({
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      validators: application.validators,
      stateValidators: application.stateValidators,
      commandValidators: application.commandValidators,
    });
    const invalid = { ...initialState } as Record<string, unknown>;
    delete invalid.brief;
    await expect(
      runtime.start({
        runId: 'native-sdk-invalid-state',
        workflow: { id: application.workflow.id, version: application.workflow.version },
        input: { name: 'sdk-shape', artifactRootRef: 'docs' },
        initialState: invalid,
      }),
    ).rejects.toThrow(/INITIAL_STATE_INVALID/);
  });
});
