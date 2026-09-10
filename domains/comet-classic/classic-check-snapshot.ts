import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readClassicState } from './classic-store.js';
import { readClassicProjectBytes, inspectClassicProjectTarget } from './classic-protected-path.js';
import { resolveWindowsCommand } from '../../platform/process/spawn-command.js';
import { readCheckPolicy, type CheckPolicy, type CheckIdentity } from './classic-check-policy.js';
import { classicTaskRequirements } from './classic-tasks.js';

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

export async function checkEnvironmentFingerprint(
  argv: string[],
  cwd: string,
  policy?: CheckPolicy,
): Promise<string> {
  const executable =
    process.platform === 'win32'
      ? resolveWindowsCommand(argv[0], process.env, cwd)
      : argv[0].includes('/')
        ? path.resolve(cwd, argv[0])
        : (
            await Promise.all(
              (process.env.PATH ?? '').split(path.delimiter).map(async (dir) => {
                const candidate = path.resolve(cwd, dir, argv[0]);
                return await fs.access(candidate, fs.constants.X_OK).then(
                  () => candidate,
                  () => null,
                );
              }),
            )
          ).find((candidate) => candidate !== null);
  const realExecutable = executable ? await fs.realpath(executable).catch(() => null) : null;
  const stat = realExecutable ? await fs.stat(realExecutable) : null;
  // Store only a digest, never environment values (which can contain credentials).
  return createHash('sha256')
    .update(
      JSON.stringify([
        process.platform,
        process.arch,
        process.execPath,
        process.version,
        argv,
        cwd,
        realExecutable,
        stat && [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino],
        Object.entries(process.env)
          .filter(
            ([name]) =>
              !policy?.env ||
              policy.env.some((key) =>
                process.platform === 'win32'
                  ? key.toLowerCase() === name.toLowerCase()
                  : key === name,
              ),
          )
          .sort(([a], [b]) => a.localeCompare(b)),
        ...(policy?.digest ? [policy.digest] : []),
      ]),
    )
    .digest('hex');
}

export async function checkInputFingerprint(
  root: string,
  changeDir: string,
  identity?: CheckIdentity,
): Promise<string> {
  const hash = createHash('sha256');
  const policy = await readCheckPolicy(root, identity);
  hash.update(policy.digest);
  const state = await readClassicState(changeDir, { migrate: false });
  const report = state.classic?.verificationReport;
  const reportPath = report && report.endsWith('.md') ? path.resolve(root, report) : null;
  const omitted = (absolute: string) =>
    absolute === path.join(changeDir, '.comet.yaml') ||
    absolute === path.join(changeDir, '.comet-state.lock') ||
    absolute === path.join(changeDir, '.comet-state-transaction.json') ||
    absolute.startsWith(path.join(changeDir, '.comet') + path.sep) ||
    absolute === reportPath ||
    absolute === path.join(root, '.comet', 'current-change.json');

  async function file(absolute: string): Promise<void> {
    if (omitted(absolute)) return;
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const stat = await fs.lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    hash.update(
      JSON.stringify([relative, stat?.mode ?? 'missing', stat?.isFile() ? stat.size : null]),
    );
    if (!stat) {
      await inspectClassicProjectTarget(root, absolute, {
        label: 'Classic check input',
        expected: 'any',
      });
      return;
    }
    if (stat.isSymbolicLink()) throw new Error(`Check input is a symbolic link: ${relative}`);
    if (stat.isDirectory()) {
      await inspectClassicProjectTarget(root, absolute, {
        label: 'Classic check input',
        expected: 'directory',
      });
      await tree(absolute);
      return;
    }
    const bytes = await readClassicProjectBytes(root, absolute, {
      label: 'Classic check input',
      maxBytes: 64 * 1024 * 1024,
    });
    hash.update(
      policy.taskCheckboxes === 'ignore' && absolute === path.join(changeDir, 'tasks.md')
        ? classicTaskRequirements(bytes.toString('utf8'))
        : bytes,
    );
  }

  async function tree(directory: string): Promise<void> {
    const isRepository =
      directory === root ||
      (await fs.lstat(path.join(directory, '.git')).then(
        () => true,
        () => false,
      ));
    const files = isRepository
      ? git(directory, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      : null;
    if (files !== null) {
      if (policy.git === 'all') hash.update(git(directory, ['rev-parse', 'HEAD']) ?? 'unborn');
      // Include the index separately: staging a different version is a changed input too.
      const index = policy.git === 'all' ? git(directory, ['ls-files', '--stage', '-z']) : '';
      if (index === null) throw new Error('Cannot inspect check input index');
      for (const entry of policy.git === 'all' ? index.split('\0').filter(Boolean) : []) {
        const name = entry.slice(entry.indexOf('\t') + 1);
        if (!omitted(path.resolve(directory, name))) hash.update(entry);
      }
      for (const name of [...new Set(files.split('\0').filter(Boolean))].sort()) {
        await file(path.resolve(directory, name));
      }
      return;
    }
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      await file(path.join(directory, entry.name));
    }
  }

  if (policy.files) {
    if (policy.git === 'all') {
      hash.update(git(root, ['rev-parse', 'HEAD']) ?? 'unborn');
      const index = git(root, ['ls-files', '--stage', '-z']);
      if (index !== null) {
        for (const entry of index.split('\0').filter(Boolean)) {
          if (!omitted(path.resolve(root, entry.slice(entry.indexOf('\t') + 1))))
            hash.update(entry);
        }
      }
    }
    for (const name of [...new Set(policy.files)].sort()) await file(path.resolve(root, name));
    await file(path.join(root, '.comet', 'config.yaml'));
  } else await tree(root);
  // The declaration is always bound, even when it is ignored by Git or omitted from files.
  if ((await readCheckPolicy(root, identity)).digest !== policy.digest)
    throw new Error('Classic check policy changed during snapshot');
  // Package-manager installation metadata is normally ignored by Git.
  for (const name of [
    'node_modules/.package-lock.json',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm/lock.yaml',
  ]) {
    await file(path.join(root, name));
  }
  return hash.digest('hex');
}
