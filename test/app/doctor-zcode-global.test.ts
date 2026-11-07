import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  copyCometSkillsForPlatform,
  installCometHooksForPlatform,
} from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';

it('keeps a valid ZCode global Hook healthy through public doctor repair and repairs disabled or duplicate Hooks', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-zcode-'));
  try {
    const platform = PLATFORMS.find((item) => item.id === 'zcode')!;
    await copyCometSkillsForPlatform(home, platform, true, 'skills', 'global', 'copy', 'native');
    await installCometHooksForPlatform(home, platform, 'global', 'native');
    const file = path.join(home, '.zcode/cli/config.json');
    const doctor = (repair = false) => {
      const result = spawnSync(
        process.execPath,
        [
          path.resolve('bin/comet.js'),
          'doctor',
          '--scope',
          'global',
          '--json',
          ...(repair ? ['--repair'] : []),
        ],
        {
          cwd: home,
          encoding: 'utf8',
          timeout: 60_000,
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            COMET_DATA_DIR: path.join(home, 'data'),
          },
        },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      return JSON.parse(result.stdout).results.find(
        (item: { check: string }) => item.check === 'hooks: ZCode (global)',
      );
    };
    expect(doctor()).toMatchObject({ status: 'pass' });
    expect(doctor(true)).toMatchObject({ status: 'pass' });
    for (const defect of ['disabled', 'duplicate']) {
      const config = JSON.parse(await fs.readFile(file, 'utf8'));
      config.team = { keep: true };
      if (defect === 'disabled') config.hooks.enabled = false;
      else config.hooks.events.PreToolUse.push(structuredClone(config.hooks.events.PreToolUse[0]));
      await fs.writeFile(file, JSON.stringify(config));
      expect(doctor()).toMatchObject({ status: 'warn' });
      expect(doctor(true)).toMatchObject({ status: 'pass' });
      expect(JSON.parse(await fs.readFile(file, 'utf8')).team).toEqual({ keep: true });
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
