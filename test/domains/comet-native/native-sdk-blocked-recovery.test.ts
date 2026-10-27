import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  createNativePortableState,
  parseNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import {
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  type RuntimeAction,
  type RuntimeValue,
  type WorkflowRuntime,
} from '../../../domains/engine/runtime.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { nativeSdkBeforeBlockedVerifierRecovery } from '../../../domains/comet-native/native-sdk-definition.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import type { NativeCheckPlan } from '../../../domains/comet-native/native-check-executor.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { hasNativeSdkPortableStopEvidence } from '../../../domains/comet-native/native-sdk-check-execution.js';

const roots: string[] = [];
// Windows 上未修改基线的双工作区修复案例需约 125 秒；保留全部断言并给完整事务留出执行时间。
const supervisorRecoveryTimeout = process.platform === 'win32' ? 240_000 : 120_000;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function blockedFixture(
  options: {
    legacy?: boolean;
    supervisor?: boolean;
    blockedChild?: boolean;
    repeatableChecks?: boolean;
    verificationChecks?: NativeCheckPlan[];
    syntaxFiles?: boolean;
    bundleCommands?: boolean;
    misclaimedVerifier?: boolean;
    inProjectRequests?: boolean;
    dirtyEmbedded?: boolean;
    generatedEmbedded?: boolean;
    directPass?: boolean;
    nonGitEnvironment?: boolean;
  } = {},
) {
  let useReleased = Boolean(options.legacy && process.env.COMET_NATIVE_LEGACY_PACKAGE_ROOT);
  const releasedRoot = process.env.COMET_NATIVE_LEGACY_PACKAGE_ROOT;
  const releasedDispatch = useReleased
    ? ((await import(pathToFileURL(path.join(releasedRoot!, 'dist/app/commands/runtime.js')).href))
        .runtimeDispatchCommand as typeof runtimeDispatchCommand)
    : undefined;
  const releasedNative = useReleased
    ? ((
        await import(
          pathToFileURL(path.join(releasedRoot!, 'dist/domains/comet-native/native-cli.js')).href
        )
      ).runNativeCli as typeof runNativeCli)
    : undefined;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-blocked-recovery-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const name = 'blocked-candidate';
  const change = path.join(projectRoot, 'docs/comet/changes', name);
  await fs.mkdir(path.join(change, 'specs/example'), { recursive: true });
  await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nShip the candidate.\n# Scope\nRetain checked work.\n## Directory structure\n### Modified\n- candidate.txt: satisfy acceptance.\n# Non-goals\nPublishing.\n# Acceptance examples\n- The candidate meets the requirement.\n',
  );
  await fs.writeFile(
    path.join(change, 'specs/example/spec.md'),
    '# Example\nThe candidate meets the requirement.\n',
  );
  if (options.supervisor)
    await fs.writeFile(
      path.join(change, 'children.yaml'),
      'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The candidate meets the requirement.\nchildren:\n  - name: left\n    depends_on: []\n    covers: [A1]\n  - name: right\n    depends_on: [left]\n    covers: [A1]\n',
    );
  await fs.writeFile(path.join(projectRoot, 'candidate.txt'), 'approved\n');
  if (options.syntaxFiles) {
    await fs.writeFile(path.join(projectRoot, 'left.mjs'), 'export const left = 1;\n');
    await fs.writeFile(path.join(projectRoot, 'right.mjs'), 'export const right = 1;\n');
  }
  await fs.writeFile(
    path.join(projectRoot, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n**/comet-state.yaml\n**/verification.md\ncheck-count\n',
  );
  const git = (args: string[], cwd = projectRoot) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...args],
      { cwd, encoding: 'utf8' },
    ).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Comet Test']);
  git(['config', 'user.email', 'comet-test@example.com']);
  git(['add', '.']);
  git(['commit', '-qm', 'candidate']);
  if (options.nonGitEnvironment) {
    for (const name of ['server', 'client']) {
      const child = path.join(projectRoot, name);
      await fs.mkdir(child);
      git(['init', '-q'], child);
      await fs.writeFile(path.join(child, 'index.js'), 'export const value = 1;\n');
      await fs.writeFile(path.join(child, '.env.development'), 'VUE_APP_BASE_API=/api\n');
      git(['add', '.'], child);
      git(['commit', '-qm', 'synthetic environment'], child);
    }
    await fs.rm(path.join(projectRoot, '.git'), { recursive: true, force: true });
  }
  if (options.dirtyEmbedded) {
    const child = path.join(projectRoot, 'dependency');
    await fs.mkdir(child);
    git(['init', '-q'], child);
    await fs.writeFile(path.join(child, 'value.txt'), 'baseline\n');
    if (options.generatedEmbedded) await fs.writeFile(path.join(child, '.gitignore'), 'dist/\n');
    git(['add', '.'], child);
    git(['commit', '-qm', 'child'], child);
    git(['add', 'dependency']);
    git(['commit', '-qm', 'gitlink']);
    await fs.writeFile(path.join(child, 'value.txt'), 'verified dirty child\n');
    if (options.generatedEmbedded) {
      await fs.mkdir(path.join(child, 'dist'));
      await fs.writeFile(path.join(child, 'dist/output.txt'), 'good');
    }
  }
  let count = 0;
  let legacyRuntime: WorkflowRuntime | undefined;
  async function dispatch(request: Record<string, unknown>) {
    if (legacyRuntime && request.operation === 'execute')
      return legacyRuntime.execute({
        runId: String(request.runId),
        actionId: String(request.actionId),
        executorId: String(request.executorId),
        context: { requestId: `legacy-check-${++count}`, projectRoot },
      });
    count += 1;
    const requestFile = options.inProjectRequests
      ? path.join(projectRoot, 'dispatch-request.json')
      : path.join(root, `request-${count}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    const result = await (useReleased ? releasedDispatch! : runtimeDispatchCommand)({
      application: 'native',
      projectRoot,
      request: requestFile,
    });
    if (result.response.status !== 'succeeded')
      throw new Error(JSON.stringify(result.response.error));
    return result.response.data;
  }
  async function native(args: string[]) {
    const argv = [
      ...args,
      ...(args.includes('--project-root') ? [] : ['--project-root', projectRoot]),
      ...(args.includes('--json') ? [] : ['--json']),
    ];
    if (options.bundleCommands) {
      const result = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
        { encoding: 'utf8', timeout: 60_000, cwd: projectRoot },
      );
      if (result.error) throw result.error;
      return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    }
    return (useReleased ? releasedNative! : runNativeCli)(argv);
  }
  async function record(
    action: RuntimeAction,
    output: RuntimeValue,
    sessionId: string,
    outcomeId = `${action.id}-result`,
  ) {
    const claimed = await dispatch({
      operation: 'claim',
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId,
      claimToken: `${action.id}-${sessionId}`,
    });
    return dispatch({
      operation: 'record-outcome',
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.find(({ id }) => id === action.id)!.claim!.token,
        outcomeId,
        status: 'succeeded',
        output,
      },
    });
  }
  const start = {
    runId: name,
    workflow: { id: 'comet-native', version: '1' },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
      workspace: {
        isolation: 'current',
        change_branch: options.nonGitEnvironment ? null : 'main',
        target_branch: options.nonGitEnvironment ? null : 'main',
        finish: null,
      },
    }),
  };
  if (options.legacy && !useReleased) {
    const application = defineNativeWorkflowApplication();
    const workflow = nativeSdkBeforeBlockedVerifierRecovery(application.workflow);
    // Exact released 0.5.0 definition hash; reconstruct through public Runtime, never edit live state.
    expect(hashRuntimeValue(defineWorkflow(workflow))).toBe(
      'fb7d10f66cb304d7b7470fdba5aef47f9dba222d8bea539632e2bba50e0743a7',
    );
    const runtime = createRuntime({
      ...application,
      executors: application.executors.map((executor) =>
        executor.id !== 'comet-native-checks'
          ? executor
          : {
              ...executor,
              async execute(...args: Parameters<typeof executor.execute>) {
                const result = await executor.execute(...args);
                const output = { ...(result.output as Record<string, RuntimeValue>) };
                // Reproduce the released receipt shape at the executor boundary, not by editing a Run.
                delete output.inputSnapshot;
                return { ...result, output };
              },
            },
      ),
      store: createNativeSdkStateStore(projectRoot),
      workflows: [workflow],
      transitionHandlers: [application.transitionHandler],
    });
    legacyRuntime = runtime;
    await runtime.start(start);
    await registerSdkChangeOwner(projectRoot, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'native',
      change: name,
      format: 'sdk',
      application: 'native',
      runId: name,
    });
  } else await dispatch({ operation: 'start', ...start });
  const prepared = await native(['next', name]);
  expect(prepared.exitCode, prepared.stderr || prepared.stdout).toBe(0);
  let run = await dispatch({ operation: 'inspect', runId: name });
  expect(
    (
      await native([
        'next',
        name,
        '--confirmed',
        '--summary',
        'Confirm scope',
        '--expected-state-version',
        String(parseNativePortableState(run.state).state_version),
        '--expected-action',
        'confirm-shape',
        ...(options.supervisor ? ['--coordination-mode', 'multi-session'] : []),
      ])
    ).exitCode,
  ).toBe(0);
  run = await dispatch({ operation: 'inspect', runId: name });
  if (options.supervisor) {
    const childChecks = [
      {
        id: 'child-check',
        name: 'child-check',
        executable: process.execPath,
        argv: ['-e', 'process.exit(0)'],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: true,
      },
    ];
    const executors: Record<string, string> = {
      'supervisor.prepare': 'native-supervisor-prepare',
      'supervisor.child.prepare': 'native-supervisor-child-prepare',
      'supervisor.child.checks': 'comet-native-checks',
      'supervisor.child.integrate': 'native-supervisor-integrate',
      'supervisor.child.integration-checks': 'comet-native-checks',
      'supervisor.child.archive': 'native-supervisor-child-archive',
    };
    for (let step = 0; step < 24; step++) {
      const action = run.actions.find(({ status }) => status === 'pending')!;
      if (action.stepId === 'supervisor.parent.builder') break;
      if (action.stepId === 'supervisor.child.builder') {
        const activation = (action.input as { activation: { worktree: string; child: string } })
          .activation;
        await fs.writeFile(
          path.join(activation.worktree, `${activation.child}.txt`),
          'approved by child\n',
        );
        git(['add', `${activation.child}.txt`], activation.worktree);
        git(['commit', '-qm', 'child candidate'], activation.worktree);
        run = await record(
          action,
          {
            candidateCommit: git(['rev-parse', 'HEAD'], activation.worktree),
            verificationChecks: childChecks,
          },
          'child-builder',
        );
      } else if (action.stepId === 'supervisor.child.verifier') {
        const activation = (
          action.input as { activation: { candidateCommit: string; child: string } }
        ).activation;
        const blockedChild = Boolean(options.blockedChild && activation.child === 'right');
        run = await record(
          action,
          {
            candidateCommit: activation.candidateCommit,
            verdict: blockedChild ? 'blocked' : 'pass',
            evidence: {
              summary: 'Independently reviewed child',
              checks: ['child-check'],
              acceptance: [
                {
                  id: 'A1',
                  result: blockedChild ? 'blocked' : 'passed',
                  reason: 'Reviewed actual child candidate',
                },
              ],
            },
            integrationChecks: childChecks,
          },
          'child-verifier',
        );
        if (blockedChild) {
          useReleased = false;
          return {
            root,
            projectRoot,
            candidateRoot: (action.input as { activation: { worktree: string } }).activation
              .worktree,
            name,
            run,
            dispatch,
            native,
            record,
          };
        }
      } else {
        expect(executors[action.stepId], action.stepId).toBeDefined();
        run = await dispatch({
          operation: 'execute',
          runId: name,
          actionId: action.id,
          executorId: executors[action.stepId],
        });
      }
    }
    expect(run.actions.find(({ status }) => status === 'pending')?.stepId).toBe(
      'supervisor.parent.builder',
    );
  }
  const builder = run.actions.find(({ status }) => status === 'pending')!;
  const candidateRoot = options.supervisor
    ? (builder.input as { activation: { integrationWorktree: string } }).activation
        .integrationWorktree
    : projectRoot;
  run = await record(
    run.actions.find(({ status }) => status === 'pending')!,
    {
      summary: 'Implemented candidate',
      ...(options.nonGitEnvironment
        ? {}
        : { candidateCommit: git(['rev-parse', 'HEAD'], candidateRoot) }),
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      submittedAt: new Date().toISOString(),
      verificationChecks: options.verificationChecks ?? [
        {
          id: 'one-shot',
          name: 'one-shot',
          executable: process.execPath,
          argv: ['-e', "require('node:fs').appendFileSync('check-count', 'once\\n')"],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: options.repeatableChecks ?? false,
        },
      ],
    },
    'builder',
  );
  run = await dispatch({
    operation: 'execute',
    runId: name,
    actionId: run.actions.find(({ status }) => status === 'pending')!.id,
    executorId: 'comet-native-checks',
  });
  const state = parseNativePortableState(run.state);
  if (options.misclaimedVerifier) {
    const action = run.actions.find(({ status }) => status === 'pending')!;
    run = await dispatch({
      operation: 'claim',
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'builder',
      claimToken: 'misclaimed-verifier',
    });
    return { root, projectRoot, candidateRoot, name, run, dispatch, native, record };
  }
  run = await record(
    run.actions.find(({ status }) => status === 'pending')!,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'blocked-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: options.directPass ? 'pass' : 'blocked',
          acceptance: [
            {
              id: 'A1',
              result: options.directPass ? 'passed' : 'blocked',
              reason: options.directPass
                ? 'Independently verified the candidate.'
                : 'The requested independent model was unavailable.',
            },
          ],
          risks: [],
          summary: options.directPass
            ? 'All acceptance passed.'
            : 'Use the correct independent model, without changing requirements.',
        },
      },
    },
    'blocked-verifier',
  );
  useReleased = false;
  return { root, projectRoot, candidateRoot, name, run, dispatch, native, record };
}

type Alternative = { name: string; commandArgs: string[] };
async function alternatives(f: Awaited<ReturnType<typeof blockedFixture>>) {
  const status = await f.native(['status', f.name]);
  expect(status.exitCode, status.stderr).toBe(0);
  return JSON.parse(status.stdout!).data.continuation.commandAlternatives as Alternative[];
}
async function executeAlternative(action: Alternative) {
  return runNativeCli(
    action.commandArgs
      .slice(2)
      .map((argument) =>
        argument === '<summary>' ? 'The user explicitly chose this recovery.' : argument,
      ),
  );
}

async function archiveReadyFixture(
  options: {
    inProjectRequests?: boolean;
    deferredRevalidation?: boolean;
    dirtyEmbedded?: boolean;
    directPass?: boolean;
    generatedEmbedded?: boolean;
    verificationChecks?: NativeCheckPlan[];
    nonGitEnvironment?: boolean;
    bundleCommands?: boolean;
  } = {},
) {
  const f = await blockedFixture({
    bundleCommands: options.bundleCommands ?? true,
    inProjectRequests: options.inProjectRequests,
    dirtyEmbedded: options.dirtyEmbedded,
    directPass: options.directPass,
    generatedEmbedded: options.generatedEmbedded,
    verificationChecks: options.verificationChecks,
    nonGitEnvironment: options.nonGitEnvironment,
  });
  if (!options.directPass) {
    const resume = (await alternatives(f)).find(({ name }) => name === 'resolve-verifier-blocker')!;
    expect(
      (
        await f.native(
          resume.commandArgs
            .slice(2)
            .map((arg) => (arg === '<summary>' ? 'The independent verifier is available.' : arg)),
        )
      ).exitCode,
    ).toBe(0);
    const run = await f.dispatch({ operation: 'inspect', runId: f.name });
    const state = parseNativePortableState(run.state);
    await f.record(
      run.actions.findLast(({ status }) => status === 'pending')!,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'archive-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'Independently verified the retained candidate.',
              },
            ],
            risks: [],
            summary: 'All acceptance passed.',
          },
        },
      },
      'archive-verifier',
    );
  }
  expect((await f.native(['next', f.name])).exitCode).toBe(0);
  const data = JSON.parse((await f.native(['status', f.name])).stdout!).data;
  const approval = (data.continuation.commandAlternatives as Alternative[]).find(
    ({ name }) => name === 'accept-result',
  )!;
  if (options.deferredRevalidation) {
    const current = await f.dispatch({ operation: 'inspect', runId: f.name });
    const wait = current.waits.findLast(({ status }) => status === 'pending')!;
    await f.dispatch({
      operation: 'resolve-wait',
      runId: f.name,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approve-with-pending-revalidation',
      choice: 'approved',
    });
    return f;
  }
  expect(
    (
      await f.native(
        approval.commandArgs
          .slice(2)
          .map((arg) => (arg === '<summary>' ? 'Approve the verified result.' : arg)),
      )
    ).exitCode,
  ).toBe(0);
  return f;
}

async function finishRepairedCandidate(
  f: Awaited<ReturnType<typeof archiveReadyFixture>>,
  shape: string | null,
) {
  const after = await f.dispatch({ operation: 'inspect', runId: f.name });
  const live = JSON.parse((await f.native(['status', f.name])).stdout!).data;
  expect(live.recovery?.code).not.toBe('candidate-drift');
  await f.record(
    after.actions.findLast((action) => action.status === 'pending')!,
    {
      summary: 'Keep the user implementation revision.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      submittedAt: new Date().toISOString(),
      verificationChecks: [
        {
          id: 'revision-check',
          name: 'Verify the user revision',
          executable: process.execPath,
          argv: [
            '-e',
            "if (!require('node:fs').readFileSync('candidate.txt','utf8').includes('user implementation revision')) process.exit(1)",
          ],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: true,
        },
      ],
    },
    'repair-builder',
  );
  expect((await f.native(['next', f.name])).exitCode).toBe(0);
  const checked = await f.dispatch({ operation: 'inspect', runId: f.name });
  const state = parseNativePortableState(checked.state);
  await f.record(
    checked.actions.findLast((action) => action.status === 'pending')!,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'repair-verifier',
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'pass',
          acceptance: [
            {
              id: 'A1',
              result: 'passed',
              reason: 'Independently verified the retained user revision.',
            },
          ],
          risks: [],
          summary: 'The successor candidate meets all acceptance.',
        },
      },
    },
    'repair-verifier',
  );
  expect((await f.native(['next', f.name])).exitCode).toBe(0);
  const approve = (await alternatives(f)).find((option) => option.name === 'accept-result')!;
  expect(
    (
      await f.native(
        approve.commandArgs
          .slice(2)
          .map((arg) => (arg === '<summary>' ? 'Approve the verified revision.' : arg)),
      )
    ).exitCode,
  ).toBe(0);
  const archived = await f.native(['archive', f.name]);
  expect(archived.exitCode, archived.stdout).toBe(0);
  expect((await f.dispatch({ operation: 'inspect', runId: f.name })).state).toMatchObject({
    archived: true,
    shape_confirmation_hash: shape,
  });
  expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
}

describe('blocked Verifier recovery command contract', () => {
  it('archives tracked environment files in non-Git child repositories and rejects stale environment evidence', async () => {
    const f = await archiveReadyFixture({
      directPass: true,
      nonGitEnvironment: true,
      verificationChecks: ['server', 'client'].map((cwdRef) => ({
        id: cwdRef,
        name: `Read ${cwdRef} environment`,
        executable: process.execPath,
        argv: [
          '-e',
          'require("node:assert/strict").ok(require("node:fs").readFileSync(".env.development", "utf8").trim())',
        ],
        cwdRef,
        timeoutMs: 5000,
        repeatable: true,
      })),
    });
    const checked = await f.dispatch({ operation: 'inspect', runId: f.name });
    const output = checked.outputs['verify.checks'].value as {
      candidateInputFingerprintGate: string;
      inputSnapshot: { complete: boolean };
    };
    expect(output.candidateInputFingerprintGate).toMatch(/^[a-f0-9]{64}$/u);
    expect(output.inputSnapshot.complete).toBe(true);
    expect(JSON.stringify(output)).not.toContain('VUE_APP_BASE_API=/api');
    const file = path.join(f.projectRoot, 'client/.env.development');
    await fs.writeFile(file, 'VUE_APP_BASE_API=/unverified\n');
    const preview = JSON.parse((await f.native(['archive', f.name, '--dry-run'])).stdout!);
    expect(preview.data.ready).toBe(false);
    const doctor = JSON.parse((await f.native(['doctor', f.name])).stdout!);
    expect(doctor.data.healthy).toBe(false);
    expect(JSON.stringify(doctor.data.findings)).toMatch(/candidate|候选/iu);
    expect((await f.dispatch({ operation: 'inspect', runId: f.name })).revision).toBe(
      checked.revision,
    );
    await fs.writeFile(file, 'VUE_APP_BASE_API=/api\n');
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode, archived.stdout ?? archived.stderr).toBe(0);
    const completed = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(completed.state).toMatchObject({ archived: true, status: 'done' });
    expect(await fs.readFile(file, 'utf8')).toBe('VUE_APP_BASE_API=/api\n');
    const again = await f.native(['archive', f.name]);
    expect(again.exitCode, again.stdout ?? again.stderr).toBe(0);
    expect((await f.dispatch({ operation: 'inspect', runId: f.name })).state).toEqual(
      completed.state,
    );
  });

  it('recovers a branch rename followed by implementation changes without replaying one-shot checks', async () => {
    const f = await archiveReadyFixture({ directPass: true });
    const original = await f.dispatch({ operation: 'inspect', runId: f.name });
    const shape = parseNativePortableState(original.state).shape_confirmation_hash;
    execFileSync('git', ['branch', '-m', 'renamed-candidate'], {
      cwd: f.projectRoot,
      stdio: 'ignore',
    });
    const rebound = await f.native(['select', f.name, '--rebind']);
    expect(rebound.exitCode, rebound.stdout).toBe(0);
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'user implementation revision\n');
    const blocked = JSON.parse((await f.native(['archive', f.name])).stdout!);
    expect(blocked.data.phase).toBe('verify');
    expect(blocked.data.recovery.code).toBe('candidate-drift');
    expect(blocked.data.continuation.userCommunication.message).not.toMatch(
      /failure budget|失败预算/u,
    );
    const repaired = await f.native(
      blocked.data.recovery.recoveryArgs
        .slice(2)
        .map((arg: string) => (arg === '<summary>' ? 'Keep the work after branch takeover.' : arg)),
    );
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    await finishRepairedCandidate(f, shape);
  });
  it('rejects changed gitlink generated output at the public Archive boundary', async () => {
    const f = await archiveReadyFixture({
      dirtyEmbedded: true,
      generatedEmbedded: true,
      directPass: true,
      verificationChecks: [
        {
          id: 'child-output',
          name: 'Validate child output',
          executable: process.execPath,
          argv: [
            '-e',
            'if (require("node:fs").readFileSync("dist/output.txt", "utf8") !== "good") process.exit(1)',
          ],
          cwdRef: 'dependency',
          timeoutMs: 10000,
          repeatable: true,
        },
      ],
    });
    await fs.writeFile(path.join(f.projectRoot, 'dependency/dist/output.txt'), 'bad');
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode).not.toBe(0);
    expect(
      parseNativePortableState((await f.dispatch({ operation: 'inspect', runId: f.name })).state)
        .archived,
    ).toBe(false);
  });
  it('reports candidate drift in read-only Archive and Doctor without changing the accepted Run', async () => {
    const f = await archiveReadyFixture();
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'unverified change\n');
    const preview = JSON.parse((await f.native(['archive', f.name, '--dry-run'])).stdout!);
    expect(preview.data).toMatchObject({ ready: false });
    expect(preview.data.blockers.length).toBeGreaterThan(0);
    const doctor = JSON.parse((await f.native(['doctor', f.name])).stdout!);
    expect(doctor.data).toMatchObject({ healthy: false });
    expect(JSON.stringify(doctor.data.findings)).toMatch(/candidate|候选/iu);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
  });

  it('repairs an implementation edited after Archive approval using the emitted recovery command and original Shape', async () => {
    const f = await archiveReadyFixture({ directPass: true });
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    const shape = parseNativePortableState(before.state).shape_confirmation_hash;
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'user implementation revision\n');
    const blocked = JSON.parse((await f.native(['archive', f.name])).stdout!);
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.data.phase).toBe('verify');
    expect(blocked.data.recovery.code).toBe('candidate-drift');
    expect(blocked.data.recovery.recoveryArgs).toEqual(
      expect.arrayContaining(['--revise-implementation']),
    );
    const repaired = await f.native(
      blocked.data.recovery.recoveryArgs
        .slice(2)
        .map((arg: string) => (arg === '<summary>' ? 'Retain the revised implementation.' : arg)),
    );
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.runId).toBe(before.runId);
    expect(parseNativePortableState(after.state)).toMatchObject({
      phase: 'build',
      shape_confirmation_hash: shape,
    });
    expect(
      after.actions.some(
        (action) => action.stepId === 'build.builder' && action.status === 'pending',
      ),
    ).toBe(true);
    const successor = after.actions.find(
      (action) => action.stepId === 'build.builder' && action.status === 'pending',
    )!;
    expect(successor.input).toMatchObject({
      activation: {
        repairContext: {
          candidateHandling: 'review-existing-work-first',
          instruction: expect.stringContaining('submit it unchanged'),
        },
      },
    });
    expect(await fs.readFile(path.join(f.projectRoot, 'candidate.txt'), 'utf8')).toBe(
      'user implementation revision\n',
    );
    await finishRepairedCandidate(f, shape);
  });

  it('hands the existing user revision to the successor Builder without requiring a rewrite', async () => {
    const f = await archiveReadyFixture({ directPass: true, bundleCommands: false });
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'user implementation revision\n');
    const blocked = JSON.parse((await f.native(['archive', f.name])).stdout!);
    expect(blocked.data.recovery.code).toBe('candidate-drift');
    const repaired = await f.native(
      blocked.data.recovery.recoveryArgs
        .slice(2)
        .map((arg: string) => (arg === '<summary>' ? 'Keep the user revision.' : arg)),
    );
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    const successor = after.actions.find(
      (action: RuntimeAction) => action.stepId === 'build.builder' && action.status === 'pending',
    );
    expect(successor.input.activation.repairContext).toMatchObject({
      candidateHandling: 'review-existing-work-first',
      instruction: expect.stringContaining('submit it unchanged'),
    });
    expect(await fs.readFile(path.join(f.projectRoot, 'candidate.txt'), 'utf8')).toBe(
      'user implementation revision\n',
    );
  });

  it('retains business status and candidate details when Archive is rejected before acceptance', async () => {
    const f = await blockedFixture({ bundleCommands: true });
    const response = await f.native(['archive', f.name]);
    expect(response.exitCode).toBe(73);
    const output = JSON.parse(response.stdout!);
    expect(output.summary).toEqual(expect.any(String));
    expect(output.agent.phase).toBe('verify');
    expect(output.data).toMatchObject({
      phase: 'verify',
      verificationResult: 'blocked',
      schema: 'comet.native.sdk-status.v1',
    });
    expect(output.data.recovery.preserved.candidateId).toBe(
      parseNativePortableState(f.run.state).builder_handoff!.candidate_id,
    );
  });

  it('excludes validated in-project SDK request transport while preserving ordinary source inputs', async () => {
    const f = await archiveReadyFixture({
      inProjectRequests: true,
      dirtyEmbedded: true,
      directPass: true,
    });
    await f.dispatch({ operation: 'inspect', runId: f.name });
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode, archived.stdout ?? archived.stderr).toBe(0);
    expect((await f.dispatch({ operation: 'inspect', runId: f.name })).state).toMatchObject({
      archived: true,
    });
    expect(await fs.readFile(path.join(f.projectRoot, 'dependency/value.txt'), 'utf8')).toBe(
      'verified dirty child\n',
    );
  });

  it('finishes pending accepted-result revalidation before Archive without consuming another Verify failure', async () => {
    const f = await archiveReadyFixture({ deferredRevalidation: true });
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(before.actions.at(-1)).toMatchObject({ stepId: 'verify.revalidate', status: 'pending' });
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode, archived.stdout ?? archived.stderr).toBe(0);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.state).toMatchObject({ archived: true });
    expect(parseNativePortableState(after.state).loop.failed_iteration_count).toEqual(
      parseNativePortableState(before.state).loop.failed_iteration_count,
    );
    expect(after.actions.filter(({ stepId }) => stepId === 'verify.revalidate')).toHaveLength(1);
  });

  it.each(['running', 'changed-requirements', 'unknown'])(
    'ends a misclaimed Verifier as failed and archives through an independent replacement without repeating checks: %s',
    async (scenario) => {
      const changedRequirements = scenario === 'changed-requirements';
      const unknown = scenario === 'unknown';
      const f = await blockedFixture({ misclaimedVerifier: true, bundleCommands: true });
      const action = f.run.actions.findLast(({ stepId }) => stepId === 'verify.verifier')!;
      const original = parseNativePortableState(f.run.state);
      const checks = f.run.actions.find(({ stepId }) => stepId === 'verify.checks')!;
      const request = {
        operation: 'record-outcome',
        runId: f.name,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          outcomeId: 'misclaimed-verifier-failure',
          status: 'failed',
          output: {
            summary:
              'The Builder claimed the Verifier by mistake; no independent verification ran.',
          },
        },
      };
      for (const verdict of ['pass', 'blocked'] as const) {
        await expect(
          f.dispatch({
            ...request,
            outcome: {
              ...request.outcome,
              outcomeId: `self-verification-${verdict}`,
              status: 'succeeded',
              output: {
                candidateId: original.builder_handoff!.candidate_id,
                verifierExecutionRef: 'builder',
                response: {
                  kind: 'final-result',
                  result: {
                    iteration: original.loop.iteration,
                    attempt: original.loop.attempt,
                    verdict,
                    acceptance: [
                      {
                        id: 'A1',
                        result: verdict === 'pass' ? 'passed' : 'blocked',
                        reason: 'Not independent.',
                      },
                    ],
                    risks: [],
                    summary: 'Not independent.',
                  },
                },
              },
            },
          }),
        ).rejects.toThrow(/independent/);
      }
      await expect(
        f.dispatch({
          ...request,
          outcome: { ...request.outcome, claimToken: 'not-the-original-claim' },
        }),
      ).rejects.toThrow();
      const spec = path.join(f.projectRoot, 'docs/comet/changes', f.name, 'specs/example/spec.md');
      const approvedSpec = await fs.readFile(spec, 'utf8');
      if (changedRequirements)
        await fs.writeFile(spec, approvedSpec + '\nA newly requested requirement.\n');
      if (unknown)
        await f.dispatch({
          operation: 'mark-unknown',
          runId: f.name,
          actionId: action.id,
          attempt: action.attempt,
          reason: 'The original host ended without a usable independent verification result.',
        });
      const failed = await f.dispatch(request);
      expect(failed.actions.find(({ id }) => id === action.id)).toMatchObject({ status: 'failed' });
      expect(failed.state).toMatchObject({
        phase: 'verify',
        shape_confirmation_hash: original.shape_confirmation_hash,
        builder_handoff: { candidate_id: original.builder_handoff!.candidate_id },
        loop: { goal_cycle: 1, execution_failure_count: 1 },
      });
      expect(failed.actions.find(({ id }) => id === checks.id)).toEqual(checks);
      expect((await f.dispatch(request)).revision).toBe(failed.revision);
      const replacement = failed.actions.findLast(({ status }) => status === 'pending')!;
      expect(replacement).toMatchObject({ stepId: 'verify.verifier' });
      expect(replacement.id).not.toBe(action.id);
      const verification = {
        candidateId: original.builder_handoff!.candidate_id,
        verifierExecutionRef: 'independent-replacement',
        response: {
          kind: 'final-result',
          result: {
            iteration: original.loop.iteration,
            attempt: parseNativePortableState(failed.state).loop.attempt,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'Independently verified the retained candidate.',
              },
            ],
            risks: [],
            summary: 'Independent verification passed.',
          },
        },
      };
      if (changedRequirements) {
        await expect(
          f.record(replacement, verification, 'independent-replacement', 'rejected-stale-shape'),
        ).rejects.toThrow('Shape artifacts changed');
        await fs.writeFile(spec, approvedSpec);
      }
      let run = await f.record(replacement, verification, 'independent-replacement');
      expect(run.actions.find(({ id }) => id === checks.id)).toEqual(checks);
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      const approval = (await alternatives(f)).find(({ name }) => name === 'accept-result')!;
      expect(approval).toBeDefined();
      expect(
        (
          await f.native(
            approval.commandArgs
              .slice(2)
              .map((arg) =>
                arg === '<summary>' ? 'Approve the independently verified result.' : arg,
              ),
          )
        ).exitCode,
      ).toBe(0);
      const archived = await f.native(['archive', f.name]);
      expect(archived.exitCode, archived.stderr || archived.stdout).toBe(0);
      run = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(run.status).toBe('completed');
      const archivedCheck = run.actions.find(({ id }) => id === checks.id)!;
      const { executionStop: oldStop, ...oldCheck } = checks;
      const { executionStop: newStop, ...newCheck } = archivedCheck;
      expect(newCheck).toEqual(oldCheck);
      if (oldStop) expect(newStop).toEqual(oldStop);
      else expect(hasNativeSdkPortableStopEvidence(run, archivedCheck)).toBe(true);
      expect(run.actions.find(({ id }) => id === action.id)).toMatchObject({ status: 'failed' });
      expect(run.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(1);
      expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    },
  );

  it('recovers an interrupted Archive through its emitted CLI command after removing an occupied destination without replaying checks or Specs', async () => {
    const f = await archiveReadyFixture();
    let run = await f.dispatch({ operation: 'inspect', runId: f.name });
    for (const [stepId, executorId] of [
      ['archive.prepare', 'comet-native-archive-preflight'],
      ['archive.execute', 'comet-native-archive-apply'],
    ]) {
      const action = run.actions.findLast(({ status }) => status === 'pending')!;
      expect(action.stepId).toBe(stepId);
      run = await f.dispatch({
        operation: 'execute',
        runId: f.name,
        actionId: action.id,
        executorId,
      });
    }
    const applied = run.outputs['archive.execute'].value as {
      archiveRef: string;
      transactionId: string;
    };
    const paths = await nativeProjectPaths(f.projectRoot, 'docs');
    const target = path.resolve(paths.archiveDir, applied.archiveRef);
    expect(path.relative(paths.archiveDir, target).startsWith('..')).toBe(false);
    expect(target).not.toBe(paths.archiveDir);
    await fs.mkdir(target, { recursive: true });
    const blocker = path.join(target, 'verification.md');
    await fs.writeFile(blocker, 'Another unfinished publication occupies the destination.');
    const stopped = await f.native(['archive', f.name]);
    expect(stopped.exitCode).not.toBe(0);
    const data = JSON.parse((await f.native(['status', f.name])).stdout!).data;
    expect(data.recovery).toMatchObject({
      code: 'execution-unresolved',
      owner: { actionId: run.actions.at(-1)!.id },
    });
    expect(data.recovery.recoveryArgs).toContain('--recover');
    await fs.unlink(blocker);
    await fs.rmdir(target);
    const recovered = await f.native(data.recovery.recoveryArgs.slice(2));
    expect(recovered.exitCode, recovered.stdout ?? recovered.stderr).toBe(0);
    const repeated = await f.native(data.recovery.recoveryArgs.slice(2));
    expect(repeated.exitCode, repeated.stdout ?? repeated.stderr).toBe(0);
    expect(JSON.parse(repeated.stdout!).data).toMatchObject({
      alreadyArchived: true,
      currentImplementationRevalidated: false,
    });
    const completed = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(completed.state).toMatchObject({ archived: true });
    expect(completed.actions.filter(({ stepId }) => stepId === 'archive.execute')).toHaveLength(1);
    expect(completed.outputs['archive.execute'].value).toMatchObject(applied);
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
  });

  it('runs incremental repair and Archive through the generated CLI without repeating unchanged scoped checks', async () => {
    const plans = ['left', 'right'].map((name) => ({
      id: name,
      name: `${name} syntax`,
      executable: process.execPath,
      argv: ['--check', `${name}.mjs`],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    }));
    const f = await blockedFixture({
      syntaxFiles: true,
      verificationChecks: plans,
      bundleCommands: true,
    });
    const original = parseNativePortableState(f.run.state);
    const originalChecks = f.run.outputs['verify.checks'].value as {
      checks: Array<{ logRef: string }>;
    };
    const data = JSON.parse((await f.native(['status', f.name])).stdout!).data;
    const repair = (data.continuation.commandAlternatives as Alternative[]).find(
      ({ name }) => name === 'revise-implementation',
    )!;
    expect(
      (
        await f.native(
          repair.commandArgs
            .slice(2)
            .map((arg) => (arg === '<summary>' ? 'Repair only the left module.' : arg)),
        )
      ).exitCode,
    ).toBe(0);
    let run = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(run.state).toMatchObject({
      phase: 'build',
      shape_confirmation_hash: original.shape_confirmation_hash,
    });
    await fs.writeFile(path.join(f.projectRoot, 'left.mjs'), 'export const left = 2;\n');
    await f.record(
      run.actions.findLast(({ status }) => status === 'pending')!,
      {
        summary: 'Repair the left module.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: new Date().toISOString(),
        verificationChecks: plans,
      },
      'successor-builder',
    );
    const checked = await f.native(['next', f.name]);
    expect(checked.exitCode, checked.stdout ?? checked.stderr).toBe(0);
    run = await f.dispatch({ operation: 'inspect', runId: f.name });
    const checks = run.outputs['verify.checks'].value as {
      checks: Array<{ logRef: string; reusedFrom?: { candidateId: string } }>;
    };
    expect(checks.checks[0].logRef).not.toBe(originalChecks.checks[0].logRef);
    expect(checks.checks[1]).toMatchObject({
      logRef: originalChecks.checks[1].logRef,
      reusedFrom: { candidateId: original.builder_handoff!.candidate_id },
    });
    const state = parseNativePortableState(run.state);
    await f.record(
      run.actions.findLast(({ status }) => status === 'pending')!,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'successor-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'Independently inspected both modules and the repair.',
              },
            ],
            risks: [],
            summary: 'All acceptance passed for the successor candidate.',
          },
        },
      },
      'successor-verifier',
    );
    expect((await f.native(['next', f.name])).exitCode).toBe(0);
    const approval = JSON.parse(
      (await f.native(['status', f.name])).stdout!,
    ).data.continuation.commandAlternatives.find(
      (item: Alternative) => item.name === 'accept-result',
    ) as Alternative;
    expect(
      (
        await f.native(
          approval.commandArgs
            .slice(2)
            .map((arg) =>
              arg === '<summary>' ? 'Approve the independently verified candidate.' : arg,
            ),
        )
      ).exitCode,
    ).toBe(0);
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode, archived.stdout ?? archived.stderr).toBe(0);
    expect((await f.dispatch({ operation: 'inspect', runId: f.name })).state).toMatchObject({
      archived: true,
    });
    await expect(
      fs.access(path.join(f.projectRoot, 'docs/comet/changes', f.name)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['resolve-verifier-blocker', 'revise-implementation', 'revise-requirements'])(
    'executes the exact advertised %s command from the advertised state',
    async (name) => {
      const f = await blockedFixture();
      expect(f.run.state).toMatchObject({
        phase: 'verify',
        status: 'await-user',
        loop: { next_action: 'resolve-verifier-blocker' },
      });
      const action = (await alternatives(f)).find((alternative) => alternative.name === name)!;
      expect(action).toBeDefined();
      const result = await executeAlternative(action);
      expect(result.exitCode, result.stderr || result.stdout).toBe(0);
      const resumed = await f.dispatch({ operation: 'inspect', runId: f.name });
      for (const original of f.run.actions)
        expect(resumed.actions.find(({ id }) => id === original.id)?.outcome).toEqual(
          original.outcome,
        );
      expect((await executeAlternative(action)).exitCode).toBe(73);
      expect(resumed.actions.findLast(({ status }) => status === 'pending')?.stepId).toBe(
        name === 'resolve-verifier-blocker'
          ? 'verify.verifier'
          : name === 'revise-implementation'
            ? 'build.builder'
            : 'shape.prepare',
      );
    },
  );

  it('retains candidate and one-shot check evidence through cold reopen, retry, and independent acceptance', async () => {
    const f = await blockedFixture();
    const old = parseNativePortableState(f.run.state);
    const check = f.run.actions.find(({ stepId }) => stepId === 'verify.checks')!;
    const retry = (await alternatives(f)).find(({ name }) => name === 'resolve-verifier-blocker')!;
    expect(retry.commandArgs).toContain('--proposal-hash');
    expect((await executeAlternative(retry)).exitCode).toBe(0);
    const cold = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(path.resolve('test/helpers/native-source-loader.mjs')).href,
          '--input-type=module',
          '-e',
          `const { runNativeCli } = await import(${JSON.stringify(pathToFileURL(path.resolve('domains/comet-native/native-cli.ts')).href)}); process.stdout.write(JSON.stringify(await runNativeCli(${JSON.stringify(['status', f.name, '--project-root', f.projectRoot, '--json'])})));`,
        ],
        { encoding: 'utf8' },
      ),
    );
    expect(cold.exitCode, cold.stderr).toBe(0);
    expect(JSON.parse(cold.stdout).data.pendingActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ stepId: 'verify.verifier' })]),
    );
    const reopened = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    let run = await reopened.runtime.inspect(f.name);
    expect(parseNativePortableState(run.state).builder_handoff).toEqual(old.builder_handoff);
    expect(run.actions.find(({ id }) => id === check.id)?.outcome).toEqual(check.outcome);
    const verifier = run.actions.findLast(({ status }) => status === 'pending')!;
    expect(verifier.stepId).toBe('verify.verifier');
    expect(verifier.input).toMatchObject({
      activation: {
        recoveryWaitId: f.run.waits.at(-1)!.id,
        reason: 'The user explicitly chose this recovery.',
      },
    });
    expect(parseNativePortableState(run.state).history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'recovery',
          summary: expect.objectContaining({ text: 'The user explicitly chose this recovery.' }),
        }),
      ]),
    );
    expect(run.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(1);
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    for (let index = 0; index < 2; index++) {
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      expect((await f.native(['status', f.name])).exitCode).toBe(0);
    }
    const current = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(current.actions.filter(({ stepId }) => stepId === 'verify.verifier')).toHaveLength(2);
    const state = parseNativePortableState(current.state);
    run = await f.record(
      verifier,
      {
        candidateId: state.builder_handoff!.candidate_id,
        verifierExecutionRef: 'replacement-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: [
              {
                id: 'A1',
                result: 'passed',
                reason: 'The replacement independently reviewed the original candidate.',
              },
            ],
            risks: [],
            summary: 'Independent review passed with retained Runtime checks.',
          },
        },
      },
      'replacement-verifier',
    );
    expect(run.actions.at(-1)?.stepId).toBe('verify.report');
    expect((await f.native(['next', f.name])).exitCode).toBe(0);
    const passed = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(passed.waits.at(-1)).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
    expect(passed.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(1);
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
  });

  it.each(['accept-result', 'revise-implementation', 'revise-requirements'])(
    'offers only executable decisions after recovered one-shot checks pass (%s)',
    async (decision) => {
      const f = await blockedFixture();
      const resume = (await alternatives(f)).find(
        ({ name }) => name === 'resolve-verifier-blocker',
      )!;
      expect((await executeAlternative(resume)).exitCode).toBe(0);
      let run = await f.dispatch({ operation: 'inspect', runId: f.name });
      const verifier = run.actions.findLast(({ status }) => status === 'pending')!;
      const state = parseNativePortableState(run.state);
      await f.record(
        verifier,
        {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: 'replacement',
          response: {
            kind: 'final-result',
            result: {
              iteration: state.loop.iteration,
              attempt: state.loop.attempt,
              verdict: 'pass',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Observed the retained candidate.' },
              ],
              risks: [],
              summary: 'Independent review passed.',
            },
          },
        },
        'replacement',
      );
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      run = await f.dispatch({ operation: 'inspect', runId: f.name });
      const status = JSON.parse((await f.native(['status', f.name])).stdout!).data;
      const commands = status.continuation.commandAlternatives as Alternative[];
      expect(commands.map(({ name }) => name)).toEqual([
        'accept-result',
        'revise-implementation',
        'revise-requirements',
      ]);
      expect(status.continuation.userCommunication.agentInstruction).toMatch(/one-shot|不可重复/);
      const wait = status.pendingWaits.find(
        (entry: { stepId: string }) => entry.stepId === 'verify.confirm',
      );
      expect(wait.choices).toEqual(['approved', 'rejected']);
      expect(wait.decisionRequests.map((request: { choice: string }) => request.choice)).toEqual([
        'approved',
        'rejected',
      ]);
      const accept = commands.find(({ name }) => name === 'accept-result')!;
      const forged = accept.commandArgs.map((arg) =>
        arg === '--accept-result'
          ? '--retry-verifier'
          : arg === 'accept-result'
            ? 'retry-verifier'
            : arg,
      );
      const rejected = await executeAlternative({ name: 'retry-verifier', commandArgs: forged });
      expect(rejected.exitCode, rejected.stdout).toBe(73);
      expect(JSON.parse(rejected.stdout!).data.continuation.commandAlternatives).toEqual(commands);
      await expect(
        f.dispatch({
          ...wait.decisionRequests[0],
          decisionId: 'forged-reverify',
          choice: 'reverify',
        }),
      ).rejects.toThrow();
      expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(run);
      const chosen = commands.find(({ name }) => name === decision)!;
      const staleArgs = [...chosen.commandArgs];
      staleArgs[staleArgs.indexOf('--expected-state-version') + 1] = '1';
      expect((await executeAlternative({ ...chosen, commandArgs: staleArgs })).exitCode).toBe(73);
      expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(run);
      const result = await executeAlternative(chosen);
      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    },
  );

  it.each([true, false])(
    'uses only the current ordinary candidate retry capability after leaving Supervisor (repeatable=%s)',
    async (repeatable) => {
      const f = await blockedFixture({ supervisor: true, repeatableChecks: !repeatable });
      const revise = (await alternatives(f)).find(({ name }) => name === 'revise-requirements')!;
      expect((await executeAlternative(revise)).exitCode).toBe(0);
      await fs.rm(path.join(f.projectRoot, 'docs/comet/changes', f.name, 'children.yaml'));
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      let run = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(
        (
          await f.native([
            'next',
            f.name,
            '--confirmed',
            '--summary',
            'Confirm ordinary workflow',
            '--expected-state-version',
            String(parseNativePortableState(run.state).state_version),
            '--expected-action',
            'confirm-shape',
          ])
        ).exitCode,
      ).toBe(0);
      run = await f.dispatch({ operation: 'inspect', runId: f.name });
      const builder = run.actions.findLast(({ status }) => status === 'pending')!;
      expect(builder.stepId).toBe('build.builder');
      run = await f.record(
        builder,
        {
          summary: 'Ordinary candidate',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          submittedAt: new Date().toISOString(),
          verificationChecks: [
            {
              id: 'ordinary-repeatable',
              name: 'ordinary-repeatable',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable,
            },
          ],
        },
        'ordinary-builder',
      );
      const check = run.actions.findLast(({ status }) => status === 'pending')!;
      run = await f.dispatch({
        operation: 'execute',
        runId: f.name,
        actionId: check.id,
        executorId: 'comet-native-checks',
      });
      expect(run.actions.find(({ id }) => id === check.id)).toMatchObject({
        status: 'succeeded',
        outcome: { output: { checks: [{ id: 'ordinary-repeatable' }] } },
      });
      const state = parseNativePortableState(run.state);
      await f.record(
        run.actions.findLast(({ status }) => status === 'pending')!,
        {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: 'ordinary-verifier',
          response: {
            kind: 'final-result',
            result: {
              iteration: state.loop.iteration,
              attempt: state.loop.attempt,
              verdict: 'pass',
              acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed ordinary candidate.' }],
              risks: [],
              summary: 'Ordinary review passed.',
            },
          },
        },
        'ordinary-verifier',
      );
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      const retry = (await alternatives(f)).find(({ name }) => name === 'retry-verifier')!;
      if (repeatable) {
        expect(retry).toBeDefined();
        const result = await executeAlternative(retry);
        expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      } else {
        expect(retry).toBeUndefined();
      }
      run = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(run.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(
        repeatable ? 3 : 2,
      );
      expect(await fs.readFile(path.join(f.candidateRoot, 'check-count'), 'utf8')).toBe('once\n');
    },
    supervisorRecoveryTimeout,
  );

  it('rejects stale proposal, state, and used outcome identities without dispatching a duplicate', async () => {
    const f = await blockedFixture();
    const action = (await alternatives(f)).find(({ name }) => name === 'resolve-verifier-blocker')!;
    for (const [flag, value] of [
      ['--proposal-hash', '0'.repeat(64)],
      ['--expected-state-version', '1'],
    ]) {
      const commandArgs = [...action.commandArgs];
      commandArgs[commandArgs.indexOf(flag) + 1] = value;
      expect((await executeAlternative({ ...action, commandArgs })).exitCode).toBe(73);
      expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(f.run);
    }
    expect((await executeAlternative(action)).exitCode).toBe(0);
    const original = f.run.actions.find(({ stepId }) => stepId === 'verify.verifier')!;
    await expect(
      f.dispatch({
        operation: 'claim',
        runId: f.name,
        actionId: original.id,
        attempt: original.attempt,
        inputHash: original.inputHash,
        executorId: 'native-host',
        sessionId: 'replayed-verifier',
        claimToken: 'replay',
      }),
    ).rejects.toThrow();
    await expect(
      f.dispatch({
        operation: 'record-outcome',
        runId: f.name,
        outcome: { ...original.outcome!, outcomeId: 'forged-second-result' },
      }),
    ).rejects.toThrow();
    expect(
      (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.filter(
        ({ stepId }) => stepId === 'verify.verifier',
      ),
    ).toHaveLength(2);
  });
  it('upgrades an existing 0.5.0 blocked Run without rebuilding candidates or replaying checks', async () => {
    const f = await blockedFixture({ legacy: true });
    expect(f.run.workflow.hash).toBe(
      'fb7d10f66cb304d7b7470fdba5aef47f9dba222d8bea539632e2bba50e0743a7',
    );
    expect(f.run.waits.at(-1)).toMatchObject({
      stepId: 'verify.stop',
      status: 'pending',
      choices: ['repair'],
    });
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    const status = JSON.parse((await f.native(['status', f.name])).stdout!).data;
    expect(status.continuation.commandAlternatives).toBeUndefined();
    expect(status.continuation.commandArgs.slice(0, 5)).toEqual([
      'comet',
      'native',
      'doctor',
      f.name,
      '--repair',
    ]);
    const diagnosis = JSON.parse((await f.native(['doctor', f.name])).stdout!).data;
    expect(diagnosis).toMatchObject({
      healthy: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'sdk-definition-upgrade-required' }),
      ]),
    });
    expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(before);
    const upgraded = await runNativeCli(status.continuation.commandArgs.slice(2));
    expect(upgraded.exitCode, upgraded.stderr || upgraded.stdout).toBe(0);
    const migrated = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(migrated.waits.at(-1)).toMatchObject({
      id: before.waits.at(-1)!.id,
      proposalHash: before.waits.at(-1)!.proposalHash,
      choices: ['retry', 'repair'],
    });
    expect(migrated.state).toEqual(before.state);
    for (const action of before.actions)
      expect(migrated.actions.find(({ id }) => id === action.id)?.outcome).toEqual(action.outcome);
    const retry = (await alternatives(f)).find(({ name }) => name === 'resolve-verifier-blocker')!;
    expect((await executeAlternative(retry)).exitCode).toBe(0);
    const resumed = await (
      await loadOwnedNativeSdkRuntime(f.projectRoot, f.name)
    ).runtime.inspect(f.name);
    expect(resumed.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    expect(resumed.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(1);
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
  });
  it('keeps an upgraded 0.5.0 blocked Run unchanged on environment drift and advertises executable repair', async () => {
    const f = await blockedFixture({ legacy: true });
    const status = JSON.parse((await f.native(['status', f.name])).stdout!).data;
    expect((await runNativeCli(status.continuation.commandArgs.slice(2))).exitCode).toBe(0);
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    const checks = before.outputs['verify.checks'].value as Record<string, RuntimeValue>;
    expect(checks.inputSnapshot).toBeUndefined();
    const commands = await alternatives(f);
    const retry = commands.find(({ name }) => name === 'resolve-verifier-blocker')!;
    const repair = commands.find(({ name }) => name === 'revise-implementation')!;
    const originalShell = process.env.SHELL;
    try {
      process.env.SHELL = `${originalShell ?? '/bin/sh'}-changed-after-upgrade`;
      const result = await executeAlternative(retry);
      expect(result.exitCode).toBe(73);
      const rejected = JSON.parse(result.stdout!);
      expect(rejected.error.message).toContain('旧版检查收据无法区分输入变化与执行环境差异');
      expect(rejected.error.message).toContain('revise-implementation');
      expect(rejected.error.message).not.toContain('refreshChecks');
      expect(rejected.data.continuation.commandAlternatives).toContainEqual(repair);
      expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(before);
      expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
      expect((await executeAlternative(repair)).exitCode).toBe(0);
      const resumed = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(resumed.actions.at(-1)).toMatchObject({ stepId: 'build.builder', status: 'pending' });
      expect(resumed.outputs['verify.checks']).toEqual(before.outputs['verify.checks']);
      expect(resumed.actions.filter(({ stepId }) => stepId === 'verify.verifier')).toHaveLength(1);
      expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    } finally {
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
    }
  });
  it.each(['resolve-verifier-blocker', 'revise-implementation'])(
    'executes the advertised Supervisor parent %s without changing completed Child work',
    async (name) => {
      const f = await blockedFixture({ supervisor: true });
      const childActions = f.run.actions.filter(({ stepId }) =>
        stepId.startsWith('supervisor.child.'),
      );
      const action = (await alternatives(f)).find((alternative) => alternative.name === name)!;
      const result = await executeAlternative(action);
      expect(result.exitCode, result.stderr || result.stdout).toBe(0);
      const resumed = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(resumed.actions.at(-1)).toMatchObject({
        stepId:
          name === 'resolve-verifier-blocker' ? 'verify.verifier' : 'supervisor.parent.builder',
        status: 'pending',
      });
      for (const original of childActions)
        expect(resumed.actions.find(({ id }) => id === original.id)?.outcome).toEqual(
          original.outcome,
        );
      expect(resumed.actions.filter(({ stepId }) => stepId === 'verify.checks')).toHaveLength(1);
      expect(await fs.readFile(path.join(f.candidateRoot, 'check-count'), 'utf8')).toBe('once\n');
    },
    supervisorRecoveryTimeout,
  );
  it('executes the exact advertised Runtime decision with its reason and preserves proposal binding', async () => {
    const f = await blockedFixture();
    const status = JSON.parse((await f.native(['status', f.name])).stdout!).data;
    const wait = status.pendingWaits.find(
      (wait: { stepId: string }) => wait.stepId === 'verify.stop',
    );
    const request = wait.decisionRequests.find(
      (request: { choice: string }) => request.choice === 'retry',
    );
    expect(request.reason).toBe('<summary>');
    const reason = 'External service is available again; use the original candidate.';
    const resumed = await f.dispatch({ ...request, decisionId: 'explicit-retry', reason });
    expect(resumed.waits.at(-1)?.decision).toMatchObject({
      reason,
      proposalHash: wait.proposalHash,
    });
    expect(resumed.actions.at(-1)?.input).toMatchObject({
      activation: { recoveryWaitId: wait.id, reason },
    });
    await expect(f.dispatch({ ...request, decisionId: 'second-retry', reason })).rejects.toThrow();
    expect(
      (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.filter(
        ({ stepId }) => stepId === 'verify.verifier',
      ),
    ).toHaveLength(2);
  });

  it('rejects stale check evidence without replay, while keeping explicit implementation repair available', async () => {
    const f = await blockedFixture();
    const commands = await alternatives(f);
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'changed implementation\n');
    const retry = commands.find(({ name }) => name === 'resolve-verifier-blocker')!;
    expect((await executeAlternative(retry)).exitCode).not.toBe(0);
    expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(f.run);
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    const repair = commands.find(({ name }) => name === 'revise-implementation')!;
    expect((await executeAlternative(repair)).exitCode).toBe(0);
    expect(
      (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.at(-1),
    ).toMatchObject({ stepId: 'build.builder', status: 'pending' });
  });

  it(
    'keeps the current Supervisor Child blocked repair executable without reusing its Verifier',
    async () => {
      const f = await blockedFixture({ supervisor: true, blockedChild: true });
      expect(f.run.status).toBe('running');
      const original = f.run.actions.findLast(
        ({ stepId }) => stepId === 'supervisor.child.verifier',
      )!;
      expect(original).toMatchObject({ outcome: { output: { verdict: 'blocked' } } });
      const status = JSON.parse((await f.native(['status', f.name])).stdout!).data;
      const pending = status.pendingActions.find(
        (action: { stepId: string }) => action.stepId === 'supervisor.child.builder',
      );
      expect(pending).toBeDefined();
      const request = {
        ...pending.claimRequest,
        sessionId: 'child-repair-builder',
        claimToken: 'child-repair-token',
      };
      const resumed = await f.dispatch(request);
      expect(resumed.actions.at(-1)).toMatchObject({
        id: pending.id,
        stepId: 'supervisor.child.builder',
        status: 'running',
      });
      expect(resumed.actions.find(({ id }) => id === original.id)?.outcome).toEqual(
        original.outcome,
      );
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      expect(
        (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.filter(
          ({ stepId }) => stepId === 'supervisor.child.verifier',
        ),
      ).toHaveLength(2);
    },
    supervisorRecoveryTimeout,
  );
});
