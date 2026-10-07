import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFileRuntimeStore,
  createRuntime,
  readPortableRunCheckpoint,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { advanceNativeSdkChange } from '../../../domains/comet-native/native-sdk-next.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import type { ApplicationIdentity } from '../../../domains/workflow-application/index.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(custom = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-recovery-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const name = 'demo';
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nResume the workflow.\n# Scope\nPreserve the workflow.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe workflow preserves confirmed work.\n',
  );
  const identity: ApplicationIdentity | undefined = custom
    ? {
        id: 'custom-native',
        version: '1',
        base: 'native',
        contentHash: 'a'.repeat(64),
        packageRoot: path.join(root, 'package'),
        projectRoot: root,
        runtimeVersion: '0.4.5',
      }
    : undefined;
  const application = defineNativeWorkflowApplication();
  const store = createNativeSdkStateStore(root, { identity });
  const runtime = createRuntime({
    ...application,
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
  });
  const state = createNativePortableState({
    name,
    language: 'en',
    workspace: { isolation: 'current', change_branch: 'main', target_branch: 'main', finish: null },
    nextAction: 'prepare-shape-confirmation',
  });
  let run = await runtime.start({
    runId: name,
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name, artifactRootRef: 'docs' },
    initialState: state,
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: name,
    format: 'sdk',
    application: identity?.id ?? 'native',
    runId: name,
  });
  const action = run.actions[0];
  await runtime.claim({
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-cli',
    claimToken: 'shape-token',
    context: { requestId: 'shape', projectRoot: root },
  });
  run = await runtime.recordOutcome({
    runId: name,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'shape-token',
      outcomeId: 'shape',
      status: 'succeeded',
      output: (await collectNativeSdkShapeProposal({ paths, state })) as never,
    },
    context: { requestId: 'shape', projectRoot: root },
  });
  const stateFile = path.join(changeDir, 'comet-state.yaml');
  const markerFile = path.join(root, '.comet/runtime/state-projections/native/demo.json');
  const raw = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(root, '.comet/runtime/sdk-runs/native'),
  });
  const checkpoint = async () =>
    readPortableRunCheckpoint(parse(await fs.readFile(stateFile, 'utf8')).run_checkpoint, name, {
      preserveSourceRevision: true,
    })!;
  const loseRun = () =>
    fs.rm(path.join(root, '.comet/runtime/sdk-runs/native'), { recursive: true });
  return {
    root,
    name,
    store,
    runtime,
    run,
    raw,
    identity,
    stateFile,
    markerFile,
    checkpoint,
    loseRun,
  };
}

