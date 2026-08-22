import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';

import { resolveProjectKnowledgeCacheLocation } from '../../platform/paths/project-knowledge-cache.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';

export const PROJECT_KNOWLEDGE_UNIT_SCHEMA = 'comet.project-knowledge.unit.v1' as const;

export type ProjectKnowledgeUnitKind =
  | 'project-map'
  | 'module-overview'
  | 'behavior-note'
  | 'integration-path'
  | 'change-impact'
  | 'build-test';

export type ProjectKnowledgeUnitState = 'draft' | 'active' | 'retired';
export type ProjectKnowledgeUnitOrigin = 'maintained' | 'generated';

export type ProjectKnowledgeRelationType =
  | 'contains'
  | 'depends-on'
  | 'consumes'
  | 'registers'
  | 'propagates-to'
  | 'generated-by'
  | 'validated-by'
  | 'supersedes';

export interface ProjectKnowledgeUnitSource {
  readonly source: string;
  readonly anchor?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  /** Small source-backed excerpt used for maintained units across workspaces. */
  readonly evidence?: string;
}

export interface ProjectKnowledgeUnitSourceVersion {
  readonly source: string;
  readonly size: number;
  readonly modifiedAt: number;
}

export interface ProjectKnowledgeUnitConclusion {
  readonly text: string;
  readonly sources: readonly ProjectKnowledgeUnitSource[];
}

export interface ProjectKnowledgeUnitRelation {
  readonly type: ProjectKnowledgeRelationType;
  readonly target: string;
  readonly sources: readonly ProjectKnowledgeUnitSource[];
}

export interface ProjectKnowledgeUnitVerification {
  readonly command: string;
  readonly expected?: string;
}

export interface ProjectKnowledgeUnit {
  readonly schema: typeof PROJECT_KNOWLEDGE_UNIT_SCHEMA;
  readonly id: string;
  readonly kind: ProjectKnowledgeUnitKind;
  readonly state: ProjectKnowledgeUnitState;
  readonly origin: ProjectKnowledgeUnitOrigin;
  readonly title: string;
  readonly summary: string;
  readonly applicablePaths: readonly string[];
  readonly operations: readonly string[];
  readonly conclusions: readonly ProjectKnowledgeUnitConclusion[];
  readonly relations: readonly ProjectKnowledgeUnitRelation[];
  readonly verification: readonly ProjectKnowledgeUnitVerification[];
  /** Persisted for generated units so validation survives a process restart. */
  readonly sourceVersions?: readonly ProjectKnowledgeUnitSourceVersion[];
}

export interface ProjectKnowledgeUnitDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly source?: string;
}

export interface ProjectKnowledgeUnitRepositoryOptions {
  readonly projectRoot: string;
  readonly cacheRoot?: string;
  /** Read the pre-workspace-qualified cache only for an explicit CLI migration path. */
  readonly allowLegacyCacheRead?: boolean;
  readonly reportDiagnostic?: (diagnostic: ProjectKnowledgeUnitDiagnostic) => void;
}

export interface ProjectKnowledgeUnitListOptions {
  readonly state?: ProjectKnowledgeUnitState;
  readonly origin?: ProjectKnowledgeUnitOrigin;
}

const UNIT_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/u;
const MAX_UNIT_BYTES = 128 * 1024;
const MAX_SOURCE_COUNT = 32;
const MAX_TOTAL_SOURCE_COUNT = 128;
const MAX_STRING = 2000;
const UNIT_KINDS = new Set<ProjectKnowledgeUnitKind>([
  'project-map',
  'module-overview',
  'behavior-note',
  'integration-path',
  'change-impact',
  'build-test',
]);
const RELATION_TYPES = new Set<ProjectKnowledgeRelationType>([
  'contains',
  'depends-on',
  'consumes',
  'registers',
  'propagates-to',
  'generated-by',
  'validated-by',
  'supersedes',
]);

function sourceAnchorPart(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100);
}

function sourceContainsAnchor(markdown: string, anchor: string): boolean {
  const stack: string[] = [];
  const occurrences = new Map<string, number>();
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!match) continue;
    const level = match[1].length;
    stack.length = level - 1;
    stack[level - 1] = match[2].trim();
    const base = stack.filter(Boolean).map(sourceAnchorPart).join('/');
    const ordinal = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, ordinal);
    if (anchor === (ordinal === 1 ? base : `${base}-${ordinal}`)) return true;
  }
  return anchor === 'document' && markdown.trim().length > 0;
}

