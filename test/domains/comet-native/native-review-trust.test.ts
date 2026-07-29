import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serializeNativeVerificationMachineBlock } from '../../../domains/comet-native/native-acceptance.js';
import { executeNativeCheckReceipt } from '../../../domains/comet-native/native-check-receipt.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  nativeControllerTrustStorePath,
  NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV,
  readNativeControllerTrustProject,
} from '../../../domains/comet-native/native-controller-trust.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { generateNativeReviewKeyPair } from '../../../domains/comet-native/native-review-identity.js';
import {
  signNativeImplementationPreparation,
  signNativeIndependentReviewApproval,
} from '../../../domains/comet-native/native-review-signer.js';
import {
  buildNativeReviewTrustPolicy,
  NATIVE_REVIEW_TRUST_POLICY_REF,
} from '../../../domains/comet-native/native-review-trust.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import {
  approveNativeIndependentReviewPreparation,
  finalizeNativeImplementationAttestation,
  finalizeNativeIndependentReviewReceipt,
  issueNativeAutomatedCheckReceipt,
  issueNativeImplementationAttestationReceipt,
  issueNativeManualEvidenceReceipt,
  issueNativeWaiverReceipt,
  loadNativeVerificationReceiptContext,
  prepareNativeImplementationAttestation,
  prepareNativeIndependentReview,
  persistNativeStaticInspectionReceipt,
} from '../../../domains/comet-native/native-verification-receipt-runtime.js';
import { nativeBlockedCheckId } from '../../../domains/comet-native/native-verification-receipt.js';
import type { NativeReviewFinding } from '../../../domains/comet-native/native-verification-receipt.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import { installNativeControllerTrust } from '../../helpers/native-controller-trust.js';

const brief = `# Outcome
Ship trusted review.
# Scope
Review trust.
# Non-goals
No external identity provider.
# Acceptance examples
- Trusted independent review is recorded.
# Constraints and invariants
Keep private keys outside Native storage.
# Decisions
Use Ed25519.
# Open questions

# Verification expectations
Run the lifecycle.
`;
const execFileAsync = promisify(execFile);

