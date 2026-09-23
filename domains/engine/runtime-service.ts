import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import {
  cancelRuntimeAction,
  claimRuntimeAction,
  markRuntimeActionUnknown,
  recordRuntimeOutcome,
  retryRuntimeAction,
  type RuntimeAction,
  type RuntimeOutcome,
} from './runtime-action.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { cloneRuntimeValue, hashRuntimeValue } from './runtime-json.js';
import type { RuntimeStore } from './runtime-store.js';
import { parseWorkflowRun } from './workflow-run-validation.js';
import {
  defineWorkflow,
  type DefineWorkflowOptions,
  type WorkflowDefinition,
} from './workflow-definition.js';
import type {
  RuntimeExecutor,
  RuntimeInvocationContext,
  RuntimeValidator,
  WorkflowRef,
  WorkflowRun,
} from './workflow-run.js';
import { advanceWorkflow, scheduleWorkflow, workflowOutputs } from './workflow-scheduler.js';

export interface CreateRuntimeOptions {
  store: RuntimeStore<WorkflowRun>;
  workflows: readonly DefineWorkflowOptions[];
  validators?: readonly RuntimeValidator[];
  executors?: readonly RuntimeExecutor[];
}

interface RunCommand {
  runId: string;
  expectedRevision?: number;
  context?: RuntimeInvocationContext;
}

export interface StartRuntimeRun {
  runId?: string;
  workflow: WorkflowRef;
  input: unknown;
  context?: RuntimeInvocationContext;
}

export interface ClaimRuntimeRunAction extends RunCommand {
  actionId: string;
  attempt: number;
  inputHash: string;
  executorId: string;
  sessionId?: string;
  claimToken?: string;
  capabilities?: readonly string[];
}

export interface ResolveRuntimeWait extends RunCommand {
  waitId: string;
  proposalHash: string;
  decisionId: string;
  choice: string;
}

function referenceKey(reference: WorkflowRef): string {
  return JSON.stringify([reference.id, reference.version]);
}

function checkContext(context?: RuntimeInvocationContext): void {
  if (context?.signal?.aborted)
    throw new RuntimeProtocolError(
      'REQUEST_ABORTED',
      '请求已取消，请查询已提交状态后再决定是否重试',
    );
}

