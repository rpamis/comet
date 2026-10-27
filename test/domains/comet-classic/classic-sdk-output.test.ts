import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import { createRuntimeAction } from '../../../domains/engine/runtime-action.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-state.js';
import { classicSdkNextAction } from '../../../domains/comet-classic/classic-sdk-status.js';
import {
  classicSdkContinuation,
  classicSdkRunSummary,
} from '../../../domains/comet-classic/classic-sdk-output.js';

function fixture(stepId = 'full.build.check', ref = 'classic-check'): WorkflowRun {
  const state = parseClassicStateDocument({
    workflow: 'full',
    phase: 'build',
    design_doc: null,
    plan: null,
    build_mode: null,
    isolation: 'current',
    verify_mode: null,
    verify_result: 'pending',
    verified_at: null,
    archived: false,
    auto_transition: true,
  }).classic!;
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    runId: 'demo',
    revision: 7,
    workflow: { id: 'comet-classic-full', version: '1', hash: 'fixed' },
    definitionHashes: {},
    input: { change: 'demo', changeDir: 'openspec/changes/demo' },
    state: { ...state },
    status: 'running',
    sequence: 1,
    actions: [
      createRuntimeAction({
        id: 'action-1',
        runId: 'demo',
        stepId,
        type: ref.startsWith('comet-') ? 'invoke_skill' : 'call_tool',
        ref,
        input: { task: 'the current task' },
        retry: 'reconcile',
      }),
    ],
    actionContexts: {},
    waits: [],
    evidenceWaits: [],
    ready: [],
    joins: {},
    outputs: {},
    children: [],
    lineage: [],
  };
}

const root = '/tmp/project with spaces';

