import type {
  MemoryKind,
  MemoryLanguage,
  MemoryClass,
  MemoryReviewAction,
  MemoryReviewActionSet,
  MemoryReviewPacket,
  MemoryReviewMemorySummary,
  MemoryReviewRequest,
  MemoryScope,
} from './types.js';
import { isMemoryClass } from './types.js';

export const MEMORY_REVIEW_PACKET_SCHEMA = 'comet.memory.review.v1' as const;
export const MEMORY_REVIEW_ACTIONS_SCHEMA = 'comet.memory.actions.v1' as const;

export const MEMORY_REVIEW_LIMITS = {
  maxEvidenceAgeMs: 180 * 24 * 60 * 60 * 1000,
} as const;

const DANGEROUS_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|authorization)\s*[:=]\s*\S+/iu,
  /\b(?:sk|rk)-[a-z0-9]{16,}\b/iu,
  /\b(?:ghp|gho|github_pat|xox[baprs]|AIza)[-_][a-z0-9_-]{8,}\b/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /\b\+?\d[\d ()-]{7,}\d\b/u,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u,
  /\b(?:diff --git|git\s+(?:diff|log)|@@\s+-\d|\+\+\+\s+[ab]\/|---\s+[ab]\/)/imu,
  /\b(?:stack trace|traceback|stderr|stdout|debug log|npm warn|npm ERR!|error log)\b/iu,
  /(?:ignore|disregard|override|forget|do not follow)\s+(?:all\s+)?(?:my\s+|the\s+)?(?:prior|previous|earlier|above|following|these)?\s*(?:instructions?|rules?|policies?|system|prompt)/iu,
  /(?:modify|change|edit|rewrite|disable|reveal)\s+(?:the\s+)?(?:skill|agent instructions?|project rules?|project policy files?|system prompt|guard|policy)/iu,
  /(?:忽略|无视|跳过|不遵循|不要遵循).*(?:之前|先前|上面|以上|前面)?.*(?:指令|规则|提示|政策|系统)/u,
  /(?:修改|更改|编辑|重写|禁用|绕过|泄露|显示).*(?:技能|skill|agent|代理|项目规范文件|项目规则|系统提示|守卫|策略|规则)/iu,
  /<\/?(?:script|iframe|object|embed|style|svg)\b|(?:onerror|onload|onclick)\s*=|data:text\/html/iu,
  /javascript:/iu,
];

export interface MemoryReviewValidationOptions {
  readonly maxActions?: number;
  readonly maxEvidence?: number;
  readonly maxBytes?: number;
}

