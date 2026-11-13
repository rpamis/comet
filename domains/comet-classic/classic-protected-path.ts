import path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { resolveClassicLocalTarget } from './classic-runtime-paths.js';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import {
  ensureProtectedProjectDirectory,
  hashProtectedProjectFile,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  type ProtectedProjectPathInspection,
  createProtectedProjectReadSession,
} from '../workflow-contract/protected-project-path.js';

export const CLASSIC_PROJECT_FILE_MAX_BYTES = Number.MAX_SAFE_INTEGER;

type SourceRead = Awaited<ReturnType<typeof readProtectedProjectFile>>;
const sourceObservations = new AsyncLocalStorage<{
  root: string;
  session: Awaited<ReturnType<typeof createProtectedProjectReadSession>>;
  files: Map<string, Promise<SourceRead>>;
}>();

/** 仅包住同次提案的材料准备；提交验证在此作用域结束后重新观察。 */
export async function withClassicSourceObservation<T>(
  projectRoot: string,
  work: () => Promise<T>,
): Promise<T> {
  const root = path.resolve(projectRoot);
  const session = await createProtectedProjectReadSession(root, 'Classic proposal sources');
  const result = await sourceObservations.run({ root, session, files: new Map() }, work);
  await session.finish({ allowDirectoryContentChanges: true });
  return result;
}

export async function readClassicSourceObservation(
  projectRoot: string,
  relative: string,
): Promise<SourceRead | null> {
  const active = sourceObservations.getStore();
  if (!active || active.root !== path.resolve(projectRoot)) return null;
  const ref = normalizeWorkflowRelativePath(relative, 'Classic proposal source');
  let read = active.files.get(ref);
  if (!read) {
    read = active.session.read(ref, CLASSIC_PROJECT_FILE_MAX_BYTES);
    active.files.set(ref, read);
  }
  return read;
}

export async function hashClassicSourceObservation(projectRoot: string, relative: string) {
  const read = await readClassicSourceObservation(projectRoot, relative);
  return read ? { ...read, digest: createHash('sha256').update(read.bytes).digest('hex') } : null;
}

async function projectTarget(
  projectRoot: string,
  target: string,
  label: string,
  migrate = false,
): Promise<{ root: string; relative: string; target: string }> {
  let root = path.resolve(projectRoot);
  let absolute = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
  const local = await resolveClassicLocalTarget(root, absolute, { readOnly: !migrate });
  if (local) {
    root = local.root;
    absolute = local.target;
  }
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  return {
    root,
    relative: normalizeWorkflowRelativePath(relative, label),
    target: absolute,
  };
}

export async function inspectClassicProjectTarget(
  projectRoot: string,
  target: string,
  options: { label: string; expected: 'file' | 'directory' | 'any'; migrate?: boolean },
): Promise<ProtectedProjectPathInspection> {
  const resolved = await projectTarget(projectRoot, target, options.label, options.migrate);
  return inspectProtectedProjectPath(resolved.root, resolved.relative, options);
}

export async function classicProjectTargetExists(
  projectRoot: string,
  target: string,
  options: { label: string; expected?: 'file' | 'directory' | 'any' },
): Promise<boolean> {
  try {
    return (
      await inspectClassicProjectTarget(projectRoot, target, {
        label: options.label,
        expected: options.expected ?? 'any',
      })
    ).exists;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function classicProjectFileNonempty(
  projectRoot: string,
  target: string,
  label: string,
  hooks?: {
    afterOpen?: () => void | Promise<void>;
    beforeFinalCheck?: () => void | Promise<void>;
  },
): Promise<boolean> {
  if (
    !(await classicProjectTargetExists(projectRoot, target, {
      label,
      expected: 'file',
    }))
  ) {
    return false;
  }
  return (
    (
      await readClassicProjectBytes(projectRoot, target, {
        label,
        hooks,
      })
    ).byteLength > 0
  );
}

export async function readClassicProjectFile(
  projectRoot: string,
  target: string,
  options: {
    label: string;
    maxBytes?: number;
    hooks?: {
      afterOpen?: () => void | Promise<void>;
      beforeFinalCheck?: () => void | Promise<void>;
    };
  },
): Promise<string> {
  return (await readClassicProjectBytes(projectRoot, target, options)).toString('utf8');
}

export async function readClassicProjectBytes(
  projectRoot: string,
  target: string,
  options: {
    label: string;
    maxBytes?: number;
    hooks?: {
      afterOpen?: () => void | Promise<void>;
      beforeFinalCheck?: () => void | Promise<void>;
    };
  },
): Promise<Buffer> {
  const resolved = await projectTarget(projectRoot, target, options.label);
  if (!options.hooks) {
    const observed = await readClassicSourceObservation(resolved.root, resolved.relative);
    if (observed) {
      if (observed.bytes.length > (options.maxBytes ?? CLASSIC_PROJECT_FILE_MAX_BYTES))
        throw new Error(`${options.label} exceeds the read limit`);
      return observed.bytes;
    }
  }
  return (
    await readProtectedProjectFile(
      resolved.root,
      resolved.relative,
      options.maxBytes ?? CLASSIC_PROJECT_FILE_MAX_BYTES,
      { label: options.label, hooks: options.hooks },
    )
  ).bytes;
}

export async function ensureClassicProjectDirectory(
  projectRoot: string,
  target: string,
  label: string,
): Promise<string> {
  const resolved = await projectTarget(projectRoot, target, label, true);
  return ensureProtectedProjectDirectory(resolved.root, resolved.relative, { label });
}

export async function assertClassicProjectFileWriteTarget(
  projectRoot: string,
  target: string,
  label: string,
): Promise<string> {
  const inspection = await inspectClassicProjectTarget(projectRoot, target, {
    label,
    expected: 'file',
    migrate: true,
  });
  return inspection.target;
}

export async function writeClassicProjectText(
  projectRoot: string,
  target: string,
  content: string,
  options: {
    label: string;
    beforeTemporaryOpen?: () => void | Promise<void>;
    beforeCommit?: () => void | Promise<void>;
    exclusive?: boolean;
  },
): Promise<void> {
  const resolved = await projectTarget(projectRoot, target, options.label, true);
  await inspectProtectedProjectPath(resolved.root, resolved.relative, {
    label: options.label,
    expected: 'file',
  });
  await atomicWriteContainedText(resolved.target, content, {
    containedRoot: resolved.root,
    beforeTemporaryOpen: options.beforeTemporaryOpen,
    beforeCommit: options.beforeCommit,
    exclusive: options.exclusive,
  });
}

export async function hashClassicProjectFile(
  projectRoot: string,
  target: string,
  options: Parameters<typeof hashProtectedProjectFile>[2],
) {
  const resolved = await projectTarget(projectRoot, target, options.label);
  return hashProtectedProjectFile(resolved.root, resolved.relative, options);
}
