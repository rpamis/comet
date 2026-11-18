import path from 'path';
import { isDeepStrictEqual } from 'node:util';
import {
  stringify,
  parseDocument,
  isAlias,
  isMap,
  isSeq,
  isScalar,
  isNode,
  type Document,
  type YAMLMap,
} from 'yaml';

import type {
  ClassicArtifactLayout,
  ParsedWorkflowProjectConfigDocument,
  ProjectConfigLanguage,
  WorkflowClassicProjectConfig,
  WorkflowHookProjectConfig,
  WorkflowKnowledgeProjectConfig,
  WorkflowKnowledgeLocalConfig,
  WorkflowKnowledgeRemoteConfig,
  WorkflowMemoryProjectConfig,
  WorkflowNativeEnabledProjectConfig,
  WorkflowNativePendingRootMove,
  WorkflowNativeProjectConfig,
  WorkflowProjectConfig,
} from './types.js';

export type ProjectConfigCommentLanguage = 'en' | 'zh-CN';

export const WORKFLOW_PROJECT_CONFIG_MAX_BYTES = Number.MAX_SAFE_INTEGER;
export const MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_LENGTH = 1024;
export const MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_WILDCARDS = 64;
export const DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES = 5;
export const DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN = 2;
export const DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG: WorkflowMemoryProjectConfig = {
  learning: true,
  retrieval: true,
};
export const DEFAULT_WORKFLOW_KNOWLEDGE_LOCAL_CONFIG = {
  include: [],
  max_file_mb: 1,
  max_total_mb: 32,
} satisfies WorkflowKnowledgeLocalConfig;
export const DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG: WorkflowKnowledgeProjectConfig = {
  provider: 'local',
};
export const DEFAULT_WORKFLOW_CLASSIC_CHECK_TIMEOUT_MS = 300_000;
export const MAX_WORKFLOW_CLASSIC_CHECK_TIMEOUT_MS = 3_600_000;

export const DEFAULT_WORKFLOW_NATIVE_PULL_REQUEST_FINISH_TIMEOUT_MS = 120_000;
export const MAX_WORKFLOW_NATIVE_PULL_REQUEST_FINISH_TIMEOUT_MS = 600_000;

type ProjectConfigCommentKey =
  | 'schema'
  | 'default_workflow'
  | 'workflows'
  | 'ambient_resume'
  | 'change_walkthrough'
  | 'memory'
  | 'memory.learning'
  | 'memory.retrieval'
  | 'knowledge'
  | 'knowledge.provider'
  | 'knowledge.local'
  | 'knowledge.local.include'
  | 'knowledge.local.max_file_mb'
  | 'knowledge.local.max_total_mb'
  | 'knowledge.remote'
  | 'knowledge.remote.endpoint'
  | 'knowledge.remote.token_env'
  | 'knowledge.remote.scope'
  | 'knowledge.remote.timeout_ms'
  | 'hook'
  | 'hook.allow_paths'
  | 'native'
  | 'native.artifact_root'
  | 'native.language'
  | 'native.clarification_mode'
  | 'native.archive_confirmation'
  | 'native.max_verify_failures'
  | 'native.max_parallel_children'
  | 'native.document_writes'
  | 'native.finish'
  | 'classic'
  | 'classic.artifact_layout'
  | 'classic.language'
  | 'classic.context_compression'
  | 'classic.review_mode'
  | 'classic.auto_transition'
  | 'classic.document_evidence'
  | 'classic.check_timeout_ms';

