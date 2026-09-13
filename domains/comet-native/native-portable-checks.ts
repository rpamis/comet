import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGitCommand } from '../../platform/process/git.js';
import { canonicalHash } from './native-canonical-hash.js';
import {
  executeNativeCheck,
  nativeCheckPlanKey,
  nativePortableArgvDisplay,
  preflightNativeCheckPlans,
  resolveNativeCheckCwd,
  validateNativeCheckPlan,
  type NativeCheckPlan,
} from './native-check-executor.js';
import {
  NATIVE_MAX_REQUEST_CHECK_ROUNDS,
  recordNativeVerifierExecutionError,
  returnNativeCandidateToBuild,
} from './native-loop-runtime.js';
import {
  readNativeLocalExecution,
  readOrRebuildNativeLocalExecution,
  rebuildNativeLocalExecution,
  writeNativeLocalExecution,
} from './native-local-execution.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { toNativePortableText } from './native-portable-text.js';
import type {
  NativeLocalCheckState,
  NativeLocalExecutionState,
  NativePortableCheckSummary,
  NativePortableState,
} from './native-portable-types.js';
import type { NativeTrustedVerifierEnvelope } from './native-runner-protocol.js';
import {
  type NativeVerifierCheckRequest,
  type NativeVerifierResponse,
} from './native-verifier-protocol.js';
import {
  isInsidePath,
  nativePreferredChangeRuntimeDir,
  resolveContainedNativePath,
} from './native-paths.js';
import { mapWithConcurrency } from './native-concurrency.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  currentBranch,
  nativeLocalExecutionFile,
  readNativePortableChange,
  writePortableMutation,
} from './native-portable-storage.js';
import { ensureNativePortableAcceptanceCurrentLocked } from './native-portable-requirements.js';

export function localCheckCwdRef(projectRoot: string, cwd: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(cwd));
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Native local check cwd escaped the project root');
  }
  const cwdRef = relative.length === 0 ? '.' : relative.split(path.sep).join('/');
  resolveNativeCheckCwd(projectRoot, cwdRef);
  return cwdRef;
}

export function nativeLocalCheckPlanKey(check: NativeLocalCheckState, projectRoot: string): string {
  const [executable, ...argv] = check.argv;
  if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
  return nativeCheckPlanKey({
    id: check.id,
    name: check.name,
    executable,
    argv,
    cwdRef: localCheckCwdRef(projectRoot, check.cwd),
    timeoutMs: check.timeoutMs,
    repeatable: check.repeatable,
  });
}

export function sameNativeCheckPlan(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
  state: NativePortableState,
  inputFingerprint: string,
  branch: string | null,
): boolean {
  if (
    local.candidateId !== state.builder_handoff?.candidate_id ||
    local.inputFingerprint !== inputFingerprint ||
    path.resolve(local.workspace.projectRoot) !== path.resolve(projectRoot) ||
    path.resolve(local.workspace.worktreeRoot) !== path.resolve(projectRoot) ||
    local.workspace.branch !== branch ||
    local.workspace.machineId !== os.hostname()
  ) {
    return false;
  }
  if (local.checks.length !== plans.length) return false;
  return local.checks.every(
    (check, index) =>
      nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
  );
}

export function sameNativeCheckCommands(
  local: NativeLocalExecutionState,
  plans: readonly NativeCheckPlan[],
  projectRoot: string,
): boolean {
  return (
    local.checks.length === plans.length &&
    local.checks.every(
      (check, index) =>
        nativeLocalCheckPlanKey(check, projectRoot) === nativeCheckPlanKey(plans[index]),
    )
  );
}

function localCheck(
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    id: plan.id,
    name: plan.name,
    operationId,
    status: 'planned',
    repeatable: plan.repeatable,
    timeoutMs: plan.timeoutMs,
    executionCount: 0,
    argv: [plan.executable, ...plan.argv],
    cwd: resolveNativeCheckCwd(projectRoot, plan.cwdRef),
    exitCode: null,
    startedAt: null,
    completedAt: null,
    log: `logs/checks/${operationId}-${plan.id}.log`,
  };
}

function resetInterruptedCheck(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  if (!previous.repeatable) {
    throw new Error(
      `Native check ${previous.id} was interrupted and is not repeatable; user resolution is required`,
    );
  }
  return resetNativeCheckForExecution(previous, plan, operationId, projectRoot);
}

function resetNativeCheckForExecution(
  previous: NativeLocalCheckState,
  plan: NativeCheckPlan,
  operationId: string,
  projectRoot: string,
): NativeLocalCheckState {
  return {
    ...localCheck(plan, operationId, projectRoot),
    executionCount: previous.executionCount,
  };
}

