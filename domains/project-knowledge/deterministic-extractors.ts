import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  hashProtectedProjectFile,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import type { ProjectKnowledgeDiagnosticReporter } from './types.js';
import type {
  ProjectKnowledgeRecord,
  ProjectKnowledgeRecordConclusion,
  ProjectKnowledgeRecordRelation,
  ProjectKnowledgeRecordSource,
  ProjectKnowledgeRecordType,
} from './records.js';

const MAX_READ_BYTES = 64 * 1024;
const MAX_EXTRACTION_MS = 1_500;
const MAX_MODULES = 64;
const MAX_SOURCE_FILES = 512;
const MODULE_ROOTS = ['app', 'domains', 'platform', 'src', 'packages'] as const;
const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.rs',
]);
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
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
  /** @deprecated Corpus membership belongs to the index status, not generated records. */
  readonly knowledgeSources?: readonly string[];
  readonly preferredRecordIds?: readonly string[];
  readonly language?: MemoryLanguage;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
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

interface ProjectModule {
  readonly modulePath: string;
  readonly absolutePath: string;
  readonly id: string;
}

interface ParsedImport {
  readonly importer: string;
  readonly specifier: string;
  readonly targetModule?: ProjectModule;
}

function source(sourcePath: string, anchor?: string): ProjectKnowledgeRecordSource {
  return { source: sourcePath, ...(anchor === undefined ? {} : { anchor }) };
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
  includeFile: (file: string) => boolean = () => true,
  allowPartialOnDeadline = false,
): Promise<string[]> {
  const result: string[] = [];
  const deadlineReached = (): boolean => {
    if (Date.now() <= deadline) return false;
    if (allowPartialOnDeadline) return true;
    throw new ExtractionDeadlineExceeded();
  };
  const visit = async (directory: string): Promise<void> => {
    if (deadlineReached() || result.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (deadlineReached()) return;
      if (
        result.length >= max ||
        entry.name.startsWith('.') ||
        SKIPPED_PROJECT_DIRECTORIES.has(entry.name)
      )
        continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(target);
      else if (
        entry.isFile() &&
        includeFile(target) &&
        !SKIPPED_PROJECT_FILE_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase())
      )
        result.push(target);
    }
  };
  await visit(root);
  return result;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

async function pathIsDirectory(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
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
  return null;
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

async function topLevelProjectDirectories(root: string, deadline: number): Promise<string[]> {
  checkDeadline(deadline);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !entry.name.startsWith('.') &&
        !SKIPPED_PROJECT_DIRECTORIES.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 30);
}

async function projectMapRecord(
  root: string,
  deadline: number,
  language: MemoryLanguage,
): Promise<ProjectKnowledgeRecordDraft | null> {
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
  const directories = await topLevelProjectDirectories(root, deadline);
  const representatives = await Promise.all(
    directories.map(async (directory) => {
      const files = await realProjectFiles(path.join(root, directory), 1, deadline);
      return files[0] ? relative(root, files[0]) : null;
    }),
  );
  const sources = [manifest, config, ...representatives]
    .filter((value): value is string => value !== null)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 32)
    .map((value) => source(value));
  if (sources.length === 0) return null;
  return recordBase(
    'generated-project-map',
    'topology',
    language === 'en' ? 'Project structure overview' : '项目结构概览',
    language === 'en'
      ? 'Project layers derived from real repository directories, configuration, and manifests.'
      : '从仓库中的真实目录、项目配置和 manifest 生成项目分层概览。',
    [
      {
        text:
          language === 'en'
            ? `Primary project directories: ${directories.join(', ') || 'none discovered'}.`
            : `项目主要目录：${directories.join('、') || '未发现'}。`,
        sources,
      },
    ],
    { applicablePaths: directories.map((directory) => `${directory}/`) },
  );
}

