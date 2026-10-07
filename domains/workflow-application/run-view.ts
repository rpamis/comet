import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
import type { LoadedWorkflowApplication } from './types.js';

function waitView(wait: WorkflowRun['waits'][number]) {
  return {
    id: wait.id,
    stepId: wait.stepId,
    sequence: wait.sequence,
    status: wait.status,
    proposal: wait.proposal,
    proposalHash: wait.proposalHash,
    choices: wait.choices,
    ...(wait.decision === undefined ? {} : { decision: wait.decision }),
  };
}

/** 从已验证的同一 Run 投影当前工作；不读取、领取或推进任何任务。 */
export function projectWorkflowApplicationRun(
  application: LoadedWorkflowApplication,
  run: WorkflowRun,
) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
  const activeActions = run.actions.filter((action) =>
    ['pending', 'running', 'unknown'].includes(action.status),
  );
  const failedActions =
    run.status === 'failed'
      ? run.actions.filter((action) => action.status === 'failed').slice(-1)
      : [];
  const currentActions = [...activeActions, ...failedActions];
  const waits = run.waits.filter((wait) => wait.status === 'pending');
  const evidenceWaits = (run.evidenceWaits ?? []).filter((wait) => wait.status === 'pending');
  const children = run.children.filter((child) =>
    activeActions.some((action) => action.id === child.actionId),
  );
  const commandArgs = [
    'comet',
    'runtime',
    'dispatch',
    '--application',
    application.identity.id,
    '--project-root',
    application.identity.projectRoot,
    '--request',
    '<request-json-file>',
  ];
  const inspectRequest = { operation: 'inspect' as const, runId: run.runId };
  const definition = application.implementation.workflows.find(
    (workflow) => workflow.id === run.workflow.id && workflow.version === run.workflow.version,
  );
  const command = { runId: run.runId, expectedRevision: run.revision };
  const nextRequest = { operation: 'next' as const, ...command };

  function actionRequests(action: RuntimeAction) {
    if (action.type === 'child_workflow') {
      return {
        instruction:
          action.status === 'unknown'
            ? '保留原子 Run 和领取记录，核对子流程结果；不能另建子 Run 或重派 Action。'
            : '使用父 Run 的 next 启动或接收原子 Run；到子 Run 的 inspect 查看待执行工作。',
      };
    }
    if (action.status === 'pending' && !terminal) {
      const executors = (application.implementation.executors ?? []).filter((executor) => {
        if (
          !action.requiredCapabilities.every((capability) =>
            executor.capabilities.includes(capability),
          )
        )
          return false;
        try {
          return executor.supports(structuredClone(action));
        } catch {
          return false;
        }
      });
      return {
        instruction:
          '仅由具备所列能力的宿主执行；execute 和手工 claim 二选一，仍须通过应用的授权与领取检查。',
        executeRequests: executors.map((executor) => ({
          operation: 'execute' as const,
          ...command,
          actionId: action.id,
          executorId: executor.id,
        })),
        claimRequest: {
          operation: 'claim' as const,
          ...command,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: executors.length === 1 ? executors[0].id : '<executor-id>',
          sessionId: '<session-id>',
          capabilities: action.requiredCapabilities,
        },
      };
    }
    const currentRejection = action.rejectedOutcomes?.some(
      (rejection) => rejection.outcome.attempt === action.attempt,
    );
    if (['running', 'unknown'].includes(action.status) && action.claim) {
      return {
        instruction:
          action.status === 'running'
            ? '等待原宿主，不重新派发。只有确认执行结果无法取得时才标记 unknown；有真实结果时提交原领取的 outcome。'
            : currentRejection
              ? '当前尝试已有被拒结果；核对并修正原尝试的结果，不能声明未执行或重派。'
              : '核对原宿主与实际产物：已执行则提交原领取的真实 outcome；仅证明确未执行后填写核对证据并 retry。断连不能作为未执行证据。',
        outcomeRequest: {
          operation: 'record-outcome' as const,
          ...command,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim.token,
            outcomeId: '<outcome-id>',
            status: '<succeeded|failed>',
            output: '<actual-action-output>',
          },
        },
        ...(action.status === 'running'
          ? {
              markUnknownRequest: {
                operation: 'mark-unknown' as const,
                ...command,
                actionId: action.id,
                attempt: action.attempt,
                reason: '<why-the-original-outcome-cannot-be-obtained>',
              },
            }
          : currentRejection
            ? {}
            : {
                retryRequest: {
                  operation: 'retry' as const,
                  ...command,
                  actionId: action.id,
                  attempt: action.attempt,
                  reconciliation: { resolution: 'not-executed' as const, evidence: null },
                },
                requiredInputs: ['reconciliation.evidence: 核对原宿主后取得的确未执行证据'],
              }),
      };
    }
    return { instruction: '读取完整 Run 的失败原因和证据，按应用声明的恢复流程处理。' };
  }

  const approvalSequences = new Set(
    currentActions.flatMap((action) => {
      const results = run.actionContexts[action.id]?.results ?? {};
      return Object.values(results).map((result) => result.sequence);
    }),
  );
  const approvals = run.waits.filter(
    (wait) => wait.status === 'resolved' && approvalSequences.has(wait.sequence),
  );
  const joins = Object.fromEntries(
    Object.entries(run.joins)
      .map(
        ([stepId, queues]) =>
          [
            stepId,
            Object.fromEntries(
              Object.entries(queues).map(([parent, queue]) => [parent, queue.length]),
            ),
          ] as const,
      )
      .filter(([, queues]) => Object.values(queues).some((count) => count > 0)),
  );
  return {
    schema: 'comet.application.run-view.v1' as const,
    applicationId: application.identity.id,
    projectRoot: application.identity.projectRoot,
    runId: run.runId,
    revision: run.revision,
    workflow: run.workflow,
    definitionHashes: run.definitionHashes,
    status: run.status,
    sequence: run.sequence,
    ...(run.reason === undefined ? {} : { reason: run.reason }),
    current: {
      actions: currentActions.map((action) => ({
        ...action,
        ...(definition?.steps[action.stepId]?.outputSchema === undefined
          ? {}
          : { outputSchema: definition.steps[action.stepId].outputSchema }),
        ...(definition?.steps[action.stepId]?.validator === undefined
          ? {}
          : { validator: definition.steps[action.stepId].validator }),
        ...actionRequests(action),
      })),
      waits: waits.map((wait) => ({
        ...waitView(wait),
        resolveRequest: {
          operation: 'resolve-wait' as const,
          ...command,
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          decisionId: '<decision-id>',
          choice: '<user-choice>',
        },
        reviseRequest: {
          operation: 'revise-wait' as const,
          ...command,
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          proposal: '<actual-revised-proposal>',
        },
        instruction: '展示当前完整提案与 choices；取得用户对当前 proposalHash 的决定后再填写请求。',
      })),
      evidenceWaits: evidenceWaits.map(({ results: _results, ...wait }) => ({
        ...wait,
        recordRequest: {
          operation: 'record-evidence' as const,
          ...command,
          evidenceId: wait.id,
          kind: wait.kind,
          ref: '<actual-evidence-ref>',
          contentHash: '<actual-evidence-sha256>',
          submissionId: '<submission-id>',
        },
      })),
      approvals: approvals.map(waitView),
      children: children.map((child) => ({
        ...child,
        inspection: { operation: 'inspect' as const, runId: child.runId },
      })),
      joins,
    },
    ...(terminal
      ? {
          outputs: run.outputs,
        }
      : {}),
    history: {
      actions: run.actions.length,
      waits: run.waits.length,
      evidenceWaits: run.evidenceWaits?.length ?? 0,
      children: run.children.length,
      outputs: Object.keys(run.outputs).length,
    },
    continuation: {
      commandArgs,
      instruction:
        '模板中的占位值必须替换为真实输入；每次提交后使用新响应中的 revision 和当前身份。',
      ...(run.status !== 'cancelled' &&
      run.status !== 'failed' &&
      !children.some(
        (child) =>
          activeActions.find((action) => action.id === child.actionId)?.status === 'unknown',
      ) &&
      (children.length > 0 || run.ready.length > 0)
        ? { nextRequest }
        : {}),
    },
    inspection: { commandArgs: [...commandArgs, '--details'], request: inspectRequest },
  };
}
