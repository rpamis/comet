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
  const candidateCli = path.resolve('bin/comet.js');
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
  async function dispatch(
    request: Record<string, unknown>,
    file = candidateCli,
  ): Promise<WorkflowRun> {
    const requestFile = path.join(root, `request-${++sequence}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    const result = cli(
      ['runtime', 'dispatch', '--application', 'native', '--request', requestFile],
      file,
    );
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
  const next = (file = candidateCli) => {
    const result = cli(['native', 'next', name, '--json'], file);
    if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
    return inspect(file);
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
    inspect,
    next,
    pending,
    claim,
    report,
    submitChild,
    verifyChild,
    revise,
    confirmAgain,
    baselineCli,
    targetCommit,
  };
}

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
