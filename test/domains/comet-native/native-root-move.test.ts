import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NATIVE_SNAPSHOT_CONFIG,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import { sha256File } from '../../../domains/comet-native/native-hash.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { moveNativeRoot } from '../../../domains/comet-native/native-root-move.js';
import { readNativeTransaction } from '../../../domains/comet-native/native-transaction.js';
import {
  assertNativeWorkspaceBinding,
  inspectNativeWorkspaceAdvisory,
  readNativeWorkspaceIdentity,
  setNativeWorkspaceFinish,
} from '../../../domains/comet-native/native-workspace.js';
import { seedNativeRoot } from '../../helpers/native-root.js';

describe('Native artifact root moves', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-move-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it.each([
    ['.', 'docs'],
    ['docs', '.'],
    ['docs', 'artifacts/native'],
  ])('moves %s to %s with file-by-file hash equivalence', async (from, to) => {
    const source = await seedNativeRoot(projectRoot, from);
    const config = await readProjectConfig(projectRoot);
    config!.native.clarification_mode = 'batch';
    config!.native.archive_confirmation = 'required';
    await writeProjectConfig(projectRoot, config!);
    const sourcePaths = await nativeProjectPaths(projectRoot, from);
    await createNativeChange({
      paths: sourcePaths,
      name: 'identity-change',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    const sourceSpec = path.join(source, 'specs', 'word-count', 'spec.md');
    const sourceBinary = path.join(source, 'changes', 'active-change', 'payload.bin');
    const expected = [await sha256File(sourceSpec), await sha256File(sourceBinary)];

    const result = await moveNativeRoot({
      projectRoot,
      toArtifactRoot: to,
      now: new Date('2026-07-14T03:00:00.000Z'),
    });
    const destinationPaths = await nativeProjectPaths(projectRoot, to);

    expect(result).toMatchObject({
      fromNativeRoot: source,
      toNativeRoot: destinationPaths.nativeRoot,
    });
    expect(await readProjectConfig(projectRoot)).toEqual({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      memory: {
        learning: true,
        retrieval: true,
      },
      knowledge: {
        provider: 'local',
      },
      native: {
        artifact_root: to,
        language: 'en',
        clarification_mode: 'batch',
        archive_confirmation: 'required',
        max_verify_failures: 5,
        snapshot: DEFAULT_NATIVE_SNAPSHOT_CONFIG,
      },
    });
    const workspace = await readNativeWorkspaceIdentity(destinationPaths, 'identity-change');
    expect(workspace).not.toBeNull();
    await expect(
      inspectNativeWorkspaceAdvisory({ paths: destinationPaths, identity: workspace! }),
    ).resolves.toEqual({ state: 'aligned', findingCodes: [], driftComponents: [] });
    expect([
      await sha256File(path.join(destinationPaths.specsDir, 'word-count', 'spec.md')),
      await sha256File(path.join(destinationPaths.changesDir, 'active-change', 'payload.bin')),
    ]).toEqual(expected);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readNativeTransaction(destinationPaths, result.transactionId)).toMatchObject({
      kind: 'root-move',
      status: 'committed',
    });
  });

  it('preserves v3 branch and finishing bindings while refreshing moved root identities', async () => {
    await seedNativeRoot(projectRoot, 'docs');
    await fs.rm(path.join(projectRoot, 'docs/comet/changes/active-change'), {
      recursive: true,
      force: true,
    });
    execFileSync('git', ['config', 'user.email', 'root-move@example.test'], {
      cwd: projectRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Root Move Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const sourcePaths = await nativeProjectPaths(projectRoot, 'docs');
    await createNativeChange({
      paths: sourcePaths,
      name: 'bound-change',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: branch,
        targetBranch: branch,
      },
    });
    await setNativeWorkspaceFinish(sourcePaths, 'bound-change', 'push');

    await moveNativeRoot({ projectRoot, toArtifactRoot: 'artifacts/native' });
    const destinationPaths = await nativeProjectPaths(projectRoot, 'artifacts/native');
    await expect(
      readNativeWorkspaceIdentity(destinationPaths, 'bound-change'),
    ).resolves.toMatchObject({
      schema: 'comet.native.workspace.v3',
      isolation: 'branch',
      changeBranch: branch,
      targetBranch: branch,
      finish: 'push',
    });
    await expect(
      assertNativeWorkspaceBinding(destinationPaths, 'bound-change'),
    ).resolves.toMatchObject({
      schema: 'comet.native.workspace.v3',
    });
  });

  it('stops before moving a root that contains an invalid workspace binding', async () => {
    await seedNativeRoot(projectRoot, 'docs');
    await fs.rm(path.join(projectRoot, 'docs/comet/changes/active-change'), {
      recursive: true,
      force: true,
    });
    execFileSync('git', ['config', 'user.email', 'root-move@example.test'], {
      cwd: projectRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Root Move Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await createNativeChange({
      paths,
      name: 'invalid-binding',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: branch,
        targetBranch: branch,
      },
    });
    const workspaceFile = path.join(
      nativeChangeRuntimeDir(paths, 'invalid-binding'),
      'workspace.json',
    );
    const workspace = JSON.parse(await fs.readFile(workspaceFile, 'utf8')) as Record<
      string,
      unknown
    >;
    workspace.isolation = 'invalid';
    await fs.writeFile(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);

    await expect(
      moveNativeRoot({ projectRoot, toArtifactRoot: 'artifacts/native' }),
    ).rejects.toThrow('must be aligned and repaired before moving the root');
    const config = await readProjectConfig(projectRoot);
    expect(config?.native.artifact_root).toBe('docs');
    expect(config?.native.pending_root_move).toBeUndefined();
    await expect(fs.stat(paths.nativeRoot)).resolves.toBeDefined();
    await expect(fs.access(path.join(projectRoot, 'artifacts/native/comet'))).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
  });

  it('refreshes a valid v3 binding even when the change schema needs a newer runtime', async () => {
    await seedNativeRoot(projectRoot, 'docs');
    await fs.rm(path.join(projectRoot, 'docs/comet/changes/active-change'), {
      recursive: true,
      force: true,
    });
    execFileSync('git', ['config', 'user.email', 'root-move@example.test'], {
      cwd: projectRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Root Move Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const sourcePaths = await nativeProjectPaths(projectRoot, 'docs');
    await createNativeChange({
      paths: sourcePaths,
      name: 'future-bound-change',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: branch,
        targetBranch: branch,
      },
    });
    await setNativeWorkspaceFinish(sourcePaths, 'future-bound-change', 'push');
    const stateFile = path.join(sourcePaths.changesDir, 'future-bound-change', 'comet-state.yaml');
    const state = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(
      stateFile,
      state
        .replace('schema: comet.native.v3', 'schema: comet.native.v4')
        .replace('minimum_runtime_version: 3', 'minimum_runtime_version: 4'),
    );

    await moveNativeRoot({ projectRoot, toArtifactRoot: 'artifacts/native' });
    const destinationPaths = await nativeProjectPaths(projectRoot, 'artifacts/native');
    await expect(
      readNativeWorkspaceIdentity(destinationPaths, 'future-bound-change'),
    ).resolves.toMatchObject({
      schema: 'comet.native.workspace.v3',
      isolation: 'branch',
      changeBranch: branch,
      targetBranch: branch,
      finish: 'push',
    });
    await expect(
      assertNativeWorkspaceBinding(destinationPaths, 'future-bound-change'),
    ).resolves.toMatchObject({ schema: 'comet.native.workspace.v3' });
  });

  it.each([
    ['workspace v3', false],
    ['legacy workspace v2', true],
  ])('moves documents without requiring another worktree Runtime (%s)', async (_label, legacy) => {
    await seedNativeRoot(projectRoot, 'docs');
    await fs.rm(path.join(projectRoot, 'docs/comet/changes/active-change'), {
      recursive: true,
      force: true,
    });
    execFileSync('git', ['config', 'user.email', 'root-move@example.test'], {
      cwd: projectRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Root Move Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await createNativeChange({
      paths,
      name: 'foreign-change',
      language: 'en',
      workspaceBinding: {
        isolation: 'branch',
        changeBranch: branch,
        targetBranch: branch,
      },
    });
    if (legacy) {
      const workspaceFile = path.join(
        nativeChangeRuntimeDir(paths, 'foreign-change'),
        'workspace.json',
      );
      const workspace = JSON.parse(await fs.readFile(workspaceFile, 'utf8')) as Record<
        string,
        unknown
      >;
      workspace.schema = 'comet.native.workspace.v2';
      delete workspace.isolation;
      delete workspace.changeBranch;
      delete workspace.targetBranch;
      delete workspace.finish;
      await fs.writeFile(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);
    }
    execFileSync('git', ['add', '.comet/config.yaml', 'docs/comet/changes/foreign-change'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'capture foreign workspace fixture'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const secondary = path.join(
      os.tmpdir(),
      `comet-native-root-move-foreign-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      execFileSync(
        'git',
        ['worktree', 'add', '-b', `comet/foreign-${legacy ? 'v2' : 'v3'}`, secondary, 'HEAD'],
        { cwd: projectRoot, stdio: 'ignore' },
      );
      await expect(
        moveNativeRoot({ projectRoot: secondary, toArtifactRoot: 'artifacts/native' }),
      ).resolves.toMatchObject({ toNativeRoot: path.join(secondary, 'artifacts/native/comet') });
      expect((await readProjectConfig(secondary))?.native.artifact_root).toBe('artifacts/native');
      const secondaryPaths = await nativeProjectPaths(secondary, 'artifacts/native');
      await expect(
        fs.access(nativeChangeRuntimeDir(secondaryPaths, 'foreign-change')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', secondary], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('refuses an occupied destination without modifying either tree', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const destination = path.join(projectRoot, 'docs', 'comet');
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'sentinel.txt'), 'keep');

    await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
      /occupied/u,
    );
    expect(await fs.stat(source)).toBeTruthy();
    expect(await fs.readFile(path.join(destination, 'sentinel.txt'), 'utf8')).toBe('keep');
    expect((await readProjectConfig(projectRoot))?.native.artifact_root).toBe('.');
  });

  it('refuses symlinks in the persisted Native tree', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const outside = path.join(projectRoot, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(source, 'linked-outside'), 'junction');

    await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
      /contains a symlink/u,
    );
    expect((await readProjectConfig(projectRoot))?.native.pending_root_move?.stage).toBe('copying');
    expect(await fs.stat(source)).toBeTruthy();
  });

  it('fails closed when a source directory is replaced after enumeration', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const sourceParent = path.join(source, 'specs', 'word-count');
    const displaced = path.join(source, 'specs', 'word-count-original');
    const originalReaddir = fs.readdir.bind(fs);
    let replaced = false;
    const readdir = vi.spyOn(fs, 'readdir').mockImplementation(async (...args) => {
      const entries = await originalReaddir(...args);
      if (!replaced && path.resolve(String(args[0])) === path.resolve(sourceParent)) {
        replaced = true;
        await fs.rename(sourceParent, displaced);
        await fs.mkdir(sourceParent);
        await fs.writeFile(path.join(sourceParent, 'spec.md'), 'replacement must not move\n');
      }
      return entries;
    });
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        /parent changed during I\/O/u,
      );
    } finally {
      readdir.mockRestore();
    }

    expect(await fs.readFile(path.join(displaced, 'spec.md'), 'utf8')).not.toContain('replacement');
    expect(await fs.readFile(path.join(sourceParent, 'spec.md'), 'utf8')).toBe(
      'replacement must not move\n',
    );
    await expect(fs.access(path.join(projectRoot, 'docs'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not recursively remove a source root replaced after equivalence checks', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const displaced = path.join(projectRoot, 'comet-original');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          beforeRootMoveSourceRemove: async () => {
            await fs.rename(source, displaced);
            await fs.mkdir(source);
            await fs.writeFile(path.join(source, 'replacement.txt'), 'do not remove\n');
          },
        },
      }),
    ).rejects.toThrow(/changed before quarantine/u);

    expect(await fs.readFile(path.join(source, 'replacement.txt'), 'utf8')).toBe('do not remove\n');
    expect(await fs.readFile(path.join(displaced, 'specs', 'word-count', 'spec.md'), 'utf8')).toBe(
      'count words\n',
    );
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'specs', 'word-count', 'spec.md'),
        'utf8',
      ),
    ).toBe('count words\n');
  });

  it('quarantines first and rejects a child rewritten by the pre-quarantine hook', async () => {
    const source = await seedNativeRoot(projectRoot, '.');
    const sourceSpec = path.join(source, 'specs', 'word-count', 'spec.md');

    await expect(
      moveNativeRoot({
        projectRoot,
        toArtifactRoot: 'docs',
        hooks: {
          beforeRootMoveSourceRemove: async () => {
            await fs.writeFile(sourceSpec, 'rewritten during cleanup\n');
          },
        },
      }),
    ).rejects.toThrow(/cleanup quarantine differs from its bound manifest/u);

    const pending = (await readProjectConfig(projectRoot))?.native.pending_root_move;
    expect(pending?.cleanup).toMatchObject({ kind: 'forward-source', state: 'prepared' });
    const quarantine = path.join(projectRoot, `.comet-native-source-${pending!.id}.removing`);
    await expect(fs.access(source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(quarantine, 'specs', 'word-count', 'spec.md'), 'utf8')).toBe(
      'rewritten during cleanup\n',
    );
    expect(
      await fs.readFile(
        path.join(projectRoot, 'docs', 'comet', 'specs', 'word-count', 'spec.md'),
        'utf8',
      ),
    ).toBe('count words\n');
  });

  it('serializes root moves with archive operations through the global lock', async () => {
    await seedNativeRoot(projectRoot, '.');
    const paths = await nativeProjectPaths(projectRoot, '.');
    const archiveGlobalLock = await acquireNativeLock(paths, 'root-move', 'archive active-change');
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        /already held/u,
      );
    } finally {
      await releaseNativeLock(archiveGlobalLock);
    }
  });

  it('refuses to copy any unresolved operation lock into the destination root', async () => {
    await seedNativeRoot(projectRoot, '.');
    const paths = await nativeProjectPaths(projectRoot, '.');
    const staleArchiveLock = await acquireNativeLock(
      paths,
      'archive',
      'archive interrupted-change',
    );
    try {
      await expect(moveNativeRoot({ projectRoot, toArtifactRoot: 'docs' })).rejects.toThrow(
        'must be diagnosed before moving',
      );
      expect((await readProjectConfig(projectRoot))?.native).toEqual({
        artifact_root: '.',
        language: 'en',
        clarification_mode: 'batch',
        archive_confirmation: 'automatic',
        max_verify_failures: 5,
        snapshot: DEFAULT_NATIVE_SNAPSHOT_CONFIG,
      });
      await expect(fs.access(path.join(projectRoot, 'docs', 'comet'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await releaseNativeLock(staleArchiveLock);
    }
  });
});
