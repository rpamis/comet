# Comet Project Installation Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-level registry for project-scope Comet installs so interactive `comet update` and `comet uninstall` default to all indexed projects, while non-interactive calls stay current-project unless `--all-projects` is explicit.

**Architecture:** Add a focused registry module under `platform/install/` for user-level state. Keep installation truth in existing project target detection, and let `app/commands/update.ts` / `app/commands/uninstall.ts` orchestrate cross-project execution through small internal helpers. `init`, successful project updates, and successful project uninstalls keep the registry fresh.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing `@inquirer/prompts`, Vitest, existing Comet CLI command modules.

## Global Constraints

- 回复和 user-facing planning context 使用中文；代码和 changelog 保持现有英文风格。
- Registry 路径是 `~/.comet/installations.json`.
- Windows 路径比较对 `canonicalPath` 大小写不敏感。
- Registry 只记录 project-scope 安装，不记录 global-scope 安装。
- Registry 不是安装真相；执行前必须调用 `detectInstalledCometTargets(projectPath, { scopes: ['project'] })`.
- 交互模式检测到已有索引项目时，默认选择“所有已有索引项目”。
- JSON / force 等非交互路径不隐式跨项目；必须显式传 `--all-projects`.
- `--all-projects --current-project` 和 `--all-projects --scope global` 必须报参数冲突。
- `comet uninstall --all-projects` 使用项目级确认，不再逐 target 复选；单项目 uninstall 保留现有复选行为。
- 不全盘扫描，不新增后台进程，不改变 Classic runtime / workflow state。
- 实现完成后更新 `CHANGELOG.md`，是否升级版本号必须先比较 `origin/master` 的 `package.json` 版本。

---

## File Structure

- Create `platform/install/project-registry.ts`
  - Owns registry path calculation, schema parsing, path normalization, upsert, remove, atomic writes, and invalid-registry errors.
- Create `test/platform/project-registry.test.ts`
  - Covers registry read/write, dedupe, corrupt JSON, and path fallback behavior.
- Create `app/commands/project-scope-selection.ts`
  - Owns shared CLI option compatibility checks and interactive current/all project scope selection.
- Create `test/app/project-scope-selection.test.ts`
  - Covers option conflicts and interactive default behavior.
- Modify `app/commands/init.ts`
  - Records current project after project-scope Comet install or skip-existing detection.
- Modify `app/commands/update.ts`
  - Adds all/current project options, extracts single-project update runner, adds all-projects orchestration, and updates registry after project updates.
- Modify `app/commands/uninstall.ts`
  - Adds all/current project options, extracts single-project uninstall runner, adds all-projects orchestration, and removes/refreshes registry entries.
- Modify `app/cli/index.ts`
  - Adds `--all-projects` and `--current-project` to `update` and `uninstall`.
- Modify `app/commands/i18n.ts`
  - Adds update scope prompt strings for `en` and `zh`; uninstall remains English because the existing command has no language option.
- Modify `test/app/init-e2e.test.ts`
  - Verifies `initCommand` writes registry only for project scope.
- Modify `test/app/update.test.ts`
  - Verifies all-projects update JSON and conflict behavior.
- Modify `test/app/uninstall.test.ts`
  - Verifies all-projects uninstall JSON, stale cleanup, and single-project behavior stays intact.
- Modify `CHANGELOG.md`
  - Adds one user-facing Added entry under the active version after checking master version.

---

### Task 1: Project Installation Registry Module

**Files:**
- Create: `platform/install/project-registry.ts`
- Create: `test/platform/project-registry.test.ts`

**Interfaces:**
- Produces:
  - `PROJECT_REGISTRY_SCHEMA_VERSION: 1`
  - `type ProjectRegistrySource = 'init' | 'update' | 'repair'`
  - `interface ProjectRegistryTarget { platform: string; language: 'en' | 'zh' }`
  - `interface ProjectRegistryEntry`
  - `interface ProjectRegistry`
  - `class ProjectRegistryError extends Error`
  - `getProjectRegistryPath(homeDir?: string): string`
  - `readProjectRegistry(options?: ProjectRegistryOptions): Promise<ProjectRegistry>`
  - `listProjectRegistryEntries(options?: ProjectRegistryOptions): Promise<ProjectRegistryEntry[]>`
  - `upsertProjectInstallation(projectPath: string, targets: ProjectRegistryTarget[], source: ProjectRegistrySource, options?: ProjectRegistryOptions): Promise<ProjectRegistryEntry>`
  - `removeProjectInstallation(projectPath: string, options?: ProjectRegistryOptions): Promise<boolean>`

- Consumes:
  - `platform/fs/file-system.ts` helpers `ensureDir`, `fileExists`.
  - Node `fs/promises`, `path`, `os`, `crypto.randomUUID`.

- Later tasks rely on:
  - `upsertProjectInstallation()` accepting already-resolved project paths.
  - `readProjectRegistry({ strict: true })` throwing `ProjectRegistryError` on corrupt registry.
  - `upsertProjectInstallation()` rebuilding a corrupt single-project registry from the current project only.

- [x] **Step 1: Write failing registry tests**

