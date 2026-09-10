import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  checkInputFingerprint,
  checkEnvironmentFingerprint,
} from '../../../domains/comet-classic/classic-check-snapshot.js';
import { readCheckPolicy } from '../../../domains/comet-classic/classic-check-policy.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

let root: string;
let change: string;
const identity = { argv: [process.execPath, 'check.cjs'], cwd: '.' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-policy-'));
  await prepareClassicLegacyProject(root);
  change = path.join(root, 'openspec/changes/demo');
  await fs.mkdir(change, { recursive: true });
  await fs.writeFile(path.join(root, 'input.txt'), 'input');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});
const writePolicy = (value: Record<string, unknown>) =>
  fs.writeFile(
    path.join(root, '.comet/check-policy.json'),
    JSON.stringify({ ...identity, ...value }),
  );
const snapshot = () => checkInputFingerprint(root, change, identity);

it('limits explicit paths but binds the declaration and dependency metadata', async () => {
  await writePolicy({ version: 1, files: ['input.txt'], git: 'none' });
  const first = await snapshot();
  await fs.writeFile(path.join(root, 'unrelated.md'), 'docs');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(path.join(root, 'input.txt'), 'changed');
  expect(await snapshot()).not.toBe(first);
  const second = await snapshot();
  await fs.appendFile(path.join(root, '.comet/check-policy.json'), '\n');
  expect(await snapshot()).not.toBe(second);
  const third = await snapshot();
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules/.modules.yaml'), 'changed');
  expect(await snapshot()).not.toBe(third);
});

it('normalizes only task checkboxes outside code fences, not task text', async () => {
  await writePolicy({ version: 1, git: 'none', taskCheckboxes: 'ignore' });
  const file = path.join(change, 'tasks.md');
  await fs.writeFile(file, '- [ ] implement\n```md\n- [ ] example\n```\n');
  const first = await snapshot();
  await fs.writeFile(file, '- [x] implement\n```md\n- [ ] example\n```\n');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(file, '- [x] implement\n```md\n- [x] example\n```\n');
  expect(await snapshot()).not.toBe(first);
  await fs.writeFile(file, '- [x] different requirement\n');
  expect(await snapshot()).not.toBe(first);
});

it('restricts environment only when declared and stores digests, not secrets', async () => {
  await writePolicy({ version: 1, env: ['COMET_TEST_REQUIRED'] });
  vi.stubEnv('COMET_TEST_REQUIRED', 'secret-one');
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'one');
  const policy = await readCheckPolicy(root, identity);
  const environment = () => checkEnvironmentFingerprint([process.execPath], root, policy);
  const first = await environment();
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'two');
  expect(await environment()).toBe(first);
  vi.stubEnv('COMET_TEST_REQUIRED', 'secret-two');
  expect(await environment()).not.toBe(first);
  expect(first).toMatch(/^[a-f0-9]{64}$/);
});

it('keeps conservative environment binding without a declaration', async () => {
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'one');
  const first = await checkEnvironmentFingerprint(
    [process.execPath],
    root,
    await readCheckPolicy(root),
  );
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'two');
  expect(
    await checkEnvironmentFingerprint([process.execPath], root, await readCheckPolicy(root)),
  ).not.toBe(first);
});

it('can opt out of staging and HEAD bindings without ignoring content', async () => {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  await writePolicy({ version: 1, git: 'none' });
  const first = await snapshot();
  git('add', 'input.txt');
  git('commit', '-m', 'baseline');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(path.join(root, 'input.txt'), 'different');
  expect(await snapshot()).not.toBe(first);
});

it('includes ignored literal inputs and rejects junctions in explicit paths', async () => {
  await fs.writeFile(path.join(root, '.gitignore'), 'input.txt\n');
  await writePolicy({ version: 1, files: ['input.txt'], git: 'none' });
  const first = await snapshot();
  await fs.writeFile(path.join(root, 'input.txt'), 'different');
  expect(await snapshot()).not.toBe(first);
  await fs.mkdir(path.join(root, 'real'));
  await fs.symlink(path.join(root, 'real'), path.join(root, 'alias'), 'junction');
  await writePolicy({ version: 1, files: ['alias/missing'], git: 'none' });
  await expect(snapshot()).rejects.toThrow(/symbolic|junction/i);
});

it.each([
  { version: 2 },
  { version: 1, files: ['../outside'] },
  { version: 1, files: ['*.ts'] },
  { version: 1, env: 'PATH' },
  { version: 1, git: false },
  { version: 1, typo: true },
  { version: 1, argv: undefined },
  { version: 1, cwd: undefined },
])('rejects invalid policy %j without relaxing defaults', async (policy) => {
  await writePolicy(policy);
  await expect(snapshot()).rejects.toThrow(/policy/i);
});

it.each([
  { argv: ['security-scan'], cwd: '.' },
  { argv: identity.argv, cwd: 'package' },
])('keeps unmatched command identity %j conservative', async (other) => {
  await writePolicy({
    version: 1,
    files: ['input.txt'],
    env: [],
    git: 'none',
    taskCheckboxes: 'ignore',
  });
  expect(await readCheckPolicy(root, other)).toMatchObject({
    git: 'all',
    taskCheckboxes: 'include',
  });
  const first = await checkInputFingerprint(root, change, other);
  await fs.writeFile(path.join(root, 'security.config'), 'changed');
  expect(await checkInputFingerprint(root, change, other)).not.toBe(first);
  expect((await readCheckPolicy(root, other)).env).toBeUndefined();
});
