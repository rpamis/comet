import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { ensureDir } from '../fs/file-system.js';

export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;

export type ProjectRegistrySource = 'init' | 'update' | 'repair';
export type ProjectRegistryErrorCode = 'invalid-json' | 'invalid-schema';

export interface ProjectRegistryTarget {
  platform: string;
  language: 'en' | 'zh';
}

export interface ProjectRegistryEntry {
  path: string;
  canonicalPath: string;
  addedAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastSource: ProjectRegistrySource;
  lastTargets: ProjectRegistryTarget[];
}

export interface ProjectRegistry {
  schemaVersion: typeof PROJECT_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  projects: ProjectRegistryEntry[];
}

export interface ProjectRegistryOptions {
  homeDir?: string;
  now?: Date;
  strict?: boolean;
}

export class ProjectRegistryError extends Error {
  constructor(
    public readonly code: ProjectRegistryErrorCode,
    message: string,
    public readonly registryPath: string,
  ) {
    super(message);
    this.name = 'ProjectRegistryError';
  }
}

function nowIso(options: ProjectRegistryOptions): string {
  return (options.now ?? new Date()).toISOString();
}

export function getProjectRegistryPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.comet', 'installations.json');
}

function emptyRegistry(updatedAt: string): ProjectRegistry {
  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    updatedAt,
    projects: [],
  };
}

function isMissingRegistryFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function registryFileExists(registryPath: string): Promise<boolean> {
  try {
    await fs.access(registryPath);
    return true;
  } catch (error) {
    if (isMissingRegistryFile(error)) return false;
    throw error;
  }
}

function canonicalKey(canonicalPath: string): string {
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

function isProjectRegistrySource(value: unknown): value is ProjectRegistrySource {
  return value === 'init' || value === 'update' || value === 'repair';
}

function isProjectRegistryTarget(value: unknown): value is ProjectRegistryTarget {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as ProjectRegistryTarget).platform === 'string' &&
    ((value as ProjectRegistryTarget).language === 'en' ||
      (value as ProjectRegistryTarget).language === 'zh')
  );
}

function assertProjectRegistry(value: unknown, registryPath: string): ProjectRegistry {
  if (!value || typeof value !== 'object') {
    throw new ProjectRegistryError(
      'invalid-schema',
      'Project registry must be a JSON object',
      registryPath,
    );
  }
  const candidate = value as { schemaVersion?: unknown; updatedAt?: unknown; projects?: unknown };
  if (candidate.schemaVersion !== PROJECT_REGISTRY_SCHEMA_VERSION) {
    throw new ProjectRegistryError(
      'invalid-schema',
      `Unsupported project registry schema version: ${String(candidate.schemaVersion)}`,
      registryPath,
    );
  }
  if (typeof candidate.updatedAt !== 'string' || !Array.isArray(candidate.projects)) {
    throw new ProjectRegistryError(
      'invalid-schema',
      'Project registry must contain updatedAt and projects',
      registryPath,
    );
  }

  const projects = candidate.projects.map((entry, index): ProjectRegistryEntry => {
    if (!entry || typeof entry !== 'object') {
      throw new ProjectRegistryError(
        'invalid-schema',
        `Project registry entry ${index} must be an object`,
        registryPath,
      );
    }
    const project = entry as Partial<ProjectRegistryEntry>;
    if (
      typeof project.path !== 'string' ||
      typeof project.canonicalPath !== 'string' ||
      typeof project.addedAt !== 'string' ||
      typeof project.updatedAt !== 'string' ||
      typeof project.lastSeenAt !== 'string' ||
      !isProjectRegistrySource(project.lastSource) ||
      !Array.isArray(project.lastTargets)
    ) {
      throw new ProjectRegistryError(
        'invalid-schema',
        `Project registry entry ${index} has invalid fields`,
        registryPath,
      );
    }

    return {
      path: project.path,
      canonicalPath: project.canonicalPath,
      addedAt: project.addedAt,
      updatedAt: project.updatedAt,
      lastSeenAt: project.lastSeenAt,
      lastSource: project.lastSource,
      lastTargets: project.lastTargets.map((target, targetIndex) => {
        if (!isProjectRegistryTarget(target)) {
          throw new ProjectRegistryError(
            'invalid-schema',
            `Project registry entry ${index} target ${targetIndex} has invalid fields`,
            registryPath,
          );
        }

        return {
          platform: target.platform,
          language: target.language,
        };
      }),
    };
  });

  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    updatedAt: candidate.updatedAt,
    projects,
  };
}

