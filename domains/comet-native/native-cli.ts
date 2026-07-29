import { promises as fs } from 'node:fs';
import path from 'path';

import { RaceSafeReadError, readFileRaceSafe } from '../../platform/fs/race-safe-read.js';

import {
  archiveNativeChange,
  NativeArchivePreflightError,
  NativeSpecConflictError,
} from './native-archive.js';
import { atomicWriteJson } from './native-atomic-file.js';
import { serializeNativeVerificationMachineBlock } from './native-acceptance.js';
import { inspectNativeArchivePreflight } from './native-archive-inspection.js';
import {
  createNativeChange,
  inspectNativeChange,
  NativeChangeRevisionConflictError,
  NativeBaselineIncompleteError,
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
import { inspectNativeStatus, listNativeStatusPage } from './native-diagnostics.js';
import { doctorNativeProject } from './native-doctor.js';
import { checkNativeChange } from './native-check.js';
import { checkpointNativeChange } from './native-progress-checkpoint.js';
import { nativeContinuation } from './native-continuation.js';
import {
  discoverNativeProject,
  ensureNativeDirectories,
  nativeProjectPaths,
  normalizeArtifactRootRef,
  resolveContainedNativePath,
} from './native-paths.js';
import { withNativeMutationLock } from './native-mutation-lock.js';
import { moveNativeRoot } from './native-root-move.js';
import { selectNativeChange } from './native-selection.js';
import {
  markNativeSpecRemoval,
  readNativeProposedSpecs,
  rebaseNativeSpecChanges,
} from './native-specs.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { NATIVE_CONTRACT_FILE_LIMITS } from './native-contract-files.js';
import { MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES } from './native-verification-scope.js';
import { readNativeControllerTrustProject } from './native-controller-trust.js';
import {
  approveNativeIndependentReviewPreparation,
  finalizeNativeImplementationAttestation,
  finalizeNativeIndependentReviewReceipt,
  issueNativeAutomatedCheckReceipt,
  issueNativeManualEvidenceReceipt,
  issueNativeWaiverReceipt,
  MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS,
  prepareNativeIndependentReview,
  prepareNativeImplementationAttestation,
  type NativeIndependentReviewPreparation,
} from './native-verification-receipt-runtime.js';
import {
  generateNativeReviewKeyPair,
  nativeReviewIdentityFromPrivateKey,
  nativeReviewPrivateKeyFilePersistenceSupported,
  parseNativeReviewIdentity,
  parseNativeReviewSignature,
} from './native-review-identity.js';
import {
  buildNativeReviewTrustPolicy,
  NATIVE_REVIEW_TRUST_POLICY_REF,
} from './native-review-trust.js';
import {
  parseNativeImplementationPreparation,
  parseNativeIndependentReviewApproval,
  signNativeImplementationPreparation,
  signNativeIndependentReviewApproval,
} from './native-review-signer.js';
import type { NativeReviewFinding } from './native-verification-receipt.js';
import { advanceNativeChange } from './native-transitions.js';
import { inspectNativeHookGuard, readNativeHookRequest } from './native-hook-guard.js';
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
  code: 'usage' | 'invalid-data' | 'blocked' | 'conflict' | 'internal' | 'baseline-incomplete';
  message: string;
}

interface DispatchResult {
  command: string | null;
  exitCode: number;
  data?: unknown;
  text?: string;
  error?: NativeCliErrorShape;
}

const NATIVE_SHOW_MAX_SERIALIZED_BYTES = 10 * 1024 * 1024;

class NativeUsageError extends Error {}

