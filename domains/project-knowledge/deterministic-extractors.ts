import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import {
  PROJECT_KNOWLEDGE_UNIT_SCHEMA,
  type ProjectKnowledgeUnit,
  type ProjectKnowledgeUnitSource,
} from './units.js';

const MAX_READ_BYTES = 64 * 1024;
const MODULE_ROOTS = ['app', 'domains', 'platform', 'src', 'packages'] as const;

export interface DeterministicProjectUnitExtractionOptions {
  readonly projectRoot: string;
}

function source(source: string, anchor?: string): ProjectKnowledgeUnitSource {
  return { source, ...(anchor === undefined ? {} : { anchor }) };
}

function unitBase(
  id: string,
  kind: ProjectKnowledgeUnit['kind'],
  title: string,
  summary: string,
  conclusions: ProjectKnowledgeUnit['conclusions'],
  options: Partial<ProjectKnowledgeUnit> = {},
): ProjectKnowledgeUnit {
  return {
    schema: PROJECT_KNOWLEDGE_UNIT_SCHEMA,
    id,
    kind,
    state: 'draft',
    origin: 'generated',
    title,
    summary,
    applicablePaths: options.applicablePaths ?? [],
    operations: options.operations ?? ['understand', 'verify'],
    conclusions,
    relations: options.relations ?? [],
    verification: options.verification ?? [],
  };
}

async function realProjectFiles(root: string, max = 200): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (result.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (result.length >= max || entry.name.startsWith('.') || entry.name === 'node_modules')
        continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        result.push(target);
      }
    }
  };
  await visit(root);
  return result;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

async function firstExistingSource(
  root: string,
  candidates: readonly string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const stat = await fs.lstat(path.join(root, ...candidate.split('/')));
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch {
      // Try the next bounded candidate.
    }
  }
  const files = await realProjectFiles(root, 1);
  return files[0] ? relative(root, files[0]) : null;
}

async function readText(root: string, relativePath: string): Promise<string | null> {
  try {
    return (
      await readProtectedProjectFile(root, relativePath, MAX_READ_BYTES, { label: relativePath })
    ).bytes.toString('utf8');
  } catch {
    return null;
  }
}

async function projectMapUnit(root: string): Promise<ProjectKnowledgeUnit> {
  const manifest = await firstExistingSource(root, [
    'package.json',
    'pnpm-workspace.yaml',
    'README.md',
  ]);
  const config = await firstExistingSource(root, [
    '.comet/config.yaml',
    'tsconfig.json',
    'vite.config.ts',
  ]);
  const files = await realProjectFiles(root, 500);
  const directories = [
    ...new Set(files.map((file) => relative(root, file).split('/')[0]).filter(Boolean)),
  ].slice(0, 32);
  const sources = [manifest, config]
    .filter((value): value is string => value !== null)
    .map((value) => source(value, 'root'));
  if (sources.length === 0) {
    const fallback = await firstExistingSource(root, []);
    if (fallback) sources.push(source(fallback));
  }
  return unitBase(
    'generated-project-map',
    'project-map',
    '项目结构概览',
    '从仓库目录、项目配置和 manifest 生成的项目入口与分层概览。',
    [{ text: `项目包含主要目录：${directories.join('、') || '待从当前项目确认'}。`, sources }],
    { applicablePaths: directories.map((directory) => `${directory}/`) },
  );
}

async function moduleOverviewUnit(root: string): Promise<ProjectKnowledgeUnit> {
  const files: string[] = [];
  for (const moduleRoot of MODULE_ROOTS) {
    try {
      const stat = await fs.lstat(path.join(root, moduleRoot));
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      files.push(...(await realProjectFiles(path.join(root, moduleRoot), 48)));
    } catch {
      // Missing module root is normal.
    }
  }
  const selected = files
    .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|py|go|java|rs)$/u.test(file))
    .slice(0, 24);
  const sourceFiles = selected.length > 0 ? selected : await realProjectFiles(root, 1);
  const names = [
    ...new Set(sourceFiles.map((file) => relative(root, file).split('/').slice(0, 2).join('/'))),
  ].filter(Boolean);
  const sourceRefs = sourceFiles.slice(0, 8).map((file) => source(relative(root, file), 'module'));
  const relationTargets = names
    .slice(0, 8)
    .map((name) => `模块 ${name}`)
    .join('、');
  const evidence: string[] = [];
  for (const file of sourceFiles.slice(0, 6)) {
    const text = await readText(root, relative(root, file));
    if (!text) continue;
    const imports = [
      ...text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
    ]
      .map((match) => match[1])
      .slice(0, 4);
    if (imports.length > 0) evidence.push(`${relative(root, file)} 引用 ${imports.join('、')}`);
  }
  return unitBase(
    'generated-module-overview',
    'module-overview',
    '模块职责与依赖概览',
    '从有限源码文件的 import/export 关系生成模块边界提示，不索引完整源码正文。',
    [
      {
        text: `当前可识别模块：${relationTargets || '请先核对仓库布局'}。${evidence.length > 0 ? ` ${evidence.join('；')}` : ''}`,
        sources: sourceRefs,
      },
    ],
    {
      applicablePaths: names.map((name) => `${name}/`),
      relations:
        sourceRefs.length > 0
          ? [
              {
                type: 'depends-on',
                target: 'generated-project-map',
                sources: sourceRefs.slice(0, 1),
              },
            ]
          : [],
    },
  );
}

async function buildTestUnit(root: string): Promise<ProjectKnowledgeUnit> {
  const manifestSource = await firstExistingSource(root, [
    'package.json',
    'pyproject.toml',
    'Makefile',
    'README.md',
  ]);
  const manifestText = manifestSource ? await readText(root, manifestSource) : null;
  const commands: string[] = [];
  if (manifestSource === 'package.json' && manifestText) {
    try {
      const scripts =
        (JSON.parse(manifestText) as { scripts?: Record<string, unknown> }).scripts ?? {};
      for (const name of ['build', 'test', 'lint', 'typecheck', 'check:generated']) {
        if (typeof scripts[name] === 'string') commands.push(`pnpm run ${name}`);
      }
    } catch {
      // An invalid manifest remains a source diagnostic for later validation.
    }
  }
  if (commands.length === 0) commands.push('pnpm test');
  const references = manifestSource ? [source(manifestSource, 'scripts')] : [];
  return unitBase(
    'generated-build-test',
    'build-test',
    '构建与测试方式',
    `项目验证优先使用：${commands.join('、')}。`,
    [{ text: `建议按顺序运行：${commands.join('、')}。`, sources: references }],
    {
      operations: ['build', 'test', 'verify'],
      verification: commands.map((command) => ({ command, expected: '成功' })),
    },
  );
}

export async function extractDeterministicProjectUnits(
  options: DeterministicProjectUnitExtractionOptions,
): Promise<readonly ProjectKnowledgeUnit[]> {
  const root = path.resolve(options.projectRoot);
  return [await projectMapUnit(root), await moduleOverviewUnit(root), await buildTestUnit(root)];
}
