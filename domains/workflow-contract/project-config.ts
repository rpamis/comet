import path from 'path';
import { stringify, parseDocument } from 'yaml';

import type {
  ClassicArtifactLayout,
  ParsedWorkflowProjectConfigDocument,
  ProjectConfigLanguage,
  WorkflowClassicProjectConfig,
  WorkflowNativeEnabledProjectConfig,
  WorkflowNativePendingRootMove,
  WorkflowNativeProjectConfig,
  WorkflowNativeSnapshotConfig,
  WorkflowProjectConfig,
} from './types.js';

export type ProjectConfigCommentLanguage = 'en' | 'zh-CN';

export const WORKFLOW_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
export const MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH = 1024;
export const MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS = 64;
export const DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES = 5;
export const DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG: WorkflowNativeSnapshotConfig = {
  include: ['**/*'],
  exclude: [],
  max_files: 10_000,
  max_total_bytes: 256 * 1024 * 1024,
  max_duration_ms: 60_000,
};

type ProjectConfigCommentKey =
  | 'schema'
  | 'default_workflow'
  | 'workflows'
  | 'ambient_resume'
  | 'native'
  | 'native.artifact_root'
  | 'native.language'
  | 'native.clarification_mode'
  | 'native.archive_confirmation'
  | 'native.max_verify_failures'
  | 'native.snapshot'
  | 'native.snapshot.include'
  | 'native.snapshot.exclude'
  | 'native.snapshot.max_files'
  | 'native.snapshot.max_total_bytes'
  | 'native.snapshot.max_duration_ms'
  | 'classic'
  | 'classic.artifact_layout'
  | 'classic.language'
  | 'classic.context_compression'
  | 'classic.review_mode'
  | 'classic.auto_transition';