Add `test/platform/project-registry.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  ProjectRegistryError,
  getProjectRegistryPath,
  listProjectRegistryEntries,
  readProjectRegistry,
  removeProjectInstallation,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';

describe('project installation registry', () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-project-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    homeDir = path.join(tmpDir, 'home');
    await fs.mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty registry when the file does not exist', async () => {
    await expect(readProjectRegistry({ homeDir })).resolves.toMatchObject({
      schemaVersion: 1,
      projects: [],
    });
  });

  it('upserts a project and preserves addedAt on later writes', async () => {
    const projectDir = path.join(tmpDir, 'Project');
    await fs.mkdir(projectDir, { recursive: true });

    const first = await upsertProjectInstallation(
      projectDir,
      [{ platform: 'claude', language: 'en' }],
      'init',
      { homeDir, now: new Date('2026-07-10T00:00:00.000Z') },
    );

    const second = await upsertProjectInstallation(
      projectDir,
      [{ platform: 'codex', language: 'zh' }],
      'update',
      { homeDir, now: new Date('2026-07-10T01:00:00.000Z') },
    );

    expect(second.addedAt).toBe(first.addedAt);
    expect(second.updatedAt).toBe('2026-07-10T01:00:00.000Z');
    expect(second.lastTargets).toEqual([{ platform: 'codex', language: 'zh' }]);

    const registry = await readProjectRegistry({ homeDir });
    expect(registry.projects).toHaveLength(1);
  });

  it('deduplicates paths through the canonical path key', async () => {
    const projectDir = path.join(tmpDir, 'Project');
    await fs.mkdir(projectDir, { recursive: true });

    await upsertProjectInstallation(projectDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir,
    });
    await upsertProjectInstallation(path.join(projectDir, '.'), [], 'update', { homeDir });

    await expect(listProjectRegistryEntries({ homeDir })).resolves.toHaveLength(1);
  });

  it('falls back to the resolved path when the project path does not exist', async () => {
    const missingProject = path.join(tmpDir, 'missing-project');

    const entry = await upsertProjectInstallation(
      missingProject,
      [{ platform: 'claude', language: 'en' }],
      'repair',
      { homeDir },
    );

    expect(entry.path).toBe(path.resolve(missingProject));
    expect(entry.canonicalPath).toBe(path.resolve(missingProject));
  });

  it('removes a project from the registry', async () => {
    const projectDir = path.join(tmpDir, 'Project');
    await fs.mkdir(projectDir, { recursive: true });
    await upsertProjectInstallation(projectDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir,
    });

    await expect(removeProjectInstallation(projectDir, { homeDir })).resolves.toBe(true);
    await expect(listProjectRegistryEntries({ homeDir })).resolves.toEqual([]);
  });

  it('throws a ProjectRegistryError for corrupt JSON in strict mode', async () => {
    const registryPath = getProjectRegistryPath(homeDir);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, '{not-json', 'utf-8');

    await expect(readProjectRegistry({ homeDir, strict: true })).rejects.toMatchObject({
      code: 'invalid-json',
    } satisfies Partial<ProjectRegistryError>);
  });

  it('rebuilds corrupt registry during single-project upsert', async () => {
    const registryPath = getProjectRegistryPath(homeDir);
    const projectDir = path.join(tmpDir, 'Project');
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(registryPath, '{not-json', 'utf-8');

    await upsertProjectInstallation(projectDir, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir,
    });

    const registry = await readProjectRegistry({ homeDir, strict: true });
    expect(registry.projects.map((project) => project.path)).toEqual([path.resolve(projectDir)]);
  });

  it('uses case-insensitive keys on Windows', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const projectDir = path.join(tmpDir, 'CaseProject');
      await fs.mkdir(projectDir, { recursive: true });
      await upsertProjectInstallation(projectDir, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir,
      });
      await upsertProjectInstallation(projectDir.toUpperCase(), [], 'update', { homeDir });

      await expect(listProjectRegistryEntries({ homeDir })).resolves.toHaveLength(1);
    } finally {
      platformSpy.mockRestore();
    }
  });
});
```

- [x] **Step 2: Run the registry test and confirm it fails**

Run:

```bash
npx vitest run test/platform/project-registry.test.ts
```

Expected:

```text
FAIL test/platform/project-registry.test.ts
Cannot find module '../../platform/install/project-registry.js'
```

- [x] **Step 3: Implement the registry module**

Create `platform/install/project-registry.ts`:

```ts
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { ensureDir, fileExists } from '../fs/file-system.js';

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

function canonicalKey(canonicalPath: string): string {
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

function assertProjectRegistry(value: unknown, registryPath: string): ProjectRegistry {
  if (!value || typeof value !== 'object') {
    throw new ProjectRegistryError('invalid-schema', 'Project registry must be a JSON object', registryPath);
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
      !['init', 'update', 'repair'].includes(String(project.lastSource)) ||
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
      lastTargets: project.lastTargets.filter(
        (target): target is ProjectRegistryTarget =>
          Boolean(target) &&
          typeof target === 'object' &&
          typeof (target as ProjectRegistryTarget).platform === 'string' &&
          ((target as ProjectRegistryTarget).language === 'en' ||
            (target as ProjectRegistryTarget).language === 'zh'),
      ),
    };
  });

  return {
    schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
    updatedAt: candidate.updatedAt,
    projects,
  };
}

async function resolveProjectPath(projectPath: string): Promise<{ path: string; canonicalPath: string }> {
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

async function writeProjectRegistry(registry: ProjectRegistry, registryPath: string): Promise<void> {
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
  if (!(await fileExists(registryPath))) return emptyRegistry(updatedAt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(registryPath, 'utf-8'));
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
  const projects = registry.projects.filter((project) => canonicalKey(project.canonicalPath) !== key);
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
  const projects = registry.projects.filter((project) => canonicalKey(project.canonicalPath) !== key);
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
```

- [x] **Step 4: Run registry tests and fix only local issues**

Run:

```bash
npx vitest run test/platform/project-registry.test.ts
```

Expected:

```text
PASS test/platform/project-registry.test.ts
```

- [x] **Step 5: Commit registry module**

```bash
git add platform/install/project-registry.ts test/platform/project-registry.test.ts
git commit -m "feat: add project installation registry"
```

---

### Task 2: Shared Project Scope Selection Helper

**Files:**
- Create: `app/commands/project-scope-selection.ts`
- Create: `test/app/project-scope-selection.test.ts`

**Interfaces:**
- Consumes:
  - `InstallScope` from `platform/install/types.ts`.
  - `select` from `@inquirer/prompts`.
- Produces:
  - `type ProjectScopeMode = 'current-project' | 'all-projects'`
  - `interface ProjectScopeOptions`
  - `assertProjectScopeOptions(options: ProjectScopeOptions): void`
  - `resolveProjectScopeMode(command: 'update' | 'uninstall', options: ProjectScopeOptions, indexedProjectCount: number): Promise<ProjectScopeMode>`

- Later tasks rely on:
  - `resolveProjectScopeMode()` returning `current-project` for JSON mode unless `allProjects` is true.
  - Interactive choices listing all projects first so it is the default selection.

- [x] **Step 1: Write failing helper tests**

