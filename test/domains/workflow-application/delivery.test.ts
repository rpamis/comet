import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  exportWorkflowApplication,
  installWorkflowApplication,
  loadWorkflowApplication,
  previewWorkflowApplicationInstall,
  resolveInstalledWorkflowApplication,
  resolveWorkflowApplicationFile,
  uninstallWorkflowApplication,
  inspectApplicationSkill,
} from '../../../domains/workflow-application/index.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import { PLATFORMS } from '../../../platform/install/platforms.js';

let root: string;
let source: Awaited<ReturnType<typeof createDiskApplication>>;
it('rejects a changed export package before writing when a content hash was confirmed', async () => {
  const inspected = await inspectApplicationSkill(source.packageRoot);
  await fs.appendFile(path.join(source.packageRoot, 'SKILL.md'), '\nChanged after preview\n');
  const destination = path.join(root, 'export-after-change');
  await expect(
    exportWorkflowApplication({
      file: source.file,
      projectRoot: root,
      destination,
      expectedContentHash: inspected.contentHash,
    }),
  ).rejects.toThrow('内容已变化');
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
});
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
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['second-entry', 'entry-directory', 'record', 'intent-cleanup'])(
  'resumes the original confirmed uninstall after interruption at %s',
  async (stage) => {
    const options = {
      file: source.file,
      projectRoot: root,
      scope: 'project' as const,
      platforms: ['cursor', 'workbuddy'],
    };
    const preview = await previewWorkflowApplicationInstall(options);
    const installed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    const request = { ...options, id: 'editorial' };
    const removal = await uninstallWorkflowApplication(request);
    const pending = path.join(preview.target, 'editorial/pending-uninstall.json');
    const failurePath =
      stage === 'second-entry'
        ? path.join(removal.removedEntries[1].root, 'SKILL.md')
        : stage === 'record'
          ? path.join(preview.target, 'editorial/current.json')
          : stage === 'intent-cleanup'
            ? pending
            : removal.removedEntries[0].root;
    let interrupted = false;
    const operation = stage === 'entry-directory' ? 'rmdir' : 'unlink';
    const original = fs[operation].bind(fs);
    const failure = vi.spyOn(fs, operation).mockImplementation(async (file) => {
      if (!interrupted && String(file) === failurePath) {
        interrupted = true;
        throw Object.assign(new Error('simulated uninstall interruption'), { code: 'EIO' });
      }
      return original(file);
    });
    await expect(
      uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
    ).rejects.toThrow('simulated uninstall interruption');
    failure.mockRestore();
    expect(interrupted).toBe(true);
    await expect(fs.stat(pending)).resolves.toBeDefined();
    await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow('卸载尚未完成');
    const resumed = await uninstallWorkflowApplication(request);
    expect(resumed.confirmationHash).toBe(removal.confirmationHash);
    await expect(
      uninstallWorkflowApplication({ ...request, confirmationHash: 'stale' }),
    ).rejects.toThrow('卸载预览已变化');
    await expect(
      uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
    ).resolves.toMatchObject({ uninstalled: true });
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBeNull();
    for (const entry of removal.removedEntries) {
      await expect(fs.stat(entry.root)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.stat(path.join(path.dirname(entry.root), 'writer/SKILL.md')),
      ).resolves.toBeDefined();
    }
    await expect(fs.stat(installed.file)).resolves.toBeDefined();
    await expect(previewWorkflowApplicationInstall(options)).resolves.toMatchObject({
      operation: 'install',
    });
  },
);

it('resumes selective uninstall after the final record write fails without broadening its approved scope', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['cursor', 'workbuddy'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  const request = { ...options, id: 'editorial', platforms: ['cursor'] };
  const removal = await uninstallWorkflowApplication(request);
  const record = path.join(preview.target, 'editorial/current.json');
  const rename = fs.rename.bind(fs);
  const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (String(to) === record)
      throw Object.assign(new Error('interrupted record update'), { code: 'EIO' });
    return rename(from, to);
  });
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).rejects.toThrow('interrupted record update');
  failure.mockRestore();
  await expect(uninstallWorkflowApplication({ ...options, id: 'editorial' })).rejects.toThrow(
    /原卸载|未完成卸载/,
  );
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).resolves.toMatchObject({ uninstalled: true });
  const current = JSON.parse(await fs.readFile(record, 'utf8'));
  expect(current.entries.map((entry: { platforms: string[] }) => entry.platforms)).toEqual([
    ['workbuddy'],
  ]);
  await expect(
    fs.stat(path.join(root, '.workbuddy/skills/editorial/SKILL.md')),
  ).resolves.toBeDefined();
  expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBe(installed.file);
});

