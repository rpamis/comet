import { execFileSync } from 'node:child_process';
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
import { runNativeEditReviewCommand } from '../../../domains/comet-native/native-edit-review-command.js';
import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('reviews a generic edit in an independent session without claiming the formal Native Verifier', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-edit-review-'));
  roots.push(base);
  const root = path.join(base, 'project'),
    home = path.join(base, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await fs.writeFile(path.join(root, 'worker.py'), 'value = 1\n');
  const cli = async (...args: string[]) => {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return JSON.parse(result.stdout!);
  };
  await cli('new', 'demo', '--runtime', 'sdk');
  const change = path.join(root, 'docs/comet/changes/demo');
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nPreserve the worker.\n# Scope\nThe worker.\n# Non-goals\nNew functionality.\n# Acceptance examples\n- The worker returns one.\n',
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
  await runtime.recordOutcome({
    runId: 'demo',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: token,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output: {
        summary: 'Preserved the worker.',
        addressedAcceptanceIds: ['A1'],
        acceptanceReview: fixtureAcceptanceReview(['A1']),
        checks: [],
        knownLimits: [],
        review: null,
        submittedAt: new Date().toISOString(),
        verificationChecks: [],
      },
    },
    context: { requestId: randomUUID(), projectRoot: root },
  });
  await cli('next', 'demo');
  const before = await inspect();
  expect(before.state.phase).toBe('verify');
  const after = '# Explanation.\nvalue = 1\n';
  const request = {
    tool_name: 'Write',
    tool_input: { file_path: path.join(root, 'worker.py'), content: after },
  };
  expect(
    (await inspectNativeHookGuard(root, parseCometHookRequest(JSON.stringify(request)), 'demo'))
      .allowed,
  ).toBe(false);
  expect((await cli('status', 'demo')).data.continuation.action).toBe('review-edit');
  const file = path.join(base, 'edit.json');
  await fs.writeFile(file, JSON.stringify(request));
  await expect(
    runNativeEditReviewCommand({
      projectRoot: root,
      name: 'demo',
      operation: 'claim',
      file,
      sessionId: 'builder',
    }),
  ).rejects.toThrow('独立');
  const claimed = (await runNativeEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'claim',
    file,
    sessionId: 'reviewer',
  })) as { recordTemplate: Record<string, unknown> };
  const result = path.join(base, 'review.json');
  await fs.writeFile(
    result,
    JSON.stringify({
      ...claimed.recordTemplate,
      decision: 'non-behavioral',
      summary: 'Only the explanation changes; the value and acceptance remain the same.',
    }),
  );
  await runNativeEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'record',
    file: result,
  });
  expect(
    (await inspectNativeHookGuard(root, parseCometHookRequest(JSON.stringify(request)), 'demo'))
      .allowed,
  ).toBe(true);
  await fs.writeFile(path.join(root, 'worker.py'), after);
  expect((await inspect()).run.actions).toEqual(before.run.actions);
  expect((await cli('status', 'demo')).data.continuation.action).not.toBe('review-edit');
  const current = (await inspect()).state as NativePortableState;
  expect(current.builder_handoff?.candidate_id).toBe(before.state.builder_handoff?.candidate_id);

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
    sessionId: 'finished-verifier',
    claimToken: formalToken,
    context: { requestId: formalToken, projectRoot: root },
  });
  await runtime.recordOutcome({
    runId: 'demo',
    outcome: {
      actionId: formal.id,
      attempt: formal.attempt,
      inputHash: formal.inputHash,
      claimToken: formalToken,
      outcomeId: randomUUID(),
      status: 'failed',
      output: { summary: 'The Verifier session ended before completing acceptance.' },
    },
    context: { requestId: randomUUID(), projectRoot: root },
  });
  const finished = await inspect();
  expect(finished.run.actions.find((entry) => entry.id === formal.id)?.status).toBe('failed');
  await fs.writeFile(
    file,
    JSON.stringify({
      ...request,
      tool_input: { ...request.tool_input, content: '# Another explanation.\n' + after },
    }),
  );
  const replacement = (await runNativeEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'claim',
    file,
    sessionId: 'replacement-reviewer',
  })) as { recordTemplate: Record<string, unknown> };
  await fs.writeFile(
    result,
    JSON.stringify({
      ...replacement.recordTemplate,
      decision: 'discard',
      summary: 'The proposed additional explanation is not needed.',
    }),
  );
  await runNativeEditReviewCommand({
    projectRoot: root,
    name: 'demo',
    operation: 'record',
    file: result,
  });
  expect((await inspect()).run.actions).toEqual(finished.run.actions);
  expect(await fs.readFile(path.join(root, 'worker.py'), 'utf8')).toBe(after);
});
