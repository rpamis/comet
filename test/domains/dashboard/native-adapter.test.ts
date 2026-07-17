import { describe, expect, it } from 'vitest';

import { buildNativeConflictRadar } from '../../../domains/comet-native/native-conflict-radar.js';
import type { NativeArchivePreflight } from '../../../domains/comet-native/native-archive-preflight.js';
import type { NativeStatusProjection } from '../../../domains/comet-native/native-types.js';
import {
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
} from '../../../domains/dashboard/native-adapter.js';

const NOW = '2026-07-17T08:00:00.000Z';
const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

function status(
  name: string,
  overrides: Partial<NativeStatusProjection> = {},
): NativeStatusProjection {
  const revision = overrides.revision ?? 1;
  const phase = overrides.phase ?? 'shape';
  return {
    name,
    phase,
    revision,
    approval: null,
    verificationResult: 'pending',
    specChanges: 0,
    selected: false,
    nextCommand: `comet native next ${name} --summary "<summary>"`,
    archiveReady: false,
    inspection: {
      freshness: 'fresh',
      codes: [],
      reasonCount: 0,
      codesTruncated: false,
    },
    findingSummary: {
      total: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      requiresUserDecision: false,
      codes: [],
      truncated: false,
    },
    detailsCommand: `comet native status ${name} --details`,
    checkpoint: null,
    continuation:
      phase === 'invalid' || revision === null
        ? null
        : {
            schema: 'comet.native.continuation.v1',
            skill: 'comet-native',
            change: name,
            phase,
            revision,
            disposition: 'continue',
            action: 'advance-phase',
            command: `comet native next ${name} --summary "<summary>"`,
            requiresUserDecision: false,
            requiredInputs: ['summary'],
          },
    ...overrides,
  };
}

function preflight(
  name: string,
  overrides: Partial<NativeArchivePreflight> = {},
): NativeArchivePreflight {
  return {
    schema: 'comet.native.archive-preflight.v1',
    change: name,
    revision: 1,
    targetRef: `archive/2026-07-17-${name}`,
    ready: false,
    evidenceFreshness: 'missing',
    operationCount: 0,
    operations: [],
    findingCodes: ['archive-phase-required', 'verification-evidence-missing'],
    preflightHash: HASH,
    ...overrides,
  };
}

