import type { MemoryReviewActionSet, MemoryReviewPacket } from './types.js';
import {
  validateMemoryReviewActions,
  validateMemoryReviewPacket,
  validateSafeMemoryText,
} from './review-contract.js';

const NON_REUSABLE_TEXT =
  /(?:完成命令检查点|完成工作流检查点|本次请求|one-time request|test checkpoint|command checkpoint|(?:workflow|command|task|change)\s+(?:checkpoint\s+)?completed)/iu;

const INJECTION_OR_ARTIFACT =
  /(?:password|secret|token|api[_ -]?key|bearer|ignore previous|system prompt|private key|密码|密钥|令牌|忽略之前|系统提示)/iu;

export function reviewMemoryPacket(value: unknown): MemoryReviewActionSet {
  const packet = validateMemoryReviewPacket(value);
  if (
    packet.userEvidence.length === 0 &&
    packet.category !== undefined &&
    isNonReusableCategory(packet.category)
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
    category:
      packet.category ??
      firstEvidence.category ??
      (packet.language === 'en' ? 'Reusable preference' : '可复用偏好'),
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
    if (text.length < 4 || NON_REUSABLE_TEXT.test(text)) continue;
    try {
      validateSafeMemoryText(text);
    } catch {
      continue;
    }
    return text;
  }
  return undefined;
}

function skip(packet: MemoryReviewPacket, reason: string): Record<string, unknown> {
  return { action: 'skip', language: packet.language, reason };
}