function sourceEvidence(markdown: string, reference: ProjectKnowledgeUnitSource): string {
  const normalized = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  if (reference.lineStart !== undefined) {
    return lines
      .slice(reference.lineStart - 1, reference.lineEnd ?? reference.lineStart)
      .join('\n')
      .trim()
      .slice(0, 1024);
  }
  if (reference.anchor && /\.mdx?$/iu.test(reference.source)) {
    const stack: string[] = [];
    const occurrences = new Map<string, number>();
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(lines[index] ?? '');
      if (!match) continue;
      const level = match[1].length;
      stack.length = level - 1;
      stack[level - 1] = match[2].trim();
      const base = stack.filter(Boolean).map(sourceAnchorPart).join('/');
      const ordinal = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, ordinal);
      const anchor = ordinal === 1 ? base : `${base}-${ordinal}`;
      if (anchor !== reference.anchor) continue;
      let end = index + 1;
      while (end < lines.length && !/^\s{0,3}#{1,6}\s+/u.test(lines[end] ?? '')) end += 1;
      return lines.slice(index, end).join('\n').trim().slice(0, 1024);
    }
  }
  return normalized.trim().slice(0, 1024);
}

async function enrichUnitSources(
  unit: ProjectKnowledgeUnit,
  projectRoot: string,
): Promise<ProjectKnowledgeUnit> {
  const cache = new Map<string, string | null>();
  const enrich = async (
    reference: ProjectKnowledgeUnitSource,
  ): Promise<ProjectKnowledgeUnitSource> => {
    if (reference.evidence !== undefined) return reference;
    if (!cache.has(reference.source)) {
      try {
        const read = await readProtectedProjectFile(projectRoot, reference.source, 64 * 1024, {
          label: reference.source,
        });
        cache.set(reference.source, sourceEvidence(read.bytes.toString('utf8'), reference));
      } catch {
        cache.set(reference.source, null);
      }
    }
    const evidence = cache.get(reference.source);
    return evidence ? { ...reference, evidence } : reference;
  };
  const conclusions = await Promise.all(
    unit.conclusions.map(async (conclusion) => ({
      ...conclusion,
      sources: await Promise.all(conclusion.sources.map(enrich)),
    })),
  );
  const relations = await Promise.all(
    unit.relations.map(async (relation) => ({
      ...relation,
      sources: await Promise.all(relation.sources.map(enrich)),
    })),
  );
  return { ...unit, conclusions, relations };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max = MAX_STRING): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function stringList(value: unknown, label: string, max = 32): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label} must be a bounded list`);
  return value.map((entry, index) => boundedString(entry, `${label}[${index}]`, 512));
}

function parseSource(value: unknown, label: string): ProjectKnowledgeUnitSource {
  const record = objectRecord(value, label);
  const source = boundedString(record.source, `${label}.source`, 1024).replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(source) ||
    path.win32.isAbsolute(source) ||
    source.split('/').some((segment) => segment === '..') ||
    source.includes('\0')
  ) {
    throw new Error(`${label}.source must be a project-relative path`);
  }
  const lineStart = record.line_start;
  const lineEnd = record.line_end;
  if (lineStart !== undefined && (!Number.isSafeInteger(lineStart) || Number(lineStart) < 1)) {
    throw new Error(`${label}.line_start must be a positive integer`);
  }
  if (lineEnd !== undefined && (!Number.isSafeInteger(lineEnd) || Number(lineEnd) < 1)) {
    throw new Error(`${label}.line_end must be a positive integer`);
  }
  if (lineStart !== undefined && lineEnd !== undefined && Number(lineEnd) < Number(lineStart)) {
    throw new Error(`${label}.line_end must not precede line_start`);
  }
  return {
    source,
    ...(record.anchor === undefined
      ? {}
      : { anchor: boundedString(record.anchor, `${label}.anchor`, 512) }),
    ...(lineStart === undefined ? {} : { lineStart: Number(lineStart) }),
    ...(lineEnd === undefined ? {} : { lineEnd: Number(lineEnd) }),
    ...(record.evidence === undefined
      ? {}
      : { evidence: boundedString(record.evidence, `${label}.evidence`, 1024) }),
  };
}

function parseSources(value: unknown, label: string): ProjectKnowledgeUnitSource[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SOURCE_COUNT) {
    throw new Error(`${label} must contain between 1 and ${MAX_SOURCE_COUNT} sources`);
  }
  return value.map((entry, index) => parseSource(entry, `${label}[${index}]`));
}

function parseConclusion(value: unknown, index: number): ProjectKnowledgeUnitConclusion {
  const record = objectRecord(value, `conclusions[${index}]`);
  return {
    text: boundedString(record.text, `conclusions[${index}].text`),
    sources: parseSources(record.sources, `conclusions[${index}].sources`),
  };
}

function parseRelation(value: unknown, index: number): ProjectKnowledgeUnitRelation {
  const record = objectRecord(value, `relations[${index}]`);
  const type = boundedString(
    record.type,
    `relations[${index}].type`,
    64,
  ) as ProjectKnowledgeRelationType;
  if (!RELATION_TYPES.has(type)) throw new Error(`relations[${index}].type is unsupported`);
  const target = boundedString(record.target, `relations[${index}].target`, 128);
  if (!UNIT_ID.test(target))
    throw new Error(`relations[${index}].target must use stable unit naming`);
  return {
    type,
    target,
    sources: parseSources(record.sources, `relations[${index}].sources`),
  };
}

function parseVerification(value: unknown): ProjectKnowledgeUnitVerification[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16)
    throw new Error('verification must be a bounded list');
  return value.map((entry, index) => {
    const record = objectRecord(entry, `verification[${index}]`);
    return {
      command: boundedString(record.command, `verification[${index}].command`, 512),
      ...(record.expected === undefined
        ? {}
        : { expected: boundedString(record.expected, `verification[${index}].expected`, 512) }),
    };
  });
}

function parseSourceVersions(value: unknown): ProjectKnowledgeUnitSourceVersion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TOTAL_SOURCE_COUNT)
    throw new Error('source_versions must be a bounded list');
  return value.map((entry, index) => {
    const record = objectRecord(entry, `source_versions[${index}]`);
    const source = boundedString(
      record.source,
      `source_versions[${index}].source`,
      1024,
    ).replaceAll('\\', '/');
    if (
      path.posix.isAbsolute(source) ||
      path.win32.isAbsolute(source) ||
      source.split('/').some((segment) => segment === '..') ||
      source.includes('\0')
    ) {
      throw new Error(`source_versions[${index}].source must be project-relative`);
    }
    const size = record.size;
    const modifiedAt = record.modified_at ?? record.modifiedAt;
    if (!Number.isSafeInteger(size) || Number(size) < 0)
      throw new Error(`source_versions[${index}].size must be a non-negative integer`);
    if (typeof modifiedAt !== 'number' || !Number.isFinite(modifiedAt) || modifiedAt < 0)
      throw new Error(`source_versions[${index}].modified_at must be a non-negative number`);
    return { source, size: Number(size), modifiedAt: Number(modifiedAt) };
  });
}

export function validateProjectKnowledgeUnitShape(value: unknown): ProjectKnowledgeUnit {
  const record = objectRecord(value, 'project knowledge unit');
  if (record.schema !== PROJECT_KNOWLEDGE_UNIT_SCHEMA)
    throw new Error('unit schema is unsupported');
  const id = boundedString(record.id, 'id', 128);
  if (!UNIT_ID.test(id)) throw new Error('id must use lowercase stable unit naming');
  const kind = boundedString(record.kind, 'kind', 64) as ProjectKnowledgeUnitKind;
  if (!UNIT_KINDS.has(kind)) throw new Error('kind is unsupported');
  const state = boundedString(record.state, 'state', 16) as ProjectKnowledgeUnitState;
  if (!['draft', 'active', 'retired'].includes(state)) throw new Error('state is unsupported');
  const origin = boundedString(record.origin, 'origin', 16) as ProjectKnowledgeUnitOrigin;
  if (!['maintained', 'generated'].includes(origin)) throw new Error('origin is unsupported');
  const conclusionsValue = record.conclusions;
  if (
    !Array.isArray(conclusionsValue) ||
    conclusionsValue.length === 0 ||
    conclusionsValue.length > 32
  ) {
    throw new Error('conclusions must contain between 1 and 32 conclusions');
  }
  const relationsValue = record.relations;
  if (!Array.isArray(relationsValue) || relationsValue.length > 16)
    throw new Error('relations must be a bounded list');
  const unit: ProjectKnowledgeUnit = {
    schema: PROJECT_KNOWLEDGE_UNIT_SCHEMA,
    id,
    kind,
    state,
    origin,
    title: boundedString(record.title, 'title', 200),
    summary: boundedString(record.summary, 'summary', 1000),
    applicablePaths: stringList(
      record.applicable_paths ?? record.applicablePaths,
      'applicable_paths',
    ),
    operations: stringList(record.operations, 'operations'),
    conclusions: conclusionsValue.map((entry, index) => parseConclusion(entry, index)),
    relations: relationsValue.map((entry, index) => parseRelation(entry, index)),
    verification: parseVerification(record.verification),
    ...(record.source_versions === undefined && record.sourceVersions === undefined
      ? {}
      : {
          sourceVersions: parseSourceVersions(record.source_versions ?? record.sourceVersions),
        }),
  };
  const sourceCount =
    unit.conclusions.reduce((total, conclusion) => total + conclusion.sources.length, 0) +
    unit.relations.reduce((total, relation) => total + relation.sources.length, 0);
  if (sourceCount > MAX_TOTAL_SOURCE_COUNT)
    throw new Error('unit source references exceed the limit');
  return unit;
}

function frontmatterAndBody(
  markdown: string,
  source: string,
): { value: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n'))
    throw new Error(`${source} must start with YAML frontmatter`);
  const end = normalized.indexOf('\n---', 4);
  if (end < 0) throw new Error(`${source} frontmatter is not closed`);
  const frontmatter = normalized.slice(4, end);
  return {
    value: objectRecord(parse(frontmatter), `${source} frontmatter`),
    body: normalized.slice(end + 4).trim(),
  };
}

export function parseProjectKnowledgeUnit(
  markdown: string,
  source = 'project knowledge unit',
): ProjectKnowledgeUnit {
  const { value } = frontmatterAndBody(markdown, source);
  return validateProjectKnowledgeUnitShape(value);
}

function bodySection(title: string, body: string): string {
  return `## ${title}\n\n${body.trim() || '无补充说明。'}\n`;
}

