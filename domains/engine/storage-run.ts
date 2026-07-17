import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import type { SkillPackage } from '../skill/types.js';
import { runStateFromDocument, type StateDocument } from './state.js';
import { assertRunStorageLayout, type RunStorageLayout } from './storage-layout.js';
import type { RunState } from './types.js';

interface StoredRunState {
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

const STORED_RUN_STATE_KEYS = new Set<keyof StoredRunState>([
  'runId',
  'skill',
  'skillVersion',
  'skillHash',
  'orchestration',
  'currentStep',
  'iteration',
  'pending',
  'pendingRef',
  'trajectoryRef',
  'contextRef',
  'artifactsRef',
  'checkpointRef',
  'status',
  'retries',
]);

function toStoredState(state: RunState): StoredRunState {
  return { ...state };
}

function fromStoredState(json: StoredRunState): RunState {
  const document: StateDocument = {
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
  const parsed = runStateFromDocument(document);
  if (!parsed) throw new Error('Invalid Run state: runId must be a non-empty string');
  return parsed;
}

export function parseStoredRunStateValue(value: unknown): RunState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Run state: stored value must be an object');
  }
  const json = value as Record<string, unknown>;
  const unknown = Object.keys(json).find(
    (key) => !STORED_RUN_STATE_KEYS.has(key as keyof StoredRunState),
  );
  if (unknown) throw new Error(`Invalid Run state: unknown field ${unknown}`);
  if (
    json.currentStep !== null &&
    (typeof json.currentStep !== 'string' || json.currentStep.length === 0)
  ) {
    throw new Error('Invalid Run state: currentStep must be a non-empty string or null');
  }
  if (json.pending !== null && (typeof json.pending !== 'string' || json.pending.length === 0)) {
    throw new Error('Invalid Run state: pending must be a non-empty string or null');
  }
  if (!json.retries || typeof json.retries !== 'object' || Array.isArray(json.retries)) {
    throw new Error('Invalid Run state: retries must be an object');
  }
  return fromStoredState(json as unknown as StoredRunState);
}

function stateFile(changeDir: string, storage: Readonly<RunStorageLayout>): string {
  assertRunStorageLayout(storage);
  return path.resolve(changeDir, ...storage.stateRef.split(/[\\/]/u));
}

export function startRunWithStorage(
  pkg: SkillPackage,
  runId: string,
  skillHash: string,
  storage: Readonly<RunStorageLayout>,
): RunState {
  assertRunStorageLayout(storage);
  return {
    runId,
    skill: pkg.definition.metadata.name,
    skillVersion: pkg.definition.metadata.version,
    skillHash,
    orchestration: pkg.definition.orchestration.mode,
    currentStep: pkg.definition.orchestration.entry ?? null,
    iteration: 0,
    pending: null,
    pendingRef: storage.pendingRef,
    trajectoryRef: storage.trajectoryRef,
    contextRef: storage.contextRef,
    artifactsRef: storage.artifactsRef,
    checkpointRef: storage.checkpointRef,
    status: 'running',
    retries: {},
  };
}

export async function readRunStateAt(
  changeDir: string,
  storage: Readonly<RunStorageLayout>,
): Promise<RunState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(stateFile(changeDir, storage), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseStoredRunStateValue(JSON.parse(raw) as unknown);
}

export async function writeRunStateAt(
  changeDir: string,
  state: RunState,
  storage: Readonly<RunStorageLayout>,
): Promise<void> {
  const file = stateFile(changeDir, storage);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `run-state.${randomUUID()}.tmp`);
  const validated = parseStoredRunStateValue(toStoredState(state));
  await fs.writeFile(temporary, JSON.stringify(toStoredState(validated), null, 2), 'utf8');
  await fs.rename(temporary, file);
}

export async function removeRunStateAt(
  changeDir: string,
  storage: Readonly<RunStorageLayout>,
): Promise<void> {
  await fs.rm(stateFile(changeDir, storage), { force: true });
}