/** 核心只持久化事实与决定；外部执行在 Action 提交后由宿主完成。 */
export function createRuntime(options: CreateRuntimeOptions) {
  const definitions = new Map<string, WorkflowDefinition>();
  for (const raw of options.workflows) {
    const definition = defineWorkflow(raw);
    const key = referenceKey(definition);
    if (definitions.has(key))
      throw new RuntimeProtocolError('DUPLICATE_WORKFLOW', '不能重复注册同一工作流版本');
    definitions.set(key, definition);
  }
  const validators = new Map<string, RuntimeValidator>();
  for (const validator of options.validators ?? []) {
    const key = referenceKey(validator);
    if (validators.has(key))
      throw new RuntimeProtocolError('DUPLICATE_VALIDATOR', '不能重复注册同一验证器版本');
    validators.set(key, validator);
  }
  const ajv = new Ajv({ strict: true, allErrors: true });
  const executors = new Map<string, RuntimeExecutor>();
  for (const executor of options.executors ?? []) {
    if (executors.has(executor.id))
      throw new RuntimeProtocolError('DUPLICATE_EXECUTOR', '不能重复注册同一执行器');
    executors.set(executor.id, executor);
  }

  function definitionFor(reference: WorkflowRef & { hash?: string }): WorkflowDefinition {
    const definition = definitions.get(referenceKey(reference));
    if (!definition)
      throw new RuntimeProtocolError('WORKFLOW_UNAVAILABLE', '请提供当前 Run 固定的工作流定义版本');
    if (reference.hash !== undefined && reference.hash !== hashRuntimeValue(definition)) {
      throw new RuntimeProtocolError(
        'WORKFLOW_CHANGED',
        '同一版本的工作流内容已改变；请恢复原定义或显式迁移',
      );
    }
    return definition;
  }

  async function inspect(runId: string): Promise<WorkflowRun> {
    const persisted = await options.store.read(runId);
    if (!persisted) throw new RuntimeProtocolError('RUN_NOT_FOUND', `找不到工作流实例：${runId}`);
    const run = parseWorkflowRun(persisted, runId);
    if (definitions.size > 0) {
      for (const [key, hash] of Object.entries(run.definitionHashes)) {
        const [id, version] = JSON.parse(key) as [string, string];
        definitionFor({ id, version, hash });
      }
    }
    return run;
  }

  async function mutate(
    command: RunCommand,
    apply: (run: WorkflowRun, definition: WorkflowDefinition) => void | Promise<void>,
  ): Promise<WorkflowRun> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      checkContext(command.context);
      const before = await inspect(command.runId);
      const definition = definitionFor(before.workflow);
      if (command.expectedRevision !== undefined && command.expectedRevision !== before.revision) {
        throw new RuntimeProtocolError('REVISION_CONFLICT', 'Run 已变化，请重新读取当前状态');
      }
      const next = structuredClone(before);
      await apply(next, definition);
      if (hashRuntimeValue(next) === hashRuntimeValue(before)) return before;
      next.revision = before.revision + 1;
      checkContext(command.context);
      if (await options.store.compareAndSwap(command.runId, before.revision, next))
        return structuredClone(next);
    }
    throw new RuntimeProtocolError('REVISION_CONFLICT', '并发提交持续冲突，请重新读取当前状态');
  }

  function requiredAction(run: WorkflowRun, actionId: string): RuntimeAction {
    const action = run.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new RuntimeProtocolError('ACTION_NOT_FOUND', 'Run 不包含此 Action');
    return action;
  }

  function ensureActive(run: WorkflowRun): void {
    if (run.status === 'cancelled')
      throw new RuntimeProtocolError('RUN_CANCELLED', 'Run 已取消，不能继续推进');
  }

  function pinnedDefinitions(
    definition: WorkflowDefinition,
    hashes: Record<string, string> = {},
  ): Record<string, string> {
    const key = referenceKey(definition);
    if (Object.hasOwn(hashes, key)) return hashes;
    hashes[key] = hashRuntimeValue(definition);
    for (const step of Object.values(definition.steps)) {
      if (step.type === 'child_workflow') pinnedDefinitions(definitionFor(step.workflow), hashes);
    }
    return hashes;
  }

  async function startInternal(input: StartRuntimeRun, lineage: string[]): Promise<WorkflowRun> {
    checkContext(input.context);
    if (lineage.length > 32)
      throw new RuntimeProtocolError('CHILD_DEPTH_LIMIT', '子工作流嵌套超过 32 层');
    const definition = definitionFor(input.workflow);
    const runId = input.runId ?? randomUUID();
    const value = cloneRuntimeValue(input.input);
    const workflow = {
      id: definition.id,
      version: definition.version,
      hash: hashRuntimeValue(definition),
    };
    const previous = await options.store.read(runId);
    if (previous) {
      if (
        hashRuntimeValue(previous.workflow) !== hashRuntimeValue(workflow) ||
        hashRuntimeValue(previous.input) !== hashRuntimeValue(value) ||
        hashRuntimeValue(previous.lineage) !== hashRuntimeValue(lineage)
      ) {
        throw new RuntimeProtocolError('RUN_CONFLICT', '该 Run 标识已绑定不同工作流或输入');
      }
      return inspect(runId);
    }
    const run: WorkflowRun = {
      protocolVersion: 1,
      schemaVersion: 1,
      runId,
      revision: 1,
      workflow,
      definitionHashes: pinnedDefinitions(definition),
      input: value,
      status: 'running',
      sequence: 0,
      actions: [],
      actionContexts: {},
      waits: [],
      ready: definition.entry.map((to) => ({ from: null, to, results: {} })),
      joins: {},
      outputs: {},
      children: [],
      lineage,
    };
    scheduleWorkflow(run, definition);
    checkContext(input.context);
    if (!(await options.store.compareAndSwap(runId, null, run)))
      return startInternal({ ...input, runId }, lineage);
    return structuredClone(run);
  }

  async function start(input: StartRuntimeRun): Promise<WorkflowRun> {
    return startInternal(input, []);
  }

  async function cancelChildren(run: WorkflowRun): Promise<void> {
    for (const child of run.children) {
      if (await options.store.read(child.runId)) {
        await cancel({ runId: child.runId, reason: run.reason ?? '父工作流已取消' });
      }
    }
  }

  async function next(command: RunCommand): Promise<WorkflowRun> {
    let run = await mutate(command, (current, definition) => scheduleWorkflow(current, definition));
    if (run.status === 'cancelled') {
      await cancelChildren(run);
      return run;
    }
    if (run.status === 'failed') return run;
    for (const child of run.children) {
      let action = requiredAction(run, child.actionId);
      if (!['pending', 'running'].includes(action.status)) continue;
      if (action.status === 'pending') {
        run = await claimInternal(
          {
            runId: run.runId,
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            executorId: 'comet-child-workflow',
            claimToken: child.runId,
            capabilities: ['child-workflow'],
            context: command.context,
          },
          true,
        );
        action = requiredAction(run, child.actionId);
      }
      await startInternal(
        {
          runId: child.runId,
          workflow: child.workflow,
          input: action.input,
          context: command.context,
        },
        [...run.lineage, run.runId],
      );
      const currentParent = await inspect(run.runId);
      if (currentParent.status === 'cancelled') {
        await cancelChildren(currentParent);
        return currentParent;
      }
      const childRun = await next({ runId: child.runId, context: command.context });
      if (['completed', 'failed', 'cancelled'].includes(childRun.status)) {
        run = await recordOutcomeInternal(
          {
            runId: run.runId,
            context: command.context,
            outcome: {
              actionId: action.id,
              attempt: action.attempt,
              inputHash: action.inputHash,
              claimToken: action.claim!.token,
              outcomeId: `${child.runId}:${childRun.revision}`,
              status: childRun.status === 'completed' ? 'succeeded' : 'failed',
              output: workflowOutputs(childRun.outputs),
            },
          },
          true,
        );
      }
    }
    return inspect(run.runId);
  }

  async function claimInternal(
    command: ClaimRuntimeRunAction,
    allowChild = false,
  ): Promise<WorkflowRun> {
    const token =
      command.claimToken ??
      (command.context?.requestId
        ? hashRuntimeValue({
            runId: command.runId,
            actionId: command.actionId,
            attempt: command.attempt,
            executorId: command.executorId,
            requestId: command.context.requestId,
          })
        : randomUUID());
    return mutate(command, (run) => {
      ensureActive(run);
      if (run.status === 'failed')
        throw new RuntimeProtocolError('RUN_FAILED', 'Run 已因失败停止；请先完成显式恢复');
      const action = requiredAction(run, command.actionId);
      if (action.type === 'child_workflow' && !allowChild)
        throw new RuntimeProtocolError(
          'CHILD_MANAGED',
          '子工作流由 Runtime 登记与核对，不接受宿主代领',
        );
      const available = new Set(command.capabilities ?? []);
      if (action.requiredCapabilities.some((capability) => !available.has(capability))) {
        throw new RuntimeProtocolError(
          'CAPABILITY_REQUIRED',
          '执行者未声明 Action 要求的全部宿主能力',
        );
      }
      const claimed = claimRuntimeAction(action, {
        attempt: command.attempt,
        inputHash: command.inputHash,
        executorId: command.executorId,
        token,
        ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
      });
      run.actions[run.actions.indexOf(action)] = claimed;
    });
  }

  async function claim(command: ClaimRuntimeRunAction): Promise<WorkflowRun> {
    return claimInternal(command);
  }

  async function recordOutcomeInternal(
    command: RunCommand & { outcome: RuntimeOutcome },
    allowChild = false,
  ): Promise<WorkflowRun> {
    let rejection:
      | { code: 'OUTPUT_INVALID' | 'OUTCOME_REJECTED' | 'OUTCOME_PROCESSING_ERROR'; reason: string }
      | undefined;
    const result = await mutate(command, async (run, definition) => {
      rejection = undefined;
      ensureActive(run);
      const action = requiredAction(run, command.outcome.actionId);
      if (action.type === 'child_workflow' && !allowChild)
        throw new RuntimeProtocolError(
          'CHILD_MANAGED',
          '子工作流结果必须由 Runtime 读取其已提交状态',
        );
      const accepted = recordRuntimeOutcome(action, command.outcome);
      if (accepted.duplicate) return;
      const actionIndex = run.actions.indexOf(action);
      try {
        const step = definition.steps[action.stepId];
        if (command.outcome.status === 'succeeded' && step.outputSchema !== undefined) {
          const validate = ajv.compile(step.outputSchema as boolean | object);
          if (!validate(command.outcome.output)) {
            rejection = { code: 'OUTPUT_INVALID', reason: ajv.errorsText(validate.errors) };
          }
        }
        if (!rejection && step.validator) {
          const validator = validators.get(referenceKey(step.validator));
          if (!validator)
            throw new RuntimeProtocolError(
              'VALIDATOR_UNAVAILABLE',
              '未注册工作流所要求的验证器版本',
            );
          const result = await validator.validate({
            action: structuredClone(action),
            outcome: structuredClone(command.outcome),
            context: command.context,
          });
          if (!result.accepted) {
            rejection = {
              code: 'OUTCOME_REJECTED',
              reason: result.reason?.trim() ? result.reason : '结果未满足业务验收条件',
            };
          }
        }
        if (!rejection) {
          const advanced = structuredClone(run);
          advanced.actions[actionIndex] = accepted.action;
          const context = advanced.actionContexts[action.id];
          advanceWorkflow(
            advanced,
            definition,
            action.stepId,
            context.sequence,
            context.results,
            command.outcome.output,
            command.outcome.status === 'failed' ? 'failed' : (command.outcome.event ?? 'succeeded'),
          );
          scheduleWorkflow(advanced, definition);
          Object.assign(run, advanced);
        }
      } catch (error) {
        rejection = {
          code: 'OUTCOME_PROCESSING_ERROR',
          reason:
            error instanceof Error && error.message.trim()
              ? error.message
              : '结果处理失败，请检查验证器或工作流定义',
        };
      }
      if (rejection) {
        run.actions[actionIndex] = {
          ...action,
          receipts: accepted.action.receipts,
          rejectedOutcomes: [
            ...(action.rejectedOutcomes ?? []),
            { outcome: accepted.action.outcome!, ...rejection },
          ],
        };
      }
    });
    if (rejection) throw new RuntimeProtocolError(rejection.code, rejection.reason);
    return result;
  }

  async function recordOutcome(
    command: RunCommand & { outcome: RuntimeOutcome },
  ): Promise<WorkflowRun> {
    return recordOutcomeInternal(command);
  }

  async function resolveWait(command: ResolveRuntimeWait): Promise<WorkflowRun> {
    return mutate(command, (run, definition) => {
      ensureActive(run);
      const wait = run.waits.find((candidate) => candidate.id === command.waitId);
      if (!wait) throw new RuntimeProtocolError('WAIT_NOT_FOUND', 'Run 不包含此等待项');
      if (wait.decision) {
        if (
          wait.decision.id !== command.decisionId ||
          wait.decision.choice !== command.choice ||
          wait.decision.proposalHash !== command.proposalHash
        ) {
          throw new RuntimeProtocolError('DECISION_CONFLICT', '等待项已经接受了不同的决定');
        }
        return;
      }
      if (wait.status !== 'pending' || wait.proposalHash !== command.proposalHash) {
        throw new RuntimeProtocolError('STALE_PROPOSAL', '提案已改变或等待项已终止，请重新审阅');
      }
      if (!command.decisionId.trim() || !wait.choices.includes(command.choice)) {
        throw new RuntimeProtocolError('INVALID_DECISION', '决定标识或选择不符合当前等待项');
      }
      wait.status = 'resolved';
      wait.decision = {
        id: command.decisionId,
        choice: command.choice,
        proposalHash: command.proposalHash,
      };
      advanceWorkflow(
        run,
        definition,
        wait.stepId,
        wait.sequence,
        wait.results,
        { choice: command.choice, proposal: wait.proposal },
        command.choice,
      );
      scheduleWorkflow(run, definition);
    });
  }

  async function reviseWait(
    command: RunCommand & { waitId: string; proposalHash: string; proposal: unknown },
  ): Promise<WorkflowRun> {
    return mutate(command, (run) => {
      ensureActive(run);
      const wait = run.waits.find((candidate) => candidate.id === command.waitId);
      if (!wait || wait.status !== 'pending' || wait.proposalHash !== command.proposalHash) {
        throw new RuntimeProtocolError('STALE_PROPOSAL', '只能修改当前仍在等待决定的提案');
      }
      wait.proposal = cloneRuntimeValue(command.proposal);
      wait.proposalHash = hashRuntimeValue(wait.proposal);
    });
  }

  async function cancel(command: RunCommand & { reason: string }): Promise<WorkflowRun> {
    const cancelled = await mutate(command, (run) => {
      if (run.status === 'cancelled' || run.status === 'completed') return;
      run.actions = run.actions.map((action) => cancelRuntimeAction(action, command.reason));
      for (const wait of run.waits) if (wait.status === 'pending') wait.status = 'cancelled';
      run.ready = [];
      run.status = 'cancelled';
      run.reason = command.reason;
    });
    if (cancelled.status === 'cancelled') await cancelChildren(cancelled);
    return cancelled;
  }

  async function markUnknown(
    command: RunCommand & { actionId: string; attempt: number; reason: string },
  ): Promise<WorkflowRun> {
    return mutate(command, (run) => {
      ensureActive(run);
      const action = requiredAction(run, command.actionId);
      if (action.attempt !== command.attempt)
        throw new RuntimeProtocolError('STALE_ACTION', 'Action 执行尝试已经改变');
      run.actions[run.actions.indexOf(action)] = markRuntimeActionUnknown(action, command.reason);
    });
  }

  async function retry(
    command: RunCommand & {
      actionId: string;
      attempt: number;
      reconciliation?: { resolution: 'not-executed'; evidence: unknown };
    },
  ): Promise<WorkflowRun> {
    return mutate(command, (run, definition) => {
      ensureActive(run);
      const action = requiredAction(run, command.actionId);
      if (action.attempt !== command.attempt)
        throw new RuntimeProtocolError('STALE_ACTION', 'Action 执行尝试已经改变');
      if (
        action.status === 'failed' &&
        definition.transitions.some((edge) => edge.from === action.stepId && edge.on === 'failed')
      ) {
        throw new RuntimeProtocolError(
          'ACTION_ALREADY_ADVANCED',
          '该失败结果已推进工作流，不能重新执行旧 Action',
        );
      }
      run.actions[run.actions.indexOf(action)] = retryRuntimeAction(action, command.reconciliation);
      run.status = 'running';
      delete run.reason;
    });
  }

  async function execute(
    command: RunCommand & { actionId: string; executorId: string },
  ): Promise<WorkflowRun> {
    const executor = executors.get(command.executorId);
    if (!executor) throw new RuntimeProtocolError('EXECUTOR_UNAVAILABLE', '未注册指定的执行器');
    const before = await inspect(command.runId);
    const pending = requiredAction(before, command.actionId);
    if (pending.status !== 'pending')
      throw new RuntimeProtocolError(
        'ACTION_ALREADY_CLAIMED',
        '不能重复执行已派发的 Action；请先查询和核对结果',
      );
    if (!executor.supports(structuredClone(pending)))
      throw new RuntimeProtocolError('EXECUTOR_UNSUPPORTED', '执行器不支持此 Action');
    const started = await claim({
      ...command,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      claimToken: randomUUID(),
      capabilities: executor.capabilities,
    });
    const action = requiredAction(started, command.actionId);
    let result: Awaited<ReturnType<RuntimeExecutor['execute']>>;
    try {
      checkContext(command.context);
      result = await executor.execute(structuredClone(action), command.context);
    } catch (error) {
      const current = await inspect(command.runId);
      const latest = requiredAction(current, action.id);
      if (
        current.status !== 'cancelled' &&
        latest.status === 'running' &&
        latest.attempt === action.attempt
      ) {
        await markUnknown({
          runId: command.runId,
          actionId: action.id,
          attempt: action.attempt,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      throw new RuntimeProtocolError(
        'EXECUTION_UNKNOWN',
        '执行器未返回可提交的结果；已保留执行归属，请核对外部操作后恢复',
      );
    }
    const outcomeId = `${action.id}:${action.attempt}:executor-result`;
    try {
      return await recordOutcome({
        runId: command.runId,
        context: command.context,
        outcome: {
          ...result,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: action.claim!.token,
          outcomeId,
        },
      });
    } catch (error) {
      const current = await inspect(command.runId);
      const latest = requiredAction(current, action.id);
      if (latest.receipts.some((receipt) => receipt.outcomeId === outcomeId)) {
        if (
          latest.rejectedOutcomes?.some((rejection) => rejection.outcome.outcomeId === outcomeId)
        ) {
          throw error;
        }
        if (latest.outcome?.outcomeId === outcomeId) return current;
      }
      if (
        current.status !== 'cancelled' &&
        latest.status === 'running' &&
        latest.attempt === action.attempt
      ) {
        await markUnknown({
          runId: command.runId,
          actionId: action.id,
          attempt: action.attempt,
          reason: error instanceof Error ? error.message.slice(0, 4096) : '执行结果无法提交',
        });
      }
      throw new RuntimeProtocolError(
        'EXECUTION_UNKNOWN',
        '执行器已返回结果但未能提交；已保留执行归属，请核对外部操作后恢复',
      );
    }
  }

  return {
    start,
    inspect,
    next,
    claim,
    recordOutcome,
    resolveWait,
    reviseWait,
    cancel,
    markUnknown,
    retry,
    execute,
  };
}

export type WorkflowRuntime = ReturnType<typeof createRuntime>;