export function renderProjectKnowledgeUnit(unit: ProjectKnowledgeUnit): string {
  const validated = validateProjectKnowledgeUnitShape(unit);
  const frontmatter = {
    schema: validated.schema,
    id: validated.id,
    kind: validated.kind,
    state: validated.state,
    origin: validated.origin,
    title: validated.title,
    summary: validated.summary,
    ...(validated.applicablePaths.length > 0
      ? { applicable_paths: [...validated.applicablePaths] }
      : {}),
    ...(validated.operations.length > 0 ? { operations: [...validated.operations] } : {}),
    conclusions: validated.conclusions.map((conclusion) => ({
      text: conclusion.text,
      sources: conclusion.sources.map((source) => ({
        source: source.source,
        ...(source.anchor === undefined ? {} : { anchor: source.anchor }),
        ...(source.lineStart === undefined ? {} : { line_start: source.lineStart }),
        ...(source.lineEnd === undefined ? {} : { line_end: source.lineEnd }),
        ...(source.evidence === undefined ? {} : { evidence: source.evidence }),
      })),
    })),
    relations: validated.relations.map((relation) => ({
      type: relation.type,
      target: relation.target,
      sources: relation.sources.map((source) => ({
        source: source.source,
        ...(source.anchor === undefined ? {} : { anchor: source.anchor }),
        ...(source.lineStart === undefined ? {} : { line_start: source.lineStart }),
        ...(source.lineEnd === undefined ? {} : { line_end: source.lineEnd }),
        ...(source.evidence === undefined ? {} : { evidence: source.evidence }),
      })),
    })),
    ...(validated.verification.length > 0 ? { verification: [...validated.verification] } : {}),
    ...(validated.sourceVersions && validated.sourceVersions.length > 0
      ? {
          source_versions: validated.sourceVersions.map((version) => ({
            source: version.source,
            size: version.size,
            modified_at: version.modifiedAt,
          })),
        }
      : {}),
  };
  const conclusionText = validated.conclusions
    .map((conclusion) => `- ${conclusion.text}`)
    .join('\n');
  const relationText =
    validated.relations.length === 0
      ? '当前没有需要扩展的关系。'
      : validated.relations.map((relation) => `- ${relation.type} → ${relation.target}`).join('\n');
  const sourceText = [
    ...new Set([
      ...validated.conclusions.flatMap((conclusion) =>
        conclusion.sources.map((source) => source.source),
      ),
      ...validated.relations.flatMap((relation) => relation.sources.map((source) => source.source)),
    ]),
  ]
    .map((source) => `- ${source}`)
    .join('\n');
  const verificationText =
    validated.verification.length === 0
      ? '无额外验证命令。'
      : validated.verification
          .map((entry) => `- \`${entry.command}\`${entry.expected ? `：${entry.expected}` : ''}`)
          .join('\n');
  return [
    '---',
    stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
    '---',
    '',
    bodySection('职责或结论', conclusionText),
    bodySection(
      'Agent 何时使用',
      validated.operations.length > 0
        ? validated.operations.map((operation) => `- ${operation}`).join('\n')
        : '根据适用路径和任务类型使用。',
    ),
    bodySection('行为语义或影响链', `${validated.summary}\n\n${relationText}`),
    bodySection(
      '修改时必须核对',
      validated.applicablePaths.length > 0
        ? validated.applicablePaths.map((value) => `- ${value}`).join('\n')
        : '先核对来源和当前代码。',
    ),
    bodySection('来源', sourceText || '- 由单元内容指定。'),
    bodySection('验证方式', verificationText),
  ].join('\n');
}

