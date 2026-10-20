import {
  defineWorkflow,
  hashRuntimeValue,
  type DefineWorkflowOptions,
  type WorkflowDefinition,
  type WorkflowRun,
} from '../engine/runtime.js';
import { canonicalRuntimeJson } from '../engine/runtime-json.js';
import { applicationError } from './skill-adapter.js';
import type { WorkflowApplicationManifest } from './types.js';

export interface WorkflowApplicationStepPresentation {
  workflowId: string;
  stepId: string;
  title: string;
  phase?: string;
  description?: string;
  /** 从步骤的实际输出读取字段，使用点分路径；不支持表达式或脚本。 */
  outputFields?: Array<{ path: string; label: string }>;
}

export interface WorkflowApplicationPresentation {
  title?: string;
  description?: string;
  steps?: WorkflowApplicationStepPresentation[];
}

/** 与固定应用一起保存的纯数据；执行状态仍以 SDK Run 为准。 */
export interface WorkflowApplicationDefinition {
  schema: 'comet.workflow.application.definition.v1';
  application: { id: string; version: string };
  workflows: WorkflowDefinition[];
  presentation?: WorkflowApplicationPresentation;
}

const MAX_DEFINITION_BYTES = 8 * 1024 * 1024;
const MAX_WORKFLOWS = 256;
const MAX_STEPS = 4096;
const MAX_TRANSITIONS = 16384;

function object(value: unknown, fields: readonly string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    applicationError(`${label} 必须是 JSON 对象`);
  if (Object.keys(value).some((key) => !fields.includes(key)))
    applicationError(`${label} 含未声明字段`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 256): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    applicationError(`${label} 必须是长度不超过 ${max} 的非空文本`);
}

export function validateWorkflowApplicationPresentation(
  value: unknown,
  workflows?: readonly WorkflowDefinition[],
): asserts value is WorkflowApplicationPresentation {
  const presentation = object(value, ['title', 'description', 'steps'], '应用展示信息');
  if (presentation.title !== undefined) text(presentation.title, '应用展示名称');
  if (presentation.description !== undefined) text(presentation.description, '应用展示说明', 4000);
  if (presentation.steps === undefined) return;
  if (!Array.isArray(presentation.steps) || presentation.steps.length > MAX_STEPS)
    applicationError('步骤展示信息必须是有界数组');
  const seen = new Set<string>();
  for (const raw of presentation.steps) {
    const step = object(
      raw,
      ['workflowId', 'stepId', 'title', 'phase', 'description', 'outputFields'],
      '步骤展示信息',
    );
    text(step.workflowId, '展示流程 ID');
    text(step.stepId, '展示步骤 ID');
    text(step.title, '步骤展示名称');
    if (step.phase !== undefined) text(step.phase, '步骤阶段名称');
    if (step.description !== undefined) text(step.description, '步骤展示说明', 4000);
    const key = JSON.stringify([step.workflowId, step.stepId]);
    if (seen.has(key)) applicationError(`重复步骤展示信息：${step.workflowId}/${step.stepId}`);
    seen.add(key);
    if (workflows) {
      const matches = workflows.filter((workflow) => workflow.id === step.workflowId);
      if (
        !matches.length ||
        matches.some((workflow) => !Object.hasOwn(workflow.steps, step.stepId as string))
      )
        applicationError(`展示信息引用不存在的步骤：${step.workflowId}/${step.stepId}`);
    }
    if (step.outputFields === undefined) continue;
    if (!Array.isArray(step.outputFields) || step.outputFields.length > 32)
      applicationError('步骤展示输出字段必须是有界数组');
    const paths = new Set<string>();
    for (const rawField of step.outputFields) {
      const field = object(rawField, ['path', 'label'], '步骤展示输出字段');
      text(field.path, '展示输出路径', 512);
      text(field.label, '展示输出名称');
      if (
        !/^[A-Za-z_][A-Za-z_0-9]*(?:\.(?:[A-Za-z_][A-Za-z_0-9]*|0|[1-9][0-9]*))*$/u.test(
          field.path,
        ) ||
        field.path.split('.').some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))
      )
        applicationError(`展示输出字段路径无效：${field.path}`);
      if (paths.has(field.path)) applicationError(`重复展示输出字段：${field.path}`);
      paths.add(field.path);
    }
  }
}

export function validateWorkflowApplicationDefinitionPath(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.json$/u.test(value) ||
    ['application.json', 'installation.json'].includes(value)
  )
    applicationError('应用流程定义必须声明固定包内的 JSON 相对路径');
}

