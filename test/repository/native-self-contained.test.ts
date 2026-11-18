import { promises as fs } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('leaves ordinary checks to the Agent platform without a local executor', async () => {
  const command = await fs.readFile(
    path.resolve('domains', 'comet-native', 'native-check-command.ts'),
    'utf8',
  );
  const runtime = await fs.readFile(
    path.resolve('domains', 'comet-native', 'native-portable-runtime.ts'),
    'utf8',
  );
  await expect(
    fs.access(path.resolve('domains', 'comet-native', 'native-check-executor.ts')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
  expect(command).toContain("status: 'platform-execution-required'");
  expect(command).toContain('checksExecuted: false');
  expect(command).not.toMatch(/child_process|spawn-command|terminateProcessTree/u);
  expect(runtime).not.toContain('executeNativePortableCheckPlan');
  expect(runtime).not.toContain('buildNativeVerificationReceipt');
});