function normalizedModuleSlug(modulePath: string): string {
  return modulePath
    .toLocaleLowerCase()
    .replaceAll('/', '-')
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function moduleRecordId(modulePath: string, duplicateSlugs: ReadonlySet<string>): string {
  const slug = normalizedModuleSlug(modulePath);
  const base = `generated-module-${slug || 'root'}`;
  if (base.length <= 128 && !duplicateSlugs.has(slug)) return base;
  const digest = createHash('sha256').update(modulePath).digest('hex').slice(0, 10);
  return `${base.slice(0, 114).replace(/[-._]+$/u, '')}-${digest}`;
}

async function discoverProjectModules(
  root: string,
  deadline: number,
  reportDiagnostic?: ProjectKnowledgeDiagnosticReporter,
): Promise<ProjectModule[]> {
  const paths: string[] = [];
  for (const moduleRoot of MODULE_ROOTS) {
    checkDeadline(deadline);
    const absoluteRoot = path.join(root, moduleRoot);
    if (!(await pathIsDirectory(absoluteRoot))) continue;
    let entries;
    try {
      entries = await fs.readdir(absoluteRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    const children = entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !entry.name.startsWith('.') &&
          !SKIPPED_PROJECT_DIRECTORIES.has(entry.name),
      )
      .map((entry) => `${moduleRoot}/${entry.name}`);
    if (children.length > 0) paths.push(...children);
    else if (
      entries.some(
        (entry) => entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      )
    )
      paths.push(moduleRoot);
  }
  const unique = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
  if (unique.length > MAX_MODULES) {
    reportDiagnostic?.({
      code: 'project-model-module-limit',
      message: `项目模型只分析前 ${MAX_MODULES} 个模块；其余模块当前未生成知识记录。`,
    });
  }
  const bounded = unique.slice(0, MAX_MODULES);
  const slugs = bounded.map(normalizedModuleSlug);
  const duplicateSlugs = new Set(
    slugs.filter((slug, index, all) => all.indexOf(slug) !== all.lastIndexOf(slug)),
  );
  return bounded.map((modulePath) => ({
    modulePath,
    absolutePath: path.join(root, ...modulePath.split('/')),
    id: moduleRecordId(modulePath, duplicateSlugs),
  }));
}

export async function discoverExpectedProjectModelRecordIds(
  options: Pick<DeterministicProjectRecordExtractionOptions, 'projectRoot' | 'reportDiagnostic'>,
): Promise<readonly string[]> {
  const deadline = Date.now() + MAX_EXTRACTION_MS;
  try {
    const modules = await discoverProjectModules(
      path.resolve(options.projectRoot),
      deadline,
      options.reportDiagnostic,
    );
    return ['generated-project-map', 'generated-build-test', ...modules.map((module) => module.id)];
  } catch (error) {
    if (!(error instanceof ExtractionDeadlineExceeded)) throw error;
    options.reportDiagnostic?.({
      code: 'project-model-timeout',
      message: '项目模型发现超过 1.5 秒预算，当前仅补齐已确认的记录。',
    });
    return ['generated-project-map', 'generated-build-test'];
  }
}

function isEntrypoint(relativePath: string): boolean {
  const stem = path.posix
    .basename(relativePath, path.posix.extname(relativePath))
    .toLocaleLowerCase();
  return /^(?:index|main|cli)$/u.test(stem) || /-entry$/u.test(stem);
}

function extractImportSpecifiers(text: string): string[] {
  const values = [
    ...text.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"]+)['"]/gu),
    ...text.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].flatMap((match) => (match[1] ? [match[1]] : []));
  return [...new Set(values)].slice(0, 32);
}

function resolveImportedModule(
  root: string,
  importer: string,
  specifier: string,
  modules: readonly ProjectModule[],
): ProjectModule | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const absolute = path.resolve(path.dirname(path.join(root, ...importer.split('/'))), specifier);
  return modules.find(
    (module) =>
      absolute === module.absolutePath || absolute.startsWith(`${module.absolutePath}${path.sep}`),
  );
}

