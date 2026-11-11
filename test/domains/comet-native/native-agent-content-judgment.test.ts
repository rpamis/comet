import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';

import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';

import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(
  [
    {
      fail: false,
      generated: true,
      name: 'continues Native Verify and Archive through the generated Runtime without content proof',
    },
    {
      fail: false,
      alias: true,
      generated: true,
      name: 'continues the original Native Run through a generated Runtime and parent directory alias',
    },
    {
      fail: false,
      generated: true,
      afterPass: true,
      name: 'blocks Native Archive when a new real check fails after an accepted pass',
    },
    {
      fail: false,
      generated: true,
      repair: true,
      name: 'preserves an Agent-selected prior report for a repaired candidate and requires full new verification',
    },
  ].map(
    (item) =>
      [
        item.name,
        item.fail,
        'generated' in item && item.generated,
        'afterPass' in item && item.afterPass,
        'repair' in item && item.repair,
        'alias' in item && item.alias,
      ] as const,
  ),
)('%s', async (_title, fail, generated, afterPass, repair, alias) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-edit-review-'));
  roots.push(base);
  const physical = path.join(base, 'physical');
  await fs.mkdir(physical);
  if (alias)
    await fs.symlink(
      physical,
      path.join(base, 'alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  const root = path.join(base, alias ? 'alias' : 'physical', 'project'),
    home = path.join(base, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await fs.writeFile(path.join(root, 'worker.py'), 'value = 1\n');
  const invoke = async (...args: string[]) => {
    const input = [...args, '--project-root', root, '--json'];
    if (!generated) return runNativeCli(input);
    const result = spawnSync(
      process.execPath,
      [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...input],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    return {
      exitCode: result.status ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return JSON.parse(result.stdout!);
  };
  // Current public v4 fixture: SIMULATED Agent/User reports only; no legacy factory or managed check.
  await cli('new', 'demo', '--runtime', 'sdk', '--isolation', 'current'); // Current public factory; no managed checks.
  const change = path.join(root, 'docs/comet/changes/demo');
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nPreserve the worker.\n# Scope\nThe worker.\n## Directory structure\n### Modified\n- worker.py — preserve the worker result.\n# Non-goals\nNew functionality.\n# Acceptance examples\n- The worker returns one.\n',
  );
  await fs.mkdir(path.join(change, 'specs/worker'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'specs/worker/spec.md'),
    '# Worker\nThe worker returns one.\n',
  );
  await cli('next', 'demo');
  const inspect = () => inspectNativeSdkRun(root, 'demo');
  const prepared = await inspect();
  await cli(
    'next',
    'demo',
    '--confirmed',
    '--summary',
    'User approved Shape.',
    '--expected-state-version',
    String(prepared.state.state_version),
    '--expected-action',
    'confirm-shape',
  );
  const runtime = createNativeSdkRuntime(root);
  const built = await inspect();
  const action = built.run.actions.find(
    (entry) => entry.stepId === 'build.builder' && entry.status === 'pending',
  )!;
  const token = randomUUID();
  await runtime.claim({
    runId: 'demo',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'builder',
    claimToken: token,
    context: { requestId: token, projectRoot: root },
  });
  const builderOutput = {
    summary: 'Preserved the worker.',
    addressedAcceptanceIds: ['A1'],
    acceptanceReview: fixtureAcceptanceReview(['A1']),
    checks: [
      {
        name: 'SIMULATED Agent-reported worker check',
        result: 'passed',
        note: 'Agent/platform report, no Comet executor.',
      },
    ],
    knownLimits: [],
    review: null,
    submittedAt: new Date().toISOString(),
  };
  if (repair) {
    const actual = spawnSync(
      process.execPath,
      [
        '-e',
        "require('node:fs').appendFileSync('prior-check-count', 'executed\\n'); process.exit(0)",
      ],
      { cwd: root, windowsHide: true },
    );
    expect(actual.status).toBe(0);
    builderOutput.checks = [
      {
        name: 'Agent-selected actual Node check',
        result: 'passed',
        note: 'Node exited 0 before the first Builder handoff; the Agent judged this result still applicable after the explanation-only repair.',
      },
    ];
  }
  await runtime.recordOutcome({
    runId: 'demo',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: token,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output: builderOutput,
    },
    context: { requestId: randomUUID(), projectRoot: root },
  });
  await invoke('next', 'demo');
  const before = await inspect();

  expect(before.state.phase).toBe('verify');
  const after = '# Explanation.\nvalue = 1\n';
  const request = {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'worker.py'), content: after },
  };
  const decision = await inspectNativeHookGuard(
    root,
    parseCometHookRequest(JSON.stringify(request)),
    'demo',
  );
  expect(decision).toMatchObject({ allowed: true, phase: 'verify' });
  await fs.writeFile(path.join(root, 'worker.py'), after);
  await cli('next', 'demo');
  const afterEdit = await inspect();
  expect(afterEdit.state.phase).toBe('verify');
  if (generated && !alias) {
    expect(afterEdit.run.actions).toEqual(before.run.actions);
    expect(afterEdit.state.builder_handoff?.candidate_id).toBe(
      before.state.builder_handoff?.candidate_id,
    );
  }
  expect((await inspect()).run.actions.some((action) => action.stepId === 'verify.checks')).toBe(
    false,
  );
  expect(
    (await inspect()).state.builder_handoff?.checks.map((check) => ({
      name: check.name.text,
      result: check.result,
      note: check.note?.text,
    })),
  ).toEqual(builderOutput.checks);
  const formal = (await inspect()).run.actions.find(
    (entry) => entry.stepId === 'verify.verifier' && entry.status === 'pending',
  )!;
  const formalToken = randomUUID();
  await runtime.claim({
    runId: 'demo',
    actionId: formal.id,
    attempt: formal.attempt,
    inputHash: formal.inputHash,
    executorId: 'native-host',
    sessionId: 'formal-verifier',
    claimToken: formalToken,
    context: { requestId: formalToken, projectRoot: root },
  });
  expect((await inspect()).run.actions.find((entry) => entry.id === formal.id)?.status).toBe(
    'running',
  );
  const candidate = (await inspect()).state.builder_handoff!;
  await runtime.recordOutcome({
    runId: 'demo',
    outcome: {
      actionId: formal.id,
      attempt: formal.attempt,
      inputHash: formal.inputHash,
      claimToken: formalToken,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output: {
        candidateId: candidate.candidate_id,
        verifierExecutionRef: 'formal-verifier',
        response: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: repair ? 'fail' : 'pass',
            acceptance: [
              {
                id: 'A1',
                result: repair ? 'failed' : 'passed',
                reason: 'The Agent checked the current worker and its explanation.',
              },
            ],
            risks: [],
            summary: 'The worker still returns one.',
          },
        },
      },
    },
    context: { requestId: randomUUID(), projectRoot: root },
  });
  if (repair) {
    let current = await inspect();
    expect(current.state).toMatchObject({ phase: 'build', verification_result: 'fail' });
    const builder = current.run.actions.find(
      (action) => action.stepId === 'build.builder' && action.status === 'pending',
    )!;
    const builderToken = randomUUID();
    await runtime.claim({
      runId: 'demo',
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'builder',
      claimToken: builderToken,
      context: { requestId: builderToken, projectRoot: root },
    });
    await fs.appendFile(
      path.join(root, 'worker.py'),
      '# Agent repaired the explanation; the original check still applies.\n',
    );
    await runtime.recordOutcome({
      runId: 'demo',
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: builderToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: builderOutput,
      },
      context: { requestId: randomUUID(), projectRoot: root },
    });
    current = await inspect();
    expect(current.state.builder_handoff!.candidate_id).not.toBe(
      before.state.builder_handoff!.candidate_id,
    );
    expect(
      current.state.builder_handoff!.checks.map((check) => ({
        name: check.name.text,
        result: check.result,
        note: check.note?.text,
      })),
    ).toEqual(builderOutput.checks);
    const verifier = current.run.actions.find(
      (action) => action.stepId === 'verify.verifier' && action.status === 'pending',
    )!;
    expect(
      current.run.waits.some(
        (wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending',
      ),
    ).toBe(false);
    const verifierToken = randomUUID();
    await runtime.claim({
      runId: 'demo',
      actionId: verifier.id,
      attempt: verifier.attempt,
      inputHash: verifier.inputHash,
      executorId: 'native-host',
      sessionId: 'repaired-verifier',
      claimToken: verifierToken,
      context: { requestId: verifierToken, projectRoot: root },
    });
    await runtime.recordOutcome({
      runId: 'demo',
      outcome: {
        actionId: verifier.id,
        attempt: verifier.attempt,
        inputHash: verifier.inputHash,
        claimToken: verifierToken,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: {
          candidateId: current.state.builder_handoff!.candidate_id,
          verifierExecutionRef: 'repaired-verifier',
          response: {
            kind: 'final-result',
            result: {
              iteration: current.state.loop.iteration,
              attempt: current.state.loop.attempt,
              verdict: 'pass',
              acceptance: [
                {
                  id: 'A1',
                  result: 'passed',
                  reason:
                    'SIMULATED independent Agent completed the full current acceptance after repair.',
                },
              ],
              risks: [],
              summary: 'The repaired candidate satisfies every criterion.',
            },
          },
        },
      },
      context: { requestId: randomUUID(), projectRoot: root },
    });
    expect(await fs.readFile(path.join(root, 'prior-check-count'), 'utf8')).toBe('executed\n');
  }
  await cli('next', 'demo');

  const accepted = (await inspect()).run;
  const wait = accepted.waits.find(
    (entry) => entry.stepId === 'verify.confirm' && entry.status === 'pending',
  )!;
  expect(wait).toBeDefined();
  // 此决定仅属于隔离测试夹具，不表示真实用户批准。
  await runtime.resolveWait({
    runId: 'demo',
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'fixture-accept',
    choice: 'approved',
    context: { requestId: randomUUID(), projectRoot: root },
  });

  if (afterPass) {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        "require('node:fs').appendFileSync('agent-check-count', 'executed\\n'); process.exit(7)",
      ],
      { cwd: root, windowsHide: true },
    );
    expect(result.status).toBe(7);
    const approved = await inspect();
    await cli(
      'next',
      'demo',
      '--revise-implementation',
      '--summary',
      'SIMULATED Agent observed the actual platform check exit 7 after accepting the previous pass.',
      '--proposal-hash',
      wait.proposalHash,
      '--expected-state-version',
      String(approved.state.state_version),
      '--expected-action',
      'revise-implementation',
    );
    const revised = (await inspect()).run;
    expect(revised.state).toMatchObject({ phase: 'build', verification_result: 'pending' });
    expect(revised.waits.find((entry) => entry.id === wait.id)).toEqual(
      approved.run.waits.find((entry) => entry.id === wait.id),
    );
    const blocked = await invoke('archive', 'demo');
    expect(blocked.exitCode).not.toBe(0);
    expect(
      (await inspect()).run.actions.some(
        (action) => action.stepId === 'archive.finalize' && action.status === 'succeeded',
      ),
    ).toBe(false);
    expect(await fs.readFile(path.join(root, 'agent-check-count'), 'utf8')).toBe('executed\n');
    return;
  }

  await fs.appendFile(path.join(root, 'worker.py'), '# More explanation, same behavior.\n');
  await cli('next', 'demo');
  const completed = (await inspect()).run;
  expect(completed.status).toBe('completed');
  if (alias)
    expect((await inspectNativeSdkRun(await fs.realpath(root), 'demo')).run).toEqual(completed);
  expect(completed.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(0);
  expect(completed.outputs['archive.finalize']?.value).not.toHaveProperty('reportSha256');
  if (repair)
    expect(await fs.readFile(path.join(root, 'prior-check-count'), 'utf8')).toBe('executed\n');
});