const COMMENTS: Record<ProjectConfigCommentLanguage, Record<ProjectConfigCommentKey, string>> = {
  en: {
    schema: '# Configuration schema used by Comet. Do not edit this value.',
    default_workflow: '# Default workflow entered by /comet. Must also appear in workflows.',
    workflows: '# Workflows enabled in this project: native, classic, or both.',
    change_walkthrough:
      '# Generate a standalone HTML change walkthrough for Native and Classic. Enabling it uses extra explanation tokens.\n# change_walkthrough: true | false (default: true)',
    ambient_resume:
      '# Enables automatic recovery through the read-only Ambient Resume probe for both Native and Classic. Set false to disable it.\n# ambient_resume: true | false',
    memory: '# Project policy for automatic personal-memory learning and retrieval.',
    'memory.learning':
      '# Allows workflow events in this project to form new personal memories automatically.\n# learning: true | false',
    'memory.retrieval':
      '# Allows personal memories to be injected into Agent context for this project.\n# retrieval: true | false',
    knowledge: '# Project knowledge retrieval provider used by ordinary Comet tasks.',
    'knowledge.provider': '# Provider for project knowledge.\n# provider: local | remote',
    'knowledge.local': '# Additional project-relative Markdown globs used by the local provider.',
    'knowledge.local.include':
      '# One project-relative Markdown glob per list item; appended to the built-in corpus.',
    'knowledge.local.max_file_mb':
      '# Maximum size in MB for one local Markdown document. Increase it for long specifications or verification reports.',
    'knowledge.local.max_total_mb':
      '# Maximum total size in MB of the local Markdown retrieval corpus.',
    'knowledge.remote': '# Fixed Comet Retrieval API v1 settings used when provider is remote.',
    'knowledge.remote.endpoint': '# HTTPS endpoint; loopback HTTP is allowed.',
    'knowledge.remote.token_env': '# Optional environment variable containing the bearer token.',
    'knowledge.remote.scope': '# Optional opaque remote knowledge scope.',
    'knowledge.remote.timeout_ms': '# Remote request timeout in milliseconds (100-30000).',
    hook: '# Hook write policy shared by Native and Classic. Paths are project-relative.',
    'hook.allow_paths':
      '# Project-relative directories allowed during guarded phases. Use one path per list item; empty by default.',
    native: '# Native workflow settings. They do not change Classic state or behavior.',
    'native.artifact_root':
      '# Root directory where Native stores Comet specs and changes. Runtime data stays under .comet.',
    'native.language':
      '# Artifact language used by Native workflow documents.\n# language: en | zh-CN',
    'native.clarification_mode':
      '# Controls how Native asks clarifying questions: batch asks every currently answerable question per round (default), sequential asks one at a time.\n# clarification_mode: batch | sequential',
    'native.archive_confirmation':
      '# Controls whether Native archives automatically after a successful preview or waits for explicit user confirmation.\n# archive_confirmation: automatic | required',
    'native.max_verify_failures':
      '# Maximum failed Verify outcomes allowed for one confirmed acceptance target before Native stops the completion loop.',
    'native.max_parallel_children':
      '# Maximum dispatched Supervisor children awaiting integration and archive. Defaults to 2; single-session always uses 1. Changes apply at the next dispatch.',
    'native.document_writes':
      '# Controls documentation file writes during Shape, Verify, and Archive: allow treats them as neutral instead of returning the change to Build, revert restores the strict behavior.\n# document_writes: allow | revert',
    'native.finish':
      '# Optional repository-owned finish providers. Native keeps commit, push, generic remote verification, and recovery ownership.',
    classic: '# Classic workflow settings. They do not change Native state or behavior.',
    'classic.artifact_layout':
      '# Selects the Classic artifact layout. The default is docs; update preserves detected root-level legacy artifacts.\n# artifact_layout: legacy | docs',
    'classic.language':
      '# Artifact language used by Classic workflow documents.\n# language: en | zh-CN',
    'classic.context_compression':
      '# Controls beta context compression for new Classic changes.\n# context_compression: off | beta',
    'classic.review_mode':
      '# Sets the default review depth for new Classic changes.\n# review_mode: off | standard | thorough',
    'classic.auto_transition':
      '# Automatically enters the next Classic phase after a phase passes.\n# auto_transition: true | false',
    'classic.check_timeout_ms':
      '# Default check timeout in milliseconds (1-3600000); --timeout-ms overrides it. Default: 300000.',
    'classic.document_evidence':
      '# Controls how documentation edits affect recorded check evidence: neutral keeps build and verify evidence valid when only documentation files changed, strict binds every working-tree file again.\n# document_evidence: neutral | strict',
  },
  'zh-CN': {
    schema: '# Comet 使用的配置格式版本，请勿修改此值。',
    default_workflow: '# `/comet` 默认进入的工作流；该值也必须出现在 workflows 中。',
    workflows: '# 此项目启用的工作流，可填写 native、classic 或同时启用两者。',
    change_walkthrough:
      '# 是否生成可直接打开的 HTML 变更说明，同时作用于 Native 和 Classic；开启会增加讲解内容的 token 消耗。\n# change_walkthrough: true | false（默认 true）',
    ambient_resume:
      '# 是否启用只读的环境感知恢复探针，同时作用于 Native 和 Classic；设为 false 可关闭自动工作流恢复。\n# ambient_resume: true | false',
    memory: '# 当前项目的个人记忆自动学习与注入策略。',
    'memory.learning':
      '# 是否允许当前项目通过工作流事件自动沉淀新的个人记忆。\n# 可选值：true | false',
    'memory.retrieval':
      '# 是否允许当前项目把个人记忆自动注入 Agent 上下文。\n# 可选值：true | false',
    knowledge: '# 普通 Comet 任务使用的项目知识检索 Provider。',
    'knowledge.provider': '# 项目知识 Provider。\n# 可选值：local | remote',
    'knowledge.local': '# Local Provider 额外加载的项目相对 Markdown 路径。',
    'knowledge.local.include': '# 每项填写一个项目相对 Markdown glob；会追加到内置语料。',
    'knowledge.local.max_file_mb':
      '# 单个本地 Markdown 文档允许参与检索的最大 MB 数；较长的规格或验证报告可按需提高。',
    'knowledge.local.max_total_mb': '# 本地 Markdown 检索语料允许读取的总 MB 数。',
    'knowledge.remote': '# provider 为 remote 时使用的固定 Comet Retrieval API v1 配置。',
    'knowledge.remote.endpoint': '# HTTPS 地址；loopback 地址允许使用 HTTP。',
    'knowledge.remote.token_env': '# 可选的 Bearer Token 环境变量名。',
    'knowledge.remote.scope': '# 可选的不透明远端知识库范围。',
    'knowledge.remote.timeout_ms': '# 远端请求超时时间（毫秒，100-30000）。',
    hook: '# Native 和 Classic 共享的 Hook 写入策略；路径必须是项目相对路径。',
    'hook.allow_paths': '# 在受保护阶段允许写入的项目相对目录；每项填写一个目录，默认为空。',
    native: '# Native 工作流配置，不会改变 Classic 的状态或行为。',
    'native.artifact_root': '# Native 规格和 change 的存放根目录；运行时数据始终位于 .comet。',
    'native.language': '# Native 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
    'native.clarification_mode':
      '# Native 提问澄清问题的方式：batch 每轮一次提出当前所有可回答的问题（默认），sequential 每轮只问一个。\n# 可选值：batch | sequential',
    'native.archive_confirmation':
      '# Native 归档检查成功后自动归档，或等待用户明确确认。\n# 可选值：automatic | required',
    'native.max_verify_failures':
      '# 同一个已确认验收目标最多允许的 Verify 失败次数；达到上限后停止完成循环。',
    'native.max_parallel_children':
      '# Supervisor 已派发且尚未完成集成归档的子任务上限；默认 2，single-session 固定为 1；调整从下一轮派发生效。',
    'native.document_writes':
      '# Shape、Verify 和 Archive 阶段的文档类写入处理方式：allow 视为中性写入、不再把 change 打回 Build，revert 恢复严格行为。\n# 可选值：allow | revert',
    'native.finish':
      '# 可选的仓库自有收尾 provider；提交、推送、通用远端核验和恢复仍由 Native 负责。',
    classic: '# Classic 工作流配置，不会改变 Native 的状态或行为。',
    'classic.artifact_layout':
      '# Classic 产物布局；默认使用 docs，update 检测到根目录 legacy 产物时予以保留。\n# 可选值：legacy | docs',
    'classic.language': '# Classic 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
    'classic.context_compression':
      '# 新建 Classic change 是否启用 beta 上下文压缩。\n# 可选值：off | beta',
    'classic.review_mode':
      '# 新建 Classic change 默认使用的审查深度。\n# 可选值：off | standard | thorough',
    'classic.auto_transition': '# Classic 阶段通过后是否自动进入下一阶段。\n# 可选值：true | false',
    'classic.check_timeout_ms':
      '# 检查命令默认超时，单位毫秒，范围 1-3600000，缺省为 300000；命令行 --timeout-ms 优先。',
    'classic.document_evidence':
      '# 文档编辑对已记录检查证据的影响：neutral 在只有文档文件变化时保持 build 和 verify 证据有效，strict 重新绑定工作区的全部文件。\n# 可选值：neutral | strict',
  },
};

export function projectConfigComment(
  key: ProjectConfigCommentKey,
  language: ProjectConfigCommentLanguage,
): string {
  return COMMENTS[language][key];
}

