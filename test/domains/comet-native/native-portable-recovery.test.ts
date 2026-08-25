import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { recoverNativePortableChange } from '../../../domains/comet-native/native-portable-recovery.js';
import { applyNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import {
  confirmNativePortableShape,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  nativeLocalExecutionFile,
  nativePortableChangeDir,
  nativePortableStateFile,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { compareAndSwapNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { toNativePortableText } from '../../../domains/comet-native/native-portable-text.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native portable recovery', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-recovery-v4-'));
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function createBuild(name: string): Promise<NativePortableState> {
    await createNativePortableChange({ paths, name, language: 'en' });
    await fs.writeFile(
      path.join(paths.changesDir, name, 'brief.md'),
      '# Acceptance examples\n- Recovery keeps the stable loop.\n',
    );
    return confirmNativePortableShape({ paths, name });
  }

  it.each(['shape', 'build'] as const)(
    'rebuilds a missing local overlay at the %s boundary without changing semantic state',
    async (phase) => {
      const name = `recover-${phase}`;
      const before =
        phase === 'shape'
          ? await createNativePortableChange({ paths, name, language: 'en' })
          : await createBuild(name);
      await fs.rm(path.dirname(nativeLocalExecutionFile(paths, name)), {
        recursive: true,
        force: true,
      });
      const recovered = await recoverNativePortableChange({ paths, name });
      expect(recovered).toMatchObject({
        action: 'resume-stable-boundary',
        reason: 'missing',
        state: { phase, state_version: before.state_version },
      });
    },
  );

  it.each(['missing', 'stale'] as const)(
    'does not inherit an Archive-ready pass when the local Runtime is %s',
    async (localState) => {
      const state = await createBuild('recover-archive');
      const archiveReady: NativePortableState = {
        ...state,
        phase: 'archive',
        state_version: state.state_version + 1,
        verification_result: 'pass',
        verification_report: 'verification.md',
        acceptance: state.acceptance.map((entry) => ({
          ...entry,
          result: 'passed',
          reason: toNativePortableText('Passed before transfer.'),
        })),
        builder_handoff: {
          candidate_id: 'candidate',
          identity_provider: 'host',
          builder_execution_ref: 'builder',
          iteration: 1,
          summary: toNativePortableText('Built.'),
          addressed_acceptance_ids: state.acceptance.map(({ id }) => id),
          checks: [],
          checks_truncated: false,
          known_limits: [],
          known_limits_truncated: false,
          review: {
            status: 'passed',
            summary: toNativePortableText('Read-only review passed.'),
            reviewer_execution_ref: 'reviewer',
          },
          submitted_at: new Date().toISOString(),
        },
        verification: {
          candidate_id: 'candidate',
          identity_provider: 'host',
          verifier_execution_ref: 'verifier',
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          checks: [
            {
              id: 'test',
              name: toNativePortableText('Tests'),
              argv_display: [],
              argv_truncated: false,
              cwd_ref: '.',
              status: 'passed',
              exit_code: 0,
              duration_ms: 1,
            },
          ],
          summary: toNativePortableText('Passed.'),
          risks: [],
          risks_truncated: false,
          completed_at: new Date().toISOString(),
        },
        loop: { ...state.loop, stage: 'archive-ready', attempt: 1, next_action: 'archive' },
      };
      await compareAndSwapNativePortableState({
        file: nativePortableStateFile(paths, state.name),
        expectedStateVersion: state.state_version,
        next: archiveReady,
        containedRoot: paths.nativeRoot,
      });
      if (localState === 'missing') {
        await fs.rm(path.dirname(nativeLocalExecutionFile(paths, state.name)), {
          recursive: true,
          force: true,
        });
      }

      const recovered = await recoverNativePortableChange({ paths, name: state.name });
      expect(recovered).toMatchObject({
        action: 'reverify',
        state: {
          phase: 'verify',
          verification_result: 'pending',
          verification: null,
          loop: { stage: 'verify-ready', iteration: 1, attempt: 1 },
        },
      });
      expect(recovered.state.loop.failed_iteration_count).toBe(0);
      expect(recovered.state.loop.no_progress_count).toBe(0);
      expect((await readNativePortableChange(paths, state.name)).state_version).toBe(
        archiveReady.state_version + 1,
      );
    },
  );

  it('abandons a lost running Verifier and returns to a fresh Verify boundary', async () => {
    let state = await createBuild('recover-verifier');
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-execution',
        }),
        candidateId: 'candidate',
        summary: 'Built.',
        addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewerExecutionRef: 'reviewer-execution',
        },
      },
    });
    const resolved = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: resolved.checks,
      verifierExecutionId: 'lost-verifier',
    });

    const recovered = await recoverNativePortableChange({ paths, name: state.name });
    expect(recovered).toMatchObject({
      action: 'reverify',
      reason: 'interrupted',
      state: {
        phase: 'verify',
        verification_result: 'pending',
        loop: { stage: 'verify-ready', attempt: 1 },
      },
    });
    expect(recovered.state.loop.execution_failure_count).toBe(0);

    const rebound = await applyNativeRunnerInput({
      paths,
      name: state.name,
      input: { kind: 'dispatch-verifier', checks: [] },
      maxVerifyFailures: 5,
    });
    expect(rebound).toMatchObject({
      state: {
        phase: 'verify',
        builder_handoff: { candidate_id: 'candidate', identity_provider: 'skill-coordinated' },
        loop: { stage: 'verify-ready', iteration: 1, attempt: 2 },
      },
      verifierDispatch: {
        candidateId: 'candidate',
        iteration: 1,
        attempt: 2,
        coordination: 'skill-coordinated',
      },
    });
  });

  it('preserves the current repair scope when a running Verifier is lost', async () => {
    const name = 'recover-repair-verifier';
    await createNativePortableChange({ paths, name, language: 'en' });
    await fs.writeFile(
      path.join(paths.changesDir, name, 'brief.md'),
      '# Acceptance examples\n- Recovery keeps completed results.\n- Recovery retries the current repair scope.\n',
    );
    let state = await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'initial-builder',
        }),
        candidateId: 'initial-candidate',
        summary: 'Built the initial candidate.',
        addressedAcceptanceIds: ['A1', 'A2'],
        review: {
          status: 'passed',
          summary: 'Initial read-only review passed.',
          reviewerExecutionRef: 'initial-reviewer',
        },
      },
    });
    const checks = await executeNativePortableCheckPlan({ paths, name, plans: [] });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      checks: checks.checks,
      verifierExecutionId: 'initial-verifier',
    });
    state = (
      await submitNativePortableVerifierResult({
        paths,
        name,
        checks: checks.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: state.builder_handoff!.candidate_id,
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'initial-verifier',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: 1,
              attempt: 1,
              verdict: 'fail',
              acceptance: [
                { id: 'A1', result: 'passed', reason: 'Already verified.' },
                { id: 'A2', result: 'failed', reason: 'Needs repair.' },
              ],
              risks: [],
              summary: 'One item needs repair.',
            },
          },
        }),
      })
    ).state;
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'repair-builder',
        }),
        candidateId: 'repair-candidate',
        summary: 'Repaired the failed item.',
        addressedAcceptanceIds: ['A2'],
        review: {
          status: 'passed',
          summary: 'Repair read-only review passed.',
          reviewerExecutionRef: 'repair-reviewer',
        },
      },
    });
    const repairChecks = await executeNativePortableCheckPlan({ paths, name, plans: [] });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      checks: repairChecks.checks,
      verifierExecutionId: 'lost-repair-verifier',
    });
    expect(state.acceptance.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: 'A1', result: 'passed' },
      { id: 'A2', result: 'pending' },
    ]);

    const recovered = await recoverNativePortableChange({ paths, name });
    expect(recovered).toMatchObject({
      action: 'reverify',
      reason: 'interrupted',
      state: {
        phase: 'verify',
        loop: { stage: 'verify-ready', iteration: 2, attempt: 1 },
      },
    });
    expect(recovered.state.acceptance.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: 'A1', result: 'passed' },
      { id: 'A2', result: 'pending' },
    ]);
  });

  it('rebuilds a missing verification report from matching portable state', async () => {
    let state = await createBuild('recover-report');
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'report-builder',
        }),
        summary: 'Built.',
        addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewerExecutionRef: 'report-reviewer',
        },
      },
    });
    const resolved = await executeNativePortableCheckPlan({
      paths,
      name: state.name,
      plans: [],
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      checks: resolved.checks,
    });
    state = (
      await submitNativePortableVerifierResult({
        paths,
        name: state.name,
        checks: resolved.checks,
        maxVerifyFailures: 5,
        envelope: runner.envelopeVerifierResponse({
          candidateId: state.builder_handoff!.candidate_id,
          identity: runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'report-verifier',
          }),
          payload: {
            kind: 'final-result',
            result: {
              iteration: state.loop.iteration,
              attempt: state.loop.attempt,
              verdict: 'pass',
              acceptance: state.acceptance.map(({ id }) => ({
                id,
                result: 'passed',
                reason: 'Verified.',
              })),
              risks: [],
              summary: 'Passed.',
            },
          },
        }),
      })
    ).state;
    const report = path.join(nativePortableChangeDir(paths, state.name), 'verification.md');
    await fs.rm(report, { force: true });

    const recovered = await recoverNativePortableChange({ paths, name: state.name });
    expect(recovered).toMatchObject({
      action: 'resume-stable-boundary',
      reason: 'available',
      state: { state_version: state.state_version, verification_result: 'pass' },
    });
    await expect(fs.readFile(report, 'utf8')).resolves.toContain(
      `generated_from_state_version: ${state.state_version}`,
    );
  });

  it('discards a stale non-repeatable check without changing newer portable state', async () => {
    const state = await createBuild('recover-stale-check');
    const file = nativeLocalExecutionFile(paths, state.name);
    const local = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    const startedAt = new Date().toISOString();
    await fs.writeFile(
      file,
      `${JSON.stringify(
        {
          ...local,
          basedOnStateVersion: state.state_version - 1,
          execution: {
            operationId: 'stale-operation',
            stage: 'checking',
            actor: 'runtime',
            executionId: null,
            status: 'interrupted',
            startedAt,
            requestCheckRounds: 0,
          },
          checks: [
            {
              id: 'non-repeatable',
              name: 'Non-repeatable check',
              operationId: 'stale-operation',
              status: 'interrupted',
              repeatable: false,
              timeoutMs: 10_000,
              executionCount: 1,
              argv: [process.execPath, '-e', 'process.exit(0)'],
              cwd: root,
              exitCode: null,
              startedAt,
              completedAt: null,
              log: 'logs/checks/stale-operation-non-repeatable.log',
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const recovered = await recoverNativePortableChange({ paths, name: state.name });
    expect(recovered).toMatchObject({
      action: 'resume-stable-boundary',
      reason: 'stale',
      state: {
        phase: 'build',
        status: 'active',
        state_version: state.state_version,
        blockers: [],
      },
    });
  });
});