Add `test/app/project-scope-selection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { select } from '@inquirer/prompts';

import {
  assertProjectScopeOptions,
  resolveProjectScopeMode,
} from '../../app/commands/project-scope-selection.js';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue('all-projects'),
}));

const mockedSelect = vi.mocked(select);

describe('project scope selection', () => {
  beforeEach(() => {
    mockedSelect.mockReset();
    mockedSelect.mockResolvedValue('all-projects' as never);
  });

  it('rejects conflicting all/current project flags', () => {
    expect(() => assertProjectScopeOptions({ allProjects: true, currentProject: true })).toThrow(
      '--all-projects cannot be combined with --current-project',
    );
  });

  it('rejects all projects with global scope', () => {
    expect(() => assertProjectScopeOptions({ allProjects: true, scope: 'global' })).toThrow(
      '--all-projects cannot be combined with --scope global',
    );
  });

  it('returns all-projects when the explicit flag is passed', async () => {
    await expect(resolveProjectScopeMode('update', { allProjects: true }, 0)).resolves.toBe(
      'all-projects',
    );
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('returns current-project for JSON mode unless all-projects is explicit', async () => {
    await expect(resolveProjectScopeMode('update', { json: true }, 3)).resolves.toBe(
      'current-project',
    );
    expect(mockedSelect).not.toHaveBeenCalled();
  });

  it('prompts interactively with all indexed projects first', async () => {
    await expect(resolveProjectScopeMode('uninstall', {}, 2)).resolves.toBe('all-projects');

    expect(mockedSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Uninstall scope:',
        choices: [
          { name: 'All indexed projects', value: 'all-projects' },
          { name: 'Current project only', value: 'current-project' },
        ],
      }),
    );
  });

  it('does not prompt when there are no indexed projects', async () => {
    await expect(resolveProjectScopeMode('update', {}, 0)).resolves.toBe('current-project');
    expect(mockedSelect).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the helper test and confirm it fails**

Run:

```bash
npx vitest run test/app/project-scope-selection.test.ts
```

Expected:

```text
FAIL test/app/project-scope-selection.test.ts
Cannot find module '../../app/commands/project-scope-selection.js'
```

- [x] **Step 3: Implement the selection helper**

Create `app/commands/project-scope-selection.ts`:

```ts
import { select } from '@inquirer/prompts';

import type { InstallScope } from '../../platform/install/types.js';

export type ProjectScopeMode = 'current-project' | 'all-projects';
export type ProjectScopeCommand = 'update' | 'uninstall';

export interface ProjectScopeOptions {
  allProjects?: boolean;
  currentProject?: boolean;
  json?: boolean;
  scope?: InstallScope;
}

export function assertProjectScopeOptions(options: ProjectScopeOptions): void {
  if (options.allProjects && options.currentProject) {
    throw new Error('--all-projects cannot be combined with --current-project');
  }
  if (options.allProjects && options.scope === 'global') {
    throw new Error('--all-projects cannot be combined with --scope global');
  }
}

function commandLabel(command: ProjectScopeCommand): string {
  return command === 'update' ? 'Update' : 'Uninstall';
}

export async function resolveProjectScopeMode(
  command: ProjectScopeCommand,
  options: ProjectScopeOptions,
  indexedProjectCount: number,
): Promise<ProjectScopeMode> {
  assertProjectScopeOptions(options);

  if (options.allProjects) return 'all-projects';
  if (options.currentProject) return 'current-project';
  if (options.json) return 'current-project';
  if (indexedProjectCount === 0) return 'current-project';

  return select<ProjectScopeMode>({
    message: `${commandLabel(command)} scope:`,
    choices: [
      { name: 'All indexed projects', value: 'all-projects' },
      { name: 'Current project only', value: 'current-project' },
    ],
  });
}
```

- [x] **Step 4: Run helper tests and fix only local issues**

Run:

```bash
npx vitest run test/app/project-scope-selection.test.ts
```

Expected:

```text
PASS test/app/project-scope-selection.test.ts
```

- [x] **Step 5: Commit selection helper**

```bash
git add app/commands/project-scope-selection.ts test/app/project-scope-selection.test.ts
git commit -m "feat: add project scope selection helper"
```

---

### Task 3: Init Writes Project Registry

**Files:**
- Modify: `app/commands/init.ts`
- Modify: `test/app/init-e2e.test.ts`

**Interfaces:**
- Consumes:
  - `upsertProjectInstallation()` from Task 1.
  - `detectInstalledCometTargets()` exported by `app/commands/update.ts`.
- Produces:
  - Project-scope `initCommand()` refreshes registry after `createWorkingDirs()`.
  - Global-scope `initCommand()` leaves project registry untouched.

- [x] **Step 1: Write failing init registry tests**

Append tests near existing `comet init E2E` cases in `test/app/init-e2e.test.ts`:

```ts
import { getProjectRegistryPath } from '../../platform/install/project-registry.js';
```

Add tests:

```ts
it('records project-scope Comet installs in the user project registry', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home');
  await fs.mkdir(fakeHome, { recursive: true });
  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

  try {
    const { initCommand } = await import('../../app/commands/init.js');
    await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'project', json: true, language: 'en' }),
    );
  } finally {
    homedirSpy.mockRestore();
  }

  const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8'));
  expect(registry.projects).toHaveLength(1);
  expect(registry.projects[0]).toMatchObject({
    path: path.resolve(tmpDir),
    lastSource: 'init',
  });
  expect(registry.projects[0].lastTargets.length).toBeGreaterThan(0);
});

