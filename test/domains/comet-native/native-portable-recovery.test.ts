import '../../helpers/isolated-agent-home.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import { ensureNativePortableReport } from '../../../domains/comet-native/native-portable-verification.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
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

import { applyNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import {
  createNativePortableChange,
  dispatchNativePortableVerifier,
  nativePortableChangeDir,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';

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

  it('preserves a running Verifier until its host reports an explicit execution error', async () => {
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
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map(({ id }) => id)),
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewerExecutionRef: 'reviewer-execution',
        },
      },
    });

    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      verifierExecutionId: 'lost-verifier',
    });
    await expect(inspectNativePortableStatus({ paths, name: state.name })).resolves.toMatchObject({
      continuation: { action: 'await-verifier', requiresUserDecision: false },
    });
    expect(await readNativePortableChange(paths, state.name)).toEqual(state);
    const failed = await applyNativeRunnerInput({
      paths,
      name: state.name,
      input: {
        kind: 'verifier-execution-error',
        summary: 'The host confirmed that the Verifier task ended without a result.',
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: 'lost-verifier',
      },
      maxVerifyFailures: 5,
    });
    expect(failed).toMatchObject({
      state: {
        phase: 'verify',
        verification_result: 'pending',
        loop: { stage: 'verify-ready', attempt: 1 },
      },
    });
    expect(failed.state.loop.execution_failure_count).toBe(1);

    const rebound = await applyNativeRunnerInput({
      paths,
      name: state.name,
      input: { kind: 'dispatch-verifier', checks: [] },
      maxVerifyFailures: 5,
    });
    expect(rebound).toMatchObject({
      state: {
        phase: 'verify',
        builder_handoff: {
          candidate_id: 'candidate',
          identity_provider: 'skill-coordinated',
        },
        loop: { stage: 'verify-ready', iteration: 1, attempt: 2 },
      },
      verifierDispatch: {
        candidateId: 'candidate',
        iteration: 1,
        attempt: 2,
      },
    });
  });

  it('restarts the complete acceptance scope when a running repair Verifier is lost', async () => {
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
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        review: {
          status: 'passed',
          summary: 'Initial read-only review passed.',
          reviewerExecutionRef: 'initial-reviewer',
        },
      },
    });

    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'initial-verifier',
    });
    state = (
      await submitNativePortableVerifierResult({
        paths,
        name,
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
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        review: {
          status: 'passed',
          summary: 'Repair read-only review passed.',
          reviewerExecutionRef: 'repair-reviewer',
        },
      },
    });

    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'lost-repair-verifier',
    });
    expect(state.acceptance.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: 'A1', result: 'pending' },
      { id: 'A2', result: 'pending' },
    ]);

    const failed = await applyNativeRunnerInput({
      paths,
      name,
      input: {
        kind: 'verifier-execution-error',
        summary: 'The host confirmed that the repair Verifier task was lost.',
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: 'lost-repair-verifier',
      },
      maxVerifyFailures: 5,
    });
    expect(failed).toMatchObject({
      state: {
        phase: 'verify',
        loop: { stage: 'verify-ready', iteration: 2, attempt: 1 },
      },
    });
    expect(failed.state.acceptance.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: 'A1', result: 'pending' },
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
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map(({ id }) => id)),
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewerExecutionRef: 'report-reviewer',
        },
      },
    });

    state = await dispatchNativePortableVerifier({
      paths,
      name: state.name,
      verifierExecutionId: 'report-verifier',
    });
    state = (
      await submitNativePortableVerifierResult({
        paths,
        name: state.name,
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

    const before = await fs.readFile(
      path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml'),
    );
    await inspectNativePortableStatus({ paths, name: state.name });
    await expect(fs.stat(report)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await ensureNativePortableReport({ paths, state })).toBe('rebuilt');
    expect(
      await fs.readFile(path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml')),
    ).toEqual(before);
    await expect(fs.readFile(report, 'utf8')).resolves.toContain(
      `generated_from_state_version: ${state.state_version}`,
    );
  });
});
