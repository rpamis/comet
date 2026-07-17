import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compareAndSwapNativeChange,
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  inspectNativeCheckpointFreshness,
  createNativeCheckpointManifest,
  hashNativeCheckpointManifest,
  nativeCheckpointJournalFile,
  nativeProgressCheckpointFile,
  readNativeProgressCheckpoint,
  writeNativeCheckpointManifest,
} from '../../../domains/comet-native/native-checkpoint-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { checkpointNativeChange } from '../../../domains/comet-native/native-progress-checkpoint.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import { markNativeSpecRemoval } from '../../../domains/comet-native/native-specs.js';
import { doctorNativeProject } from '../../../domains/comet-native/native-doctor.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native progress checkpoints', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-progress-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await createNativeChange({ paths, name: 'resume-work', language: 'en' });
  });

  async function writeValidBrief(): Promise<void> {
    await fs.writeFile(
      path.join(nativeChangeDir(paths, 'resume-work'), 'brief.md'),
      `# Outcome
Resume safely.
# Scope
One Native change.
# Non-goals
No background process.
# Acceptance examples
- Work resumes once.
# Constraints and invariants
Keep revisions monotonic.
# Decisions
Use a durable journal.
# Open questions
None.
# Verification expectations
Run focused tests.
`,
    );
  }

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('records progress without changing phase and treats an identical retry exactly once', async () => {
    const first = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Implemented the parser',
      nextAction: 'Add focused edge-case tests',
      expectedRevision: 1,
      now: new Date('2026-07-17T01:00:00.000Z'),
      checkpointId: () => 'checkpoint-one',
    });
    expect(first).toMatchObject({
      change: { phase: 'shape', revision: 2 },
      checkpoint: { previousRevision: 1, stateRevision: 2 },
      idempotent: false,
      expectedRevision: 1,
      previousRevision: 1,
      revision: 2,
      outcome: 'recorded',
      continuation: { schema: 'comet.native.continuation.v1', revision: 2 },
    });

    const retried = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Implemented the parser',
      nextAction: 'Add focused edge-case tests',
      expectedRevision: 1,
    });
    expect(retried).toMatchObject({
      idempotent: true,
      expectedRevision: 1,
      previousRevision: 1,
      revision: 2,
      outcome: 'idempotent',
      change: { revision: 2 },
    });
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(2);
  });

  it('enforces revision CAS for a distinct checkpoint', async () => {
    await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'First checkpoint',
      nextAction: 'Continue work',
      expectedRevision: 1,
    });
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Second checkpoint',
        nextAction: 'Continue other work',
        expectedRevision: 1,
      }),
    ).rejects.toThrow('revision conflict: expected 1, actual 2');
  });

  it('rejects an impossible expected revision even for an idempotent input', async () => {
    await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Stable input',
      nextAction: 'Continue safely',
      expectedRevision: 1,
    });
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Stable input',
        nextAction: 'Continue safely',
        expectedRevision: 99,
      }),
    ).rejects.toThrow('revision conflict: expected 99, actual 2');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Stable input',
        nextAction: 'Continue safely',
        expectedRevision: 2,
      }),
    ).resolves.toMatchObject({ outcome: 'idempotent', revision: 2 });
  });

  it('recovers a prepared checkpoint and does not increment twice', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Prepared durable state',
        nextAction: 'Resume after interruption',
        expectedRevision: 1,
        checkpointId: () => 'interrupted-checkpoint',
        hooks: {
          afterPrepared: () => {
            throw new Error('simulated interruption');
          },
        },
      }),
    ).rejects.toThrow('simulated interruption');
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(1);
    await expect(
      fs.access(nativeCheckpointJournalFile(paths, 'resume-work')),
    ).resolves.toBeUndefined();

    const recovered = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Prepared durable state',
      nextAction: 'Resume after interruption',
      expectedRevision: 1,
    });
    expect(recovered).toMatchObject({ idempotent: true, change: { revision: 2 } });
    await expect(
      fs.access(nativeCheckpointJournalFile(paths, 'resume-work')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('lets doctor deterministically continue an interrupted checkpoint', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Prepared for doctor',
        nextAction: 'Resume safely',
        hooks: {
          afterStateWritten: () => {
            throw new Error('stop after state write');
          },
        },
      }),
    ).rejects.toThrow('stop after state write');
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(2);
    expect(await readNativeProgressCheckpoint(paths, 'resume-work')).toBeNull();

    const repaired = await doctorNativeProject({ paths, name: 'resume-work', repair: true });
    expect(repaired.findings).toContainEqual(
      expect.objectContaining({ code: 'checkpoint-progress-recovered', severity: 'info' }),
    );
    expect(await readNativeProgressCheckpoint(paths, 'resume-work')).toMatchObject({
      stateRevision: 2,
      summary: 'Prepared for doctor',
    });
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(2);
  });

  it('replays an after-state-write interruption through CAS without a second increment', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'State reached disk',
        nextAction: 'Finish checkpoint recovery',
        expectedRevision: 1,
        hooks: {
          afterStateWritten: () => {
            throw new Error('interrupt after CAS');
          },
        },
      }),
    ).rejects.toThrow('interrupt after CAS');
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(2);

    const replayed = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'State reached disk',
      nextAction: 'Finish checkpoint recovery',
      expectedRevision: 1,
    });
    expect(replayed).toMatchObject({ outcome: 'idempotent', revision: 2 });
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(2);
  });

  it('settles an after-prepared checkpoint before next reads and advances the revision', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Prepared before next',
        nextAction: 'Advance Shape',
        expectedRevision: 1,
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt before checkpoint CAS');
          },
        },
      }),
    ).rejects.toThrow('interrupt before checkpoint CAS');
    await writeValidBrief();

    const advanced = await advanceNativeChange({
      paths,
      name: 'resume-work',
      evidence: { summary: 'Shape is ready after checkpoint recovery' },
    });
    expect(advanced.change).toMatchObject({ phase: 'build', revision: 3 });
    expect(await readNativeProgressCheckpoint(paths, 'resume-work')).toMatchObject({
      summary: 'Prepared before next',
      stateRevision: 2,
    });
    await expect(
      fs.access(nativeCheckpointJournalFile(paths, 'resume-work')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('settles an after-state-write checkpoint before next without a permanent conflict', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'State persisted before next',
        nextAction: 'Advance Shape',
        expectedRevision: 1,
        hooks: {
          afterStateWritten: () => {
            throw new Error('interrupt after checkpoint CAS before next');
          },
        },
      }),
    ).rejects.toThrow('interrupt after checkpoint CAS before next');
    await writeValidBrief();

    const advanced = await advanceNativeChange({
      paths,
      name: 'resume-work',
      evidence: { summary: 'Shape is ready after idempotent checkpoint recovery' },
    });
    expect(advanced.change).toMatchObject({ phase: 'build', revision: 3 });
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(3);
    await expect(
      fs.access(nativeCheckpointJournalFile(paths, 'resume-work')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('settles a pending checkpoint before another revisioned spec mutation', async () => {
    const canonical = path.join(paths.specsDir, 'legacy-capability', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, '# Legacy capability\nRemove it.\n');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Prepared before spec mutation',
        nextAction: 'Record removal intent',
        hooks: {
          afterPrepared: () => {
            throw new Error('interrupt before spec mutation');
          },
        },
      }),
    ).rejects.toThrow('interrupt before spec mutation');

    const updated = await markNativeSpecRemoval(paths, 'resume-work', 'legacy-capability');
    expect(updated).toMatchObject({
      revision: 3,
      spec_changes: [{ capability: 'legacy-capability', operation: 'remove' }],
    });
    expect(await readNativeProgressCheckpoint(paths, 'resume-work')).toMatchObject({
      stateRevision: 2,
    });
  });

  it('fails closed when a low-level revision write bypasses mutation recovery', async () => {
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Prepared before a low-level write',
        nextAction: 'Recover first',
        hooks: {
          afterPrepared: () => {
            throw new Error('leave checkpoint journal');
          },
        },
      }),
    ).rejects.toThrow('leave checkpoint journal');
    const state = await readNativeChange(paths, 'resume-work');
    await expect(
      compareAndSwapNativeChange(
        paths,
        { ...state, approval: 'implicit', revision: state.revision + 1 },
        state.revision,
      ),
    ).rejects.toThrow('progress checkpoint recovery is required');
    expect((await readNativeChange(paths, 'resume-work')).revision).toBe(1);
  });

  it('hashes project artifacts and reports a changed artifact as stale', async () => {
    await fs.mkdir(path.join(projectRoot, 'src'));
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Feature implemented',
      nextAction: 'Run verification',
      artifacts: ['src\\feature.ts'],
      expectedRevision: 1,
    });
    const progress = await readNativeProgressCheckpoint(paths, 'resume-work');
    expect(progress).toMatchObject({
      artifactCount: 1,
      manifestRef: expect.stringMatching(/^runtime\//u),
    });
    expect(
      await inspectNativeCheckpointFreshness({
        paths,
        name: 'resume-work',
        stateRevision: 2,
      }),
    ).toMatchObject({ freshness: 'fresh', reasons: [] });

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    expect(
      await inspectNativeCheckpointFreshness({
        paths,
        name: 'resume-work',
        stateRevision: 2,
      }),
    ).toMatchObject({ freshness: 'stale', reasons: ['artifact-changed:src/feature.ts'] });
  });

  it('rejects unsafe, duplicate, and Native-owned artifact references', async () => {
    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export {};\n');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Unsafe',
        nextAction: 'Never',
        artifacts: ['../outside.ts'],
      }),
    ).rejects.toThrow('project-relative');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Duplicate',
        nextAction: 'Never',
        artifacts: ['feature.ts', 'feature.ts'],
      }),
    ).rejects.toThrow('must not contain duplicates');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Recursive',
        nextAction: 'Never',
        artifacts: ['comet/changes/resume-work/brief.md'],
      }),
    ).rejects.toThrow('outside project content');
  });

  it.each([
    ['nested/.env.production', 'environment-file'],
    ['.git', 'git-metadata'],
    ['nested/.cache/result.bin', 'dependency-or-cache'],
    ['node_modules/pkg/index.js', 'dependency-or-cache'],
  ])('rejects sensitive checkpoint artifact %s', async (artifact, reason) => {
    const target = path.join(projectRoot, ...artifact.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'credential material\n');
    await expect(
      checkpointNativeChange({
        paths,
        name: 'resume-work',
        summary: 'Sensitive artifact',
        nextAction: 'Reject it',
        artifacts: [artifact],
      }),
    ).rejects.toThrow(`excluded as sensitive (${reason})`);
  });

  it('redacts credential-shaped checkpoint text before persistence and status projection', async () => {
    const result = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary:
        'Called Bearer abc.def.ghi, Basic dXNlcjpwYXNz and {"token":"json-token"} with api_key=sk-secret-value',
      nextAction:
        "Use access_token='token-value', password: hunter2, secret=hidden at https://user:pass@example.test",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toMatch(
      /abc\.def\.ghi|dXNlcjpwYXNz|json-token|sk-secret-value|token-value|hunter2|hidden|user:pass/u,
    );
    const progressSource = await fs.readFile(
      nativeProgressCheckpointFile(paths, 'resume-work'),
      'utf8',
    );
    expect(progressSource).not.toMatch(
      /abc\.def\.ghi|dXNlcjpwYXNz|json-token|sk-secret-value|token-value|hunter2|hidden|user:pass/u,
    );
    const statusSource = JSON.stringify([
      await inspectNativeStatus(paths, 'resume-work'),
      await inspectNativeStatus(paths, 'resume-work', { details: true }),
    ]);
    expect(statusSource).toContain('[REDACTED]');
    expect(statusSource).not.toMatch(
      /abc\.def\.ghi|dXNlcjpwYXNz|json-token|sk-secret-value|token-value|hunter2|hidden|user:pass/u,
    );
  });

  it('redacts escaped JSON quotes without leaking the credential suffix', async () => {
    const secret = 'prefix"escaped-secret-suffix';
    const result = await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: JSON.stringify({ clientSecret: secret }),
      nextAction: 'Continue with the implementation',
    });

    expect(result.checkpoint.summary).toBe('{"clientSecret":"[REDACTED]"}');
    expect(result.checkpoint.summary).not.toContain('escaped-secret-suffix');
  });

  it('detects opened-object replacement and in-place changes around artifact reads', async () => {
    const target = path.join(projectRoot, 'race.txt');
    await fs.writeFile(target, 'before\n');
    await expect(
      createNativeCheckpointManifest(paths, 'resume-work', ['race.txt'], {
        afterOpen: async () => {
          await fs.writeFile(target, 'replacement with another size\n');
        },
      }),
    ).rejects.toThrow(/changed while opening/u);

    await fs.writeFile(target, 'stable before read\n');
    await expect(
      createNativeCheckpointManifest(paths, 'resume-work', ['race.txt'], {
        beforeRead: async () => {
          await fs.writeFile(target, 'changed during read with another size\n');
        },
      }),
    ).rejects.toThrow(/changed while reading/u);
  });

  it('rejects a checkpoint artifact whose captured parent is replaced', async () => {
    const parent = path.join(projectRoot, 'checkpoint-source');
    const displaced = path.join(projectRoot, 'checkpoint-source-original');
    const target = path.join(parent, 'artifact.txt');
    await fs.mkdir(parent);
    await fs.writeFile(target, 'trusted artifact\n');

    await expect(
      createNativeCheckpointManifest(paths, 'resume-work', ['checkpoint-source/artifact.txt'], {
        afterParentChainCaptured: async () => {
          await fs.rename(parent, displaced);
          await fs.mkdir(parent);
          await fs.writeFile(target, 'replacement artifact\n');
        },
      }),
    ).rejects.toThrow(/parent changed during I\/O/u);

    expect(await fs.readFile(path.join(displaced, 'artifact.txt'), 'utf8')).toBe(
      'trusted artifact\n',
    );
    expect(await fs.readFile(target, 'utf8')).toBe('replacement artifact\n');
  });

  it('bounds and rejects untrusted progress documents before JSON parsing', async () => {
    const file = nativeProgressCheckpointFile(paths, 'resume-work');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'x'.repeat(256 * 1024 + 1));
    await expect(readNativeProgressCheckpoint(paths, 'resume-work')).rejects.toThrow(
      'exceeds 262144 bytes',
    );

    await fs.writeFile(file, '{}');
    const realLstat = fs.lstat.bind(fs);
    const lstat = vi.spyOn(fs, 'lstat').mockImplementation(async (target) => {
      const stat = await realLstat(target);
      if (path.resolve(String(target)) !== path.resolve(file)) return stat;
      return new Proxy(stat, {
        get(current, property, receiver) {
          if (property === 'isSymbolicLink') return () => true;
          return Reflect.get(current, property, receiver);
        },
      });
    });
    try {
      await expect(readNativeProgressCheckpoint(paths, 'resume-work')).rejects.toThrow(
        'must be a regular file',
      );
    } finally {
      lstat.mockRestore();
    }
  });

  it('rejects tampered persisted credentials and dynamically configured Native paths', async () => {
    await checkpointNativeChange({
      paths,
      name: 'resume-work',
      summary: 'Safe checkpoint',
      nextAction: 'Continue safely',
    });
    const progressFile = nativeProgressCheckpointFile(paths, 'resume-work');
    const progress = JSON.parse(await fs.readFile(progressFile, 'utf8')) as Record<string, unknown>;
    progress.summary = 'api_key=raw-secret';
    await fs.writeFile(progressFile, JSON.stringify(progress));
    await expect(readNativeProgressCheckpoint(paths, 'resume-work')).rejects.toThrow(
      'unredacted credential material',
    );

    await expect(
      writeNativeCheckpointManifest(paths, 'resume-work', {
        schema: 'comet.native.checkpoint-manifest.v1',
        change: 'resume-work',
        artifacts: [
          {
            path: 'comet/changes/resume-work/brief.md',
            hash: 'a'.repeat(64),
            size: 1,
          },
        ],
        totalBytes: 1,
      }),
    ).rejects.toThrow('sensitive artifact (native-runtime)');
  });

  it('rejects an internal symlink or junction in the checkpoint manifest parent chain', async () => {
    const runtime = path.join(nativeChangeDir(paths, 'resume-work'), 'runtime');
    const internalTarget = path.join(runtime, 'internal-checkpoint-target');
    const linkedParent = path.join(runtime, 'checkpoints');
    const manifest = {
      schema: 'comet.native.checkpoint-manifest.v1' as const,
      change: 'resume-work',
      artifacts: [],
      totalBytes: 0,
    };
    const manifestHash = hashNativeCheckpointManifest(manifest);
    await fs.mkdir(path.join(internalTarget, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(internalTarget, 'manifests', `${manifestHash}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    await fs.rm(linkedParent, { recursive: true, force: true });
    await fs.symlink(
      internalTarget,
      linkedParent,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(writeNativeCheckpointManifest(paths, 'resume-work', manifest)).rejects.toThrow(
      'parent must be a real directory',
    );
    expect(await fs.readdir(internalTarget)).toEqual(['manifests']);
  });

  it('rejects a checkpoint manifest commit when its parent directory is replaced', async () => {
    const manifest = {
      schema: 'comet.native.checkpoint-manifest.v1' as const,
      change: 'resume-work',
      artifacts: [],
      totalBytes: 0,
    };
    const manifestDirectory = path.dirname(
      path.join(
        nativeChangeDir(paths, 'resume-work'),
        'runtime',
        'checkpoints',
        'manifests',
        `${'0'.repeat(64)}.json`,
      ),
    );
    const displaced = `${manifestDirectory}-displaced`;

    await expect(
      writeNativeCheckpointManifest(paths, 'resume-work', manifest, {
        beforeCommit: async () => {
          await fs.rename(manifestDirectory, displaced);
          await fs.mkdir(manifestDirectory, { recursive: true });
        },
      }),
    ).rejects.toThrow('parent changed before commit');
    expect(await fs.readdir(manifestDirectory)).toEqual([]);
    expect((await fs.readdir(displaced)).some((entry) => entry.endsWith('.tmp'))).toBe(true);
  });
});
