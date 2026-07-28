import path from 'path';

import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  type ProtectedProjectPathInspection,
} from '../workflow-contract/protected-project-path.js';

export const CLASSIC_PROJECT_FILE_MAX_BYTES = 2 * 1024 * 1024;

function projectTarget(
  projectRoot: string,
  target: string,
  label: string,
): { root: string; relative: string; target: string } {
  const root = path.resolve(projectRoot);
  const absolute = path.isAbsolute(target) ? path.resolve(target) : path.resolve(root, target);
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
  options: { label: string; expected: 'file' | 'directory' | 'any' },
): Promise<ProtectedProjectPathInspection> {
  const resolved = projectTarget(projectRoot, target, options.label);
  return inspectProtectedProjectPath(resolved.root, resolved.relative, options);
}

export async function classicProjectTargetExists(
  projectRoot: string,
  target: string,
  options: { label: string; expected?: 'file' | 'directory' | 'any' },
): Promise<boolean> {
  return (
    await inspectClassicProjectTarget(projectRoot, target, {
      label: options.label,
      expected: options.expected ?? 'any',
    })
  ).exists;
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
  const resolved = projectTarget(projectRoot, target, options.label);
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
  const resolved = projectTarget(projectRoot, target, label);
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
  const resolved = projectTarget(projectRoot, target, options.label);
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
