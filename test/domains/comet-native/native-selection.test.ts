import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { createNativeChange } from '../../../domains/comet-native/native-change.js';
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
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-selection-'));
    paths = await nativeProjectPaths(projectRoot, '.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('stores selection only in the Native runtime', async () => {
    await createNativeChange({ paths, name: 'selected-change', language: 'en' });
    await selectNativeChange(paths, 'selected-change');

    expect(await resolveSelectedNativeChange(paths)).toBe('selected-change');
    expect(nativeSelectionFile(paths)).toBe(
      path.join(projectRoot, 'comet', 'runtime', 'current-change.json'),
    );
    await expect(fs.access(path.join(projectRoot, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await clearNativeSelection(paths);
    expect(await resolveSelectedNativeChange(paths)).toBeNull();
  });

  it('refuses to select a missing active change', async () => {
    await expect(selectNativeChange(paths, 'missing-change')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
