import { RuntimeProtocolError } from './runtime-errors.js';
import type { RuntimeAction, RuntimeOutcome } from './runtime-action.js';
import { cloneRuntimeValue, type RuntimeValue } from './runtime-json.js';
import type { RuntimeExecutor, RuntimeInvocationContext, WorkflowRun } from './workflow-run.js';

export interface RuntimeStepInput {
  input: RuntimeValue;
  outputs: Readonly<Record<string, RuntimeValue>>;
  activation?: RuntimeValue;
}

export interface RuntimeHandlerContext {
  action: Readonly<RuntimeAction>;
  context?: RuntimeInvocationContext;
  run?: Readonly<WorkflowRun>;
}

export type RuntimeHandlerResult<Output = RuntimeValue> = Pick<
  RuntimeOutcome,
  'status' | 'artifacts' | 'summary' | 'event'
> & { output: Output };

export interface RuntimeHandlerOptions<Input, Output> {
  type: 'invoke_skill' | 'call_tool' | 'handoff';
  /** 校验并解码工作流输入；也可在此组合上游 outputs 和 activation。 */
  parseInput(value: RuntimeStepInput): Input;
  execute(
    input: Input,
    context: RuntimeHandlerContext,
  ): RuntimeHandlerResult<Output> | Promise<RuntimeHandlerResult<Output>>;
}

export interface RuntimeHandler {
  type: RuntimeHandlerOptions<unknown, RuntimeValue>['type'];
  execute(
    action: Readonly<RuntimeAction>,
    context?: RuntimeInvocationContext,
    run?: Readonly<WorkflowRun>,
  ): Promise<RuntimeHandlerResult>;
}

export interface CreateRuntimeExecutorOptions {
  id: string;
  capabilities?: readonly string[];
  handlers: Readonly<Record<string, RuntimeHandler>>;
}

export function defineRuntimeHandler<Input, Output>(
  options: RuntimeHandlerOptions<Input, Output>,
): RuntimeHandler {
  return {
    type: options.type,
    async execute(action, context, run) {
      const value = action.input;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !Object.hasOwn(value, 'input') ||
        !value.outputs ||
        typeof value.outputs !== 'object' ||
        Array.isArray(value.outputs)
      )
        throw new RuntimeProtocolError('INVALID_ACTION', '处理函数需要工作流生成的步骤输入');
      const input = options.parseInput({
        input: value.input,
        outputs: value.outputs,
        ...(Object.hasOwn(value, 'activation') ? { activation: value.activation } : {}),
      });
      const result = await options.execute(input, { action, context, run });
      return { ...result, output: cloneRuntimeValue(result.output) };
    },
  };
}

/** 只按已注册的 ref 和步骤类型路由，不发现或调用宿主未注册的工具。 */
export function createRuntimeExecutor(options: CreateRuntimeExecutorOptions): RuntimeExecutor {
  const handlers = new Map(Object.entries(options.handlers));
  const handlerFor = (action: Readonly<RuntimeAction>) => {
    const handler = action.ref === undefined ? undefined : handlers.get(action.ref);
    return handler?.type === action.type ? handler : undefined;
  };
  return {
    id: options.id,
    capabilities: [...(options.capabilities ?? [])],
    supports: (action) => handlerFor(action) !== undefined,
    async execute(action, context, run) {
      const handler = handlerFor(action);
      if (!handler)
        throw new RuntimeProtocolError('EXECUTOR_UNSUPPORTED', '执行器未注册此步骤类型与引用');
      return handler.execute(action, context, run);
    },
  };
}
