import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveProjectKnowledgeStorageLocation } from '../../platform/paths/project-knowledge-storage.js';

export const PROJECT_MEMORY_TYPES = [
  'fact',
  'decision',
  'pattern',
  'procedure',
  'constraint',
  'failure-resolution',
] as const;

export type ProjectMemoryType = (typeof PROJECT_MEMORY_TYPES)[number];

export const PROJECT_MEMORY_INDEX_FILE = 'MEMORY.md';
export const PROJECT_MEMORY_EXPANSION_PREFIX = 'project-memory:';
/** Context candidate id of the always-injected MEMORY.md index. */
export const PROJECT_MEMORY_INDEX_CANDIDATE_ID = 'project-memory-index';

const MEMORY_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const MAX_TITLE_CHARS = 120;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MEMORIES = 200;
const MAX_PATHS = 8;
const MAX_CONTEXT_ENTRIES = 60;
const MAX_CONTEXT_CHARS = 3000;
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 4_000;
const LOCK_POLL_MS = 50;

export interface ProjectMemoryEntry {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly type: ProjectMemoryType;
  readonly created: string;
  readonly updated: string;
  readonly paths: readonly string[];
  readonly source?: string;
  readonly body: string;
}

export interface ProjectMemoryIndexEntry {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

export interface WriteProjectMemoryInput {
  readonly title: string;
  readonly text: string;
  readonly type?: ProjectMemoryType;
  readonly description?: string;
  readonly slug?: string;
  readonly paths?: readonly string[];
  readonly source?: string;
}

export interface WriteProjectMemoryResult {
  readonly action: 'created' | 'updated';
  readonly slug: string;
  readonly file: string;
  readonly entry: ProjectMemoryEntry;
  readonly total: number;
}

export interface ProjectMemoryStoreOptions {
  readonly cacheRoot?: string;
  readonly now?: () => Date;
}

export function isProjectMemoryType(value: unknown): value is ProjectMemoryType {
  return typeof value === 'string' && (PROJECT_MEMORY_TYPES as readonly string[]).includes(value);
}

export function resolveProjectMemoryDirectory(projectRoot: string, cacheRoot?: string): string {
  const location = resolveProjectKnowledgeStorageLocation(projectRoot, cacheRoot);
  return path.join(path.dirname(location.databasePath), 'memory');
}

function singleLine(value: string, maxChars: number): string {
  return value
    .replace(/[\r\n\t]+/gu, ' ')
    .trim()
    .slice(0, maxChars);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isValidSlug(value: string): boolean {
  return MEMORY_SLUG_PATTERN.test(value);
}

function deriveMemorySlug(title: string): string {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 6)
    .join('-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/u, '');
  if (words.includes('-') && words.replace(/-/gu, '').length >= 3 && isValidSlug(words)) {
    return words;
  }
  return `memo-${createHash('sha256').update(title).digest('hex').slice(0, 8)}`;
}

function memoryFileName(slug: string): string {
  return `${slug}.md`;
}

function serializeMemoryDocument(entry: ProjectMemoryEntry): string {
  const frontmatter = [
    `name: ${entry.slug}`,
    `title: ${singleLine(entry.title, MAX_TITLE_CHARS)}`,
    `description: ${singleLine(entry.description, MAX_DESCRIPTION_CHARS)}`,
    `type: ${entry.type}`,
    `created: ${entry.created}`,
    `updated: ${entry.updated}`,
    `paths: ${JSON.stringify(entry.paths.map((value) => singleLine(value, 200)))}`,
    ...(entry.source === undefined ? [] : [`source: ${singleLine(entry.source, 200)}`]),
  ];
  return `---\n${frontmatter.join('\n')}\n---\n\n${entry.body.replace(/\r\n/gu, '\n').trim()}\n`;
}

interface ParsedMemoryDocument {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly type: ProjectMemoryType;
  readonly created: string;
  readonly updated: string;
  readonly paths: readonly string[];
  readonly source?: string;
  readonly body: string;
}

function parseMemoryDocument(raw: string): ParsedMemoryDocument | null {
  const lines = raw.replace(/\r\n/gu, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing <= 1) return null;
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const slug = fields.get('name') ?? fields.get('slug') ?? '';
  const title = fields.get('title') ?? '';
  const description = fields.get('description') ?? '';
  const type = fields.get('type') ?? '';
  const created = fields.get('created') ?? '';
  const updated = fields.get('updated') ?? created;
  if (!isValidSlug(slug) || !title || !description || !isProjectMemoryType(type)) return null;
  let paths: string[] = [];
  const rawPaths = fields.get('paths');
  if (rawPaths) {
    try {
      const parsed: unknown = JSON.parse(rawPaths);
      if (Array.isArray(parsed)) {
        paths = parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, MAX_PATHS);
      }
    } catch {
      paths = [];
    }
  }
  const source = fields.get('source');
  return {
    slug,
    title,
    description,
    type,
    created,
    updated,
    paths,
    ...(source === undefined ? {} : { source }),
    body: lines
      .slice(closing + 1)
      .join('\n')
      .trim(),
  };
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, file);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The memory directory is shared by short-lived CLI processes and hook
 * invocations. A create-marker lock file bounds concurrent rewrites of the
 * index; a stale lock (crashed writer) is taken over after LOCK_STALE_MS.
 */
async function withProjectMemoryLock<T>(
  directory: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, '.lock');
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.write(`${process.pid} ${new Date().toISOString()}`);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await unlink(lockPath).catch(() => undefined);
        }
      } catch {
        // The lock disappeared between the failed create and the stat; retry.
      }
      if (Date.now() > deadline) {
        throw new Error('项目记忆存储正被其他进程写入，请稍后重试', { cause: error });
      }
      await delay(LOCK_POLL_MS);
    }
  }
  try {
    return await operation();
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

async function scanProjectMemoryEntries(
  directory: string,
): Promise<readonly ParsedMemoryDocument[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const entries: ParsedMemoryDocument[] = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name === PROJECT_MEMORY_INDEX_FILE) continue;
    let raw: string;
    try {
      raw = await readFile(path.join(directory, name), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseMemoryDocument(raw);
    if (parsed !== null && `${parsed.slug}.md` === name) entries.push(parsed);
  }
  entries.sort((left, right) => left.slug.localeCompare(right.slug));
  return entries;
}

function renderIndexDocument(entries: readonly ProjectMemoryIndexEntry[]): string {
  const lines = [
    '# Project Memory Index',
    '',
    '<!-- Managed by comet knowledge remember. One line per durable project lesson; the full note lives in the linked file. -->',
    '',
  ];
  for (const entry of entries) {
    const title = singleLine(entry.title, MAX_TITLE_CHARS).replace(/[[\]]/gu, '');
    const description = singleLine(entry.description, MAX_DESCRIPTION_CHARS);
    lines.push(`- [${title}](${memoryFileName(entry.slug)}) — ${description}`);
  }
  return `${lines.join('\n')}\n`;
}

const INDEX_LINE_PATTERN = /^-\s+\[([^\]]+)\]\(([a-z0-9][a-z0-9-]*)\.md\)\s+—\s+(.+)$/u;

