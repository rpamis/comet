import { promises as fs } from 'node:fs';
import path from 'node:path';

import { atomicWriteJson, type NativeAtomicWriteOptions } from './native-atomic-file.js';
import {
  NATIVE_LOCAL_EXECUTION_SCHEMA,
  type NativeLocalCheckState,
  type NativeLocalExecutionState,
  type NativePortableState,
} from './native-portable-types.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}`);
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function integerValue(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be null or a safe integer`);
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function timestampOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  const result = stringValue(value, label);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
}

function absolutePath(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!path.isAbsolute(result)) throw new Error(`${label} must be absolute`);
  return path.resolve(result);
}

function parseCheck(value: unknown, index: number): NativeLocalCheckState {
  const label = `Native local checks[${index}]`;
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set([
      'id',
      'name',
      'operationId',
      'status',
      'repeatable',
      'timeoutMs',
      'executionCount',
      'argv',
      'cwd',
      'exitCode',
      'startedAt',
      'completedAt',
      'log',
    ]),
    label,
  );
  if (!Array.isArray(root.argv) || root.argv.length === 0) {
    throw new Error(`${label}.argv must be a non-empty array`);
  }
  const argv = root.argv.map((entry, argvIndex) =>
    stringValue(entry, `${label}.argv[${argvIndex}]`, true),
  );
  const status = enumValue(
    root.status,
    ['planned', 'running', 'passed', 'failed', 'interrupted'] as const,
    `${label}.status`,
  );
  const startedAt = timestampOrNull(root.startedAt, `${label}.startedAt`);
  const completedAt = timestampOrNull(root.completedAt, `${label}.completedAt`);
  if (status === 'planned' && (startedAt !== null || completedAt !== null)) {
    throw new Error(`${label} planned check cannot contain execution timestamps`);
  }
  if (status === 'running' && (startedAt === null || completedAt !== null)) {
    throw new Error(`${label} running check requires only startedAt`);
  }
  if (
    (status === 'passed' || status === 'failed') &&
    (startedAt === null || completedAt === null)
  ) {
    throw new Error(`${label} completed check requires startedAt and completedAt`);
  }
  const timeoutMs = integerValue(root.timeoutMs, `${label}.timeoutMs`);
  if (timeoutMs < 1) throw new Error(`${label}.timeoutMs must be positive`);
  return {
    id: stringValue(root.id, `${label}.id`),
    name: stringValue(root.name, `${label}.name`),
    operationId: stringValue(root.operationId, `${label}.operationId`),
    status,
    repeatable: booleanValue(root.repeatable, `${label}.repeatable`),
    timeoutMs,
    executionCount: integerValue(root.executionCount, `${label}.executionCount`),
    argv,
    cwd: absolutePath(root.cwd, `${label}.cwd`),
    exitCode: nullableInteger(root.exitCode, `${label}.exitCode`),
    startedAt,
    completedAt,
    log: stringValue(root.log, `${label}.log`),
  };
}

export function parseNativeLocalExecution(value: unknown): NativeLocalExecutionState {
  const label = 'Native local execution state';
  const root = record(value, label);
  rejectUnknown(
    root,
    new Set(['schema', 'change', 'basedOnStateVersion', 'workspace', 'execution', 'checks']),
    label,
  );
  if (root.schema !== NATIVE_LOCAL_EXECUTION_SCHEMA) {
    throw new Error(`Native local execution schema must be ${NATIVE_LOCAL_EXECUTION_SCHEMA}`);
  }
  const workspaceRoot = record(root.workspace, 'Native local workspace');
  rejectUnknown(
    workspaceRoot,
    new Set(['projectRoot', 'worktreeRoot', 'branch']),
    'Native local workspace',
  );

  let execution: NativeLocalExecutionState['execution'] = null;
  if (root.execution !== null) {
    const executionRoot = record(root.execution, 'Native local execution');
    rejectUnknown(
      executionRoot,
      new Set([
        'operationId',
        'stage',
        'actor',
        'executionId',
        'status',
        'startedAt',
        'requestCheckRounds',
      ]),
      'Native local execution',
    );
    const startedAt = timestampOrNull(executionRoot.startedAt, 'Native local execution.startedAt');
    if (startedAt === null) throw new Error('Native local execution.startedAt is required');
    execution = {
      operationId: stringValue(executionRoot.operationId, 'Native local execution.operationId'),
      stage: enumValue(
        executionRoot.stage,
        ['building', 'checking', 'verifying', 'archiving'] as const,
        'Native local execution.stage',
      ),
      actor:
        executionRoot.actor === null
          ? null
          : enumValue(
              executionRoot.actor,
              ['builder', 'runtime', 'verifier'] as const,
              'Native local execution.actor',
            ),
      executionId: nullableString(executionRoot.executionId, 'Native local execution.executionId'),
      status: enumValue(
        executionRoot.status,
        ['running', 'completed', 'interrupted'] as const,
        'Native local execution.status',
      ),
      startedAt,
      requestCheckRounds: integerValue(
        executionRoot.requestCheckRounds,
        'Native local execution.requestCheckRounds',
      ),
    };
  }

  if (!Array.isArray(root.checks)) throw new Error('Native local checks must be an array');
  const checks = root.checks.map(parseCheck);
  if (new Set(checks.map((check) => check.id)).size !== checks.length) {
    throw new Error('Native local check IDs must be unique');
  }
  if (execution && checks.some((check) => check.operationId !== execution.operationId)) {
    throw new Error('Native local checks must belong to the current operation');
  }
  return {
    schema: NATIVE_LOCAL_EXECUTION_SCHEMA,
    change: stringValue(root.change, 'Native local change'),
    basedOnStateVersion: integerValue(
      root.basedOnStateVersion,
      'Native local basedOnStateVersion',
      1,
    ),
    workspace: {
      projectRoot: absolutePath(workspaceRoot.projectRoot, 'Native local workspace.projectRoot'),
      worktreeRoot: absolutePath(workspaceRoot.worktreeRoot, 'Native local workspace.worktreeRoot'),
      branch: nullableString(workspaceRoot.branch, 'Native local workspace.branch'),
    },
    execution,
    checks,
  };
}

export function rebuildNativeLocalExecution(options: {
  portableState: NativePortableState;
  projectRoot: string;
  worktreeRoot?: string;
  branch?: string | null;
}): NativeLocalExecutionState {
  return parseNativeLocalExecution({
    schema: NATIVE_LOCAL_EXECUTION_SCHEMA,
    change: options.portableState.name,
    basedOnStateVersion: options.portableState.state_version,
    workspace: {
      projectRoot: path.resolve(options.projectRoot),
      worktreeRoot: path.resolve(options.worktreeRoot ?? options.projectRoot),
      branch: options.branch ?? null,
    },
    execution: null,
    checks: [],
  });
}

export async function readNativeLocalExecution(
  file: string,
): Promise<NativeLocalExecutionState | null> {
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Native local execution state is invalid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return parseNativeLocalExecution(value);
}

export async function writeNativeLocalExecution(
  file: string,
  state: NativeLocalExecutionState,
  options: NativeAtomicWriteOptions = {},
): Promise<void> {
  const parsed = parseNativeLocalExecution(state);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteJson(file, parsed, options);
}

export type NativeLocalExecutionRebuildReason = 'missing' | 'invalid' | 'version-mismatch';

export async function readOrRebuildNativeLocalExecution(options: {
  file: string;
  portableState: NativePortableState;
  projectRoot: string;
  worktreeRoot?: string;
  branch?: string | null;
  containedRoot?: string;
}): Promise<{
  state: NativeLocalExecutionState;
  rebuilt: boolean;
  reason: NativeLocalExecutionRebuildReason | null;
}> {
  let current: NativeLocalExecutionState | null = null;
  let reason: NativeLocalExecutionRebuildReason | null = null;
  try {
    current = await readNativeLocalExecution(options.file);
    if (current === null) reason = 'missing';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) throw error;
    reason = 'invalid';
  }
  if (
    current &&
    (current.change !== options.portableState.name ||
      current.basedOnStateVersion !== options.portableState.state_version)
  ) {
    reason = 'version-mismatch';
  }
  if (current && reason === null) return { state: current, rebuilt: false, reason: null };

  const rebuilt = rebuildNativeLocalExecution(options);
  await writeNativeLocalExecution(options.file, rebuilt, {
    ...(options.containedRoot ? { containedRoot: options.containedRoot } : {}),
  });
  return { state: rebuilt, rebuilt: true, reason: reason ?? 'missing' };
}