describe('Classic next-step source projection', () => {
  it('shows the original delivery recheck request before large approval context', () => {
    const run = fixture('full.delivery.check');
    run.state = { ...(run.state as object), phase: 'archive', archived: true };
    run.waits = [
      {
        id: 'approved-open',
        stepId: 'full.open.confirm',
        sequence: 1,
        status: 'resolved',
        proposal: { details: 'LARGE_APPROVAL_CONTEXT_' + 'x'.repeat(12000) },
        proposalHash: 'approved-open-hash',
        choices: ['approved', 'rejected'],
        results: {},
        decision: { id: 'actual-reply', choice: 'approved', proposalHash: 'approved-open-hash' },
      },
    ];
    run.actionContexts['action-1'] = {
      sequence: 2,
      results: { 'full.open.confirm': { sequence: 1, value: { approved: true } } },
    };
    const before = structuredClone(run);
    const continuation = classicSdkContinuation(run, root, 'demo');
    expect(continuation).toMatchObject({
      mode: 'execute',
      request: {
        operation: 'execute',
        runId: 'demo',
        expectedRevision: 7,
        actionId: 'action-1',
        executorId: 'comet-classic-check',
      },
    });
    const serialized = JSON.stringify(continuation);
    expect(serialized.indexOf('"request":')).toBeLessThan(
      serialized.indexOf('LARGE_APPROVAL_CONTEXT_'),
    );
    expect(serialized).toContain('LARGE_APPROVAL_CONTEXT_');
    expect(classicSdkNextAction(run)?.instruction).toContain('data.continuation.request');
    expect(continuation.instruction).toContain('data.continuation.request');
    expect(run).toEqual(before);
  });

  it.each(['design', 'delivery'])(
    'keeps task authorization separate from new %s proposal approval',
    (kind) => {
      const run = fixture();
      run.actions = [];
      run.status = 'waiting';
      run.waits = [
        {
          id: 'decision-1',
          stepId: `full.${kind}.confirm`,
          status: 'pending',
          proposal: { summary: 'Actual design' },
          proposalHash: 'current-proposal',
          choices: ['approved', 'rejected'],
          results: {},
          sequence: 1,
        },
      ];
      const before = structuredClone(run);
      const continuation = classicSdkContinuation(run, root, 'demo');
      expect(continuation.mode).toBe('ask');
      expect(continuation.instruction).toContain('已有批准、委托授权');
      expect(continuation.instruction).toContain('对象、范围和条件');
      expect(continuation.instruction).toContain('不得把 Agent 自行判断写成用户确认');
      expect(continuation.instruction).toContain('用户明确要求逐阶段确认');
      if (kind === 'delivery') {
        expect(continuation.instruction).toContain('本次重检完成后');
        expect(continuation.instruction).toContain('用户明确要求审阅本次范围后确认时');
        expect(continuation.instruction).toContain('结束当前回复');
      }
      expect(classicSdkNextAction(run)).toMatchObject({
        kind: 'decision',
        proposalHash: 'current-proposal',
        instruction: continuation.instruction,
      });
      expect(run).toEqual(before);
    },
  );

  it('avoids repeating accepted task completion writes', () => {
    const build = classicSdkContinuation(
      fixture('full.build.execute', 'comet-build'),
      root,
      'demo',
    );
    expect(build.completion?.instruction).toContain('只补尚未完成');
    expect(build.completion?.instruction).toContain('不得重复 task-complete');
  });

  it('keeps fresh-check requirements visible before opting into local reuse', () => {
    const run = fixture('full.build.check');
    const before = structuredClone(run);
    const continuation = classicSdkContinuation(run, root, 'demo');
    const next = classicSdkNextAction(run);
    expect(next).toMatchObject({ instruction: continuation.instruction });
    expect(continuation.instruction).toContain('--local');
    expect(continuation.instruction).toContain('不是执行位置');
    expect(continuation.instruction).toContain('每阶段真实执行');
    expect(continuation.instruction).toContain('禁止');
    expect(continuation.commandArgs).not.toContain('--local');
    expect(run).toEqual(before);
  });

  it('requests a full delivery commit hash from the actual Git HEAD', () => {
    const delivery = classicSdkContinuation(
      fixture('full.archive.deliver', 'comet-archive'),
      root,
      'demo',
    );
    expect(delivery.completion?.requiredInputs[0]).toContain('git rev-parse HEAD');
  });

  it('uses the current terminal delivery receipt instead of an archived baseline', () => {
    const run = fixture();
    run.status = 'completed';
    run.actions = [];
    expect(classicSdkContinuation(run, root, 'demo').instruction).toContain(
      '归档 YAML 保留交付前基线',
    );
  });

  it('distinguishes manual Skill entry from an already running executor', () => {
    const run = fixture('full.build.execute', 'comet-build');
    run.state = { ...(run.state as object), autoTransition: false };
    const manual = classicSdkContinuation(run, root, 'demo');
    expect(manual).toMatchObject({
      mode: 'wait',
      waitReason: 'manual-transition',
      skill: 'comet-build',
    });
    expect(manual.instruction).toContain('已明确调用');
    run.actions[0].status = 'running';
    expect(classicSdkContinuation(run, root, 'demo')).toMatchObject({
      mode: 'wait',
      waitReason: 'executor',
    });
  });

  it.each(['full', 'hotfix', 'tweak'])(
    'restores %s stage context without changing the Action or its approval bindings',
    (profile) => {
      const run = fixture(`${profile}.build.execute`, 'comet-build');
      run.workflow.id = `comet-classic-${profile}`;
      run.state = { ...(run.state as object), workflow: profile, language: 'zh-CN' };
      const before = structuredClone(run);
      const build = classicSdkContinuation(run, root, 'demo');
      expect(build.contextRequest).toMatchObject({ phase: 'build', contextMode: 'snapshot' });
      expect(build.contextRequest?.commandArgs).toEqual([
        'comet',
        'task',
        root,
        '--task',
        '<original-task>',
        '--phase',
        'build',
        '--session',
        '<receiving-session-id>',
        '--context-mode',
        'snapshot',
        '--workflow',
        'classic',
        '--change',
        'demo',
        '--json',
      ]);
      expect(build.current.actions[0].contextRequest).toEqual(build.contextRequest);
      expect(build.contextRequest?.instruction).toContain('已确认的执行方式');
      expect(run).toEqual(before);

      run.state = { ...(run.state as object), phase: 'verify' };
      run.actions[0].stepId = `${profile}.verify.run`;
      run.actions[0].ref = 'comet-verify';
      run.actions[0].status = 'running';
      run.actions[0].claim = {
        executorId: 'reviewer',
        token: 'claim',
        sessionId: 'review-session',
      };
      const verify = classicSdkContinuation(run, root, 'demo');
      expect(verify.contextRequest?.phase).toBe('verify');
      expect(verify.current.actions[0].contextRequest?.commandArgs).toContain('review-session');
      expect(verify.current.actions[0].inputHash).toBe(before.actions[0].inputHash);
      expect(verify.mode).toBe('wait');
      run.actions[0].status = 'unknown';
      expect(classicSdkContinuation(run, root, 'demo').current.actions[0].contextRequest).toEqual(
        verify.current.actions[0].contextRequest,
      );
    },
  );

  it.each(['completed', 'cancelled'] as const)(
    'does not request stage context after %s',
    (status) => {
      const run = fixture();
      run.actions = [];
      run.status = status;
      expect(classicSdkContinuation(run, root, 'demo').contextRequest).toBeUndefined();
    },
  );

  it.each(['full', 'hotfix', 'tweak'])(
    'maps %s check tools to executable argv, never a Skill',
    (profile) => {
      const run = fixture(`${profile}.build.check`);
      const continuation = classicSdkContinuation(run, root, 'demo');
      expect(continuation).toMatchObject({
        mode: 'execute',
        cwd: root,
        stepId: `${profile}.build.check`,
        commandArgs: [
          'comet',
          'check',
          'run',
          'demo',
          'build',
          '--json',
          '--',
          '<program>',
          '<args...>',
        ],
        requiredInputs: [expect.any(String)],
        run: { id: 'demo', revision: 7 },
      });
      expect(continuation.skill).toBeUndefined();
      expect(continuation.current.actions[0]).not.toHaveProperty('input');
      expect(continuation.current.actions[0].inputHash).toBe(run.actions[0].inputHash);
      expect(classicSdkRunSummary(run, true).actions[0].input).toEqual(run.actions[0].input);
    },
  );

  it.each(['classic-archive-preflight', 'classic-archive'])(
    'maps approved %s to guarded Archive',
    (ref) => {
      const continuation = classicSdkContinuation(
        fixture('full.archive.execute', ref),
        root,
        'demo',
      );
      expect(continuation.mode).toBe('execute');
      expect(continuation.commandArgs).toEqual([
        'comet',
        'guard',
        'demo',
        'archive',
        '--apply',
        '--json',
      ]);
      expect(continuation.skill).toBeUndefined();
    },
  );

  it('distinguishes running from unknown and keeps the original claim', () => {
    const run = fixture();
    run.actions[0].status = 'running';
    run.actions[0].claim = {
      executorId: 'original-host',
      token: 'original-claim',
      sessionId: 'original-session',
    };
    const running = classicSdkContinuation(run, root, 'demo');
    expect(running).toMatchObject({
      mode: 'wait',
      commandArgs: ['comet', 'state', 'check', 'demo', 'build', '--recover', '--json'],
      requiredInputs: [],
    });
    expect(running.current.actions[0].claim).toEqual(run.actions[0].claim);
    run.actions[0].status = 'unknown';
    const unknown = classicSdkContinuation(run, root, 'demo');
    expect(unknown).toMatchObject({
      mode: 'reconcile',
      commandArgs: ['comet', 'state', 'check', 'demo', 'build', '--recover', '--json'],
    });
    expect(unknown.current.actions[0].claim).toEqual(run.actions[0].claim);
    expect(unknown.commandArgs).not.toContain('retry');
  });

  it('keeps the exact decision proposal, hash, choices and revision', () => {
    const run = fixture();
    run.actions = [];
    run.waits = [
      {
        id: 'wait-1',
        stepId: 'full.build.confirm',
        sequence: 2,
        status: 'pending',
        proposal: { buildMode: 'direct', reviewMode: 'standard' },
        proposalHash: 'approved-hash',
        choices: ['approved', 'rejected'],
        results: {},
      },
    ];
    const continuation = classicSdkContinuation(run, root, 'demo');
    expect(continuation).toMatchObject({
      mode: 'ask',
      commandArgs: [
        'comet',
        'state',
        'decide-build',
        'demo',
        '--proposal-hash',
        'approved-hash',
        '--choice',
        '<user-choice>',
        '--json',
      ],
    });
    expect(continuation.current.waits[0]).toMatchObject({
      proposal: run.waits[0].proposal,
      proposalHash: 'approved-hash',
      choices: run.waits[0].choices,
      request: {
        operation: 'resolve-wait',
        runId: 'demo',
        expectedRevision: 7,
        waitId: 'wait-1',
        proposalHash: 'approved-hash',
      },
    });
  });

  it('keeps all active parallel identities but omits completed history', () => {
    const run = fixture();
    const second = { ...run.actions[0], id: 'action-2', stepId: 'full.verify.check' };
    run.actions.push(second, { ...run.actions[0], id: 'old', status: 'succeeded' });
    expect(classicSdkRunSummary(run).actions.map((action) => action.id)).toEqual([
      'action-1',
      'action-2',
    ]);
    expect(classicSdkContinuation(run, root, 'demo').current.actions).toHaveLength(2);
    expect(classicSdkRunSummary(run, true).actions).toHaveLength(3);
  });

  it.each(['hotfix', 'tweak'])(
    'routes historical %s Skill without changing the fixed Run',
    (profile) => {
      const run = fixture(`${profile}.build.execute`, 'comet-build');
      run.workflow.id = `comet-classic-${profile}`;
      run.state = { ...(run.state as object), workflow: profile };
      const original = structuredClone(run);
      expect(classicSdkContinuation(run, root, 'demo')).toMatchObject({
        mode: 'execute',
        skill: `comet-${profile}`,
      });
      expect(run).toEqual(original);
    },
  );

  it.each(['completed', 'cancelled', 'failed'] as const)(
    'does not dispatch terminal %s work',
    (status) => {
      const run = fixture();
      run.status = status;
      if (status === 'cancelled') {
        run.actions = run.actions.map((action) => ({
          ...action,
          status: 'cancelled',
          reason: 'User cancelled',
        }));
        run.ready = [];
      }
      const result = classicSdkContinuation(run, root, 'demo');
      expect(result.mode).toBe(status === 'failed' ? 'reconcile' : 'done');
      expect(result.commandArgs).toBeNull();
    },
  );

  it('separates real Skill work from its completion command', () => {
    const run = fixture('full.build.execute', 'comet-build');
    const result = classicSdkContinuation(run, root, 'demo');
    expect(result).toMatchObject({ mode: 'execute', skill: 'comet-build', commandArgs: null });
    expect(result.completion).toMatchObject({
      commandArgs: ['comet', 'state', 'complete-build', 'demo', '--json'],
      requiredInputs: [expect.any(String)],
    });
    expect(result.completion?.instruction).toContain('真实工作完成');
  });

  it('uses the exact Open preview hash only behind an explicit user decision', () => {
    const run = fixture('full.open', 'comet-open');
    run.state = { ...(run.state as object), phase: 'open' };
    const initial = classicSdkContinuation(run, root, 'demo');
    expect(initial.completion?.commandArgs).toEqual(['comet', 'guard', 'demo', 'open', '--json']);
    const preview = classicSdkContinuation(run, root, 'demo', { openApprovalHash: 'preview-hash' });
    expect(preview).toMatchObject({
      mode: 'ask',
      commandArgs: [
        'comet',
        'guard',
        'demo',
        'open',
        '--apply',
        '--approval-hash',
        'preview-hash',
        '--json',
      ],
    });
    expect(preview.requiredInputs).toEqual([expect.stringContaining('明确批准')]);
    expect(preview.instruction).toContain('已有批准或明确委托授权');
    expect(preview.instruction).toContain('需要新决定时');
  });

  it('keeps current Skill scope, activation, approved delivery and manual completion without cumulative receipts', () => {
    const run = fixture('full.archive.deliver', 'comet-archive');
    const scope = {
      change: 'demo',
      changeDir: 'openspec/changes/demo',
      goal: 'Keep real customer wording',
      constraints: ['No remote publication'],
    };
    const target = { deliveryAction: 'local', targetBranch: 'main', baseCommit: 'approved-base' };
    run.actions[0].input = {
      input: scope,
      activation: { reason: 'Continue approved delivery' },
      outputs: {
        'full.archive.preflight': target,
        'full.archive.execute': { archiveDirectory: 'openspec/changes/archive/2026-10-07-demo' },
        'full.build.check': { exitCode: 0, receiptRef: 'old-build', history: 'x'.repeat(8000) },
        'full.verify.check': { exitCode: 0, receiptRef: 'old-verify', history: 'y'.repeat(8000) },
      },
    };
    const original = structuredClone(run);
    const projected = classicSdkContinuation(run, root, 'demo');
    expect(projected.current.actions[0]).toMatchObject({
      inputHash: run.actions[0].inputHash,
      inputSummary: {
        scope,
        activation: { reason: 'Continue approved delivery' },
        configurationRef: 'data.configuration',
        artifactRefsRef: 'data.artifactRefs',
        taskStateRef: 'data.taskState',
        approvalsRef: 'data.continuation.current.approvals',
        outputs: {
          'full.archive.preflight': target,
          'full.archive.execute': { archiveDirectory: 'openspec/changes/archive/2026-10-07-demo' },
        },
      },
    });
    expect(projected.current.actions[0]).not.toHaveProperty('input');
    expect(projected.completion?.commandArgs).toEqual([
      'comet',
      'state',
      'complete-delivery',
      'demo',
      '--commit',
      '<commit-sha>',
      '--json',
    ]);
    expect(JSON.stringify(projected)).not.toContain('old-build');
    expect(JSON.stringify(projected)).not.toContain('old-verify');
    expect(classicSdkRunSummary(run, true).actions[0].input).toEqual(original.actions[0].input);
    expect(run).toEqual(original);
  });

  it('preserves the current failed check for Build repair while dropping successful receipts', () => {
    const run = fixture('full.build.execute', 'comet-build');
    const failed = createRuntimeAction({
      id: 'failed-check',
      runId: run.runId,
      stepId: 'full.build.check',
      type: 'call_tool',
      ref: 'classic-check',
      input: {},
    });
    failed.status = 'failed';
    failed.outcome = {
      actionId: failed.id,
      attempt: 1,
      inputHash: failed.inputHash,
      claimToken: 'claim',
      outcomeId: 'outcome',
      status: 'failed',
      output: {
        scope: 'build',
        argv: ['node', 'real-check.cjs'],
        cwd: '.',
        exitCode: 9,
        receiptRef: 'real-failure.log',
        contentHash: 'receipt-hash',
      },
    };
    run.actions.unshift(failed);
    run.actionContexts[failed.id] = { sequence: 5, results: {} };
    run.actionContexts['action-1'] = {
      sequence: 6,
      results: { 'full.build.check': { sequence: 5, value: failed.outcome.output } },
    };
    run.actions[1].input = {
      input: run.input,
      outputs: {
        'full.build.check': failed.outcome.output,
        'full.open.evidence': { ref: 'old-evidence' },
      },
    };
    const result = classicSdkContinuation(run, root, 'demo');
    expect(result.current.actions[0]).toMatchObject({
      inputSummary: { scope: run.input, outputs: { 'full.build.check': failed.outcome.output } },
    });
    expect(JSON.stringify(result)).not.toContain('old-evidence');
  });

  it('preserves unrecognized host input and custom Skill contracts verbatim', () => {
    const run = fixture('full.build.execute', 'custom-worker');
    run.actions[0].type = 'invoke_skill';
    expect(classicSdkContinuation(run, root, 'demo').current.actions[0]).toMatchObject({
      input: run.actions[0].input,
    });
    run.actions[0].ref = 'comet-build';
    expect(classicSdkContinuation(run, root, 'demo').current.actions[0]).toMatchObject({
      input: run.actions[0].input,
    });
  });

  it('respects manual Skill continuation', () => {
    const run = fixture('full.design.handoff', 'comet-design');
    run.state = { ...(run.state as object), autoTransition: false };
    expect(classicSdkContinuation(run, root, 'demo')).toMatchObject({
      mode: 'wait',
      automatic: false,
      skill: 'comet-design',
      commandArgs: null,
    });
  });
});
