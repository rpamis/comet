import { promises as fs, type Dirent } from 'fs';

import {
  validateNativeBrief,
  validateNativeSpecChanges,
  validateNativeVerification,
} from './native-artifacts.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { nativeSelectionFile } from './native-selection.js';
import type {
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
  NativeStatusProjection,
} from './native-types.js';

async function selectedName(paths: NativeProjectPaths): Promise<string | null> {
  try {
    const value = JSON.parse(await fs.readFile(nativeSelectionFile(paths), 'utf8')) as {
      schema?: unknown;
      change?: unknown;
    };
    return value.schema === 'comet.native.selection.v1' && typeof value.change === 'string'
      ? value.change
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export function nativeNextCommand(state: NativeChangeState, archiveReady: boolean): string | null {
  if (state.phase === 'archive') {
    return archiveReady ? `comet native archive ${state.name}` : null;
  }
  return `comet native next ${state.name}`;
}

async function statusFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  const changeDir = nativeChangeDir(paths, state.name);
  const findings = [
    ...(await validateNativeBrief(changeDir, state.brief)).findings,
    ...(await validateNativeSpecChanges(paths, state)).findings,
  ];
  if (state.verification_report) {
    findings.push(
      ...(await validateNativeVerification(changeDir, state.verification_report)).findings,
    );
  } else if (
    state.phase === 'verify' ||
    state.phase === 'archive' ||
    state.verification_result === 'pass'
  ) {
    findings.push({
      code: 'verification-report-missing',
      message: 'Native change has no verification report',
    });
  }
  return findings;
}

export async function inspectNativeStatus(
  paths: NativeProjectPaths,
  name: string,
): Promise<NativeStatusProjection> {
  const selected = (await selectedName(paths)) === name;
  let state: NativeChangeState;
  try {
    state = await readNativeChange(paths, name);
  } catch (error) {
    return {
      name,
      phase: 'invalid',
      approval: null,
      verificationResult: 'pending',
      specChanges: 0,
      selected,
      nextCommand: null,
      archiveReady: false,
      error: (error as Error).message,
    };
  }
  const findings = await statusFindings(paths, state);
  const archiveReady =
    state.phase === 'archive' && state.verification_result === 'pass' && findings.length === 0;
  return {
    name: state.name,
    phase: state.phase,
    approval: state.approval,
    verificationResult: state.verification_result,
    specChanges: state.spec_changes.length,
    selected,
    nextCommand: nativeNextCommand(state, archiveReady),
    archiveReady,
    ...(findings[0] ? { error: findings[0].message } : {}),
  };
}

export async function listNativeStatus(
  paths: NativeProjectPaths,
): Promise<NativeStatusProjection[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(paths.changesDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map((name) => inspectNativeStatus(paths, name)));
}

export async function inspectNativeArtifactFindings(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeFinding[]> {
  return statusFindings(paths, state);
}