const COMMENTS: Record<ProjectConfigCommentLanguage, Record<ProjectConfigCommentKey, string>> = {
  en: {
    schema: '# Configuration schema used by Comet. Do not edit this value.',
    default_workflow: '# Default workflow entered by /comet. Must also appear in workflows.',
    workflows: '# Workflows enabled in this project: native, classic, or both.',
    ambient_resume:
      '# Enables automatic recovery through the read-only Ambient Resume probe for both Native and Classic. Set false to disable it.\n# ambient_resume: true | false',
    native: '# Native workflow settings. They do not change Classic state or behavior.',
    'native.artifact_root':
      '# Root directory where Native stores Comet specs, changes, and runtime data.',
    'native.language':
      '# Artifact language used by Native workflow documents.\n# language: en | zh-CN',
    'native.clarification_mode':
      '# Controls whether Native asks one clarification at a time or every currently answerable question in a round.\n# clarification_mode: sequential | batch',
    'native.archive_confirmation':
      '# Controls whether Native archives automatically after a successful preview or waits for explicit user confirmation.\n# archive_confirmation: automatic | required',
    'native.max_verify_failures':
      '# Maximum failed Verify outcomes allowed for one confirmed contract before Native stops the completion loop.',
    'native.snapshot':
      '# Controls the auditable project scope and bounded work used by Native content snapshots.',
    'native.snapshot.include':
      '# Selects the project-relative paths included in Native snapshots. Patterns use / and support *, **, and ?.',
    'native.snapshot.exclude':
      '# Removes paths from the included scope. Exclusions are bound into each new change baseline.',
    'native.snapshot.max_files':
      '# Bounds the number of files captured by one snapshot. Increase it for large monorepos.',
    'native.snapshot.max_total_bytes':
      '# Bounds the total file content hashed by one snapshot. Content is streamed and does not depend on Git hashes.',
    'native.snapshot.max_duration_ms':
      '# Bounds snapshot capture time in milliseconds. Increase it together with the byte budget on slower or larger repositories.',
    classic: '# Classic workflow settings. They do not change Native state or behavior.',
    'classic.artifact_layout':
      '# Selects the Classic artifact layout. New projects use docs; existing projects remain legacy until explicitly migrated.\n# artifact_layout: legacy | docs',
    'classic.language':
      '# Artifact language used by Classic workflow documents.\n# language: en | zh-CN',
    'classic.context_compression':
      '# Controls beta context compression for new Classic changes.\n# context_compression: off | beta',
    'classic.review_mode':
      '# Sets the default review depth for new Classic changes.\n# review_mode: off | standard | thorough',
    'classic.auto_transition':
      '# Automatically enters the next Classic phase after a phase passes.\n# auto_transition: true | false',
  },
  'zh-CN': {
    schema: '# Comet 使用的配置格式版本，请勿修改此值。',
    default_workflow: '# `/comet` 默认进入的工作流；该值也必须出现在 workflows 中。',
    workflows: '# 此项目启用的工作流，可填写 native、classic 或同时启用两者。',
    ambient_resume:
      '# 是否启用只读的环境感知恢复探针，同时作用于 Native 和 Classic；设为 false 可关闭自动工作流恢复。\n# ambient_resume: true | false',
    native: '# Native 工作流配置，不会改变 Classic 的状态或行为。',
    'native.artifact_root': '# Native 产物的存放根目录，包括规格、change 和运行时数据。',
    'native.language': '# Native 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
    'native.clarification_mode':
      '# Native 每轮询问一个问题，或一次提出当前所有可回答的问题。\n# 可选值：sequential | batch',
    'native.archive_confirmation':
      '# Native 归档预演成功后自动归档，或等待用户明确确认。\n# 可选值：automatic | required',
    'native.max_verify_failures':
      '# 同一份已确认 contract 最多允许的 Verify 失败次数；达到上限后停止完成循环。',
    'native.snapshot': '# Native 内容快照使用的可审计项目范围与有界工作预算。',
    'native.snapshot.include': '# Native 快照纳入的项目相对路径；模式使用 /，支持 *、** 和 ?。',
    'native.snapshot.exclude': '# 从纳入范围中排除路径；新 change 会把排除策略绑定到 baseline。',
    'native.snapshot.max_files': '# 单次快照最多捕获的文件数；大型 monorepo 可按需提高。',
    'native.snapshot.max_total_bytes':
      '# 单次快照最多哈希的文件内容总字节数；内容采用流式读取，不依赖 Git hash。',
    'native.snapshot.max_duration_ms':
      '# 单次快照的最长执行时间（毫秒）；较慢或更大的仓库应与字节预算一并提高。',
    classic: '# Classic 工作流配置，不会改变 Native 的状态或行为。',
    'classic.artifact_layout':
      '# Classic 产物布局；新项目使用 docs，已有项目在显式迁移前保持 legacy。\n# 可选值：legacy | docs',
    'classic.language': '# Classic 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
    'classic.context_compression':
      '# 新建 Classic change 是否启用 beta 上下文压缩。\n# 可选值：off | beta',
    'classic.review_mode':
      '# 新建 Classic change 默认使用的审查深度。\n# 可选值：off | standard | thorough',
    'classic.auto_transition': '# Classic 阶段通过后是否自动进入下一阶段。\n# 可选值：true | false',
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
  block: 'native' | 'classic' | null,
  nativeNested: 'snapshot' | null,
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
  if (indent === 4 && block === 'native' && nativeNested === 'snapshot') {
    const nestedKey = `native.snapshot.${key}` as ProjectConfigCommentKey;
    if (nestedKey in COMMENTS.en) return nestedKey;
  }
  return null;
}

export function renderStructuredProjectConfig(
  value: Record<string, unknown>,
  language: ProjectConfigCommentLanguage,
): string {
  const output: string[] = [];
  let block: 'native' | 'classic' | null = null;
  let nativeNested: 'snapshot' | null = null;
  for (const line of stringify(value).trimEnd().split('\n')) {
    const key = commentKey(line, block, nativeNested);
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
      else block = null;
      nativeNested = null;
    } else if (/^ {2}[a-z_]+:/u.test(line) && block === 'native') {
      nativeNested = line.startsWith('  snapshot:') ? 'snapshot' : null;
    }
  }
  output.push('');
  return output.join('\n');
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
  fallback: ClassicArtifactLayout = 'legacy',
): ClassicArtifactLayout {
  const resolved = value ?? fallback;
  if (resolved !== 'legacy' && resolved !== 'docs') {
    throw new Error('classic.artifact_layout must be legacy or docs');
  }
  return resolved;
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

export function normalizeWorkflowSnapshotPattern(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  ) {
    throw new Error(`${label} contains an unsafe pattern`);
  }
  if (value.length > MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_WORKFLOW_SNAPSHOT_PATTERN_LENGTH} characters`);
  }
  let wildcardTokens = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '?') {
      wildcardTokens += 1;
    } else if (value[index] === '*') {
      wildcardTokens += 1;
      if (value[index + 1] === '*') index += 1;
    }
  }
  if (wildcardTokens > MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS) {
    throw new Error(
      `${label} contains more than ${MAX_WORKFLOW_SNAPSHOT_PATTERN_WILDCARDS} wildcard tokens`,
    );
  }
  return value;
}

function workflowSnapshotPatterns(value: unknown, label: string, fallback: string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`${label} contains an unsafe pattern`);
  return [
    ...new Set(value.map((pattern) => normalizeWorkflowSnapshotPattern(pattern, label))),
  ].sort((left, right) => left.localeCompare(right, 'en'));
}

function positiveWorkflowSnapshotInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return resolved as number;
}

function normalizeWorkflowSnapshot(value: unknown): WorkflowNativeSnapshotConfig {
  if (value === undefined) {
    return {
      ...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG,
      include: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.include],
      exclude: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude],
    };
  }
  const snapshot = projectConfigRecord(value, 'native.snapshot');
  return {
    include: workflowSnapshotPatterns(
      snapshot.include,
      'native.snapshot.include',
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.include,
    ),
    exclude: workflowSnapshotPatterns(
      snapshot.exclude,
      'native.snapshot.exclude',
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude,
    ),
    max_files: positiveWorkflowSnapshotInteger(
      snapshot.max_files,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_files,
      'native.snapshot.max_files',
    ),
    max_total_bytes: positiveWorkflowSnapshotInteger(
      snapshot.max_total_bytes,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_total_bytes,
      'native.snapshot.max_total_bytes',
    ),
    max_duration_ms: positiveWorkflowSnapshotInteger(
      snapshot.max_duration_ms,
      DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.max_duration_ms,
      'native.snapshot.max_duration_ms',
    ),
  };
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

function normalizeWorkflowNativeProjectConfig(value: unknown): WorkflowNativeProjectConfig {
  const native = projectConfigRecord(value, 'native');
  if (typeof native.artifact_root !== 'string') {
    throw new Error('native.artifact_root must be a string');
  }
  const clarificationMode = native.clarification_mode ?? 'sequential';
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
  const pending = normalizeWorkflowPendingRootMove(native.pending_root_move);
  return {
    artifact_root: normalizeWorkflowArtifactRoot(native.artifact_root),
    language: projectConfigLanguage(native.language, 'en', 'native.language'),
    clarification_mode: clarificationMode,
    archive_confirmation: archiveConfirmation,
    max_verify_failures: maxVerifyFailures as number,
    snapshot: normalizeWorkflowSnapshot(native.snapshot),
    ...(pending ? { pending_root_move: pending } : {}),
  };
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
  return {
    artifact_layout: normalizeClassicArtifactLayout(classic.artifact_layout),
    language: projectConfigLanguage(classic.language, 'zh-CN', 'classic.language'),
    context_compression: contextCompression,
    review_mode: reviewMode,
    auto_transition: autoTransition,
  };
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
    ...(native ? { native } : {}),
    ...(classic ? { classic } : {}),
  };
}

/**
 * Parse one project-config YAML document exactly once. Missing fields may use
 * their runtime defaults, but malformed YAML, duplicate keys, and invalid
 * managed values fail closed. Unknown fields remain in `value` for round trips.
 */
export function parseWorkflowProjectConfigDocument(
  source: string,
  options: { allowPartialProject?: boolean } = {},
): ParsedWorkflowProjectConfigDocument {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid .comet/config.yaml: ${document.errors[0].message}`);
  }
  const parsed = document.toJS() as unknown;
  if (parsed === null || parsed === undefined) {
    return { value: {}, config: null, ambient_resume: true };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid .comet/config.yaml: root must be a mapping');
  }
  const value = parsed as Record<string, unknown>;
  const ambientResume = normalizeAmbientResume(value.ambient_resume);
  const native =
    value.native === undefined ? undefined : normalizeWorkflowNativeProjectConfig(value.native);
  const classic =
    value.classic === undefined ? undefined : normalizeWorkflowClassicProjectConfig(value.classic);
  const config = normalizeWorkflowProjectConfig(value, native, classic, ambientResume, {
    allowPartialProject: options.allowPartialProject ?? false,
  });
  return {
    value,
    config,
    ambient_resume: ambientResume,
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
  return {
    schema: config.schema,
    default_workflow: config.default_workflow,
    workflows: config.workflows ?? [config.default_workflow],
    ambient_resume: config.ambient_resume,
    ...(config.native
      ? {
          native: {
            artifact_root: config.native.artifact_root,
            language: config.native.language,
            clarification_mode: config.native.clarification_mode,
            archive_confirmation: config.native.archive_confirmation,
            max_verify_failures: config.native.max_verify_failures,
            snapshot: config.native.snapshot,
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
  const managed = workflowProjectConfigManagedValue(config);
  const validated = parseWorkflowProjectConfigDocument(stringify(managed)).config;
  if (!validated) throw new Error('Unsupported Comet project schema');
  const output: Record<string, unknown> = {
    ...existing,
    schema: validated.schema,
    default_workflow: validated.default_workflow,
    workflows: validated.workflows,
    ambient_resume: validated.ambient_resume,
  };
  if (validated.native) {
    const existingNative = optionalRecord(existing.native);
    const existingSnapshot = optionalRecord(existingNative.snapshot);
    const native: Record<string, unknown> = {
      ...existingNative,
      artifact_root: validated.native.artifact_root,
      language: validated.native.language,
      clarification_mode: validated.native.clarification_mode,
      archive_confirmation: validated.native.archive_confirmation,
      max_verify_failures: validated.native.max_verify_failures,
      snapshot: {
        ...existingSnapshot,
        ...validated.native.snapshot,
      },
    };
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
    native: {
      artifact_root: normalizeWorkflowArtifactRoot(artifactRoot),
      language,
      clarification_mode: 'sequential',
      archive_confirmation: 'automatic',
      max_verify_failures: DEFAULT_WORKFLOW_NATIVE_MAX_VERIFY_FAILURES,
      snapshot: {
        ...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG,
        include: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.include],
        exclude: [...DEFAULT_WORKFLOW_NATIVE_SNAPSHOT_CONFIG.exclude],
      },
    },
  };
}

/**
 * Dependency-free counterpart used by generated workflow runtimes. Keep its
 * path and enum checks behaviorally aligned with the typed helpers above.
 */
export function workflowProjectConfigRuntimeHelperScript(): string {
  return String.raw`
const WORKFLOW_PROJECT_CONFIG_MAX_BYTES = 64 * 1024;
const WORKFLOW_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

function workflowProjectRelativeSegments(value, label) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string');
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    throw new Error(label + ' must be a project-relative path');
  }
  if (trimmed === '.') return [];
  const segments = trimmed.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(label + ' must stay inside the project root');
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(label + ' must not contain empty or dot path segments');
  }
  return segments;
}

function normalizeWorkflowArtifactRoot(value) {
  const segments = workflowProjectRelativeSegments(value, 'native.artifact_root');
  return segments.length === 0 ? '.' : segments.join('/');
}

function normalizeClassicArtifactLayout(value, fallback = 'legacy') {
  const resolved = value ?? fallback;
  if (resolved !== 'legacy' && resolved !== 'docs') {
    throw new Error('classic.artifact_layout must be legacy or docs');
  }
  return resolved;
}

function workflowPathInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

async function inspectWorkflowProtectedPath(
  projectRoot,
  target,
  label,
  expected = 'any',
) {
  const lexicalRoot = path.resolve(projectRoot);
  const lexicalTarget = path.resolve(target);
  if (!workflowPathInside(lexicalRoot, lexicalTarget)) {
    throw new Error(label + ' must stay inside the project root');
  }
  const rootStat = await fs.lstat(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(label + ' project root must be a real directory');
  }
  const realRoot = await fs.realpath(lexicalRoot);
  const relative = path.relative(lexicalRoot, lexicalTarget);
  const segments = relative === '' ? [] : relative.split(path.sep);
  let cursor = lexicalRoot;
  for (let index = 0; index < segments.length; index++) {
    cursor = path.join(cursor, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        return { target: lexicalTarget, exists: false };
      }
      throw error;
    }
    const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) {
      throw new Error(label + ' crosses a symbolic link or junction at ' + display);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(label + ' ancestor ' + display + ' must be a real directory');
    }
    if (
      final &&
      ((expected === 'file' && !stat.isFile()) ||
        (expected === 'directory' && !stat.isDirectory()) ||
        (expected === 'any' && !stat.isFile() && !stat.isDirectory()))
    ) {
      throw new Error(label + ' must be a real ' + expected);
    }
    const physical = await fs.realpath(cursor);
    if (!workflowPathInside(realRoot, physical)) {
      throw new Error(label + ' resolves outside the project root');
    }
  }
  return { target: lexicalTarget, exists: true };
}

function workflowFileObjectIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    birthtime: typeof stat.birthtimeNs === 'bigint' ? stat.birthtimeNs : stat.birthtimeMs,
  };
}

function workflowHasIdentity(value) {
  return value !== 0 && value !== 0n && value !== '0';
}

function workflowSameFileObject(left, right) {
  const comparableDevice = workflowHasIdentity(left.dev) && workflowHasIdentity(right.dev);
  const comparableInode = workflowHasIdentity(left.ino) && workflowHasIdentity(right.ino);
  if (comparableDevice && left.dev !== right.dev) return false;
  if (comparableInode && left.ino !== right.ino) return false;
  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}

function workflowSameFileStat(left, right) {
  return (
    workflowSameFileObject(
      workflowFileObjectIdentity(left),
      workflowFileObjectIdentity(right),
    ) &&
    left.size === right.size &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readWorkflowProtectedFile(
  projectRoot,
  file,
  label,
  maxBytes,
  hooks = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(label + ' byte limit must be a positive integer');
  }
  const inspection = await inspectWorkflowProtectedPath(
    projectRoot,
    file,
    label,
    'file',
  );
  if (!inspection.exists) {
    const error = new Error(label + ' does not exist');
    error.code = 'ENOENT';
    throw error;
  }
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(label + ' must be a real file');
  }
  if (before.size > BigInt(maxBytes)) {
    throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
  }
  const beforeRealPath = await fs.realpath(file);
  await hooks.afterLstat?.();
  const flags =
    process.platform === 'win32'
      ? fsConstants.O_RDONLY
      : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
  let handle;
  try {
    handle = await fs.open(file, flags);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ELOOP') {
      throw new Error(label + ' must be a real file');
    }
    throw error;
  }
  try {
    const [opened, afterOpen, afterOpenRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !opened.isFile() ||
      !afterOpen.isFile() ||
      afterOpen.isSymbolicLink() ||
      afterOpenRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, opened) ||
      !workflowSameFileStat(before, afterOpen)
    ) {
      throw new Error(label + ' changed while opening');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    await hooks.afterOpen?.();
    const chunks = [];
    let total = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    for (;;) {
      const remaining = maxBytes + 1 - total;
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, remaining),
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) {
        throw new Error(label + ' exceeds ' + String(maxBytes) + ' bytes');
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    await hooks.beforeFinalCheck?.();
    const [afterHandle, afterPath, afterRealPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(file, { bigint: true }),
      fs.realpath(file),
    ]);
    if (
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterRealPath !== beforeRealPath ||
      !workflowSameFileStat(before, afterHandle) ||
      !workflowSameFileStat(before, afterPath)
    ) {
      throw new Error(label + ' changed while reading');
    }
    await inspectWorkflowProtectedPath(projectRoot, file, label, 'file');
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function workflowRelativeSegments(value, label, allowWildcards = false) {
  if (typeof value !== 'string') throw new Error(label + ' must be a string');
  const trimmed = value.trim().replaceAll('\\', '/');
  if (
    trimmed.length === 0 ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  ) {
    throw new Error(label + ' must be relative to its declared path base');
  }
  const segments = trimmed.split('/');
  if (segments.some((segment) => segment === '..')) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(label + ' must not contain empty or dot path segments');
  }
  if (!allowWildcards && (trimmed.includes('*') || trimmed.includes('?'))) {
    throw new Error(label + ' cannot contain wildcards');
  }
  return segments;
}

function workflowYamlError(message, line) {
  const suffix = Number.isInteger(line) ? ' at line ' + String(line) : '';
  throw new Error('Invalid .comet/config.yaml: ' + message + suffix);
}

function workflowYamlStripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function workflowYamlMappingColon(value) {
  let quote = null;
  let flowDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') {
      flowDepth++;
      continue;
    }
    if (character === ']' || character === '}') {
      flowDepth--;
      if (flowDepth < 0) workflowYamlError('unexpected flow collection terminator');
      continue;
    }
    if (
      character === ':' &&
      flowDepth === 0 &&
      (index + 1 === value.length || /\s/u.test(value[index + 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function workflowYamlDoubleQuoted(value, line) {
  let output = '';
  const escapes = {
    '0': '\0',
    a: '\u0007',
    b: '\b',
    t: '\t',
    n: '\n',
    v: '\u000b',
    f: '\f',
    r: '\r',
    e: '\u001b',
    ' ': ' ',
    '"': '"',
    '/': '/',
    '\\': '\\',
    N: '\u0085',
    _: '\u00a0',
    L: '\u2028',
    P: '\u2029',
  };
  for (let index = 1; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      if (value.slice(index + 1).trim() !== '') {
        workflowYamlError('unexpected content after quoted scalar', line);
      }
      return output;
    }
    if (character !== '\\') {
      output += character;
      continue;
    }
    index++;
    const escape = value[index];
    if (escape === undefined) workflowYamlError('unterminated quoted scalar', line);
    if (Object.prototype.hasOwnProperty.call(escapes, escape)) {
      output += escapes[escape];
      continue;
    }
    const widths = { x: 2, u: 4, U: 8 };
    const width = widths[escape];
    if (width) {
      const digits = value.slice(index + 1, index + 1 + width);
      if (!new RegExp('^[a-fA-F0-9]{' + String(width) + '}$', 'u').test(digits)) {
        workflowYamlError('invalid Unicode escape', line);
      }
      const point = Number.parseInt(digits, 16);
      try {
        output += String.fromCodePoint(point);
      } catch {
        workflowYamlError('invalid Unicode code point', line);
      }
      index += width;
      continue;
    }
    workflowYamlError('unsupported quoted-scalar escape', line);
  }
  workflowYamlError('unterminated quoted scalar', line);
}

function workflowYamlSingleQuoted(value, line) {
  let output = '';
  for (let index = 1; index < value.length; index++) {
    const character = value[index];
    if (character !== "'") {
      output += character;
      continue;
    }
    if (value[index + 1] === "'") {
      output += "'";
      index++;
      continue;
    }
    if (value.slice(index + 1).trim() !== '') {
      workflowYamlError('unexpected content after quoted scalar', line);
    }
    return output;
  }
  workflowYamlError('unterminated quoted scalar', line);
}

function workflowYamlPlainScalar(value) {
  if (/^(?:null|Null|NULL|~)$/u.test(value)) return null;
  if (/^(?:true|True|TRUE)$/u.test(value)) return true;
  if (/^(?:false|False|FALSE)$/u.test(value)) return false;
  if (/^[-+]?(?:0|[1-9][0-9_]*)$/u.test(value)) {
    const parsed = Number(value.replaceAll('_', ''));
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (
    /^[-+]?(?:(?:0|[1-9][0-9_]*)\.[0-9_]+|(?:0|[1-9][0-9_]*)(?:[eE][-+]?[0-9]+))$/u.test(
      value,
    )
  ) {
    const parsed = Number(value.replaceAll('_', ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  if (/^[&*!]/u.test(value)) {
    workflowYamlError('anchors, aliases, and tags are not supported in project config');
  }
  return value;
}

function workflowYamlFlowParser(source, line) {
  let cursor = 0;
  const skip = () => {
    while (/\s/u.test(source[cursor] ?? '')) cursor++;
  };
  const quoted = () => {
    const start = cursor;
    const quote = source[cursor++];
    while (cursor < source.length) {
      if (quote === "'" && source[cursor] === "'" && source[cursor + 1] === "'") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === quote) {
        cursor++;
        const token = source.slice(start, cursor);
        return quote === '"'
          ? workflowYamlDoubleQuoted(token, line)
          : workflowYamlSingleQuoted(token, line);
      }
      if (quote === '"' && source[cursor] === '\\') cursor++;
      cursor++;
    }
    workflowYamlError('unterminated quoted scalar', line);
  };
  const value = (stops) => {
    skip();
    const character = source[cursor];
    if (character === '[') return sequence();
    if (character === '{') return mapping();
    if (character === '"' || character === "'") return quoted();
    const start = cursor;
    while (cursor < source.length && !stops.includes(source[cursor])) cursor++;
    const token = source.slice(start, cursor).trim();
    if (!token) workflowYamlError('missing flow collection value', line);
    return workflowYamlPlainScalar(token);
  };
  const sequence = () => {
    cursor++;
    const output = [];
    skip();
    if (source[cursor] === ']') {
      cursor++;
      return output;
    }
    for (;;) {
      output.push(value([',', ']']));
      skip();
      if (source[cursor] === ']') {
        cursor++;
        return output;
      }
      if (source[cursor] !== ',') workflowYamlError('expected , or ] in flow sequence', line);
      cursor++;
    }
  };
  const mapping = () => {
    cursor++;
    const output = {};
    skip();
    if (source[cursor] === '}') {
      cursor++;
      return output;
    }
    for (;;) {
      skip();
      let key;
      if (source[cursor] === '"' || source[cursor] === "'") {
        key = String(quoted());
      } else {
        const start = cursor;
        while (cursor < source.length && source[cursor] !== ':') cursor++;
        key = source.slice(start, cursor).trim();
      }
      if (!key || source[cursor] !== ':') {
        workflowYamlError('expected mapping key and : in flow mapping', line);
      }
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        workflowYamlError('duplicate key ' + key, line);
      }
      cursor++;
      output[key] = value([',', '}']);
      skip();
      if (source[cursor] === '}') {
        cursor++;
        return output;
      }
      if (source[cursor] !== ',') workflowYamlError('expected , or } in flow mapping', line);
      cursor++;
    }
  };
  const parsed = value([]);
  skip();
  if (cursor !== source.length) workflowYamlError('unexpected flow collection content', line);
  return parsed;
}

function workflowYamlFlowDepth(value, line) {
  const stack = [];
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (quote === "'" && character === "'" && value[index + 1] === "'") {
        index++;
        continue;
      }
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === '\\') {
        index++;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') {
      stack.push(character);
      continue;
    }
    if (character === ']' || character === '}') {
      const expected = character === ']' ? '[' : '{';
      if (stack.pop() !== expected) workflowYamlError('mismatched flow collection', line);
    }
  }
  return stack.length;
}

function workflowYamlScalar(value, line) {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return workflowYamlFlowParser(trimmed, line);
  }
  if (trimmed.startsWith('"')) return workflowYamlDoubleQuoted(trimmed, line);
  if (trimmed.startsWith("'")) return workflowYamlSingleQuoted(trimmed, line);
  if (/[\[\]{}]/u.test(trimmed)) {
    workflowYamlError('malformed flow collection', line);
  }
  return workflowYamlPlainScalar(trimmed);
}

function parseWorkflowProjectYaml(source) {
  const lines = String(source).replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let cursor = 0;
  const info = (index) => {
    const raw = lines[index] ?? '';
    if (raw.includes('\t')) workflowYamlError('tabs are not supported', index + 1);
    let indent = 0;
    while (raw[indent] === ' ') indent++;
    return {
      raw,
      indent,
      content: workflowYamlStripComment(raw.slice(indent)).trimEnd(),
      line: index + 1,
    };
  };
  const skipEmpty = () => {
    while (cursor < lines.length && info(cursor).content.trim() === '') cursor++;
  };
  const nextContent = () => {
    let index = cursor;
    while (index < lines.length && info(index).content.trim() === '') index++;
    return index < lines.length ? info(index) : null;
  };
  const flowValue = (initial, line) => {
    let combined = initial;
    let depth = workflowYamlFlowDepth(combined, line);
    while (depth > 0) {
      if (cursor >= lines.length) workflowYamlError('unterminated flow collection', line);
      const current = info(cursor);
      cursor++;
      combined += ' ' + current.content.trim();
      depth = workflowYamlFlowDepth(combined, line);
    }
    return workflowYamlScalar(combined, line);
  };
  const blockScalar = (style, parentIndent) => {
    const output = [];
    let contentIndent = null;
    while (cursor < lines.length) {
      const raw = lines[cursor];
      if (raw.trim() === '') {
        output.push('');
        cursor++;
        continue;
      }
      const current = info(cursor);
      if (current.indent <= parentIndent) break;
      contentIndent ??= current.indent;
      if (current.indent < contentIndent) break;
      output.push(raw.slice(contentIndent));
      cursor++;
    }
    const text = style === '>' ? output.join('\n').replace(/([^\n])\n([^\n])/gu, '$1 $2') : output.join('\n');
    return text + '\n';
  };
  const parseKey = (value, line) => {
    const trimmed = value.trim();
    if (!trimmed) workflowYamlError('mapping key is empty', line);
    if (trimmed.startsWith('"')) return workflowYamlDoubleQuoted(trimmed, line);
    if (trimmed.startsWith("'")) return workflowYamlSingleQuoted(trimmed, line);
    if (/^[?[\]{}&,*!|>@\x60]/u.test(trimmed)) {
      workflowYamlError('unsupported complex mapping key', line);
    }
    return trimmed;
  };
  const parseFollowingValue = (rawValue, keyIndent, line) => {
    const trimmed = rawValue.trim();
    if (/^[|>][+-]?[0-9]?$/u.test(trimmed)) {
      return blockScalar(trimmed[0], keyIndent);
    }
    if (trimmed !== '') {
      return trimmed.startsWith('[') || trimmed.startsWith('{')
        ? flowValue(trimmed, line)
        : workflowYamlScalar(trimmed, line);
    }
    const next = nextContent();
    if (!next || next.indent <= keyIndent || next.content === '...') return null;
    return parseBlock(next.indent);
  };
  const mapEntry = (output, content, keyIndent, line) => {
    const colon = workflowYamlMappingColon(content);
    if (colon < 0) workflowYamlError('expected mapping key followed by :', line);
    const key = String(parseKey(content.slice(0, colon), line));
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      workflowYamlError('duplicate key ' + key, line);
    }
    output[key] = parseFollowingValue(content.slice(colon + 1), keyIndent, line);
  };
  const parseMapping = (indent) => {
    const output = {};
    for (;;) {
      skipEmpty();
      if (cursor >= lines.length) return output;
      const current = info(cursor);
      if (current.content === '...') return output;
      if (current.indent < indent) return output;
      if (current.indent > indent) workflowYamlError('unexpected indentation', current.line);
      if (current.content === '-' || current.content.startsWith('- ')) return output;
      cursor++;
      mapEntry(output, current.content, indent, current.line);
    }
  };
  const parseSequence = (indent) => {
    const output = [];
    for (;;) {
      skipEmpty();
      if (cursor >= lines.length) return output;
      const current = info(cursor);
      if (current.content === '...') return output;
      if (current.indent < indent) return output;
      if (current.indent > indent) workflowYamlError('unexpected indentation', current.line);
      if (current.content !== '-' && !current.content.startsWith('- ')) return output;
      const item = current.content === '-' ? '' : current.content.slice(2);
      cursor++;
      if (item === '') {
        const next = nextContent();
        output.push(!next || next.indent <= indent ? null : parseBlock(next.indent));
        continue;
      }
      const colon = workflowYamlMappingColon(item);
      if (colon >= 0) {
        const mapping = {};
        mapEntry(mapping, item, indent + 2, current.line);
        const next = nextContent();
        if (next && next.indent > indent) {
          const remainder = parseMapping(next.indent);
          for (const [key, value] of Object.entries(remainder)) {
            if (Object.prototype.hasOwnProperty.call(mapping, key)) {
              workflowYamlError('duplicate key ' + key, next.line);
            }
            mapping[key] = value;
          }
        }
        output.push(mapping);
      } else {
        output.push(
          item.startsWith('[') || item.startsWith('{')
            ? flowValue(item, current.line)
            : workflowYamlScalar(item, current.line),
        );
      }
    }
  };
  const parseBlock = (indent) => {
    skipEmpty();
    const current = info(cursor);
    if (current.indent !== indent) workflowYamlError('unexpected indentation', current.line);
    return current.content === '-' || current.content.startsWith('- ')
      ? parseSequence(indent)
      : parseMapping(indent);
  };

  skipEmpty();
  if (cursor < lines.length && info(cursor).content === '---') {
    cursor++;
    skipEmpty();
  }
  if (cursor >= lines.length || info(cursor).content === '...') return {};
  if (info(cursor).indent !== 0) workflowYamlError('root must start at indentation 0', info(cursor).line);
  const value = parseBlock(0);
  skipEmpty();
  if (cursor < lines.length && info(cursor).content === '...') {
    cursor++;
    skipEmpty();
  }
  if (cursor < lines.length) workflowYamlError('multiple YAML documents are not supported', info(cursor).line);
  return value;
}

function workflowConfigRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be a mapping');
  }
  return value;
}

function workflowConfigLanguage(value, fallback, label) {
  const resolved = value ?? fallback;
  if (resolved !== 'en' && resolved !== 'zh-CN') {
    throw new Error(label + ' must be en or zh-CN');
  }
  return resolved;
}

function workflowSnapshotPattern(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.split('/').includes('..')
  ) {
    throw new Error(label + ' contains an unsafe pattern');
  }
  if (value.length > 1024) throw new Error(label + ' exceeds 1024 characters');
  let wildcardTokens = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '?') {
      wildcardTokens++;
    } else if (value[index] === '*') {
      wildcardTokens++;
      if (value[index + 1] === '*') index++;
    }
  }
  if (wildcardTokens > 64) {
    throw new Error(label + ' contains more than 64 wildcard tokens');
  }
}

function validateWorkflowSnapshot(value) {
  if (value === undefined) return;
  const snapshot = workflowConfigRecord(value, 'native.snapshot');
  for (const key of ['include', 'exclude']) {
    if (snapshot[key] === undefined) continue;
    if (!Array.isArray(snapshot[key])) {
      throw new Error('native.snapshot.' + key + ' contains an unsafe pattern');
    }
    for (const pattern of snapshot[key]) {
      workflowSnapshotPattern(pattern, 'native.snapshot.' + key);
    }
  }
  for (const key of ['max_files', 'max_total_bytes', 'max_duration_ms']) {
    if (
      snapshot[key] !== undefined &&
      (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 1)
    ) {
      throw new Error('native.snapshot.' + key + ' must be a positive integer');
    }
  }
}

function validateWorkflowPendingRootMove(value) {
  if (value === undefined) return;
  const pending = workflowConfigRecord(value, 'native.pending_root_move');
  if (typeof pending.id !== 'string' || !/^[a-f0-9-]{8,}$/u.test(pending.id)) {
    throw new Error('native.pending_root_move.id is invalid');
  }
  if (
    typeof pending.from_artifact_root !== 'string' ||
    typeof pending.to_artifact_root !== 'string'
  ) {
    throw new Error('native.pending_root_move roots must be strings');
  }
  normalizeWorkflowArtifactRoot(pending.from_artifact_root);
  normalizeWorkflowArtifactRoot(pending.to_artifact_root);
  if (!['copying', 'ready', 'switched'].includes(pending.stage)) {
    throw new Error('native.pending_root_move.stage is invalid');
  }
  if (pending.cleanup !== undefined) {
    const cleanup = workflowConfigRecord(
      pending.cleanup,
      'native.pending_root_move.cleanup',
    );
    if (
      ![
        'forward-source',
        'restart-staging',
        'rollback-destination',
        'rollback-staging',
      ].includes(cleanup.kind)
    ) {
      throw new Error('native.pending_root_move.cleanup.kind is invalid');
    }
    if (!['prepared', 'quarantined', 'deleting'].includes(cleanup.state)) {
      throw new Error('native.pending_root_move.cleanup.state is invalid');
    }
    if (
      typeof cleanup.manifest_hash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(cleanup.manifest_hash)
    ) {
      throw new Error('native.pending_root_move.cleanup.manifest_hash is invalid');
    }
  }
}

function managedWorkflowConfigFields(source) {
  const root = workflowConfigRecord(parseWorkflowProjectYaml(source), '.comet/config.yaml');
  const hasProjectMarker =
    root.schema !== undefined ||
    root.default_workflow !== undefined ||
    root.workflows !== undefined ||
    root.native !== undefined;
  if (hasProjectMarker && root.schema !== 'comet.project.v1') {
    throw new Error('Unsupported Comet project schema');
  }
  if (
    root.schema === 'comet.project.v1' &&
    root.default_workflow !== 'native' &&
    root.default_workflow !== 'classic'
  ) {
    throw new Error('default_workflow must be native or classic');
  }
  const workflows =
    root.workflows ?? (root.default_workflow === undefined ? undefined : [root.default_workflow]);
  if (
    workflows !== undefined &&
    (!Array.isArray(workflows) ||
      workflows.length === 0 ||
      workflows.some((workflow) => workflow !== 'native' && workflow !== 'classic'))
  ) {
    throw new Error('workflows must contain native and/or classic');
  }
  if (
    workflows !== undefined &&
    root.default_workflow !== undefined &&
    !workflows.includes(root.default_workflow)
  ) {
    throw new Error('workflows must include default_workflow');
  }
  if (root.ambient_resume !== undefined && typeof root.ambient_resume !== 'boolean') {
    throw new Error('ambient_resume must be true or false');
  }

  let nativeArtifactRoot = null;
  if (root.native !== undefined) {
    const native = workflowConfigRecord(root.native, 'native');
    if (typeof native.artifact_root !== 'string') {
      throw new Error('native.artifact_root must be a string');
    }
    nativeArtifactRoot = normalizeWorkflowArtifactRoot(native.artifact_root);
    workflowConfigLanguage(native.language, 'en', 'native.language');
    const clarificationMode = native.clarification_mode ?? 'sequential';
    if (clarificationMode !== 'sequential' && clarificationMode !== 'batch') {
      throw new Error('native.clarification_mode must be sequential or batch');
    }
    const archiveConfirmation = native.archive_confirmation ?? 'automatic';
    if (archiveConfirmation !== 'automatic' && archiveConfirmation !== 'required') {
      throw new Error('native.archive_confirmation must be automatic or required');
    }
    const maxVerifyFailures = native.max_verify_failures ?? 5;
    if (!Number.isSafeInteger(maxVerifyFailures) || maxVerifyFailures < 1) {
      throw new Error('native.max_verify_failures must be a positive integer');
    }
    validateWorkflowSnapshot(native.snapshot);
    validateWorkflowPendingRootMove(native.pending_root_move);
  }

  let classicArtifactLayout = null;
  if (root.classic !== undefined) {
    const classic = workflowConfigRecord(root.classic, 'classic');
    classicArtifactLayout = normalizeClassicArtifactLayout(
      classic.artifact_layout,
      'legacy',
    );
    workflowConfigLanguage(classic.language, 'zh-CN', 'classic.language');
    const compression = classic.context_compression ?? 'off';
    if (compression !== 'off' && compression !== 'beta') {
      throw new Error('classic.context_compression must be off or beta');
    }
    const reviewMode = classic.review_mode ?? 'standard';
    if (!['off', 'standard', 'thorough'].includes(reviewMode)) {
      throw new Error('classic.review_mode must be off, standard, or thorough');
    }
    const autoTransition = classic.auto_transition ?? true;
    if (typeof autoTransition !== 'boolean') {
      throw new Error('classic.auto_transition must be true or false');
    }
  }
  const nativeEnabled = Array.isArray(workflows) && workflows.includes('native');
  const classicEnabled = Array.isArray(workflows) && workflows.includes('classic');
  if (nativeEnabled && root.native === undefined) {
    throw new Error('native must be a mapping');
  }
  if (classicEnabled && classicArtifactLayout === null) {
    classicArtifactLayout = 'legacy';
  }
  return { nativeArtifactRoot, classicArtifactLayout, nativeEnabled, classicEnabled };
}

async function readWorkflowProjectPathConfig(projectRoot) {
  const file = path.join(projectRoot, '.comet', 'config.yaml');
  let inspection;
  try {
    inspection = await inspectWorkflowProtectedPath(
      projectRoot,
      file,
      '.comet/config.yaml',
      'file',
    );
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {
        nativeArtifactRoot: null,
        classicArtifactLayout: null,
        nativeEnabled: false,
        classicEnabled: false,
      };
    }
    throw error;
  }
  if (!inspection.exists) {
    return {
      nativeArtifactRoot: null,
      classicArtifactLayout: null,
      nativeEnabled: false,
      classicEnabled: false,
    };
  }
  const source = await readWorkflowProtectedFile(
    projectRoot,
    file,
    '.comet/config.yaml',
    WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
  );
  return managedWorkflowConfigFields(source.toString('utf8'));
}

function resolveWorkflowRelativePath(base, value, label, allowWildcards = false) {
  const segments = workflowRelativeSegments(value, label, allowWildcards);
  const target = path.resolve(base, ...segments);
  const relative = path.relative(path.resolve(base), target);
  if (
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith('..' + path.sep)
  ) {
    const boundary = label === 'workflow-run statePath' ? 'the project root' : 'its declared path base';
    throw new Error(label + ' must stay inside ' + boundary);
  }
  return { target, segments };
}
`;
}
