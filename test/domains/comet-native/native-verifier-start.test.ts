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
import { readNativeLocalExecution } from '../../../domains/comet-native/native-local-execution.js';
import {
  applyNativeRunnerInput,
  parseNativeRunnerInput,
} from '../../../domains/comet-native/native-runner-input.js';
import {
  createNativePortableChange,
  nativeLocalExecutionFile,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { recoverNativePortableChange } from '../../../domains/comet-native/native-portable-recovery.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import { deriveNativeOutputEnvelope } from '../../../domains/comet-native/native-output-language.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import {
  createNativeRunnerChannel,
  NATIVE_SKILL_COORDINATION,
} from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

describe('Native Verifier startup receipts', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-verifier-start-'));
    await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function dispatchVerifier(name: string) {
    await createNativePortableChange({ paths, name, language: 'en' });
    await fs.writeFile(
      path.join(paths.changesDir, name, 'brief.md'),
      '# Acceptance examples\n- Startup receipts stay observable.\n',
    );
    let state = await confirmNativePortableShape({ paths, name });
    const runner = createNativeRunnerChannel();
    state = await submitNativePortableBuilderCandidate({
      paths,
      name: state.name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: NATIVE_SKILL_COORDINATION,
          executionRef: `${NATIVE_SKILL_COORDINATION}:builder:test-builder`,
        }),
        candidateId: 'candidate',
        summary: 'Built.',
        addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
        review: null,
      },
    });
    return applyNativeRunnerInput({
      paths,
      name,
      input: { kind: 'dispatch-verifier', checks: [] },
      maxVerifyFailures: 5,
    });
  }

  it('keeps a dispatched attempt unconfirmed until the Verifier reports startup', async () => {
    const dispatched = await dispatchVerifier('receipt-observable');
    const verifierExecutionRef = dispatched.verifierDispatch!.verifierExecutionRef;

    const before = await inspectNativePortableStatus({ paths, name: 'receipt-observable' });
    expect(before.localExecution.verifierStartup).toMatchObject({
      attempt: 1,
      confirmation: 'unconfirmed',
      confirmedAt: null,
    });
    expect(before.localExecution.verifierStartup!.registeredAt).toBeTruthy();

    const confirmed = await applyNativeRunnerInput({
      paths,
      name: 'receipt-observable',
      input: {
        kind: 'verifier-started',
        candidateId: dispatched.state.builder_handoff!.candidate_id,
        verifierExecutionRef,
      },
      maxVerifyFailures: 5,
    });
    expect(confirmed.state.loop.next_action).toBe('await-verifier-result');

    const after = await inspectNativePortableStatus({ paths, name: 'receipt-observable' });
    expect(after.localExecution.verifierStartup).toMatchObject({
      attempt: 1,
      confirmation: 'confirmed',
    });
    expect(after.localExecution.verifierStartup!.confirmedAt).toBeTruthy();
    const overlay = await readNativeLocalExecution(
      nativeLocalExecutionFile(paths, 'receipt-observable'),
    );
    expect(overlay?.execution?.verifierStartedAt).toBe(
      after.localExecution.verifierStartup!.confirmedAt,
    );

    const repeated = await applyNativeRunnerInput({
      paths,
      name: 'receipt-observable',
      input: {
        kind: 'verifier-started',
        candidateId: dispatched.state.builder_handoff!.candidate_id,
        verifierExecutionRef,
      },
      maxVerifyFailures: 5,
    });
    expect(repeated.state.state_version).toBe(confirmed.state.state_version);
    const afterRepeat = await inspectNativePortableStatus({ paths, name: 'receipt-observable' });
    expect(afterRepeat.localExecution.verifierStartup!.confirmedAt).toBe(
      after.localExecution.verifierStartup!.confirmedAt,
    );
  });

  it('rejects startup receipts that are stale for the current attempt or candidate', async () => {
    const dispatched = await dispatchVerifier('receipt-stale');
    const candidateId = dispatched.state.builder_handoff!.candidate_id;

    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'receipt-stale',
        input: {
          kind: 'verifier-started',
          candidateId,
          verifierExecutionRef: 'not-the-current-execution',
        },
        maxVerifyFailures: 5,
      }),
    ).rejects.toThrow(/stale|active/iu);

    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'receipt-stale',
        input: {
          kind: 'verifier-started',
          candidateId: 'another-candidate',
          verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
        },
        maxVerifyFailures: 5,
      }),
    ).rejects.toThrow(/stale|active/iu);

    const status = await inspectNativePortableStatus({ paths, name: 'receipt-stale' });
    expect(status.localExecution.verifierStartup?.confirmation).toBe('unconfirmed');
  });

  it('parses exactly the verifier-started input shape', () => {
    expect(
      parseNativeRunnerInput({
        kind: 'verifier-started',
        candidateId: 'candidate',
        verifierExecutionRef: 'skill-coordinated:verifier:1',
      }),
    ).toEqual({
      kind: 'verifier-started',
      candidateId: 'candidate',
      verifierExecutionRef: 'skill-coordinated:verifier:1',
    });
    expect(() =>
      parseNativeRunnerInput({
        kind: 'verifier-started',
        candidateId: 'candidate',
        verifierExecutionRef: 'skill-coordinated:verifier:1',
        extra: true,
      }),
    ).toThrow();
    expect(() =>
      parseNativeRunnerInput({ kind: 'verifier-started', candidateId: 'candidate' }),
    ).toThrow();
  });

  it('surfaces the unconfirmed state in the human summary and recovery message', async () => {
    const dispatched = await dispatchVerifier('receipt-recovery');
    const envelopeRecord = (confirmation: 'unconfirmed' | 'confirmed') => ({
      continuation: {
        change: 'receipt-recovery',
        phase: 'verify',
        status: 'active',
        disposition: 'continue' as const,
        commandArgs: ['comet', 'native', 'next'],
        userCommunication: { required: false, message: null, agentInstruction: 'Keep waiting.' },
      },
      localExecution: { verifierStartup: { confirmation } },
    });
    expect(deriveNativeOutputEnvelope(envelopeRecord('unconfirmed'))?.summary).toContain(
      'has not confirmed startup',
    );
    expect(deriveNativeOutputEnvelope(envelopeRecord('confirmed'))?.summary).not.toContain(
      'has not confirmed startup',
    );

    const unconfirmed = await recoverNativePortableChange({
      paths,
      name: 'receipt-recovery',
    });
    expect(unconfirmed).toMatchObject({ action: 'await-user', reason: 'execution-active' });
    expect(unconfirmed.message).toContain('never confirmed startup');

    await applyNativeRunnerInput({
      paths,
      name: 'receipt-recovery',
      input: {
        kind: 'verifier-started',
        candidateId: dispatched.state.builder_handoff!.candidate_id,
        verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
      },
      maxVerifyFailures: 5,
    });
    const confirmed = await recoverNativePortableChange({
      paths,
      name: 'receipt-recovery',
    });
    expect(confirmed.message).not.toContain('never confirmed startup');
  });
});