function commentKey(
  line: string,
  block: 'native' | 'classic' | 'hook' | 'memory' | 'knowledge' | null,
  knowledgeNested: 'local' | 'remote' | null,
): ProjectConfigCommentKey | null {
  const match = /^(\s*)([a-z_]+):/u.exec(line);
  if (!match) return null;
  const indent = match[1].length;
  const key = match[2];
  if (indent === 0 && key in COMMENTS.en) return key as ProjectConfigCommentKey;
  if (indent === 2 && block) {
    const blockKey = `${block}.${key}` as ProjectConfigCommentKey;
    if (blockKey in COMMENTS.en) return blockKey;
  }
  if (indent === 4 && block === 'knowledge' && knowledgeNested === 'remote') {
    const nestedKey = `knowledge.remote.${key}` as ProjectConfigCommentKey;
    if (nestedKey in COMMENTS.en) return nestedKey;
  }
  if (indent === 4 && block === 'knowledge' && knowledgeNested === 'local') {
    const nestedKey = `knowledge.local.${key}` as ProjectConfigCommentKey;
    if (nestedKey in COMMENTS.en) return nestedKey;
  }
  if (indent === 2 && block === null && key === 'hook') return 'hook';
  if (indent === 2 && block === 'hook' && key === 'allow_paths') {
    return 'hook.allow_paths';
  }

  return null;
}

export function renderStructuredProjectConfig(
  value: Record<string, unknown>,
  language: ProjectConfigCommentLanguage,
  source?: string | null,
): string {
  const output: string[] = [];
  let block: 'native' | 'classic' | 'hook' | 'memory' | 'knowledge' | null = null;
  let knowledgeNested: 'local' | 'remote' | null = null;
  for (const line of stringify(value).trimEnd().split('\n')) {
    const key = commentKey(line, block, knowledgeNested);
    if (key) {
      const indent = line.match(/^\s*/u)?.[0] ?? '';
      for (const comment of projectConfigComment(key, language).split('\n')) {
        output.push(`${indent}${comment}`);
      }
    }
    output.push(line);
    if (/^[a-z_]+:/u.test(line)) {
      if (line.startsWith('native:')) block = 'native';
      else if (line.startsWith('classic:')) block = 'classic';
      else if (line.startsWith('hook:')) block = 'hook';
      else if (line.startsWith('memory:')) block = 'memory';
      else if (line.startsWith('knowledge:')) block = 'knowledge';
      else block = null;
      knowledgeNested = null;
    } else if (/^ {2}[a-z_]+:/u.test(line)) {
      if (block === 'knowledge') {
        knowledgeNested = line.startsWith('  local:')
          ? 'local'
          : line.startsWith('  remote:')
            ? 'remote'
            : null;
      }
    }
  }
  output.push('');
  const rendered = output.join('\n');
  if (!source) return rendered;
  const original: Document = parseDocument(source, { uniqueKeys: true });
  if (original.errors.length > 0) throw new Error(original.errors[0].message);
  const template = parseDocument(rendered);
  if (!isMap(original.contents) || !isMap(template.contents)) return rendered;
  // YAML 将映射首项前的注释放在映射节点上；统一到键，避免键序变化时丢失或重复说明。
  const attachLeadingComments = (node: unknown) => {
    if (!isMap(node)) return;
    const first = node.items[0];
    if (node.commentBefore && first && isScalar(first.key)) {
      first.key.commentBefore = [node.commentBefore, first.key.commentBefore]
        .filter(Boolean)
        .join('\n');
      node.commentBefore = undefined;
    }
    for (const pair of node.items) attachLeadingComments(pair.value);
  };
  attachLeadingComments(original.contents);
  attachLeadingComments(template.contents);
  const previousValues = original.toJS() as Record<string, unknown>;
  const targetClassic = template.get('classic', true);
  if (isMap(targetClassic)) {
    for (const pair of [...original.contents.items]) {
      if (!isScalar(pair.key) || template.has(pair.key)) continue;
      const key = String(pair.key.value);
      if (!Object.hasOwn(COMMENTS.en, `classic.${key}`) || !targetClassic.has(key)) continue;
      let classic = original.get('classic', true);
      if (!isMap(classic)) {
        const added = original.createPair('classic', {});
        original.contents.items.push(added);
        classic = added.value;
      }
      if (!isMap(classic)) continue;
      const existing = classic.items.find((item) => isScalar(item.key) && item.key.value === key);
      if (!existing) {
        classic.items.push(pair);
        previousValues.classic = {
          ...(previousValues.classic as Record<string, unknown>),
          [key]: previousValues[key],
        };
      } else {
        if (isScalar(existing.key))
          existing.key.commentBefore =
            [pair.key.commentBefore, existing.key.commentBefore].filter(Boolean).join('\n') ||
            undefined;
        if (isNode(existing.value) && isNode(pair.value))
          existing.value.comment =
            [pair.value.comment, existing.value.comment].filter(Boolean).join('\n') || undefined;
      }
    }
  }
  const managedComments = new Set(
    Object.values(COMMENTS).flatMap((comments) =>
      Object.values(comments).flatMap((comment) =>
        comment.split('\n').map((line) => line.replace(/^#\s?/u, '').trim()),
      ),
    ),
  );
  const merge = (
    current: YAMLMap,
    next: YAMLMap,
    previous: Record<string, unknown>,
    target: Record<string, unknown>,
  ) => {
    for (const pair of [...current.items]) {
      if (!next.has(pair.key)) current.delete(pair.key);
    }
    for (const pair of next.items) {
      const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
      const existing = current.items.find((item) =>
        isScalar(item.key) && isScalar(pair.key) ? item.key.value === pair.key.value : false,
      );
      if (!existing) {
        const added = original.createPair(key, target[key]);
        if (isScalar(added.key) && isScalar(pair.key))
          added.key.commentBefore = pair.key.commentBefore;
        current.items.push(added);
        if (isMap(added.value) && isMap(pair.value))
          merge(
            added.value,
            pair.value,
            target[key] as Record<string, unknown>,
            target[key] as Record<string, unknown>,
          );
        continue;
      }
      if (isScalar(existing.key) && isScalar(pair.key)) {
        const userComments = existing.key.commentBefore
          ?.split('\n')
          .filter((line) => !managedComments.has(line.trim()))
          .join('\n');
        existing.key.commentBefore =
          [pair.key.commentBefore, userComments].filter(Boolean).join('\n') || undefined;
      }
      if (isMap(existing.value) && isMap(pair.value))
        merge(
          existing.value,
          pair.value,
          (previous[key] ?? {}) as Record<string, unknown>,
          target[key] as Record<string, unknown>,
        );
      else if (!isDeepStrictEqual(previous[key], target[key])) {
        const previous = existing.value;
        existing.value = original.createNode(target[key]);
        if (isNode(previous) && isNode(existing.value)) {
          existing.value.comment = previous.comment;
          existing.value.commentBefore = previous.commentBefore;
          existing.value.spaceBefore = previous.spaceBefore;
        }
      }
    }
  };
  merge(original.contents, template.contents, previousValues, value);
  // anchor 被迁移或修改后，别名不能改变扩展字段的原值；只展开受影响的引用。
  const stabilizeAliases = (node: unknown, target: unknown): unknown => {
    if (isAlias(node)) {
      let matches = false;
      try {
        matches = isDeepStrictEqual(node.toJS(original), target);
      } catch {
        /* 原 anchor 可能已迁到引用后方。 */
      }
      if (matches) return node;
      const replacement = original.createNode(target);
      replacement.comment = node.comment;
      replacement.commentBefore = node.commentBefore;
      replacement.spaceBefore = node.spaceBefore;
      return replacement;
    }
    if (isMap(node)) {
      for (const pair of node.items) {
        const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
        pair.value = stabilizeAliases(pair.value, (target as Record<string, unknown>)[key]);
      }
    } else if (isSeq(node) && Array.isArray(target)) {
      node.items = node.items.map((item, index) => stabilizeAliases(item, target[index]));
    }
    return node;
  };
  stabilizeAliases(original.contents, value);
  const result = original.toString();
  return source.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result;
}

function projectRelativeSegments(value: unknown, label: string): string[] {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    /^(?:~|[\\/])/u.test(trimmed)
  ) {
    throw new Error(`${label} must be a project-relative path`);
  }
  if (trimmed === '.') return [];
  const segments = trimmed.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`${label} must stay inside the project root`);
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(`${label} must not contain empty or dot path segments`);
  }
  return segments;
}

