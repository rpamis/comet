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

  it('does not treat unreadable registry files as an empty strict registry', async () => {
    const registryPath = getProjectRegistryPath(homeDir);
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(registryPath, '{"schemaVersion":1,"updatedAt":"now","projects":[]}\n');

    const originalAccess = fs.access.bind(fs);
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (target) => {
      if (path.resolve(String(target)) === path.resolve(registryPath)) {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
      return originalAccess(target);
    });

    try {
      await expect(readProjectRegistry({ homeDir, strict: true })).rejects.toMatchObject({
        code: 'EACCES',
      });
    } finally {
      accessSpy.mockRestore();
    }
  });

  it.each<[string, unknown[]]>([
    ['non-string platform', [{ platform: 123, language: 'en' }]],
    ['unsupported language', [{ platform: 'codex', language: 'fr' }]],
    ['missing language', [{ platform: 'codex' }]],
  ])(
    'throws a ProjectRegistryError for lastTargets with %s in strict mode',
    async (_, lastTargets) => {
      const registryPath = getProjectRegistryPath(homeDir);
      await fs.mkdir(path.dirname(registryPath), { recursive: true });
      await fs.writeFile(
        registryPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: '2026-07-10T00:00:00.000Z',
            projects: [
              {
                path: path.join(tmpDir, 'Project'),
                canonicalPath: path.join(tmpDir, 'Project'),
                addedAt: '2026-07-10T00:00:00.000Z',
                updatedAt: '2026-07-10T00:00:00.000Z',
                lastSeenAt: '2026-07-10T00:00:00.000Z',
                lastSource: 'init',
                lastTargets,
              },
            ],
          },
          null,
          2,
        )}\n`,
        'utf-8',
      );

      await expect(readProjectRegistry({ homeDir, strict: true })).rejects.toMatchObject({
        code: 'invalid-schema',
      } satisfies Partial<ProjectRegistryError>);
    },
  );

  it('refuses to overwrite a corrupt registry during single-project upsert', async () => {
    const registryPath = getProjectRegistryPath(homeDir);
    const projectDir = path.join(tmpDir, 'Project');
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(registryPath, '{not-json', 'utf-8');

    await expect(
      upsertProjectInstallation(projectDir, [{ platform: 'claude', language: 'en' }], 'init', {
        homeDir,
      }),
    ).rejects.toMatchObject({ code: 'invalid-json' } satisfies Partial<ProjectRegistryError>);
    await expect(fs.readFile(registryPath, 'utf-8')).resolves.toBe('{not-json');
  });

  it('uses case-insensitive keys on Windows', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    try {
      const projectDir = path.join(tmpDir, 'CaseProject');
      await fs.mkdir(projectDir, { recursive: true });
      await upsertProjectInstallation(
        projectDir,
        [{ platform: 'claude', language: 'en' }],
        'init',
        {
          homeDir,
        },
      );
      await upsertProjectInstallation(projectDir.toUpperCase(), [], 'update', { homeDir });

      await expect(listProjectRegistryEntries({ homeDir })).resolves.toHaveLength(1);
    } finally {
      platformSpy.mockRestore();
    }
  });
});
