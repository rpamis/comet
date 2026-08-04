import path from 'path';

import { RaceSafeReadError, readFileRaceSafe } from '../../platform/fs/race-safe-read.js';

import { NativeArchivePreflightError, NativeSpecConflictError } from './native-archive.js';
import {
  NativeBaselineIncompleteError,
  NativeChangeRevisionConflictError,
  NativeWorkspaceIsolationRequiredError,
} from './native-change.js';
import { discoverNativeProject, nativeProjectPaths } from './native-paths.js';
import { readProjectConfig, resolveNativeProject } from './native-config.js';
import { NativeReceiptScopeStaleError } from './native-receipt-errors.js';
import { NativeVerificationReceiptBindingError } from './native-verification-runtime.js';
import type { CometProjectConfig, NativeProjectPaths } from './native-types.js';

export interface NativeCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface NativeCliErrorShape {
  code:
    | 'usage'
    | 'invalid-data'
    | 'blocked'
    | 'conflict'
    | 'internal'
    | 'baseline-incomplete'
    | 'workspace-isolation-required'
    | 'implementation-scope-stale';
  message: string;
}

export interface DispatchResult {
  command: string | null;
  exitCode: number;
  data?: unknown;
  text?: string;
  error?: NativeCliErrorShape;
}

export const NATIVE_SHOW_MAX_SERIALIZED_BYTES = 10 * 1024 * 1024;

export class NativeUsageError extends Error {}

export const USAGE = `Usage: comet native <command> [options]

Commands:
  hook-guard [--hook-output copilot]
  init [--root <artifact-root>] [--language en|zh-CN]
  root show
  root move <artifact-root>
  new <change-name> [--language en|zh-CN] [--isolation current|branch|worktree] [--change-branch <branch>] [--target-branch <branch>]
  spec remove <change-name> <capability>
  spec rebase <change-name> --summary <text>
  show <change-name>
  status [<change-name>] [--cursor <token>] [--details [--acceptance-cursor <token>]]
  select <change-name>
  checkpoint <change-name> --summary <text> --next-action <text> [--artifact <project-relative>] [--expect-revision <n>]
  check <change-name>
  evidence format [--entries <path>]
  receipt manual <change-name> --acceptance <id> --step <text> --observation <text>
  receipt automated <change-name> --acceptance <id> [--timeout-ms <n>] -- <executable> [args...]
  next <change-name> --summary <text> [--confirmed] [--artifact <path>] [--no-code-reason <text>] [--allow-partial-scope <sha256> --partial-reason <text>] [--result pass|fail] [--report <path>] [--override-repair <sha256> --override-summary <text>]
  archive <change-name> --dry-run [--finish merge|push|pull-request|keep]
  archive <change-name> --expect-preflight <sha256> [--confirmed]
  doctor [<change-name>] [--repair] [--strategy continue|rollback]
`;

export function takeFlag(args: string[], name: string): boolean {
  const indexes = args.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length > 1) throw new NativeUsageError(`${name} may only be provided once`);
  if (indexes.length === 0) return false;
  args.splice(indexes[0], 1);
  return true;
}

export function takeOption(args: string[], name: string): string | undefined {
  const indexes = args.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length > 1) throw new NativeUsageError(`${name} may only be provided once`);
  if (indexes.length === 0) return undefined;
  const index = indexes[0];
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new NativeUsageError(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

export function takeMany(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; ) {
    if (args[index] !== name) {
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new NativeUsageError(`${name} requires a value`);
    }
    values.push(value);
    args.splice(index, 2);
  }
  return values;
}

export function assertNoArguments(args: string[]): void {
  if (args.length > 0) throw new NativeUsageError(`Unexpected argument: ${args[0]}`);
}

export function requiredPositional(args: string[], label: string): string {
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new NativeUsageError(`${label} is required`);
  return value;
}

export function languageOption(args: string[], fallback: 'en' | 'zh-CN' = 'en'): 'en' | 'zh-CN' {
  const language = takeOption(args, '--language') ?? fallback;
  if (language !== 'en' && language !== 'zh-CN') {
    throw new NativeUsageError('--language must be en or zh-CN');
  }
  return language;
}

export function revisionOption(args: string[]): number | undefined {
  const value = takeOption(args, '--expect-revision');
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new NativeUsageError('--expect-revision must be a positive integer');
  }
  return Number(value);
}

export async function projectRootFrom(explicit: string | undefined): Promise<string> {
  return explicit ? path.resolve(explicit) : discoverNativeProject(process.cwd());
}

export async function configuredPaths(projectRoot: string): Promise<{
  config: CometProjectConfig;
  paths: NativeProjectPaths;
}> {
  const resolved = await resolveNativeProject({
    startPath: projectRoot,
    allowMissingConfig: false,
  });
  return { config: resolved.config, paths: resolved.paths };
}

export async function doctorPaths(projectRoot: string): Promise<NativeProjectPaths> {
  const config = await readProjectConfig(projectRoot);
  return nativeProjectPaths(projectRoot, config?.native.artifact_root ?? 'docs');
}

