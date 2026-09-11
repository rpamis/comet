import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGitCommand } from '../../platform/process/git.js';
import {
  nativePortableArgvDisplay,
  type NativeCheckPlan,
  type NativeExecutedCheck,
} from './native-check-executor.js';
import { canonicalHash } from './native-canonical-hash.js';
import type { NativeSupervisorMaterial } from './native-supervisor-evidence.js';
import type { NativeSupervisorCheckExecutionState } from './native-supervisor.js';

export type NativeSupervisorCheckBindingKind = 'child' | 'integration';

export function plannedNativeSupervisorCheckState(
  plan: NativeCheckPlan,
): NativeSupervisorCheckExecutionState {
  return {
    id: plan.id,
    name: plan.name,
    status: 'planned',
    repeatable: plan.repeatable,
    executionCount: 0,
    argvDisplay: nativePortableArgvDisplay(plan.argv),
    cwdRef: plan.cwdRef,
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    startedAt: null,
    completedAt: null,
    logRef: null,
  };
}

export function completedNativeSupervisorCheckState(
  previous: NativeSupervisorCheckExecutionState,
  result: NativeExecutedCheck,
): NativeSupervisorCheckExecutionState {
  return {
    ...previous,
    name: result.name,
    status: result.status,
    argvDisplay: [...result.argvDisplay],
    cwdRef: result.cwdRef,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    logRef: result.logRef,
  };
}

export function nativeSupervisorExecutedCheckFromState(
  state: NativeSupervisorCheckExecutionState,
): NativeExecutedCheck {
  if (
    (state.status !== 'passed' && state.status !== 'failed' && state.status !== 'interrupted') ||
    state.startedAt === null ||
    state.completedAt === null ||
    state.logRef === null
  ) {
    throw new Error(`Native Supervisor check ${state.id} has incomplete Runtime evidence`);
  }
  return {
    id: state.id,
    name: state.name,
    argvDisplay: [...state.argvDisplay],
    cwdRef: state.cwdRef,
    status: state.status,
    exitCode: state.exitCode,
    signal: state.signal,
    timedOut: state.timedOut,
    durationMs: state.durationMs,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    repeatable: state.repeatable,
    logRef: state.logRef,
  };
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`));
}

function tryGit(projectRoot: string, args: readonly string[]): string | null {
  try {
    return runGitCommand(projectRoot, args);
  } catch (error) {
    return `unavailable:${error instanceof Error ? error.message : String(error)}`;
  }
}

async function untrackedFiles(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  const raw = tryGit(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (raw === null || raw.startsWith('unavailable:')) return [{ error: raw }];
  return Promise.all(
    raw
      .split('\0')
      .filter(Boolean)
      .sort()
      .map(async (rawPath): Promise<Record<string, unknown>> => {
        const relativePath = rawPath.replaceAll('\\', '/');
        const absolutePath = path.resolve(projectRoot, ...relativePath.split('/'));
        if (!inside(projectRoot, absolutePath)) {
          return { path: relativePath, error: 'escaped' };
        }
        try {
          const stat = await fs.lstat(absolutePath);
          if (stat.isSymbolicLink()) {
            return {
              path: relativePath,
              kind: 'symlink',
              target: await fs.readlink(absolutePath),
            };
          }
          if (!stat.isFile()) {
            return { path: relativePath, kind: 'other', size: stat.size };
          }
          const content = await fs.readFile(absolutePath);
          return {
            path: relativePath,
            kind: 'file',
            size: stat.size,
            digest: createHash('sha256').update(content).digest('hex'),
          };
        } catch (error) {
          return {
            path: relativePath,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  );
}

async function submoduleSnapshots(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  const raw = tryGit(projectRoot, ['ls-files', '--stage', '-z']);
  if (raw === null || raw.startsWith('unavailable:')) return [{ error: raw }];
  const paths = raw
    .split('\0')
    .map((entry) => /^160000\s+[^\s]+\s+\d+\t(.+)$/u.exec(entry)?.[1])
    .filter((entry): entry is string => entry !== undefined)
    .sort();
  return Promise.all(
    paths.map(async (relativePath) => ({
      path: relativePath.replaceAll('\\', '/'),
      head: tryGit(path.resolve(projectRoot, relativePath), ['rev-parse', 'HEAD']),
      status: tryGit(path.resolve(projectRoot, relativePath), [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
      ]),
      diff: tryGit(path.resolve(projectRoot, relativePath), [
        'diff',
        '--binary',
        'HEAD',
        '--submodule=diff',
      ]),
      untracked: await untrackedFiles(path.resolve(projectRoot, relativePath)),
    })),
  );
}

/**
 * Bind Supervisor checks to every observable input that can change their meaning.
 * The returned digest is the only value persisted; raw environment/material content
 * never enters Supervisor state.
 */
export async function nativeSupervisorCheckInputFingerprint(options: {
  kind: NativeSupervisorCheckBindingKind;
  parent: string;
  child: string;
  runId: string;
  projectRoot: string;
  candidateCommit: string;
  integrationCommit?: string;
  contractHash?: string | null;
  plans: readonly NativeCheckPlan[];
  materials: readonly NativeSupervisorMaterial[];
}): Promise<string> {
  const environment = Object.entries(process.env)
    .map(([key, value]) => [key, value ?? null] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return canonicalHash('comet.native.supervisor-check-input.v2', {
    kind: options.kind,
    parent: options.parent,
    child: options.child,
    runId: options.runId,
    projectRoot: path.resolve(options.projectRoot),
    candidateCommit: options.candidateCommit,
    integrationCommit: options.integrationCommit ?? null,
    contractHash: options.contractHash ?? null,
    plans: options.plans,
    materials: options.materials,
    machineId: os.hostname(),
    runtime: {
      execPath: process.execPath,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      environment,
    },
    git: {
      head: tryGit(options.projectRoot, ['rev-parse', 'HEAD']),
      branch: tryGit(options.projectRoot, ['branch', '--show-current']),
      status: tryGit(options.projectRoot, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--ignore-submodules=none',
      ]),
      diff: tryGit(options.projectRoot, ['diff', '--binary', 'HEAD', '--submodule=diff']),
      stagedDiff: tryGit(options.projectRoot, ['diff', '--cached', '--binary', '--submodule=diff']),
      submodules: await submoduleSnapshots(options.projectRoot),
      untracked: await untrackedFiles(options.projectRoot),
    },
  });
}

export function nativeSupervisorCheckMachineId(): string {
  return os.hostname();
}
