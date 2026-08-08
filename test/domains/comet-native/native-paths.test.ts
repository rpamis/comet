import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
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

    await expect(nativeProjectPaths(projectRoot, 'docs')).rejects.toThrow(
      'Native Runtime root resolves outside the project root',
    );
  });

  it('keeps Runtime project-local when the document artifact root changes', async () => {
    const rootPaths = await nativeProjectPaths(projectRoot, '.');
    const docsPaths = await nativeProjectPaths(projectRoot, 'docs');

    expect(rootPaths.runtimeDir).toBe(path.join(projectRoot, '.comet', 'runtime', 'native'));
    expect(docsPaths.runtimeDir).toBe(rootPaths.runtimeDir);
    expect(nativePreferredChangeRuntimeDir(docsPaths, 'focused-change')).toBe(
      path.join(projectRoot, '.comet', 'runtime', 'native', 'changes', 'focused-change'),
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
      layout: 'project-local',
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
    expect(nativeChangeRuntimeDir(paths, name)).toBe(legacy);

    await fs.mkdir(preferred, { recursive: true });
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'invalid',
      layout: 'project-local',
      message: 'Both project-local and legacy Native Runtime directories exist',
    });

    await fs.rm(legacy, { recursive: true });
    await fs.rm(preferred, { recursive: true });
    await fs.writeFile(preferred, 'not a directory');
    await expect(inspectNativeRuntimeStorage(paths, name)).resolves.toMatchObject({
      status: 'invalid',
      layout: 'project-local',
      message: 'Native Runtime path must be a real directory',
    });
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
