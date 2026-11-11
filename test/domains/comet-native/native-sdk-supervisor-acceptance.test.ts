import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import {
  createMemoryRuntimeStore,
  createRuntime,
  type WorkflowRun,
  type RuntimeValue,
} from '../../../domains/engine/runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const git = (root: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=SIMULATED-Agent', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-current-child-acceptance-'));
  roots.push(root);
  const name = 'child-acceptance',
    paths = await nativeProjectPaths(root, 'docs');
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const dir = path.join(paths.changesDir, name);
  await fs.mkdir(path.join(dir, 'specs/feature'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'brief.md'),
    '# Outcome\nShip both behaviors.\n# Scope\nOne Child.\n## Directory structure\n### Created\n- feature.txt: implement the selected behavior.\n# Non-goals\nPublishing.\n# Acceptance examples\n- The first behavior works.\n- The second behavior works.\n',
  );
  await fs.writeFile(
    path.join(dir, 'specs/feature/spec.md'),
    '# Feature\nBoth behaviors remain available.\n',
  );
  await fs.writeFile(
    path.join(dir, 'children.yaml'),
    'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The first behavior works.\n  A2:\n    source: brief.md\n    text: The second behavior works.\nchildren:\n  - name: core\n    depends_on: []\n    covers: [A1, A2]\n  - name: tail\n    depends_on: [core]\n    covers: [A2]\n',
  );
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n**/comet-state.yaml\n**/verification.md\n',
  );
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'SIMULATED-Agent');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'SIMULATED approved scope source');
  const target = git(root, 'rev-parse', 'HEAD');
  const app = defineNativeWorkflowApplication(),
    runtime = createRuntime({
      ...app,
      store: createMemoryRuntimeStore<WorkflowRun>(),
      workflows: [app.workflow],
      transitionHandlers: [app.transitionHandler],
    });
  let run = await runtime.start({
    runId: name,
    workflow: { id: app.workflow.id, version: '4' },
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
  });
  let sequence = 0;
  const context = { projectRoot: root };
  async function send(actionId: string, output: unknown, session: string) {
    run = await runtime.inspect(name);
    let action = run.actions.find((a) => a.id === actionId)!;
    if (action.status === 'pending') {
      run = await runtime.claim({
        runId: name,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'native-host',
        sessionId: session,
        claimToken: session + '-claim',
        context,
      });
      action = run.actions.find((a) => a.id === actionId)!;
    }
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: 'SIMULATED-report-' + ++sequence,
        status: 'succeeded',
        output: output as RuntimeValue,
      },
      context,
    });
    return run;
  }
  await send(
    run.actions.at(-1)!.id,
    await collectNativeSdkShapeProposal({ paths, state: run.state as never }),
    'shape-agent',
  );
  const wait = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'multi-session',
    decisionId: 'SIMULATED-USER-full-scope-approved',
  });
  for (const executorId of ['native-supervisor-prepare', 'native-supervisor-child-prepare'])
    run = await runtime.execute({
      runId: name,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context,
    });
  const builder = run.actions.at(-1)!,
    activation = (builder.input as { activation: { worktree: string } }).activation;
  expect(builder.stepId).toBe('supervisor.child.builder');
  expect((run.state as { acceptance: Array<{ id: string }> }).acceptance.map((a) => a.id)).toEqual([
    'A1',
    'A2',
  ]);
  await fs.writeFile(path.join(activation.worktree, 'feature.txt'), 'implemented\n');
  git(activation.worktree, 'add', 'feature.txt');
  git(activation.worktree, 'commit', '-m', 'SIMULATED Agent implements both accepted behaviors');
  const commit = git(activation.worktree, 'rev-parse', 'HEAD');
  run = await send(
    builder.id,
    {
      summary: 'SIMULATED candidate with both requested behaviors.',
      candidateCommit: commit,
      checks: [],
      requireIndependentReview: true,
    },
    'builder',
  );
  const verifier = run.actions.at(-1)!;
  expect(verifier.stepId).toBe('supervisor.child.verifier');
  run = await runtime.claim({
    runId: name,
    actionId: verifier.id,
    attempt: verifier.attempt,
    inputHash: verifier.inputHash,
    executorId: 'native-host',
    sessionId: 'independent-verifier',
    claimToken: 'original-independent-claim',
    context,
  });
  const original = run.actions.find((a) => a.id === verifier.id)!;
  return {
    root,
    name,
    paths,
    runtime,
    run,
    builder: run.actions.find((a) => a.id === builder.id)!,
    verifier: original,
    worktree: activation.worktree,
    commit,
    target,
    context,
  };
}
const acceptance = (first: 'passed' | 'failed' | 'blocked' = 'passed') => [
  { id: 'A1', result: first, reason: 'SIMULATED independent first behavior inspection.' },
  { id: 'A2', result: 'passed', reason: 'SIMULATED independent second behavior inspection.' },
];
function request(
  f: Awaited<ReturnType<typeof fixture>>,
  output: unknown,
  outcomeId = 'original-verifier-result',
) {
  const a = f.verifier;
  return {
    runId: f.name,
    outcome: {
      actionId: a.id,
      attempt: a.attempt,
      inputHash: a.inputHash,
      claimToken: a.claim!.token,
      outcomeId,
      status: 'succeeded' as const,
      output: output as RuntimeValue,
    },
    context: f.context,
  };
}
it.each(['fail', 'blocked'] as const)(
  'records current Child %s without inventing a checker receipt or a successful integration',
  async (verdict) => {
    const f = await fixture(),
      approved = structuredClone(f.run.waits),
      output = {
        candidateCommit: f.commit,
        verdict,
        evidence: {
          summary: 'SIMULATED independent result with no executed checks claimed.',
          checks: [],
          acceptance: acceptance(verdict === 'fail' ? 'failed' : 'blocked'),
        },
      };
    const run = await f.runtime.recordOutcome(request(f, output));
    expect(run.actions.find((a) => a.id === f.verifier.id)).toMatchObject({
      claim: f.verifier.claim,
      outcome: { output: { verdict, evidence: { checks: [] } } },
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.child.builder',
      status: 'pending',
      input: { activation: { failedVerifierActionId: f.verifier.id, child: 'core' } },
    });
    expect(run.actions.find((a) => a.id === f.builder.id)).toEqual(f.builder);
    expect(run.waits).toEqual(approved);
    expect(
      run.actions.some((a) =>
        ['supervisor.child.integrate', 'supervisor.child.checks'].includes(a.stepId),
      ),
    ).toBe(false);
    expect(git(f.root, 'rev-parse', 'main')).toBe(f.target);
  },
);
it('requires complete current Child acceptance and actual passing reports, retains original material and integrates only the original accepted candidate once', async () => {
  const f = await fixture(),
    material = path.join(f.worktree, 'original-probe.txt'),
    text = 'Actual original Agent material retained across rejected reports.\n';
  await fs.writeFile(material, text);
  const actual = spawnSync(process.execPath, ['-e', 'process.exit(2)'], { cwd: f.worktree });
  expect(actual.status).toBe(2);
  const base = {
    candidateCommit: f.commit,
    verdict: 'pass',
    evidence: {
      summary: 'SIMULATED independent inspection using actual platform observations.',
      checks: [
        {
          name: 'Actual Node command',
          result: 'passed',
          note: 'SIMULATED protocol report; accepted only after a real successful probe below.',
        },
      ],
      acceptance: acceptance(),
    },
  };
  let rejectedIndex = 0;
  for (const output of [
    {
      ...base,
      evidence: {
        ...base.evidence,
        checks: [{ name: 'Actual Node failure', result: 'failed', note: 'Actual exit 2.' }],
      },
    },
    { ...base, candidateCommit: '0'.repeat(40) },
    { ...base, evidence: { ...base.evidence, acceptance: acceptance().slice(0, 1) } },
    { ...base, evidence: { ...base.evidence, acceptance: [...acceptance(), acceptance()[0]] } },
    { ...base, evidence: { ...base.evidence, acceptance: acceptance('failed') } },
  ]) {
    await expect(
      f.runtime.recordOutcome(request(f, output, 'rejected-' + ++rejectedIndex)),
    ).rejects.toThrow();
    const rejected = await f.runtime.inspect(f.name);
    expect(rejected.state).toEqual(f.run.state);
    expect(rejected.actions.find((a) => a.id === f.verifier.id)).toMatchObject({
      status: 'running',
      claim: f.verifier.claim,
      inputHash: f.verifier.inputHash,
    });
    expect(rejected.actions.some((a) => a.stepId === 'supervisor.child.integrate')).toBe(false);
    expect(await fs.readFile(material, 'utf8')).toBe(text);
  }
  const wrong = request(f, base, 'wrong-original-claim');
  wrong.outcome.claimToken = 'stale-claim';
  await expect(f.runtime.recordOutcome(wrong)).rejects.toThrow();
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      'if(require("node:fs").readFileSync("feature.txt","utf8").trim()!=="implemented")process.exit(3);',
    ],
    { cwd: f.worktree },
  );
  expect(probe.status).toBe(0);
  const current = request(f, base, 'original-current-result'),
    accepted = await f.runtime.recordOutcome(current);
  expect(await f.runtime.recordOutcome(current)).toEqual(accepted);
  await expect(
    f.runtime.recordOutcome(request(f, base, 'forged-second-outcome')),
  ).rejects.toThrow();
  expect(accepted.actions.filter((a) => a.stepId === 'supervisor.child.integrate')).toHaveLength(1);
  const integrate = accepted.actions.find((a) => a.stepId === 'supervisor.child.integrate')!;
  const run = await f.runtime.execute({
    runId: f.name,
    actionId: integrate.id,
    executorId: 'native-supervisor-integrate',
    context: f.context,
  });
  expect(run.actions.find((a) => a.id === integrate.id)).toMatchObject({
    status: 'succeeded',
    outcome: { output: { candidateCommit: f.commit } },
  });
  const integration = (
    run.actions.find((a) => a.id === integrate.id)!.outcome!.output as {
      integrationWorktree: string;
    }
  ).integrationWorktree;
  const after = spawnSync(
    process.execPath,
    [
      '-e',
      'if(require("node:fs").readFileSync("feature.txt","utf8").trim()!=="implemented")process.exit(3);',
    ],
    { cwd: integration },
  );
  expect(after.status).toBe(0);
  expect(await fs.readFile(material, 'utf8')).toBe(text);
  expect(run.actions.find((a) => a.id === f.builder.id)).toEqual(f.builder);
  expect(git(f.root, 'rev-parse', 'main')).toBe(f.target);
  expect(git(f.root, 'rev-parse', 'main')).not.toBe(f.commit);
});
