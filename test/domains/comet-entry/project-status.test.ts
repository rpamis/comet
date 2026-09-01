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
import { createNativePortableChange } from '../../../domains/comet-native/native-portable-runtime.js';

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

function bothProjectConfig(nativeRoot: string) {
  const config = defaultProjectConfig(nativeRoot);
  config.workflows = ['native', 'classic'];
  config.classic = { artifact_layout: 'legacy', language: 'en' };
  return config;
}

async function writeClassicOnlyConfig(projectRoot: string): Promise<void> {
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      '  artifact_layout: legacy',
      '  language: en',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function initializeClassicChange(projectRoot: string, name: string): Promise<void> {
  await fs.mkdir(path.join(projectRoot, 'openspec'), { recursive: true });
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

    const status = await inspectCometProjectStatus(projectRoot);
    expect(status).toMatchObject({
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
    expect(status.workflows.classic).toEqual({ changes: [] });
    expect(status.workflows.classic.error).toBeUndefined();

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
              nextCommand: 'comet native next native-only --summary "<summary>" --confirmed',
            },
          ],
        },
      },
    });
  });

  it('uses the portable status projection for Native v4 changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await createNativePortableChange({ paths, name: 'native-v4', language: 'en' });

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.native.changes).toEqual([
      expect.objectContaining({
        name: 'native-v4',
        phase: 'shape',
        status: 'active',
        stateVersion: 1,
        verificationResult: 'pending',
        continuation: expect.objectContaining({ action: 'confirm-shape' }),
      }),
    ]);
  });

  it('keeps plain OpenSpec changes outside both Comet workflows', async () => {
    await writeClassicOnlyConfig(projectRoot);
    const changeDir = path.join(projectRoot, 'openspec', 'changes', 'plain-change');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] done\n');

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.defaultEntry).toEqual({
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'project-config',
    });
    expect(status.workflows.native.changes).toEqual([]);
    expect(status.workflows.classic.changes).toEqual([]);
    expect(status.unmanagedOpenSpec).toEqual([
      expect.objectContaining({
        name: 'plain-change',
        cometManaged: false,
        archiveReady: true,
        recommendedArchiveCommand: 'comet classic openspec -- archive plain-change -y',
        tasksCompleted: 1,
        tasksTotal: 1,
      }),
    ]);
  });

  it('fails closed for a valid Classic change name backed by a directory link', async () => {
    await writeClassicOnlyConfig(projectRoot);
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-status-outside-'));
    try {
      await fs.writeFile(path.join(outsideRoot, 'tasks.md'), '- [x] outside task\n', 'utf8');
      await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });
      await fs.symlink(
        outsideRoot,
        path.join(projectRoot, 'openspec', 'changes', 'unsafe-change'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const status = await inspectCometProjectStatus(projectRoot);

      expect(status.unmanagedOpenSpec).toEqual([]);
      expect(status.workflows.classic.changes).toEqual([
        expect.objectContaining({
          name: 'unsafe-change',
          phase: 'invalid',
          tasksCompleted: 0,
          tasksTotal: 0,
          error: expect.stringMatching(/symbolic link or junction/iu),
        }),
      ]);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when a Classic runtime directory is a directory link', async () => {
    await writeClassicOnlyConfig(projectRoot);
    await initializeClassicChange(projectRoot, 'unsafe-runtime');
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-runtime-outside-'));
    try {
      await fs.symlink(
        outsideRoot,
        path.join(projectRoot, 'openspec', 'changes', 'unsafe-runtime', '.comet'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const status = await inspectCometProjectStatus(projectRoot);

      expect(status.workflows.classic.changes).toEqual([
        expect.objectContaining({
          name: 'unsafe-runtime',
          phase: 'invalid',
          error: expect.stringMatching(/symbolic link or junction/iu),
        }),
      ]);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('reports configured Classic as unavailable when its root is missing', async () => {
    await writeClassicOnlyConfig(projectRoot);

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.classic).toEqual({
      changes: [],
      error: expect.stringContaining('Configured Classic OpenSpec root is missing'),
    });
    expect(status.unmanagedOpenSpec).toEqual([]);
  });

  it('reports Classic-managed changes only in the Classic workflow', async () => {
    await writeClassicOnlyConfig(projectRoot);
    await initializeClassicChange(projectRoot, 'classic-only');

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

  it('reports Classic unavailable without guessing a legacy root when project config is malformed', async () => {
    await writeClassicOnlyConfig(projectRoot);
    await initializeClassicChange(projectRoot, 'classic-survives');
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
    expect(status.workflows.classic).toEqual({
      changes: [],
      error: expect.stringContaining('Invalid'),
    });
    expect(status.unmanagedOpenSpec).toEqual([]);
  });

  it('reports only the configured Classic root when a standalone root coexists', async () => {
    const config = defaultProjectConfig('docs');
    config.default_workflow = 'classic';
    config.workflows = ['classic'];
    config.classic = { artifact_layout: 'docs' };
    await writeProjectConfig(projectRoot, config);
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'legacy'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'docs', 'openspec', 'changes', 'configured'), {
      recursive: true,
    });

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.classic).toEqual({ changes: [] });
    expect(status.unmanagedOpenSpec).toEqual([
      expect.objectContaining({ name: 'configured', cometManaged: false }),
    ]);
  });

  it.each(['changes-root', 'change-dir'] as const)(
    'does not inspect project-external Classic state through a %s junction',
    async (kind) => {
      await writeClassicOnlyConfig(projectRoot);
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-status-outside-'));
      try {
        await fs.writeFile(
          path.join(outsideRoot, '.comet.yaml'),
          'workflow: TOP_SECRET\nphase: build\n',
          'utf8',
        );
        await fs.writeFile(path.join(outsideRoot, 'tasks.md'), '- [ ] external secret\n', 'utf8');
        const changesRoot = path.join(projectRoot, 'openspec', 'changes');
        const target =
          kind === 'changes-root' ? changesRoot : path.join(changesRoot, 'external-change');
        await fs.mkdir(path.dirname(target), { recursive: true });
        try {
          await fs.symlink(outsideRoot, target, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
          throw error;
        }

        const status = await inspectCometProjectStatus(projectRoot);

        if (kind === 'changes-root') {
          expect(status.workflows.classic.changes).toEqual([]);
          expect(status.workflows.classic.error).toMatch(/symbolic link or junction/iu);
        } else {
          expect(status.workflows.classic.error).toBeUndefined();
          expect(status.workflows.classic.changes).toEqual([
            expect.objectContaining({
              name: 'external-change',
              phase: 'invalid',
              error: expect.stringMatching(/symbolic link or junction/iu),
            }),
          ]);
        }
        expect(status.unmanagedOpenSpec).toEqual([]);
        expect(JSON.stringify(status)).not.toContain('TOP_SECRET');
        expect(JSON.stringify(status)).not.toContain('external secret');
      } finally {
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('ignores unrelated invalid names but fails closed for a legal-name non-directory', async () => {
    await writeClassicOnlyConfig(projectRoot);
    const changesRoot = path.join(projectRoot, 'openspec', 'changes');
    await fs.mkdir(changesRoot, { recursive: true });
    await fs.writeFile(path.join(changesRoot, 'README.md'), 'ignore\n', 'utf8');
    await fs.writeFile(path.join(changesRoot, 'legal-name'), 'not a change directory\n', 'utf8');

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.classic.error).toBeUndefined();
    expect(status.workflows.classic.changes).toEqual([
      expect.objectContaining({
        name: 'legal-name',
        phase: 'invalid',
        error: expect.stringMatching(/must be a real directory/iu),
      }),
    ]);
    expect(status.unmanagedOpenSpec).toEqual([]);
  });

  it('keeps same-name Native and Classic changes separate under a custom artifact root', async () => {
    await writeProjectConfig(projectRoot, bothProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'shared-name', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    await initializeClassicChange(projectRoot, 'shared-name');
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
    await writeProjectConfig(projectRoot, bothProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'nested-native', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    await initializeClassicChange(projectRoot, 'nested-classic');
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
    await writeProjectConfig(projectRoot, bothProjectConfig('.'));
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

    await initializeClassicChange(projectRoot, 'classic-healthy');
    await initializeClassicChange(projectRoot, 'classic-broken');
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

  it('keeps an unreadable portable change as an error entry instead of failing the Native section', async () => {
    await writeProjectConfig(projectRoot, bothProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    await createNativePortableChange({ paths, name: 'native-healthy', language: 'en' });
    const staleDir = path.join(paths.changesDir, 'native-stale-copy');
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(
      path.join(staleDir, 'comet-state.yaml'),
      'schema: comet.native.v4\nphase: [\n',
    );

    const status = await inspectCometProjectStatus(projectRoot);

    expect(status.workflows.native.error).toBeUndefined();
    expect(status.workflows.native.changes).toEqual([
      expect.objectContaining({ name: 'native-healthy' }),
      expect.objectContaining({ name: 'native-stale-copy', error: expect.any(String) }),
    ]);
  });

  it('reads mixed Native, Classic, and OpenSpec status without changing project files', async () => {
    await writeProjectConfig(projectRoot, bothProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const native = await createNativeChange({ paths, name: 'native-readonly', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, native.name), native.brief), VALID_BRIEF);
    await initializeClassicChange(projectRoot, 'classic-readonly');
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
