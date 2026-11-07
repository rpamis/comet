import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRepositoryPath } from '../lib/repository-layout.mjs';

export async function buildCodexCliPackage(outputRoot, version) {
  const root = resolveRepositoryPath('.');
  await fs.access(path.join(root, 'dist/app/cli/index.js')).catch(() => {
    throw new Error('Run pnpm build before packaging the Comet CLI');
  });
  const { resolveNpmCommand } = await import(
    pathToFileURL(path.join(root, 'dist/platform/process/node-cli-command.js')).href
  );
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-package-'));
  const stage = path.join(temporary, 'package');
  await fs.mkdir(stage);
  const runNpm = (cwd, args) => {
    const command = resolveNpmCommand(args, { cwd });
    const stdout = execFileSync(command.command, command.args, {
      cwd,
      env: command.env ?? process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    const start = stdout.search(/\[\s*\{/u);
    if (start < 0) throw new Error('npm pack did not return a package inventory');
    return JSON.parse(stdout.slice(start))[0];
  };
  try {
    const inventory = runNpm(root, ['pack', '--dry-run', '--json', '--ignore-scripts']);
    for (const file of inventory.files) {
      if (/^dist\/(?:codex-plugin|dsh-plugin)(?:\/|$)/u.test(file.path)) continue;
      const relative = path.normalize(file.path);
      if (path.isAbsolute(relative) || relative.startsWith('..'))
        throw new Error('npm package input escapes repository');
      const source = path.join(root, relative);
      if ((await fs.lstat(source)).isSymbolicLink())
        throw new Error(`npm package input must not be a symlink: ${relative}`);
      const destination = path.join(stage, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    // npm pack 仍会定位 prepare；该脚本在禁用生命周期时立即返回，不进入发布清单。
    await fs.mkdir(path.join(stage, 'scripts/release'), { recursive: true });
    await fs.copyFile(
      path.join(root, 'scripts/release/prepare.js'),
      path.join(stage, 'scripts/release/prepare.js'),
    );
    const packed = runNpm(stage, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      temporary,
    ]);
    if (packed.name !== '@rpamis/comet' || packed.version !== version)
      throw new Error('Bundled npm package version does not match the plugin');
    await fs.mkdir(outputRoot, { recursive: true });
    const bytes = await fs.readFile(path.join(temporary, packed.filename));
    await fs.writeFile(path.join(outputRoot, 'comet-cli.tgz'), bytes);
    await fs.writeFile(
      path.join(outputRoot, 'cli-package.json'),
      JSON.stringify(
        { name: packed.name, version, sha256: createHash('sha256').update(bytes).digest('hex') },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
