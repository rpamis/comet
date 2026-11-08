import {
  resolveWorkspaceRuntimeRootSync,
  isWorkspaceRuntimeMigrationFence,
} from '../../../domains/workflow-contract/workspace-runtime.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  inspectNativeRuntimeStorage,
  nativeChangeRuntimeDir,
  nativeLegacyChangeRuntimeDir,
  nativePreferredChangeRuntimeDir,
  nativeProjectPaths,
  nativeRuntimeRefFile,
  nativeStorageRoot,
  normalizeArtifactRootRef,
  resolveArtifactRoot,
} from '../../../domains/comet-native/native-paths.js';

describe('Native artifact root safety', () => {
  let projectRoot: string;
  let outside: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-paths-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-outside-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('migrates only the named legacy runtime without enumerating unrelated changes', async () => {
    const legacy = path.join(projectRoot, 'comet', 'changes', 'target', 'runtime');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'record.json'), '{"saved":true}');
    const reads = vi.spyOn(fs, 'readdir');
    const paths = await nativeProjectPaths(projectRoot, '.', { change: 'target' });
    expect(
      await fs.readFile(
        path.join(nativePreferredChangeRuntimeDir(paths, 'target'), 'record.json'),
        'utf8',
      ),
    ).toBe('{"saved":true}');
    expect(await isWorkspaceRuntimeMigrationFence(legacy)).toBe(true);
    reads.mockClear();
    await nativeProjectPaths(projectRoot, '.', { change: 'target' });
    expect(reads.mock.calls.some(([file]) => String(file) === paths.changesDir)).toBe(false);
  });

  it.each([
    ['.', '.'],
    ['docs', 'docs'],
    ['docs\\specs', 'docs/specs'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeArtifactRootRef(input)).toBe(expected);
  });

  it.each(['../docs', '/tmp/docs', 'C:\\docs', '~/.docs', ''])('rejects %s', (input) => {
    expect(() => normalizeArtifactRootRef(input)).toThrow();
  });

  it('accepts an in-project directory junction', async () => {
    const actual = path.join(projectRoot, 'actual');
    const link = path.join(projectRoot, 'linked');
    await fs.mkdir(actual);
    await fs.symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir');

    expect(await resolveArtifactRoot(projectRoot, 'linked')).toBe(link);
  });

  it('rejects a junction that escapes the project', async () => {
    const link = path.join(projectRoot, 'escaped');
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(resolveArtifactRoot(projectRoot, 'escaped')).rejects.toThrow(
      'resolves outside the project root',
    );
  });

  it('rejects a configured comet root that is itself a junction', async () => {
    const linkedRoot = path.join(projectRoot, 'comet');
    await fs.symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(nativeProjectPaths(projectRoot, '.')).rejects.toThrow(
      'Native comet root must not be a symbolic link',
    );
  });

  it('rejects a .comet parent junction that redirects Runtime outside the project', async () => {
    await fs.symlink(
      outside,
      path.join(projectRoot, '.comet'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(nativeProjectPaths(projectRoot, 'docs')).rejects.toThrow();
  });

  it('keeps Runtime user-local when the document artifact root changes', async () => {
    const rootPaths = await nativeProjectPaths(projectRoot, '.');
    const docsPaths = await nativeProjectPaths(projectRoot, 'docs');

    expect(rootPaths.runtimeDir).toBe(
      path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'native'),
    );
    expect(docsPaths.runtimeDir).toBe(rootPaths.runtimeDir);
    expect(nativePreferredChangeRuntimeDir(docsPaths, 'focused-change')).toBe(
      path.join(
        resolveWorkspaceRuntimeRootSync(projectRoot),
        'native',
        'changes',
        'focused-change',
      ),
    );
  });

  it('reports preferred, legacy, missing, and conflicting Runtime storage', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const name = 'runtime-health';
    const preferred = nativePreferredChangeRuntimeDir(paths, name);
    const legacy = nativeLegacyChangeRuntimeDir(paths, name);

    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'missing',
      layout: 'missing',
      path: preferred,
    });
    expect(nativeChangeRuntimeDir(paths, name)).toBe(preferred);

    await fs.mkdir(preferred, { recursive: true });
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'available',
      layout: 'user-local',
      path: preferred,
    });
    expect(nativeChangeRuntimeDir(paths, name)).toBe(preferred);

    await fs.rm(preferred, { recursive: true });
    await fs.mkdir(legacy, { recursive: true });
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'available',
      layout: 'legacy',
      path: legacy,
    });
    expect(() => nativeChangeRuntimeDir(paths, name)).toThrow('requires migration');

    await fs.mkdir(preferred, { recursive: true });
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'invalid',
      layout: 'user-local',
      message: 'Both user-local and legacy Native Runtime directories exist',
    });

    await fs.rm(legacy, { recursive: true });
    await fs.rm(preferred, { recursive: true });
    await fs.writeFile(preferred, 'not a directory');
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'invalid',
      layout: 'user-local',
      message: 'Native Runtime path must be a real directory',
    });
  });

  it('reports linked legacy Runtime as invalid without opening the target', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const legacy = nativeLegacyChangeRuntimeDir(paths, 'linked-legacy');
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.symlink(outside, legacy, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(inspectNativeRuntimeStorage(paths, 'linked-legacy')).resolves.toMatchObject({
      status: 'invalid',
      layout: 'legacy',
    });
    expect(() => nativeChangeRuntimeDir(paths, 'linked-legacy')).toThrow('requires migration');
  });

  it('migrates change-local evidence before returning paths and fences the old writer', async () => {
    const legacy = path.join(projectRoot, 'docs/comet/changes/migrate-me/runtime');
    await fs.mkdir(path.join(legacy, 'evidence'), { recursive: true });
    await fs.writeFile(path.join(legacy, 'evidence/receipt.json'), '{"preserved":true}');
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const runtime = nativeChangeRuntimeDir(paths, 'migrate-me');
    expect(runtime).toBe(nativePreferredChangeRuntimeDir(paths, 'migrate-me'));
    expect(await fs.readFile(path.join(runtime, 'evidence/receipt.json'), 'utf8')).toBe(
      '{"preserved":true}',
    );
    expect(await isWorkspaceRuntimeMigrationFence(legacy, runtime)).toBe(true);
    expect((await inspectNativeRuntimeStorage(paths, 'migrate-me')).layout).toBe('user-local');
    await expect(fs.mkdir(legacy, { recursive: true })).rejects.toThrow();
    expect((await nativeProjectPaths(projectRoot, 'docs')).runtimeDir).toBe(paths.runtimeDir);
  });

  it('rescans legacy directories created after a previous successful path resolution', async () => {
    const initial = await nativeProjectPaths(projectRoot, 'docs');
    const legacy = nativeLegacyChangeRuntimeDir(initial, 'late-runtime');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'trajectory.jsonl'), '{"type":"history-preserved"}\n');

    const refreshed = await nativeProjectPaths(projectRoot, 'docs');
    const runtime = nativeChangeRuntimeDir(refreshed, 'late-runtime');
    expect(refreshed.workspaceRuntimeRoot).toBe(initial.workspaceRuntimeRoot);
    expect(await fs.readFile(path.join(runtime, 'trajectory.jsonl'), 'utf8')).toBe(
      '{"type":"history-preserved"}\n',
    );
    expect(await isWorkspaceRuntimeMigrationFence(legacy, runtime)).toBe(true);
    await expect(fs.mkdir(legacy, { recursive: true })).rejects.toThrow();
  });

  it('retains legacy execution evidence when migration cannot prove it stopped', async () => {
    const legacy = path.join(projectRoot, 'docs/comet/changes/still-running/runtime');
    await fs.mkdir(legacy, { recursive: true });
    const evidence = JSON.stringify({
      actions: [{ status: 'running', claim: { token: 'fixture' } }],
    });
    await fs.writeFile(path.join(legacy, 'state.json'), evidence);
    await expect(nativeProjectPaths(projectRoot, 'docs')).rejects.toThrow();
    expect(await fs.readFile(path.join(legacy, 'state.json'), 'utf8')).toBe(evidence);
    await expect(
      fs.stat(
        path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'native/changes/still-running'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow a copied workspace fence when reconstructing a portable checkout', async () => {
    const legacy = path.join(projectRoot, 'docs/comet/changes/copied-change/runtime');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'source-evidence.json'), '{}');
    const source = await nativeProjectPaths(projectRoot, 'docs');
    await fs.cp(path.join(projectRoot, 'docs'), path.join(outside, 'docs'), { recursive: true });
    const copy = await nativeProjectPaths(outside, 'docs');
    const target = nativeChangeRuntimeDir(copy, 'copied-change');
    expect(target).not.toBe(nativeChangeRuntimeDir(source, 'copied-change'));
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await inspectNativeRuntimeStorage(copy, 'copied-change')).status).toBe('missing');
  });

  it('isolates equal change names in separate workspaces and rejects linked runtime roots', async () => {
    const first = await nativeProjectPaths(projectRoot, 'docs');
    const second = await nativeProjectPaths(outside, 'docs');
    expect(first.workspaceRuntimeRoot).not.toBe(second.workspaceRuntimeRoot);
    expect(nativePreferredChangeRuntimeDir(first, 'same-name')).not.toBe(
      nativePreferredChangeRuntimeDir(second, 'same-name'),
    );
    await fs.symlink(outside, first.runtimeDir, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(nativeProjectPaths(projectRoot, 'docs')).rejects.toThrow();
  });

  it('keeps Runtime references and storage roots contained', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');

    expect(nativeRuntimeRefFile(paths.runtimeDir, 'runtime/changes/example/state.json')).toBe(
      path.join(paths.runtimeDir, 'changes', 'example', 'state.json'),
    );
    expect(() => nativeRuntimeRefFile(paths.runtimeDir, '../outside.json')).toThrow(
      'Invalid Native Runtime ref',
    );
    expect(nativeStorageRoot(paths, paths.runtimeDir)).toBe(paths.runtimeDir);
    expect(nativeStorageRoot(paths, paths.nativeRoot)).toBe(paths.nativeRoot);
    expect(() => nativeStorageRoot(paths, projectRoot)).toThrow(
      'outside Native document and Runtime roots',
    );
  });
});
