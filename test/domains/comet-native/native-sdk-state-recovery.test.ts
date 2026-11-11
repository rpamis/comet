import '../../helpers/isolated-agent-home.js';
import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../../../domains/workflow-contract/workspace-runtime.js';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
async function fixture(custom = false, { initializeGit = true, completeShape = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-recovery-'));
  roots.push(root);
  if (initializeGit) execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const name = 'demo';
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nResume the workflow.\n# Scope\nPreserve the workflow.\n## Directory structure\n### Modified\n- src/ — preserve workflow recovery behavior.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
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
    workspace: {
      isolation: 'current',
      change_branch: initializeGit ? 'main' : null,
      target_branch: initializeGit ? 'main' : null,
      finish: null,
    },
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
  run = await runtime.claim({
    runId: name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-cli',
    claimToken: 'shape-token',
    context: { requestId: 'shape', projectRoot: root },
  });
  if (completeShape)
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
  const markerFile = path.join(
    resolveWorkspaceRuntimeRootSync(root),
    'state-projections/native/demo.json',
  );
  const raw = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
  });
  const checkpoint = async () =>
    readPortableRunCheckpoint(parse(await fs.readFile(stateFile, 'utf8')).run_checkpoint, name, {
      preserveSourceRevision: true,
    })!;
  const loseRun = () =>
    fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'), { recursive: true });
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
  it.each(['initialize-git', 'replace-git'])(
    'keeps bound historical reads but rejects cross-namespace mutations after %s',
    async (mutation) => {
      const f = await fixture();
      if (mutation === 'initialize-git') {
        await fs.rename(path.join(f.root, '.git'), path.join(f.root, '.git-before-initialization'));
      }
      const previousRoot = await resolveWorkspaceRuntimeRoot(f.root);
      await fs.mkdir(previousRoot, { recursive: true });
      await fs.writeFile(path.join(previousRoot, 'preserved.txt'), 'Keep the old authority.');
      const store = createNativeSdkStateStore(f.root);
      const readOnlyStore = createNativeSdkStateStore(f.root, { readOnly: true });
      const snapshot = async (root: string): Promise<Record<string, string>> => {
        const entries: Record<string, string> = {};
        const visit = async (directory: string): Promise<void> => {
          for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            const ref = path.relative(root, target);
            if (entry.isDirectory()) {
              entries[ref] = 'directory';
              await visit(target);
            } else {
              entries[ref] = (await fs.readFile(target)).toString('base64');
            }
          }
        };
        await visit(root);
        return entries;
      };
      const previous = await snapshot(previousRoot);
      if (mutation === 'replace-git') {
        await fs.rename(path.join(f.root, '.git'), path.join(f.root, '.git-before-replacement'));
      }
      execFileSync('git', ['init', '-b', 'main'], { cwd: f.root, stdio: 'ignore' });
      const currentRoot = resolveWorkspaceRuntimeRootSync(f.root);
      expect(currentRoot).not.toBe(previousRoot);

      if (mutation === 'initialize-git') {
        await expect(store.read(f.name)).rejects.toThrow(/workspace identity changed/);
        await expect(readOnlyStore.read(f.name)).rejects.toThrow(/checkpoint recovery/);
      } else {
        const bound = await store.read(f.name);
        expect(bound).toEqual(f.run);
        expect(await readOnlyStore.read(f.name)).toEqual(bound);
      }
      await expect(
        store.compareAndSwap(f.name, f.run.revision, { ...f.run, revision: f.run.revision + 1 }),
      ).rejects.toThrow(/workspace identity changed/u);
      expect(await snapshot(previousRoot)).toEqual(previous);
      await expect(fs.stat(currentRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.each([true, false])(
    'recovers a pre-Git checkpoint after initialization with completed Shape=%s without replay',
    async (completeShape) => {
      const f = await fixture(false, { initializeGit: false, completeShape });
      const previousRoot = resolveWorkspaceRuntimeRootSync(f.root);
      const previous = await f.raw.read(f.name);
      const checkpoint = await f.checkpoint();
      execFileSync('git', ['init', '-b', 'main'], { cwd: f.root, stdio: 'ignore' });
      expect(resolveWorkspaceRuntimeRootSync(f.root)).not.toBe(previousRoot);
      expect(await f.store.read(f.name)).toEqual(previous);

      const restored = await createNativeSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual(checkpoint);
      expect(restored!.actions[0]).toMatchObject({
        id: previous!.actions[0].id,
        inputHash: previous!.actions[0].inputHash,
        status: checkpoint!.actions[0].status,
      });
      if (!completeShape) {
        expect(checkpoint!.actions[0].status).toBe('pending');
        expect(previous!.actions[0]).toMatchObject({
          status: 'running',
          claim: { token: 'shape-token' },
        });
      }
      expect(restored!.waits).toEqual(previous!.waits);
      expect(await f.raw.read(f.name)).toEqual(previous);
    },
  );

  it.each(['run', 'retired-marker', 'runtime'])(
    'recovers missing %s at the saved Shape revision and keeps its decision pending',
    async (missing) => {
      const f = await fixture();
      const saved = await f.checkpoint();
      expect(saved!.revision).toBeGreaterThan(1);
      if (missing === 'run') await f.loseRun();
      else
        await fs.rm(
          path.join(
            resolveWorkspaceRuntimeRootSync(f.root),
            missing === 'retired-marker' ? 'state-projections' : '.',
          ),
          { recursive: true, force: true },
        );
      const restored = await createNativeSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual(missing === 'retired-marker' ? f.run : saved);
      expect(restored!.waits[0].status).toBe('pending');
      expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(restored);
      await expect(fs.access(f.markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await f.raw.compareAndSwap(f.name, 1, { ...saved!, revision: 2 })).toBe(false);
      expect((await advanceNativeSdkChange(f.root, f.name)).exitCode).toBe(0);
    },
  );

  it('preserves Build history, approvals, hashes and an interrupted claim without replaying work', async () => {
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
          checks: [
            {
              name: 'Actual platform Node probe',
              result: 'passed',
              note: execFileSync(
                process.execPath,
                ['-e', "process.stdout.write('platform probe passed')"],
                { encoding: 'utf8' },
              ).trim(),
            },
          ],
          knownLimits: [],
          review: null,
          submittedAt: '2026-10-07T00:00:00.000Z',
        },
      },
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
    'restores legacy normalized checkpoints without requiring a marker and partial import=%s',
    async (partial) => {
      const f = await fixture();
      const document = parse(await fs.readFile(f.stateFile, 'utf8'));
      delete document.run_checkpoint.sourceRevision;
      delete document.run_checkpoint.sourceHash;
      await fs.writeFile(f.stateFile, '# comet-execution: managed-run\n' + stringify(document));
      const saved = await f.checkpoint();
      await f.loseRun();
      if (partial) await f.raw.compareAndSwap(f.name, null, saved!);
      const restored = await createNativeSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual(saved);
      expect(restored!.state).toEqual(f.run.state);
      expect(restored!.waits).toEqual(f.run.waits);
      expect(
        await f.raw.compareAndSwap(f.name, restored!.revision + 1, {
          ...restored!,
          revision: restored!.revision + 2,
        }),
      ).toBe(false);
      expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(restored);
    },
  );

  it('retries after the Run is published but before projection completion', async () => {
    const f = await fixture();
    const saved = await f.checkpoint();
    await f.loseRun();
    await fs.rm(f.markerFile, { force: true });
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
    await expect(fs.access(f.markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['checkpoint', 'source-revision', 'state', 'branch'])(
    'rejects %s drift before creating a replacement Run',
    async (damage) => {
      const f = await fixture();
      if (damage === 'branch')
        execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: f.root });
      else {
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
  it.each([false, true])(
    'restores only matching bound sourceRevision partial data (drift=%s)',
    async (drift) => {
      const f = await fixture(),
        saved = (await f.checkpoint())!;
      expect(saved.revision).toBeGreaterThan(1);
      const bytes = await fs.readFile(f.stateFile),
        partial = {
          ...saved,
          revision: 1,
          state: drift ? { ...(saved.state as object), language: 'zh-CN' } : saved.state,
        };
      await f.loseRun();
      expect(await f.raw.compareAndSwap(f.name, null, partial)).toBe(true);
      if (drift) {
        await expect(createNativeSdkStateStore(f.root).read(f.name)).rejects.toThrow(
          /interrupted checkpoint import/,
        );
        expect(await f.raw.read(f.name)).toEqual(partial);
      } else {
        await expect(
          createNativeSdkStateStore(f.root, { readOnly: true }).read(f.name),
        ).rejects.toThrow(/checkpoint recovery/);
        expect(await f.raw.read(f.name)).toEqual(partial);
        expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(saved);
        expect(await f.raw.read(f.name)).toEqual(saved);
        expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(saved);
      }
      expect(await fs.readFile(f.stateFile)).toEqual(bytes);
    },
  );

  it.each(['marker', 'future-marker'])(
    'ignores retired %s bytes while preserving the actual portable recovery evidence',
    async (marker) => {
      const f = await fixture(),
        saved = await f.checkpoint(),
        bytes = await fs.readFile(f.stateFile),
        source = JSON.stringify({
          schema: 'SIMULATED-retired-projection',
          revision: marker === 'future-marker' ? f.run.revision + 10 : f.run.revision,
          state: { language: 'zh-CN' },
        });
      await fs.mkdir(path.dirname(f.markerFile), { recursive: true });
      await fs.writeFile(f.markerFile, source);
      await f.loseRun();
      expect(await createNativeSdkStateStore(f.root).read(f.name)).toEqual(saved);
      expect(await fs.readFile(f.stateFile)).toEqual(bytes);
      expect(await fs.readFile(f.markerFile, 'utf8')).toBe(source);
    },
  );

  it('retains a real public Shape Agent claim in its portable checkpoint before workspace recreation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-shape-agent-checkpoint-'));
    roots.push(root);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    const { runNativeCli } = await import('../../../domains/comet-native/native-cli.js'),
      name = 'shape-agent',
      cli = async (args: string[]) => {
        const r = await runNativeCli([...args, '--project-root', root, '--json']);
        expect(r.exitCode, r.stdout).toBe(0);
        return r;
      };
    await cli(['new', name]);
    await cli(['next', name, '--session', 'SIMULATED-original-shape-agent']);
    const oldRoot = resolveWorkspaceRuntimeRootSync(root),
      raw = createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(oldRoot, 'sdk-runs/native') }),
      original = (await raw.read(name))!,
      action = original.actions.find((a) => a.stepId === 'shape.prepare')!;
    expect(action).toMatchObject({
      status: 'running',
      claim: { sessionId: 'SIMULATED-original-shape-agent', executorId: 'native-host' },
    });
    const file = path.join(root, 'docs/comet/changes', name, 'comet-state.yaml'),
      bytes = await fs.readFile(file),
      saved = readPortableRunCheckpoint(parse(bytes.toString()).run_checkpoint, name, {
        preserveSourceRevision: true,
      })!;
    expect(saved.revision).toBe(original.revision);
    expect(saved.actions.find((a) => a.id === action.id)).toMatchObject({
      id: action.id,
      inputHash: action.inputHash,
      status: 'unknown',
      claim: {
        sessionId: action.claim!.sessionId,
        executorId: 'native-host',
        token: expect.stringMatching(/^portable-/),
      },
    });
    await fs.rename(path.join(root, '.git'), path.join(root, '.git-original'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    expect(await createNativeSdkStateStore(root).read(name)).toEqual(saved);
    expect(await raw.read(name)).toEqual(original);
    expect(await fs.readFile(file)).toEqual(bytes);
  });
});