export function normalizeWorkflowArtifactRoot(value: unknown): string {
  const segments = projectRelativeSegments(value, 'native.artifact_root');
  return segments.length === 0 ? '.' : segments.join('/');
}

export function normalizeClassicArtifactLayout(
  value: unknown,
  fallback: ClassicArtifactLayout = 'docs',
): ClassicArtifactLayout {
  const resolved = value ?? fallback;
  if (resolved !== 'legacy' && resolved !== 'docs') {
    throw new Error('classic.artifact_layout must be legacy or docs');
  }
  return resolved;
}

export function hasExplicitClassicArtifactLayout(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).artifact_layout !== undefined
  );
}

export function normalizeWorkflowRelativePath(
  value: unknown,
  label: string,
  allowWildcards = false,
): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    /^(?:~|[\\/])/u.test(trimmed)
  ) {
    throw new Error(`${label} must be relative to its declared path base`);
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`${label} must stay inside its declared path base`);
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(`${label} must not contain empty or dot path segments`);
  }
  if (!allowWildcards && /[*?]/u.test(trimmed)) {
    throw new Error(`${label} cannot contain wildcards`);
  }
  return segments.join('/');
}

function projectConfigRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function projectConfigLanguage(
  value: unknown,
  fallback: ProjectConfigLanguage,
  label: string,
): ProjectConfigLanguage {
  const resolved = value ?? fallback;
  if (resolved !== 'en' && resolved !== 'zh-CN') {
    throw new Error(`${label} must be en or zh-CN`);
  }
  return resolved;
}

function positiveWorkflowInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved as number;
}

function workflowKnowledgeLimitMb(value: unknown, fallback: number, label: string): number {
  const resolved = positiveWorkflowInteger(value, fallback, label);
  if (resolved > Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024))) {
    throw new Error(`${label} is too large to convert to bytes safely`);
  }
  return resolved;
}

function normalizeWorkflowPendingRootMove(
  value: unknown,
): WorkflowNativePendingRootMove | undefined {
  if (value === undefined) return undefined;
  const pending = projectConfigRecord(value, 'native.pending_root_move');
  const id = pending.id;
  const from = pending.from_artifact_root;
  const to = pending.to_artifact_root;
  const stage = pending.stage;
  if (typeof id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(id)) {
    throw new Error('native.pending_root_move.id is invalid');
  }
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new Error('native.pending_root_move roots must be strings');
  }
  if (stage !== 'copying' && stage !== 'ready' && stage !== 'switched') {
    throw new Error('native.pending_root_move.stage is invalid');
  }
  let cleanup: WorkflowNativePendingRootMove['cleanup'];
  if (pending.cleanup !== undefined) {
    const rawCleanup = projectConfigRecord(pending.cleanup, 'native.pending_root_move.cleanup');
    const kind = rawCleanup.kind;
    const state = rawCleanup.state;
    const manifestHash = rawCleanup.manifest_hash;
    if (
      kind !== 'forward-source' &&
      kind !== 'restart-staging' &&
      kind !== 'rollback-destination' &&
      kind !== 'rollback-staging'
    ) {
      throw new Error('native.pending_root_move.cleanup.kind is invalid');
    }
    if (state !== 'prepared' && state !== 'quarantined' && state !== 'deleting') {
      throw new Error('native.pending_root_move.cleanup.state is invalid');
    }
    if (typeof manifestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(manifestHash)) {
      throw new Error('native.pending_root_move.cleanup.manifest_hash is invalid');
    }
    cleanup = { kind, state, manifestHash };
  }
  return {
    id,
    fromArtifactRoot: normalizeWorkflowArtifactRoot(from),
    toArtifactRoot: normalizeWorkflowArtifactRoot(to),
    stage,
    ...(cleanup ? { cleanup } : {}),
  };
}