export function success(command: string, data: unknown, text?: string): DispatchResult {
  return { command, exitCode: 0, data, text: text ?? JSON.stringify(data, null, 2) + '\n' };
}

export async function readBoundedEvidenceFile(filePath: string, maxBytes: number): Promise<string> {
  try {
    const { bytes } = await readFileRaceSafe(filePath, maxBytes, {
      label: 'Acceptance evidence entries file',
    });
    return bytes.toString('utf8');
  } catch (error) {
    if (error instanceof RaceSafeReadError) {
      if (error.reason === 'not-regular-file') {
        throw new Error(`Acceptance evidence entries path is not a regular file: ${filePath}`, {
          cause: error,
        });
      }
      if (error.reason === 'too-large') {
        throw new Error(`Acceptance evidence entries file exceeds ${maxBytes} bytes: ${filePath}`, {
          cause: error,
        });
      }
      throw new Error(`Acceptance evidence entries file changed while reading: ${filePath}`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function readBoundedEvidenceStdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new Error(`Acceptance evidence entries on stdin exceed ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function errorResult(command: string | null, error: unknown): DispatchResult {
  if (error instanceof NativeUsageError) {
    return {
      command,
      exitCode: 64,
      error: { code: 'usage', message: error.message },
    };
  }
  if (error instanceof NativeSpecConflictError) {
    return {
      command,
      exitCode: 73,
      data: {
        capability: error.capability,
        expectedHash: error.expectedHash,
        actualHash: error.actualHash,
        canonicalPath: error.canonicalPath,
      },
      error: { code: 'conflict', message: error.message },
    };
  }
  if (error instanceof NativeArchivePreflightError) {
    return {
      command,
      exitCode: 73,
      data: error.preflight,
      error: { code: 'conflict', message: error.message },
    };
  }
  if (error instanceof NativeChangeRevisionConflictError) {
    return {
      command,
      exitCode: 73,
      data: {
        change: error.change,
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
        outcome: 'revision-conflict',
      },
      error: { code: 'conflict', message: error.message },
    };
  }
  if (error instanceof NativeWorkspaceIsolationRequiredError) {
    return {
      command,
      exitCode: 73,
      data: {
        requestedIsolation: error.requestedIsolation,
        activeChanges: error.activeChanges,
        requiredAction: 'create-native-worktree',
      },
      error: { code: 'workspace-isolation-required', message: error.message },
    };
  }
  if (error instanceof NativeBaselineIncompleteError) {
    return {
      command,
      exitCode: 65,
      data: {
        change: error.change,
        complete: false,
        omittedCount: error.omittedCount,
        omittedByReason: error.omittedByReason,
        samplePaths: error.samplePaths,
        sampleTruncated: error.sampleTruncated,
        effectiveLimits: error.effectiveLimits,
        policyHash: error.policyHash,
        configPath: '.comet/config.yaml',
        supportedFixes: [
          'increase native.snapshot.max_files, native.snapshot.max_total_bytes, or native.snapshot.max_duration_ms',
          'add an explicit native.snapshot.exclude pattern for data outside implementation scope',
        ],
        requiredAction: 'resolve-native-baseline',
      },
      error: { code: 'baseline-incomplete', message: error.message },
    };
  }
  if (error instanceof NativeVerificationReceiptBindingError) {
    // Insurance branch: the verify path normally converts binding failures into
    // structured findings, but if one ever escapes (e.g. a direct caller), keep
    // exit code 65 / invalid-data and surface the per-receipt diagnostics in
    // `data` so the Agent still gets an actionable payload.
    return {
      command,
      exitCode: 65,
      data: { receiptBindingFailures: error.details },
      error: { code: 'invalid-data', message: error.message },
    };
  }
  if (error instanceof NativeReceiptScopeStaleError) {
    return {
      command,
      exitCode: 65,
      data: error.recovery,
      error: { code: 'implementation-scope-stale', message: error.message },
    };
  }
  if (error instanceof Error) {
    const systemCode = (error as NodeJS.ErrnoException).code;
    if (
      systemCode &&
      new Set(['EACCES', 'EPERM', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'EROFS']).has(systemCode)
    ) {
      return {
        command,
        exitCode: 70,
        error: { code: 'internal', message: error.message },
      };
    }
    const conflict = /\b(lock|transaction|conflict|occupied|incomplete|recovery)\b/iu.test(
      error.message,
    );
    return {
      command,
      exitCode: conflict ? 73 : 65,
      error: { code: conflict ? 'conflict' : 'invalid-data', message: error.message },
    };
  }
  return {
    command,
    exitCode: 70,
    error: { code: 'internal', message: String(error) },
  };
}

export function render(result: DispatchResult, json: boolean): NativeCommandResult {
  if (json) {
    return {
      exitCode: result.exitCode,
      stdout:
        JSON.stringify({
          command: result.command,
          exitCode: result.exitCode,
          ...(result.data === undefined ? {} : { data: result.data }),
          ...(result.error === undefined ? {} : { error: result.error }),
        }) + '\n',
    };
  }
  if (result.error) {
    return { exitCode: result.exitCode, stderr: result.error.message };
  }
  return { exitCode: result.exitCode, stdout: result.text };
}
