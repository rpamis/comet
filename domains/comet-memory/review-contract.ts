import type {
  MemoryKind,
  MemoryLanguage,
  MemoryReviewAction,
  MemoryReviewActionSet,
  MemoryReviewPacket,
  MemoryReviewMemorySummary,
  MemoryScope,
} from './types.js';

export const MEMORY_REVIEW_PACKET_SCHEMA = 'comet.memory.review.v1' as const;
export const MEMORY_REVIEW_ACTIONS_SCHEMA = 'comet.memory.actions.v1' as const;

export const MEMORY_REVIEW_LIMITS = {
  maxActions: 8,
  maxEvidence: 16,
  maxBytes: 12 * 1024,
  maxTextBytes: 2 * 1024,
  maxCollectionEntries: 32,
} as const;

const DANGEROUS_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|password|passwd|secret|authorization)\s*[:=]\s*\S+/iu,
  /\b(?:sk|rk)-[a-z0-9]{16,}\b/iu,
  /\b\d{3}-\d{2}-\d{4}\b/u,
  /ignore\s+(?:all\s+)?previous\s+instructions/iu,
  /(?:modify|change|edit|rewrite|disable)\s+(?:the\s+)?(?:skill|agent instructions?|project rules?|system prompt)/iu,
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
  const checkpoint = requiredString(object.checkpoint, 'checkpoint');
  const userEvidence = boundedStrings(object.userEvidence, 'userEvidence', 8, true);
  const evidence = asArray(object.evidence, 'evidence');
  if (evidence.length > MEMORY_REVIEW_LIMITS.maxCollectionEntries) {
    throw new Error('Review packet evidence exceeds the collection limit');
  }
  const normalizedEvidence = evidence.map((entry, index) => {
    const item = asObject(entry, `evidence[${index}]`);
    const key = requiredString(item.key, `evidence[${index}].key`);
    const evidenceProjectKey = optionalProjectKey(item.projectKey);
    const evidenceProjectIdentity = optionalString(
      item.projectIdentity,
      `evidence[${index}].projectIdentity`,
    );
    if (evidenceProjectKey !== undefined && evidenceProjectIdentity === undefined) {
      throw new Error(`evidence[${index}] project key requires a stable project identity`);
    }
    const evidenceText = optionalString(item.text, `evidence[${index}].text`);
    if (evidenceText !== undefined) validateSafeText(evidenceText, `evidence[${index}].text`);
    return {
      key,
      ...(evidenceProjectIdentity === undefined
        ? {}
        : { projectIdentity: evidenceProjectIdentity }),
      ...(evidenceProjectKey === undefined ? {} : { projectKey: evidenceProjectKey }),
      changeId: requiredString(item.changeId, `evidence[${index}].changeId`),
      success: item.success === true,
      ...(evidenceText === undefined ? {} : { text: evidenceText }),
    };
  });
  const evidenceKeys = new Set(normalizedEvidence.map((entry) => entry.key));
  if (evidenceKeys.size !== normalizedEvidence.length) {
    throw new Error('Review packet evidence keys must be unique');
  }
  const memories = asArray(object.memories, 'memories');
  if (memories.length > MEMORY_REVIEW_LIMITS.maxCollectionEntries) {
    throw new Error('Review packet memories exceeds the collection limit');
  }
  const normalizedMemories: MemoryReviewMemorySummary[] = memories.map((entry, index) => {
    const item = asObject(entry, `memories[${index}]`);
    const id = requiredString(item.id, `memories[${index}].id`);
    const scope = asScope(item.scope, `memories[${index}].scope`);
    const memoryProjectKey = optionalProjectKey(item.projectKey);
    if (scope === 'project' && memoryProjectKey === undefined) {
      throw new Error(`memories[${index}] project memory requires a project key`);
    }
    if (scope === 'global' && memoryProjectKey !== undefined) {
      throw new Error(`memories[${index}] global memory must not have a project key`);
    }
    const kind: MemoryKind =
      item.kind === 'explicit' || item.kind === 'inferred' ? item.kind : invalid('kind');
    return {
      id,
      scope,
      ...(memoryProjectKey === undefined ? {} : { projectKey: memoryProjectKey }),
      category: requiredString(item.category, `memories[${index}].category`),
      text: requiredString(item.text, `memories[${index}].text`),
      kind,
      active: item.active === true,
    };
  });
  const memoryIds = new Set(normalizedMemories.map((entry) => entry.id));
  if (memoryIds.size !== normalizedMemories.length) {
    throw new Error('Review packet memory IDs must be unique');
  }
  const budget = normalizeBudget(object.budget, options);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > budget.maxBytes) {
    throw new Error('Review packet exceeds its byte budget');
  }
  return {
    schema: MEMORY_REVIEW_PACKET_SCHEMA,
    language,
    ...(projectIdentity === undefined ? {} : { projectIdentity }),
    ...(projectKey === undefined ? {} : { projectKey }),
    workflow,
    changeId,
    checkpoint,
    userEvidence,
    evidence: normalizedEvidence,
    memories: normalizedMemories,
    budget,
  };
}

