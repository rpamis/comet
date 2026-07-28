import path from 'path';

import {
  appendEngineRunText,
  readOptionalEngineRunText,
  removeEngineRunFile,
  writeEngineRunText,
  type EngineRunReadOptions,
  type EngineRunRemoveOptions,
  type EngineRunWriteOptions,
} from './protected-run-file.js';
import type { Checkpoint, EngineAction, TrajectoryEvent } from './types.js';

const RUN_FILE_LIMITS = {
  trajectory: 8 * 1024 * 1024,
  artifacts: 1024 * 1024,
  context: 1024 * 1024,
  pendingAction: 256 * 1024,
  checkpoint: 256 * 1024,
} as const;

function assertRunPath(changeDir: string, relativePath: string): void {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Run path must stay inside the change directory');
  }
  const root = path.resolve(changeDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Run path must stay inside the change directory');
  }
}

export async function appendTrajectory(
  changeDir: string,
  relativePath: string,
  event: TrajectoryEvent,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await appendEngineRunText(
    changeDir,
    relativePath,
    `${JSON.stringify(event)}\n`,
    RUN_FILE_LIMITS.trajectory,
    'Run trajectory',
    options,
  );
}

export async function readTrajectory(
  changeDir: string,
  relativePath: string,
  options: EngineRunReadOptions = {},
): Promise<TrajectoryEvent[]> {
  assertRunPath(changeDir, relativePath);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath,
    RUN_FILE_LIMITS.trajectory,
    'Run trajectory',
    options,
  );
  if (raw === null) return [];
  return raw
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, number }) => {
      try {
        return JSON.parse(line) as TrajectoryEvent;
      } catch (error) {
        throw new Error(`Invalid Trajectory event at line ${number}`, { cause: error });
      }
    });
}

export async function readArtifacts(
  changeDir: string,
  relativePath: string,
  options: EngineRunReadOptions = {},
): Promise<Record<string, string>> {
  assertRunPath(changeDir, relativePath);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath,
    RUN_FILE_LIMITS.artifacts,
    'Run artifacts',
    options,
  );
  return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
}

export async function writeArtifacts(
  changeDir: string,
  relativePath: string,
  artifacts: Record<string, string>,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await writeEngineRunText(
    changeDir,
    relativePath,
    JSON.stringify(artifacts, null, 2) + '\n',
    RUN_FILE_LIMITS.artifacts,
    'Run artifacts',
    options,
  );
}

export async function writeContext(
  changeDir: string,
  relativePath: string,
  context: string,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await writeEngineRunText(
    changeDir,
    relativePath,
    context,
    RUN_FILE_LIMITS.context,
    'Run context',
    options,
  );
}

export async function readContext(
  changeDir: string,
  relativePath: string,
  options: EngineRunReadOptions = {},
): Promise<string | null> {
  assertRunPath(changeDir, relativePath);
  return readOptionalEngineRunText(
    changeDir,
    relativePath,
    RUN_FILE_LIMITS.context,
    'Run context',
    options,
  );
}

export async function writePendingAction(
  changeDir: string,
  relativePath: string,
  action: EngineAction,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await writeEngineRunText(
    changeDir,
    relativePath,
    JSON.stringify(action, null, 2) + '\n',
    RUN_FILE_LIMITS.pendingAction,
    'Run pending action',
    options,
  );
}

export async function readPendingAction(
  changeDir: string,
  relativePath: string,
  options: EngineRunReadOptions = {},
): Promise<EngineAction | null> {
  assertRunPath(changeDir, relativePath);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath,
    RUN_FILE_LIMITS.pendingAction,
    'Run pending action',
    options,
  );
  return raw === null ? null : (JSON.parse(raw) as EngineAction);
}

export async function clearPendingAction(
  changeDir: string,
  relativePath: string,
  options: EngineRunRemoveOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await removeEngineRunFile(changeDir, relativePath, 'Run pending action', options);
}

export async function writeCheckpoint(
  changeDir: string,
  relativePath: string,
  checkpoint: Checkpoint,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  assertRunPath(changeDir, relativePath);
  await writeEngineRunText(
    changeDir,
    relativePath,
    JSON.stringify(checkpoint, null, 2) + '\n',
    RUN_FILE_LIMITS.checkpoint,
    'Run checkpoint',
    options,
  );
}

export async function readCheckpoint(
  changeDir: string,
  relativePath: string,
  options: EngineRunReadOptions = {},
): Promise<Checkpoint | null> {
  assertRunPath(changeDir, relativePath);
  const raw = await readOptionalEngineRunText(
    changeDir,
    relativePath,
    RUN_FILE_LIMITS.checkpoint,
    'Run checkpoint',
    options,
  );
  return raw === null ? null : (JSON.parse(raw) as Checkpoint);
}
