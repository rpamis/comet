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
  listNativeVerificationReceiptRefs,
  readNativeImplementationScopeBundle,
  readNativeVerificationReceipt,
  writeNativeVerificationReceipt,
} from './native-evidence-storage.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { redactNativeCredentialText } from './native-redaction.js';
import {
  NativeReceiptScopeStaleError,
  type NativeReceiptFenceChangedPath,
  type NativeReceiptScopeRecovery,
} from './native-receipt-errors.js';
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

export interface NativeReceiptFenceInspection {
  matched: boolean;
  expectedScopeHash: string;
  actualScopeHash: string;
  expectedSnapshotHash: string;
  actualSnapshotHash: string;
  changedPaths: NativeReceiptFenceChangedPath[];
  changedPathCount: number;
  changedPathsTruncated: boolean;
}

export interface NativeIssuedVerificationReceipt {
  receipt: NativeVerificationReceipt;
  ref: string;
  recovery?: NativeReceiptScopeRecovery;
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

const NATIVE_RECEIPT_BINDING_FIELDS = [
  'change',
  'sourceRevision',
  'contractHash',
  'scopeHash',
  'snapshotHash',
  'artifactHash',
] as const satisfies readonly (keyof NativeVerificationReceiptBindings)[];

export interface NativeReceiptBindingComparison {
  ok: boolean;
  mismatches: string[];
}

/**
 * Compare a receipt's bindings against the expected bindings field-by-field.
 *
 * Unlike a coarse {@link nativeReceiptBindingsMatch} boolean check, this returns
 * a per-field mismatch description so callers can surface exactly which binding
 * diverged (e.g. "sourceRevision: expected 6, got 5") instead of an opaque
 * "invalid" error. This is the diagnostic foundation that lets an Agent recover
 * from a stale receipt without user intervention.
 */
export function compareNativeReceiptBindings(
  receipt: Pick<NativeVerificationReceipt, 'bindings'>,
  expected: NativeVerificationReceiptBindings,
): NativeReceiptBindingComparison {
  const mismatches: string[] = [];
  for (const field of NATIVE_RECEIPT_BINDING_FIELDS) {
    const actual = receipt.bindings[field];
    const wanted = expected[field];
    if (actual !== wanted) {
      mismatches.push(
        `${field}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function nativeReceiptBindingsMatch(
  receipt: Pick<NativeVerificationReceipt, 'bindings'>,
  expected: NativeVerificationReceiptBindings,
): boolean {
  return compareNativeReceiptBindings(receipt, expected).ok;
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

export interface NativeReusableRequiredCheckReceipt {
  receipt: NativeVerificationReceipt;
  ref: string;
  checkReceipt: NativeCheckReceipt;
  checkReceiptRef: string;
}

function isReusableRequiredCheck(options: {
  receipt: NativeVerificationReceipt;
  checkReceipt: NativeCheckReceipt;
  context: NativeVerificationReceiptContext;
}): boolean {
  const { receipt, checkReceipt, context } = options;
  if (
    receipt.kind !== 'static-inspection' ||
    receipt.role !== 'required-check' ||
    receipt.status !== 'passed' ||
    !nativeReceiptBindingsMatch(receipt, context.bindings) ||
    checkReceipt.status !== 'passed' ||
    checkReceipt.stale
  ) {
    return false;
  }
  const selectedFiles = context.scope.scope.changes.filter((change) => change.after !== null);
  const selectedBytes = selectedFiles.reduce((total, change) => total + change.after!.size, 0);
  return (
    checkReceipt.change === context.bindings.change &&
    checkReceipt.sourceRevision === context.bindings.sourceRevision &&
    checkReceipt.contract.expectedHash === context.bindings.contractHash &&
    checkReceipt.contract.beforeHash === context.bindings.contractHash &&
    checkReceipt.contract.afterHash === context.bindings.contractHash &&
    checkReceipt.implementation.scopeHash === context.bindings.scopeHash &&
    checkReceipt.implementation.expectedSnapshotHash === context.bindings.snapshotHash &&
    checkReceipt.implementation.beforeSnapshotHash === context.bindings.snapshotHash &&
    checkReceipt.implementation.afterSnapshotHash === context.bindings.snapshotHash &&
    checkReceipt.counts.filesSelected === selectedFiles.length &&
    checkReceipt.counts.filesScanned + checkReceipt.counts.binaryFilesSkipped ===
      selectedFiles.length &&
    checkReceipt.counts.bytesScanned === selectedBytes &&
    checkReceipt.counts.issueCount === 0 &&
    checkReceipt.counts.recordedIssueCount === 0 &&
    checkReceipt.issues.length === 0 &&
    !checkReceipt.issuesTruncated
  );
}

/**
 * Find a passed required-check receipt that still proves the current Verify
 * scope. The directory scan is deliberately skipped when no typed receipts
 * exist, keeping the first Verify pass on the existing fast path.
 */
export async function findNativeReusableRequiredCheckReceipt(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
}): Promise<NativeReusableRequiredCheckReceipt | null> {
  const refs = await listNativeVerificationReceiptRefs(options.paths, options.state.name);
  if (refs.length === 0) return null;

  const candidates: Array<{
    ref: string;
    receipt: Extract<NativeVerificationReceipt, { kind: 'static-inspection' }>;
  }> = [];
  for (const ref of refs) {
    try {
      const receipt = await readNativeVerificationReceipt(options.paths, options.state.name, ref);
      if (
        receipt.kind === 'static-inspection' &&
        receipt.role === 'required-check' &&
        receipt.status === 'passed'
      ) {
        candidates.push({ ref, receipt });
      }
    } catch {
      // A stale, deleted, or malformed historical receipt is not reusable.
    }
  }
  if (candidates.length === 0) return null;

  let context: NativeVerificationReceiptContext;
  try {
    context = await loadNativeVerificationReceiptContext(options.paths, options.state);
    const fence = await currentReceiptFence({ paths: options.paths, context });
    if (!fence.matched) return null;
  } catch {
    return null;
  }

  let reusable: NativeReusableRequiredCheckReceipt | null = null;
  for (const { ref, receipt } of candidates) {
    try {
      const checkReceipt = await validateNativeStaticReceiptDependency({
        paths: options.paths,
        state: options.state,
        receipt,
      });
      if (checkReceipt === null || !isReusableRequiredCheck({ receipt, checkReceipt, context })) {
        continue;
      }
      const candidate = {
        receipt,
        ref,
        checkReceipt,
        checkReceiptRef: receipt.evidence.checkReceiptRef,
      };
      if (
        reusable === null ||
        candidate.receipt.issuedAt > reusable.receipt.issuedAt ||
        (candidate.receipt.issuedAt === reusable.receipt.issuedAt && candidate.ref > reusable.ref)
      ) {
        reusable = candidate;
      }
    } catch {
      // A stale, deleted, or malformed historical receipt is not reusable;
      // execute a fresh required check instead.
    }
  }
  return reusable;
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
  await assertNativeReceiptScopeCurrent({
    paths: options.paths,
    state: options.state,
    context,
  });
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

const MAX_NATIVE_RECEIPT_FENCE_CHANGED_PATHS = 20;

function inspectNativeReceiptFenceChanges(
  expected: NativeSnapshotProjection,
  actual: NativeSnapshotProjection,
): Pick<
  NativeReceiptFenceInspection,
  'changedPaths' | 'changedPathCount' | 'changedPathsTruncated'
> {
  const changedPaths: NativeReceiptFenceChangedPath[] = [];
  let changedPathCount = 0;
  let expectedIndex = 0;
  let actualIndex = 0;
  while (expectedIndex < expected.entries.length || actualIndex < actual.entries.length) {
    const expectedEntry = expected.entries[expectedIndex];
    const actualEntry = actual.entries[actualIndex];
    const order =
      expectedEntry === undefined
        ? 1
        : actualEntry === undefined
          ? -1
          : expectedEntry.path < actualEntry.path
            ? -1
            : expectedEntry.path > actualEntry.path
              ? 1
              : 0;
    const before = order <= 0 ? expectedEntry : undefined;
    const after = order >= 0 ? actualEntry : undefined;
    if (order <= 0) expectedIndex += 1;
    if (order >= 0) actualIndex += 1;
    if (before && after && before.hash === after.hash && before.size === after.size) continue;
    const pathValue = before?.path ?? after?.path;
    if (!pathValue) continue;
    changedPathCount += 1;
    if (changedPaths.length < MAX_NATIVE_RECEIPT_FENCE_CHANGED_PATHS) {
      changedPaths.push({
        path: pathValue,
        kind: before ? (after ? 'modified' : 'removed') : 'added',
      });
    }
  }
  return {
    changedPaths,
    changedPathCount,
    changedPathsTruncated: changedPaths.length !== changedPathCount,
  };
}

function nativeReceiptScopeRecovery(
  change: string,
  inspection: NativeReceiptFenceInspection,
  commandExecuted: boolean,
): NativeReceiptScopeRecovery {
  return {
    reason: commandExecuted
      ? 'implementation-changed-during-command'
      : 'implementation-scope-stale',
    commandExecuted,
    expectedScopeHash: inspection.expectedScopeHash,
    actualScopeHash: inspection.actualScopeHash,
    expectedSnapshotHash: inspection.expectedSnapshotHash,
    actualSnapshotHash: inspection.actualSnapshotHash,
    changedPaths: inspection.changedPaths,
    changedPathCount: inspection.changedPathCount,
    changedPathsTruncated: inspection.changedPathsTruncated,
    requiredAction: 'return-to-build-and-refresh-implementation-scope',
    nextCommand: `comet native next ${change} --summary "Implementation changed after Build; return to Build and refresh scope"`,
    requiresUserDecision: false,
  };
}

function nativeReceiptScopeStaleError(
  change: string,
  inspection: NativeReceiptFenceInspection,
): NativeReceiptScopeStaleError {
  const recovery = nativeReceiptScopeRecovery(change, inspection, false);
  const changed = recovery.changedPaths.map((entry) => `${entry.kind}: ${entry.path}`).join(', ');
  return new NativeReceiptScopeStaleError(
    `Native receipt stopped before command execution because the implementation scope changed after Build${changed ? ` (${changed}${recovery.changedPathsTruncated ? ', ...' : ''})` : ''}. Return to Build with \`${recovery.nextCommand}\`, re-freeze the implementation scope, and then issue fresh receipts.`,
    recovery,
  );
}

async function currentReceiptFence(options: {
  paths: NativeProjectPaths;
  context: NativeVerificationReceiptContext;
  now?: Date;
}): Promise<NativeReceiptFenceInspection> {
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
  const changes = inspectNativeReceiptFenceChanges(options.context.scope.current, bundle.current);
  return {
    expectedScopeHash: options.context.bindings.scopeHash,
    actualScopeHash: bundle.scope.scopeHash,
    expectedSnapshotHash: options.context.bindings.snapshotHash,
    actualSnapshotHash: bundle.scope.currentProjectionHash,
    matched:
      bundle.scope.currentProjectionHash === options.context.bindings.snapshotHash &&
      bundle.scope.scopeHash === options.context.bindings.scopeHash,
    ...changes,
  };
}

export async function assertNativeReceiptScopeCurrent(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  context?: NativeVerificationReceiptContext;
}): Promise<NativeVerificationReceiptContext> {
  const context =
    options.context ?? (await loadNativeVerificationReceiptContext(options.paths, options.state));
  const inspection = await currentReceiptFence({ paths: options.paths, context });
  if (!inspection.matched) {
    throw nativeReceiptScopeStaleError(options.state.name, inspection);
  }
  return context;
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
}): Promise<NativeIssuedVerificationReceipt> {
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
}): Promise<NativeIssuedVerificationReceipt> {
  const context = await loadNativeVerificationReceiptContext(options.paths, options.state);
  await assertNativeReceiptScopeCurrent({
    paths: options.paths,
    state: options.state,
    context,
  });
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
        snapshotHash: afterFence.actualSnapshotHash,
        scopeHash: afterFence.actualScopeHash,
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
    ...(!afterFence.matched || !worktreeMatched
      ? { recovery: nativeReceiptScopeRecovery(options.state.name, afterFence, true) }
      : {}),
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
