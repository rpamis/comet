import path from 'node:path';
import { runGitCommand } from '../../platform/process/git.js';
import type { DispatchResult } from './native-cli-shared.js';
import { nativeRecoveryCommand, type NativeRecovery } from './native-recovery.js';
import { resolveNativeSdkCommandRoot } from './native-runtime-ownership.js';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** CLI、status 和 doctor 共享业务恢复结构，不探测已退休的写入锁。 */
export async function withNativeCommandRecovery(
  result: DispatchResult,
  options: {
    projectRoot: string;
    name?: string;
    error?: unknown;
    application?: string;
    rejectedOutcome?: { actionId: string; attempt: number; inputHash: string; claimToken: string };
  },
): Promise<DispatchResult> {
  if (result.error?.code === 'usage' || result.command === 'hook-guard') return result;
  const data = object(result.data);
  const continuation = object(data.continuation);
  if (object(data.builderReadiness).ready === false && continuation.action === 'builder-handoff')
    return result;
  const suppliedName =
    typeof data.change === 'string'
      ? data.change
      : typeof data.name === 'string'
        ? data.name
        : options.name;
  const name =
    suppliedName && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(suppliedName)
      ? suppliedName
      : undefined;
  let root = result.executionCwd ?? path.resolve(options.projectRoot);
  if (name && result.exitCode !== 0 && !result.executionCwd)
    root = await resolveNativeSdkCommandRoot(root, name, { readOnly: true }).catch(() => root);
  const command = (args: string[]) => nativeRecoveryCommand(args, root);
  const diagnosticArgs = command(['comet', 'native', 'doctor', ...(name ? [name] : [])]);
  const state = object(data.state);
  const finish = object(data.workspaceFinishResult);
  const actualReason =
    typeof finish.message === 'string' ? finish.message : (result.error?.message ?? '');
  const reasonLower = actualReason.toLowerCase();
  const reasonLines = reasonLower.split('\n');
  const worktreeLocked = reasonLines.some((line) => {
    const start = line.indexOf('worktree');
    return start !== -1 && line.indexOf('locked', start + 'worktree'.length + 1) !== -1;
  });
  const gitLocked =
    reasonLower.includes('index.lock') ||
    reasonLower.includes('cannot lock ref') ||
    worktreeLocked ||
    reasonLines.some((line) => {
      const start = line.indexOf('unable to create');
      return start !== -1 && line.indexOf('.lock', start + 'unable to create'.length + 1) !== -1;
    });
  const base: NativeRecovery = {
    schema: 'comet.native.recovery.v1',
    code: 'runtime-recovery-required',
    reason:
      result.error?.message ??
      (typeof object(data.recovery).reason === 'string'
        ? (object(data.recovery).reason as string)
        : 'Inspect the original execution and its retained evidence.'),
    affectedPaths: [],
    owner: null,
    diagnosticArgs,
    recoveryArgs: null,
    preconditions: ['Inspect the original Action before retrying; preserve its receipts.'],
    preserved: {
      candidateId:
        (object(state.builder_handoff).candidate_id as string | undefined) ??
        (data.candidateId as string | undefined) ??
        null,
      shapeConfirmationHash:
        (state.shape_confirmation_hash as string | undefined) ??
        (data.shapeConfirmationHash as string | undefined) ??
        null,
    },
  };
  let recovery = object(data.recovery).schema
    ? (data.recovery as NativeRecovery)
    : object(continuation.recovery).schema
      ? (continuation.recovery as NativeRecovery)
      : undefined;
  if (gitLocked) {
    const gitRoot = typeof finish.targetRoot === 'string' ? finish.targetRoot : root;
    const paths: string[] = [];

    try {
      if (/index\.lock/iu.test(actualReason))
        paths.push(
          path.resolve(gitRoot, runGitCommand(gitRoot, ['rev-parse', '--git-path', 'index.lock'])),
        );
      else if (worktreeLocked)
        paths.push(
          path.join(
            path.resolve(gitRoot, runGitCommand(gitRoot, ['rev-parse', '--git-dir'])),
            'locked',
          ),
        );
    } catch {
      /* 原 Git 错误仍包含失败对象；诊断失败不触碰锁。 */
    }
    recovery = {
      ...base,
      code: 'git-lock',
      reason: actualReason,
      affectedPaths: paths,
      owner: null,
      diagnosticArgs: ['git', '-C', gitRoot, 'status', '--short'],
      recoveryArgs: Array.isArray(finish.recoveryArgs)
        ? command(finish.recoveryArgs as string[])
        : Array.isArray(continuation.commandArgs)
          ? command(continuation.commandArgs as string[])
          : result.command === 'archive' && name
            ? command(['comet', 'native', 'archive', name])
            : null,
      preconditions: [
        'Inspect the original Git command result and resolve its reported Git condition before retrying.',
        'Resolve the reported Git lock or worktree condition, then retry the retained workflow step.',
      ],
    };
  } else if (!recovery && (result.exitCode !== 0 || continuation.disposition === 'blocked')) {
    const actualCommand = Array.isArray(finish.recoveryArgs)
      ? finish.recoveryArgs
      : continuation.commandArgs;
    recovery = {
      ...base,
      code:
        finish.status === 'blocked'
          ? 'workspace-conflict'
          : result.command === 'archive'
            ? 'archive-blocked'
            : 'runtime-recovery-required',
      reason: typeof finish.message === 'string' ? finish.message : base.reason,
      affectedPaths: Array.isArray(finish.blockedPaths) ? (finish.blockedPaths as string[]) : [],
      diagnosticArgs: Array.isArray(finish.diagnosticArgs)
        ? (finish.diagnosticArgs as string[])
        : diagnosticArgs,
      recoveryArgs:
        Array.isArray(actualCommand) && actualCommand.every((arg) => typeof arg === 'string')
          ? command(actualCommand as string[])
          : null,
      preconditions: [
        'Resolve the reported file, transaction, or execution conflict, then retry the original step.',
      ],
    };
  }
  if (!recovery) return result;
  return {
    ...result,
    data: {
      ...data,
      recovery,
      ...(continuation.schema ? { continuation: { ...continuation, recovery } } : {}),
    },
    ...(result.error
      ? {
          envelope: {
            summary: recovery.reason,
            next: {
              command: (recovery.recoveryArgs ?? recovery.diagnosticArgs)
                .map((arg) => (/^[\w./:=+@-]+$/u.test(arg) ? arg : JSON.stringify(arg)))
                .join(' '),
            },
          },
        }
      : {}),
  };
}
