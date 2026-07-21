import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
  readNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { inspectNativeArchivePreflight } from '../../../domains/comet-native/native-archive-inspection.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { sha256Text } from '../../../domains/comet-native/native-hash.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  readNativeRunState,
  readNativeTrajectoryText,
  replaceNativeTrajectoryText,
  writeNativeRunState,
} from '../../../domains/comet-native/native-run-store.js';
import { NATIVE_LEGACY_RUNTIME_IDENTITIES } from '../../../domains/comet-native/native-runtime-package.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { inspectNativeVerificationFreshness } from '../../../domains/comet-native/native-verification-runtime.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

const brief = `# Outcome
Ship evidence-bound behavior.
# Scope
Update the declared implementation.
# Non-goals
No unrelated refactor.
# Acceptance examples
- The evidence-bound behavior works.
# Constraints and invariants
Old evidence must become stale when implementation changes.
# Decisions
Use the Native evidence envelope.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

describe('Native evidence-bound phase transitions', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-evidence-transition-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({ paths, name: 'evidence-change', language: 'en' });
    changeDir = nativeChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await advanceNativeChange({
      paths,
      name: state.name,
      evidence: { summary: 'The contract is executable.' },
      runId: () => 'evidence-transition-run',
    });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function writeVerification(conclusion: 'Pass' | 'Fail' = 'Pass'): Promise<void> {
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'evidence-change',
        evidenceRefs: ['src/feature.ts'],
        conclusion,
      }),
    );
  }

  async function readTreeText(root: string): Promise<string> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const content: string[] = [];
    for (const entry of entries) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) content.push(await readTreeText(target));
      else if (entry.isFile()) content.push(await fs.readFile(target, 'utf8'));
    }
    return content.join('\n');
  }

  it('binds Build scope and Verify evidence, then marks implementation drift stale', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    const built = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented the declared behavior.', artifacts: ['src/feature.ts'] },
    });
    expect(built.change).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification_report: null,
      verification_evidence: null,
      partial_allowance: null,
    });
    expect(built.change.implementation_scope).toMatch(
      /^runtime\/evidence\/scopes\/[a-f0-9]{64}\.json$/u,
    );
    expect(built.preparedScope).toMatchObject({ complete: true, unresolvedScopeCount: 0 });
    expect(built.preparedScope?.acceptancePage.items).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^acceptance-[a-f0-9]{64}$/u),
        kind: 'brief-example',
        source: 'brief.md',
        text: 'The evidence-bound behavior works.',
      }),
    ]);
    await expect(inspectNativeStatus(paths, 'evidence-change', { details: true })).resolves.toEqual(
      expect.objectContaining({
        acceptancePage: built.preparedScope?.acceptancePage,
      }),
    );

    await writeVerification();
    const verified = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'The focused evidence passed.',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
    expect(verified.change).toMatchObject({
      phase: 'archive',
      verification_result: 'pass',
      verification_report: 'verification.md',
    });
    expect(verified.change.verification_evidence).toMatch(
      /^runtime\/evidence\/verifications\/[a-f0-9]{64}\.json$/u,
    );
    await expect(
      inspectNativeVerificationFreshness({ paths, state: verified.change }),
    ).resolves.toMatchObject({ freshness: 'complete', findingCodes: [] });

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    const stale = await inspectNativeVerificationFreshness({ paths, state: verified.change });
    expect(stale).toMatchObject({
      freshness: 'stale',
      findingCodes: ['verification-implementation-stale'],
    });
    const preflight = await inspectNativeArchivePreflight({ paths, name: 'evidence-change' });
    expect(preflight).toMatchObject({ ready: false });
    expect(preflight.findingCodes).toContain('verification-evidence-stale');
    await expect(inspectNativeStatus(paths, 'evidence-change')).resolves.toMatchObject({
      phase: 'archive',
      nextCommand: 'comet native next evidence-change --summary "<summary>"',
      continuation: {
        disposition: 'continue',
        action: 'advance-phase',
        command: 'comet native next evidence-change --summary "<summary>"',
      },
    });

    const retreated = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implementation changed after verification; capture evidence again.' },
    });
    expect(retreated.change).toMatchObject({
      phase: 'build',
      verification_result: 'pending',
      verification_report: null,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
    });
  });

  it('retreats a stale Verify scope to Build before requiring contract re-confirmation', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    const built = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented the approved contract.', artifacts: ['src/feature.ts'] },
    });
    const approvedHash = built.change.approved_contract_hash;
    expect(built.change.phase).toBe('verify');

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('Ship evidence-bound behavior.', 'Ship the revised evidence-bound behavior.'),
    );

    const status = await inspectNativeStatus(paths, 'evidence-change', { details: true });
    expect(status).toMatchObject({
      phase: 'verify',
      nextCommand: 'comet native next evidence-change --summary "<summary>"',
      continuation: {
        disposition: 'continue',
        action: 'advance-phase',
        command: 'comet native next evidence-change --summary "<summary>"',
        requiresUserDecision: false,
      },
      findings: expect.arrayContaining([
        expect.objectContaining({
          code: 'verification-contract-stale',
          retryCommand: 'comet native next evidence-change --summary "<summary>"',
          requiresUserDecision: false,
        }),
      ]),
    });
    expect(status.findingSummary.codes).not.toContain('contract-changed-after-approval');

    const retreated = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Return the changed contract to Build for fresh evidence.' },
    });
    expect(retreated.change).toMatchObject({
      phase: 'build',
      approved_contract_hash: approvedHash,
      implementation_scope: null,
      verification_evidence: null,
      partial_allowance: null,
    });

    const blocked = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'Attempt the revised contract without confirmation.',
        artifacts: ['src/feature.ts'],
      },
    });
    expect(blocked).toMatchObject({
      next: 'manual',
      change: { phase: 'build', approved_contract_hash: approvedHash },
      findings: [expect.objectContaining({ code: 'contract-changed-after-approval' })],
    });

    const confirmed = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'The revised contract is explicitly re-confirmed.',
        artifacts: ['src/feature.ts'],
        confirmed: true,
      },
    });
    expect(confirmed.change).toMatchObject({ phase: 'verify', approval: 'confirmed' });
    expect(confirmed.change.approved_contract_hash).not.toBe(approvedHash);
  });

  it('continues an active v1 Run through the compatible v2 iteration-budget upgrade', async () => {
    const run = await readNativeRunState(changeDir);
    expect(run).not.toBeNull();
    await writeNativeRunState(changeDir, {
      ...run!,
      ...NATIVE_LEGACY_RUNTIME_IDENTITIES[0],
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');

    const built = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Continue the active v1 Run.', artifacts: ['src/feature.ts'] },
    });

    expect(built.change.phase).toBe('verify');
    await expect(readNativeRunState(changeDir)).resolves.toMatchObject(
      NATIVE_LEGACY_RUNTIME_IDENTITIES[0],
    );
  });

  it('does not persist verification evidence before Run consistency accepts the transition', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented the behavior.', artifacts: ['src/feature.ts'] },
    });
    await writeVerification();
    const evidenceDir = path.join(changeDir, 'runtime', 'evidence', 'verifications');
    const evidenceCount = async (): Promise<number> => {
      try {
        return (await fs.readdir(evidenceDir)).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    };
    const beforeCount = await evidenceCount();
    const beforeState = await readNativeChange(paths, 'evidence-change');
    const run = await readNativeRunState(changeDir);
    expect(run).not.toBeNull();
    await writeNativeRunState(changeDir, { ...run!, currentStep: 'build' });

    const blocked = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'This transition must fail before evidence persistence.',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
    expect(blocked).toMatchObject({
      next: 'manual',
      change: { phase: 'verify', verification_evidence: null },
      findings: [expect.objectContaining({ code: 'run-phase-mismatch' })],
    });
    await expect(evidenceCount()).resolves.toBe(beforeCount);
    await expect(readNativeChange(paths, 'evidence-change')).resolves.toMatchObject({
      phase: beforeState.phase,
      revision: beforeState.revision,
      verification_evidence: null,
    });
  });

  it('does not persist verification evidence when the protected trajectory is invalid', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented the behavior.', artifacts: ['src/feature.ts'] },
    });
    await writeVerification();
    const evidenceDir = path.join(changeDir, 'runtime', 'evidence', 'verifications');
    const evidenceCount = async (): Promise<number> => {
      try {
        return (await fs.readdir(evidenceDir)).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    };
    const beforeCount = await evidenceCount();
    const beforeState = await readNativeChange(paths, 'evidence-change');
    const run = await readNativeRunState(changeDir);
    expect(run).not.toBeNull();
    const trajectory = await readNativeTrajectoryText(changeDir, run!.trajectoryRef);
    expect(trajectory).not.toBeNull();
    await replaceNativeTrajectoryText(
      changeDir,
      run!.trajectoryRef,
      '{invalid trajectory tail\n',
      sha256Text(trajectory!),
    );

    await expect(
      advanceNativeChange({
        paths,
        name: 'evidence-change',
        evidence: {
          summary: 'This transition must stop on the invalid trajectory.',
          verificationResult: 'pass',
          verificationReport: 'verification.md',
        },
      }),
    ).rejects.toThrow('Native trajectory is invalid');
    await expect(evidenceCount()).resolves.toBe(beforeCount);
    await expect(readNativeChange(paths, 'evidence-change')).resolves.toMatchObject({
      phase: beforeState.phase,
      revision: beforeState.revision,
      verification_evidence: null,
    });
  });

  it('does not retreat fresh Archive evidence through an ordinary next command', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented the behavior.', artifacts: ['src/feature.ts'] },
    });
    await writeVerification();
    await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'Verification passed.',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });

    const result = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Try to reopen fresh evidence.' },
    });

    expect(result).toMatchObject({
      next: 'manual',
      nextCommand: 'comet native archive evidence-change --dry-run',
      change: { phase: 'archive' },
      continuation: {
        disposition: 'continue',
        action: 'archive',
        command: 'comet native archive evidence-change --dry-run',
      },
    });
  });

  it('keeps a failed envelope for repair history and clears it on the next Build capture', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'First implementation.', artifacts: ['src/feature.ts'] },
    });
    await writeVerification('Fail');
    const failed = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'The focused check failed.',
        verificationResult: 'fail',
        verificationReport: 'verification.md',
      },
    });
    expect(failed.change).toMatchObject({
      phase: 'build',
      verification_result: 'fail',
      verification_report: 'verification.md',
    });
    expect(failed.change.verification_evidence).not.toBeNull();

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    const rebuilt = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Repaired the failure.', artifacts: ['src/feature.ts'] },
    });
    expect(rebuilt.change).toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
      verification_report: null,
      verification_evidence: null,
    });
    expect(rebuilt.change.implementation_scope).not.toBe(failed.change.implementation_scope);
  });

  it('requires one exact user confirmation before attaching a partial scope', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await fs.writeFile(
      path.join(projectRoot, 'src', 'user-work.ts'),
      'export const user = true;\n',
    );
    const partial = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: { summary: 'Implemented only the declared file.', artifacts: ['src/feature.ts'] },
    });
    expect(partial).toMatchObject({
      next: 'manual',
      change: { phase: 'build', implementation_scope: null },
      preparedScope: { complete: false, unresolvedScopeCount: 1 },
      continuation: { disposition: 'await-user', requiresUserDecision: true },
    });
    expect(partial.findings).toContainEqual(
      expect.objectContaining({
        code: 'verification-scope-partial',
        requiredAction: 'confirm-partial-verification-scope',
        requiresUserDecision: true,
      }),
    );

    const confirmed = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'The user accepted excluding their unrelated file.',
        artifacts: ['src/feature.ts'],
        allowPartialScopeHash: partial.preparedScope!.scopeHash,
        partialReason: 'src/user-work.ts belongs to the user and is outside this change.',
        confirmed: true,
      },
    });
    expect(confirmed.change).toMatchObject({ phase: 'verify', approval: 'confirmed' });
    expect(confirmed.change.partial_allowance).toMatch(
      /^runtime\/evidence\/allowances\/[a-f0-9]{64}\.json$/u,
    );
    expect((await readNativeChange(paths, 'evidence-change')).partial_allowance).toBe(
      confirmed.change.partial_allowance,
    );

    await writeVerification();
    const verified = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'The accepted partial scope passed.',
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
    await expect(
      inspectNativeVerificationFreshness({ paths, state: verified.change }),
    ).resolves.toMatchObject({ freshness: 'partial', findingCodes: [] });
  });

  it('redacts credential-shaped transition and partial-allowance text before hashing or persistence', async () => {
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await fs.writeFile(
      path.join(projectRoot, 'src', 'user-work.ts'),
      'export const user = true;\n',
    );
    const partial = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'Valid credentials remain ordinary prose.',
        artifacts: ['src/feature.ts'],
      },
    });

    const confirmed = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'Valid credentials remain ordinary prose; Bearer transition-secret-value',
        artifacts: ['src/feature.ts'],
        allowPartialScopeHash: partial.preparedScope!.scopeHash,
        partialReason: 'Exclude unrelated work with api_key=partial-secret-value',
        confirmed: true,
      },
    });

    expect(confirmed.change.phase).toBe('verify');
    const persisted = await readTreeText(changeDir);
    expect(persisted).toContain('Valid credentials remain ordinary prose');
    expect(persisted).toContain('Bearer [REDACTED]');
    expect(persisted).toContain('api_key=[REDACTED]');
    expect(persisted).not.toContain('transition-secret-value');
    expect(persisted).not.toContain('partial-secret-value');
    expect(JSON.stringify(confirmed)).not.toContain('transition-secret-value');
    expect(JSON.stringify(confirmed)).not.toContain('partial-secret-value');
  });

  it('redacts credential-shaped no-code text from transition output and the entire change tree', async () => {
    const result = await advanceNativeChange({
      paths,
      name: 'evidence-change',
      evidence: {
        summary: 'Documented credentials semantics with password=summary-secret-value',
        noCodeReason: 'No project edit is required; access_token=no-code-secret-value',
      },
    });

    expect(result.change.phase).toBe('verify');
    const persisted = await readTreeText(changeDir);
    expect(persisted).toContain('Documented credentials semantics');
    expect(persisted).toContain('password=[REDACTED]');
    expect(persisted).toContain('access_token=[REDACTED]');
    expect(persisted).not.toContain('summary-secret-value');
    expect(persisted).not.toContain('no-code-secret-value');
    expect(JSON.stringify(result)).not.toContain('summary-secret-value');
    expect(JSON.stringify(result)).not.toContain('no-code-secret-value');
  });
});
