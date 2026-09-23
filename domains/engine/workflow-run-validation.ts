import { parseRuntimeAction, type RuntimeAction } from './runtime-action.js';
import { RuntimeProtocolError } from './runtime-errors.js';
import { cloneRuntimeValue, hashRuntimeValue, type RuntimeValue } from './runtime-json.js';
import type {
  RuntimeWait,
  WorkflowRef,
  WorkflowResult,
  WorkflowRun,
  WorkflowToken,
} from './workflow-run.js';

type JsonObject = Record<string, RuntimeValue>;

const RUN_FIELDS = [
  'protocolVersion',
  'schemaVersion',
  'runId',
  'revision',
  'workflow',
  'definitionHashes',
  'input',
  'status',
  'sequence',
  'actions',
  'actionContexts',
  'waits',
  'ready',
  'joins',
  'outputs',
  'children',
  'lineage',
  'reason',
];

function invalid(message: string): never {
  throw new RuntimeProtocolError('INVALID_RUN', message);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} 必须是 JSON 对象`);
  }
  return value as JsonObject;
}

function onlyFields(value: JsonObject, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${label} 包含不支持的字段：${key}`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    invalid(`${label} 必须是非空字符串且不超过 4096 字符`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    invalid(`${label} 必须是大于等于 ${minimum} 的安全整数`);
  }
  return value as number;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    invalid(`${label} 必须是 SHA-256 摘要`);
  }
  return value;
}

function reference(
  value: unknown,
  label: string,
  withHash = false,
): WorkflowRef & { hash?: string } {
  const data = object(value, label);
  onlyFields(data, withHash ? ['id', 'version', 'hash'] : ['id', 'version'], label);
  const result: WorkflowRef & { hash?: string } = {
    id: text(data.id, `${label}.id`),
    version: text(data.version, `${label}.version`),
  };
  if (withHash) result.hash = hash(data.hash, `${label}.hash`);
  return result;
}

function parseResults(value: unknown, label: string): Record<string, WorkflowResult> {
  const data = object(value, label);
  const results: Record<string, WorkflowResult> = {};
  for (const [stepId, raw] of Object.entries(data)) {
    text(stepId, `${label} step id`);
    const result = object(raw, `${label}.${stepId}`);
    onlyFields(result, ['sequence', 'value'], `${label}.${stepId}`);
    if (!Object.hasOwn(result, 'sequence') || !Object.hasOwn(result, 'value')) {
      invalid(`${label}.${stepId} 缺少 sequence 或 value`);
    }
    results[stepId] = {
      sequence: integer(result.sequence, `${label}.${stepId}.sequence`, 1),
      value: result.value,
    };
  }
  return results;
}

function parseToken(value: unknown, label: string): WorkflowToken {
  const data = object(value, label);
  onlyFields(data, ['from', 'to', 'results'], label);
  if (
    !Object.hasOwn(data, 'from') ||
    !Object.hasOwn(data, 'to') ||
    !Object.hasOwn(data, 'results')
  ) {
    invalid(`${label} 缺少 from、to 或 results`);
  }
  const from = data.from === null ? null : text(data.from, `${label}.from`);
  return {
    from,
    to: text(data.to, `${label}.to`),
    results: parseResults(data.results, `${label}.results`),
  };
}

function sequenceFromId(id: string, runId: string, label: string, maximum: number): number {
  const prefix = `${runId}:`;
  if (!id.startsWith(prefix)) invalid(`${label} 不属于当前 Run`);
  const suffix = id.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(suffix)) invalid(`${label} 的步骤序号无效`);
  const sequence = Number(suffix);
  if (!Number.isSafeInteger(sequence) || sequence > maximum) {
    invalid(`${label} 的步骤序号超出 Run 范围`);
  }
  return sequence;
}

