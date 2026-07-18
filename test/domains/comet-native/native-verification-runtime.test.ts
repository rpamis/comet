import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serializeNativeVerificationMachineBlock } from '../../../domains/comet-native/native-acceptance.js';
import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../../domains/comet-native/native-contract-files.js';
import { buildNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt-model.js';
import { writeNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt-storage.js';
import {
  readNativeImplementationScopeBundle,
  readNativeVerificationEvidence,
} from '../../../domains/comet-native/native-evidence-storage.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import {
  inspectNativeVerificationFreshness,
  prepareNativeVerificationEvidence,
} from '../../../domains/comet-native/native-verification-runtime.js';

const brief = `# Outcome
Ship the focused behavior.
# Scope
Update one implementation file.
# Non-goals
No unrelated changes.
# Acceptance examples
- The focused behavior works.
# Constraints and invariants
Keep callers stable.
# Decisions
Use the current module.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

describe('Native verification evidence runtime', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;
  let verifyState: NativeChangeState;
  let report: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-verification-runtime-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'verified-change',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    changeDir = nativeChangeDir(paths, created.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    const buildState: NativeChangeState = {
      ...created,
      phase: 'build',
      approval: 'implicit',
    };
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
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const machineBlock = serializeNativeVerificationMachineBlock(
      contract.contract.acceptance.map((criterion) => ({
        acceptance_id: criterion.id,
        evidence_refs: ['src/feature.ts'],
      })),
    );
    report = `# Acceptance evidence
${machineBlock}
# Commands and results
Focused check passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`;
    await fs.writeFile(path.join(changeDir, 'verification.md'), report);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function writeCheckReceipt(options?: {
    stale?: boolean;
    status?: 'passed' | 'failed';
  }): Promise<string> {
    const scope = await readNativeImplementationScopeBundle(
      paths,
      verifyState.name,
      verifyState.implementation_scope!,
    );
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const stale = options?.stale ?? false;
    const status = options?.status ?? 'passed';
    const snapshotHash = scope.scope.currentProjectionHash;
    const failed = status === 'failed';
    const receipt = buildNativeCheckReceipt({
      change: verifyState.name,
      sourceRevision: verifyState.revision,
      status,
      startedAt: '2026-07-17T01:30:00.000Z',
      endedAt: '2026-07-17T01:30:01.000Z',
      contract: {
        expectedHash: contract.contract.contractHash,
        beforeHash: contract.contract.contractHash,
        afterHash: contract.contract.contractHash,
      },
      implementation: {
        scopeHash: scope.scope.scopeHash,
        expectedSnapshotHash: snapshotHash,
        beforeSnapshotHash: stale ? '3'.repeat(64) : snapshotHash,
        afterSnapshotHash: snapshotHash,
      },
      counts: {
        filesSelected: 1,
        filesScanned: 1,
        binaryFilesSkipped: 0,
        bytesScanned: 24,
        issueCount: failed ? 1 : 0,
        recordedIssueCount: failed ? 1 : 0,
      },
      issues: failed ? [{ path: 'src/feature.ts', line: 1, kind: 'trailing-whitespace' }] : [],
      issuesTruncated: false,
      stale,
      staleReasons: stale ? ['implementation-before-does-not-match-scope'] : [],
    });
    return writeNativeCheckReceipt({ paths, name: verifyState.name, receipt });
  }

  async function archiveState(receiptRef?: string): Promise<{
    state: NativeChangeState;
    evidenceRef: string;
  }> {
    const prepared = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      receiptRef: receiptRef ?? null,
      now: new Date('2026-07-17T02:00:00.000Z'),
    });
    expect(prepared.ready).toBe(true);
    const state: NativeChangeState = {
      ...verifyState,
      phase: 'archive',
      revision: verifyState.revision + 1,
      verification_result: 'pass',
      verification_report: 'verification.md',
      verification_evidence: prepared.evidenceRef as NativeChangeState['verification_evidence'],
    };
    return { state, evidenceRef: prepared.evidenceRef! };
  }

  it('creates a content-bound envelope and reports complete freshness', async () => {
    const { state } = await archiveState();

    const inspection = await inspectNativeVerificationFreshness({ paths, state });

    expect(inspection).toMatchObject({
      freshness: 'complete',
      findingCodes: [],
      evidence: {
        result: 'pass',
        freshness: 'complete',
        skippedAcceptanceCount: 0,
      },
    });
    expect(inspection.evidence.envelopeHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('preserves an immutable report snapshot after the live report is rewritten', async () => {
    const { evidenceRef } = await archiveState();
    const envelope = await readNativeVerificationEvidence(paths, verifyState.name, evidenceRef);
    const snapshot = path.join(
      changeDir,
      'runtime',
      'evidence',
      'reports',
      `${envelope.reportHash}.json`,
    );

    expect(JSON.parse(await fs.readFile(snapshot, 'utf8'))).toMatchObject({ content: report });
    await fs.writeFile(path.join(changeDir, 'verification.md'), `${report}\nReverified later.\n`);
    expect(JSON.parse(await fs.readFile(snapshot, 'utf8'))).toMatchObject({ content: report });
  });

  it('binds a fresh Native check receipt and revalidates its policy during freshness inspection', async () => {
    const receiptRef = await writeCheckReceipt();
    const { state } = await archiveState(receiptRef);

    const fresh = await inspectNativeVerificationFreshness({ paths, state });
    expect(fresh).toMatchObject({
      freshness: 'complete',
      findingCodes: [],
      envelope: { receiptRef },
    });

    const receiptFile = path.join(changeDir, ...receiptRef.split('/'));
    const persisted = JSON.parse(await fs.readFile(receiptFile, 'utf8')) as {
      checker: { version: number };
    };
    persisted.checker.version = 0;
    await fs.writeFile(receiptFile, JSON.stringify(persisted));
    const invalidPolicy = await inspectNativeVerificationFreshness({ paths, state });
    expect(invalidPolicy).toMatchObject({
      freshness: 'stale',
      findingCodes: ['verification-receipt-invalid'],
    });
  });

  it('rejects an unsupported check policy before binding Verify evidence', async () => {
    const receiptRef = await writeCheckReceipt();
    const receiptFile = path.join(changeDir, ...receiptRef.split('/'));
    const persisted = JSON.parse(await fs.readFile(receiptFile, 'utf8')) as {
      checker: { version: number };
    };
    persisted.checker.version = 0;
    await fs.writeFile(receiptFile, JSON.stringify(persisted));

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
      }),
    ).rejects.toThrow('checker policy is unsupported');
  });

  it('refuses to bind a stale Native check receipt', async () => {
    const receiptRef = await writeCheckReceipt({ stale: true, status: 'failed' });

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
      }),
    ).rejects.toThrow('verification receipt is not admissible');
  });

  it('rejects a failed receipt for pass while allowing it to explain a failed outcome', async () => {
    const failedRef = await writeCheckReceipt({ status: 'failed' });
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: failedRef,
      }),
    ).rejects.toThrow('verification receipt is not admissible');
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'fail',
        reportRef: 'verification.md',
        receiptRef: failedRef,
      }),
    ).resolves.toMatchObject({ ready: true });
  });

  it('refuses to create evidence when implementation changed after Build capture', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');

    const prepared = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
    });

    expect(prepared).toEqual({
      ready: false,
      findingCodes: ['verification-implementation-stale'],
      envelope: null,
      evidenceRef: null,
      reportSnapshot: null,
    });
  });

  it.each([
    ['implementation', 'verification-implementation-stale'],
    ['contract', 'verification-contract-stale'],
    ['report', 'verification-report-stale'],
  ] as const)('marks a changed %s boundary stale', async (boundary, expectedCode) => {
    const { state } = await archiveState();
    if (boundary === 'implementation') {
      await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 4;\n');
    } else if (boundary === 'contract') {
      await fs.writeFile(path.join(changeDir, 'brief.md'), brief.replace('works.', 'is correct.'));
    } else {
      await fs.writeFile(path.join(changeDir, 'verification.md'), report.replace('Pass.', 'Pass!'));
    }

    const inspection = await inspectNativeVerificationFreshness({ paths, state });

    expect(inspection.freshness).toBe('stale');
    expect(inspection.findingCodes).toContain(expectedCode);
  });

  it('fails closed when the evidence document is tampered with', async () => {
    const { state, evidenceRef } = await archiveState();
    const evidenceFile = path.join(changeDir, ...evidenceRef.split('/'));
    const value = JSON.parse(await fs.readFile(evidenceFile, 'utf8')) as Record<string, unknown>;
    value.result = 'fail';
    await fs.writeFile(evidenceFile, JSON.stringify(value));

    const inspection = await inspectNativeVerificationFreshness({ paths, state });

    expect(inspection).toMatchObject({
      freshness: 'invalid',
      findingCodes: ['verification-evidence-invalid'],
      envelope: null,
    });
  });

  it('detects a state/envelope ref mismatch without trusting state booleans', async () => {
    const { state } = await archiveState();
    const mismatched = { ...state, verification_result: 'fail' as const };

    const inspection = await inspectNativeVerificationFreshness({ paths, state: mismatched });

    expect(inspection).toMatchObject({
      freshness: 'stale',
      findingCodes: ['verification-state-mismatch'],
    });
  });
});
