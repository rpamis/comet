import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
  await expect(readCheckPolicy(root, identity)).rejects.toThrow(/policy/i);
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

it('resolves the matching v2 command entry', async () => {
  await writeRawPolicy(v2Commands());
  const policy = await readCheckPolicy(root, identity);
  expect(policy).toMatchObject({ git: 'all', files: ['input.txt', 'src/**'] });
  const other = { argv: ['node', 'other.mjs'], cwd: '.' };
  const otherPolicy = await readCheckPolicy(root, other);
  expect(otherPolicy).toMatchObject({ files: ['other.txt'], git: 'none' });
  const unmatched = await readCheckPolicy(root, { argv: ['nope'], cwd: '.' });
  expect(unmatched).toMatchObject({ git: 'none', taskCheckboxes: 'ignore' });
});

it('keeps the selected policy unchanged when another command declaration changes', async () => {
  await writeRawPolicy(v2Commands());
  const first = await readCheckPolicy(root, identity);
  await writeRawPolicy(v2Commands({}, ['other.txt', 'extra.txt']));
  expect(await readCheckPolicy(root, identity)).toMatchObject({
    files: first.files,
    git: first.git,
    declaredCwd: first.declaredCwd,
  });
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
  await expect(readCheckPolicy(root, identity)).rejects.toThrow(/policy/i);
});
