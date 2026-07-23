import { promises as fs } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectCometProjectStatus } from '../../../domains/comet-entry/project-status.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';

const VALID_BRIEF = `# Outcome
Ship one outcome.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Keep workflows separate.
# Decisions
Use Native state.
# Open questions
None.
# Verification expectations
Run focused checks.
`;

const classicStateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');

function initializeClassicChange(projectRoot: string, name: string): void {
  const result = spawnSync(process.execPath, [classicStateScript, 'init', name, 'full'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        snapshot[`${relative}/`] = 'directory';
        await visit(absolute);
      } else {
        snapshot[relative] = (await fs.readFile(absolute)).toString('base64');
      }
    }
  }
  await visit(root);
  return snapshot;
}

describe('Comet project status', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-status-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('partitions configured Native changes under a versioned status contract', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({ paths, name: 'native-only', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, state.name), state.brief), VALID_BRIEF);

    await expect(inspectCometProjectStatus(projectRoot)).resolves.toMatchObject({
      schema: 'comet.status.v2',
      defaultEntry: {
        workflow: 'native',
        skill: 'comet-native',
        source: 'project-config',
      },
      workflows: {
        native: {
          changes: [
            {
              name: 'native-only',
              phase: 'shape',
              nextCommand: 'comet native next native-only --summary "<summary>" --confirmed',
            },
          ],
        },
        classic: { changes: [] },
      },
      unmanagedOpenSpec: [],
    });

    await writeProjectConfig(projectRoot, {
      ...defaultProjectConfig('.'),
      native: {
        ...defaultProjectConfig('.').native,
        clarification_mode: 'batch',
      },
    });
    await expect(inspectCometProjectStatus(projectRoot)).resolves.toMatchObject({
      workflows: {
        native: {
          changes: [
            {
              name: 'native-only',
              phase: 'shape',
              nextCommand: 'comet native next native-only --summary "<summary>"',
            },
          ],
        },
      },
    });
  });

  it('keeps plain OpenSpec changes outside both Comet workflows', async () => {
    const changeDir = path.join(projectRoot, 'openspec', 'changes', 'plain-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.defaultEntry).toEqual({
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'legacy-fallback',
    });
    expect(status.workflows.native.changes).toEqual([]);
    expect(status.workflows.classic.changes).toEqual([]);
    expect(status.unmanagedOpenSpec).toEqual([
      expect.objectContaining({
        name: 'plain-change',
        cometManaged: false,
        archiveReady: true,
        tasksCompleted: 1,
        tasksTotal: 1,
      }),
    ]);
  });

  it('reports Classic-managed changes only in the Classic workflow', async () => {
    initializeClassicChange(projectRoot, 'classic-only');

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.native.changes).toEqual([]);
    expect(status.workflows.classic.changes).toEqual([
      expect.objectContaining({
        name: 'classic-only',
        cometManaged: true,
        workflow: 'full',
        phase: 'open',
        recommendedArchiveCommand: 'comet archive classic-only',
      }),
    ]);
    expect(status.unmanagedOpenSpec).toEqual([]);
  });

  it('keeps Classic and unmanaged OpenSpec visible when project config is malformed', async () => {
    initializeClassicChange(projectRoot, 'classic-survives');
    const unmanagedDir = path.join(projectRoot, 'openspec', 'changes', 'plain-survives');
    await fs.mkdir(unmanagedDir, { recursive: true });
    await fs.writeFile(path.join(unmanagedDir, 'tasks.md'), '- [ ] todo\n');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'schema: [broken\n');

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.defaultEntry).toEqual({ error: expect.stringContaining('Invalid') });
    expect(status.workflows.native).toEqual({
      changes: [],
      error: expect.stringContaining('Invalid'),
    });
    expect(status.workflows.classic.changes.map((change) => change.name)).toEqual([
      'classic-survives',
    ]);
    expect(status.unmanagedOpenSpec.map((change) => change.name)).toEqual(['plain-survives']);
  });

  it('keeps same-name Native and Classic changes separate under a custom artifact root', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'shared-name', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    initializeClassicChange(projectRoot, 'shared-name');
    const unmanagedDir = path.join(projectRoot, 'openspec', 'changes', 'plain-change');
    await fs.mkdir(unmanagedDir, { recursive: true });

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.native.changes.map((change) => change.name)).toEqual(['shared-name']);
    expect(status.workflows.classic.changes.map((change) => change.name)).toEqual(['shared-name']);
    expect(status.unmanagedOpenSpec.map((change) => change.name)).toEqual(['plain-change']);
  });

  it('reports an incomplete Native artifact-root move instead of projecting stale changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    const native = await createNativeChange({ paths, name: 'stale-change', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    const config = defaultProjectConfig('.');
    config.native.pending_root_move = {
      id: 'deadbeef-0001',
      fromArtifactRoot: '.',
      toArtifactRoot: 'docs',
      stage: 'copying',
    };
    await writeProjectConfig(projectRoot, config);

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.defaultEntry).toMatchObject({ workflow: 'native' });
    expect(status.workflows.native).toEqual({
      changes: [],
      error: expect.stringContaining('comet native doctor --repair'),
    });
  });

  it('discovers the configured project from a nested working directory', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'nested-native', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    initializeClassicChange(projectRoot, 'nested-classic');
    const nested = path.join(projectRoot, 'src', 'feature');
    await fs.mkdir(nested, { recursive: true });

    const status = await inspectCometProjectStatus(nested);

    expect(status.defaultEntry).toMatchObject({ workflow: 'native' });
    expect(status.workflows.native.changes.map((change) => change.name)).toEqual(['nested-native']);
    expect(status.workflows.classic.changes.map((change) => change.name)).toEqual([
      'nested-classic',
    ]);
  });

  it('does not let corrupt changes on either workflow hide healthy changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    const healthyNative = await createNativeChange({
      paths,
      name: 'native-healthy',
      language: 'en',
    });
    await fs.writeFile(
      path.join(nativeChangeDir(paths, healthyNative.name), healthyNative.brief),
      VALID_BRIEF,
    );
    const brokenNativeDir = path.join(paths.changesDir, 'native-broken');
    await fs.mkdir(brokenNativeDir, { recursive: true });
    await fs.writeFile(path.join(brokenNativeDir, 'comet-state.yaml'), 'schema: [broken\n');

    initializeClassicChange(projectRoot, 'classic-healthy');
    initializeClassicChange(projectRoot, 'classic-broken');
    await fs.appendFile(
      path.join(projectRoot, 'openspec', 'changes', 'classic-broken', '.comet.yaml'),
      'unknown_field: true\n',
    );

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.native.changes).toEqual([
      expect.objectContaining({
        name: 'native-broken',
        phase: 'invalid',
        error: expect.any(String),
      }),
      expect.objectContaining({ name: 'native-healthy', phase: 'shape' }),
    ]);
    expect(status.workflows.classic.changes).toEqual([
      expect.objectContaining({
        name: 'classic-broken',
        phase: 'invalid',
        error: expect.any(String),
      }),
      expect.objectContaining({ name: 'classic-healthy', phase: 'open' }),
    ]);
  });

  it('reads mixed Native, Classic, and OpenSpec status without changing project files', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'native-readonly', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    initializeClassicChange(projectRoot, 'classic-readonly');
    const classicState = path.join(
      projectRoot,
      'openspec',
      'changes',
      'classic-readonly',
      '.comet.yaml',
    );
    await fs.appendFile(classicState, 'build_command: pnpm build\n');
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'plain-readonly'));
    const before = await snapshotTree(projectRoot);

    await inspectCometProjectStatus(projectRoot);

    expect(await snapshotTree(projectRoot)).toEqual(before);
  });
});
