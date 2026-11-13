import '../../helpers/isolated-agent-home.js';
import { parseNativeStateDocument } from '../../../domains/comet-native/native-state-document.js';
import { closeNativeSdkHistory } from '../../../domains/comet-native/native-sdk-history.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { it, expect, afterEach } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  inspectNativeSdkRun,
  createNativeSdkRuntime,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import {
  createFileRuntimeStore,
  type WorkflowRun,
  preserveRuntimeExecutionOrigins,
  readPortableRunCheckpoint,
  PORTABLE_RUN_CHECKPOINT_KEY,
} from '../../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it.each(['current', 'published-052'] as const)(
  'restores a real %s cancelled portable Run through public Doctor repair without replacing original evidence',
  async (kind) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-history-no-projection-')),
      source = path.join(directory, 'source'),
      target = path.join(directory, 'target');
    roots.push(directory);
    await fs.mkdir(source);
    await fs.mkdir(target);
    execFileSync('git', ['init', '-b', 'main'], { cwd: source, stdio: 'ignore' });
    execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
    let name = 'cancelled-history';
    let original: WorkflowRun;
    if (kind === 'current') {
      const created = await runNativeCli(['new', name, '--project-root', source, '--json']);
      expect(created.exitCode, created.stderr).toBe(0);
      await createNativeSdkRuntime(source).cancel({
        runId: name,
        reason: 'SIMULATED user cancellation before platform execution',
      });
      original = (await createFileRuntimeStore<WorkflowRun>({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(source), 'sdk-runs/native'),
      }).read(name))!;
    } else {
      const fixture = JSON.parse(
        await fs.readFile(
          path.resolve('test/fixtures/native-052-cancelled-portable-history/cancelled.json'),
          'utf8',
        ),
      ) as { run: WorkflowRun; projectMaterials: Array<{ ref: string; bytesBase64: string }> };
      name = fixture.run.runId;
      for (const f of fixture.projectMaterials) {
        const file = path.join(source, f.ref);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, Buffer.from(f.bytesBase64, 'base64'));
      }
      original = fixture.run;
      expect(original.status).toBe('cancelled');
      expect(original.workflow.version).toBe('3');
    }
    const originalConfig = await fs.readFile(path.join(source, '.comet/config.yaml'));
    await fs.mkdir(path.join(target, '.comet'));
    await fs.writeFile(path.join(target, '.comet/config.yaml'), originalConfig);
    const artifactRoot = (original.input as { artifactRootRef: string }).artifactRootRef;
    const sourceDocs = path.join(source, artifactRoot, 'comet'),
      targetDocs = path.join(target, artifactRoot, 'comet');
    await fs.cp(sourceDocs, targetDocs, { recursive: true });
    const portable = path.join(targetDocs, 'changes', name, 'comet-state.yaml'),
      bytes = await fs.readFile(portable);
    const saved = readPortableRunCheckpoint(
      (
        parseNativeStateDocument(bytes.toString('utf8'), 'actual source checkpoint') as Record<
          string,
          unknown
        >
      )[PORTABLE_RUN_CHECKPOINT_KEY],
      name,
      { preserveSourceRevision: true },
    )!;
    expect(saved).not.toBeNull();
    const runtimeRoot = resolveWorkspaceRuntimeRootSync(target),
      marker = path.join(runtimeRoot, 'state-projections/native', name + '.json');
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, 'SIMULATED retired unrelated marker: preserve original bytes\n');
    const markerBytes = await fs.readFile(marker);
    const store = createFileRuntimeStore<WorkflowRun>({
      rootDir: path.join(runtimeRoot, 'sdk-runs/native'),
    });
    expect(await store.read(name)).toBeNull();
    const cli = () =>
      runNativeCli(['doctor', name, '--repair', '--confirmed', '--project-root', target, '--json']);
    const result = await cli();

    expect(result.exitCode, result.stdout || result.stderr).toBe(0);
    expect(await store.readDisposition(name)).toBe('closed');
    await expect(
      fs.access(path.join(runtimeRoot, 'change-owner-history/native', name + '.json')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(runtimeRoot, 'change-owners/native', name + '.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = (await store.read(name))!;
    expect(restored).toEqual(saved);
    expect(restored.runId).toBe(original.runId);
    expect(restored.revision).toBe(original.revision);
    expect(restored.state).toEqual(original.state);
    expect(restored.actions).toEqual(saved.actions);
    expect(restored.waits).toEqual(saved.waits);
    expect(restored.commands).toEqual(saved.commands);
    expect(restored.actions.map((a) => a.claim)).toEqual(saved.actions.map((a) => a.claim));
    const observed = await inspectNativeSdkRun(target, name, { readOnly: true });
    expect(observed.run.workflow.version).toBe('4');
    expect(observed.run.actions).toEqual(
      kind === 'current' ? saved.actions : preserveRuntimeExecutionOrigins(saved).actions,
    );
    expect(await fs.readFile(portable)).toEqual(bytes);
    expect(await fs.readFile(marker)).toEqual(markerBytes);
    expect((await cli()).exitCode).toBe(0);
    expect(await store.read(name)).toEqual(restored);
    const ownerFile = path.join(runtimeRoot, 'change-owner-history/native', name + '.json'),
      ownerBytes = await fs.readFile(ownerFile);
    expect(await closeNativeSdkHistory({ projectRoot: target, run: saved })).toBe(true);
    expect(
      await closeNativeSdkHistory({
        projectRoot: target,
        run: { ...saved, revision: saved.revision + 1 },
      }),
    ).toBe(false);
    await expect(
      closeNativeSdkHistory({
        projectRoot: target,
        run: { ...saved, reason: 'SIMULATED unrelated same-revision content' },
      }),
    ).rejects.toThrow(/content changed/);
    await expect(
      closeNativeSdkHistory({
        projectRoot: target,
        run: { ...saved, workflow: { ...saved.workflow, version: '4', hash: 'f'.repeat(64) } },
      }),
    ).rejects.toThrow(/definition hash|content changed/);
    expect(await store.read(name)).toEqual(restored);
    expect(await fs.readFile(ownerFile)).toEqual(ownerBytes);
    expect(await fs.readFile(portable)).toEqual(bytes);
    expect(
      restored.actions.map((a) => [
        a.id,
        a.attempt,
        a.inputHash,
        a.claim?.sessionId,
        a.claim?.executorId,
      ]),
    ).toEqual(
      original.actions.map((a) => [
        a.id,
        a.attempt,
        a.inputHash,
        a.claim?.sessionId,
        a.claim?.executorId,
      ]),
    );
  },
);