it('does not record global-scope installs in the user project registry', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home-global');
  await fs.mkdir(fakeHome, { recursive: true });
  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);

  try {
    const { initCommand } = await import('../../app/commands/init.js');
    await captureJsonOutput(() =>
      initCommand(tmpDir, { yes: true, scope: 'global', json: true, language: 'en' }),
    );
  } finally {
    homedirSpy.mockRestore();
  }

  await expect(fs.access(getProjectRegistryPath(fakeHome))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
```

- [x] **Step 2: Run the focused init tests and confirm they fail**

Run:

```bash
npx vitest run test/app/init-e2e.test.ts -t "project registry"
```

Expected:

```text
FAIL test/app/init-e2e.test.ts
ENOENT: no such file or directory, open '<fake-home>/.comet/installations.json'
```

- [x] **Step 3: Implement registry recording in init**

Modify imports in `app/commands/init.ts`:

```ts
import { upsertProjectInstallation } from '../../platform/install/project-registry.js';
import { detectInstalledCometTargets } from './update.js';
```

Add this block after `createWorkingDirs(projectPath, language.artifactLanguage)`:

```ts
  if (scope === 'project') {
    const projectTargets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
    if (projectTargets.length > 0) {
      await upsertProjectInstallation(
        projectPath,
        projectTargets.map((target) => ({
          platform: target.platform.id,
          language: target.language,
        })),
        'init',
      );
    }
  }
```

The final section should read:

```ts
  if (scope === 'project') {
    await createWorkingDirs(projectPath, language.artifactLanguage);
    const projectTargets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
    if (projectTargets.length > 0) {
      await upsertProjectInstallation(
        projectPath,
        projectTargets.map((target) => ({
          platform: target.platform.id,
          language: target.language,
        })),
        'init',
      );
    }
  }
```

- [x] **Step 4: Run focused init tests**

Run:

```bash
npx vitest run test/app/init-e2e.test.ts -t "project registry"
```

Expected:

```text
PASS test/app/init-e2e.test.ts
```

- [x] **Step 5: Run full init E2E tests**

Run:

```bash
npx vitest run test/app/init-e2e.test.ts
```

Expected:

```text
PASS test/app/init-e2e.test.ts
```

- [x] **Step 6: Commit init integration**

```bash
git add app/commands/init.ts test/app/init-e2e.test.ts
git commit -m "feat: record project installs during init"
```

---

### Task 4: Update All Indexed Projects

**Files:**
- Modify: `app/commands/update.ts`
- Modify: `app/cli/index.ts`
- Modify: `app/commands/i18n.ts`
- Modify: `test/app/update.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 registry functions.
  - Task 2 `resolveProjectScopeMode()`.
  - Existing `detectInstalledCometTargets()`.
- Produces:
  - `UpdateOptions` includes `allProjects?: boolean` and `currentProject?: boolean`.
  - `updateCommand()` emits current JSON for normal current-project mode.
  - `updateCommand(..., { allProjects: true, json: true })` emits `{ mode: 'all-projects', registry, projects }`.
  - Successful project updates upsert registry entries with source `update`.

- [x] **Step 1: Write failing all-projects update tests**

In `test/app/update.test.ts`, add imports:

```ts
import { getProjectRegistryPath, upsertProjectInstallation } from '../../platform/install/project-registry.js';
```

Add tests inside `describe('update command helpers', ...)`:

```ts
it('updates all indexed project-scope installs when --all-projects is explicit in JSON mode', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home');
  const projectA = path.join(tmpDir, 'project-a');
  const projectB = path.join(tmpDir, 'project-b');
  await fs.mkdir(fakeHome, { recursive: true });

  for (const project of [projectA, projectB]) {
    await fs.mkdir(path.join(project, '.claude', 'skills', 'comet'), { recursive: true });
    await fs.writeFile(path.join(project, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet', 'utf-8');
    await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
  }

  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let json = '';
  try {
    await updateCommand(projectA, { json: true, skipNpm: true, allProjects: true });
    json = log.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
    homedirSpy.mockRestore();
  }

  const result = JSON.parse(json);
  expect(result.mode).toBe('all-projects');
  expect(result.registry.projectsFound).toBe(2);
  expect(result.projects.map((project: { projectPath: string }) => project.projectPath).sort()).toEqual(
    [path.resolve(projectA), path.resolve(projectB)].sort(),
  );
  expect(result.projects.every((project: { status: string }) => project.status === 'updated')).toBe(true);
});

it('rejects --all-projects with --scope global during update', async () => {
  await expect(
    updateCommand(tmpDir, { json: true, skipNpm: true, allProjects: true, scope: 'global' }),
  ).rejects.toThrow('--all-projects cannot be combined with --scope global');
});

it('keeps JSON update current-project by default even when registry has projects', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home-current');
  const projectA = path.join(tmpDir, 'project-current');
  await fs.mkdir(path.join(projectA, '.claude', 'skills', 'comet'), { recursive: true });
  await fs.writeFile(path.join(projectA, '.claude', 'skills', 'comet', 'SKILL.md'), '# Comet', 'utf-8');
  await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
    homeDir: fakeHome,
  });

  const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let json = '';
  try {
    await updateCommand(projectA, { json: true, skipNpm: true });
    json = log.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    log.mockRestore();
    homedirSpy.mockRestore();
  }

  const result = JSON.parse(json);
  expect(result.mode).toBeUndefined();
  expect(result.skills.targets).toHaveLength(1);
});
```

- [x] **Step 2: Run focused update tests and confirm failure**

Run:

```bash
npx vitest run test/app/update.test.ts -t "all indexed|all-projects|current-project"
```

Expected:

```text
FAIL test/app/update.test.ts
Object literal may only specify known properties, and 'allProjects' does not exist
```

- [x] **Step 3: Add update CLI options**

Modify `app/cli/index.ts` update command:

```ts
  .option('--all-projects', 'Update all indexed project-scope Comet installs')
  .option('--current-project', 'Update only the current project')
```

Place them before `.addOption(new Option('--skip-npm', ...))`.

- [x] **Step 4: Refactor update into a single-project runner**

In `app/commands/update.ts`, extend options:

```ts
interface UpdateOptions {
  json?: boolean;
  language?: string;
  scope?: InstallScope;
  skipNpm?: boolean;
  installMode?: InstallMode;
  allProjects?: boolean;
  currentProject?: boolean;
}
```

Add result interfaces near `InstalledCometTarget`:

```ts
type NpmStatus = 'updated' | 'failed' | 'skipped';
type CodegraphStatus = 'installed' | 'failed' | 'skipped';

interface SingleProjectUpdateResult {
  projectPath: string;
  npm: {
    scope: InstallScope | 'skipped';
    status: NpmStatus;
    command: string | null;
  };
  skills: {
    totalCopied: number;
    installMode?: InstallMode;
    targets: Array<{
      scope: InstallScope;
      platform: string;
      platformName: string;
      language: SkillLanguage;
      source: string;
      copied: number;
      skipped: number;
      command: string;
    }>;
  };
  rules: { totalCopied: number };
  hooks: { totalInstalled: number };
  projectInstructions: { updated: number };
  codegraph: CodegraphStatus;
}
```

Create helper:

```ts
async function updateSingleProject(
  projectPath: string,
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<SingleProjectUpdateResult | null> {
  const lang = options.language ?? 'en';
  const packageScope = options.scope ?? (await detectCometPackageScope(projectPath));
  let npmStatus: NpmStatus = 'skipped';

  if (!options.skipNpm) {
    log(`  ${t(lang, 'updatingNpmPackage')} (${packageScope} scope)...`);
    log(`    $ ${formatNpmUpdateCommand(packageScope)}`);
    npmStatus = (await updateCometNpmPackage(packageScope, projectPath, log, options.json === true))
      ? 'updated'
      : 'failed';
    log(
      npmStatus === 'updated'
        ? `  ${t(lang, 'npmPackageUpdated')} ${PACKAGE_NAME}`
        : `  ${t(lang, 'npmPackageFailed')}`,
    );
  }

  const installMode = await selectInstallMode(options, lang);
  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) return null;

  log(`\n  ${t(lang, 'updatingSkillsOnTargets')} ${targets.length} target(s):`);
  for (const target of targets) {
    const language = options.language ?? target.language;
    const scopeLabel = target.scope === 'global' ? 'global' : `project (${projectPath})`;
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    log(`    - ${target.platform.name} (${scopeLabel}, ${language})`);
    log(
      `      $ ${formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir, installMode)}`,
    );
  }

  log(`\n  ${t(lang, 'copyingSkillsFiles')} ${(await getManifestSkills()).length} skill files...\n`);

  let totalCopied = 0;
  let totalRulesCopied = 0;
  let totalHooksInstalled = 0;
  let projectInstructionsUpdated = 0;
  const targetResults: SingleProjectUpdateResult['skills']['targets'] = [];

  for (const target of targets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const languageId = resolveTargetLanguage(options.language, target.language);
    const languageSkillsDir = languageToSkillsDir(languageId);
    const { copied, skipped } = await copyCometSkillsForPlatform(
      baseDir,
      target.platform,
      true,
      languageSkillsDir,
      target.scope,
      installMode,
    );
    totalCopied += copied;
    targetResults.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      language: options.language === 'zh' ? 'zh' : target.language,
      source: languageSkillsDir,
      copied,
      skipped,
      command: formatSkillUpdateCommand(target.scope, target.platform, languageSkillsDir, installMode),
    });
    log(
      `  ${target.platform.name} (${target.scope}, ${languageSkillsDir}): ${copied} ${t(lang, 'skillsCopiedSkipped')} ${skipped} skipped`,
    );

    try {
      const { copied: ruleCopied } = await copyCometRulesForPlatform(
        baseDir,
        target.platform,
        true,
        languageId,
        target.scope,
      );
      totalRulesCopied += ruleCopied;
      if (ruleCopied > 0) {
        log(`  Comet rules -> ${target.platform.name}: ${ruleCopied} ${t(lang, 'rulesUpdated')}`);
      }
    } catch (err) {
      log(`  Comet rules -> ${target.platform.name}: ${t(lang, 'rulesFailed')} (${(err as Error).message})`);
    }

    if (target.platform.supportsHooks) {
      try {
        const { installed, reason } = await installCometHooksForPlatform(
          baseDir,
          target.platform,
          target.scope,
        );
        if (installed) {
          totalHooksInstalled++;
          log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksUpdated')}`);
        } else if (reason) {
          log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksSkipped')} (${reason})`);
        }
      } catch (err) {
        log(`  Comet hooks -> ${target.platform.name}: ${t(lang, 'hooksFailed')} (${(err as Error).message})`);
      }
    }
  }

  const hasProjectTargets = targets.some((target) => target.scope === 'project');
  if (hasProjectTargets) {
    await mergeProjectConfig(projectPath);
    const projectTarget = targets.find((target) => target.scope === 'project');
    const projectLanguageId = resolveTargetLanguage(options.language, projectTarget?.language ?? 'en');
    const projectInstructionResult = await installCometProjectInstructions(projectPath, projectLanguageId);
    projectInstructionsUpdated = projectInstructionResult.changed;
    if (projectInstructionsUpdated > 0) {
      log(`  Comet project instructions -> ${projectInstructionsUpdated} file(s) updated`);
    }
    log(`  ${t(lang, 'configMerged')}`);
  }

  let codegraphStatus: CodegraphStatus = 'skipped';
  const primaryScope = targets[0]?.scope ?? 'project';
  const codegraphAlreadyIndexed = hasCodegraphProjectIndex(projectPath);
  if (options.json) {
    codegraphStatus = 'skipped';
  } else if (codegraphAlreadyIndexed) {
    log('\n  CodeGraph: skipped (existing .codegraph index detected)');
  } else {
    const shouldInstallCodegraph = options.skipNpm ? false : await promptCodegraphInstall(lang);
    if (shouldInstallCodegraph) {
      log(`\n  ${t(lang, 'installingCG')}`);
      codegraphStatus = await installCodegraph(projectPath, primaryScope, true);
      log(`  CodeGraph: ${codegraphStatus}`);
    } else {
      log(`\n  CodeGraph: ${t(lang, 'cgSkippedByUser')}`);
    }
  }

  return {
    projectPath,
    npm: {
      scope: options.skipNpm ? 'skipped' : packageScope,
      status: npmStatus,
      command: options.skipNpm ? null : formatNpmUpdateCommand(packageScope),
    },
    skills: {
      totalCopied,
      installMode,
      targets: targetResults,
    },
    rules: { totalCopied: totalRulesCopied },
    hooks: { totalInstalled: totalHooksInstalled },
    projectInstructions: { updated: projectInstructionsUpdated },
    codegraph: codegraphStatus,
  };
}
```

Then reduce the existing current-project body of `updateCommand()` to call this helper and preserve old JSON shape:

```ts
  const result = await updateSingleProject(projectPath, options, log);
  if (!result) {
    if (options.json) {
      console.log(JSON.stringify(emptyUpdateJson(options, packageScope, npmStatus), null, 2));
      return;
    }
    log(`\n  ${t(lang, 'noInstallsFound')}\n`);
    return;
  }
