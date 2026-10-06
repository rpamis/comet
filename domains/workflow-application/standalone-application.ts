import {
  createRuntime,
  createMemoryRuntimeStore,
  defineWorkflow,
  type DefineWorkflowOptions,
  type RuntimeExecutor,
  type RuntimeValidator,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';
import type { WorkflowApplicationImplementation } from './types.js';

export interface StandaloneApplicationOptions {
  workflows: readonly DefineWorkflowOptions[];
  transitionHandlers: readonly WorkflowTransitionHandler[];
  executors: readonly RuntimeExecutor[];
  validators: readonly RuntimeValidator[];
  executorIds: readonly string[];
  validatorRefs: readonly { id: string; version: string }[];
}

/** 独立应用沿SDK已声明的图、分支、join和有界转移执行；不继承Native业务验收。 */
export function createStandaloneApplication(
  options: StandaloneApplicationOptions,
): WorkflowApplicationImplementation {
  const exact = (actual: string[], expected: string[], label: string) => {
    if (
      new Set(actual).size !== actual.length ||
      new Set(expected).size !== expected.length ||
      actual.length !== expected.length ||
      expected.some((id) => !actual.includes(id))
    )
      throw new Error(`${label}身份重复、缺失或未声明`);
  };
  exact(
    options.executors.map((e) => e.id),
    [...options.executorIds],
    '执行器',
  );
  exact(
    options.validators.map((v) => `${v.id}@${v.version}`),
    options.validatorRefs.map((v) => `${v.id}@${v.version}`),
    '验证器',
  );
  const definitions = options.workflows.map(defineWorkflow);
  const usedValidators = [
    ...new Set(
      definitions.flatMap((w) =>
        Object.values(w.steps).flatMap((s) =>
          s.validator ? [`${s.validator.id}@${s.validator.version}`] : [],
        ),
      ),
    ),
  ];
  exact(
    options.validatorRefs.map((v) => `${v.id}@${v.version}`),
    usedValidators,
    '流程验证器引用',
  );
  for (const workflow of definitions)
    for (const [stepId, step] of Object.entries(workflow.steps)) {
      if (['invoke_skill', 'call_tool', 'handoff'].includes(step.type)) {
        const action = {
          id: 'closure',
          attempt: 1,
          inputHash: 'closure',
          runId: 'closure',
          stepId,
          type: step.type,
          ref: step.ref,
          input: { input: {}, outputs: {} },
          status: 'pending',
          protocolVersion: 1,
          requiredCapabilities: step.requiredCapabilities ?? [],
          retry: step.retry,
          receipts: [],
          reconciliations: [],
        } as Parameters<RuntimeExecutor['supports']>[0];
        if (!options.executors.some((executor) => executor.supports(action)))
          throw new Error(`流程步骤缺少实际执行器：${workflow.id}/${stepId}`);
      }
      if (step.type === 'await_evidence')
        throw new Error('此独立组合未声明证据验证端口；不能承诺支持该步骤');
    }
  exact(
    options.transitionHandlers.map((h) => `${h.id}@${h.version}`),
    [
      ...new Set(
        definitions.flatMap((w) =>
          w.transitionHandler ? [`${w.transitionHandler.id}@${w.transitionHandler.version}`] : [],
        ),
      ),
    ],
    '转移处理器',
  );
  const application = {
    workflows: options.workflows,
    transitionHandlers: options.transitionHandlers,
    executors: options.executors,
    validators: options.validators,
  };
  createRuntime({ ...application, store: createMemoryRuntimeStore() });
  return application;
}
