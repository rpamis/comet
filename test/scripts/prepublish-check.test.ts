import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];
const prepublishCheck = path.resolve('scripts/release/prepublish-check.js');

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf-8');
}

async function makePackageFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-prepublish-check-'));
  temporary.push(root);

  await writeFile(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'comet-prepublish-check-fixture',
        version: '1.0.0',
        files: ['index.js', 'README.md'],
      },
      null,
      2,
    ),
  );
  await writeFile(root, 'README.md', '# Fixture\n');
  await writeFile(root, 'index.js', 'export const ok = true;\n');
  await writeFile(root, '.gitignore', ['eval/.cache/', 'eval/.pytest-basetemp-*/', ''].join('\n'));

  return root;
}

async function makePublishFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-publish-fixture-'));
  temporary.push(root);
  const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8')) as Record<
    string,
    unknown
  >;
  delete packageJson.scripts;
  await writeFile(root, 'package.json', JSON.stringify(packageJson, null, 2));
  await writeFile(root, 'README.md', '# Comet publish fixture\n');
  await writeFile(root, 'eval/pyproject.toml', '[project]\nname = "comet-eval-fixture"\n');
  await writeFile(root, 'eval/local/tests/tasks/test_tasks.py', 'def test_fixture(): pass\n');
  await writeFile(root, 'eval/.venv/ignored.txt', 'ignored\n');
  await writeFile(root, 'eval/.uv-cache/ignored.txt', 'ignored\n');
  await writeFile(root, 'eval/local/logs/ignored.txt', 'ignored\n');
  return root;
}

describe('prepublish security check', () => {
  it('packs the eval harness without derived artifacts', async () => {
    const root = await makePublishFixture();
    const npmCache = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-npm-cache-'));
    temporary.push(npmCache);
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `npm pack --dry-run --json --ignore-scripts --cache ${npmCache}`]
        : ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', npmCache];
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NPM_CONFIG_CACHE: npmCache,
        npm_config_cache: npmCache,
      },
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const jsonStart = result.stdout.lastIndexOf('\n[');
    const [packed] = JSON.parse(result.stdout.slice(jsonStart + 1)) as Array<{
      files: Array<{ path: string }>;
    }>;
    const published = packed.files.map((file) => `package/${file.path}`);

    expect(published).toContain('package/eval/pyproject.toml');
    expect(published).toContain('package/eval/local/tests/tasks/test_tasks.py');
    expect(published.some((file) => file.startsWith('package/eval/.venv/'))).toBe(false);
    expect(published.some((file) => file.startsWith('package/eval/.uv-cache/'))).toBe(false);
    expect(published.some((file) => file.startsWith('package/eval/local/logs/'))).toBe(false);
  });

  it('scans only files that npm would publish', async () => {
    const root = await makePackageFixture();
    await writeFile(
      root,
      'eval/.cache/langsmith-cc-plugin/src/langsmith.test.ts',
      'const api_key = "abcdefghijklmnopqrstuvwxyz";\n',
    );
    await writeFile(
      root,
      'eval/.pytest-basetemp-ci-green/token.txt',
      'const api_key = "abcdefghijklmnopqrstuvwxyz";\n',
    );

    const result = spawnSync(process.execPath, [prepublishCheck], {
      cwd: root,
      encoding: 'utf-8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stderr).not.toContain('[SECURITY]');
  });
});
