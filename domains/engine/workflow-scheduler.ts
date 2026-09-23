import { createRuntimeAction } from './runtime-action.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { hashRuntimeValue, type RuntimeValue } from './runtime-json.js';
import type { WorkflowDefinition } from './workflow-definition.js';
import type { WorkflowResult, WorkflowRun, WorkflowToken } from './workflow-run.js';

function put<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

export function workflowOutputs(
  results: Record<string, WorkflowResult>,
): Record<string, RuntimeValue> {
  return Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.value]));
}

function mergeResults(tokens: WorkflowToken[]): Record<string, WorkflowResult> {
  const results: Record<string, WorkflowResult> = {};
  for (const token of tokens) {
    for (const [key, result] of Object.entries(token.results)) {
      if (!Object.hasOwn(results, key) || result.sequence > results[key].sequence)
        put(results, key, result);
    }
  }
  return results;
}

/** 只消费已经提交在 Run 中的 token；并行 join 按各父节点 FIFO 配对。 */
export function scheduleWorkflow(run: WorkflowRun, definition: WorkflowDefinition): void {
  if (run.status === 'cancelled' || run.status === 'failed') return;
  while (run.ready.length > 0) {
    const incoming = run.ready.shift()!;
    const step = definition.steps[incoming.to];
    let results = incoming.results;
    if (step.join?.length) {
      if (incoming.from === null || !step.join.includes(incoming.from)) {
        throw new RuntimeProtocolError('INVALID_JOIN', 'join 必须由其声明的父节点触发');
      }
      if (!Object.hasOwn(run.joins, incoming.to)) {
        put(run.joins, incoming.to, Object.fromEntries(step.join.map((parent) => [parent, []])));
      }
      const queues = run.joins[incoming.to];
      queues[incoming.from].push(incoming);
      if (step.join.some((parent) => queues[parent].length === 0)) continue;
      results = mergeResults(step.join.map((parent) => queues[parent].shift()!));
    }
    if (run.sequence >= definition.maxTransitions) {
      run.ready.unshift(incoming);
      run.status = 'failed';
      run.reason = 'TRANSITION_LIMIT: 工作流已达到允许的步骤激活次数';
      return;
    }
    const sequence = ++run.sequence;
    const id = `${run.runId}:${sequence}`;
    const input = {
      input: step.input === undefined ? run.input : step.input,
      outputs: workflowOutputs(results),
    };
    if (step.type === 'ask_user') {
      const outputs = Object.fromEntries(
        step.proposalFrom.map((source) => {
          if (!Object.hasOwn(results, source)) {
            throw new RuntimeProtocolError(
              'PROPOSAL_INPUT_MISSING',
              `确认步骤缺少上游产物：${source}`,
            );
          }
          return [source, results[source].value];
        }),
      );
      const proposal = { input: input.input, outputs };
      run.waits.push({
        id,
        stepId: incoming.to,
        sequence,
        status: 'pending',
        proposal,
        proposalHash: hashRuntimeValue(proposal),
        choices: [...step.choices],
        results,
      });
    } else {
      const ref =
        step.type === 'child_workflow' ? `${step.workflow.id}@${step.workflow.version}` : step.ref;
      const action = createRuntimeAction({
        id,
        runId: run.runId,
        stepId: incoming.to,
        type: step.type,
        ref,
        input,
        retry: step.retry,
        requiredCapabilities: step.requiredCapabilities,
      });
      run.actions.push(action);
      put(run.actionContexts, id, { sequence, results });
      if (step.type === 'child_workflow') {
        run.children.push({
          actionId: id,
          runId: `child-${hashRuntimeValue(id)}`,
          workflow: step.workflow,
        });
      }
    }
  }
  const active = run.actions.some((action) =>
    ['pending', 'running', 'unknown'].includes(action.status),
  );
  const waiting = run.waits.some((wait) => wait.status === 'pending');
  const incompleteJoin = Object.values(run.joins).some((queues) =>
    Object.values(queues).some((queue) => queue.length > 0),
  );
  run.status = active ? 'running' : waiting || incompleteJoin ? 'waiting' : 'completed';
}

export function advanceWorkflow(
  run: WorkflowRun,
  definition: WorkflowDefinition,
  stepId: string,
  sequence: number,
  previous: Record<string, WorkflowResult>,
  output: RuntimeValue,
  event: string,
): void {
  const result = { sequence, value: output };
  const results = { ...previous };
  put(results, stepId, result);
  if (!Object.hasOwn(run.outputs, stepId) || run.outputs[stepId].sequence <= sequence) {
    put(run.outputs, stepId, result);
  }
  const outgoing = definition.transitions.filter((edge) => edge.from === stepId);
  const selected = outgoing.filter((edge) => edge.on === event);
  if (selected.length === 0 && event === 'failed') {
    run.status = 'failed';
    run.reason = `ACTION_FAILED: ${stepId}`;
    return;
  }
  if (selected.length === 0 && outgoing.length > 0) {
    throw new RuntimeProtocolError(
      'TRANSITION_UNAVAILABLE',
      `步骤 ${stepId} 未声明 ${event} 的后续转换`,
    );
  }
  for (const edge of selected) run.ready.push({ from: stepId, to: edge.to, results });
}
