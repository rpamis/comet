import { describe, expect, it } from 'vitest';

import {
  buildNativeAcceptanceEvidenceTrace,
  buildNativePartialAllowance,
  buildNativeVerificationEvidenceEnvelope,
  parseNativeAcceptanceEvidenceTrace,
} from '../../../domains/comet-native/native-verification-evidence.js';
import { buildNativeContractSnapshot } from '../../../domains/comet-native/native-contract.js';
import { canonicalHash } from '../../../domains/comet-native/native-canonical-hash.js';
import type { NativeContentSnapshotManifest } from '../../../domains/comet-native/native-types.js';
import { buildNativeImplementationScopeBundle } from '../../../domains/comet-native/native-verification-scope.js';

const contract = buildNativeContractSnapshot({
  briefMarkdown: '# Acceptance examples\n- The command succeeds.\n- Failure is visible.\n',
  specs: [],
});

function evidenceForAll() {
  return contract.acceptance.map((criterion) => ({
    acceptance_id: criterion.id,
    evidence_refs: [`tests/${criterion.id}.txt`],
  }));
}

function buildTrace(evidence = evidenceForAll()) {
  return buildNativeAcceptanceEvidenceTrace(contract.acceptance, evidence, {
    nativeRootRef: 'comet',
  });
}

function snapshot(
  entries: NativeContentSnapshotManifest['entries'],
): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: 'explicit',
    createdAt: '2026-07-17T00:00:00.000Z',
    complete: true,
    limits: {
      maxFiles: 10,
      maxFileBytes: 1024,
      maxTotalBytes: 4096,
      maxManifestBytes: 4096,
    },
    entries,
    omitted: [],
    omittedCount: 0,
  };
}

function scopeBundle(declared: boolean) {
  return buildNativeImplementationScopeBundle({
    baseline: snapshot([]),
    current: snapshot([
      { path: 'src/login.ts', hash: 'a'.repeat(64), size: 10, type: 'file' },
      { path: 'src/session.ts', hash: 'b'.repeat(64), size: 12, type: 'file' },
    ]),
    contractHash: contract.contractHash,
    declaredArtifacts: declared
      ? [
          { path: 'src/login.ts', kind: 'file' },
          { path: 'src/session.ts', kind: 'file' },
        ]
      : [],
  });
}

