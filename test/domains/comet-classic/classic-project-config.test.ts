import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { readClassicConfigValue } from '../../../domains/comet-classic/classic-project-config.js';

describe('Classic project config', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-config-project-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-config-home-'));
  });

  afterEach(async () => {
    await Promise.all([
      fs.rm(projectRoot, { recursive: true, force: true }),
      fs.rm(homeDir, { recursive: true, force: true }),
    ]);
  });

  async function writeConfig(root: string, source: string): Promise<void> {
    const configFile = path.join(root, '.comet', 'config.yaml');
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    await fs.writeFile(configFile, source, 'utf8');
  }

  it('reads Classic settings only from the nested block', async () => {
    await writeConfig(projectRoot, 'classic:\n  language: zh-CN\n  review_mode: thorough\n');

    await expect(
      readClassicConfigValue('review_mode', { cwd: projectRoot, homeDir }),
    ).resolves.toEqual({ value: 'thorough', source: '.comet/config.yaml' });
  });

  it('ignores legacy top-level settings and falls through to the global nested block', async () => {
    await writeConfig(projectRoot, 'review_mode: off\n');
    await writeConfig(homeDir, 'classic:\n  review_mode: thorough\n');

    await expect(
      readClassicConfigValue('review_mode', { cwd: projectRoot, homeDir }),
    ).resolves.toEqual({ value: 'thorough', source: '~/.comet/config.yaml' });
  });

  it('returns null when only a legacy top-level setting exists', async () => {
    await writeConfig(projectRoot, 'auto_transition: false\n');

    await expect(
      readClassicConfigValue('auto_transition', { cwd: projectRoot, homeDir }),
    ).resolves.toBeNull();
  });

  it('fails closed when another project-config field is malformed', async () => {
    await writeConfig(
      projectRoot,
      'classic:\n  context_compression: beta\nunrelated: [unterminated\n',
    );

    await expect(
      readClassicConfigValue('context_compression', { cwd: projectRoot, homeDir }),
    ).rejects.toThrow('Invalid .comet/config.yaml');
  });

  it('fails closed for duplicate keys instead of selecting one value', async () => {
    await writeConfig(projectRoot, 'classic:\n  review_mode: standard\n  review_mode: thorough\n');

    await expect(
      readClassicConfigValue('review_mode', { cwd: projectRoot, homeDir }),
    ).rejects.toThrow('Invalid .comet/config.yaml');
  });

  it('rejects a linked project config instead of following it', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-config-outside-'));
    try {
      await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
      const outsideConfig = path.join(outsideRoot, 'config.yaml');
      await fs.writeFile(outsideConfig, 'classic:\n  review_mode: thorough\n', 'utf8');
      try {
        await fs.symlink(outsideConfig, path.join(projectRoot, '.comet', 'config.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        readClassicConfigValue('review_mode', { cwd: projectRoot, homeDir }),
      ).rejects.toThrow(/symbolic link or junction/iu);
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });
});
