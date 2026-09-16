import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { appendTrajectory } from '../engine/run-store.js';
import type { RunState, TrajectoryEvent } from '../engine/types.js';
import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';
import { spawnCommand } from '../../platform/process/spawn-command.js';
import {
  checkEnvironmentFingerprint,
  collectCheckSnapshot,
  legacyCheckInputFingerprint,
} from './classic-check-snapshot.js';
import { readClassicProjectFile, writeClassicProjectText } from './classic-protected-path.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import { readCheckIndex } from './classic-check-index.js';
import { readCheckPolicy } from './classic-check-policy.js';
import {
  checkManifestHash,
  diffCheckManifests,
  parseCheckManifest,
  type CheckManifestEntry,
} from './classic-check-manifest.js';

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
  /** Repository-relative per-file input manifest recorded at execution time. */
  manifestRef?: string;
  manifestHash?: string;
  /** Incremental evidence maintains validity inside a phase; only full evidence advances it. */
  tier?: 'full' | 'incremental';
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
          manifestRef:
            typeof (data as RecordedCommandCheck).manifestRef === 'string'
              ? (data as RecordedCommandCheck).manifestRef
              : undefined,
          manifestHash:
            typeof (data as RecordedCommandCheck).manifestHash === 'string'
              ? (data as RecordedCommandCheck).manifestHash
              : undefined,
          tier: (data as RecordedCommandCheck).tier === 'incremental' ? 'incremental' : undefined,
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
  return withClassicStateLock(changeDir, async () => {
    const index = await readCheckIndex(changeDir, run.trajectoryRef);
    const recorded: RecordedCommandCheck = {
      sequence: index.maximumSequence + 1,
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
  });
}

