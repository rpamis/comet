import { createHash } from 'crypto';
import path from 'path';

import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import { readNativeTrajectoryText, replaceNativeTrajectoryText } from './native-run-store.js';
import type { NativeProjectPaths } from './native-types.js';

const CHANGE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export type NativeTrajectoryTailInspection =
  | { status: 'clean'; file: string }
  | {
      status: 'repairable';
      file: string;
      reason: 'incomplete-json' | 'missing-newline';
      line: number;
      originalHash: string;
      targetHash: string;
      tailHash: string;
      discardedBytes: number;
    }
  | {
      status: 'invalid';
      file: string;
      line: number;
      message: string;
    };

interface RepairableAnalysis {
  inspection: Extract<NativeTrajectoryTailInspection, { status: 'repairable' }>;
  targetContent: string;
}

export class NativeTrajectoryRepairRequiredError extends Error {
  readonly code = 'native-trajectory-tail-repair-required';

  constructor(readonly inspection: Exclude<NativeTrajectoryTailInspection, { status: 'clean' }>) {
    super(
      inspection.status === 'repairable'
        ? `Native trajectory has an incomplete final line at ${inspection.file}:${inspection.line}; run doctor --repair`
        : `Native trajectory is invalid at ${inspection.file}:${inspection.line}: ${inspection.message}`,
    );
    this.name = 'NativeTrajectoryRepairRequiredError';
  }
}

export interface NativeTrajectoryRepairHooks {
  beforeCommit?: () => void | Promise<void>;
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function trajectoryFile(paths: NativeProjectPaths, name: string): string {
  if (!CHANGE_NAME_PATTERN.test(name)) throw new Error(`Invalid Native change name: ${name}`);
  const changeDir = path.join(paths.changesDir, name);
  if (!isInsidePath(paths.changesDir, changeDir)) throw new Error('Native change path escaped');
  return path.join(changeDir, 'runtime', 'trajectory.jsonl');
}

function parseCompleteLines(
  content: string,
): { status: 'valid'; count: number } | { status: 'invalid'; line: number; message: string } {
  const lines = content.split(/\n/u);
  let count = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
    if (line.length === 0) continue;
    count = index + 1;
    try {
      JSON.parse(line);
    } catch (error) {
      return { status: 'invalid', line: index + 1, message: (error as Error).message };
    }
  }
  return { status: 'valid', count };
}

function looksTruncated(error: Error, content: string): boolean {
  if (/Unexpected end|Unterminated string/iu.test(error.message)) return true;
  const position = /position (\d+)/iu.exec(error.message)?.[1];
  return position !== undefined && Number(position) >= Math.max(0, content.length - 1);
}

function analyzeTrajectory(
  file: string,
  source: Buffer,
): NativeTrajectoryTailInspection | RepairableAnalysis {
  const lastNewline = source.lastIndexOf(0x0a);
  const prefix = source.subarray(0, lastNewline + 1);
  const complete = parseCompleteLines(prefix.toString('utf8'));
  if (complete.status === 'invalid') {
    return { status: 'invalid', file, line: complete.line, message: complete.message };
  }
  if (lastNewline === source.length - 1) return { status: 'clean', file };

  const tail = source.subarray(lastNewline + 1);
  const tailText = tail.toString('utf8');
  const line = complete.count + 1;
  let reason: 'incomplete-json' | 'missing-newline';
  let target: Buffer;
  try {
    JSON.parse(tailText.endsWith('\r') ? tailText.slice(0, -1) : tailText);
    reason = 'missing-newline';
    target = Buffer.concat([source, Buffer.from('\n')]);
  } catch (error) {
    if (!looksTruncated(error as Error, tailText)) {
      return { status: 'invalid', file, line, message: (error as Error).message };
    }
    reason = 'incomplete-json';
    target = prefix;
  }
  const inspection: Extract<NativeTrajectoryTailInspection, { status: 'repairable' }> = {
    status: 'repairable',
    file,
    reason,
    line,
    originalHash: sha256Buffer(source),
    targetHash: sha256Buffer(target),
    tailHash: sha256Buffer(tail),
    discardedBytes: reason === 'incomplete-json' ? tail.length : 0,
  };
  return { inspection, targetContent: target.toString('utf8') };
}

async function inspectFile(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeTrajectoryTailInspection | RepairableAnalysis> {
  const file = trajectoryFile(paths, name);
  await resolveContainedNativePath(paths.nativeRoot, file);
  const changeDir = path.join(paths.changesDir, name);
  const content = await readNativeTrajectoryText(changeDir, NATIVE_RUN_STORAGE.trajectoryRef);
  return content === null
    ? { status: 'clean', file }
    : analyzeTrajectory(file, Buffer.from(content));
}

export async function inspectNativeTrajectoryTail(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeTrajectoryTailInspection> {
  const result = await inspectFile(paths, name);
  return 'inspection' in result ? result.inspection : result;
}

export async function assertNativeTrajectoryHealthy(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  const inspection = await inspectNativeTrajectoryTail(paths, name);
  if (inspection.status !== 'clean') throw new NativeTrajectoryRepairRequiredError(inspection);
}

export async function repairNativeTrajectoryTail(
  paths: NativeProjectPaths,
  name: string,
  hooks?: NativeTrajectoryRepairHooks,
): Promise<Extract<NativeTrajectoryTailInspection, { status: 'repairable' }> | null> {
  return withNativeMutationLock(paths, `repair trajectory tail for ${name}`, async () => {
    const result = await inspectFile(paths, name);
    if (!('inspection' in result)) {
      if (result.status === 'clean') return null;
      throw new NativeTrajectoryRepairRequiredError(result);
    }
    try {
      await replaceNativeTrajectoryText(
        path.join(paths.changesDir, name),
        NATIVE_RUN_STORAGE.trajectoryRef,
        result.targetContent,
        result.inspection.originalHash,
        { beforeCommit: hooks?.beforeCommit },
      );
    } catch (error) {
      if (/changed (?:before|while)/iu.test((error as Error).message)) {
        throw new Error(
          `Native trajectory changed while preparing tail repair for ${name}; inspect it again before retrying`,
          { cause: error },
        );
      }
      throw error;
    }
    const repaired = await inspectNativeTrajectoryTail(paths, name);
    if (repaired.status !== 'clean') {
      throw new Error(`Native trajectory tail repair did not produce a clean file for ${name}`);
    }
    return result.inspection;
  });
}
