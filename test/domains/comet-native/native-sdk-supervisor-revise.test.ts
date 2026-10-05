import { spawnSync, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { RuntimeAction, WorkflowRun } from '../../../domains/engine/runtime.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  for (const root of roots.splice(0)) {
    const actual = await fs.realpath(root);
    const relative = path.relative(temporaryRoot, actual);
    if (
      path.isAbsolute(relative) ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      !path.basename(actual).startsWith('comet-sdk-build-revision-')
    )
      throw new Error('测试清理路径不属于本次临时目录');
    await fs.rm(actual, { recursive: true, force: true });
  }
});

async function supervisor() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-build-revision-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  await writeProjectConfig(project, defaultProjectConfig('docs', 'en'));
  const name = 'build-revision';
  const change = path.join(project, 'docs/comet/changes', name);
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nShip the workflow.\n# Scope\nTwo children.\n# Non-goals\nPublishing.\n# Acceptance examples\n- The workflow resumes.\n# Directory structure\n## Created\n- left.txt\n- right.txt\n## Modified\nNone.\n## Deleted\nNone.\n## Not created\nNo service.\n',
  );
  await fs.writeFile(
    path.join(change, 'specs/workflow/spec.md'),
    '# Workflow\nThe workflow resumes.\n',
  );
  await fs.writeFile(
    path.join(change, 'children.yaml'),
    'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The workflow resumes.\nchildren:\n  - name: left\n    depends_on: []\n    covers: [A1]\n  - name: right\n    depends_on: [left]\n    covers: [A1]\n',
  );
  await fs.writeFile(
    path.join(project, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n**/comet-state.yaml\n**/verification.md\n',
  );
  const git = (cwd: string, argv: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...argv],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(project, ['init', '-b', 'main']);
  git(project, ['add', '.']);
  git(project, ['commit', '-m', 'base']);
  const targetCommit = git(project, ['rev-parse', 'HEAD']);
  git(project, ['config', 'user.name', 'Comet Test']);
  git(project, ['config', 'user.email', 'comet-test@example.com']);
  const candidateCli = process.env.COMET_NATIVE_CANDIDATE_CLI ?? path.resolve('bin/comet.js');
  const baselineCli = process.env.COMET_NATIVE_BASELINE_CLI ?? candidateCli;
  function cli(argv: string[], file = candidateCli, projectRoot = project) {
    const result = spawnSync(process.execPath, [file, ...argv, '--project-root', projectRoot], {
      encoding: 'utf8',
      timeout: 60000,
    });
    if (result.error) throw result.error;
    return { exitCode: result.status, response: JSON.parse(result.stdout), stderr: result.stderr };
  }
  let sequence = 0;
  async function dispatchResult(request: Record<string, unknown>, file = candidateCli) {
    const requestFile = path.join(root, `request-${++sequence}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    return cli(['runtime', 'dispatch', '--application', 'native', '--request', requestFile], file);
  }
  async function dispatch(
    request: Record<string, unknown>,
    file = candidateCli,
  ): Promise<WorkflowRun> {
    const result = await dispatchResult(request, file);
    if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
    return result.response.data;
  }
  const started = await dispatch(
    {
      operation: 'start',
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
    },
    baselineCli,
  );
  expect(cli(['native', 'next', name, '--json'], baselineCli).exitCode).toBe(0);
  const proposal = await dispatch({ operation: 'inspect', runId: name }, baselineCli);
  const confirmed = cli(
    [
      'native',
      'next',
      name,
      '--confirmed',
      '--summary',
      'Confirmed full child scope',
      '--expected-state-version',
      String((proposal.state as { state_version: number }).state_version),
      '--expected-action',
      'confirm-shape',
      '--coordination-mode',
      'multi-session',
      '--json',
    ],
    baselineCli,
  );
  expect(confirmed.response).not.toHaveProperty('error');
  let run = await dispatch({ operation: 'inspect', runId: name }, baselineCli);
  for (
    let count = 0;
    count < 5 &&
    !run.actions.some((a) => a.stepId === 'supervisor.child.builder' && a.status === 'pending');
    count++
  ) {
    const next = cli(['native', 'next', name, '--json'], baselineCli);
    if (next.exitCode !== 0) throw new Error(JSON.stringify(next));
    run = await dispatch({ operation: 'inspect', runId: name }, baselineCli);
  }
  expect(run.actions.at(-1)).toMatchObject({
    stepId: 'supervisor.child.builder',
    status: 'pending',
  });
  const inspect = (file = candidateCli) => dispatch({ operation: 'inspect', runId: name }, file);
  const next = async (file = candidateCli): Promise<WorkflowRun> => {
    const result = cli(['native', 'next', name, '--json'], file);
    if (result.exitCode !== 0) {
      const inspected = await inspect(file);
      throw new Error(
        JSON.stringify({
          result,
          unresolved: inspected.actions
            .filter((action) => action.status === 'unknown' || action.status === 'failed')
            .map(({ id, stepId, reason }) => ({ id, stepId, reason })),
        }),
      );
    }
    const inspected = await inspect(file);
    // 归档属于子任务集成收尾，完成它后再读取下一项工作。
    if (
      inspected.actions.some(
        (action) => action.stepId === 'supervisor.child.archive' && action.status === 'pending',
      )
    ) {
      return next(file);
    }
    return inspected;
  };
  const pending = (value: WorkflowRun, step: string) =>
    value.actions.find((a) => a.stepId === step && a.status === 'pending')!;
  const claim = (action: RuntimeAction, file = candidateCli) =>
    dispatch(
      {
        operation: 'claim',
        runId: name,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId: action.id + '-session',
        claimToken: action.id + '-claim',
      },
      file,
    );
  const report = (action: RuntimeAction, output: unknown, file = candidateCli) =>
    dispatch(
      {
        operation: 'record-outcome',
        runId: name,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          outcomeId: action.id + '-result',
          status: 'succeeded',
          output,
        },
      },
      file,
    );
  const checkPlan = (child: string) => [
    {
      id: 'artifact-' + child,
      name: 'Read actual ' + child + ' artifact',
      executable: process.execPath,
      argv: [
        '-e',
        `const fs=require('node:fs');if(fs.readFileSync('${child}.txt','utf8').trim()!=='approved')process.exit(1);`,
      ],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: true,
    },
  ];
  async function submitChild(value: WorkflowRun, file = candidateCli, includeBase = false) {
    const builder = pending(value, 'supervisor.child.builder');
    const input = (
      builder.input as { activation: { child: string; worktree: string; baseCommit: string } }
    ).activation;
    if (includeBase) git(input.worktree, ['merge', '--ff-only', input.baseCommit]);
    await fs.writeFile(path.join(input.worktree, input.child + '.txt'), 'approved\n');
    git(input.worktree, ['add', input.child + '.txt']);
    git(input.worktree, ['commit', '--allow-empty', '-m', builder.id + ' candidate']);
    const claimed = await claim(builder, file);
    return report(
      claimed.actions.find((a) => a.id === builder.id)!,
      {
        summary: 'Actual candidate',
        candidateCommit: git(input.worktree, ['rev-parse', 'HEAD']),
        verificationChecks: checkPlan(input.child),
      },
      file,
    );
  }
  async function verifyChild(value: WorkflowRun, file = candidateCli) {
    const verifier = pending(value, 'supervisor.child.verifier');
    const input = (
      verifier.input as { activation: { child: string; worktree: string; candidateCommit: string } }
    ).activation;
    expect(
      (await fs.readFile(path.join(input.worktree, input.child + '.txt'), 'utf8')).trim(),
    ).toBe('approved');
    const claimed = await claim(verifier, file);
    return report(
      claimed.actions.find((a) => a.id === verifier.id)!,
      {
        candidateCommit: input.candidateCommit,
        verdict: 'pass',
        evidence: {
          summary: 'Distinct test executor inspected actual artifact',
          checks: ['artifact-' + input.child],
          acceptance: [{ id: 'A1', result: 'passed', reason: 'Actual artifact read' }],
        },
        integrationChecks: checkPlan(input.child),
      },
      file,
    );
  }
  const revise = (value: WorkflowRun) =>
    cli([
      'native',
      'next',
      name,
      '--revise-requirements',
      '--summary',
      'User narrows actual host acceptance to Claude Code; product Codex support remains.',
      '--expected-state-version',
      String((value.state as { state_version: number }).state_version),
      '--expected-action',
      'revise-requirements',
      '--json',
    ]);
  async function confirmAgain() {
    const proposal = await next();
    const confirmed = cli([
      'native',
      'next',
      name,
      '--confirmed',
      '--summary',
      'Confirmed changed host acceptance and retained product support',
      '--expected-state-version',
      String((proposal.state as { state_version: number }).state_version),
      '--expected-action',
      'confirm-shape',
      '--coordination-mode',
      'multi-session',
      '--json',
    ]);
    if (confirmed.exitCode !== 0) throw new Error(JSON.stringify(confirmed));
    return inspect();
  }
  console.info(
    JSON.stringify({ baselineCli, candidateCli, definitionHashes: started.definitionHashes }),
  );
  return {
    root,
    project,
    change,
    name,
    run,
    started,
    git,
    cli,
    dispatch,
    dispatchResult,
    inspect,
    next,
    pending,
    claim,
    report,
    checkPlan,
    submitChild,
    verifyChild,
    revise,
    confirmAgain,
    baselineCli,
    targetCommit,
  };
}

it('recovers a completed Supervisor Build after an independent Child reports blocked through the public CLI', async () => {
  const f = await supervisor();
  let run = await f.submitChild(f.run, f.baselineCli);
  run = await f.next(f.baselineCli);
  const verifier = f.pending(run, 'supervisor.child.verifier');
  const activation = verifier.input as { activation: { candidateCommit: string } };
  run = await f.claim(verifier, f.baselineCli);
  run = await f.report(
    run.actions.find((action) => action.id === verifier.id)!,
    {
      candidateCommit: activation.activation.candidateCommit,
      verdict: 'blocked',
      evidence: {
        summary: 'External host evidence has not been supplied',
        checks: ['artifact-left'],
        acceptance: [{ id: 'A1', result: 'blocked', reason: 'External host evidence is missing' }],
      },
    },
    f.baselineCli,
  );
  const revised = f.revise(run);
  console.info(
    JSON.stringify({
      reproduction: 'blocked-supervisor-completed-build',
      runId: run.runId,
      revision: run.revision,
      status: run.status,
      phase: (run.state as { phase: string }).phase,
      blockedActionId: verifier.id,
      originalDefinitionHashes: run.definitionHashes,
      revisionResult: revised,
    }),
  );
  expect(revised.exitCode, JSON.stringify(revised.response)).toBe(0);
  const revisedRun = await f.inspect();
  expect(revisedRun.runId).toBe(run.runId);
  expect(revisedRun.definitionHashes).toEqual(run.definitionHashes);
  expect(revisedRun.state).toMatchObject({ phase: 'shape', status: 'active' });
  const settled = run.actions.filter((action) => action.status !== 'pending');
  expect(
    revisedRun.actions.filter((action) => settled.some((old) => old.id === action.id)),
  ).toEqual(settled);
}, 180000);

it('recovers a blocked Child with a successor candidate without replaying an integrated sibling or reusing historical checks as new evidence', async () => {
  const f = await supervisor();
  let run = await f.submitChild(f.run, f.baselineCli);
  run = await f.next(f.baselineCli);
  run = await f.verifyChild(run, f.baselineCli);
  for (let index = 0; index < 3; index++) run = await f.next(f.baselineCli);
  const failedBuilder = f.pending(run, 'supervisor.child.builder');
  run = await f.claim(failedBuilder, f.baselineCli);
  run = await f.dispatch(
    {
      operation: 'record-outcome',
      runId: f.name,
      outcome: {
        actionId: failedBuilder.id,
        attempt: failedBuilder.attempt,
        inputHash: failedBuilder.inputHash,
        claimToken: run.actions.find((action) => action.id === failedBuilder.id)!.claim!.token,
        outcomeId: failedBuilder.id + '-failure',
        status: 'failed',
        output: { summary: 'Host evidence was unavailable' },
      },
    },
    f.baselineCli,
  );
  const resume = run.waits.find((wait) => wait.status === 'pending')!;
  run = await f.dispatch(
    {
      operation: 'resolve-wait',
      runId: f.name,
      expectedRevision: run.revision,
      waitId: resume.id,
      proposalHash: resume.proposalHash,
      decisionId: 'continue-after-host-failure',
      choice: 'continue',
    },
    f.baselineCli,
  );
  run = await f.submitChild(run, f.baselineCli);
  run = await f.next(f.baselineCli);
  const verifier = f.pending(run, 'supervisor.child.verifier');
  const input = (
    verifier.input as {
      activation: { candidateCommit: string; checkActionId: string; worktree: string };
    }
  ).activation;
  run = await f.claim(verifier, f.baselineCli);
  run = await f.report(
    run.actions.find((action) => action.id === verifier.id)!,
    {
      candidateCommit: input.candidateCommit,
      verdict: 'blocked',
      evidence: {
        summary: 'External evidence must be supplied',
        checks: ['artifact-right'],
        acceptance: [{ id: 'A1', result: 'blocked', reason: 'Missing external evidence' }],
      },
    },
    f.baselineCli,
  );
  const before = run;
  const originalChecks = run.actions.find((action) => action.id === input.checkActionId)!;
  const settled = run.actions.filter((action) =>
    ['succeeded', 'failed', 'cancelled'].includes(action.status),
  );
  const integration = path.join(f.project, '.worktrees', f.name + '-integration');
  const integratedHead = f.git(integration, ['rev-parse', 'HEAD']);
  const publicNext = f.cli(['native', 'next', f.name, '--json']);
  if (before.status === 'completed') {
    const { inspectNativeSdkSupervisorRecovery } =
      await import('../../../domains/comet-native/native-sdk-supervisor-recovery.js');
    const rejectedStates = [
      { ...before, workflow: { id: 'comet-native', version: 'wrong-version' } },
      { ...before, status: 'failed' as const },
      { ...before, status: 'cancelled' as const },
      {
        ...before,
        state: {
          ...(before.state as Record<string, unknown>),
          phase: 'archive',
          status: 'archived',
          archived: true,
        },
      },
    ];
    for (const rejected of rejectedStates) {
      expect(
        await inspectNativeSdkSupervisorRecovery(rejected as WorkflowRun, f.project).catch(
          () => null,
        ),
      ).toBeNull();
    }
    const ordinary = structuredClone(before);
    (ordinary.actions.at(-1)!.outcome!.output as { verdict: string }).verdict = 'pass';
    expect(await inspectNativeSdkSupervisorRecovery(ordinary, f.project)).toBeNull();
    const continuation = publicNext.response.agent.continuation;
    expect(continuation?.action, JSON.stringify(publicNext.response)).toBe(
      'resolve-verifier-blocker',
    );
    const args = (continuation.commandArgs as string[])
      .slice(1)
      .map((value) =>
        value === '<summary>' ? 'Continue the original Child after inspecting its blocker' : value,
      );
    const withGuard = (flag: string, value: string) => {
      const changed = [...args];
      changed[changed.indexOf(flag) + 1] = value;
      return [...changed, '--json'];
    };
    expect(
      f.cli(
        withGuard(
          '--expected-state-version',
          String((run.state as { state_version: number }).state_version + 1),
        ),
      ).exitCode,
    ).toBe(73);
    expect(f.cli(withGuard('--proposal-hash', 'stale')).exitCode).toBe(73);
    expect(f.cli(withGuard('--expected-action', 'continue-builder')).exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    const staleRecovery = await f.dispatchResult({
      operation: 'retry',
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: verifier.id,
      attempt: verifier.attempt,
      proposalHash: 'stale-backend-proposal',
    });
    expect(staleRecovery.exitCode).not.toBe(0);
    expect(staleRecovery.response.error).toMatchObject({ code: 'ACTION_TERMINAL' });
    expect(staleRecovery.response.error.message).toContain('当前结果不是可恢复的 Native Child');
    expect(await f.inspect()).toEqual(before);
    const checkLog = path.join(
      f.project,
      (originalChecks.outcome!.output as { checks: Array<{ logRef: string }> }).checks[0].logRef,
    );
    const originalLog = await fs.readFile(checkLog);
    await fs.appendFile(checkLog, 'altered evidence\n');
    expect(f.cli([...args, '--json']).exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    await fs.writeFile(checkLog, originalLog);
    const brief = path.join(f.change, 'brief.md');
    const originalBrief = await fs.readFile(brief);
    await fs.appendFile(brief, '\nAdditional unconfirmed scope.\n');
    expect(f.cli([...args, '--json']).exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    await fs.writeFile(brief, originalBrief);
    await fs.writeFile(path.join(input.worktree, 'repair.txt'), 'actual successor repair\n');
    expect(f.cli([...args, '--json']).exitCode).not.toBe(0);
    expect(await f.inspect()).toEqual(before);
    f.git(input.worktree, ['add', 'repair.txt']);
    f.git(input.worktree, ['commit', '-m', 'repair blocked Child']);
    expect(f.cli([...args, '--json']).exitCode).toBe(73);
    expect(await f.inspect()).toEqual(before);
    const refreshed = f.cli(['native', 'next', f.name, '--json']).response.agent.continuation;
    const recoveryArgs = (refreshed.commandArgs as string[])
      .slice(1)
      .map((value) =>
        value === '<summary>' ? 'Continue from the inspected successor repair' : value,
      );
    const recovered = f.cli([...recoveryArgs, '--json']);
    expect(recovered.exitCode, JSON.stringify(recovered.response)).toBe(0);
    expect(f.cli([...recoveryArgs, '--json']).exitCode).toBe(73);
    run = await f.inspect();
  } else {
    expect(before.status).toBe('running');
    expect(f.pending(before, 'supervisor.child.builder')).toBeDefined();
    await fs.writeFile(path.join(input.worktree, 'repair.txt'), 'actual successor repair\n');
    f.git(input.worktree, ['add', 'repair.txt']);
    f.git(input.worktree, ['commit', '-m', 'repair blocked Child']);
  }
  expect(run.runId).toBe(before.runId);
  expect(run.state).toEqual(before.state);
  expect(run.definitionHashes).toEqual(before.definitionHashes);
  expect(run.actions.filter((action) => settled.some((old) => old.id === action.id))).toEqual(
    settled,
  );
  expect(f.git(integration, ['rev-parse', 'HEAD'])).toBe(integratedHead);
  const builder = f.pending(run, 'supervisor.child.builder');
  expect(builder.id).not.toBe(failedBuilder.id);
  expect(builder.input).toMatchObject({
    activation: { child: 'right', failedVerifierActionId: verifier.id },
  });
  const successor = f.git(input.worktree, ['rev-parse', 'HEAD']);
  expect(successor).not.toBe(input.candidateCommit);
  run = await f.claim(builder);
  run = await f.report(
    run.actions.find((action) => action.id === builder.id)!,
    {
      summary: 'Return the preserved successor repair candidate',
      candidateCommit: successor,
      verificationChecks: f.checkPlan('right'),
    },
  );
  run = await f.next();
  const fresh = f.pending(run, 'supervisor.child.verifier');
  const freshInput = (
    fresh.input as { activation: { checkActionId: string; candidateCommit: string } }
  ).activation;
  expect(fresh.id).not.toBe(verifier.id);
  expect(freshInput.candidateCommit).toBe(successor);
  expect(freshInput.checkActionId).not.toBe(originalChecks.id);
  expect(
    run.actions.find((action) => action.id === freshInput.checkActionId)?.outcome?.output,
  ).toMatchObject({ candidateId: successor });
  expect(run.actions.find((action) => action.id === originalChecks.id)).toEqual(originalChecks);
  run = await f.verifyChild(run);
  expect(run.actions.find((action) => action.id === verifier.id)?.outcome?.output).toMatchObject({
    verdict: 'blocked',
    candidateCommit: input.candidateCommit,
  });
  expect(run.actions.find((action) => action.id === failedBuilder.id)?.status).toBe('failed');
  expect(run.actions.filter((action) => settled.some((old) => old.id === action.id))).toEqual(
    settled,
  );
  expect(f.git(integration, ['rev-parse', 'HEAD'])).toBe(integratedHead);
  console.info(
    JSON.stringify({
      recovery: 'original-blocked-child-successor',
      originalStatus: before.status,
      originalDefinitionHashes: before.definitionHashes,
      originalCandidate: input.candidateCommit,
      successor,
      originalCheckActionId: originalChecks.id,
      freshCheckActionId: freshInput.checkActionId,
      blockedActionId: verifier.id,
      builderActionId: builder.id,
      freshVerifierActionId: fresh.id,
    }),
  );
}, 360000);

it('revises a quiescent Supervisor Build through the candidate public CLI without changing its original definition', async () => {
  const f = await supervisor();
  const inspected = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(inspected.actions).toEqual(f.run.actions);
  expect(inspected.definitionHashes).toEqual(f.started.definitionHashes);
  const state = inspected.state as { state_version: number };
  const result = f.cli([
    'native',
    'next',
    f.name,
    '--revise-requirements',
    '--summary',
    'User narrows actual host acceptance to Claude Code; product Codex support remains.',
    '--expected-state-version',
    String(state.state_version),
    '--expected-action',
    'revise-requirements',
    '--json',
  ]);
  expect(result.response, JSON.stringify(result)).not.toHaveProperty('error');
  expect(result.exitCode).toBe(0);
  const revised = await f.dispatch({ operation: 'inspect', runId: f.name });
  expect(revised.definitionHashes).toEqual(f.started.definitionHashes);
  expect(revised.state).toMatchObject({ phase: 'shape', status: 'active' });
  expect(revised.actions.at(-1)).toMatchObject({ stepId: 'shape.prepare', status: 'pending' });
  expect(
    revised.actions.some((a) => a.id === f.run.actions.at(-1)!.id && a.status === 'cancelled'),
  ).toBe(true);
}, 120000);

it('executes the actual returned Shape continuation with summary and guards without implying user confirmation', async () => {
  const f = await supervisor();
  const revision = f.revise(f.run);
  expect(revision.exitCode).toBe(0);
  const continuation = revision.response.agent.continuation;
  expect(continuation.action).toBe('prepare-shape-confirmation');
  const argv: string[] = continuation.commandArgs
    .slice(1)
    .map((part: string) =>
      part === '<summary>' ? 'Prepare the actual revised Shape proposal' : part,
    );
  const before = await f.inspect();
  const versionIndex = argv.indexOf('--expected-state-version') + 1;
  const actionIndex = argv.indexOf('--expected-action') + 1;
  expect(versionIndex).toBeGreaterThan(0);
  expect(actionIndex).toBeGreaterThan(0);
  const stale = [...argv];
  stale[versionIndex] = String(Number(argv[versionIndex]) + 1);
  const staleResult = f.cli([...stale, '--json']);
  expect(staleResult.exitCode).not.toBe(0);
  expect(await f.inspect()).toEqual(before);
  const wrongAction = [...argv];
  wrongAction[actionIndex] = 'confirm-shape';
  expect(f.cli([...wrongAction, '--json']).exitCode).not.toBe(0);
  expect(await f.inspect()).toEqual(before);
  const prepared = f.cli([...argv, '--json']);
  expect(prepared.response, JSON.stringify({ prepared, continuation })).not.toHaveProperty('error');
  expect(prepared.exitCode).toBe(0);
  const proposed = await f.inspect();
  expect(proposed.state).toMatchObject({ phase: 'shape', status: 'await-user' });
  expect(
    proposed.waits.filter(
      (wait) => wait.stepId === 'supervisor.shape.confirm' && wait.status === 'pending',
    ),
  ).toHaveLength(1);
  expect(
    proposed.actions.some(
      (action) => action.stepId === 'supervisor.prepare' && action.status === 'pending',
    ),
  ).toBe(false);
  expect(proposed.actions.find((action) => action.id === before.actions.at(-1)!.id)).toMatchObject({
    stepId: 'shape.prepare',
    status: 'succeeded',
    attempt: 1,
  });
  expect(f.cli([...argv, '--json']).exitCode).toBe(73);
  expect(await f.inspect()).toEqual(proposed);
  const stalePhase = [...argv];
  stalePhase[versionIndex] = String((proposed.state as { state_version: number }).state_version);
  expect(f.cli([...stalePhase, '--json']).exitCode).toBe(73);
  expect(await f.inspect()).toEqual(proposed);
  expect(f.cli([...stalePhase, '--confirmed', '--json']).exitCode).not.toBe(0);
  expect(await f.inspect()).toEqual(proposed);
  expect(proposed.definitionHashes).toEqual(f.started.definitionHashes);
  expect(staleResult.exitCode).toBe(73);
  expect(f.revise(await f.confirmAgain()).exitCode).toBe(0);
  const summaryOnly = f.cli([
    'native',
    'next',
    f.name,
    '--summary',
    'Prepare revised proposal with current machine state',
    '--json',
  ]);
  expect(summaryOnly.response, JSON.stringify(summaryOnly)).not.toHaveProperty('error');
  expect((await f.inspect()).state).toMatchObject({ phase: 'shape', status: 'await-user' });
}, 180000);

it('reintegrates an already included Child after public Shape reconfirmation (same)', async () => {
  const f = await supervisor();
  await f.submitChild(f.run, f.baselineCli);
  let run = await f.next(f.baselineCli);
  run = await f.verifyChild(run, f.baselineCli);
  const firstIntegration = f.pending(run, 'supervisor.child.integrate');
  run = await f.next();
  const firstOutput = run.actions.find((a) => a.id === firstIntegration.id)!.outcome!.output as {
    baseCommit: string;
    candidateCommit: string;
    integrationCommit: string;
    integrationWorktree: string;
  };
  expect(
    f
      .git(firstOutput.integrationWorktree, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        firstOutput.integrationCommit,
      ])
      .split(' '),
  ).toEqual([firstOutput.integrationCommit, firstOutput.baseCommit, firstOutput.candidateCommit]);
  await f.next();
  run = await f.next();
  const archivedIntegrationCommit = f.git(firstOutput.integrationWorktree, ['rev-parse', 'HEAD']);
  expect(run.actions.find((action) => action.stepId === 'supervisor.child.archive')).toMatchObject({
    status: 'succeeded',
    outcome: { output: { integrationCommit: archivedIntegrationCommit } },
  });
  const retainedFacts = run.actions.filter((a) => a.status === 'succeeded');
  expect(f.revise(run).exitCode).toBe(0);
  await f.confirmAgain();
  await f.next();
  run = await f.next();
  const builder = f.pending(run, 'supervisor.child.builder');
  const input = (
    builder.input as { activation: { child: string; worktree: string; baseCommit: string } }
  ).activation;
  expect(input.child).toBe('left');
  expect(input.baseCommit).toBe(archivedIntegrationCommit);
  f.git(input.worktree, ['merge', '--ff-only', input.baseCommit]);
  const candidate = f.git(input.worktree, ['rev-parse', 'HEAD']);
  expect(candidate).toBe(input.baseCommit);
  const claimed = await f.claim(builder);
  await f.report(
    claimed.actions.find((a) => a.id === builder.id)!,
    {
      summary: 'Revalidate the actual retained Child without a new commit',
      candidateCommit: candidate,
      verificationChecks: f.checkPlan('left'),
    },
  );
  run = await f.next();
  const checks = [...run.actions].reverse().find((a) => a.stepId === 'supervisor.child.checks')!;
  expect(checks.status).toBe('succeeded');
  expect(retainedFacts.some((a) => a.id === checks.id)).toBe(false);
  run = await f.verifyChild(run);
  const integration = f.pending(run, 'supervisor.child.integrate');
  const beforeHead = f.git(firstOutput.integrationWorktree, ['rev-parse', 'HEAD']);
  expect(beforeHead).toBe(archivedIntegrationCommit);
  const result = f.cli(['native', 'next', f.name, '--json']);
  console.info(
    JSON.stringify({
      candidateKind: 'same',
      candidate,
      checkedBase: beforeHead,
      exitCode: result.exitCode,
      error: result.response.error,
    }),
  );
  expect(result.exitCode, JSON.stringify(result)).toBe(0);
  run = await f.inspect();
  expect(run.actions.find((a) => a.id === integration.id)).toMatchObject({
    status: 'succeeded',
    claim: { executorId: 'native-supervisor-integrate' },
    outcome: {
      output: {
        candidateCommit: candidate,
        baseCommit: beforeHead,
        integrationCommit: beforeHead,
      },
    },
  });
  expect(f.git(firstOutput.integrationWorktree, ['rev-parse', 'HEAD'])).toBe(beforeHead);
  for (const fact of retainedFacts) expect(run.actions.find((a) => a.id === fact.id)).toEqual(fact);
  const integrationChecks = f.pending(run, 'supervisor.child.integration-checks');
  expect(integrationChecks).toBeTruthy();
  expect(f.pending(run, 'supervisor.child.builder')).toBeUndefined();
  run = await f.next();
  expect(run.actions.find((a) => a.id === integrationChecks.id)).toMatchObject({
    status: 'succeeded',
    outcome: { output: { candidateId: beforeHead } },
  });
  run = await f.next();
  expect(
    (f.pending(run, 'supervisor.child.builder').input as { activation: { child: string } })
      .activation.child,
  ).toBe('right');
  expect(run.definitionHashes).toEqual(f.started.definitionHashes);
  await f.submitChild(run, undefined, true);
  run = await f.next();
  run = await f.verifyChild(run);
  const pendingIntegration = f.pending(run, 'supervisor.child.integrate');
  await fs.writeFile(
    path.join(firstOutput.integrationWorktree, 'integration-note.txt'),
    'Actual unbound integration change\n',
  );
  f.git(firstOutput.integrationWorktree, ['add', 'integration-note.txt']);
  f.git(firstOutput.integrationWorktree, ['commit', '-m', 'unbound integration work']);
  const changedHead = f.git(firstOutput.integrationWorktree, ['rev-parse', 'HEAD']);
  const beforeDrift = await f.inspect();
  const rejectedNext = f.cli(['native', 'next', f.name, '--json']);
  expect(rejectedNext.response.error.message).toContain('branch changed after the prior check');
  expect(await f.inspect()).toEqual(beforeDrift);
  for (const operation of ['execute', 'claim']) {
    const request = {
      operation,
      runId: f.name,
      actionId: pendingIntegration.id,
      executorId: 'native-supervisor-integrate',
      ...(operation === 'claim'
        ? {
            attempt: pendingIntegration.attempt,
            inputHash: pendingIntegration.inputHash,
            sessionId: 'integration-preflight',
            claimToken: 'integration-preflight-claim',
          }
        : {}),
    };
    const requestFile = path.join(f.root, operation + '-drifted-integration.json');
    await fs.writeFile(requestFile, JSON.stringify(request));
    const rejected = f.cli([
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--request',
      requestFile,
    ]);
    expect(rejected.response.error.message).toContain('branch changed after the prior check');
    expect(await f.inspect()).toEqual(beforeDrift);
  }
  expect(f.git(firstOutput.integrationWorktree, ['rev-parse', 'HEAD'])).toBe(changedHead);
}, 360000);

it('preserves integrated and uncommitted Child work, then rechecks every Child in the new Shape cycle', async () => {
  const f = await supervisor();
  let run = await f.submitChild(f.run, f.baselineCli);
  run = await f.next(f.baselineCli);
  run = await f.verifyChild(run, f.baselineCli);
  run = await f.next(f.baselineCli);
  run = await f.next(f.baselineCli);
  run = await f.next(f.baselineCli);
  const right = f.pending(run, 'supervisor.child.builder');
  const rightRoot = (right.input as { activation: { worktree: string } }).activation.worktree;
  await fs.writeFile(path.join(rightRoot, 'draft.txt'), 'unfinished right work\n');
  const integration = path.join(f.project, '.worktrees', f.name + '-integration');
  const left = path.join(f.project, '.worktrees', f.name + '-left');
  const heads = [left, rightRoot, integration].map((root) => f.git(root, ['rev-parse', 'HEAD']));
  const oldShapeHash = (run.state as { shape_confirmation_hash: string }).shape_confirmation_hash;
  const oldContractHash = (run.state as { children_contract_hash: string }).children_contract_hash;
  const oldFacts = run.actions.filter((a) => a.status === 'succeeded');
  const result = f.revise(run);
  expect(result.response, JSON.stringify(result)).not.toHaveProperty('error');
  expect(result.exitCode).toBe(0);
  let revised = await f.inspect();
  expect(revised.state).toMatchObject({
    phase: 'shape',
    acceptance: [],
    builder_handoff: null,
    verification_result: 'pending',
    verification_report: null,
  });
  expect(revised.state).not.toHaveProperty('shape_confirmation_hash');
  expect(revised.state).not.toHaveProperty('children_contract_hash');
  for (const fact of oldFacts) expect(revised.actions.find((a) => a.id === fact.id)).toEqual(fact);
  expect([left, rightRoot, integration].map((root) => f.git(root, ['rev-parse', 'HEAD']))).toEqual(
    heads,
  );
  expect(await fs.readFile(path.join(rightRoot, 'draft.txt'), 'utf8')).toBe(
    'unfinished right work\n',
  );
  await fs.appendFile(
    path.join(f.change, 'brief.md'),
    '\n# Actual host acceptance\nClaude Code only; product Codex support remains.\n',
  );
  revised = await f.confirmAgain();
  expect((revised.state as { shape_confirmation_hash: string }).shape_confirmation_hash).not.toBe(
    oldShapeHash,
  );
  expect((revised.state as { children_contract_hash: string }).children_contract_hash).toBe(
    oldContractHash,
  );
  revised = await f.next();
  expect(revised.outputs['supervisor.prepare'].value).toMatchObject({
    targetCommit: f.targetCommit,
    integrationCommit: heads[2],
  });
  revised = await f.next();
  expect(f.pending(revised, 'supervisor.child.builder')).toBeTruthy();
  const newBuilder = f.pending(revised, 'supervisor.child.builder');
  expect((newBuilder.input as { activation: { child: string } }).activation.child).toBe('left');
  expect([left, rightRoot, integration].map((root) => f.git(root, ['rev-parse', 'HEAD']))).toEqual(
    heads,
  );
  // 第二次修订时，尚未在本轮重新准备的 Right 也必须保留可验证的恢复绑定。
  expect(f.revise(revised).exitCode).toBe(0);
  revised = await f.inspect();
  const repeatedRevision = [...revised.actions]
    .reverse()
    .find((a) => a.stepId === 'shape.revise' && a.status === 'succeeded')!;
  expect(
    (repeatedRevision.outcome!.output as { workspaces: { worktree: string }[] }).workspaces.map(
      (w) => w.worktree,
    ),
  ).toContain(rightRoot);
  revised = await f.confirmAgain();
  revised = await f.next();
  revised = await f.next();
  revised = await f.submitChild(revised, undefined, true);
  revised = await f.next();
  revised = await f.verifyChild(revised);
  revised = await f.next();
  revised = await f.next();
  expect(f.pending(revised, 'supervisor.parent.builder')).toBeUndefined();
  revised = await f.next();
  expect(
    (f.pending(revised, 'supervisor.child.builder').input as { activation: { child: string } })
      .activation.child,
  ).toBe('right');
  expect(await fs.readFile(path.join(rightRoot, 'draft.txt'), 'utf8')).toBe(
    'unfinished right work\n',
  );
  revised = await f.submitChild(revised, undefined, true);
  revised = await f.next();
  revised = await f.verifyChild(revised);
  revised = await f.next();
  revised = await f.next();
  expect(f.pending(revised, 'supervisor.parent.builder')).toBeTruthy();
  const revisionIndex = revised.actions.findLastIndex(
    (a) => a.stepId === 'shape.revise' && a.status === 'succeeded',
  );
  for (const step of [
    'supervisor.child.checks',
    'supervisor.child.verifier',
    'supervisor.child.integration-checks',
  ])
    expect(
      revised.actions
        .slice(revisionIndex + 1)
        .filter((a) => a.stepId === step && a.status === 'succeeded'),
    ).toHaveLength(2);
  expect(revised.definitionHashes).toEqual(f.started.definitionHashes);
  const parentBuilder = f.pending(revised, 'supervisor.parent.builder');
  const parentActivation = (
    parentBuilder.input as {
      activation: { integrationCommit: string; integrationWorktree: string };
    }
  ).activation;
  expect(parentActivation.integrationWorktree).toBe(integration);
  const parentClaimed = await f.claim(parentBuilder);
  revised = await f.report(
    parentClaimed.actions.find((a) => a.id === parentBuilder.id)!,
    {
      summary: 'Read both actual integration artifacts after revised scope',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [],
      knownLimits: [],
      review: null,
      submittedAt: new Date().toISOString(),
      candidateCommit: parentActivation.integrationCommit,
      verificationChecks: [
        {
          id: 'parent-artifacts',
          name: 'Read both actual integration artifacts',
          executable: process.execPath,
          argv: [
            '-e',
            "const fs=require('node:fs');for(const file of ['left.txt','right.txt'])if(fs.readFileSync(file,'utf8').trim()!=='approved')process.exit(1)",
          ],
          cwdRef: '.',
          timeoutMs: 10000,
          repeatable: true,
        },
      ],
    },
  );
  revised = await f.next();
  const parentVerifier = f.pending(revised, 'verify.verifier');
  for (const file of ['left.txt', 'right.txt'])
    expect((await fs.readFile(path.join(integration, file), 'utf8')).trim()).toBe('approved');
  const verifierClaimed = await f.claim(parentVerifier);
  const state = revised.state as {
    builder_handoff: { candidate_id: string };
    loop: { iteration: number; attempt: number };
  };
  revised = await f.report(
    verifierClaimed.actions.find((a) => a.id === parentVerifier.id)!,
    {
      candidateId: state.builder_handoff.candidate_id,
      verifierExecutionRef: parentVerifier.id + '-session',
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
              reason: 'Independent test executor read both actual artifacts',
            },
          ],
          risks: [],
          summary: 'Revised scope verified against actual integration tree',
        },
      },
    },
  );
  revised = await f.next();
  const confirmation = revised.waits.find(
    (wait) => wait.status === 'pending' && wait.stepId === 'verify.confirm',
  )!;
  const accepted = f.cli([
    'native',
    'next',
    f.name,
    '--accept-result',
    '--summary',
    'Test user accepts revised scope result',
    '--expected-state-version',
    String((revised.state as { state_version: number }).state_version),
    '--expected-action',
    'accept-result',
    '--proposal-hash',
    confirmation.proposalHash,
    '--json',
  ]);
  expect(accepted.response, JSON.stringify(accepted)).not.toHaveProperty('error');
  revised = await f.inspect();
  expect(revised.state).toMatchObject({ phase: 'archive', verification_result: 'pass' });
  expect(f.pending(revised, 'supervisor.parent.deliver')).toBeTruthy();
  const dryRun = f.cli(['native', 'archive', f.name, '--dry-run', '--json']);
  expect(dryRun.response, JSON.stringify(dryRun)).not.toHaveProperty('error');
  expect(dryRun.response.data).toMatchObject({
    ready: true,
    delivery: {
      targetCommit: f.targetCommit,
      integrationCommit: parentActivation.integrationCommit,
    },
  });
  expect(f.git(f.project, ['rev-parse', 'HEAD'])).toBe(f.targetCommit);
  expect(await f.inspect()).toEqual(revised);
  f.git(f.project, ['commit', '--allow-empty', '-m', 'unauthorized target branch change']);
  const changedTarget = f.git(f.project, ['rev-parse', 'HEAD']);
  const rejectedDelivery = f.cli(['native', 'archive', f.name, '--dry-run', '--json']);
  expect(rejectedDelivery.exitCode).not.toBe(0);
  expect(rejectedDelivery.response.error.message).toContain('target branch changed');
  expect(f.git(f.project, ['rev-parse', 'HEAD'])).toBe(changedTarget);
  expect(await f.inspect()).toEqual(revised);
}, 420000);

it.each(['running', 'unknown'] as const)(
  'rejects Build revision while a Child is %s and retains its original claim',
  async (status) => {
    const f = await supervisor();
    const builder = f.pending(f.run, 'supervisor.child.builder');
    let run = await f.claim(builder, f.baselineCli);
    if (status === 'unknown')
      run = await f.dispatch(
        {
          operation: 'mark-unknown',
          runId: f.name,
          actionId: builder.id,
          attempt: builder.attempt,
          reason: 'Host result needs reconciliation',
        },
        f.baselineCli,
      );
    const before = await f.inspect();
    const result = f.revise(run);
    expect(result.exitCode).not.toBe(0);
    expect(result.response.error.message).toContain('ACTION_IN_FLIGHT');
    expect(await f.inspect()).toEqual(before);
  },
  120000,
);

it('blocks a retained integration HEAD change without resetting Git or accepting the old checks', async () => {
  const f = await supervisor();
  expect(f.revise(f.run).exitCode).toBe(0);
  const revision = await f.inspect();
  const integration = path.join(f.project, '.worktrees', f.name + '-integration');
  f.git(integration, ['commit', '--allow-empty', '-m', 'unexpected change during Shape']);
  const changedHead = f.git(integration, ['rev-parse', 'HEAD']);
  await f.confirmAgain();
  const before = await f.inspect();
  const execution = f.cli(['native', 'next', f.name, '--json']);
  const rejected = await f.inspect();
  const prepared = [...rejected.actions].reverse().find((a) => a.stepId === 'supervisor.prepare')!;
  expect(execution.exitCode).not.toBe(0);
  expect(execution.response.error.message).toContain('提交已变化');
  expect(rejected).toEqual(before);
  const previousIds = new Set(revision.actions.map((a) => a.id));
  expect(
    rejected.actions.some((a) => !previousIds.has(a.id) && a.stepId === 'supervisor.child.builder'),
  ).toBe(false);
  expect(f.git(integration, ['rev-parse', 'HEAD'])).toBe(changedHead);
  expect(rejected.definitionHashes).toEqual(f.started.definitionHashes);
  // 同一端口 preflight 也覆盖底层公开 execute 和 claim；失败前不会登记领取。
  const executionFile = path.join(f.root, 'execute-drifted-prepare.json');
  await fs.writeFile(
    executionFile,
    JSON.stringify({
      operation: 'execute',
      runId: f.name,
      actionId: prepared.id,
      executorId: 'native-supervisor-prepare',
    }),
  );
  const worktreeList = f.git(f.project, ['worktree', 'list', '--porcelain']);
  const configuration = await fs.readFile(path.join(integration, '.comet/config.yaml'), 'utf8');
  const dispatched = f.cli([
    'runtime',
    'dispatch',
    '--application',
    'native',
    '--request',
    executionFile,
  ]);
  expect(dispatched.response.error.message).toContain('提交已变化');
  expect(await f.inspect()).toEqual(before);
  await fs.writeFile(
    executionFile,
    JSON.stringify({
      operation: 'claim',
      runId: f.name,
      actionId: prepared.id,
      attempt: prepared.attempt,
      inputHash: prepared.inputHash,
      executorId: 'native-supervisor-prepare',
      sessionId: 'preflight-only',
      claimToken: 'preflight-only-claim',
    }),
  );
  const claimRejected = f.cli([
    'runtime',
    'dispatch',
    '--application',
    'native',
    '--request',
    executionFile,
  ]);
  expect(claimRejected.response.error.message).toContain('提交已变化');
  expect(await f.inspect()).toEqual(before);
  expect(f.git(f.project, ['worktree', 'list', '--porcelain'])).toBe(worktreeList);
  expect(f.git(integration, ['rev-parse', 'HEAD'])).toBe(changedHead);
  expect(await fs.readFile(path.join(integration, '.comet/config.yaml'), 'utf8')).toBe(
    configuration,
  );
  expect(f.revise(before).exitCode).toBe(0);
  let reapproved = await f.confirmAgain();
  reapproved = await f.next();
  reapproved = await f.next();
  expect(f.pending(reapproved, 'supervisor.child.builder')).toBeTruthy();
  expect(f.git(integration, ['rev-parse', 'HEAD'])).toBe(changedHead);
  expect(reapproved.definitionHashes).toEqual(f.started.definitionHashes);
}, 180000);

it('transfers repeated preparation receipts once per actual workspace without losing history or dirty files', async () => {
  const f = await supervisor();
  expect(f.revise(f.run).exitCode).toBe(0);
  let run = await f.confirmAgain();
  run = await f.next();
  run = await f.next();
  const builder = f.pending(run, 'supervisor.child.builder');
  const activation = (builder.input as { activation: { worktree: string; branch: string } })
    .activation;
  await fs.writeFile(path.join(activation.worktree, 'draft.txt'), 'retained unfinished work\n');
  const transfer = path.join(f.root, 'transfer');
  const exported = f.cli([
    'native',
    'transfer',
    'export',
    f.name,
    '--output',
    transfer,
    '--confirmed-stopped',
    '--json',
  ]);
  expect(exported.response, JSON.stringify(exported)).not.toHaveProperty('error');
  const target = path.join(f.root, 'target');
  f.git(f.project, ['clone', '--no-local', f.project, target]);
  await writeProjectConfig(target, defaultProjectConfig('docs', 'en'));
  const imported = f.cli(
    ['native', 'transfer', 'import', '--input', transfer, '--json'],
    undefined,
    target,
  );
  expect(imported.response, JSON.stringify(imported)).not.toHaveProperty('error');
  const manifest = JSON.parse(await fs.readFile(path.join(transfer, 'manifest.json'), 'utf8'));
  expect(manifest.workspaces).toHaveLength(2);
  expect(new Set(manifest.workspaces.map((w: { branch: string }) => w.branch)).size).toBe(2);
  const inspectFile = path.join(f.root, 'inspect-target.json');
  await fs.writeFile(inspectFile, JSON.stringify({ operation: 'inspect', runId: f.name }));
  const relocated: WorkflowRun = f.cli(
    ['runtime', 'dispatch', '--application', 'native', '--request', inspectFile],
    undefined,
    target,
  ).response.data;
  expect(relocated.actions.map((a) => [a.id, a.stepId, a.status])).toEqual(
    run.actions.map((a) => [a.id, a.stepId, a.status]),
  );
  expect(relocated.definitionHashes).toEqual(f.started.definitionHashes);
  const relocatedBuilder = f.pending(relocated, 'supervisor.child.builder');
  const relocatedRoot = (relocatedBuilder.input as { activation: { worktree: string } }).activation
    .worktree;
  expect(await fs.readFile(path.join(relocatedRoot, 'draft.txt'), 'utf8')).toBe(
    'retained unfinished work\n',
  );
  expect(f.git(relocatedRoot, ['rev-parse', 'HEAD'])).toBe(
    f.git(activation.worktree, ['rev-parse', 'HEAD']),
  );
  // 篡改包中的重复身份和提交，必须在目标分支写入前拒绝。
  manifest.workspaces.push({ ...manifest.workspaces[1], head: 'f'.repeat(40) });
  await fs.writeFile(path.join(transfer, 'manifest.json'), JSON.stringify(manifest));
  const otherTarget = path.join(f.root, 'other-target');
  f.git(f.project, ['clone', '--no-local', f.project, otherTarget]);
  await writeProjectConfig(otherTarget, defaultProjectConfig('docs', 'en'));
  const rejected = f.cli(
    ['native', 'transfer', 'import', '--input', transfer, '--json'],
    undefined,
    otherTarget,
  );
  expect(rejected.exitCode).not.toBe(0);
  expect(f.git(otherTarget, ['branch', '--list', 'comet/supervisor/*'])).toBe('');
}, 120000);

it('retains a genuine failed Child outcome and resume decision when Build returns to Shape', async () => {
  const f = await supervisor();
  const builder = f.pending(f.run, 'supervisor.child.builder');
  const activation = (builder.input as { activation: { worktree: string } }).activation;
  await fs.writeFile(path.join(activation.worktree, 'partial.txt'), 'actual partial candidate\n');
  f.git(activation.worktree, ['add', 'partial.txt']);
  f.git(activation.worktree, ['commit', '-m', 'partial work before blocked host']);
  await fs.writeFile(path.join(activation.worktree, 'draft.txt'), 'unfinished work\n');
  const head = f.git(activation.worktree, ['rev-parse', 'HEAD']);
  const claimed = await f.claim(builder, f.baselineCli);
  const original = claimed.actions.find((a) => a.id === builder.id)!;
  const failed = await f.dispatch(
    {
      operation: 'record-outcome',
      runId: f.name,
      outcome: {
        actionId: original.id,
        attempt: original.attempt,
        inputHash: original.inputHash,
        claimToken: original.claim!.token,
        outcomeId: original.id + '-blocked',
        status: 'failed',
        output: { summary: 'Actual host budget exhausted before independent evidence completed' },
      },
    },
    f.baselineCli,
  );
  expect(failed.actions.find((a) => a.id === original.id)?.status).toBe('failed');
  const resume = failed.waits.find(
    (wait) => wait.stepId === 'supervisor.child.resume' && wait.status === 'pending',
  )!;
  expect(resume).toBeTruthy();
  expect(f.revise(failed).exitCode).toBe(0);
  let revised = await f.inspect();
  expect(revised.actions.find((a) => a.id === original.id)).toEqual(
    failed.actions.find((a) => a.id === original.id),
  );
  expect(revised.waits.find((wait) => wait.id === resume.id)).toMatchObject({
    status: 'cancelled',
  });
  revised = await f.confirmAgain();
  revised = await f.next();
  revised = await f.next();
  const newBuilder = f.pending(revised, 'supervisor.child.builder');
  expect(newBuilder.id).not.toBe(original.id);
  expect(f.git(activation.worktree, ['rev-parse', 'HEAD'])).toBe(head);
  expect(await fs.readFile(path.join(activation.worktree, 'draft.txt'), 'utf8')).toBe(
    'unfinished work\n',
  );
  expect(revised.definitionHashes).toEqual(f.started.definitionHashes);
}, 120000);
