import { describe, expect, it } from 'vitest';

import {
  applyNativeVerifierEnvelope,
  confirmNativeSkillCoordinatedPass,
  confirmNativePortableAcceptance,
  recordNativeVerifierExecutionError,
  reserveNativeVerifierAttempt,
  resolveNativeVerifierBlocker,
  returnNativeCandidateToBuild,
  retryNativeVerifier,
  submitNativeBuilderCandidate,
} from '../../../domains/comet-native/native-loop-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { toNativePortableText } from '../../../domains/comet-native/native-portable-text.js';
import type {
  NativePortableCheckSummary,
  NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';
import {
  createNativeRunnerChannel,
  NATIVE_SKILL_COORDINATION,
} from '../../../domains/comet-native/native-runner-protocol.js';
import { nativePortableContinuation } from '../../../domains/comet-native/native-portable-continuation.js';

const checks: NativePortableCheckSummary[] = [
  {
    id: 'unit',
    name: toNativePortableText('Unit tests'),
    argv_display: [toNativePortableText('test')],
    argv_truncated: false,
    cwd_ref: '.',
    status: 'passed',
    exit_code: 0,
    duration_ms: 25,
  },
];

function buildState(identityProvider = 'test-host'): {
  state: NativePortableState;
  runner: ReturnType<typeof createNativeRunnerChannel>;
} {
  const runner = createNativeRunnerChannel();
  let state = confirmNativePortableAcceptance({
    state: createNativePortableState({ name: 'loop-change', language: 'en' }),
    acceptance: [
      { id: 'A1', source: 'brief.md', text: 'First behavior works.' },
      { id: 'A2', source: 'brief.md', text: 'Second behavior works.' },
    ],
  });
  state = submitNativeBuilderCandidate({
    state,
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider,
        executionRef: 'builder-1',
      }),
      candidateId: `candidate-${state.loop.iteration}`,
      summary: 'Implemented the candidate.',
      addressedAcceptanceIds: ['A1', 'A2'],
      review: {
        status: 'passed',
        summary: 'A read-only reviewer found no blocking issues.',
        reviewerExecutionRef: 'reviewer-1',
      },
    },
  });
  state = reserveNativeVerifierAttempt(state);
  return { state, runner };
}

function envelope(
  runner: ReturnType<typeof createNativeRunnerChannel>,
  state: NativePortableState,
  verdict: 'pass' | 'fail' | 'blocked',
  unresolved: string[] = [],
  acceptanceIds = state.acceptance.filter(({ result }) => result === 'pending').map(({ id }) => id),
) {
  return runner.envelopeVerifierResponse({
    candidateId: state.builder_handoff!.candidate_id,
    identity: runner.captureExecutionIdentity({
      identityProvider: state.builder_handoff!.identity_provider,
      executionRef: `verifier-${state.loop.iteration}-${state.loop.attempt}`,
    }),
    payload: {
      kind: 'final-result',
      result: {
        iteration: state.loop.iteration,
        attempt: state.loop.attempt,
        verdict,
        acceptance: acceptanceIds.map((id) => ({
          id,
          result: unresolved.includes(id)
            ? verdict === 'blocked'
              ? 'blocked'
              : 'failed'
            : 'passed',
          reason: unresolved.includes(id) ? 'Behavior is missing.' : 'Behavior was observed.',
        })),
        risks: [],
        summary: verdict === 'pass' ? 'Everything passed.' : 'Some behavior is missing.',
      },
    },
  });
}

function resubmitRepair(
  runner: ReturnType<typeof createNativeRunnerChannel>,
  state: NativePortableState,
): NativePortableState {
  const submitted = submitNativeBuilderCandidate({
    state,
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: state.builder_handoff!.identity_provider,
        executionRef: `builder-${state.loop.iteration}`,
      }),
      candidateId: `candidate-${state.loop.iteration}`,
      summary: 'Tried a new repair hypothesis.',
      addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
      review: {
        status: 'passed',
        summary: 'A fresh read-only review passed after the repair.',
        reviewerExecutionRef: `reviewer-${state.loop.iteration}`,
      },
    },
  });
  return reserveNativeVerifierAttempt(submitted);
}