function digestNativeCheckInput(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const NATIVE_IGNORED_INPUT_MAX_FILES = 20_000;

const NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const NATIVE_GENERATED_INPUT_DIRECTORIES = [
  'build',
  'dist',
  'gen',
  'generated',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
] as const;

interface NativeIgnoredInputFile {
  path: string;
  digest: string;
  size: number;
}

interface NativeIgnoredInputSnapshot {
  complete: boolean;
  files: NativeIgnoredInputFile[];
}

const NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES = new Set([
  '.agents',
  '.cache',
  '.claude',
  '.codex',
  '.comet',
  '.git',
  '.idea',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.svelte-kit',
  '.tmp',
  '.turbo',
  '.vscode',
  '.worktrees',
  'coverage',
  'logs',
  'node_modules',
  'temp',
  'tmp',
]);

function incompleteNativeIgnoredInputSnapshot(): NativeIgnoredInputSnapshot {
  return { complete: false, files: [] };
}

function nativeGeneratedInputPathspecs(cwdRef: string): string[] {
  const prefix = cwdRef === '.' ? '' : `${cwdRef}/`;
  return NATIVE_GENERATED_INPUT_DIRECTORIES.flatMap((directory) => [
    `:(glob)${prefix}${directory}/**`,
    `:(glob)${prefix}**/${directory}/**`,
  ]);
}

function sensitiveNativeIgnoredInputPath(relative: string): boolean {
  return /(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:key|pem|p12|pfx))$/iu.test(relative);
}

async function nativeIgnoredCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
): Promise<NativeIgnoredInputSnapshot> {
  const cwdRefs = [...new Set(plans.map(({ cwdRef }) => cwdRef))];
  if (cwdRefs.length === 0) return { complete: true, files: [] };

  let ignoredPaths: string[];
  try {
    ignoredPaths = [
      ...new Set(
        runGitCommand(projectRoot, [
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '-z',
          '--',
          ...cwdRefs.flatMap(nativeGeneratedInputPathspecs),
        ])
          .split('\0')
          .filter(Boolean)
          .map((relative) => relative.replaceAll('\\', '/')),
      ),
    ].sort();
  } catch {
    return incompleteNativeIgnoredInputSnapshot();
  }
  if (ignoredPaths.length > NATIVE_IGNORED_INPUT_MAX_FILES) {
    return incompleteNativeIgnoredInputSnapshot();
  }

  const files: NativeIgnoredInputFile[] = [];
  let totalBytes = 0;
  for (const relative of ignoredPaths) {
    const target = path.resolve(projectRoot, ...relative.split('/'));
    if (!isInsidePath(projectRoot, target) || sensitiveNativeIgnoredInputPath(relative)) {
      return incompleteNativeIgnoredInputSnapshot();
    }
    try {
      const before = await fs.lstat(target);
      if (!before.isFile() || totalBytes + before.size > NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES) {
        return incompleteNativeIgnoredInputSnapshot();
      }
      const content = await fs.readFile(target);
      const after = await fs.lstat(target);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        return incompleteNativeIgnoredInputSnapshot();
      }
      totalBytes += before.size;
      files.push({
        path: relative,
        digest: digestNativeCheckInput(content.toString('base64')),
        size: before.size,
      });
    } catch {
      return incompleteNativeIgnoredInputSnapshot();
    }
  }
  return { complete: true, files };
}

async function nativePhysicalCheckInputSnapshot(
  projectRoot: string,
  plans: readonly NativeCheckPlan[],
): Promise<NativeIgnoredInputSnapshot> {
  const cwdRefs = [...new Set(plans.map(({ cwdRef }) => cwdRef))];
  const files = new Map<string, NativeIgnoredInputFile>();
  let totalBytes = 0;
  const isGeneratedDirectory = (name: string): boolean =>
    NATIVE_GENERATED_INPUT_DIRECTORIES.includes(
      name as (typeof NATIVE_GENERATED_INPUT_DIRECTORIES)[number],
    );

  const visit = async (
    directory: string,
    relativeDirectory: string,
    insideGeneratedDirectory: boolean,
  ): Promise<boolean> => {
    let entries: Dirent<string>[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory() && NATIVE_PHYSICAL_INPUT_EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !(await visit(
            target,
            relative,
            insideGeneratedDirectory || isGeneratedDirectory(entry.name),
          ))
        ) {
          return false;
        }
        continue;
      }
      if (!insideGeneratedDirectory) continue;
      if (sensitiveNativeIgnoredInputPath(relative)) return false;
      if (!entry.isFile()) return false;
      try {
        const before = await fs.lstat(target);
        if (totalBytes + before.size > NATIVE_IGNORED_INPUT_MAX_TOTAL_BYTES) return false;
        const content = await fs.readFile(target);
        const after = await fs.lstat(target);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return false;
        totalBytes += before.size;
        files.set(relative, {
          path: relative,
          digest: digestNativeCheckInput(content.toString('base64')),
          size: before.size,
        });
        if (files.size > NATIVE_IGNORED_INPUT_MAX_FILES) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  for (const cwdRef of cwdRefs) {
    const directory = resolveNativeCheckCwd(projectRoot, cwdRef);
    const relativeDirectory = cwdRef === '.' ? '' : cwdRef;
    if (
      !(await visit(directory, relativeDirectory, isGeneratedDirectory(path.basename(directory))))
    ) {
      return incompleteNativeIgnoredInputSnapshot();
    }
  }
  return {
    complete: true,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path, 'en')),
  };
}

function nativeLocalCheckEvidenceDigest(
  check: Pick<
    NativeLocalCheckState,
    | 'id'
    | 'name'
    | 'status'
    | 'repeatable'
    | 'timeoutMs'
    | 'argv'
    | 'cwd'
    | 'exitCode'
    | 'startedAt'
    | 'completedAt'
    | 'log'
  >,
  logContent: string,
): string {
  return canonicalHash('comet.native.local-check-evidence.v1', {
    id: check.id,
    name: check.name,
    status: check.status,
    repeatable: check.repeatable,
    timeoutMs: check.timeoutMs,
    argv: check.argv,
    cwd: path.resolve(check.cwd),
    exitCode: check.exitCode,
    startedAt: check.startedAt,
    completedAt: check.completedAt,
    log: check.log,
    logDigest: digestNativeCheckInput(logContent),
  });
}

