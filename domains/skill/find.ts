import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { getPlatformSkillsDir, PLATFORMS } from '../../platform/install/platforms.js';

export interface SkillPreferenceEntry {
  query: string;
  preferenceIndex: number;
}

export interface SkillSearchRoot {
  root: string;
  origin: 'project' | 'global' | 'builtin' | 'plugin' | 'explicit';
  platform?: string;
}

export interface FoundSkillSource {
  name: string;
  root: string;
  origin: SkillSearchRoot['origin'];
  platform?: string;
  description: string;
  skillMd: string;
  references: Array<{ path: string; contentHash: string }>;
  scripts: Array<{
    path: string;
    sideEffect: 'unknown' | 'none' | 'read' | 'write' | 'external';
  }>;
  hash: string;
}

export interface FoundSkill {
  query: string;
  preferenceIndex: number | null;
  status: 'available' | 'missing' | 'ambiguous';
  sources: FoundSkillSource[];
}

export interface FindPreferredSkillsOptions {
  projectRoot: string;
  homeDir?: string;
  builtinRoot?: string;
  preferences?: SkillPreferenceEntry[] | null;
  extraRoots?: SkillSearchRoot[];
}

interface HashedFile {
  relativePath: string;
  kind: 'file' | 'symlink';
  content: Buffer;
}

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function defaultBuiltinRoot(): string {
  return path.resolve(moduleDirectory, '..', '..', 'assets', 'skills');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validSkillName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(name);
}

function looksLikePath(query: string): boolean {
  return (
    path.isAbsolute(query) || query.startsWith('.') || query.includes('/') || query.includes('\\')
  );
}

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizedPlatformId(platformId: string): string {
  return platformId === 'claude' ? 'claude-code' : platformId;
}

function platformRoots(projectRoot: string, homeDir: string): SkillSearchRoot[] {
  const roots: SkillSearchRoot[] = [];
  for (const platform of PLATFORMS) {
    roots.push({
      root: path.resolve(projectRoot, getPlatformSkillsDir(platform, 'project'), 'skills'),
      origin: 'project',
      platform: normalizedPlatformId(platform.id),
    });
    roots.push({
      root: path.resolve(homeDir, getPlatformSkillsDir(platform, 'global'), 'skills'),
      origin: 'global',
      platform: normalizedPlatformId(platform.id),
    });
  }
  return roots;
}

function searchRoots(options: {
  projectRoot: string;
  homeDir: string;
  builtinRoot: string;
  extraRoots: SkillSearchRoot[];
}): SkillSearchRoot[] {
  return [
    { root: path.resolve(options.projectRoot, '.comet', 'skills'), origin: 'project' },
    ...platformRoots(options.projectRoot, options.homeDir),
    { root: options.builtinRoot, origin: 'builtin', platform: 'comet' },
    ...options.extraRoots,
  ];
}

async function directoryEntries(root: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function collectHashFiles(root: string, relative = ''): Promise<HashedFile[]> {
  const directory = path.join(root, ...relative.split('/').filter(Boolean));
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
    compareText(left.name, right.name),
  );
  const files: HashedFile[] = [];
  for (const entry of entries) {
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectHashFiles(root, relativePath)));
    } else if (entry.isSymbolicLink()) {
      files.push({
        relativePath,
        kind: 'symlink',
        content: Buffer.from(await fs.readlink(target)),
      });
    } else if (entry.isFile()) {
      files.push({ relativePath, kind: 'file', content: await fs.readFile(target) });
    }
  }
  return files;
}