it('keeps an actual Agent-platform failure report failed after file edits without replay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-failed-agent-report-'));
  roots.push(root);
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  const name = 'failed-report';
  const cli = async (...args: string[]) => {
    const r = await runNativeCli([...args, '--project-root', root, '--json']);
    expect(r.exitCode, r.stdout || r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };
  await cli('new', name);
  const dir = path.join(root, 'docs/comet/changes', name);
  await fs.writeFile(
    path.join(dir, 'brief.md'),
    `# Acceptance examples
- The worker preserves its output.
`,
  );
  await fs.mkdir(path.join(dir, 'specs/worker'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'specs/worker/spec.md'),
    `The worker preserves its output.
`,
  );
  await fs.writeFile(
    path.join(root, 'worker.py'),
    `value=1
`,
  );
  await cli('next', name);
  const runtime = createNativeSdkRuntime(root);
  let run = (await inspectNativeSdkRun(root, name)).run;
  const wait = run.waits.find((w) => w.status === 'pending')!;
  run = await runtime.resolveWait({
    runId: name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'SIMULATED-isolated-user-shape-approval',
    choice: 'approved',
  });
  const builder = run.actions.find((a) => a.stepId === 'build.builder' && a.status === 'pending')!,
    claimToken = randomUUID();
  await runtime.claim({
    runId: name,
    actionId: builder.id,
    attempt: builder.attempt,
    inputHash: builder.inputHash,
    executorId: 'native-host',
    sessionId: 'SIMULATED-agent-builder',
    claimToken,
  });
  const actual = spawnSync(process.execPath, ['-e', 'process.exit(7)'], {
    cwd: root,
    windowsHide: true,
  });
  expect(actual.status).toBe(7);
  const output = {
    summary: 'SIMULATED Agent reports the actual ordinary Node check failure.',
    addressedAcceptanceIds: ['A1'],
    acceptanceReview: fixtureAcceptanceReview(['A1']),
    checks: [
      {
        name: 'ordinary Agent-platform Node check',
        result: 'failed',
        note: 'Actual process exitCode=7; no Comet executor ran it.',
      },
    ],
    knownLimits: [
      'Actual ordinary check failed; independent review has not accepted the candidate.',
    ],
    review: null,
    submittedAt: new Date().toISOString(),
  };
  await runtime.recordOutcome({
    runId: name,
    outcome: {
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      claimToken,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output,
    },
    context: { requestId: 'SIMULATED-platform-outcome', projectRoot: root },
  });
  const before = (await inspectNativeSdkRun(root, name)).run;
  await fs.appendFile(
    path.join(root, 'worker.py'),
    `# explanation only
`,
  );
  await cli('next', name);
  const after = (await inspectNativeSdkRun(root, name)).run;
  expect(after.actions.find((a) => a.id === builder.id)?.outcome).toEqual(
    before.actions.find((a) => a.id === builder.id)?.outcome,
  );
  expect(after.outputs['build.builder'].value).toMatchObject({
    checks: [{ result: 'failed', note: expect.stringContaining('exitCode=7') }],
  });
  expect(after.actions.some((a) => a.stepId.includes('checks'))).toBe(false);
  expect(after.outputs['archive.finalize']).toBeUndefined();
  expect(after.status).not.toBe('completed');
});
