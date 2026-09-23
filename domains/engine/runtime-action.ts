import { RuntimeProtocolError } from './runtime-errors.js';
import { cloneRuntimeValue, hashRuntimeValue, type RuntimeValue } from './runtime-json.js';

export type RuntimeActionStatus =
  'pending' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'cancelled';
export type RuntimeRetryPolicy = 'idempotent' | 'reconcile' | 'manual';

export interface RuntimeArtifactRef {
  uri: string;
  sha256: string;
}

export interface RuntimeClaim {
  executorId: string;
  sessionId?: string;
  /** 关联当前执行尝试，不代表宿主证明或用户授权。 */
  token: string;
}

export interface RuntimeOutcome {
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
  outcomeId: string;
  status: 'succeeded' | 'failed';
  output: RuntimeValue;
  artifacts?: RuntimeArtifactRef[];
  summary?: string;
  event?: string;
}

export interface RuntimeAction {
  protocolVersion: 1;
  id: string;
  runId: string;
  stepId: string;
  type: string;
  ref?: string;
  attempt: number;
  input: RuntimeValue;
  inputHash: string;
  status: RuntimeActionStatus;
  retry: RuntimeRetryPolicy;
  requiredCapabilities: string[];
  claim?: RuntimeClaim;
  outcome?: RuntimeOutcome;
  receipts: { outcomeId: string; hash: string }[];
  rejectedOutcomes?: {
    outcome: RuntimeOutcome;
    code: 'OUTPUT_INVALID' | 'OUTCOME_REJECTED' | 'OUTCOME_PROCESSING_ERROR';
    reason: string;
  }[];
  reconciliations: { attempt: number; resolution: 'not-executed'; evidence: RuntimeValue }[];
  reason?: string;
}

export interface CreateRuntimeActionOptions {
  id: string;
  runId: string;
  stepId: string;
  type: string;
  ref?: string;
  input: unknown;
  attempt?: number;
  retry?: RuntimeRetryPolicy;
  requiredCapabilities?: string[];
}

function nonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new RuntimeProtocolError('INVALID_ACTION', `${field} 必须是非空字符串且不超过 4096 字符`);
  }
}

function assertBinding(action: RuntimeAction, attempt: number, inputHash: string): void {
  if (attempt !== action.attempt || inputHash !== action.inputHash) {
    throw new RuntimeProtocolError('STALE_ACTION', '执行尝试或输入版本与当前 Action 不一致');
  }
}

function terminal(action: RuntimeAction): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(action.status);
}

export function createRuntimeAction(options: CreateRuntimeActionOptions): RuntimeAction {
  for (const field of ['id', 'runId', 'stepId', 'type'] as const) nonEmpty(options[field], field);
  if (options.ref !== undefined) nonEmpty(options.ref, 'ref');
  const attempt = options.attempt ?? 1;
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'attempt 必须是正安全整数');
  }
  const retry = options.retry ?? 'manual';
  if (!['idempotent', 'reconcile', 'manual'].includes(retry)) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'retry 策略无效');
  }
  const capabilities = options.requiredCapabilities ?? [];
  for (const capability of capabilities) nonEmpty(capability, 'requiredCapabilities');
  const input = cloneRuntimeValue(options.input);
  return {
    protocolVersion: 1,
    id: options.id,
    runId: options.runId,
    stepId: options.stepId,
    type: options.type,
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    attempt,
    input,
    inputHash: hashRuntimeValue(input),
    status: 'pending',
    retry,
    requiredCapabilities: [...new Set(capabilities)],
    receipts: [],
    reconciliations: [],
  };
}

export function claimRuntimeAction(
  action: RuntimeAction,
  input: RuntimeClaim & { attempt: number; inputHash: string },
): RuntimeAction {
  assertBinding(action, input.attempt, input.inputHash);
  nonEmpty(input.executorId, 'executorId');
  nonEmpty(input.token, 'token');
  if (input.sessionId !== undefined) nonEmpty(input.sessionId, 'sessionId');
  const claim: RuntimeClaim = {
    executorId: input.executorId,
    token: input.token,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  };
  if (action.claim) {
    if (hashRuntimeValue(action.claim) === hashRuntimeValue(claim) && action.status === 'running') {
      return structuredClone(action);
    }
    throw new RuntimeProtocolError(
      'ACTION_ALREADY_CLAIMED',
      'Action 已由执行者领取，不能替换其归属',
    );
  }
  if (action.status !== 'pending') {
    throw new RuntimeProtocolError('ACTION_NOT_PENDING', '只有待执行 Action 可以被领取');
  }
  return { ...structuredClone(action), claim, status: 'running' };
}