```

When implementing, keep the old no-target JSON shape exactly. If the helper makes that awkward, create `emptySingleProjectUpdateResult()` and serialize it to the old shape.

- [x] **Step 5: Add all-projects orchestration in update**

Add imports:

```ts
import {
  listProjectRegistryEntries,
  removeProjectInstallation,
  upsertProjectInstallation
} from '../../platform/install/project-registry.js';
import { resolveProjectScopeMode } from './project-scope-selection.js';
```

Add helper:

```ts
async function updateAllIndexedProjects(
  options: UpdateOptions,
  log: (message: string) => void,
): Promise<void> {
  const registryProjects = await listProjectRegistryEntries({ strict: true });
  const results = [];
  const runnableProjects = [];
  let staleRemoved = 0;

  for (const project of registryProjects) {
    const projectPath = project.path;
    try {
      const targets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
      if (targets.length === 0) {
        if (await removeProjectInstallation(projectPath)) staleRemoved++;
        results.push({
          projectPath,
          status: 'skipped',
          reason: 'no project-scope Comet install detected',
          targets: [],
        });
        continue;
      }
      runnableProjects.push({ projectPath, targets });
    } catch (error) {
      results.push({
        projectPath,
        status: 'skipped',
        reason: `unable to inspect project: ${(error as Error).message}`,
        targets: [],
      });
    }
  }

  if (!options.json) {
    log(`  Comet will update ${runnableProjects.length} indexed project(s):`);
    for (const project of runnableProjects) {
      log(`    - ${project.projectPath}`);
      log(`      ${project.targets.map((target) => target.platform.name).join(', ')}`);
    }
    const confirmed = await select({
      message: 'Proceed with updating all indexed projects?',
      choices: [
        { name: 'Yes, update all indexed projects', value: true },
        { name: 'No, cancel', value: false },
      ],
    });
    if (!confirmed) {
      log('\n  Cancelled.\n');
      return;
    }
  }

  for (const project of runnableProjects) {
    const { projectPath, targets } = project;
    try {
      const result = await updateSingleProject(
        projectPath,
        { ...options, scope: 'project', currentProject: true, allProjects: false },
        log,
      );

      if (!result) {
        results.push({
          projectPath,
          status: 'skipped',
          reason: 'no project-scope Comet install detected',
          targets: [],
        });
        continue;
      }

      await upsertProjectInstallation(
        projectPath,
        targets.map((target) => ({ platform: target.platform.id, language: target.language })),
        'update',
      );
      results.push({
        projectPath,
        status: 'updated',
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
        summary: {
          skillsCopied: result.skills.totalCopied,
          rulesCopied: result.rules.totalCopied,
          hooksInstalled: result.hooks.totalInstalled,
          projectInstructionsUpdated: result.projectInstructions.updated,
        },
      });
    } catch (error) {
      results.push({
        projectPath,
        status: 'failed',
        reason: (error as Error).message,
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
      });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'all-projects',
          registry: {
            projectsFound: registryProjects.length,
            staleRemoved,
          },
          projects: results,
        },
        null,
        2,
      ),
    );
    return;
  }

  log(`\n  Updated ${results.filter((result) => result.status === 'updated').length} indexed project(s).`);
}
```

At the top of `updateCommand()` after computing `projectPath`, call:

```ts
  const registryProjects = await listProjectRegistryEntries({ strict: options.allProjects === true });
  const scopeMode = await resolveProjectScopeMode('update', options, registryProjects.length);
  if (scopeMode === 'all-projects') {
    await updateAllIndexedProjects(options, log);
    return;
  }
