import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import {
  exportWorkflowApplication,
  installWorkflowApplication,
  loadWorkflowApplication,
  previewWorkflowApplicationInstall,
  resolveInstalledWorkflowApplication,
  resolveWorkflowApplicationFile,
  uninstallWorkflowApplication,
} from '../../../domains/workflow-application/index.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';

let root: string;
let source: Awaited<ReturnType<typeof createDiskApplication>>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-delivery-'));
  await fs.mkdir(path.join(root, 'source'));
  source = await createDiskApplication(path.join(root, 'source'));
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['project', 'user'] as const)(
  'exports and installs complete packages in %s scope; old Run survives upgrade and uninstall',
  async (scope) => {
    const projectRoot = path.join(root, 'consumer');
    await fs.mkdir(projectRoot);
    const exported = await exportWorkflowApplication({
      file: source.file,
      projectRoot,
      destination: path.join(root, 'export'),
    });
    const options = {
      file: exported.file,
      projectRoot,
      scope,
      userRoot: path.join(root, 'home'),
      host: 'claude-code' as const,
    };
    const preview = await previewWorkflowApplicationInstall(options);
    expect(preview).toMatchObject({
      operation: 'install',
      noFilesWritten: true,
      retainedVersions: true,
    });
    await expect(fs.stat(preview.target)).rejects.toMatchObject({ code: 'ENOENT' });
    const installed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    expect(preview.hostSkills.map((entry) => entry.name)).toEqual(['editorial', 'writer']);
    expect(await fs.readFile(path.join(preview.hostSkills[0].root, 'SKILL.md'), 'utf8')).toContain(
      'Editorial entry',
    );
    const loaded = await loadWorkflowApplication({ file: installed.file, projectRoot });
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    const run = await runtime.start({
      runId: 'in-flight',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'Fixed topic' },
    });
    expect(run.actions[0].status).toBe('pending');
    await expect(previewWorkflowApplicationInstall(options)).resolves.toMatchObject({
      operation: 'unchanged',
    });
    const manifest = JSON.parse(await fs.readFile(exported.file, 'utf8'));
    manifest.version = '2';
    await fs.writeFile(exported.file, JSON.stringify(manifest));
    await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow('同名应用');
    const upgrade = await previewWorkflowApplicationInstall({ ...options, upgrade: true });
    const newer = await installWorkflowApplication({
      ...options,
      upgrade: true,
      confirmationHash: upgrade.confirmationHash,
    });
    expect(newer.file).not.toBe(installed.file);
    expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBe(newer.file);
    expect(await resolveWorkflowApplicationFile(projectRoot, 'editorial', 'in-flight')).toBe(
      installed.file,
    );
    const cold = await loadWorkflowApplication({
      file: installed.file,
      projectRoot,
      runId: 'in-flight',
    });
    const resumed = createRuntime({ ...cold.implementation, store: cold.store });
    expect(await resumed.inspect('in-flight')).toEqual(run);
    const uninstall = await uninstallWorkflowApplication({ ...options, id: 'editorial' });
    const result = await uninstallWorkflowApplication({
      ...options,
      id: 'editorial',
      confirmationHash: uninstall.confirmationHash,
    });
    expect(result).toMatchObject({
      uninstalled: true,
      retainedVersions: true,
      removesDefaultEntryOnly: true,
    });
    await expect(fs.stat(preview.hostSkills[0].root)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(preview.hostSkills[1].root)).resolves.toBeDefined();
    expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBeNull();
    expect(await resolveWorkflowApplicationFile(projectRoot, 'editorial', 'in-flight')).toBe(
      installed.file,
    );
    const after = await loadWorkflowApplication({
      file: installed.file,
      projectRoot,
      runId: 'in-flight',
    });
    let restored = createRuntime({ ...after.implementation, store: after.store });
    const progressed = await restored.execute({
      runId: 'in-flight',
      actionId: run.actions[0].id,
      executorId: 'local-skill',
    });
    expect(progressed.waits[0].status).toBe('pending');
  },
);

