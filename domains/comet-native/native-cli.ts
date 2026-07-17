import { promises as fs } from 'fs';
import path from 'path';

import {
  archiveNativeChange,
  NativeArchivePreflightError,
  NativeSpecConflictError,
} from './native-archive.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import {
  createNativeChange,
  inspectNativeChange,
  listNativeChanges,
  NativeChangeRevisionConflictError,
  NativeRuntimeCompatibilityError,
  nativeChangeDir,
  readNativeChange,
} from './native-change.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  resolveNativeProject,
  writeProjectConfig,
} from './native-config.js';
import { inspectNativeStatus, listNativeStatus } from './native-diagnostics.js';
import { doctorNativeProject } from './native-doctor.js';
import { checkpointNativeChange } from './native-progress-checkpoint.js';
import { nativeContinuation } from './native-continuation.js';
import {
  discoverNativeProject,
  ensureNativeDirectories,
  nativeProjectPaths,
  normalizeArtifactRootRef,
} from './native-paths.js';
import { moveNativeRoot } from './native-root-move.js';
import { selectNativeChange } from './native-selection.js';
import {
  markNativeSpecRemoval,
  readNativeProposedSpecs,
  rebaseNativeSpecChanges,
} from './native-specs.js';
import { advanceNativeChange } from './native-transitions.js';
import type {
  CometProjectConfig,
  NativeAdvanceEvidence,
  NativeProjectPaths,
} from './native-types.js';

export interface NativeCommandResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

interface NativeCliErrorShape {
  code: 'usage' | 'invalid-data' | 'conflict' | 'internal';
  message: string;
}

interface DispatchResult {
  command: string | null;
  exitCode: number;
  data?: unknown;
  text?: string;
  error?: NativeCliErrorShape;
}

class NativeUsageError extends Error {}

const USAGE = `Usage: comet native <command> [options]

Commands:
  init [--root <artifact-root>] [--language en|zh-CN]
  root show
  root move <artifact-root>
  new <change-name> [--language en|zh-CN]
  spec remove <change-name> <capability>
  spec rebase <change-name> --summary <text>
  list
  show <change-name>
  status [<change-name>]
  select <change-name>
  checkpoint <change-name> --summary <text> --next-action <text> [--artifact <project-relative>] [--expect-revision <n>]
  next <change-name> --summary <text> [--confirmed] [--artifact <path>] [--no-code-reason <text>] [--allow-partial-scope <sha256> --partial-reason <text>] [--result pass|fail] [--report <path>]
  archive <change-name> --dry-run
  archive <change-name> --expect-preflight <sha256>
  doctor [<change-name>] [--repair] [--strategy continue|rollback]
`;

function takeFlag(args: string[], name: string): boolean {
  const indexes = args.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length > 1) throw new NativeUsageError(`${name} may only be provided once`);
  if (indexes.length === 0) return false;
  args.splice(indexes[0], 1);
  return true;
}

