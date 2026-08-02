import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { parseNativeVerificationMachineBlock } from '../../../domains/comet-native/native-acceptance.js';
import { replaceAcceptanceEvidenceBlock } from '../../../domains/comet-native/native-receipt-refresh.js';
import { atomicWriteText } from '../../../domains/comet-native/native-atomic-file.js';
import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
  nativeChangeDocument,
  NATIVE_CHANGE_STATE_FILE,
} from '../../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../../domains/comet-native/native-contract-files.js';
import {
  readNativeImplementationScopeBundle,
  readNativeVerificationReceipt,
  writeNativeVerificationReceipt,
} from '../../../domains/comet-native/native-evidence-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import {
  isManualReceiptRefreshSafe,
  refreshNativeVerificationReceipts,
} from '../../../domains/comet-native/native-receipt-refresh.js';
import {
  inspectNativeVerificationEvidence,
  prepareNativeVerificationEvidence,
  NativeVerificationReceiptBindingError,
} from '../../../domains/comet-native/native-verification-runtime.js';
import { persistNativeStaticInspectionReceipt } from '../../../domains/comet-native/native-verification-receipt-runtime.js';
import {
  buildNativeVerificationReceipt,
  nativeArtifactBindingHash,
  type NativeVerificationReceiptBindings,
} from '../../../domains/comet-native/native-verification-receipt.js';
import { buildNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt-model.js';
import {
  readNativeCheckReceipt,
  writeNativeCheckReceipt,
} from '../../../domains/comet-native/native-check-receipt-storage.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

const brief = `# Outcome
Ship the focused behavior.
# Scope
Update one implementation file.
# Non-goals
No unrelated changes.
# Acceptance examples
- The focused behavior works.
- The focused result remains observable.
# Constraints and invariants
Keep callers stable.
# Decisions
Use the current module.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

/**
 * Write a Native change state to disk without bumping the revision. The CAS
 * primitives always increment revision, which would re-stale receipts we just
 * issued; this helper writes the document verbatim so a test can pin the exact
 * revision that receipts were bound to.
 */
async function writeStateVerbatim(stateFile: string, state: NativeChangeState): Promise<void> {
  await atomicWriteText(stateFile, stringifyYaml(nativeChangeDocument(state)));
}

describe('Native receipt refresh', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;
  let stateFile: string;
  let verifyState: NativeChangeState;
  let acceptanceIds: string[];
  let requiredReceiptRef: string;

  afterEach(async () => {
    if (projectRoot) await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function currentBindings(
    state: NativeChangeState,
  ): Promise<NativeVerificationReceiptBindings> {
    const [scope, contract] = await Promise.all([
      readNativeImplementationScopeBundle(paths, state.name, state.implementation_scope!),
      collectNativeContractFiles({
        changeDir,
        briefRef: state.brief,
        specChanges: state.spec_changes,
      }),
    ]);
    return {
      change: state.name,
      sourceRevision: state.revision,
      contractHash: contract.contract.contractHash,
      scopeHash: scope.scope.scopeHash,
      snapshotHash: scope.scope.currentProjectionHash,
      artifactHash: nativeArtifactBindingHash(scope.scope.declaredArtifacts),
    };
  }

  async function writeManualReceiptAtRevision(
    state: NativeChangeState,
    revision: number,
    ids: readonly string[],
  ): Promise<string> {
    const current = await currentBindings(state);
    return writeNativeVerificationReceipt({
      paths,
      name: state.name,
      receipt: buildNativeVerificationReceipt({
        kind: 'manual-evidence',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings: { ...current, sourceRevision: revision },
        acceptanceIds: [...ids],
        actor: 'runtime-test',
        issuedAt: '2026-07-17T01:20:00.000Z',
        evidence: {
          steps: ['Execute the focused acceptance check.'],
          observations: ['The focused behavior matched the contract.'],
        },
      }),
    });
  }

  async function writeAutomatedReceiptAtRevision(
    state: NativeChangeState,
    revision: number,
    ids: readonly string[],
  ): Promise<string> {
    const current = await currentBindings(state);
    const bindings: NativeVerificationReceiptBindings = { ...current, sourceRevision: revision };
    return writeNativeVerificationReceipt({
      paths,
      name: state.name,
      receipt: buildNativeVerificationReceipt({
        kind: 'automated-check',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds: [...ids],
        actor: 'native-runtime:command:node',
        issuedAt: '2026-07-17T01:20:00.000Z',
        evidence: {
          executable: 'node',
          args: ['--test', 'focused.test.ts'],
          cwd: '.',
          exitCode: 0,
          signal: null,
          timedOut: false,
          timeoutMs: 120_000,
          startedAt: '2026-07-17T01:19:59.000Z',
          endedAt: '2026-07-17T01:20:00.000Z',
          worktree: { provider: 'none', root: '.', beforeCommit: null, afterCommit: null },
          afterFence: {
            snapshotHash: bindings.snapshotHash,
            scopeHash: bindings.scopeHash,
            matched: true,
          },
          outputHash: '0'.repeat(64),
          outputSummary: 'ok',
          outputTruncated: false,
        },
      }),
    });
  }

  async function writeRequiredCheckReceipt(state: NativeChangeState): Promise<string> {
    const scope = await readNativeImplementationScopeBundle(
      paths,
      state.name,
      state.implementation_scope!,
    );
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: state.brief,
      specChanges: state.spec_changes,
    });
    const selected = scope.scope.changes.filter((change) => change.after !== null);
    const checkRef = await writeNativeCheckReceipt({
      paths,
      name: state.name,
      receipt: buildNativeCheckReceipt({
        change: state.name,
        sourceRevision: state.revision,
        status: 'passed',
        startedAt: '2026-07-17T01:30:00.000Z',
        endedAt: '2026-07-17T01:30:01.000Z',
        contract: {
          expectedHash: contract.contract.contractHash,
          beforeHash: contract.contract.contractHash,
          afterHash: contract.contract.contractHash,
        },
        implementation: {
          scopeHash: scope.scope.scopeHash,
          expectedSnapshotHash: scope.scope.currentProjectionHash,
          beforeSnapshotHash: scope.scope.currentProjectionHash,
          afterSnapshotHash: scope.scope.currentProjectionHash,
        },
        counts: {
          filesSelected: selected.length,
          filesScanned: selected.length,
          binaryFilesSkipped: 0,
          bytesScanned: selected.reduce((total, change) => total + change.after!.size, 0),
          issueCount: 0,
          recordedIssueCount: 0,
        },
        issues: [],
        issuesTruncated: false,
        stale: false,
        staleReasons: [],
      }),
    });
    return (
      await persistNativeStaticInspectionReceipt({
        paths,
        state,
        checkReceipt: await readNativeCheckReceipt(paths, state.name, checkRef),
        checkReceiptRef: checkRef,
      })
    ).ref;
  }

  /**
   * Seed a verify-phase fixture, then finalize it with a manual acceptance
   * receipt bound to {@link acceptanceRevision}. The acceptance receipt, the
   * required-check receipt, the verification report, the evidence envelope, and
   * the on-disk state are all pinned to {@link acceptanceRevision}, so the
   * fixture is internally consistent (fresh) when acceptanceRevision equals
   * verifyState.revision.
   */
  async function seedFixtureWithAcceptanceRevision(acceptanceRevision: number): Promise<string> {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-receipt-refresh-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'receipt-refresh',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    changeDir = nativeChangeDir(paths, created.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    const buildState: NativeChangeState = { ...created, phase: 'build', approval: 'implicit' };
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    const build = await prepareNativeBuildEvidence({
      paths,
      state: buildState,
      artifactRefs: ['src/feature.ts'],
      now: new Date('2026-07-17T01:00:00.000Z'),
    });
    verifyState = {
      ...buildState,
      phase: 'verify',
      revision: buildState.revision + 1,
      implementation_scope: build.scopeRef as NativeChangeState['implementation_scope'],
      partial_allowance: null,
    };
    stateFile = path.join(changeDir, NATIVE_CHANGE_STATE_FILE);
    // Pin the on-disk revision verbatim so the acceptance receipt (issued below
    // at acceptanceRevision) stays consistent with the state we finally persist.
    await writeStateVerbatim(stateFile, verifyState);
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    acceptanceIds = contract.contract.acceptance.map((criterion) => criterion.id);
    const acceptanceRef = await writeManualReceiptAtRevision(
      verifyState,
      acceptanceRevision,
      acceptanceIds,
    );
    requiredReceiptRef = await writeRequiredCheckReceipt(verifyState);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: verifyState.name,
        evidenceRefs: [acceptanceRef],
      }),
    );
    const preparation = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      receiptRef: requiredReceiptRef,
      now: new Date('2026-07-17T02:00:00.000Z'),
    });
    verifyState = {
      ...verifyState,
      verification_result: 'pass',
      verification_report: 'verification.md',
      verification_evidence: preparation.evidenceRef as NativeChangeState['verification_evidence'],
    };
    await writeStateVerbatim(stateFile, verifyState);
    return acceptanceRef;
  }

  async function replaceAcceptanceReceiptInReport(
    acceptanceRef: string,
    boundRevision: number,
    kind: 'manual' | 'automated',
  ): Promise<void> {
    const newRef =
      kind === 'manual'
        ? await writeManualReceiptAtRevision(verifyState, boundRevision, acceptanceIds)
        : await writeAutomatedReceiptAtRevision(verifyState, boundRevision, acceptanceIds);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: verifyState.name,
        evidenceRefs: [newRef],
      }),
    );
    void acceptanceRef;
    const preparation = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      receiptRef: requiredReceiptRef,
      now: new Date('2026-07-17T02:30:00.000Z'),
    });
    verifyState = {
      ...verifyState,
      verification_evidence: preparation.evidenceRef as NativeChangeState['verification_evidence'],
    };
    await writeStateVerbatim(stateFile, verifyState);
  }

  /**
   * Bump the on-disk state revision without re-issuing receipts. This models the
   * real staleness trigger: a state write (checkpoint, spec refresh, phase
   * advance) increments the revision, which leaves every receipt bound to the
   * previous revision stale while the evidence envelope stays on disk.
   */
  async function bumpStateRevision(): Promise<void> {
    verifyState = { ...verifyState, revision: verifyState.revision + 1 };
    await writeStateVerbatim(stateFile, verifyState);
  }

  it('only allows automatic manual refresh for a sourceRevision-only mismatch', () => {
    expect(
      isManualReceiptRefreshSafe({
        ok: false,
        mismatches: ['sourceRevision: expected 3, got 2'],
      }),
    ).toBe(true);
    expect(
      isManualReceiptRefreshSafe({
        ok: false,
        mismatches: [
          'sourceRevision: expected 3, got 2',
          'contractHash: expected "new", got "old"',
        ],
      }),
    ).toBe(false);
    expect(
      isManualReceiptRefreshSafe({
        ok: false,
        mismatches: ['contractHash: expected "new", got "old"'],
      }),
    ).toBe(false);
  });

  it('reports no stale receipts when everything is current', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    const result = await refreshNativeVerificationReceipts({
      paths,
      name: verifyState.name,
      apply: false,
    });
    expect(result).toMatchObject({
      refreshed: [],
      requiresRerun: [],
      requiresCheck: [],
      applied: false,
    });
  });

  it('returns a no-op when Verify has no evidence envelope yet', async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-receipt-refresh-empty-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'receipt-refresh-empty',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    verifyState = { ...created, phase: 'verify' };
    stateFile = path.join(nativeChangeDir(paths, verifyState.name), NATIVE_CHANGE_STATE_FILE);
    await writeStateVerbatim(stateFile, verifyState);

    await expect(
      refreshNativeVerificationReceipts({ paths, name: verifyState.name, apply: true }),
    ).resolves.toMatchObject({
      refreshed: [],
      requiresRerun: [],
      requiresManual: [],
      requiresCheck: [],
      applied: false,
      verificationReport: null,
    });
  });

  it('refuses to rewrite stale receipts when the verification report reference is missing', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    await bumpStateRevision();
    await writeStateVerbatim(stateFile, { ...verifyState, verification_report: null });

    await expect(
      refreshNativeVerificationReceipts({ paths, name: verifyState.name, apply: true }),
    ).rejects.toThrow('has no report ref');
  });

  it('reports stale manual receipts on dry-run without touching files', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    await bumpStateRevision();
    const before = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');

    const result = await refreshNativeVerificationReceipts({
      paths,
      name: verifyState.name,
      apply: false,
    });
    expect(result.applied).toBe(false);
    expect(result.refreshed).toEqual([]);
    expect(result.requiresRerun).toEqual([]);
    const after = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('re-issues stale manual receipts under --apply and rewrites verification.md', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    await bumpStateRevision();

    const result = await refreshNativeVerificationReceipts({
      paths,
      name: verifyState.name,
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(result.refreshed.length).toBeGreaterThan(0);
    expect(result.verificationReport).toBe('verification.md');
    for (const item of result.refreshed) {
      expect(item.newRef).not.toBe(item.oldRef);
      const reissued = await readNativeVerificationReceipt(paths, verifyState.name, item.newRef);
      expect(reissued.bindings.sourceRevision).toBe(verifyState.revision);
    }
    const updated = await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8');
    const entries = parseNativeVerificationMachineBlock(updated);
    const freshRefs = new Set(result.refreshed.map((item) => item.newRef));
    for (const entry of entries) {
      expect(entry.evidence_refs.some((ref) => freshRefs.has(ref))).toBe(true);
    }
  });

  it('reports stale automated receipts as requiring rerun and never silently re-issues them', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    // Swap the fresh manual receipt for an automated one, then bump the revision
    // so the automated receipt becomes stale.
    await replaceAcceptanceReceiptInReport('unused', 2, 'automated');
    await bumpStateRevision();

    const result = await refreshNativeVerificationReceipts({
      paths,
      name: verifyState.name,
      apply: true,
    });
    expect(result.applied).toBe(false);
    expect(result.refreshed).toEqual([]);
    expect(result.requiresRerun.length).toBe(1);
    expect(result.requiresRerun[0].command).toContain('node');
  });

  it('refuses to refresh outside the verify phase', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    await writeStateVerbatim(stateFile, { ...verifyState, phase: 'build' });
    await expect(
      refreshNativeVerificationReceipts({ paths, name: verifyState.name, apply: false }),
    ).rejects.toThrow(/requires Verify, got build/u);
  });

  it('exposes per-receipt mismatch diagnostics via the verification-receipt-binding-mismatch finding', async () => {
    await seedFixtureWithAcceptanceRevision(2);
    await bumpStateRevision();
    // The A-block error path: a stale sourceRevision surfaces a structured
    // binding-mismatch finding rather than an opaque exit-65 throw.
    const preparation = await inspectNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      receiptRef: requiredReceiptRef,
    });
    expect(preparation.ready).toBe(false);
    expect(preparation.findingCodes).toContain('verification-receipt-binding-mismatch');
    expect(preparation.receiptBindingFailures?.length).toBeGreaterThan(0);
    const failure = preparation.receiptBindingFailures![0];
    expect(failure.mismatches.some((m) => m.includes('sourceRevision'))).toBe(true);
    expect(NativeVerificationReceiptBindingError).toBeDefined();
  });

  it('rejects reports without both acceptance-evidence markers', () => {
    expect(() => replaceAcceptanceEvidenceBlock('plain report', 'new block')).toThrow(
      'missing the acceptance-evidence start marker',
    );
    expect(() =>
      replaceAcceptanceEvidenceBlock(
        '<!-- comet-native:acceptance-evidence:start -->',
        'new block',
      ),
    ).toThrow('missing the acceptance-evidence end marker');
  });
});
