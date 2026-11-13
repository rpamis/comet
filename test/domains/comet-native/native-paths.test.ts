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

  it('resolves only the named Runtime without migrating or enumerating legacy changes', async () => {
    const legacy = path.join(projectRoot, 'comet/changes/target/runtime'),
      record = path.join(legacy, 'record.json');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(record, '{"saved":true}');
    await fs.mkdir(path.join(projectRoot, 'comet/changes/unrelated/runtime'), { recursive: true });
    const reads = vi.spyOn(fs, 'readdir');
    const paths = await nativeProjectPaths(projectRoot, '.', { change: 'target' });
    await nativeProjectPaths(projectRoot, '.', { change: 'target' });
    expect(reads.mock.calls.some(([file]) => String(file) === paths.changesDir)).toBe(false);
    expect(await fs.readFile(record, 'utf8')).toBe('{"saved":true}');
    expect(await fs.readdir(legacy)).toEqual(['record.json']);
    expect(await isWorkspaceRuntimeMigrationFence(legacy)).toBe(false);
    await expect(fs.stat(nativePreferredChangeRuntimeDir(paths, 'target'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
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

  it('resolves Native paths without following a linked legacy .comet directory', async () => {
    await fs.writeFile(path.join(outside, 'canary.json'), 'foreign-data');
    await fs.symlink(
      outside,
      path.join(projectRoot, '.comet'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(paths.workspaceRuntimeRoot).toBe(resolveWorkspaceRuntimeRootSync(projectRoot));
    expect(await fs.readdir(outside)).toEqual(['canary.json']);
    expect(await fs.readFile(path.join(outside, 'canary.json'), 'utf8')).toBe('foreign-data');
    await expect(fs.stat(paths.runtimeDir)).rejects.toMatchObject({ code: 'ENOENT' });
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
    expect(nativeChangeRuntimeDir(paths, name)).toBe(preferred);

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
    expect(nativeChangeRuntimeDir(paths, 'linked-legacy')).toBe(
      nativePreferredChangeRuntimeDir(paths, 'linked-legacy'),
    );
  });

  it('leaves old change-local check evidence untouched during path resolution', async () => {
    const legacy = path.join(projectRoot, 'docs/comet/changes/migrate-me/runtime'),
      record = path.join(legacy, 'evidence/receipt.json');
    await fs.mkdir(path.dirname(record), { recursive: true });
    await fs.writeFile(record, '{"preserved":true}');
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(nativeChangeRuntimeDir(paths, 'migrate-me')).toBe(
      nativePreferredChangeRuntimeDir(paths, 'migrate-me'),
    );
    expect(await fs.readFile(record, 'utf8')).toBe('{"preserved":true}');
    expect(await fs.readdir(legacy)).toEqual(['evidence']);
    expect(await isWorkspaceRuntimeMigrationFence(legacy)).toBe(false);
    expect(await inspectNativeRuntimeStorage(paths, 'migrate-me')).toMatchObject({
      status: 'available',
      layout: 'legacy',
      path: legacy,
    });
    await expect(
      fs.stat(nativePreferredChangeRuntimeDir(paths, 'migrate-me')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await nativeProjectPaths(projectRoot, 'docs')).runtimeDir).toBe(paths.runtimeDir);
  });

  it('reports late legacy business history without moving it during path resolution', async () => {
    const initial = await nativeProjectPaths(projectRoot, 'docs'),
      legacy = nativeLegacyChangeRuntimeDir(initial, 'late-runtime'),
      history = '{"type":"history-preserved"}\n';
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'trajectory.jsonl'), history);
    const refreshed = await nativeProjectPaths(projectRoot, 'docs');
    expect(refreshed.workspaceRuntimeRoot).toBe(initial.workspaceRuntimeRoot);
    expect(await fs.readFile(path.join(legacy, 'trajectory.jsonl'), 'utf8')).toBe(history);
    expect(await fs.readdir(legacy)).toEqual(['trajectory.jsonl']);
    expect(await isWorkspaceRuntimeMigrationFence(legacy)).toBe(false);
    expect(await inspectNativeRuntimeStorage(refreshed, 'late-runtime')).toMatchObject({
      status: 'available',
      layout: 'legacy',
      path: legacy,
    });
    await expect(fs.stat(nativeChangeRuntimeDir(refreshed, 'late-runtime'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves old execution-looking bytes without running a process check during path resolution', async () => {
    const legacy = path.join(projectRoot, 'docs/comet/changes/still-running/runtime');
    await fs.mkdir(legacy, { recursive: true });
    const evidence = JSON.stringify({
      actions: [{ status: 'running', claim: { token: 'fixture' } }],
    });
    await fs.writeFile(path.join(legacy, 'state.json'), evidence);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    expect(await fs.readFile(path.join(legacy, 'state.json'), 'utf8')).toBe(evidence);
    expect(await fs.readdir(legacy)).toEqual(['state.json']);
    expect(await inspectNativeRuntimeStorage(paths, 'still-running')).toMatchObject({
      status: 'available',
      layout: 'legacy',
    });
    await expect(
      fs.stat(
        path.join(resolveWorkspaceRuntimeRootSync(projectRoot), 'native/changes/still-running'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow a copied legacy fence when resolving a portable checkout', async () => {
    const source = await nativeProjectPaths(projectRoot, 'docs'),
      original = nativeChangeRuntimeDir(source, 'copied-change'),
      legacy = nativeLegacyChangeRuntimeDir(source, 'copied-change');
    await fs.mkdir(original, { recursive: true });
    await fs.writeFile(path.join(original, 'source-evidence.json'), 'original-data');
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    const marker = JSON.stringify({
      schema: 'comet.workspace-runtime-migration.v1',
      workspaceId: 'old-workspace',
      source: legacy,
      target: original,
      kind: 'directory',
    });
    await fs.writeFile(legacy, marker);
    await fs.cp(path.join(projectRoot, 'docs'), path.join(outside, 'docs'), { recursive: true });
    const copy = await nativeProjectPaths(outside, 'docs'),
      target = nativeChangeRuntimeDir(copy, 'copied-change');
    expect(target).not.toBe(original);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await inspectNativeRuntimeStorage(copy, 'copied-change')).status).toBe('missing');
    expect(await fs.readFile(path.join(original, 'source-evidence.json'), 'utf8')).toBe(
      'original-data',
    );
    expect(await fs.readFile(nativeLegacyChangeRuntimeDir(copy, 'copied-change'), 'utf8')).toBe(
      marker,
    );
  });

  it('isolates equal change names in separate workspaces and rejects linked runtime roots', async () => {
    const first = await nativeProjectPaths(projectRoot, 'docs');
    const second = await nativeProjectPaths(outside, 'docs');
    expect(first.workspaceRuntimeRoot).not.toBe(second.workspaceRuntimeRoot);
    expect(nativePreferredChangeRuntimeDir(first, 'same-name')).not.toBe(
      nativePreferredChangeRuntimeDir(second, 'same-name'),
    );
    await fs.mkdir(path.dirname(first.runtimeDir), { recursive: true });
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
