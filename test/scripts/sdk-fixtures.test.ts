import { spawnSync, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = path.resolve('scripts/release/check-sdk-fixtures.mjs');
let root: string;
let baseline: string;
function git(...args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
async function commit() {
  git('add', '--all');
  git(
    '-c',
    'user.name=SDK fixture test',
    '-c',
    'user.email=sdk-ci@example.invalid',
    'commit',
    '-m',
    'test fixture',
  );
}
function check(base = baseline) {
  return spawnSync(process.execPath, [script, '--project-root', root, '--base', base], {
    encoding: 'utf8',
  });
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-ci-fixtures-'));
  git('init');
  await fs.mkdir(path.join(root, 'test/fixtures/runtime-sdk-v1'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'test/fixtures/runtime-sdk-v1/run.json'),
    '{"original":true}\n',
  );
  await commit();
  baseline = git('rev-parse', 'HEAD');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('accepts new versioned fixtures while retaining the baseline recovery snapshot', async () => {
  await fs.mkdir(path.join(root, 'test/fixtures/runtime-sdk-v2'));
  await fs.writeFile(path.join(root, 'test/fixtures/runtime-sdk-v2/run.json'), '{"new":true}\n');
  await commit();
  const result = check();
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
it.each(['rewrite', 'delete', 'rename', 'add-resource'])(
  'rejects %s of a baseline SDK snapshot without altering checkout files',
  async (operation) => {
    const file = path.join(root, 'test/fixtures/runtime-sdk-v1/run.json');
    if (operation === 'rewrite') await fs.writeFile(file, '{"recomputed":true}\n');
    if (operation === 'delete') await fs.unlink(file);
    if (operation === 'rename') await fs.rename(file, path.join(root, 'test/fixtures/moved.json'));
    if (operation === 'add-resource')
      await fs.writeFile(path.join(path.dirname(file), 'definition.json'), '{}\n');
    await commit();
    const head = git('rev-parse', 'HEAD');
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('runtime-sdk-v1');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('status', '--porcelain')).toBe('');
  },
);
it('fails closed when the declared base commit is unavailable', () => {
  const result = check('not-an-existing-ref');
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('比较基线');
});

it.each(['', '0'.repeat(40)])(
  'uses the fetched default branch for a manual or initial push base (%s)',
  (base) => {
    git('update-ref', 'refs/remotes/origin/master', baseline);
    const result = check(base);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  },
);