export function recordRuntimeOutcome(
  action: RuntimeAction,
  outcome: RuntimeOutcome,
): { action: RuntimeAction; duplicate: boolean } {
  outcome = parseRuntimeOutcome(outcome);
  nonEmpty(outcome.outcomeId, 'outcomeId');
  if (!['succeeded', 'failed'].includes(outcome.status)) {
    throw new RuntimeProtocolError('INVALID_OUTCOME', '结果必须声明执行成功或失败');
  }
  if (outcome.event !== undefined) nonEmpty(outcome.event, 'event');
  const receiptHash = hashRuntimeValue(outcome);
  const rejection = action.rejectedOutcomes?.find(
    (entry) => entry.outcome.outcomeId === outcome.outcomeId,
  );
  if (rejection) {
    if (hashRuntimeValue(rejection.outcome) !== receiptHash) {
      throw new RuntimeProtocolError('OUTCOME_CONFLICT', '同一结果标识不能提交不同内容');
    }
    throw new RuntimeProtocolError(rejection.code, rejection.reason);
  }
  const previous = action.receipts.find((receipt) => receipt.outcomeId === outcome.outcomeId);
  if (previous) {
    if (previous.hash !== receiptHash) {
      throw new RuntimeProtocolError('OUTCOME_CONFLICT', '同一结果标识不能提交不同内容');
    }
    return { action: structuredClone(action), duplicate: true };
  }
  assertBinding(action, outcome.attempt, outcome.inputHash);
  if (outcome.actionId !== action.id) {
    throw new RuntimeProtocolError('STALE_ACTION', '结果不属于当前 Action');
  }
  if (terminal(action))
    throw new RuntimeProtocolError('ACTION_TERMINAL', 'Action 已终止，不能接受新结果');
  if (!action.claim || !['running', 'unknown'].includes(action.status)) {
    throw new RuntimeProtocolError('ACTION_NOT_RUNNING', 'Action 尚未交给执行者');
  }
  if (outcome.claimToken !== action.claim.token) {
    throw new RuntimeProtocolError('STALE_ACTION', '结果不属于当前执行者的领取记录');
  }
  for (const artifact of outcome.artifacts ?? []) {
    nonEmpty(artifact.uri, 'artifact.uri');
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new RuntimeProtocolError('INVALID_OUTCOME', '产物引用必须包含 SHA-256');
    }
  }
  return {
    action: {
      ...structuredClone(action),
      status: outcome.status,
      outcome: structuredClone(outcome),
      receipts: [...action.receipts, { outcomeId: outcome.outcomeId, hash: receiptHash }],
    },
    duplicate: false,
  };
}

export function markRuntimeActionUnknown(action: RuntimeAction, reason: string): RuntimeAction {
  nonEmpty(reason, 'reason');
  if (!['running', 'unknown'].includes(action.status)) {
    throw new RuntimeProtocolError(
      'ACTION_NOT_RUNNING',
      '只有已派发 Action 才存在执行结果不明的情况',
    );
  }
  return { ...structuredClone(action), status: 'unknown', reason };
}

export function retryRuntimeAction(
  action: RuntimeAction,
  reconciliation?: { resolution: 'not-executed'; evidence: unknown },
): RuntimeAction {
  if (action.rejectedOutcomes?.some((item) => item.outcome.attempt === action.attempt)) {
    throw new RuntimeProtocolError(
      'OUTCOME_ALREADY_RECORDED',
      '当前执行尝试已记录结果，不能声明未执行并重试；请核对并修正同一次结果',
    );
  }
  if (!['failed', 'unknown'].includes(action.status)) {
    throw new RuntimeProtocolError('ACTION_ACTIVE', '仅失败或待核对的 Action 可以重试');
  }
  if ((action.retry !== 'idempotent' || action.status === 'unknown') && !reconciliation) {
    throw new RuntimeProtocolError(
      'RECONCILIATION_REQUIRED',
      '先核对外部执行结果；不能把断连当作未执行',
    );
  }
  const next = structuredClone(action);
  if (reconciliation) {
    if (reconciliation.resolution !== 'not-executed' || reconciliation.evidence === null) {
      throw new RuntimeProtocolError('RECONCILIATION_REQUIRED', '需要明确的未执行结论与核对证据');
    }
    next.reconciliations.push({
      attempt: action.attempt,
      resolution: 'not-executed',
      evidence: cloneRuntimeValue(reconciliation.evidence),
    });
  }
  if (!Number.isSafeInteger(action.attempt + 1))
    throw new RuntimeProtocolError('INVALID_ACTION', '执行尝试次数溢出');
  next.attempt += 1;
  next.status = 'pending';
  delete next.claim;
  delete next.outcome;
  delete next.reason;
  return next;
}

