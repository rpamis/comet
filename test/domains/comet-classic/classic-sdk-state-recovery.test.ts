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
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import {
  classicOpenEvidenceReceipt,
  defineClassicWorkflowApplication,
} from '../../../domains/comet-classic/classic-sdk-application.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import {
  parseClassicStateDocument,
  CLASSIC_MANAGED_RUN_MARKER,
} from '../../../domains/comet-classic/classic-state.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
import type { ApplicationIdentity } from '../../../domains/workflow-application/index.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(custom = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-recovery-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const name = 'demo';
  const changeDir = path.join(root, 'openspec/changes/demo');
  const stateFile = path.join(changeDir, '.comet.yaml');
  const markerFile = path.join(root, '.comet/runtime/state-projections/classic/demo.json');
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(['state', ...args, '--json']),
    );
  const identity: ApplicationIdentity | undefined = custom
    ? {
        id: 'custom-classic',
        version: '1',
        base: 'classic-hotfix',
        contentHash: 'a'.repeat(64),
        packageRoot: path.join(root, 'package'),
        projectRoot: root,
        runtimeVersion: '0.4.5',
      }
    : undefined;
  const application = defineClassicWorkflowApplication('hotfix');
  const store = createClassicSdkStateStore(root, { identity });
  const runtime = createRuntime({
    ...application,
    store,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
  });
  if (custom) {
    await fs.mkdir(changeDir, { recursive: true });
    const state = parseClassicStateDocument({
      workflow: 'hotfix',
      language: 'en',
      phase: 'open',
      design_doc: null,
      plan: null,
      build_mode: null,
      isolation: 'current',
      bound_branch: 'main',
      verify_mode: null,
      verify_result: 'pending',
      verified_at: null,
      archived: false,
    }).classic!;
    await runtime.start({
      runId: name,
      workflow: { id: application.workflow.id, version: application.workflow.version },
      input: { change: name, changeDir: 'openspec/changes/demo' },
      initialState: state as never,
    });
    await store.read(name);
    await registerSdkChangeOwner(root, {
      schema: COMET_CHANGE_OWNER_SCHEMA,
      workflow: 'classic',
      change: name,
      format: 'sdk',
      application: identity!.id,
      runId: name,
    });
    const document = parse(await fs.readFile(stateFile, 'utf8'));
    document.language = 'zh-CN';
    await fs.writeFile(stateFile, CLASSIC_MANAGED_RUN_MARKER + stringify(document));
  } else {
    expect((await cli('init', name, 'hotfix', '--isolation', 'current')).exitCode).toBe(0);
    expect((await cli('set', name, 'language', 'zh-CN')).exitCode).toBe(0);
  }
  const run = await store.read(name);
  const raw = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(root, '.comet/runtime/sdk-runs/classic'),
  });
  const checkpoint = async () =>
    readPortableRunCheckpoint(parse(await fs.readFile(stateFile, 'utf8')).run_checkpoint, name, {
      preserveSourceRevision: true,
    })!;
  const loseRun = () =>
    fs.rm(path.join(root, '.comet/runtime/sdk-runs/classic'), { recursive: true });
  return {
    root,
    name,
    cli,
    runtime,
    store,
    raw,
    run: run!,
    identity,
    stateFile,
    changeDir,
    markerFile,
    checkpoint,
    loseRun,
  };
}

