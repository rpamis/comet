import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitRepositoryInspection } from '../../../platform/process/git-repository.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  inspectNativeWorkspaceAdvisory,
  inspectNativeWorkspaceIdentity,
  readNativeWorkspaceIdentity,
  writeNativeWorkspaceIdentity,
} from '../../../domains/comet-native/native-workspace.js';

function availableInspection(root: string, overrides = {}): GitRepositoryInspection {
  return {
    available: true,
    head: 'a'.repeat(40),
    branch: 'feature/native',
    worktreeRoot: root,
    commonDir: path.join(root, '.git'),
    changedPaths: [],
    failure: null,
    ...overrides,
  };
}

describe('Native workspace identity', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-workspace-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
    await fs.mkdir(path.join(projectRoot, 'docs', 'comet', 'changes', 'example'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('stores hashes and project-relative refs without raw paths or session ids', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 7,
      sessionId: 'raw-session-secret',
      now: new Date('2026-07-17T00:00:00.000Z'),
      inspectRepository: async () => availableInspection(projectRoot),
    });
    const serialized = JSON.stringify(identity);

    expect(identity.nativeRootRef).toBe('docs/comet');
    expect(identity.vcs.kind).toBe('git');
    expect(identity.sessionHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain('raw-session-secret');
  });

  it('writes and reads local workspace metadata atomically', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => availableInspection(projectRoot),
    });

    await expect(readNativeWorkspaceIdentity(paths, 'example')).resolves.toEqual(written);
  });

  it('rejects copied metadata with non-portable root or prefix refs', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const written = await writeNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => availableInspection(projectRoot),
    });
    const file = path.join(projectRoot, 'docs/comet/changes/example/runtime/workspace.json');

    await fs.writeFile(file, JSON.stringify({ ...written, nativeRootRef: '../other' }));
    await expect(readNativeWorkspaceIdentity(paths, 'example')).rejects.toThrow(
      'project-relative path',
    );
  });

  it('represents unavailable inspection without inventing clean Git facts', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => ({
        available: false,
        head: null,
        branch: null,
        worktreeRoot: null,
        commonDir: null,
        changedPaths: null,
        failure: { kind: 'git-unavailable', operation: 'discovery' },
      }),
    });

    expect(identity.vcs).toEqual({
      kind: 'unavailable',
      head: null,
      branch: null,
      worktreeId: null,
      commonDirId: null,
      projectPrefix: null,
      failureKind: 'git-unavailable',
    });
  });

  it('degrades when reported Git identity paths cannot be resolved', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () =>
        availableInspection(projectRoot, {
          commonDir: path.join(projectRoot, 'missing-git-directory'),
        }),
    });

    expect(identity.vcs).toMatchObject({
      kind: 'unavailable',
      failureKind: 'identity-unavailable',
    });
  });

  it('reports stable drift codes and ignores attributed paths', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => availableInspection(projectRoot),
    });
    const advisory = await inspectNativeWorkspaceAdvisory({
      paths,
      identity,
      attributedPaths: ['owned.ts'],
      inspectRepository: async () =>
        availableInspection(projectRoot, {
          head: 'b'.repeat(40),
          branch: 'other',
          changedPaths: ['owned.ts', 'unowned.ts'],
        }),
    });

    expect(advisory).toEqual({
      state: 'drifted',
      findingCodes: [
        'workspace-branch-changed',
        'workspace-head-changed',
        'workspace-unattributed-changes',
      ],
    });
  });

  it('does not align metadata copied from another Native root or project prefix', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => availableInspection(projectRoot),
    });
    const copied = {
      ...identity,
      nativeRootRef: 'other/comet',
      vcs:
        identity.vcs.kind === 'git'
          ? { ...identity.vcs, projectPrefix: 'packages/other' }
          : identity.vcs,
    };

    await expect(
      inspectNativeWorkspaceAdvisory({
        paths,
        identity: copied,
        inspectRepository: async () => availableInspection(projectRoot),
      }),
    ).resolves.toEqual({
      state: 'drifted',
      findingCodes: ['workspace-worktree-changed'],
    });
  });

  it('returns unknown when either inspection is unavailable', async () => {
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const identity = await inspectNativeWorkspaceIdentity({
      paths,
      name: 'example',
      revision: 1,
      inspectRepository: async () => availableInspection(projectRoot),
    });

    await expect(
      inspectNativeWorkspaceAdvisory({
        paths,
        identity,
        inspectRepository: async () => ({
          available: false,
          head: null,
          branch: null,
          worktreeRoot: null,
          commonDir: null,
          changedPaths: null,
          failure: { kind: 'timeout', operation: 'status' },
        }),
      }),
    ).resolves.toEqual({
      state: 'unknown',
      findingCodes: ['workspace-inspection-unavailable'],
    });
  });
});
