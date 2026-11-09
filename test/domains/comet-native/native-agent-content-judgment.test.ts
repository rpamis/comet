import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeSdkCurrentCheckSummaries } from '../../../domains/comet-native/native-sdk-checks.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';

import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';
import { createLegacyNativeSdkChange } from '../../helpers/native-legacy-sdk-change.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it.each(
  [
    { fail: true, name: 'keeps a real failed Native check failed after file edits without replay' },
    {
      fail: false,
      generated: true,
      name: 'continues Native Verify and Archive through the generated Runtime without content proof',
    },
    {
      fail: false,
      afterPass: true,
      name: 'blocks Native Archive when a new real check fails after an accepted pass',
    },
    {
      fail: false,
      alias: true,
      generated: true,
      name: 'continues the original Native Run through a generated Runtime and parent directory alias',
    },
    {
      fail: false,
      repair: true,
      name: 'reuses an Agent-selected original Runtime check for a repaired Native candidate',
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
    return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return JSON.parse(result.stdout!);
  };
  // Managed-check assertions cover supported legacy Runs; v4 platform reports have their own CLI suite.
  await createLegacyNativeSdkChange(root, 'demo', '3');
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
    checks: [],
    knownLimits: [],
    review: null,
    submittedAt: new Date().toISOString(),
    verificationChecks: [
      {
        id: 'worker',
        name: 'Check worker value',
        executable: process.execPath,
        argv: [
          '-e',
          fail
            ? 'process.exit(7)'
            : "if (!require('node:fs').readFileSync('worker.py', 'utf8').includes('value = 1')) process.exit(1);require('node:fs').appendFileSync('check-counter.txt','x')",
        ],
        cwdRef: '.',
        timeoutMs: 10_000,
        repeatable: true,
      },
    ],
  };
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
  if (fail) {
    const check = before.run.actions.find((action) => action.stepId === 'verify.checks')!;
    expect(check.outcome?.output).toMatchObject({ checks: [{ status: 'failed', exitCode: 7 }] });
    await fs.appendFile(path.join(root, 'worker.py'), '# Explanation after a failed check.\n');
    await invoke('next', 'demo');
    const failed = (await inspect()).run;
    expect(failed.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(1);
    expect(failed.outputs['archive.finalize']).toBeUndefined();
    expect(failed.actions.find((action) => action.id === check.id)?.outcome?.output).toMatchObject({
      checks: [{ status: 'failed', exitCode: 7 }],
    });
    return;
  }
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
  expect((await inspect()).state.phase).toBe('verify');
  await expect(
    nativeSdkCurrentCheckSummaries({ run: (await inspect()).run, projectRoot: root }),
  ).resolves.toHaveLength(1);
  expect(
    (await inspect()).run.actions.find((action) => action.stepId === 'verify.checks')?.outcome
      ?.output,
  ).not.toHaveProperty('inputSnapshot');
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
  await cli('next', 'demo');
  if (repair) {
    const firstCheck = before.run.actions.find((action) => action.stepId === 'verify.checks')!;
    await fs.appendFile(
      path.join(root, 'worker.py'),
      '# Agent addressed the in-scope review feedback.\n',
    );
    const returned = (await inspect()).run;
    expect((await inspect()).state.phase).toBe('build');
    const builder = returned.actions.find(
      (action) => action.stepId === 'build.builder' && action.status === 'pending',
    )!;
    const token = randomUUID();
    await runtime.claim({
      runId: 'demo',
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'builder-repair',
      claimToken: token,
      context: { requestId: token, projectRoot: root },
    });
    await runtime.recordOutcome({
      runId: 'demo',
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: {
          ...builderOutput,
          summary: 'Addressed the in-scope review feedback.',
          verificationChecks: builderOutput.verificationChecks.map((plan) => ({
            ...plan,
            reusable: true,
          })),
        },
      },
      context: { requestId: randomUUID(), projectRoot: root },
    });
    await cli('next', 'demo');
    const repaired = (await inspect()).run;
    const check = repaired.actions.findLast((action) => action.stepId === 'verify.checks')!;
    expect(check.outcome?.output).toMatchObject({
      checks: [{ status: 'passed', reusedFrom: { actionId: firstCheck.id } }],
    });
    expect(await fs.readFile(path.join(root, 'check-counter.txt'), 'utf8')).toBe('x');
    expect(repaired.waits.filter((wait) => wait.stepId === 'shape.confirm')).toHaveLength(1);
    expect((await inspect()).state.phase).toBe('verify');
    return;
  }
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
    await fs.writeFile(path.join(root, 'worker.py'), 'value = 2\n');
    const current = (await inspect()).run;
    const pending = current.actions.find((action) => action.status === 'pending')!;
    await runtime.dispatchCommand({
      runId: current.runId,
      expectedRevision: current.revision,
      name: 'refresh-checks',
      commandId: 'fixture-repeat-check',
      input: {
        archiveActionId: pending.id,
        approvalWaitId: wait.id,
        proposalHash: wait.proposalHash,
        checkIds: ['worker'],
        summary: 'Agent selected the affected original check.',
      },
      context: { requestId: randomUUID(), projectRoot: root },
    });
    await invoke('next', 'demo');
    const failed = (await inspect()).run;
    expect(failed.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(2);
    expect(
      failed.actions.findLast((action) => action.stepId === 'verify.checks')?.outcome?.output,
    ).toMatchObject({ checks: [{ status: 'failed', exitCode: 1 }] });
    expect(failed.outputs['archive.finalize']).toBeUndefined();
    return;
  }
  await fs.appendFile(path.join(root, 'worker.py'), '# More explanation, same behavior.\n');
  await cli('next', 'demo');
  const completed = (await inspect()).run;
  expect(completed.status).toBe('completed');
  if (alias)
    expect((await inspectNativeSdkRun(await fs.realpath(root), 'demo')).run).toEqual(completed);
  expect(completed.actions.filter((action) => action.stepId === 'verify.checks')).toHaveLength(1);
  expect(completed.outputs['archive.finalize']?.value).not.toHaveProperty('reportSha256');
});
