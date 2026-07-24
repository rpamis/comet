import { randomUUID } from 'crypto';
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';

import type { CometWorkflow } from './types.js';

export const COMET_CURRENT_SELECTION_SCHEMA = 'comet.selection.v2' as const;
export const COMET_CURRENT_SELECTION_MAX_BYTES = 16 * 1024;

export interface CometCurrentSelection {
  schema: typeof COMET_CURRENT_SELECTION_SCHEMA;
  workflow: CometWorkflow;
  change: string;
  branch: string | null;
}

export interface LegacyClassicSelection {
  version: 1;
  change: string;
  branch: string | null;
}

export type CometCurrentSelectionRead =
  | { status: 'missing' }
  | { status: 'selected'; selection: CometCurrentSelection; legacy: boolean };

export function cometCurrentSelectionFile(projectRoot: string): string {
  return path.join(projectRoot, '.comet', 'current-change.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validBranch(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseSelection(source: string): { selection: CometCurrentSelection; legacy: boolean } {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(
      `current change selection contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!isRecord(value)) {
    throw new Error('current change selection must be a JSON object');
  }

  if (value.version === 1) {
    if (typeof value.change !== 'string') {
      throw new Error('legacy current change selection change must be a string');
    }
    if (value.branch !== undefined && !validBranch(value.branch)) {
      throw new Error('legacy current change selection branch must be a string or null');
    }
    return {
      selection: {
        schema: COMET_CURRENT_SELECTION_SCHEMA,
        workflow: 'classic',
        change: value.change,
        branch: (value.branch as string | null | undefined) ?? null,
      },
      legacy: true,
    };
  }

  if (value.schema !== COMET_CURRENT_SELECTION_SCHEMA) {
    throw new Error(`current change selection schema must be ${COMET_CURRENT_SELECTION_SCHEMA}`);
  }
  if (value.workflow !== 'native' && value.workflow !== 'classic') {
    throw new Error('current change selection workflow must be native or classic');
  }
  if (typeof value.change !== 'string') {
    throw new Error('current change selection change must be a string');
  }
  if (!validBranch(value.branch)) {
    throw new Error('current change selection branch must be a string or null');
  }
  if (value.workflow === 'native' && value.branch !== null) {
    throw new Error('Native current change selection branch must be null');
  }
  return { selection: value as unknown as CometCurrentSelection, legacy: false };
}

async function readHandleBounded(
  handle: Awaited<ReturnType<typeof fs.open>>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
  for (;;) {
    const remaining = maxBytes + 1 - total;
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) {
      throw new Error(`current change selection exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, total);
}

export async function readCometCurrentSelection(
  projectRoot: string,
): Promise<CometCurrentSelectionRead> {
  let source: string;
  try {
    const file = cometCurrentSelectionFile(projectRoot);
    // Open once and check/read through the same fd: a path-based stat()
    // followed by a separate readFile() by path would leave a window where
    // the file at that path could be swapped (grown past the byte limit, or
    // replaced with a symlink) between the check and the read.
    const flags =
      process.platform === 'win32'
        ? fsConstants.O_RDONLY
        : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
    const handle = await fs.open(file, flags);
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) {
        throw new Error('current change selection must be a regular file');
      }
      const bytes = await readHandleBounded(handle, COMET_CURRENT_SELECTION_MAX_BYTES);
      source = bytes.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error('cannot read current change selection: must be a regular file', {
        cause: error,
      });
    }
    throw new Error(
      `cannot read current change selection: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const parsed = parseSelection(source);
  return { status: 'selected', ...parsed };
}

export async function writeCometCurrentSelection(
  projectRoot: string,
  selection: CometCurrentSelection,
): Promise<void> {
  const parsed = parseSelection(JSON.stringify(selection));
  if (parsed.legacy) throw new Error('cannot write a legacy current change selection');

  const file = cometCurrentSelectionFile(projectRoot);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(parsed.selection, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function migrateLegacyClassicSelection(projectRoot: string): Promise<boolean> {
  const current = await readCometCurrentSelection(projectRoot);
  if (current.status === 'missing' || !current.legacy) return false;
  await writeCometCurrentSelection(projectRoot, current.selection);
  return true;
}

export async function clearCometCurrentSelection(projectRoot: string): Promise<void> {
  await fs.rm(cometCurrentSelectionFile(projectRoot), { force: true });
}

export async function clearCometCurrentSelectionIf(
  projectRoot: string,
  workflow: CometWorkflow,
  change: string,
): Promise<boolean> {
  const current = await readCometCurrentSelection(projectRoot);
  if (
    current.status !== 'selected' ||
    current.selection.workflow !== workflow ||
    current.selection.change !== change
  ) {
    return false;
  }
  await clearCometCurrentSelection(projectRoot);
  return true;
}
