import '../../helpers/isolated-agent-home.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  applyNativeRunnerInput,
  parseNativeRunnerInput,
} from '../../../domains/comet-native/native-runner-input.js';
import {
  createNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';

import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';

import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import {
  createNativeRunnerChannel,
  NATIVE_SKILL_COORDINATION,
} from '../../../domains/comet-native/native-runner-protocol.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';
import { readNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { nativePortableStateFile } from '../../../domains/comet-native/native-portable-storage.js';

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
    vi.restoreAllMocks();
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
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map(({ id }) => id)),
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
    const exactBefore = await fs.readFile(nativePortableStateFile(paths, 'receipt-stale'));

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
    ).rejects.toThrow(/stale|active|candidate/iu);

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
    ).rejects.toThrow(/stale|active|candidate/iu);

    const status = await inspectNativePortableStatus({
      paths,
      name: 'receipt-stale',
    });
    expect(status.continuation.action).toBe('await-verifier');
    expect(
      (await readNativePortableState(nativePortableStateFile(paths, 'receipt-stale')))
        .verifier_action,
    ).toEqual(dispatched.state.verifier_action);
    expect(await fs.readFile(nativePortableStateFile(paths, 'receipt-stale'))).toEqual(exactBefore);
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
      parseNativeRunnerInput({
        kind: 'verifier-started',
        candidateId: 'candidate',
      }),
    ).toThrow();
  });

  it('keeps a dispatched platform task pending until its bound Verifier reports startup and accepts the same start once', async () => {
    const result = await dispatchVerifier('receipt-observable'),
      ref = result.verifierDispatch!.verifierExecutionRef,
      input = {
        kind: 'verifier-started' as const,
        candidateId: result.state.builder_handoff!.candidate_id,
        verifierExecutionRef: ref,
      };
    expect(result.state.verifier_action).toMatchObject({
      status: 'pending',
      attempt: 1,
    });
    const before = await fs.readFile(nativePortableStateFile(paths, 'receipt-observable'));
    const resumed = await runNativeCli([
      'next',
      'receipt-observable',
      '--project-root',
      root,
      '--json',
    ]);
    expect(resumed.exitCode, resumed.stdout).toBe(0);
    expect(await fs.readFile(nativePortableStateFile(paths, 'receipt-observable'))).toEqual(before);
    const started = await applyNativeRunnerInput({
      paths,
      name: 'receipt-observable',
      input,
      maxVerifyFailures: 5,
    });
    expect(started.state.verifier_action).toMatchObject({
      id: result.state.verifier_action!.id,
      status: 'running',
      claim: { token: ref },
    });
    const repeated = await applyNativeRunnerInput({
      paths,
      name: 'receipt-observable',
      input,
      maxVerifyFailures: 5,
    });
    expect(repeated.state).toEqual(started.state);
  });
  it('keeps a delayed platform startup pending without failure or redispatch and preserves the original candidate and action', async () => {
    const result = await dispatchVerifier('receipt-delayed'),
      file = nativePortableStateFile(paths, 'receipt-delayed'),
      before = await fs.readFile(file);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60 * 60 * 1000);
    const status = await inspectNativePortableStatus({
      paths,
      name: 'receipt-delayed',
    });
    expect(status.continuation).toMatchObject({
      action: 'await-verifier',
      requiresUserDecision: false,
    });
    expect(await fs.readFile(file)).toEqual(before);
    const current = await readNativePortableState(file);
    expect(current.verifier_action).toEqual(result.state.verifier_action);
    expect(current.builder_handoff).toEqual(result.state.builder_handoff);
    expect(current.loop.execution_failure_count).toBe(0);
  });
  it('rejects the retired Runtime check request without ending the active platform Verifier or losing its Builder reports', async () => {
    const result = await dispatchVerifier('request-retired'),
      file = nativePortableStateFile(paths, 'request-retired'),
      before = await fs.readFile(file);
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'request-retired',
        maxVerifyFailures: 5,
        input: {
          kind: 'verifier-response',
          candidateId: result.state.builder_handoff!.candidate_id,
          verifierExecutionRef: result.verifierDispatch!.verifierExecutionRef,
          response: {
            kind: 'request-checks',
            checks: [
              {
                id: 'unsafe-repeat',
                executable: process.execPath,
                argv: ['-e', 'throw Error("must not run")'],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow();
    expect(await fs.readFile(file)).toEqual(before);
    expect((await readNativePortableState(file)).verifier_action).toEqual(
      result.state.verifier_action,
    );
    expect((await readNativePortableState(file)).builder_handoff).toEqual(
      result.state.builder_handoff,
    );
  });

  it('keeps the original started platform task running without retired machine metadata and displays its real task state read-only', async () => {
    const result = await dispatchVerifier('receipt-metadata-free'),
      input = {
        kind: 'verifier-started' as const,
        candidateId: result.state.builder_handoff!.candidate_id,
        verifierExecutionRef: result.verifierDispatch!.verifierExecutionRef,
      };
    const pending = await runNativeCli([
      'show',
      'receipt-metadata-free',
      '--project-root',
      root,
      '--json',
    ]);
    expect(JSON.parse(pending.stdout!).data.state.verifier_action).toMatchObject({
      id: result.state.verifier_action!.id,
      status: 'pending',
    });
    const started = await applyNativeRunnerInput({
        paths,
        name: 'receipt-metadata-free',
        input,
        maxVerifyFailures: 5,
      }),
      file = nativePortableStateFile(paths, 'receipt-metadata-free'),
      before = await fs.readFile(file);
    for (const command of ['show', 'status', 'doctor', 'next']) {
      const observed = await runNativeCli([
        command,
        'receipt-metadata-free',
        '--project-root',
        root,
        '--json',
      ]);
      expect(observed.exitCode, observed.stdout).toBe(0);
      expect(await fs.readFile(file)).toEqual(before);
    }
    const show = await runNativeCli([
      'show',
      'receipt-metadata-free',
      '--project-root',
      root,
      '--json',
    ]);
    expect(JSON.parse(show.stdout!).data.state.verifier_action).toMatchObject({
      id: started.state.verifier_action!.id,
      status: 'running',
      claim: started.state.verifier_action!.claim,
    });
    expect((await readNativePortableState(file)).loop.attempt).toBe(1);
  });
});
