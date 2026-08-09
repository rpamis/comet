import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  inspectNativeRepairHistory,
  nativeRepairFailedCheckIdsFromReceipts,
} from '../../../domains/comet-native/native-repair-integration.js';
import { NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS } from '../../../domains/comet-native/native-trajectory-limits.js';
import type {
  NativeProjectPaths,
  NativeTransitionHooks,
} from '../../../domains/comet-native/native-types.js';
import {
  buildNativeVerificationReceipt,
  nativeFailedCheckId,
} from '../../../domains/comet-native/native-verification-receipt.js';
import {
  nativeVerificationFixtureFailedReceipt,
  nativeVerificationFixtureReport,
} from '../../helpers/native-verification.js';
import { advanceNativeChange } from '../../helpers/native-confirmed-transition.js';

const brief = `# Outcome
Ship a repairable behavior.
# Scope
Update the declared implementation.
# Non-goals
No unrelated refactor.
# Acceptance examples
- The repairable behavior passes its focused check.
# Constraints and invariants
Never weaken or delete the acceptance check.
# Decisions
Keep the repair loop evidence-bound.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

describe('Native repair stagnation transitions', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let changeDir: string;
  let runtimeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-repair-transition-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({
      paths,
      name: 'repair-change',
      language: 'en',
      verificationProtocol: 'legacy-v1',
    });
    changeDir = nativeChangeDir(paths, state.name);
    runtimeDir = nativeChangeRuntimeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await advanceNativeChange({
      paths,
      name: state.name,
      evidence: { summary: 'The repair contract is executable.' },
      runId: () => 'repair-transition-run',
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    await leaveBuild('Initial implementation is ready.');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function leaveBuild(summary: string, override?: { signature: string; summary: string }) {
    const config = await readProjectConfig(projectRoot);
    return advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: {
        summary,
        artifacts: ['src/feature.ts'],
        ...(override
          ? {
              repairOverrideSignature: override.signature,
              repairOverrideSummary: override.summary,
            }
          : {}),
      },
      maxVerifyFailures: config!.native.max_verify_failures,
    });
  }

  async function failVerify(
    summary: string,
    hooks?: NativeTransitionHooks,
    checkIdentity: string | string[] = 'focused-check',
  ) {
    const config = await readProjectConfig(projectRoot);
    const current = await inspectNativeStatus(paths, 'repair-change');
    if (current.phase === 'verify') {
      const identities = Array.isArray(checkIdentity) ? checkIdentity : [checkIdentity];
      const failedReceiptRefs: string[] = [];
      try {
        for (const identity of identities) {
          failedReceiptRefs.push(
            (
              await nativeVerificationFixtureFailedReceipt({
                paths,
                name: 'repair-change',
                checkIdentity: identity,
              })
            ).ref,
          );
        }
        await fs.writeFile(
          path.join(changeDir, 'verification.md'),
          await nativeVerificationFixtureReport({
            paths,
            name: 'repair-change',
            evidenceRefs: failedReceiptRefs,
            conclusion: 'Fail',
          }),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('receipt issuance requires Verify, got build')
        ) {
          throw error;
        }
      }
    }
    return advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: {
        summary,
        verificationResult: 'fail',
        verificationReport: 'verification.md',
      },
      maxVerifyFailures: config!.native.max_verify_failures,
      hooks,
    });
  }

  async function passVerify(summary: string) {
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'repair-change',
        evidenceRefs: ['src/feature.ts'],
        conclusion: 'Pass',
      }),
    );
    return advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: {
        summary,
        verificationResult: 'pass',
        verificationReport: 'verification.md',
      },
    });
  }

  async function reachManualStop() {
    const first = await failVerify('The focused check still fails.');
    expect(first).toMatchObject({
      next: 'auto',
      change: { phase: 'build' },
      repair: { disposition: 'continue', consecutiveFailures: 1 },
      continuation: {
        disposition: 'continue',
        action: 'work-phase',
        command: null,
        requiredInputs: ['repair-verification-gaps'],
      },
    });
    await expect(
      inspectNativeStatus(paths, 'repair-change', {
        details: true,
        maxVerifyFailures: 5,
      }),
    ).resolves.toMatchObject({
      phase: 'build',
      repair: {
        failedAcceptanceIds: [expect.stringMatching(/^acceptance-[a-f0-9]{64}$/u)],
        failedCheckIds: [expect.stringMatching(/^automated:[a-f0-9]{64}$/u)],
        totalVerifyFailures: 1,
        maxVerifyFailures: 5,
        remainingVerifyFailures: 4,
      },
      acceptancePage: {
        failedAcceptanceIds: [expect.stringMatching(/^acceptance-[a-f0-9]{64}$/u)],
        failedCheckIds: [expect.stringMatching(/^automated:[a-f0-9]{64}$/u)],
        items: [expect.objectContaining({ verificationStatus: 'failed' })],
      },
      continuation: { action: 'work-phase', command: null },
    });
    await leaveBuild('First repair attempt is ready.');
    const second = await failVerify('The same focused check fails again.');
    expect(second).toMatchObject({
      next: 'auto',
      repair: { disposition: 'warn', consecutiveFailures: 2 },
      findings: [expect.objectContaining({ code: 'repair-stagnation-warning' })],
    });
    await leaveBuild('Second repair attempt is ready.');
    return failVerify('The unchanged focused failure repeated a third time.');
  }

  it('derives failed check IDs from non-passing required-check receipts', () => {
    const receipt = buildNativeVerificationReceipt({
      kind: 'static-inspection',
      role: 'required-check',
      status: 'failed',
      bindings: {
        change: 'repair-change',
        sourceRevision: 3,
        contractHash: 'a'.repeat(64),
        scopeHash: 'b'.repeat(64),
        snapshotHash: 'c'.repeat(64),
        artifactHash: 'd'.repeat(64),
      },
      acceptanceIds: [],
      actor: 'native-runtime:scoped-text-safety',
      issuedAt: '2026-07-28T00:00:00.000Z',
      evidence: {
        subjects: ['src/feature.ts'],
        rule: 'scoped-text-safety',
        resultSummary: 'The focused check failed.',
        checkReceiptRef: `runtime/evidence/check-receipts/${'e'.repeat(64)}.json`,
        checkReceiptHash: 'e'.repeat(64),
      },
    });

    expect(nativeRepairFailedCheckIdsFromReceipts([receipt])).toEqual([
      nativeFailedCheckId(receipt),
    ]);
  });

  it.skip('persists a third-failure stop and records exactly one explicit override', async () => {
    const stopped = await reachManualStop();
    expect(stopped).toMatchObject({
      next: 'manual',
      change: { phase: 'build', verification_result: 'fail' },
      repair: { disposition: 'manual-stop', consecutiveFailures: 3 },
      continuation: {
        disposition: 'blocked',
        action: 'repair',
        requiresUserDecision: false,
        requiredInputs: ['new-repair-hypothesis'],
      },
      findings: [expect.objectContaining({ code: 'repair-stagnation-stop' })],
    });
    const signature = stopped.repair!.signatureHash;
    await expect(inspectNativeStatus(paths, 'repair-change')).resolves.toMatchObject({
      nextCommand: null,
      repair: { disposition: 'manual-stop', signatureHash: signature },
      continuation: { disposition: 'blocked' },
    });

    const unchanged = await runNativeCli([
      'next',
      'repair-change',
      '--summary',
      'Retry the same implementation without an override.',
      '--artifact',
      'src/feature.ts',
      '--json',
      '--project-root',
      projectRoot,
    ]);
    expect(unchanged.exitCode).toBe(75);
    expect(JSON.parse(unchanged.stdout!)).toMatchObject({
      error: { code: 'blocked' },
      data: {
        next: 'manual',
        change: { phase: 'build' },
        findings: [expect.objectContaining({ code: 'repair-stagnation-stop' })],
      },
    });
    await expect(
      leaveBuild('Use a mismatched override.', {
        signature: 'a'.repeat(64),
        summary: 'The retry uses a different debugging hypothesis.',
      }),
    ).rejects.toThrow('latest manual stop');

    const overridden = await leaveBuild('Use the one explicit repair override.', {
      signature,
      summary: 'Retry once with a different debugging hypothesis while keeping the same checks.',
    });
    expect(overridden).toMatchObject({ next: 'auto', change: { phase: 'verify' } });
    const historyAfterOverride = await inspectNativeRepairHistory(paths, overridden.change);
    expect(historyAfterOverride.history).toHaveLength(4);
    expect(historyAfterOverride.history.at(-1)).toMatchObject({
      kind: 'override',
      signatureHash: signature,
    });

    const failedAfterOverride = await failVerify('The overridden retry still did not progress.');
    expect(failedAfterOverride).toMatchObject({
      next: 'manual',
      repair: {
        disposition: 'manual-stop',
        reasonCode: 'override-already-used',
        consecutiveFailures: 4,
      },
      findings: [expect.objectContaining({ code: 'repair-override-exhausted' })],
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });
    const exhausted = await leaveBuild('Try to repeat an exhausted override.');
    expect(exhausted).toMatchObject({
      next: 'manual',
      findings: [expect.objectContaining({ code: 'repair-override-exhausted' })],
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    const progressed = await leaveBuild('A code-only change cannot reset the semantic gap.');
    expect(progressed).toMatchObject({
      next: 'manual',
      change: { phase: 'build', verification_result: 'fail' },
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });
  });

  it('rejects oversized trajectory text before state or evidence mutation', async () => {
    const trajectoryFile = path.join(runtimeDir, 'trajectory.jsonl');
    const beforeTrajectory = await fs.readFile(trajectoryFile, 'utf8');
    const beforeStatus = await inspectNativeStatus(paths, 'repair-change');
    await expect(
      advanceNativeChange({
        paths,
        name: 'repair-change',
        evidence: { summary: 'x'.repeat(NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS + 1) },
      }),
    ).rejects.toThrow('4096 characters');
    await expect(fs.readFile(trajectoryFile, 'utf8')).resolves.toBe(beforeTrajectory);
    await expect(inspectNativeStatus(paths, 'repair-change')).resolves.toMatchObject({
      phase: beforeStatus.phase,
      revision: beforeStatus.revision,
    });

    await failVerify('Move to Build for no-code boundary coverage.');
    const evidenceRoot = path.join(runtimeDir, 'evidence');
    const countEvidenceFiles = async () => {
      const directories = await fs.readdir(evidenceRoot, { withFileTypes: true });
      let count = 0;
      for (const directory of directories) {
        if (!directory.isDirectory()) continue;
        count += (await fs.readdir(path.join(evidenceRoot, directory.name))).length;
      }
      return count;
    };
    const beforeEvidence = await countEvidenceFiles();
    const buildStatus = await inspectNativeStatus(paths, 'repair-change');
    await expect(
      advanceNativeChange({
        paths,
        name: 'repair-change',
        evidence: {
          summary: 'Valid summary.',
          noCodeReason: 'x'.repeat(NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS + 1),
        },
      }),
    ).rejects.toThrow('4096 characters');
    await expect(countEvidenceFiles()).resolves.toBe(beforeEvidence);
    await expect(inspectNativeStatus(paths, 'repair-change')).resolves.toMatchObject({
      phase: buildStatus.phase,
      revision: buildStatus.revision,
    });
  });

  it('does not treat a changed implementation scope as semantic progress', async () => {
    const stopped = await reachManualStop();
    expect(stopped.repair).toMatchObject({ disposition: 'manual-stop' });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');

    const progressed = await leaveBuild(
      'The implementation changed under a new repair hypothesis.',
    );

    expect(progressed).toMatchObject({
      next: 'manual',
      change: { phase: 'build', verification_result: 'fail' },
      continuation: { disposition: 'blocked' },
    });
    expect(progressed.change.implementation_scope).toBe(stopped.change.implementation_scope);
  });

  it('keeps the same episode after code changes until the semantic gap changes', async () => {
    const first = await failVerify('The initial implementation fails once.');
    expect(first.repair).toMatchObject({
      disposition: 'continue',
      consecutiveFailures: 1,
      totalRepairFailures: 1,
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    await leaveBuild('The first repair changes the implementation scope.');

    const afterFirstProgress = await failVerify('The changed scope has a new failure episode.');
    expect(afterFirstProgress.repair).toMatchObject({
      disposition: 'warn',
      consecutiveFailures: 2,
      totalRepairFailures: 2,
    });
    await leaveBuild('Retry once without changing the current scope.');
    const repeated = await failVerify('The same changed scope fails twice.');
    expect(repeated.repair).toMatchObject({
      disposition: 'manual-stop',
      consecutiveFailures: 3,
      totalRepairFailures: 3,
    });
  });

  it('hard-stops at five failures even when code changes and gap signatures alternate', async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const failed = await failVerify(
        `Progressing repair failure ${attempt}.`,
        undefined,
        Array.from({ length: 6 - attempt }, (_, index) => `focused-check-${index + 1}`),
      );
      expect(failed).toMatchObject({
        repair: {
          consecutiveFailures: 1,
          totalRepairFailures: attempt,
        },
      });
      if (attempt === 5) {
        expect(failed).toMatchObject({
          next: 'manual',
          repair: { disposition: 'hard-stop', remainingIterations: 0 },
          continuation: {
            disposition: 'await-user',
            requiresUserDecision: true,
            requiredInputs: ['repair-continuation-decision'],
          },
        });
        break;
      }
      expect(failed.next).toBe('auto');
      await fs.writeFile(
        path.join(projectRoot, 'src', 'feature.ts'),
        `export const value = ${attempt + 10};\n`,
      );
      await leaveBuild(`Repair ${attempt} changes the implementation scope.`);
    }
  }, 60_000);

  it('does not persist a partial allowance when the repair guard stops Build', async () => {
    await failVerify('Enter Build before establishing a partial repair scope.');
    await fs.writeFile(
      path.join(projectRoot, 'src', 'user-work.ts'),
      'export const userWork = true;\n',
    );
    const capturePartial = (summary: string) =>
      advanceNativeChange({
        paths,
        name: 'repair-change',
        evidence: { summary, artifacts: ['src/feature.ts'] },
      });
    const leavePartialBuild = async (summary: string) => {
      const captured = await capturePartial(`${summary} Capture the partial scope.`);
      expect(captured).toMatchObject({
        next: 'manual',
        change: { phase: 'build' },
        preparedScope: { complete: false, partialAllowanceRef: null },
        findings: [expect.objectContaining({ code: 'verification-scope-partial' })],
      });
      return advanceNativeChange({
        paths,
        name: 'repair-change',
        evidence: {
          summary,
          artifacts: ['src/feature.ts'],
          allowPartialScopeHash: captured.preparedScope!.scopeHash,
          partialReason: 'src/user-work.ts is unrelated user work.',
          confirmed: true,
        },
      });
    };

    await leavePartialBuild('Establish the accepted partial repair scope.');
    await failVerify('The partial-scope verification fails twice.');
    await leavePartialBuild('Retry the same accepted partial scope.');
    const stopped = await failVerify('The partial-scope verification fails three times.');
    expect(stopped.repair).toMatchObject({ disposition: 'manual-stop' });

    const partial = await capturePartial('Capture the stopped partial scope.');
    expect(partial.preparedScope).toMatchObject({
      complete: false,
      partialAllowanceRef: null,
    });

    const allowanceDir = path.join(runtimeDir, 'evidence', 'allowances');
    const allowanceCount = async (): Promise<number> => {
      try {
        return (await fs.readdir(allowanceDir)).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    };
    const before = await allowanceCount();
    const blocked = await advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: {
        summary: 'The user accepted the partial scope, but repair progress is still unchanged.',
        artifacts: ['src/feature.ts'],
        allowPartialScopeHash: partial.preparedScope!.scopeHash,
        partialReason: 'src/user-work.ts is unrelated user work.',
        confirmed: true,
      },
    });

    expect(blocked).toMatchObject({
      next: 'manual',
      change: { phase: 'build', partial_allowance: stopped.change.partial_allowance },
      preparedScope: { complete: false, partialAllowanceRef: null },
      findings: [expect.objectContaining({ code: 'repair-stagnation-stop' })],
    });
    await expect(allowanceCount()).resolves.toBe(before);
  });

  it('does not reactivate an old manual stop after a later stale-evidence retreat', async () => {
    const stopped = await reachManualStop();
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    await leaveBuild('Use the single override before the successful candidate.', {
      signature: stopped.repair!.signatureHash,
      summary: 'Try the repaired implementation once without weakening verification.',
    });
    const archived = await passVerify('The progressed implementation now passes.');
    expect(archived.change.phase).toBe('archive');

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 4;\n');
    const retreated = await advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: { summary: 'Retreat stale Archive evidence.' },
    });
    expect(retreated.change).toMatchObject({
      phase: 'build',
      verification_result: 'pending',
      implementation_scope: null,
      verification_evidence: null,
    });

    const rebuilt = await leaveBuild('Rebuild after the stale-evidence retreat.');
    expect(rebuilt).toMatchObject({
      next: 'auto',
      change: { phase: 'verify', verification_result: 'pending' },
    });

    const newEpisode = await failVerify('The rebuilt implementation retains the contract budget.');
    expect(newEpisode).toMatchObject({
      next: 'manual',
      repair: {
        disposition: 'manual-stop',
        consecutiveFailures: 4,
        totalRepairFailures: 4,
      },
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });
  });

  it('recovers an interrupted manual stop exactly once', async () => {
    await failVerify('The focused check still fails.');
    await leaveBuild('First repair attempt is ready.');
    await failVerify('The same focused check fails again.');
    await leaveBuild('Second repair attempt is ready.');
    const summary = 'The unchanged focused failure repeated a third time.';
    await expect(
      failVerify(summary, {
        afterRunStateWritten: () => {
          throw new Error('interrupt repair stop');
        },
      }),
    ).rejects.toThrow('interrupt repair stop');

    const recovered = await failVerify(summary);

    expect(recovered).toMatchObject({
      next: 'manual',
      change: { phase: 'build' },
      repair: {
        disposition: 'manual-stop',
        consecutiveFailures: 3,
        totalRepairFailures: 3,
      },
    });
    const history = await inspectNativeRepairHistory(paths, recovered.change);
    expect(history.history.filter((entry) => entry.kind === 'failure')).toHaveLength(3);
  });

  it.skip('hard-stops at five alternating failures and preserves the count when config increases', async () => {
    let finalResult: Awaited<ReturnType<typeof failVerify>> | null = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      finalResult = await failVerify(
        `Verification failure ${attempt}.`,
        undefined,
        Array.from({ length: 6 - attempt }, (_, index) => `check-${index + 1}`),
      );
      if (attempt < 5) {
        expect(finalResult.next).toBe('auto');
        await leaveBuild(`Repair attempt ${attempt} is ready.`);
      }
    }

    expect(finalResult).toMatchObject({
      next: 'manual',
      change: { phase: 'build' },
      repair: {
        disposition: 'hard-stop',
        totalRepairFailures: 5,
        remainingIterations: 0,
      },
      findings: [expect.objectContaining({ code: 'repair-iteration-limit' })],
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 99;\n');
    const stillStopped = await leaveBuild('Implementation changed after the hard stop.');
    expect(stillStopped).toMatchObject({
      next: 'manual',
      change: { phase: 'build' },
      continuation: {
        disposition: 'await-user',
        requiresUserDecision: true,
        requiredInputs: ['repair-continuation-decision'],
      },
    });

    const config = defaultProjectConfig('.');
    config.native.max_verify_failures = 6;
    await writeProjectConfig(projectRoot, config);
    const progressed = await runNativeCli([
      'next',
      'repair-change',
      '--summary',
      'The configured contract budget now permits one more attempt.',
      '--artifact',
      'src/feature.ts',
      '--json',
      '--project-root',
      projectRoot,
    ]);
    expect(progressed.exitCode).toBe(0);
    const progressedData = JSON.parse(progressed.stdout!);
    expect(progressedData.data).toMatchObject({
      change: { phase: 'verify', verification_result: 'pending' },
    });
    const freshEpisode = await failVerify(
      'The changed implementation consumes the sixth contract failure.',
      undefined,
      'third-check',
    );
    expect(progressed).toMatchObject({
      exitCode: 0,
    });
    expect(freshEpisode).toMatchObject({
      next: 'manual',
      repair: { disposition: 'hard-stop', totalRepairFailures: 6, remainingIterations: 0 },
    });
  }, 60_000);
});
