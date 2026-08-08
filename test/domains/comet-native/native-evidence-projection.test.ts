import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  readNativeImplementationScope,
  writeNativeImplementationScope,
  writeNativeVerificationReportSnapshot,
  writeNativeVerificationEvidence,
  writeNativeVerificationReceipt,
} from '../../../domains/comet-native/native-evidence-storage.js';
import {
  NATIVE_EVIDENCE_PROJECTION_REF,
  NATIVE_EVIDENCE_PROJECTION_LIMITS,
  renderNativeEvidenceProjectionMarkdown,
  writeNativeEvidenceProjection,
} from '../../../domains/comet-native/native-evidence-projection.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
  nativeRuntimeRefFile,
} from '../../../domains/comet-native/native-paths.js';
import type {
  NativeContentSnapshotManifest,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import { buildNativeImplementationScopeBundle } from '../../../domains/comet-native/native-verification-scope.js';
import {
  buildNativeAcceptanceEvidenceTrace,
  buildNativeVerificationEvidenceEnvelope,
  buildNativePartialAllowance,
} from '../../../domains/comet-native/native-verification-evidence.js';
import { buildNativeVerificationReceipt } from '../../../domains/comet-native/native-verification-receipt.js';
import { buildNativeContractSnapshot } from '../../../domains/comet-native/native-contract.js';

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

describe('Native evidence projection rendering', () => {
  describe('renderNativeEvidenceProjectionMarkdown (pure)', () => {
    it('writes the boundary declaration and generator fingerprint', () => {
      const markdown = renderNativeEvidenceProjectionMarkdown({
        change: 'add-login',
        phase: 'shape',
        revision: 1,
        scope: null,
        envelope: null,
        receipts: [],
        generatedAt: '2026-08-07T00:00:00.000Z',
      });
      expect(markdown).toContain('Generated-by: comet-native');
      expect(markdown).toContain('Do not hand-edit');
      expect(markdown).toContain('never cite this file as verification proof');
      expect(markdown).toContain('- Change: add-login');
      expect(markdown).toContain('- Phase: shape');
      expect(markdown).toContain('- Revision: 1');
      expect(markdown).toContain('No implementation scope evidence recorded yet.');
      expect(markdown).toContain('No verification evidence recorded yet.');
    });

    it('is deterministic: identical inputs produce identical bytes', () => {
      const input = {
        change: 'add-login',
        phase: 'verify' as const,
        revision: 3,
        scope: null,
        envelope: null,
        receipts: [],
        generatedAt: '2026-08-07T00:00:00.000Z',
      };
      expect(renderNativeEvidenceProjectionMarkdown(input)).toBe(
        renderNativeEvidenceProjectionMarkdown({ ...input }),
      );
    });
  });
});

describe('Native evidence projection write', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-projection-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    await createNativeChange({
      paths,
      name: 'secure-login',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function buildFixtureEvidence() {
    const contract = buildNativeContractSnapshot({
      briefMarkdown: '# Acceptance examples\n- Login succeeds.\n',
      specs: [],
    });
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current: snapshot([
        { path: 'src/login.ts', hash: 'a'.repeat(64), size: 10, type: 'file' },
        { path: 'src/session.ts', hash: 'b'.repeat(64), size: 20, type: 'file' },
      ]),
      contractHash: contract.contractHash,
      declaredArtifacts: [],
    });
    const { scope } = bundle;
    // The acceptance trace evidence_refs must reference real receipt hashes so
    // the projection can read them back. The receipt is built first, then its
    // hash is wired into the trace.
    const acceptanceReceipt = buildNativeVerificationReceipt({
      kind: 'automated-check',
      role: 'acceptance-evidence',
      status: 'passed',
      bindings: {
        change: 'secure-login',
        sourceRevision: 3,
        contractHash: contract.contractHash,
        scopeHash: scope.scopeHash,
        snapshotHash: 'd'.repeat(64),
        artifactHash: 'e'.repeat(64),
      },
      acceptanceIds: [contract.acceptance[0].id],
      actor: 'comet-native:test',
      issuedAt: '2026-07-17T00:00:00.000Z',
      evidence: {
        executable: 'npm',
        args: ['test', '--', 'login'],
        cwd: '/repo',
        exitCode: 0,
        signal: null,
        timedOut: false,
        timeoutMs: 60000,
        startedAt: '2026-07-17T00:00:00.000Z',
        endedAt: '2026-07-17T00:00:01.000Z',
        worktree: {
          provider: 'none',
          root: '/repo',
          beforeCommit: null,
          afterCommit: null,
        },
        afterFence: {
          snapshotHash: 'd'.repeat(64),
          scopeHash: scope.scopeHash,
          matched: true,
        },
        outputHash: createHash('sha256').update('all good').digest('hex'),
        outputSummary: 'all good',
        outputTruncated: false,
      },
    });
    const trace = buildNativeAcceptanceEvidenceTrace(
      contract.acceptance,
      [
        {
          acceptance_id: contract.acceptance[0].id,
          status: 'passed' as const,
          evidence_refs: [`runtime/evidence/receipts/${acceptanceReceipt.receiptHash}.json`],
        },
      ],
      { nativeRootRef: 'comet' },
    );
    return { bundle, contract, scope, trace, acceptanceReceipt };
  }

  it('is a no-op when no evidence is recorded (shape phase)', async () => {
    await writeNativeEvidenceProjection(paths, 'secure-login');
    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...NATIVE_EVIDENCE_PROJECTION_REF.split('/'),
    );
    await expect(fs.access(file)).rejects.toThrow();
  });

  it('writes a human-readable projection after scope evidence is recorded', async () => {
    const { bundle } = buildFixtureEvidence();
    const scopeRef = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });

    const state = await readNativeChange(paths, 'secure-login');
    await writeNativeChange(paths, {
      ...state,
      implementation_scope: scopeRef as never,
      partial_allowance: null,
      verification_evidence: null,
    });

    await writeNativeEvidenceProjection(paths, 'secure-login', {
      now: new Date('2026-08-07T00:00:00.000Z'),
    });

    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...NATIVE_EVIDENCE_PROJECTION_REF.split('/'),
    );
    const markdown = await fs.readFile(file, 'utf8');

    expect(markdown).toContain('Generated-by: comet-native');
    expect(markdown).toContain('## Implementation scope');
    expect(markdown).toContain('src/login.ts added 0→10 bytes');
    expect(markdown).toContain('src/session.ts added 0→20 bytes');
    // Scope-only projection: verification section shows the placeholder.
    expect(markdown).toContain('No verification evidence recorded yet.');
  });

  it('writes scope, verification, and receipt sections for a verified change', async () => {
    const { bundle, contract, scope, trace, acceptanceReceipt } = buildFixtureEvidence();
    const scopeRef = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const scopeIds = scope.unresolvedScopes.map((entry) => entry.id);
    const allowance = buildNativePartialAllowance({
      change: 'secure-login',
      scopeBundle: bundle,
      allowedScopeIds: scopeIds,
      reason: 'Known fixture boundary',
      confirmedSummary: 'Accepted the exact partial boundary',
      sourceRevision: 2,
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    // Partial allowance write helper lives in storage; import lazily to avoid cycle noise.
    const { writeNativePartialAllowance } =
      await import('../../../domains/comet-native/native-evidence-storage.js');
    const allowanceRef = await writeNativePartialAllowance({
      paths,
      name: 'secure-login',
      allowance,
    });
    const receiptRef = await writeNativeVerificationReceipt({
      paths,
      name: 'secure-login',
      receipt: acceptanceReceipt,
    });
    const evidence = buildNativeVerificationEvidenceEnvelope({
      change: 'secure-login',
      sourceRevision: 3,
      result: 'pass',
      contractHash: contract.contractHash,
      acceptanceHash: contract.acceptanceHash,
      implementationScope: { ref: scopeRef, bundle },
      reportRef: 'verification.md',
      reportHash: createHash('sha256').update('Verification passed.').digest('hex'),
      acceptanceTrace: trace,
      requiredReceiptRefs: [receiptRef],
      partialAllowance: { ref: allowanceRef, allowance },
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    await writeNativeVerificationReportSnapshot({
      paths,
      name: 'secure-login',
      hash: evidence.reportHash,
      text: 'Verification passed.',
    });
    const evidenceRef = await writeNativeVerificationEvidence({
      paths,
      name: 'secure-login',
      evidence,
    });

    const state = await readNativeChange(paths, 'secure-login');
    await writeNativeChange(paths, {
      ...state,
      implementation_scope: scopeRef as never,
      verification_evidence: evidenceRef as never,
      partial_allowance: allowanceRef as never,
    });

    await writeNativeEvidenceProjection(paths, 'secure-login', {
      now: new Date('2026-08-07T00:00:00.000Z'),
    });

    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...NATIVE_EVIDENCE_PROJECTION_REF.split('/'),
    );
    const markdown = await fs.readFile(file, 'utf8');

    expect(markdown).toContain('## Verification');
    expect(markdown).toContain('- Result: pass');
    expect(markdown).toContain('### Acceptance trace');
    expect(markdown).toContain('### Check receipts');
    expect(markdown).toContain('automated-check (acceptance-evidence) passed');
    expect(markdown).toContain('command: `npm test -- login`');
    expect(markdown).toContain('exit code: 0');

    // Regenerating with the same state is idempotent (deterministic body aside from
    // the timestamp, which is pinned by the injected clock).
    await writeNativeEvidenceProjection(paths, 'secure-login', {
      now: new Date('2026-08-07T00:00:00.000Z'),
    });
    expect(await fs.readFile(file, 'utf8')).toBe(markdown);
  });

  it('truncates long unresolved scope lists with a truncation marker', async () => {
    // The scope builder collapses changes beyond MAX_NATIVE_DETAILED_SCOPE_CHANGES
    // into a single scope-detail-overflow entry, so a large unattributed change
    // set surfaces here as many unresolved reasons (one per unattributed path).
    // The projection bounds these rather than dumping hundreds of lines.
    const overflowCount = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxUnresolvedReasons + 5;
    const manyEntries = Array.from({ length: 128 + overflowCount }, (_, index) => ({
      path: `src/file-${String(index).padStart(3, '0')}.ts`,
      hash: 'a'.repeat(64),
      size: index + 1,
      type: 'file' as const,
    }));
    const bigSnapshot: NativeContentSnapshotManifest = {
      schema: 'comet.native.content-snapshot.v1',
      origin: 'explicit',
      createdAt: '2026-07-17T00:00:00.000Z',
      complete: true,
      limits: {
        maxFiles: manyEntries.length,
        maxFileBytes: 1024,
        maxTotalBytes: manyEntries.length * 1024,
        maxManifestBytes: manyEntries.length * 1024,
      },
      entries: manyEntries,
      omitted: [],
      omittedCount: 0,
    };
    const contract = buildNativeContractSnapshot({
      briefMarkdown: '# Acceptance examples\n- Login succeeds.\n',
      specs: [],
    });
    const bundle = buildNativeImplementationScopeBundle({
      baseline: snapshot([]),
      current: bigSnapshot,
      contractHash: contract.contractHash,
      declaredArtifacts: [],
    });
    const scopeRef = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const state = await readNativeChange(paths, 'secure-login');
    await writeNativeChange(paths, {
      ...state,
      implementation_scope: scopeRef as never,
      verification_evidence: null,
      partial_allowance: null,
    });

    await writeNativeEvidenceProjection(paths, 'secure-login', {
      now: new Date('2026-08-07T00:00:00.000Z'),
    });

    const file = path.join(
      nativeChangeDir(paths, 'secure-login'),
      ...NATIVE_EVIDENCE_PROJECTION_REF.split('/'),
    );
    const markdown = await fs.readFile(file, 'utf8');
    expect(markdown).toContain('more unresolved reason(s) truncated');
  });

  it('reads back through the content-addressed readers (tampered evidence surfaces as an error)', async () => {
    const { bundle } = buildFixtureEvidence();
    const scopeRef = await writeNativeImplementationScope({
      paths,
      name: 'secure-login',
      bundle,
    });
    const state = await readNativeChange(paths, 'secure-login');
    await writeNativeChange(paths, {
      ...state,
      implementation_scope: scopeRef as never,
      verification_evidence: null,
      partial_allowance: null,
    });

    // Sanity: the projection reads cleanly before tampering.
    await writeNativeEvidenceProjection(paths, 'secure-login');

    const scopeFile = nativeRuntimeRefFile(nativeChangeRuntimeDir(paths, 'secure-login'), scopeRef);
    const value = JSON.parse(await fs.readFile(scopeFile, 'utf8')) as Record<string, unknown>;
    value.complete = true;
    await fs.writeFile(scopeFile, JSON.stringify(value));

    // The readers re-hash on read, so a mismatched body is rejected rather than projected.
    await expect(writeNativeEvidenceProjection(paths, 'secure-login')).rejects.toThrow();
    // And the underlying reader agrees.
    await expect(readNativeImplementationScope(paths, 'secure-login', scopeRef)).rejects.toThrow();
  });
});