function parseIndexDocument(raw: string): readonly ProjectMemoryIndexEntry[] {
  const entries: ProjectMemoryIndexEntry[] = [];
  for (const line of raw.replace(/\r\n/gu, '\n').split('\n')) {
    const match = INDEX_LINE_PATTERN.exec(line.trim());
    if (match === null) continue;
    entries.push({
      slug: match[2],
      title: match[1].trim(),
      description: match[3].trim(),
    });
  }
  return entries;
}

function descriptionFromText(text: string): string {
  const firstLine = text
    .replace(/\r\n/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\s>*-]+/u, '').trim())
    .find((line) => line.length > 0);
  return singleLine(firstLine ?? '', MAX_DESCRIPTION_CHARS);
}

export async function readProjectMemoryIndex(
  projectRoot: string,
  cacheRoot?: string,
): Promise<readonly ProjectMemoryIndexEntry[]> {
  const directory = resolveProjectMemoryDirectory(projectRoot, cacheRoot);
  let raw: string;
  try {
    raw = await readFile(path.join(directory, PROJECT_MEMORY_INDEX_FILE), 'utf8');
  } catch {
    return [];
  }
  return parseIndexDocument(raw);
}

export async function readProjectMemory(
  projectRoot: string,
  slug: string,
  cacheRoot?: string,
): Promise<ProjectMemoryEntry | null> {
  if (!isValidSlug(slug)) return null;
  const directory = resolveProjectMemoryDirectory(projectRoot, cacheRoot);
  let raw: string;
  try {
    raw = await readFile(path.join(directory, memoryFileName(slug)), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseMemoryDocument(raw);
  if (parsed === null || parsed.slug !== slug) return null;
  return parsed;
}

export interface ProjectMemoryEntrySummary {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly type: ProjectMemoryType;
  readonly created: string;
  readonly updated: string;
  readonly paths: readonly string[];
  readonly source?: string;
}

const MAX_SUMMARY_ENTRIES = 200;

export async function readProjectMemoryEntries(
  projectRoot: string,
  cacheRoot?: string,
): Promise<readonly ProjectMemoryEntrySummary[]> {
  const directory = resolveProjectMemoryDirectory(projectRoot, cacheRoot);
  const entries = await scanProjectMemoryEntries(directory);
  return [...entries]
    .sort((left, right) => right.updated.localeCompare(left.updated))
    .slice(0, MAX_SUMMARY_ENTRIES)
    .map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      description: entry.description,
      type: entry.type,
      created: entry.created,
      updated: entry.updated,
      paths: entry.paths,
      ...(entry.source === undefined ? {} : { source: entry.source }),
    }));
}