function parseWait(value: unknown, runId: string, maximum: number): RuntimeWait {
  const data = object(value, 'Wait');
  onlyFields(
    data,
    [
      'id',
      'stepId',
      'sequence',
      'status',
      'proposal',
      'proposalHash',
      'choices',
      'results',
      'decision',
    ],
    'Wait',
  );
  for (const field of [
    'id',
    'stepId',
    'sequence',
    'status',
    'proposal',
    'proposalHash',
    'choices',
    'results',
  ]) {
    if (!Object.hasOwn(data, field)) invalid(`Wait 缺少 ${field}`);
  }
  const id = text(data.id, 'Wait.id');
  const stepId = text(data.stepId, 'Wait.stepId');
  const sequence = integer(data.sequence, 'Wait.sequence', 1);
  if (sequence > maximum || sequenceFromId(id, runId, 'Wait.id', maximum) !== sequence) {
    invalid('Wait 的 id 与 sequence 不一致');
  }
  if (!['pending', 'resolved', 'cancelled'].includes(String(data.status))) {
    invalid('Wait.status 无效');
  }
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    invalid('Wait.choices 必须是非空数组');
  }
  const choices = data.choices.map((choice) => text(choice, 'Wait.choices'));
  if (new Set(choices).size !== choices.length) invalid('Wait.choices 不能重复');
  const proposalHash = hash(data.proposalHash, 'Wait.proposalHash');
  if (hashRuntimeValue(data.proposal) !== proposalHash) {
    invalid('Wait.proposal 与 proposalHash 不一致');
  }
  const result: RuntimeWait = {
    id,
    stepId,
    sequence,
    status: data.status as RuntimeWait['status'],
    proposal: data.proposal,
    proposalHash,
    choices,
    results: parseResults(data.results, 'Wait.results'),
  };
  if (data.decision !== undefined) {
    const decision = object(data.decision, 'Wait.decision');
    onlyFields(decision, ['id', 'choice', 'proposalHash'], 'Wait.decision');
    const decisionValue = {
      id: text(decision.id, 'Wait.decision.id'),
      choice: text(decision.choice, 'Wait.decision.choice'),
      proposalHash: hash(decision.proposalHash, 'Wait.decision.proposalHash'),
    };
    if (
      data.status !== 'resolved' ||
      !choices.includes(decisionValue.choice) ||
      decisionValue.proposalHash !== proposalHash
    ) {
      invalid('Wait.decision 与 Wait 状态、选择或提案不一致');
    }
    result.decision = decisionValue;
  } else if (data.status === 'resolved') {
    invalid('已解决的 Wait 必须保存对应 decision');
  }
  return result;
}