async function moduleRecords(
  root: string,
  deadline: number,
  language: MemoryLanguage,
  preferredRecordIds: readonly string[] | undefined,
  reportDiagnostic?: ProjectKnowledgeDiagnosticReporter,
): Promise<ProjectKnowledgeRecordDraft[]> {
  const modules = await discoverProjectModules(root, deadline, reportDiagnostic);
  const preference = new Map((preferredRecordIds ?? []).map((id, index) => [id, index]));
  const scanOrder = [...modules].sort((left, right) => {
    const leftPreference = preference.get(left.id) ?? Number.POSITIVE_INFINITY;
    const rightPreference = preference.get(right.id) ?? Number.POSITIVE_INFINITY;
    return leftPreference - rightPreference || left.modulePath.localeCompare(right.modulePath);
  });
  const discoveredCodeFiles: string[] = [];
  const scannedModuleIds = new Set<string>();
  let timedOut = false;
  for (const module of scanOrder) {
    if (discoveredCodeFiles.length > MAX_SOURCE_FILES) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const files = await realProjectFiles(
      module.absolutePath,
      MAX_SOURCE_FILES + 1 - discoveredCodeFiles.length,
      deadline,
      (file) => CODE_EXTENSIONS.has(path.extname(file).toLocaleLowerCase()),
      true,
    );
    scannedModuleIds.add(module.id);
    discoveredCodeFiles.push(...files);
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }
  const sourceLimitReached = discoveredCodeFiles.length > MAX_SOURCE_FILES;
  if (sourceLimitReached) {
    reportDiagnostic?.({
      code: 'project-model-source-limit',
      message: `项目模型只分析前 ${MAX_SOURCE_FILES} 个源码文件；其余源码当前未用于生成模块记录。`,
    });
  }
  const codeFiles = discoveredCodeFiles
    .slice(0, MAX_SOURCE_FILES)
    .sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
  const imports: ParsedImport[] = [];
  const registrations = new Map<string, string[]>();
  const sourceTexts = await Promise.all(
    codeFiles.map(async (file) => {
      if (Date.now() > deadline) return { file, text: null };
      return { file, text: await readText(root, relative(root, file), deadline) };
    }),
  );
  if (Date.now() > deadline) timedOut = true;
  for (const { file, text } of sourceTexts) {
    if (!TS_JS_EXTENSIONS.has(path.extname(file).toLocaleLowerCase())) continue;
    const importer = relative(root, file);
    if (text === null) continue;
    for (const specifier of extractImportSpecifiers(text)) {
      imports.push({
        importer,
        specifier,
        targetModule: resolveImportedModule(root, importer, specifier, modules),
      });
    }
    const names = [...text.matchAll(/\b(register[A-Z][A-Za-z0-9_$]*)\s*\(/gu)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    );
    if (names.length > 0) registrations.set(importer, [...new Set(names)].slice(0, 6));
  }
  if (timedOut) {
    reportDiagnostic?.({
      code: 'project-model-timeout',
      message: '项目模型生成超过 1.5 秒预算，当前仅保留预算内已确认的记录。',
    });
  }

  const records: ProjectKnowledgeRecordDraft[] = [];
  for (const module of modules) {
    if (!scannedModuleIds.has(module.id)) continue;
    if (
      (timedOut || sourceLimitReached) &&
      preferredRecordIds !== undefined &&
      !preference.has(module.id)
    )
      continue;
    const moduleFiles = codeFiles.filter(
      (file) =>
        file === module.absolutePath || file.startsWith(`${module.absolutePath}${path.sep}`),
    );
    const entrypoints = moduleFiles
      .map((file) => relative(root, file))
      .filter(isEntrypoint)
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 8);
    const outgoing = imports.filter(
      (entry) =>
        entry.importer.startsWith(`${module.modulePath}/`) &&
        entry.targetModule !== undefined &&
        entry.targetModule.modulePath !== module.modulePath,
    );
    const dependencyModules = [
      ...new Map(outgoing.map((entry) => [entry.targetModule!.id, entry.targetModule!])).values(),
    ]
      .sort((left, right) => left.modulePath.localeCompare(right.modulePath))
      .slice(0, 8);
    const inbound = imports.filter(
      (entry) =>
        entry.targetModule?.modulePath === module.modulePath &&
        !entry.importer.startsWith(`${module.modulePath}/`),
    );
    const callerModules = [
      ...new Set(
        inbound.map(
          (entry) =>
            modules.find((candidate) => entry.importer.startsWith(`${candidate.modulePath}/`))
              ?.modulePath ?? entry.importer,
        ),
      ),
    ]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 8);
    const registrationEntries = [...registrations.entries()]
      .filter(([file]) => file.startsWith(`${module.modulePath}/`))
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 6);
    const testPath = `test/${module.modulePath}`;
    const hasTestMirror = await pathIsDirectory(path.join(root, ...testPath.split('/')));
    if (
      entrypoints.length === 0 &&
      dependencyModules.length === 0 &&
      callerModules.length === 0 &&
      registrationEntries.length === 0 &&
      !hasTestMirror
    )
      continue;

    const conclusions: ProjectKnowledgeRecordConclusion[] = [];
    if (entrypoints.length > 0) {
      conclusions.push({
        text:
          language === 'en'
            ? `Confirmed entry points: ${entrypoints.join(', ')}.`
            : `可确认入口：${entrypoints.join('、')}。`,
        sources: entrypoints.map((entry) => source(entry)),
      });
    }
    if (dependencyModules.length > 0) {
      conclusions.push({
        text:
          language === 'en'
            ? `Cross-module dependencies: ${dependencyModules.map((entry) => entry.modulePath).join(', ')}.`
            : `跨模块依赖：${dependencyModules.map((entry) => entry.modulePath).join('、')}。`,
        sources: outgoing.slice(0, 16).map((entry) => source(entry.importer)),
      });
    }
    if (callerModules.length > 0) {
      conclusions.push({
        text:
          language === 'en'
            ? `External callers: ${callerModules.join(', ')}.`
            : `外部调用方：${callerModules.join('、')}。`,
        sources: inbound.slice(0, 16).map((entry) => source(entry.importer)),
      });
    }
    if (registrationEntries.length > 0) {
      conclusions.push({
        text:
          language === 'en'
            ? `Registration points: ${registrationEntries.map(([file, names]) => `${file} (${names.join(', ')})`).join('; ')}.`
            : `注册点：${registrationEntries.map(([file, names]) => `${file}（${names.join('、')}）`).join('；')}。`,
        sources: registrationEntries.map(([file]) => source(file)),
      });
    }
    if (hasTestMirror) {
      const testFiles = await realProjectFiles(
        path.join(root, ...testPath.split('/')),
        4,
        deadline,
        () => true,
        true,
      );
      conclusions.push({
        text:
          language === 'en'
            ? `Mirrored test directory: ${testPath}/.`
            : `镜像测试目录：${testPath}/。`,
        sources: testFiles.map((file) => source(relative(root, file))),
      });
    }
    const relations: ProjectKnowledgeRecordRelation[] = dependencyModules.map((dependency) => {
      const evidence = outgoing.find((entry) => entry.targetModule?.id === dependency.id)!;
      return { type: 'depends-on', targetId: dependency.id, sources: [source(evidence.importer)] };
    });
    records.push(
      recordBase(
        module.id,
        'dependency',
        language === 'en'
          ? `Module entry points and dependencies: ${module.modulePath}`
          : `模块入口与依赖：${module.modulePath}`,
        conclusions.map((entry) => entry.text).join(' '),
        conclusions,
        {
          applicablePaths: [`${module.modulePath}/`, ...(hasTestMirror ? [`${testPath}/`] : [])],
          relations,
        },
      ),
    );
  }
  return records;
}

