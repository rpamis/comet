import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function preparedChange() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-sdk-read-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  const name = 'read-budget';
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
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, source.replace(/^language: en$/mu, 'language: zh-CN'));
    await expect(createNativeSdkStateStore(root).read(name)).rejects.toThrow(
      /differs from SDK Run/u,
    );
    await fs.writeFile(stateFile, `${source}\nlanguage: en\n`);
    await expect(createNativeSdkStateStore(root).read(name)).rejects.toThrow(/invalid YAML/u);
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
    expect(recovered?.revision).toBe(1);
    expect(recovered?.state).toEqual(before.run.state);
    expect(recovered?.waits).toEqual(before.run.waits);
    expect(await fs.readFile(stateFile, 'utf8')).toContain('run_checkpoint:');
    expect(JSON.parse(await fs.readFile(markerFile, 'utf8')).revision).toBe(1);
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
