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

it('normalizes task checkboxes by default and restores sensitivity on request', async () => {
  await writePolicy({ version: 1, git: 'none', taskCheckboxes: 'ignore' });
  const file = path.join(change, 'tasks.md');
  await fs.writeFile(file, '- [ ] implement\n```md\n- [ ] example\n```\n');
  const first = await snapshot();
  await fs.writeFile(file, '- [x] implement\n```md\n- [ ] example\n```\n');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(file, '- [x] implement\n```md\n- [x] example\n```\n');
  expect(await snapshot()).not.toBe(first);
  await writePolicy({ version: 1, git: 'none', taskCheckboxes: 'include' });
  await fs.writeFile(file, '- [ ] implement\n');
  const second = await snapshot();
  await fs.writeFile(file, '- [x] implement\n');
  expect(await snapshot()).not.toBe(second);
});

it('keeps working-tree content as the default input across commits and ticks', async () => {
  const gitExec = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  gitExec('init');
  gitExec('config', 'user.email', 'test@example.com');
  gitExec('config', 'user.name', 'Test');
  const file = path.join(change, 'tasks.md');
  await fs.writeFile(file, '- [ ] implement\n');
  const first = await snapshot();
  gitExec('add', '-A');
  gitExec('commit', '-m', 'baseline');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(file, '- [x] implement\n');
  expect(await snapshot()).toBe(first);
  await fs.writeFile(path.join(root, 'input.txt'), 'changed');
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

it('binds no environment variable without a declaration; legacy evidence keeps full binding', async () => {
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'one');
  const current = async () =>
    checkEnvironmentFingerprint([process.execPath], root, await readCheckPolicy(root));
  const first = await current();
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'two');
  expect(await current()).toBe(first);
  const legacy = async () =>
    checkEnvironmentFingerprint(
      [process.execPath],
      root,
      await readCheckPolicy(root, undefined, true),
      true,
    );
  const legacyFirst = await legacy();
  vi.stubEnv('COMET_TEST_IRRELEVANT', 'three');
  expect(await legacy()).not.toBe(legacyFirst);
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
])('keeps unmatched command identity %j on the default bindings', async (other) => {
  await writePolicy({
    version: 1,
    files: ['input.txt'],
    env: [],
    git: 'all',
    taskCheckboxes: 'include',
  });
  expect(await readCheckPolicy(root, other)).toMatchObject({
    git: 'none',
    taskCheckboxes: 'ignore',
  });
  const first = await checkInputFingerprint(root, change, other);
  await fs.writeFile(path.join(root, 'security.config'), 'changed');
  expect(await checkInputFingerprint(root, change, other)).not.toBe(first);
  expect((await readCheckPolicy(root, other)).env).toBeUndefined();
});

const writeRawPolicy = (value: unknown) =>
  fs.writeFile(path.join(root, '.comet/check-policy.json'), JSON.stringify(value));

const v2Commands = (
  first: Record<string, unknown> = {},
  secondFiles: string[] = ['other.txt'],
) => ({
  version: 2,
  commands: [
    { argv: identity.argv, cwd: '.', files: ['input.txt', 'src/**'], git: 'all', ...first },
    { argv: ['node', 'other.mjs'], cwd: '.', files: secondFiles },
  ],
});

it('resolves the matching v2 command entry and binds its digest', async () => {
  await writeRawPolicy(v2Commands());
  const policy = await readCheckPolicy(root, identity);
  expect(policy).toMatchObject({ git: 'all', files: ['input.txt', 'src/**'] });
  expect(policy.entryDigest).toMatch(/^[a-f0-9]{64}$/);
  const other = { argv: ['node', 'other.mjs'], cwd: '.' };
  const otherPolicy = await readCheckPolicy(root, other);
  expect(otherPolicy).toMatchObject({ files: ['other.txt'], git: 'none' });
  expect(otherPolicy.entryDigest).not.toBe(policy.entryDigest);
  const unmatched = await readCheckPolicy(root, { argv: ['nope'], cwd: '.' });
  expect(unmatched.entryDigest).toBeUndefined();
  expect(unmatched).toMatchObject({ git: 'none', taskCheckboxes: 'ignore' });
});

it('keeps evidence stable when an unrelated v2 entry changes', async () => {
  await writeRawPolicy(v2Commands());
  const first = await snapshot();
  await fs.writeFile(path.join(root, 'other.txt'), 'changed');
  expect(await snapshot()).toBe(first);
  await writeRawPolicy(v2Commands({}, ['other.txt', 'extra.txt']));
  expect(await snapshot()).toBe(first);
  await fs.writeFile(path.join(root, 'input.txt'), 'changed');
  expect(await snapshot()).not.toBe(first);
});

it('binds glob-matched files including ones created after the declaration', async () => {
  await writeRawPolicy(v2Commands());
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'one');
  const first = await snapshot();
  await fs.writeFile(path.join(root, 'src', 'a.ts'), 'two');
  expect(await snapshot()).not.toBe(first);
  const second = await snapshot();
  await fs.mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'nested', 'b.ts'), 'new');
  expect(await snapshot()).not.toBe(second);
  const third = await snapshot();
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs', 'outside.md'), 'unrelated');
  expect(await snapshot()).toBe(third);
});

it.each([
  { version: 2, commands: [], note: 'empty' },
  { version: 2, commands: [{ argv: ['node', 'a.mjs'] }], note: 'missing cwd' },
  { version: 2, commands: [{ argv: ['x'], cwd: '.', typo: 1 }], note: 'unknown field' },
  {
    version: 2,
    commands: [
      { argv: ['node', 'a.mjs'], cwd: '.' },
      { argv: ['node', 'a.mjs'], cwd: '.' },
    ],
    note: 'duplicate identity',
  },
  { version: 2, commands: [{ argv: ['x'], cwd: '.', files: ['../outside'] }], note: 'unsafe' },
  { version: 2, extra: true, commands: [{ argv: ['x'], cwd: '.' }], note: 'unknown top level' },
])('rejects invalid v2 policy (%s)', async (policy) => {
  await writeRawPolicy(policy);
  await expect(snapshot()).rejects.toThrow(/policy/i);
});
