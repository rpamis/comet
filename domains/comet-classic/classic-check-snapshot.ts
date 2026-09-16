import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readClassicState } from './classic-store.js';
import { readClassicProjectBytes, inspectClassicProjectTarget } from './classic-protected-path.js';
import { resolveWindowsCommand } from '../../platform/process/spawn-command.js';
import { readCheckPolicy, type CheckPolicy, type CheckIdentity } from './classic-check-policy.js';
import { classicTaskRequirements } from './classic-tasks.js';
import {
  compileCheckPolicyPattern,
  hasGlobCharacters,
  serializeCheckManifest,
  type CheckManifestEntry,
} from './classic-check-manifest.js';

function git(root: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

/**
 * The declaration binding folded into evidence digests. Legacy evidence always
 * binds the whole file; current evidence binds the matched command entry when
 * the declaration is a v2 multi-command policy, so unrelated entries can
 * change without invalidating this command's recorded checks.
 */
function bindingDigest(policy: CheckPolicy | undefined, legacy: boolean): string {
  if (legacy) return policy?.digest ?? '';
  return policy?.entryDigest ?? policy?.digest ?? '';
}

export async function checkEnvironmentFingerprint(
  argv: string[],
  cwd: string,
  policy?: CheckPolicy,
  legacy = false,
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
  // Without a declared binding, current records bind no environment variable;
  // the legacy flag keeps pre-manifest evidence bound to all of them.
  const declaredEnv = policy?.env;
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
          .filter(([name]) =>
            declaredEnv
              ? declaredEnv.some((key) =>
                  process.platform === 'win32'
                    ? key.toLowerCase() === name.toLowerCase()
                    : key === name,
                )
              : legacy,
          )
          .sort(([a], [b]) => a.localeCompare(b)),
        ...(bindingDigest(policy, legacy) ? [bindingDigest(policy, legacy)] : []),
      ]),
    )
    .digest('hex');
}

export interface CheckSnapshot {
  digest: string;
  entries: CheckManifestEntry[];
  /** Deterministic per-file serialization of `entries`; persisted next to the check log. */
  manifest: string;
}

export interface CheckSnapshotOptions {
  /**
   * Recorded entries from the check execution. Files whose stat identity still
   * matches the baseline reuse the recorded content hash without rereading.
   */
  baseline?: CheckManifestEntry[];
  /** Content hash cache keyed by path and stat identity, shareable across revalidations. */
  contentCache?: Map<string, string>;
  /**
   * Pre-manifest binding semantics: records recorded before per-file manifests
   * existed bound HEAD, the index and every environment variable by default.
   */
  legacy?: boolean;
}

