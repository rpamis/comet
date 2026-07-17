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
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
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
    await fs.writeFile(path.join(projectRoot, 'src', 'user-work.ts'), 'export const user = true;\n');
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
});