function normalizeWorkflowNativeFinish(
  value: unknown,
): WorkflowNativeProjectConfig['finish'] | undefined {
  if (value === undefined) return undefined;
  const finish = projectConfigRecord(value, 'native.finish');
  if (finish.pull_request === undefined) return {};
  const pullRequest = projectConfigRecord(finish.pull_request, 'native.finish.pull_request');
  if (pullRequest.provider !== 'repository-command') {
    throw new Error('native.finish.pull_request.provider must be repository-command');
  }
  if (!Array.isArray(pullRequest.command) || pullRequest.command.length === 0) {
    throw new Error('native.finish.pull_request.command must be a non-empty array');
  }
  if (pullRequest.command.length > 64) {
    throw new Error('native.finish.pull_request.command must contain at most 64 arguments');
  }
  const command = pullRequest.command.map((argument, index) => {
    if (
      typeof argument !== 'string' ||
      argument.trim().length === 0 ||
      argument.length > 4096 ||
      /[\0\r\n]/u.test(argument)
    ) {
      throw new Error(
        `native.finish.pull_request.command[${index}] must be a non-empty single-line string of at most 4096 characters`,
      );
    }
    return argument;
  });
  if (path.posix.isAbsolute(command[0]) || path.win32.isAbsolute(command[0])) {
    throw new Error(
      'native.finish.pull_request.command[0] must be a bare executable name or a project-relative path',
    );
  }
  const timeoutMs =
    pullRequest.timeout_ms ?? DEFAULT_WORKFLOW_NATIVE_PULL_REQUEST_FINISH_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    (timeoutMs as number) < 1 ||
    (timeoutMs as number) > MAX_WORKFLOW_NATIVE_PULL_REQUEST_FINISH_TIMEOUT_MS
  ) {
    throw new Error(
      `native.finish.pull_request.timeout_ms must be an integer between 1 and ${MAX_WORKFLOW_NATIVE_PULL_REQUEST_FINISH_TIMEOUT_MS}`,
    );
  }
  return {
    pull_request: {
      provider: 'repository-command',
      command,
      timeout_ms: timeoutMs as number,
    },
  };
}

function normalizeWorkflowNativeProjectConfig(
  value: unknown,
  options: { allowMissingArtifactRoot?: boolean } = {},
): WorkflowNativeProjectConfig {
  const native = projectConfigRecord(value, 'native');
  const artifactRoot =
    native.artifact_root ?? (options.allowMissingArtifactRoot ? 'docs' : undefined);
  if (typeof artifactRoot !== 'string') {
    throw new Error('native.artifact_root must be a string');
  }
  const clarificationMode = native.clarification_mode ?? 'batch';
  if (clarificationMode !== 'sequential' && clarificationMode !== 'batch') {
    throw new Error('native.clarification_mode must be sequential or batch');
  }
  const archiveConfirmation = native.archive_confirmation ?? 'automatic';
  if (archiveConfirmation !== 'automatic' && archiveConfirmation !== 'required') {
    throw new Error('native.archive_confirmation must be automatic or required');
  }
  const maxVerifyFailures =
    native.max_verify_failures ?? DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES;
  if (!Number.isSafeInteger(maxVerifyFailures) || (maxVerifyFailures as number) < 1) {
    throw new Error('native.max_verify_failures must be a positive integer');
  }
  const maxParallelChildren =
    native.max_parallel_children === undefined
      ? DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN
      : native.max_parallel_children;
  if (!Number.isSafeInteger(maxParallelChildren) || (maxParallelChildren as number) < 1) {
    throw new Error('native.max_parallel_children must be a positive integer');
  }
  const documentWrites = native.document_writes ?? 'allow';
  if (documentWrites !== 'allow' && documentWrites !== 'revert') {
    throw new Error('native.document_writes must be allow or revert');
  }
  const pending = normalizeWorkflowPendingRootMove(native.pending_root_move);
  const finish = normalizeWorkflowNativeFinish(native.finish);
  return {
    artifact_root: normalizeWorkflowArtifactRoot(artifactRoot),
    language: projectConfigLanguage(native.language, 'en', 'native.language'),
    clarification_mode: clarificationMode,
    archive_confirmation: archiveConfirmation,
    max_verify_failures: maxVerifyFailures as number,
    max_parallel_children: maxParallelChildren as number,
    ...(documentWrites === 'revert' ? { document_writes: documentWrites } : {}),
    ...(finish ? { finish } : {}),
    ...(pending ? { pending_root_move: pending } : {}),
  };
}

export function normalizeWorkflowClassicCheckTimeout(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_WORKFLOW_CLASSIC_CHECK_TIMEOUT_MS
  ) {
    throw new Error(
      `${label} must be an integer between 1 and ${MAX_WORKFLOW_CLASSIC_CHECK_TIMEOUT_MS} milliseconds`,
    );
  }
  return value as number;
}

function normalizeWorkflowClassicProjectConfig(value: unknown): WorkflowClassicProjectConfig {
  const classic = projectConfigRecord(value, 'classic');
  const contextCompression = classic.context_compression ?? 'off';
  if (contextCompression !== 'off' && contextCompression !== 'beta') {
    throw new Error('classic.context_compression must be off or beta');
  }
  const reviewMode = classic.review_mode ?? 'standard';
  if (reviewMode !== 'off' && reviewMode !== 'standard' && reviewMode !== 'thorough') {
    throw new Error('classic.review_mode must be off, standard, or thorough');
  }
  const autoTransition = classic.auto_transition ?? true;
  if (typeof autoTransition !== 'boolean') {
    throw new Error('classic.auto_transition must be true or false');
  }
  if (classic.check_timeout_ms !== undefined) {
    normalizeWorkflowClassicCheckTimeout(classic.check_timeout_ms, 'classic.check_timeout_ms');
  }
  const documentEvidence = classic.document_evidence ?? 'neutral';
  if (documentEvidence !== 'neutral' && documentEvidence !== 'strict') {
    throw new Error('classic.document_evidence must be neutral or strict');
  }
  return {
    artifact_layout: normalizeClassicArtifactLayout(classic.artifact_layout),
    language: projectConfigLanguage(classic.language, 'zh-CN', 'classic.language'),
    context_compression: contextCompression,
    review_mode: reviewMode,
    auto_transition: autoTransition,
    ...(documentEvidence === 'strict' ? { document_evidence: documentEvidence } : {}),
    ...(classic.check_timeout_ms !== undefined
      ? { check_timeout_ms: classic.check_timeout_ms as number }
      : {}),
  };
}

function normalizeWorkflowHookProjectConfig(value: unknown): WorkflowHookProjectConfig {
  const hook = projectConfigRecord(value, 'hook');
  const allowPaths = hook.allow_paths ?? [];
  if (!Array.isArray(allowPaths)) {
    throw new Error('hook.allow_paths must be an array');
  }
  return {
    allow_paths: [
      ...new Set(
        allowPaths.map((allowPath, index) =>
          normalizeWorkflowRelativePath(allowPath, `hook.allow_paths[${index}]`),
        ),
      ),
    ],
  };
}

