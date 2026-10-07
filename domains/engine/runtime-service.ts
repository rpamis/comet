import { randomUUID } from 'node:crypto';
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
import { cloneRuntimeValue, hashRuntimeValue, type RuntimeValue } from './runtime-json.js';
import { compileRuntimeSchema } from './runtime-schema.js';
import type { RuntimeStore } from './runtime-store.js';
import { parseWorkflowRun } from './workflow-run-validation.js';
import {
  defineWorkflow,
  type DefineWorkflowOptions,
  type WorkflowDefinition,
} from './workflow-definition.js';
import type {
  RuntimeEvidenceValidator,
  RuntimeCommandValidator,
  RuntimeExecutor,
  RuntimeInvocationContext,
  RuntimeValidator,
  RuntimeStateValidator,
  WorkflowRef,
  WorkflowRun,
  WorkflowStepActivation,
  WorkflowTransitionEvent,
  WorkflowTransitionHandler,
} from './workflow-run.js';
import { advanceWorkflow, scheduleWorkflow, workflowOutputs } from './workflow-scheduler.js';

export interface CreateRuntimeOptions {
  store: RuntimeStore<WorkflowRun>;
  workflows: readonly DefineWorkflowOptions[];
  validators?: readonly RuntimeValidator[];
  stateValidators?: readonly RuntimeStateValidator[];
  executors?: readonly RuntimeExecutor[];
  transitionHandlers?: readonly WorkflowTransitionHandler[];
  evidenceValidators?: readonly RuntimeEvidenceValidator[];
  commandValidators?: readonly RuntimeCommandValidator[];
  /** 应用的结果契约检查；不执行派发授权，拒绝时保留原结果与工件。 */
  validateOutcome?: RuntimeValidator['validate'];
  /** 应用显式核对已提交结果后，可重走其声明的成功转移；原 Action 和回执保持不变。 */
  validateRecovery?: (
    input: Parameters<RuntimeValidator['validate']>[0] & { proposalHash: string },
  ) => ReturnType<RuntimeValidator['validate']>;
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
  initialState?: unknown;
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

export interface DispatchRuntimeCommand extends RunCommand {
  expectedRevision: number;
  commandId: string;
  name: string;
  input: unknown;
}

export interface RecordRuntimeEvidence extends RunCommand {
  evidenceId: string;
  kind: string;
  ref: string;
  contentHash: string;
  submissionId: string;
  expectedRevision: number;
}

export type InvalidateRuntimeEvidence = RecordRuntimeEvidence;

export interface RunRuntimeUntilBlocked {
  runId: string;
  executorId: string;
  /** 每次调用最多执行多少个 Action，默认 100；不限制单个执行器的耗时。 */
  maxActions?: number;
  context?: RuntimeInvocationContext;
}

export type RuntimeStopReason =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'approval-required'
  | 'evidence-required'
  | 'execution-unknown'
  | 'action-in-flight'
  | 'executor-required'
  | 'action-limit'
  | 'idle';

export interface RuntimeProgress {
  reason: RuntimeStopReason;
  run: WorkflowRun;
  /** 本次调用已尝试执行的 Action 数，包括结果未知的执行。 */
  actionsExecuted: number;
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
  const definitionHashes = new Map<WorkflowDefinition, string>();
  for (const raw of options.workflows) {
    const definition = defineWorkflow(raw);
    const key = referenceKey(definition);
    if (definitions.has(key))
      throw new RuntimeProtocolError('DUPLICATE_WORKFLOW', '不能重复注册同一工作流版本');
    definitions.set(key, definition);
    definitionHashes.set(definition, hashRuntimeValue(definition));
  }
  const validators = new Map<string, RuntimeValidator>();
  for (const validator of options.validators ?? []) {
    const key = referenceKey(validator);
    if (validators.has(key))
      throw new RuntimeProtocolError('DUPLICATE_VALIDATOR', '不能重复注册同一验证器版本');
    validators.set(key, validator);
  }
  const stateValidators = new Map<string, RuntimeStateValidator>();
  for (const validator of options.stateValidators ?? []) {
    const key = referenceKey(validator);
    if (stateValidators.has(key))
      throw new RuntimeProtocolError('DUPLICATE_STATE_VALIDATOR', '不能重复注册同一状态验证器版本');
    stateValidators.set(key, validator);
  }
  const schemaValidators = new Map<RuntimeValue, ReturnType<typeof compileRuntimeSchema>>();
  function schemaValidator(schema: RuntimeValue): ReturnType<typeof compileRuntimeSchema> {
    let compiled = schemaValidators.get(schema);
    if (!compiled) {
      compiled = compileRuntimeSchema(schema);
      // 此处的 schema 仅来自 defineWorkflow 返回的深冻结副本。
      schemaValidators.set(schema, compiled);
    }
    return compiled;
  }
  const executors = new Map<string, RuntimeExecutor>();
  const transitionHandlers = new Map<string, WorkflowTransitionHandler>();
  for (const handler of options.transitionHandlers ?? []) {
    const key = referenceKey(handler);
    if (transitionHandlers.has(key))
      throw new RuntimeProtocolError(
        'DUPLICATE_TRANSITION_HANDLER',
        '不能重复注册同一转移处理器版本',
      );
    transitionHandlers.set(key, handler);
  }
  const evidenceValidators = new Map<string, RuntimeEvidenceValidator>();
  for (const validator of options.evidenceValidators ?? []) {
    const key = referenceKey(validator);
    if (evidenceValidators.has(key))
      throw new RuntimeProtocolError(
        'DUPLICATE_EVIDENCE_VALIDATOR',
        '不能重复注册同一证据验证器版本',
      );
    evidenceValidators.set(key, validator);
  }
  const commandValidators = new Map<string, RuntimeCommandValidator>();
  for (const validator of options.commandValidators ?? []) {
    const key = referenceKey(validator);
    if (commandValidators.has(key)) {
      throw new RuntimeProtocolError(
        'DUPLICATE_COMMAND_VALIDATOR',
        '不能重复注册同一命令验证器版本',
      );
    }
    commandValidators.set(key, validator);
  }
  for (const executor of options.executors ?? []) {
    if (executors.has(executor.id))
      throw new RuntimeProtocolError('DUPLICATE_EXECUTOR', '不能重复注册同一执行器');
    executors.set(executor.id, executor);
  }