export function validateMemoryReviewPacket(
  value: unknown,
  options: MemoryReviewValidationOptions = {},
): MemoryReviewPacket {
  const object = asObject(value, 'review packet');
  if (object.schema !== MEMORY_REVIEW_PACKET_SCHEMA) {
    throw new Error(`Unsupported memory review packet schema: ${String(object.schema)}`);
  }
  const language = asLanguage(object.language, 'review packet language');
  const projectIdentity = optionalString(object.projectIdentity, 'projectIdentity');
  const projectKey = optionalProjectKey(object.projectKey);
  if (projectKey !== undefined && projectIdentity === undefined) {
    throw new Error('Review packet project key requires a stable project identity');
  }
  const workflow = requiredString(object.workflow, 'workflow');
  const changeId = requiredString(object.changeId, 'changeId');
  const createdAt = requiredTimestamp(object.createdAt, 'createdAt');
  const checkpoint = requiredString(object.checkpoint, 'checkpoint');
  const category = optionalString(object.category, 'category');
  if (category !== undefined && object.explicitRequest === undefined)
    validateLanguageText(category, language, 'category');
  const budget = normalizeBudget(object.budget, options);
  const userEvidence = boundedStrings(object.userEvidence, 'userEvidence', 8, true);
  const explicitRequest = normalizeReviewRequest(object.explicitRequest, language);
  const evidence = asArray(object.evidence, 'evidence');
  const normalizedEvidence = evidence.map((entry, index) => {
    const item = asObject(entry, `evidence[${index}]`);
    const key = requiredString(item.key, `evidence[${index}].key`);
    const scope = asScope(item.scope, `evidence[${index}].scope`);
    const evidenceProjectKey = optionalProjectKey(item.projectKey);
    const evidenceProjectIdentity = optionalString(
      item.projectIdentity,
      `evidence[${index}].projectIdentity`,
    );
    if (evidenceProjectKey !== undefined && evidenceProjectIdentity === undefined) {
      throw new Error(`evidence[${index}] project key requires a stable project identity`);
    }
    if (scope === 'project' && evidenceProjectKey === undefined) {
      throw new Error(`evidence[${index}] project evidence requires a project key`);
    }
    if (scope === 'global' && evidenceProjectIdentity === undefined) {
      throw new Error(`evidence[${index}] global evidence requires a project identity`);
    }
    const candidateKey = optionalSafeKey(item.candidateKey, `evidence[${index}].candidateKey`);
    const evidenceChangeId = requiredString(item.changeId, `evidence[${index}].changeId`);
    if (typeof item.success !== 'boolean') {
      throw new Error(`evidence[${index}].success is invalid`);
    }
    const observedAt = requiredTimestamp(item.observedAt, `evidence[${index}].observedAt`);
    const evidenceAge = Date.parse(createdAt) - Date.parse(observedAt);
    if (evidenceAge < 0 || evidenceAge > MEMORY_REVIEW_LIMITS.maxEvidenceAgeMs) {
      throw new Error(`evidence[${index}] is outside the freshness window`);
    }
    const evidenceText = optionalString(item.text, `evidence[${index}].text`);
    if (evidenceText !== undefined) validateSafeText(evidenceText, `evidence[${index}].text`);
    const evidenceCategory = optionalString(item.category, `evidence[${index}].category`);
    const evidenceMemoryClass = optionalMemoryClass(
      item.memoryClass,
      `evidence[${index}].memoryClass`,
    );
    if (evidenceCategory !== undefined && object.explicitRequest === undefined)
      validateLanguageText(evidenceCategory, language, `evidence[${index}].category`);
    const evidenceArrays = optionalEvidenceArrays(item, language, index);
    return {
      key,
      scope,
      ...(evidenceProjectIdentity === undefined
        ? {}
        : { projectIdentity: evidenceProjectIdentity }),
      ...(evidenceProjectKey === undefined ? {} : { projectKey: evidenceProjectKey }),
      ...(candidateKey === undefined ? {} : { candidateKey }),
      changeId: evidenceChangeId,
      success: item.success,
      observedAt,
      ...(evidenceText === undefined ? {} : { text: evidenceText }),
      ...(evidenceCategory === undefined ? {} : { category: evidenceCategory }),
      ...(evidenceMemoryClass === undefined ? {} : { memoryClass: evidenceMemoryClass }),
      ...evidenceArrays,
    };
  });
  const evidenceKeys = new Set(normalizedEvidence.map((entry) => entry.key));
  if (evidenceKeys.size !== normalizedEvidence.length) {
    throw new Error('Review packet evidence keys must be unique');
  }
  const memories = asArray(object.memories, 'memories');
  const normalizedMemories: MemoryReviewMemorySummary[] = memories.map((entry, index) => {
    const item = asObject(entry, `memories[${index}]`);
    const id = requiredString(item.id, `memories[${index}].id`);
    const scope = asScope(item.scope, `memories[${index}].scope`);
    const memoryProjectIdentity = optionalString(
      item.projectIdentity,
      `memories[${index}].projectIdentity`,
    );
    const memoryProjectKey = optionalProjectKey(item.projectKey);
    if (scope === 'project' && memoryProjectKey === undefined) {
      throw new Error(`memories[${index}] project memory requires a project key`);
    }
    if (scope === 'global' && memoryProjectKey !== undefined) {
      throw new Error(`memories[${index}] global memory must not have a project key`);
    }
    const category = requiredString(item.category, `memories[${index}].category`);
    const text = requiredString(item.text, `memories[${index}].text`);
    const title = optionalString(item.title, `memories[${index}].title`);
    const reason = optionalString(item.reason, `memories[${index}].reason`);
    const memoryClass = optionalMemoryClass(item.memoryClass, `memories[${index}].memoryClass`);
    validateSafeText(category, `memories[${index}].category`);
    validateSafeText(text, `memories[${index}].text`);
    if (title !== undefined) validateLanguageText(title, language, `memories[${index}].title`);
    if (reason !== undefined) validateLanguageText(reason, language, `memories[${index}].reason`);
    const kind: MemoryKind =
      item.kind === 'explicit' || item.kind === 'inferred' ? item.kind : invalid('kind');
    const memoryType =
      item.memoryType === 'core-profile' ||
      item.memoryType === 'collaboration-policy' ||
      item.memoryType === 'personal-episode'
        ? item.memoryType
        : invalid('memoryType');
    const state =
      item.state === 'trial' || item.state === 'proven' || item.state === 'superseded'
        ? item.state
        : invalid('state');
    return {
      id,
      scope,
      ...(memoryProjectIdentity === undefined ? {} : { projectIdentity: memoryProjectIdentity }),
      ...(memoryProjectKey === undefined ? {} : { projectKey: memoryProjectKey }),
      category,
      text,
      ...(title === undefined ? {} : { title }),
      ...(reason === undefined ? {} : { reason }),
      ...(memoryClass === undefined ? {} : { memoryClass }),
      kind,
      memoryType,
      state,
    };
  });
  const memoryIds = new Set(normalizedMemories.map((entry) => entry.id));
  if (memoryIds.size !== normalizedMemories.length) {
    throw new Error('Review packet memory IDs must be unique');
  }
  return {
    schema: MEMORY_REVIEW_PACKET_SCHEMA,
    language,
    ...(projectIdentity === undefined ? {} : { projectIdentity }),
    ...(projectKey === undefined ? {} : { projectKey }),
    workflow,
    changeId,
    createdAt,
    checkpoint,
    ...(category === undefined ? {} : { category }),
    userEvidence,
    ...(explicitRequest === undefined ? {} : { explicitRequest }),
    evidence: normalizedEvidence,
    memories: normalizedMemories,
    budget,
  };
}

