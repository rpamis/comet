import { describe, expect, it } from 'vitest';

import {
  buildNativeConflictRadar,
  NATIVE_CONFLICT_RADAR_LIMITS,
  type NativeConflictRadarChangeInput,
} from '../../../domains/comet-native/native-conflict-radar.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const W1 = '1'.repeat(64);
const W2 = '2'.repeat(64);

function change(
  name: string,
  options: Partial<Omit<NativeConflictRadarChangeInput, 'name'>> = {},
): NativeConflictRadarChangeInput {
  return {
    name,
    revision: options.revision ?? 1,
    specs: options.specs ?? [],
    declaredArtifacts: options.declaredArtifacts ?? [],
    ...(options.workspaceIdentityHash !== undefined
      ? { workspaceIdentityHash: options.workspaceIdentityHash }
      : {}),
  };
}

function replace(capability: string, baseHash = A) {
  return { capability, operation: 'replace' as const, baseHash };
}

describe('Native multi-change conflict radar', () => {
  it('classifies a shared canonical base as definite and divergent bases as possible', () => {
    const definite = buildNativeConflictRadar([
      change('alpha', { specs: [replace('authentication')] }),
      change('beta', { specs: [replace('authentication')] }),
    ]);
    expect(definite.relationships[0]).toMatchObject({
      classification: 'definite-conflict',
      signals: [
        {
          kind: 'capability',
          certainty: 'definite-conflict',
          capability: 'authentication',
          leftBaseHash: A,
          rightBaseHash: A,
        },
      ],
    });

    const possible = buildNativeConflictRadar([
      change('alpha', { specs: [replace('authentication', A)] }),
      change('beta', { specs: [replace('authentication', B)] }),
    ]);
    expect(possible.relationships[0]).toMatchObject({
      classification: 'possible-overlap',
      signals: [{ kind: 'capability', certainty: 'possible-overlap' }],
    });
  });

  it('treats create collisions as definite even when the other change targets a canonical base', () => {
    const radar = buildNativeConflictRadar([
      change('creator', {
        specs: [{ capability: 'sessions', operation: 'create', baseHash: null }],
      }),
      change('replacer', { specs: [replace('sessions')] }),
    ]);

    expect(radar.relationships[0].classification).toBe('definite-conflict');
  });

  it('distinguishes exact file conflicts, broad directory overlap, and disjoint prefixes', () => {
    const exact = buildNativeConflictRadar([
      change('alpha', { declaredArtifacts: [{ path: 'src/auth.ts', kind: 'file' }] }),
      change('beta', { declaredArtifacts: [{ path: 'src/auth.ts', kind: 'file' }] }),
    ]);
    expect(exact.relationships[0]).toMatchObject({
      classification: 'definite-conflict',
      signals: [{ kind: 'artifact', certainty: 'definite-conflict' }],
    });

    const broad = buildNativeConflictRadar([
      change('alpha', { declaredArtifacts: [{ path: 'src', kind: 'directory' }] }),
      change('beta', { declaredArtifacts: [{ path: 'src/auth.ts', kind: 'file' }] }),
    ]);
    expect(broad.relationships[0]).toMatchObject({
      classification: 'possible-overlap',
      signals: [{ kind: 'artifact', certainty: 'possible-overlap' }],
    });

    const disjoint = buildNativeConflictRadar([
      change('alpha', { declaredArtifacts: [{ path: 'src', kind: 'directory' }] }),
      change('beta', { declaredArtifacts: [{ path: 'src-other/auth.ts', kind: 'file' }] }),
    ]);
    expect(disjoint.relationships[0]).toMatchObject({
      classification: 'disjoint',
      signalCount: 0,
      signals: [],
    });
  });

  it('normalizes ordering and produces the same full-fact hash for reordered inputs', () => {
    const first = buildNativeConflictRadar([
      change('zeta', {
        revision: 4,
        specs: [replace('zeta-capability'), replace('shared-capability')],
        declaredArtifacts: [
          { path: 'src/zeta.ts', kind: 'file' },
          { path: 'src/shared.ts', kind: 'file' },
        ],
      }),
      change('alpha', {
        revision: 2,
        specs: [replace('shared-capability'), replace('alpha-capability')],
        declaredArtifacts: [
          { path: 'src/shared.ts', kind: 'file' },
          { path: 'src/alpha.ts', kind: 'file' },
        ],
      }),
    ]);
    const reordered = buildNativeConflictRadar([
      change('alpha', {
        revision: 2,
        specs: [replace('alpha-capability'), replace('shared-capability')],
        declaredArtifacts: [
          { path: 'src/alpha.ts', kind: 'file' },
          { path: 'src/shared.ts', kind: 'file' },
        ],
      }),
      change('zeta', {
        revision: 4,
        specs: [replace('shared-capability'), replace('zeta-capability')],
        declaredArtifacts: [
          { path: 'src/shared.ts', kind: 'file' },
          { path: 'src/zeta.ts', kind: 'file' },
        ],
      }),
    ]);

    expect(reordered).toEqual(first);
    expect(first.radarHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.relationships[0].signals.map(({ kind }) => kind)).toEqual([
      'capability',
      'artifact',
    ]);
  });

  it('keeps workspace identity advisory and never exposes its hash', () => {
    const sameWorkspace = buildNativeConflictRadar([
      change('alpha', { specs: [replace('authentication')], workspaceIdentityHash: W1 }),
      change('beta', { specs: [replace('authentication')], workspaceIdentityHash: W1 }),
    ]);
    const differentWorkspace = buildNativeConflictRadar([
      change('alpha', { specs: [replace('authentication')], workspaceIdentityHash: W1 }),
      change('beta', { specs: [replace('authentication')], workspaceIdentityHash: W2 }),
    ]);

    expect(sameWorkspace.relationships[0].classification).toBe('definite-conflict');
    expect(differentWorkspace.relationships[0].classification).toBe('definite-conflict');
    expect(sameWorkspace.relationships[0].workspaceRelationship).toBe('same');
    expect(differentWorkspace.relationships[0].workspaceRelationship).toBe('different');
    expect(sameWorkspace.workspaceIdentityAdvisoryOnly).toBe(true);
    expect(JSON.stringify(sameWorkspace)).not.toContain(W1);
    expect(JSON.stringify(differentWorkspace)).not.toContain(W2);
  });

  it('caps relationship details and serialized output while hashing all pairs', () => {
    const changes = Array.from({ length: 24 }, (_, index) =>
      change(`change-${String(index).padStart(2, '0')}`),
    );
    const radar = buildNativeConflictRadar(changes);

    expect(radar.relationshipCount).toBe((24 * 23) / 2);
    expect(radar.relationships.length).toBeLessThanOrEqual(
      NATIVE_CONFLICT_RADAR_LIMITS.maxRelationships,
    );
    expect(radar.relationshipsTruncated).toBe(true);
    expect(radar.omittedRelationshipCount).toBe(
      radar.relationshipCount - radar.relationships.length,
    );
    expect(Buffer.byteLength(JSON.stringify(radar), 'utf8')).toBeLessThanOrEqual(
      NATIVE_CONFLICT_RADAR_LIMITS.maxSerializedBytes,
    );
  });

  it('caps per-pair evidence without losing the full signal count or hash', () => {
    const artifacts = Array.from({ length: 12 }, (_, index) => ({
      path: `src/shared-${String(index).padStart(2, '0')}.ts`,
      kind: 'file' as const,
    }));
    const radar = buildNativeConflictRadar([
      change('alpha', { declaredArtifacts: artifacts }),
      change('beta', { declaredArtifacts: [...artifacts].reverse() }),
    ]);
    const relation = radar.relationships[0];

    expect(relation.signalCount).toBe(12);
    expect(relation.signals).toHaveLength(NATIVE_CONFLICT_RADAR_LIMITS.maxSignalsPerRelationship);
    expect(relation.signalsTruncated).toBe(true);
    expect(relation.signalHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    '/absolute/file.ts',
    'C:/absolute/file.ts',
    '../outside.ts',
    'src/../outside.ts',
    'src\\windows.ts',
    '//server/share.ts',
    'src/trailing/',
  ])('rejects unsafe artifact path %s so output cannot contain absolute paths', (artifactPath) => {
    expect(() =>
      buildNativeConflictRadar([
        change('alpha', { declaredArtifacts: [{ path: artifactPath, kind: 'file' }] }),
      ]),
    ).toThrow('project-relative path');
  });

  it('fails closed on malformed hashes, operation/base pairs, duplicates, and input overflow', () => {
    expect(() =>
      buildNativeConflictRadar([
        change('alpha', {
          specs: [{ capability: 'authentication', operation: 'replace', baseHash: null }],
        }),
      ]),
    ).toThrow('requires a canonical base hash');
    expect(() =>
      buildNativeConflictRadar([
        change('alpha', {
          specs: [{ capability: 'authentication', operation: 'create', baseHash: A }],
        }),
      ]),
    ).toThrow('requires a null canonical base hash');
    expect(() =>
      buildNativeConflictRadar([change('alpha', { workspaceIdentityHash: 'not-a-hash' })]),
    ).toThrow('workspace identity hash');
    expect(() => buildNativeConflictRadar([change('alpha'), change('alpha')])).toThrow(
      'duplicate change names',
    );
    expect(() =>
      buildNativeConflictRadar([
        change('alpha', { specs: [replace('authentication'), replace('authentication')] }),
      ]),
    ).toThrow('duplicate capabilities');
    expect(() =>
      buildNativeConflictRadar([
        change('alpha', {
          declaredArtifacts: [
            { path: 'src/auth.ts', kind: 'file' },
            { path: 'src/auth.ts', kind: 'directory' },
          ],
        }),
      ]),
    ).toThrow('duplicate or conflicting artifact paths');
    expect(() =>
      buildNativeConflictRadar(
        Array.from({ length: NATIVE_CONFLICT_RADAR_LIMITS.maxChanges + 1 }, (_, index) =>
          change(`overflow-${index}`),
        ),
      ),
    ).toThrow('change budget');
  });

  it.each([
    ['change', [{ ...change('alpha'), secret: 'must-not-be-ignored' }]],
    [
      'spec',
      [
        change('alpha', {
          specs: [{ ...replace('authentication'), secret: 'must-not-be-ignored' }],
        }),
      ],
    ],
    [
      'artifact',
      [
        change('alpha', {
          declaredArtifacts: [{ path: 'src/auth.ts', kind: 'file', secret: 'must-not-be-ignored' }],
        }),
      ],
    ],
  ])('rejects unknown %s fields instead of silently dropping untrusted input', (_label, input) => {
    expect(() => buildNativeConflictRadar(input as NativeConflictRadarChangeInput[])).toThrow(
      'unknown field',
    );
  });
});