  function definitionFor(reference: WorkflowRef & { hash?: string }): WorkflowDefinition {
    const definition = definitions.get(referenceKey(reference));
    if (!definition)
      throw new RuntimeProtocolError('WORKFLOW_UNAVAILABLE', '请提供当前 Run 固定的工作流定义版本');
    if (reference.hash !== undefined && reference.hash !== definitionHashes.get(definition)) {
      throw new RuntimeProtocolError(
        'WORKFLOW_CHANGED',
        '同一版本的工作流内容已改变；请恢复原定义或显式迁移',
      );
    }
    return definition;
  }

  function requireTransitionHandler(definition: WorkflowDefinition): void {
    if (
      definition.transitionHandler &&
      !transitionHandlers.has(referenceKey(definition.transitionHandler))
    ) {
      throw new RuntimeProtocolError(
        'TRANSITION_HANDLER_UNAVAILABLE',
        '未注册工作流所要求的转移处理器版本',
      );
    }
  }

  function requireStateValidator(definition: WorkflowDefinition): void {
    if (
      definition.stateValidator &&
      !stateValidators.has(referenceKey(definition.stateValidator))
    ) {
      throw new RuntimeProtocolError(
        'STATE_VALIDATOR_UNAVAILABLE',
        '未注册工作流所要求的状态验证器版本',
      );
    }
  }

  function requireEvidenceValidators(definition: WorkflowDefinition): void {
    for (const step of Object.values(definition.steps)) {
      if (step.type === 'await_evidence' && !evidenceValidators.has(referenceKey(step.validator))) {
        throw new RuntimeProtocolError(
          'EVIDENCE_VALIDATOR_UNAVAILABLE',
          '未注册工作流所要求的证据验证器版本',
        );
      }
    }
  }

  function requireCommandValidators(definition: WorkflowDefinition): void {
    for (const command of Object.values(definition.commands ?? {})) {
      if (command.validator && !commandValidators.has(referenceKey(command.validator))) {
        throw new RuntimeProtocolError(
          'COMMAND_VALIDATOR_UNAVAILABLE',
          '未注册工作流所要求的命令验证器版本',
        );
      }
    }
  }