export class ProjectKnowledgeUnitRepository {
  readonly maintainedRoot: string;
  readonly generatedRoot: string;
  private readonly projectRoot: string;
  private readonly legacyGeneratedRoot?: string;
  private readonly allowLegacyCacheRead: boolean;
  private readonly reportDiagnostic: ProjectKnowledgeUnitRepositoryOptions['reportDiagnostic'];

  constructor(options: ProjectKnowledgeUnitRepositoryOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.reportDiagnostic = options.reportDiagnostic;
    this.allowLegacyCacheRead = options.allowLegacyCacheRead === true;
    this.maintainedRoot = path.join(this.projectRoot, 'docs', 'comet', 'knowledge', 'units');
    this.legacyGeneratedRoot = options.cacheRoot
      ? path.join(path.resolve(options.cacheRoot), 'project-knowledge', 'units')
      : undefined;
    this.generatedRoot = path.join(
      path.dirname(
        resolveProjectKnowledgeCacheLocation(this.projectRoot, options.cacheRoot).databasePath,
      ),
      'units',
    );
  }

  async list(
    options: ProjectKnowledgeUnitListOptions = {},
  ): Promise<readonly ProjectKnowledgeUnit[]> {
    const output: ProjectKnowledgeUnit[] = [];
    const roots: ReadonlyArray<readonly [string, ProjectKnowledgeUnitOrigin]> = [
      [this.maintainedRoot, 'maintained'],
      [this.generatedRoot, 'generated'],
      ...(this.allowLegacyCacheRead &&
      this.legacyGeneratedRoot &&
      this.legacyGeneratedRoot !== this.generatedRoot
        ? ([[this.legacyGeneratedRoot, 'generated']] as const)
        : []),
    ];
    const seenIds = new Set<string>();
    for (const [root, origin] of roots) {
      if (options.origin && options.origin !== origin) continue;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.reportDiagnostic?.({
            code: 'unit-directory',
            message:
              origin === 'maintained'
                ? '无法读取项目维护知识单元目录。'
                : '无法读取本地生成知识单元缓存。',
          });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.isSymbolicLink()) continue;
        const relative = path
          .relative(this.projectRoot, path.join(root, entry.name))
          .replaceAll(path.sep, '/');
        try {
          let bytes: Buffer;
          if (origin === 'maintained') {
            bytes = (
              await readProtectedProjectFile(this.projectRoot, relative, MAX_UNIT_BYTES, {
                label: relative,
              })
            ).bytes;
          } else {
            const generatedPath = path.join(root, entry.name);
            const stat = await fs.stat(generatedPath);
            if (stat.size > MAX_UNIT_BYTES) throw new Error('generated unit exceeds read budget');
            bytes = await fs.readFile(generatedPath);
          }
          const parsed = parseProjectKnowledgeUnit(bytes.toString('utf8'), relative);
          const unit = origin === 'maintained' ? { ...parsed, sourceVersions: undefined } : parsed;
          if (unit.origin !== origin || (options.state && unit.state !== options.state)) continue;
          if (seenIds.has(unit.id)) continue;
          if (origin === 'generated' && root !== this.generatedRoot) {
            const validation = await validateProjectKnowledgeUnitSources(unit, {
              projectRoot: this.projectRoot,
            });
            if (!validation.valid) continue;
          }
          seenIds.add(unit.id);
          output.push(unit);
        } catch {
          this.reportDiagnostic?.({
            code: 'unit-parse',
            message: `跳过无法解析的项目知识单元：${entry.name}`,
          });
        }
      }
    }
    return output.sort((left, right) => left.id.localeCompare(right.id));
  }

  async read(id: string): Promise<ProjectKnowledgeUnit | null> {
    const unit = (await this.list()).find((candidate) => candidate.id === id);
    return unit ?? null;
  }

  async writeMaintained(unit: ProjectKnowledgeUnit): Promise<void> {
    const validated = await enrichUnitSources(
      validateProjectKnowledgeUnitShape({ ...unit, sourceVersions: undefined }),
      this.projectRoot,
    );
    if (validated.origin !== 'maintained')
      throw new Error('writeMaintained requires maintained origin');
    await ensureProtectedProjectDirectory(this.projectRoot, 'docs/comet/knowledge/units', {
      label: 'project knowledge units',
    });
    await fs.writeFile(
      path.join(this.maintainedRoot, `${validated.id}.md`),
      renderProjectKnowledgeUnit(validated),
      'utf8',
    );
  }

  async writeGenerated(unit: ProjectKnowledgeUnit): Promise<void> {
    const validated = validateProjectKnowledgeUnitShape(unit);
    if (validated.origin !== 'generated')
      throw new Error('writeGenerated requires generated origin');
    const sourceVersions = await captureProjectKnowledgeUnitSourceVersions(
      validated,
      this.projectRoot,
    );
    const persisted = sourceVersions.length > 0 ? { ...validated, sourceVersions } : validated;
    await fs.mkdir(this.generatedRoot, { recursive: true });
    await fs.writeFile(
      path.join(this.generatedRoot, `${persisted.id}.md`),
      renderProjectKnowledgeUnit(persisted),
      'utf8',
    );
    if (this.legacyGeneratedRoot && this.legacyGeneratedRoot !== this.generatedRoot) {
      // Keep the historical cache location observable for older integrations;
      // reads always use the workspace-qualified directory above.
      await fs.mkdir(this.legacyGeneratedRoot, { recursive: true });
      await fs.writeFile(
        path.join(this.legacyGeneratedRoot, `${persisted.id}.md`),
        `<!-- workspace-qualified project knowledge: ${path.relative(this.legacyGeneratedRoot, this.generatedRoot).replaceAll('\\', '/')} -->\n`,
        'utf8',
      );
    }
  }

  async share(
    id: string,
    options: { readonly confirm?: boolean } = {},
  ): Promise<ProjectKnowledgeUnit> {
    if (options.confirm !== true) throw new Error('share requires explicit confirmation');
    const unit = await this.read(id);
    if (unit === null) throw new Error(`项目知识单元不存在：${id}`);
    const validation = await validateProjectKnowledgeUnitSources(unit, {
      projectRoot: this.projectRoot,
    });
    if (!validation.valid) throw new Error('项目知识单元来源已变化或不可用');
    const shared = validateProjectKnowledgeUnitShape({
      ...unit,
      origin: 'maintained',
      state: unit.state === 'retired' ? 'draft' : unit.state,
      sourceVersions: undefined,
    });
    await this.writeMaintained(shared);
    if (unit.origin === 'generated') {
      await this.writeGenerated({ ...unit, state: 'retired' });
    }
    return shared;
  }

  async shareMaintained(
    unit: ProjectKnowledgeUnit,
    options: { readonly confirm?: boolean } = {},
  ): Promise<ProjectKnowledgeUnit> {
    if (options.confirm !== true) throw new Error('share requires explicit confirmation');
    const validated = validateProjectKnowledgeUnitShape({ ...unit, sourceVersions: undefined });
    if (validated.origin !== 'maintained') throw new Error('shared unit must be maintained');
    const validation = await validateProjectKnowledgeUnitSources(validated, {
      projectRoot: this.projectRoot,
    });
    if (!validation.valid) throw new Error('shared unit sources are not current');
    await this.writeMaintained(validated);
    return validated;
  }

  async retire(id: string): Promise<ProjectKnowledgeUnit> {
    const unit = await this.read(id);
    if (unit === null) throw new Error(`项目知识单元不存在：${id}`);
    const retired = { ...unit, state: 'retired' as const };
    if (unit.origin === 'maintained') await this.writeMaintained(retired);
    else await this.writeGenerated(retired);
    return retired;
  }
}