export function validateMemoryReviewActions(
  packet: MemoryReviewPacket,
  value: unknown,
  options: MemoryReviewValidationOptions = {},
): MemoryReviewActionSet {
  const actions = Array.isArray(value)
    ? value
    : asArray(asObject(value, 'review actions').actions, 'review actions.actions');
  const maxActions = boundedLimit(
    options.maxActions ?? packet.budget.maxActions,
    MEMORY_REVIEW_LIMITS.maxActions,
  );
  if (actions.length > maxActions) throw new Error('Memory review action count exceeds the limit');
  const evidenceKeys = new Set(packet.evidence.map((entry) => entry.key));
  const memoryIds = new Set(packet.memories.map((entry) => entry.id));
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
    const candidateKey = optionalSafeKey(action.candidateKey, `actions[${index}].candidateKey`);
    const actionEvidence =
      action.evidenceKeys === undefined
        ? []
        : boundedStrings(
            action.evidenceKeys,
            `actions[${index}].evidenceKeys`,
            Math.min(packet.budget.maxEvidence, MEMORY_REVIEW_LIMITS.maxEvidence),
            false,
          );
    for (const key of actionEvidence) {
      if (!evidenceKeys.has(key)) throw new Error(`actions[${index}] references unknown evidence`);
    }
    const reason = optionalString(action.reason, `actions[${index}].reason`);
    if (reason !== undefined) validateLanguageText(reason, language, `actions[${index}].reason`);
    if (kind === 'skip') {
      if (reason === undefined) throw new Error(`actions[${index}] skip requires a reason`);
      return { action: 'skip', language, reason, evidenceKeys: actionEvidence };
    }
    if (kind === 'forget') {
      const targetId = requiredString(action.targetId, `actions[${index}].targetId`);
      assertTarget(memoryIds, targetId, index);
      return {
        action: 'forget',
        language,
        targetId,
        evidenceKeys: actionEvidence,
        ...(reason === undefined ? {} : { reason }),
      };
    }
    if (kind === 'create') {
      if (scope === undefined) throw new Error(`actions[${index}] create requires a scope`);
      const category = requiredString(action.category, `actions[${index}].category`);
      const text = requiredString(action.text, `actions[${index}].text`);
      validateLanguageText(category, language, `actions[${index}].category`);
      validateLanguageText(text, language, `actions[${index}].text`);
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
        ...optionalArrays(action),
      };
    }
    const targetId = requiredString(action.targetId, `actions[${index}].targetId`);
    assertTarget(memoryIds, targetId, index);
    const text = optionalString(action.text, `actions[${index}].text`);
    const category = optionalString(action.category, `actions[${index}].category`);
    if (text === undefined && category === undefined && !hasArrayUpdate(action)) {
      throw new Error(`actions[${index}] update must change a memory field`);
    }
    if (text !== undefined) validateLanguageText(text, language, `actions[${index}].text`);
    if (category !== undefined)
      validateLanguageText(category, language, `actions[${index}].category`);
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
      ...optionalArrays(action),
    };
  });
  const maxBytes = boundedLimit(
    options.maxBytes ?? packet.budget.maxBytes,
    MEMORY_REVIEW_LIMITS.maxBytes,
  );
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > maxBytes) {
    throw new Error('Memory review actions exceed the byte budget');
  }
  return { schema: MEMORY_REVIEW_ACTIONS_SCHEMA, actions: normalized };
}