describe('Native pre-trusted review policy', () => {
  let root: string;
  let paths: NativeProjectPaths;
  const implementation = generateNativeReviewKeyPair();
  const reviewer = generateNativeReviewKeyPair();
  const waiverSigner = generateNativeReviewKeyPair();
  const controller = generateNativeReviewKeyPair();
  let cleanupControllerTrust: () => Promise<void>;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-review-trust-'));
    paths = await nativeProjectPaths(root, '.');
    cleanupControllerTrust = await installNativeControllerTrust({
      projectRoot: root,
      controller,
    });
    const policy = buildNativeReviewTrustPolicy({
      controllerIdentity: controller.identity,
      controllerPrivateKey: controller.privateKey,
      implementationKeyId: implementation.identity.keyId,
      trustedReviewers: [reviewer.identity],
      trustedWaiverSigners: [waiverSigner.identity],
    });
    await fs.mkdir(path.join(root, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(root, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')),
      `${JSON.stringify(policy, null, 2)}\n`,
    );
    const state = await createNativeChange({
      paths,
      name: 'trusted-review',
      language: 'en',
    });
    await fs.writeFile(path.join(nativeChangeDir(paths, state.name), 'brief.md'), brief);
    await advanceNativeChange({
      paths,
      name: state.name,
      evidence: { summary: 'Shape confirmed.', confirmed: true },
    });
    await fs.mkdir(path.join(root, 'domains', 'comet-native'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'domains', 'comet-native', 'trusted-review.ts'),
      'export const trustedReview = true;\n',
    );
    await advanceNativeChange({
      paths,
      name: state.name,
      evidence: {
        summary: 'High-risk implementation complete.',
        artifacts: ['domains/comet-native/trusted-review.ts'],
      },
    });
  });

  afterEach(async () => {
    await cleanupControllerTrust();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function prepareReviewInputs(
    state: NativeChangeState,
    entries?: Array<{
      acceptance_id: string;
      status: 'passed' | 'failed' | 'waived';
      evidence_refs: string[];
      skipped_reason?: string;
      waiver_ref?: string;
    }>,
    highRiskEvidenceRef?: string,
  ): Promise<{
    reportRef: string;
    requiredReceiptRef: string;
    highRiskEvidenceRef: string;
  }> {
    const context = await loadNativeVerificationReceiptContext(paths, state);
    const manual =
      highRiskEvidenceRef ??
      (
        await issueNativeManualEvidenceReceipt({
          paths,
          name: state.name,
          acceptanceIds: context.acceptanceIds,
          responsible: 'review-fixture',
          steps: ['Exercise the trusted review path.'],
          observations: ['The expected result was observed.'],
          confirmed: true,
        })
      ).ref;
    await fs.writeFile(
      path.join(nativeChangeDir(paths, state.name), 'verification.md'),
      `# Acceptance evidence
${serializeNativeVerificationMachineBlock(
  entries ??
    context.acceptanceIds.map((acceptance_id) => ({
      acceptance_id,
      status: 'passed' as const,
      evidence_refs: [manual],
    })),
)}
`,
    );
    const check = await executeNativeCheckReceipt({ paths, state });
    const requiredReceipt = await persistNativeStaticInspectionReceipt({
      paths,
      state,
      checkReceipt: check.receipt,
      checkReceiptRef: check.ref,
    });
    return {
      reportRef: 'verification.md',
      requiredReceiptRef: requiredReceipt.ref,
      highRiskEvidenceRef: manual,
    };
  }

  async function externallyReview(options: {
    state: NativeChangeState;
    implementationReceiptRef: string;
    reportRef: string;
    requiredReceiptRef: string;
    highRiskEvidenceRef: string;
    reviewerIdentity?: typeof reviewer.identity;
    reviewerPrivateKey?: string;
    findings?: readonly NativeReviewFinding[];
  }) {
    const reviewerIdentity = options.reviewerIdentity ?? reviewer.identity;
    const preparation = await prepareNativeIndependentReview({
      paths,
      name: options.state.name,
      implementationReceiptRef: options.implementationReceiptRef,
      reportRef: options.reportRef,
      requiredReceiptRefs: [options.requiredReceiptRef],
      reviewerIdentity,
      checkedEvidence: {
        unifiedIo: options.requiredReceiptRef,
        adversarialPaths: options.highRiskEvidenceRef,
        generatedAssets: options.highRiskEvidenceRef,
        lifecycleEval: options.highRiskEvidenceRef,
      },
    });
    const approval = await approveNativeIndependentReviewPreparation({
      paths,
      name: options.state.name,
      preparation,
      acceptanceApplicability: true,
      manualAttestationRefs: [options.highRiskEvidenceRef],
      findings: options.findings ?? [],
    });
    const attestation = signNativeIndependentReviewApproval({
      approval,
      identity: reviewerIdentity,
      privateKey: options.reviewerPrivateKey ?? reviewer.privateKey,
    });
    return finalizeNativeIndependentReviewReceipt({
      paths,
      name: options.state.name,
      preparation,
      approval,
      attestation,
      confirmed: true,
    });
  }

  it('keeps the detached signer free of workspace and process capabilities', async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), 'domains', 'comet-native', 'native-review-signer.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /(?:node:fs|node:child_process|native-paths|native-change|native-snapshot|spawn|execFile)/u,
    );
  });

  it('rejects a same-uid replacement controller store outside the project', async () => {
    const trustedPath = nativeControllerTrustStorePath();
    const attackerPath = path.join(root, '..', `${path.basename(root)}-attacker-trust.json`);
    await fs.copyFile(trustedPath, attackerPath);
    process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV] = attackerPath;
    try {
      await expect(readNativeControllerTrustProject(root)).rejects.toThrow(
        'not host-isolated read-only',
      );
    } finally {
      process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV] = trustedPath;
      await fs.rm(attackerPath, { force: true });
    }
  });

  it('keeps implementation signing outside the project-aware Runtime', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const preparation = await prepareNativeImplementationAttestation({
      paths,
      name: state.name,
      implementationIdentity: implementation.identity,
    });
    expect(JSON.stringify(preparation)).not.toContain(implementation.privateKey);
    const attestation = signNativeImplementationPreparation({
      preparation,
      identity: implementation.identity,
      privateKey: implementation.privateKey,
    });
    const issued = await finalizeNativeImplementationAttestation({
      paths,
      name: state.name,
      preparation,
      attestation,
      confirmed: true,
    });
    expect(issued.receipt).toMatchObject({
      kind: 'implementation-attestation',
      status: 'passed',
      evidence: {
        implementationIdentity: implementation.identity,
        attestation: { keyId: implementation.identity.keyId },
      },
    });
  });

  it('exposes a keyless prepare, external approval, and keyless finalize review flow', async () => {
    const runtime =
      await import('../../../domains/comet-native/native-verification-receipt-runtime.js');
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const implementationReceipt = await issueNativeImplementationAttestationReceipt({
      paths,
      name: state.name,
      implementationIdentity: implementation.identity,
      privateKey: implementation.privateKey,
      confirmed: true,
    });
    const reviewInputs = await prepareReviewInputs(state);
    const preparation = await runtime.prepareNativeIndependentReview({
      paths,
      name: state.name,
      implementationReceiptRef: implementationReceipt.ref,
      reportRef: reviewInputs.reportRef,
      requiredReceiptRefs: [reviewInputs.requiredReceiptRef],
      reviewerIdentity: reviewer.identity,
      checkedEvidence: {
        unifiedIo: reviewInputs.requiredReceiptRef,
        adversarialPaths: reviewInputs.highRiskEvidenceRef,
        generatedAssets: reviewInputs.highRiskEvidenceRef,
        lifecycleEval: reviewInputs.highRiskEvidenceRef,
      },
    });
    expect(JSON.stringify(preparation)).not.toContain(reviewer.privateKey);
    expect(preparation).not.toHaveProperty('evidenceGraph');
    await expect(
      runtime.approveNativeIndependentReviewPreparation({
        paths,
        name: state.name,
        preparation: { ...preparation, reportRef: 'forged.md' },
        acceptanceApplicability: true,
        manualAttestationRefs: [reviewInputs.highRiskEvidenceRef],
        findings: [],
      }),
    ).rejects.toThrow();
    await expect(
      runtime.approveNativeIndependentReviewPreparation({
        paths,
        name: state.name,
        preparation,
        acceptanceApplicability: true,
        manualAttestationRefs: [],
        findings: [],
      }),
    ).rejects.toThrow('explicit external reviewer attestation');

    const approval = await runtime.approveNativeIndependentReviewPreparation({
      paths,
      name: state.name,
      preparation,
      acceptanceApplicability: true,
      manualAttestationRefs: [reviewInputs.highRiskEvidenceRef],
      findings: [],
    });
    expect(() =>
      signNativeIndependentReviewApproval({
        approval: { ...approval, payloadHash: '0'.repeat(64) },
        identity: reviewer.identity,
        privateKey: reviewer.privateKey,
      }),
    ).toThrow('payload hash mismatch');
    const approvalPath = path.join(root, 'review-approval.json');
    const identityPath = path.join(root, 'reviewer-identity.json');
    const attestationPath = path.join(root, 'review-attestation.json');
    await Promise.all([
      fs.writeFile(approvalPath, JSON.stringify(approval)),
      fs.writeFile(identityPath, JSON.stringify(reviewer.identity)),
    ]);
    process.env.COMET_TEST_REVIEWER_PRIVATE_KEY = reviewer.privateKey;
    const signResult = await runNativeCli([
      'receipt',
      'review',
      'sign',
      '--approval',
      approvalPath,
      '--identity',
      identityPath,
      '--private-key-env',
      'COMET_TEST_REVIEWER_PRIVATE_KEY',
      '--output',
      attestationPath,
      '--project-root',
      path.join(root, 'does-not-exist'),
    ]);
    expect(signResult.exitCode).toBe(0);
    expect(process.env.COMET_TEST_REVIEWER_PRIVATE_KEY).toBeUndefined();
    const attestation = JSON.parse(await fs.readFile(attestationPath, 'utf8')) as ReturnType<
      typeof signNativeIndependentReviewApproval
    >;
    const issued = await runtime.finalizeNativeIndependentReviewReceipt({
      paths,
      name: state.name,
      preparation,
      approval,
      attestation,
      confirmed: true,
    });
    expect(issued.receipt).toMatchObject({
      kind: 'independent-review',
      status: 'passed',
      actor: `review-key:${reviewer.identity.keyId}`,
      evidence: {
        evidenceGraph: {
          manualAttestationRefs: [reviewInputs.highRiskEvidenceRef],
        },
        attestation: { keyId: reviewer.identity.keyId },
      },
    });
  });

  it('requires every implementation, reviewer, and waiver signer key to be globally distinct', () => {
    expect(() =>
      buildNativeReviewTrustPolicy({
        controllerIdentity: controller.identity,
        controllerPrivateKey: controller.privateKey,
        implementationKeyId: implementation.identity.keyId,
        trustedReviewers: [reviewer.identity],
        trustedWaiverSigners: [reviewer.identity],
      }),
    ).toThrow('globally distinct');
  });

  it('issues only a signed receipt from a reviewer pre-trusted before Build', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const implementationReceipt = await issueNativeImplementationAttestationReceipt({
      paths,
      name: state.name,
      implementationIdentity: implementation.identity,
      privateKey: implementation.privateKey,
      confirmed: true,
    });
    const reviewInputs = await prepareReviewInputs(state);
    const issued = await externallyReview({
      state,
      implementationReceiptRef: implementationReceipt.ref,
      reportRef: reviewInputs.reportRef,
      requiredReceiptRef: reviewInputs.requiredReceiptRef,
      highRiskEvidenceRef: reviewInputs.highRiskEvidenceRef,
    });

    expect(issued.receipt).toMatchObject({
      kind: 'independent-review',
      actor: `review-key:${reviewer.identity.keyId}`,
      evidence: {
        implementationKeyId: implementation.identity.keyId,
        reviewerIdentity: reviewer.identity,
        attestation: { keyId: reviewer.identity.keyId },
      },
    });
    const blocked = await externallyReview({
      state,
      implementationReceiptRef: implementationReceipt.ref,
      reportRef: reviewInputs.reportRef,
      requiredReceiptRef: reviewInputs.requiredReceiptRef,
      highRiskEvidenceRef: reviewInputs.highRiskEvidenceRef,
      findings: [{ severity: 'P1', status: 'open', summary: 'Lifecycle Eval is missing.' }],
    });
    expect(blocked.receipt).toMatchObject({
      status: 'blocked',
      evidence: {
        checked: { lifecycleEval: reviewInputs.highRiskEvidenceRef },
        findings: [{ severity: 'P1', status: 'open' }],
      },
    });

    const untrusted = generateNativeReviewKeyPair();
    await expect(
      externallyReview({
        state,
        implementationReceiptRef: implementationReceipt.ref,
        reportRef: reviewInputs.reportRef,
        requiredReceiptRef: reviewInputs.requiredReceiptRef,
        highRiskEvidenceRef: reviewInputs.highRiskEvidenceRef,
        reviewerIdentity: untrusted.identity,
        reviewerPrivateKey: untrusted.privateKey,
      }),
    ).rejects.toThrow('not pre-trusted');
  });

  it('rejects a policy changed after the Build snapshot', async () => {
    await fs.appendFile(path.join(root, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')), ' ');
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    await expect(
      issueNativeImplementationAttestationReceipt({
        paths,
        name: state.name,
        implementationIdentity: implementation.identity,
        privateKey: implementation.privateKey,
        confirmed: true,
      }),
    ).rejects.toThrow('changed after Build');
  });

  it('records an executed command and signs a waiver for its real non-pass receipt', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const context = await loadNativeVerificationReceiptContext(paths, state);
    const acceptanceId = context.acceptanceIds[0];
    const automated = await issueNativeAutomatedCheckReceipt({
      paths,
      name: state.name,
      acceptanceIds: [acceptanceId],
      command: process.execPath,
      args: ['-e', "process.stdout.write('checked'); process.exit(2)"],
    });
    expect(automated.receipt).toMatchObject({
      kind: 'automated-check',
      status: 'failed',
      evidence: {
        executable: process.execPath,
        args: ['-e', "process.stdout.write('checked'); process.exit(2)"],
        cwd: '.',
        exitCode: 2,
        timedOut: false,
        worktree: {
          provider: 'none',
          root: '.',
          beforeCommit: null,
          afterCommit: null,
        },
        afterFence: { matched: true },
        outputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputSummary: 'checked',
        outputTruncated: false,
      },
    });
    const alternative = await issueNativeManualEvidenceReceipt({
      paths,
      name: state.name,
      acceptanceIds: [acceptanceId],
      responsible: 'manual-fallback',
      steps: ['Exercise the fallback path.'],
      observations: ['The fallback produced the expected result.'],
      confirmed: true,
    });
    const issued = await issueNativeWaiverReceipt({
      paths,
      name: state.name,
      acceptanceId,
      blockedReceiptRef: automated.ref,
      reason: 'The primary command failed in the current environment.',
      risk: 'The primary execution remains unavailable.',
      alternativeReceiptRefs: [alternative.ref],
      signerIdentity: waiverSigner.identity,
      privateKey: waiverSigner.privateKey,
      confirmed: true,
    });

    expect(issued.waiver).toMatchObject({
      blockedReceiptRef: automated.ref,
      blockedCheckId: nativeBlockedCheckId(automated.receipt),
      signerIdentity: waiverSigner.identity,
      attestation: { keyId: waiverSigner.identity.keyId },
    });

    const implementationReceipt = await issueNativeImplementationAttestationReceipt({
      paths,
      name: state.name,
      implementationIdentity: implementation.identity,
      privateKey: implementation.privateKey,
      confirmed: true,
    });
    const reviewInputs = await prepareReviewInputs(
      state,
      [
        {
          acceptance_id: acceptanceId,
          status: 'waived',
          evidence_refs: [],
          waiver_ref: issued.ref,
        },
      ],
      alternative.ref,
    );
    const reviewReceipt = await externallyReview({
      state,
      implementationReceiptRef: implementationReceipt.ref,
      reportRef: reviewInputs.reportRef,
      requiredReceiptRef: reviewInputs.requiredReceiptRef,
      highRiskEvidenceRef: reviewInputs.highRiskEvidenceRef,
    });
    await expect(
      issueNativeWaiverReceipt({
        paths,
        name: state.name,
        acceptanceId,
        blockedReceiptRef: automated.ref,
        reason: 'The primary command failed in the current environment.',
        risk: 'The primary execution remains unavailable.',
        alternativeReceiptRefs: [reviewReceipt.ref],
        signerIdentity: waiverSigner.identity,
        privateKey: waiverSigner.privateKey,
        confirmed: true,
      }),
    ).rejects.toThrow('automated-check or manual-evidence');
  });

  it('does not expose signing secrets to an automated verification command', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const context = await loadNativeVerificationReceiptContext(paths, state);
    process.env.COMET_NATIVE_REVIEWER_PRIVATE_KEY = reviewer.privateKey;
    process.env.COMET_NATIVE_WAIVER_SECRET = waiverSigner.privateKey;
    try {
      const automated = await issueNativeAutomatedCheckReceipt({
        paths,
        name: state.name,
        acceptanceIds: [context.acceptanceIds[0]],
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({reviewer:process.env.COMET_NATIVE_REVIEWER_PRIVATE_KEY ?? null,waiver:process.env.COMET_NATIVE_WAIVER_SECRET ?? null}))',
        ],
      });
      expect(automated.receipt.status).toBe('passed');
      expect(automated.receipt.evidence.outputSummary).toBe('{"reviewer":null,"waiver":null}');
      expect(automated.receipt.evidence.outputSummary).not.toContain(reviewer.privateKey);
      expect(automated.receipt.evidence.outputSummary).not.toContain(waiverSigner.privateKey);
    } finally {
      delete process.env.COMET_NATIVE_REVIEWER_PRIVATE_KEY;
      delete process.env.COMET_NATIVE_WAIVER_SECRET;
    }
  });

  it('force-terminates a timed-out command that ignores soft termination', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const context = await loadNativeVerificationReceiptContext(paths, state);
    const startedAt = Date.now();
    const automated = await issueNativeAutomatedCheckReceipt({
      paths,
      name: state.name,
      acceptanceIds: [context.acceptanceIds[0]],
      command: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      timeoutMs: 50,
    });

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(automated.receipt).toMatchObject({
      kind: 'automated-check',
      status: 'blocked',
      evidence: {
        exitCode: 124,
        timedOut: true,
      },
    });
  });

  it('terminates a timed-out command process tree before a grandchild can escape', async () => {
    const state = await import('../../../domains/comet-native/native-change.js').then(
      ({ readNativeChange }) => readNativeChange(paths, 'trusted-review'),
    );
    const context = await loadNativeVerificationReceiptContext(paths, state);
    const sentinel = path.join(root, 'escaped-grandchild.txt');
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(
      sentinel,
    )}, 'escaped\\n'), 500)`;
    const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(
      grandchild,
    )}], {stdio:'ignore'}); setInterval(() => {}, 1000)`;

    const automated = await issueNativeAutomatedCheckReceipt({
      paths,
      name: state.name,
      acceptanceIds: [context.acceptanceIds[0]],
      command: process.execPath,
      args: ['-e', parent],
      timeoutMs: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(automated.receipt).toMatchObject({
      status: 'blocked',
      evidence: { exitCode: 124, timedOut: true },
    });
    await expect(fs.access(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('passes a read-only command in Git and blocks a command that mutates the fenced worktree', async () => {
    const gitRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-review-git-'));
    let cleanupGitControllerTrust: (() => Promise<void>) | null = null;
    try {
      const gitPaths = await nativeProjectPaths(gitRoot, '.');
      cleanupGitControllerTrust = await installNativeControllerTrust({
        projectRoot: gitRoot,
        controller,
      });
      const policy = buildNativeReviewTrustPolicy({
        controllerIdentity: controller.identity,
        controllerPrivateKey: controller.privateKey,
        implementationKeyId: implementation.identity.keyId,
        trustedReviewers: [reviewer.identity],
        trustedWaiverSigners: [waiverSigner.identity],
      });
      await fs.mkdir(path.join(gitRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(gitRoot, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/')),
        `${JSON.stringify(policy, null, 2)}\n`,
      );
      await fs.writeFile(path.join(gitRoot, '.gitignore'), '.comet/\n');
      await fs.writeFile(path.join(gitRoot, 'seed.txt'), 'seed\n');
      await execFileAsync('git', ['-C', gitRoot, 'init']);
      await execFileAsync('git', ['-C', gitRoot, 'config', 'user.email', 'native@example.test']);
      await execFileAsync('git', ['-C', gitRoot, 'config', 'user.name', 'Native Test']);
      await execFileAsync('git', ['-C', gitRoot, 'add', '.gitignore', 'seed.txt']);
      await execFileAsync('git', ['-C', gitRoot, 'commit', '-m', 'trust policy']);
      await expect(
        execFileAsync('git', ['-C', gitRoot, 'check-ignore', NATIVE_REVIEW_TRUST_POLICY_REF]),
      ).resolves.toMatchObject({ stdout: expect.stringContaining(NATIVE_REVIEW_TRUST_POLICY_REF) });
      const opened = await createNativeChange({
        paths: gitPaths,
        name: 'git-fence',
        language: 'en',
      });
      await fs.writeFile(path.join(nativeChangeDir(gitPaths, opened.name), 'brief.md'), brief);
      await advanceNativeChange({
        paths: gitPaths,
        name: opened.name,
        evidence: { summary: 'Shape confirmed.', confirmed: true },
      });
      await fs.mkdir(path.join(gitRoot, 'domains', 'comet-native'), { recursive: true });
      const artifact = 'domains/comet-native/git-fence.ts';
      await fs.writeFile(
        path.join(gitRoot, ...artifact.split('/')),
        'export const fence = true;\n',
      );
      await execFileAsync('git', ['-C', gitRoot, 'add', artifact]);
      await execFileAsync('git', ['-C', gitRoot, 'commit', '-m', 'implementation']);
      await advanceNativeChange({
        paths: gitPaths,
        name: opened.name,
        evidence: { summary: 'Build complete.', artifacts: [artifact] },
      });
      const state = await import('../../../domains/comet-native/native-change.js').then(
        ({ readNativeChange }) => readNativeChange(gitPaths, opened.name),
      );
      const context = await loadNativeVerificationReceiptContext(gitPaths, state);
      const acceptanceId = context.acceptanceIds[0];
      const readOnly = await issueNativeAutomatedCheckReceipt({
        paths: gitPaths,
        name: opened.name,
        acceptanceIds: [acceptanceId],
        command: process.execPath,
        args: ['-e', "process.stdout.write('ok')"],
      });
      expect(readOnly.receipt).toMatchObject({
        status: 'passed',
        evidence: {
          worktree: {
            provider: 'git',
            beforeCommit: expect.stringMatching(/^[a-f0-9]{40,64}$/u),
            afterCommit: expect.stringMatching(/^[a-f0-9]{40,64}$/u),
          },
          afterFence: { matched: true },
        },
      });
      const mutating = await issueNativeAutomatedCheckReceipt({
        paths: gitPaths,
        name: opened.name,
        acceptanceIds: [acceptanceId],
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(artifact)}, 'changed\\n')`],
      });
      expect(mutating.receipt).toMatchObject({
        status: 'blocked',
        evidence: { exitCode: 0, afterFence: { matched: false } },
      });
    } finally {
      await cleanupGitControllerTrust?.();
      await fs.rm(gitRoot, { recursive: true, force: true });
    }
  });
});
