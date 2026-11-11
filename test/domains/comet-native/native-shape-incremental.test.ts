import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { returnNativePortableChangeToShape } from '../../../domains/comet-native/native-portable-requirements.js';
import { parseNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { readNativePortableChange } from '../../../domains/comet-native/native-portable-storage.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
  loadOwnedNativeSdkRuntime,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import type { RuntimeAction, WorkflowRun } from '../../../domains/engine/runtime.js';
import {
  createPortableRunCheckpoint,
  readPortableRunCheckpoint,
} from '../../../domains/engine/runtime.js';
import { registerSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
import { parseCometHookRequest } from '../../../platform/process/hook-adapter.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
const brief =
  '# Outcome\nPreserve the worker.\n# Scope\nThe worker.\n## Directory structure\n### Modified\n- worker.ts: preserve the worker result.\n# Non-goals\nNew functionality.\n# Acceptance examples\n- The worker returns one.\n# Verification expectations\nRun focused checks.\n## Spec → 测试名与断言计划\n| Test | Assertion | 计划行号 |\n| --- | --- | --- |\n| worker result | result equals one | planned |\n';
async function fixture(
  mode: 'sdk' | 'compat' = 'sdk',
  specText = '# Worker\nThe worker returns one.\n',
  briefText = brief,
  options: { projectAlias?: boolean; strict?: boolean } = {},
) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-shape-incremental-'));
  roots.push(base);
  let projectBase = base;
  if (options.projectAlias) {
    const physicalBase = path.join(base, 'physical');
    await fs.mkdir(physicalBase);
    projectBase = path.join(base, 'project-alias');
    await fs.symlink(physicalBase, projectBase, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const root = path.join(projectBase, 'project');
  await fs.mkdir(root);
  const home = path.join(base, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('XDG_DATA_HOME', path.join(home, 'data'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await fs.writeFile(path.join(root, 'worker.ts'), 'export const value = 1;\n');
  execFileSync('git', ['add', 'worker.ts'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'seed'],
    { cwd: root, stdio: 'ignore' },
  );
  const name = 'demo';
  if (options.strict) {
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, {
      ...config,
      native: { ...config.native, document_writes: 'revert' },
    });
  }
  const cli = async (...args: string[]) =>
    JSON.parse((await runNativeCli([...args, '--project-root', root, '--json'])).stdout!);
  // Default SDK is intentionally exercised, not only the explicit --runtime sdk alias.
  expect(
    (await cli('new', name, ...(mode === 'compat' ? ['--runtime', 'compat'] : []))).exitCode,
  ).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  const briefFile = path.join(change, 'brief.md');
  await fs.writeFile(briefFile, briefText);
  await fs.mkdir(path.join(change, 'specs/worker'), { recursive: true });
  await fs.writeFile(path.join(change, 'specs/worker/spec.md'), specText);
  const preparedResult = await cli('next', name, '--summary', 'Ready for Shape approval.');
  expect(preparedResult.exitCode, preparedResult.error?.message).toBe(0);
  const paths = await nativeProjectPaths(root, 'docs');
  const inspect = () => inspectNativeSdkRun(root, name);
  const state = async () =>
    mode === 'sdk' ? (await inspect()).state : readNativePortableChange(paths, name);
  const prepared = await state();
  const confirmed = await cli(
    'next',
    name,
    '--confirmed',
    '--summary',
    'User approved Shape.',
    '--expected-state-version',
    String(prepared.state_version),
    '--expected-action',
    'confirm-shape',
  );
  expect(confirmed.exitCode, confirmed.error?.message).toBe(0);
  const runtime = createNativeSdkRuntime(root);
  const claim = async (stepId: string) => {
    const { run } = await inspect();
    const action = run.actions.find(
      (entry) => entry.stepId === stepId && entry.status === 'pending',
    )!;
    const token = randomUUID();
    const sessionId = stepId === 'build.builder' ? 'builder' : 'verifier';
    const claimed = await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      sessionId,
      claimToken: token,
      context: { requestId: token, projectRoot: root },
    });
    return claimed.actions.find((entry) => entry.id === action.id)!;
  };
  const finishBuilder = async (action?: RuntimeAction) => {
    action ??= await claim('build.builder');
    await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
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
        },
      },
      context: { requestId: randomUUID(), projectRoot: root },
    });
    const preparedResult = await cli('next', name, '--summary', 'Ready for Shape approval.');
    expect(preparedResult.exitCode, preparedResult.error?.message).toBe(0);
    return (await inspect()).run;
  };
  const request = (file: string, content: string) =>
    parseCometHookRequest(
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: file, content },
      }),
    );
  return {
    base,
    root,
    paths,
    name,
    cli,
    inspect,
    state,
    runtime,
    claim,
    finishBuilder,
    request,
    briefFile,
    change,
  };
}