export async function collectCheckSnapshot(
  root: string,
  changeDir: string,
  identity?: CheckIdentity,
  options: CheckSnapshotOptions = {},
): Promise<CheckSnapshot> {
  root = path.resolve(root);
  changeDir = path.resolve(changeDir);
  const legacy = options.legacy === true;
  const hash = createHash('sha256');
  const policy = await readCheckPolicy(root, identity, legacy);
  hash.update(bindingDigest(policy, legacy));
  const entries: CheckManifestEntry[] = [];
  const baseline = options.baseline ? new Map(options.baseline.map((e) => [e.p, e])) : null;
  const contentCache = options.contentCache ?? new Map<string, string>();
  const state = await readClassicState(changeDir, { migrate: false });
  const report = state.classic?.verificationReport;
  const reportPath = report && report.endsWith('.md') ? path.resolve(root, report) : null;
  const rootVariants = [root, await fs.realpath(root).catch(() => root)];
  const isWithinRoot = (candidate: string, base = root): boolean => {
    const relative = path.relative(base, candidate);
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  // Some package managers and build tools write caches below the process home.
  // Test runners may place that home inside the temporary project, so it must
  // not make an otherwise stable check input look changed between snapshots.
  const configuredHomes = [process.env.HOME, process.env.USERPROFILE].filter(
    (value): value is string => Boolean(value),
  );
  const processHomeRoots = [
    ...new Set(
      (
        await Promise.all(
          configuredHomes.map(async (value) => {
            const home = path.resolve(value);
            return [home, await fs.realpath(home).catch(() => home)];
          }),
        )
      ).flat(),
    ),
  ].filter((home) => rootVariants.some((base) => home !== base && isWithinRoot(home, base)));
  const omitted = (absolute: string) =>
    processHomeRoots.some((home) => absolute === home || absolute.startsWith(home + path.sep)) ||
    absolute === path.join(changeDir, '.comet.yaml') ||
    absolute === path.join(changeDir, '.comet-state.lock') ||
    absolute === path.join(changeDir, '.comet-state-transaction.json') ||
    absolute.startsWith(path.join(changeDir, '.comet') + path.sep) ||
    absolute === reportPath ||
    absolute === path.join(root, '.comet', 'current-change.json');

  const gitKey = (directory: string) => path.relative(root, directory).replaceAll('\\', '/') || '.';

  /** Enumerates repository-relative file paths exactly as the tree walk visits them. */
  async function enumerateTree(base: string): Promise<string[]> {
    const results: string[] = [];
    async function walk(directory: string): Promise<void> {
      const isRepository =
        directory === base ||
        (await fs.lstat(path.join(directory, '.git')).then(
          () => true,
          () => false,
        ));
      const files = isRepository
        ? git(directory, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        : null;
      const prefix = path.relative(base, directory).replaceAll('\\', '/');
      if (files !== null) {
        for (const name of [...new Set(files.split('\0').filter(Boolean))].sort()) {
          results.push(prefix ? `${prefix}/${name}` : name);
        }
        return;
      }
      for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(directory, entry.name));
        else results.push(relative);
      }
    }
    await walk(base);
    return results;
  }

  async function file(absolute: string): Promise<void> {
    if (omitted(absolute)) return;
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const stat = await fs
      .lstat(absolute, { bigint: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    hash.update(
      JSON.stringify([
        relative,
        stat ? Number(stat.mode) : 'missing',
        stat && stat.isFile() ? Number(stat.size) : null,
      ]),
    );
    if (!stat) {
      entries.push({ p: relative, h: 'missing', s: null, m: null });
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
    const bound =
      policy.taskCheckboxes === 'ignore' && absolute === path.join(changeDir, 'tasks.md')
        ? classicTaskRequirements(bytes.toString('utf8'))
        : bytes;
    hash.update(bound);
    const cacheKey = `${relative}|${stat.size}|${stat.mtimeNs}|${stat.mode}`;
    let contentHash = contentCache.get(cacheKey);
    if (!contentHash) {
      const recorded = baseline?.get(relative);
      if (
        recorded &&
        recorded.h !== 'missing' &&
        recorded.s === Number(stat.size) &&
        recorded.m === stat.mtimeNs.toString()
      ) {
        contentHash = recorded.h;
      } else {
        contentHash = createHash('sha256').update(bound).digest('hex');
      }
      contentCache.set(cacheKey, contentHash);
    }
    entries.push({
      p: relative,
      h: contentHash,
      s: Number(stat.size),
      m: stat.mtimeNs.toString(),
    });
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
      if (policy.git === 'all') {
        const head = git(directory, ['rev-parse', 'HEAD']) ?? 'unborn';
        hash.update(head);
        entries.push({
          p: `\u0000git:${gitKey(directory)}:head`,
          h: head.trim(),
          s: null,
          m: null,
        });
      }
      // Include the index separately: staging a different version is a changed input too.
      const index = policy.git === 'all' ? git(directory, ['ls-files', '--stage', '-z']) : '';
      if (index === null) throw new Error('Cannot inspect check input index');
      if (policy.git === 'all') {
        for (const entry of index.split('\0').filter(Boolean)) {
          const name = entry.slice(entry.indexOf('\t') + 1);
          if (!omitted(path.resolve(directory, name))) {
            hash.update(entry);
            entries.push({
              p: `\u0000git:${gitKey(directory)}:index:${name}`,
              h: entry.slice(0, entry.indexOf('\t')).split(' ')[1],
              s: null,
              m: null,
            });
          }
        }
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
      const head = git(root, ['rev-parse', 'HEAD']) ?? 'unborn';
      hash.update(head);
      entries.push({ p: '\u0000git:.:head', h: head.trim(), s: null, m: null });
      const index = git(root, ['ls-files', '--stage', '-z']);
      if (index !== null) {
        for (const entry of index.split('\0').filter(Boolean)) {
          if (!omitted(path.resolve(root, entry.slice(entry.indexOf('\t') + 1)))) {
            hash.update(entry);
            entries.push({
              p: `\u0000git:.:index:${entry.slice(entry.indexOf('\t') + 1)}`,
              h: entry.slice(0, entry.indexOf('\t')).split(' ')[1],
              s: null,
              m: null,
            });
          }
        }
      }
    }
    const patterns = policy.files
      .filter((file) => hasGlobCharacters(file))
      .map((pattern) => compileCheckPolicyPattern(pattern));
    if (!patterns.length) {
      for (const name of [...new Set(policy.files)].sort()) await file(path.resolve(root, name));
    } else {
      const literals = new Set(policy.files.filter((name) => !hasGlobCharacters(name)));
      const matches = new Set<string>();
      const relativeMatches = await enumerateTree(root);
      for (const relative of relativeMatches) {
        const absolute = path.resolve(root, relative);
        if (omitted(absolute)) continue;
        if (literals.has(relative) || patterns.some((match) => match(relative)))
          matches.add(relative);
      }
      for (const name of [...literals].sort()) await file(path.resolve(root, name));
      for (const relative of [...matches].sort()) await file(path.resolve(root, relative));
    }
    await file(path.join(root, '.comet', 'config.yaml'));
  } else await tree(root);
  // The declaration is always bound, even when it is ignored by Git or omitted from files.
  if (
    bindingDigest(await readCheckPolicy(root, identity, legacy), legacy) !==
    bindingDigest(policy, legacy)
  )
    throw new Error('Classic check policy changed during snapshot');
  // Package-manager installation metadata is normally ignored by Git.
  for (const name of [
    'node_modules/.package-lock.json',
    'node_modules/.modules.yaml',
    'node_modules/.pnpm/lock.yaml',
  ]) {
    await file(path.join(root, name));
  }
  return { digest: hash.digest('hex'), entries, manifest: serializeCheckManifest(entries) };
}

export async function checkInputFingerprint(
  root: string,
  changeDir: string,
  identity?: CheckIdentity,
): Promise<string> {
  return (await collectCheckSnapshot(root, changeDir, identity)).digest;
}

/** Digest with the pre-manifest default bindings, for evidence recorded before manifests existed. */
export async function legacyCheckInputFingerprint(
  root: string,
  changeDir: string,
  identity?: CheckIdentity,
): Promise<string> {
  return (await collectCheckSnapshot(root, changeDir, identity, { legacy: true })).digest;
}
