import { execFile, spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { terminateProcessTree } from '../../platform/process/terminate-process-tree.js';

import { nativeChangeDir, readNativeChange } from './native-change.js';
import { settleNativeChangeJournalsLocked } from './native-change-recovery.js';
import type { NativeCheckReceipt } from './native-check-receipt.js';
import { readNativeCheckReceipt } from './native-check-receipt-storage.js';
import { collectNativeContractFiles } from './native-contract-files.js';
import {
  readNativeImplementationScopeBundle,
  writeNativeVerificationReceipt,
} from './native-evidence-storage.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { redactNativeCredentialText } from './native-redaction.js';
import { withNativeTransitionLock } from './native-transition-journal.js';
import type { NativeContentSnapshotManifest } from './native-types.js';
import { createNativeCurrentContentSnapshot } from './native-snapshot.js';
import {
  buildNativeVerificationReceipt,
  nativeArtifactBindingHash,
  type NativeVerificationReceipt,
  type NativeVerificationReceiptBindings,
} from './native-verification-receipt.js';
import {
  buildNativeImplementationScopeBundle,
  type NativeImplementationScopeBundle,
  type NativeSnapshotProjection,
} from './native-verification-scope.js';

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
export const MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS = 60 * 60 * 1_000;
const AUTOMATED_COMMAND_TERMINATION_WAIT_MS = 4_000;
const NATIVE_MANUAL_EVIDENCE_ACTOR = 'native-runtime:manual-evidence';
const execFileAsync = promisify(execFile);
const WINDOWS_SHIM_EXTENSIONS = new Set(['.bat', '.cmd', '.ps1']);
type NativeReceiptChildProcess = ChildProcessByStdio<null, Readable, Readable>;
const WINDOWS_POWERSHELL_SCRIPT = [
  "$ProgressPreference = 'SilentlyContinue'",
  '$encoded = $env:COMET_NATIVE_COMMAND_PAYLOAD',
  'Remove-Item Env:COMET_NATIVE_COMMAND_PAYLOAD -ErrorAction SilentlyContinue',
  '$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))',
  '$payload = ConvertFrom-Json $json',
  '$commandArgs = @($payload.arguments)',
  '& $payload.command @commandArgs',
  'if ($null -eq $LASTEXITCODE) { if ($?) { exit 0 } else { exit 1 } }',
  'exit $LASTEXITCODE',
].join('; ');

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...configured, '.ps1'])];
}

function windowsCommandCandidates(command: string, env: NodeJS.ProcessEnv, cwd: string): string[] {
  const hasPath = path.win32.isAbsolute(command) || /[\\/]/u.test(command);
  const directories = hasPath
    ? ['']
    : (env.PATH ?? '')
        .split(path.delimiter)
        .map((directory) => directory.trim().replace(/^"(.*)"$/u, '$1'))
        .filter(Boolean);
  const extension = path.win32.extname(command);
  const names = extension
    ? [command]
    : windowsExecutableExtensions(env).map((candidate) => `${command}${candidate}`);
  return directories.flatMap((directory) =>
    names.map((name) => (directory ? path.join(directory, name) : path.resolve(cwd, name))),
  );
}

function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv, cwd: string): string {
  return (
    windowsCommandCandidates(command, env, cwd).find((candidate) => existsSync(candidate)) ??
    command
  );
}

function powershellExecutable(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SYSTEMROOT ?? env.SystemRoot;
  if (systemRoot) {
    const bundled = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    if (existsSync(bundled)) return bundled;
  }
  return 'powershell.exe';
}

