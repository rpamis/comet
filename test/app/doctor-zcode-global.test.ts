import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { copyCometSkillsForPlatform } from '../../domains/skill/platform-install.js';
import { PLATFORMS } from '../../platform/install/platforms.js';
import { writeLegacyZcodeUserHook } from '../helpers/zcode-hook-config.js';

it('reports and removes old ZCode user Routers through public doctor without touching user Hooks', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-doctor-zcode-'));
  try {
    const platform = PLATFORMS.find((item) => item.id === 'zcode')!;
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
      return JSON.parse(result.stdout);
    };
    const globalHook = (repair = false) =>
      doctor(repair).results.find(
        (item: { check: string }) => item.check === 'hooks: ZCode (global)',
      );

    const hookOnly = await writeLegacyZcodeUserHook(home);
    expect(doctor(true).repaired).toContain('ZCode (global) Hook');
    expect(JSON.parse(await fs.readFile(hookOnly.configPath, 'utf8'))).toEqual(
      hookOnly.userSettings,
    );

    await copyCometSkillsForPlatform(home, platform, true, 'skills', 'global', 'copy', 'native');
    expect
      .soft(globalHook())
      .toMatchObject({ status: 'pass', message: 'no global blocking Hook present' });
    for (const state of ['enabled', 'disabled', 'duplicate']) {
      const { configPath, legacySettings, userSettings } = await writeLegacyZcodeUserHook(home);
      if (state === 'disabled') {
        legacySettings.hooks.enabled = false;
        userSettings.hooks.enabled = false;
      } else if (state === 'duplicate') {
        legacySettings.hooks.events.PreToolUse[0].hooks.push(
          legacySettings.hooks.events.PreToolUse[0].hooks[1],
        );
      }
      const original = JSON.stringify(legacySettings);
      await fs.writeFile(configPath, original);
      expect(globalHook()).toMatchObject({
        status: 'warn',
        message: expect.stringContaining('remains'),
      });
      await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(original);
      expect(globalHook(true)).toMatchObject({
        status: 'pass',
        message: 'no global blocking Hook present',
      });
      expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toEqual(userSettings);
    }
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});