const USAGE = `Usage: comet native <command> [options]

Commands:
  hook-guard [--hook-output copilot]
  init [--root <artifact-root>] [--language en|zh-CN]
  root show
  root move <artifact-root>
  new <change-name> [--language en|zh-CN]
  spec remove <change-name> <capability>
  spec rebase <change-name> --summary <text>
  list [--cursor <token>]
  show <change-name>
  status [<change-name>] [--cursor <token>] [--details [--acceptance-cursor <token>]]
  select <change-name>
  checkpoint <change-name> --summary <text> --next-action <text> [--artifact <project-relative>] [--expect-revision <n>]
  check <change-name>
  evidence format [--entries <path>]
  trust keygen --identity <path> --private-key <outside-project-path>
  trust identity --private-key-env <name> --identity <path>
  trust policy --implementation-identity <path> --reviewer-identity <path> --waiver-identity <path> --controller-private-key-env <name>
  receipt manual <change-name> --acceptance <id> --responsible <text> --step <text> --observation <text> --confirmed
  receipt automated <change-name> --acceptance <id> [--timeout-ms <n>] -- <executable> [args...]
  receipt implement <change-name> prepare --identity <path> --output <path>
  receipt implement sign --preparation <path> --identity <path> --private-key-env <name> --output <path>
  receipt implement <change-name> finalize --preparation <path> --attestation <path> --confirmed
  receipt review <change-name> prepare --implementation-receipt <ref> --report <path> --required-receipt <ref> --identity <path> [--unified-io-receipt <ref> --adversarial-paths-receipt <ref> --generated-assets-receipt <ref> --lifecycle-eval-receipt <ref>] --output <path>
  receipt review <change-name> approve --preparation <path> --attest-manual <ref> [--findings <path>] --checked-acceptance-applicability --output <path>
  receipt review sign --approval <path> --identity <path> --private-key-env <name> --output <path>
  receipt review <change-name> finalize --preparation <path> --approval <path> --attestation <path> --confirmed
  receipt waive <change-name> --acceptance <id> --blocked-receipt <ref> --reason <text> --risk <text> --alternative-receipt <ref> --identity <path> --private-key-env <name> --confirmed
  next <change-name> --summary <text> [--confirmed] [--artifact <path>] [--no-code-reason <text>] [--allow-partial-scope <sha256> --partial-reason <text>] [--result pass|fail] [--report <path>] [--receipt <required-ref>] [--evidence-receipt <ref>] [--waiver <ref>] [--independent-review-receipt <ref>] [--failure-category <token>] [--failed-check <token>] [--override-repair <sha256> --override-summary <text>]
  archive <change-name> --dry-run
  archive <change-name> --expect-preflight <sha256> [--confirmed]
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

function languageOption(args: string[], fallback: 'en' | 'zh-CN' = 'en'): 'en' | 'zh-CN' {
  const language = takeOption(args, '--language') ?? fallback;
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
  return nativeProjectPaths(projectRoot, config?.native.artifact_root ?? 'docs');
}

function success(command: string, data: unknown, text?: string): DispatchResult {
  return { command, exitCode: 0, data, text: text ?? JSON.stringify(data, null, 2) + '\n' };
}

async function readBoundedEvidenceFile(filePath: string, maxBytes: number): Promise<string> {
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

async function readBoundedEvidenceStdin(maxBytes: number): Promise<string> {
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

async function readEvidenceJson(filePath: string, label: string): Promise<unknown> {
  const raw = await readBoundedEvidenceFile(
    path.resolve(filePath),
    MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
  );
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function privateKeyFromEnvironment(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new NativeUsageError('--private-key-env must be an environment variable name');
  }
  const value = process.env[name];
  if (!value) throw new NativeUsageError(`Private key environment variable ${name} is not set`);
  delete process.env[name];
  return value;
}

function pathIsInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

async function assertPrivateKeyOutsideProject(projectRoot: string, file: string): Promise<void> {
  const relative = path.relative(projectRoot, file);
  if (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  ) {
    throw new NativeUsageError('--private-key must resolve outside the Native project');
  }
  const physicalProjectRoot = await fs.realpath(projectRoot);
  const parsed = path.parse(path.resolve(path.dirname(file)));
  let cursor = parsed.root;
  for (const segment of path
    .relative(parsed.root, path.resolve(path.dirname(file)))
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new NativeUsageError(
        '--private-key parent chain must not contain symlinks, junctions, or non-directories',
      );
    }
    if (pathIsInside(physicalProjectRoot, await fs.realpath(cursor))) {
      throw new NativeUsageError('--private-key parent resolves inside the Native project');
    }
  }
}

async function writeExclusiveFile(file: string, content: string, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', mode);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

async function writeExclusivePrivateKeyFile(
  projectRoot: string,
  file: string,
  content: string,
): Promise<void> {
  if (!nativeReviewPrivateKeyFilePersistenceSupported()) {
    throw new NativeUsageError(
      'trust keygen cannot persist private keys on Windows because owner-only ACLs cannot be verified; generate the identity in an external secret store and provide signing keys through --private-key-env',
    );
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await assertPrivateKeyOutsideProject(projectRoot, file);
  const handle = await fs.open(file, 'wx', 0o600);
  let secure = false;
  try {
    await handle.writeFile(content, 'utf8');
    await handle.chmod(0o600);
    const stat = await handle.stat();
    if ((stat.mode & 0o077) !== 0) {
      throw new Error('Native review private key file permissions are not owner-only');
    }
    const [physicalProjectRoot, physicalFile, target] = await Promise.all([
      fs.realpath(projectRoot),
      fs.realpath(file),
      fs.lstat(file),
    ]);
    if (
      !target.isFile() ||
      target.isSymbolicLink() ||
      pathIsInside(physicalProjectRoot, physicalFile)
    ) {
      throw new Error('Native review private key resolved inside the project during write');
    }
    secure = true;
  } finally {
    await handle.close();
    if (!secure) await fs.rm(file, { force: true });
  }
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
  if (command === 'hook-guard') {
    const hookOutput = takeOption(rawArgs, '--hook-output');
    if (hookOutput !== undefined && hookOutput !== 'copilot') {
      throw new NativeUsageError('--hook-output must be copilot');
    }
    assertNoArguments(rawArgs);
    const result = await inspectNativeHookGuard(projectRoot, await readNativeHookRequest());
    if (hookOutput === 'copilot') {
      return {
        command,
        exitCode: 0,
        data: result,
        text: result.allowed
          ? '{}\n'
          : `${JSON.stringify({
              permissionDecision: 'deny',
              permissionDecisionReason: result.reason,
            })}\n`,
      };
    }
    return result.allowed
      ? { command, exitCode: 0, data: result }
      : {
          command,
          exitCode: 2,
          data: result,
          error: { code: 'blocked', message: result.reason },
        };
  }
  if (command === 'init') {
    const requestedRoot = takeOption(rawArgs, '--root');
    const existing = await readProjectConfig(projectRoot);
    const language = languageOption(rawArgs, existing?.native.language ?? 'en');
    assertNoArguments(rawArgs);
    if (existing?.native.pending_root_move) {
      throw new Error(`Native root move ${existing.native.pending_root_move.id} is incomplete`);
    }
    const artifactRoot = normalizeArtifactRootRef(
      requestedRoot ?? existing?.native.artifact_root ?? 'docs',
    );
    if (existing && requestedRoot && existing.native.artifact_root !== artifactRoot) {
      throw new Error(
        `Configured Native artifact root is ${existing.native.artifact_root}; refusing conflicting root ${artifactRoot}`,
      );
    }
    const config = existing
      ? { ...existing, native: { ...existing.native, language } }
      : defaultProjectConfig(artifactRoot, language);
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    await writeProjectConfig(projectRoot, config);
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
      if (!config) throw new Error('.comet/config.yaml was not found');
      const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
      return success('root show', {
        projectRoot,
        artifactRoot: config.native.artifact_root,
        language: config.native.language,
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
    let config = await readProjectConfig(projectRoot);
    const language = languageOption(rawArgs, config?.native.language ?? 'en');
    assertNoArguments(rawArgs);
    const shouldWriteConfig = config === null;
    if (!config) {
      config = defaultProjectConfig('docs', language);
    }
    if (config.native.pending_root_move) {
      throw new Error(`Native root move ${config.native.pending_root_move.id} is incomplete`);
    }
    if (shouldWriteConfig) await writeProjectConfig(projectRoot, config);
    const paths = await nativeProjectPaths(projectRoot, config.native.artifact_root);
    await ensureNativeDirectories(paths);
    const state = await createNativeChange({
      paths,
      name,
      language,
    });
    await selectNativeChange(paths, state.name);
    const status = await inspectNativeStatus(paths, state.name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
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
      const { config, paths } = await configuredPaths(projectRoot);
      const state = await markNativeSpecRemoval(paths, name, capability);
      const status = await inspectNativeStatus(paths, state.name, {
        clarificationMode: config.native.clarification_mode,
        maxVerifyFailures: config.native.max_verify_failures,
      });
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
      const { config, paths } = await configuredPaths(projectRoot);
      const state = await rebaseNativeSpecChanges({ paths, name, summary });
      const status = await inspectNativeStatus(paths, state.name, {
        clarificationMode: config.native.clarification_mode,
        maxVerifyFailures: config.native.max_verify_failures,
      });
      return success(
        'spec rebase',
        { ...state, continuation: status.continuation },
        `Rebased Native specs for ${name}\n`,
      );
    }
    throw new NativeUsageError(`Unknown spec command: ${subcommand}`);
  }
  if (command === 'list') {
    const cursor = takeOption(rawArgs, '--cursor');
    assertNoArguments(rawArgs);
    const { config, paths } = await configuredPaths(projectRoot);
    const page = await listNativeStatusPage(paths, {
      ...(cursor ? { cursor } : {}),
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    return success('list', page);
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
    const brief = await readNativeBoundedTextFile({
      root: changeDir,
      ref: state.brief,
      maxBytes: NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes,
    });
    const payload = {
      state,
      brief: brief.text,
      proposedSpecs,
    };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > NATIVE_SHOW_MAX_SERIALIZED_BYTES) {
      throw new Error('Native show output exceeds its serialized byte budget');
    }
    return success('show', payload);
  }
  if (command === 'status') {
    const details = takeFlag(rawArgs, '--details');
    const cursor = takeOption(rawArgs, '--cursor');
    const acceptanceCursor = takeOption(rawArgs, '--acceptance-cursor');
    const name = rawArgs[0]?.startsWith('--') ? undefined : rawArgs.shift();
    if (details && !name) throw new NativeUsageError('status --details requires a change name');
    if (cursor && name) throw new NativeUsageError('--cursor is only valid for status lists');
    if (cursor && details) throw new NativeUsageError('--cursor cannot be combined with --details');
    if (acceptanceCursor && !details) {
      throw new NativeUsageError('--acceptance-cursor requires status --details');
    }
    if (acceptanceCursor && !name) {
      throw new NativeUsageError('--acceptance-cursor requires a change name');
    }
    assertNoArguments(rawArgs);
    const { config, paths } = await configuredPaths(projectRoot);
    const data = name
      ? await inspectNativeStatus(paths, name, {
          details,
          ...(acceptanceCursor ? { acceptanceCursor } : {}),
          clarificationMode: config.native.clarification_mode,
          maxVerifyFailures: config.native.max_verify_failures,
        })
      : await listNativeStatusPage(paths, {
          ...(cursor ? { cursor } : {}),
          clarificationMode: config.native.clarification_mode,
          maxVerifyFailures: config.native.max_verify_failures,
        });
    return success('status', data);
  }
  if (command === 'select') {
    const name = requiredPositional(rawArgs, 'change name');
    assertNoArguments(rawArgs);
    const { config, paths } = await configuredPaths(projectRoot);
    await selectNativeChange(paths, name);
    const status = await inspectNativeStatus(paths, name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
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
    const { config, paths } = await configuredPaths(projectRoot);
    const result = await checkpointNativeChange({
      paths,
      name,
      summary,
      nextAction,
      artifacts,
      expectedRevision,
    });
    const status = await inspectNativeStatus(paths, name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
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
  if (command === 'check') {
    const name = requiredPositional(rawArgs, 'change name');
    assertNoArguments(rawArgs);
    const { paths } = await configuredPaths(projectRoot);
    const checked = await checkNativeChange({ paths, name });
    const data = {
      ref: checked.ref,
      hash: checked.receipt.receiptHash,
      status: checked.receipt.status,
      checker: checked.receipt.checker,
      counts: checked.receipt.counts,
      issues: checked.receipt.issues,
      issuesTruncated: checked.receipt.issuesTruncated,
      stale: checked.receipt.stale,
      staleReasons: checked.receipt.staleReasons,
      startedAt: checked.receipt.startedAt,
      endedAt: checked.receipt.endedAt,
      sourceRevision: checked.receipt.sourceRevision,
    };
    const passed = checked.receipt.status === 'passed' && !checked.receipt.stale;
    return {
      command: 'check',
      exitCode: passed ? 0 : 1,
      data,
      text: `Native check ${passed ? 'passed' : 'failed'}: ${checked.ref}\n`,
    };
  }
  if (command === 'evidence') {
    const subcommand = requiredPositional(rawArgs, 'evidence subcommand');
    if (subcommand === 'format') {
      const entriesPath = takeOption(rawArgs, '--entries');
      assertNoArguments(rawArgs);
      let raw: string;
      if (entriesPath) {
        raw = await readBoundedEvidenceFile(
          path.resolve(entriesPath),
          MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES,
        );
      } else {
        if (process.stdin.isTTY) {
          throw new NativeUsageError(
            'evidence format requires acceptance evidence entries JSON on stdin, or --entries <path>',
          );
        }
        raw = await readBoundedEvidenceStdin(MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES);
      }
      let entries: unknown;
      try {
        entries = JSON.parse(raw);
      } catch (error) {
        throw new Error(
          `Acceptance evidence entries must be valid JSON: ${(error as Error).message}`,
          { cause: error },
        );
      }
      if (!Array.isArray(entries)) {
        throw new Error('Acceptance evidence entries must be a JSON array');
      }
      const block = serializeNativeVerificationMachineBlock(entries);
      return success('evidence format', { block }, `${block}\n`);
    }
    throw new NativeUsageError(`Unknown evidence command: ${subcommand}`);
  }
  if (command === 'trust') {
    const subcommand = requiredPositional(rawArgs, 'trust subcommand');
    if (subcommand === 'identity') {
      const identityPathValue = takeOption(rawArgs, '--identity');
      const privateKeyEnv = takeOption(rawArgs, '--private-key-env');
      if (!identityPathValue || !privateKeyEnv) {
        throw new NativeUsageError('trust identity requires --identity and --private-key-env');
      }
      assertNoArguments(rawArgs);
      const identityPath = path.resolve(identityPathValue);
      const identity = nativeReviewIdentityFromPrivateKey(privateKeyFromEnvironment(privateKeyEnv));
      await writeExclusiveFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, 0o644);
      return success(
        'trust identity',
        { identityPath, keyId: identity.keyId, privateKeyPrinted: false },
        `Native review identity ${identity.keyId} created from external private key material\n`,
      );
    }
    if (subcommand === 'keygen') {
      const identityPathValue = takeOption(rawArgs, '--identity');
      const privateKeyPathValue = takeOption(rawArgs, '--private-key');
      if (!identityPathValue || !privateKeyPathValue) {
        throw new NativeUsageError('trust keygen requires --identity and --private-key');
      }
      assertNoArguments(rawArgs);
      const identityPath = path.resolve(identityPathValue);
      const privateKeyPath = path.resolve(privateKeyPathValue);
      await assertPrivateKeyOutsideProject(projectRoot, privateKeyPath);
      if (identityPath === privateKeyPath) {
        throw new NativeUsageError('--identity and --private-key must be different files');
      }
      const keyPair = generateNativeReviewKeyPair();
      await writeExclusivePrivateKeyFile(projectRoot, privateKeyPath, `${keyPair.privateKey}\n`);
      await writeExclusiveFile(
        identityPath,
        `${JSON.stringify(keyPair.identity, null, 2)}\n`,
        0o644,
      );
      return success(
        'trust keygen',
        {
          identityPath,
          privateKeyPath,
          keyId: keyPair.identity.keyId,
          privateKeyPrinted: false,
        },
        `Native review identity ${keyPair.identity.keyId} created; private key written only to ${privateKeyPath}\n`,
      );
    }
    if (subcommand === 'policy') {
      const implementationIdentityPath = takeOption(rawArgs, '--implementation-identity');
      const reviewerIdentityPaths = takeMany(rawArgs, '--reviewer-identity');
      const waiverIdentityPaths = takeMany(rawArgs, '--waiver-identity');
      const controllerPrivateKeyEnv = takeOption(rawArgs, '--controller-private-key-env');
      if (
        !implementationIdentityPath ||
        reviewerIdentityPaths.length === 0 ||
        waiverIdentityPaths.length === 0 ||
        !controllerPrivateKeyEnv
      ) {
        throw new NativeUsageError(
          'trust policy requires --implementation-identity, --reviewer-identity, --waiver-identity, and --controller-private-key-env',
        );
      }
      assertNoArguments(rawArgs);
      const { paths } = await configuredPaths(projectRoot);
      const implementationIdentity = parseNativeReviewIdentity(
        await readEvidenceJson(implementationIdentityPath, 'Implementation identity'),
      );
      const trustedReviewers = await Promise.all(
        reviewerIdentityPaths.map(async (file) =>
          parseNativeReviewIdentity(await readEvidenceJson(file, 'Reviewer identity')),
        ),
      );
      const trustedWaiverSigners = await Promise.all(
        waiverIdentityPaths.map(async (file) =>
          parseNativeReviewIdentity(await readEvidenceJson(file, 'Waiver signer identity')),
        ),
      );
      const controllerTrust = await readNativeControllerTrustProject(projectRoot);
      if (!controllerTrust) {
        throw new Error('Native project has no controller-owned trust root');
      }
      const policy = buildNativeReviewTrustPolicy({
        controllerIdentity: controllerTrust.controllerIdentity,
        controllerPrivateKey: privateKeyFromEnvironment(controllerPrivateKeyEnv),
        implementationKeyId: implementationIdentity.keyId,
        trustedReviewers,
        trustedWaiverSigners,
      });
      const policyPath = path.join(projectRoot, ...NATIVE_REVIEW_TRUST_POLICY_REF.split('/'));
      await withNativeMutationLock(paths, 'create review trust policy', async () => {
        await resolveContainedNativePath(projectRoot, policyPath);
        await atomicWriteJson(policyPath, policy, {
          containedRoot: projectRoot,
          exclusive: true,
        });
      });
      return success(
        'trust policy',
        { ref: NATIVE_REVIEW_TRUST_POLICY_REF, policy },
        `Native review trust policy created: ${NATIVE_REVIEW_TRUST_POLICY_REF}\n`,
      );
    }
    throw new NativeUsageError(`Unknown trust command: ${subcommand}`);
  }
  if (command === 'receipt') {
    const subcommand = requiredPositional(rawArgs, 'receipt subcommand');
    if (subcommand === 'implement' && rawArgs[0] === 'sign') {
      rawArgs.shift();
      const preparationPath = takeOption(rawArgs, '--preparation');
      const identityPath = takeOption(rawArgs, '--identity');
      const privateKeyEnv = takeOption(rawArgs, '--private-key-env');
      const outputPathValue = takeOption(rawArgs, '--output');
      if (!preparationPath || !identityPath || !privateKeyEnv || !outputPathValue) {
        throw new NativeUsageError(
          'receipt implement sign requires --preparation, --identity, --private-key-env, and --output',
        );
      }
      assertNoArguments(rawArgs);
      const attestation = signNativeImplementationPreparation({
        preparation: await readEvidenceJson(preparationPath, 'Native implementation preparation'),
        identity: parseNativeReviewIdentity(
          await readEvidenceJson(identityPath, 'Implementation identity'),
        ),
        privateKey: privateKeyFromEnvironment(privateKeyEnv),
      });
      const outputPath = path.resolve(outputPathValue);
      await atomicWriteJson(outputPath, attestation);
      return success(
        'receipt implement sign',
        { outputPath, attestation },
        `Native implementation attestation written to ${outputPath}\n`,
      );
    }
    if (subcommand === 'review' && rawArgs[0] === 'sign') {
      rawArgs.shift();
      const approvalPath = takeOption(rawArgs, '--approval');
      const identityPath = takeOption(rawArgs, '--identity');
      const privateKeyEnv = takeOption(rawArgs, '--private-key-env');
      const outputPathValue = takeOption(rawArgs, '--output');
      if (!approvalPath || !identityPath || !privateKeyEnv || !outputPathValue) {
        throw new NativeUsageError(
          'receipt review sign requires --approval, --identity, --private-key-env, and --output',
        );
      }
      assertNoArguments(rawArgs);
      const attestation = signNativeIndependentReviewApproval({
        approval: await readEvidenceJson(approvalPath, 'Native review approval'),
        identity: parseNativeReviewIdentity(
          await readEvidenceJson(identityPath, 'Reviewer identity'),
        ),
        privateKey: privateKeyFromEnvironment(privateKeyEnv),
      });
      const outputPath = path.resolve(outputPathValue);
      await atomicWriteJson(outputPath, attestation);
      return success(
        'receipt review sign',
        { outputPath, attestation },
        `Native review attestation written to ${outputPath}\n`,
      );
    }
    const name = requiredPositional(rawArgs, 'change name');
    const { paths } = await configuredPaths(projectRoot);
    if (subcommand === 'implement') {
      const implementationPhase = requiredPositional(rawArgs, 'implementation phase');
      if (implementationPhase === 'prepare') {
        const identityPath = takeOption(rawArgs, '--identity');
        const outputPathValue = takeOption(rawArgs, '--output');
        if (!identityPath || !outputPathValue) {
          throw new NativeUsageError('receipt implement prepare requires --identity and --output');
        }
        assertNoArguments(rawArgs);
        const preparation = await prepareNativeImplementationAttestation({
          paths,
          name,
          implementationIdentity: parseNativeReviewIdentity(
            await readEvidenceJson(identityPath, 'Implementation identity'),
          ),
        });
        const outputPath = path.resolve(outputPathValue);
        await atomicWriteJson(outputPath, preparation);
        return success(
          'receipt implement prepare',
          { outputPath, preparation },
          `Native implementation preparation written to ${outputPath}\n`,
        );
      }
      if (implementationPhase === 'finalize') {
        const preparationPath = takeOption(rawArgs, '--preparation');
        const attestationPath = takeOption(rawArgs, '--attestation');
        const confirmed = takeFlag(rawArgs, '--confirmed');
        if (!preparationPath || !attestationPath) {
          throw new NativeUsageError(
            'receipt implement finalize requires --preparation and --attestation',
          );
        }
        assertNoArguments(rawArgs);
        const issued = await finalizeNativeImplementationAttestation({
          paths,
          name,
          preparation: parseNativeImplementationPreparation(
            await readEvidenceJson(preparationPath, 'Native implementation preparation'),
          ),
          attestation: parseNativeReviewSignature(
            await readEvidenceJson(attestationPath, 'Native implementation attestation'),
          ),
          confirmed,
        });
        return success(
          'receipt implement finalize',
          issued,
          `Native implementation attestation: ${issued.ref}\n`,
        );
      }
      throw new NativeUsageError(`Unknown receipt implementation phase: ${implementationPhase}`);
    }
    if (subcommand === 'manual') {
      const acceptanceIds = takeMany(rawArgs, '--acceptance');
      const responsible = takeOption(rawArgs, '--responsible');
      const steps = takeMany(rawArgs, '--step');
      const observations = takeMany(rawArgs, '--observation');
      const confirmed = takeFlag(rawArgs, '--confirmed');
      if (!responsible) throw new NativeUsageError('--responsible is required');
      assertNoArguments(rawArgs);
      const issued = await issueNativeManualEvidenceReceipt({
        paths,
        name,
        acceptanceIds,
        responsible,
        steps,
        observations,
        confirmed,
      });
      return success('receipt manual', issued, `Native manual receipt: ${issued.ref}\n`);
    }
    if (subcommand === 'automated') {
      const separator = rawArgs.indexOf('--');
      if (separator < 0 || separator === rawArgs.length - 1) {
        throw new NativeUsageError('receipt automated requires -- <executable> [args...]');
      }
      const commandArgs = rawArgs.splice(separator + 1);
      rawArgs.splice(separator, 1);
      const acceptanceIds = takeMany(rawArgs, '--acceptance');
      const timeoutText = takeOption(rawArgs, '--timeout-ms');
      assertNoArguments(rawArgs);
      const timeoutMs =
        timeoutText === undefined
          ? undefined
          : /^[1-9]\d*$/u.test(timeoutText) &&
              Number.isSafeInteger(Number(timeoutText)) &&
              Number(timeoutText) <= MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS
            ? Number(timeoutText)
            : null;
      if (timeoutMs === null) {
        throw new NativeUsageError(
          `--timeout-ms must be an integer from 1 through ${MAX_NATIVE_AUTOMATED_COMMAND_TIMEOUT_MS}`,
        );
      }
      const issued = await issueNativeAutomatedCheckReceipt({
        paths,
        name,
        acceptanceIds,
        command: commandArgs[0],
        args: commandArgs.slice(1),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      return {
        command: 'receipt automated',
        exitCode: issued.receipt.status === 'passed' ? 0 : 1,
        data: issued,
        text: `Native automated receipt ${issued.receipt.status}: ${issued.ref}\n`,
      };
    }
    if (subcommand === 'review') {
      const reviewPhase = requiredPositional(rawArgs, 'review phase');
      if (reviewPhase === 'prepare') {
        const implementationReceiptRef = takeOption(rawArgs, '--implementation-receipt');
        const reportRef = takeOption(rawArgs, '--report');
        const requiredReceiptRefs = takeMany(rawArgs, '--required-receipt');
        const identityPath = takeOption(rawArgs, '--identity');
        const outputPathValue = takeOption(rawArgs, '--output');
        const checkedEvidence = {
          unifiedIo: takeOption(rawArgs, '--unified-io-receipt') ?? null,
          adversarialPaths: takeOption(rawArgs, '--adversarial-paths-receipt') ?? null,
          generatedAssets: takeOption(rawArgs, '--generated-assets-receipt') ?? null,
          lifecycleEval: takeOption(rawArgs, '--lifecycle-eval-receipt') ?? null,
        };
        if (
          !implementationReceiptRef ||
          !reportRef ||
          requiredReceiptRefs.length === 0 ||
          !identityPath ||
          !outputPathValue
        ) {
          throw new NativeUsageError(
            'receipt review prepare requires --implementation-receipt, --report, at least one --required-receipt, --identity, and --output',
          );
        }
        assertNoArguments(rawArgs);
        const preparation = await prepareNativeIndependentReview({
          paths,
          name,
          implementationReceiptRef,
          reportRef,
          requiredReceiptRefs,
          reviewerIdentity: parseNativeReviewIdentity(
            await readEvidenceJson(identityPath, 'Reviewer identity'),
          ),
          checkedEvidence,
        });
        const outputPath = path.resolve(outputPathValue);
        await atomicWriteJson(outputPath, preparation);
        return success(
          'receipt review prepare',
          { outputPath, preparation },
          `Native review preparation written to ${outputPath}\n`,
        );
      }
      if (reviewPhase === 'approve') {
        const preparationPath = takeOption(rawArgs, '--preparation');
        const outputPathValue = takeOption(rawArgs, '--output');
        const manualAttestationRefs = takeMany(rawArgs, '--attest-manual');
        const findingsPath = takeOption(rawArgs, '--findings');
        const acceptanceApplicability = takeFlag(rawArgs, '--checked-acceptance-applicability');
        if (!preparationPath || !outputPathValue) {
          throw new NativeUsageError('receipt review approve requires --preparation and --output');
        }
        assertNoArguments(rawArgs);
        const rawFindings = findingsPath
          ? await readEvidenceJson(findingsPath, 'Independent review findings')
          : [];
        if (!Array.isArray(rawFindings)) {
          throw new Error('Independent review findings must be a JSON array');
        }
        const preparation = (await readEvidenceJson(
          preparationPath,
          'Native review preparation',
        )) as NativeIndependentReviewPreparation;
        const approval = await approveNativeIndependentReviewPreparation({
          paths,
          name,
          preparation,
          acceptanceApplicability,
          manualAttestationRefs,
          findings: rawFindings as NativeReviewFinding[],
        });
        const outputPath = path.resolve(outputPathValue);
        await atomicWriteJson(outputPath, approval);
        return success(
          'receipt review approve',
          { outputPath, approval },
          `Native review approval written to ${outputPath}\n`,
        );
      }
      if (reviewPhase === 'finalize') {
        const preparationPath = takeOption(rawArgs, '--preparation');
        const approvalPath = takeOption(rawArgs, '--approval');
        const attestationPath = takeOption(rawArgs, '--attestation');
        const confirmed = takeFlag(rawArgs, '--confirmed');
        if (!preparationPath || !approvalPath || !attestationPath) {
          throw new NativeUsageError(
            'receipt review finalize requires --preparation, --approval, and --attestation',
          );
        }
        assertNoArguments(rawArgs);
        const issued = await finalizeNativeIndependentReviewReceipt({
          paths,
          name,
          preparation: (await readEvidenceJson(
            preparationPath,
            'Native review preparation',
          )) as NativeIndependentReviewPreparation,
          approval: parseNativeIndependentReviewApproval(
            await readEvidenceJson(approvalPath, 'Native review approval'),
          ),
          attestation: parseNativeReviewSignature(
            await readEvidenceJson(attestationPath, 'Native review attestation'),
          ),
          confirmed,
        });
        return {
          command: 'receipt review finalize',
          exitCode: issued.receipt.status === 'passed' ? 0 : 1,
          data: issued,
          text: `Native review receipt ${issued.receipt.status}: ${issued.ref}\n`,
        };
      }
      throw new NativeUsageError(`Unknown receipt review phase: ${reviewPhase}`);
    }
    if (subcommand === 'waive') {
      const acceptanceId = takeOption(rawArgs, '--acceptance');
      const blockedReceiptRef = takeOption(rawArgs, '--blocked-receipt');
      const reason = takeOption(rawArgs, '--reason');
      const risk = takeOption(rawArgs, '--risk');
      const alternativeReceiptRefs = takeMany(rawArgs, '--alternative-receipt');
      const identityPath = takeOption(rawArgs, '--identity');
      const privateKeyEnv = takeOption(rawArgs, '--private-key-env');
      const confirmed = takeFlag(rawArgs, '--confirmed');
      if (
        !acceptanceId ||
        !blockedReceiptRef ||
        !reason ||
        !risk ||
        !identityPath ||
        !privateKeyEnv
      ) {
        throw new NativeUsageError(
          'receipt waive requires --acceptance, --blocked-receipt, --reason, --risk, --identity, and --private-key-env',
        );
      }
      assertNoArguments(rawArgs);
      const issued = await issueNativeWaiverReceipt({
        paths,
        name,
        acceptanceId,
        blockedReceiptRef,
        reason,
        risk,
        alternativeReceiptRefs,
        signerIdentity: parseNativeReviewIdentity(
          await readEvidenceJson(identityPath, 'Waiver signer identity'),
        ),
        privateKey: privateKeyFromEnvironment(privateKeyEnv),
        confirmed,
      });
      return success('receipt waive', issued, `Native waiver receipt: ${issued.ref}\n`);
    }
    throw new NativeUsageError(`Unknown receipt command: ${subcommand}`);
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
    const verificationReceipt = takeOption(rawArgs, '--receipt');
    const hasVerificationReceiptRefs = rawArgs.includes('--evidence-receipt');
    const hasVerificationWaiverRefs = rawArgs.includes('--waiver');
    const verificationReceiptRefs = takeMany(rawArgs, '--evidence-receipt');
    const verificationWaiverRefs = takeMany(rawArgs, '--waiver');
    const independentReviewReceiptRef = takeOption(rawArgs, '--independent-review-receipt');
    const repairFailureCategories = takeMany(rawArgs, '--failure-category');
    const repairFailedCheckIds = takeMany(rawArgs, '--failed-check');
    const repairOverrideSignature = takeOption(rawArgs, '--override-repair');
    const repairOverrideSummary = takeOption(rawArgs, '--override-summary');
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
    if (
      (repairFailureCategories.length > 0 || repairFailedCheckIds.length > 0) &&
      verificationResult !== 'fail'
    ) {
      throw new NativeUsageError('--failure-category and --failed-check require --result fail');
    }
    if (verificationReceipt && verificationResult === undefined) {
      throw new NativeUsageError('--receipt requires --result');
    }
    if (
      (verificationReceiptRefs.length > 0 ||
        verificationWaiverRefs.length > 0 ||
        independentReviewReceiptRef) &&
      verificationResult === undefined
    ) {
      throw new NativeUsageError(
        '--evidence-receipt, --waiver, and --independent-review-receipt require --result',
      );
    }
    if (independentReviewReceiptRef && verificationResult !== 'pass') {
      throw new NativeUsageError('--independent-review-receipt requires --result pass');
    }
    if ((repairOverrideSignature === undefined) !== (repairOverrideSummary === undefined)) {
      throw new NativeUsageError(
        '--override-repair and --override-summary must be provided together',
      );
    }
    if (repairOverrideSignature && !/^[a-f0-9]{64}$/u.test(repairOverrideSignature)) {
      throw new NativeUsageError('--override-repair must be a SHA-256 hash');
    }
    if (repairOverrideSignature && verificationResult !== undefined) {
      throw new NativeUsageError('--override-repair cannot be combined with --result');
    }
    assertNoArguments(rawArgs);
    const { config, paths } = await configuredPaths(projectRoot);
    const evidence: NativeAdvanceEvidence = {
      summary,
      ...(confirmed ? { confirmed: true } : {}),
      ...(artifacts.length > 0 ? { artifacts } : {}),
      ...(noCodeReason ? { noCodeReason } : {}),
      ...(allowPartialScopeHash ? { allowPartialScopeHash } : {}),
      ...(partialReason ? { partialReason } : {}),
      ...(verificationResult ? { verificationResult } : {}),
      ...(verificationReport ? { verificationReport } : {}),
      ...(verificationReceipt ? { verificationReceipt } : {}),
      ...(verificationResult && hasVerificationReceiptRefs
        ? {
            verificationReceiptRefs,
          }
        : {}),
      ...(verificationResult && hasVerificationWaiverRefs ? { verificationWaiverRefs } : {}),
      ...(independentReviewReceiptRef ? { independentReviewReceiptRef } : {}),
      ...(repairFailureCategories.length > 0 ? { repairFailureCategories } : {}),
      ...(repairFailedCheckIds.length > 0 ? { repairFailedCheckIds } : {}),
      ...(repairOverrideSignature ? { repairOverrideSignature } : {}),
      ...(repairOverrideSummary ? { repairOverrideSummary } : {}),
    };
    const result = await advanceNativeChange({
      paths,
      name,
      evidence,
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    if (result.next === 'manual') {
      const repairBlocked =
        result.repair?.disposition === 'manual-stop' ||
        result.repair?.disposition === 'hard-stop' ||
        result.findings.some((finding) =>
          [
            'repair-stagnation-stop',
            'repair-iteration-limit',
            'repair-override-exhausted',
          ].includes(finding.code),
        );
      return {
        command: 'next',
        exitCode: repairBlocked ? 75 : 65,
        data: result,
        error: {
          code: repairBlocked ? 'blocked' : 'invalid-data',
          message: result.findings[0]?.message ?? 'Native phase guard failed',
        },
      };
    }
    const status = await inspectNativeStatus(paths, name, {
      clarificationMode: config.native.clarification_mode,
      maxVerifyFailures: config.native.max_verify_failures,
    });
    return success('next', { ...result, continuation: status.continuation });
  }
  if (command === 'archive') {
    const name = requiredPositional(rawArgs, 'change name');
    const dryRun = takeFlag(rawArgs, '--dry-run');
    const expectedPreflightHash = takeOption(rawArgs, '--expect-preflight');
    const confirmed = takeFlag(rawArgs, '--confirmed');
    if (dryRun && expectedPreflightHash) {
      throw new NativeUsageError('--dry-run and --expect-preflight cannot be combined');
    }
    if (dryRun && confirmed) {
      throw new NativeUsageError('--confirmed is only valid with --expect-preflight');
    }
    if (!dryRun && !expectedPreflightHash) {
      throw new NativeUsageError('archive requires --dry-run or --expect-preflight <sha256>');
    }
    if (expectedPreflightHash && !/^[a-f0-9]{64}$/u.test(expectedPreflightHash)) {
      throw new NativeUsageError('--expect-preflight must be a SHA-256 hash');
    }
    assertNoArguments(rawArgs);
    const { config, paths } = await configuredPaths(projectRoot);
    if (dryRun) {
      const preview = await inspectNativeArchivePreflight({ paths, name });
      const state = await readNativeChange(paths, name);
      return success(
        'archive --dry-run',
        {
          ...preview,
          continuation: nativeContinuation({
            state,
            archiveReady: preview.ready,
            archiveConfirmation: preview.archiveConfirmation,
            archivePreflightHash: preview.preflightHash,
          }),
        },
        `Native Archive preview ${preview.preflightHash}: ${preview.ready ? 'ready' : 'blocked'}\n`,
      );
    }
    if (config.native.archive_confirmation === 'required' && !confirmed) {
      throw new NativeUsageError(
        'archive requires --confirmed when native.archive_confirmation is required',
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
          'increase native.snapshot.max_total_bytes or native.snapshot.max_duration_ms',
          'add an explicit native.snapshot.exclude pattern for data outside implementation scope',
        ],
        requiredAction: 'resolve-native-baseline',
      },
      error: { code: 'baseline-incomplete', message: error.message },
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
  const separator = args.indexOf('--');
  const globalArgs = separator < 0 ? args : args.slice(0, separator);
  const commandTail = separator < 0 ? [] : args.slice(separator);
  const json = globalArgs.includes('--json');
  let explicitProjectRoot: string | undefined;
  let command: string | null = globalArgs[0] ?? null;
  try {
    takeFlag(globalArgs, '--json');
    explicitProjectRoot = takeOption(globalArgs, '--project-root');
    const dispatchArgs = [...globalArgs, ...commandTail];
    command = dispatchArgs[0] ?? null;
    return render(await dispatch(dispatchArgs, explicitProjectRoot), json);
  } catch (error) {
    return render(errorResult(command, error), json);
  }
}