async function nativeCheckInputFingerprint(options: {
  state: NativePortableState;
  projectRoot: string;
  plans: readonly NativeCheckPlan[];
}): Promise<string> {
  const gitSnapshot = {
    complete: true,
    capture: 'git' as 'git' | 'physical-tree',
    head: null as string | null,
    branch: null as string | null,
    status: null as string | null,
    diff: null as string | null,
    stagedDiff: null as string | null,
    submodules: null as string | null,
    untracked: [] as Array<{ path: string; digest: string | null; size: number | null }>,
    ignored: { complete: true, files: [] as NativeIgnoredInputFile[] },
    physical: { complete: true, files: [] as NativeIgnoredInputFile[] },
    reuseNonce: null as string | null,
  };
  let stableGitView = false;
  try {
    gitSnapshot.head = runGitCommand(options.projectRoot, ['rev-parse', 'HEAD']);
    stableGitView = true;
    gitSnapshot.branch = runGitCommand(options.projectRoot, ['branch', '--show-current']);
    gitSnapshot.status = runGitCommand(options.projectRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--ignore-submodules=none',
    ]);
    gitSnapshot.diff = digestNativeCheckInput(
      runGitCommand(options.projectRoot, ['diff', '--binary', 'HEAD', '--submodule=diff', '--']),
    );
    gitSnapshot.stagedDiff = digestNativeCheckInput(
      runGitCommand(options.projectRoot, [
        'diff',
        '--cached',
        '--binary',
        '--submodule=diff',
        '--',
      ]),
    );
    gitSnapshot.submodules = runGitCommand(options.projectRoot, [
      'submodule',
      'status',
      '--recursive',
    ]);
    const untracked = runGitCommand(options.projectRoot, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
    ])
      .split('\0')
      .filter(Boolean)
      .sort();
    gitSnapshot.untracked = await mapWithConcurrency(untracked, 4, async (relative) => {
      const target = path.resolve(options.projectRoot, ...relative.split('/'));
      try {
        const stat = await fs.stat(target);
        const content = await fs.readFile(target);
        return {
          path: relative,
          digest: digestNativeCheckInput(content.toString('base64')),
          size: stat.size,
        };
      } catch {
        return { path: relative, digest: null, size: null };
      }
    });
    if (gitSnapshot.untracked.some(({ digest }) => digest === null)) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    }
    gitSnapshot.ignored = await nativeIgnoredCheckInputSnapshot(options.projectRoot, options.plans);
    if (!gitSnapshot.ignored.complete) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    }
  } catch {
    // Non-Git projects still receive a candidate/tool fingerprint. They do
    // not receive a Git view, so use a bounded physical snapshot instead.
    if (stableGitView) {
      gitSnapshot.complete = false;
      gitSnapshot.reuseNonce = randomUUID();
    } else {
      gitSnapshot.capture = 'physical-tree';
      gitSnapshot.physical = await nativePhysicalCheckInputSnapshot(
        options.projectRoot,
        options.plans,
      );
      gitSnapshot.complete = gitSnapshot.physical.complete;
      if (!gitSnapshot.physical.complete) gitSnapshot.reuseNonce = randomUUID();
    }
  }
  return canonicalHash('comet.native.check-input.v1', {
    candidateId: options.state.builder_handoff?.candidate_id ?? null,
    shapeConfirmationHash: options.state.shape_confirmation_hash ?? null,
    acceptance: options.state.acceptance.map(({ id, source, text }) => ({ id, source, text })),
    git: gitSnapshot,
    projectRoot: path.resolve(options.projectRoot),
    machineId: os.hostname(),
    execPath: process.execPath,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    path: process.env.PATH ?? null,
    pathext: process.env.PATHEXT ?? null,
    environment: Object.entries(process.env)
      .map(([key, value]) => [key, value ?? null] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  });
}

function completedCheckDuration(check: NativeLocalCheckState): number {
  if (check.startedAt === null || check.completedAt === null) return 0;
  return Math.max(0, Date.parse(check.completedAt) - Date.parse(check.startedAt));
}

export function authoritativePortableChecks(options: {
  local: NativeLocalExecutionState;
  projectRoot: string;
  supplied: readonly NativePortableCheckSummary[];
  requestedNames?: ReadonlyMap<string, string>;
}): NativePortableCheckSummary[] {
  const suppliedById = new Map<string, NativePortableCheckSummary>();
  for (const check of options.supplied) {
    if (suppliedById.has(check.id)) {
      throw new Error(`Native Runtime check summaries contain duplicate ID ${check.id}`);
    }
    suppliedById.set(check.id, check);
  }
  return options.local.checks.map((check) => {
    if (check.status === 'planned' || check.status === 'running') {
      throw new Error(`Native Runtime check ${check.id} has not completed`);
    }
    if (check.status === 'passed' && (check.evidence !== 'runtime' || !check.evidenceDigest)) {
      throw new Error(`Native Runtime check ${check.id} has no Runtime execution evidence`);
    }
    const name = options.requestedNames?.get(check.id) ?? check.name;
    return {
      id: check.id,
      name: toNativePortableText(name),
      argv_display: nativePortableArgvDisplay(check.argv.slice(1)).map((entry) =>
        toNativePortableText(entry),
      ),
      argv_truncated: false,
      cwd_ref: localCheckCwdRef(options.projectRoot, check.cwd),
      status: check.status,
      exit_code: check.exitCode,
      duration_ms: completedCheckDuration(check),
    };
  });
}

