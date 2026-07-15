import path from 'path';

export interface RunStorageLayout {
  stateRef: string;
  pendingRef: string;
  trajectoryRef: string;
  contextRef: string;
  artifactsRef: string;
  checkpointRef: string;
  snapshotsRef: string;
}

export const CLASSIC_RUN_STORAGE: Readonly<RunStorageLayout> = /* @__PURE__ */ Object.freeze({
  stateRef: '.comet/run-state.json',
  pendingRef: '.comet/pending-action.json',
  trajectoryRef: '.comet/trajectory.jsonl',
  contextRef: '.comet/context.md',
  artifactsRef: '.comet/artifacts.json',
  checkpointRef: '.comet/checkpoint.json',
  snapshotsRef: '.comet/skill-snapshots',
});

export const NATIVE_RUN_STORAGE: Readonly<RunStorageLayout> = /* @__PURE__ */ Object.freeze({
  stateRef: 'runtime/run-state.json',
  pendingRef: 'runtime/pending-action.json',
  trajectoryRef: 'runtime/trajectory.jsonl',
  contextRef: 'runtime/context.md',
  artifactsRef: 'runtime/artifacts.json',
  checkpointRef: 'runtime/checkpoints/latest.json',
  snapshotsRef: 'runtime/skill-snapshots',
});

export function assertRunStorageRef(value: string): void {
  if (
    value.length === 0 ||
    path.isAbsolute(value) ||
    /^(?:[A-Za-z]:|[\\/]|~)/u.test(value) ||
    value.split(/[\\/]/u).includes('..')
  ) {
    throw new Error('Run storage ref must stay inside the Run root');
  }
}

export function assertRunStorageLayout(storage: Readonly<RunStorageLayout>): void {
  for (const value of Object.values(storage)) assertRunStorageRef(value);
}