async function legacyFixture() {
  const f = await fixture('sdk', undefined, undefined, { strict: true });
  const released = JSON.parse(
    await fs.readFile(
      new URL('../../fixtures/native-sdk-050-approved-shape.json', import.meta.url),
      'utf8',
    ),
  ) as {
    runtimeCommit: string;
    brief: string;
    run: WorkflowRun;
    owner: Parameters<typeof registerSdkChangeOwner>[1];
  };
  const name = released.run.runId;
  const change = path.join(f.paths.changesDir, name);
  await fs.mkdir(change, { recursive: true });
  const briefFile = path.join(change, 'brief.md');
  await fs.writeFile(briefFile, released.brief);
  expect(released.runtimeCommit).toBe('aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  // Restore a real released Run as an upgrade input; no phase, hash, Action or claim is synthesized.
  const portable = readPortableRunCheckpoint(createPortableRunCheckpoint(released.run), name)!;
  expect(await createNativeSdkStateStore(f.root).compareAndSwap(name, null, portable)).toBe(true);
  await registerSdkChangeOwner(f.root, released.owner);
  const inspect = () => inspectNativeSdkRun(f.root, name);
  const { runtime } = await loadOwnedNativeSdkRuntime(f.root, name);
  return { ...f, name, change, briefFile, released, inspect, runtime };
}

describe('Native Shape incremental contract', () => {
  it('preserves SDK ownership and its original projection after Agent-accepted formal edits', async () => {
    const f = await fixture();
    await f.claim('build.builder');
    const before = await f.inspect();
    await fs.writeFile(
      f.briefFile,
      brief.replace('The worker returns one.', 'The worker returns two.'),
    );
    expect((await f.inspect()).run).toEqual(before.run);
    expect(await readNativePortableChange(f.paths, f.name)).toEqual(before.state);
    await expect(
      returnNativePortableChangeToShape({
        paths: f.paths,
        name: f.name,
        reason: 'Accidental Compat call',
      }),
    ).rejects.toThrow('belongs to SDK Run');
    expect(await readNativePortableChange(f.paths, f.name)).toEqual(before.state);
  });

  it('continues a restored 0.5.0 Run with its original approval and Builder claim without content proof', async () => {
    const f = await legacyFixture();
    const before = await f.inspect();
    const action = before.run.actions.find(
      (entry) => entry.stepId === 'build.builder' && entry.status === 'pending',
    )!;
    const token = randomUUID();
    await f.runtime.claim({
      runId: f.name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      sessionId: 'legacy-builder',
      claimToken: token,
      context: { projectRoot: f.root, requestId: token },
    });
    const claimed = await f.inspect();
    await fs.writeFile(f.briefFile, f.released.brief.replace('planned', '42'));
    const result = await f.runtime.recordOutcome({
      runId: f.name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: token,
        outcomeId: randomUUID(),
        status: 'succeeded',
        output: {
          summary: 'Preserved the confirmed contract.',
          addressedAcceptanceIds: ['A1', 'A2'],
          acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: new Date().toISOString(),
        },
      },
      context: { projectRoot: f.root, requestId: randomUUID() },
    });
    expect(result.state).toMatchObject({
      phase: 'verify',
      acceptance: claimed.state.acceptance,
      shape_confirmation_hash: claimed.state.shape_confirmation_hash,
      loop: { goal_cycle: claimed.state.loop.goal_cycle },
    });
    expect(result.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'succeeded',
      inputHash: action.inputHash,
      attempt: action.attempt,
      claim: { token, sessionId: 'legacy-builder' },
    });
  });

  it('ignores retired historical Shape snapshot fields without changing business state', async () => {
    const f = await fixture();
    const state = await f.state();
    const digest = 'a'.repeat(64);
    const historical = {
      ...state,
      shape_semantic_snapshot: {
        schema: 'comet.native.shape-semantics.v1',
        artifacts: [
          'brief.md',
          ...state.spec_changes.flatMap((change) => (change.source ? [change.source] : [])),
        ].map((source) => ({
          source,
          contentHash: digest,
          inputHash: digest,
          contractHash: digest,
          commentsHash: digest,
          legacyFingerprint: null,
          auxiliary: [],
        })),
      },
    };
    expect(parseNativePortableState(historical)).toEqual(state);
    const invalid = {
      ...historical,
      shape_semantic_snapshot: {
        ...historical.shape_semantic_snapshot,
        artifacts: [
          {
            ...historical.shape_semantic_snapshot.artifacts[0],
            contentHash: ['invalid legacy field'],
          },
        ],
      },
    };
    expect(parseNativePortableState(invalid)).toEqual(state);
    expect(() => parseNativePortableState({ ...historical, phase: 'invalid' })).toThrow('phase');
  });
});