function takeOption(args: string[], name: string): string | undefined {
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

function takeMany(args: string[], name: string): string[] {
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

function assertNoArguments(args: string[]): void {
  if (args.length > 0) throw new NativeUsageError(`Unexpected argument: ${args[0]}`);
}

function requiredPositional(args: string[], label: string): string {
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new NativeUsageError(`${label} is required`);
  return value;
}

function languageOption(args: string[]): 'en' | 'zh-CN' {
  const language = takeOption(args, '--language') ?? 'en';
  if (language !== 'en' && language !== 'zh-CN') {
    throw new NativeUsageError('--language must be en or zh-CN');
  }
  return language;
}

function revisionOption(args: string[]): number | undefined {
  const value = takeOption(args, '--expect-revision');
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new NativeUsageError('--expect-revision must be a positive integer');
  }
  return Number(value);
}

async function projectRootFrom(explicit: string | undefined): Promise<string> {
  return explicit ? path.resolve(explicit) : discoverNativeProject(process.cwd());
}

async function configuredPaths(projectRoot: string): Promise<{
  config: CometProjectConfig;
  paths: NativeProjectPaths;
}> {
  const resolved = await resolveNativeProject({
    startPath: projectRoot,
    allowMissingConfig: false,
  });
  return { config: resolved.config, paths: resolved.paths };
}

async function doctorPaths(projectRoot: string): Promise<NativeProjectPaths> {
  const config = await readProjectConfig(projectRoot);
  return nativeProjectPaths(projectRoot, config?.native.artifact_root ?? '.');
}

function success(command: string, data: unknown, text?: string): DispatchResult {
  return { command, exitCode: 0, data, text: text ?? JSON.stringify(data, null, 2) + '\n' };
}

async function dispatch(
  rawArgs: string[],
  explicitProjectRoot: string | undefined,
): Promise<DispatchResult> {
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === 'help') {
    return { command: rawArgs[0] ?? null, exitCode: 0, data: { usage: USAGE }, text: USAGE };
  }
  const command = rawArgs.shift()!;
  const projectRoot = await projectRootFrom(explicitProjectRoot);
  if (command === 'init') {
    const requestedRoot = takeOption(rawArgs, '--root');
    const language = languageOption(rawArgs);
    assertNoArguments(rawArgs);
    const existing = await readProjectConfig(projectRoot);
    if (existing?.native.pending_root_move) {
      throw new Error(`Native root move ${existing.native.pending_root_move.id} is incomplete`);
    }
    const artifactRoot = normalizeArtifactRootRef(
      requestedRoot ?? existing?.native.artifact_root ?? '.',
    );
    if (existing && requestedRoot && existing.native.artifact_root !== artifactRoot) {
      throw new Error(
        `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${artifactRoot}`,
      );
    }
    const config = existing ?? defaultProjectConfig(artifactRoot);
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    if (!existing) await writeProjectConfig(projectRoot, config);
    return success(
      'init',
      {
        projectRoot,
        artifactRoot: config.native.artifact_root,
        nativeRoot: paths.nativeRoot,
        language,
      },
      `Initialized Comet Native at ${paths.nativeRoot}\n`,
    );
  }
  if (command === 'root') {
    const subcommand = requiredPositional(rawArgs, 'root subcommand');
    if (subcommand === 'show') {
      assertNoArguments(rawArgs);
      const config = await readProjectConfig(projectRoot);
      if (!config) throw new Error('comet.config.yaml was not found');
      const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
      return success('root show', {
        projectRoot,
        artifactRoot: config.native.artifact_root,
        nativeRoot: paths.nativeRoot,
        pendingRootMove: config.native.pending_root_move ?? null,
      });
    }
    if (subcommand === 'move') {
      const target = requiredPositional(rawArgs, 'artifact root');
      assertNoArguments(rawArgs);
      const result = await moveNativeRoot({ projectRoot, toArtifactRoot: target });
      return success('root move', result, `Moved Comet Native to ${result.toNativeRoot}\n`);
    }
    throw new NativeUsageError(`Unknown root command: ${subcommand}`);
  }
  if (command === 'new') {
    const name = requiredPositional(rawArgs, 'change name');
    const language = languageOption(rawArgs);
    assertNoArguments(rawArgs);
    let config = await readProjectConfig(projectRoot);
    const shouldWriteConfig = config === null;
    if (!config) {
      config = defaultProjectConfig('.');
    }
    if (config.native.pending_root_move) {
      throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
    }
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    const state = await createNativeChange({ paths, name, language });
    if (shouldWriteConfig) await writeProjectConfig(projectRoot, config);
    const status = await inspectNativeStatus(paths, state.name);
    return success(
      'new',
      { ...state, continuation: status.continuation },
      `Created Native change ${state.name}\n`,
    );
  }
  if (command === 'spec') {
    const subcommand = requiredPositional(rawArgs, 'spec subcommand');
    if (subcommand === 'remove') {
      const name = requiredPositional(rawArgs, 'change name');
      const capability = requiredPositional(rawArgs, 'capability');
      assertNoArguments(rawArgs);
      const { paths } = await configuredPaths(projectRoot);
      const state = await markNativeSpecRemoval(paths, name, capability);
      const status = await inspectNativeStatus(paths, state.name);
      return success(
        'spec remove',
        { ...state, continuation: status.continuation },
        `Marked Native capability ${capability} for removal in ${name}\n`,
      );
    }
    if (subcommand === 'rebase') {
      const name = requiredPositional(rawArgs, 'change name');
      const summary = takeOption(rawArgs, '--summary');
      if (!summary) throw new NativeUsageError('--summary is required');
      assertNoArguments(rawArgs);
      const { paths } = await configuredPaths(projectRoot);
      const state = await rebaseNativeSpecChanges({ paths, name, summary });
      const status = await inspectNativeStatus(paths, state.name);
      return success(
        'spec rebase',
        { ...state, continuation: status.continuation },
        `Rebased Native specs for ${name}\n`,
      );
    }
    throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
  }
  if (command === 'list') {
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const changes = await listNativeChanges(paths);
    return success('list', changes);
  }
  if (command === 'show') {
    const name = requiredPositional(rawArgs, 'change name');
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const inspection = await inspectNativeChange(paths, name);
    if (inspection.status === 'migration-required') {
      return success('show', {
        name,
        schema: inspection.schema,
        minimumRuntimeVersion: inspection.minimumRuntimeVersion,
        migrationRequired: true,
        message: inspection.message,
      });
    }
    if (inspection.status !== 'current' || !inspection.state) {
      throw new NativeRuntimeCompatibilityError(
        inspection.schema,
        inspection.minimumRuntimeVersion,
      );
    }
    const state = inspection.state;
    const changeDir = nativeChangeDir(paths, name);
    const proposedSpecs = await readNativeProposedSpecs(paths, name);
    return success('show', {
      state,
      brief: await fs.readFile(path.join(changeDir, state.brief), 'utf8'),
      proposedSpecs,
    });
  }
  if (command === 'status') {
    const details = takeFlag(rawArgs, '--details');
    const name = rawArgs[0]?.startsWith('--') ? undefined : rawArgs.shift();
    if (details && !name) throw new NativeUsageError('status --details requires a change name');
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const data = name
      ? await inspectNativeStatus(paths, name, { details })
      : await listNativeStatus(paths);
    return success('status', data);
  }
  if (command === 'select') {
    const name = requiredPositional(rawArgs, 'change name');
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    await selectNativeChange(paths, name);
    const status = await inspectNativeStatus(paths, name);
    return success(
      'select',
      { selected: name, continuation: status.continuation },
      `Selected Native change ${name}\n`,
    );
  }
  if (command === 'checkpoint') {
    const name = requiredPositional(rawArgs, 'change name');
    const summary = takeOption(rawArgs, '--summary');
    if (!summary) throw new NativeUsageError('--summary is required');
    const nextAction = takeOption(rawArgs, '--next-action');
    if (!nextAction) throw new NativeUsageError('--next-action is required');
    const artifacts = takeMany(rawArgs, '--artifact');
    const expectedRevision = revisionOption(rawArgs);
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const result = await checkpointNativeChange({
      paths,
      name,
      summary,
      nextAction,
      artifacts,
      expectedRevision,
    });
    const status = await inspectNativeStatus(paths, name);
    const manifestRef = path
      .relative(
        paths.projectRoot,
        path.join(nativeChangeDir(paths, name), ...result.checkpoint.manifestRef.split('/')),
      )
      .replaceAll('\\', '/');
    return success('checkpoint', {
      ...result,
      checkpoint: { ...result.checkpoint, manifestRef },
      continuation: status.continuation,
    });
  }
  if (command === 'next') {
    const name = requiredPositional(rawArgs, 'change name');
    const summary = takeOption(rawArgs, '--summary');
    if (!summary) throw new NativeUsageError('--summary is required');
    const confirmed = takeFlag(rawArgs, '--confirmed');
    const artifacts = takeMany(rawArgs, '--artifact');
    const noCodeReason = takeOption(rawArgs, '--no-code-reason');
    const allowPartialScopeHash = takeOption(rawArgs, '--allow-partial-scope');
    const partialReason = takeOption(rawArgs, '--partial-reason');
    const verificationResult = takeOption(rawArgs, '--result');
    const verificationReport = takeOption(rawArgs, '--report');
    if (
      verificationResult !== undefined &&
      verificationResult !== 'pass' &&
      verificationResult !== 'fail'
    ) {
      throw new NativeUsageError('--result must be pass or fail');
    }
    if ((allowPartialScopeHash === undefined) !== (partialReason === undefined)) {
      throw new NativeUsageError(
        '--allow-partial-scope and --partial-reason must be provided together',
      );
    }
    if (allowPartialScopeHash && !/^[a-f0-9]{64}$/u.test(allowPartialScopeHash)) {
      throw new NativeUsageError('--allow-partial-scope must be a SHA-256 hash');
    }
    if (allowPartialScopeHash && !confirmed) {
      throw new NativeUsageError('--allow-partial-scope requires --confirmed');
    }
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const evidence: NativeAdvanceEvidence = {
      summary,
      ...(confirmed ? { confirmed: true } : {}),
      ...(artifacts.length > 0 ? { artifacts } : {}),
      ...(noCodeReason ? { noCodeReason } : {}),
      ...(allowPartialScopeHash ? { allowPartialScopeHash } : {}),
      ...(partialReason ? { partialReason } : {}),
      ...(verificationResult ? { verificationResult } : {}),
      ...(verificationReport ? { verificationReport } : {}),
    };
    const result = await advanceNativeChange({ paths, name, evidence });
    if (result.next === 'manual') {
      return {
        command: 'next',
        exitCode: 65,
        data: result,
        error: {
          code: 'invalid-data',
          message: result.findings[0]?.message ?? 'Native phase guard failed',
        },
      };
    }
    const status = await inspectNativeStatus(paths, name);
    return success('next', { ...result, continuation: status.continuation });
  }
  if (command === 'archive') {
    const name = requiredPositional(rawArgs, 'change name');
    const dryRun = takeFlag(rawArgs, '--dry-run');
    const expectedPreflightHash = takeOption(rawArgs, '--expect-preflight');
    if (dryRun && expectedPreflightHash) {
      throw new NativeUsageError('--dry-run and --expect-preflight cannot be combined');
    }
    if (!dryRun && !expectedPreflightHash) {
      throw new NativeUsageError('archive requires --dry-run or --expect-preflight <sha256>');
    }
    if (expectedPreflightHash && !/^[a-f0-9]{64}$/u.test(expectedPreflightHash)) {
      throw new NativeUsageError('--expect-preflight must be a SHA-256 hash');
    }
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    if (dryRun) {
      const preview = await inspectNativeArchivePreflight({ paths, name });
      return success(
        'archive --dry-run',
        preview,
        `Native Archive preview ${preview.preflightHash}: ${preview.ready ? 'ready' : 'blocked'}\n`,
      );
    }
    const state = await readNativeChange(paths, name);
    const result = await archiveNativeChange({
      paths,
      name,
      expectedPreflightHash: expectedPreflightHash!,
    });
    return success(
      'archive',
      { ...result, continuation: nativeContinuation({ state, done: true }) },
      `Archived Native change ${name} to ${result.archiveDir}\n`,
    );
  }
  if (command === 'doctor') {
    const repair = takeFlag(rawArgs, '--repair');
    const recoveryStrategy = takeOption(rawArgs, '--strategy');
    if (
      recoveryStrategy !== undefined &&
      recoveryStrategy !== 'continue' &&
      recoveryStrategy !== 'rollback'
    ) {
      throw new NativeUsageError('--strategy must be continue or rollback');
    }
    const name = rawArgs[0]?.startsWith('--') ? undefined : rawArgs.shift();
    assertNoArguments(rawArgs);
    const paths = await doctorPaths(projectRoot);
    const result = await doctorNativeProject({
      paths,
      ...(name ? { name } : {}),
      repair,
      ...(recoveryStrategy ? { recoveryStrategy } : {}),
    });
    return result.healthy
      ? success('doctor', result)
      : {
          command: 'doctor',
          exitCode: 65,
          data: result,
          error: { code: 'invalid-data', message: 'Native project needs attention' },
        };
  }
  throw new NativeUsageError(`Unknown Native command: ${command}`);
}

function errorResult(command: string | null, error: unknown): DispatchResult {
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

function render(result: DispatchResult, json: boolean): NativeCommandResult {
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

export async function runNativeCli(argv: readonly string[]): Promise<NativeCommandResult> {
  const args = [...argv];
  const json = args.includes('--json');
  let explicitProjectRoot: string | undefined;
  let command: string | null = args[0] ?? null;
  try {
    takeFlag(args, '--json');
    explicitProjectRoot = takeOption(args, '--project-root');
    command = args[0] ?? null;
    return render(await dispatch(args, explicitProjectRoot), json);
  } catch (error) {
    return render(errorResult(command, error), json);
  }
}
