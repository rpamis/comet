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
describe('Native verification receipt fence recovery (legacy)', () => {
  let projectRoot: string;
  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-receipt-fence-'));
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
  });
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  it('rejects the retired receipt command at the public boundary', async () => {
    const result = json(
      await runNativeCli(['receipt', 'receipt-fence', '--json', '--project-root', projectRoot]),
    );
    expect(result).toMatchObject({
      command: 'receipt',
      exitCode: 64,
      error: { code: 'usage' },
    });
  });
});
