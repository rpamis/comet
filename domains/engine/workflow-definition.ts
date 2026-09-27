import { Ajv } from 'ajv';
import type { RuntimeRetryPolicy } from './runtime-action.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { cloneRuntimeValue, type RuntimeValue } from './runtime-json.js';

export interface WorkflowReference {
  id: string;
  version: string;
}

export interface WorkflowStepOptions {
  ref?: string;
  input?: RuntimeValue;
  outputSchema?: RuntimeValue;
  validator?: WorkflowReference;
  requiredCapabilities?: string[];
  retry?: RuntimeRetryPolicy;
  join?: string[];
}

export interface ExternalWorkflowStepOptions extends WorkflowStepOptions {
  type: 'invoke_skill' | 'call_tool' | 'handoff';
  ref: string;
}

export interface ApprovalWorkflowStepOptions extends WorkflowStepOptions {
  type: 'ask_user';
  proposalFrom: string | string[];
  choices?: string | string[];
}

export interface ChildWorkflowStepOptions extends WorkflowStepOptions {
  type: 'child_workflow';
  workflow: WorkflowReference;
}

export interface EvidenceWorkflowStepOptions extends WorkflowStepOptions {
  type: 'await_evidence';
  kind: string;
  validator: WorkflowReference;
}

export type WorkflowStepInput =
  | ExternalWorkflowStepOptions
  | ApprovalWorkflowStepOptions
  | ChildWorkflowStepOptions
  | EvidenceWorkflowStepOptions;

export type WorkflowStep =
  | (ExternalWorkflowStepOptions & { retry: RuntimeRetryPolicy })
  | (ApprovalWorkflowStepOptions & {
      retry: RuntimeRetryPolicy;
      proposalFrom: string[];
      choices: string[];
    })
  | (ChildWorkflowStepOptions & { retry: RuntimeRetryPolicy })
  | (EvidenceWorkflowStepOptions & { retry: RuntimeRetryPolicy });

export interface WorkflowTransition {
  from: string;
  to: string;
  on: string;
}

export interface DefineWorkflowOptions extends WorkflowReference {
  entry: string | string[];
  steps: Record<string, WorkflowStepInput>;
  /** External commands may activate only declared, unjoined execution steps. */
  commands?: Record<string, string | { stepId: string; validator?: WorkflowReference }>;
  transitions?: Array<Omit<WorkflowTransition, 'on'> & { on?: string }>;
  maxTransitions?: number;
  initialState?: RuntimeValue;
  stateSchema?: RuntimeValue;
  stateValidator?: WorkflowReference;
  transitionHandler?: WorkflowReference;
}

export interface WorkflowDefinition extends WorkflowReference {
  entry: string[];
  steps: Record<string, WorkflowStep>;
  commands?: Record<string, { stepId: string; validator?: WorkflowReference }>;
  transitions: WorkflowTransition[];
  maxTransitions: number;
  initialState?: RuntimeValue;
  stateSchema?: RuntimeValue;
  stateValidator?: WorkflowReference;
  transitionHandler?: WorkflowReference;
}

type JsonObject = { [key: string]: RuntimeValue };

const commonStepFields = [
  'type',
  'ref',
  'input',
  'outputSchema',
  'validator',
  'requiredCapabilities',
  'retry',
  'join',
];

function invalid(message: string): never {
  throw new RuntimeProtocolError('INVALID_WORKFLOW', message);
}