async function collectOptionalHashFiles(root: string, relative: string): Promise<HashedFile[]> {
  try {
    return await collectHashFiles(root, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function hashSkillDirectory(root: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await collectHashFiles(root)) {
    const normalizedPath = Buffer.from(file.relativePath.replaceAll('\\', '/'));
    hash.update(file.kind);
    hash.update('\0');
    hash.update(String(normalizedPath.length));
    hash.update('\0');
    hash.update(normalizedPath);
    hash.update('\0');
    hash.update(String(file.content.length));
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function skillDescription(skillMd: string): string {
  const match = skillMd.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return '';
  let document: unknown;
  try {
    document = parse(match[1]) as unknown;
  } catch {
    return '';
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) return '';
  const description = (document as Record<string, unknown>).description;
  return typeof description === 'string' ? description : '';
}

async function collectReferenceHashes(root: string): Promise<FoundSkillSource['references']> {
  const files = await collectOptionalHashFiles(root, 'reference');
  return files
    .filter((file) => file.kind === 'file')
    .map((file) => ({
      path: file.relativePath.replaceAll('\\', '/'),
      contentHash: createHash('sha256').update(file.content).digest('hex'),
    }))
    .sort((left, right) => compareText(left.path, right.path));
}

async function collectScripts(root: string): Promise<FoundSkillSource['scripts']> {
  const files = await collectOptionalHashFiles(root, 'scripts');
  return files
    .filter((file) => file.kind === 'file')
    .map((file) => ({
      path: file.relativePath.replaceAll('\\', '/'),
      sideEffect: 'unknown' as const,
    }))
    .sort((left, right) => compareText(left.path, right.path));
}

async function readSkillSource(
  name: string,
  searchRoot: SkillSearchRoot,
): Promise<FoundSkillSource | null> {
  const resolvedRoot = path.resolve(searchRoot.root);
  const candidatePath = path.resolve(resolvedRoot, name);
  if (!isInsideRoot(resolvedRoot, candidatePath)) return null;

  let realRoot: string;
  let skillMd: string;
  try {
    realRoot = await fs.realpath(candidatePath);
    if (searchRoot.origin !== 'explicit') {
      const realSearchRoot = await fs.realpath(resolvedRoot);
      if (!isInsideRoot(realSearchRoot, realRoot)) return null;
    }
    if (!(await fs.stat(realRoot)).isDirectory()) return null;
    skillMd = await fs.readFile(path.join(realRoot, 'SKILL.md'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  return {
    name,
    root: realRoot,
    origin: searchRoot.origin,
    ...(searchRoot.platform ? { platform: searchRoot.platform } : {}),
    description: skillDescription(skillMd),
    skillMd,
    references: await collectReferenceHashes(realRoot),
    scripts: await collectScripts(realRoot),
    hash: await hashSkillDirectory(realRoot),
  };
}

async function readExplicitSource(
  query: string,
  projectRoot: string,
): Promise<FoundSkillSource | null> {
  if (!looksLikePath(query)) return null;
  const absoluteTarget = path.isAbsolute(query)
    ? path.resolve(query)
    : path.resolve(projectRoot, query);
  if (!path.isAbsolute(query) && !isInsideRoot(projectRoot, absoluteTarget)) return null;
  return readSkillSource(path.basename(absoluteTarget), {
    root: path.dirname(absoluteTarget),
    origin: 'explicit',
  });
}

async function discoveredPreferenceEntries(
  roots: SkillSearchRoot[],
): Promise<SkillPreferenceEntry[]> {
  const names = new Set<string>();
  for (const root of roots) {
    for (const entry of await directoryEntries(root.root)) {
      if (entry.isDirectory() && validSkillName(entry.name)) names.add(entry.name);
    }
  }
  return [...names].sort(compareText).map((query, index) => ({ query, preferenceIndex: index }));
}

function dedupeSources(sources: FoundSkillSource[]): FoundSkillSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = process.platform === 'win32' ? source.root.toLocaleLowerCase('en-US') : source.root;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function findPreferredSkills(
  options: FindPreferredSkillsOptions,
): Promise<FoundSkill[]> {
  const projectRoot = path.resolve(options.projectRoot);
  const roots = searchRoots({
    projectRoot,
    homeDir: path.resolve(options.homeDir ?? os.homedir()),
    builtinRoot: path.resolve(options.builtinRoot ?? defaultBuiltinRoot()),
    extraRoots: options.extraRoots ?? [],
  });
  const preferences = options.preferences ?? null;
  const entries = preferences ?? (await discoveredPreferenceEntries(roots));
  const scannedMode = preferences === null;

  const result: FoundSkill[] = [];
  for (const entry of entries) {
    const explicit = await readExplicitSource(entry.query, projectRoot);
    const sources = explicit ? [explicit] : [];
    if (!explicit && validSkillName(entry.query)) {
      for (const root of roots) {
        const source = await readSkillSource(entry.query, root);
        if (source) sources.push(source);
      }
    }

    const uniqueSources = dedupeSources(sources);
    result.push({
      query: entry.query,
      preferenceIndex: scannedMode ? null : entry.preferenceIndex,
      status:
        uniqueSources.length === 0
          ? 'missing'
          : uniqueSources.length === 1
            ? 'available'
            : 'ambiguous',
      sources: uniqueSources,
    });
  }
  return result;
}