function normalizeReviewRequest(
  value: unknown,
  language: MemoryLanguage,
): MemoryReviewRequest | undefined {
  if (value === undefined) return undefined;
  const request = asObject(value, 'explicitRequest');
  const action = request.action;
  if (action !== 'remember' && action !== 'correct' && action !== 'forget') {
    throw new Error('explicitRequest.action is invalid');
  }
  const targetId = optionalString(request.targetId, 'explicitRequest.targetId');
  const permanent =
    request.permanent === undefined
      ? undefined
      : typeof request.permanent === 'boolean'
        ? request.permanent
        : (() => {
            throw new Error('explicitRequest.permanent is invalid');
          })();
  const scope =
    request.scope === undefined ? undefined : asScope(request.scope, 'explicitRequest.scope');
  const projectKey = optionalProjectKey(request.projectKey);
  if (scope === 'project' && projectKey === undefined) {
    throw new Error('explicitRequest project action requires a project key');
  }
  if (scope === 'global' && projectKey !== undefined) {
    throw new Error('explicitRequest global action must not have a project key');
  }
  const category = optionalString(request.category, 'explicitRequest.category');
  const memoryClass = optionalMemoryClass(request.memoryClass, 'explicitRequest.memoryClass');
  const title = optionalString(request.title, 'explicitRequest.title');
  const reason = optionalString(request.reason, 'explicitRequest.reason');
  const text = optionalString(request.text, 'explicitRequest.text');
  if (text !== undefined) validateSafeText(text, 'explicitRequest.text');
  const arrays = normalizeRequestArrays(request, language, true);
  if (action === 'remember' && text === undefined) {
    throw new Error('explicitRequest remember requires text');
  }
  if (action !== 'forget' && permanent !== undefined) {
    throw new Error(`explicitRequest ${action} must not set permanent`);
  }
  if (action !== 'remember' && targetId === undefined) {
    throw new Error(`explicitRequest ${action} requires targetId`);
  }
  if (
    action === 'correct' &&
    text === undefined &&
    category === undefined &&
    title === undefined &&
    reason === undefined &&
    Object.keys(arrays).length === 0
  ) {
    throw new Error('explicitRequest correct must change a memory field');
  }
  if (
    action === 'forget' &&
    (text !== undefined ||
      category !== undefined ||
      title !== undefined ||
      reason !== undefined ||
      Object.keys(arrays).length > 0)
  ) {
    throw new Error('explicitRequest forget must not change memory fields');
  }
  return {
    action,
    ...(targetId === undefined ? {} : { targetId }),
    ...(permanent === undefined ? {} : { permanent }),
    ...(scope === undefined ? {} : { scope }),
    ...(projectKey === undefined ? {} : { projectKey }),
    ...(category === undefined ? {} : { category }),
    ...(memoryClass === undefined ? {} : { memoryClass }),
    ...(title === undefined ? {} : { title }),
    ...(reason === undefined ? {} : { reason }),
    ...(text === undefined ? {} : { text }),
    ...arrays,
  };
}

