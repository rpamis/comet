import '../../helpers/isolated-agent-home.js';
type FixtureCommand = {
  id: string;
  name: string;
  executable: string;
  argv: string[];
  cwdRef: string;
  timeoutMs: number;
  repeatable: boolean;
};
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeDispatchCommand } from '../../../app/commands/runtime.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableState,
  parseNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type RuntimeAction,
  type RuntimeValue,
} from '../../../domains/engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
// Windows 上未修改基线的双工作区修复案例需约 125 秒；保留全部断言并给完整事务留出执行时间。
const supervisorRecoveryTimeout = process.platform === 'win32' ? 240_000 : 120_000;
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function blockedFixture(
  options: {
    supervisor?: boolean;
    blockedChild?: boolean;
    repeatableChecks?: boolean;
    verificationChecks?: FixtureCommand[];
    syntaxFiles?: boolean;
    bomSource?: boolean;
    bundleCommands?: boolean;
    misclaimedVerifier?: boolean;
    inProjectRequests?: boolean;
    projectAlias?: boolean;
    dirtyEmbedded?: boolean;
    generatedEmbedded?: boolean;
    directPass?: boolean;
    nonGitEnvironment?: boolean;
    documentWrites?: 'allow' | 'revert';
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-blocked-recovery-'));
  roots.push(root);
  let projectBase = root;
  if (options.projectAlias) {
    const physicalBase = path.join(root, 'physical');
    await fs.mkdir(physicalBase);
    projectBase = path.join(root, 'project-alias');
    await fs.symlink(physicalBase, projectBase, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const projectRoot = path.join(projectBase, 'project');
  const name = 'blocked-candidate';
  const change = path.join(projectRoot, 'docs/comet/changes', name);
  await fs.mkdir(path.join(change, 'specs/example'), { recursive: true });
  const config = defaultProjectConfig('docs', 'en');
  await writeProjectConfig(projectRoot, {
    ...config,
    native: {
      ...config.native,
      document_writes: options.documentWrites ?? 'revert',
    },
  });
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
      if (name === 'server' && options.bomSource !== undefined)
        await fs.writeFile(
          path.join(child, 'utf8-source.mjs'),
          `${options.bomSource ? '\ufeff' : ''}export const value = 1;\n`,
        );
      await fs.writeFile(path.join(child, '.env.development'), 'VUE_APP_BASE_API=/api\n');
      git(['add', '.'], child);
      git(['commit', '-qm', 'synthetic environment'], child);
    }
    await fs.rm(path.join(projectRoot, '.git'), {
      recursive: true,
      force: true,
    });
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
  let agentReports: Array<{ name: string; result: string; note: string }> = [];
  async function dispatch(request: Record<string, unknown>) {
    count += 1;
    const requestFile = options.inProjectRequests
      ? path.join(projectRoot, 'dispatch-request.json')
      : path.join(root, `request-${count}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    const result = await runtimeDispatchCommand({
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
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }
    return runNativeCli(argv);
  }
  async function record(
    action: RuntimeAction,
    output: RuntimeValue,
    sessionId: string,
    outcomeId = `${action.id}-result`,
    afterClaim?: () => Promise<void>,
  ) {
    const value = output as Record<string, unknown>;
    const plans = value.verificationChecks as FixtureCommand[] | undefined;
    if (plans) {
      const a = (
        action.input as {
          activation?: { worktree?: string; integrationWorktree?: string };
        }
      ).activation;
      const cwd = a?.worktree ?? a?.integrationWorktree ?? projectRoot;
      agentReports = plans.map((plan) => {
        const actual = spawnSync(plan.executable, plan.argv, {
          cwd: path.resolve(cwd, plan.cwdRef),
          windowsHide: true,
          timeout: plan.timeoutMs,
        });
        expect(actual.status).toBe(0);
        return {
          name: plan.name,
          result: 'passed',
          note: 'Actual Agent platform command exited 0; SIMULATED protocol report.',
        };
      });
      const next = {
        ...value,
        checks: agentReports,
        requireIndependentReview: true,
      };
      delete next.verificationChecks;
      output = next;
    } else if (value.response && !Object.hasOwn(value, 'checks'))
      output = { ...value, checks: agentReports };
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
    await afterClaim?.();
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
    workflow: { id: 'comet-native', version: '4' },
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
  await dispatch({ operation: 'start', ...start });
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
      'supervisor.child.integrate': 'native-supervisor-integrate',
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
          action.input as {
            activation: { candidateCommit: string; child: string };
          }
        ).activation;
        const blockedChild = Boolean(options.blockedChild && activation.child === 'right');
        run = await record(
          action,
          {
            candidateCommit: activation.candidateCommit,
            verdict: blockedChild ? 'blocked' : 'pass',
            evidence: {
              summary: 'Independently reviewed child',
              checks: [
                {
                  name: 'Actual Child platform command',
                  result: 'passed',
                  note: 'Agent executed Node exit 0 in this Child.',
                },
              ],
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
  const state = parseNativePortableState(run.state);
  if (options.misclaimedVerifier) {
    const action = run.actions.find(({ status }) => status === 'pending')!;
    // 重现旧版已接受的错误领取；当前 Native 入口会在领取阶段拒绝它。
    const application = defineNativeWorkflowApplication();
    const rawRuntime = createRuntime({
      ...application,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      store: createFileRuntimeStore({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'sdk-runs', 'native'),
      }),
    });
    run = await rawRuntime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: 'builder',
      claimToken: 'misclaimed-verifier',
    });
    return {
      root,
      projectRoot,
      candidateRoot,
      name,
      run,
      dispatch,
      native,
      record,
    };
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
  return {
    root,
    projectRoot,
    candidateRoot,
    name,
    run,
    dispatch,
    native,
    record,
  };
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
    verificationChecks?: FixtureCommand[];
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
  const current = await f.dispatch({ operation: 'inspect', runId: f.name }),
    wait = current.waits.findLast((w) => w.status === 'pending')!;
  await f.dispatch({
    operation: 'resolve-wait',
    runId: f.name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'SIMULATED-USER-current-result-approved',
    choice: 'approved',
    reason: 'SIMULATED explicit result acceptance for isolated test.',
  });
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
  expect(
    parseNativePortableState((await f.dispatch({ operation: 'inspect', runId: f.name })).state)
      .shape_confirmation_hash,
  ).toBe(shape);
  const archived = await f.native(['archive', f.name]);
  expect(archived.exitCode, archived.stdout).toBe(0);
  expect((await f.dispatch({ operation: 'inspect', runId: f.name })).state).toMatchObject({
    archived: true,
  });
  expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
}

async function reviseApprovedImplementation(
  f: Awaited<ReturnType<typeof archiveReadyFixture>>,
  summary: string,
) {
  const run = await f.dispatch({ operation: 'inspect', runId: f.name });
  const state = parseNativePortableState(run.state);
  const approval = run.waits.findLast(
    (wait) =>
      wait.stepId === 'verify.confirm' &&
      wait.status === 'resolved' &&
      wait.decision?.choice === 'approved',
  )!;
  return f.native([
    'next',
    f.name,
    '--revise-implementation',
    '--summary',
    summary,
    '--proposal-hash',
    approval.proposalHash,
    '--expected-state-version',
    String(state.state_version),
    '--expected-action',
    'revise-implementation',
  ]);
}

describe('blocked Verifier recovery command contract', () => {
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
    const repaired = await reviseApprovedImplementation(f, 'Keep the work after branch takeover.');
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    await finishRepairedCandidate(f, shape);
  });
  it('keeps Archive and Doctor read-only after an Agent-accepted edit without content proof', async () => {
    const f = await archiveReadyFixture();
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'unverified change\n');
    const preview = JSON.parse((await f.native(['archive', f.name, '--dry-run'])).stdout!);
    expect(preview.data).toMatchObject({ ready: true });
    expect(preview.data.blockers).toEqual([]);
    const doctor = JSON.parse((await f.native(['doctor', f.name])).stdout!);
    expect(doctor.data).toMatchObject({ healthy: true });

    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.revision).toBe(before.revision);
    expect(after.state).toEqual(before.state);
  });

  it('repairs an implementation edited after Archive approval through explicit revision and original Shape', async () => {
    const f = await archiveReadyFixture({ directPass: true });
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    const shape = parseNativePortableState(before.state).shape_confirmation_hash;
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'user implementation revision\n');
    const repaired = await reviseApprovedImplementation(f, 'Retain the revised implementation.');
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.runId).toBe(before.runId);
    expect(parseNativePortableState(after.state)).toMatchObject({
      phase: 'build',
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
    const f = await archiveReadyFixture({
      directPass: true,
      bundleCommands: false,
    });
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'user implementation revision\n');
    const repaired = await reviseApprovedImplementation(f, 'Keep the user revision.');
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

  it('archives the original approved result without consuming another Verify failure', async () => {
    const f = await archiveReadyFixture({ deferredRevalidation: true });
    const before = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(before.actions.at(-1)).toMatchObject({
      stepId: 'archive.prepare',
      status: 'pending',
    });
    const archived = await f.native(['archive', f.name]);
    expect(archived.exitCode, archived.stdout ?? archived.stderr).toBe(0);
    const after = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(after.state).toMatchObject({ archived: true });
    expect(parseNativePortableState(after.state).loop.failed_iteration_count).toEqual(
      parseNativePortableState(before.state).loop.failed_iteration_count,
    );
    expect(after.actions.some(({ stepId }) => stepId === 'verify.revalidate')).toBe(false);
  });

  it.each(['running', 'changed-requirements', 'unknown'])(
    'ends a misclaimed Verifier as failed and archives through an independent replacement without repeating checks: %s',
    async (scenario) => {
      const changedRequirements = scenario === 'changed-requirements';
      const unknown = scenario === 'unknown';
      const f = await blockedFixture({
        misclaimedVerifier: true,
        bundleCommands: true,
      });
      const action = f.run.actions.findLast(({ stepId }) => stepId === 'verify.verifier')!;
      const original = parseNativePortableState(f.run.state);
      const checks = f.run.actions.find(({ stepId }) => stepId === 'build.builder' && stepId)!;
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
      expect(failed.actions.find(({ id }) => id === action.id)).toMatchObject({
        status: 'failed',
      });
      expect(failed.state).toMatchObject({
        phase: 'verify',
        builder_handoff: {
          candidate_id: original.builder_handoff!.candidate_id,
        },
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
      if (changedRequirements) await fs.writeFile(spec, approvedSpec);
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
      expect(run.actions.find(({ id }) => id === checks.id)).toEqual(checks);
      expect(run.actions.find(({ id }) => id === action.id)).toMatchObject({
        status: 'failed',
      });
      expect(
        run.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'succeeded'),
      ).toHaveLength(1);
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
    const check = f.run.actions.find(
      (a) => a.stepId === 'build.builder' && a.status === 'succeeded',
    )!;
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
          summary: expect.objectContaining({
            text: 'The user explicitly chose this recovery.',
          }),
        }),
      ]),
    );
    expect(
      run.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'succeeded'),
    ).toHaveLength(1);
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
    expect(run.waits.at(-1)?.stepId).toBe('verify.confirm');
    expect((await f.native(['next', f.name])).exitCode).toBe(0);
    const passed = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(passed.waits.at(-1)).toMatchObject({
      stepId: 'verify.confirm',
      status: 'pending',
    });
    expect(
      passed.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'succeeded'),
    ).toHaveLength(1);
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
                {
                  id: 'A1',
                  result: 'passed',
                  reason: 'Observed the retained candidate.',
                },
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
      expect(
        commands.map(({ name }) => name),
        JSON.stringify(commands.map(({ name }) => name)),
      ).toEqual([
        'accept-result',
        'revise-implementation',
        'retry-verifier',
        'revise-requirements',
      ]);
      const wait = status.pendingWaits.find(
        (entry: { stepId: string }) => entry.stepId === 'verify.confirm',
      );
      expect(wait.choices).toEqual(['approved', 'rejected', 'reverify']);
      expect(wait.decisionRequests.map((request: { choice: string }) => request.choice)).toEqual([
        'approved',
        'rejected',
        'reverify',
      ]);
      const accept = commands.find(({ name }) => name === 'accept-result')!;
      const forged = accept.commandArgs.map((arg) =>
        arg === '--accept-result'
          ? '--resolve-verifier-blocker'
          : arg === 'accept-result'
            ? 'resolve-verifier-blocker'
            : arg,
      );
      const rejected = await executeAlternative({
        name: 'resolve-verifier-blocker',
        commandArgs: forged,
      });
      expect(rejected.exitCode, rejected.stdout).toBe(73);
      expect(JSON.parse(rejected.stdout!).data.continuation.commandAlternatives).toEqual(commands);
      await expect(
        f.dispatch({
          ...wait.decisionRequests[0],
          decisionId: 'forged-reverify',
          choice: 'retry',
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
      const f = await blockedFixture({
        supervisor: true,
        repeatableChecks: !repeatable,
      });
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
      const ordinaryBuilder = run.actions.findLast(
        (a) => a.stepId === 'build.builder' && a.status === 'succeeded',
      )!;
      expect(ordinaryBuilder.outcome?.output).toMatchObject({
        checks: [{ name: 'ordinary-repeatable', result: 'passed' }],
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
              acceptance: [
                {
                  id: 'A1',
                  result: 'passed',
                  reason: 'Observed ordinary candidate.',
                },
              ],
              risks: [],
              summary: 'Ordinary review passed.',
            },
          },
        },
        'ordinary-verifier',
      );
      expect((await f.native(['next', f.name])).exitCode).toBe(0);
      const retry = (await alternatives(f)).find(({ name }) => name === 'retry-verifier')!;
      expect(retry).toBeDefined();
      const originalBuilderCount = run.actions.filter(
        (a) => a.stepId === 'build.builder' && a.status === 'succeeded',
      ).length;
      const result = await executeAlternative(retry);
      expect(result.exitCode, result.stdout || result.stderr).toBe(0);
      run = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(run.actions.at(-1)).toMatchObject({
        stepId: 'verify.verifier',
        status: 'pending',
      });
      expect(
        run.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'succeeded'),
      ).toHaveLength(originalBuilderCount);
      expect(run.actions.find((a) => a.id === ordinaryBuilder.id)).toEqual(ordinaryBuilder);
      expect(
        run.actions.some(
          (a) => a.stepId === 'verify.checks' || a.stepId === 'verify.requested-checks',
        ),
      ).toBe(false);
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
  it('reopens the original blocked Run without rebuilding candidates or replaying platform checks', async () => {
    const f = await blockedFixture(),
      before = await f.dispatch({ operation: 'inspect', runId: f.name }),
      loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name, {
        readOnly: true,
      });
    expect(await loaded.runtime.inspect(f.name)).toEqual(before);
    const retry = (await alternatives(f)).find((a) => a.name === 'resolve-verifier-blocker')!;
    expect((await executeAlternative(retry)).exitCode).toBe(0);
    const run = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(run.runId).toBe(before.runId);
    for (const a of before.actions) expect(run.actions.find((x) => x.id === a.id)).toEqual(a);
    expect(run.actions.at(-1)?.stepId).toBe('verify.verifier');
    expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
  });
  it('repairs the original blocked Run across shell changes without repeating platform checks', async () => {
    const f = await blockedFixture(),
      before = await f.dispatch({ operation: 'inspect', runId: f.name }),
      repair = (await alternatives(f)).find((a) => a.name === 'revise-implementation')!;
    const shell = process.env.SHELL;
    try {
      process.env.SHELL = (shell ?? '/bin/sh') + '-different';
      expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(before);
      expect((await executeAlternative(repair)).exitCode).toBe(0);
      const run = await f.dispatch({ operation: 'inspect', runId: f.name });
      expect(run.actions.at(-1)?.stepId).toBe('build.builder');
      for (const a of before.actions) expect(run.actions.find((x) => x.id === a.id)).toEqual(a);
      expect(await fs.readFile(path.join(f.projectRoot, 'check-count'), 'utf8')).toBe('once\n');
    } finally {
      if (shell === undefined) delete process.env.SHELL;
      else process.env.SHELL = shell;
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
      const parentBuilder = f.run.actions.find(
        (a) => a.stepId === 'supervisor.parent.builder' && a.status === 'succeeded',
      )!;
      expect(parentBuilder).toBeDefined();
      expect(resumed.actions.find((a) => a.id === parentBuilder.id)).toEqual(parentBuilder);
      expect(
        resumed.actions.filter(
          (a) => a.stepId === 'supervisor.parent.builder' && a.status === 'succeeded',
        ),
      ).toHaveLength(1);
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
    const resumed = await f.dispatch({
      ...request,
      decisionId: 'explicit-retry',
      reason,
    });
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

  it('uses explicit implementation repair after an Agent judges edits without replaying original checks', async () => {
    const f = await blockedFixture();
    const commands = await alternatives(f);
    await fs.writeFile(path.join(f.projectRoot, 'candidate.txt'), 'changed implementation\n');
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
      expect(original).toMatchObject({
        outcome: { output: { verdict: 'blocked' } },
      });
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