function spawnWindowsShim(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): NativeReceiptChildProcess {
  const payload = Buffer.from(JSON.stringify({ command, arguments: [...args] }), 'utf8').toString(
    'base64',
  );
  const encodedScript = Buffer.from(WINDOWS_POWERSHELL_SCRIPT, 'utf16le').toString('base64');
  return spawn(
    powershellExecutable(options.env),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-InputFormat',
      'None',
      '-OutputFormat',
      'Text',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      encodedScript,
    ],
    {
      cwd: options.cwd,
      env: { ...options.env, COMET_NATIVE_COMMAND_PAYLOAD: payload },
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

function spawnNativeVerificationCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): NativeReceiptChildProcess {
  if (process.platform !== 'win32') {
    return spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  const resolved = resolveWindowsCommand(command, options.env, options.cwd);
  if (WINDOWS_SHIM_EXTENSIONS.has(path.win32.extname(resolved).toLowerCase())) {
    return spawnWindowsShim(resolved, args, options);
  }
  return spawn(resolved, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function withNativeReceiptIssuanceLock<T>(options: {
  paths: NativeProjectPaths;
  name: string;
  operation: string;
  issue: (state: NativeChangeState) => Promise<T>;
}): Promise<T> {
  return withNativeMutationLock(options.paths, options.operation, () =>
    withNativeTransitionLock(options.paths, options.name, options.operation, async () => {
      await settleNativeChangeJournalsLocked(options.paths, options.name);
      return options.issue(await readNativeChange(options.paths, options.name));
    }),
  );
}

export interface NativeVerificationReceiptContext {
  bindings: NativeVerificationReceiptBindings;
  acceptanceIds: string[];
  implementationAuthor: string;
  implementationExecutionId: string;
  scope: NativeImplementationScopeBundle;
}

function boundedText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function normalizeAcceptanceIds(values: readonly string[], expected: readonly string[]): string[] {
  const acceptanceIds = [...values].sort();
  if (
    acceptanceIds.length === 0 ||
    new Set(acceptanceIds).size !== acceptanceIds.length ||
    acceptanceIds.some((id) => !expected.includes(id))
  ) {
    throw new Error('Native receipt acceptance IDs do not match the current contract');
  }
  return acceptanceIds;
}

export async function loadNativeVerificationReceiptContext(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeVerificationReceiptContext> {
  if (state.phase !== 'verify') {
    throw new Error(`Native verification receipt issuance requires Verify, got ${state.phase}`);
  }
  if (!state.implementation_scope) {
    throw new Error('Native verification receipt issuance requires an implementation scope');
  }
  const [scope, contract] = await Promise.all([
    readNativeImplementationScopeBundle(paths, state.name, state.implementation_scope),
    collectNativeContractFiles({
      changeDir: nativeChangeDir(paths, state.name),
      briefRef: state.brief,
      specChanges: state.spec_changes,
    }),
  ]);
  if (scope.scope.contractHash !== contract.contract.contractHash) {
    throw new Error('Native verification receipt contract/scope mismatch');
  }
  const implementationExecutionId = state.run_id
    ? `run:${state.run_id}`
    : `scope:${scope.scope.scopeHash}`;
  return {
    bindings: {
      change: state.name,
      sourceRevision: state.revision,
      contractHash: contract.contract.contractHash,
      scopeHash: scope.scope.scopeHash,
      snapshotHash: scope.scope.currentProjectionHash,
      artifactHash: nativeArtifactBindingHash(scope.scope.declaredArtifacts),
    },
    acceptanceIds: contract.contract.acceptance.map((criterion) => criterion.id).sort(),
    implementationAuthor: `native-implementation:${implementationExecutionId}`,
    implementationExecutionId,
    scope,
  };
}

export function nativeReceiptBindingsMatch(
  receipt: Pick<NativeVerificationReceipt, 'bindings'>,
  expected: NativeVerificationReceiptBindings,
): boolean {
  return JSON.stringify(receipt.bindings) === JSON.stringify(expected);
}

export async function persistNativeStaticInspectionReceipt(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  checkReceipt: NativeCheckReceipt;
  checkReceiptRef: string;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const blocked =
    options.checkReceipt.stale ||
    options.checkReceipt.issues.some((issue) =>
      ['scan-limit', 'scope-mismatch', 'unsafe-file', 'binary-skipped'].includes(issue.kind),
    );
  const status =
    options.checkReceipt.status === 'passed' ? 'passed' : blocked ? 'blocked' : 'failed';
  const receipt = buildNativeVerificationReceipt({
    kind: 'static-inspection',
    role: 'required-check',
    status,
    bindings: context.bindings,
    acceptanceIds: [],
    actor: `native-runtime:${options.checkReceipt.checker.policy}`,
    issuedAt: options.checkReceipt.endedAt,
    evidence: {
      subjects: context.scope.scope.changes.map((change) => change.path).sort(),
      rule: options.checkReceipt.checker.policy,
      resultSummary:
        status === 'passed'
          ? 'The built-in scoped inspection passed without skipped or blocking input.'
          : `The built-in scoped inspection recorded ${options.checkReceipt.counts.issueCount} blocking issue(s).`,
      checkReceiptRef: options.checkReceiptRef,
      checkReceiptHash: options.checkReceipt.receiptHash,
    },
  });
  const ref = await writeNativeVerificationReceipt({
    paths: options.paths,
    name: options.state.name,
    receipt,
  });
  return { receipt, ref };
}

export async function issueNativeManualEvidenceReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  acceptanceIds: readonly string[];
  steps: readonly string[];
  observations: readonly string[];
  now?: Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue manual receipt ${options.name}`,
    issue: (state) => issueNativeManualEvidenceReceiptLocked({ ...options, state }),
  });
}

async function issueNativeManualEvidenceReceiptLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  acceptanceIds: readonly string[];
  steps: readonly string[];
  observations: readonly string[];
  now?: Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const receipt = buildNativeVerificationReceipt({
    kind: 'manual-evidence',
    role: 'acceptance-evidence',
    status: 'passed',
    bindings: context.bindings,
    acceptanceIds: normalizeAcceptanceIds(options.acceptanceIds, context.acceptanceIds),
    actor: NATIVE_MANUAL_EVIDENCE_ACTOR,
    issuedAt: (options.now ?? new Date()).toISOString(),
    evidence: {
      steps: [...options.steps],
      observations: [...options.observations],
    },
  });
  return {
    receipt,
    ref: await writeNativeVerificationReceipt({
      paths: options.paths,
      name: options.state.name,
      receipt,
    }),
  };
}

function projectionManifest(projection: NativeSnapshotProjection): NativeContentSnapshotManifest {
  return {
    schema: 'comet.native.content-snapshot.v1',
    origin: projection.origin,
    ...(projection.capture ? { capture: projection.capture } : {}),
    createdAt: '1970-01-01T00:00:00.000Z',
    complete: projection.complete,
    limits: projection.limits,
    ...(projection.policy ? { policy: projection.policy } : {}),
    entries: projection.entries,
    omitted: projection.omitted,
    omittedCount: projection.omittedCount,
    ...(projection.omissionOverflow ? { omissionOverflow: projection.omissionOverflow } : {}),
  };
}

async function currentReceiptFence(options: {
  paths: NativeProjectPaths;
  context: NativeVerificationReceiptContext;
  now?: Date;
}): Promise<{ snapshotHash: string; scopeHash: string; matched: boolean }> {
  const baseline = projectionManifest(options.context.scope.baseline);
  const current = await createNativeCurrentContentSnapshot(options.paths, baseline, {
    origin: 'explicit',
    now: options.now,
  });
  const bundle = buildNativeImplementationScopeBundle({
    baseline,
    current,
    contractHash: options.context.bindings.contractHash,
    declaredArtifacts: options.context.scope.scope.declaredArtifacts,
    noCodeReason: options.context.scope.scope.noCodeReason,
    gitChangedPaths: options.context.scope.authority.gitChangedPaths,
  });
  return {
    snapshotHash: bundle.scope.currentProjectionHash,
    scopeHash: bundle.scope.scopeHash,
    matched:
      bundle.scope.currentProjectionHash === options.context.bindings.snapshotHash &&
      bundle.scope.scopeHash === options.context.bindings.scopeHash,
  };
}

async function gitWorktreeIdentity(projectRoot: string): Promise<{
  provider: 'git' | 'none';
  root: string;
  commit: string | null;
}> {
  try {
    const [{ stdout: rootOutput }, { stdout: commitOutput }] = await Promise.all([
      execFileAsync('git', ['-C', projectRoot, 'rev-parse', '--show-toplevel'], {
        windowsHide: true,
        timeout: 10_000,
      }),
      execFileAsync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], {
        windowsHide: true,
        timeout: 10_000,
      }),
    ]);
    const absoluteRoot = path.resolve(rootOutput.trim());
    const relativeRoot = path.relative(projectRoot, absoluteRoot).replaceAll('\\', '/');
    if (
      relativeRoot === '..' ||
      relativeRoot.startsWith('../') ||
      path.posix.isAbsolute(relativeRoot)
    ) {
      throw new Error('Git worktree is outside the Native project root');
    }
    const commit = commitOutput.trim().toLowerCase();
    if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw new Error('Git commit identity is invalid');
    return { provider: 'git', root: relativeRoot || '.', commit };
  } catch {
    return { provider: 'none', root: '.', commit: null };
  }
}

export async function issueNativeAutomatedCheckReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  acceptanceIds: readonly string[];
  command: string;
  args: readonly string[];
  timeoutMs?: number;
  now?: () => Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  return withNativeReceiptIssuanceLock({
    paths: options.paths,
    name: options.name,
    operation: `issue automated receipt ${options.name}`,
    issue: (state) => issueNativeAutomatedCheckReceiptLocked({ ...options, state }),
  });
}

async function issueNativeAutomatedCheckReceiptLocked(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  acceptanceIds: readonly string[];
  command: string;
  args: readonly string[];
  timeoutMs?: number;
  now?: () => Date;
}): Promise<{ receipt: NativeVerificationReceipt; ref: string }> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  const beforeWorktree = await gitWorktreeIdentity(options.paths.projectRoot);
  const startedAt = (options.now?.() ?? new Date()).toISOString();
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS
  ) {
    throw new Error(
      `Native automated command timeout must be an integer from 1 through ${MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS}`,
    );
  }
  const output: Buffer[] = [];
  let outputBytes = 0;
  let totalOutputBytes = 0;
  const outputHasher = createHash('sha256');
  let timedOut = false;
  const child = spawnNativeVerificationCommand(options.command, options.args, {
    cwd: options.paths.projectRoot,
    env: { ...process.env },
  });
  const collect = (chunk: Buffer): void => {
    outputHasher.update(chunk);
    totalOutputBytes += chunk.byteLength;
    if (outputBytes >= MAX_COMMAND_OUTPUT_BYTES) return;
    const remaining = MAX_COMMAND_OUTPUT_BYTES - outputBytes;
    const bounded = chunk.subarray(0, remaining);
    output.push(Buffer.from(bounded));
    outputBytes += bounded.byteLength;
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const outcome = await new Promise<{ exitCode: number; signal: string | null }>(
    (resolve, reject) => {
      let finished = false;
      let termination: Promise<void> | null = null;
      let terminationTimer: NodeJS.Timeout | null = null;
      const finish = (result: { exitCode: number; signal: string | null }): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (terminationTimer) clearTimeout(terminationTimer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        termination = terminateProcessTree(child).catch(() => {
          child.kill('SIGKILL');
          child.stdout?.destroy();
          child.stderr?.destroy();
        });
        terminationTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish({ exitCode: 124, signal: 'SIGKILL' });
        }, AUTOMATED_COMMAND_TERMINATION_WAIT_MS);
      }, timeoutMs);
      child.once('error', (error) => {
        if (timedOut) {
          void (termination ?? Promise.resolve()).then(() =>
            finish({ exitCode: 124, signal: 'SIGKILL' }),
          );
          return;
        }
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (terminationTimer) clearTimeout(terminationTimer);
        reject(error);
      });
      child.once('close', (code, signal) => {
        void (termination ?? Promise.resolve()).then(() =>
          finish({
            exitCode: timedOut ? 124 : (code ?? 1),
            signal: signal ?? (timedOut ? 'SIGKILL' : null),
          }),
        );
      });
    },
  );
  const endedAt = (options.now?.() ?? new Date()).toISOString();
  const [afterWorktree, afterFence] = await Promise.all([
    gitWorktreeIdentity(options.paths.projectRoot),
    currentReceiptFence({
      paths: options.paths,
      context,
      now: options.now?.(),
    }),
  ]);
  const capture = context.scope.current.capture;
  const requiresGitIdentity =
    capture?.provider === 'git' ||
    (capture?.provider === 'physical-tree' && capture.projection?.provider === 'git');
  const worktreeMatched =
    (!requiresGitIdentity || beforeWorktree.provider === 'git') &&
    beforeWorktree.provider === afterWorktree.provider &&
    beforeWorktree.root === afterWorktree.root &&
    beforeWorktree.commit === afterWorktree.commit;
  const status =
    timedOut || !afterFence.matched || !worktreeMatched
      ? 'blocked'
      : outcome.exitCode === 0
        ? 'passed'
        : 'failed';
  const summary = Buffer.concat(output, outputBytes).toString('utf8').trim();
  const receipt = buildNativeVerificationReceipt({
    kind: 'automated-check',
    role: 'acceptance-evidence',
    status,
    bindings: context.bindings,
    acceptanceIds: normalizeAcceptanceIds(options.acceptanceIds, context.acceptanceIds),
    actor: `native-runtime:command:${options.command}`,
    issuedAt: endedAt,
    evidence: {
      executable: options.command,
      args: [...options.args],
      cwd: '.',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      timeoutMs,
      startedAt,
      endedAt,
      worktree: {
        provider: beforeWorktree.provider,
        root: beforeWorktree.root,
        beforeCommit: beforeWorktree.commit,
        afterCommit: afterWorktree.commit,
      },
      afterFence: {
        ...afterFence,
        matched: afterFence.matched && worktreeMatched,
      },
      outputHash: outputHasher.digest('hex'),
      outputSummary: boundedText(
        redactNativeCredentialText(summary || `(exit ${outcome.exitCode})`),
        'Native command output summary',
      ),
      outputTruncated: totalOutputBytes > outputBytes,
    },
  });
  return {
    receipt,
    ref: await writeNativeVerificationReceipt({
      paths: options.paths,
      name: options.state.name,
      receipt,
    }),
  };
}

export async function validateNativeStaticReceiptDependency(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  receipt: NativeVerificationReceipt;
}): Promise<NativeCheckReceipt | null> {
  if (options.receipt.kind !== 'static-inspection') return null;
  const check = await readNativeCheckReceipt(
    options.paths,
    options.state.name,
    options.receipt.evidence.checkReceiptRef,
  );
  if (check.receiptHash !== options.receipt.evidence.checkReceiptHash) {
    throw new Error('Native static receipt dependency hash mismatch');
  }
  return check;
}
