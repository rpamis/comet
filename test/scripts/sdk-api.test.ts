import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const script = path.resolve('scripts/release/check-sdk-api.mjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

test('rejects a public method signature change without updating the accepted report', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-api-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'sdk-fixture',
      version: '1.0.0',
      type: 'module',
      exports: {
        './runtime': { types: './dist/index.d.ts' },
        './applications': { types: './dist/index.d.ts' },
        './applications/native': { types: './dist/index.d.ts' },
        './applications/classic': { types: './dist/index.d.ts' },
        './plugins': { types: './dist/index.d.ts' },
        './plugins/comet': { types: './dist/index.d.ts' },
      },
    }),
  );
  const declaration = path.join(root, 'dist/index.d.ts');
  await fs.writeFile(declaration, 'export declare class Client { answer(): number; }\n');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, '--project-root', root, ...args], { encoding: 'utf8' });
  const accepted = run('--update');
  expect(accepted.status, accepted.stdout + accepted.stderr).toBe(0);
  const before = await fs.readFile(path.join(root, 'config/sdk-api/runtime.api.md'), 'utf8');
  const unchanged = run();
  expect(unchanged.status, unchanged.stdout + unchanged.stderr).toBe(0);
  await fs.writeFile(declaration, 'export declare class Client { answer(): string; }\n');
  const changed = run();
  expect(changed.status).toBe(1);
  expect(changed.stdout + changed.stderr).toContain('runtime');
  expect(await fs.readFile(path.join(root, 'config/sdk-api/runtime.api.md'), 'utf8')).toBe(before);
});

test('fails when an advertised SDK declaration is missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-api-missing-'));
  roots.push(root);
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'sdk-fixture',
      version: '1.0.0',
      exports: { './runtime': { types: './missing.d.ts' } },
    }),
  );
  const result = spawnSync(process.execPath, [script, '--project-root', root], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('SDK 类型声明缺失');
});