export async function writeProjectMemory(
  projectRoot: string,
  input: WriteProjectMemoryInput,
  options: ProjectMemoryStoreOptions = {},
): Promise<WriteProjectMemoryResult> {
  const title = singleLine(input.title, MAX_TITLE_CHARS);
  if (!title) throw new Error('项目记忆标题不能为空');
  const body = input.text.replace(/\r\n/gu, '\n').trim();
  if (!body) throw new Error('项目记忆正文不能为空');
  if (byteLength(body) > MAX_BODY_BYTES) {
    throw new Error(`项目记忆正文不得超过 ${MAX_BODY_BYTES} 字节`);
  }
  const type: ProjectMemoryType = input.type ?? 'pattern';
  if (!isProjectMemoryType(type)) {
    throw new Error(`项目记忆类型必须是 ${PROJECT_MEMORY_TYPES.join(' | ')}`);
  }
  const description = singleLine(
    input.description && input.description.trim() ? input.description : descriptionFromText(body),
    MAX_DESCRIPTION_CHARS,
  );
  if (!description) throw new Error('项目记忆摘要不能为空');
  const paths = (input.paths ?? [])
    .map((value) => singleLine(value, 200))
    .filter(Boolean)
    .slice(0, MAX_PATHS);
  const source = input.source === undefined ? undefined : singleLine(input.source, 200);
  const explicitSlug = input.slug?.trim().toLowerCase();
  if (explicitSlug !== undefined && explicitSlug !== '' && !isValidSlug(explicitSlug)) {
    throw new Error('项目记忆 slug 只能包含小写字母、数字和中划线，且不超过 64 个字符');
  }

  const directory = resolveProjectMemoryDirectory(projectRoot, options.cacheRoot);
  return withProjectMemoryLock(directory, async () => {
    const existing = await scanProjectMemoryEntries(directory);
    const now = (options.now ?? (() => new Date()))().toISOString();
    let slug = explicitSlug || deriveMemorySlug(title);
    if (explicitSlug === undefined || explicitSlug === '') {
      const taken = new Set(existing.map((entry) => entry.slug));
      const base = slug.slice(0, 61);
      let candidate = slug;
      let suffix = 2;
      while (taken.has(candidate)) {
        const current = existing.find((entry) => entry.slug === candidate);
        if (current !== undefined && current.title === title) break;
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      slug = candidate;
    }
    const previous = existing.find((entry) => entry.slug === slug);
    if (previous === undefined && existing.length >= MAX_MEMORIES) {
      throw new Error(
        `项目记忆已达上限（${MAX_MEMORIES} 条）；请先合并或用 comet knowledge forget --memory <slug> 删除过时记忆`,
      );
    }
    const entry: ProjectMemoryEntry = {
      slug,
      title,
      description,
      type,
      created: previous?.created ?? now,
      updated: now,
      paths,
      ...(source === undefined && previous?.source === undefined
        ? {}
        : { source: source ?? previous?.source }),
      body,
    };
    const file = path.join(directory, memoryFileName(slug));
    await atomicWrite(file, serializeMemoryDocument(entry));
    const merged = [
      ...existing.filter((current) => current.slug !== slug),
      {
        slug,
        title,
        description,
        type,
        created: entry.created,
        updated: entry.updated,
        paths,
        ...(entry.source === undefined ? {} : { source: entry.source }),
        body,
      },
    ].sort((left, right) => left.slug.localeCompare(right.slug));
    await atomicWrite(path.join(directory, PROJECT_MEMORY_INDEX_FILE), renderIndexDocument(merged));
    return {
      action: previous === undefined ? 'created' : 'updated',
      slug,
      file,
      entry,
      total: merged.length,
    };
  });
}

export async function removeProjectMemory(
  projectRoot: string,
  slug: string,
  cacheRoot?: string,
): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  const directory = resolveProjectMemoryDirectory(projectRoot, cacheRoot);
  return withProjectMemoryLock(directory, async () => {
    const existing = await scanProjectMemoryEntries(directory);
    const target = existing.find((entry) => entry.slug === slug);
    if (target === undefined) return false;
    await unlink(path.join(directory, memoryFileName(slug))).catch(() => undefined);
    await atomicWrite(
      path.join(directory, PROJECT_MEMORY_INDEX_FILE),
      renderIndexDocument(
        existing
          .filter((entry) => entry.slug !== slug)
          .map((entry) => ({
            slug: entry.slug,
            title: entry.title,
            description: entry.description,
          })),
      ),
    );
    return true;
  });
}

