import type { MemoryReviewActionSet, MemoryReviewPacket, MemoryReviewRequest } from './types.js';
import {
  validateMemoryReviewActions,
  validateMemoryReviewPacket,
  validateSafeMemoryText,
} from './review-contract.js';

const NON_REUSABLE_TEXT =
  /(?:完成命令检查点|完成工作流检查点|本次请求|one-time request|test checkpoint|command checkpoint|(?:workflow|command|task|change)\s+(?:checkpoint\s+)?completed)/iu;

const ONE_TIME_REQUEST =
  /^(?:请(?:帮我)?|帮我|修复|实现|处理|解决).{0,120}(?:页面|样式|问题|bug|错误|命令|测试|提交|检查|本次|此次|这个|当前|文件|任务)$/iu;

const COMPLETED_WORK_SUMMARY =
  /^(?:(?:本次|已经|已)\s*)?(?:完成|实现|修复|处理|解决|更新|新增|添加|移除|删除|重构|验证|合并|提交|推送|构建|发布|优化|调整|改为|改成|completed|implemented|fixed|resolved|updated|added|removed|deleted|refactored|verified|merged|committed|pushed|built|released|optimized|changed)\s*.{2,200}$/iu;

const DURABLE_PREFERENCE_CUE =
  /(?:偏好|习惯|约定|以后|后续|始终|总是|默认|每次|必须|不得|不要|避免|优先|只|统一|保持|提交前|写入前|发布前|运行前|(?:完成|修改|实现|验证)后(?:先|再|应|要|必须|运行|执行)|prefer|preference|always|never|by default|every time|must(?:\s+not)?|avoid|before|after|when|keep)/iu;

const INJECTION_OR_ARTIFACT =
  /(?:password|secret|token|api[_ -]?key|bearer|ignore previous|system prompt|private key|密码|密钥|令牌|忽略之前|系统提示)/iu;

export function reviewMemoryPacket(value: unknown): MemoryReviewActionSet {
  const packet = validateMemoryReviewPacket(value);
  if (packet.explicitRequest !== undefined) {
    return validateMemoryReviewActions(packet, {
      schema: 'comet.memory.actions.v1',
      actions: [buildExplicitAction(packet, packet.explicitRequest)],
    });
  }
  if (
    (packet.category !== undefined && isNonReusableCategory(packet.category)) ||
    packet.userEvidence.some((entry) => isNonReusableText(entry)) ||
    (packet.userEvidence.length === 0 &&
      packet.evidence.some((entry) => entry.text !== undefined && isNonReusableText(entry.text)))
  ) {
    return validateMemoryReviewActions(packet, {
      schema: 'comet.memory.actions.v1',
      actions: [skip(packet, '这是一次性命令、测试或运行产物，不保存为长期记忆')],
    });
  }
  const action = buildAction(packet);
  return validateMemoryReviewActions(packet, {
    schema: 'comet.memory.actions.v1',
    actions: [action],
  });
}

function buildExplicitAction(
  packet: MemoryReviewPacket,
  request: MemoryReviewRequest,
): Record<string, unknown> {
  const language = packet.language;
  const metadata = {
    reason:
      request.reason ??
      (language === 'en' ? 'Requested directly by the user' : '由用户明确要求，立即更新个人记忆'),
    title: request.title ?? (language === 'en' ? 'Personal memory' : '个人记忆'),
  };
  if (request.action === 'remember') {
    const text = request.text;
    if (text === undefined) return skip(packet, localizedSkip(language, '显式记忆缺少正文'));
    const evidence = matchingEvidence(packet, request.scope, request.projectKey);
    const scope = request.scope ?? evidence[0]?.scope ?? 'project';
    const projectKey =
      scope === 'project'
        ? (request.projectKey ?? evidence[0]?.projectKey ?? packet.projectKey)
        : undefined;
    return {
      action: 'create',
      language,
      scope,
      ...(projectKey === undefined ? {} : { projectKey }),
      category: request.category ?? localizedCategory(language),
      text,
      ...(request.memoryClass === undefined ? {} : { memoryClass: request.memoryClass }),
      ...metadata,
      evidenceKeys: evidence.map((entry) => entry.key),
      ...copyRequestArrays(request),
    };
  }

  const target = packet.memories.find((entry) => entry.id === request.targetId);
  if (target === undefined || request.targetId === undefined) {
    return skip(packet, localizedSkip(language, '找不到需要处理的目标记忆'));
  }
  const evidence = matchingEvidence(packet, target.scope, target.projectKey);
  if (request.action === 'forget') {
    return {
      action: 'forget',
      language,
      targetId: request.targetId,
      ...(request.permanent === undefined ? {} : { permanent: request.permanent }),
      reason:
        request.reason ??
        (language === 'en' ? 'Requested directly by the user' : '由用户明确要求忘记'),
      title: metadata.title,
      evidenceKeys: evidence.map((entry) => entry.key),
    };
  }
  return {
    action: 'update',
    language,
    targetId: request.targetId,
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.projectKey === undefined ? {} : { projectKey: request.projectKey }),
    ...metadata,
    ...(request.text === undefined ? {} : { text: request.text }),
    ...(request.category === undefined ? {} : { category: request.category }),
    ...(request.memoryClass === undefined ? {} : { memoryClass: request.memoryClass }),
    evidenceKeys: evidence.map((entry) => entry.key),
    ...copyRequestArrays(request),
  };
}

