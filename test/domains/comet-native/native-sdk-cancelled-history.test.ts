import { closeNativeSdkHistory } from '../../../domains/comet-native/native-sdk-history.js';
import { createNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(linked = false, kind: 'current' | 'published-052' = 'current') {
  const integration = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancelled-history-'));
  roots.push(integration);
  const git = (args: string[]) => execFileSync('git', args, { cwd: integration, stdio: 'ignore' });
  git(['init', '-b', 'main']);
  let root = integration;
  if (linked) {
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ]);
    root = path.join(integration, 'linked');
    git(['worktree', 'add', '-b', 'linked', root]);
  }
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  if (kind === 'published-052') {
    const frozen = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-cancelled-portable-history/cancelled.json'),
        'utf8',
      ),
    ) as { run: WorkflowRun; projectMaterials: Array<{ ref: string; bytesBase64: string }> };
    for (const material of frozen.projectMaterials) {
      // The old local Runtime path marker is not business material or a portable store location.
      if (material.ref === '.comet/runtime') continue;
      const file = path.join(root, material.ref);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.from(material.bytesBase64, 'base64'));
    }
    const name = frozen.run.runId,
      documents = path.join(root, 'docs/comet/changes', name);
    const raw = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
    });
    await raw.restoreCheckpoint!(name, null, frozen.run);
    await registerSdkChangeOwner(
      root,
      {
        schema: COMET_CHANGE_OWNER_SCHEMA,
        workflow: 'native',
        change: name,
        format: 'sdk',
        application: 'native',
        runId: name,
      },
      { canonical: true },
    );
    expect(await closeNativeSdkHistory({ projectRoot: root, run: frozen.run })).toBe(true);
    expect(await raw.read(name)).toEqual(frozen.run);
    return {
      root,
      integration,
      name,
      runtime: createNativeSdkRuntime(root),
      raw,
      documents,
      removeDocuments: () => fs.rename(documents, path.join(root, 'retained-cancelled-documents')),
    };
  }
  const name = 'cancelled-history';
  const documents = path.join(root, 'docs/comet/changes', name);
  await fs.mkdir(documents, { recursive: true });
  const app = defineNativeWorkflowApplication('4');
  const runtime = createRuntime({
    ...app,
    store: createNativeSdkStateStore(root),
    workflows: [app.workflow],
    transitionHandlers: [app.transitionHandler],
  });
  await runtime.start({
    runId: name,
    workflow: { id: app.workflow.id, version: app.workflow.version },
    input: { name, artifactRootRef: 'docs' },
    initialState: createNativePortableState({
      name,
      language: 'en',
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
  const raw = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
  });
  const removeDocuments = () =>
    fs.rename(documents, path.join(root, 'retained-cancelled-documents'));
  return { root, integration, name, runtime, raw, documents, removeDocuments };
}

it.each(
  (['current', 'published-052'] as const).flatMap((kind) =>
    [false, true].map((linked) => ({ kind, linked })),
  ),
)(
  'diagnoses closed cancelled $kind history without active documents (linked=$linked)',
  async ({ kind, linked }) => {
    const f = await fixture(linked, kind);
    if (kind === 'current')
      await f.runtime.cancel({ runId: f.name, reason: 'SIMULATED user stopped this task' });
    expect(await f.raw.readDisposition(f.name)).toBe('closed');
    const original = await f.raw.read(f.name);
    let neighbor: WorkflowRun | null = null;
    const neighborStore = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.integration), 'sdk-runs/native'),
    });
    if (linked) {
      const created = await runNativeCli([
        'new',
        f.name,
        '--project-root',
        f.integration,
        '--json',
      ]);
      expect(JSON.parse(created.stdout!).exitCode).toBe(0);
      neighbor = await neighborStore.read(f.name);
      expect(neighbor?.status).not.toBe('cancelled');
    }
    await f.removeDocuments();
    for (const args of [[f.name], [f.name, '--repair'], []]) {
      const result = await nativeDoctorCommand([...args], f.root);
      expect(result.exitCode, JSON.stringify(result)).toBe(0);
      expect(result.data).toMatchObject({ healthy: true });
    }
    const command = spawnSync(
      process.execPath,
      [
        path.resolve('assets/skills/comet-native/scripts/comet-native-doctor.mjs'),
        f.name,
        '--project-root',
        f.root,
        '--json',
      ],
      { encoding: 'utf8' },
    );
    expect(command.status, command.stderr + command.stdout).toBe(0);
    expect(JSON.parse(command.stdout).data).toMatchObject({ healthy: true });
    expect(await f.raw.read(f.name)).toEqual(original);
    if (linked) {
      expect((await nativeDoctorCommand([f.name], f.integration)).exitCode).toBe(0);
      expect(await neighborStore.read(f.name)).toEqual(neighbor);
    }
    await expect(fs.access(f.documents)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('closes a claimed Shape Action without stop proof and keeps its original claim in read-only history', async () => {
  const f = await fixture();

  const run = await f.raw.read(f.name);
  const action = run!.actions[0];
  await f.runtime.claim({
    runId: f.name,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-native-cli',
    claimToken: 'active-shape',
    context: { requestId: 'shape', projectRoot: f.root },
  });
  await f.runtime.cancel({ runId: f.name, reason: 'SIMULATED user cancelled the platform task' });
  expect(await f.raw.readDisposition(f.name)).toBe('closed');
  const cancelled = await f.raw.read(f.name);
  expect(cancelled!.actions[0]).toMatchObject({
    id: action.id,
    status: 'cancelled',
    claim: { token: 'active-shape' },
  });
  expect(cancelled!.actions[0]).not.toHaveProperty('executionStop');
  expect(cancelled!.actions[0]).not.toHaveProperty('cancellation');
  await f.removeDocuments();
  expect((await nativeDoctorCommand([f.name], f.root)).data).toMatchObject({
    healthy: true,
    repaired: false,
  });
  expect(await f.raw.read(f.name)).toEqual(cancelled);
  await expect(fs.access(f.documents)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reads closed data without a projection but rejects a different fixed Application on checkpoint recovery', async () => {
  const f = await fixture();
  await f.runtime.cancel({ runId: f.name, reason: 'Stop this task' });
  await f.removeDocuments();
  const fixed = createNativeSdkStateStore(f.root, {
    readOnly: true,
    identity: {
      id: 'custom-native',
      version: '1',
      base: 'native',
      contentHash: 'a'.repeat(64),
      packageRoot: path.join(f.root, 'package'),
      projectRoot: f.root,
      runtimeVersion: '0.5.3',
    },
  });
  const original = await f.raw.read(f.name);
  expect(await fixed.read(f.name)).toEqual(original);
  await fs.rename(path.join(f.root, 'retained-cancelled-documents'), f.documents);
  const portableFile = path.join(f.documents, 'comet-state.yaml'),
    bytes = await fs.readFile(portableFile);
  await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native'), {
    recursive: true,
  });
  await expect(fixed.read(f.name)).rejects.toThrow(/original fixed Application package/u);
  expect(await fs.readFile(portableFile)).toEqual(bytes);
  expect(await f.raw.read(f.name)).toBeNull();
});
