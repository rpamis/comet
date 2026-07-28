import path from 'path';
import {
  readOptionalEngineRunText,
  removeEngineRunFile,
  writeEngineRunText,
  type EngineRunReadOptions,
  type EngineRunRemoveOptions,
  type EngineRunWriteOptions,
} from './protected-run-file.js';
import type { RunState } from './types.js';

export type StateDocument = Record<string, unknown>;

const field = (doc: StateDocument, key: string): string | null => {
  const value = doc[key];
  return value === null || value === undefined ? null : String(value);
};

function requiredString(doc: StateDocument, key: string): string {
  const value = doc[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid Run state: ${key} must be a non-empty string`);
  }
  return value;
}

function requiredRunReference(doc: StateDocument, key: string): string {
  const value = requiredString(doc, key);
  if (
    path.isAbsolute(value) ||
    /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error(`Invalid Run state: ${key} must stay inside the change directory`);
  }
  return value;
}

function retries(doc: StateDocument): Record<string, number> {
  const raw = doc.run_retries ?? '{}';
  let value: unknown;
  try {
    value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error('Invalid Run state: run_retries must be a JSON object', { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Run state: run_retries must be a JSON object');
  }
  for (const count of Object.values(value)) {
    if (!Number.isInteger(count) || Number(count) < 0) {
      throw new Error('Invalid Run state: retry counts must be non-negative integers');
    }
  }
  return value as Record<string, number>;
}

export function runStateFromDocument(doc: StateDocument): RunState | null {
  if (!doc.run_id) return null;
  const runId = requiredString(doc, 'run_id');
  const skill = requiredString(doc, 'skill');
  const skillVersion = requiredString(doc, 'skill_version');
  const skillHash = requiredString(doc, 'skill_hash');
  const pendingRef = requiredRunReference(doc, 'pending_ref');
  const trajectoryRef = requiredRunReference(doc, 'trajectory_ref');
  const contextRef = requiredRunReference(doc, 'context_ref');
  const artifactsRef = requiredRunReference(doc, 'artifacts_ref');
  const checkpointRef = requiredRunReference(doc, 'checkpoint_ref');
  const iteration = Number(doc.iteration);
  if (!Number.isInteger(iteration) || iteration < 0) {
    throw new Error('Invalid Run state: iteration must be a non-negative integer');
  }
  if (doc.orchestration !== 'deterministic' && doc.orchestration !== 'adaptive') {
    throw new Error('Invalid Run state: orchestration must be deterministic or adaptive');
  }
  if (
    doc.run_status !== 'running' &&
    doc.run_status !== 'waiting' &&
    doc.run_status !== 'completed' &&
    doc.run_status !== 'failed'
  ) {
    throw new Error('Invalid Run state: run_status is invalid');
  }
  return {
    runId,
    skill,
    skillVersion,
    skillHash,
    orchestration: doc.orchestration,
    currentStep: field(doc, 'current_step'),
    iteration,
    pending: field(doc, 'pending'),
    pendingRef,
    trajectoryRef,
    contextRef,
    artifactsRef,
    checkpointRef,
    status: doc.run_status,
    retries: retries(doc),
  };
}

/** Write only run_id onto a yaml document (the rest of Run state lives in .comet/run-state.json). */
export function applyRunStateToDocument(doc: StateDocument, state: RunState | null): void {
  if (state) {
    doc.run_id = state.runId;
  } else {
    delete doc.run_id;
  }
}

export const RUN_STATE_FILE = '.comet/run-state.json';
const RUN_STATE_MAX_BYTES = 256 * 1024;

interface RunStateJson {
  runId: string;
  skill: string;
  skillVersion: string;
  skillHash: string;
  orchestration: 'deterministic' | 'adaptive';
  currentStep: string | null;
  iteration: number;
  pending: string | null;
  pendingRef: string;
  trajectoryRef: string;
  contextRef: string;
  artifactsRef: string;
  checkpointRef: string;
  status: 'running' | 'waiting' | 'completed' | 'failed';
  retries: Record<string, number>;
}

function runStateToJson(state: RunState): RunStateJson {
  return {
    runId: state.runId,
    skill: state.skill,
    skillVersion: state.skillVersion,
    skillHash: state.skillHash,
    orchestration: state.orchestration,
    currentStep: state.currentStep,
    iteration: state.iteration,
    pending: state.pending,
    pendingRef: state.pendingRef,
    trajectoryRef: state.trajectoryRef,
    contextRef: state.contextRef,
    artifactsRef: state.artifactsRef,
    checkpointRef: state.checkpointRef,
    status: state.status,
    retries: state.retries,
  };
}

function runStateFromJson(json: RunStateJson): RunState {
  // Validate by round-tripping through the document parser
  const doc: StateDocument = {
    run_id: json.runId,
    skill: json.skill,
    skill_version: json.skillVersion,
    skill_hash: json.skillHash,
    orchestration: json.orchestration,
    current_step: json.currentStep,
    iteration: json.iteration,
    pending: json.pending,
    pending_ref: json.pendingRef,
    trajectory_ref: json.trajectoryRef,
    context_ref: json.contextRef,
    artifacts_ref: json.artifactsRef,
    checkpoint_ref: json.checkpointRef,
    run_status: json.status,
    run_retries: JSON.stringify(json.retries),
  };
  return runStateFromDocument(doc)!;
}

export async function readRunState(
  changeDir: string,
  options: EngineRunReadOptions = {},
): Promise<RunState | null> {
  const raw = await readOptionalEngineRunText(
    changeDir,
    RUN_STATE_FILE,
    RUN_STATE_MAX_BYTES,
    'Run state',
    options,
  );
  if (raw === null) return null;
  const json = JSON.parse(raw) as RunStateJson;
  return runStateFromJson(json);
}

export async function writeRunState(
  changeDir: string,
  state: RunState,
  options: EngineRunWriteOptions = {},
): Promise<void> {
  await writeEngineRunText(
    changeDir,
    RUN_STATE_FILE,
    JSON.stringify(runStateToJson(state), null, 2),
    RUN_STATE_MAX_BYTES,
    'Run state',
    options,
  );
}

export async function removeRunState(
  changeDir: string,
  options: EngineRunRemoveOptions = {},
): Promise<void> {
  await removeEngineRunFile(changeDir, RUN_STATE_FILE, 'Run state', options);
}
