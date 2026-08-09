import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../domains/integrations/openspec.js', () => ({
  installOpenSpec: vi.fn(
    async (
      projectRoot: string,
      _tools: string[],
      _scope: string,
      _cli: boolean,
      _mirrors: string[],
      layout: string,
    ) => {
      const root =
        layout === 'docs'
          ? path.join(projectRoot, 'docs', 'openspec')
          : path.join(projectRoot, 'openspec');
      await fs.mkdir(path.join(root, 'changes'), { recursive: true });
      await fs.mkdir(path.join(root, 'specs'), { recursive: true });
      await fs.writeFile(path.join(root, 'config.yaml'), 'schema: spec-driven\n', 'utf8');
      return 'installed';
    },
  ),
}));

import { resolveOrActivateCometEntry } from '../../../domains/comet-entry/project-activation.js';
import { writeWorkflowGlobalConfig } from '../../../domains/workflow-contract/global-config.js';

describe('Comet project activation', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-activation-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-global-home-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('initializes project-owned Classic roots from a global Classic default', async () => {
    await writeWorkflowGlobalConfig(homeDir, {
      schema: 'comet.global.v1',
      default_workflow: 'classic',
      workflows: ['classic'],
      ambient_resume: true,
      classic: {
        artifact_layout: 'docs',
        language: 'zh-CN',
        context_compression: 'off',
        review_mode: 'standard',
        auto_transition: true,
      },
    });

    await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).resolves.toEqual({
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'global-config',
    });
    await expect(
      fs.access(path.join(projectRoot, 'docs', 'openspec', 'config.yaml')),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, 'docs', 'superpowers', 'plans')),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('default_workflow: classic');
    await expect(fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8')).resolves.toContain(
      '!/.comet/config.yaml',
    );
  });

  it('projects a globally installed Codex Router before publishing project config', async () => {
    await writeWorkflowGlobalConfig(homeDir, {
      schema: 'comet.global.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      native: {
        artifact_root: 'artifacts',
        language: 'en',
        clarification_mode: 'sequential',
        archive_confirmation: 'automatic',
        max_verify_failures: 3,
        snapshot: {
          include: ['**/*'],
          exclude: [],
          max_files: 1000,
          max_total_bytes: 10485760,
          max_duration_ms: 3000,
        },
      },
    });
    const sourceRouter = path.join(
      homeDir,
      '.agents',
      'skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await fs.writeFile(sourceRouter, '// installed global Router\n', 'utf8');

    await resolveOrActivateCometEntry(projectRoot, { homeDir });

    await expect(fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8')).resolves.toContain(
      '!/.comet/config.yaml',
    );

    const hooks = await fs.readFile(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8');
    expect(hooks.replaceAll('\\', '/')).toContain(
      `${projectRoot.replaceAll('\\', '/')}/.agents/skills/comet/scripts/comet-hook-router.mjs`,
    );
    await expect(
      fs.access(
        path.join(projectRoot, '.agents', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not publish project config when a projected Hook would overwrite user state', async () => {
    await writeWorkflowGlobalConfig(homeDir, {
      schema: 'comet.global.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      native: {
        artifact_root: 'artifacts',
        language: 'en',
        clarification_mode: 'sequential',
        archive_confirmation: 'automatic',
        max_verify_failures: 3,
        snapshot: {
          include: ['**/*'],
          exclude: [],
          max_files: 1000,
          max_total_bytes: 10485760,
          max_duration_ms: 3000,
        },
      },
    });
    const sourceRouter = path.join(
      homeDir,
      '.kiro',
      'skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
    await fs.writeFile(sourceRouter, '// installed global Router\n', 'utf8');
    const userHook = path.join(projectRoot, '.kiro', 'hooks', 'comet-hook-router.kiro.hook');
    await fs.mkdir(path.dirname(userHook), { recursive: true });
    await fs.writeFile(userHook, '{"name":"user-owned"}', 'utf8');

    await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).rejects.toThrow(
      'user-owned Kiro Hook',
    );

    await expect(fs.readFile(userHook, 'utf8')).resolves.toBe('{"name":"user-owned"}');
    await expect(fs.access(path.join(projectRoot, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('preserves legacy Classic ownership instead of applying a global Native default', async () => {
    await fs.mkdir(path.join(projectRoot, 'openspec', 'changes', 'legacy-change'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'legacy-change', '.comet.yaml'),
      'phase: build\n',
      'utf8',
    );
    await writeWorkflowGlobalConfig(homeDir, {
      schema: 'comet.global.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      native: {
        artifact_root: 'artifacts',
        language: 'en',
        clarification_mode: 'sequential',
        archive_confirmation: 'automatic',
        max_verify_failures: 3,
        snapshot: {
          include: ['**/*'],
          exclude: [],
          max_files: 1000,
          max_total_bytes: 10485760,
          max_duration_ms: 3000,
        },
      },
    });

    await expect(resolveOrActivateCometEntry(projectRoot, { homeDir })).resolves.toEqual({
      workflow: 'classic',
      skill: 'comet-classic',
      source: 'legacy-project',
    });
    await expect(fs.access(path.join(projectRoot, 'artifacts', 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