it('rejects stale previews, same-version conflicts, external dependencies, and legacy format without modifying user files', async () => {
  const options = { file: source.file, projectRoot: root, scope: 'project' as const };
  const preview = await previewWorkflowApplicationInstall(options);
  await fs.appendFile(path.join(source.packageRoot, 'SKILL.md'), '\nChanged entry\n');
  await expect(
    installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash }),
  ).rejects.toThrow('预览已变化');
  const current = await previewWorkflowApplicationInstall(options);
  await installWorkflowApplication({ ...options, confirmationHash: current.confirmationHash });
  await fs.appendFile(path.join(source.packageRoot, 'SKILL.md'), '\nSame version drift\n');
  await expect(previewWorkflowApplicationInstall({ ...options, upgrade: true })).rejects.toThrow(
    '相同版本内容冲突',
  );
  source.manifest.skills[0].root = source.skillRoot;
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  await expect(
    exportWorkflowApplication({ ...options, destination: path.join(root, 'incomplete') }),
  ).rejects.toThrow('包内');
  await fs.writeFile(source.file, '{"schema":"workflow-protocol"}');
  const before = await fs.readFile(source.file, 'utf8');
  await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow('重新生成 SDK');
  expect(await fs.readFile(source.file, 'utf8')).toBe(before);
});

it('rejects installation through a junction and preserves an unrelated directory', async () => {
  const outside = path.join(root, 'outside');
  const home = path.join(root, 'home');
  await fs.mkdir(outside);
  await fs.mkdir(home);
  await fs.symlink(outside, path.join(home, '.comet'), 'junction');
  await expect(
    previewWorkflowApplicationInstall({
      file: source.file,
      projectRoot: root,
      scope: 'user',
      userRoot: home,
    }),
  ).rejects.toThrow(/symbolic link|junction/u);
  expect(await fs.readdir(outside)).toEqual([]);
});

it('keeps a user-scoped in-flight Run in another project and refuses unowned or changed host entries', async () => {
  const userRoot = path.join(root, 'home');
  const other = path.join(root, 'other-project');
  await fs.mkdir(other);
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'user' as const,
    userRoot,
    host: 'codex' as const,
  };
  const preview = await previewWorkflowApplicationInstall(options);
  await fs.mkdir(preview.hostSkills[0].root, { recursive: true });
  await fs.writeFile(path.join(preview.hostSkills[0].root, 'SKILL.md'), '# Personal entry\n');
  await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow('不属于此安装');
  await fs.unlink(path.join(preview.hostSkills[0].root, 'SKILL.md'));
  await fs.rmdir(preview.hostSkills[0].root);
  const fresh = await previewWorkflowApplicationInstall(options);
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: fresh.confirmationHash,
  });
  const loaded = await loadWorkflowApplication({ file: installed.file, projectRoot: other });
  const ownedText = await fs.readFile(path.join(preview.hostSkills[0].root, 'SKILL.md'), 'utf8');
  const run = await createRuntime({ ...loaded.implementation, store: loaded.store }).start({
    runId: 'other-active',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Other project' },
  });
  await fs.appendFile(path.join(preview.hostSkills[0].root, 'SKILL.md'), '\nPersonal change\n');
  await expect(uninstallWorkflowApplication({ ...options, id: 'editorial' })).rejects.toThrow(
    '被修改',
  );
  await fs.writeFile(path.join(preview.hostSkills[0].root, 'SKILL.md'), ownedText);
  const uninstall = await uninstallWorkflowApplication({ ...options, id: 'editorial' });
  await uninstallWorkflowApplication({
    ...options,
    id: 'editorial',
    confirmationHash: uninstall.confirmationHash,
  });
  expect(await resolveWorkflowApplicationFile(other, 'editorial', 'other-active')).toBe(
    installed.file,
  );
  const cold = await loadWorkflowApplication({
    file: installed.file,
    projectRoot: other,
    runId: run.runId,
  });
  expect(
    await createRuntime({ ...cold.implementation, store: cold.store }).inspect(run.runId),
  ).toEqual(run);
});
