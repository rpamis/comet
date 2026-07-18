import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { inspectNativeHookGuard } from '../../../domains/comet-native/native-hook-guard.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { selectNativeChange } from '../../../domains/comet-native/native-selection.js';

describe('Native phase Hook guard', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-hook-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('blocks implementation writes while an active change is in Shape', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    await createNativeChange({ paths, name: 'guard-shape', language: 'en' });

    await expect(inspectNativeHookGuard(projectRoot, 'src/index.ts')).resolves.toMatchObject({
      allowed: false,
      phase: 'shape',
      change: 'guard-shape',
    });
  });

  it('allows Native artifacts and projects without an active change', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(
      inspectNativeHookGuard(projectRoot, 'docs/comet/changes/example/brief.md'),
    ).resolves.toMatchObject({ allowed: true, reason: 'Native control artifact write' });
    await expect(inspectNativeHookGuard(projectRoot, 'src/index.ts')).resolves.toMatchObject({
      allowed: true,
      reason: 'No Native changes exist',
    });
  });

  it('does not guard a Classic-only project', async () => {
    const config = defaultProjectConfig('.');
    config.default_workflow = 'classic';
    config.workflows = ['classic'];
    await writeProjectConfig(projectRoot, config);

    await expect(inspectNativeHookGuard(projectRoot, 'src/index.ts')).resolves.toMatchObject({
      allowed: true,
      reason: 'Native workflow is not enabled',
    });
  });

  it('uses the selected change when multiple Native changes are active', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await ensureNativeDirectories(paths);
    await createNativeChange({ paths, name: 'shape-change', language: 'en' });
    const buildChange = await createNativeChange({
      paths,
      name: 'build-change',
      language: 'en',
    });
    buildChange.phase = 'build';
    await writeNativeChange(paths, buildChange);
    await selectNativeChange(paths, 'build-change');

    await expect(inspectNativeHookGuard(projectRoot, 'src/index.ts')).resolves.toMatchObject({
      allowed: true,
      phase: 'build',
      change: 'build-change',
    });
  });
});
