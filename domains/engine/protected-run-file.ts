import { TextDecoder } from 'util';

import {
  atomicWriteContainedText,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  removeContainedFile,
} from '../workflow-contract/index.js';
import { sameFileObject, type FileObjectIdentity } from '../../platform/fs/file-identity.js';
import type { RaceSafeReadOptions, RaceSafeReadResult } from '../../platform/fs/race-safe-read.js';

export interface EngineRunReadOptions {
  hooks?: RaceSafeReadOptions['hooks'];
}

export interface EngineRunWriteOptions {
  beforeCommit?: () => void | Promise<void>;
}

export interface EngineRunRemoveOptions {
  beforeRemove?: () => void | Promise<void>;
}

interface RunFileSnapshot {
  text: string;
  result: RaceSafeReadResult;
}

function identityOf(stat: RaceSafeReadResult['stat']): FileObjectIdentity {
  return { dev: stat.dev, ino: stat.ino, birthtime: stat.birthtimeMs };
}

function decodeRunText(result: RaceSafeReadResult, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
}

async function readSnapshot(
  changeDir: string,
  relativePath: string,
  maxBytes: number,
  label: string,
  options: EngineRunReadOptions = {},
): Promise<RunFileSnapshot | null> {
  try {
    const result = await readProtectedProjectFile(changeDir, relativePath, maxBytes, {
      label,
      hooks: options.hooks,
    });
    return { result, text: decodeRunText(result, label) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function readOptionalEngineRunText(
  changeDir: string,
  relativePath: string,
  maxBytes: number,
  label: string,
  options: EngineRunReadOptions = {},
): Promise<string | null> {
  return (await readSnapshot(changeDir, relativePath, maxBytes, label, options))?.text ?? null;
}

export async function writeEngineRunText(
  changeDir: string,
  relativePath: string,
  content: string,
  maxBytes: number,
  label: string,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes`);
  }
  const expected = await readSnapshot(changeDir, relativePath, maxBytes, label);
  const inspection = await inspectProtectedProjectPath(changeDir, relativePath, {
    label,
    expected: 'file',
  });
  await atomicWriteContainedText(inspection.target, content, {
    containedRoot: inspection.projectRoot,
    beforeCommit: async () => {
      await options.beforeCommit?.();
      const current = await readSnapshot(changeDir, relativePath, maxBytes, label);
      if (!expected && !current) return;
      if (!expected || !current) {
        throw new Error(`${label} changed before commit`);
      }
      if (
        expected.result.realPath !== current.result.realPath ||
        !sameFileObject(identityOf(expected.result.stat), identityOf(current.result.stat)) ||
        expected.text !== current.text
      ) {
        throw new Error(`${label} changed before commit`);
      }
    },
  });
}

export async function appendEngineRunText(
  changeDir: string,
  relativePath: string,
  addition: string,
  maxBytes: number,
  label: string,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  const existing = await readOptionalEngineRunText(changeDir, relativePath, maxBytes, label);
  await writeEngineRunText(
    changeDir,
    relativePath,
    `${existing ?? ''}${addition}`,
    maxBytes,
    label,
    options,
  );
}

export async function removeEngineRunFile(
  changeDir: string,
  relativePath: string,
  label: string,
  options: EngineRunRemoveOptions = {},
): Promise<boolean> {
  const inspection = await inspectProtectedProjectPath(changeDir, relativePath, {
    label,
    expected: 'file',
  });
  if (!inspection.exists) return false;
  return removeContainedFile(inspection.target, {
    containedRoot: inspection.projectRoot,
    beforeRemove: options.beforeRemove,
  });
}
