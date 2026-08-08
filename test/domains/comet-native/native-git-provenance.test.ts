import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectNativeGitExternalDrift } from '../../../domains/comet-native/native-git-provenance.js';
import type { NativeSnapshotProjection } from '../../../domains/comet-native/native-verification-scope.js';

const projection = (entry: { path: string; gitObjectId: string }): NativeSnapshotProjection => ({
  schema: 'comet.native.snapshot-projection.v1',
  origin: 'change-created',
  complete: true,
  limits: {
    maxFiles: 10,
    maxFileBytes: 1024,
    maxTotalBytes: 1024,
    maxDurationMs: 1000,
  },
  entries: [
    {
      path: entry.path,
      hash: 'a'.repeat(64),
      size: 1,
      type: 'file',
      gitObjectId: entry.gitObjectId,
    },
  ],
  omitted: [],
  omittedCount: 0,
});

describe('Native Git provenance', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-provenance-'));
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    await fs.writeFile(path.join(projectRoot, 'source.ts'), 'before\n');
    execFileSync('git', ['add', 'source.ts'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'baseline'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('fails closed when provenance names a non-local ref such as HEAD', async () => {
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    await fs.writeFile(path.join(projectRoot, 'source.ts'), 'after\n');
    execFileSync('git', ['add', 'source.ts'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'target change'], { cwd: projectRoot, stdio: 'ignore' });
    const targetCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const baseObject = execFileSync('git', ['rev-parse', `${baseCommit}:source.ts`], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const targetObject = execFileSync('git', ['rev-parse', `${targetCommit}:source.ts`], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();

    expect(
      detectNativeGitExternalDrift({
        projectRoot,
        provenance: {
          provider: 'git',
          baseCommit,
          targetBranch: 'HEAD',
          targetCommit,
        },
        baseline: projection({ path: 'source.ts', gitObjectId: baseObject }),
        current: projection({ path: 'source.ts', gitObjectId: targetObject }),
        declaredArtifacts: [],
      }),
    ).toBeNull();
  });
});