function matchingEvidence(
  packet: MemoryReviewPacket,
  scope: 'global' | 'project' | undefined,
  projectKey: string | undefined,
) {
  return packet.evidence.filter(
    (entry) =>
      entry.success &&
      (scope === undefined || entry.scope === scope) &&
      (scope !== 'project' || entry.projectKey === projectKey),
  );
}

function copyRequestArrays(request: MemoryReviewRequest): Record<string, readonly string[]> {
  return Object.fromEntries(
    (['tags', 'pathPatterns', 'taskTypes', 'operations', 'phases'] as const)
      .filter((name) => request[name] !== undefined)
      .map((name) => [name, request[name] as readonly string[]]),
  );
}

function localizedCategory(language: 'zh-CN' | 'en'): string {
  return language === 'en' ? 'Reusable preference' : '可复用偏好';
}

function localizedSkip(language: 'zh-CN' | 'en', message: string): string {
  return language === 'en' ? 'The explicit memory request is incomplete' : message;
}

function isNonReusableCategory(category: string): boolean {
  const normalized = category.trim().toLocaleLowerCase();
  return [
    '测试',
    '命令',
    '变更',
    '差异',
    '日志',
    '输出',
    '安全',
    '用户请求',
    '一次性请求',
    '一次性选择',
    '任务请求',
    '工作流检查点',
    'checkpoint',
    'workflow checkpoint',
    'test',
    'command',
    'change',
    'pr',
    'issue',
    'log',
    'diff',
    'security',
  ].some(
    (prefix) =>
      normalized === prefix ||
      normalized.startsWith(`${prefix} `) ||
      normalized.startsWith(`${prefix}:`),
  );
}

function buildAction(packet: MemoryReviewPacket): Record<string, unknown> {
  const successfulEvidence = packet.evidence.filter((entry) => entry.success);
  const text = firstUsefulText(packet, successfulEvidence);
  if (text === undefined) return skip(packet, '没有发现可长期复用的用户偏好');
  if (INJECTION_OR_ARTIFACT.test(text))
    return skip(packet, '内容包含敏感信息或不可持久化的运行产物');

  const evidence = successfulEvidence.filter(
    (entry) => entry.text === undefined || entry.text === text,
  );
  const selectedEvidence = evidence.length > 0 ? evidence : successfulEvidence;
  const firstEvidence = selectedEvidence[0];
  if (firstEvidence === undefined) return skip(packet, '没有成功证据支持这条记忆');

  const scope = firstEvidence.scope;
  const projectKey =
    scope === 'project' ? (firstEvidence.projectKey ?? packet.projectKey) : undefined;
  if (scope === 'project' && projectKey === undefined) {
    return skip(packet, '项目记忆缺少稳定的项目范围');
  }
  return {
    action: 'create',
    language: packet.language,
    scope,
    ...(projectKey === undefined ? {} : { projectKey }),
    ...(firstEvidence.candidateKey === undefined
      ? {}
      : { candidateKey: firstEvidence.candidateKey }),
    ...(firstEvidence.memoryClass === undefined ? {} : { memoryClass: firstEvidence.memoryClass }),
    category: packet.category ?? firstEvidence.category ?? localizedCategory(packet.language),
    text,
    title: packet.language === 'en' ? 'Reusable workflow preference' : '可复用协作偏好',
    reason:
      packet.language === 'en'
        ? 'Validated by a successful change and safe to reuse in later tasks'
        : '已通过成功变更验证，后续任务可以复用',
    evidenceKeys: selectedEvidence.map((entry) => entry.key),
    ...(firstEvidence.tags === undefined ? {} : { tags: firstEvidence.tags }),
    ...(firstEvidence.pathPatterns === undefined
      ? {}
      : { pathPatterns: firstEvidence.pathPatterns }),
    ...(firstEvidence.taskTypes === undefined ? {} : { taskTypes: firstEvidence.taskTypes }),
    ...(firstEvidence.operations === undefined ? {} : { operations: firstEvidence.operations }),
  };
}

function firstUsefulText(
  packet: MemoryReviewPacket,
  evidence: readonly MemoryReviewPacket['evidence'][number][],
): string | undefined {
  const candidates = [
    ...packet.userEvidence,
    ...evidence.map((entry) => entry.text).filter((entry): entry is string => entry !== undefined),
  ];
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (text.length < 4 || isNonReusableText(text)) continue;
    try {
      validateSafeMemoryText(text);
    } catch {
      continue;
    }
    return text;
  }
  return undefined;
}

function isNonReusableText(text: string): boolean {
  const normalized = text.trim();
  return (
    NON_REUSABLE_TEXT.test(normalized) ||
    ONE_TIME_REQUEST.test(normalized) ||
    (COMPLETED_WORK_SUMMARY.test(normalized) && !DURABLE_PREFERENCE_CUE.test(normalized))
  );
}

function skip(packet: MemoryReviewPacket, reason: string): Record<string, unknown> {
  return { action: 'skip', language: packet.language, reason };
}
