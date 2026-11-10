import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

describe('Native check public seam (legacy)', () => {
  let projectRoot: string;
  const name = 'safe-check';
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-check-cli-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('rejects the retired legacy content-proof check command', async () => {
    const result = json(await runNativeCli(['check', name, '--json', ...projectArgs()]));
    expect(result).toMatchObject({
      command: 'check',
      exitCode: 64,
      error: { code: 'usage', message: expect.stringContaining('内容证明检查已移除') },
    });
  });
});
