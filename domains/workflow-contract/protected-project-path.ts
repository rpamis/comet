import { promises as fs } from 'fs';
import path from 'path';

import {
  hashFileRaceSafe,
  readFileRaceSafe,
  type RaceSafeHashResult,
  type RaceSafeReadOptions,
  type RaceSafeReadResult,
} from '../../platform/fs/race-safe-read.js';
import { normalizeWorkflowRelativePath } from './project-config.js';
import { memoizedHookRead, memoizedHookReadSync } from '../../platform/process/hook-read-cache.js';

export type ProtectedProjectPathKind = 'missing' | 'file' | 'directory';

export interface ProtectedProjectPathInspection {
  projectRoot: string;
  target: string;
  relative: string;
  exists: boolean;
  kind: ProtectedProjectPathKind;
}

/** 单次文件观察共用目录身份；叶子仍新鲜读取，返回结果前必须 finish。 */
export async function createProtectedProjectReadSession(
  projectRoot: string,
  label: string,
  options: {
    ignoredDirectoryEntries?: (
      directoryRef: string,
    ) => ((entry: import('node:fs').Dirent) => boolean) | undefined;
  } = {},
) {
  const root = path.resolve(projectRoot);
  const realRoot = await assertRealProjectRoot(root, label);
  const directories = new Map<
    string,
    Promise<{
      stat: import('node:fs').BigIntStats;
      real: string;
      namespace?: string;
      ignoreEntry?: (entry: import('node:fs').Dirent) => boolean;
    }>
  >();
  let finished = false;
  const identity = (stat: import('node:fs').BigIntStats) =>
    [stat.dev, stat.ino, stat.mode, stat.birthtimeNs, stat.mtimeNs, stat.ctimeNs].join(':');
  const directoryIdentity = (stat: import('node:fs').BigIntStats) =>
    [stat.dev, stat.ino, stat.mode, stat.birthtimeNs].join(':');
  const namespace = async (
    target: string,
    ignoreEntry: (entry: import('node:fs').Dirent) => boolean,
  ) =>
    JSON.stringify(
      (await fs.readdir(target, { withFileTypes: true }))
        .filter((entry) => !ignoreEntry(entry))
        .map((entry) => [entry.name, entry.isDirectory(), entry.isSymbolicLink()])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en')),
    );
  const directory = (target: string) => {
    let pending = directories.get(target);
    if (!pending) {
      pending = (async () => {
        const stat = await fs.lstat(target, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error(
            `${label} crosses a symbolic link, junction or invalid directory at ${path.relative(root, target) || '.'}`,
          );
        const real = await fs.realpath(target);
        if (!isInside(realRoot, real))
          throw new Error(`${label} resolves outside the project root`);
        const ignoreEntry = options.ignoredDirectoryEntries?.(
          path.relative(root, target).replaceAll('\\', '/') || '.',
        );
        return {
          stat,
          real,
          ...(ignoreEntry ? { ignoreEntry, namespace: await namespace(target, ignoreEntry) } : {}),
        };
      })();
      directories.set(target, pending);
    }
    return pending;
  };
  await directory(root);
  const targetFor = async (relativePath: string) => {
    if (finished) throw new Error(`${label} read session is already finished`);
    const ref = normalizeWorkflowRelativePath(relativePath, label);
    let parent = root;
    for (const segment of ref.split('/').slice(0, -1)) {
      parent = path.join(parent, segment);
      await directory(parent);
    }
    return path.resolve(root, ...ref.split('/'));
  };
  return {
    observePath: targetFor,
    async observeDirectory(relativePath: string) {
      const target = await targetFor(relativePath);
      await directory(target);
      return target;
    },
    async stat(relativePath: string) {
      const target = await targetFor(relativePath);
      const stat = await fs.lstat(target, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error(`${label} must be a real file: ${relativePath}`);
      return { target, stat };
    },
    async hash(relativePath: string): Promise<RaceSafeHashResult> {
      const target = await targetFor(relativePath);
      return hashFileRaceSafe(target, {
        bigint: true,
        label: `${label} ${relativePath}`,
        verify: async (_checkpoint, context) => {
          if (!isInside(realRoot, context.realPath))
            throw new Error(`${label} resolves outside the project root`);
          let cursor = root;
          const parents = [root];
          for (const segment of path
            .relative(root, path.dirname(target))
            .split(path.sep)
            .filter(Boolean)) {
            cursor = path.join(cursor, segment);
            parents.push(cursor);
          }
          for (const parent of parents) {
            const before = await directories.get(parent)!;
            const current = await fs.lstat(parent, { bigint: true });
            if (
              !current.isDirectory() ||
              current.isSymbolicLink() ||
              directoryIdentity(current) !== directoryIdentity(before.stat)
            )
              throw new Error(
                `${label} directory changed while reading: ${path.relative(root, parent) || '.'}`,
              );
          }
        },
      });
    },
    async finish() {
      if (finished) throw new Error(`${label} read session is already finished`);
      finished = true;
      const changedDirectories: string[] = [];
      for (const [target, pending] of directories) {
        const before = await pending;
        const current = await fs.lstat(target, { bigint: true });
        if (
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          directoryIdentity(before.stat) !== directoryIdentity(current) ||
          (identity(before.stat) !== identity(current) &&
            (!before.ignoreEntry ||
              (await namespace(target, before.ignoreEntry)) !== before.namespace)) ||
          (await fs.realpath(target)) !== before.real
        )
          throw new Error(
            `${label} directory changed while observing: ${path.relative(root, target) || '.'}`,
          );
        if (identity(before.stat) !== identity(current))
          changedDirectories.push(path.relative(root, target).replaceAll('\\', '/') || '.');
      }
      return { changedDirectories };
    },
  };
}

export async function hashProtectedProjectFile(
  projectRoot: string,
  relativePath: string,
  options: Omit<RaceSafeReadOptions, 'verify'> & { label: string },
): Promise<RaceSafeHashResult> {
  const inspection = await inspectProtectedProjectPath(projectRoot, relativePath, {
    label: options.label,
    expected: 'file',
  });
  if (!inspection.exists) {
    const error = new Error(`${options.label} does not exist`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }
  const realRoot = await assertRealProjectRoot(inspection.projectRoot, options.label);
  return hashFileRaceSafe(inspection.target, {
    ...options,
    verify: async (_checkpoint, context) => {
      if (!isInside(realRoot, context.realPath)) {
        throw new Error(`${options.label} resolves outside the project root`);
      }
      await inspectExistingChain(inspection.projectRoot, realRoot, inspection.relative.split('/'), {
        label: options.label,
        expected: 'file',
      });
    },
  });
}

export interface ProtectedProjectPathOptions {
  label: string;
  expected?: 'file' | 'directory' | 'any';
}

export interface ProtectedProjectInstructionPath {
  projectRoot: string;
  target: string;
  relative: string;
  exists: boolean;
}

const PROJECT_INSTRUCTION_ALIASES = new Map([
  ['AGENTS.md', 'CLAUDE.md'],
  ['CLAUDE.md', 'AGENTS.md'],
]);

function isMissingPath(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

// Per-decision memoization for the chain verification reads: one probe or
// Hook decision re-verifies the same ancestor prefixes hundreds of times.
// Outside an active read-cache scope (CLI writes, receipt hashing) these
// wrappers are pass-through, so verification semantics stay unchanged there.
const cachedChainLstat = memoizedHookRead('protectedChainLstat', (target: string) =>
  fs.lstat(target),
);
const cachedChainRealpath = memoizedHookRead('protectedChainRealpath', (target: string) =>
  fs.realpath(target),
);
// 两个参数均为 realpath 返回的完整绝对路径，不含 NUL。
// 只复用字符串比较；调用者仍逐个检查路径链节点。
const cachedChainInside = memoizedHookReadSync('protectedChainInside', isInside);

async function assertRealProjectRoot(projectRoot: string, label: string): Promise<string> {
  const lexicalRoot = path.resolve(projectRoot);
  const stat = await cachedChainLstat(lexicalRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} project root must be a real directory`);
  }
  return cachedChainRealpath(lexicalRoot);
}

async function inspectExistingChain(
  lexicalRoot: string,
  realRoot: string,
  segments: readonly string[],
  options: ProtectedProjectPathOptions,
): Promise<{ exists: boolean; kind: ProtectedProjectPathKind }> {
  let cursor = lexicalRoot;
  for (let index = 0; index < segments.length; index++) {
    cursor = path.join(cursor, segments[index]);
    let stat;
    try {
      stat = await cachedChainLstat(cursor);
    } catch (error) {
      if (isMissingPath(error)) return { exists: false, kind: 'missing' };
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
      throw new Error(`${options.label} crosses a symbolic link or junction at ${display}`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
      throw new Error(`${options.label} ancestor ${display} must be a real directory`);
    }
    if (
      final &&
      ((options.expected === 'file' && !stat.isFile()) ||
        (options.expected === 'directory' && !stat.isDirectory()) ||
        (options.expected === 'any' && !stat.isFile() && !stat.isDirectory()))
    ) {
      throw new Error(`${options.label} must be a real ${options.expected}`);
    }
    const realCursor = await cachedChainRealpath(cursor);
    if (!cachedChainInside(realRoot, realCursor)) {
      throw new Error(`${options.label} resolves outside the project root`);
    }
    if (final) {
      return {
        exists: true,
        kind: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'missing',
      };
    }
  }
  return { exists: true, kind: 'directory' };
}

/**
 * Resolve a project-relative path while rejecting lexical traversal, special
 * filesystem objects, symlink/junction ancestors, and physical root escapes.
 */
async function inspectProtectedProjectPathUncached(
  projectRoot: string,
  relativePath: string,
  options: ProtectedProjectPathOptions,
): Promise<ProtectedProjectPathInspection> {
  const relative = normalizeWorkflowRelativePath(relativePath, options.label);
  const lexicalRoot = path.resolve(projectRoot);
  const realRoot = await assertRealProjectRoot(lexicalRoot, options.label);
  const segments = relative.split('/');
  const target = path.resolve(lexicalRoot, ...segments);
  if (!isInside(lexicalRoot, target)) {
    throw new Error(`${options.label} must stay inside the project root`);
  }
  const result = await inspectExistingChain(lexicalRoot, realRoot, segments, options);
  return {
    projectRoot: lexicalRoot,
    target,
    relative,
    exists: result.exists,
    kind: result.kind,
  };
}

// Whole-inspection memoization: one probe decision asks about the same
// (root, path, expectation) many times through exists/read wrappers; the
// per-level stat cache below still pays path math and promise chains. The
// label is deliberately not part of the key — it only shapes error wording,
// and rejections are not cached by the read-cache contract anyway. Outside an
// active read-cache scope every call inspects unchanged.
const cachedInspectProtectedProjectPath = memoizedHookRead(
  'protectedInspectPath',
  (projectRoot: string, relativePath: string, expected: string) =>
    inspectProtectedProjectPathUncached(projectRoot, relativePath, {
      label: 'Protected project path',
      expected: expected as ProtectedProjectPathOptions['expected'],
    }),
);

export async function inspectProtectedProjectPath(
  projectRoot: string,
  relativePath: string,
  options: ProtectedProjectPathOptions,
): Promise<ProtectedProjectPathInspection> {
  if (options.expected === undefined)
    return inspectProtectedProjectPathUncached(projectRoot, relativePath, options);
  try {
    return await cachedInspectProtectedProjectPath(projectRoot, relativePath, options.expected);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Protected project path')) {
      error.message = error.message.replaceAll('Protected project path', options.label);
    }
    throw error;
  }
}

/**
 * Resolve one of the two project instruction files without following an
 * arbitrary link. Some repositories keep a single instruction file and link
 * AGENTS.md to CLAUDE.md (or the reverse); that alias is safe only when the
 * target is the other instruction file in this same project root.
 */
export async function resolveProtectedProjectInstructionPath(
  projectRoot: string,
  relativePath: string,
): Promise<ProtectedProjectInstructionPath> {
  const relative = normalizeWorkflowRelativePath(relativePath, 'project instruction file');
  const aliasTarget = PROJECT_INSTRUCTION_ALIASES.get(relative);
  if (!aliasTarget) {
    throw new Error(`project instruction file must be AGENTS.md or CLAUDE.md: ${relative}`);
  }

  const requestedRoot = path.resolve(projectRoot);
  const rootStat = await fs.stat(requestedRoot);
  if (!rootStat.isDirectory()) {
    throw new Error('project instruction file project root must be a directory');
  }
  // A registered project may be reached through a directory junction or
  // symlink. Canonicalize that root first; only file aliases are restricted to
  // the AGENTS.md/CLAUDE.md pair below.
  const lexicalRoot = await fs.realpath(requestedRoot);
  const realRoot = lexicalRoot;
  const target = path.resolve(lexicalRoot, relative);
  if (!isInside(lexicalRoot, target)) {
    throw new Error(`project instruction file must stay inside the project root: ${relative}`);
  }

  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (isMissingPath(error)) {
      return { projectRoot: lexicalRoot, target, relative, exists: false };
    }
    throw error;
  }

  if (!stat.isSymbolicLink()) {
    const inspection = await inspectProtectedProjectPath(lexicalRoot, relative, {
      label: `${relative} project instruction`,
      expected: 'file',
    });
    return {
      projectRoot: lexicalRoot,
      target: inspection.target,
      relative: inspection.relative,
      exists: inspection.exists,
    };
  }

  const linkTarget = await fs.readlink(target);
  const resolvedTarget = path.resolve(path.dirname(target), linkTarget);
  if (!isInside(lexicalRoot, resolvedTarget)) {
    throw new Error(
      `${relative} project instruction alias must point to ${aliasTarget} inside the project root`,
    );
  }
  const resolvedRelative = path.relative(lexicalRoot, resolvedTarget).replaceAll('\\', '/');
  if (resolvedRelative !== aliasTarget) {
    throw new Error(
      `${relative} project instruction alias must point to ${aliasTarget} inside the project root`,
    );
  }

  const inspection = await inspectProtectedProjectPath(lexicalRoot, aliasTarget, {
    label: `${relative} project instruction alias target`,
    expected: 'file',
  });
  if (!inspection.exists) {
    return {
      projectRoot: lexicalRoot,
      target: inspection.target,
      relative: inspection.relative,
      exists: false,
    };
  }
  if (!isInside(realRoot, await fs.realpath(inspection.target))) {
    throw new Error(
      `${relative} project instruction alias target resolves outside the project root`,
    );
  }
  return {
    projectRoot: lexicalRoot,
    target: inspection.target,
    relative: inspection.relative,
    exists: true,
  };
}

/**
 * Create a project-relative directory one segment at a time. Every existing or
 * newly-created segment is checked with lstat and realpath before the next
 * segment is touched, so a symlink, junction, special object, or physical root
 * escape fails closed.
 */
export async function ensureProtectedProjectDirectory(
  projectRoot: string,
  relativePath: string,
  options: { label: string },
): Promise<string> {
  const relative = normalizeWorkflowRelativePath(relativePath, options.label);
  const lexicalRoot = path.resolve(projectRoot);
  const realRoot = await assertRealProjectRoot(lexicalRoot, options.label);
  const segments = relative.split('/');
  let cursor = lexicalRoot;

  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      try {
        await fs.mkdir(cursor);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      stat = await fs.lstat(cursor);
    }

    const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) {
      throw new Error(`${options.label} crosses a symbolic link or junction at ${display}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`${options.label} directory ${display} must be a real directory`);
    }
    const realCursor = await fs.realpath(cursor);
    if (!isInside(realRoot, realCursor)) {
      throw new Error(`${options.label} resolves outside the project root`);
    }
  }

  await inspectExistingChain(lexicalRoot, realRoot, segments, {
    label: options.label,
    expected: 'directory',
  });
  return cursor;
}

export async function protectedProjectFileExists(
  projectRoot: string,
  relativePath: string,
  options: { label: string },
): Promise<boolean> {
  return (
    await inspectProtectedProjectPath(projectRoot, relativePath, {
      ...options,
      expected: 'file',
    })
  ).exists;
}

async function readProtectedProjectFileUncached(
  projectRoot: string,
  relativePath: string,
  maxBytes: number,
  options: Omit<RaceSafeReadOptions, 'verify'> & { label: string },
): Promise<RaceSafeReadResult> {
  const inspection = await inspectProtectedProjectPath(projectRoot, relativePath, {
    label: options.label,
    expected: 'file',
  });
  if (!inspection.exists) {
    const error = new Error(`${options.label} does not exist`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }
  const realRoot = await assertRealProjectRoot(inspection.projectRoot, options.label);
  return readFileRaceSafe(inspection.target, maxBytes, {
    ...options,
    verify: async (_checkpoint, context) => {
      if (!isInside(realRoot, context.realPath)) {
        throw new Error(`${options.label} resolves outside the project root`);
      }
      await inspectExistingChain(inspection.projectRoot, realRoot, inspection.relative.split('/'), {
        label: options.label,
        expected: 'file',
      });
    },
  });
}

// Reads co-operating with an atomic write (hooks) bypass the cache so their
// staged checks keep firing; plain decision-scope reads are immutable by the
// read-cache contract, so repeating callers share one race-safe read.
const CACHED_READ_LABEL = 'Cached protected project read';
const cachedReadProtectedProjectFile = memoizedHookRead(
  'protectedReadFile',
  (projectRoot: string, relativePath: string, maxBytes: number) =>
    readProtectedProjectFileUncached(projectRoot, relativePath, maxBytes, {
      label: CACHED_READ_LABEL,
    }),
);

export async function readProtectedProjectFile(
  projectRoot: string,
  relativePath: string,
  maxBytes: number,
  options: Omit<RaceSafeReadOptions, 'verify'> & { label: string },
): Promise<RaceSafeReadResult> {
  if (options.hooks || options.bigint)
    return readProtectedProjectFileUncached(projectRoot, relativePath, maxBytes, options);
  try {
    return await cachedReadProtectedProjectFile(projectRoot, relativePath, maxBytes);
  } catch (error) {
    // The cached read runs under a neutral label; surface failures under the
    // caller's label so diagnostics keep their contractual wording.
    if (error instanceof Error && error.message.includes(CACHED_READ_LABEL)) {
      error.message = error.message.replaceAll(CACHED_READ_LABEL, options.label);
    }
    throw error;
  }
}
