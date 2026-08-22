import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  readPersonalMemoryConfig,
  writePersonalMemoryConfig,
} from '../../../domains/comet-memory/provider-config.js';

describe('personal memory provider config', () => {
  test('reads defaults and updates only the personal_memory block', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'comet-memory-config-'));
    try {
      const configPath = path.join(home, '.comet', 'config.yaml');
      await mkdir(path.dirname(configPath), { recursive: true });
      await writeFile(
        configPath,
        'schema: comet.global.v1\nnative:\n  language: zh-CN\n\n',
        'utf8',
      );

      await expect(readPersonalMemoryConfig(home)).resolves.toMatchObject({
        provider: 'local',
        profileCharLimit: 2000,
        taskContextCharLimit: 6000,
      });

      await writePersonalMemoryConfig(home, {
        provider: 'remote',
        profileCharLimit: 2400,
        taskContextCharLimit: 7000,
        remote: {
          endpoint: 'https://memory.example.test/provider',
          tokenEnv: 'COMET_MEMORY_TOKEN',
          profile: 'default',
          timeoutMs: 2400,
        },
      });

      await expect(readPersonalMemoryConfig(home)).resolves.toMatchObject({
        provider: 'remote',
        profileCharLimit: 2400,
        taskContextCharLimit: 7000,
        remote: { endpoint: 'https://memory.example.test/provider', timeoutMs: 2400 },
      });
      await expect(readFile(configPath, 'utf8')).resolves.toContain('language: zh-CN');
      await expect(readFile(configPath, 'utf8')).resolves.toContain('personal_memory:');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