function requestCheckPlan(request: NativeVerifierCheckRequest): NativeCheckPlan {
  return {
    id: request.id,
    name: request.name,
    executable: request.executable,
    argv: [...request.argv],
    cwdRef: request.cwdRef,
    timeoutMs: request.timeoutMs,
    repeatable: request.repeatable,
  };
}

export function preservedLocalChecksForVersion(options: {
  local: NativeLocalExecutionState | null;
  state: NativePortableState;
  projectRoot: string;
}): NativeLocalExecutionState {
  if (options.local === null || options.local.change !== options.state.name) {
    return rebuildNativeLocalExecution({
      portableState: options.state,
      projectRoot: options.projectRoot,
      branch: currentBranch(options.projectRoot),
    });
  }
  const operationId = options.local.execution?.operationId ?? randomUUID();
  return {
    ...options.local,
    basedOnStateVersion: options.state.state_version,
    execution: {
      operationId,
      stage: 'checking',
      actor: 'runtime',
      executionId: null,
      status: 'completed',
      startedAt: options.local.execution?.startedAt ?? new Date().toISOString(),
      requestCheckRounds: 0,
    },
    checks: options.local.checks.map((check) =>
      check.status === 'running' || check.status === 'planned'
        ? { ...check, operationId, status: 'interrupted' as const }
        : { ...check, operationId },
    ),
  };
}

export async function readCurrentLocalExecution(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
}): Promise<NativeLocalExecutionState | null> {
  try {
    const local = await readNativeLocalExecution(
      nativeLocalExecutionFile(options.paths, options.state.name),
    );
    if (
      local === null ||
      local.change !== options.state.name ||
      local.basedOnStateVersion !== options.state.state_version
    ) {
      return null;
    }
    return local;
  } catch {
    return null;
  }
}

export async function persistVerifierExecutionError(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  summary: string;
}): Promise<NativePortableState> {
  const local = await readCurrentLocalExecution({ paths: options.paths, state: options.state });
  const next = recordNativeVerifierExecutionError({
    state: options.state,
    summary: options.summary,
  });
  const written = await writePortableMutation({
    paths: options.paths,
    previous: options.state,
    next,
  });
  await writeNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.state.name),
    preservedLocalChecksForVersion({
      local,
      state: written,
      projectRoot: options.paths.projectRoot,
    }),
    { containedRoot: options.paths.runtimeDir },
  );
  return written;
}