async function resolveProjectPath(projectPath: string): Promise<{
  path: string;
  canonicalPath: string;
}> {
  const resolved = path.resolve(projectPath);
  try {
    return {
      path: resolved,
      canonicalPath: await fs.realpath(resolved),
    };
  } catch {
    return {
      path: resolved,
      canonicalPath: resolved,
    };
  }
}

async function writeProjectRegistry(
  registry: ProjectRegistry,
  registryPath: string,
): Promise<void> {
  await ensureDir(path.dirname(registryPath));
  const temporary = path.join(path.dirname(registryPath), `installations.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
  await fs.rename(temporary, registryPath);
}

export async function readProjectRegistry(
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistry> {
  const registryPath = getProjectRegistryPath(options.homeDir);
  const updatedAt = nowIso(options);
  if (!(await registryFileExists(registryPath))) return emptyRegistry(updatedAt);

  let content: string;
  try {
    content = await fs.readFile(registryPath, 'utf-8');
  } catch (error) {
    if (isMissingRegistryFile(error)) return emptyRegistry(updatedAt);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    if (options.strict) {
      throw new ProjectRegistryError(
        'invalid-json',
        `Project registry is invalid JSON: ${(error as Error).message}`,
        registryPath,
      );
    }
    return emptyRegistry(updatedAt);
  }

  try {
    return assertProjectRegistry(parsed, registryPath);
  } catch (error) {
    if (options.strict) throw error;
    return emptyRegistry(updatedAt);
  }
}

export async function listProjectRegistryEntries(
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryEntry[]> {
  return (await readProjectRegistry(options)).projects;
}

export async function upsertProjectInstallation(
  projectPath: string,
  targets: ProjectRegistryTarget[],
  source: ProjectRegistrySource,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryEntry> {
  const registryPath = getProjectRegistryPath(options.homeDir);
  const timestamp = nowIso(options);
  const registry = await readProjectRegistry({ ...options, strict: false });
  const resolved = await resolveProjectPath(projectPath);
  const key = canonicalKey(resolved.canonicalPath);
  const existing = registry.projects.find((entry) => canonicalKey(entry.canonicalPath) === key);
  const entry: ProjectRegistryEntry = {
    path: resolved.path,
    canonicalPath: resolved.canonicalPath,
    addedAt: existing?.addedAt ?? timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    lastSource: source,
    lastTargets: targets,
  };
  const projects = registry.projects.filter(
    (project) => canonicalKey(project.canonicalPath) !== key,
  );
  projects.push(entry);
  projects.sort((left, right) => left.path.localeCompare(right.path));

  await writeProjectRegistry(
    {
      schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
      updatedAt: timestamp,
      projects,
    },
    registryPath,
  );

  return entry;
}

export async function removeProjectInstallation(
  projectPath: string,
  options: ProjectRegistryOptions = {},
): Promise<boolean> {
  const registryPath = getProjectRegistryPath(options.homeDir);
  const registry = await readProjectRegistry({ ...options, strict: false });
  const resolved = await resolveProjectPath(projectPath);
  const key = canonicalKey(resolved.canonicalPath);
  const projects = registry.projects.filter(
    (project) => canonicalKey(project.canonicalPath) !== key,
  );
  if (projects.length === registry.projects.length) return false;

  await writeProjectRegistry(
    {
      schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
      updatedAt: nowIso(options),
      projects,
    },
    registryPath,
  );
  return true;
}