describe('Native acceptance evidence trace', () => {
  it('requires exact coverage and is stable across evidence order', () => {
    const first = buildTrace();
    const reordered = buildTrace(evidenceForAll().reverse());

    expect(first).toEqual(reordered);
    expect(first).toMatchObject({ total: 2, evidenced: 2, skipped: 0 });
    expect(first.traceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects missing, unknown, duplicate, or ambiguous entries', () => {
    const [first] = evidenceForAll();
    expect(() => buildTrace([first])).toThrow('missing 1 acceptance evidence entry');
    expect(() =>
      buildTrace([
        ...evidenceForAll(),
        { acceptance_id: `acceptance-${'f'.repeat(64)}`, evidence_refs: ['tests/no.txt'] },
      ]),
    ).toThrow('unknown acceptance ID');
    expect(() => buildTrace([first, first])).toThrow('repeats acceptance ID');
    expect(() =>
      buildTrace([{ ...first, skipped_reason: 'not run' }, evidenceForAll()[1]]),
    ).toThrow('exactly one');
  });

  it('bounds missing-coverage diagnostics instead of echoing every acceptance ID', () => {
    const criteria = Array.from({ length: 100 }, (_, index) => ({
      id: `acceptance-${index.toString(16).padStart(64, '0')}`,
      kind: 'brief-example' as const,
      source: 'brief.md',
      context: [],
      text: `Criterion ${index}.`,
    }));
    let message = '';
    try {
      buildNativeAcceptanceEvidenceTrace(criteria, [], { nativeRootRef: 'comet' });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('missing 100 acceptance evidence entries');
    expect(message).toContain('(92 more)');
    expect(Buffer.byteLength(message, 'utf8')).toBeLessThan(1_024);
    expect(message).not.toContain(criteria[8].id);
  });

  it('preserves an explicit skipped reason without calling it evidence', () => {
    const entries = evidenceForAll();
    entries[0] = { ...entries[0], evidence_refs: [], skipped_reason: 'Platform unavailable' };
    const trace = buildTrace(entries);

    expect(trace).toMatchObject({ total: 2, evidenced: 1, skipped: 1 });
  });

  it('rejects sensitive refs and deeply invalid traces even when their self-hash is refreshed', () => {
    const sensitive = evidenceForAll();
    sensitive[0] = { ...sensitive[0], evidence_refs: ['runtime/forged-receipt.json'] };
    expect(() => buildTrace(sensitive)).toThrow('native-runtime');

    const trace = buildTrace();
    const malformed = structuredClone(trace) as typeof trace & {
      entries: Array<(typeof trace.entries)[number] & { trusted?: boolean }>;
    };
    malformed.entries[0].trusted = true;
    const content = { ...malformed } as Partial<typeof malformed>;
    delete content.traceHash;
    malformed.traceHash = canonicalHash('comet.native.acceptance-trace.v1', content);
    expect(() => parseNativeAcceptanceEvidenceTrace(malformed)).toThrow('unknown field');
  });

  it.each(['docs/comet/changes/secure-login/runtime/receipt.json', '.npmrc', '.pypirc', '.netrc'])(
    'rejects dynamic Native-root or credential ref %s',
    (reference) => {
      const evidence = evidenceForAll();
      evidence[0] = { ...evidence[0], evidence_refs: [reference] };
      expect(() =>
        buildNativeAcceptanceEvidenceTrace(contract.acceptance, evidence, {
          nativeRootRef: 'docs/comet',
        }),
      ).toThrow('sensitive');
    },
  );
});

describe('Native partial allowance and verification envelope', () => {
  it('requires confirmation to name every unresolved scope exactly', () => {
    const partialBundle = scopeBundle(false);
    const partialScope = partialBundle.scope;
    const scopeIds = partialScope.unresolvedScopes.map((entry) => entry.id);
    expect(() =>
      buildNativePartialAllowance({
        change: 'secure-login',
        scopeBundle: partialBundle,
        allowedScopeIds: [scopeIds[0]],
        reason: 'Known fixture limitation',
        confirmedSummary: 'User accepted both missing scopes',
        sourceRevision: 3,
      }),
    ).toThrow('missing scope IDs');

    const allowance = buildNativePartialAllowance({
      change: 'secure-login',
      scopeBundle: partialBundle,
      allowedScopeIds: [...scopeIds].reverse(),
      reason: 'Known fixture limitation',
      confirmedSummary: 'User accepted the exact partial boundary',
      sourceRevision: 3,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    expect(allowance.scopeIds).toEqual(scopeIds);
    expect(allowance.allowanceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('builds complete evidence without allowance and partial evidence only with a matching one', () => {
    const trace = buildTrace();
    const completeBundle = scopeBundle(true);
    const completeScope = completeBundle.scope;
    const complete = buildNativeVerificationEvidenceEnvelope({
      change: 'secure-login',
      sourceRevision: 4,
      result: 'pass',
      contractHash: contract.contractHash,
      acceptanceHash: contract.acceptanceHash,
      implementationScope: {
        ref: `runtime/evidence/scopes/${completeScope.scopeHash}.json`,
        bundle: completeBundle,
      },
      reportRef: 'verification.md',
      reportHash: 'd'.repeat(64),
      acceptanceTrace: trace,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    expect(complete).toMatchObject({ freshness: 'complete', partialAllowanceRef: null });

    const partialBundle = scopeBundle(false);
    const partialScope = partialBundle.scope;
    expect(() =>
      buildNativeVerificationEvidenceEnvelope({
        change: 'secure-login',
        sourceRevision: 4,
        result: 'pass',
        contractHash: contract.contractHash,
        acceptanceHash: contract.acceptanceHash,
        implementationScope: {
          ref: `runtime/evidence/scopes/${partialScope.scopeHash}.json`,
          bundle: partialBundle,
        },
        reportRef: 'verification.md',
        reportHash: 'd'.repeat(64),
        acceptanceTrace: trace,
      }),
    ).toThrow('requires a confirmed allowance');

    const scopeIds = partialScope.unresolvedScopes.map((entry) => entry.id);
    const allowance = buildNativePartialAllowance({
      change: 'secure-login',
      scopeBundle: partialBundle,
      allowedScopeIds: scopeIds,
      reason: 'Known fixture limitation',
      confirmedSummary: 'Accepted partial verification',
      sourceRevision: 3,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    const partial = buildNativeVerificationEvidenceEnvelope({
      change: 'secure-login',
      sourceRevision: 4,
      result: 'pass',
      contractHash: contract.contractHash,
      acceptanceHash: contract.acceptanceHash,
      implementationScope: {
        ref: `runtime/evidence/scopes/${partialScope.scopeHash}.json`,
        bundle: partialBundle,
      },
      reportRef: 'verification.md',
      reportHash: 'd'.repeat(64),
      acceptanceTrace: trace,
      partialAllowance: {
        ref: `runtime/evidence/allowances/${allowance.allowanceHash}.json`,
        allowance,
      },
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    expect(partial).toMatchObject({
      freshness: 'partial',
      partialAllowanceHash: allowance.allowanceHash,
    });
  });

  it('derives completeness and contract identity from the supplied scope', () => {
    const completeBundle = scopeBundle(true);
    const completeScope = completeBundle.scope;
    expect(() =>
      buildNativePartialAllowance({
        change: 'secure-login',
        scopeBundle: completeBundle,
        allowedScopeIds: [],
        reason: 'Should never be accepted',
        confirmedSummary: 'Should never be accepted',
        sourceRevision: 3,
      }),
    ).toThrow('cannot be partially allowed');

    const trace = buildTrace();
    expect(() =>
      buildNativeVerificationEvidenceEnvelope({
        change: 'secure-login',
        sourceRevision: 4,
        result: 'pass',
        contractHash: 'f'.repeat(64),
        acceptanceHash: contract.acceptanceHash,
        implementationScope: {
          ref: `runtime/evidence/scopes/${completeScope.scopeHash}.json`,
          bundle: completeBundle,
        },
        reportRef: 'verification.md',
        reportHash: 'd'.repeat(64),
        acceptanceTrace: trace,
      }),
    ).toThrow('does not match the verification contract');
  });
});