export function validateSafeMemoryText(value: string): void {
  validateSafeText(value, 'memory text');
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
  const maxActions = boundedLimit(
    requiredPositiveNumber(budget.maxActions, 'budget.maxActions'),
    options.maxActions ?? MEMORY_REVIEW_LIMITS.maxActions,
  );
  const maxEvidence = boundedLimit(
    requiredPositiveNumber(budget.maxEvidence, 'budget.maxEvidence'),
    options.maxEvidence ?? MEMORY_REVIEW_LIMITS.maxEvidence,
  );
  const maxBytes = boundedLimit(
    requiredPositiveNumber(budget.maxBytes, 'budget.maxBytes'),
    options.maxBytes ?? MEMORY_REVIEW_LIMITS.maxBytes,
  );
  return { maxActions, maxEvidence, maxBytes };
}

function optionalArrays(value: Record<string, unknown>): {
  tags?: string[];
  pathPatterns?: string[];
  taskTypes?: string[];
  operations?: string[];
} {
  const result: {
    tags?: string[];
    pathPatterns?: string[];
    taskTypes?: string[];
    operations?: string[];
  } = {};
  for (const name of ['tags', 'pathPatterns', 'taskTypes', 'operations'] as const) {
    if (value[name] === undefined) continue;
    const values = boundedStrings(value[name], name, 16, false);
    values.forEach((entry) => validateSafeText(entry, name));
    result[name] = values;
  }
  return result;
}

function hasArrayUpdate(value: Record<string, unknown>): boolean {
  return ['tags', 'pathPatterns', 'taskTypes', 'operations'].some(
    (name) => value[name] !== undefined,
  );
}

function assertTarget(ids: ReadonlySet<string>, targetId: string, index: number): void {
  if (!ids.has(targetId)) throw new Error(`actions[${index}] references an unknown target`);
}

function validateLanguageText(value: string, language: MemoryLanguage, field: string): void {
  validateSafeText(value, field);
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  const machineLike =
    /[`/\\]|\b(?:git|npm|pnpm|yarn|node|comet)\b|\.(?:ts|js|json|md|yaml)\b/iu.test(value);
  if (language === 'zh-CN' && hasLatin && !hasHan && !machineLike) {
    throw new Error(`${field} does not match zh-CN review language`);
  }
  if (language === 'en' && hasHan && !machineLike && !/[A-Za-z]{2,}\s+[A-Za-z]{2,}/u.test(value)) {
    throw new Error(`${field} does not match en review language`);
  }
}

function validateSafeText(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
  if (Buffer.byteLength(value, 'utf8') > MEMORY_REVIEW_LIMITS.maxTextBytes) {
    throw new Error(`${field} exceeds the text budget`);
  }
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`${field} contains unsafe or non-memory content`);
  }
}

function boundedStrings(
  value: unknown,
  field: string,
  max: number,
  validateText: boolean,
): string[] {
  const values = asArray(value, field).map((entry, index) =>
    requiredString(entry, `${field}[${index}]`),
  );
  if (values.length > max) throw new Error(`${field} exceeds the collection limit`);
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

function requiredPositiveNumber(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new Error(`${field} is invalid`);
  return value as number;
}

function boundedLimit(value: number, maximum: number): number {
  if (value <= 0 || value > maximum) throw new Error('Review budget exceeds the configured limit');
  return value;
}

function asLanguage(value: unknown, field: string): MemoryLanguage {
  if (value !== 'zh-CN' && value !== 'en') throw new Error(`${field} is invalid`);
  return value;
}

function asScope(value: unknown, field: string): MemoryScope {
  if (value !== 'global' && value !== 'project') throw new Error(`${field} is invalid`);
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
