import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import {
  copyCometSkillsForPlatform,
  installCometHooksForPlatform,
} from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import { renderCometProjectGitignore } from '../../domains/workflow-contract/project-gitignore.js';

it('preserves custom ignore rules and YAML comments through repeated public project updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-update-user-content-'));
  const home = path.join(root, 'isolated-home');
  await fs.mkdir(home);
  try {
    const platform = PLATFORMS.find((item) => item.id === 'zcode')!;
    await writeProjectConfig(root, defaultProjectConfig('docs', 'zh-CN'));
    await copyCometSkillsForPlatform(
      root,
      platform,
      true,
      'skills-zh',
      'project',
      'copy',
      'native',
    );
    await installCometHooksForPlatform(home, platform, 'global', 'native');
    const globalHookFile = path.join(home, '.zcode/cli/config.json');
    const globalHookSource = await fs.readFile(globalHookFile, 'utf8');
    const file = path.join(root, '.comet/config.yaml');
    await fs.appendFile(
      file,
      '# Team configuration note\nteam_extension: keep # Inline extension note\n',
    );
    const ignore = renderCometProjectGitignore('').replace(
      '# <<< Comet managed project state <<<',
      '# Team archive rule\n**/changes/**/custom-state/\n# <<< Comet managed project state <<<',
    );
    await fs.writeFile(path.join(root, '.gitignore'), ignore);
    for (let iteration = 0; iteration < 2; iteration++) {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('bin/comet.js'),
          'update',
          '--current-project',
          '--scope',
          'project',
          '--skip-self-update',
          '--yes',
          '--language',
          'zh',
          '--platform',
          'zcode',
          '--json',
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60_000,
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            COMET_DATA_DIR: path.join(home, 'data'),
            OPENSPEC_TELEMETRY: '0',
            OPENSPEC_NO_UPDATE_CHECK: '1',
          },
        },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(ignore);
      const source = await fs.readFile(file, 'utf8');
      expect(source).toContain('Team configuration note');
      expect(source).toContain('Inline extension note');
      expect(source).toContain('team_extension: keep');
      expect(await fs.readFile(globalHookFile, 'utf8')).toBe(globalHookSource);
      await expect(fs.access(path.join(root, '.zcode/config.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
