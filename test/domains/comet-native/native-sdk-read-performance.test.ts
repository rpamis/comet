import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as yaml from 'yaml';

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
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { advanceNativeSdkChange } from '../../../domains/comet-native/native-sdk-next.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { nativeSdkCurrentCheckSummaries } from '../../../domains/comet-native/native-sdk-checks.js';
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

async function preparedChange(name = 'read-budget', existingRoot?: string) {
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
    '# Outcome\nResume the workflow.\n# Scope\nPreserve the workflow.\n# Non-goals\nNone.\n# Acceptance examples\n- The workflow resumes.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun focused checks.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe workflow resumes without losing confirmed work.\n',
  );
  const runtime = createNativeSdkRuntime(root);
  await runtime.start({
    runId: name,
    workflow: { id: 'comet-native', version: '1' },
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
  const prepared = await advanceNativeSdkChange(root, name);
  expect(prepared.exitCode).toBe(0);
  return {
    root,
    name,
    runtime,
    stateFile: path.join(changeDir, 'comet-state.yaml'),
    markerFile: path.join(root, '.comet/runtime/state-projections/native', `${name}.json`),
  };
}

describe('Native SDK read work budgets', () => {
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
    const { root, name, runtime } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: before.state.state_version,
      summary: 'Confirm this fixture Shape.',
    });
    const status = await inspectNativeSdkStatus({ projectRoot: root, name });
    const pending = status.pendingAction!;
    expect(pending).toMatchObject({ stepId: 'build.builder', type: 'handoff' });
    expect(status.continuation.commandArgs).toEqual([
      'comet',
      'runtime',
      'dispatch',
      '--application',
      'native',
      '--request',
      '<request-json-file>',
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
    expect(waiting.continuation.commandArgs).toEqual(['comet', 'native', 'status', name, '--json']);
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
    const unknown = await runtime.markUnknown({
      runId: name,
      actionId: pending.id,
      attempt: pending.attempt,
      reason: 'Fixture host lost the original execution result.',
    });
    const blocked = await advanceNativeSdkChange(root, name);
    expect(blocked.exitCode).toBe(0);
    expect(blocked.data).toMatchObject({
      phase: 'build',
      run: { revision: unknown.revision },
      continuation: { disposition: 'blocked', requiredInputs: ['original-execution-result'] },
      activeActions: [
        {
          id: pending.id,
          status: 'unknown',
          outcomeRequest: { outcome: { actionId: pending.id, claimToken: 'budget-builder-token' } },
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
  });

  it.each(['healthy', 'marker-mismatch', 'missing-marker', 'invalid-yaml'])(
    'keeps named and project SDK doctor consistent without writes (%s)',
    async (scenario) => {
      const { root, name, markerFile, stateFile } = await preparedChange();
      await preparedChange('healthy-peer', root);
      if (scenario === 'marker-mismatch') {
        const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
        marker.revision += 1;
        await fs.writeFile(markerFile, JSON.stringify(marker));
      } else if (scenario === 'missing-marker') {
        await fs.rm(markerFile);
      } else if (scenario === 'invalid-yaml') {
        await fs.appendFile(stateFile, '\nphase: unknown-phase\n');
      }
      const snapshot = async () => {
        const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
        return Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
              const file = path.join(entry.parentPath, entry.name);
              const stat = await fs.stat(file);
              return [file, stat.mtimeMs, (await fs.readFile(file)).toString('base64')];
            }),
        );
      };
      const before = await snapshot();
      const named = await nativeDoctorCommand([name], root);
      const project = await nativeDoctorCommand([], root);
      expect(named.exitCode).toBe(scenario === 'healthy' ? 0 : 65);
      const data = project.data as {
        changes: Array<{ change: string; healthy: boolean }>;
        findings: Array<{ code: string }>;
      };
      expect(data.changes.find((change) => change.change === name)?.healthy).toBe(
        scenario === 'healthy',
      );
      expect(data.changes.find((change) => change.change === 'healthy-peer')?.healthy).toBe(true);
      if (scenario !== 'healthy') {
        expect(project.exitCode).toBe(65);
        expect(data.findings.some((finding) => finding.code === 'sdk-run-invalid')).toBe(true);
      }
      expect(await snapshot()).toEqual(before);
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

  it('reads a stable next state once and leaves its projection files untouched', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    const timestamp = new Date('2020-01-01T00:00:00.000Z');
    await fs.utimes(stateFile, timestamp, timestamp);
    await fs.utimes(markerFile, timestamp, timestamp);
    const reads = vi.spyOn(fs, 'readFile');
    const renames = vi.spyOn(fs, 'rename');
    const result = await advanceNativeSdkChange(root, name);
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      stateVersion: before.state.state_version,
      run: { revision: before.run.revision },
    });
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
    expect((await fs.stat(stateFile)).mtimeMs).toBe(timestamp.getTime());
    expect((await fs.stat(markerFile)).mtimeMs).toBe(timestamp.getTime());
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
    const reads = vi.spyOn(fs, 'readFile');
    const renames = vi.spyOn(fs, 'rename');
    const pending = await advanceNativeSdkChange(root, name);
    expect(pending.data).toEqual(result.data);
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    expect(renames.mock.calls.filter(([, target]) => String(target) === markerFile)).toHaveLength(
      0,
    );
  });

  it('still detects external state edits and duplicate YAML keys on every read', async () => {
    const { root, name, stateFile } = await preparedChange();
    const store = createNativeSdkStateStore(root);
    await store.read(name);
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace(/^language: en$/mu, 'language: zh-CN'));
    await expect(store.read(name)).rejects.toThrow(/differs from SDK Run/u);
    await fs.writeFile(stateFile, `${source}\nlanguage: en\n`);
    await expect(store.read(name)).rejects.toThrow(/invalid YAML/u);
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

  it('reuses only byte-identical parsed state inside one store while rereading every file', async () => {
    const { root, name, stateFile } = await preparedChange();
    const store = createNativeSdkStateStore(root);
    const parse = vi.mocked(yaml.parseDocument);
    const reads = vi.spyOn(fs, 'readFile');
    parse.mockClear();
    const first = await store.read(name);
    const source = await fs.readFile(stateFile, 'utf8');
    const yamlPrefix = source.slice(0, source.lastIndexOf('\nrun_checkpoint: ') + 1);
    const projectionParses = () => parse.mock.calls.filter(([text]) => text === yamlPrefix).length;
    expect(parse.mock.calls.some(([text]) => text === source)).toBe(false);
    expect(projectionParses()).toBe(1);
    const original = structuredClone(first!);
    (first!.state as { language: string }).language = 'zh-CN';
    reads.mockClear();
    expect(await store.read(name)).toEqual(original);
    expect(projectionParses()).toBe(1);
    expect(reads.mock.calls.filter(([file]) => String(file) === stateFile)).toHaveLength(1);
    await createNativeSdkStateStore(root).read(name);
    expect(projectionParses()).toBe(2);
  });

  it('enumerates SDK owners once when discovering an otherwise unconfigured workspace', async () => {
    const { root, name } = await preparedChange();
    await fs.rm(path.join(root, '.comet/config.yaml'));
    const reads = vi.spyOn(fs, 'readdir');
    const page = await listDiscoveredNativeStatusPage({ projectRoot: root });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ schema: 'comet.native.sdk-status.v1', name });
    const owners = path.join(root, '.comet/runtime/change-owners/native');
    expect(reads.mock.calls.filter(([file]) => String(file) === owners)).toHaveLength(1);
  });

  it('repairs a missing projection marker and recovers a lost Run from its checkpoint', async () => {
    const { root, name, stateFile, markerFile } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await fs.rm(markerFile);
    const restoredMarker = await createNativeSdkStateStore(root).read(name);
    expect(restoredMarker?.revision).toBe(before.run.revision);
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(before.run.revision);
    await fs.rm(path.join(root, '.comet/runtime/sdk-runs/native'), { recursive: true });
    await fs.rm(markerFile);
    const recovered = await createNativeSdkStateStore(root).read(name);
    expect(recovered?.revision).toBe(before.run.revision);
    expect(recovered?.state).toEqual(before.run.state);
    expect(recovered?.waits).toEqual(before.run.waits);
    expect(await fs.readFile(stateFile, 'utf8')).toContain('run_checkpoint:');
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(before.run.revision);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects an equal-content projection marker replaced by a symlink',
    async () => {
      const { root, name, markerFile } = await preparedChange();
      const target = path.join(root, 'copied-marker.json');
      const source = await fs.readFile(markerFile, 'utf8');
      await fs.writeFile(target, source);
      await fs.rm(markerFile);
      await fs.symlink(target, markerFile);
      await expect(createNativeSdkStateStore(root).read(name)).rejects.toThrow(/symbolic link/u);
      expect(await fs.readFile(target, 'utf8')).toBe(source);
    },
  );

  it('reads each check log only at commit, then rechecks its bytes at the next evidence boundary', async () => {
    const { root, name, runtime } = await preparedChange();
    const before = await inspectNativeSdkRun(root, name);
    await advanceNativeSdkChange(root, name, {
      expectedAction: 'confirm-shape',
      expectedStateVersion: before.state.state_version,
      summary: 'Confirm this fixture Shape.',
    });
    let run = await runtime.inspect(name);
    const builder = run.actions.at(-1)!;
    const context = { requestId: 'read-budget-builder', projectRoot: root };
    run = await runtime.claim({
      runId: name,
      actionId: builder.id,
      attempt: builder.attempt,
      inputHash: builder.inputHash,
      executorId: 'native-host',
      sessionId: 'read-budget-builder-session',
      claimToken: 'read-budget-builder-claim',
      context,
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: builder.id,
        attempt: builder.attempt,
        inputHash: builder.inputHash,
        claimToken: run.actions.at(-1)!.claim!.token,
        outcomeId: 'read-budget-builder-output',
        status: 'succeeded',
        output: {
          summary: 'Implemented this fixture workflow.',
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [],
          review: null,
          submittedAt: '2026-10-06T00:00:00.000Z',
          verificationChecks: [
            {
              id: 'log-budget',
              name: 'Large log check',
              executable: process.execPath,
              argv: ['-e', 'process.stdout.write("x".repeat(256 * 1024))'],
              cwdRef: '.',
              timeoutMs: 10_000,
              repeatable: true,
            },
          ],
        },
      },
      context,
    });
    const opens = vi.spyOn(fs, 'open');
    run = await runtime.execute({
      runId: name,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-native-checks',
      context: { requestId: 'read-budget-checks', projectRoot: root },
    });
    const output = run.outputs['verify.checks'].value as { checks: Array<{ logRef: string }> };
    const logFile = path.join(root, output.checks[0].logRef);
    expect(opens.mock.calls.filter(([file]) => String(file) === logFile)).toHaveLength(1);
    expect((await fs.stat(logFile)).size).toBe(256 * 1024);
    await fs.appendFile(logFile, 'changed after execution');
    await expect(nativeSdkCurrentCheckSummaries({ run, projectRoot: root })).rejects.toThrow(
      /log changed after execution/u,
    );
  });
});