  function validateWorkflowState(
    definition: WorkflowDefinition,
    state: unknown,
    code: string,
  ): void {
    if (definition.stateSchema !== undefined) {
      const schema = schemaValidator(definition.stateSchema);
      if (!schema.validate(state)) throw new RuntimeProtocolError(code, schema.errorsText());
    }
    if (definition.stateValidator) {
      const validator = stateValidators.get(referenceKey(definition.stateValidator));
      if (!validator)
        throw new RuntimeProtocolError(
          'STATE_VALIDATOR_UNAVAILABLE',
          '未注册工作流所要求的状态验证器版本',
        );
      try {
        const result = validator.validate({ state: cloneRuntimeValue(state) });
        if (!result.accepted) throw new Error(result.reason ?? '业务状态未通过验证');
      } catch (error) {
        throw new RuntimeProtocolError(
          code,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  function applyTransitionHandler(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    event: WorkflowTransitionEvent,
    routeEvent: string,
  ): Array<string | WorkflowStepActivation> | undefined {
    if (!definition.transitionHandler) return undefined;
    const handler = transitionHandlers.get(referenceKey(definition.transitionHandler));
    if (!handler)
      throw new RuntimeProtocolError(
        'TRANSITION_HANDLER_UNAVAILABLE',
        '未注册工作流所要求的转移处理器版本',
      );
    const transition = handler.apply({ run: structuredClone(run), event });
    const state = cloneRuntimeValue(transition.state);
    validateWorkflowState(definition, state, 'TRANSITION_STATE_INVALID');
    const allowedTargets = new Set(
      definition.transitions
        .filter((edge) => edge.from === event.stepId && edge.on === routeEvent)
        .map((edge) => edge.to),
    );
    if (!Array.isArray(transition.next)) {
      throw new RuntimeProtocolError(
        'TRANSITION_TARGET_INVALID',
        '转移处理器选择了未声明或重复的后续步骤',
      );
    }
    const selected: Array<string | WorkflowStepActivation> = [];
    const identities = new Set<string>();
    for (const target of transition.next) {
      let normalized: string | WorkflowStepActivation;
      if (typeof target === 'string') {
        normalized = target;
      } else if (target !== null && typeof target === 'object' && !Array.isArray(target)) {
        const fields = Object.keys(target);
        if (
          fields.length !== 2 ||
          !fields.includes('stepId') ||
          !fields.includes('input') ||
          typeof target.stepId !== 'string'
        ) {
          throw new RuntimeProtocolError('TRANSITION_TARGET_INVALID', '后续步骤的输入绑定无效');
        }
        normalized = { stepId: target.stepId, input: cloneRuntimeValue(target.input) };
      } else {
        throw new RuntimeProtocolError('TRANSITION_TARGET_INVALID', '后续步骤的输入绑定无效');
      }
      const stepId = typeof normalized === 'string' ? normalized : normalized.stepId;
      const identity = hashRuntimeValue(normalized);
      if (!allowedTargets.has(stepId) || identities.has(identity)) {
        throw new RuntimeProtocolError(
          'TRANSITION_TARGET_INVALID',
          '转移处理器选择了未声明或重复的后续步骤',
        );
      }
      identities.add(identity);
      selected.push(normalized);
    }
    run.state = state;
    return selected;
  }

  async function inspect(runId: string): Promise<WorkflowRun> {
    const persisted = await options.store.read(runId);
    if (!persisted) throw new RuntimeProtocolError('RUN_NOT_FOUND', `找不到工作流实例：${runId}`);
    const run = parseWorkflowRun(persisted, runId);
    if (definitions.size > 0) {
      for (const [key, hash] of Object.entries(run.definitionHashes)) {
        const [id, version] = JSON.parse(key) as [string, string];
        const definition = definitionFor({ id, version, hash });
        requireTransitionHandler(definition);
        requireStateValidator(definition);
        requireEvidenceValidators(definition);
        requireCommandValidators(definition);
        if (id === run.workflow.id && version === run.workflow.version) {
          const actions = new Map(run.actions.map((action) => [action.id, action]));
          for (const command of run.commands ?? []) {
            const action = actions.get(command.actionId);
            if (
              !action ||
              !Object.hasOwn(definition.commands ?? {}, command.name) ||
              definition.commands?.[command.name].stepId !== action.stepId ||
              action.input === null ||
              typeof action.input !== 'object' ||
              !Object.hasOwn(action.input, 'activation') ||
              hashRuntimeValue((action.input as { activation?: unknown }).activation) !==
                command.inputHash
            ) {
              throw new RuntimeProtocolError('INVALID_RUN', '命令记录与固定工作流 Action 不一致');
            }
          }
          if (
            definition.stateSchema !== undefined &&
            definition.initialState === undefined &&
            run.initialStateHash === undefined
          ) {
            throw new RuntimeProtocolError('INVALID_RUN', '已保存的 Run 缺少启动时的初始状态绑定');
          }
          validateWorkflowState(definition, run.state, 'RUN_STATE_INVALID');
          for (const token of run.ready) {
            const invalidToken = () => {
              throw new RuntimeProtocolError('INVALID_RUN', '待调度步骤与固定工作流定义不一致');
            };
            if (!Object.hasOwn(definition.steps, token.to)) invalidToken();
            if (token.from === null) {
              if (
                !definition.entry.includes(token.to) ||
                Object.keys(token.results).length > 0 ||
                (run.sequence !== 0 &&
                  !(run.status === 'failed' && run.reason?.startsWith('TRANSITION_LIMIT:')))
              )
                invalidToken();
              continue;
            }
            const source = token.results[token.from];
            if (!source) invalidToken();
            const action = run.actions.find(
              (candidate) =>
                candidate.stepId === token.from &&
                run.actionContexts[candidate.id].sequence === source.sequence,
            );
            const wait = run.waits.find(
              (candidate) =>
                candidate.stepId === token.from && candidate.sequence === source.sequence,
            );
            const evidence = run.evidenceWaits?.find(
              (candidate) =>
                candidate.stepId === token.from && candidate.sequence === source.sequence,
            );
            const event = action?.outcome
              ? action.outcome.status === 'failed'
                ? 'failed'
                : (action.outcome.event ?? 'succeeded')
              : (wait?.decision?.choice ??
                (evidence?.invalidation
                  ? 'invalidated'
                  : evidence?.receipt
                    ? 'succeeded'
                    : undefined));
            const prior = action
              ? run.actionContexts[action.id].results
              : (wait?.results ?? evidence?.results);
            const value = action?.outcome
              ? action.outcome.output
              : wait?.decision
                ? { choice: wait.decision.choice, proposal: wait.proposal }
                : evidence?.invalidation
                  ? {
                      ref: evidence.invalidation.ref,
                      contentHash: evidence.invalidation.contentHash,
                      reason: evidence.invalidation.reason,
                    }
                  : evidence?.receipt
                    ? { ref: evidence.receipt.ref, contentHash: evidence.receipt.contentHash }
                    : undefined;
            if (
              !event ||
              !prior ||
              (action && !['succeeded', 'failed'].includes(action.status)) ||
              (wait && wait.status !== 'resolved') ||
              (evidence && !['resolved', 'invalidated'].includes(evidence.status)) ||
              value === undefined ||
              hashRuntimeValue(token.results) !==
                hashRuntimeValue({
                  ...prior,
                  [token.from]: { sequence: source.sequence, value },
                }) ||
              !definition.transitions.some(
                (edge) => edge.from === token.from && edge.to === token.to && edge.on === event,
              )
            ) {
              invalidToken();
            }
          }
          for (const wait of run.evidenceWaits ?? []) {
            const step = definition.steps[wait.stepId];
            if (!step || step.type !== 'await_evidence' || step.kind !== wait.kind) {
              throw new RuntimeProtocolError(
                'INVALID_RUN',
                '已保存的证据等待项与固定工作流定义不一致',
              );
            }
          }
        }
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
    hashes[key] = definitionHashes.get(definition)!;
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
    requireTransitionHandler(definition);
    requireStateValidator(definition);
    requireEvidenceValidators(definition);
    requireCommandValidators(definition);
    const suppliedState = Object.hasOwn(input, 'initialState');
    if (suppliedState && definition.initialState !== undefined) {
      throw new RuntimeProtocolError(
        'INITIAL_STATE_CONFLICT',
        '工作流定义和启动请求不能同时指定初始状态',
      );
    }
    const initialState = suppliedState
      ? cloneRuntimeValue(input.initialState)
      : definition.initialState;
    if (definition.stateSchema !== undefined && initialState === undefined) {
      throw new RuntimeProtocolError('INITIAL_STATE_REQUIRED', '启动请求必须提供工作流初始状态');
    }
    if (initialState !== undefined) {
      validateWorkflowState(definition, initialState, 'INITIAL_STATE_INVALID');
    }
    const initialStateHash =
      initialState === undefined ? undefined : hashRuntimeValue(initialState);
    const runId = input.runId ?? randomUUID();
    const value = cloneRuntimeValue(input.input);
    const workflow = {
      id: definition.id,
      version: definition.version,
      hash: definitionHashes.get(definition)!,
    };
    const previous = await options.store.read(runId);
    if (previous) {
      if (
        hashRuntimeValue(previous.workflow) !== hashRuntimeValue(workflow) ||
        hashRuntimeValue(previous.input) !== hashRuntimeValue(value) ||
        hashRuntimeValue(previous.lineage) !== hashRuntimeValue(lineage) ||
        (previous.initialStateHash ??
          (definition.initialState === undefined
            ? undefined
            : hashRuntimeValue(definition.initialState))) !== initialStateHash
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
      ...(initialState === undefined
        ? {}
        : { state: cloneRuntimeValue(initialState), initialStateHash: initialStateHash! }),
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

  async function dispatchCommand(command: DispatchRuntimeCommand): Promise<WorkflowRun> {
    const activation = cloneRuntimeValue(command.input);
    const inputHash = hashRuntimeValue(activation);
    if (
      !command.commandId.trim() ||
      command.commandId.length > 4096 ||
      !command.name.trim() ||
      command.name.length > 4096
    ) {
      throw new RuntimeProtocolError('INVALID_COMMAND', '命令标识和名称不能为空');
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      checkContext(command.context);
      const before = await inspect(command.runId);
      const previous = before.commands?.find((receipt) => receipt.id === command.commandId);
      if (previous) {
        if (previous.name !== command.name || previous.inputHash !== inputHash) {
          throw new RuntimeProtocolError('COMMAND_CONFLICT', '同一命令标识不能提交不同内容');
        }
        return before;
      }
      if (command.expectedRevision !== before.revision) {
        throw new RuntimeProtocolError('REVISION_CONFLICT', 'Run 已变化，请重新读取当前状态');
      }
      const definition = definitionFor(before.workflow);
      const declared = Object.hasOwn(definition.commands ?? {}, command.name)
        ? definition.commands?.[command.name]
        : undefined;
      if (!declared) throw new RuntimeProtocolError('COMMAND_NOT_FOUND', '工作流未声明此命令');
      const stepId = declared.stepId;
      if (['failed', 'cancelled'].includes(before.status)) {
        throw new RuntimeProtocolError('RUN_TERMINAL', '已停止的 Run 不能接受命令');
      }
      if (before.actions.some((action) => ['running', 'unknown'].includes(action.status))) {
        throw new RuntimeProtocolError('ACTION_IN_FLIGHT', '已有 Action 的执行结果不明，不能中断');
      }
      let allowCompleted = false;
      if (declared.validator) {
        const validator = commandValidators.get(referenceKey(declared.validator));
        if (!validator) {
          throw new RuntimeProtocolError(
            'COMMAND_VALIDATOR_UNAVAILABLE',
            '未注册工作流所要求的命令验证器版本',
          );
        }
        let checked;
        try {
          checked = await validator.validate({
            run: structuredClone(before),
            name: command.name,
            input: activation,
            context: command.context,
          });
        } catch (error) {
          throw new RuntimeProtocolError(
            'COMMAND_VALIDATION_ERROR',
            error instanceof Error ? error.message : String(error),
          );
        }
        allowCompleted = checked.accepted && checked.allowCompleted === true;
        if (before.status === 'completed' && !allowCompleted) {
          throw new RuntimeProtocolError('RUN_TERMINAL', '已停止的 Run 不能接受命令');
        }
        if (!checked.accepted) {
          throw new RuntimeProtocolError(
            'COMMAND_REJECTED',
            checked.reason ?? '命令未通过当前工作流状态验证',
          );
        }
      }
      if (before.status === 'completed' && !allowCompleted) {
        throw new RuntimeProtocolError('RUN_TERMINAL', '已停止的 Run 不能接受命令');
      }
      const next = structuredClone(before);
      next.actions = next.actions.map((action) =>
        action.status === 'pending'
          ? cancelRuntimeAction(action, `命令 ${command.name} 已取代待执行 Action`)
          : action,
      );
      for (const wait of next.waits) if (wait.status === 'pending') wait.status = 'cancelled';
      for (const wait of next.evidenceWaits ?? []) {
        if (wait.status === 'pending') wait.status = 'cancelled';
      }
      next.ready = [{ from: null, to: stepId, results: {}, activation }];
      next.joins = {};
      scheduleWorkflow(next, definition);
      const action = next.actions.at(-1);
      if (!action || action.stepId !== stepId || action.status !== 'pending') {
        throw new RuntimeProtocolError('COMMAND_DISPATCH_FAILED', '命令未生成可执行的 Action');
      }
      next.commands = [
        ...(next.commands ?? []),
        {
          id: command.commandId,
          name: command.name,
          inputHash,
          actionId: action.id,
        },
      ];
      next.revision = before.revision + 1;
      checkContext(command.context);
      if (await options.store.compareAndSwap(command.runId, before.revision, next)) {
        return structuredClone(next);
      }
    }
    throw new RuntimeProtocolError('REVISION_CONFLICT', '并发提交持续冲突，请重新读取当前状态');
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
    // 没有子流程时，本次读取或成功 CAS 已确定返回快照，无需再次读取完整 Run。
    if (run.children.length === 0) return run;
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
    return mutate(command, async (run) => {
      ensureActive(run);
      if (run.status === 'failed')
        throw new RuntimeProtocolError('RUN_FAILED', 'Run 已因失败停止；请先完成显式恢复');
      const action = requiredAction(run, command.actionId);
      if (action.type === 'child_workflow' && !allowChild)
        throw new RuntimeProtocolError(
          'CHILD_MANAGED',
          '子工作流由 Runtime 登记与核对，不接受宿主代领',
        );
      const claimed = claimRuntimeAction(action, {
        attempt: command.attempt,
        inputHash: command.inputHash,
        executorId: command.executorId,
        token,
        ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
      });
      if (!action.claim) {
        const available = new Set(command.capabilities ?? []);
        if (action.requiredCapabilities.some((capability) => !available.has(capability)))
          throw new RuntimeProtocolError(
            'CAPABILITY_REQUIRED',
            '执行者未声明 Action 要求的全部宿主能力',
          );
        const executor = executors.get(command.executorId);
        if (executor?.supports(structuredClone(action))) {
          if (
            action.requiredCapabilities.some(
              (capability) => !executor.capabilities.includes(capability),
            )
          )
            throw new RuntimeProtocolError(
              'CAPABILITY_REQUIRED',
              '已配置执行端口缺少 Action 要求的宿主能力',
            );
          await executor.preflight?.(
            structuredClone(action),
            command.context,
            structuredClone(run),
          );
          checkContext(command.context);
        }
      }
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
        if (options.validateOutcome) {
          const checked = await options.validateOutcome({
            run: structuredClone(run),
            action: structuredClone(action),
            outcome: structuredClone(command.outcome),
            context: command.context,
          });
          if (!checked.accepted)
            rejection = {
              code: 'OUTCOME_REJECTED',
              reason: checked.reason ?? '应用结果契约拒绝此结果',
            };
        }
        const step = definition.steps[action.stepId];
        if (
          !rejection &&
          command.outcome.status === 'succeeded' &&
          step.outputSchema !== undefined
        ) {
          const schema = schemaValidator(step.outputSchema);
          if (!schema.validate(command.outcome.output)) {
            rejection = { code: 'OUTPUT_INVALID', reason: schema.errorsText() };
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
            run: structuredClone(run),
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
          const routeEvent =
            command.outcome.status === 'failed' ? 'failed' : (command.outcome.event ?? 'succeeded');
          const selectedTargets = applyTransitionHandler(
            advanced,
            definition,
            { kind: 'action-outcome', stepId: action.stepId, outcome: command.outcome },
            routeEvent,
          );
          advanceWorkflow(
            advanced,
            definition,
            action.stepId,
            context.sequence,
            context.results,
            command.outcome.output,
            routeEvent,
            selectedTargets,
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
      const selectedTargets = applyTransitionHandler(
        run,
        definition,
        {
          kind: 'wait-resolved',
          stepId: wait.stepId,
          choice: command.choice,
          proposalHash: command.proposalHash,
          decisionId: command.decisionId,
        },
        command.choice,
      );
      advanceWorkflow(
        run,
        definition,
        wait.stepId,
        wait.sequence,
        wait.results,
        { choice: command.choice, proposal: wait.proposal },
        command.choice,
        selectedTargets,
      );
      scheduleWorkflow(run, definition);
    });
  }

  async function recordEvidence(command: RecordRuntimeEvidence): Promise<WorkflowRun> {
    return mutate(command, async (run, definition) => {
      ensureActive(run);
      if (run.status === 'failed')
        throw new RuntimeProtocolError('RUN_FAILED', 'Run 已因失败停止，不能提交证据');
      const wait = run.evidenceWaits?.find((candidate) => candidate.id === command.evidenceId);
      if (!wait)
        throw new RuntimeProtocolError('EVIDENCE_WAIT_NOT_FOUND', 'Run 不包含此证据等待项');
      if (wait.status !== 'pending')
        throw new RuntimeProtocolError('EVIDENCE_WAIT_RESOLVED', '证据等待项已结束');
      if (wait.kind !== command.kind)
        throw new RuntimeProtocolError('EVIDENCE_KIND_MISMATCH', '证据种类与等待项不一致');
      if (
        !command.ref.trim() ||
        /^(?:[a-zA-Z]:|[\\/~])/u.test(command.ref) ||
        command.ref.split(/[\\/]/u).includes('..') ||
        !/^[a-f0-9]{64}$/u.test(command.contentHash) ||
        !command.submissionId.trim()
      ) {
        throw new RuntimeProtocolError('INVALID_EVIDENCE', '证据引用、摘要或提交标识无效');
      }
      const step = definition.steps[wait.stepId];
      if (!step || step.type !== 'await_evidence' || step.kind !== command.kind) {
        throw new RuntimeProtocolError('EVIDENCE_STEP_CHANGED', '证据等待项与固定工作流不一致');
      }
      const validator = evidenceValidators.get(referenceKey(step.validator));
      if (!validator)
        throw new RuntimeProtocolError('EVIDENCE_VALIDATOR_UNAVAILABLE', '未注册证据验证器版本');
      const checked = await validator.validate({
        run: structuredClone(run),
        kind: command.kind,
        ref: command.ref,
        contentHash: command.contentHash,
        context: command.context,
      });
      if (!checked.accepted || checked.actualHash !== command.contentHash) {
        throw new RuntimeProtocolError(
          'EVIDENCE_REJECTED',
          checked.reason ?? '证据未通过验证或内容已改变',
        );
      }
      wait.status = 'resolved';
      wait.receipt = {
        ref: command.ref,
        contentHash: command.contentHash,
        submissionId: command.submissionId,
      };
      const selectedTargets = applyTransitionHandler(
        run,
        definition,
        {
          kind: 'evidence-recorded',
          stepId: wait.stepId,
          evidenceKind: command.kind,
          ref: command.ref,
          contentHash: command.contentHash,
          submissionId: command.submissionId,
        },
        'succeeded',
      );
      advanceWorkflow(
        run,
        definition,
        wait.stepId,
        wait.sequence,
        wait.results,
        { ref: command.ref, contentHash: command.contentHash },
        'succeeded',
        selectedTargets,
      );
      scheduleWorkflow(run, definition);
    });
  }

  async function invalidateEvidence(command: InvalidateRuntimeEvidence): Promise<WorkflowRun> {
    return mutate(command, async (run, definition) => {
      ensureActive(run);
      if (run.status === 'failed')
        throw new RuntimeProtocolError('RUN_FAILED', 'Run 已因失败停止，不能使证据失效');
      const wait = run.evidenceWaits?.find((candidate) => candidate.id === command.evidenceId);
      if (!wait)
        throw new RuntimeProtocolError('EVIDENCE_WAIT_NOT_FOUND', 'Run 不包含此证据等待项');
      if (wait.status !== 'pending')
        throw new RuntimeProtocolError('EVIDENCE_WAIT_RESOLVED', '证据等待项已结束');
      if (wait.kind !== command.kind)
        throw new RuntimeProtocolError('EVIDENCE_KIND_MISMATCH', '证据种类与等待项不一致');
      if (
        !command.ref.trim() ||
        /^(?:[a-zA-Z]:|[\\/~])/u.test(command.ref) ||
        command.ref.split(/[\\/]/u).includes('..') ||
        !/^[a-f0-9]{64}$/u.test(command.contentHash) ||
        !command.submissionId.trim()
      ) {
        throw new RuntimeProtocolError('INVALID_EVIDENCE', '证据引用、摘要或提交标识无效');
      }
      const step = definition.steps[wait.stepId];
      if (!step || step.type !== 'await_evidence' || step.kind !== command.kind) {
        throw new RuntimeProtocolError('EVIDENCE_STEP_CHANGED', '证据等待项与固定工作流不一致');
      }
      if (
        !definition.transitions.some(
          (edge) => edge.from === wait.stepId && edge.on === 'invalidated',
        )
      ) {
        throw new RuntimeProtocolError(
          'EVIDENCE_INVALIDATION_UNAVAILABLE',
          '当前工作流未声明证据失效后的恢复路径',
        );
      }
      const validator = evidenceValidators.get(referenceKey(step.validator));
      if (!validator)
        throw new RuntimeProtocolError('EVIDENCE_VALIDATOR_UNAVAILABLE', '未注册证据验证器版本');
      const checked = await validator.validate({
        run: structuredClone(run),
        kind: command.kind,
        ref: command.ref,
        contentHash: command.contentHash,
        context: command.context,
      });
      if (checked.accepted && checked.actualHash === command.contentHash) {
        throw new RuntimeProtocolError('EVIDENCE_STILL_VALID', '当前证据仍然有效，不能使其失效');
      }
      const reason = (checked.reason?.trim() || '证据未通过验证或内容已改变').slice(0, 4096);
      wait.status = 'invalidated';
      wait.invalidation = {
        ref: command.ref,
        contentHash: command.contentHash,
        submissionId: command.submissionId,
        reason,
      };
      const selectedTargets = applyTransitionHandler(
        run,
        definition,
        {
          kind: 'evidence-invalidated',
          stepId: wait.stepId,
          evidenceKind: command.kind,
          ref: command.ref,
          contentHash: command.contentHash,
          submissionId: command.submissionId,
          reason,
        },
        'invalidated',
      );
      advanceWorkflow(
        run,
        definition,
        wait.stepId,
        wait.sequence,
        wait.results,
        { ref: command.ref, contentHash: command.contentHash, reason },
        'invalidated',
        selectedTargets,
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
      for (const wait of run.evidenceWaits ?? [])
        if (wait.status === 'pending') wait.status = 'cancelled';
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
      proposalHash?: string;
      reconciliation?: { resolution: 'not-executed'; evidence: unknown };
    },
  ): Promise<WorkflowRun> {
    return mutate(command, async (run, definition) => {
      ensureActive(run);
      const action = requiredAction(run, command.actionId);
      if (action.attempt !== command.attempt)
        throw new RuntimeProtocolError('STALE_ACTION', 'Action 执行尝试已经改变');
      if (action.status === 'succeeded' && options.validateRecovery) {
        if (command.expectedRevision === undefined)
          throw new RuntimeProtocolError(
            'REVISION_CONFLICT',
            '恢复已提交结果必须绑定当前 Run 版本',
          );
        if (command.reconciliation !== undefined)
          throw new RuntimeProtocolError(
            'OUTCOME_ALREADY_RECORDED',
            '已提交结果不能声明未执行；请使用应用的语义恢复',
          );
        if (typeof command.proposalHash !== 'string' || !command.proposalHash.trim())
          throw new RuntimeProtocolError('INVALID_REQUEST', '恢复已提交结果必须绑定当前应用决定');
        if (run.actions.some((item) => ['running', 'unknown'].includes(item.status)))
          throw new RuntimeProtocolError(
            'ACTION_IN_FLIGHT',
            '已有 Action 的执行结果不明，不能恢复',
          );
        if (
          run.status !== 'completed' ||
          run.ready.length > 0 ||
          run.actions.some((item) => item.status === 'pending') ||
          run.waits.some((wait) => wait.status === 'pending') ||
          run.evidenceWaits?.some((wait) => wait.status === 'pending') ||
          Object.values(run.joins).some((queues) =>
            Object.values(queues).some((queue) => queue.length > 0),
          ) ||
          !action.outcome ||
          action.outcome.status !== 'succeeded'
        )
          throw new RuntimeProtocolError('RUN_TERMINAL', '当前 Run 不符合已提交结果的恢复条件');
        const checked = await options.validateRecovery({
          run: structuredClone(run),
          action: structuredClone(action),
          outcome: structuredClone(action.outcome),
          context: command.context,
          proposalHash: command.proposalHash,
        });
        if (!checked.accepted)
          throw new RuntimeProtocolError('ACTION_TERMINAL', checked.reason ?? '应用拒绝恢复此结果');
        const event = action.outcome.event ?? 'succeeded';
        const targets = applyTransitionHandler(
          run,
          definition,
          {
            kind: 'action-outcome',
            stepId: action.stepId,
            outcome: action.outcome,
          },
          event,
        );
        if (
          targets?.length === 0 ||
          (targets === undefined &&
            !definition.transitions.some(
              (edge) => edge.from === action.stepId && edge.on === event,
            ))
        )
          throw new RuntimeProtocolError('ACTION_TERMINAL', '应用未声明可恢复的后续工作');
        const actionContext = run.actionContexts[action.id];
        advanceWorkflow(
          run,
          definition,
          action.stepId,
          actionContext.sequence,
          actionContext.results,
          action.outcome.output,
          event,
          targets,
        );
        scheduleWorkflow(run, definition);
        return;
      }
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
    checkContext(command.context);
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
      result = await executor.execute(
        structuredClone(action),
        command.context,
        structuredClone(started),
      );
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

  /** 顺序推进当前 Run；确认、核对和重试始终由宿主显式提交。 */
  async function runUntilBlocked(command: RunRuntimeUntilBlocked): Promise<RuntimeProgress> {
    const maxActions = command.maxActions ?? 100;
    if (!Number.isSafeInteger(maxActions) || maxActions < 1) {
      throw new RuntimeProtocolError('INVALID_REQUEST', 'maxActions 必须是正安全整数');
    }
    const executor = executors.get(command.executorId);
    if (!executor) throw new RuntimeProtocolError('EXECUTOR_UNAVAILABLE', '未注册指定的执行器');
    let actionsExecuted = 0;
    let run = await inspect(command.runId);
    const stop = (reason: RuntimeStopReason): RuntimeProgress => ({ reason, run, actionsExecuted });
    const blockedReason = (allowChildProgress: boolean): RuntimeStopReason | undefined => {
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        return run.status;
      }
      if (run.actions.some((action) => action.status === 'unknown')) return 'execution-unknown';
      if (
        run.actions.some(
          (action) =>
            action.status === 'running' &&
            (!allowChildProgress || action.type !== 'child_workflow'),
        )
      )
        return 'action-in-flight';
      if (run.waits.some((wait) => wait.status === 'pending')) return 'approval-required';
      if (run.evidenceWaits?.some((wait) => wait.status === 'pending')) return 'evidence-required';
      return undefined;
    };
    for (;;) {
      checkContext(command.context);
      // 先检查现有阻塞；next 可能领取并创建 Child，不能先调用再判断未知状态。
      const existingBlock = blockedReason(true);
      if (existingBlock) return stop(existingBlock);
      run = await next({ runId: command.runId, context: command.context });
      const scheduledBlock = blockedReason(false);
      if (scheduledBlock) return stop(scheduledBlock);
      const action = run.actions.find((candidate) => candidate.status === 'pending');
      if (!action) return stop('idle');
      if (actionsExecuted >= maxActions) return stop('action-limit');
      if (
        !executor.supports(structuredClone(action)) ||
        action.requiredCapabilities.some(
          (capability) => !executor.capabilities.includes(capability),
        )
      )
        return stop('executor-required');
      actionsExecuted++;
      try {
        run = await execute({ ...command, actionId: action.id });
      } catch (error) {
        if (!(error instanceof RuntimeProtocolError) || error.code !== 'EXECUTION_UNKNOWN')
          throw error;
        run = await inspect(command.runId);
        if (!run.actions.some((candidate) => candidate.status === 'unknown')) throw error;
        return stop('execution-unknown');
      }
    }
  }

  return {
    start,
    dispatchCommand,
    inspect,
    next,
    claim,
    recordOutcome,
    resolveWait,
    recordEvidence,
    invalidateEvidence,
    reviseWait,
    cancel,
    markUnknown,
    retry,
    execute,
    runUntilBlocked,
  };
}

export type WorkflowRuntime = ReturnType<typeof createRuntime>;
