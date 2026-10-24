import { execFileSync } from 'node:child_process';
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

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function blockedFixture(
  options: { legacy?: boolean; supervisor?: boolean; blockedChild?: boolean } = {},
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
    const requestFile = path.join(root, `request-${++count}.json`);
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
    return (useReleased ? releasedNative! : runNativeCli)([
      ...args,
      '--project-root',
      projectRoot,
      '--json',
    ]);
  }
  async function record(action: RuntimeAction, output: RuntimeValue, sessionId: string) {
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
        outcomeId: `${action.id}-result`,
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
        change_branch: 'main',
        target_branch: 'main',
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
  expect((await native(['next', name])).exitCode).toBe(0);
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
      candidateCommit: git(['rev-parse', 'HEAD'], candidateRoot),
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      submittedAt: new Date().toISOString(),
      verificationChecks: [
        {
          id: 'one-shot',
          name: 'one-shot',
          executable: process.execPath,
          argv: ['-e', "require('node:fs').appendFileSync('check-count', 'once\\n')"],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: false,
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
          verdict: 'blocked',
          acceptance: [
            {
              id: 'A1',
              result: 'blocked',
              reason: 'The requested independent model was unavailable.',
            },
          ],
          risks: [],
          summary: 'Use the correct independent model, without changing requirements.',
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

describe('blocked Verifier recovery command contract', () => {
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
          path.resolve('test/helpers/native-source-loader.mjs'),
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
    120_000,
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

  it('keeps the current Supervisor Child blocked repair executable without reusing its Verifier', async () => {
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
    expect(resumed.actions.find(({ id }) => id === original.id)?.outcome).toEqual(original.outcome);
    expect((await f.native(['next', f.name])).exitCode).toBe(0);
    expect(
      (await f.dispatch({ operation: 'inspect', runId: f.name })).actions.filter(
        ({ stepId }) => stepId === 'supervisor.child.verifier',
      ),
    ).toHaveLength(2);
  }, 120_000);
});