export function cancelRuntimeAction(action: RuntimeAction, reason: string): RuntimeAction {
  nonEmpty(reason, 'reason');
  if (terminal(action)) return structuredClone(action);
  return { ...structuredClone(action), status: 'cancelled', reason };
}

function keysOnly(
  value: unknown,
  keys: readonly string[],
  code = 'INVALID_ACTION',
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new RuntimeProtocolError(code, '执行记录包含无效结构或未知字段');
  }
}

export function parseRuntimeOutcome(value: unknown): RuntimeOutcome {
  const data = cloneRuntimeValue(value);
  const required = [
    'actionId',
    'attempt',
    'inputHash',
    'claimToken',
    'outcomeId',
    'status',
    'output',
  ];
  keysOnly(data, [...required, 'artifacts', 'summary', 'event'], 'INVALID_OUTCOME');
  if (required.some((field) => !Object.hasOwn(data, field))) {
    throw new RuntimeProtocolError('INVALID_OUTCOME', '执行结果缺少身份、绑定或 output 字段');
  }
  for (const field of ['actionId', 'inputHash', 'claimToken', 'outcomeId'] as const) {
    if (typeof data[field] !== 'string' || !data[field].trim() || data[field].length > 4096) {
      throw new RuntimeProtocolError('INVALID_OUTCOME', `${field} 必须是非空字符串`);
    }
  }
  if (typeof data.attempt !== 'number' || !Number.isSafeInteger(data.attempt) || data.attempt < 1) {
    throw new RuntimeProtocolError('INVALID_OUTCOME', 'attempt 必须是正安全整数');
  }
  if (data.status !== 'succeeded' && data.status !== 'failed') {
    throw new RuntimeProtocolError('INVALID_OUTCOME', 'status 必须是 succeeded 或 failed');
  }
  for (const field of ['summary', 'event'] as const) {
    if (
      data[field] !== undefined &&
      (typeof data[field] !== 'string' || !data[field].trim() || data[field].length > 4096)
    ) {
      throw new RuntimeProtocolError('INVALID_OUTCOME', `${field} 必须是非空字符串`);
    }
  }
  if (data.artifacts !== undefined) {
    if (!Array.isArray(data.artifacts)) {
      throw new RuntimeProtocolError('INVALID_OUTCOME', '产物引用必须是数组');
    }
    for (const artifact of data.artifacts) {
      keysOnly(artifact, ['uri', 'sha256'], 'INVALID_OUTCOME');
      if (
        typeof artifact.uri !== 'string' ||
        !artifact.uri.trim() ||
        typeof artifact.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256)
      ) {
        throw new RuntimeProtocolError('INVALID_OUTCOME', '产物引用必须包含 URI 与 SHA-256');
      }
    }
  }
  return data as unknown as RuntimeOutcome;
}