function normalizeRequestArrays(
  value: Record<string, unknown>,
  language: MemoryLanguage,
  skipLanguageValidation = false,
): {
  tags?: string[];
  pathPatterns?: string[];
  taskTypes?: string[];
  operations?: string[];
  phases?: string[];
} {
  const result: {
    tags?: string[];
    pathPatterns?: string[];
    taskTypes?: string[];
    operations?: string[];
    phases?: string[];
  } = {};
  for (const name of ['tags', 'pathPatterns', 'taskTypes', 'operations', 'phases'] as const) {
    if (value[name] === undefined) continue;
    const entries = boundedStrings(value[name], `explicitRequest.${name}`, 16, false);
    entries.forEach((entry, index) => {
      if (name === 'tags' && !skipLanguageValidation) {
        validateLanguageText(entry, language, `explicitRequest.${name}[${index}]`);
      } else {
        validateSafeText(entry, `explicitRequest.${name}[${index}]`);
      }
    });
    result[name] = entries;
  }
  return result;
}

export function validateMemoryReviewActions(
  packet: MemoryReviewPacket,
  value: unknown,
  options: MemoryReviewValidationOptions = {},
): MemoryReviewActionSet {
  const envelope = asObject(value, 'review actions');
  if (envelope.schema !== MEMORY_REVIEW_ACTIONS_SCHEMA) {
    throw new Error(`Unsupported memory review action schema: ${String(envelope.schema)}`);
  }
  const actions = asArray(envelope.actions, 'review actions.actions');
  void options;
  const evidenceKeys = new Set(packet.evidence.map((entry) => entry.key));
  const memoryIds = new Set(packet.memories.map((entry) => entry.id));
  const actionScopes = new Set<MemoryScope>();
  const normalized: MemoryReviewAction[] = actions.map((value, index): MemoryReviewAction => {
    const action = asObject(value, `actions[${index}]`);
    const kind = action.action;
    if (!isActionKind(kind)) throw new Error(`Unknown memory review action: ${String(kind)}`);
    const language = asLanguage(action.language, `actions[${index}].language`);
    if (language !== packet.language)
      throw new Error(`actions[${index}] language does not match packet`);
    const scope =
      action.scope === undefined ? undefined : asScope(action.scope, `actions[${index}].scope`);
    const projectKey = optionalProjectKey(action.projectKey);
    if (scope === 'project' && projectKey === undefined) {
      throw new Error(`actions[${index}] project action requires a project key`);
    }
    if (scope === 'global' && projectKey !== undefined) {
      throw new Error(`actions[${index}] global action must not have a project key`);
    }
    assertActionProjectContext(packet, scope, projectKey, index);
    const candidateKey = optionalSafeKey(action.candidateKey, `actions[${index}].candidateKey`);
    const actionEvidence =
      action.evidenceKeys === undefined
        ? []
        : boundedStrings(
            action.evidenceKeys,
            `actions[${index}].evidenceKeys`,
            packet.evidence.length,
            false,
          );
    for (const key of actionEvidence) {
      if (!evidenceKeys.has(key)) throw new Error(`actions[${index}] references unknown evidence`);
    }
    const reason = optionalString(action.reason, `actions[${index}].reason`);
    if (reason !== undefined) validateLanguageText(reason, language, `actions[${index}].reason`);
    const title = optionalString(action.title, `actions[${index}].title`);
    if (title !== undefined) validateLanguageText(title, language, `actions[${index}].title`);
    const memoryClass = optionalMemoryClass(action.memoryClass, `actions[${index}].memoryClass`);
    if (kind === 'skip') {
      if (reason === undefined) throw new Error(`actions[${index}] skip requires a reason`);
      if (scope !== undefined) actionScopes.add(scope);
      return { action: 'skip', language, reason, evidenceKeys: actionEvidence };
    }
    if (kind === 'forget') {
      const targetId = requiredString(action.targetId, `actions[${index}].targetId`);
      const target = assertTarget(packet, memoryIds, targetId, index);
      assertTargetMatches(target, scope, projectKey, index);
      assertTargetProjectContext(packet, target, index);
      assertTargetActive(target, index);
      actionScopes.add(scope ?? target.scope);
      validateActionEvidence(
        packet,
        actionEvidence,
        scope ?? target.scope,
        projectKey ?? target.projectKey,
        candidateKey,
        index,
        false,
      );
      return {
        action: 'forget',
        language,
        targetId,
        ...(typeof action.permanent === 'boolean' ? { permanent: action.permanent } : {}),
        evidenceKeys: actionEvidence,
        ...(reason === undefined ? {} : { reason }),
        ...(title === undefined ? {} : { title }),
      };
    }
    if (kind === 'create') {
      if (scope === undefined) throw new Error(`actions[${index}] create requires a scope`);
      actionScopes.add(scope);
      const category = requiredString(action.category, `actions[${index}].category`);
      const text = requiredString(action.text, `actions[${index}].text`);
      if (packet.explicitRequest === undefined) {
        validateLanguageText(category, language, `actions[${index}].category`);
        validateLanguageText(text, language, `actions[${index}].text`);
      }
      validateActionEvidence(packet, actionEvidence, scope, projectKey, candidateKey, index, true);
      return {
        action: 'create',
        language,
        scope,
        ...(projectKey === undefined ? {} : { projectKey }),
        ...(candidateKey === undefined ? {} : { candidateKey }),
        category,
        text,
        evidenceKeys: actionEvidence,
        ...(reason === undefined ? {} : { reason }),
        ...(title === undefined ? {} : { title }),
        ...(memoryClass === undefined ? {} : { memoryClass }),
        ...optionalArrays(action, language, index, packet.explicitRequest !== undefined),
      };
    }
    const targetId = requiredString(action.targetId, `actions[${index}].targetId`);
    const target = assertTarget(packet, memoryIds, targetId, index);
    assertTargetMatches(target, scope, projectKey, index);
    assertTargetProjectContext(packet, target, index);
    assertTargetActive(target, index);
    actionScopes.add(scope ?? target.scope);
    const text = optionalString(action.text, `actions[${index}].text`);
    const category = optionalString(action.category, `actions[${index}].category`);
    if (text === undefined && category === undefined && !hasArrayUpdate(action)) {
      throw new Error(`actions[${index}] update must change a memory field`);
    }
    if (packet.explicitRequest === undefined && text !== undefined)
      validateLanguageText(text, language, `actions[${index}].text`);
    if (packet.explicitRequest === undefined && category !== undefined)
      validateLanguageText(category, language, `actions[${index}].category`);
    validateActionEvidence(
      packet,
      actionEvidence,
      scope ?? target.scope,
      projectKey ?? target.projectKey,
      candidateKey,
      index,
      true,
    );
    return {
      action: 'update',
      language,
      targetId,
      ...(scope === undefined ? {} : { scope }),
      ...(projectKey === undefined ? {} : { projectKey }),
      ...(candidateKey === undefined ? {} : { candidateKey }),
      ...(text === undefined ? {} : { text }),
      ...(category === undefined ? {} : { category }),
      evidenceKeys: actionEvidence,
      ...(reason === undefined ? {} : { reason }),
      ...(title === undefined ? {} : { title }),
      ...(memoryClass === undefined ? {} : { memoryClass }),
      ...optionalArrays(action, language, index, packet.explicitRequest !== undefined),
    };
  });
  if (actionScopes.size > 1) {
    throw new Error('Memory review action set must not mix global and project scopes');
  }
  return { schema: MEMORY_REVIEW_ACTIONS_SCHEMA, actions: normalized };
}