describe('Classic trusted checkpoint recovery', () => {
  it.each(['run', 'projection', 'runtime'])(
    'recovers missing %s at the original revision without replaying Open',
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
      const restored = await createClassicSdkStateStore(f.root).read(f.name);
      expect(restored).toEqual(saved);
      expect(await createClassicSdkStateStore(f.root).read(f.name)).toEqual(restored);
      expect(JSON.parse(await fs.readFile(f.markerFile, 'utf8')).revision).toBe(saved!.revision);
      expect(await f.raw.compareAndSwap(f.name, 1, { ...saved!, revision: 2 })).toBe(false);
      expect((await f.cli('next', f.name)).exitCode).toBe(0);
    },
  );

  it('restores Build with its completed Open, evidence and pending Action intact', async () => {
    const f = await fixture();
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(
        path.join(f.changeDir, file),
        file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
      );
    const action = f.run.actions[0];
    await f.runtime.claim({
      runId: f.name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'open-claim',
    });
    let run = await f.runtime.recordOutcome({
      runId: f.name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'open-claim',
        outcomeId: 'open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    run = await f.runtime.recordEvidence({
      runId: f.name,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...(await classicOpenEvidenceReceipt(f.root, 'openspec/changes/demo')),
      submissionId: 'open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'open-evidence', projectRoot: f.root },
    });
    expect(run.state).toMatchObject({ phase: 'build' });
    const saved = await f.checkpoint();
    await f.loseRun();
    expect(await createClassicSdkStateStore(f.root).read(f.name)).toEqual(saved);
    expect((await f.raw.read(f.name))!.actions.map((item) => item.id)).toEqual(
      run.actions.map((item) => item.id),
    );
    expect((await f.cli('next', f.name)).exitCode).toBe(0);
  });

  it.each([false, true])(
    'preserves user configuration during a legacy recovery with partial import=%s',
    async (partial) => {
      const f = await fixture();
      const document = parse(await fs.readFile(f.stateFile, 'utf8'));
      delete document.run_checkpoint.sourceRevision;
      delete document.run_checkpoint.sourceHash;
      document.review_mode = 'thorough';
      await fs.writeFile(f.stateFile, CLASSIC_MANAGED_RUN_MARKER + stringify(document));
      await f.loseRun();
      if (partial)
        await f.raw.compareAndSwap(f.name, null, {
          ...document.run_checkpoint.run,
          state: parseClassicStateDocument(document).classic,
        });
      const restored = await createClassicSdkStateStore(f.root).read(f.name);
      expect(restored!.revision).toBe(f.run.revision + 1);
      expect(restored!.state).toMatchObject({ reviewMode: 'thorough' });
      expect(restored!.actions).toEqual(document.run_checkpoint.run.actions);
      expect(await f.raw.compareAndSwap(f.name, 1, { ...restored!, revision: 2 })).toBe(false);
      expect(await createClassicSdkStateStore(f.root).read(f.name)).toEqual(restored);
    },
  );

  it('retries after publishing the Run and before completing projection', async () => {
    const f = await fixture();
    const saved = await f.checkpoint();
    await f.loseRun();
    await fs.rm(f.markerFile);
    const interrupted = createClassicSdkStateStore(f.root, {
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
    expect(await createClassicSdkStateStore(f.root).read(f.name)).toEqual(saved);
    expect(JSON.parse(await fs.readFile(f.markerFile, 'utf8')).revision).toBe(saved!.revision);
  });

  it.each([
    'checkpoint',
    'source-revision',
    'marker',
    'future-marker',
    'state',
    'branch',
    'partial',
  ])('rejects %s drift without replacing history or user files', async (damage) => {
    const f = await fixture();
    if (damage === 'branch')
      execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/other'], { cwd: f.root });
    else if (damage.includes('marker')) {
      const marker = JSON.parse(await fs.readFile(f.markerFile, 'utf8'));
      if (damage === 'future-marker') marker.revision += 1;
      else marker.state.language = 'en';
      await fs.writeFile(f.markerFile, JSON.stringify(marker));
    } else if (damage !== 'partial') {
      const document = parse(await fs.readFile(f.stateFile, 'utf8'));
      if (damage === 'checkpoint') document.run_checkpoint.hash = '0'.repeat(64);
      else if (damage === 'source-revision') document.run_checkpoint.sourceRevision += 20;
      else document.phase = 'build';
      await fs.writeFile(f.stateFile, CLASSIC_MANAGED_RUN_MARKER + stringify(document));
    }
    await f.loseRun();
    if (damage === 'partial')
      await f.raw.compareAndSwap(f.name, null, {
        ...(await f.checkpoint())!,
        revision: 1,
        state: { ...(f.run.state as object), phase: 'build' },
      });
    const before = await fs.readFile(f.stateFile, 'utf8');
    const original = await f.raw.read(f.name);
    await expect(createClassicSdkStateStore(f.root).read(f.name)).rejects.toThrow();
    expect(await f.raw.read(f.name)).toEqual(original);
    expect(await fs.readFile(f.stateFile, 'utf8')).toBe(before);
  });

  it('requires the original fixed application and preserves its custom checkpoint identity', async () => {
    const f = await fixture(true);
    const saved = await f.checkpoint();
    await f.loseRun();
    await expect(createClassicSdkStateStore(f.root).read(f.name)).rejects.toThrow(
      /original fixed Application/,
    );
    await expect(
      createClassicSdkStateStore(f.root, {
        identity: { ...f.identity!, contentHash: 'b'.repeat(64) },
      }).read(f.name),
    ).rejects.toThrow(/original fixed Application/);
    await expect(
      createClassicSdkStateStore(f.root, {
        identity: f.identity,
        store: { read: f.raw.read, compareAndSwap: f.raw.compareAndSwap },
      }).read(f.name),
    ).rejects.toThrow(/restoreCheckpoint support/);
    expect(await f.raw.read(f.name)).toBeNull();
    expect(await createClassicSdkStateStore(f.root, { identity: f.identity }).read(f.name)).toEqual(
      saved,
    );
  });
});