it('preserves replacement files when an interrupted uninstall is resumed', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['cursor', 'workbuddy'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  await installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash });
  const request = { ...options, id: 'editorial' };
  const removal = await uninstallWorkflowApplication(request);
  const [first, second] = removal.removedEntries;
  const unlink = fs.unlink.bind(fs);
  const failure = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
    if (String(file) === path.join(second.root, 'SKILL.md'))
      throw new Error('interrupted deletion');
    return unlink(file);
  });
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).rejects.toThrow('interrupted deletion');
  failure.mockRestore();
  await fs.mkdir(first.root);
  await fs.writeFile(path.join(first.root, 'SKILL.md'), '# Personal replacement\n');
  const retained = await fs.readFile(path.join(second.root, 'SKILL.md'), 'utf8');
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).rejects.toThrow(/入口.*修改|入口.*变化/);
  expect(await fs.readFile(path.join(first.root, 'SKILL.md'), 'utf8')).toBe(
    '# Personal replacement\n',
  );
  expect(await fs.readFile(path.join(second.root, 'SKILL.md'), 'utf8')).toBe(retained);
});

it('rejects forged interrupted uninstall plans before touching files outside the approved entries', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['cursor'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  await installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash });
  const request = { ...options, id: 'editorial' };
  const removal = await uninstallWorkflowApplication(request);
  const pending = path.join(preview.target, 'editorial/pending-uninstall.json');
  const rmdir = fs.rmdir.bind(fs);
  const failure = vi.spyOn(fs, 'rmdir').mockImplementation(async (directory) => {
    if (String(directory) === removal.removedEntries[0].root)
      throw new Error('interrupted deletion');
    return rmdir(directory);
  });
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).rejects.toThrow('interrupted deletion');
  failure.mockRestore();
  const original = await fs.readFile(pending, 'utf8');
  const outside = path.join(root, 'personal');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'SKILL.md'), '# Personal workflow\n');
  for (const change of ['digest', 'package', 'entry']) {
    const intent = JSON.parse(original);
    if (change === 'package') intent.preview.previous.packageRef = '../../personal';
    if (change === 'entry') intent.preview.removedEntries[0].root = outside;
    intent.confirmationHash =
      change === 'digest' ? '0'.repeat(64) : hashRuntimeValue(intent.preview);
    await fs.writeFile(pending, JSON.stringify(intent));
    await expect(
      uninstallWorkflowApplication({ ...request, confirmationHash: intent.confirmationHash }),
    ).rejects.toThrow(/卸载意图|原卸载/);
    expect(await fs.readFile(path.join(outside, 'SKILL.md'), 'utf8')).toBe('# Personal workflow\n');
  }
  await fs.writeFile(pending, original);
  await expect(
    uninstallWorkflowApplication({ ...request, confirmationHash: removal.confirmationHash }),
  ).resolves.toMatchObject({ uninstalled: true });
});