describe('Native portable Build/Verify loop', () => {
  it('requires a passed read-only review from a different execution before Verify', () => {
    const runner = createNativeRunnerChannel();
    const state = confirmNativePortableAcceptance({
      state: createNativePortableState({ name: 'reviewed-change', language: 'en' }),
      acceptance: [{ id: 'A1', source: 'brief.md', text: 'Reviewed behavior works.' }],
    });
    const identity = runner.captureExecutionIdentity({
      identityProvider: 'test-host',
      executionRef: 'builder-review-gate',
    });

    expect(() =>
      submitNativeBuilderCandidate({
        state,
        input: {
          identity,
          summary: 'Candidate without a separate review.',
          addressedAcceptanceIds: ['A1'],
          review: {
            status: 'passed',
            summary: 'Review passed.',
            reviewerExecutionRef: 'builder-review-gate',
          },
        },
      }),
    ).toThrow('reviewer execution ref must differ');

    expect(() =>
      submitNativeBuilderCandidate({
        state,
        input: {
          identity,
          summary: 'Candidate without review evidence.',
          addressedAcceptanceIds: ['A1'],
        } as never,
      }),
    ).toThrow('requires a passed read-only review');

    const reviewed = submitNativeBuilderCandidate({
      state,
      input: {
        identity,
        summary: 'Candidate with a valid review.',
        addressedAcceptanceIds: ['A1'],
        review: {
          status: 'passed',
          summary: 'Independent review passed.',
          reviewerExecutionRef: 'reviewer-valid',
        },
      },
    });
    expect(() =>
      reserveNativeVerifierAttempt({
        ...reviewed,
        builder_handoff: { ...reviewed.builder_handoff!, review: null },
      }),
    ).toThrow('requires a reviewed Builder candidate');
  });

  it('requires a fresh review after a candidate returns to Build', () => {
    const prepared = buildState();
    const failed = applyNativeVerifierEnvelope({
      state: prepared.state,
      envelope: envelope(prepared.runner, prepared.state, 'fail', ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(() =>
      submitNativeBuilderCandidate({
        state: failed,
        input: {
          identity: prepared.runner.captureExecutionIdentity({
            identityProvider: 'test-host',
            executionRef: 'builder-2',
          }),
          summary: 'Repaired A2.',
          addressedAcceptanceIds: ['A2'],
          review: {
            status: 'passed',
            summary: 'Reused the prior review.',
            reviewerExecutionRef: 'reviewer-1',
          },
        },
      }),
    ).toThrow('fresh read-only review');
  });

  it('keeps passed scenarios when a blocked candidate returns to Build', () => {
    const prepared = buildState();
    const blocked = applyNativeVerifierEnvelope({
      state: prepared.state,
      envelope: envelope(prepared.runner, prepared.state, 'blocked', ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    const repairing = returnNativeCandidateToBuild({
      state: blocked,
      reason: 'Resolve the blocked A2 implementation.',
    });

    expect(repairing.acceptance).toMatchObject([
      { id: 'A1', result: 'passed' },
      { id: 'A2', result: 'pending' },
    ]);
    expect(repairing.builder_handoff?.review?.reviewer_execution_ref).toBe('reviewer-1');
    expect(repairing.loop.previous_unresolved_ids).toEqual(['A2']);
  });

  it('requires a reviewed parent handoff when every child is done', () => {
    const state = confirmNativePortableAcceptance({
      state: createNativePortableState({ name: 'parent-change', language: 'en' }),
      acceptance: [{ id: 'A1', source: 'brief.md', text: 'Parent behavior works.' }],
    });
    const continuation = nativePortableContinuation(state, {
      contractHash: 'contract',
      confirmed: true,
      parentBranch: 'comet/supervisor/parent/integration',
      children: [],
      readyChildren: [],
      allDone: true,
    });

    expect(continuation).toMatchObject({
      disposition: 'continue',
      action: 'builder-handoff',
      requiredInputs: ['builder-handoff-json-file'],
      commandArgs: [
        'comet',
        'native',
        'next',
        state.name,
        '--runner-input',
        '<temporary-json-file>',
      ],
    });
  });

  it('requires an explicit coordination choice before confirming a multi-child Supervisor Shape', () => {
    const state = createNativePortableState({ name: 'supervisor-shape', language: 'en' });
    const children = {
      schema: 'comet.native.children.v2',
      contractHash: null,
      confirmed: false,
      parentBranch: 'master',
      children: [
        {
          name: 'first-child',
          summary: null,
          dependsOn: [],
          covers: ['A1'],
          status: 'pending',
          phase: 'shape',
          projectRoot: null,
          message: null,
        },
        {
          name: 'second-child',
          summary: null,
          dependsOn: [],
          covers: ['A2'],
          status: 'pending',
          phase: 'shape',
          projectRoot: null,
          message: null,
        },
      ],
      readyChildren: [],
      allDone: false,
    } as const;
    const continuation = nativePortableContinuation(state, children);

    expect(continuation).toMatchObject({
      disposition: 'await-user',
      action: 'confirm-shape',
      requiredInputs: ['summary', 'coordination-choice', 'shared-understanding-confirmation'],
      commandArgs: expect.arrayContaining(['--coordination-mode', '<coordination-mode>']),
      inputOptions: [
        expect.objectContaining({ name: 'summary', flag: '--summary' }),
        expect.objectContaining({
          name: 'coordination-mode',
          flag: '--coordination-mode',
          valueKind: 'choice',
          choices: ['multi-session', 'single-session'],
        }),
        expect.objectContaining({ name: 'confirmed', flag: '--confirmed' }),
      ],
      userCommunication: {
        required: true,
        message: expect.stringContaining('coordination'),
      },
    });

    const resumed = nativePortableContinuation(
      { ...state, coordination_mode: 'multi-session' },
      children,
    );
    expect(resumed).toMatchObject({
      disposition: 'continue',
      action: 'confirm-shape',
      requiredInputs: ['summary', 'shared-understanding-confirmation'],
      userCommunication: { required: false },
    });
    expect(resumed.commandArgs).not.toContain('--coordination-mode');
    expect(resumed.inputOptions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'coordination-mode' })]),
    );
  });

  it('requires user confirmation before a package-local pass becomes archive-ready', () => {
    const { state, runner } = buildState();
    const result = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'pass'),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(result).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      verification_report: 'verification.md',
      loop: { stage: 'await-user', iteration: 1, attempt: 1 },
    });
    expect(result.acceptance.every(({ result }) => result === 'passed')).toBe(true);
    expect(confirmNativeSkillCoordinatedPass(result)).toMatchObject({
      phase: 'archive',
      status: 'active',
      loop: { stage: 'archive-ready' },
    });
  });

  it.each(['en', 'zh-CN'] as const)(
    'provides a non-empty Supervisor integration check template in %s',
    (language) => {
      const { state } = buildState();
      state.language = language;
      state.loop.stage = 'verify-ready';
      state.loop.next_action = 'run-required-checks-and-dispatch-verifier';
      expect(nativePortableContinuation(state).inputOptions[0].template).toEqual({
        kind: 'dispatch-verifier',
        checks: [],
      });

      state.children_contract_hash = 'parent-contract';
      const continuation = nativePortableContinuation(state);
      expect(continuation.inputOptions[0].template).toEqual({
        kind: 'dispatch-verifier',
        checks: [
          {
            id: '<check-id>',
            name: '<check-name>',
            executable: '<executable>',
            argv: [],
            cwdRef: '.',
            timeoutMs: 120000,
            repeatable: true,
          },
        ],
      });
      expect(continuation.userCommunication.agentInstruction).toContain(
        language === 'en' ? 'at least one integration check' : '至少一项集成检查',
      );
    },
  );

  it('offers requirement revision only before Archive finalizes the change', () => {
    const { state, runner } = buildState();
    const archiveReady = confirmNativeSkillCoordinatedPass(
      applyNativeVerifierEnvelope({
        state,
        envelope: envelope(runner, state, 'pass'),
        checks,
        maxVerifyFailures: 5,
      }).state,
    );

    expect(nativePortableContinuation(archiveReady).commandAlternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'revise-requirements',
          expectedAction: 'revise-requirements',
        }),
      ]),
    );

    const archived = {
      ...archiveReady,
      archived: true,
      status: 'done' as const,
      loop: { ...archiveReady.loop, stage: 'done' as const },
    };
    expect(nativePortableContinuation(archived).commandAlternatives).toBeUndefined();
  });

  it('allows an explicitly empty Runtime check plan when Verifier covers every acceptance ID', () => {
    const { state, runner } = buildState();
    const result = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'pass'),
      checks: [],
      maxVerifyFailures: 5,
    }).state;

    expect(result).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      verification: { checks: [] },
      loop: { stage: 'await-user', iteration: 1, attempt: 1 },
    });
    expect(result.acceptance.map(({ result: acceptanceResult }) => acceptanceResult)).toEqual([
      'passed',
      'passed',
    ]);
  });

  it('returns an implementation failure to a new Build iteration', () => {
    const { state, runner } = buildState();
    const result = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(result).toMatchObject({
      phase: 'build',
      status: 'active',
      verification_result: 'fail',
      verification_report: 'verification.md',
      loop: {
        stage: 'repairing',
        iteration: 2,
        attempt: 0,
        failed_iteration_count: 1,
        previous_unresolved_ids: ['A2'],
      },
    });
  });

  it('checks only affected scenarios during repair, then requires one final full verification', () => {
    const prepared = buildState();
    const { runner } = prepared;
    let state = applyNativeVerifierEnvelope({
      state: prepared.state,
      envelope: envelope(runner, prepared.state, 'fail', ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    state = submitNativeBuilderCandidate({
      state,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: state.builder_handoff!.identity_provider,
          executionRef: 'builder-repair-2',
        }),
        candidateId: 'candidate-repair-2',
        summary: 'Repaired the failing scenario.',
        addressedAcceptanceIds: ['A2'],
        review: {
          status: 'passed',
          summary: 'The repair passed read-only review.',
          reviewerExecutionRef: 'reviewer-repair-2',
        },
      },
    });
    expect(state.acceptance).toMatchObject([
      { id: 'A1', result: 'passed' },
      { id: 'A2', result: 'pending' },
    ]);

    state = reserveNativeVerifierAttempt(state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'pass', [], ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;
    expect(state).toMatchObject({
      phase: 'verify',
      status: 'active',
      verification_result: 'pending',
      loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
    });
    expect(state.acceptance.every(({ result }) => result === 'pending')).toBe(true);

    state = reserveNativeVerifierAttempt(state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'pass', [], ['A1', 'A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;
    expect(state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { stage: 'await-user', next_action: 'confirm-skill-coordinated-pass' },
    });
  });

  it('runs a new final full verification even when the repair scope already contains every item', () => {
    const prepared = buildState();
    let state = applyNativeVerifierEnvelope({
      state: prepared.state,
      envelope: envelope(prepared.runner, prepared.state, 'fail', ['A1', 'A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    state = resubmitRepair(prepared.runner, state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(prepared.runner, state, 'pass', [], ['A1', 'A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(state).toMatchObject({
      phase: 'verify',
      status: 'active',
      verification_result: 'pending',
      loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
    });

    state = reserveNativeVerifierAttempt(state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(prepared.runner, state, 'pass', [], ['A1', 'A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;
    expect(state).toMatchObject({
      status: 'await-user',
      verification_result: 'pass',
      loop: { next_action: 'confirm-skill-coordinated-pass' },
    });
  });

  it('counts alternating and increased unresolved sets as no progress, but resets on a strict subset', () => {
    const prepared = buildState();
    let { state } = prepared;
    const { runner } = prepared;
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A1']),
      checks,
      maxVerifyFailures: 10,
    }).state;
    expect(state.loop.no_progress_count).toBe(0);

    state = resubmitRepair(runner, state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A2']),
      checks,
      maxVerifyFailures: 10,
    }).state;
    expect(state.loop.no_progress_count).toBe(1);

    state = resubmitRepair(runner, state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A1', 'A2']),
      checks,
      maxVerifyFailures: 10,
    }).state;
    expect(state.loop.no_progress_count).toBe(2);
    expect(state.blockers[0]?.reason.text).toContain('different repair hypothesis');

    state = resubmitRepair(runner, state);
    state = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A1']),
      checks,
      maxVerifyFailures: 10,
    }).state;
    expect(state).toMatchObject({
      status: 'active',
      loop: { no_progress_count: 0, stage: 'repairing' },
    });
  });

  it('stops alternating unresolved sets after three non-progressive results', () => {
    const prepared = buildState();
    let { state } = prepared;
    const { runner } = prepared;
    for (const unresolved of [['A1'], ['A2'], ['A1'], ['A2']]) {
      state = applyNativeVerifierEnvelope({
        state,
        envelope: envelope(runner, state, 'fail', unresolved),
        checks,
        maxVerifyFailures: 10,
      }).state;
      if (state.status === 'active') state = resubmitRepair(runner, state);
    }

    expect(state).toMatchObject({
      status: 'await-user',
      verification_report: 'verification.md',
      loop: { no_progress_count: 3, stage: 'await-user' },
    });
    expect(nativePortableContinuation(state)).toMatchObject({
      disposition: 'await-user',
      action: 'resolve-loop-stop',
      commandArgs: null,
      requiredInputs: ['summary', 'user-decision'],
      userCommunication: {
        required: true,
        message: expect.stringContaining('paused to avoid looping on the same problem'),
        suggestedReply: 'Continue repairing',
        agentInstruction: expect.stringContaining('revise-implementation'),
      },
      commandAlternatives: expect.arrayContaining([
        expect.objectContaining({
          name: 'revise-implementation',
          commandArgs: expect.arrayContaining(['--revise-implementation']),
          requiredInputs: ['summary', 'user-decision'],
        }),
        expect.objectContaining({
          name: 'revise-requirements',
          commandArgs: expect.arrayContaining(['--revise-requirements']),
          requiredInputs: ['summary', 'user-decision'],
        }),
      ]),
    });
    expect(
      nativePortableContinuation({ ...state, language: 'zh-CN' }).userCommunication,
    ).toMatchObject({
      required: true,
      message: expect.stringContaining('本次修改已暂停'),
      suggestedReply: '继续修复',
      agentInstruction: expect.stringContaining('revise-implementation'),
    });
  });

  it('explains a budget-exhausted stop without calling it a no-progress loop', () => {
    const { state, runner } = buildState();
    const stopped = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'fail', ['A1']),
      checks,
      maxVerifyFailures: 1,
    }).state;

    expect(stopped).toMatchObject({
      status: 'await-user',
      loop: { failed_iteration_count: 1, no_progress_count: 0, stage: 'await-user' },
    });
    expect(nativePortableContinuation(stopped).userCommunication).toMatchObject({
      required: true,
      message: expect.stringContaining('used its configured failure budget'),
      suggestedReply: 'Continue repairing',
    });
    expect(
      nativePortableContinuation({ ...stopped, language: 'zh-CN' }).userCommunication,
    ).toMatchObject({
      required: true,
      message: expect.stringContaining('已用完配置的预算'),
    });
  });

  it('persists one stop reason when budget and no-progress thresholds overlap', () => {
    const prepared = buildState();
    const primed = {
      ...prepared.state,
      loop: {
        ...prepared.state.loop,
        failed_iteration_count: 2,
        no_progress_count: 2,
        previous_unresolved_ids: ['A1'],
      },
    };
    const stopped = applyNativeVerifierEnvelope({
      state: primed,
      envelope: envelope(prepared.runner, primed, 'fail', ['A1']),
      checks,
      maxVerifyFailures: 3,
    }).state;

    expect((stopped.loop as { stop_reason?: string }).stop_reason).toBe('stalled');
    expect(stopped.blockers[0]?.reason.text).toContain('did not strictly reduce');
    expect(nativePortableContinuation(stopped).userCommunication.message).toContain(
      'failed three times in a row',
    );
  });

  it('keeps a report reference for a semantic blocker', () => {
    const { state, runner } = buildState();
    const result = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'blocked', ['A2']),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(result).toMatchObject({
      status: 'await-user',
      verification_result: 'blocked',
      verification_report: 'verification.md',
      loop: { next_action: 'resolve-verifier-blocker' },
    });
    expect(nativePortableContinuation(result).userCommunication).toMatchObject({
      required: true,
      message: expect.stringContaining('information only you can provide'),
      suggestedReply: null,
      agentInstruction: expect.stringContaining('resolve-verifier-blocker'),
    });
    expect(
      nativePortableContinuation({ ...result, language: 'zh-CN' }).userCommunication,
    ).toMatchObject({
      required: true,
      message: expect.stringContaining('缺少只有你能提供的信息'),
    });

    const resumed = resolveNativeVerifierBlocker(result, {
      reason: 'The external service returns 429 under load; that behavior is expected.',
    });
    expect(resumed.history[resumed.history.length - 1]).toMatchObject({
      outcome: 'recovery',
      summary: { text: 'The external service returns 429 under load; that behavior is expected.' },
    });
  });

  it('blocks after three execution errors without consuming semantic failure budgets', () => {
    let { state } = buildState();
    expect(nativePortableContinuation(state).userCommunication).toMatchObject({
      required: false,
      message: null,
      suggestedReply: null,
    });
    for (let index = 0; index < 3; index += 1) {
      state = recordNativeVerifierExecutionError({
        state,
        summary: `Verifier crashed ${index + 1}.`,
      });
      if (index < 2) {
        expect(() =>
          recordNativeVerifierExecutionError({ state, summary: 'Stale duplicate error.' }),
        ).toThrow('active Verify attempt');
        expect(nativePortableContinuation(state).userCommunication).toMatchObject({
          required: false,
          message: null,
          suggestedReply: null,
          agentInstruction: expect.stringContaining(
            'Continue with dispatch-verifier without asking the user',
          ),
        });
        state = reserveNativeVerifierAttempt(state);
      }
    }

    expect(state).toMatchObject({
      phase: 'verify',
      status: 'blocked',
      loop: {
        stage: 'blocked',
        attempt: 3,
        execution_failure_count: 3,
        failed_iteration_count: 0,
        no_progress_count: 0,
      },
    });
    expect(nativePortableContinuation(state).userCommunication).toEqual({
      required: true,
      message:
        'Verification paused because the independent verification task repeatedly ended without a result. Your code and completed checks are safely preserved. Reply “Continue” to retry; you do not need to manage files or processes.',
      suggestedReply: 'Continue',
      agentInstruction:
        'Relay only message and suggestedReply to the user, then wait for that reply. Do not expose internal attempts, counters, paths, or recovery steps.',
    });
    const retried = retryNativeVerifier(state);
    expect(retried.loop).toMatchObject({
      stage: 'verify-ready',
      retry_epoch: 1,
      execution_failure_count: 0,
      attempt: 3,
    });
  });

  it('rejects a stale execution error after a Skill-coordinated pass', () => {
    const { state, runner } = buildState(NATIVE_SKILL_COORDINATION);
    const passed = applyNativeVerifierEnvelope({
      state,
      envelope: envelope(runner, state, 'pass'),
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(passed).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
      loop: { next_action: 'confirm-skill-coordinated-pass' },
    });
    expect(() =>
      recordNativeVerifierExecutionError({ state: passed, summary: 'Late failure.' }),
    ).toThrow('active Verify attempt');
  });

  it('does not accept a pass when the final Runtime check failed', () => {
    const { state, runner } = buildState();
    expect(() =>
      applyNativeVerifierEnvelope({
        state,
        envelope: envelope(runner, state, 'pass'),
        checks: [{ ...checks[0], status: 'failed', exit_code: 1 }],
        maxVerifyFailures: 5,
      }),
    ).toThrow('required check');
  });

  it('stores long diagnostic reasons as truncated previews without invalidating the decision', () => {
    const { state, runner } = buildState();
    const trusted = runner.envelopeVerifierResponse({
      candidateId: state.builder_handoff!.candidate_id,
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: 'verifier-long',
      }),
      payload: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: 'fail',
          acceptance: state.acceptance.map(({ id }, index) => ({
            id,
            result: index === 0 ? 'failed' : 'passed',
            reason: '鱼'.repeat(100_000),
          })),
          risks: ['risk'.repeat(100_000)],
          summary: 'summary'.repeat(100_000),
        },
      },
    });
    const result = applyNativeVerifierEnvelope({
      state,
      envelope: trusted,
      checks,
      maxVerifyFailures: 5,
    }).state;

    expect(result.acceptance[0].reason).toMatchObject({ truncated: true });
    expect(result.verification?.summary).toMatchObject({ truncated: true });
    expect(result.verification?.risks[0]).toMatchObject({ truncated: true });
    expect(result.verification_result).toBe('fail');
  });
});
