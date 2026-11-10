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
  data?: unknown;
  error?: { code: string; message: string };
}
function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}
describe('Native Wave B CLI contract (legacy)', () => {
  let projectRoot: string;
  const projectArgs = () => ['--project-root', projectRoot] as const;
  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-wave-b-cli-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  it('rejects the retired checkpoint command instead of invoking the v4 Runtime', async () => {
    const result = json(
      await runNativeCli(['checkpoint', 'cold-resume', '--json', ...projectArgs()]),
    );
    expect(result).toMatchObject({
      command: 'checkpoint',
      exitCode: 64,
      error: { code: 'usage' },
    });
  });
});