export function validateSafeMemoryText(value: string): void {
  validateSafeText(value, 'memory text');
}

export function validateMemoryLanguageText(
  value: string,
  language: MemoryLanguage,
  field = 'memory text',
): void {
  validateLanguageText(value, language, field);
}

function normalizeBudget(
  value: unknown,
  options: MemoryReviewValidationOptions,
): {
  maxActions: number;
  maxEvidence: number;
  maxBytes: number;
} {
  const budget = asObject(value, 'budget');
  void options;
  const maxActions = requiredPositiveNumber(budget.maxActions, 'budget.maxActions');
  const maxEvidence = requiredPositiveNumber(budget.maxEvidence, 'budget.maxEvidence');
  const maxBytes = requiredPositiveNumber(budget.maxBytes, 'budget.maxBytes');
  return { maxActions, maxEvidence, maxBytes };
}

function optionalArrays(
  value: Record<string, unknown>,
  language: MemoryLanguage,
  actionIndex: number,
  skipLanguageValidation = false,
): {
  tags?: string[];
  pathPatterns?: string[];
  taskTypes?: string[];
  operations?: string[];
  phases?: string[];
} {
  const result: {
    tags?: string[];
    pathPatterns?: string[];
    taskTypes?: string[];
    operations?: string[];
    phases?: string[];
  } = {};
  for (const name of ['tags', 'pathPatterns', 'taskTypes', 'operations', 'phases'] as const) {
    if (value[name] === undefined) continue;
    const values = boundedStrings(value[name], name, 16, false);
    values.forEach((entry, index) => {
      if (name === 'tags' && !skipLanguageValidation) {
        validateLanguageText(entry, language, `actions[${actionIndex}].tags[${index}]`);
      } else {
        validateSafeText(entry, name);
      }
    });
    result[name] = values;
  }
  return result;
}

