import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import type {
  ProjectKnowledgeRecord,
  ProjectKnowledgeRecordConclusion,
  ProjectKnowledgeRecordSource,
  ProjectKnowledgeRecordType,
} from './records.js';

const MAX_READ_BYTES = 64 * 1024;
const MAX_EXTRACTION_MS = 1_500;
const MODULE_ROOTS = ['app', 'domains', 'platform', 'src', 'packages'] as const;
const SKIPPED_PROJECT_DIRECTORIES = new Set([
  '.git',
  '.comet',
  'node_modules',
  'plugin-state',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  '.cache',
  'cache',
  'tmp',
  'temp',
]);
const SKIPPED_PROJECT_FILE_EXTENSIONS = new Set([
  '.db',
  '.sqlite',
  '.sqlite3',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.zip',
  '.tar',
  '.gz',
]);

class ExtractionDeadlineExceeded extends Error {}

function checkDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new ExtractionDeadlineExceeded();
}

export interface DeterministicProjectRecordExtractionOptions {
  readonly projectRoot: string;
  readonly changedPaths?: readonly string[];
  readonly knowledgeSources?: readonly string[];
  readonly language?: MemoryLanguage;
}

type ProjectKnowledgeRecordDraft = Omit<
  ProjectKnowledgeRecord,
  | 'projectId'
  | 'state'
  | 'authority'
  | 'sourceVersions'
  | 'applicationCount'
  | 'successCount'
  | 'failureCount'
  | 'lastAppliedAt'
  | 'updatedAt'
>;

function source(source: string, anchor?: string): ProjectKnowledgeRecordSource {
  return { source, ...(anchor === undefined ? {} : { anchor }) };
}

function recordBase(
  id: string,
  type: ProjectKnowledgeRecordType,
  title: string,
  summary: string,
  conclusions: readonly ProjectKnowledgeRecordConclusion[],
  options: Partial<
    Omit<ProjectKnowledgeRecordDraft, 'id' | 'type' | 'title' | 'summary' | 'conclusions'>
  > = {},
): ProjectKnowledgeRecordDraft {
  return {
    id,
    type,
    title,
    summary,
    applicablePaths: options.applicablePaths ?? [],
    operations: options.operations ?? [],
    phases: options.phases ?? [],
    conclusions,
    relations: options.relations ?? [],
    verification: options.verification ?? [],
  };
}

async function realProjectFiles(
  root: string,
  max = 200,
  deadline = Number.POSITIVE_INFINITY,
): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    checkDeadline(deadline);
    if (result.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      checkDeadline(deadline);
      if (
        result.length >= max ||
        entry.name.startsWith('.') ||
        SKIPPED_PROJECT_DIRECTORIES.has(entry.name)
      )
        continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(target);
      } else if (
        entry.isFile() &&
        !SKIPPED_PROJECT_FILE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase())
      ) {
        result.push(target);
      }
    }
  };
  await visit(root);
  return result;
}

async function changedProjectFiles(
  root: string,
  changedPaths: readonly string[],
  max: number,
  deadline: number,
): Promise<string[]> {
  const result: string[] = [];
  for (const value of changedPaths.slice(0, max)) {
    checkDeadline(deadline);
    const relativePath = value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!relativePath || relativePath.split('/').some((part) => part === '..')) continue;
    const target = path.resolve(root, relativePath);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile()) result.push(target);
      else if (stat.isDirectory()) result.push(...(await realProjectFiles(target, max, deadline)));
    } catch {
      // Deleted paths are handled by the index and do not produce a record source.
    }
    if (result.length >= max) break;
  }
  return result.slice(0, max);
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