export function renderProjectMemoryIndexContext(
  entries: readonly ProjectMemoryIndexEntry[],
  language: 'zh-CN' | 'en' = 'zh-CN',
): string | null {
  if (entries.length === 0) return null;
  const heading = language === 'en' ? '## Project memory index' : '## 项目记忆索引';
  const hint =
    language === 'en'
      ? 'Each line is a durable lesson learned in this project. Expand the full note with the same task arguments plus --expand-context "project-memory:<slug>".'
      : '以下每行是本项目沉淀的一条可复用经验；需要完整内容时用同一任务参数追加 --expand-context "project-memory:<slug>" 展开。';
  const lines = [heading, hint];
  for (const entry of entries.slice(0, MAX_CONTEXT_ENTRIES)) {
    const line = `- ${singleLine(entry.title, MAX_TITLE_CHARS)} — ${singleLine(
      entry.description,
      MAX_DESCRIPTION_CHARS,
    )} (${entry.slug})`;
    if (lines.join('\n').length + line.length >= MAX_CONTEXT_CHARS) break;
    lines.push(line);
  }
  const remaining = entries.length - (lines.length - 2);
  if (remaining > 0) {
    lines.push(
      language === 'en'
        ? `… ${remaining} more entries in MEMORY.md`
        : `……另有 ${remaining} 条，见 MEMORY.md`,
    );
  }
  return lines.join('\n');
}
