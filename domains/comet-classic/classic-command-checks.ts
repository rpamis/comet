import path from 'path';
import { appendTrajectory, readTrajectory } from '../engine/run-store.js';
import type { RunState, TrajectoryEvent } from '../engine/types.js';

export type CommandCheckScope = 'build' | 'verify';

export interface RecordedCommandCheck {
  sequence: number;
  timestamp: string;
  runId: string;
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd: string;
}

export interface RecordCommandCheckInput {
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd?: string;
}

function validateScope(scope: unknown): asserts scope is CommandCheckScope {
  if (scope !== 'build' && scope !== 'verify') {
    throw new Error(`Invalid command check scope: '${String(scope)}'`);
  }
}

function projectRoot(changeDir: string): string {
  return path.resolve(changeDir, '..', '..', '..');
}

function normalizedCwd(changeDir: string, cwd = '.'): string {
  if (cwd.trim().length === 0) throw new Error('Command check cwd cannot be blank');
  const root = projectRoot(changeDir);
  const target = path.resolve(root, cwd);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Command check cwd must resolve within the project root: '${cwd}'`);
  }
  return path.relative(root, target).replaceAll('\\', '/') || '.';
}

function validRecord(changeDir: string, event: TrajectoryEvent): RecordedCommandCheck | null {
  if (event.type !== 'command_check_recorded') return null;
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { scope, command, exitCode, cwd } = data as Record<string, unknown>;
  if (
    (scope !== 'build' && scope !== 'verify') ||
    typeof command !== 'string' ||
    command.trim().length === 0 ||
    !Number.isInteger(exitCode) ||
    typeof cwd !== 'string'
  ) {
    return null;
  }
  let normalized: string;
  try {
    normalized = normalizedCwd(changeDir, cwd);
  } catch {
    return null;
  }
  return {
    sequence: event.sequence,
    timestamp: event.timestamp,
    runId: event.runId,
    scope,
    command,
    exitCode: exitCode as number,
    cwd: normalized,
  };
}

export async function recordCommandCheck(
  changeDir: string,
  run: RunState,
  input: RecordCommandCheckInput,
): Promise<RecordedCommandCheck> {
  validateScope(input.scope);
  if (typeof input.command !== 'string' || input.command.trim().length === 0) {
    throw new Error('Command check command cannot be blank');
  }
  if (!Number.isInteger(input.exitCode)) {
    throw new Error('Command check exitCode must be an integer');
  }
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  const recorded: RecordedCommandCheck = {
    sequence: trajectory.reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1,
    timestamp: new Date().toISOString(),
    runId: run.runId,
    scope: input.scope,
    command: input.command,
    exitCode: input.exitCode,
    cwd: normalizedCwd(changeDir, input.cwd),
  };
  await appendTrajectory(changeDir, run.trajectoryRef, {
    sequence: recorded.sequence,
    timestamp: recorded.timestamp,
    type: 'command_check_recorded',
    runId: recorded.runId,
    data: {
      scope: recorded.scope,
      command: recorded.command,
      exitCode: recorded.exitCode,
      cwd: recorded.cwd,
    },
  });
  return recorded;
}

export async function latestCommandCheck(
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null> {
  validateScope(scope);
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    const record = validRecord(changeDir, event);
    if (record?.scope === scope) return record;
  }
  return null;
}
