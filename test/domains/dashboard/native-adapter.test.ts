import { describe, expect, it } from 'vitest';

import {
  NATIVE_LOCAL_EXECUTION_SCHEMA,
  NATIVE_PORTABLE_STATE_SCHEMA,
  type NativeLocalExecutionState,
  type NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';
import {
  adaptNativeDashboardChange,
  adaptNativeDashboardListItem,
  adaptNativeDashboardProjection,
  NATIVE_DASHBOARD_LIMITS,
} from '../../../domains/dashboard/native-adapter.js';

const NOW = '2026-08-09T08:00:00.000Z';
const text = (value: string) => ({ text: value, truncated: false });

function portableState(name = 'dashboard-v2'): NativePortableState {
  return {
    schema: NATIVE_PORTABLE_STATE_SCHEMA,
    name,
    language: 'zh-CN',
    phase: 'verify',
    status: 'active',
    state_version: 7,
    brief: 'brief.md',
    spec_changes: [{ capability: 'dashboard', operation: 'modify', source: 'specs/dashboard.md' }],
    workspace: {
      isolation: 'current',
      change_branch: null,
      target_branch: null,
      finish: null,
    },
    loop: {
      stage: 'verify-ready',
      goal_cycle: 2,
      iteration: 3,
      attempt: 2,
      retry_epoch: 1,
      failed_iteration_count: 1,
      no_progress_count: 0,
      execution_failure_count: 0,
      previous_unresolved_ids: ['accept-failed'],
      next_action: 'Verifier 独立复核本轮候选实现。',
    },
    acceptance: [
      {
        id: 'accept-passed',
        source: 'brief.md',
        text: '列表展示 loop 进度。',
        result: 'passed',
        reason: text('已观察到对应结果。'),
      },
      {
        id: 'accept-failed',
        source: 'specs/dashboard.md',
        text: '失败项回到 Builder。',
        result: 'failed',
        reason: text('缺少失败态文案。'),
      },
      {
        id: 'accept-blocked',
        source: 'brief.md',
        text: '外部依赖可阻塞。',
        result: 'blocked',
        reason: text('等待外部服务。'),
      },
      {
        id: 'accept-pending',
        source: 'brief.md',
        text: '归档前复核。',
        result: 'pending',
        reason: null,
      },
    ],
    builder_handoff: {
      candidate_id: 'candidate-3',
      identity_provider: 'runtime',
      builder_execution_ref: 'builder-3',
      iteration: 3,
      summary: text('Builder 已提交本轮实现。'),
      addressed_acceptance_ids: ['accept-failed'],
      checks: [{ name: text('focused tests'), result: 'passed', note: null }],
      checks_truncated: false,
      known_limits: [text('尚未覆盖真实浏览器。')],
      known_limits_truncated: false,
      submitted_at: NOW,
    },
    blockers: [
      {
        owner: 'builder',
        reason: text('需要补充失败态文案。'),
        acceptance_ids: ['accept-failed'],
        resolution_action: 'return-build',
      },
    ],
    verification: {
      candidate_id: 'candidate-3',
      identity_provider: 'runtime',
      verifier_execution_ref: 'verifier-3',
      iteration: 3,
      attempt: 2,
      assurance: 'host-attested',
      verdict: 'fail',
      checks: [
        {
          id: 'focused-tests',
          name: text('Dashboard focused tests'),
          argv_display: [text('pnpm'), text('vitest')],
          argv_truncated: true,
          cwd_ref: '.',
          status: 'failed',
          exit_code: 1,
          duration_ms: 1250,
        },
      ],
      summary: text('一项验收仍失败。'),
      risks: [text('失败态可能误导用户。')],
      risks_truncated: false,
      completed_at: NOW,
    },
    history: [
      {
        goal_cycle: 2,
        iteration: 2,
        attempt: 1,
        outcome: 'fail',
        unresolved_ids: ['accept-failed'],
        summary: text('上一轮验证失败。'),
        completed_at: NOW,
      },
    ],
    history_overflow: {
      dropped_entries: 2,
      first_dropped_at: '2026-08-08T08:00:00.000Z',
      last_dropped_at: '2026-08-08T09:00:00.000Z',
      outcome_counts: { pass: 0, fail: 1, blocked: 0, 'execution-error': 0, recovery: 1 },
    },
    verification_result: 'fail',
    verification_report: 'verification.md',
    archived: false,
    created_at: '2026-08-08T07:00:00.000Z',
  };
}

function localExecution(stateVersion = 7): NativeLocalExecutionState {
  return {
    schema: NATIVE_LOCAL_EXECUTION_SCHEMA,
    change: 'dashboard-v2',
    basedOnStateVersion: stateVersion,
    workspace: {
      projectRoot: 'D:\\project',
      worktreeRoot: 'D:\\project',
      branch: null,
    },
    execution: {
      operationId: 'verify-operation',
      stage: 'verifying',
      actor: 'verifier',
      executionId: 'private-verifier-session',
      status: 'running',
      startedAt: NOW,
      requestCheckRounds: 2,
    },
    checks: [
      {
        id: 'focused-tests',
        name: 'Dashboard focused tests',
        operationId: 'verify-operation',
        status: 'running',
        repeatable: true,
        timeoutMs: 10_000,
        executionCount: 1,
        argv: ['pnpm', 'vitest', '--run'],
        cwd: 'D:\\project',
        exitCode: null,
        startedAt: NOW,
        completedAt: null,
        log: 'D:\\project\\.comet\\private.log',
      },
    ],
  };
}

describe('Native Dashboard v2 adapter', () => {
  it('projects loop, acceptance, verifier results, blockers, history, and recovery state', () => {
    const projection = adaptNativeDashboardChange({
      state: portableState(),
      status: 'active',
      localExecution: localExecution(),
      localExecutionReason: 'current',
    });

    expect(projection).toMatchObject({
      workflow: 'native',
      name: 'dashboard-v2',
      stateVersion: 7,
      loop: { stage: 'verify-ready', goalCycle: 2, iteration: 3, attempt: 2, actor: 'verifier' },
      acceptance: { total: 4, passed: 1, failed: 1, blocked: 1, pending: 1 },
      verificationResult: 'fail',
      specs: { total: 1, modify: 1 },
      localExecution: {
        status: 'running',
        reason: 'current',
        stage: 'verifying',
        actor: 'verifier',
        requestCheckRounds: 2,
        checks: [{ id: 'focused-tests', status: 'running', logAvailable: true }],
      },
      verification: {
        verdict: 'fail',
        assurance: 'host-attested',
        summary: text('一项验收仍失败。'),
      },
      blockers: [{ owner: 'builder', acceptanceIds: ['accept-failed'] }],
      history: [{ iteration: 2, attempt: 1, outcome: 'fail' }],
      historyOverflow: { droppedEntries: 2 },
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('private-verifier-session');
    expect(serialized).not.toContain('D:\\\\project\\\\.comet\\\\private.log');
    expect(serialized).not.toContain('"argv":["pnpm"');
    expect(serialized).not.toContain('argvDisplay');
    expect(serialized).not.toContain('cwdRef');
  });

  it('does not apply an overlay whose state version does not match the YAML', () => {
    const item = adaptNativeDashboardListItem({
      state: portableState(),
      status: 'active',
      localExecution: localExecution(6),
      localExecutionReason: 'version-mismatch',
    });

    expect(item.loop?.actor).toBeNull();
    expect(item.localExecution).toMatchObject({
      status: 'absent',
      reason: 'version-mismatch',
      actor: null,
      checks: [],
      recoverableFromStage: 'verify-ready',
    });
  });

  it.each([
    'host-attested',
    'skill-coordinated',
    'semantic-verification-unavailable',
    'user-confirmed-degraded',
  ] as const)('preserves the portable %s assurance boundary', (assurance) => {
    const state = portableState();
    state.verification!.assurance = assurance;
    const projection = adaptNativeDashboardChange({ state, status: 'active' });
    expect(projection.verification?.assurance).toBe(assurance);
  });

  it('emits the v2 schema and enforces the bounded all-in-one projection', () => {
    const changes = Array.from({ length: NATIVE_DASHBOARD_LIMITS.maxChanges + 2 }, (_, index) =>
      adaptNativeDashboardChange({
        state: portableState(`dashboard-${index}`),
        status: 'active',
      }),
    );
    const projection = adaptNativeDashboardProjection({ generatedAt: NOW, changes });

    expect(projection.schema).toBe('comet.dashboard.native.v2');
    expect(projection.visibleChangeCount).toBe(NATIVE_DASHBOARD_LIMITS.maxChanges);
    expect(projection.omittedChangeCount).toBe(2);
    expect(projection.changesTruncated).toBe(true);
  });

  it('rejects invalid projection timestamps', () => {
    expect(() => adaptNativeDashboardProjection({ generatedAt: 'today', changes: [] })).toThrow(
      'canonical ISO timestamp',
    );
  });
});