```

Do not pass `--scope global` into `updateAllIndexedProjects`; Task 2 helper rejects that combination before execution.

- [x] **Step 6: Run focused update tests**

Run:

```bash
npx vitest run test/app/project-scope-selection.test.ts test/app/update.test.ts
```

Expected:

```text
PASS test/app/project-scope-selection.test.ts
PASS test/app/update.test.ts
```

- [x] **Step 7: Commit update integration**

```bash
git add app/cli/index.ts app/commands/update.ts app/commands/i18n.ts test/app/update.test.ts
git commit -m "feat: update all indexed projects"
```

---

### Task 5: Uninstall All Indexed Projects

**Files:**
- Modify: `app/commands/uninstall.ts`
- Modify: `app/cli/index.ts`
- Modify: `test/app/uninstall.test.ts`

**Interfaces:**
- Consumes:
  - Task 1 registry functions.
  - Task 2 `resolveProjectScopeMode()`.
  - Existing removal helpers from `domains/skill/uninstall.ts`.
- Produces:
  - `UninstallOptions` includes `allProjects?: boolean` and `currentProject?: boolean`.
  - `uninstallCommand(..., { allProjects: true, force: true, json: true })` emits `{ mode: 'all-projects', registry, projects }`.
  - All-projects uninstall removes registry entries when no project-scope targets remain.

- [x] **Step 1: Write failing all-projects uninstall tests**

In `test/app/uninstall.test.ts`, add imports:

```ts
import { getProjectRegistryPath, upsertProjectInstallation } from '../../platform/install/project-registry.js';
```

Add tests inside `describe('uninstallCommand interactive selection', ...)`:

```ts
it('uninstalls all indexed projects with --all-projects --force --json', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home-all-uninstall');
  const projectA = path.join(tmpDir, 'project-a');
  const projectB = path.join(tmpDir, 'project-b');
  const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

  for (const project of [projectA, projectB]) {
    await copyCometSkillsForPlatform(project, claudePlatform, true, 'skills', 'project');
    await upsertProjectInstallation(project, [{ platform: 'claude', language: 'en' }], 'init', {
      homeDir: fakeHome,
    });
  }

  homedirSpy.mockRestore();
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let jsonOutput = '';
  try {
    await uninstallCommand(projectA, { allProjects: true, force: true, json: true });
    jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }

  const result = JSON.parse(jsonOutput);
  expect(result.mode).toBe('all-projects');
  expect(result.projects.every((project: { status: string }) => project.status === 'uninstalled')).toBe(
    true,
  );
  await expect(fs.access(path.join(projectA, '.claude', 'skills', 'comet'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await expect(fs.access(path.join(projectB, '.claude', 'skills', 'comet'))).rejects.toMatchObject({
    code: 'ENOENT',
  });

  const registry = JSON.parse(await fs.readFile(getProjectRegistryPath(fakeHome), 'utf-8'));
  expect(registry.projects).toEqual([]);
});

it('rejects --all-projects with --scope global during uninstall', async () => {
  await expect(
    uninstallCommand(tmpDir, { allProjects: true, scope: 'global', json: true, force: true }),
  ).rejects.toThrow('--all-projects cannot be combined with --scope global');
});

it('keeps JSON uninstall current-project by default when registry has projects', async () => {
  const fakeHome = path.join(tmpDir, 'fake-home-current-uninstall');
  const projectA = path.join(tmpDir, 'project-current-uninstall');
  const projectB = path.join(tmpDir, 'project-other-uninstall');
  const claudePlatform = PLATFORMS.find((p) => p.id === 'claude')!;

  await copyCometSkillsForPlatform(projectA, claudePlatform, true, 'skills', 'project');
  await copyCometSkillsForPlatform(projectB, claudePlatform, true, 'skills', 'project');
  await upsertProjectInstallation(projectA, [{ platform: 'claude', language: 'en' }], 'init', {
    homeDir: fakeHome,
  });
  await upsertProjectInstallation(projectB, [{ platform: 'claude', language: 'en' }], 'init', {
    homeDir: fakeHome,
  });

  homedirSpy.mockRestore();
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  let jsonOutput = '';
  try {
    await uninstallCommand(projectA, { json: true, force: true });
    jsonOutput = log.mock.calls.map((c) => c.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }

  const result = JSON.parse(jsonOutput);
  expect(result.mode).toBeUndefined();
  expect(await fileExists(path.join(projectB, '.claude', 'skills', 'comet'))).toBe(true);
});
```

- [x] **Step 2: Run focused uninstall tests and confirm failure**

Run:

```bash
npx vitest run test/app/uninstall.test.ts -t "all indexed|all-projects|current-project"
```

Expected:

```text
FAIL test/app/uninstall.test.ts
Object literal may only specify known properties, and 'allProjects' does not exist
```

- [x] **Step 3: Add uninstall CLI options**

Modify `app/cli/index.ts` uninstall command:

```ts
  .option('--all-projects', 'Uninstall all indexed project-scope Comet installs')
  .option('--current-project', 'Uninstall only the current project')
```

Place them before `.option('--force', ...)`.

- [x] **Step 4: Extract single-project uninstall helper**

In `app/commands/uninstall.ts`, extend options:

```ts
interface UninstallOptions {
  json?: boolean;
  scope?: InstallScope;
  force?: boolean;
  allProjects?: boolean;
  currentProject?: boolean;
}
```

Add:

```ts
interface SingleProjectUninstallResult {
  projectPath: string;
  targets: TargetUninstallResult[];
  workingDirsRemoved: number;
  projectInstructionsRemoved: number;
  summary: {
    targetsProcessed: number;
    totalSkillsRemoved: number;
    totalRulesRemoved: number;
    totalHooksRemoved: number;
  };
}
```

Move existing body after target detection into:

```ts
async function uninstallSingleProject(
  projectPath: string,
  options: UninstallOptions,
  log: (message: string) => void,
): Promise<SingleProjectUninstallResult | null> {
  const targets = await detectInstalledCometTargets(projectPath, {
    scopes: options.scope ? [options.scope] : undefined,
  });

  if (targets.length === 0) return null;

  const scopeLabel = (scope: InstallScope) =>
    scope === 'global' ? 'global' : `project (${projectPath})`;

  log('  Found Comet installations on the following targets:\n');
  for (const target of targets) {
    const skillsDir = getPlatformSkillsDir(target.platform, target.scope);
    const prefix = target.scope === 'global' ? '~/' : '';
    log(`    ${target.platform.name} (${scopeLabel(target.scope)})`);
    log(`      Path: ${prefix}${skillsDir}/skills/`);
  }

  let selectedTargets = targets;
  if (!options.force && !options.json) {
    if (targets.length === 1) {
      const confirmed = await select({
        message: `Uninstall Comet from ${targets[0].platform.name} (${targets[0].scope})?`,
        choices: [
          { name: 'Yes, uninstall', value: true },
          { name: 'No, cancel', value: false },
        ],
      });
      if (!confirmed) return null;
    } else {
      const selected = await checkbox({
        message: 'Select targets to uninstall:',
        choices: targets.map((t) => ({
          name: `${t.platform.name} (${t.scope})`,
          value: `${t.platform.id}:${t.scope}`,
          checked: true,
        })),
        required: true,
      });
      selectedTargets = targets.filter((t) => selected.includes(`${t.platform.id}:${t.scope}`));
      if (selectedTargets.length === 0) return null;
    }
  }

  log('');
  const results: TargetUninstallResult[] = [];
  let totalSkills = 0;
  let totalRules = 0;
  let totalHooks = 0;
  let projectInstructionsRemoved = 0;

  for (const target of selectedTargets) {
    const baseDir = getBaseDir(target.scope, projectPath);
    const skillsResult = await removeCometSkillsForPlatform(baseDir, target.platform, target.scope);
    totalSkills += skillsResult.removed;
    const rulesResult = await removeCometRulesForPlatform(baseDir, target.platform, target.scope);
    totalRules += rulesResult.removed;

    let hooksRemoved = 0;
    if (target.platform.supportsHooks) {
      const hooksResult = await removeCometHooksForPlatform(baseDir, target.platform, target.scope);
      hooksRemoved = hooksResult.removed;
      totalHooks += hooksResult.removed;
    }

    log(
      `  ${target.platform.name} (${target.scope}): ${skillsResult.removed} skills, ${rulesResult.removed} rules, ${hooksRemoved} hooks removed`,
    );

    results.push({
      scope: target.scope,
      platform: target.platform.id,
      platformName: target.platform.name,
      skillsRemoved: skillsResult.removed,
      rulesRemoved: rulesResult.removed,
      hooksRemoved,
      workingDirsRemoved: 0,
    });
  }

  let workingDirsRemoved = 0;
  const hasProjectScope = selectedTargets.some((t) => t.scope === 'project');
  if (hasProjectScope) {
    const removeResult = await removeCometProjectInstructions(projectPath);
    projectInstructionsRemoved = removeResult.removed;
    if (projectInstructionsRemoved > 0) {
      log(`  Project instructions: ${projectInstructionsRemoved} managed block(s) removed`);
    }

    const dirsResult = await removeWorkingDirs(projectPath);
    workingDirsRemoved = dirsResult.removed;
    if (workingDirsRemoved > 0) {
      log(`  Working directories: ${workingDirsRemoved} removed`);
    }
  }

  return {
    projectPath,
    targets: results,
    workingDirsRemoved,
    projectInstructionsRemoved,
    summary: {
      targetsProcessed: results.length,
      totalSkillsRemoved: totalSkills,
      totalRulesRemoved: totalRules,
      totalHooksRemoved: totalHooks,
    },
  };
}
```

Then make current-project `uninstallCommand()` call this helper and serialize the exact old JSON shape.

- [x] **Step 5: Add all-projects uninstall orchestration**

Add imports:

```ts
import {
  listProjectRegistryEntries,
  removeProjectInstallation,
  upsertProjectInstallation,
} from '../../platform/install/project-registry.js';
import { resolveProjectScopeMode } from './project-scope-selection.js';
```

Add helper:

```ts
async function uninstallAllIndexedProjects(
  options: UninstallOptions,
  log: (message: string) => void,
): Promise<void> {
  const registryProjects = await listProjectRegistryEntries({ strict: true });
  const results = [];
  const runnableProjects = [];
  let staleRemoved = 0;

  for (const project of registryProjects) {
    const projectPath = project.path;
    try {
      const targets = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
      if (targets.length === 0) {
        if (await removeProjectInstallation(projectPath)) staleRemoved++;
        results.push({
          projectPath,
          status: 'skipped',
          reason: 'no project-scope Comet install detected',
          targets: [],
        });
        continue;
      }
      runnableProjects.push({ projectPath, targets });
    } catch (error) {
      results.push({
        projectPath,
        status: 'skipped',
        reason: `unable to inspect project: ${(error as Error).message}`,
        targets: [],
      });
    }
  }

  if (!options.force && !options.json) {
    log(`  Comet will uninstall project-scope files from ${runnableProjects.length} indexed project(s):`);
    for (const project of runnableProjects) {
      log(`    - ${project.projectPath}`);
      log(`      ${project.targets.map((target) => target.platform.name).join(', ')}`);
    }
    const confirmed = await select({
      message: 'Proceed with uninstalling all indexed projects?',
      choices: [
        { name: 'Yes, uninstall all indexed projects', value: true },
        { name: 'No, cancel', value: false },
      ],
    });
    if (!confirmed) {
      log('\n  Cancelled.\n');
      return;
    }
  }

  for (const project of runnableProjects) {
    const { projectPath, targets } = project;
    try {
      const result = await uninstallSingleProject(
        projectPath,
        { ...options, scope: 'project', allProjects: false, currentProject: true, force: true },
        log,
      );

      const remaining = await detectInstalledCometTargets(projectPath, { scopes: ['project'] });
      if (remaining.length === 0) {
        await removeProjectInstallation(projectPath);
      } else {
        await upsertProjectInstallation(
          projectPath,
          remaining.map((target) => ({ platform: target.platform.id, language: target.language })),
          'repair',
        );
      }

      results.push({
        projectPath,
        status: result ? 'uninstalled' : 'skipped',
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
        summary: result?.summary ?? {
          targetsProcessed: 0,
          totalSkillsRemoved: 0,
          totalRulesRemoved: 0,
          totalHooksRemoved: 0,
        },
        projectInstructionsRemoved: result?.projectInstructionsRemoved ?? 0,
        workingDirsRemoved: result?.workingDirsRemoved ?? 0,
      });
    } catch (error) {
      results.push({
        projectPath,
        status: 'failed',
        reason: (error as Error).message,
        targets: targets.map((target) => ({
          scope: target.scope,
          platform: target.platform.id,
          platformName: target.platform.name,
          language: target.language,
        })),
      });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: 'all-projects',
          registry: {
            projectsFound: registryProjects.length,
            staleRemoved,
          },
          projects: results,
        },
        null,
        2,
      ),
    );
    return;
  }

  log(`\n  Uninstalled ${results.filter((result) => result.status === 'uninstalled').length} indexed project(s).`);
}
```

At the top of `uninstallCommand()`:

```ts
  const registryProjects = await listProjectRegistryEntries({ strict: options.allProjects === true });
  const scopeMode = await resolveProjectScopeMode('uninstall', options, registryProjects.length);
  if (scopeMode === 'all-projects') {
    await uninstallAllIndexedProjects(options, log);
    return;
  }
```

- [x] **Step 6: Run focused uninstall tests**

Run:

```bash
npx vitest run test/app/project-scope-selection.test.ts test/app/uninstall.test.ts
```

Expected:

```text
PASS test/app/project-scope-selection.test.ts
PASS test/app/uninstall.test.ts
```

- [x] **Step 7: Commit uninstall integration**

```bash
git add app/cli/index.ts app/commands/uninstall.ts test/app/uninstall.test.ts
git commit -m "feat: uninstall all indexed projects"
```

---

### Task 6: Changelog, Formatting, Build, and Full Verification

**Files:**
- Modify: `CHANGELOG.md`
- Possibly modify: `package.json` if master version comparison requires a version bump.

**Interfaces:**
- Consumes:
  - All previous task commits.
- Produces:
  - Release-facing changelog entry.
  - Verified build/test state.

- [x] **Step 1: Determine version baseline**

Run:

```bash
git show origin/master:package.json
Get-Content -LiteralPath package.json
Get-Content -LiteralPath CHANGELOG.md -TotalCount 80
```

Expected:

```text
origin/master package.json version is visible
current package.json version is visible
CHANGELOG top section is visible
```

Decision rule:

```text
If current package.json version is already greater than origin/master, append to that version's existing top CHANGELOG block.
If current package.json version equals origin/master, bump package.json by exactly one patch/prerelease step following the existing branch pattern, then create a matching top CHANGELOG block.
```

- [x] **Step 2: Update changelog**

Add one release-facing bullet under the active version:

```markdown
### Added

- **Project installation registry**: Added a user-level registry for project-scope Comet installs so interactive update and uninstall can operate across all indexed projects from one command while JSON and scripted calls remain current-project by default.
```

Do not add bullets about the spec, internal refactors, test files, or intermediate fixes.

- [x] **Step 3: Run targeted tests**

Run:

```bash
npx vitest run test/platform/project-registry.test.ts test/app/project-scope-selection.test.ts test/app/update.test.ts test/app/uninstall.test.ts test/app/init-e2e.test.ts
```

Expected:

```text
PASS test/platform/project-registry.test.ts
PASS test/app/project-scope-selection.test.ts
PASS test/app/update.test.ts
PASS test/app/uninstall.test.ts
PASS test/app/init-e2e.test.ts
```

- [x] **Step 4: Run full tests**

Run:

```bash
npx vitest run
```

Expected:

```text
Test Files  ... passed
Tests       ... passed
```

- [x] **Step 5: Run build**

Run:

```bash
node build.js
```

Expected:

```text
Build completed
```

If the exact build output differs, accept success only if the command exits `0`.

- [x] **Step 6: Run formatting and whitespace checks**

Run:

```bash
npx prettier --check app/ domains/ platform/ test/app/update.test.ts test/app/uninstall.test.ts test/app/init-e2e.test.ts test/platform/project-registry.test.ts test/app/project-scope-selection.test.ts
git diff --check
```

Expected:

```text
All matched files use Prettier code style!
```

and:

```text
git diff --check exits 0
```

- [x] **Step 7: Commit changelog and verification cleanup**

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "docs: update changelog for project registry"
```

Only include `package.json` and `package-lock.json` if the version changed. If no version change happened, stage only `CHANGELOG.md`.

---

## Self-Review Checklist

- [x] Registry module exists and is the only code that reads/writes `~/.comet/installations.json`.
- [x] `initCommand()` records project-scope installs and ignores global-scope installs.
- [x] `updateCommand()` preserves current JSON shape unless `--all-projects` is explicit.
- [x] `uninstallCommand()` preserves current JSON shape unless `--all-projects` is explicit.
- [x] Interactive current/all selection defaults to all indexed projects when registry has entries.
- [x] `--all-projects --current-project` fails before doing work.
- [x] `--all-projects --scope global` fails before doing work.
- [x] Cross-project execution re-detects project-scope targets before modifying files.
- [x] Stale registry entries with no detected project-scope install are removed.
- [x] Unreadable project entries are not removed unless the code can prove the install is absent.
- [x] `CHANGELOG.md` contains one user-facing Added bullet, not process notes.