/** 在持久化/传输边界恢复记录，不从缺失字段推断执行归属或成功状态。 */
export function parseRuntimeAction(value: unknown): RuntimeAction {
  const data = cloneRuntimeValue(value);
  keysOnly(data, [
    'protocolVersion',
    'id',
    'runId',
    'stepId',
    'type',
    'ref',
    'attempt',
    'input',
    'inputHash',
    'status',
    'retry',
    'requiredCapabilities',
    'claim',
    'outcome',
    'receipts',
    'rejectedOutcomes',
    'reconciliations',
    'reason',
  ]);
  if (data.protocolVersion !== 1) {
    throw new RuntimeProtocolError('UNSUPPORTED_PROTOCOL', '当前 Runtime 不支持此 Action 协议版本');
  }
  if (
    !Array.isArray(data.requiredCapabilities) ||
    !Array.isArray(data.receipts) ||
    !Array.isArray(data.reconciliations)
  ) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'Action 缺少能力、结果或核对记录');
  }
  const action = data as unknown as RuntimeAction;
  const normalized = createRuntimeAction(action);
  if (
    action.inputHash !== normalized.inputHash ||
    action.retry !== normalized.retry ||
    action.attempt !== normalized.attempt
  ) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'Action 输入绑定或执行参数不完整');
  }
  if (
    !['pending', 'running', 'unknown', 'succeeded', 'failed', 'cancelled'].includes(action.status)
  ) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'Action 状态无效');
  }
  if (action.reason !== undefined) nonEmpty(action.reason, 'reason');
  if (action.claim !== undefined) {
    keysOnly(action.claim, ['executorId', 'sessionId', 'token']);
    nonEmpty(action.claim.executorId, 'executorId');
    nonEmpty(action.claim.token, 'token');
    if (action.claim.sessionId !== undefined) nonEmpty(action.claim.sessionId, 'sessionId');
  }
  if (
    (action.status === 'pending' && action.claim) ||
    (['running', 'unknown', 'succeeded', 'failed'].includes(action.status) && !action.claim)
  ) {
    throw new RuntimeProtocolError('INVALID_ACTION', 'Action 状态与执行归属不一致');
  }
  const receiptIds = new Set<string>();
  for (const receipt of action.receipts) {
    keysOnly(receipt, ['outcomeId', 'hash']);
    nonEmpty(receipt.outcomeId, 'outcomeId');
    if (!/^[a-f0-9]{64}$/.test(receipt.hash) || receiptIds.has(receipt.outcomeId)) {
      throw new RuntimeProtocolError('INVALID_ACTION', '结果记录的标识或摘要无效');
    }
    receiptIds.add(receipt.outcomeId);
  }
  if (action.rejectedOutcomes !== undefined) {
    if (!Array.isArray(action.rejectedOutcomes)) {
      throw new RuntimeProtocolError('INVALID_ACTION', 'Action 的拒绝结果记录必须是数组');
    }
    const rejectedIds = new Set<string>();
    for (const rejection of action.rejectedOutcomes) {
      keysOnly(rejection, ['outcome', 'code', 'reason']);
      if (
        !['OUTPUT_INVALID', 'OUTCOME_REJECTED', 'OUTCOME_PROCESSING_ERROR'].includes(rejection.code)
      ) {
        throw new RuntimeProtocolError('INVALID_ACTION', 'Action 的拒绝结果代码无效');
      }
      if (typeof rejection.reason !== 'string' || !rejection.reason.trim()) {
        throw new RuntimeProtocolError('INVALID_ACTION', 'Action 的拒绝结果缺少原因');
      }
      const outcome = parseRuntimeOutcome(rejection.outcome);
      const receipt = action.receipts.find((item) => item.outcomeId === outcome.outcomeId);
      if (
        rejectedIds.has(outcome.outcomeId) ||
        !receipt ||
        receipt.hash !== hashRuntimeValue(outcome) ||
        outcome.actionId !== action.id ||
        outcome.inputHash !== action.inputHash ||
        outcome.attempt > action.attempt ||
        (outcome.attempt === action.attempt && action.claim?.token !== outcome.claimToken)
      ) {
        throw new RuntimeProtocolError('INVALID_ACTION', 'Action 的拒绝结果与当前执行记录不一致');
      }
      rejectedIds.add(outcome.outcomeId);
    }
  }
  const reconciledAttempts = new Set<number>();
  for (const reconciliation of action.reconciliations) {
    keysOnly(reconciliation, ['attempt', 'resolution', 'evidence']);
    if (
      !Number.isSafeInteger(reconciliation.attempt) ||
      reconciliation.attempt < 1 ||
      reconciliation.attempt >= action.attempt ||
      reconciledAttempts.has(reconciliation.attempt) ||
      reconciliation.resolution !== 'not-executed' ||
      reconciliation.evidence === null ||
      reconciliation.evidence === undefined
    ) {
      throw new RuntimeProtocolError('INVALID_ACTION', '核对记录与执行尝试不一致');
    }
    reconciledAttempts.add(reconciliation.attempt);
  }
  if (action.status === 'succeeded' || action.status === 'failed') {
    keysOnly(action.outcome, [
      'actionId',
      'attempt',
      'inputHash',
      'claimToken',
      'outcomeId',
      'status',
      'output',
      'artifacts',
      'summary',
      'event',
    ]);
    if (action.outcome.status !== action.status || action.outcome.output === undefined) {
      throw new RuntimeProtocolError('INVALID_ACTION', '终态 Action 缺少匹配的结果');
    }
    const stored = action.receipts.find(
      (receipt) => receipt.outcomeId === action.outcome!.outcomeId,
    );
    if (!stored || stored.hash !== hashRuntimeValue(action.outcome)) {
      throw new RuntimeProtocolError('INVALID_ACTION', '终态结果与已接受摘要不一致');
    }
    recordRuntimeOutcome({ ...action, status: 'running', receipts: [] }, action.outcome);
  } else if (action.outcome !== undefined) {
    throw new RuntimeProtocolError('INVALID_ACTION', '非执行终态不能保存当前执行结果');
  }
  return action;
}
