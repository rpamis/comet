import { promises as fs } from 'fs';
import path from 'path';

import {
  readFileRaceSafe,
  type RaceSafeReadOptions,
  type RaceSafeReadResult,
} from '../../platform/fs/race-safe-read.js';
import { normalizeWorkflowRelativePath } from './project-config.js';

export type ProtectedProjectPathKind = 'missing' | 'file' | 'directory';

export interface ProtectedProjectPathInspection {
  projectRoot: string;
  target: string;
  relative: string;
  exists: boolean;
  kind: ProtectedProjectPathKind;
}

export interface ProtectedProjectPathOptions {
  label: string;
  expected?: 'file' | 'directory' | 'any';
}

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

async function assertRealProjectRoot(projectRoot: string, label: string): Promise<string> {
  const lexicalRoot = path.resolve(projectRoot);
  const stat = await fs.lstat(lexicalRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} project root must be a real directory`);
  }
  return fs.realpath(lexicalRoot);
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
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (isMissingPath(error)) return { exists: false, kind: 'missing' };
      throw error;
    }
    const display = path.relative(lexicalRoot, cursor).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) {
      throw new Error(`${options.label} crosses a symbolic link or junction at ${display}`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
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
    const realCursor = await fs.realpath(cursor);
    if (!isInside(realRoot, realCursor)) {
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
export async function inspectProtectedProjectPath(
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

export async function readProtectedProjectFile(
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
