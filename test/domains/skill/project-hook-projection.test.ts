import { readNodeHookArguments } from '../../../platform/process/hook-command.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCometProject } from '../../../domains/comet-entry/project-activation.js';
import { projectCometHooksFromInstalledScope } from '../../../domains/skill/project-hook-projection.js';
import { getAssetsDir } from '../../../domains/skill/platform-install.js';
import * as fileSystem from '../../../platform/fs/file-system.js';

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
    ).resolves.toEqual({ installedPlatforms: ['codex'], failures: [], notices: [] });

    const projectHooks = await fs.readFile(path.join(projectRoot, '.codex', 'hooks.json'), 'utf8');
    const command = JSON.parse(projectHooks).hooks.PreToolUse[0].hooks[0].command;
    expect(readNodeHookArguments(command)).toEqual([
      path.join(projectRoot, '.agents/skills/comet/scripts/comet-hook-router.mjs'),
      '--platform',
      'codex',
      '--project-root',
      projectRoot,
    ]);
    await expect(
      fs.access(
        path.join(projectRoot, '.agents', 'skills', 'comet', 'scripts', 'comet-hook-router.mjs'),
      ),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(projectRoot, '.comet', 'current-change.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const result = spawnSync(command, {
      shell: true,
      cwd: projectRoot,
      encoding: 'utf8',
      input: JSON.stringify({
        cwd: projectRoot,
        tool_name: 'Write',
        tool_input: { file_path: 'example.txt' },
      }),
      timeout: 20_000,
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it.each(['project', 'global'] as const)(
    'projects a disabled ZCode project Router from %s Skills',
    async (scope) => {
      const sourceRouter = path.join(
        sourceRoot,
        '.zcode/skills/comet/scripts/comet-hook-router.mjs',
      );
      await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
      await fs.writeFile(sourceRouter, '// installed Router\n', 'utf8');
      await expect(
        projectCometHooksFromInstalledScope(projectRoot, sourceRoot, scope, 'native', {
          globalBaseDir: scope === 'global' ? sourceRoot : path.join(sourceRoot, 'home'),
        }),
      ).resolves.toEqual({
        installedPlatforms: ['zcode'],
        failures: [],
        notices: [expect.stringContaining('Manually enable the Router')],
      });

      const configPath = path.join(projectRoot, '.zcode/config.json');
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect(config.hooks).not.toHaveProperty('enabled');
      expect(config.hooks.events.PreToolUse[0].hooks[0]).toMatchObject({
        enabled: false,
        args: [
          path.join(projectRoot, '.zcode/skills/comet/scripts/comet-hook-router.mjs'),
          '--platform',
          'zcode',
          '--project-root',
          projectRoot,
        ],
      });
      await expect(
        fs.access(path.join(sourceRoot, '.zcode/cli/config.json')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it.for(['first activation', 'worktree projection'] as const)(
    'rejects a ZCode runtime directory outside the workspace before copying during %s',
    async (entry) => {
      const scripts = path.join(projectRoot, '.zcode/skills/comet/scripts');
      const sourceRouter = path.join(
        sourceRoot,
        '.zcode/skills/comet/scripts/comet-hook-router.mjs',
      );
      const external = path.join(sourceRoot, 'external');
      await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
      await fs.writeFile(sourceRouter, '// installed Router fixture\n');
      await fs.mkdir(path.dirname(scripts), { recursive: true });
      await fs.mkdir(external);
      await fs.symlink(external, scripts, process.platform === 'win32' ? 'junction' : 'dir');

      // The test exercises path validation without copying executable files to the linked directory.
      const copy = vi.spyOn(fileSystem, 'copyFile').mockResolvedValue(undefined);
      try {
        if (entry === 'first activation') {
          await expect(activateCometProject(projectRoot, { homeDir: sourceRoot })).rejects.toThrow(
            /Comet project Hook activation failed: zcode: Hook runtime destination must stay inside the workspace/u,
          );
          await expect(
            fs.access(path.join(projectRoot, '.comet/config.yaml')),
          ).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } else {
          await expect(
            projectCometHooksFromInstalledScope(projectRoot, sourceRoot, 'project', 'native', {
              globalBaseDir: path.join(sourceRoot, 'home'),
            }),
          ).resolves.toMatchObject({
            installedPlatforms: [],
            failures: [
              {
                platform: 'zcode',
                reason: expect.stringContaining(
                  'Hook runtime destination must stay inside the workspace',
                ),
              },
            ],
          });
        }
        expect(copy).not.toHaveBeenCalled();
        await expect(fs.readdir(external)).resolves.toEqual([]);
        await expect(fs.access(path.join(projectRoot, '.zcode/config.json'))).rejects.toMatchObject(
          {
            code: 'ENOENT',
          },
        );
      } finally {
        copy.mockRestore();
      }
    },
  );

  it('keeps ZCode runtime directory links whose targets stay inside the workspace', async () => {
    const scripts = path.join(projectRoot, '.zcode/skills/comet/scripts');
    const internal = path.join(projectRoot, 'runtime');
    const sourceRouter = path.join(sourceRoot, '.zcode/skills/comet/scripts/comet-hook-router.mjs');
    await fs.mkdir(path.dirname(sourceRouter), { recursive: true });
    await fs.writeFile(sourceRouter, '// installed Router fixture\n');
    await fs.mkdir(path.dirname(scripts), { recursive: true });
    await fs.mkdir(internal);
    await fs.symlink(internal, scripts, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(
      projectCometHooksFromInstalledScope(projectRoot, sourceRoot, 'global', 'native', {
        globalBaseDir: sourceRoot,
      }),
    ).resolves.toMatchObject({ installedPlatforms: ['zcode'], failures: [] });

    expect((await fs.lstat(scripts)).isSymbolicLink()).toBe(true);
    for (const file of ['comet-hook-router.mjs', 'comet-hook-router-guard.mjs']) {
      await expect(fs.readFile(path.join(internal, file))).resolves.toEqual(
        await fs.readFile(path.join(getAssetsDir(), 'skills/comet/scripts', file)),
      );
    }
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