async function firstExistingSource(
  root: string,
  candidates: readonly string[],
  deadline = Number.POSITIVE_INFINITY,
): Promise<string | null> {
  for (const candidate of candidates) {
    checkDeadline(deadline);
    try {
      const stat = await fs.lstat(path.join(root, ...candidate.split('/')));
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch {
      // Try the next bounded candidate.
    }
  }
  const files = await realProjectFiles(root, 1, deadline);
  return files[0] ? relative(root, files[0]) : null;
}

async function readText(
  root: string,
  relativePath: string,
  deadline = Number.POSITIVE_INFINITY,
): Promise<string | null> {
  try {
    checkDeadline(deadline);
    return (
      await readProtectedProjectFile(root, relativePath, MAX_READ_BYTES, { label: relativePath })
    ).bytes.toString('utf8');
  } catch {
    return null;
  }
}

async function projectMapRecord(
  root: string,
  deadline: number,
  changedPaths?: readonly string[],
  language: MemoryLanguage = 'zh-CN',
): Promise<ProjectKnowledgeRecordDraft> {
  const manifest = await firstExistingSource(
    root,
    ['package.json', 'pnpm-workspace.yaml', 'README.md'],
    deadline,
  );
  const config = await firstExistingSource(
    root,
    ['.comet/config.yaml', 'tsconfig.json', 'vite.config.ts'],
    deadline,
  );
  const files =
    changedPaths && changedPaths.length > 0
      ? await changedProjectFiles(root, changedPaths, 500, deadline)
      : await realProjectFiles(root, 500, deadline);
  const representatives = new Map<string, string>();
  for (const file of files) {
    const relativeFile = relative(root, file);
    const directory = relativeFile.split('/')[0];
    if (directory && !representatives.has(directory)) representatives.set(directory, relativeFile);
  }
  const representativeSources = [...representatives.entries()]
    .slice(0, 30)
    .map(([, file]) => source(file));
  const directories = [...representatives.keys()].slice(0, representativeSources.length);
  const sources = [manifest, config]
    .filter((value): value is string => value !== null)
    .map((value) => source(value))
    .concat(representativeSources)
    .filter(
      (reference, index, values) =>
        values.findIndex((candidate) => candidate.source === reference.source) === index,
    )
    .slice(0, 32);
  if (sources.length === 0) {
    const fallback = await firstExistingSource(root, [], deadline);
    if (fallback) sources.push(source(fallback));
  }
  return recordBase(
    'generated-project-map',
    'topology',
    language === 'en' ? 'Project structure overview' : '项目结构概览',
    language === 'en'
      ? 'Project entry points and layers derived from repository directories, configuration, and manifests.'
      : '从仓库目录、项目配置和 manifest 生成的项目入口与分层概览。',
    [
      {
        text:
          language === 'en'
            ? `Primary project directories: ${directories.join(', ') || 'to be confirmed from the current project'}.`
            : `项目包含主要目录：${directories.join('、') || '待从当前项目确认'}。`,
        sources,
      },
    ],
    { applicablePaths: directories.map((directory) => `${directory}/`) },
  );
}

async function moduleOverviewRecord(
  root: string,
  deadline: number,
  changedPaths?: readonly string[],
  language: MemoryLanguage = 'zh-CN',
): Promise<ProjectKnowledgeRecordDraft> {
  const files: string[] = [];
  for (const moduleRoot of MODULE_ROOTS) {
    checkDeadline(deadline);
    try {
      const stat = await fs.lstat(path.join(root, moduleRoot));
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      if (changedPaths && changedPaths.length > 0) {
        files.push(
          ...(await changedProjectFiles(
            root,
            changedPaths.filter(
              (changed) => changed === moduleRoot || changed.startsWith(`${moduleRoot}/`),
            ),
            48,
            deadline,
          )),
        );
      } else {
        files.push(...(await realProjectFiles(path.join(root, moduleRoot), 48, deadline)));
      }
    } catch {
      // Missing module root is normal.
    }
  }
  const selected = files
    .filter((file) => /\.(?:ts|tsx|js|jsx|mjs|py|go|java|rs)$/u.test(file))
    .slice(0, 24);
  const sourceFiles =
    selected.length > 0
      ? selected
      : changedPaths && changedPaths.length > 0
        ? await changedProjectFiles(root, changedPaths, 1, deadline)
        : await realProjectFiles(root, 1, deadline);
  const names = [
    ...new Set(sourceFiles.map((file) => relative(root, file).split('/').slice(0, 2).join('/'))),
  ].filter(Boolean);
  const sourceRefs = sourceFiles.slice(0, 32).map((file) => source(relative(root, file)));
  const relationTargets = names
    .slice(0, 8)
    .map((name) => (language === 'en' ? `module ${name}` : `模块 ${name}`))
    .join(language === 'en' ? ', ' : '、');
  const evidence: string[] = [];
  const registrationSources: ProjectKnowledgeRecordSource[] = [];
  for (const file of sourceFiles.slice(0, 6)) {
    checkDeadline(deadline);
    const text = await readText(root, relative(root, file), deadline);
    if (!text) continue;
    const imports = [
      ...text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
    ]
      .map((match) => match[1])
      .slice(0, 4);
    if (imports.length > 0)
      evidence.push(
        language === 'en'
          ? `${relative(root, file)} imports ${imports.join(', ')}`
          : `${relative(root, file)} 引用 ${imports.join('、')}`,
      );
    if (/\bregister[A-Z][A-Za-z0-9_$]*\s*\(/u.test(text)) {
      registrationSources.push(source(relative(root, file)));
    }
  }
  return recordBase(
    'generated-module-overview',
    'dependency',
    language === 'en' ? 'Module responsibilities and dependencies' : '模块职责与依赖概览',
    language === 'en'
      ? 'Module boundaries derived from bounded import/export relationships without indexing complete source files.'
      : '从有限源码文件的 import/export 关系生成模块边界提示，不索引完整源码正文。',
    [
      {
        text:
          language === 'en'
            ? `Recognized modules: ${relationTargets || 'inspect the repository layout first'}.${evidence.length > 0 ? ` ${evidence.join('; ')}` : ''}`
            : `当前可识别模块：${relationTargets || '请先核对仓库布局'}。${evidence.length > 0 ? ` ${evidence.join('；')}` : ''}`,
        sources: sourceRefs,
      },
    ],
    {
      applicablePaths: names.map((name) => `${name}/`),
      relations: [
        ...(sourceRefs.length > 0
          ? [
              {
                type: 'depends-on' as const,
                targetId: 'generated-project-map',
                sources: sourceRefs.slice(0, 1),
              },
            ]
          : []),
        ...(registrationSources.length > 0
          ? [
              {
                type: 'registers' as const,
                targetId: 'generated-project-map',
                sources: registrationSources.slice(0, 2),
              },
            ]
          : []),
      ],
    },
  );
}

async function buildTestRecord(
  root: string,
  deadline: number,
  language: MemoryLanguage = 'zh-CN',
): Promise<ProjectKnowledgeRecordDraft> {
  const manifestSource = await firstExistingSource(
    root,
    ['package.json', 'pyproject.toml', 'Makefile', 'README.md'],
    deadline,
  );
  const manifestText = manifestSource ? await readText(root, manifestSource, deadline) : null;
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
  const references = [source(manifestSource ?? 'README.md')];
  const summary =
    commands.length > 0
      ? language === 'en'
        ? `Preferred project verification commands: ${commands.join(', ')}.`
        : `项目验证优先使用：${commands.join('、')}。`
      : language === 'en'
        ? 'No build or test command is directly discoverable from the manifest; inspect the project documentation before choosing verification.'
        : '项目未声明可从 manifest 直接识别的构建或测试命令，Agent 应先读取项目说明再选择验证方式。';
  return recordBase(
    'generated-build-test',
    'procedure',
    language === 'en' ? 'Build and test workflow' : '构建与测试方式',
    summary,
    [
      {
        text:
          commands.length > 0
            ? language === 'en'
              ? `Run in order: ${commands.join(', ')}.`
              : `建议按顺序运行：${commands.join('、')}。`
            : language === 'en'
              ? 'Inspect README, project configuration, and CI for the actual verification commands.'
              : '请先核对 README、项目配置和 CI 中记录的实际验证命令。',
        sources: references,
      },
    ],
    {
      operations: ['build', 'test', 'verify'],
      verification: commands.map((command) => ({
        command,
        expected: language === 'en' ? 'pass' : '成功',
      })),
    },
  );
}

function knowledgeCorpusRecord(
  sources: readonly string[],
  language: MemoryLanguage = 'zh-CN',
): ProjectKnowledgeRecordDraft | null {
  const normalized = [
    ...new Set(
      sources
        .map((entry) => entry.replaceAll('\\', '/').replace(/^\.\//u, '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 24);
  if (normalized.length === 0) return null;
  const references = normalized.map((entry) => source(entry));
  return recordBase(
    'generated-knowledge-corpus',
    'fact',
    language === 'en' ? 'Project knowledge document sources' : '项目知识文档来源',
    language === 'en'
      ? 'Traceable knowledge sources derived from built-in project documents and user-configured Markdown paths.'
      : '从项目内置文档和用户配置的 Markdown 路径生成的可核对知识来源。',
    [
      {
        text:
          language === 'en'
            ? `Current project knowledge documents: ${normalized.join(', ')}.`
            : `当前项目知识文档：${normalized.join('、')}。`,
        sources: references,
      },
    ],
  );
}

async function extractDraftRecords(
  options: DeterministicProjectRecordExtractionOptions,
): Promise<readonly ProjectKnowledgeRecordDraft[]> {
  const root = path.resolve(options.projectRoot);
  const deadline = Date.now() + MAX_EXTRACTION_MS;
  const records: ProjectKnowledgeRecordDraft[] = [];
  try {
    records.push(
      await projectMapRecord(root, deadline, options.changedPaths, options.language ?? 'zh-CN'),
    );
    records.push(
      await moduleOverviewRecord(root, deadline, options.changedPaths, options.language ?? 'zh-CN'),
    );
    records.push(await buildTestRecord(root, deadline, options.language ?? 'zh-CN'));
    const corpus = knowledgeCorpusRecord(options.knowledgeSources ?? [], options.language);
    if (corpus !== null) records.push(corpus);
  } catch (error) {
    if (!(error instanceof ExtractionDeadlineExceeded)) throw error;
  }
  return records;
}

async function sourceVersions(
  root: string,
  sources: readonly ProjectKnowledgeRecordSource[],
): Promise<readonly ProjectKnowledgeRecord['sourceVersions'][number][]> {
  const unique = [...new Map(sources.map((entry) => [entry.source, entry.source])).values()];
  const versions: ProjectKnowledgeRecord['sourceVersions'][number][] = [];
  for (const relativePath of unique.slice(0, 32)) {
    try {
      const inspected = await fs.lstat(path.join(root, ...relativePath.split('/')));
      if (!inspected.isFile() || inspected.isSymbolicLink()) continue;
      versions.push({
        source: relativePath,
        size: inspected.size,
        modifiedAt: Math.trunc(inspected.mtimeMs),
      });
    } catch {
      // The candidate is still bounded; current-source validation will reject
      // it if a referenced file disappeared before persistence.
    }
  }
  return versions;
}

export async function extractDeterministicProjectRecords(
  options: DeterministicProjectRecordExtractionOptions,
): Promise<readonly ProjectKnowledgeRecord[]> {
  const root = path.resolve(options.projectRoot);
  const drafts = await extractDraftRecords(options);
  const projectId = resolveStableProjectId(root);
  const updatedAt = new Date().toISOString();
  const records: ProjectKnowledgeRecord[] = [];
  for (const draft of drafts) {
    const sources = [...draft.conclusions, ...draft.relations].flatMap((entry) => entry.sources);
    const fingerprints = await sourceVersions(root, sources);
    records.push({
      ...draft,
      projectId,
      state: 'proven',
      authority: 'repository',
      sourceVersions: fingerprints,
      applicationCount: 0,
      successCount: 0,
      failureCount: 0,
      updatedAt,
    });
  }
  return records;
}
