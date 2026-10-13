import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runNode } from '../helpers/comet-test-utils.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-test-process-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('isolates Classic subprocess HOME from the signed-in user', async () => {
  const script = path.join(root, 'home.mjs');
  await fs.writeFile(
    script,
    'console.log(JSON.stringify({home:process.env.HOME,profile:process.env.USERPROFILE}));',
  );
  const result = runNode(root, script);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    home: path.join(root, '.test-home'),
    profile: path.join(root, '.test-home'),
  });
});

it('reports a subprocess timeout before it can be mistaken for a rejected guard', async () => {
  const script = path.join(root, 'hang.mjs');
  await fs.writeFile(script, 'setInterval(() => {}, 1000);');
  expect(() => runNode(root, script, [], {}, 30)).toThrow(/ETIMEDOUT/);
});

it('preserves a real business rejection and its diagnostic output', async () => {
  const script = path.join(root, 'reject.mjs');
  await fs.writeFile(script, "console.error('[FAIL] missing design'); process.exitCode=7;");
  const result = runNode(root, script);
  expect(result.status).toBe(7);
  expect(result.stderr).toContain('[FAIL] missing design');
});

it('reports a launch failure before checking business output', async () => {
  const script = path.join(root, 'never-started.mjs');
  await fs.writeFile(script, 'process.exitCode=0;');
  expect(() => runNode(path.join(root, 'missing'), script)).toThrow(/ENOENT/);
});