describe('Native trusted checkpoint recovery', () => {
  it.each(['run', 'projection', 'runtime'])(
    'recovers missing %s at the saved Shape revision and keeps its decision pending',
    async (missing) => {
      const f = await fixture();
      const saved = await f.checkpoint();
      expect(saved!.revision).toBeGreaterThan(1);
      if (missing === 'run') await f.loseRun();
      else
        await fs.rm(
          path.join(
            f.root,
            `.comet/runtime${missing === 'projection' ? '/state-projections' : ''}`,
          ),
          { recursive: true },
        );
      const restored = await createNativeSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual(missing === 'projection' ? f.run : saved);
      expect(restored!.waits[0].status).toBe('pending');
      expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(restored);
      expect(JSON.parse(await fs.readFile(f.markerFile, 'utf8')).revision).toBe(saved!.revision);
      expect(await f.raw.compareAndSwap(f.name, 1, { ...saved!, revision: 2 })).toBe(false);
      expect((await advanceNativeSdkChange(f.root, f.name)).exitCode).toBe(0);
    },
  );

  it('preserves Build history, approvals, hashes and an interrupted claim without replaying work', async () => {
    const f = await fixture();
    const wait = f.run.waits[0];
    let run = await f.runtime.resolveWait({
      runId: f.name,
      expectedRevision: f.run.revision,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'confirmed-shape',
      choice: 'approved',
    });
    expect((await advanceNativeSdkChange(f.root, f.name)).exitCode).toBe(0);
    run = await f.runtime.inspect(f.name);
    expect(run.state).toMatchObject({ phase: 'build' });
    const builder = run.actions.at(-1)!;
    expect(builder.stepId).toBe('build.builder');
    run = await f.runtime.claim({
      runId: f.name,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      claimToken: 'builder-claim',
      executorId: 'native-host',
      context: { requestId: 'builder', projectRoot: f.root },
    });
    const saved = await f.checkpoint();
    await f.loseRun();
    const restored = await createNativeSdkStateStore(f.root).read(f.name);
    expect(restored).toEqual(saved);
    expect(restored!.revision).toBe(run.revision);
    expect(restored!.actions.at(-1)).toMatchObject({
      id: builder.id,
      inputHash: builder.inputHash,
      status: 'unknown',
      claim: { token: expect.stringMatching(/^portable-/) },
    });
    expect(restored!.waits).toEqual(run.waits);
  });

  it('restores Verify with its candidate, check evidence and pending Verifier unchanged', async () => {
    const f = await fixture();
    const wait = f.run.waits[0];
    await f.runtime.resolveWait({
      runId: f.name,
      expectedRevision: f.run.revision,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'confirmed-shape',
      choice: 'approved',
    });
    expect((await advanceNativeSdkChange(f.root, f.name)).exitCode).toBe(0);
    let run = await f.runtime.inspect(f.name);
    const builder = run.actions.at(-1)!;
    expect(builder.stepId).toBe('build.builder');
    const context = { requestId: 'builder', projectRoot: f.root };
    run = await f.runtime.claim({
      runId: f.name,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'builder-session',
      claimToken: 'builder-claim',
      context,
    });
    run = await f.runtime.recordOutcome({
      runId: f.name,
      context,
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: run.actions.at(-1)!.claim!.token,
        outcomeId: 'builder-result',
        status: 'succeeded',
        output: {
          summary: 'Implemented the recovery fixture.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-10-07T00:00:00.000Z',
          verificationChecks: [],
        },
      },
    });
    run = await f.runtime.execute({
      runId: f.name,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'checks', projectRoot: f.root },
    });
    expect(run.state).toMatchObject({ phase: 'verify' });
    expect(run.actions.at(-1)).toMatchObject({ stepId: 'verify.verifier', status: 'pending' });
    const saved = await f.checkpoint();
    await f.loseRun();
    const restored = await createNativeSdkStateStore(f.root).read(f.name);
    expect(restored).toEqual(saved);
    expect(restored!.revision).toBe(run.revision);
    expect(restored!.state).toEqual(run.state);
    expect(restored!.waits).toEqual(run.waits);
    expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(restored);
  });

  it.each([false, true])(
    'supports legacy checkpoints with a retained projection and partial import=%s',
    async (partial) => {
      const f = await fixture();
      const document = parse(await fs.readFile(f.stateFile, 'utf8'));
      delete document.run_checkpoint.sourceRevision;
      delete document.run_checkpoint.sourceHash;
      await fs.writeFile(f.stateFile, '# comet-execution: managed-run\n' + stringify(document));
      await f.loseRun();
      if (partial) await f.raw.compareAndSwap(f.name, null, document.run_checkpoint.run);
      const restored = await createNativeSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual({ ...document.run_checkpoint.run, revision: f.run.revision });
      expect(await f.raw.compareAndSwap(f.name, 1, { ...restored!, revision: 2 })).toBe(false);
      expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(restored);
    },
  );

  it('retries after the Run is published but before projection completion', async () => {
    const f = await fixture();
    const saved = await f.checkpoint();
    await f.loseRun();
    await fs.rm(f.markerFile);
    const interrupted = createNativeSdkStateStore(f.root, {
      store: {
        ...f.raw,
        async restoreCheckpoint(...args) {
          await f.raw.restoreCheckpoint!(...args);
          throw new Error('simulated projection interruption');
        },
      },
    });
    await expect(interrupted.read(f.name)).rejects.toThrow(/projection interruption/);
    expect(await f.raw.read(f.name)).toEqual(saved);
    expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(saved);
    expect(JSON.parse(await fs.readFile(f.markerFile, 'utf8')).revision).toBe(saved!.revision);
  });

  it.each(['checkpoint', 'source-revision', 'marker', 'future-marker', 'state', 'branch'])(
    'rejects %s drift before creating a replacement Run',
    async (damage) => {
      const f = await fixture();
      if (damage === 'branch')
        execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: f.root });
      else if (damage.includes('marker')) {
        const marker = JSON.parse(await fs.readFile(f.markerFile, 'utf8'));
        if (damage === 'future-marker') marker.revision += 1;
        else marker.state.language = 'zh-CN';
        await fs.writeFile(f.markerFile, JSON.stringify(marker));
      } else {
        const document = parse(await fs.readFile(f.stateFile, 'utf8'));
        if (damage === 'checkpoint') document.run_checkpoint.hash = '0'.repeat(64);
        else if (damage === 'source-revision') document.run_checkpoint.sourceRevision += 20;
        else document.language = 'zh-CN';
        await fs.writeFile(f.stateFile, '# comet-execution: managed-run\n' + stringify(document));
      }
      await f.loseRun();
      const before = await fs.readFile(f.stateFile, 'utf8');
      await expect(createNativeSdkStateStore(f.root).read(f.name)).rejects.toThrow();
      expect(await f.raw.read(f.name)).toBeNull();
      expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
    },
  );

  it('requires the original custom application identity and a recovery-capable store', async () => {
    const f = await fixture(true);
    const saved = await f.checkpoint();
    await f.loseRun();
    await expect(createNativeSdkStateStore(f.root).read(f.name)).rejects.toThrow(
      /original fixed Application/,
    );
    await expect(
      createNativeSdkStateStore(f.root, {
        identity: { ...f.identity!, contentHash: 'b'.repeat(64) },
      }).read(f.name),
    ).rejects.toThrow(/original fixed Application/);
    await expect(
      createNativeSdkStateStore(f.root, {
        identity: f.identity,
        store: { read: f.raw.read, compareAndSwap: f.raw.compareAndSwap },
      }).read(f.name),
    ).rejects.toThrow(/restoreCheckpoint support/);
    expect(await f.raw.read(f.name)).toBeNull();
    expect(await createNativeSdkStateStore(f.root, { identity: f.identity }).read(f.name)).toEqual(
      saved,
    );
  });
});