export interface ProjectKnowledgeUnitSourceValidationOptions {
  readonly projectRoot: string;
  readonly maxSourceBytes?: number;
  readonly maxTotalBytes?: number;
  readonly baseline?: ReadonlyMap<string, { readonly size: number; readonly modifiedAt: number }>;
}

export interface ProjectKnowledgeUnitSourceValidationResult {
  readonly valid: boolean;
  readonly bytesRead: number;
  readonly diagnostics: readonly ProjectKnowledgeUnitDiagnostic[];
}

const validationObserved = new Map<
  string,
  { readonly size: number; readonly modifiedAt: number; readonly content: string }
>();

export async function captureProjectKnowledgeUnitSourceVersions(
  unit: ProjectKnowledgeUnit,
  projectRoot: string,
): Promise<readonly ProjectKnowledgeUnitSourceVersion[]> {
  const deadline = Date.now() + 2_000;
  const references = [
    ...unit.conclusions.flatMap((conclusion) => conclusion.sources),
    ...unit.relations.flatMap((relation) => relation.sources),
  ];
  const seen = new Set<string>();
  const versions: ProjectKnowledgeUnitSourceVersion[] = [];
  for (const reference of references) {
    if (Date.now() > deadline) break;
    if (seen.has(reference.source)) continue;
    seen.add(reference.source);
    try {
      const inspected = await inspectProtectedProjectPath(projectRoot, reference.source, {
        label: reference.source,
        expected: 'file',
      });
      if (!inspected.exists) continue;
      const stat = await fs.stat(inspected.target);
      versions.push({
        source: reference.source,
        size: Number(stat.size),
        modifiedAt: Number(stat.mtimeMs),
      });
    } catch {
      // Validation reports missing or inaccessible sources separately.
    }
  }
  return versions;
}