async function hasNativeRuntimeCheckEvidence(
  local: NativeLocalExecutionState,
  runtimeDir: string,
): Promise<boolean> {
  for (const check of local.checks) {
    if (check.status !== 'passed') continue;
    if (check.evidence !== 'runtime') return false;
    try {
      const logFile = await resolveContainedNativePath(
        runtimeDir,
        path.resolve(runtimeDir, ...check.log.split(/[\\/]/u)),
      );
      if (!(await fs.stat(logFile)).isFile()) return false;
      const logContent = await fs.readFile(logFile, 'utf8');
      if (
        !check.evidenceDigest ||
        check.evidenceDigest !== nativeLocalCheckEvidenceDigest(check, logContent)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function reserveNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot: string;
  retryCheckIds?: readonly string[];
}): Promise<
  | {
      kind: 'execute';
      state: NativePortableState;
      local: NativeLocalExecutionState;
      plans: NativeCheckPlan[];
    }
  | { kind: 'reuse'; state: NativePortableState; checks: NativePortableCheckSummary[] }
> {
  return withNativeMutationLock(
    options.paths,
    `reserve portable checks ${options.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.name);
      await ensureNativePortableAcceptanceCurrentLocked({ paths: options.paths, state });
      if (state.phase !== 'verify' || state.loop.stage !== 'verify-ready') {
        throw new Error('Native checks require Verify ready state');
      }
      const branch = currentBranch(options.projectRoot);
      const file = nativeLocalExecutionFile(options.paths, state.name);
      let local = (
        await readOrRebuildNativeLocalExecution({
          file,
          portableState: state,
          projectRoot: options.projectRoot,
          branch,
          containedRoot: options.paths.runtimeDir,
        })
      ).state;
      const inputFingerprint = await nativeCheckInputFingerprint({
        state,
        projectRoot: options.projectRoot,
        plans: options.plans,
      });
      const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, state.name);
      const runtimeEvidenceAvailable = await hasNativeRuntimeCheckEvidence(local, runtimeDir);
      const allChecksPassed = local.checks.every((check) => check.status === 'passed');
      const retryIds = options.retryCheckIds === undefined ? null : new Set(options.retryCheckIds);
      const sameBinding =
        local.candidateId === state.builder_handoff?.candidate_id &&
        path.resolve(local.workspace.projectRoot) === path.resolve(options.projectRoot) &&
        path.resolve(local.workspace.worktreeRoot) === path.resolve(options.projectRoot) &&
        local.workspace.branch === branch &&
        local.workspace.machineId === os.hostname() &&
        local.inputFingerprint === inputFingerprint;
      const forceReexecuteForMissingEvidence =
        sameBinding && allChecksPassed && !runtimeEvidenceAvailable;
      if (retryIds && retryIds.size === 0) {
        throw new Error('Native check retry list must contain at least one ID');
      }
      if (!sameBinding) {
        // A local overlay from another candidate, workspace or host is not
        // evidence for the current candidate. Rebuild the local overlay before
        // reserving a new plan; the portable state remains untouched.
        const rebuilt = rebuildNativeLocalExecution({
          portableState: state,
          projectRoot: options.projectRoot,
          branch,
        });
        await writeNativeLocalExecution(file, rebuilt, { containedRoot: options.paths.runtimeDir });
        local = rebuilt;
      }
      const planMatches = sameNativeCheckCommands(local, options.plans, options.projectRoot);
      if (
        local.execution?.stage === 'checking' &&
        local.execution.actor === 'runtime' &&
        planMatches &&
        sameNativeCheckPlan(
          local,
          options.plans,
          options.projectRoot,
          state,
          inputFingerprint,
          branch,
        )
      ) {
        const execution = local.execution;
        if (execution.status === 'running') {
          throw new Error('Native check plan is already in progress');
        }
        const interrupted = local.checks.filter((check) => check.status === 'interrupted');
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          allChecksPassed &&
          !forceReexecuteForMissingEvidence
        ) {
          const requestedNames = new Map(options.plans.map(({ id, name }) => [id, name] as const));
          return {
            kind: 'reuse',
            state,
            checks: authoritativePortableChecks({
              local,
              projectRoot: options.projectRoot,
              supplied: [],
              requestedNames,
            }),
          };
        }
        if (
          interrupted.length === 0 &&
          execution.status === 'completed' &&
          !allChecksPassed &&
          !forceReexecuteForMissingEvidence
        ) {
          throw new Error(
            `Native check plan contains a failed check (${local.checks
              .filter(({ status }) => status === 'failed')
              .map(({ id }) => id)
              .join(', ')}); submit a new Builder candidate`,
          );
        }
        if (interrupted.length > 0 && retryIds === null && !forceReexecuteForMissingEvidence) {
          const requestedNames = new Map(options.plans.map(({ id, name }) => [id, name] as const));
          return {
            kind: 'reuse',
            state,
            checks: authoritativePortableChecks({
              local,
              projectRoot: options.projectRoot,
              supplied: [],
              requestedNames,
            }),
          };
        }
        if (retryIds) {
          const unknown = [...retryIds].filter(
            (id) => !interrupted.some((check) => check.id === id),
          );
          if (unknown.length > 0) {
            throw new Error(
              `Native check retry IDs must refer to interrupted checks: ${unknown.join(', ')}`,
            );
          }
          const exhausted = interrupted.filter(
            (check) => retryIds.has(check.id) && check.executionCount >= 3,
          );
          if (exhausted.length > 0) {
            throw new Error(
              `Native check retry limit (3) reached: ${exhausted.map(({ id }) => id).join(', ')}`,
            );
          }
        }
        if (
          interrupted.length > 0 &&
          interrupted.some((check) => !check.repeatable) &&
          !forceReexecuteForMissingEvidence
        ) {
          const next = returnNativeCandidateToBuild({
            state,
            reason: `A non-repeatable Runtime check was interrupted (${interrupted
              .filter((check) => !check.repeatable)
              .map(({ id }) => id)
              .join(', ')}); a new Builder candidate is required before it can run again.`,
          });
          const written = await writePortableMutation({
            paths: options.paths,
            previous: state,
            next,
          });
          await writeNativeLocalExecution(
            nativeLocalExecutionFile(options.paths, state.name),
            rebuildNativeLocalExecution({
              portableState: written,
              projectRoot: options.paths.projectRoot,
              branch: currentBranch(options.paths.projectRoot),
            }),
            { containedRoot: options.paths.runtimeDir },
          );
          throw new Error(
            `Native check ${interrupted.find((check) => !check.repeatable)!.id} was interrupted and is not repeatable; the change returned to Build for a new candidate`,
          );
        }
      }
      if (local.execution !== null && local.checks.length > 0) {
        const sameInterruptedPlan =
          local.execution.stage === 'checking' &&
          local.execution.actor === 'runtime' &&
          local.checks.some((check) => check.status === 'interrupted') &&
          planMatches;
        if (!sameInterruptedPlan && !forceReexecuteForMissingEvidence) {
          throw new Error('Native check plan was already resolved with a different plan');
        }
      } else if (
        (local.execution !== null || local.checks.length > 0) &&
        !forceReexecuteForMissingEvidence
      ) {
        throw new Error('Native check plan was already resolved with a different plan');
      }
      const operationId = randomUUID();
      const operation: NativeLocalExecutionState = {
        ...local,
        candidateId: state.builder_handoff?.candidate_id ?? null,
        inputFingerprint,
        workspace: {
          ...local.workspace,
          projectRoot: path.resolve(options.projectRoot),
          worktreeRoot: path.resolve(options.projectRoot),
          branch: currentBranch(options.projectRoot),
          machineId: os.hostname(),
        },
        execution: {
          operationId,
          stage: 'checking',
          actor: 'runtime',
          executionId: null,
          status: 'running',
          startedAt: new Date().toISOString(),
          requestCheckRounds: 0,
        },
        checks: options.plans.map((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          if (forceReexecuteForMissingEvidence && previous) {
            return resetNativeCheckForExecution(previous, plan, operationId, options.projectRoot);
          }
          if (
            previous?.status === 'interrupted' &&
            (retryIds === null || retryIds.has(previous.id))
          ) {
            return resetInterruptedCheck(previous, plan, operationId, options.projectRoot);
          }
          if (previous) return { ...previous, operationId };
          return localCheck(plan, operationId, options.projectRoot);
        }),
      };
      await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });
      return {
        kind: 'execute',
        state,
        local: operation,
        plans: options.plans.filter((plan) => {
          const previous = local.checks.find((check) => check.id === plan.id);
          return (
            forceReexecuteForMissingEvidence ||
            previous === undefined ||
            (previous.status === 'interrupted' && (retryIds === null || retryIds.has(previous.id)))
          );
        }),
      };
    },
  );
}

async function updateReservedNativeCheckPlan(options: {
  paths: NativeProjectPaths;
  state: NativePortableState;
  operationId: string;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update portable checks ${options.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.state.name);
      if (
        state.state_version !== options.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.stage !== 'verify-ready'
      ) {
        throw new Error('Native check plan state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        local.execution?.operationId !== options.operationId ||
        local.execution.stage !== 'checking' ||
        local.execution.actor !== 'runtime' ||
        local.execution.status !== 'running'
      ) {
        throw new Error('Native check plan reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  plans: NativeCheckPlan[];
  projectRoot?: string;
  retryCheckIds?: readonly string[];
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  preflightNativeCheckPlans(projectRoot, options.plans);
  const normalizedPlans: NativeCheckPlan[] = [];
  const seenPlanKeys = new Set<string>();
  for (const plan of options.plans) {
    validateNativeCheckPlan(projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    if (seenPlanKeys.has(key)) continue;
    seenPlanKeys.add(key);
    normalizedPlans.push(plan);
  }
  const reservation = await reserveNativePortableCheckPlan({
    ...options,
    plans: normalizedPlans,
    projectRoot,
  });
  if (reservation.kind === 'reuse') return reservation;

  const operationId = reservation.local.execution!.operationId;
  const runtimeDir = nativePreferredChangeRuntimeDir(options.paths, reservation.state.name);
  try {
    for (const plan of reservation.plans) {
      const startedAt = new Date().toISOString();
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                }
              : check,
          ),
        }),
      });
      const result = await executeNativeCheck({
        projectRoot,
        runtimeDir,
        operationId,
        plan,
      });
      const logContent = await fs.readFile(
        path.resolve(runtimeDir, ...result.logRef.split('/')),
        'utf8',
      );
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              evidence: 'runtime' as const,
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
        }),
      });
    }
    await updateReservedNativeCheckPlan({
      paths: options.paths,
      state: reservation.state,
      operationId,
      update: (local) => ({
        ...local,
        execution: { ...local.execution!, status: 'completed' },
      }),
    });
  } catch (error) {
    try {
      await updateReservedNativeCheckPlan({
        paths: options.paths,
        state: reservation.state,
        operationId,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  const finalLocal = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, reservation.state.name),
  );
  if (finalLocal === null)
    throw new Error('Native Runtime check state disappeared after execution');
  return {
    state: reservation.state,
    checks: authoritativePortableChecks({
      local: finalLocal,
      projectRoot,
      supplied: [],
    }),
  };
}

/**
 * Retry only repeatable interrupted checks for the current Builder candidate.
 * The local overlay is read to reconstruct the exact original command, so an
 * Agent cannot silently replace a failed command while claiming a retry.
 */
export async function retryNativePortableCheckPlan(options: {
  paths: NativeProjectPaths;
  name: string;
  checkIds: readonly string[];
  projectRoot?: string;
}): Promise<{ state: NativePortableState; checks: NativePortableCheckSummary[] }> {
  if (options.checkIds.length === 0) {
    throw new Error('Native check retry list must contain at least one ID');
  }
  const projectRoot = options.projectRoot ?? options.paths.projectRoot;
  const state = await readNativePortableChange(options.paths, options.name);
  if (
    state.phase !== 'verify' ||
    state.status !== 'active' ||
    state.loop.stage !== 'verify-ready' ||
    state.builder_handoff === null
  ) {
    throw new Error('Native check retry requires an active Verify-ready candidate');
  }
  const local = await readNativeLocalExecution(
    nativeLocalExecutionFile(options.paths, options.name),
  );
  if (
    local === null ||
    local.change !== state.name ||
    local.basedOnStateVersion !== state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'checking' ||
    local.execution.actor !== 'runtime'
  ) {
    throw new Error('Native check retry has no current Runtime check execution');
  }
  const requested = new Set(options.checkIds);
  if (requested.size !== options.checkIds.length) {
    throw new Error('Native check retry list contains duplicate IDs');
  }
  const checks = local.checks.filter((check) => requested.has(check.id));
  const missing = options.checkIds.filter((id) => !checks.some((check) => check.id === id));
  if (missing.length > 0) {
    throw new Error(`Native check retry IDs are unknown: ${missing.join(', ')}`);
  }
  for (const check of checks) {
    if (check.status !== 'interrupted') {
      throw new Error(`Native check ${check.id} is not interrupted and cannot be retried`);
    }
    if (!check.repeatable) {
      throw new Error(`Native check ${check.id} is not repeatable and cannot be retried`);
    }
    if (check.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${check.id}`);
    }
  }
  const plans = local.checks.map((check) => {
    const [executable, ...argv] = check.argv;
    if (!executable) throw new Error(`Native local check ${check.id} has no executable`);
    return {
      id: check.id,
      name: check.name,
      executable,
      argv,
      cwdRef: localCheckCwdRef(projectRoot, check.cwd),
      timeoutMs: check.timeoutMs,
      repeatable: check.repeatable,
    } satisfies NativeCheckPlan;
  });
  return executeNativePortableCheckPlan({
    paths: options.paths,
    name: options.name,
    plans,
    projectRoot,
    retryCheckIds: options.checkIds,
  });
}

