import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('creates an agent-managed Native Run without a project content snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-checks-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const created = await runNativeCli(['new', 'agent-checks', '--project-root', root, '--json']);
  expect(created.exitCode, created.stderr || created.stdout).toBe(0);
  const { run } = await inspectNativeSdkRun(root, 'agent-checks');
  expect(run.workflow.version).toBe('4');
  expect(run.actions.some((action) => action.stepId.includes('checks'))).toBe(false);
});

async function builderFixture(boundary: 'source' | 'bundle' = 'source') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-report-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const name = 'agent-report';
  const cli = async (args: string[]) => {
    const argv = [...args, '--project-root', root, '--json'];
    const child =
      boundary === 'bundle'
        ? spawnSync(
            process.execPath,
            [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          )
        : null;
    const result = child
      ? { exitCode: child.status ?? 1, stdout: child.stdout, stderr: child.stderr }
      : await runNativeCli(argv);
    return { ...result, envelope: JSON.parse(result.stdout) };
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  await fs.writeFile(path.join(change, 'brief.md'), 'Implement the approved workflow behavior.');
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(path.join(change, 'specs/workflow/spec.md'), 'The workflow works.');
  const file = path.join(root, 'result.json');
  const submit = async (action: string, output: unknown, extra: string[] = []) => {
    await fs.writeFile(file, JSON.stringify({ status: 'succeeded', output }));
    return cli([
      'next',
      name,
      '--action',
      action,
      '--session',
      'actual-agent',
      '--result',
      file,
      ...extra,
    ]);
  };
  const shape = await cli(['next', name, '--session', 'actual-agent']);
  expect(shape.exitCode, shape.stdout).toBe(0);
  const prepared = await submit(shape.envelope.data.task.actionId, {
    acceptance: [{ source: 'specs/workflow/spec.md', text: 'The workflow works.' }],
  });
  expect(prepared.exitCode, prepared.stdout).toBe(0);
  const { runtime } = await loadOwnedNativeSdkRuntime(root, name);
  const run = await runtime.inspect(name);
  const wait = run.waits.find((entry) => entry.status === 'pending')!;
  await runtime.resolveWait({
    runId: name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'test-user-shape-approved',
    choice: 'approved',
    context: { requestId: 'test-user-shape-approved', projectRoot: root },
  });
  const builder = await cli(['next', name, '--session', 'actual-agent']);
  expect(builder.exitCode, builder.stdout).toBe(0);
  return { root, name, cli, submit, runtime, builder: builder.envelope.data };
}

it.each(['source', 'bundle'] as const)(
  'accepts platform check reports and completes authorized Archive without Runtime check actions (%s)',
  async (boundary) => {
    const f = await builderFixture(boundary);
    expect(f.builder.resultTemplate.output).not.toHaveProperty('verificationChecks');
    const checks = [
      {
        name: 'Targeted test',
        result: 'passed',
        note: 'node test.mjs exited 0 in the project; original platform log retained.',
      },
    ];
    const built = await f.submit(f.builder.task.actionId, {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks,
      knownLimits: [],
    });
    expect(built.exitCode, built.stdout).toBe(0);
    expect(built.envelope.data.task.role).toBe('verify');
    expect(built.envelope.data.task.checks).toEqual(checks);
    const output = built.envelope.data.resultTemplate.output;
    expect(output.checks).toEqual(checks);
    output.checks = checks;
    Object.assign(output.response.result, {
      verdict: 'pass',
      acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed the approved behavior.' }],
      risks: [],
      summary: 'Approved behavior verified.',
    });
    const completed = await f.submit(built.envelope.data.task.actionId, output, [
      '--accept-on-pass',
      'Test user explicitly delegated acceptance and Archive after passing.',
    ]);
    expect(completed.exitCode, completed.stdout).toBe(0);
    const run = await f.runtime.inspect(f.name);
    expect(run.status).toBe('completed');
    expect(
      run.actions.some((action) =>
        ['build.checks', 'verify.checks', 'verify.requested-checks'].includes(action.stepId),
      ),
    ).toBe(false);
    expect(JSON.stringify(run.state)).toContain('original platform log retained');
  },
  120_000,
);

it.each(['failed', 'not-run'])(
  'does not pass acceptance with a %s platform check',
  async (result) => {
    const f = await builderFixture();
    const built = await f.submit(f.builder.task.actionId, {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks: [],
      knownLimits: [],
    });
    expect(built.exitCode, built.stdout).toBe(0);
    const output = built.envelope.data.resultTemplate.output;
    output.checks = [{ name: 'Required test', result, note: 'The required check did not pass.' }];
    Object.assign(output.response.result, {
      verdict: 'pass',
      acceptance: [{ id: 'A1', result: 'passed', reason: 'Claimed pass.' }],
      risks: [],
      summary: 'Claimed pass.',
    });
    const rejected = await f.submit(built.envelope.data.task.actionId, output);
    expect(rejected.exitCode).not.toBe(0);
    expect((await f.runtime.inspect(f.name)).status).not.toBe('completed');
  },
);

it('waits for user acceptance and rejects another session reporting the original task', async () => {
  const f = await builderFixture();
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  const output = built.envelope.data.resultTemplate.output;
  Object.assign(output.response.result, {
    verdict: 'pass',
    acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed actual behavior.' }],
    risks: [],
    summary: 'Verified.',
  });
  const file = path.join(f.root, 'wrong-result.json');
  await fs.writeFile(file, JSON.stringify({ status: 'succeeded', output }));
  const wrong = await f.cli([
    'next',
    f.name,
    '--action',
    built.envelope.data.task.actionId,
    '--session',
    'unrelated-agent',
    '--result',
    file,
  ]);
  expect(wrong.exitCode).not.toBe(0);
  const passed = await f.submit(built.envelope.data.task.actionId, output);
  expect(passed.exitCode, passed.stdout).toBe(0);
  const run = await f.runtime.inspect(f.name);
  expect(run.status).not.toBe('completed');
  expect(
    run.waits.find((wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending'),
  ).toBeDefined();
  expect(run.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
});

it('retains an explicit independent review requirement', async () => {
  const f = await builderFixture();
  const built = await f.submit(
    f.builder.task.actionId,
    {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks: [],
      knownLimits: [],
      requireIndependentReview: true,
    },
    ['--review', 'independent'],
  );
  expect(built.exitCode, built.stdout).toBe(0);
  const denied = await f.cli(['next', f.name, '--session', 'actual-agent']);
  expect(denied.exitCode).not.toBe(0);
  const received = await f.cli(['next', f.name, '--session', 'independent-reviewer']);
  expect(received.exitCode, received.stdout).toBe(0);
  expect(received.envelope.data.task).toMatchObject({
    role: 'verify',
    session: 'independent-reviewer',
    requireIndependentReview: true,
  });
});

it('reads the submitted platform report once before committing its result', async () => {
  const f = await builderFixture();
  const open = vi.spyOn(fs, 'open');
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  expect(
    open.mock.calls.filter(([file]) => String(file) === path.join(f.root, 'result.json')),
  ).toHaveLength(1);
});

it('preserves the original agent task as unknown when recovering a v4 checkpoint', async () => {
  const f = await builderFixture();
  const original = await f.runtime.inspect(f.name);
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(f.root);
  const directory = path.join(runtimeRoot, 'sdk-runs', 'native');
  expect(path.relative(runtimeRoot, directory)).toBe(path.join('sdk-runs', 'native'));
  await fs.rm(directory, { recursive: true });
  await expect(createNativeSdkStateStore(f.root, { readOnly: true }).read(f.name)).rejects.toThrow(
    'checkpoint recovery',
  );
  const repair = await f.cli(['doctor', f.name, '--repair', '--confirmed']);
  expect(repair.exitCode).not.toBe(0);
  const restored = await createNativeSdkStateStore(f.root, { readOnly: true }).read(f.name);
  expect(restored?.revision).toBe(original.revision);
  expect(restored?.actions.at(-1)).toMatchObject({
    id: f.builder.task.actionId,
    status: 'unknown',
    claim: { sessionId: 'actual-agent' },
  });
  expect(restored?.actions.filter((action) => action.stepId === 'build.builder')).toHaveLength(1);
});

it('dispatches the Verifier directly when the user requests another review', async () => {
  const f = await builderFixture();
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  const output = built.envelope.data.resultTemplate.output;
  Object.assign(output.response.result, {
    verdict: 'pass',
    acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed behavior.' }],
    risks: [],
    summary: 'Verified.',
  });
  expect((await f.submit(built.envelope.data.task.actionId, output)).exitCode).toBe(0);
  const run = await f.runtime.inspect(f.name);
  const wait = run.waits.find(
    (item) => item.stepId === 'verify.confirm' && item.status === 'pending',
  )!;
  const reviewed = await createNativeSdkRuntime(f.root).resolveWait({
    runId: f.name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'test-user-reverify',
    choice: 'reverify',
    context: { requestId: 'test-user-reverify', projectRoot: f.root },
  });
  expect(reviewed.actions.at(-1)?.stepId).toBe('verify.verifier');
  expect(reviewed.actions.filter((item) => item.stepId === 'verify.verifier')).toHaveLength(2);
  expect(reviewed.actions.some((item) => item.stepId.includes('checks'))).toBe(false);
  const claimed = await f.cli(['next', f.name, '--session', 'actual-agent']);
  expect(claimed.exitCode, claimed.stdout).toBe(0);
  const secondOutput = claimed.envelope.data.resultTemplate.output;
  const { iteration: _iteration, attempt: _attempt, ...conclusion } = output.response.result;
  Object.assign(secondOutput.response.result, conclusion);
  const completed = await f.submit(claimed.envelope.data.task.actionId, secondOutput, [
    '--accept-on-pass',
    'The user delegated acceptance after the requested second review passes.',
  ]);
  expect(completed.exitCode, completed.stdout).toBe(0);
  expect((await f.runtime.inspect(f.name)).status).toBe('completed');
});
