import './isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import { loadOwnedNativeSdkRuntime } from '../../domains/comet-native/native-runtime-ownership.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { fixtureAcceptanceReview } from './native-builder-acceptance-review.js';
import type { RuntimeValue } from '../../domains/engine/runtime.js';

export async function nativeVerificationFixture(
  onRoot?: (root: string) => void,
  cliPath?: string,
  task?: string,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-verification-'));
  onRoot?.(temporary);
  const root = path.join(temporary, 'project');
  await fs.mkdir(root);
  let requestIndex = 0;
  const cli = (args: string[]) => {
    const execution = spawnSync(process.execPath, [cliPath!, ...args], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (execution.status !== 0) throw new Error(execution.stdout + execution.stderr);
    return JSON.parse(execution.stdout.slice(execution.stdout.indexOf('{')));
  };
  const dispatch = async (request: Record<string, unknown>) => {
    const file = path.join(temporary, `request-${++requestIndex}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    const result = cli([
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--project-root',
      root,
      '--request',
      file,
      '--json',
    ]);
    if (result.status !== 'succeeded') throw new Error(JSON.stringify(result));
    return result.data;
  };
  const load = async () => {
    const owned = await loadOwnedNativeSdkRuntime(root, 'verification-test');
    return { ...owned, run: await owned.runtime.inspect('verification-test') };
  };
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      windowsHide: true,
      stdio: 'pipe',
    });
  git('init');
  await fs.writeFile(path.join(root, 'value.txt'), 'initial\n');
  git('add', 'value.txt');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'initial',
  );
  const config = defaultProjectConfig('docs', 'zh-CN');
  await writeProjectConfig(root, config);
  const invoke = async (...args: string[]) => {
    if (cliPath) {
      const result = cli(['native', ...args, '--project-root', root, '--json']) as Awaited<
        ReturnType<typeof runNativeCli>
      >;
      if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
      return result;
    }
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    if (result.exitCode !== 0) throw new Error(JSON.stringify(result));
    return result;
  };
  const change = path.join(root, 'docs/comet/changes/verification-test');
  await fs.mkdir(change, { recursive: true });
  // Current business workflow; independent review is selected explicitly in the fixture report.
  const initial = {
    operation: 'start',
    runId: 'verification-test',
    workflow: { id: 'comet-native', version: '4' },
    input: {
      name: 'verification-test',
      artifactRootRef: 'docs',
      ...(task ? { task } : {}),
    },
    initialState: createNativePortableState({
      name: 'verification-test',
      language: 'zh-CN',
      nextAction: 'prepare-shape-confirmation',
    }),
  };
  if (cliPath) await dispatch(initial);
  else {
    const request = path.join(temporary, 'start.json');
    await fs.writeFile(request, JSON.stringify(initial));
    const started = await runtimeDispatchCommand({
      projectRoot: root,
      application: 'native',
      request,
    });
    if (started.exitCode !== 0) throw new Error(JSON.stringify(started));
  }
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nDeliver the expected value.\n# Scope\nChange the value.\n## Directory structure\n### Modified\n- value.txt — expected value.\n# Non-goals\nNo unrelated changes.\n# Acceptance examples\n- The value is expected.\n',
  );
  await fs.mkdir(path.join(change, 'specs/value'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'specs/value/spec.md'),
    '# Value\nThe final value is expected.\n',
  );
  await invoke('next', 'verification-test');
  let owned = await load();
  const state = owned.run.state as { state_version: number };
  await invoke(
    'next',
    'verification-test',
    '--confirmed',
    '--summary',
    'Approve fixture shape',
    '--expected-state-version',
    String(state.state_version),
    '--expected-action',
    'confirm-shape',
  );
  const submit = async (output: RuntimeValue, sessionId: string) => {
    if (cliPath) {
      const run = await dispatch({
        operation: 'inspect',
        runId: 'verification-test',
      });
      const action = run.actions.at(-1)!;
      const claimToken =
        action.claim?.sessionId === sessionId ? action.claim.token : crypto.randomUUID();
      if (action.claim?.sessionId !== sessionId)
        await dispatch({
          operation: 'claim',
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'native-host',
          sessionId,
          claimToken,
        });
      await dispatch({
        operation: 'record-outcome',
        runId: run.runId,
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken,
          outcomeId: crypto.randomUUID(),
          status: 'succeeded',
          output,
        },
      });
      return dispatch({ operation: 'inspect', runId: run.runId });
    }
    owned = await load();
    const action = owned.run.actions.at(-1)!;
    const context = { projectRoot: root, requestId: crypto.randomUUID() };
    const claimed =
      action.claim?.sessionId === sessionId
        ? owned.run
        : await owned.runtime.claim({
            runId: owned.run.runId,
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            executorId: 'native-host',
            sessionId,
            claimToken: crypto.randomUUID(),
            context,
          });
    return owned.runtime.recordOutcome({
      runId: owned.run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.actions.at(-1)!.claim!.token,
        outcomeId: crypto.randomUUID(),
        status: 'succeeded',
        output,
      },
      context,
    });
  };
  const candidate = async (value: string, sessionId = 'builder') => {
    await fs.writeFile(path.join(root, 'value.txt'), value);
    await submit(
      {
        summary: 'Implement expected value',
        acceptanceReview: fixtureAcceptanceReview(['A1']) as unknown as RuntimeValue,
        checks: [],
        knownLimits: [],
        requireIndependentReview: true,
      },
      sessionId,
    );
    await invoke('next', 'verification-test');
    return cliPath
      ? dispatch({ operation: 'inspect', runId: 'verification-test' })
      : (await load()).run;
  };
  return {
    root,
    change,
    invoke,
    submit,
    candidate,
    inspect: async () =>
      cliPath ? dispatch({ operation: 'inspect', runId: 'verification-test' }) : (await load()).run,
  };
}
