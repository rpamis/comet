import { describe, expect, it } from 'vitest';

import {
  hashNativeCheckpointManifest,
  normalizeNativeCheckpointArtifactRef,
  parseNativeCheckpointManifestValue,
  parseNativeProgressCheckpointValue,
  nativeCheckpointManifestRef,
} from '../../../domains/comet-native/native-checkpoint-storage.js';

const hash = (character: string) => character.repeat(64);

function validManifest(patch: Record<string, unknown> = {}) {
  return {
    schema: 'comet.native.checkpoint-manifest.v1',
    change: 'checkpoint-change',
    artifacts: [{ path: 'src/app.ts', hash: hash('a'), size: 3 }],
    totalBytes: 3,
    ...patch,
  };
}

function validCheckpoint(patch: Record<string, unknown> = {}) {
  const manifestHash = hash('b');
  return {
    schema: 'comet.native.progress-checkpoint.v1',
    id: 'checkpoint-1',
    change: 'checkpoint-change',
    phase: 'build',
    previousRevision: 1,
    stateRevision: 2,
    summary: 'Build completed.',
    nextAction: 'Run Verify.',
    inputHash: hash('c'),
    manifestHash,
    manifestRef: nativeCheckpointManifestRef(manifestHash),
    artifactCount: 1,
    createdAt: '2026-08-12T00:00:00.000Z',
    ...patch,
  };
}

describe('Native checkpoint parser branches', () => {
  it('normalizes safe artifact paths and hashes a canonical manifest', () => {
    expect(normalizeNativeCheckpointArtifactRef('src\\app.ts')).toBe('src/app.ts');
    expect(normalizeNativeCheckpointArtifactRef('src/./app.ts')).toBe('src/app.ts');
    const parsed = parseNativeCheckpointManifestValue(validManifest(), 'checkpoint-change');
    expect(parsed.artifacts[0]?.path).toBe('src/app.ts');
    expect(hashNativeCheckpointManifest(parsed)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['', 'project-relative'],
    ['../escape', 'project-relative'],
    ['/absolute', 'project-relative'],
    ['C:/absolute', 'project-relative'],
    ['.', 'project file'],
  ])('rejects unsafe artifact path %s', (value, message) => {
    expect(() => normalizeNativeCheckpointArtifactRef(value)).toThrow(message);
  });

  it.each([
    ['schema', { schema: 'wrong' }, 'schema'],
    ['change', { change: 'other' }, 'change mismatch'],
    ['artifacts', { artifacts: null }, 'artifacts must be an array'],
    [
      'unsorted',
      {
        artifacts: [
          { path: 'z.ts', hash: hash('a'), size: 1 },
          { path: 'a.ts', hash: hash('b'), size: 1 },
        ],
        totalBytes: 2,
      },
      'sorted',
    ],
    [
      'duplicate',
      {
        artifacts: [
          { path: 'src/app.ts', hash: hash('a'), size: 1 },
          { path: 'src/app.ts', hash: hash('b'), size: 2 },
        ],
        totalBytes: 3,
      },
      'duplicate',
    ],
    ['total bytes', { totalBytes: 4 }, 'totalBytes mismatch'],
  ])('rejects invalid checkpoint manifest %s', (_label, patch, message) => {
    expect(() =>
      parseNativeCheckpointManifestValue(validManifest(patch), 'checkpoint-change'),
    ).toThrow(message);
  });

  it('parses a progress checkpoint and rejects revision, reference, and credential mismatches', () => {
    expect(
      parseNativeProgressCheckpointValue(validCheckpoint(), 'checkpoint-change'),
    ).toMatchObject({
      phase: 'build',
      stateRevision: 2,
      artifactCount: 1,
    });
    const invalidCases: Array<[Record<string, unknown>, string]> = [
      [{ phase: 'unknown' }, 'phase'],
      [{ previousRevision: 0 }, 'positive integer'],
      [{ stateRevision: 3 }, 'increment'],
      [{ manifestRef: 'wrong.json' }, 'manifestRef'],
      [{ inputHash: 'bad' }, 'inputHash'],
      [{ artifactCount: -1 }, 'non-negative'],
      [{ summary: 'token sk-ant-api03-secret' }, 'credential'],
    ];
    for (const [patch, message] of invalidCases) {
      expect(() =>
        parseNativeProgressCheckpointValue(validCheckpoint(patch), 'checkpoint-change'),
      ).toThrow(message);
    }
  });
});
