import { promises as fs } from 'fs';
import path from 'path';
import { stringify, parseDocument } from 'yaml';

export type ProjectConfigCommentLanguage = 'en' | 'zh-CN';

type ProjectConfigCommentKey =
  | 'schema'
  | 'default_workflow'
  | 'workflows'
  | 'ambient_resume'
  | 'native'
  | 'native.artifact_root'
  | 'native.language'
  | 'native.clarification_mode'
  | 'native.snapshot'
  | 'native.snapshot.include'
  | 'native.snapshot.exclude'
  | 'native.snapshot.max_files'
  | 'native.snapshot.max_total_bytes'
  | 'native.snapshot.max_duration_ms'
  | 'classic'
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
    'native.snapshot': '# Native 内容快照使用的可审计项目范围与有界工作预算。',
    'native.snapshot.include': '# Native 快照纳入的项目相对路径；模式使用 /，支持 *、** 和 ?。',
    'native.snapshot.exclude': '# 从纳入范围中排除路径；新 change 会把排除策略绑定到 baseline。',
    'native.snapshot.max_files': '# 单次快照最多捕获的文件数；大型 monorepo 可按需提高。',
    'native.snapshot.max_total_bytes':
      '# 单次快照最多哈希的文件内容总字节数；内容采用流式读取，不依赖 Git hash。',
    'native.snapshot.max_duration_ms':
      '# 单次快照的最长执行时间（毫秒）；较慢或更大的仓库应与字节预算一并提高。',
    classic: '# Classic 工作流配置，不会改变 Native 的状态或行为。',
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

export async function readAmbientResumeEnabled(projectRoot: string): Promise<boolean> {
  const file = path.join(projectRoot, '.comet', 'config.yaml');
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
  if (Buffer.byteLength(source) > 64 * 1024) {
    throw new Error('.comet/config.yaml exceeds 65536 bytes');
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid .comet/config.yaml: ${document.errors[0].message}`);
  }
  const value = document.toJS();
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid .comet/config.yaml: root must be a mapping');
  }
  const configured = (value as Record<string, unknown>).ambient_resume;
  if (configured === undefined) return true;
  if (typeof configured !== 'boolean') {
    throw new Error('ambient_resume must be true or false');
  }
  return configured;
}