export interface NativePortableRequestChecksOutcome {
  round: number;
  reusedCheckIds: string[];
  executedCheckIds: string[];
}

interface NativeVerifierRequestedCheckReservation {
  state: NativePortableState;
  local: NativeLocalExecutionState;
  verifierExecutionRef: string;
  round: number;
  novelPlans: NativeCheckPlan[];
  requestedNames: ReadonlyMap<string, string>;
  reusedCheckIds: string[];
  suppliedChecks: readonly NativePortableCheckSummary[];
}

export async function reserveVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  state: NativePortableState;
  local: NativeLocalExecutionState;
  envelope: NativeTrustedVerifierEnvelope<unknown>;
  response: Extract<NativeVerifierResponse, { kind: 'request-checks' }>;
  suppliedChecks: readonly NativePortableCheckSummary[];
}): Promise<NativeVerifierRequestedCheckReservation> {
  const file = nativeLocalExecutionFile(options.paths, options.state.name);
  const local = options.local;
  if (
    local === null ||
    local.change !== options.state.name ||
    local.basedOnStateVersion !== options.state.state_version ||
    local.execution === null ||
    local.execution.stage !== 'verifying' ||
    local.execution.actor !== 'verifier' ||
    local.execution.status !== 'running'
  ) {
    throw new Error('Native Verifier request-checks has no active local execution');
  }
  if (
    local.execution.executionId !== null &&
    local.execution.executionId !== options.envelope.verifierExecutionRef
  ) {
    throw new Error('Native Verifier request-checks changed execution within the same attempt');
  }
  if (local.execution.requestCheckRounds >= NATIVE_MAX_REQUEST_CHECK_ROUNDS) {
    throw new Error(
      `Native Verifier request-checks exceeded ${NATIVE_MAX_REQUEST_CHECK_ROUNDS} rounds for this attempt`,
    );
  }

  const existingByKey = new Map<string, NativeLocalCheckState>();
  const existingByKeyAll = new Map<string, NativeLocalCheckState>();
  const existingKeyById = new Map<string, string>();
  for (const check of local.checks) {
    const key = nativeLocalCheckPlanKey(check, options.projectRoot);
    existingByKeyAll.set(key, check);
    if (check.status !== 'interrupted') existingByKey.set(key, check);
    existingKeyById.set(check.id, key);
  }

  const requestedByKey = new Map<string, NativeCheckPlan>();
  const requestedKeyById = new Map<string, string>();
  for (const request of options.response.checks) {
    const plan = requestCheckPlan(request);
    validateNativeCheckPlan(options.projectRoot, plan);
    const key = nativeCheckPlanKey(plan);
    const previousRequestKey = requestedKeyById.get(plan.id);
    if (previousRequestKey !== undefined && previousRequestKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} refers to conflicting commands`);
    }
    const existingKey = existingKeyById.get(plan.id);
    if (existingKey !== undefined && existingKey !== key) {
      throw new Error(`Native Verifier check ID ${plan.id} conflicts with a Runtime check`);
    }
    requestedKeyById.set(plan.id, key);
    const existing = existingByKeyAll.get(key);
    if (existing?.status === 'interrupted' && !existing.repeatable) {
      throw new Error(
        `Native check ${existing.id} was interrupted and is not repeatable; user resolution is required`,
      );
    }
    if (existing?.status === 'interrupted' && existing.executionCount >= 3) {
      throw new Error(`Native check retry limit (3) reached: ${existing.id}`);
    }
    if (!requestedByKey.has(key)) requestedByKey.set(key, plan);
  }

  preflightNativeCheckPlans(options.projectRoot, [...requestedByKey.values()]);

  const requested = [...requestedByKey.entries()];
  const novel = requested.filter(([key]) => !existingByKey.has(key));
  if (local.execution.requestCheckRounds > 0 && novel.length === 0) {
    throw new Error('Native Verifier repeatedly requested only equivalent checks');
  }

  const round = local.execution.requestCheckRounds + 1;
  const requestedNames = new Map(requested.map(([, plan]) => [plan.id, plan.name] as const));
  const operation: NativeLocalExecutionState = {
    ...local,
    execution: {
      ...local.execution,
      stage: 'checking',
      actor: 'runtime',
      executionId: options.envelope.verifierExecutionRef,
      requestCheckRounds: round,
    },
    checks: [
      ...local.checks.map((check) => {
        const key = nativeLocalCheckPlanKey(check, options.projectRoot);
        const plan = requestedByKey.get(key);
        return plan && check.status === 'interrupted'
          ? resetInterruptedCheck(check, plan, local.execution!.operationId, options.projectRoot)
          : check;
      }),
      ...novel
        .filter(([key]) => !existingByKeyAll.has(key))
        .map(([, plan]) => localCheck(plan, local.execution!.operationId, options.projectRoot)),
    ],
  };
  await writeNativeLocalExecution(file, operation, { containedRoot: options.paths.runtimeDir });

  return {
    state: options.state,
    local: operation,
    verifierExecutionRef: options.envelope.verifierExecutionRef,
    round,
    novelPlans: novel.map(([, plan]) => plan),
    requestedNames,
    reusedCheckIds: requested.filter(([key]) => existingByKey.has(key)).map(([, plan]) => plan.id),
    suppliedChecks: options.suppliedChecks,
  };
}

async function updateReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  reservation: NativeVerifierRequestedCheckReservation;
  update: (local: NativeLocalExecutionState) => NativeLocalExecutionState;
}): Promise<NativeLocalExecutionState> {
  return withNativeMutationLock(
    options.paths,
    `update Verifier-requested checks ${options.reservation.state.name}`,
    async () => {
      const state = await readNativePortableChange(options.paths, options.reservation.state.name);
      if (
        state.state_version !== options.reservation.state.state_version ||
        state.phase !== 'verify' ||
        state.loop.next_action !== 'await-verifier-result'
      ) {
        throw new Error('Native Verifier request-checks state changed during execution');
      }
      const file = nativeLocalExecutionFile(options.paths, state.name);
      const local = await readNativeLocalExecution(file);
      const execution = local?.execution;
      if (
        local === null ||
        local.basedOnStateVersion !== state.state_version ||
        execution === null ||
        execution === undefined ||
        execution.operationId !== options.reservation.local.execution?.operationId ||
        execution.stage !== 'checking' ||
        execution.actor !== 'runtime' ||
        execution.status !== 'running' ||
        execution.executionId !== options.reservation.verifierExecutionRef ||
        execution.requestCheckRounds !== options.reservation.round
      ) {
        throw new Error('Native Verifier request-checks reservation changed during execution');
      }
      const next = options.update(local);
      await writeNativeLocalExecution(file, next, { containedRoot: options.paths.runtimeDir });
      return next;
    },
  );
}

export async function executeReservedVerifierRequestedChecks(options: {
  paths: NativeProjectPaths;
  projectRoot: string;
  reservation: NativeVerifierRequestedCheckReservation;
}): Promise<{
  checks: NativePortableCheckSummary[];
  requestChecks: NativePortableRequestChecksOutcome;
}> {
  let operation: NativeLocalExecutionState;
  try {
    for (const plan of options.reservation.novelPlans) {
      const startedAt = new Date().toISOString();
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) =>
            check.id === plan.id
              ? {
                  ...check,
                  status: 'running',
                  executionCount: check.executionCount + 1,
                  startedAt,
                }
              : check,
          ),
        }),
      });
      const runtimeDir = nativePreferredChangeRuntimeDir(
        options.paths,
        options.reservation.state.name,
      );
      const result = await executeNativeCheck({
        projectRoot: options.projectRoot,
        runtimeDir,
        operationId: options.reservation.local.execution!.operationId,
        plan,
      });
      const logContent = await fs.readFile(
        await resolveContainedNativePath(
          runtimeDir,
          path.resolve(runtimeDir, ...result.logRef.split(/[\\/]/u)),
        ),
        'utf8',
      );
      operation = await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          checks: local.checks.map((check) => {
            if (check.id !== plan.id) return check;
            const completed = {
              ...check,
              status: result.status,
              exitCode: result.exitCode,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              log: result.logRef,
              evidence: 'runtime' as const,
            };
            return {
              ...completed,
              evidenceDigest: nativeLocalCheckEvidenceDigest(completed, logContent),
            };
          }),
        }),
      });
    }

    operation = await updateReservedVerifierRequestedChecks({
      paths: options.paths,
      reservation: options.reservation,
      update: (local) => ({
        ...local,
        execution: {
          ...local.execution!,
          stage: 'verifying',
          actor: 'verifier',
          executionId: options.reservation.verifierExecutionRef,
        },
      }),
    });
  } catch (error) {
    try {
      await updateReservedVerifierRequestedChecks({
        paths: options.paths,
        reservation: options.reservation,
        update: (local) => ({
          ...local,
          execution: { ...local.execution!, status: 'interrupted' },
          checks: local.checks.map((check) =>
            check.status === 'planned' || check.status === 'running'
              ? { ...check, status: 'interrupted' as const }
              : check,
          ),
        }),
      });
    } catch {
      // Preserve the original execution failure; recovery will inspect the overlay.
    }
    throw error;
  }
  return {
    checks: authoritativePortableChecks({
      local: operation,
      projectRoot: options.projectRoot,
      supplied: options.reservation.suppliedChecks,
      requestedNames: options.reservation.requestedNames,
    }),
    requestChecks: {
      round: options.reservation.round,
      reusedCheckIds: options.reservation.reusedCheckIds,
      executedCheckIds: options.reservation.novelPlans.map(({ id }) => id),
    },
  };
}
