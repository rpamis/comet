import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { projectCometHooksFromInstalledScope } from '../../../domains/skill/project-hook-projection.js';

describe('project Hook projection', () => {
  let projectRoot: string;
  let sourceRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-hook-target-'));
    sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-hook-source-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(sourceRoot, { recursive: true, force: true });
  });

  it('projects a global Codex Router into the project without copying selection state', async () => {
    const sourceRouter = path.join(
      sourceRoot,
      '.agents',
      'skills',
      'comet',
      'scripts',
      'comet-hook-router.mjs',
    );
    await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
    await fs.mkdir(path.join(sourceRoot, '.codex'), { recursive: true });
    await fs.writeFile(sourceRouter, '// installed global Router\n', 'utf8');
    await fs.mkdir(path.join(sourceRoot, '.comet'), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, '.comet', 'current-change.json'),
      '{"schema":"comet.selection.v2","workflow":"native","change":"global"}',
      'utf8',
    );

    await expect(
      projectCometHooksFromInstalledScope(projectRoot, sourceRoot, 'global', 'native', {
        globalBaseDir: sourceRoot,
      }),
    ).resolves.toEqual({ installedPlatforms: ['codex'], failures: [] });

    const projectHooks = await fs.readFile(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8');
    expect(projectHooks.replaceAll('\\', '/')).toContain(
      `${projectRoot.replaceAll('\\', '/')}/.agents/skills/comet/scripts/comet-hook-router.mjs`,
    );
    await expect(
      fs.access(
        path.join(projectRoot, '.agents', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, '.comet', 'current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a user-owned Kiro canonical Hook collision', async () => {
    const sourceRouter = path.join(
      sourceRoot,
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

    const result = await projectCometHooksFromInstalledScope(
      projectRoot,
      sourceRoot,
      'global',
      'native',
      { globalBaseDir: sourceRoot },
    );

    expect(result.installedPlatforms).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ platform: 'kiro', reason: expect.stringContaining('user-owned') }),
    ]);
    await expect(fs.readFile(userHook, 'utf8')).resolves.toBe('{"name":"user-owned"}');
  });
});
