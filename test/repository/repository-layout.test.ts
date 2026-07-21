import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  readRepositoryLayout,
  resolveRepositoryPath,
} from '../../platform/paths/repository-layout.js';

describe('repository layout registry', () => {
  it('resolves the manifest and classic script output paths', () => {
    const layout = readRepositoryLayout();

    expect(layout.assetsRoot).toBe('assets');
    expect(layout.manifestPath).toBe('assets/manifest.json');
    expect(layout.classicRuntime.outputs).toMatchObject({
      runtime: 'assets/skills/comet/scripts/comet-runtime.mjs',
      state: 'assets/skills/comet/scripts/comet-state.mjs',
      guard: 'assets/skills/comet/scripts/comet-guard.mjs',
      archive: 'assets/skills/comet/scripts/comet-archive.mjs',
      intent: 'assets/skills/comet/scripts/comet-intent.mjs',
    });
    expect(Object.values(layout.classicRuntime.outputs)).toContain(
      'assets/skills/comet/scripts/comet-runtime.mjs',
    );
    expect(resolveRepositoryPath(layout.classicRuntime.outputs.state)).toBe(
      path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs'),
    );
    expect(layout.nativeRuntime).toEqual({
      entries: { runtime: 'domains/comet-native/native-cli-entry.ts' },
      outputs: {
        runtime: 'assets/skills/comet-native/scripts/comet-native-runtime.mjs',
      },
    });
    expect(resolveRepositoryPath(layout.nativeRuntime.outputs.runtime)).toBe(
      path.resolve('assets', 'skills', 'comet-native', 'scripts', 'comet-native-runtime.mjs'),
    );
    expect(layout.entryRuntime).toEqual({
      entries: {
        runtime: 'domains/comet-entry/entry-runtime-entry.ts',
        hookRouter: 'domains/comet-entry/hook-router-entry.ts',
      },
      outputs: {
        runtime: 'assets/skills/comet/scripts/comet-entry-runtime.mjs',
        hookRouter: 'assets/skills/comet/scripts/comet-hook-router.mjs',
      },
    });
    expect(resolveRepositoryPath(layout.entryRuntime.outputs.runtime)).toBe(
      path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-entry-runtime.mjs'),
    );
  });

  it('tracks active source roots', () => {
    const layout = readRepositoryLayout();

    expect(layout.sourceRoots).toEqual(['app', 'domains', 'platform']);
    expect(layout.appModules).toEqual(['cli', 'commands']);
    expect(layout.domainModules).toEqual([
      'bundle',
      'comet-classic',
      'comet-entry',
      'comet-native',
      'dashboard',
      'engine',
      'eval',
      'factory',
      'integrations',
      'skill',
      'workflow-contract',
    ]);
    expect(layout.platformModules).toEqual(['fs', 'install', 'paths', 'process', 'version']);
    expect(layout.scriptModules).toEqual([
      'benchmark',
      'build',
      'install',
      'lib',
      'lint',
      'release',
    ]);
    expect(layout.allowedTopLevelEntries).toContain('app');
    expect(layout.allowedTopLevelEntries).toContain('domains');
    expect(layout.allowedTopLevelEntries).toContain('platform');
    expect(layout.allowedTopLevelEntries).toContain('.superpowers');
    expect(layout.allowedTopLevelEntries).toContain('codecov.yml');
    expect(layout.allowedTopLevelEntries).not.toContain('src');
  });
});
