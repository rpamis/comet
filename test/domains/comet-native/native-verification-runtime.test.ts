import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseNativeVerificationMachineBlock,
  serializeNativeVerificationMachineBlock,
} from '../../../domains/comet-native/native-acceptance.js';
import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../../domains/comet-native/native-contract-files.js';
import { buildNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt-model.js';
import {
  readNativeCheckReceipt,
  writeNativeCheckReceipt,
} from '../../../domains/comet-native/native-check-receipt-storage.js';
import {
  readNativeImplementationScopeBundle,
  readNativeVerificationEvidence,
  readNativeVerificationReceipt,
  readNativeWaiverReceipt,
  writeNativeVerificationReceipt,
  writeNativeWaiverReceipt,
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
import { persistNativeStaticInspectionReceipt } from '../../../domains/comet-native/native-verification-receipt-runtime.js';
import {
  buildNativeVerificationReceipt,
  buildNativeReviewEvidenceGraph,
  buildNativeWaiverReceipt,
  nativeArtifactBindingHash,
  nativeBlockedCheckId,
  nativeImplementationAttestationHash,
  nativeIndependentReviewAttestationHash,
  nativeReviewAcceptanceMatrixHash,
  nativeWaiverAttestationHash,
} from '../../../domains/comet-native/native-verification-receipt.js';
import {
  generateNativeReviewKeyPair,
  signNativeReviewPayloadHash,
} from '../../../domains/comet-native/native-review-identity.js';
import {
  buildNativeReviewTrustPolicy,
  NATIVE_REVIEW_TRUST_POLICY_REF,
} from '../../../domains/comet-native/native-review-trust.js';
import {
  authorizeNativeTestChange,
  installNativeControllerTrust,
} from '../../helpers/native-controller-trust.js';

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

describe('Native verification evidence runtime', () => {
  const implementation = generateNativeReviewKeyPair();
  const reviewer = generateNativeReviewKeyPair();
  const waiverSigner = generateNativeReviewKeyPair();
  const controller = generateNativeReviewKeyPair();
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;
  let verifyState: NativeChangeState;
  let report: string;
  let acceptanceReceiptRef: string;
  let applicabilityReviewRef: string;
  let cleanupControllerTrust: () => Promise<void>;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-verification-runtime-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(projectRoot, 'domains', 'comet-native'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    await fs.writeFile(
      path.join(projectRoot, 'domains', 'comet-native', 'policy.ts'),
      'export const policy = 1;\n',
    );
    cleanupControllerTrust = await installNativeControllerTrust({
      projectRoot,
      controller,
    });
    const policy = buildNativeReviewTrustPolicy({
      controllerIdentity: controller.identity,
      controllerPrivateKey: controller.privateKey,
      implementationKeyId: implementation.identity.keyId,
      trustedReviewers: [reviewer.identity],
      trustedWaiverSigners: [waiverSigner.identity],
    });
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')),
      `${JSON.stringify(policy, null, 2)}\n`,
    );
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'verified-change',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
      creationAuthorization: await authorizeNativeTestChange({
        projectRoot,
        controller,
        policy,
        name: 'verified-change',
        now: new Date('2026-07-17T00:00:00.000Z'),
      }),
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
    acceptanceReceiptRef = await writeAcceptanceReceipt(
      verifyState,
      contract.contract.acceptance.map((criterion) => criterion.id),
    );
    applicabilityReviewRef = '';
    const machineBlock = serializeNativeVerificationMachineBlock(
      contract.contract.acceptance.map((criterion) => ({
        acceptance_id: criterion.id,
        status: 'passed' as const,
        evidence_refs: [acceptanceReceiptRef],
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
    await cleanupControllerTrust();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function currentBindings(state: NativeChangeState) {
    const [scope, contract] = await Promise.all([
      readNativeImplementationScopeBundle(paths, state.name, state.implementation_scope!),
      collectNativeContractFiles({
        changeDir,
        briefRef: state.brief,
        specChanges: state.spec_changes,
      }),
    ]);
    return {
      scope,
      contract,
      bindings: {
        change: state.name,
        sourceRevision: state.revision,
        contractHash: contract.contract.contractHash,
        scopeHash: scope.scope.scopeHash,
        snapshotHash: scope.scope.currentProjectionHash,
        artifactHash: nativeArtifactBindingHash(scope.scope.declaredArtifacts),
      },
    };
  }

  async function writeAcceptanceReceipt(
    state: NativeChangeState,
    acceptanceIds: readonly string[],
  ): Promise<string> {
    const { bindings } = await currentBindings(state);
    return writeNativeVerificationReceipt({
      paths,
      name: state.name,
      receipt: buildNativeVerificationReceipt({
        kind: 'manual-evidence',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds: [...acceptanceIds],
        actor: 'runtime-test',
        issuedAt: '2026-07-17T01:20:00.000Z',
        evidence: {
          steps: ['Execute the focused acceptance check.'],
          observations: ['The focused behavior matched the contract.'],
          responsible: 'runtime-test',
        },
      }),
    });
  }

  async function writeApplicabilityReview(
    state: NativeChangeState,
    acceptanceIds: readonly string[],
    requiredReceiptRefs: readonly string[],
    checked = {
      acceptanceApplicability: true,
      unifiedIo: null as string | null,
      adversarialPaths: null as string | null,
      generatedAssets: null as string | null,
      lifecycleEval: null as string | null,
    },
  ): Promise<string> {
    const { bindings, scope } = await currentBindings(state);
    const policy = buildNativeReviewTrustPolicy({
      controllerIdentity: controller.identity,
      controllerPrivateKey: controller.privateKey,
      implementationKeyId: implementation.identity.keyId,
      trustedReviewers: [reviewer.identity],
      trustedWaiverSigners: [waiverSigner.identity],
    });
    const implementationIssuedAt = '2026-07-17T01:18:00.000Z';
    const implementationEvidence = {
      implementationExecutionId: state.run_id
        ? `run:${state.run_id}`
        : `scope:${scope.scope.scopeHash}`,
      reviewPolicyHash: policy.policyHash,
      implementationIdentity: implementation.identity,
    };
    const implementationReceipt = buildNativeVerificationReceipt({
      kind: 'implementation-attestation',
      role: 'acceptance-evidence',
      status: 'passed',
      bindings,
      acceptanceIds: [...acceptanceIds],
      actor: `implementation-key:${implementation.identity.keyId}`,
      issuedAt: implementationIssuedAt,
      evidence: {
        ...implementationEvidence,
        attestation: signNativeReviewPayloadHash({
          identity: implementation.identity,
          privateKey: implementation.privateKey,
          payloadHash: nativeImplementationAttestationHash({
            bindings,
            status: 'passed',
            acceptanceIds,
            issuedAt: implementationIssuedAt,
            evidence: implementationEvidence,
          }),
        }),
      },
    });
    const implementationReceiptRef = await writeNativeVerificationReceipt({
      paths,
      name: state.name,
      receipt: implementationReceipt,
    });
    const matrix = parseNativeVerificationMachineBlock(
      await fs.readFile(path.join(changeDir, 'verification.md'), 'utf8'),
    );
    const reviewedReceiptRefs = new Set(requiredReceiptRefs);
    const reviewedWaiverRefs = new Set<string>();
    for (const entry of matrix) {
      for (const ref of entry.evidence_refs) reviewedReceiptRefs.add(ref);
      if (entry.status !== 'waived') continue;
      const waiver = await readNativeWaiverReceipt(paths, state.name, entry.waiver_ref!);
      reviewedWaiverRefs.add(entry.waiver_ref!);
      reviewedReceiptRefs.add(waiver.blockedReceiptRef);
      for (const ref of waiver.alternativeReceiptRefs) reviewedReceiptRefs.add(ref);
    }
    for (const ref of [
      checked.unifiedIo,
      checked.adversarialPaths,
      checked.generatedAssets,
      checked.lifecycleEval,
    ]) {
      if (ref !== null) reviewedReceiptRefs.add(ref);
    }
    const staticReplays: Array<{ sourceRef: string; replayRef: string }> = [];
    const manualAttestationRefs: string[] = [];
    let replayIndex = 0;
    for (const sourceRef of [...reviewedReceiptRefs].sort()) {
      const source = await readNativeVerificationReceipt(paths, state.name, sourceRef);
      if (source.kind === 'manual-evidence') {
        manualAttestationRefs.push(sourceRef);
        continue;
      }
      if (source.kind !== 'static-inspection') {
        throw new Error(`Unsupported review fixture source: ${source.kind}`);
      }
      const sourceCheck = await readNativeCheckReceipt(
        paths,
        state.name,
        source.evidence.checkReceiptRef,
      );
      const {
        schema: _schema,
        checker: _checker,
        inputHash: _inputHash,
        receiptHash: _receiptHash,
        ...sourceInput
      } = sourceCheck;
      const startedAt = new Date(
        Date.parse(sourceCheck.endedAt) + 1_000 + replayIndex * 2_000,
      ).toISOString();
      const endedAt = new Date(Date.parse(startedAt) + 1_000).toISOString();
      const replayCheck = buildNativeCheckReceipt({
        ...sourceInput,
        startedAt,
        endedAt,
      });
      const replayCheckRef = await writeNativeCheckReceipt({
        paths,
        name: state.name,
        receipt: replayCheck,
      });
      const replay = await persistNativeStaticInspectionReceipt({
        paths,
        state,
        checkReceipt: replayCheck,
        checkReceiptRef: replayCheckRef,
      });
      staticReplays.push({ sourceRef, replayRef: replay.ref });
      replayIndex += 1;
    }
    const reviewIssuedAt = '2026-07-17T02:00:00.000Z';
    const reviewEvidence = {
      preparationHash: policy.policyHash,
      implementationKeyId: implementation.identity.keyId,
      implementationReceiptRef,
      reviewPolicyHash: policy.policyHash,
      reviewerIdentity: reviewer.identity,
      matrixHash: nativeReviewAcceptanceMatrixHash(matrix),
      checked,
      evidenceGraph: buildNativeReviewEvidenceGraph({
        reviewedReceiptRefs: [...reviewedReceiptRefs],
        reviewedWaiverRefs: [...reviewedWaiverRefs],
        automatedReplays: [],
        staticReplays,
        manualAttestationRefs,
      }),
      findings: [],
    };
    return writeNativeVerificationReceipt({
      paths,
      name: state.name,
      receipt: buildNativeVerificationReceipt({
        kind: 'independent-review',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds: [...acceptanceIds],
        actor: `review-key:${reviewer.identity.keyId}`,
        issuedAt: reviewIssuedAt,
        evidence: {
          ...reviewEvidence,
          attestation: signNativeReviewPayloadHash({
            identity: reviewer.identity,
            privateKey: reviewer.privateKey,
            payloadHash: nativeIndependentReviewAttestationHash({
              bindings,
              status: 'passed',
              acceptanceIds,
              issuedAt: reviewIssuedAt,
              evidence: reviewEvidence,
            }),
          }),
        },
      }),
    });
  }

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
    const selected = scope.scope.changes.filter((change) => change.after !== null);
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
        filesSelected: selected.length,
        filesScanned: selected.length,
        binaryFilesSkipped: 0,
        bytesScanned: selected.reduce((total, change) => total + change.after!.size, 0),
        issueCount: failed ? 1 : 0,
        recordedIssueCount: failed ? 1 : 0,
      },
      issues: failed ? [{ path: selected[0]!.path, line: 1, kind: 'trailing-whitespace' }] : [],
      issuesTruncated: false,
      stale,
      staleReasons: stale ? ['implementation-before-does-not-match-scope'] : [],
    });
    const checkReceiptRef = await writeNativeCheckReceipt({
      paths,
      name: verifyState.name,
      receipt,
    });
    return (
      await persistNativeStaticInspectionReceipt({
        paths,
        state: verifyState,
        checkReceipt: receipt,
        checkReceiptRef,
      })
    ).ref;
  }

  async function checkDependencyRef(receiptRef: string): Promise<string> {
    const receipt = await readNativeVerificationReceipt(paths, verifyState.name, receiptRef);
    if (receipt.kind !== 'static-inspection') throw new Error('Expected static receipt');
    return receipt.evidence.checkReceiptRef;
  }

  async function archiveState(receiptRef?: string): Promise<{
    state: NativeChangeState;
    evidenceRef: string;
  }> {
    const effectiveReceiptRef = receiptRef ?? (await writeCheckReceipt());
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    applicabilityReviewRef = await writeApplicabilityReview(
      verifyState,
      contract.contract.acceptance.map((criterion) => criterion.id),
      [effectiveReceiptRef],
    );
    const prepared = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      receiptRef: effectiveReceiptRef,
      receiptRefs: [acceptanceReceiptRef, applicabilityReviewRef],
      waiverRefs: [],
      independentReviewReceiptRef: applicabilityReviewRef,
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
      envelope: { requiredReceiptRefs: [receiptRef] },
    });

    const receiptFile = path.join(changeDir, ...(await checkDependencyRef(receiptRef)).split('/'));
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

  it('revalidates signed review replay artifacts during Archive freshness checks', async () => {
    const { state } = await archiveState();
    const review = await readNativeVerificationReceipt(
      paths,
      verifyState.name,
      applicabilityReviewRef,
    );
    expect(review.kind).toBe('independent-review');
    if (review.kind !== 'independent-review') throw new Error('Expected review receipt');
    const replayRef = review.evidence.evidenceGraph.staticReplays[0]?.replayRef;
    expect(replayRef).toBeTruthy();
    const replayFile = path.join(changeDir, ...replayRef!.split('/'));
    const replay = JSON.parse(await fs.readFile(replayFile, 'utf8')) as {
      actor: string;
    };
    replay.actor = 'tampered-review-replay';
    await fs.writeFile(replayFile, JSON.stringify(replay));

    const inspection = await inspectNativeVerificationFreshness({ paths, state });

    expect(inspection).toMatchObject({
      freshness: 'stale',
      findingCodes: ['verification-receipt-invalid'],
    });
  });

  it('rejects an unsupported check policy before binding Verify evidence', async () => {
    const receiptRef = await writeCheckReceipt();
    const receiptFile = path.join(changeDir, ...(await checkDependencyRef(receiptRef)).split('/'));
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
    ).rejects.toThrow('verification-receipt-stale');
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
    ).rejects.toThrow('not passed or covered');
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

  it('accepts an incomplete matrix only for fail and records omitted criteria as missing', async () => {
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const machineBlock = serializeNativeVerificationMachineBlock([
      {
        acceptance_id: contract.contract.acceptance[0].id,
        status: 'passed',
        evidence_refs: [acceptanceReceiptRef],
      },
    ]);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${machineBlock}
# Conclusion
Fail.
`,
    );
    const failedRef = await writeCheckReceipt({ status: 'failed' });

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: failedRef,
      }),
    ).rejects.toThrow('missing 1 acceptance evidence entry');
    const failed = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'fail',
      reportRef: 'verification.md',
      receiptRef: failedRef,
    });
    expect(failed.envelope?.acceptanceTrace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          acceptanceId: contract.contract.acceptance[1].id,
          status: 'missing',
        }),
      ]),
    );
  });

  it('refuses a passing result without a current Runtime receipt', async () => {
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
      }),
    ).rejects.toThrow('typed required-check receipt');
  });

  it('rejects bare project paths as acceptance evidence even when the built-in check passed', async () => {
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const entries = contract.contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      status: 'passed',
      evidence_refs: ['src/feature.ts'],
    }));
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
<!-- comet-native:acceptance-evidence:start -->
${JSON.stringify(entries, null, 2)}
<!-- comet-native:acceptance-evidence:end -->
`,
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: await writeCheckReceipt(),
      }),
    ).rejects.toThrow('content-addressed typed receipt');
  });

  it('rejects an independent review receipt used as direct acceptance evidence', async () => {
    const requiredReceiptRef = await writeCheckReceipt();
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const reviewRef = await writeApplicabilityReview(
      verifyState,
      contract.contract.acceptance.map((criterion) => criterion.id),
      [requiredReceiptRef],
    );
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock(
  contract.contract.acceptance.map((criterion) => ({
    acceptance_id: criterion.id,
    status: 'passed' as const,
    evidence_refs: [reviewRef],
  })),
)}
`,
    );

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: requiredReceiptRef,
        independentReviewReceiptRef: reviewRef,
      }),
    ).rejects.toThrow('automated-check or manual-evidence');
  });

  it('rejects a receipt replacement made after the reviewer signed the matrix', async () => {
    const requiredReceiptRef = await writeCheckReceipt();
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const acceptanceIds = contract.contract.acceptance.map((criterion) => criterion.id);
    const reviewRef = await writeApplicabilityReview(verifyState, acceptanceIds, [
      requiredReceiptRef,
    ]);
    const { bindings } = await currentBindings(verifyState);
    const replacementRef = await writeNativeVerificationReceipt({
      paths,
      name: verifyState.name,
      receipt: buildNativeVerificationReceipt({
        kind: 'manual-evidence',
        role: 'acceptance-evidence',
        status: 'passed',
        bindings,
        acceptanceIds,
        actor: 'replacement-evidence',
        issuedAt: '2026-07-17T01:21:00.000Z',
        evidence: {
          steps: ['Repeat the focused acceptance check.'],
          observations: ['A replacement result was recorded after review.'],
          responsible: 'replacement-evidence',
        },
      }),
    });
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock(
  acceptanceIds.map((acceptance_id) => ({
    acceptance_id,
    status: 'passed' as const,
    evidence_refs: [replacementRef],
  })),
)}
`,
    );

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: requiredReceiptRef,
        independentReviewReceiptRef: reviewRef,
      }),
    ).rejects.toThrow('acceptance matrix is stale');
  });

  it('refuses a passing result when any acceptance criterion is skipped', async () => {
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const skippedBlock = serializeNativeVerificationMachineBlock(
      contract.contract.acceptance.map((criterion) => ({
        acceptance_id: criterion.id,
        status: 'failed' as const,
        evidence_refs: [],
        skipped_reason: 'The required check was not run.',
      })),
    );
    await fs.writeFile(changeDir + '/verification.md', `# Acceptance evidence\n${skippedBlock}\n`);

    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: await writeCheckReceipt(),
      }),
    ).rejects.toThrow('failed or missing acceptance criteria');
  });

  it('binds a signed structured waiver to a real blocking receipt and alternative evidence', async () => {
    const { contract, bindings } = await currentBindings(verifyState);
    const policy = buildNativeReviewTrustPolicy({
      controllerIdentity: controller.identity,
      controllerPrivateKey: controller.privateKey,
      implementationKeyId: implementation.identity.keyId,
      trustedReviewers: [reviewer.identity],
      trustedWaiverSigners: [waiverSigner.identity],
    });
    const waiverRefs: string[] = [];
    for (const criterion of contract.contract.acceptance) {
      const blockedReceipt = buildNativeVerificationReceipt({
        kind: 'manual-evidence',
        role: 'acceptance-evidence',
        status: 'blocked',
        bindings,
        acceptanceIds: [criterion.id],
        actor: 'blocked-check-owner',
        issuedAt: '2026-07-17T01:25:00.000Z',
        evidence: {
          steps: ['Attempt the unavailable platform check.'],
          observations: ['The platform dependency blocked execution.'],
          responsible: 'blocked-check-owner',
        },
      });
      const blockedReceiptRef = await writeNativeVerificationReceipt({
        paths,
        name: verifyState.name,
        receipt: blockedReceipt,
      });
      const unsignedWaiver = {
        bindings,
        acceptanceId: criterion.id,
        blockedReceiptRef,
        blockedCheckId: nativeBlockedCheckId(blockedReceipt),
        reason: 'The platform dependency is unavailable.',
        risk: 'The platform-specific path remains unexecuted.',
        alternativeReceiptRefs: [acceptanceReceiptRef],
        reviewPolicyHash: policy.policyHash,
        signerIdentity: waiverSigner.identity,
        confirmedAt: '2026-07-17T01:26:00.000Z',
      };
      const waiver = buildNativeWaiverReceipt({
        ...unsignedWaiver,
        attestation: signNativeReviewPayloadHash({
          identity: waiverSigner.identity,
          privateKey: waiverSigner.privateKey,
          payloadHash: nativeWaiverAttestationHash(unsignedWaiver),
        }),
      });
      waiverRefs.push(
        await writeNativeWaiverReceipt({
          paths,
          name: verifyState.name,
          waiver,
        }),
      );
    }
    const waiverBlock = serializeNativeVerificationMachineBlock(
      contract.contract.acceptance.map((criterion, index) => ({
        acceptance_id: criterion.id,
        status: 'waived' as const,
        evidence_refs: [],
        waiver_ref: waiverRefs[index],
      })),
    );
    await fs.writeFile(changeDir + '/verification.md', `# Acceptance evidence\n${waiverBlock}\n`);
    const receiptRef = await writeCheckReceipt();
    applicabilityReviewRef = await writeApplicabilityReview(
      verifyState,
      contract.contract.acceptance.map((criterion) => criterion.id),
      [receiptRef],
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
        receiptRefs: [applicabilityReviewRef],
        waiverRefs,
        independentReviewReceiptRef: applicabilityReviewRef,
      }),
    ).resolves.toMatchObject({ ready: true });
  });

  it('requires a signed waiver for every acceptance before waiving a global required check', async () => {
    const { contract, bindings } = await currentBindings(verifyState);
    const acceptanceIds = contract.contract.acceptance.map((criterion) => criterion.id);
    expect(acceptanceIds).toHaveLength(2);
    const failedRequiredRef = await writeCheckReceipt({ status: 'failed' });
    const failedRequired = await readNativeVerificationReceipt(
      paths,
      verifyState.name,
      failedRequiredRef,
    );
    const policy = buildNativeReviewTrustPolicy({
      controllerIdentity: controller.identity,
      controllerPrivateKey: controller.privateKey,
      implementationKeyId: implementation.identity.keyId,
      trustedReviewers: [reviewer.identity],
      trustedWaiverSigners: [waiverSigner.identity],
    });
    const issueWaiver = async (acceptanceId: string): Promise<string> => {
      const unsigned = {
        bindings,
        acceptanceId,
        blockedReceiptRef: failedRequiredRef,
        blockedCheckId: nativeBlockedCheckId(failedRequired),
        reason: 'The global required check is unavailable.',
        risk: 'The required static result is replaced for this acceptance only.',
        alternativeReceiptRefs: [acceptanceReceiptRef],
        reviewPolicyHash: policy.policyHash,
        signerIdentity: waiverSigner.identity,
        confirmedAt: '2026-07-17T01:27:00.000Z',
      };
      return writeNativeWaiverReceipt({
        paths,
        name: verifyState.name,
        waiver: buildNativeWaiverReceipt({
          ...unsigned,
          attestation: signNativeReviewPayloadHash({
            identity: waiverSigner.identity,
            privateKey: waiverSigner.privateKey,
            payloadHash: nativeWaiverAttestationHash(unsigned),
          }),
        }),
      });
    };
    const firstWaiver = await issueWaiver(acceptanceIds[0]);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock([
  {
    acceptance_id: acceptanceIds[0],
    status: 'waived',
    evidence_refs: [],
    waiver_ref: firstWaiver,
  },
  {
    acceptance_id: acceptanceIds[1],
    status: 'passed',
    evidence_refs: [acceptanceReceiptRef],
  },
])}
`,
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: failedRequiredRef,
      }),
    ).rejects.toThrow('not passed or covered');

    const secondWaiver = await issueWaiver(acceptanceIds[1]);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock(
  acceptanceIds.map((acceptance_id, index) => ({
    acceptance_id,
    status: 'waived' as const,
    evidence_refs: [],
    waiver_ref: [firstWaiver, secondWaiver][index],
  })),
)}
`,
    );
    applicabilityReviewRef = await writeApplicabilityReview(verifyState, acceptanceIds, [
      failedRequiredRef,
    ]);
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: verifyState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef: failedRequiredRef,
        waiverRefs: [firstWaiver, secondWaiver],
        independentReviewReceiptRef: applicabilityReviewRef,
      }),
    ).resolves.toMatchObject({ ready: true });
  });

  it('requires a current independent review for high-risk Native runtime changes', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'domains', 'comet-native', 'policy.ts'),
      'export const policy = 2;\n',
    );
    const built = await prepareNativeBuildEvidence({
      paths,
      state: { ...verifyState, phase: 'build' },
      artifactRefs: ['src/feature.ts', 'domains/comet-native/policy.ts'],
    });
    const highRiskState = {
      ...verifyState,
      implementation_scope: built.scopeRef as NativeChangeState['implementation_scope'],
    };
    const original = verifyState;
    verifyState = highRiskState;
    const receiptRef = await writeCheckReceipt();
    verifyState = original;
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: highRiskState.brief,
      specChanges: highRiskState.spec_changes,
    });
    const acceptanceIds = contract.contract.acceptance.map((criterion) => criterion.id);
    const highRiskAcceptanceRef = await writeAcceptanceReceipt(highRiskState, acceptanceIds);
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock(
  acceptanceIds.map((acceptance_id) => ({
    acceptance_id,
    status: 'passed' as const,
    evidence_refs: [highRiskAcceptanceRef],
  })),
)}
`,
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: highRiskState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
        receiptRefs: [highRiskAcceptanceRef],
        waiverRefs: [],
      }),
    ).rejects.toThrow('acceptance-applicability review');
    const applicabilityOnlyRef = await writeApplicabilityReview(highRiskState, acceptanceIds, [
      receiptRef,
    ]);
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: highRiskState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
        independentReviewReceiptRef: applicabilityOnlyRef,
      }),
    ).rejects.toThrow('incomplete required checks');

    const partialAcceptanceIds = [acceptanceIds[0]!];
    const fullChecks = {
      acceptanceApplicability: true,
      unifiedIo: receiptRef,
      adversarialPaths: highRiskAcceptanceRef,
      generatedAssets: highRiskAcceptanceRef,
      lifecycleEval: highRiskAcceptanceRef,
    };
    const partialReviewRef = await writeApplicabilityReview(
      highRiskState,
      partialAcceptanceIds,
      [receiptRef],
      fullChecks,
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: highRiskState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
        independentReviewReceiptRef: partialReviewRef,
      }),
    ).rejects.toThrow('complete current acceptance set');

    const reviewRef = await writeApplicabilityReview(
      highRiskState,
      acceptanceIds,
      [receiptRef],
      fullChecks,
    );
    await expect(
      prepareNativeVerificationEvidence({
        paths,
        state: highRiskState,
        result: 'pass',
        reportRef: 'verification.md',
        receiptRef,
        receiptRefs: [highRiskAcceptanceRef, reviewRef],
        waiverRefs: [],
        independentReviewReceiptRef: reviewRef,
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
