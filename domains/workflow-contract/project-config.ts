import { promises as fs } from 'fs';
import path from 'path';
import { stringify, parseDocument } from 'yaml';

export type ProjectConfigCommentLanguage = 'en' | 'zh-CN';

type ProjectConfigCommentKey =
  | 'schema'
  | 'default_workflow'
  | 'workflows'
  | 'ambient_resume'
  | 'language'
  | 'context_compression'
  | 'review_mode'
  | 'auto_transition'
  | 'native'
  | 'native.artifact_root'
  | 'native.language';

const COMMENTS: Record<ProjectConfigCommentLanguage, Record<ProjectConfigCommentKey, string>> = {
  en: {
    schema: '# Configuration schema used by Comet. Do not edit this value.',
    default_workflow: '# Default workflow entered by /comet. Must also appear in workflows.',
    workflows: '# Workflows enabled in this project: native, classic, or both.',
    ambient_resume:
      '# Enables automatic recovery through the read-only Ambient Resume probe for both Native and Classic. Set false to disable it.\n# ambient_resume: true | false',
    language: '# Artifact language used for workflow documents.\n# language: en | zh-CN',
    context_compression:
      '# Controls beta context compression for new Classic changes.\n# context_compression: off | beta',
    review_mode:
      '# Sets the default review depth for new Classic changes.\n# review_mode: off | standard | thorough',
    auto_transition:
      '# Automatically enters the next Classic phase after a phase passes.\n# auto_transition: true | false',
    native: '# Native workflow settings. They do not change Classic state or behavior.',
    'native.artifact_root':
      '# Root directory where Native stores Comet specs, changes, and runtime data.',
    'native.language':
      '# Artifact language used by Native workflow documents.\n# language: en | zh-CN',
  },
  'zh-CN': {
    schema: '# Comet 使用的配置格式版本，请勿修改此值。',
    default_workflow: '# `/comet` 默认进入的工作流；该值也必须出现在 workflows 中。',
    workflows: '# 此项目启用的工作流，可填写 native、classic 或同时启用两者。',
    ambient_resume:
      '# 是否启用只读的环境感知恢复探针，同时作用于 Native 和 Classic；设为 false 可关闭自动工作流恢复。\n# ambient_resume: true | false',
    language: '# 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
    context_compression: '# 新建 Classic change 是否启用 beta 上下文压缩。\n# 可选值：off | beta',
    review_mode: '# 新建 Classic change 默认使用的审查深度。\n# 可选值：off | standard | thorough',
    auto_transition: '# Classic 阶段通过后是否自动进入下一阶段。\n# 可选值：true | false',
    native: '# Native 工作流配置，不会改变 Classic 的状态或行为。',
    'native.artifact_root': '# Native 产物的存放根目录，包括规格、change 和运行时数据。',
    'native.language': '# Native 工作流文档使用的产物语言。\n# 可选值：en | zh-CN',
  },
};

export function projectConfigComment(
  key: ProjectConfigCommentKey,
  language: ProjectConfigCommentLanguage,
): string {
  return COMMENTS[language][key];
}

function commentKey(line: string, inNative: boolean): ProjectConfigCommentKey | null {
  const match = /^(\s*)([a-z_]+):/u.exec(line);
  if (!match) return null;
  const indent = match[1].length;
  const key = match[2];
  if (indent === 0 && key in COMMENTS.en) return key as ProjectConfigCommentKey;
  if (indent === 2 && inNative && (key === 'artifact_root' || key === 'language')) {
    return `native.${key}` as ProjectConfigCommentKey;
  }
  return null;
}

export function renderStructuredProjectConfig(
  value: Record<string, unknown>,
  language: ProjectConfigCommentLanguage,
): string {
  const output: string[] = [];
  let inNative = false;
  for (const line of stringify(value).trimEnd().split('\n')) {
    const key = commentKey(line, inNative);
    if (key) {
      const indent = line.match(/^\s*/u)?.[0] ?? '';
      for (const comment of projectConfigComment(key, language).split('\n')) {
        output.push(`${indent}${comment}`);
      }
    }
    output.push(line);
    if (/^[a-z_]+:/u.test(line)) inNative = line.startsWith('native:');
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
