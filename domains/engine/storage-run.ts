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
  return runStateFromDocument(document)!;
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
  return fromStoredState(JSON.parse(raw) as StoredRunState);
}

export async function writeRunStateAt(
  changeDir: string,
  state: RunState,
  storage: Readonly<RunStorageLayout>,
): Promise<void> {
  const file = stateFile(changeDir, storage);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `run-state.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(toStoredState(state), null, 2), 'utf8');
  await fs.rename(temporary, file);
}

export async function removeRunStateAt(
  changeDir: string,
  storage: Readonly<RunStorageLayout>,
): Promise<void> {
  await fs.rm(stateFile(changeDir, storage), { force: true });
}
