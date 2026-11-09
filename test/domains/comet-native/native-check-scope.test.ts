import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { captureNativeCheckScope } from '../../../domains/comet-native/native-check-scope.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('does not establish a reusable scope for a directory replacing the syntax input', async () => {
  vi.stubEnv('LD_LIBRARY_PATH', undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-check-scope-directory-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'value.mjs'));
  expect(
    await captureNativeCheckScope({
      projectRoot: root,
      contract: 'approved-shape',
      plan: {
        id: 'syntax',
        name: 'Syntax',
        executable: process.execPath,
        argv: ['--check', 'value.mjs'],
        cwdRef: '.',
        timeoutMs: 5_000,
        repeatable: true,
      },
    }),
  ).toBeNull();
});

it('binds Docker NODE_VERSION metadata without disabling a proven syntax scope', async () => {
  vi.stubEnv('LD_LIBRARY_PATH', undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-check-scope-docker-'));
  roots.push(root);
  await fs.writeFile(path.join(root, 'value.mjs'), 'export const value = 1;\n');
  const options = {
    projectRoot: root,
    contract: 'approved-shape',
    plan: {
      id: 'syntax',
      name: 'Syntax',
      executable: process.execPath,
      argv: ['--check', 'value.mjs'],
      cwdRef: '.',
      timeoutMs: 5_000,
      repeatable: true,
    },
  };
  vi.stubEnv('NODE_VERSION', '22.23.3');
  const first = await captureNativeCheckScope(options);
  expect(first).not.toBeNull();
  expect(await captureNativeCheckScope(options)).toEqual(first);
  vi.stubEnv('NODE_VERSION', '22.23.4');
  expect((await captureNativeCheckScope(options))?.contextDigest).not.toBe(first?.contextDigest);
  vi.stubEnv('NODE_OPTIONS', '--require ./preload.cjs');
  expect(await captureNativeCheckScope(options)).toBeNull();
});