export async function latestCommandCheck(
  projectRoot: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
): Promise<RecordedCommandCheck | null> {
  validateScope(scope);
  const trajectory = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
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
  const snapshots = new Map<string, Promise<string>>();
  // Pre-manifest records are revalidated with their original binding semantics.
  const inputFingerprint = async (argv: string[], cwd: string) => {
    const identity = { argv, cwd };
    const key = JSON.stringify(await readCheckPolicy(root, identity, true));
    let snapshot = snapshots.get(key);
    if (!snapshot) {
      snapshot = legacyCheckInputFingerprint(root, changeDir, identity);
      snapshots.set(key, snapshot);
    }
    return snapshot;
  };
  const scopes: Record<CommandCheckScope, 'revalidated' | 'rerun-required'> = {
    build: 'rerun-required',
    verify: 'rerun-required',
  };
  const invalidated: CommandCheckScope[] = [];
  for (const scope of ['build', 'verify'] as const) {
    const record = await usableCommandCheck(root, changeDir, run, scope, inputFingerprint).catch(
      () => null,
    );
    // Incremental evidence never survives cold recovery: it is a phase-local
    // accelerator, not a resumable acceptance record.
    if (record?.reusable === true && record.tier !== 'incremental') scopes[scope] = 'revalidated';
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
  return withClassicStateLock(changeDir, async () => {
    const index = await readCheckIndex(changeDir, run.trajectoryRef);
    const event = {
      sequence: index.maximumSequence + 1,
      timestamp: new Date().toISOString(),
      runId: run.runId,
      type,
      data,
    };
    await appendTrajectory(changeDir, run.trajectoryRef, event);
    return event;
  });
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
    tier?: 'full' | 'incremental';
  },
): Promise<RecordedCommandCheck> {
  validateScope(input.scope);
  if (!input.argv.length || input.argv.some((arg) => typeof arg !== 'string' || arg.includes('\0')))
    throw new Error('Check requires literal program arguments');
  const cwd = normalizedCwd(root, input.cwd);
  const realRoot = await fs.realpath(root);
  normalizedCwd(realRoot, await fs.realpath(path.resolve(root, cwd)));
  const tier: 'full' | 'incremental' = input.tier === 'incremental' ? 'incremental' : 'full';
  if (input.reusable) {
    const previous = await latestCommandCheck(root, changeDir, run, input.scope);
    if (
      previous &&
      previous.reusable &&
      (previous.tier ?? 'full') === tier &&
      previous.cwd === cwd &&
      JSON.stringify(previous.argv) === JSON.stringify(input.argv)
    ) {
      const usable = await usableCommandCheck(root, changeDir, run, input.scope);
      if (usable?.sequence === previous.sequence && usable.timestamp === previous.timestamp)
        return { ...usable, reused: true };
    }
  }
  // A failed launch, snapshot, or log write must not expose an older success.
  const started = await checkEvent(changeDir, run, 'command_check_started', { scope: input.scope });
  const checkEpoch =
    (await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0;
  const identity = { argv: input.argv, cwd };
  const inputBefore = (await collectCheckSnapshot(root, changeDir, identity)).digest;
  const environment = await checkEnvironmentFingerprint(
    input.argv,
    path.resolve(root, cwd),
    await readCheckPolicy(root, identity),
  );
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
  const after = await collectCheckSnapshot(root, changeDir, identity).catch(() => null);
  let inputAfter = after ? after.digest : 'unavailable';
  let manifestRef: string | undefined;
  let manifestHash: string | undefined;
  if (after) {
    // The manifest lives under the change's runtime directory, which the
    // input snapshot omits, so recording it never invalidates its own check.
    const manifestPath = path.join(changeDir, '.comet', 'checks', `${randomUUID()}.manifest`);
    await writeClassicProjectText(root, manifestPath, after.manifest, {
      label: 'Classic check manifest',
    });
    manifestRef = path.relative(root, manifestPath).replaceAll('\\', '/');
    manifestHash = checkManifestHash(after.manifest);
  }
  if (
    checkEpoch !==
    ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  )
    inputAfter = 'phase-changed';
  if (
    environment !==
    (await checkEnvironmentFingerprint(
      input.argv,
      path.resolve(root, cwd),
      await readCheckPolicy(root, identity),
    ))
  )
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
    manifestRef,
    manifestHash,
    tier,
    reusable: input.reusable === true && inputBefore === inputAfter,
  };
  const event = await withClassicStateLock(changeDir, async () => {
    const events = (await readCheckIndex(changeDir, run.trajectoryRef)).events;
    const newer = events.some(
      (event) =>
        event.runId === run.runId &&
        event.sequence > started.sequence &&
        ((event.type === 'command_checks_invalidated' &&
          (!Array.isArray(event.data?.scopes) || event.data.scopes.includes(input.scope))) ||
          event.data?.scope === input.scope),
    );
    if (newer) throw new Error('Check superseded by a newer check or invalidation; rerun required');
    return checkEvent(changeDir, run, 'command_check_executed', data);
  });
  return { ...data, sequence: event.sequence, timestamp: event.timestamp, runId: run.runId };
}

async function recordManifestEntries(
  root: string,
  record: RecordedCommandCheck,
): Promise<CheckManifestEntry[] | null> {
  if (typeof record.manifestHash !== 'string' || typeof record.manifestRef !== 'string')
    return null;
  const serialized = await readClassicProjectFile(root, record.manifestRef, {
    label: 'Classic check manifest',
    maxBytes: Number.MAX_SAFE_INTEGER,
  });
  if (checkManifestHash(serialized) !== record.manifestHash) return null;
  return parseCheckManifest(serialized);
}

export interface CommandCheckEvaluation {
  record: RecordedCommandCheck | null;
  /** Why the latest record is not reusable; absent when a record is usable or none exists. */
  reason?: string;
  /** Added, removed and changed input paths relative to the recorded manifest. */
  changedPaths?: string[];
  /** The declared input scope that decided relevance for the changed paths. */
  relevance?: string;
}