/** 在恢复边界完整验证 Run 聚合，并返回与持久化输入隔离的副本。 */
export function parseWorkflowRun(value: unknown, expectedRunId?: string): WorkflowRun {
  const data = object(cloneRuntimeValue(value), 'WorkflowRun');
  onlyFields(data, RUN_FIELDS, 'WorkflowRun');
  for (const field of RUN_FIELDS.filter((field) => field !== 'reason')) {
    if (!Object.hasOwn(data, field)) invalid(`WorkflowRun 缺少 ${field}`);
  }
  if (data.protocolVersion !== 1 || data.schemaVersion !== 1) {
    throw new RuntimeProtocolError(
      'UNSUPPORTED_PROTOCOL',
      '当前 Runtime 不支持此 Run 协议或状态版本',
    );
  }

  const runId = text(data.runId, 'WorkflowRun.runId');
  if (expectedRunId !== undefined && runId !== expectedRunId) {
    invalid('WorkflowRun.runId 与存储键不一致');
  }
  const revision = integer(data.revision, 'WorkflowRun.revision', 1);
  const sequence = integer(data.sequence, 'WorkflowRun.sequence');
  const workflow = reference(data.workflow, 'WorkflowRun.workflow', true) as WorkflowRef & {
    hash: string;
  };
  if (!['running', 'waiting', 'completed', 'failed', 'cancelled'].includes(String(data.status))) {
    invalid('WorkflowRun.status 无效');
  }
  if (data.reason !== undefined) text(data.reason, 'WorkflowRun.reason');
  if (!Object.hasOwn(data, 'input')) invalid('WorkflowRun 缺少 input');

  const definitionHashes = object(data.definitionHashes, 'WorkflowRun.definitionHashes');
  if (Object.keys(definitionHashes).length === 0) invalid('WorkflowRun.definitionHashes 不能为空');
  for (const [key, value] of Object.entries(definitionHashes)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key);
    } catch {
      invalid('WorkflowRun.definitionHashes 包含无效的工作流引用');
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      JSON.stringify(parsed) !== key
    ) {
      invalid('WorkflowRun.definitionHashes 包含非规范的工作流引用');
    }
    hash(value, `WorkflowRun.definitionHashes.${key}`);
  }
  const rootKey = JSON.stringify([workflow.id, workflow.version]);
  if (definitionHashes[rootKey] !== workflow.hash) {
    invalid('WorkflowRun.workflow 与固定定义摘要不一致');
  }

  if (!Array.isArray(data.lineage) || data.lineage.length > 32) {
    invalid('WorkflowRun.lineage 必须是最多 32 层的数组');
  }
  const lineage = data.lineage.map((entry) => text(entry, 'WorkflowRun.lineage'));
  if (new Set(lineage).size !== lineage.length || lineage.includes(runId)) {
    invalid('WorkflowRun.lineage 不能重复或包含当前 Run');
  }

  if (!Array.isArray(data.actions) || !Array.isArray(data.waits)) {
    invalid('WorkflowRun.actions 和 waits 必须是数组');
  }
  const actions: RuntimeAction[] = data.actions.map((raw) => {
    let action: RuntimeAction;
    try {
      action = parseRuntimeAction(raw);
    } catch (error) {
      if (error instanceof RuntimeProtocolError && error.code === 'UNSUPPORTED_PROTOCOL')
        throw error;
      invalid(`WorkflowRun.actions 包含无效 Action：${(error as Error).message}`);
    }
    if (action.runId !== runId) invalid(`Action ${action.id} 不属于当前 Run`);
    if (new Set(action.requiredCapabilities).size !== action.requiredCapabilities.length) {
      invalid(`Action ${action.id} 的 requiredCapabilities 不能重复`);
    }
    return action;
  });
  const waits = data.waits.map((wait) => parseWait(wait, runId, sequence));
  const sequences = new Map<number, string>();
  for (const action of actions) {
    const actionSequence = sequenceFromId(action.id, runId, 'Action.id', sequence);
    if (sequences.has(actionSequence)) invalid('WorkflowRun 的步骤序号不能重复');
    sequences.set(actionSequence, action.stepId);
  }
  for (const wait of waits) {
    if (sequences.has(wait.sequence)) invalid('WorkflowRun 的步骤序号不能重复');
    sequences.set(wait.sequence, wait.stepId);
  }
  if (sequences.size !== sequence) invalid('WorkflowRun.sequence 与已激活步骤数量不一致');

  const actionContexts = object(data.actionContexts, 'WorkflowRun.actionContexts');
  if (Object.keys(actionContexts).length !== actions.length) {
    invalid('WorkflowRun.actionContexts 必须与 actions 一一对应');
  }
  const checkedResults = new Set<Record<string, WorkflowResult>>();
  function validateResultOrigins(results: Record<string, WorkflowResult>, before?: number): void {
    if (checkedResults.has(results)) return;
    checkedResults.add(results);
    for (const [stepId, result] of Object.entries(results)) {
      if (
        result.sequence >= (before ?? sequence + 1) ||
        sequences.get(result.sequence) !== stepId
      ) {
        invalid(`WorkflowRun 结果 ${stepId} 的序号或来源不一致`);
      }
    }
  }
  for (const action of actions) {
    if (!Object.hasOwn(actionContexts, action.id)) invalid(`Action ${action.id} 缺少上下文`);
    const context = object(actionContexts[action.id], `actionContexts.${action.id}`);
    onlyFields(context, ['sequence', 'results'], `actionContexts.${action.id}`);
    const contextSequence = integer(context.sequence, `actionContexts.${action.id}.sequence`, 1);
    if (contextSequence !== sequenceFromId(action.id, runId, 'Action.id', sequence)) {
      invalid(`Action ${action.id} 的上下文序号不一致`);
    }
    const results = parseResults(context.results, `actionContexts.${action.id}.results`);
    validateResultOrigins(results, contextSequence);
  }
  for (const wait of waits) validateResultOrigins(wait.results, wait.sequence);

  if (!Array.isArray(data.ready)) invalid('WorkflowRun.ready 必须是数组');
  const ready = data.ready.map((token) => parseToken(token, 'WorkflowRun.ready token'));
  for (const token of ready) validateResultOrigins(token.results);

  const joinsData = object(data.joins, 'WorkflowRun.joins');
  const joins: Record<string, Record<string, WorkflowToken[]>> = {};
  for (const [stepId, rawQueues] of Object.entries(joinsData)) {
    text(stepId, 'WorkflowRun.joins step id');
    const queues = object(rawQueues, `WorkflowRun.joins.${stepId}`);
    const parsedQueues: Record<string, WorkflowToken[]> = {};
    for (const [parentId, rawQueue] of Object.entries(queues)) {
      text(parentId, 'WorkflowRun.joins parent id');
      if (!Array.isArray(rawQueue)) invalid(`WorkflowRun.joins.${stepId}.${parentId} 必须是数组`);
      parsedQueues[parentId] = rawQueue.map((rawToken) => {
        const token = parseToken(rawToken, `WorkflowRun.joins.${stepId}.${parentId}`);
        if (token.to !== stepId || token.from !== parentId) {
          invalid(`WorkflowRun.joins.${stepId}.${parentId} 包含错误来源的 token`);
        }
        validateResultOrigins(token.results);
        return token;
      });
    }
    joins[stepId] = parsedQueues;
  }

  const outputs = parseResults(data.outputs, 'WorkflowRun.outputs');
  validateResultOrigins(outputs);
  if (!Array.isArray(data.children)) invalid('WorkflowRun.children 必须是数组');
  const children = data.children.map((rawChild) => {
    const child = object(rawChild, 'WorkflowRun.children item');
    onlyFields(child, ['actionId', 'runId', 'workflow'], 'WorkflowRun.children item');
    const childWorkflow = reference(child.workflow, 'WorkflowRun.children.workflow');
    const actionId = text(child.actionId, 'WorkflowRun.children.actionId');
    const childRunId = text(child.runId, 'WorkflowRun.children.runId');
    const action = actions.find((candidate) => candidate.id === actionId);
    if (
      !action ||
      action.type !== 'child_workflow' ||
      action.ref !== `${childWorkflow.id}@${childWorkflow.version}` ||
      childRunId !== `child-${hashRuntimeValue(actionId)}` ||
      !Object.hasOwn(definitionHashes, JSON.stringify([childWorkflow.id, childWorkflow.version]))
    ) {
      invalid('WorkflowRun.children 与子工作流 Action 或固定定义不一致');
    }
    return { actionId, runId: childRunId, workflow: childWorkflow };
  });
  const childActionIds = new Set(children.map((child) => child.actionId));
  if (
    childActionIds.size !== children.length ||
    actions.filter((action) => action.type === 'child_workflow').length !== children.length
  ) {
    invalid('每个子工作流 Action 必须恰好对应一个 Child Run');
  }

  const activeAction = actions.some((action) =>
    ['pending', 'running', 'unknown'].includes(action.status),
  );
  const pendingWait = waits.some((wait) => wait.status === 'pending');
  const incompleteJoin = Object.values(joins).some((queues) =>
    Object.values(queues).some((queue) => queue.length > 0),
  );
  if (data.status === 'running' && !activeAction) {
    invalid('running Run 必须包含待执行或已派发的 Action');
  }
  if (
    data.status === 'waiting' &&
    (activeAction || (!pendingWait && !incompleteJoin) || ready.length > 0)
  ) {
    invalid('waiting Run 必须只有未解决的 Wait 或不完整 join');
  }
  if (
    data.status === 'completed' &&
    (activeAction || pendingWait || incompleteJoin || ready.length > 0)
  ) {
    invalid('completed Run 不能遗留待执行、等待或 join 工作');
  }
  if ((data.status === 'failed' || data.status === 'cancelled') && data.reason === undefined) {
    invalid(`${String(data.status)} Run 必须记录停止原因`);
  }

  return {
    protocolVersion: 1,
    schemaVersion: 1,
    runId,
    revision,
    workflow,
    definitionHashes: definitionHashes as Record<string, string>,
    input: data.input,
    status: data.status as WorkflowRun['status'],
    sequence,
    actions,
    actionContexts: actionContexts as unknown as WorkflowRun['actionContexts'],
    waits,
    ready,
    joins,
    outputs,
    children,
    lineage,
    ...(data.reason === undefined ? {} : { reason: data.reason as string }),
  };
}
