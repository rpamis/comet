import { describe, expect, it } from 'vitest';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import { createRuntimeAction } from '../../../domains/engine/runtime-action.js';
import { parseClassicStateDocument } from '../../../domains/comet-classic/classic-state.js';
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
    expect(running).toMatchObject({ mode: 'wait', commandArgs: null, requiredInputs: [] });
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