export async function validateProjectKnowledgeUnitSources(
  unit: ProjectKnowledgeUnit,
  options: ProjectKnowledgeUnitSourceValidationOptions,
): Promise<ProjectKnowledgeUnitSourceValidationResult> {
  const diagnostics: ProjectKnowledgeUnitDiagnostic[] = [];
  const deadline = Date.now() + 2_000;
  const references = [
    ...unit.conclusions.flatMap((conclusion) => conclusion.sources),
    ...unit.relations.flatMap((relation) => relation.sources),
  ];
  let bytesRead = 0;
  for (const reference of references) {
    if (Date.now() > deadline) {
      diagnostics.push({
        code: 'source-budget',
        message: '项目知识单元来源校验超过时间限制。',
        source: reference.source,
      });
      continue;
    }
    if (bytesRead >= (options.maxTotalBytes ?? 512 * 1024)) {
      diagnostics.push({
        code: 'source-budget',
        message: '项目知识单元来源读取超过总字节限制。',
        source: reference.source,
      });
      continue;
    }
    let inspected;
    try {
      inspected = await inspectProtectedProjectPath(options.projectRoot, reference.source, {
        label: reference.source,
        expected: 'file',
      });
      if (!inspected.exists) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      const read = await readProtectedProjectFile(
        options.projectRoot,
        reference.source,
        Math.min(
          options.maxSourceBytes ?? 64 * 1024,
          (options.maxTotalBytes ?? 512 * 1024) - bytesRead,
        ),
        { label: reference.source },
      );
      bytesRead += read.bytes.length;
      if (Date.now() > deadline) {
        diagnostics.push({
          code: 'source-budget',
          message: '项目知识单元来源校验超过时间限制。',
          source: reference.source,
        });
        continue;
      }
      const stat = read.stat;
      const current = { size: Number(stat.size), modifiedAt: Number(stat.mtimeMs) };
      const content = read.bytes.toString('utf8');
      const normalizedContent = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
      const lines = content.replaceAll('\r\n', '\n').split('\n');
      if (
        reference.evidence !== undefined &&
        !normalizedContent.includes(reference.evidence.replaceAll('\r\n', '\n'))
      ) {
        diagnostics.push({
          code: 'source-evidence-missing',
          message: '项目知识单元引用的来源片段在当前文件中不存在。',
          source: reference.source,
        });
        continue;
      }
      if (
        reference.anchor &&
        /\.mdx?$/iu.test(reference.source) &&
        !sourceContainsAnchor(content, reference.anchor)
      ) {
        diagnostics.push({
          code: 'source-anchor-missing',
          message: '项目知识单元引用的章节锚点在当前来源中不存在。',
          source: reference.source,
        });
        continue;
      }
      if (
        (reference.lineStart !== undefined && reference.lineStart > lines.length) ||
        (reference.lineEnd !== undefined && reference.lineEnd > lines.length)
      ) {
        diagnostics.push({
          code: 'source-line-missing',
          message: '项目知识单元引用的行范围超出当前来源。',
          source: reference.source,
        });
        continue;
      }
      const persisted = unit.sourceVersions?.find((entry) => entry.source === reference.source);
      const baseline = options.baseline?.get(reference.source) ?? persisted;
      if (
        baseline &&
        (baseline.size !== current.size || baseline.modifiedAt !== current.modifiedAt)
      ) {
        diagnostics.push({
          code: 'source-changed',
          message: '来源在知识单元生成后发生变化。',
          source: reference.source,
        });
        continue;
      }
      const observedKey = `${path.resolve(options.projectRoot)}\0${reference.source}`;
      const observed = validationObserved.get(observedKey);
      if (
        observed &&
        (observed.size !== current.size ||
          observed.modifiedAt !== current.modifiedAt ||
          observed.content !== content)
      ) {
        diagnostics.push({
          code: 'source-changed',
          message: '来源在知识单元生成后发生变化。',
          source: reference.source,
        });
        continue;
      }
      validationObserved.set(observedKey, { ...current, content });
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'source-missing' : 'source-path';
      diagnostics.push({
        code,
        message: '项目知识单元来源无法通过当前项目路径校验。',
        source: reference.source,
      });
    }
  }
  return { valid: diagnostics.length === 0 && unit.state !== 'retired', bytesRead, diagnostics };
}

export function expandProjectKnowledgeRelations(options: {
  readonly units: readonly ProjectKnowledgeUnit[];
  readonly matchedIds: readonly string[];
  readonly maxPerUnit?: number;
}): readonly ProjectKnowledgeUnit[] {
  const byId = new Map(options.units.map((unit) => [unit.id, unit]));
  const matched = new Set(options.matchedIds);
  const expanded = new Map<string, ProjectKnowledgeUnit>();
  const limit = Math.max(0, Math.min(options.maxPerUnit ?? 4, 4));
  for (const matchedId of matched) {
    const unit = byId.get(matchedId);
    if (!unit || unit.state !== 'active') continue;
    let count = 0;
    for (const relation of unit.relations) {
      if (count >= limit || relation.sources.length === 0) break;
      const target = byId.get(relation.target);
      if (!target || target.state !== 'active' || matched.has(target.id)) continue;
      expanded.set(target.id, target);
      count += 1;
    }
  }
  return [...expanded.values()].sort((left, right) => left.id.localeCompare(right.id));
}