function optionalEvidenceArrays(
  value: Record<string, unknown>,
  language: MemoryLanguage,
  evidenceIndex: number,
): {
  tags?: string[];
  pathPatterns?: string[];
  taskTypes?: string[];
  operations?: string[];
  phases?: string[];
} {
  const result: {
    tags?: string[];
    pathPatterns?: string[];
    taskTypes?: string[];
    operations?: string[];
    phases?: string[];
  } = {};
  for (const name of ['tags', 'pathPatterns', 'taskTypes', 'operations', 'phases'] as const) {
    if (value[name] === undefined) continue;
    const values = boundedStrings(value[name], `evidence[${evidenceIndex}].${name}`, 16, false);
    values.forEach((entry, index) => {
      if (name === 'tags') {
        validateLanguageText(entry, language, `evidence[${evidenceIndex}].${name}[${index}]`);
      } else {
        validateSafeText(entry, `evidence[${evidenceIndex}].${name}[${index}]`);
      }
    });
    result[name] = values;
  }
  return result;
}

function hasArrayUpdate(value: Record<string, unknown>): boolean {
  return ['tags', 'pathPatterns', 'taskTypes', 'operations', 'phases'].some(
    (name) => value[name] !== undefined,
  );
}

function assertTarget(
  packet: MemoryReviewPacket,
  ids: ReadonlySet<string>,
  targetId: string,
  index: number,
): MemoryReviewPacket['memories'][number] {
  if (!ids.has(targetId)) throw new Error(`actions[${index}] references an unknown target`);
  const target = packet.memories.find((entry) => entry.id === targetId);
  if (target === undefined) throw new Error(`actions[${index}] references an unknown target`);
  return target;
}