function object(value: RuntimeValue, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} 必须是 JSON 对象`);
  }
  return value;
}

function onlyFields(value: JsonObject, fields: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) invalid(`${label} 包含不支持的字段：${key}`);
  }
}

function text(value: RuntimeValue | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    invalid(`${label} 必须是非空字符串且不超过 4096 字符`);
  }
  return value;
}

function strings(value: RuntimeValue | undefined, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    invalid(`${label} 必须是${allowEmpty ? '' : '非空'}字符串数组`);
  }
  const values = value.map((entry) => text(entry, label));
  if (new Set(values).size !== values.length) invalid(`${label} 不能包含重复值`);
  return values;
}

function stringList(value: RuntimeValue | undefined, label: string): string[] {
  return strings(typeof value === 'string' ? [value] : value, label);
}

function reference(value: RuntimeValue, label: string): WorkflowReference {
  const fields = object(value, label);
  onlyFields(fields, ['id', 'version'], label);
  return { id: text(fields.id, `${label}.id`), version: text(fields.version, `${label}.version`) };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateSchema(schema: RuntimeValue, label: string): void {
  try {
    const supported = typeof schema === 'boolean' ? schema : object(schema, label);
    if (typeof supported !== 'boolean' && supported.$async === true) {
      invalid(`${label} 仅支持同步校验；异步检查请注册 RuntimeValidator`);
    }
    new Ajv({ strict: true, allErrors: true }).compile(supported);
  } catch (error) {
    invalid(`${label} 不是受支持的 JSON Schema：${(error as Error).message}`);
  }
}

function normalizeStep(value: RuntimeValue): WorkflowStep {
  const fields = object(value, 'step');
  const type = text(fields.type, 'step.type');
  if (
    ![
      'invoke_skill',
      'call_tool',
      'handoff',
      'ask_user',
      'child_workflow',
      'await_evidence',
    ].includes(type)
  ) {
    invalid(`不支持的步骤类型：${type}`);
  }
  const specific =
    type === 'ask_user'
      ? ['proposalFrom', 'choices']
      : type === 'child_workflow'
        ? ['workflow']
        : type === 'await_evidence'
          ? ['kind']
          : [];
  onlyFields(fields, [...commonStepFields, ...specific], 'step');
  const retry = fields.retry === undefined ? 'manual' : fields.retry;
  if (retry !== 'manual' && retry !== 'idempotent' && retry !== 'reconcile') {
    invalid('step.retry 必须是 manual、idempotent 或 reconcile');
  }
  const common: WorkflowStepOptions & { retry: RuntimeRetryPolicy } = {
    ...(fields.ref === undefined ? {} : { ref: text(fields.ref, 'step.ref') }),
    ...(fields.input === undefined ? {} : { input: fields.input }),
    ...(fields.outputSchema === undefined ? {} : { outputSchema: fields.outputSchema }),
    ...(fields.validator === undefined
      ? {}
      : { validator: reference(fields.validator, 'step.validator') }),
    ...(fields.requiredCapabilities === undefined
      ? {}
      : {
          requiredCapabilities: strings(
            fields.requiredCapabilities,
            'step.requiredCapabilities',
            true,
          ),
        }),
    ...(fields.join === undefined ? {} : { join: strings(fields.join, 'step.join') }),
    retry,
  };
  if (fields.outputSchema !== undefined) validateSchema(fields.outputSchema, 'outputSchema');
  if (type === 'ask_user') {
    return {
      ...common,
      type,
      proposalFrom: stringList(fields.proposalFrom, 'step.proposalFrom'),
      choices: stringList(
        fields.choices === undefined ? ['approved', 'rejected'] : fields.choices,
        'step.choices',
      ),
    };
  }
  if (type === 'child_workflow') {
    return { ...common, type, workflow: reference(fields.workflow, 'step.workflow') };
  }
  if (type === 'await_evidence') {
    if (!common.validator) invalid('await_evidence 必须声明验证器');
    return { ...common, type, kind: text(fields.kind, 'step.kind'), validator: common.validator };
  }
  return {
    ...common,
    type: type as ExternalWorkflowStepOptions['type'],
    ref: text(fields.ref, 'step.ref'),
  };
}

function buildStep(options: unknown, type: WorkflowStep['type']): WorkflowStep {
  const fields = object(cloneRuntimeValue(options), 'step options');
  if ('type' in fields) invalid('构建选项不能覆盖步骤类型');
  return freeze(normalizeStep({ ...fields, type }));
}

export function defineWorkflow(options: DefineWorkflowOptions): WorkflowDefinition {
  const fields = object(cloneRuntimeValue(options), 'workflow');
  onlyFields(
    fields,
    [
      'id',
      'version',
      'entry',
      'steps',
      'commands',
      'transitions',
      'maxTransitions',
      'initialState',
      'stateSchema',
      'stateValidator',
      'transitionHandler',
    ],
    'workflow',
  );
  const id = text(fields.id, 'workflow.id');
  const version = text(fields.version, 'workflow.version');
  if (fields.initialState !== undefined && fields.stateSchema === undefined) {
    invalid('workflow.initialState 必须声明 stateSchema');
  }
  if (fields.stateValidator !== undefined && fields.stateSchema === undefined) {
    invalid('workflow.stateValidator 必须声明 stateSchema');
  }
  if (fields.stateSchema !== undefined) validateSchema(fields.stateSchema, 'stateSchema');
  const stepFields = object(fields.steps, 'workflow.steps');
  if (Object.keys(stepFields).length === 0) invalid('workflow.steps 必须至少包含一个步骤');
  const steps = Object.fromEntries(
    Object.entries(stepFields).map(([stepId, value]) => {
      text(stepId, 'step id');
      return [stepId, normalizeStep(value)];
    }),
  );
  function requireStep(stepId: string, label: string): void {
    if (!Object.hasOwn(steps, stepId)) invalid(`${label} 引用了不存在的步骤：${stepId}`);
  }
  const entry = stringList(fields.entry, 'workflow.entry');
  for (const stepId of entry) requireStep(stepId, 'workflow.entry');
  const commandFields =
    fields.commands === undefined ? {} : object(fields.commands, 'workflow.commands');
  const commands: Record<string, { stepId: string; validator?: WorkflowReference }> = {};
  for (const [name, rawCommand] of Object.entries(commandFields)) {
    text(name, 'workflow command name');
    const command =
      typeof rawCommand === 'string'
        ? { stepId: text(rawCommand, `workflow.commands.${name}`) }
        : object(rawCommand, `workflow.commands.${name}`);
    onlyFields(command, ['stepId', 'validator'], `workflow.commands.${name}`);
    const stepId = text(command.stepId, `workflow.commands.${name}.stepId`);
    requireStep(stepId, `workflow.commands.${name}`);
    const step = steps[stepId];
    if (step.join || !['invoke_skill', 'call_tool', 'handoff'].includes(step.type)) {
      invalid(`workflow.commands.${name} 必须指向不带 join 的执行步骤`);
    }
    Object.defineProperty(commands, name, {
      value: {
        stepId,
        ...(command.validator === undefined
          ? {}
          : {
              validator: reference(command.validator, `workflow.commands.${name}.validator`),
            }),
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const transitionValues = fields.transitions === undefined ? [] : fields.transitions;
  if (!Array.isArray(transitionValues)) invalid('workflow.transitions 必须是数组');
  const edgeKeys = new Set<string>();
  const transitions = transitionValues.map((value): WorkflowTransition => {
    const edge = object(value, 'transition');
    onlyFields(edge, ['from', 'to', 'on'], 'transition');
    const from = text(edge.from, 'transition.from');
    const to = text(edge.to, 'transition.to');
    const on = text(edge.on === undefined ? 'succeeded' : edge.on, 'transition.on');
    requireStep(from, 'transition.from');
    requireStep(to, 'transition.to');
    const edgeKey = JSON.stringify([from, to, on]);
    if (edgeKeys.has(edgeKey)) invalid(`重复的状态转移：${from} -> ${to} (${on})`);
    edgeKeys.add(edgeKey);
    return { from, to, on };
  });
  for (const [stepId, step] of Object.entries(steps)) {
    if (step.join) {
      const parents = new Set(
        transitions.filter((edge) => edge.to === stepId).map((edge) => edge.from),
      );
      for (const parent of step.join) {
        requireStep(parent, `${stepId}.join`);
        if (!parents.has(parent)) invalid(`${stepId}.join 依赖缺少对应的进入边：${parent}`);
      }
      if (parents.size !== step.join.length) invalid(`${stepId}.join 必须包含全部进入边的父节点`);
    }
    if (step.type === 'ask_user') {
      for (const source of step.proposalFrom) requireStep(source, `${stepId}.proposalFrom`);
    }
  }
  const maxTransitions = fields.maxTransitions === undefined ? 1000 : fields.maxTransitions;
  if (
    typeof maxTransitions !== 'number' ||
    !Number.isSafeInteger(maxTransitions) ||
    maxTransitions < 1
  ) {
    invalid('workflow.maxTransitions 必须是正安全整数');
  }
  return freeze({
    id,
    version,
    entry,
    steps,
    ...(fields.commands === undefined ? {} : { commands }),
    transitions,
    maxTransitions,
    ...(fields.initialState === undefined ? {} : { initialState: fields.initialState }),
    ...(fields.stateSchema === undefined ? {} : { stateSchema: fields.stateSchema }),
    ...(fields.stateValidator === undefined
      ? {}
      : { stateValidator: reference(fields.stateValidator, 'workflow.stateValidator') }),
    ...(fields.transitionHandler === undefined
      ? {}
      : { transitionHandler: reference(fields.transitionHandler, 'workflow.transitionHandler') }),
  });
}

export function skill(options: Omit<ExternalWorkflowStepOptions, 'type'>): WorkflowStep {
  return buildStep(options, 'invoke_skill');
}

export function tool(options: Omit<ExternalWorkflowStepOptions, 'type'>): WorkflowStep {
  return buildStep(options, 'call_tool');
}

export function approval(options: Omit<ApprovalWorkflowStepOptions, 'type'>): WorkflowStep {
  return buildStep(options, 'ask_user');
}

export function childWorkflow(options: Omit<ChildWorkflowStepOptions, 'type'>): WorkflowStep {
  return buildStep(options, 'child_workflow');
}

export function evidence(options: Omit<EvidenceWorkflowStepOptions, 'type'>): WorkflowStep {
  return buildStep(options, 'await_evidence');
}
