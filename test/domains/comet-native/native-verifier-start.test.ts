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
import {
  readNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import { nativePortableStateFile } from '../../../domains/comet-native/native-portable-storage.js';
import { validateNativeRunnerInputBoundary } from '../../../domains/comet-native/native-runner-input.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';

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
    expect(dispatched.state.verifier_action).toMatchObject({
      type: 'handoff',
      ref: 'native-verifier',
      status: 'pending',
      attempt: 1,
    });

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
    expect(confirmed.state.verifier_action).toMatchObject({
      status: 'running',
      claim: { token: verifierExecutionRef },
    });

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

  it('keeps the dispatched identity when the machine overlay is lost', async () => {
    const dispatched = await dispatchVerifier('receipt-overlay-lost');
    await fs.unlink(nativeLocalExecutionFile(paths, 'receipt-overlay-lost'));
    const recovered = await recoverNativePortableChange({ paths, name: 'receipt-overlay-lost' });
    expect(recovered).toMatchObject({ action: 'await-user', reason: 'execution-active' });
    expect(recovered.state.verifier_action?.id).toBe(dispatched.state.verifier_action?.id);
    const status = await inspectNativePortableStatus({ paths, name: 'receipt-overlay-lost' });
    expect(status.continuation.action).toBe('await-verifier');
    expect(JSON.stringify(status.continuation)).toContain(
      dispatched.verifierDispatch!.verifierExecutionRef,
    );
    const state = recovered.state;
    const failed = await applyNativeRunnerInput({
      paths,
      name: state.name,
      maxVerifyFailures: 5,
      input: {
        kind: 'verifier-execution-error',
        summary: 'The host confirmed that the task was lost.',
        stateVersion: state.state_version,
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
      },
    });
    expect(failed.state.verifier_action?.status).toBe('failed');
    expect(failed.state.loop.execution_failure_count).toBe(1);
  });

  it('migrates a legacy current attempt on mutation without changing read-only inspection', async () => {
    const dispatched = await dispatchVerifier('receipt-legacy');
    const { verifier_action: _action, ...legacy } = dispatched.state;
    const file = nativePortableStateFile(paths, legacy.name);
    await writeNativePortableState(file, legacy);
    const before = await fs.readFile(file, 'utf8');
    const input = {
      kind: 'verifier-started' as const,
      candidateId: legacy.builder_handoff!.candidate_id,
      verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
    };
    await inspectNativePortableStatus({ paths, name: legacy.name });
    await validateNativeRunnerInputBoundary({
      paths,
      name: legacy.name,
      state: legacy,
      input,
      projectRoot: root,
    });
    expect(await fs.readFile(file, 'utf8')).toBe(before);
    const started = await applyNativeRunnerInput({
      paths,
      name: legacy.name,
      input,
      maxVerifyFailures: 5,
    });
    expect(started.state.verifier_action).toMatchObject({
      id: _action!.id,
      status: 'running',
      claim: { token: input.verifierExecutionRef },
    });
    expect((await readNativePortableState(file)).verifier_action).toEqual(
      started.state.verifier_action,
    );
  });

  it('keeps one active action while a Verifier requests Runtime checks', async () => {
    const dispatched = await dispatchVerifier('receipt-request-checks');
    const requested = await applyNativeRunnerInput({
      paths,
      name: dispatched.state.name,
      maxVerifyFailures: 5,
      input: {
        kind: 'verifier-response',
        candidateId: dispatched.state.builder_handoff!.candidate_id,
        verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
        response: {
          kind: 'request-checks',
          iteration: 1,
          attempt: 1,
          checks: [
            {
              id: 'probe',
              name: 'Probe',
              executable: process.execPath,
              argv: ['-e', 'process.exit(0)'],
              cwdRef: '.',
              timeoutMs: 10000,
              repeatable: true,
            },
          ],
        },
      },
    });
    expect(requested.state.verifier_action).toMatchObject({
      id: dispatched.state.verifier_action!.id,
      status: 'running',
      receipts: [],
    });
    expect(requested.state.verifier_action?.outcome).toBeUndefined();
    expect(requested.state.loop.next_action).toBe('await-verifier-result');
    expect(requested.checks).toMatchObject([{ id: 'probe', status: 'passed' }]);
  });

  it('marks a started action unknown after losing its machine metadata without redispatching', async () => {
    const dispatched = await dispatchVerifier('receipt-unknown');
    const file = path.join(root, 'startup.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        kind: 'verifier-started',
        candidateId: dispatched.state.builder_handoff!.candidate_id,
        verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
      }),
    );
    const result = await runNativeCli([
      'next',
      dispatched.state.name,
      '--runner-input',
      file,
      '--project-root',
      root,
      '--json',
    ]);
    expect(result.exitCode).toBe(0);
    const state = await readNativePortableState(
      nativePortableStateFile(paths, dispatched.state.name),
    );
    expect(state.verifier_action?.status).toBe('running');
    await fs.unlink(nativeLocalExecutionFile(paths, state.name));
    const recovered = await recoverNativePortableChange({ paths, name: state.name });
    expect(recovered.state.verifier_action).toMatchObject({
      id: state.verifier_action!.id,
      status: 'unknown',
    });
    expect(recovered).toMatchObject({ action: 'await-user', reason: 'execution-active' });
    const repeated = await recoverNativePortableChange({ paths, name: state.name });
    expect(repeated.state.state_version).toBe(recovered.state.state_version);
    expect(repeated.state.loop.attempt).toBe(1);
  });

  it('accepts the same final outcome once and rejects a conflicting repeated outcome', async () => {
    const dispatched = await dispatchVerifier('receipt-terminal');
    const input = {
      kind: 'verifier-response' as const,
      candidateId: dispatched.state.builder_handoff!.candidate_id,
      verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
      response: {
        kind: 'final-result',
        result: {
          iteration: 1,
          attempt: 1,
          verdict: 'pass',
          acceptance: dispatched.state.acceptance.map(({ id }) => ({
            id,
            result: 'passed',
            reason: 'Inspected.',
          })),
          risks: [],
          summary: 'Verified.',
        },
      },
    };
    const first = await applyNativeRunnerInput({
      paths,
      name: 'receipt-terminal',
      input,
      maxVerifyFailures: 5,
    });
    expect(first.state.verifier_action?.status).toBe('succeeded');
    const repeated = await applyNativeRunnerInput({
      paths,
      name: 'receipt-terminal',
      input,
      maxVerifyFailures: 5,
    });
    expect(repeated.state.state_version).toBe(first.state.state_version);
    expect(repeated.state.verifier_action?.receipts).toHaveLength(1);
    const file = path.join(root, 'final-response.json');
    await fs.writeFile(file, JSON.stringify(input));
    const viaCli = await runNativeCli([
      'next',
      first.state.name,
      '--runner-input',
      file,
      '--project-root',
      root,
      '--json',
    ]);
    expect(viaCli.exitCode).toBe(0);
    expect(
      (await readNativePortableState(nativePortableStateFile(paths, first.state.name)))
        .state_version,
    ).toBe(first.state.state_version);
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'receipt-terminal',
        input: {
          ...input,
          response: {
            ...input.response,
            result: { ...input.response.result, summary: 'Different.' },
          },
        },
        maxVerifyFailures: 5,
      }),
    ).rejects.toThrow();
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
