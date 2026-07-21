import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  inspectNativeWorkspaceAdvisory,
  inspectNativeWorkspaceIdentity,
  readNativeWorkspaceIdentity,
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
});