/** 校验并规范化静态图，不加载任何应用执行模块。 */
export function parseWorkflowApplicationDefinition(
  value: unknown,
  manifest?: Pick<WorkflowApplicationManifest, 'id' | 'version'>,
): WorkflowApplicationDefinition {
  const source = typeof value === 'string' ? value : canonicalRuntimeJson(value);
  if (Buffer.byteLength(source, 'utf8') > MAX_DEFINITION_BYTES)
    applicationError('应用流程定义超过大小限制');
  const definition = object(
    JSON.parse(source),
    ['schema', 'application', 'workflows', 'presentation'],
    '应用流程定义',
  );
  if (definition.schema !== 'comet.workflow.application.definition.v1')
    applicationError('应用流程定义格式不受支持');
  const application = object(definition.application, ['id', 'version'], '流程定义应用身份');
  text(application.id, '流程定义应用 ID');
  text(application.version, '流程定义应用版本');
  if (manifest && (manifest.id !== application.id || manifest.version !== application.version))
    applicationError('流程定义与应用固定身份不匹配');
  if (
    !Array.isArray(definition.workflows) ||
    !definition.workflows.length ||
    definition.workflows.length > MAX_WORKFLOWS
  )
    applicationError('应用流程定义必须包含有界的完整流程数组');
  let stepCount = 0;
  let transitionCount = 0;
  const workflows = definition.workflows.map((raw: DefineWorkflowOptions) => {
    if (!raw || typeof raw !== 'object' || !raw.steps || typeof raw.steps !== 'object')
      applicationError('应用流程定义缺少步骤');
    stepCount += Object.keys(raw.steps).length;
    transitionCount += Array.isArray(raw.transitions) ? raw.transitions.length : 0;
    if (stepCount > MAX_STEPS || transitionCount > MAX_TRANSITIONS)
      applicationError('应用流程定义超过步骤或转移数量限制');
    return defineWorkflow(raw);
  });
  const identities = new Set<string>();
  for (const workflow of workflows) {
    const key = JSON.stringify([workflow.id, workflow.version]);
    if (identities.has(key)) applicationError(`重复流程身份：${workflow.id}@${workflow.version}`);
    identities.add(key);
  }
  for (const workflow of workflows)
    for (const [stepId, step] of Object.entries(workflow.steps))
      if (
        step.type === 'child_workflow' &&
        !identities.has(JSON.stringify([step.workflow.id, step.workflow.version]))
      )
        applicationError(`子流程定义不存在：${workflow.id}/${stepId}`);
  if (definition.presentation !== undefined)
    validateWorkflowApplicationPresentation(definition.presentation, workflows);
  return {
    schema: 'comet.workflow.application.definition.v1',
    application: { id: application.id, version: application.version },
    workflows,
    ...(definition.presentation === undefined ? {} : { presentation: definition.presentation }),
  };
}

export function readWorkflowApplicationDefinition(
  files: Readonly<Record<string, string>>,
  manifest: WorkflowApplicationManifest,
): WorkflowApplicationDefinition | undefined {
  if (manifest.definition === undefined) return undefined;
  validateWorkflowApplicationDefinitionPath(manifest.definition);
  if (!Object.hasOwn(files, manifest.definition)) applicationError('固定包缺少声明的应用流程定义');
  return parseWorkflowApplicationDefinition(
    Buffer.from(files[manifest.definition], 'base64').toString('utf8'),
    manifest,
  );
}

export function assertWorkflowApplicationDefinitionMatches(
  definition: WorkflowApplicationDefinition,
  workflows: readonly DefineWorkflowOptions[],
): void {
  const hashes = (items: readonly DefineWorkflowOptions[]) =>
    items
      .map((item) => {
        const normalized = defineWorkflow(item);
        return [normalized.id, normalized.version, hashRuntimeValue(normalized)];
      })
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  if (hashRuntimeValue(hashes(definition.workflows)) !== hashRuntimeValue(hashes(workflows)))
    applicationError('实际工厂的流程与固定流程定义不匹配，请同步确认方案');
}

/** 固定包匹配后，再核对 Run 绑定的主流程及每个子流程定义；无需加载应用模块。 */
export function matchesWorkflowApplicationDefinition(
  definition: WorkflowApplicationDefinition,
  run: Pick<WorkflowRun, 'workflow' | 'definitionHashes'>,
): boolean {
  const hashes = new Map(
    definition.workflows.map((workflow) => [
      JSON.stringify([workflow.id, workflow.version]),
      hashRuntimeValue(workflow),
    ]),
  );
  const current = JSON.stringify([run.workflow.id, run.workflow.version]);
  return (
    hashes.get(current) === run.workflow.hash &&
    run.definitionHashes[current] === run.workflow.hash &&
    Object.entries(run.definitionHashes).every(([key, hash]) => hashes.get(key) === hash)
  );
}
