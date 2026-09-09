import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { appendTrajectory, readTrajectory } from '../engine/run-store.js';
import type { RunState, TrajectoryEvent } from '../engine/types.js';
import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import { checkEnvironmentFingerprint, checkInputFingerprint } from './classic-check-snapshot.js';
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import { readClassicState } from './classic-store.js';

export type CommandCheckScope = 'build' | 'verify';

export interface RecordedCommandCheck {
  sequence: number;
  timestamp: string;
  runId: string;
  scope: CommandCheckScope;
  command: string;
  exitCode: number;
  cwd: string;
  provenance?: 'runtime';
  argv?: string[];
  inputBefore?: string;
  inputAfter?: string;
  environment?: string;
  logRef?: string;
  logHash?: string;
  reusable?: boolean;
  reused?: boolean;
  checkEpoch?: number;
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

function normalizedCwd(projectRoot: string, cwd = '.'): string {
  if (cwd.trim().length === 0) throw new Error('Command check cwd cannot be blank');
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, cwd);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Command check cwd must resolve within the project root: '${cwd}'`);
  }
  return path.relative(root, target).replaceAll('\\', '/') || '.';
}

function validRecord(projectRoot: string, event: TrajectoryEvent): RecordedCommandCheck | null {
  if (event.type !== 'command_check_recorded' && event.type !== 'command_check_executed')
    return null;
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
    normalized = normalizedCwd(projectRoot, cwd);
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
    ...(event.type === 'command_check_executed'
      ? {
          provenance: 'runtime' as const,
          argv: (data as RecordedCommandCheck).argv,
          inputBefore: (data as RecordedCommandCheck).inputBefore,
          inputAfter: (data as RecordedCommandCheck).inputAfter,
          environment: (data as RecordedCommandCheck).environment,
          logRef: (data as RecordedCommandCheck).logRef,
          logHash: (data as RecordedCommandCheck).logHash,
          reusable: (data as RecordedCommandCheck).reusable,
          checkEpoch: (data as RecordedCommandCheck).checkEpoch,
        }
      : {}),
  };
}

export async function recordCommandCheck(
  projectRoot: string,
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
    cwd: normalizedCwd(projectRoot, input.cwd),
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
  projectRoot: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null> {
  validateScope(scope);
  const trajectory = await readTrajectory(changeDir, run.trajectoryRef);
  for (let index = trajectory.length - 1; index >= 0; index -= 1) {
    const event = trajectory[index];
    if (event.runId !== run.runId) continue;
    if (
      event.type === 'command_checks_invalidated' &&
      (!Array.isArray(event.data?.scopes) || event.data.scopes.includes(scope))
    )
      return null;
    if (event.type === 'command_check_started' && event.data?.scope === scope) return null;
    if (event.type === 'command_check_consumed' && event.data?.scope === scope) return null;
    const record = validRecord(projectRoot, event);
    if (record?.scope === scope) return record;
  }
  return null;
}

export async function invalidateCommandChecks(changeDir: string, run: RunState): Promise<void> {
  await checkEvent(changeDir, run, 'command_checks_invalidated', { reason: 'cold-recovery' });
}

export async function recoverCommandChecks(root: string, changeDir: string, run: RunState) {
  let snapshot: Promise<string> | undefined;
  const inputFingerprint = () => (snapshot ??= checkInputFingerprint(root, changeDir));
  const scopes: Record<CommandCheckScope, 'revalidated' | 'rerun-required'> = {
    build: 'rerun-required',
    verify: 'rerun-required',
  };
  const invalidated: CommandCheckScope[] = [];
  for (const scope of ['build', 'verify'] as const) {
    const record = await usableCommandCheck(root, changeDir, run, scope, inputFingerprint).catch(
      () => null,
    );
    if (record?.reusable === true) scopes[scope] = 'revalidated';
    else invalidated.push(scope);
  }
  // Persist rejected scopes so restoring old inputs cannot resurrect stale evidence.
  if (invalidated.length) {
    await checkEvent(changeDir, run, 'command_checks_invalidated', {
      reason: 'cold-recovery',
      scopes: invalidated,
    });
  }
  return scopes;
}

async function checkEvent(
  changeDir: string,
  run: RunState,
  type: TrajectoryEvent['type'],
  data: Record<string, unknown>,
): Promise<TrajectoryEvent> {
  const events = await readTrajectory(changeDir, run.trajectoryRef);
  const event = {
    sequence: events.reduce((maximum, item) => Math.max(maximum, item.sequence), 0) + 1,
    timestamp: new Date().toISOString(),
    runId: run.runId,
    type,
    data,
  };
  await appendTrajectory(changeDir, run.trajectoryRef, event);
  return event;
}

export async function executeCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  input: {
    scope: CommandCheckScope;
    argv: string[];
    cwd?: string;
    timeoutMs?: number;
    reusable?: boolean;
  },
): Promise<RecordedCommandCheck> {
  validateScope(input.scope);
  if (!input.argv.length || input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')))
    throw new Error('Check requires literal program arguments');
  const cwd = normalizedCwd(root, input.cwd);
  const realRoot = await fs.realpath(root);
  normalizedCwd(realRoot, await fs.realpath(path.resolve(root, cwd)));
  if (input.reusable) {
    const previous = await usableCommandCheck(root, changeDir, run, input.scope);
    if (
      previous &&
      previous.reusable &&
      previous.cwd === cwd &&
      JSON.stringify(previous.argv) === JSON.stringify(input.argv)
    ) {
      return { ...previous, reused: true };
    }
  }
  // A failed launch, snapshot, or log write must not expose an older success.
  await checkEvent(changeDir, run, 'command_check_started', { scope: input.scope });
  const checkEpoch =
    (await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0;
  const inputBefore = await checkInputFingerprint(root, changeDir);
  const environment = await checkEnvironmentFingerprint(input.argv, path.resolve(root, cwd));
  const logPath = path.join(changeDir, '.comet', 'checks', `${randomUUID()}.log`);
  // The platform adapter preserves argv and rejects unsafe Windows batch arguments.
  const result = await new Promise<{ exitCode: number; output: string }>((resolve) => {
    const child = spawnCommand(input.argv[0], input.argv.slice(1), {
      cwd: path.resolve(root, cwd),
    });
    let output = '';
    let timedOut = false;
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => {
      output += `\n${error.message}`;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child).catch(() => child.kill('SIGKILL'));
    }, input.timeoutMs ?? 300_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        output: (timedOut ? 'Check timed out.\n' : '') + output,
      });
    });
  });
  let inputAfter = await checkInputFingerprint(root, changeDir).catch(() => 'unavailable');
  if (
    checkEpoch !==
    ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  )
    inputAfter = 'phase-changed';
  if (environment !== (await checkEnvironmentFingerprint(input.argv, path.resolve(root, cwd))))
    inputAfter = 'environment-changed';
  await writeClassicProjectText(root, logPath, result.output, { label: 'Classic check log' });
  const data = {
    scope: input.scope,
    command: JSON.stringify(input.argv),
    checkEpoch,
    argv: input.argv,
    exitCode: result.exitCode,
    cwd,
    provenance: 'runtime' as const,
    inputBefore,
    inputAfter,
    environment,
    logRef: path.relative(root, logPath).replaceAll('\\', '/'),
    logHash: createHash('sha256').update(result.output).digest('hex'),
    reusable: input.reusable === true && inputBefore === inputAfter,
  };
  const event = await checkEvent(changeDir, run, 'command_check_executed', data);
  return { ...data, sequence: event.sequence, timestamp: event.timestamp, runId: run.runId };
}

export async function usableCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
  inputFingerprint: () => Promise<string> = () => checkInputFingerprint(root, changeDir),
): Promise<RecordedCommandCheck | null> {
  const record = await latestCommandCheck(root, changeDir, run, scope);
  if (
    record &&
    !record.reusable &&
    (record.checkEpoch ?? 0) !==
      ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  )
    return null;
  if (
    !record ||
    record.provenance !== 'runtime' ||
    record.exitCode !== 0 ||
    !Array.isArray(record.argv) ||
    !record.argv.length ||
    !record.inputBefore ||
    record.inputBefore !== record.inputAfter ||
    record.environment !==
      (await checkEnvironmentFingerprint(record.argv, path.resolve(root, record.cwd))) ||
    record.inputAfter !== (await inputFingerprint())
  )
    return null;
  if (typeof record.logRef !== 'string' || typeof record.logHash !== 'string') return null;
  try {
    const log = await readClassicProjectFile(root, record.logRef, {
      label: 'Classic check evidence log',
      maxBytes: 8 * 1024 * 1024,
    });
    if (createHash('sha256').update(log).digest('hex') !== record.logHash) return null;
  } catch {
    return null;
  }
  return record;
}

export async function consumeCommandCheck(
  changeDir: string,
  run: RunState,
  record: RecordedCommandCheck,
): Promise<void> {
  if (!record.reusable)
    await checkEvent(changeDir, run, 'command_check_consumed', {
      scope: record.scope,
      sequence: record.sequence,
    });
}