function assertTargetMatches(
  target: MemoryReviewPacket['memories'][number],
  scope: MemoryScope | undefined,
  projectKey: string | undefined,
  index: number,
): void {
  if (scope !== undefined && scope !== target.scope) {
    throw new Error(`actions[${index}] scope does not match target`);
  }
  if (projectKey !== undefined && projectKey !== target.projectKey) {
    throw new Error(`actions[${index}] project key does not match target`);
  }
  if (target.scope === 'global' && projectKey !== undefined) {
    throw new Error(`actions[${index}] global target must not have a project key`);
  }
}

function assertTargetActive(target: MemoryReviewPacket['memories'][number], index: number): void {
  if (target.state === 'superseded') {
    throw new Error(`actions[${index}] target is superseded`);
  }
}

function assertTargetProjectContext(
  packet: MemoryReviewPacket,
  target: MemoryReviewPacket['memories'][number],
  index: number,
): void {
  if (
    target.scope === 'project' &&
    packet.projectKey !== undefined &&
    target.projectKey !== packet.projectKey
  ) {
    throw new Error(`actions[${index}] target project does not match packet context`);
  }
  if (
    target.scope === 'project' &&
    packet.projectKey === undefined &&
    packet.projectIdentity !== undefined &&
    target.projectIdentity !== packet.projectIdentity
  ) {
    throw new Error(`actions[${index}] target identity does not match packet context`);
  }
}

function assertActionProjectContext(
  packet: MemoryReviewPacket,
  scope: MemoryScope | undefined,
  projectKey: string | undefined,
  index: number,
): void {
  if (
    (scope === 'project' || projectKey !== undefined) &&
    packet.projectKey !== undefined &&
    projectKey !== packet.projectKey
  ) {
    throw new Error(`actions[${index}] project does not match packet context`);
  }
}

function validateActionEvidence(
  packet: MemoryReviewPacket,
  evidenceKeys: readonly string[],
  scope: MemoryScope,
  projectKey: string | undefined,
  candidateKey: string | undefined,
  index: number,
  requireSuccess: boolean,
): void {
  for (const key of evidenceKeys) {
    const evidence = packet.evidence.find((entry) => entry.key === key);
    if (evidence === undefined) throw new Error(`actions[${index}] references unknown evidence`);
    if (evidence.scope !== scope)
      throw new Error(`actions[${index}] evidence scope does not match`);
    if (scope === 'project' && evidence.projectKey !== projectKey) {
      throw new Error(`actions[${index}] evidence project does not match`);
    }
    if (
      scope === 'project' &&
      packet.projectIdentity !== undefined &&
      evidence.projectIdentity !== packet.projectIdentity
    ) {
      throw new Error(`actions[${index}] evidence identity does not match packet context`);
    }
    if (scope === 'global' && evidence.projectIdentity === undefined) {
      throw new Error(`actions[${index}] global evidence lacks project identity`);
    }
    if (candidateKey !== undefined && evidence.candidateKey !== candidateKey) {
      throw new Error(`actions[${index}] evidence candidate does not match`);
    }
    if (requireSuccess && !evidence.success) {
      throw new Error(`actions[${index}] requires successful evidence`);
    }
    const evidenceAge = Date.parse(packet.createdAt) - Date.parse(evidence.observedAt);
    if (evidenceAge < 0 || evidenceAge > MEMORY_REVIEW_LIMITS.maxEvidenceAgeMs) {
      throw new Error(`actions[${index}] evidence is outside the freshness window`);
    }
  }
}

