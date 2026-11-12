import { spawnSync } from 'node:child_process';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import { runWithHookReadCache } from '../../../platform/process/hook-read-cache.js';
import * as runtimeRoots from '../../../domains/workflow-contract/workspace-runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as yaml from 'yaml';
import { createFileRuntimeStore, type WorkflowRun } from '../../../domains/engine/runtime.js';
import * as portableCheckpoints from '../../../domains/engine/portable-run-checkpoint.js';
import * as fileLocks from '../../../platform/fs/recoverable-file-lock.js';

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
  createNativeSdkRuntime,
  loadOwnedNativeSdkRuntime,
  inspectNativeSdkRun,
  registerNativeSdkRequestInput,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { advanceNativeSdkChange } from '../../../domains/comet-native/native-sdk-next.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { listDiscoveredNativeStatusPage } from '../../../domains/comet-native/native-status-discovery.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import * as sdkApplication from '../../../domains/comet-native/native-sdk-application.js';
import {
  inspectNativeSdkStatus,
  projectNativeSdkStatus,
} from '../../../domains/comet-native/native-sdk-status.js';
import { nativeShowCommand } from '../../../domains/comet-native/native-show-command.js';
import { nativeStatusCommand } from '../../../domains/comet-native/native-status-command.js';
import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { render } from '../../../domains/comet-native/native-cli-shared.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

vi.mock('yaml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yaml')>();
  return { ...actual, parseDocument: vi.fn(actual.parseDocument) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function preparedChange(name = 'read-budget', existingRoot?: string, version: '4' = '4') {
  const root = existingRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-sdk-read-')));
  if (!existingRoot) roots.push(root);
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, name);
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nResume the workflow.\n# Scope\nPreserve the workflow.\n## Directory structure\n### Modified\n- src/ — preserve workflow recovery behavior.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe workflow resumes without losing confirmed work.\n',
  );
  const runtime = createNativeSdkRuntime(root);
  await runtime.start({
    runId: name,
    workflow: { id: 'comet-native', version },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
      createdAt: '2026-10-06T00:00:00.000Z',
      nextAction: 'prepare-shape-confirmation',
    }),
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: name,
    format: 'sdk',
    application: 'native',
    runId: name,
  });
  const started = await runtime.inspect(name);
  const shape = started.actions[0];
  const token = 'fixture-shape-' + name;
  const context = { requestId: token, projectRoot: root };
  await runtime.claim({
    runId: name,
    actionId: shape.id,
    attempt: shape.attempt,
    inputHash: shape.inputHash,
    executorId: 'SIMULATED-shaper',
    sessionId: token,
    claimToken: token,
    context,
  });
  await runtime.recordOutcome({
    runId: name,
    outcome: {
      actionId: shape.id,
      attempt: shape.attempt,
      inputHash: shape.inputHash,
      claimToken: token,
      outcomeId: token,
      status: 'succeeded',
      output: await sdkApplication.collectNativeSdkShapeProposal({
        paths,
        state: started.state as NativePortableState,
      }),
    },
    context,
  });
  const prepared = await advanceNativeSdkChange(root, name);
  expect(prepared.exitCode).toBe(0);
  return {
    root,
    name,
    runtime,
    prepared: prepared.data as Awaited<ReturnType<typeof inspectNativeSdkStatus>>,
    stateFile: path.join(changeDir, 'comet-state.yaml'),
    markerFile: path.join(
      resolveWorkspaceRuntimeRootSync(root),
      'state-projections/native',
      `${name}.json`,
    ),
  };
}