function normalizeWorkflowMemoryProjectConfig(value: unknown): WorkflowMemoryProjectConfig {
  if (value === undefined) {
    return { ...DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG };
  }
  const memory = projectConfigRecord(value, 'memory');
  const learning = memory.learning ?? DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG.learning;
  const retrieval = memory.retrieval ?? DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG.retrieval;
  if (typeof learning !== 'boolean') {
    throw new Error('memory.learning must be true or false');
  }
  if (typeof retrieval !== 'boolean') {
    throw new Error('memory.retrieval must be true or false');
  }
  return { learning, retrieval };
}

function projectKnowledgeRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function normalizeKnowledgeIncludePattern(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const pattern = value.trim();
  if (
    pattern.length === 0 ||
    pattern.includes('\\') ||
    pattern.includes('\0') ||
    path.posix.isAbsolute(pattern) ||
    path.win32.isAbsolute(pattern) ||
    pattern.startsWith('~') ||
    pattern.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a safe project-relative glob`);
  }
  if (!pattern.toLowerCase().endsWith('.md')) {
    throw new Error(`${label} must target a Markdown file ending in .md`);
  }
  if (pattern.length > MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_LENGTH} characters`);
  }
  let wildcardTokens = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === '?') {
      wildcardTokens += 1;
    } else if (pattern[index] === '*') {
      wildcardTokens += 1;
      if (pattern[index + 1] === '*') index += 1;
    }
  }
  if (wildcardTokens > MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_WILDCARDS) {
    throw new Error(
      `${label} contains more than ${MAX_WORKFLOW_KNOWLEDGE_INCLUDE_PATTERN_WILDCARDS} wildcard tokens`,
    );
  }
  return pattern;
}

function normalizeKnowledgeLocal(value: unknown): WorkflowKnowledgeLocalConfig {
  const local = projectKnowledgeRecord(value, 'knowledge.local');
  const include = local.include ?? [];
  if (!Array.isArray(include)) throw new Error('knowledge.local.include must be an array');
  const normalized = {
    include: [
      ...new Set(
        include.map((pattern, index) =>
          normalizeKnowledgeIncludePattern(pattern, `knowledge.local.include[${index}]`),
        ),
      ),
    ],
    max_file_mb: workflowKnowledgeLimitMb(
      local.max_file_mb,
      DEFAULT_WORKFLOW_KNOWLEDGE_LOCAL_CONFIG.max_file_mb,
      'knowledge.local.max_file_mb',
    ),
    max_total_mb: workflowKnowledgeLimitMb(
      local.max_total_mb,
      DEFAULT_WORKFLOW_KNOWLEDGE_LOCAL_CONFIG.max_total_mb,
      'knowledge.local.max_total_mb',
    ),
  };
  if (normalized.max_file_mb > normalized.max_total_mb) {
    throw new Error('knowledge.local.max_file_mb must not exceed max_total_mb');
  }
  return normalized;
}

function normalizeKnowledgeEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('knowledge.remote.endpoint must be a non-empty URL');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('knowledge.remote.endpoint must be a valid URL');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('knowledge.remote.endpoint must use HTTPS (HTTP is allowed for loopback)');
  }
  return url.toString();
}

function normalizeKnowledgeRemote(value: unknown): WorkflowKnowledgeRemoteConfig {
  const remote = projectKnowledgeRecord(value, 'knowledge.remote');
  const endpoint = normalizeKnowledgeEndpoint(remote.endpoint);
  const tokenEnv = remote.token_env;
  if (
    tokenEnv !== undefined &&
    (typeof tokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tokenEnv))
  ) {
    throw new Error('knowledge.remote.token_env must be an environment variable name');
  }
  const scope = remote.scope;
  if (scope !== undefined && (typeof scope !== 'string' || scope.length > 512)) {
    throw new Error('knowledge.remote.scope must be a string of at most 512 characters');
  }
  const timeout = remote.timeout_ms ?? 5000;
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout < 100 ||
    timeout > 30000
  ) {
    throw new Error('knowledge.remote.timeout_ms must be an integer between 100 and 30000');
  }
  return {
    endpoint,
    ...(tokenEnv === undefined ? {} : { token_env: tokenEnv }),
    ...(scope === undefined ? {} : { scope }),
    timeout_ms: timeout,
  };
}