async function packageManager(root: string, manifestText: string): Promise<string> {
  try {
    const declared = (JSON.parse(manifestText) as { packageManager?: unknown }).packageManager;
    if (typeof declared === 'string' && declared.trim()) {
      const name = declared.trim().split('@')[0];
      if (name && ['pnpm', 'npm', 'yarn', 'bun'].includes(name)) return name;
    }
  } catch {
    // The manifest parser below will report no commands.
  }
  for (const [lockfile, manager] of [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
    ['package-lock.json', 'npm'],
  ] as const) {
    try {
      const stat = await fs.lstat(path.join(root, lockfile));
      if (stat.isFile()) return manager;
    } catch {
      // Continue with the next declared lockfile.
    }
  }
  return 'npm';
}

async function buildTestRecord(
  root: string,
  deadline: number,
  language: MemoryLanguage,
): Promise<ProjectKnowledgeRecordDraft | null> {
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
      const manager = await packageManager(root, manifestText);
      for (const name of ['build', 'test', 'lint', 'typecheck', 'check:generated']) {
        if (typeof scripts[name] === 'string') commands.push(`${manager} run ${name}`);
      }
    } catch {
      // An invalid manifest remains visible as evidence for later validation.
    }
  }
  const references = manifestSource ? [source(manifestSource)] : [];
  if (references.length === 0) return null;
  const summary =
    commands.length > 0
      ? language === 'en'
        ? `Preferred project verification commands: ${commands.join(', ')}.`
        : `项目验证优先使用：${commands.join('、')}。`
      : language === 'en'
        ? 'No build or test command is directly discoverable from the manifest.'
        : '项目未声明可从 manifest 直接识别的构建或测试命令。';
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
              ? 'Inspect project documentation and CI before choosing verification commands.'
              : '请先核对项目说明和 CI 中记录的实际验证命令。',
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

async function extractDraftRecords(
  options: DeterministicProjectRecordExtractionOptions,
): Promise<readonly ProjectKnowledgeRecordDraft[]> {
  const root = path.resolve(options.projectRoot);
  const deadline = Date.now() + MAX_EXTRACTION_MS;
  const language = options.language ?? 'zh-CN';
  const records: ProjectKnowledgeRecordDraft[] = [];
  try {
    const projectMap = await projectMapRecord(root, deadline, language);
    if (projectMap) records.push(projectMap);
    const buildTest = await buildTestRecord(root, deadline, language);
    if (buildTest) records.push(buildTest);
    records.push(
      ...(await moduleRecords(
        root,
        deadline,
        language,
        options.preferredRecordIds,
        options.reportDiagnostic,
      )),
    );
  } catch (error) {
    if (!(error instanceof ExtractionDeadlineExceeded)) throw error;
    options.reportDiagnostic?.({
      code: 'project-model-timeout',
      message: '项目模型生成超过 1.5 秒预算，当前仅保留预算内已确认的记录。',
    });
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
      const hashed = await hashProtectedProjectFile(root, relativePath, {
        label: `Project Knowledge source ${relativePath}`,
      });
      versions.push({
        source: relativePath,
        size: Number(hashed.stat.size),
        modifiedAt: Math.trunc(Number(hashed.stat.mtimeMs)),
        digest: hashed.digest,
      });
    } catch {
      // Current-source validation will reject a source that disappeared before persistence.
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