function validateLanguageText(value: string, language: MemoryLanguage, field: string): void {
  validateSafeText(value, field);
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  const mixedTechnical = hasHan && hasLatin && containsTechnicalLatinTokens(value);
  const machineLike =
    /[`/\\]|\b(?:git|npm|pnpm|yarn|node|comet)\b|\.(?:ts|js|json|md|yaml)\b/iu.test(value) ||
    /\b[A-Z][A-Z0-9_-]{1,}\b/u.test(value);
  if (language === 'zh-CN' && hasLatin && !machineLike && !mixedTechnical) {
    throw new Error(`${field} does not match zh-CN review language`);
  }
  if (language === 'en' && hasHan && !machineLike) {
    throw new Error(`${field} does not match en review language`);
  }
}

const COMMON_TECHNICAL_TOKENS = new Set([
  'Ant',
  'API',
  'CSS',
  'Classic',
  'Comet',
  'Dashboard',
  'Design',
  'GitHub',
  'HTML',
  'JavaScript',
  'Native',
  'React',
  'Tailwind',
  'TypeScript',
  'UI',
  'URL',
  'Vue',
  'hooks',
  'component',
  'components',
  'frontend',
  'backend',
]);

function containsTechnicalLatinTokens(value: string): boolean {
  const tokens = value.match(/[A-Za-z][A-Za-z0-9+.#-]*/gu) ?? [];
  return (
    tokens.length > 0 &&
    tokens.every(
      (token) => COMMON_TECHNICAL_TOKENS.has(token) || /^[A-Z]{2,}[0-9A-Z+.#-]*$/u.test(token),
    )
  );
}

function validateSafeText(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${field} contains unsafe or non-memory content`);
  }
}

function boundedStrings(
  value: unknown,
  field: string,
  _max: number,
  validateText: boolean,
): string[] {
  const values = asArray(value, field).map((entry, index) =>
    requiredString(entry, `${field}[${index}]`),
  );
  if (validateText) values.forEach((entry) => validateSafeText(entry, field));
  return values;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function optionalSafeKey(value: unknown, field: string): string | undefined {
  const key = optionalString(value, field);
  if (key !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(key)) {
    throw new Error(`${field} is invalid`);
  }
  return key;
}

function optionalProjectKey(value: unknown): string | undefined {
  const key = optionalString(value, 'projectKey');
  if (key !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key)) {
    throw new Error('projectKey is invalid');
  }
  return key;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${field} is required`);
  return value.trim();
}

function requiredTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${field} is invalid`);
  return timestamp;
}

function requiredPositiveNumber(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${field} is invalid`);
  return value as number;
}

function asLanguage(value: unknown, field: string): MemoryLanguage {
  if (value !== 'zh-CN' && value !== 'en') throw new Error(`${field} is invalid`);
  return value;
}

function asScope(value: unknown, field: string): MemoryScope {
  if (value !== 'global' && value !== 'project') throw new Error(`${field} is invalid`);
  return value;
}

function optionalMemoryClass(value: unknown, field: string): MemoryClass | undefined {
  if (value === undefined) return undefined;
  if (!isMemoryClass(value)) throw new Error(`${field} is invalid`);
  return value;
}

function isActionKind(value: unknown): value is MemoryReviewAction['action'] {
  return value === 'create' || value === 'update' || value === 'forget' || value === 'skip';
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function invalid(field: string): never {
  throw new Error(`${field} is invalid`);
}