function normalizeWorkflowKnowledgeProjectConfig(value: unknown): WorkflowKnowledgeProjectConfig {
  if (value === undefined) return { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
  const knowledge = projectKnowledgeRecord(value, 'knowledge');
  const provider = knowledge.provider ?? 'local';
  if (provider !== 'local' && provider !== 'remote') {
    throw new Error('knowledge.provider must be local or remote');
  }
  const local =
    knowledge.local === undefined ? undefined : normalizeKnowledgeLocal(knowledge.local);
  if (provider === 'local') return { provider, ...(local ? { local } : {}) };
  const remote =
    knowledge.remote === undefined ? undefined : normalizeKnowledgeRemote(knowledge.remote);
  if (remote === undefined) {
    throw new Error('knowledge.remote must be configured when knowledge.provider is remote');
  }
  return { provider, ...(local ? { local } : {}), remote };
}

export function normalizeChangeWalkthrough(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new Error('change_walkthrough must be true or false');
  return value;
}

function normalizeAmbientResume(value: unknown): boolean {
  const resolved = value ?? true;
  if (typeof resolved !== 'boolean') {
    throw new Error('ambient_resume must be true or false');
  }
  return resolved;
}

function normalizeWorkflowProjectConfig(
  root: Record<string, unknown>,
  hook: WorkflowHookProjectConfig | undefined,
  memory: WorkflowMemoryProjectConfig,
  knowledge: WorkflowKnowledgeProjectConfig,
  native: WorkflowNativeProjectConfig | undefined,
  classic: WorkflowClassicProjectConfig | undefined,
  ambientResume: boolean,
  options: { allowPartialProject: boolean },
): WorkflowProjectConfig | null {
  const hasSchema = root.schema !== undefined;
  const hasProjectMarker =
    hasSchema ||
    root.default_workflow !== undefined ||
    root.workflows !== undefined ||
    (!options.allowPartialProject && root.native !== undefined);
  if (!hasProjectMarker) return null;
  if (options.allowPartialProject && !hasSchema) return null;
  if (root.schema !== 'comet.project.v1') {
    throw new Error('Unsupported Comet project schema');
  }
  if (root.default_workflow !== 'native' && root.default_workflow !== 'classic') {
    throw new Error('default_workflow must be native or classic');
  }
  const configuredWorkflows = root.workflows ?? [root.default_workflow];
  if (
    !Array.isArray(configuredWorkflows) ||
    configuredWorkflows.length === 0 ||
    configuredWorkflows.some((workflow) => workflow !== 'native' && workflow !== 'classic')
  ) {
    throw new Error('workflows must contain native and/or classic');
  }
  const workflows = [...new Set(configuredWorkflows)] as Array<'native' | 'classic'>;
  if (!workflows.includes(root.default_workflow)) {
    throw new Error('workflows must include default_workflow');
  }
  if (workflows.includes('native') && !native) {
    throw new Error('native must be a mapping');
  }
  return {
    schema: 'comet.project.v1',
    default_workflow: root.default_workflow,
    workflows,
    ambient_resume: ambientResume,
    change_walkthrough: normalizeChangeWalkthrough(root.change_walkthrough),
    ...(hook ? { hook } : {}),
    memory,
    knowledge,
    ...(native ? { native } : {}),
    ...(classic ? { classic } : {}),
  };
}

/** 在校验失败后识别明确的项目声明；只检查顶层 schema，不把正文中的文本当作声明。 */
export function declaresWorkflowProjectConfig(source: string): boolean {
  const document = parseDocument(source);
  const scalarValue = (node: unknown): unknown => {
    const resolved = isAlias(node) ? node.resolve(document) : node;
    return isScalar(resolved) ? resolved.value : undefined;
  };
  return (
    isMap(document.contents) &&
    document.contents.items.some(
      ({ key, value }) =>
        scalarValue(key) === 'schema' && scalarValue(value) === 'comet.project.v1',
    )
  );
}

/**
 * Parse one project-config YAML document exactly once. Missing fields may use
 * their runtime defaults, but malformed YAML, duplicate keys, and invalid
 * managed values fail closed. Unknown fields remain in `value` for round trips.
 */
export function parseWorkflowProjectConfigDocument(
  source: string,
  options: { allowPartialProject?: boolean; allowMissingNativeFields?: boolean } = {},
): ParsedWorkflowProjectConfigDocument {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid .comet/config.yaml: ${document.errors[0].message}`);
  }
  const parsed = document.toJS() as unknown;
  if (parsed === null || parsed === undefined) {
    return { value: {}, config: null, ambient_resume: true, change_walkthrough: true };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid .comet/config.yaml: root must be a mapping');
  }
  const value = parsed as Record<string, unknown>;
  const ambientResume = normalizeAmbientResume(value.ambient_resume);
  const changeWalkthrough = normalizeChangeWalkthrough(value.change_walkthrough);
  const hook =
    value.hook === undefined ? undefined : normalizeWorkflowHookProjectConfig(value.hook);
  const memory = normalizeWorkflowMemoryProjectConfig(value.memory);
  const knowledge = normalizeWorkflowKnowledgeProjectConfig(value.knowledge);
  const native =
    value.native === undefined
      ? undefined
      : normalizeWorkflowNativeProjectConfig(value.native, {
          allowMissingArtifactRoot: options.allowMissingNativeFields,
        });
  const classic =
    value.classic === undefined ? undefined : normalizeWorkflowClassicProjectConfig(value.classic);
  const config = normalizeWorkflowProjectConfig(
    value,
    hook,
    memory,
    knowledge,
    native,
    classic,
    ambientResume,
    {
      allowPartialProject: options.allowPartialProject ?? false,
    },
  );
  return {
    value,
    config,
    ambient_resume: ambientResume,
    change_walkthrough: changeWalkthrough,
    memory,
    knowledge,
    ...(hook ? { hook } : {}),
    ...(native ? { native } : {}),
    ...(classic ? { classic } : {}),
  };
}

function workflowPendingRootMoveValue(
  pending: WorkflowNativePendingRootMove,
): Record<string, unknown> {
  return {
    id: pending.id,
    from_artifact_root: pending.fromArtifactRoot,
    to_artifact_root: pending.toArtifactRoot,
    stage: pending.stage,
    ...(pending.cleanup
      ? {
          cleanup: {
            kind: pending.cleanup.kind,
            state: pending.cleanup.state,
            manifest_hash: pending.cleanup.manifestHash,
          },
        }
      : {}),
  };
}

export function workflowProjectConfigManagedValue(
  config: WorkflowProjectConfig,
): Record<string, unknown> {
  const knowledge = config.knowledge ?? { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG };
  return {
    schema: config.schema,
    default_workflow: config.default_workflow,
    workflows: config.workflows ?? [config.default_workflow],
    ambient_resume: config.ambient_resume,
    change_walkthrough: config.change_walkthrough ?? true,
    memory: config.memory ?? { ...DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG },
    knowledge: {
      provider: knowledge.provider,
      ...(knowledge.local
        ? {
            local: {
              include: [...knowledge.local.include],
              max_file_mb:
                knowledge.local.max_file_mb ?? DEFAULT_WORKFLOW_KNOWLEDGE_LOCAL_CONFIG.max_file_mb,
              max_total_mb:
                knowledge.local.max_total_mb ??
                DEFAULT_WORKFLOW_KNOWLEDGE_LOCAL_CONFIG.max_total_mb,
            },
          }
        : {}),
      ...(knowledge.remote
        ? {
            remote: {
              endpoint: knowledge.remote.endpoint,
              timeout_ms: knowledge.remote.timeout_ms,
              ...(knowledge.remote.token_env === undefined
                ? {}
                : { token_env: knowledge.remote.token_env }),
              ...(knowledge.remote.scope === undefined ? {} : { scope: knowledge.remote.scope }),
            },
          }
        : {}),
    },
    ...(config.hook
      ? {
          hook: {
            allow_paths: [...config.hook.allow_paths],
          },
        }
      : {}),
    ...(config.native
      ? {
          native: {
            artifact_root: config.native.artifact_root,
            language: config.native.language,
            clarification_mode: config.native.clarification_mode,
            archive_confirmation: config.native.archive_confirmation,
            max_verify_failures: config.native.max_verify_failures,
            max_parallel_children:
              config.native.max_parallel_children ?? DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN,
            ...(config.native.document_writes
              ? { document_writes: config.native.document_writes }
              : {}),
            ...(config.native.finish?.pull_request
              ? {
                  finish: {
                    pull_request: {
                      provider: config.native.finish.pull_request.provider,
                      command: [...config.native.finish.pull_request.command],
                      timeout_ms: config.native.finish.pull_request.timeout_ms,
                    },
                  },
                }
              : {}),
            ...(config.native.pending_root_move
              ? {
                  pending_root_move: workflowPendingRootMoveValue(config.native.pending_root_move),
                }
              : {}),
          },
        }
      : {}),
    ...(config.classic
      ? {
          classic: {
            artifact_layout: config.classic.artifact_layout,
            language: config.classic.language,
            context_compression: config.classic.context_compression,
            review_mode: config.classic.review_mode,
            auto_transition: config.classic.auto_transition,
            ...(config.classic.check_timeout_ms !== undefined
              ? { check_timeout_ms: config.classic.check_timeout_ms }
              : {}),
            ...(config.classic.document_evidence
              ? { document_evidence: config.classic.document_evidence }
              : {}),
          },
        }
      : {}),
  };
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function mergeWorkflowProjectConfigDocument(
  existing: Record<string, unknown>,
  config: WorkflowProjectConfig,
): Record<string, unknown> {
  const managed = workflowProjectConfigManagedValue({
    ...config,
    change_walkthrough:
      config.change_walkthrough ?? normalizeChangeWalkthrough(existing.change_walkthrough),
  });
  const validated = parseWorkflowProjectConfigDocument(stringify(managed)).config;
  if (!validated) throw new Error('Unsupported Comet project schema');
  const output: Record<string, unknown> = {
    ...existing,
    schema: validated.schema,
    default_workflow: validated.default_workflow,
    workflows: validated.workflows,
    ambient_resume: validated.ambient_resume,
    change_walkthrough: validated.change_walkthrough ?? true,
  };
  if (validated.hook) {
    output.hook = {
      ...optionalRecord(existing.hook),
      allow_paths: [...validated.hook.allow_paths],
    };
  }
  if (validated.memory) {
    const existingMemory = optionalRecord(existing.memory);
    output.memory = {
      ...existingMemory,
      learning: validated.memory.learning,
      retrieval: validated.memory.retrieval,
    };
  }
  if (validated.knowledge) {
    const existingKnowledge = optionalRecord(existing.knowledge);
    const knowledge: Record<string, unknown> = {
      ...existingKnowledge,
      provider: validated.knowledge.provider,
    };
    if (validated.knowledge.local) {
      knowledge.local = {
        ...optionalRecord(existingKnowledge.local),
        include: [...validated.knowledge.local.include],
        max_file_mb: validated.knowledge.local.max_file_mb,
        max_total_mb: validated.knowledge.local.max_total_mb,
      };
    } else {
      delete knowledge.local;
    }
    if (validated.knowledge.remote) {
      const existingRemote = optionalRecord(existingKnowledge.remote);
      const remote: Record<string, unknown> = {
        ...existingRemote,
        endpoint: validated.knowledge.remote.endpoint,
        timeout_ms: validated.knowledge.remote.timeout_ms,
        ...(validated.knowledge.remote.token_env === undefined
          ? {}
          : { token_env: validated.knowledge.remote.token_env }),
        ...(validated.knowledge.remote.scope === undefined
          ? {}
          : { scope: validated.knowledge.remote.scope }),
      };
      if (validated.knowledge.remote.token_env === undefined) delete remote.token_env;
      if (validated.knowledge.remote.scope === undefined) delete remote.scope;
      knowledge.remote = remote;
    } else {
      delete knowledge.remote;
    }
    output.knowledge = knowledge;
  }
  if (validated.native) {
    const existingNative = optionalRecord(existing.native);
    const native: Record<string, unknown> = {
      ...existingNative,
      artifact_root: validated.native.artifact_root,
      language: validated.native.language,
      clarification_mode: validated.native.clarification_mode,
      archive_confirmation: validated.native.archive_confirmation,
      max_verify_failures: validated.native.max_verify_failures,
      max_parallel_children: validated.native.max_parallel_children,
      ...(validated.native.document_writes
        ? { document_writes: validated.native.document_writes }
        : {}),
    };
    if (config.native?.document_writes === 'allow') delete native.document_writes;
    if (validated.native.finish?.pull_request) {
      const existingFinish = optionalRecord(existingNative.finish);
      native.finish = {
        ...existingFinish,
        pull_request: {
          ...optionalRecord(existingFinish.pull_request),
          provider: validated.native.finish.pull_request.provider,
          command: [...validated.native.finish.pull_request.command],
          timeout_ms: validated.native.finish.pull_request.timeout_ms,
        },
      };
    } else {
      const remainingFinish = { ...optionalRecord(existingNative.finish) };
      delete remainingFinish.pull_request;
      if (Object.keys(remainingFinish).length > 0) native.finish = remainingFinish;
      else delete native.finish;
    }
    // 旧快照设置不参与当前流程；升级写回时移除。
    delete native.snapshot;
    if (validated.native.pending_root_move) {
      const existingPending = optionalRecord(existingNative.pending_root_move);
      const pending = workflowPendingRootMoveValue(validated.native.pending_root_move);
      const existingCleanup = optionalRecord(existingPending.cleanup);
      const managedCleanup = optionalRecord(pending.cleanup);
      native.pending_root_move = {
        ...existingPending,
        ...pending,
        ...(pending.cleanup ? { cleanup: { ...existingCleanup, ...managedCleanup } } : {}),
      };
    } else {
      delete native.pending_root_move;
    }
    output.native = native;
  }
  if (validated.classic) {
    output.classic = {
      ...optionalRecord(existing.classic),
      artifact_layout: validated.classic.artifact_layout,
      language: validated.classic.language,
      context_compression: validated.classic.context_compression,
      review_mode: validated.classic.review_mode,
      auto_transition: validated.classic.auto_transition,
      ...(validated.classic.check_timeout_ms !== undefined
        ? { check_timeout_ms: validated.classic.check_timeout_ms }
        : {}),
      ...(validated.classic.document_evidence
        ? { document_evidence: validated.classic.document_evidence }
        : {}),
    };
  }
  return output;
}

export function defaultWorkflowProjectConfig(
  artifactRoot = 'docs',
  language: ProjectConfigLanguage = 'en',
): WorkflowNativeEnabledProjectConfig {
  return {
    schema: 'comet.project.v1',
    default_workflow: 'native',
    ambient_resume: true,
    change_walkthrough: true,
    memory: { ...DEFAULT_WORKFLOW_MEMORY_PROJECT_CONFIG },
    knowledge: { ...DEFAULT_WORKFLOW_KNOWLEDGE_PROJECT_CONFIG },
    native: {
      artifact_root: normalizeWorkflowArtifactRoot(artifactRoot),
      language,
      clarification_mode: 'batch',
      archive_confirmation: 'automatic',
      max_verify_failures: DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES,
      max_parallel_children: DEFAULT_WORKFLOW_NATIVE_MAX_PARALLEL_CHILDREN,
    },
  };
}