it('completes a partially copied host Skill only with its sealed install intent', async () => {
  const projectRoot = path.join(root, 'partial-host-consumer');
  await fs.mkdir(projectRoot);
  const options = {
    file: source.file,
    projectRoot,
    scope: 'project' as const,
    platforms: ['codex'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const pending = path.join(preview.target, preview.id, 'pending-install.json');
  await fs.mkdir(path.dirname(pending), { recursive: true });
  await fs.writeFile(
    pending,
    JSON.stringify({ schema: 'comet.workflow.application.install.intent.v1', preview }),
  );
  const dependency = preview.hostSkills.find((entry) => entry.name === 'writer')!;
  await fs.mkdir(dependency.root, { recursive: true });
  const originalSkill = await fs.readFile(path.join(source.packageRoot, 'skills/writer/SKILL.md'));
  await fs.writeFile(path.join(dependency.root, 'SKILL.md'), originalSkill);
  await fs.writeFile(path.join(dependency.root, 'SKILL.md'), '# Different owner\n');
  await expect(
    installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash }),
  ).rejects.toThrow('同名内容冲突');
  expect(await fs.readFile(path.join(dependency.root, 'SKILL.md'), 'utf8')).toBe(
    '# Different owner\n',
  );
  await fs.writeFile(path.join(dependency.root, 'SKILL.md'), originalSkill);
  const resumed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  expect(resumed.contentHash).toBe(preview.contentHash);
  await expect(fs.readFile(path.join(dependency.root, 'scripts/run.mjs'))).resolves.toBeDefined();
  await expect(fs.stat(pending)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['empty', 'empty-nested'])(
  'resumes a sealed host Skill interrupted before its first file (%s)',
  async (kind) => {
    const options = {
      file: source.file,
      projectRoot: root,
      scope: 'project' as const,
      platforms: ['codex'],
    };
    const preview = await previewWorkflowApplicationInstall(options);
    const dependency = preview.hostSkills.find((entry) => entry.kind === 'dependency')!;
    await fs.mkdir(kind === 'empty' ? dependency.root : path.join(dependency.root, 'scripts'), {
      recursive: true,
    });
    await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow('依赖目录为空');
    const pending = path.join(preview.target, preview.id, 'pending-install.json');
    await fs.mkdir(path.dirname(pending), { recursive: true });
    await fs.writeFile(
      pending,
      JSON.stringify({ schema: 'comet.workflow.application.install.intent.v1', preview }),
    );
    const resumed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    expect(resumed.contentHash).toBe(preview.contentHash);
    expect((await inspectApplicationSkill(dependency.root)).contentHash).toBe(
      dependency.contentHash,
    );
    await expect(fs.stat(pending)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['project', 'user'] as const)(
  'distributes one immutable application to every registered platform in %s scope',
  async (scope) => {
    const projectRoot = path.join(root, 'consumer');
    const userRoot = path.join(root, 'isolated-home');
    await fs.mkdir(projectRoot);
    const options = { file: source.file, projectRoot, userRoot, scope, platforms: ['all'] };
    const preview = await previewWorkflowApplicationInstall(options);
    expect(preview.platforms.map(({ id }) => id)).toEqual(PLATFORMS.map(({ id }) => id));
    expect(preview.requiredCapabilities).toEqual(['skill-script']);
    expect(await fs.readdir(projectRoot)).toEqual([]);
    await expect(fs.stat(userRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const installed = await installWorkflowApplication({
      ...options,
      confirmationHash: preview.confirmationHash,
    });
    const base = scope === 'project' ? projectRoot : userRoot;
    for (const relative of scope === 'project'
      ? ['.cursor', '.agents', '.claude', '.zcode', '.workbuddy', '.omp']
      : ['.cursor', '.agents', '.claude', '.config/opencode', '.pi/agent', '.omp/agent']) {
      expect(
        await fs.readFile(path.join(base, relative, 'skills/editorial/SKILL.md'), 'utf8'),
      ).toContain(path.dirname(installed.file));
      expect(
        await fs.readFile(path.join(base, relative, 'skills/writer/scripts/run.mjs'), 'utf8'),
      ).toContain('JSON.stringify');
    }
    expect(new Set(preview.hostSkills.map(({ root }) => root)).size).toBe(
      preview.hostSkills.length,
    );
    const loaded = await loadWorkflowApplication({ file: installed.file, projectRoot });
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    const run = await runtime.start({
      runId: 'distributed-run',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'Distributed topic' },
    });
    const progressed = await runtime.execute({
      runId: run.runId,
      actionId: run.actions[0].id,
      executorId: 'local-skill',
    });
    expect(progressed.waits[0].status).toBe('pending');
    const uninstall = await uninstallWorkflowApplication({ ...options, id: 'editorial' });
    await uninstallWorkflowApplication({
      ...options,
      id: 'editorial',
      confirmationHash: uninstall.confirmationHash,
    });
    for (const entry of preview.hostSkills.filter(({ kind }) => kind === 'entry'))
      await expect(fs.stat(entry.root)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.stat(path.join(base, '.cursor/skills/writer/scripts/run.mjs')),
    ).resolves.toBeDefined();
    expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBeNull();
    expect(await resolveWorkflowApplicationFile(projectRoot, 'editorial', run.runId)).toBe(
      installed.file,
    );
  },
);

it('keeps all distributed entries current through platform additions, upgrades and selective uninstall', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['codex', 'antigravity', 'cursor'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const first = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  const loaded = await loadWorkflowApplication({ file: first.file, projectRoot: root });
  const run = await createRuntime({ ...loaded.implementation, store: loaded.store }).start({
    runId: 'before-upgrade',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Original' },
  });
  source.manifest.version = '2';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const upgradeOptions = { ...options, platforms: ['zcode'], upgrade: true };
  const upgrade = await previewWorkflowApplicationInstall(upgradeOptions);
  expect(new Set(upgrade.platforms.map(({ id }) => id))).toEqual(
    new Set(['codex', 'antigravity', 'cursor', 'zcode']),
  );
  const second = await installWorkflowApplication({
    ...upgradeOptions,
    confirmationHash: upgrade.confirmationHash,
  });
  expect(await fs.readFile(path.join(root, '.cursor/skills/editorial/SKILL.md'), 'utf8')).toContain(
    path.dirname(second.file),
  );
  const removeOptions = { ...options, id: 'editorial', platforms: ['codex', 'cursor'] };
  const removal = await uninstallWorkflowApplication(removeOptions);
  await uninstallWorkflowApplication({
    ...removeOptions,
    confirmationHash: removal.confirmationHash,
  });
  await expect(fs.stat(path.join(root, '.cursor/skills/editorial'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(
    fs.stat(path.join(root, '.agents/skills/editorial/SKILL.md')),
  ).resolves.toBeDefined();
  expect(await resolveInstalledWorkflowApplication(options, 'editorial')).toBe(second.file);
  expect(await resolveWorkflowApplicationFile(root, 'editorial', run.runId)).toBe(first.file);
});

it('preflights every platform and rejects target drift before writing any install files', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['codex', 'cursor'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const personal = path.join(root, '.cursor/skills/editorial');
  await fs.mkdir(personal, { recursive: true });
  await fs.writeFile(path.join(personal, 'SKILL.md'), '# Personal workflow\n');
  await expect(
    installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash }),
  ).rejects.toThrow(/不属于|冲突|预览/u);
  await expect(fs.stat(path.join(root, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(preview.target)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(personal, 'SKILL.md'), 'utf8')).toBe('# Personal workflow\n');
  await expect(
    previewWorkflowApplicationInstall({ ...options, platforms: ['not-a-platform'] }),
  ).rejects.toThrow(/未知平台/u);
});

it('rejects platform junctions and forged entry ownership without touching unrelated files', async () => {
  const options = {
    file: source.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['cursor'],
  };
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, '.cursor'), 'junction');
  await expect(previewWorkflowApplicationInstall(options)).rejects.toThrow(
    /symbolic link|junction/u,
  );
  expect(await fs.readdir(outside)).toEqual([]);
  await fs.unlink(path.join(root, '.cursor'));
  const preview = await previewWorkflowApplicationInstall(options);
  await installWorkflowApplication({ ...options, confirmationHash: preview.confirmationHash });
  const personal = path.join(root, '.cursor/skills/personal');
  await fs.mkdir(personal);
  await fs.writeFile(path.join(personal, 'SKILL.md'), '# Personal workflow\n');
  const recordFile = path.join(preview.target, 'editorial/current.json');
  const record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
  record.entries[0].root = personal;
  record.entries[0].contentHash = (await inspectApplicationSkill(personal)).contentHash;
  await fs.writeFile(recordFile, JSON.stringify(record));
  await expect(uninstallWorkflowApplication({ ...options, id: 'editorial' })).rejects.toThrow(
    /安装记录|固定包/u,
  );
  expect(await fs.readFile(path.join(personal, 'SKILL.md'), 'utf8')).toBe('# Personal workflow\n');
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
