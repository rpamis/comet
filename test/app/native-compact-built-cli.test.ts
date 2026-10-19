import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('runs compact Native status through the real bin and independent bundle in a relocated package', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'comet-compact-package-'));
  try {
    const packageRoot = path.join(root, 'package');
    const project = path.join(root, 'project');
    const home = path.join(root, 'home');
    await Promise.all(
      [packageRoot, project, home].map((directory) => mkdir(directory, { recursive: true })),
    );
    await cp(path.resolve('bin'), path.join(packageRoot, 'bin'), { recursive: true });
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'comet-compact-fixture', type: 'module' }),
    );
    const scripts = path.join(packageRoot, 'assets/skills/comet-native/scripts');
    await mkdir(scripts, { recursive: true });
    for (const command of ['init', 'status']) {
      await build({
        entryPoints: [path.resolve(`domains/comet-native/native-${command}-entry.ts`)],
        outfile: path.join(scripts, `comet-native-${command}.mjs`),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        minify: true,
        define: { __COMET_VERSION__: JSON.stringify('0.5.0') },
        banner: {
          js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
        },
      });
    }
    const run = (...args: string[]) =>
      spawnSync(
        process.execPath,
        [path.join(packageRoot, 'bin/comet.js'), 'native', ...args, '--project-root', project],
        {
          cwd: project,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: home,
            USERPROFILE: home,
            COMET_DAEMON: 'off',
            COMET_TASK: '',
          },
        },
      );
    const init = run('init', '--json', '--compact');
    expect(init.stderr).toBe('');
    expect(init.status, init.stdout).toBe(0);
    expect(JSON.parse(init.stdout).exitCode).toBe(0);
    const full = run('status', '--json');
    const compact = run('status', '--json', '--compact');
    expect(full.status, full.stdout).toBe(0);
    expect(compact.status, compact.stdout).toBe(0);
    expect(compact.stderr).toBe('');
    expect(JSON.parse(full.stdout)).not.toHaveProperty('outputView');
    expect(JSON.parse(compact.stdout)).toMatchObject({
      command: 'status',
      exitCode: 0,
    });
    const invalid = run('status', '--compact');
    expect(invalid.status).toBe(64);
    expect(invalid.stderr).toContain('--compact requires --json');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
