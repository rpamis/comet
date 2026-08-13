import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  assertNativeWorkspaceBindingCurrent,
  inspectNativeWorkspaceBinding,
  inspectNativeWorkspaceAdvisory,
  inspectNativeWorkspaceIdentity,
  nativeWorkspaceFile,
  projectNativeWorkspace,
  readNativeWorkspaceIdentity,
  resolveNativeWorkspaceBinding,
  setNativeWorkspaceFinish,
  writeNativeWorkspaceIdentity,
} from '../../../domains/comet-native/native-workspace.js';

describe('Native workspace identity', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-workspace-'));
    await fs.mkdir(path.join(projectRoot, 'docs', 'comet', 'changes', 'example', 'runtime'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('stores only process-free hashes and project-relative refs', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 7,
      sessionId: 'raw-session-secret',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    const serialized = JSON.stringify(identity);

    expect(identity).toMatchObject({
      schema: 'comet.native.workspace.v2',
      nativeRootRef: 'docs/comet',
      capturedRevision: 7,
      capturedAt: '2026-07-17T00:00:00.000Z',
      projectRootId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      nativeRootId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      projectRootPathId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      nativeRootPathId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      sessionHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain('raw-session-secret');
    expect(serialized).not.toMatch(/\b(?:git|head|branch|worktree|commonDir)\b/iu);
  });

  it('writes and reads bounded local workspace metadata atomically', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
    });

    await expect(readNativeWorkspaceIdentity(paths, 'example')).resolves.toEqual(written);
    await expect(inspectNativeWorkspaceAdvisory({ paths, identity: written })).resolves.toEqual({
      state: 'aligned',
      findingCodes: [],
      driftComponents: [],
    });
  });

  it('persists new isolation bindings without migrating legacy identities', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      binding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });

    expect(written).toMatchObject({
      schema: 'comet.native.workspace.v3',
      isolation: 'current',
      changeBranch: null,
      targetBranch: null,
      finish: null,
    });
    await expect(inspectNativeWorkspaceBinding({ paths, identity: written })).resolves.toEqual({
      state: 'aligned',
      code: null,
      message: null,
    });
  });

  it('does not treat legacy target-branch provenance as a change-branch binding', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.mkdir(paths.runtimeDir, { recursive: true });
    await writeNativeWorkspaceIdentity({
      paths,
      name: 'legacy-example',
      revision: 1,
      binding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });
    const file = nativeWorkspaceFile(paths, 'legacy-example');
    const identity = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    delete identity.schema;
    identity.schema = 'comet.native.workspace.v2';
    delete identity.isolation;
    delete identity.changeBranch;
    delete identity.targetBranch;
    delete identity.finish;
    identity.git = {
      provider: 'git',
      baseCommit: 'a'.repeat(40),
      targetBranch: 'main',
      targetCommit: 'b'.repeat(40),
    };
    await fs.writeFile(file, JSON.stringify(identity));

    await expect(projectNativeWorkspace(paths, 'legacy-example')).resolves.toMatchObject({
      bindingState: 'legacy',
      changeBranch: null,
      targetBranch: 'main',
    });
  });

  it('persists the selected finishing action for isolated changes', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'workspace@example.test'], {
      cwd: projectRoot,
    });
    execFileSync('git', ['config', 'user.name', 'Workspace Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/example'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      binding: {
        isolation: 'branch',
        changeBranch: 'comet/example',
        targetBranch: 'main',
      },
    });

    await expect(setNativeWorkspaceFinish(paths, 'example', 'merge')).resolves.toMatchObject({
      schema: 'comet.native.workspace.v3',
      finish: 'merge',
    });
    await expect(readNativeWorkspaceIdentity(paths, 'example')).resolves.toMatchObject({
      finish: 'merge',
    });
  });

  it('reports a copied identity as root drift without executing VCS commands', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
    });
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-workspace-copy-'));
    try {
      await fs.mkdir(path.join(otherRoot, 'docs', 'comet'), { recursive: true });
      const copiedPaths = await nativeProjectPaths(otherRoot, 'docs');
      await expect(
        inspectNativeWorkspaceAdvisory({ paths: copiedPaths, identity }),
      ).resolves.toEqual({
        state: 'drifted',
        findingCodes: ['workspace-root-changed'],
        driftComponents: ['project-root-path', 'native-root-path'],
      });
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it('identifies native-root-ref drift separately from physical root drift', async () => {
    const originalPaths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths: originalPaths,
      name: 'example',
      revision: 1,
    });
    await fs.mkdir(path.join(projectRoot, 'other', 'comet'), { recursive: true });
    const movedPaths = await nativeProjectPaths(projectRoot, 'other');

    await expect(
      inspectNativeWorkspaceAdvisory({ paths: movedPaths, identity }),
    ).resolves.toMatchObject({
      state: 'drifted',
      findingCodes: ['workspace-root-changed'],
      driftComponents: ['native-root-ref', 'native-root-path'],
    });
  });

  it('does not report Windows root drift from legacy physical hashes alone', async () => {
    if (process.platform !== 'win32') return;
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
    });
    const legacy = { ...identity } as Record<string, unknown>;
    delete legacy.projectRootPathId;
    delete legacy.nativeRootPathId;
    legacy.projectRootId = 'a'.repeat(64);
    legacy.nativeRootId = 'b'.repeat(64);

    await expect(
      inspectNativeWorkspaceAdvisory({ paths, identity: legacy as never }),
    ).resolves.toEqual({
      state: 'unknown',
      findingCodes: ['workspace-inspection-unavailable'],
      driftComponents: ['project-root-legacy-identity', 'native-root-legacy-identity'],
    });
  });

  it('rejects non-portable refs and unknown fields', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
    });
    const file = path.join(projectRoot, 'docs/comet/changes/example/runtime/workspace.json');

    await fs.writeFile(file, JSON.stringify({ ...written, nativeRootRef: '../other' }));
    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow(
      'project-relative path',
    );

    await fs.writeFile(file, JSON.stringify({ ...written, rawPath: projectRoot }));
    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow('unknown field');
  });

  it('ignores legacy Git-backed v1 metadata as a non-blocking advisory', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const file = path.join(projectRoot, 'docs/comet/changes/example/runtime/workspace.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: 'comet.native.workspace.v1',
        capturedAt: '2026-07-17T00:00:00.000Z',
        capturedRevision: 1,
        nativeRootRef: 'docs/comet',
        vcs: { kind: 'git', head: 'legacy' },
      }),
    );

    await expect(readNativeWorkspaceIdentity(paths, 'example')).resolves.toBeNull();
  });

  it('rejects symlinked identity files instead of following them', async () => {
    if (process.platform === 'win32') return;
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const file = path.join(projectRoot, 'docs/comet/changes/example/runtime/workspace.json');
    const outside = path.join(projectRoot, 'outside.json');
    await fs.writeFile(outside, '{}');
    await fs.symlink(outside, file);

    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow('regular file');
  });

  it('resolves and rechecks current, branch, and worktree bindings against Git', async () => {
    expect(resolveNativeWorkspaceBinding({ projectRoot, isolation: 'current' })).toEqual({
      isolation: 'current',
      changeBranch: null,
      targetBranch: null,
    });
    await expect(() =>
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'branch', targetBranch: 'main' }),
    ).toThrow(/require a Git/u);

    execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'workspace@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Workspace Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/example'], { cwd: projectRoot, stdio: 'ignore' });

    expect(resolveNativeWorkspaceBinding({ projectRoot, isolation: 'current' })).toEqual({
      isolation: 'current',
      changeBranch: 'comet/example',
      targetBranch: 'comet/example',
    });
    expect(
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'branch', targetBranch: 'main' }),
    ).toEqual({ isolation: 'branch', changeBranch: 'comet/example', targetBranch: 'main' });
    expect(() =>
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'worktree', targetBranch: 'main' }),
    ).toThrow(/linked Git worktree/u);
    expect(() =>
      resolveNativeWorkspaceBinding({
        projectRoot,
        isolation: 'branch',
        changeBranch: 'wrong-branch',
        targetBranch: 'main',
      }),
    ).toThrow(/does not match/u);
    expect(() =>
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'branch', targetBranch: 'missing' }),
    ).toThrow(/verified local branch/u);
    expect(() => resolveNativeWorkspaceBinding({ projectRoot, isolation: 'branch' })).toThrow(
      /requires --target-branch/u,
    );

    const expected = {
      isolation: 'branch' as const,
      changeBranch: 'comet/example',
      targetBranch: 'main',
    };
    expect(() => assertNativeWorkspaceBindingCurrent(projectRoot, expected)).not.toThrow();
    expect(() =>
      assertNativeWorkspaceBindingCurrent(projectRoot, { ...expected, changeBranch: 'other' }),
    ).toThrow(/does not match/u);

    execFileSync('git', ['switch', '--detach'], { cwd: projectRoot, stdio: 'ignore' });
    expect(() => resolveNativeWorkspaceBinding({ projectRoot, isolation: 'current' })).toThrow(
      /detached HEAD/u,
    );
  });

  it('rejects isolated bindings outside a Git project and invalid binding fields', async () => {
    await expect(() =>
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'branch', targetBranch: 'main' }),
    ).toThrow(/require a Git/u);
    await expect(() =>
      resolveNativeWorkspaceBinding({ projectRoot, isolation: 'current', changeBranch: 'main' }),
    ).toThrow(/require a Git/u);

    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      binding: { isolation: 'current', changeBranch: null, targetBranch: null },
    });
    const file = nativeWorkspaceFile(paths, 'example');
    await fs.writeFile(file, JSON.stringify({ ...written, isolation: 'invalid' }));
    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow(/isolation/u);
    const incompletePathIdentity = { ...written } as Record<string, unknown>;
    delete incompletePathIdentity.nativeRootPathId;
    await fs.writeFile(file, JSON.stringify(incompletePathIdentity));
    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow(
      /provided together/u,
    );
  });
});