describe('Native SDK read work budgets', () => {
  it('uses its captured Runtime namespace without repeated workspace identity reconciliation', async () => {
    const { root, name } = await preparedChange('prepared-runtime', undefined, '4');
    const resolve = vi.spyOn(runtimeRoots, 'resolveWorkspaceRuntimeRoot');
    const store = createNativeSdkStateStore(root);
    await store.read(name);
    await store.read(name);
    expect(resolve).not.toHaveBeenCalled();
    const expected = await store.read(name);
    const original = process.env.COMET_DATA_DIR;
    try {
      process.env.COMET_DATA_DIR = path.join(os.tmpdir(), 'different-native-data');
      expect(await store.read(name)).toEqual(expected);
    } finally {
      if (original === undefined) delete process.env.COMET_DATA_DIR;
      else process.env.COMET_DATA_DIR = original;
    }
  });
  it('commits a current Shape once and keeps its user approval reachable', async () => {
    const { root, name } = await preparedChange('single-shape', undefined, '4');
    const { run } = await inspectNativeSdkRun(root, name);
    expect(run.revision).toBe(3);
    expect(run.actions[0]).toMatchObject({ stepId: 'shape.prepare', status: 'succeeded' });
    expect(run.waits.find((wait) => wait.status === 'pending')?.stepId).toBe('shape.confirm');
  });

  it('validates outside request bytes without a writable resolver or registration lock', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-external-request-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    const file = path.join(root, 'result.json');
    await fs.writeFile(file, '{"status":"succeeded"}');
    const locks = vi.spyOn(fileLocks, 'withRecoverableFileLock');
    const validation = vi.fn((source: string) => {
      expect(JSON.parse(source)).toEqual({ status: 'succeeded' });
    });
    await registerNativeSdkRequestInput({
      projectRoot,
      file,
      artifactRootRef: 'docs',
      runId: 'external',
      validateContent: validation,
    });
    expect(validation).toHaveBeenCalledTimes(1);
    expect(locks).not.toHaveBeenCalled();
    expect(await fs.readdir(projectRoot)).toEqual([]);
    await fs.writeFile(file, 'invalid');
    await expect(
      registerNativeSdkRequestInput({
        projectRoot,
        file,
        artifactRootRef: 'docs',
        runId: 'external',
        validateContent: validation,
      }),
    ).rejects.toThrow();
    expect(await fs.readdir(projectRoot)).toEqual([]);
  });

  it('uses the committed v3 Run without reading the authority again at a non-boundary', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-nonboundary-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    expect(
      (await runNativeCli(['new', 'nonboundary', '--project-root', root, '--json'])).exitCode,
    ).toBe(0);
    const runtime = createNativeSdkRuntime(root);
    const before = await runtime.inspect('nonboundary');
    const action = before.actions[0];
    const claimed = await runtime.claim({
      runId: before.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'shape-observer',
      claimToken: 'shape-token',
    });
    const read = vi.fn(async () => claimed);
    const compareAndSwap = vi.fn(async () => true);
    const store = createNativeSdkStateStore(root, { store: { read, compareAndSwap } });
    expect(await store.compareAndSwap(claimed.runId, claimed.revision - 1, claimed)).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(compareAndSwap).toHaveBeenCalledTimes(1);
  });
  it('reads SDK authority without a writer lock or a third projection file', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await fs.readFile(stateFile, 'utf8');
    const locks = vi.spyOn(fileLocks, 'withRecoverableFileLock');
    const store = createNativeSdkStateStore(root, { readOnly: true });
    const run = await store.read(name);
    expect(await store.read(name)).toEqual(run);
    expect(locks).not.toHaveBeenCalled();
    await expect(fs.access(markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it('shares one builtin definition per read scope while keeping independent Run state', async () => {
    const { root, name } = await preparedChange();
    const peer = await preparedChange('independent-peer', root);
    const definitions = vi.spyOn(sdkApplication, 'defineNativeWorkflowApplication');
    await runWithHookReadCache(async () => {
      const first = await loadOwnedNativeSdkRuntime(root, name, { readOnly: true });
      const second = await loadOwnedNativeSdkRuntime(root, peer.name, { readOnly: true });
      expect(definitions).toHaveBeenCalledTimes(1);
      expect(first.executors).toBe(second.executors);
      const a = await first.runtime.inspect(name),
        b = await second.runtime.inspect(peer.name);
      expect(a.runId).toBe(name);
      expect(b.runId).toBe(peer.name);
      expect(a.state).not.toBe(b.state);
    });
    await runWithHookReadCache(() => inspectNativeSdkRun(root, name, { readOnly: true }));
    expect(definitions).toHaveBeenCalledTimes(2);
  });

  it('returns the first executable continuation when creating an SDK change', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-new-contract-'));
    roots.push(root);
    await fs.mkdir(path.join(root, '.git'));
    const result = await runNativeCli([
      'new',
      'warm-start',
      '--runtime',
      'sdk',
      '--project-root',
      root,
      '--json',
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const response = JSON.parse(result.stdout!);
    expect(response.data).toMatchObject({
      schema: 'comet.native.v4',
      runtimeFormat: 'sdk',
      acceptance: [],
      blockers: [],
      workspace: { isolation: 'current', change_branch: null, target_branch: null },
      run: { id: 'warm-start', revision: expect.any(Number) },
      continuation: {
        mode: 'execute',
        action: 'prepare-shape-confirmation',
        cwd: root,
        commandArgs: expect.arrayContaining(['--project-root', root]),
      },
      pendingAction: { stepId: 'shape.prepare' },
      pendingActions: [{ stepId: 'shape.prepare' }],
    });
    expect(response.data.pendingAction).not.toHaveProperty('inputRef');
    expect(response.data.pendingActions[0]).not.toHaveProperty('input');
    expect(response.agent.continuation).toMatchObject(response.data.continuation);
  });

  it('returns the current proposal and executable decision templates with a stale mutation response', async () => {
    const { root, name, prepared } = await preparedChange();
    const rejected = await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: prepared.stateVersion - 1,
      summary: 'This approval used a stale response.',
    });
    expect(rejected).toMatchObject({ exitCode: 73, error: { code: 'conflict' } });
    const current = rejected.data as typeof prepared;
    expect(current.run.revision).toBe(prepared.run.revision);
    expect(current.continuation).toEqual(prepared.continuation);
    expect(current.continuation.mode).toBe('ask');
    expect(current.pendingWaits![0]).toMatchObject({
      proposal: expect.any(Object),
      commandArgs: expect.arrayContaining(['--project-root', root]),
      decisionRequests: [
        {
          operation: 'resolve-wait',
          runId: name,
          expectedRevision: prepared.run.revision,
          waitId: prepared.pendingWaits![0].id,
          proposalHash: prepared.pendingWaits![0].proposalHash,
          choice: 'approved',
        },
        { choice: 'rejected' },
      ],
    });
  });

  it('loads one definition and returns the same guarded Shape decision from status, next, and show', async () => {
    const { root, name } = await preparedChange();
    const definitions = vi.spyOn(sdkApplication, 'defineNativeWorkflowApplication');
    const status = await inspectNativeSdkStatus({ projectRoot: root, name });
    expect(definitions).toHaveBeenCalledTimes(1);
    definitions.mockClear();
    const next = await advanceNativeSdkChange(root, name);
    expect(definitions).toHaveBeenCalledTimes(1);
    const show = await nativeShowCommand([name], root);
    expect((next.data as typeof status).continuation).toEqual(status.continuation);
    expect((show.data as typeof status).continuation).toEqual(status.continuation);
    expect(status.continuation.commandAlternatives?.[0]).toMatchObject({
      expectedAction: 'confirm-shape',
      stateVersion: status.stateVersion,
    });
    const output = render(await nativeStatusCommand([name], root), false);
    expect(output.stdout).toContain('NEXT:');
    expect(output.stdout).toContain('RELAY TO USER:');
  });

  it('provides a directly claimable Builder template without another inspect or compat runner input', async () => {
    const { root, name, runtime, prepared } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: before.state.state_version,
      summary: 'Confirm this fixture Shape.',
    });
    const status = await inspectNativeSdkStatus({ projectRoot: root, name });
    const pending = status.pendingAction!;
    expect(pending).toMatchObject({
      stepId: 'build.builder',
      type: 'handoff',
      inputRef: 'pendingActions[0].input',
    });
    expect(status.pendingActions![0].input).toEqual(
      (await inspectNativeSdkRun(root, name)).run.actions.find(
        (action) => action.id === pending.id,
      )!.input,
    );
    expect(status.continuation).toMatchObject({ mode: 'execute', cwd: root });
    expect(status.pendingActions![0]).toMatchObject({
      contextRequest: { phase: 'build', contextMode: 'snapshot' },
    });
    expect(status.pendingActions![0].contextRequest.commandArgs).toContain(root);
    expect(status.continuation.commandArgs).toEqual([
      'comet',
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--request',
      '<request-json-file>',
      '--project-root',
      root,
      '--json',
    ]);
    const request = pending.claimRequest!;
    expect(status.continuation.inputOptions[0].template).toEqual(request);
    const { operation, ...claim } = request;
    expect(operation).toBe('claim');
    const claimed = await runtime.claim({
      ...claim,
      sessionId: 'budget-builder-session',
      claimToken: 'budget-builder-token',
      context: { requestId: 'budget-builder-claim', projectRoot: root },
    });
    expect(claimed.actions.find((action) => action.id === pending.id)?.status).toBe('running');
    const waiting = await inspectNativeSdkStatus({ projectRoot: root, name });
    expect(waiting.activeActions![0].contextRequest?.commandArgs).toContain(
      'budget-builder-session',
    );
    expect(waiting.activeActions![0].resultRequest!.result.output).toMatchObject({
      summary: expect.any(String),
      addressedAcceptanceIds: before.state.acceptance.map(({ id }) => id),
      checks: expect.any(Array),
      requireIndependentReview: false,
    });
    expect(
      JSON.parse(
        Buffer.from(waiting.activeActions![0].resultRequest!.receipt, 'base64url').toString('utf8'),
      ),
    ).toEqual({
      runId: name,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      claimToken: 'budget-builder-token',
    });
    expect(waiting.continuation).toMatchObject({ mode: 'wait', commandArgs: null, cwd: root });
    expect(waiting.activeActions![0].input).toEqual(
      claimed.actions.find((action) => action.id === pending.id)!.input,
    );
    expect(waiting.pendingAction).toBeUndefined();
    expect(waiting.continuation.userCommunication.agentInstruction).toContain(
      'original claimed task',
    );
    const continued = await advanceNativeSdkChange(root, name);
    expect(continued.exitCode).toBe(0);
    expect(continued.data).toMatchObject({
      phase: 'build',
      stateVersion: waiting.stateVersion,
      workspace: waiting.workspace,
      run: { revision: claimed.revision },
      continuation: waiting.continuation,
      activeActions: [
        { id: pending.id, status: 'running', claim: { token: 'budget-builder-token' } },
      ],
    });
    expect(await runtime.inspect(name)).toEqual(claimed);
    const markUnknown = {
      runId: name,
      expectedRevision: claimed.revision,
      actionId: pending.id,
      attempt: pending.attempt,
    };
    const unknown = await runtime.markUnknown({
      ...markUnknown,
      reason: 'Fixture host lost the original execution result.',
    });
    const blocked = await advanceNativeSdkChange(root, name);
    expect(blocked.exitCode).toBe(0);
    expect(blocked.data).toMatchObject({
      phase: 'build',
      run: { revision: unknown.revision },
      continuation: {
        mode: 'reconcile',
        commandArgs: null,
        disposition: 'blocked',
        requiredInputs: ['original-execution-result'],
      },
      activeActions: [
        {
          id: pending.id,
          status: 'unknown',
          resultRequest: { operation: 'record-outcome', receipt: expect.any(String) },
        },
      ],
    });
    expect(await runtime.inspect(name)).toEqual(unknown);
    await expect(
      runtime.claim({
        ...claim,
        sessionId: 'second-session',
        claimToken: 'second-token',
        context: { requestId: 'stale-claim', projectRoot: root },
      }),
    ).rejects.toThrow();
    const blockedView = blocked.data as typeof waiting;
    const { operation: retryOperation, ...retry } = blockedView.activeActions![0].retryRequest!;
    expect(retryOperation).toBe('retry');
    await expect(runtime.retry(retry)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    const retried = await runtime.retry({
      ...retry,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { host: 'Fixture only claimed; no work was started.' },
      },
    });
    expect(retried.actions.find((action) => action.id === pending.id)).toMatchObject({
      status: 'pending',
      attempt: pending.attempt + 1,
    });
  });

  it.each(['healthy', 'invalid-authority'] as const)(
    'inspects a named SDK Run without repairing it (%s)',
    async (scenario) => {
      const { root, name, stateFile } = await preparedChange();
      const raw = createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
      });
      const run = (await raw.read(name))!;
      if (scenario === 'invalid-authority')
        expect(
          await raw.compareAndSwap(name, run.revision, {
            ...run,
            revision: run.revision + 1,
            workflow: { ...run.workflow, id: 'foreign-workflow' },
          }),
        ).toBe(true);
      const before = await raw.read(name),
        portable = await fs.readFile(stateFile, 'utf8');
      const result = await runNativeCli(['doctor', name, '--project-root', root, '--json']);
      if (scenario === 'healthy') expect(result.exitCode, result.stdout).toBe(0);
      else expect(result.exitCode).not.toBe(0);
      expect(await raw.read(name)).toEqual(before);
      expect(await fs.readFile(stateFile, 'utf8')).toBe(portable);
    },
  );

  it('bounds settled history without hiding older unfinished work and exposes complete details', async () => {
    const { root, name } = await preparedChange();
    const inspection = await inspectNativeSdkRun(root, name);
    const action = inspection.run.actions[0];
    const wait = inspection.run.waits[0];
    // 只测试投影，不把构造的历史写入 Runtime 或伪造状态推进。
    const run = {
      ...inspection.run,
      actions: [
        { ...action, id: 'older-running', status: 'running' as const },
        ...Array.from({ length: 1000 }, (_, index) => ({ ...action, id: `settled-${index}` })),
      ],
      waits: [
        wait,
        ...Array.from({ length: 1000 }, (_, index) => ({
          ...wait,
          id: `resolved-${index}`,
          status: 'resolved' as const,
        })),
      ],
    };
    const compact = await projectNativeSdkStatus(
      { projectRoot: root, name },
      { ...inspection, run },
    );
    const details = await projectNativeSdkStatus(
      { projectRoot: root, name, details: true },
      { ...inspection, run },
    );
    expect(compact.run.actions).toHaveLength(13);
    expect(compact.run.waits).toHaveLength(13);
    expect(compact.run.actions[0].id).toBe('older-running');
    expect(compact.run.waits[0].id).toBe(wait.id);
    expect(compact.run.history).toMatchObject({
      actions: { total: 1001, omitted: 988 },
      waits: { total: 1001, omitted: 988 },
    });
    expect(details.run.actions).toHaveLength(1001);
    expect(details.run.waits).toHaveLength(1001);
    expect(details.run.history.actions.omitted).toBe(0);
    expect(details.details?.state).toEqual(inspection.state);
    expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(details)) / 10,
    );
  });

  it('rejects unsupported Archive arguments before inspecting or advancing an SDK Run', async () => {
    const { root, name } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await expect(nativeArchiveCommand([name, '--unknown-option'], root)).rejects.toThrow(
      'Unexpected argument',
    );
    expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(before.run.revision);
  });

  it('reads a stable next state without opening or rewriting portable checkpoints', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    const original = await fs.readFile(stateFile, 'utf8'),
      timestamp = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(stateFile, timestamp, timestamp);
    const reads = vi.spyOn(fs, 'open');
    const result = await advanceNativeSdkChange(root, name);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      stateVersion: before.state.state_version,
      run: { revision: before.run.revision },
    });
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(0);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(original);
    expect((await fs.stat(stateFile)).mtimeMs).toBe(timestamp.getTime());
    await expect(fs.access(markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('projects the just-committed confirmation result without losing the pending Builder', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    const result = await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: before.state.state_version,
      summary: 'Confirm this fixture Shape.',
    });
    expect(result.exitCode).toBe(0);
    const committed = await inspectNativeSdkRun(root, name);
    expect(result.data).toMatchObject({
      phase: 'build',
      stateVersion: committed.state.state_version,
      run: { revision: committed.run.revision },
      pendingAction: { stepId: 'build.builder' },
    });
    const reads = vi.spyOn(fs, 'open');
    const renames = vi.spyOn(fs, 'rename');
    const pending = await advanceNativeSdkChange(root, name);
    expect(pending.data).toEqual(result.data);
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(0);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
  });

  it('rejects duplicate YAML in a recovery checkpoint without publishing Run authority', async () => {
    const { root, name, stateFile } = await preparedChange();
    const original = await fs.readFile(stateFile, 'utf8');
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'), {
      recursive: true,
    });
    const invalid = original + '\nlanguage: en\n';
    await fs.writeFile(stateFile, invalid);
    const result = await runNativeCli([
      'doctor',
      name,
      '--repair',
      '--project-root',
      root,
      '--json',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(
      await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
      }).read(name),
    ).toBeNull();
    expect(await fs.readFile(stateFile, 'utf8')).toBe(invalid);
  });

  it('reads legacy full-YAML checkpoints without rewriting or requiring recovery', async () => {
    const { root, name, stateFile } = await preparedChange();
    const expected = await createNativeSdkStateStore(root).read(name);
    const document = yaml.parse(await fs.readFile(stateFile, 'utf8'));
    const legacy = '# comet-execution: managed-run\n' + yaml.stringify(document);
    await fs.writeFile(stateFile, legacy);
    const timestamp = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(stateFile, timestamp, timestamp);
    expect(await createNativeSdkStateStore(root, { readOnly: true }).read(name)).toEqual(expected);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(legacy);
    expect((await fs.stat(stateFile)).mtimeMs).toBe(timestamp.getTime());
  });

  it('leaves receipt-bearing checkpoints untouched while reading SDK authority', async () => {
    const { root, name, stateFile } = await preparedChange();
    const expected = await createNativeSdkStateStore(root, { readOnly: true }).read(name);
    const source = await fs.readFile(stateFile, 'utf8');
    const withReceipt = source.replace(
      '\nrun_checkpoint: ',
      '\narchive_receipt: { pending: true }\nrun_checkpoint: ',
    );
    await fs.writeFile(stateFile, withReceipt);
    const parse = vi.mocked(yaml.parseDocument);
    parse.mockClear();
    expect(await createNativeSdkStateStore(root, { readOnly: true }).read(name)).toEqual(expected);
    expect(parse.mock.calls.some(([text]) => String(text).includes('archive_receipt:'))).toBe(
      false,
    );
    expect(await fs.readFile(stateFile, 'utf8')).toBe(withReceipt);
  });

  it.skipIf(process.platform === 'win32').for([true, false])(
    'reads authority without following a portable state symlink (readOnly=%s)',
    async (readOnly) => {
      const { root, name, stateFile } = await preparedChange();
      const source = await fs.readFile(stateFile, 'utf8');
      const target = path.join(root, 'copied-state.yaml');
      await fs.writeFile(target, source);
      await fs.rm(stateFile);
      await fs.symlink(target, stateFile);
      expect(await createNativeSdkStateStore(root, { readOnly }).read(name)).not.toBeNull();
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    },
  );

  it.for([true, false])(
    'does not open portable state while reading SDK authority (readOnly=%s)',
    async (readOnly) => {
      const { root, name, stateFile } = await preparedChange();
      const source = await fs.readFile(stateFile, 'utf8');
      const open = fs.open.bind(fs);
      let replaced = false;
      vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const handle = await open(...args);
        if (!replaced && String(args[0]) === stateFile) {
          replaced = true;
          await fs.rename(stateFile, stateFile + '.original');
          await fs.writeFile(stateFile, source);
        }
        return handle;
      });
      expect(await createNativeSdkStateStore(root, { readOnly }).read(name)).not.toBeNull();
      expect(replaced).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32').for(['active', 'archive'] as const)(
    'refuses recovery through an external %s portable-state symlink',
    async (location) => {
      const { root, name, stateFile } = await preparedChange();
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'native-external-checkpoint-'));
      roots.push(outside);
      const source = await fs.readFile(stateFile, 'utf8');
      const target = path.join(outside, 'checkpoint.yaml');
      await fs.writeFile(target, source);
      await fs.rm(stateFile);
      let link = stateFile;
      if (location === 'archive') {
        link = path.join(root, 'docs/comet/archive', '2026-10-18-' + name, 'comet-state.yaml');
        await fs.mkdir(path.dirname(link), { recursive: true });
      }
      await fs.symlink(target, link);
      const runtimeDir = path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native');
      await fs.rm(runtimeDir, { recursive: true, force: true });
      for (const readOnly of [true, false]) {
        await expect(createNativeSdkStateStore(root, { readOnly }).read(name)).rejects.toThrow(
          /regular file/u,
        );
      }
      // Failed recovery must not publish the checkpoint as a new authority.
      const { createFileRuntimeStore } = await import('../../../domains/engine/runtime.js');
      expect(await createFileRuntimeStore({ rootDir: runtimeDir }).read(name)).toBeNull();
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    },
  );

  it('enumerates SDK owners once when discovering an otherwise unconfigured workspace', async () => {
    const { root, name } = await preparedChange();
    await fs.rm(path.join(root, '.comet/config.yaml'));
    const reads = vi.spyOn(fs, 'readdir');
    const page = await listDiscoveredNativeStatusPage({ projectRoot: root });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ schema: 'comet.native.sdk-status.v1', name });
    const owners = path.join(resolveWorkspaceRuntimeRootSync(root), 'change-owners/native');
    expect(reads.mock.calls.filter(([file]) => String(file) === owners)).toHaveLength(1);
  });

  it('explicitly restores a lost Run from its checkpoint without creating a projection marker', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'), {
      recursive: true,
    });
    await expect(createNativeSdkStateStore(root, { readOnly: true }).read(name)).rejects.toThrow(
      /checkpoint recovery/,
    );
    const repaired = await runNativeCli([
      'doctor',
      name,
      '--repair',
      '--confirmed',
      '--project-root',
      root,
      '--json',
    ]);
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    const restored = await createNativeSdkStateStore(root, { readOnly: true }).read(name);
    expect(restored?.revision).toBe(before.run.revision);
    expect(restored?.state).toEqual(before.run.state);
    expect(restored?.waits).toEqual(before.run.waits);
    expect(await fs.readFile(stateFile, 'utf8')).toContain('run_checkpoint:');
    await expect(fs.access(markerFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps platform logs outside normal responses and preserves the actual check report after log edits', async () => {
    const { root, name, runtime } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: before.state.state_version,
      summary: 'SIMULATED user approves this fixture Shape.',
    });
    let run = await runtime.inspect(name);
    const builder = run.actions.at(-1)!;
    const context = { requestId: 'platform-report', projectRoot: root },
      token = 'platform-builder-claim';
    run = await runtime.claim({
      runId: name,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'SIMULATED-Agent',
      sessionId: 'platform-builder',
      claimToken: token,
      context,
    });
    const result = spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(256*1024))'],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    expect(result.status).toBe(0);
    const log = path.join(root, '.platform-check.log');
    await fs.writeFile(log, result.stdout);
    const checks = [
      {
        name: 'Actual large-output platform check',
        result: 'passed',
        note: 'Actual Node exit 0; read full log at ' + log,
      },
    ];
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: token,
        outcomeId: 'platform-builder-result',
        status: 'succeeded',
        output: {
          summary: 'SIMULATED fixture implementation.',
          addressedAcceptanceIds: ['A1'],
          checks,
          knownLimits: ['No model or product evaluation.'],
        },
      },
      context,
    });
    const opens = vi.spyOn(fs, 'open');
    const task = await runNativeCli([
      'next',
      name,
      '--session',
      'platform-verifier',
      '--project-root',
      root,
      '--json',
    ]);
    expect(task.exitCode, task.stdout).toBe(0);
    expect(JSON.parse(task.stdout!).data.task).toMatchObject({ role: 'verify', status: 'running' });
    expect(Buffer.byteLength(task.stdout!)).toBeLessThan(16384);
    expect(task.stdout).not.toContain('x'.repeat(1000));
    const status = await inspectNativeSdkStatus({ projectRoot: root, name });
    const text = JSON.stringify(status);
    expect(Buffer.byteLength(text)).toBeLessThan(32768);
    expect(text).not.toContain('x'.repeat(1000));
    expect(opens.mock.calls.filter(([file]) => String(file) === log)).toHaveLength(0);
    await fs.appendFile(log, 'changed after execution');
    expect(
      (await runtime.inspect(name)).actions.find((action) => action.id === builder.id)?.outcome,
    ).toEqual(run.actions.find((action) => action.id === builder.id)?.outcome);
    expect((await inspectNativeSdkRun(root, name)).state.builder_handoff!.checks[0]).toMatchObject({
      result: 'passed',
    });
  });
});