export async function evaluateCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
  inputFingerprint: (argv: string[], cwd: string) => Promise<string> = (argv, cwd) =>
    legacyCheckInputFingerprint(root, changeDir, { argv, cwd }),
): Promise<CommandCheckEvaluation> {
  const record = await latestCommandCheck(root, changeDir, run, scope);
  const fail = (reason: string): CommandCheckEvaluation => ({ record: null, reason });
  if (
    record &&
    !record.reusable &&
    (record.checkEpoch ?? 0) !==
      ((await readClassicState(changeDir, { migrate: false })).classic?.checkEpoch ?? 0)
  )
    return fail('check evidence crossed a phase boundary');
  if (!record) return { record: null };
  if (record.provenance !== 'runtime')
    return fail('the latest record was not produced by the runtime');
  if (record.exitCode !== 0) return fail(`the last check failed with exit code ${record.exitCode}`);
  if (!Array.isArray(record.argv) || !record.argv.length || !record.inputBefore)
    return fail('the latest record is incomplete');
  if (record.inputBefore !== record.inputAfter) return fail('inputs changed while the check ran');
  const identity = { argv: record.argv, cwd: record.cwd };
  if (record.manifestRef) {
    // Per-file evidence reuses when the environment binding holds and no
    // recorded input file changed relative to the execution-time manifest.
    if (
      record.environment !==
      (await checkEnvironmentFingerprint(
        record.argv,
        path.resolve(root, record.cwd),
        await readCheckPolicy(root, identity),
      ))
    )
      return fail('the environment changed since execution');
    const baseline = await recordManifestEntries(root, record).catch(() => null);
    if (!baseline) return fail('the recorded input manifest is damaged or missing');
    const current = await collectCheckSnapshot(root, changeDir, identity, { baseline });
    const diff = diffCheckManifests(baseline, current.entries);
    const changedPaths = [...diff.added, ...diff.removed, ...diff.changed];
    if (changedPaths.length) {
      const policy = await readCheckPolicy(root, identity);
      return {
        record: null,
        reason: 'check inputs changed since execution',
        changedPaths,
        relevance: policy.files
          ? `declared inputs (${policy.files.join(', ')})`
          : 'default whole-tree inputs',
      };
    }
  } else {
    // Evidence recorded before per-file manifests existed keeps its original
    // binding semantics: whole-tree inputs, HEAD/index and every environment
    // variable unless a v1 policy declared otherwise.
    if (
      record.environment !==
        (await checkEnvironmentFingerprint(
          record.argv,
          path.resolve(root, record.cwd),
          await readCheckPolicy(root, identity, true),
          true,
        )) ||
      record.inputAfter !== (await inputFingerprint(record.argv, record.cwd))
    )
      return fail('check inputs changed since execution');
  }
  if (typeof record.logRef !== 'string' || typeof record.logHash !== 'string')
    return fail('the evidence log record is incomplete');
  try {
    const log = await readClassicProjectFile(root, record.logRef, {
      label: 'Classic check evidence log',
      maxBytes: 8 * 1024 * 1024,
    });
    if (createHash('sha256').update(log).digest('hex') !== record.logHash)
      return fail('the evidence log is damaged');
  } catch {
    return fail('the evidence log is missing');
  }
  const current = await latestCommandCheck(root, changeDir, run, scope);
  if (
    current?.sequence !== record.sequence ||
    current.timestamp !== record.timestamp ||
    JSON.stringify(current) !== JSON.stringify(record)
  )
    return fail('the evidence was superseded by a newer check');
  return { record };
}

export async function usableCommandCheck(
  root: string,
  changeDir: string,
  run: RunState,
  scope: CommandCheckScope,
  inputFingerprint: (argv: string[], cwd: string) => Promise<string> = (argv, cwd) =>
    legacyCheckInputFingerprint(root, changeDir, { argv, cwd }),
): Promise<RecordedCommandCheck | null> {
  return (await evaluateCommandCheck(root, changeDir, run, scope, inputFingerprint)).record;
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
