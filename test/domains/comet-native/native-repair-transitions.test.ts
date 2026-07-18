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
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { inspectNativeStatus } from '../../../domains/comet-native/native-diagnostics.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { inspectNativeRepairHistory } from '../../../domains/comet-native/native-repair-integration.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import { NATIVE_TRAJECTORY_MAX_TEXT_CHARACTERS } from '../../../domains/comet-native/native-trajectory-limits.js';
import type {
  NativeProjectPaths,
  NativeTransitionHooks,
} from '../../../domains/comet-native/native-types.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

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

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-repair-transition-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    paths = await nativeProjectPaths(projectRoot, '.');
    const state = await createNativeChange({ paths, name: 'repair-change', language: 'en' });
    changeDir = nativeChangeDir(paths, state.name);
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
    });
  }

  async function failVerify(
    summary: string,
    hooks?: NativeTransitionHooks,
    category = 'focused-check-failed',
  ) {
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'repair-change',
        evidenceRefs: ['src/feature.ts'],
        conclusion: 'Fail',
      }),
    );
    return advanceNativeChange({
      paths,
      name: 'repair-change',
      evidence: {
        summary,
        verificationResult: 'fail',
        verificationReport: 'verification.md',
        repairFailureCategories: [category],
        repairFailedCheckIds: ['focused-check'],
      },
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

  it('persists a third-failure stop and records exactly one explicit override', async () => {
    const stopped = await reachManualStop();
    expect(stopped).toMatchObject({
      next: 'manual',
      change: { phase: 'build', verification_result: 'fail' },
      repair: { disposition: 'manual-stop', consecutiveFailures: 3 },
      continuation: { disposition: 'blocked', requiresUserDecision: false },
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
      continuation: { disposition: 'await-user', requiresUserDecision: true },
    });
    const exhausted = await leaveBuild('Try to repeat an exhausted override.');
    expect(exhausted).toMatchObject({
      next: 'manual',
      findings: [expect.objectContaining({ code: 'repair-override-exhausted' })],
      continuation: { disposition: 'await-user', requiresUserDecision: true },
    });

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    const progressed = await leaveBuild('Continue with a genuinely changed implementation.');
    expect(progressed).toMatchObject({
      next: 'auto',
      change: { phase: 'verify', verification_result: 'pending' },
    });
  });

  it('rejects malformed failure facts before creating verification evidence', async () => {
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      await nativeVerificationFixtureReport({
        paths,
        name: 'repair-change',
        evidenceRefs: ['src/feature.ts'],
        conclusion: 'Fail',
      }),
    );
    const evidenceDir = path.join(changeDir, 'runtime', 'evidence', 'verifications');
    const evidenceCount = async () => {
      try {
        return (await fs.readdir(evidenceDir)).length;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
    };
    const beforeState = await inspectNativeStatus(paths, 'repair-change');
    const beforeCount = await evidenceCount();

    for (const facts of [
      { repairFailureCategories: ['Invalid token'] },
      {
        repairFailureCategories: Array.from({ length: 17 }, (_, index) => `category-${index}`),
      },
      {
        repairFailedCheckIds: Array.from({ length: 129 }, (_, index) => `check-${index}`),
      },
    ]) {
      await expect(
        advanceNativeChange({
          paths,
          name: 'repair-change',
          evidence: {
            summary: 'This invalid attempt must not persist evidence.',
            verificationResult: 'fail',
            verificationReport: 'verification.md',
            ...facts,
          },
        }),
      ).rejects.toThrow(/invalid token|count boundary/u);
      await expect(evidenceCount()).resolves.toBe(beforeCount);
      await expect(inspectNativeStatus(paths, 'repair-change')).resolves.toMatchObject({
        phase: beforeState.phase,
        revision: beforeState.revision,
      });
    }
  });

  it('rejects oversized trajectory text before state or evidence mutation', async () => {
    const trajectoryFile = path.join(changeDir, 'runtime', 'trajectory.jsonl');
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
    const evidenceRoot = path.join(changeDir, 'runtime', 'evidence');
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

  it('treats a changed implementation scope as progress without requiring an override', async () => {
    const stopped = await reachManualStop();
    expect(stopped.repair).toMatchObject({ disposition: 'manual-stop' });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');

    const progressed = await leaveBuild(
      'The implementation changed under a new repair hypothesis.',
    );

    expect(progressed).toMatchObject({
      next: 'auto',
      change: { phase: 'verify', verification_result: 'pending' },
    });
    expect(progressed.change.implementation_scope).not.toBe(stopped.change.implementation_scope);
  });

  it('resets the episode after scope progress following the first or second failure', async () => {
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
      disposition: 'continue',
      consecutiveFailures: 1,
      totalRepairFailures: 1,
    });
    await leaveBuild('Retry once without changing the current scope.');
    const repeated = await failVerify('The same changed scope fails twice.');
    expect(repeated.repair).toMatchObject({
      disposition: 'warn',
      consecutiveFailures: 2,
      totalRepairFailures: 2,
    });

    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 4;\n');
    await leaveBuild('The second repair also makes real scope progress.');
    const afterSecondProgress = await failVerify('The second changed scope starts fresh.');
    expect(afterSecondProgress.repair).toMatchObject({
      disposition: 'continue',
      consecutiveFailures: 1,
      totalRepairFailures: 1,
    });
  });

  it('does not hard-stop twelve failures when every repair changes the scope', async () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const failed = await failVerify(`Progressing repair failure ${attempt}.`);
      expect(failed).toMatchObject({
        next: 'auto',
        repair: {
          disposition: 'continue',
          consecutiveFailures: 1,
          totalRepairFailures: 1,
        },
      });
      if (attempt === 12) break;
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
    await failVerify('The partial-scope verification fails once.');
    await leavePartialBuild('Retry the same accepted partial scope once.');
    await failVerify('The partial-scope verification fails twice.');
    await leavePartialBuild('Retry the same accepted partial scope twice.');
    const stopped = await failVerify('The partial-scope verification fails three times.');
    expect(stopped.repair).toMatchObject({ disposition: 'manual-stop' });

    const partial = await capturePartial('Capture the stopped partial scope.');
    expect(partial.preparedScope).toMatchObject({
      complete: false,
      partialAllowanceRef: null,
    });

    const allowanceDir = path.join(changeDir, 'runtime', 'evidence', 'allowances');
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
    await reachManualStop();
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');
    await leaveBuild('A changed implementation scope makes real repair progress.');
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

    const newEpisode = await failVerify('The rebuilt implementation starts a new repair episode.');
    expect(newEpisode).toMatchObject({
      next: 'auto',
      repair: {
        disposition: 'continue',
        consecutiveFailures: 1,
        totalRepairFailures: 1,
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

  it('hard-stops the twelfth total failure even when signatures alternate', async () => {
    let finalResult: Awaited<ReturnType<typeof failVerify>> | null = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      finalResult = await failVerify(
        `Verification failure ${attempt}.`,
        undefined,
        attempt % 2 === 0 ? 'even-failure' : 'odd-failure',
      );
      if (attempt < 12) {
        expect(finalResult.next).toBe('auto');
        await leaveBuild(`Repair attempt ${attempt} is ready.`);
      }
    }

    expect(finalResult).toMatchObject({
      next: 'manual',
      change: { phase: 'build' },
      repair: {
        disposition: 'hard-stop',
        totalRepairFailures: 12,
        remainingIterations: 0,
      },
      findings: [expect.objectContaining({ code: 'repair-iteration-limit' })],
      continuation: { disposition: 'await-user', requiresUserDecision: true },
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 99;\n');
    const progressed = await leaveBuild('Implementation changed after the hard stop.');
    expect(progressed).toMatchObject({
      next: 'auto',
      change: { phase: 'verify', verification_result: 'pending' },
    });
    const freshEpisode = await failVerify('The changed implementation has a new bounded episode.');
    expect(freshEpisode).toMatchObject({
      next: 'auto',
      repair: {
        disposition: 'continue',
        consecutiveFailures: 1,
        totalRepairFailures: 1,
      },
    });
  }, 60_000);
});
