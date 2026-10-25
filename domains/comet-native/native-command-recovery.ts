import path from 'node:path';
import type { DispatchResult } from './native-cli-shared.js';
import { inspectNativeSdkLocks } from './native-sdk-projection-lock.js';
import {
  NativeLockBusyError,
  inspectNativeLockRecovery,
  inspectNativeProjectLocks,
} from './native-lock.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import { readSdkChangeOwner } from '../workflow-contract/change-runtime-owner.js';
import { runGitCommand } from '../../platform/process/git.js';
import { resolveNativeSdkCommandRoot, inspectNativeSdkRun } from './native-runtime-ownership.js';
import { inspectNativePortableAcceptanceDrift } from './native-portable-requirements.js';
import { nativeRecoveryCommand, type NativeRecovery } from './native-recovery.js';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** CLI、status 和 doctor 共享诊断结构；读取锁不获取锁、不修复文件。 */
export async function withNativeCommandRecovery(
  result: DispatchResult,
  options: {
    projectRoot: string;
    name?: string;
    error?: unknown;
    onlyLocks?: boolean;
    application?: string;
    rejectedOutcome?: { actionId: string; attempt: number; inputHash: string; claimToken: string };
  },
): Promise<DispatchResult> {
  if (result.error?.code === 'usage' || result.command === 'hook-guard') return result;
  const data = object(result.data);
  const continuation = object(data.continuation);
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
  if (options.onlyLocks && options.application?.startsWith('classic-')) return result;
  if (name && result.exitCode !== 0 && !result.executionCwd)
    root = await resolveNativeSdkCommandRoot(root, name, { readOnly: true }).catch(() => root);
  if (options.onlyLocks && options.application && options.application !== 'native') {
    const owner = name ? await readSdkChangeOwner(root, 'native', name, { readOnly: true }) : null;
    if (!owner || owner.application !== options.application) return result;
  }
  const command = (args: string[]) => nativeRecoveryCommand(args, root);
  const diagnosticArgs = command(['comet', 'native', 'doctor', ...(name ? [name] : [])]);
  const state = object(data.state);
  const finish = object(data.workspaceFinishResult);
  const actualReason =
    typeof finish.message === 'string' ? finish.message : (result.error?.message ?? '');
  const base: NativeRecovery = {
    schema: 'comet.native.recovery.v1',
    code: 'runtime-recovery-required',
    reason: result.error?.message ?? 'Inspect the original execution and its retained evidence.',
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
  const findings = Array.isArray(data.findings) ? data.findings.map(object) : [];
  let lock = findings.find(
    (finding) =>
      typeof finding.code === 'string' &&
      /(?:(?:sdk-(?:projection|run-store|application-scope))-(?:lock|coordinator)|native-project-(?:lock|coordinator))-(?:active|stale|unknown|malformed)$/u.test(
        finding.code,
      ),
  );
  if (!lock && name && ['status', 'next', 'archive', 'runtime'].includes(result.command ?? '')) {
    try {
      for (const inspected of await inspectNativeSdkLocks(root, name)) {
        const item = inspected.status === 'missing' ? inspected.coordinator?.[0] : inspected;
        if (item && item.status !== 'missing') {
          lock = {
            ...item,
            code: `sdk-${inspected.kind}-lock-${item.status}`,
            path: 'file' in item ? item.file : inspected.path,
          };
          break;
        }
      }
    } catch {
      // 原读取错误仍在结果中；诊断不能通过尝试写入来掩盖它。
    }
  }
  if (
    !lock &&
    (result.exitCode !== 0 ||
      ['status', 'next', 'archive', 'runtime'].includes(result.command ?? ''))
  ) {
    try {
      const config = await readProjectConfig(root);
      if (config) {
        const projectLock = (
          await inspectNativeProjectLocks(
            await nativeProjectPaths(root, config.native.artifact_root, { readOnly: true }),
          )
        )[0];
        if (projectLock)
          lock = {
            ...projectLock,
            path: projectLock.file,
            code: `native-project-lock-${projectLock.status}`,
            diagnosticArgs: command(['comet', 'native', 'doctor']),
            recoveryArgs: command([
              'comet',
              'native',
              'doctor',
              '--repair',
              '--confirmed',
              '--lock-token',
              projectLock.token!,
            ]),
          };
      }
    } catch {
      // 原读取错误仍在结果中；诊断不能通过尝试写入来掩盖它。
    }
  }
  if (lock) {
    const active = String(lock.code).endsWith('-active');
    const stale = String(lock.code).endsWith('-stale');
    const uncertain = !active && !stale;
    recovery = {
      ...base,
      code: active ? 'lock-active' : stale ? 'lock-stale' : 'lock-owner-unknown',
      reason:
        typeof lock.message === 'string'
          ? lock.message
          : active
            ? 'The original Native writer is still alive.'
            : 'Inspect the original Native writer lock owner before repair.',
      affectedPaths: typeof lock.path === 'string' ? [lock.path] : [],
      owner: lock.owner ?? null,
      diagnosticArgs: Array.isArray(lock.diagnosticArgs)
        ? (lock.diagnosticArgs as string[])
        : diagnosticArgs,
      recoveryArgs:
        active || (uncertain && typeof lock.token !== 'string')
          ? null
          : Array.isArray(lock.recoveryArgs)
            ? (lock.recoveryArgs as string[])
            : command([
                'comet',
                'native',
                'doctor',
                ...(name ? [name] : []),
                '--repair',
                ...(uncertain ? ['--confirmed', '--lock-token', lock.token as string] : []),
              ]),
      preconditions: active
        ? ['Wait for the recorded writer to finish; keep the same original operation.']
        : uncertain
          ? [
              'Confirm that the original writer and all concurrent writers have stopped on every machine.',
              ...(typeof lock.token === 'string'
                ? []
                : [
                    'Inspect the reported path type and resolve the non-regular lock entry; no automatic deletion is offered.',
                  ]),
            ]
          : ['The original local writer has exited; repair only this observed lock.'],
    };
  } else if (
    name &&
    options.rejectedOutcome &&
    /Native (?:Shape artifacts|confirmed acceptance criteria) changed/u.test(actualReason)
  ) {
    const inspected = await inspectNativeSdkRun(root, name, { readOnly: true }).catch(() => null);
    const action = inspected?.run.actions.find(
      (entry) => entry.id === options.rejectedOutcome!.actionId,
    );
    const submitted = options.rejectedOutcome;
    if (
      inspected &&
      action &&
      action.stepId === 'build.builder' &&
      action.status === 'running' &&
      action.attempt === submitted.attempt &&
      action.inputHash === submitted.inputHash &&
      action.claim?.token === submitted.claimToken
    ) {
      const paths = await nativeProjectPaths(root, inspected.artifactRootRef, { readOnly: true });
      const drift = await inspectNativePortableAcceptanceDrift({ paths, state: inspected.state });
      if (drift.drifted && !drift.reviewRequired) {
        recovery = {
          ...base,
          code: 'shape-drift',
          reason: actualReason,
          affectedPaths: (drift.affectedSources ?? []).map((source) =>
            path.resolve(paths.changesDir, name, source),
          ),
          owner: {
            actionId: action.id,
            attempt: action.attempt,
            executorId: action.claim.executorId,
            sessionId: action.claim.sessionId,
          },
          diagnosticArgs: command(['comet', 'native', 'status', name, '--details']),
          recoveryArgs: command([
            'comet',
            'runtime',
            'dispatch',
            '--application',
            options.application ?? 'native',
            '--request',
            '<failure-outcome-request-json-file>',
          ]),
          request: {
            operation: 'record-outcome',
            runId: inspected.run.runId,
            outcome: {
              actionId: action.id,
              attempt: action.attempt,
              inputHash: action.inputHash,
              claimToken: action.claim.token,
              outcomeId: `${action.id}:${action.attempt}:shape-drift`,
              status: 'failed',
              output: { summary: actualReason },
            },
          },
          preconditions: [
            'Only the original claim owner may submit this failure receipt, after confirming its Builder execution and all writers have stopped.',
            'Write request to the named JSON file and execute recoveryArgs. Then read the returned continuation and request explicit revise-requirements approval on this same change. Preserve the Run, documents, and original receipts; do not recreate the change or delete managed Runtime data.',
          ],
          preserved: {
            candidateId: inspected.state.builder_handoff?.candidate_id ?? null,
            shapeConfirmationHash: inspected.state.shape_confirmation_hash ?? null,
          },
        };
      }
    }
  } else if (options.error instanceof NativeLockBusyError) {
    const diagnosis = await inspectNativeLockRecovery(options.error.file).catch(() => null);
    const active = diagnosis?.status === 'active';
    recovery = {
      ...base,
      code: active ? 'lock-active' : 'lock-owner-unknown',
      reason: options.error.message,
      affectedPaths: [options.error.file],
      owner: diagnosis?.owner ?? options.error.owner,
      diagnosticArgs: command(['comet', 'native', 'doctor']),
      recoveryArgs:
        active || !diagnosis?.token
          ? null
          : command([
              'comet',
              'native',
              'doctor',
              '--repair',
              '--confirmed',
              '--lock-token',
              diagnosis.token,
            ]),
      preconditions: [
        active
          ? 'Wait for the recorded process to finish; do not start a competing mutation.'
          : 'Inspect the recorded owner; ordinary doctor repair only takes over a lock it can safely identify.',
      ],
    };
  } else if (
    /(?:index\.lock|cannot lock ref|unable to create[^\n]+\.lock|worktree[^\n]+locked)/iu.test(
      actualReason,
    )
  ) {
    const gitRoot = typeof finish.targetRoot === 'string' ? finish.targetRoot : root;
    const paths: string[] = [];
    try {
      if (/index\.lock/iu.test(actualReason))
        paths.push(
          path.resolve(gitRoot, runGitCommand(gitRoot, ['rev-parse', '--git-path', 'index.lock'])),
        );
      else if (/worktree[^\n]+locked/iu.test(actualReason))
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
          : !options.onlyLocks && result.command === 'archive' && name
            ? command(['comet', 'native', 'archive', name])
            : null,
      preconditions: [
        'Confirm that the original Git command and all concurrent writers have stopped. Git lock files do not prove their owner by age.',
        'Resolve the reported Git lock or worktree condition, then retry the retained workflow step.',
      ],
    };
  } else if (
    !options.onlyLocks &&
    !recovery &&
    (result.exitCode !== 0 || continuation.disposition === 'blocked')
  ) {
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
