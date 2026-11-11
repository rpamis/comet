import '../../helpers/isolated-agent-home.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  clearNativeSelection,
  nativeSelectionFile,
  resolveSelectedNativeChange,
  selectNativeChange,
} from '../../../domains/comet-native/native-selection.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native current change selection', () => {
  let projectRoot: string;
  let outside: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-selection-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-selection-outside-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('stores the Native owner in the shared project selection', async () => {
    await createNativePortableChange({
      paths,
      name: 'selected-change',
      language: 'en',
    });
    await selectNativeChange(paths, 'selected-change');

    expect(await resolveSelectedNativeChange(paths)).toBe('selected-change');
    expect(nativeSelectionFile(paths)).toBe(
      path.join(projectRoot, '.comet', 'current-change.json'),
    );
    expect(JSON.parse(await fs.readFile(nativeSelectionFile(paths), 'utf8'))).toEqual({
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'selected-change',
      branch: null,
    });

    await clearNativeSelection(paths);
    expect(await resolveSelectedNativeChange(paths)).toBeNull();
  });

  it('refuses to select a missing active change', async () => {
    await expect(selectNativeChange(paths, 'missing-change')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses a shared selection directory junction before writing outside the project', async () => {
    await createNativePortableChange({
      paths,
      name: 'selected-change',
      language: 'en',
    });
    const stateFile = path.join(paths.changesDir, 'selected-change', 'comet-state.yaml');
    const stateBefore = await fs.readFile(stateFile, 'utf8');
    const outsideBefore = await fs.readdir(outside);
    const selectionDirectory = path.dirname(nativeSelectionFile(paths));
    await fs.rm(selectionDirectory, { recursive: true, force: true });
    await fs.symlink(
      outside,
      selectionDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(selectNativeChange(paths, 'selected-change')).rejects.toThrow(
      /symbolic link|junction|resolves outside|real directory/u,
    );
    await expect(fs.access(nativeSelectionFile(paths))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(path.join(outside, 'current-change.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(stateFile, 'utf8')).toBe(stateBefore);
    expect(await fs.readdir(outside)).toEqual(outsideBefore);
  });
});