describe('Native Dashboard read-only adapter', () => {
  it('preserves CLI parity fields and adds bounded continuation and Archive facts', () => {
    const source = status('dashboard-visible-change', {
      selected: true,
      findingSummary: {
        total: 1,
        errors: 1,
        warnings: 0,
        info: 0,
        requiresUserDecision: false,
        codes: ['brief-section-empty'],
        truncated: false,
      },
    });

    const projection = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses: [source],
      preflights: { 'dashboard-visible-change': preflight('dashboard-visible-change') },
    });

    expect(projection.changes[0]).toMatchObject({
      workflow: 'native',
      name: source.name,
      phase: source.phase,
      nextCommand: source.nextCommand,
      verificationResult: source.verificationResult,
      verificationFreshness: 'missing',
      archiveReady: false,
      continuation: {
        disposition: 'continue',
        action: 'advance-phase',
        command: source.nextCommand,
        requiredInputs: ['summary'],
      },
      findings: {
        total: 1,
        codes: ['brief-section-empty'],
      },
      archive: {
        ready: false,
        evidenceFreshness: 'missing',
        operationCount: 0,
        findingCodes: ['archive-phase-required', 'verification-evidence-missing'],
        preflightHash: HASH,
      },
    });
  });

  it('drops detailed findings, raw conflict signals, reports, roots, and unexpected commands', () => {
    const absolutePath = 'C:/Users/Alice/private-report.md';
    const artifactPath = 'private/implementation-secret.ts';
    const source = status('alpha-change', {
      nextCommand: `comet native next alpha-change --summary "${absolutePath}"`,
      error: `Unable to read ${absolutePath}`,
      findings: [
        {
          code: 'verification-report-invalid',
          message: `Raw report at ${absolutePath}`,
          severity: 'error',
          path: absolutePath,
          requiredAction: 'complete-verification-evidence',
          retryCommand: null,
          repairCommand: null,
          requiresUserDecision: false,
        },
      ],
      continuation: {
        schema: 'comet.native.continuation.v1',
        skill: 'comet-native',
        change: 'alpha-change',
        phase: 'shape',
        revision: 1,
        disposition: 'continue',
        action: 'advance-phase',
        command: `comet native next alpha-change --summary "${absolutePath}"`,
        requiresUserDecision: false,
        requiredInputs: ['summary'],
      },
    });
    const radar = buildNativeConflictRadar([
      {
        name: 'alpha-change',
        revision: 1,
        specs: [],
        declaredArtifacts: [{ path: artifactPath, kind: 'file' }],
      },
      {
        name: 'beta-change',
        revision: 1,
        specs: [],
        declaredArtifacts: [{ path: artifactPath, kind: 'file' }],
      },
    ]);
    const archive = preflight('alpha-change', {
      targetRef: 'archive/2026-07-17-private-target',
      operationCount: 1,
      operations: [
        {
          capability: 'internal-capability',
          operation: 'replace',
          expectedBaseHash: HASH,
          actualBaseHash: HASH,
          proposedHash: OTHER_HASH,
          operationHash: HASH,
        },
      ],
    });

    const projection = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses: [source, status('beta-change')],
      preflights: { 'alpha-change': archive },
      conflictRadar: radar,
    });
    const serialized = JSON.stringify(projection);

    expect(projection.changes[0].nextCommand).toBeNull();
    expect(projection.changes[0].continuation?.command).toBeNull();
    expect(projection.changes[0].conflicts.peers).toEqual([
      {
        change: 'beta-change',
        classification: 'definite-conflict',
        workspaceRelationship: 'unknown',
        signalCount: 1,
      },
    ]);
    expect(serialized).not.toContain(absolutePath);
    expect(serialized).not.toContain(artifactPath);
    expect(serialized).not.toContain('internal-capability');
    expect(serialized).not.toContain('private-target');
    expect(serialized).not.toContain('Raw report');
  });

  it('fails closed for missing or revision-mismatched preflight projections', () => {
    const missing = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses: [status('missing-preview')],
    });
    const mismatched = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses: [status('stale-preview', { revision: 3 })],
      preflights: { 'stale-preview': preflight('stale-preview', { revision: 2, ready: true }) },
    });

    expect(missing.changes[0]).toMatchObject({
      verificationFreshness: 'unknown',
      archiveReady: false,
      archive: { findingCodes: ['dashboard-preflight-unavailable'], preflightHash: null },
    });
    expect(mismatched.changes[0]).toMatchObject({
      verificationFreshness: 'unknown',
      archiveReady: false,
      archive: { findingCodes: ['dashboard-preflight-mismatch'], preflightHash: null },
    });
  });

  it('projects global and per-change conflict summaries without carrying signal details', () => {
    const radar = buildNativeConflictRadar([
      {
        name: 'alpha-change',
        revision: 1,
        specs: [{ capability: 'shared-capability', operation: 'replace', baseHash: HASH }],
        declaredArtifacts: [],
      },
      {
        name: 'beta-change',
        revision: 1,
        specs: [{ capability: 'shared-capability', operation: 'replace', baseHash: HASH }],
        declaredArtifacts: [],
      },
      {
        name: 'gamma-change',
        revision: 1,
        specs: [],
        declaredArtifacts: [{ path: 'src', kind: 'directory' }],
      },
    ]);

    const projection = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses: [status('gamma-change'), status('beta-change'), status('alpha-change')],
      conflictRadar: radar,
    });

    expect(projection.conflicts).toMatchObject({
      available: true,
      definiteConflict: 1,
      possibleOverlap: 0,
      disjoint: 2,
      relationshipCount: 3,
    });
    expect(projection.changes.map(({ name }) => name)).toEqual([
      'alpha-change',
      'beta-change',
      'gamma-change',
    ]);
    expect(projection.changes[0].conflicts).toMatchObject({
      visibleDefiniteConflict: 1,
      visiblePossibleOverlap: 0,
      peers: [{ change: 'beta-change', classification: 'definite-conflict' }],
    });
    expect(JSON.stringify(projection)).not.toContain('shared-capability');
  });

  it('caps changes, compact codes, and serialized output without mutating source projections', () => {
    const statuses = Array.from({ length: 40 }, (_, index) => {
      const name = `change-${String(index).padStart(2, '0')}`;
      return status(name, {
        findingSummary: {
          total: 12,
          errors: 12,
          warnings: 0,
          info: 0,
          requiresUserDecision: false,
          codes: Array.from({ length: 12 }, (__, codeIndex) => `finding-${codeIndex}`),
          truncated: false,
        },
      });
    });
    const sourceBefore = structuredClone(statuses);

    const projection = adaptNativeDashboardProjection({
      generatedAt: NOW,
      statuses,
      omittedSourceChangeCount: 3,
    });

    expect(statuses).toEqual(sourceBefore);
    expect(projection.visibleChangeCount).toBe(NATIVE_DASHBOARD_LIMITS.maxChanges);
    expect(projection.totalChangeCount).toBe(43);
    expect(projection.omittedChangeCount).toBe(11);
    expect(projection.changesTruncated).toBe(true);
    expect(projection.changes[0].findings.codes).toHaveLength(
      NATIVE_DASHBOARD_LIMITS.maxFindingCodes,
    );
    expect(projection.changes[0].findings.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(projection), 'utf8')).toBeLessThanOrEqual(
      NATIVE_DASHBOARD_LIMITS.maxSerializedBytes,
    );
  });

  it('requires a canonical timestamp so callers cannot smuggle unbounded metadata', () => {
    expect(() => adaptNativeDashboardProjection({ generatedAt: 'today', statuses: [] })).toThrow(
      'canonical ISO timestamp',
    );
  });
});
