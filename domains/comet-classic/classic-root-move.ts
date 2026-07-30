import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { BigIntStats, Dirent, Stats } from 'fs';
import path from 'path';

import {
  hasComparableFileObject,
  sameFileObject,
  type FileObjectIdentity,
} from '../../platform/fs/file-identity.js';
import { renderStructuredProjectConfig } from '../workflow-contract/project-config.js';
import {
  readWorkflowProjectConfigSnapshot,
  WORKFLOW_PROJECT_CONFIG_PATH,
} from '../workflow-contract/project-config-reader.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';

import {
  assertClassicWorkflowEnabled,
  classicLayoutPaths,
  discoverClassicProject,
  readClassicArtifactLayout,
  writeClassicArtifactLayout,
} from './classic-layout.js';

const JOURNAL_RELATIVE_PATH = '.comet/classic-root-move.json';
const STAGING_PLAN_IDENTITY = '.comet/transactions/classic-root-move/<transaction-id>/openspec';
const HISTORICAL_POINTERS_PRESERVED = [
  'handoff hashes',
  'Run state',
  'checkpoints',
  'trajectory',
  'archived evidence and artifact pointers',
] as const;
const APPLY_PRECONDITIONS = [
  'approved plan ID still matches layout, source identity and manifest, target identity, and configuration',
  'no pending root-move recovery transaction',
  'target remains absent or the bound empty directory',
  'source, target, staging, transaction, and config paths remain protected',
] as const;
const MAX_FILES = 50_000;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const journalClaimBrand = Symbol('ClassicRootMoveJournalClaim');

export interface ClassicRootMoveFileSummary {
  path: string;
  size: number;
  hash: string;
}

interface ClassicRootMoveManifest {
  directories: string[];
  files: ClassicRootMoveFileSummary[];
  totalBytes: number;
  hash: string;
}

interface ClassicRootMoveJournalBase {
  id: string;
  source: string;
  target: string;
  staging: string;
  configPath: typeof WORKFLOW_PROJECT_CONFIG_PATH;
  originalConfigHash: string;
  expectedConfigHash: string;
  planId: string;
  manifest: ClassicRootMoveManifest;
  readonly [journalClaimBrand]?: ClassicRootMoveJournalClaim;
}

interface ClassicRootMoveJournalV1 extends ClassicRootMoveJournalBase {
  schema: 'comet.classic-root-move.v1';
  stage: 'copying' | 'ready' | 'switched' | 'configured';
  targetInitialState: 'missing' | 'empty';
}

interface ClassicRootMoveJournalV2 extends ClassicRootMoveJournalBase {
  schema: 'comet.classic-root-move.v2';
  stage: 'locked' | 'copying' | 'ready' | 'switched' | 'configured';
  artifactLayout: 'legacy';
  sourceIdentity: ClassicRootMovePathIdentity[];
  targetInitialIdentity: ClassicRootMoveObjectIdentity | null;
  approvedPlanId: string;
  targetInitialState: 'missing' | 'empty' | 'non-empty';
}

type ClassicRootMoveJournal = ClassicRootMoveJournalV1 | ClassicRootMoveJournalV2;

interface ClassicRootMoveJournalClaim {
  fileIdentity: BigIntStats;
  contentHash: string;
}

interface ClassicRootMoveTestHooks {
  afterSourceFileInspect?: (relativePath: string) => void | Promise<void>;
  beforeSourceFileCopy?: (relativePath: string) => void | Promise<void>;
  afterJournalInspect?: () => void | Promise<void>;
  afterJournalQuarantine?: (operation: string) => void | Promise<void>;
  afterConfigSnapshot?: () => void | Promise<void>;
  afterDirectoryInspect?: (label: string) => void | Promise<void>;
  beforeMutation?: (operation: string) => void | Promise<void>;
}

export interface ClassicRootMoveOptions {
  planId?: string;
  testHooks?: ClassicRootMoveTestHooks;
}

export type ClassicRootMoveRecoveryStrategy = 'continue' | 'rollback';

export interface ClassicRootMoveFileObjectIdentity {
  dev: string;
  ino: string;
  birthtime: string;
}

export interface ClassicRootMoveObjectIdentity extends ClassicRootMoveFileObjectIdentity {
  ctime: string;
  mtime: string;
}

export interface ClassicRootMovePathIdentity extends ClassicRootMoveFileObjectIdentity {
  path: string;
}

export interface ClassicRootMovePlan {
  projectRoot: string;
  source: string;
  target: string;
  staging: string;
  artifactLayout: 'legacy';
  sourceIdentity: ClassicRootMovePathIdentity[];
  targetInitialIdentity: ClassicRootMoveObjectIdentity | null;
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  manifestHash: string;
  configPath: typeof WORKFLOW_PROJECT_CONFIG_PATH;
  configHash: string;
  originalConfigHash: string;
  expectedConfigHash: string;
  planId: string;
  fileSummary: ClassicRootMoveFileSummary[];
  configChange: { from: 'legacy'; to: 'docs' };
  conflicts: string[];
  blockers: string[];
  pendingRecovery: ClassicRootMoveInspection | null;
  historicalPointersPreserved: string[];
  applyPreconditions: string[];
  allowedRecoveryStrategies: ClassicRootMoveRecoveryStrategy[];
  targetInitialState: 'missing' | 'empty' | 'non-empty';
  readyToApply: boolean;
}

export interface ClassicRootMoveInspection {
  id: string;
  stage: ClassicRootMoveJournal['stage'];
  source: string;
  target: string;
  staging: string;
  planId: string;
  allowedStrategies: ClassicRootMoveRecoveryStrategy[];
  reason?: string;
}

function projectRelative(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replaceAll('\\', '/');
}

async function assertProtectedMovePath(
  projectRoot: string,
  target: string,
  label: string,
  expected: 'file' | 'directory' | 'any' = 'directory',
): Promise<void> {
  await inspectProtectedProjectPath(projectRoot, projectRelative(projectRoot, target), {
    label: `Classic root move physical path ${label}`,
    expected,
  });
}

interface ProtectedDirectoryChain {
  entries: Array<{ path: string; identity: FileObjectIdentity; stat: BigIntStats }>;
}

function sameDirectoryObject(expected: FileObjectIdentity, actual: FileObjectIdentity): boolean {
  return sameFileObject(expected, actual);
}

async function captureProtectedDirectoryChain(
  projectRoot: string,
  directory: string,
  label: string,
): Promise<ProtectedDirectoryChain> {
  const root = path.resolve(projectRoot);
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  if (target !== root) {
    await assertProtectedMovePath(projectRoot, directory, label, 'directory');
  }
  const paths = [root];
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    paths.push(cursor);
  }
  const entries: ProtectedDirectoryChain['entries'] = [];
  for (const current of paths) {
    const stat = await fs.lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${label} crosses a symbolic link or junction`);
    }
    entries.push({ path: current, identity: fileObjectIdentity(stat), stat });
  }
  return { entries };
}

async function validateProtectedDirectoryChain(
  chain: ProtectedDirectoryChain,
  label: string,
): Promise<void> {
  for (const entry of chain.entries) {
    const stat = await fs.lstat(entry.path, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !sameDirectoryObject(entry.identity, fileObjectIdentity(stat))
    ) {
      throw new Error(`${label} changed after inspection`);
    }
  }
}

async function readProtectedDirectory(
  projectRoot: string,
  directory: string,
  label: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<Dirent[]> {
  const chain = await captureProtectedDirectoryChain(projectRoot, directory, label);
  await testHooks?.afterDirectoryInspect?.(label);
  await validateProtectedDirectoryChain(chain, label);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await validateProtectedDirectoryChain(chain, label);
  return entries;
}

async function protectedDirectoryExists(
  projectRoot: string,
  directory: string,
  label: string,
): Promise<boolean> {
  try {
    await captureProtectedDirectoryChain(projectRoot, directory, label);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureRootMoveDirectory(
  projectRoot: string,
  directory: string,
  label: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  const root = path.resolve(projectRoot);
  const target = path.resolve(directory);
  const relative = path.relative(root, target);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label} must stay inside the project root`);
  }
  let cursor = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(cursor, segment);
    try {
      const stat = await fs.lstat(next, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`${label} crosses a symbolic link or junction`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const chain = await captureProtectedDirectoryChain(projectRoot, cursor, label);
      const operation = `create-directory:${projectRelative(projectRoot, next)}`;
      await testHooks?.beforeMutation?.(operation);
      await validateProtectedDirectoryChain(chain, label);
      try {
        await fs.mkdir(next);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
      }
      await validateProtectedDirectoryChain(chain, label);
      const created = await fs.lstat(next, { bigint: true });
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error(`${label} changed while creating a directory`, { cause: error });
      }
    }
    cursor = next;
  }
  await assertProtectedMovePath(projectRoot, directory, label, 'directory');
}

async function captureMutationObject(
  target: string,
  expected: 'file' | 'directory',
  label: string,
): Promise<BigIntStats> {
  const stat = await fs.lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || (expected === 'file' ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`${label} must be a real ${expected}`);
  }
  return stat;
}

async function validateMutationObject(
  target: string,
  expected: BigIntStats,
  label: string,
): Promise<void> {
  const actual = await fs.lstat(target, { bigint: true });
  const sameIdentity = expected.isDirectory()
    ? sameDirectoryObject(fileObjectIdentity(expected), fileObjectIdentity(actual))
    : sameInspectedFile(expected, actual);
  if (
    actual.isSymbolicLink() ||
    actual.isFile() !== expected.isFile() ||
    actual.isDirectory() !== expected.isDirectory() ||
    !sameIdentity
  ) {
    throw new Error(`${label} changed after inspection`);
  }
}

async function writeProtectedFileExclusive(
  projectRoot: string,
  file: string,
  bytes: string | Buffer,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  const label = `Classic root move ${operation}`;
  const chain = await captureProtectedDirectoryChain(projectRoot, path.dirname(file), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(chain, label);
  const handle = await fs.open(file, 'wx');
  try {
    await validateProtectedDirectoryChain(chain, label);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await validateProtectedDirectoryChain(chain, label);
  await assertProtectedMovePath(projectRoot, file, label, 'file');
}

async function linkProtectedFileExclusive(
  projectRoot: string,
  source: string,
  target: string,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  const label = `Classic root move ${operation}`;
  const sourceParent = await captureProtectedDirectoryChain(
    projectRoot,
    path.dirname(source),
    label,
  );
  const targetParent = await captureProtectedDirectoryChain(
    projectRoot,
    path.dirname(target),
    label,
  );
  const sourceIdentity = await captureMutationObject(source, 'file', label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(source, sourceIdentity, label);
  await fs.link(source, target);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(target, sourceIdentity, label);
}

async function renameProtectedPath(
  projectRoot: string,
  source: string,
  target: string,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
  options: {
    replaceTarget?: boolean;
    expectedTargetIdentity?: BigIntStats;
    validateTarget?: () => Promise<void>;
  } = {},
): Promise<void> {
  const label = `Classic root move ${operation}`;
  const sourceParent = await captureProtectedDirectoryChain(
    projectRoot,
    path.dirname(source),
    label,
  );
  const targetParent = await captureProtectedDirectoryChain(
    projectRoot,
    path.dirname(target),
    label,
  );
  const sourceIdentity = await captureMutationObject(
    source,
    (await fs.lstat(source)).isDirectory() ? 'directory' : 'file',
    label,
  );
  if (!options.replaceTarget) {
    const inspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative(projectRoot, target),
      { label, expected: 'any' },
    );
    if (inspection.exists) throw new Error(`${label} target already exists`);
  } else if (options.expectedTargetIdentity) {
    await validateMutationObject(target, options.expectedTargetIdentity, label);
  }
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(source, sourceIdentity, label);
  if (options.expectedTargetIdentity) {
    await validateMutationObject(target, options.expectedTargetIdentity, label);
  }
  await options.validateTarget?.();
  await fs.rename(source, target);
  await validateProtectedDirectoryChain(sourceParent, label);
  await validateProtectedDirectoryChain(targetParent, label);
  await validateMutationObject(target, sourceIdentity, label);
}

async function unlinkProtectedFile(
  projectRoot: string,
  file: string,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
  options: {
    expectedIdentity?: BigIntStats;
    validateTarget?: () => Promise<void>;
  } = {},
): Promise<boolean> {
  const label = `Classic root move ${operation}`;
  let identity: BigIntStats;
  try {
    identity = await captureMutationObject(file, 'file', label);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (options.expectedIdentity) {
    await validateMutationObject(file, options.expectedIdentity, label);
  }
  const parent = await captureProtectedDirectoryChain(projectRoot, path.dirname(file), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(file, identity, label);
  if (options.expectedIdentity) {
    await validateMutationObject(file, options.expectedIdentity, label);
  }
  await options.validateTarget?.();
  await fs.unlink(file);
  await validateProtectedDirectoryChain(parent, label);
  return true;
}

async function removeProtectedEmptyDirectory(
  projectRoot: string,
  directory: string,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
  expectedIdentity?: ClassicRootMoveObjectIdentity,
): Promise<boolean> {
  const label = `Classic root move ${operation}`;
  let identity: BigIntStats;
  try {
    identity = await captureMutationObject(directory, 'directory', label);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (
    expectedIdentity &&
    !sameStableIdentity(
      stableObjectIdentity(identity, `Classic root move ${operation}`),
      expectedIdentity,
    )
  ) {
    throw new Error(`Classic root move ${operation} changed after migration preflight`);
  }
  const parent = await captureProtectedDirectoryChain(projectRoot, path.dirname(directory), label);
  await testHooks?.beforeMutation?.(operation);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(directory, identity, label);
  const entries = await fs.readdir(directory);
  await validateProtectedDirectoryChain(parent, label);
  await validateMutationObject(directory, identity, label);
  if (entries.length > 0) throw new Error(`${label} directory is not empty`);
  await fs.rmdir(directory);
  await validateProtectedDirectoryChain(parent, label);
  return true;
}

async function assertRootMovePreflightBoundaries(
  projectRoot: string,
  transactionId?: string,
): Promise<void> {
  const legacy = classicLayoutPaths(projectRoot, 'legacy');
  const docs = classicLayoutPaths(projectRoot, 'docs');
  const transactionBase = path.join(projectRoot, '.comet', 'transactions', 'classic-root-move');
  const checks: Array<[string, string, 'file' | 'directory' | 'any']> = [
    [path.join(projectRoot, '.comet'), '.comet', 'directory'],
    [path.join(projectRoot, '.comet', 'config.yaml'), '.comet/config.yaml', 'file'],
    [legacy.openSpecRoot, 'openspec', 'directory'],
    [path.dirname(docs.openSpecRoot), 'docs', 'directory'],
    [docs.openSpecRoot, 'docs/openspec', 'directory'],
    [path.join(projectRoot, '.comet', 'transactions'), '.comet/transactions', 'directory'],
    [transactionBase, '.comet/transactions/classic-root-move', 'directory'],
  ];
  if (transactionId) {
    const transactionRoot = path.join(transactionBase, transactionId);
    checks.push(
      [transactionRoot, `transaction ${transactionId}`, 'directory'],
      [path.join(transactionRoot, 'openspec'), `transaction ${transactionId} staging`, 'directory'],
      [
        path.join(transactionRoot, 'legacy-source'),
        `transaction ${transactionId} quarantine`,
        'directory',
      ],
    );
  }
  for (const [target, label, expected] of checks) {
    await assertProtectedMovePath(projectRoot, target, label, expected);
  }
}

async function atomicWriteJournal(
  projectRoot: string,
  expected: ClassicRootMoveJournal,
  updated: ClassicRootMoveJournal,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<ClassicRootMoveJournal> {
  const file = journalFile(projectRoot);
  await ensureRootMoveDirectory(
    projectRoot,
    path.dirname(file),
    'Classic root move journal parent',
    testHooks,
  );
  const temporary = `${file}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(updated, null, 2) + '\n';
  let quarantine: QuarantinedClassicRootMoveJournal | undefined;
  try {
    await writeProtectedFileExclusive(
      projectRoot,
      temporary,
      serialized,
      'update-journal-temp',
      testHooks,
    );
    const temporaryIdentity = await captureMutationObject(
      temporary,
      'file',
      'Classic root move updated journal',
    );
    quarantine = await quarantineOwnedJournal(
      projectRoot,
      expected,
      'update-journal-commit',
      testHooks,
    );
    try {
      await linkProtectedFileExclusive(
        projectRoot,
        temporary,
        file,
        'update-journal-publish',
        testHooks,
      );
    } catch (error) {
      throw new Error(
        'Classic root move journal publish failed; a successor journal was preserved',
        { cause: error },
      );
    }
    const persisted = await readJournal(projectRoot);
    const persistedClaim = persisted ? journalClaim(persisted) : null;
    if (
      !persisted ||
      persisted.id !== updated.id ||
      persisted.stage !== updated.stage ||
      persisted.planId !== updated.planId ||
      persisted.schema !== updated.schema ||
      !persistedClaim ||
      persistedClaim.contentHash !== hashBytes(Buffer.from(serialized)) ||
      !sameInspectedFile(temporaryIdentity, persistedClaim.fileIdentity)
    ) {
      throw new Error('Classic root move journal ownership changed while updating');
    }
    await unlinkProtectedFile(
      projectRoot,
      quarantine.file,
      'cleanup-update-journal-quarantine',
      testHooks,
      { expectedIdentity: journalClaim(quarantine.journal).fileIdentity },
    );
    quarantine = undefined;
    return persisted;
  } catch (error) {
    if (quarantine) {
      await restoreQuarantinedJournal(
        projectRoot,
        quarantine,
        'restore-update-journal',
        testHooks,
      ).catch(() => false);
    }
    throw error;
  } finally {
    await unlinkProtectedFile(projectRoot, temporary, 'cleanup-update-journal-temp').catch(
      () => false,
    );
  }
}

async function createJsonExclusive(
  projectRoot: string,
  file: string,
  value: unknown,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  await ensureRootMoveDirectory(
    projectRoot,
    path.dirname(file),
    'Classic root move journal parent',
    testHooks,
  );
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeProtectedFileExclusive(
      projectRoot,
      temporary,
      JSON.stringify(value, null, 2) + '\n',
      'create-journal-temp',
      testHooks,
    );
    await linkProtectedFileExclusive(
      projectRoot,
      temporary,
      file,
      'create-journal-commit',
      testHooks,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'Classic root move is incomplete; use comet doctor --repair --strategy continue|rollback',
        { cause: error },
      );
    }
    throw error;
  } finally {
    await unlinkProtectedFile(projectRoot, temporary, 'cleanup-create-journal-temp').catch(
      () => false,
    );
  }
}

function manifestHash(manifest: Omit<ClassicRootMoveManifest, 'hash'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        directories: manifest.directories,
        files: manifest.files,
        totalBytes: manifest.totalBytes,
      }),
    )
    .digest('hex');
}
function compareManifestPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function manifestPathsAreSorted(
  values: readonly string[],
  compare: (left: string, right: string) => number,
): boolean {
  return values.every((entry, index) => index === 0 || compare(values[index - 1], entry) <= 0);
}

interface ClassicRootMovePlanIdentity {
  source: string;
  target: string;
  staging: string;
  artifactLayout: 'legacy';
  sourceIdentity: ClassicRootMovePathIdentity[];
  targetInitialIdentity: ClassicRootMoveObjectIdentity | null;
  targetInitialState: 'missing' | 'empty' | 'non-empty';
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  manifestHash: string;
  configPath: typeof WORKFLOW_PROJECT_CONFIG_PATH;
  originalConfigHash: string;
  expectedConfigHash: string;
}

function planIdFor(plan: ClassicRootMovePlanIdentity): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        source: plan.source,
        target: plan.target,
        staging: plan.staging,
        artifactLayout: plan.artifactLayout,
        sourceIdentity: plan.sourceIdentity,
        targetInitialIdentity: plan.targetInitialIdentity,
        targetInitialState: plan.targetInitialState,
        fileCount: plan.fileCount,
        directoryCount: plan.directoryCount,
        totalBytes: plan.totalBytes,
        manifestHash: plan.manifestHash,
        configPath: plan.configPath,
        originalConfigHash: plan.originalConfigHash,
        expectedConfigHash: plan.expectedConfigHash,
      }),
    )
    .digest('hex');
}

function v1PlanIdFor(plan: {
  source: string;
  target: string;
  targetInitialState: 'missing' | 'empty';
  fileCount: number;
  directoryCount: number;
  totalBytes: number;
  manifestHash: string;
  configPath: typeof WORKFLOW_PROJECT_CONFIG_PATH;
  originalConfigHash: string;
  expectedConfigHash: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        source: plan.source,
        target: plan.target,
        staging: STAGING_PLAN_IDENTITY,
        targetInitialState: plan.targetInitialState,
        fileCount: plan.fileCount,
        directoryCount: plan.directoryCount,
        totalBytes: plan.totalBytes,
        manifestHash: plan.manifestHash,
        configPath: plan.configPath,
        originalConfigHash: plan.originalConfigHash,
        expectedConfigHash: plan.expectedConfigHash,
      }),
    )
    .digest('hex');
}

type AnyStats = Stats | BigIntStats;

function birthtimeOf(stat: AnyStats): number | bigint {
  return 'birthtimeNs' in stat && typeof stat.birthtimeNs === 'bigint'
    ? stat.birthtimeNs
    : stat.birthtimeMs;
}

function ctimeOf(stat: AnyStats): number | bigint {
  return 'ctimeNs' in stat && typeof stat.ctimeNs === 'bigint' ? stat.ctimeNs : stat.ctimeMs;
}

function mtimeOf(stat: AnyStats): number | bigint {
  return 'mtimeNs' in stat && typeof stat.mtimeNs === 'bigint' ? stat.mtimeNs : stat.mtimeMs;
}

function fileObjectIdentity(stat: AnyStats): FileObjectIdentity {
  return { dev: stat.dev, ino: stat.ino, birthtime: birthtimeOf(stat) };
}

function identityScalar(value: number | bigint): string {
  return String(value);
}

function stableObjectIdentity(stat: BigIntStats, label: string): ClassicRootMoveObjectIdentity {
  const objectIdentity = fileObjectIdentity(stat);
  if (!hasComparableFileObject(objectIdentity, objectIdentity)) {
    throw new Error(
      `${label} filesystem does not expose a stable device and file identity; refusing an auditable root move`,
    );
  }
  return {
    dev: identityScalar(stat.dev),
    ino: identityScalar(stat.ino),
    birthtime: identityScalar(birthtimeOf(stat)),
    ctime: identityScalar(ctimeOf(stat)),
    mtime: identityScalar(mtimeOf(stat)),
  };
}

function stableChainIdentity(
  projectRoot: string,
  chain: ProtectedDirectoryChain,
  label: string,
): ClassicRootMovePathIdentity[] {
  return chain.entries.map((entry) => {
    const identity = stableObjectIdentity(entry.stat, label);
    return {
      path: projectRelative(projectRoot, entry.path) || '.',
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime,
    };
  });
}

function sameStableIdentity(
  left: ClassicRootMoveFileObjectIdentity | ClassicRootMovePathIdentity,
  right: ClassicRootMoveFileObjectIdentity | ClassicRootMovePathIdentity,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStableChain(
  left: ClassicRootMovePathIdentity[],
  right: ClassicRootMovePathIdentity[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => sameStableIdentity(entry, right[index]))
  );
}

async function captureStableSourceIdentity(
  projectRoot: string,
  directory: string,
  label: string,
): Promise<ClassicRootMovePathIdentity[]> {
  const chain = await captureProtectedDirectoryChain(projectRoot, directory, label);
  await validateProtectedDirectoryChain(chain, label);
  return stableChainIdentity(projectRoot, chain, label);
}

function sameInspectedFile(left: AnyStats, right: AnyStats): boolean {
  const leftObject = fileObjectIdentity(left);
  const rightObject = fileObjectIdentity(right);
  if (hasComparableFileObject(leftObject, rightObject)) {
    return sameFileObject(leftObject, rightObject);
  }
  return (
    sameFileObject(leftObject, rightObject) &&
    birthtimeOf(left) === birthtimeOf(right) &&
    ctimeOf(left) === ctimeOf(right) &&
    left.size === right.size
  );
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readRootMoveFile(
  projectRoot: string,
  file: string,
  maxBytes: number,
  label: string,
  inspected?: AnyStats,
): Promise<Buffer> {
  const result = await readProtectedProjectFile(
    projectRoot,
    projectRelative(projectRoot, file),
    maxBytes,
    { label, bigint: true },
  );
  if (inspected && !sameInspectedFile(inspected, result.stat)) {
    throw new Error(`${label} changed while reading`);
  }
  if (BigInt(result.stat.size) !== BigInt(result.bytes.byteLength)) {
    throw new Error(`${label} changed while reading`);
  }
  return result.bytes;
}

async function projectConfigSnapshot(projectRoot: string) {
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true,
  });
  if (!snapshot.document || !snapshot.identity.exists || !snapshot.identity.sha256) {
    throw new Error('.comet/config.yaml does not exist');
  }
  return snapshot as typeof snapshot & {
    document: NonNullable<(typeof snapshot)['document']>;
    identity: { exists: true; sha256: string };
  };
}

async function projectConfigHash(projectRoot: string): Promise<string> {
  return (await projectConfigSnapshot(projectRoot)).identity.sha256;
}

function expectedPostSwitchConfigHash(
  parsed: Awaited<ReturnType<typeof projectConfigSnapshot>>['document'],
): string {
  const classic = parsed.value.classic;
  if (!classic || typeof classic !== 'object' || Array.isArray(classic)) {
    throw new Error('classic must be a mapping');
  }
  const expected = renderStructuredProjectConfig(
    {
      ...parsed.value,
      classic: {
        ...(classic as Record<string, unknown>),
        artifact_layout: 'docs',
      },
    },
    parsed.classic?.language === 'zh-CN' || parsed.native?.language === 'zh-CN' ? 'zh-CN' : 'en',
  );
  return createHash('sha256').update(expected).digest('hex');
}

async function scanTree(
  projectRoot: string,
  root: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<ClassicRootMoveManifest> {
  const directories: string[] = [];
  const files: ClassicRootMoveFileSummary[] = [];
  let totalBytes = 0;

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    await assertProtectedMovePath(
      projectRoot,
      directory,
      relativeDirectory || projectRelative(projectRoot, root),
      'directory',
    );
    const entries = await readProtectedDirectory(
      projectRoot,
      directory,
      `tree:${relativeDirectory || projectRelative(projectRoot, root)}`,
      testHooks,
    );
    for (const entry of entries.sort((left, right) => compareManifestPath(left.name, right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const stat = await fs.lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Classic root move does not support symbolic links or junctions: ${relative}`,
        );
      }
      if (stat.isDirectory()) {
        directories.push(relative);
        await visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(
          `Classic root move supports only regular files and directories: ${relative}`,
        );
      }
      await testHooks?.afterSourceFileInspect?.(relative);
      if (files.length + 1 > MAX_FILES) {
        throw new Error(`Classic root move exceeds ${MAX_FILES} files`);
      }
      const remainingBytes = MAX_TOTAL_BYTES - totalBytes;
      const bytes = await readRootMoveFile(
        projectRoot,
        absolute,
        Math.max(1, remainingBytes),
        `Classic root move source file ${relative}`,
        stat,
      );
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(`Classic root move exceeds ${MAX_TOTAL_BYTES} bytes`);
      }
      files.push({ path: relative, size: bytes.byteLength, hash: hashBytes(bytes) });
    }
  }

  await visit(root, '');
  directories.sort(compareManifestPath);
  files.sort((left, right) => compareManifestPath(left.path, right.path));
  const normalized = { directories, files, totalBytes };
  return { ...normalized, hash: manifestHash(normalized) };
}

function sameManifest(actual: ClassicRootMoveManifest, expected: ClassicRootMoveManifest): boolean {
  return actual.hash === expected.hash;
}

async function inspectInitialTarget(
  projectRoot: string,
  target: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<{
  state: 'missing' | 'empty' | 'non-empty';
  conflicts: string[];
  identity: ClassicRootMoveObjectIdentity | null;
}> {
  try {
    const chain = await captureProtectedDirectoryChain(projectRoot, target, 'docs-target');
    const initialEntry = chain.entries.at(-1);
    if (!initialEntry) throw new Error('Classic docs target identity is unavailable');
    const initialIdentity = stableObjectIdentity(initialEntry.stat, 'Classic docs target');
    await testHooks?.afterDirectoryInspect?.('docs-target');
    await validateProtectedDirectoryChain(chain, 'docs-target');
    const entries = await fs.readdir(target, { withFileTypes: true });
    await validateProtectedDirectoryChain(chain, 'docs-target');
    const currentChain = await captureProtectedDirectoryChain(projectRoot, target, 'docs-target');
    const currentEntry = currentChain.entries.at(-1);
    const currentIdentity = currentEntry
      ? stableObjectIdentity(currentEntry.stat, 'Classic docs target')
      : null;
    if (!currentIdentity || !sameStableIdentity(initialIdentity, currentIdentity)) {
      throw new Error('Classic docs target changed after inspection');
    }
    if (entries.length > 0) {
      return {
        state: 'non-empty',
        conflicts: ['Classic docs target is not empty'],
        identity: currentIdentity,
      };
    }
    return { state: 'empty', conflicts: [], identity: currentIdentity };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: 'missing', conflicts: [], identity: null };
    }
    throw error;
  }
}

async function validatedLegacyConfig(projectRoot: string): Promise<void> {
  await assertClassicWorkflowEnabled(projectRoot);
  if ((await readClassicArtifactLayout(projectRoot)) !== 'legacy') {
    throw new Error('Classic root move requires classic.artifact_layout: legacy');
  }
}

async function preflight(
  projectRoot: string,
  options: ClassicRootMoveOptions = {},
): Promise<{
  plan: ClassicRootMovePlan;
  manifest: ClassicRootMoveManifest;
}> {
  await assertRootMovePreflightBoundaries(projectRoot);
  await validatedLegacyConfig(projectRoot);
  if ((await readClassicArtifactLayout(projectRoot)) !== 'legacy') {
    throw new Error('Classic root move requires the legacy layout');
  }
  const legacy = classicLayoutPaths(projectRoot, 'legacy');
  const docs = classicLayoutPaths(projectRoot, 'docs');
  if (!(await protectedDirectoryExists(projectRoot, legacy.openSpecRoot, 'Classic legacy root'))) {
    throw new Error('Classic legacy root does not exist: openspec/');
  }
  // Validate the complete source tree before reading any nested state file so
  // blocker reporting cannot follow a special object outside the migration root.
  const sourceIdentityBefore = await captureStableSourceIdentity(
    projectRoot,
    legacy.openSpecRoot,
    'Classic legacy root identity',
  );
  const manifest = await scanTree(projectRoot, legacy.openSpecRoot, options.testHooks);
  const sourceIdentityAfter = await captureStableSourceIdentity(
    projectRoot,
    legacy.openSpecRoot,
    'Classic legacy root identity',
  );
  if (!sameStableChain(sourceIdentityBefore, sourceIdentityAfter)) {
    throw new Error('Classic legacy root identity changed during migration preflight');
  }
  const targetInspection = await inspectInitialTarget(
    projectRoot,
    docs.openSpecRoot,
    options.testHooks,
  );
  const configSnapshot = await projectConfigSnapshot(projectRoot);
  await options.testHooks?.afterConfigSnapshot?.();
  const configHash = configSnapshot.identity.sha256;
  const expectedConfigHash = expectedPostSwitchConfigHash(configSnapshot.document);
  const identity: ClassicRootMovePlanIdentity = {
    source: projectRelative(projectRoot, legacy.openSpecRoot),
    target: projectRelative(projectRoot, docs.openSpecRoot),
    staging: STAGING_PLAN_IDENTITY,
    artifactLayout: 'legacy',
    sourceIdentity: sourceIdentityAfter,
    targetInitialIdentity: targetInspection.identity,
    targetInitialState: targetInspection.state,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: WORKFLOW_PROJECT_CONFIG_PATH,
    originalConfigHash: configHash,
    expectedConfigHash,
  };
  return {
    manifest,
    plan: {
      projectRoot,
      ...identity,
      configHash,
      planId: planIdFor(identity),
      fileSummary: manifest.files.map((file) => ({ ...file })),
      configChange: { from: 'legacy', to: 'docs' },
      conflicts: targetInspection.conflicts,
      blockers: [],
      pendingRecovery: null,
      historicalPointersPreserved: [...HISTORICAL_POINTERS_PRESERVED],
      applyPreconditions: [...APPLY_PRECONDITIONS],
      allowedRecoveryStrategies: [],
      readyToApply: targetInspection.conflicts.length === 0,
    },
  };
}

async function copyManifest(
  projectRoot: string,
  sourceRoot: string,
  targetRoot: string,
  manifest: ClassicRootMoveManifest,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  await ensureRootMoveDirectory(
    projectRoot,
    targetRoot,
    'Classic root move staging root',
    testHooks,
  );
  for (const directory of manifest.directories) {
    await ensureRootMoveDirectory(
      projectRoot,
      path.join(targetRoot, ...directory.split('/')),
      `Classic root move staging directory ${directory}`,
      testHooks,
    );
  }
  for (const file of manifest.files) {
    await testHooks?.beforeSourceFileCopy?.(file.path);
    const source = path.join(sourceRoot, ...file.path.split('/'));
    const sourceBytes = await readRootMoveFile(
      projectRoot,
      source,
      Math.max(1, file.size),
      `Classic root move source file ${file.path}`,
    );
    if (sourceBytes.byteLength !== file.size || hashBytes(sourceBytes) !== file.hash) {
      throw new Error('Classic legacy root changed after migration preflight');
    }
    const target = path.join(targetRoot, ...file.path.split('/'));
    await ensureRootMoveDirectory(
      projectRoot,
      path.dirname(target),
      `Classic root move staging parent ${file.path}`,
      testHooks,
    );
    const targetInspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative(projectRoot, target),
      { label: `Classic root move staging file ${file.path}`, expected: 'file' },
    );
    if (targetInspection.exists) {
      throw new Error('Classic root move staging changed after migration preflight');
    }
    await writeProtectedFileExclusive(
      projectRoot,
      target,
      sourceBytes,
      `copy-file:${file.path}`,
      testHooks,
    );
    const copiedBytes = await readRootMoveFile(
      projectRoot,
      target,
      Math.max(1, file.size),
      `Classic root move staging file ${file.path}`,
    );
    if (copiedBytes.byteLength !== file.size || hashBytes(copiedBytes) !== file.hash) {
      throw new Error('Classic root move staging verification failed');
    }
  }
}

function journalFile(projectRoot: string): string {
  return path.join(projectRoot, ...JOURNAL_RELATIVE_PATH.split('/'));
}

function invalidJournal(detail: string): Error {
  return new Error(`invalid Classic root move journal: ${detail}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidJournal(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw invalidJournal(`${label} fields are invalid`);
  }
}

function assertSafeManifestPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')) {
    throw invalidJournal(`${label} is invalid`);
  }
  const segments = value.split('/');
  if (
    path.posix.isAbsolute(value) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    path.posix.normalize(value) !== value
  ) {
    throw invalidJournal(`${label} must stay inside the migration tree`);
  }
  return value;
}

function parseManifest(value: unknown): ClassicRootMoveManifest {
  const manifest = record(value, 'manifest');
  assertExactKeys(manifest, ['directories', 'files', 'totalBytes', 'hash'], 'manifest');
  if (
    !Array.isArray(manifest.directories) ||
    !Array.isArray(manifest.files) ||
    !Number.isSafeInteger(manifest.totalBytes) ||
    (manifest.totalBytes as number) < 0 ||
    (manifest.totalBytes as number) > MAX_TOTAL_BYTES ||
    typeof manifest.hash !== 'string' ||
    !HASH_PATTERN.test(manifest.hash)
  ) {
    throw invalidJournal('manifest shape is invalid');
  }
  const directories = manifest.directories.map((entry, index) =>
    assertSafeManifestPath(entry, `manifest path directories[${index}]`),
  );
  const files = manifest.files.map((entry, index) => {
    const file = record(entry, `manifest.files[${index}]`);
    assertExactKeys(file, ['path', 'size', 'hash'], `manifest.files[${index}]`);
    const filePath = assertSafeManifestPath(file.path, `manifest path files[${index}]`);
    if (
      !Number.isSafeInteger(file.size) ||
      (file.size as number) < 0 ||
      typeof file.hash !== 'string' ||
      !HASH_PATTERN.test(file.hash)
    ) {
      throw invalidJournal(`manifest.files[${index}] is invalid`);
    }
    return { path: filePath, size: file.size as number, hash: file.hash };
  });
  if (files.length > MAX_FILES) throw invalidJournal(`manifest exceeds ${MAX_FILES} files`);
  const filePaths = files.map((file) => file.path);
  const duplicatePaths =
    new Set(directories).size !== directories.length ||
    new Set(filePaths).size !== filePaths.length;
  const pathsUseSupportedOrder =
    (manifestPathsAreSorted(directories, compareManifestPath) &&
      manifestPathsAreSorted(filePaths, compareManifestPath)) ||
    (manifestPathsAreSorted(directories, (left, right) => left.localeCompare(right)) &&
      manifestPathsAreSorted(filePaths, (left, right) => left.localeCompare(right)));
  if (duplicatePaths || !pathsUseSupportedOrder) {
    throw invalidJournal('manifest paths must be unique and sorted');
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes !== manifest.totalBytes) {
    throw invalidJournal('manifest totalBytes does not match its files');
  }
  const normalized = { directories, files, totalBytes };
  const hash = manifestHash(normalized);
  if (hash !== manifest.hash) throw invalidJournal('manifest hash is invalid');
  return { ...normalized, hash };
}

function parseFileObjectIdentity(value: unknown, label: string): ClassicRootMoveFileObjectIdentity {
  const identity = record(value, label);
  assertExactKeys(identity, ['dev', 'ino', 'birthtime'], label);
  const scalarPattern = /^-?[0-9]+$/u;
  for (const field of ['dev', 'ino', 'birthtime'] as const) {
    if (typeof identity[field] !== 'string' || !scalarPattern.test(identity[field])) {
      throw invalidJournal(`${label}.${field} is invalid`);
    }
  }
  if (identity.dev === '0' || identity.ino === '0') {
    throw invalidJournal(`${label} does not contain a stable filesystem identity`);
  }
  return {
    dev: identity.dev,
    ino: identity.ino,
    birthtime: identity.birthtime,
  } as ClassicRootMoveFileObjectIdentity;
}

function parseObjectIdentity(value: unknown, label: string): ClassicRootMoveObjectIdentity {
  const identity = record(value, label);
  assertExactKeys(identity, ['dev', 'ino', 'birthtime', 'ctime', 'mtime'], label);
  const base = parseFileObjectIdentity(
    {
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime,
    },
    label,
  );
  const scalarPattern = /^-?[0-9]+$/u;
  if (
    typeof identity.ctime !== 'string' ||
    !scalarPattern.test(identity.ctime) ||
    typeof identity.mtime !== 'string' ||
    !scalarPattern.test(identity.mtime)
  ) {
    throw invalidJournal(`${label} timestamps are invalid`);
  }
  return {
    ...base,
    ctime: identity.ctime,
    mtime: identity.mtime,
  };
}

function parseSourceIdentity(value: unknown): ClassicRootMovePathIdentity[] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw invalidJournal('sourceIdentity must bind the project root and openspec root');
  }
  const expectedPaths = ['.', 'openspec'];
  return value.map((entry, index) => {
    const identity = record(entry, `sourceIdentity[${index}]`);
    assertExactKeys(identity, ['path', 'dev', 'ino', 'birthtime'], `sourceIdentity[${index}]`);
    if (identity.path !== expectedPaths[index]) {
      throw invalidJournal(`sourceIdentity[${index}].path is invalid`);
    }
    const objectIdentity = {
      dev: identity.dev,
      ino: identity.ino,
      birthtime: identity.birthtime,
    };
    return {
      path: expectedPaths[index],
      ...parseFileObjectIdentity(objectIdentity, `sourceIdentity[${index}]`),
    };
  });
}

function parseJournalV1(journal: Record<string, unknown>): ClassicRootMoveJournalV1 {
  assertExactKeys(
    journal,
    [
      'schema',
      'id',
      'stage',
      'source',
      'target',
      'staging',
      'configPath',
      'originalConfigHash',
      'expectedConfigHash',
      'planId',
      'targetInitialState',
      'manifest',
    ],
    'root',
  );
  if (typeof journal.id !== 'string' || !UUID_PATTERN.test(journal.id)) {
    throw invalidJournal('id is invalid');
  }
  if (
    journal.stage !== 'copying' &&
    journal.stage !== 'ready' &&
    journal.stage !== 'switched' &&
    journal.stage !== 'configured'
  ) {
    throw invalidJournal('stage is invalid');
  }
  const expectedStaging = `.comet/transactions/classic-root-move/${journal.id}/openspec`;
  if (
    journal.source !== 'openspec' ||
    journal.target !== 'docs/openspec' ||
    journal.staging !== expectedStaging
  ) {
    throw invalidJournal('source, target, and staging must use the managed project paths');
  }
  if (
    journal.configPath !== WORKFLOW_PROJECT_CONFIG_PATH ||
    typeof journal.originalConfigHash !== 'string' ||
    !HASH_PATTERN.test(journal.originalConfigHash) ||
    typeof journal.expectedConfigHash !== 'string' ||
    !HASH_PATTERN.test(journal.expectedConfigHash) ||
    typeof journal.planId !== 'string' ||
    !HASH_PATTERN.test(journal.planId)
  ) {
    throw invalidJournal('config path, config hashes, or planId is invalid');
  }
  if (journal.targetInitialState !== 'missing' && journal.targetInitialState !== 'empty') {
    throw invalidJournal('targetInitialState is invalid');
  }
  const targetInitialState = journal.targetInitialState;
  const manifest = parseManifest(journal.manifest);
  const identity: Parameters<typeof v1PlanIdFor>[0] = {
    source: journal.source,
    target: journal.target,
    targetInitialState,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
  };
  if (v1PlanIdFor(identity) !== journal.planId) {
    throw invalidJournal('planId does not match the bound config and tree');
  }
  return {
    schema: 'comet.classic-root-move.v1',
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
    planId: journal.planId,
    targetInitialState,
    manifest,
  };
}

function parseJournalV2(journal: Record<string, unknown>): ClassicRootMoveJournalV2 {
  assertExactKeys(
    journal,
    [
      'schema',
      'id',
      'stage',
      'source',
      'target',
      'staging',
      'artifactLayout',
      'sourceIdentity',
      'targetInitialIdentity',
      'configPath',
      'originalConfigHash',
      'expectedConfigHash',
      'planId',
      'approvedPlanId',
      'targetInitialState',
      'manifest',
    ],
    'root',
  );
  if (typeof journal.id !== 'string' || !UUID_PATTERN.test(journal.id)) {
    throw invalidJournal('id is invalid');
  }
  if (
    journal.stage !== 'locked' &&
    journal.stage !== 'copying' &&
    journal.stage !== 'ready' &&
    journal.stage !== 'switched' &&
    journal.stage !== 'configured'
  ) {
    throw invalidJournal('stage is invalid');
  }
  const expectedStaging = `.comet/transactions/classic-root-move/${journal.id}/openspec`;
  if (
    journal.source !== 'openspec' ||
    journal.target !== 'docs/openspec' ||
    journal.staging !== expectedStaging
  ) {
    throw invalidJournal('source, target, and staging must use the managed project paths');
  }
  if (journal.artifactLayout !== 'legacy') {
    throw invalidJournal('artifactLayout must be legacy');
  }
  const sourceIdentity = parseSourceIdentity(journal.sourceIdentity);
  if (
    journal.configPath !== WORKFLOW_PROJECT_CONFIG_PATH ||
    typeof journal.originalConfigHash !== 'string' ||
    !HASH_PATTERN.test(journal.originalConfigHash) ||
    typeof journal.expectedConfigHash !== 'string' ||
    !HASH_PATTERN.test(journal.expectedConfigHash) ||
    typeof journal.planId !== 'string' ||
    !HASH_PATTERN.test(journal.planId) ||
    typeof journal.approvedPlanId !== 'string' ||
    !HASH_PATTERN.test(journal.approvedPlanId)
  ) {
    throw invalidJournal('config path, config hashes, planId, or approvedPlanId is invalid');
  }
  const targetInitialState = journal.targetInitialState;
  if (
    targetInitialState !== 'missing' &&
    targetInitialState !== 'empty' &&
    !(journal.stage === 'locked' && targetInitialState === 'non-empty')
  ) {
    throw invalidJournal('targetInitialState is invalid');
  }
  const targetInitialIdentity =
    journal.targetInitialIdentity === null
      ? null
      : parseObjectIdentity(journal.targetInitialIdentity, 'targetInitialIdentity');
  if (
    (targetInitialState === 'missing' && targetInitialIdentity !== null) ||
    (targetInitialState !== 'missing' && targetInitialIdentity === null)
  ) {
    throw invalidJournal('targetInitialIdentity does not match targetInitialState');
  }
  const manifest = parseManifest(journal.manifest);
  const identity: ClassicRootMovePlanIdentity = {
    source: journal.source,
    target: journal.target,
    staging: STAGING_PLAN_IDENTITY,
    artifactLayout: 'legacy',
    sourceIdentity,
    targetInitialIdentity,
    targetInitialState,
    fileCount: manifest.files.length,
    directoryCount: manifest.directories.length,
    totalBytes: manifest.totalBytes,
    manifestHash: manifest.hash,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
  };
  if (planIdFor(identity) !== journal.planId) {
    throw invalidJournal('planId does not match the bound config and tree');
  }
  if (journal.stage !== 'locked' && journal.approvedPlanId !== journal.planId) {
    throw invalidJournal('approvedPlanId does not match the executable plan');
  }
  return {
    schema: 'comet.classic-root-move.v2',
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    artifactLayout: 'legacy',
    sourceIdentity,
    targetInitialIdentity,
    configPath: journal.configPath,
    originalConfigHash: journal.originalConfigHash,
    expectedConfigHash: journal.expectedConfigHash,
    planId: journal.planId,
    approvedPlanId: journal.approvedPlanId,
    targetInitialState,
    manifest,
  };
}

function parseJournal(value: unknown): ClassicRootMoveJournal {
  const journal = record(value, 'root');
  if (journal.schema === 'comet.classic-root-move.v1') return parseJournalV1(journal);
  if (journal.schema === 'comet.classic-root-move.v2') return parseJournalV2(journal);
  throw invalidJournal('schema is unsupported');
}

async function readJournal(
  projectRoot: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<ClassicRootMoveJournal | null> {
  return readJournalAtPath(
    projectRoot,
    journalFile(projectRoot),
    JOURNAL_RELATIVE_PATH,
    testHooks?.afterJournalInspect,
  );
}

async function readJournalAtPath(
  projectRoot: string,
  file: string,
  label: string,
  afterInspect?: () => void | Promise<void>,
): Promise<ClassicRootMoveJournal | null> {
  await assertProtectedMovePath(projectRoot, file, label, 'file');
  try {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(MAX_JOURNAL_BYTES)) {
      throw invalidJournal('journal must be a bounded regular file');
    }
    await afterInspect?.();
    const bytes = await readRootMoveFile(
      projectRoot,
      file,
      MAX_JOURNAL_BYTES,
      'Classic root move journal',
      stat,
    );
    const journal = parseJournal(JSON.parse(bytes.toString('utf8')) as unknown);
    Object.defineProperty(journal, journalClaimBrand, {
      value: {
        fileIdentity: stat,
        contentHash: hashBytes(bytes),
      } satisfies ClassicRootMoveJournalClaim,
      enumerable: false,
    });
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function journalClaim(journal: ClassicRootMoveJournal): ClassicRootMoveJournalClaim {
  const claim = journal[journalClaimBrand];
  if (!claim) throw new Error('Classic root move journal has no ownership claim');
  return claim;
}

function sameJournalOwnership(
  expected: ClassicRootMoveJournal,
  actual: ClassicRootMoveJournal,
): boolean {
  const expectedClaim = journalClaim(expected);
  const actualClaim = journalClaim(actual);
  return (
    sameInspectedFile(expectedClaim.fileIdentity, actualClaim.fileIdentity) &&
    expectedClaim.contentHash === actualClaim.contentHash &&
    expected.schema === actual.schema &&
    expected.id === actual.id &&
    expected.stage === actual.stage &&
    expected.planId === actual.planId
  );
}

async function validateOwnedJournal(
  projectRoot: string,
  expected: ClassicRootMoveJournal,
): Promise<void> {
  const current = await readJournalAtPath(
    projectRoot,
    journalFile(projectRoot),
    JOURNAL_RELATIVE_PATH,
  );
  if (!current || !sameJournalOwnership(expected, current)) {
    throw new Error('Classic root move journal ownership changed');
  }
}

interface QuarantinedClassicRootMoveJournal {
  file: string;
  journal: ClassicRootMoveJournal;
}

async function restoreQuarantinedJournal(
  projectRoot: string,
  quarantine: QuarantinedClassicRootMoveJournal,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<boolean> {
  const file = journalFile(projectRoot);
  try {
    await linkProtectedFileExclusive(
      projectRoot,
      quarantine.file,
      file,
      `${operation}-publish`,
      testHooks,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  const restored = await readJournal(projectRoot);
  if (!restored || !sameJournalOwnership(quarantine.journal, restored)) {
    throw new Error('Classic root move journal ownership changed while restoring quarantine');
  }
  await unlinkProtectedFile(
    projectRoot,
    quarantine.file,
    `${operation}-cleanup-quarantine`,
    testHooks,
    { expectedIdentity: journalClaim(quarantine.journal).fileIdentity },
  );
  return true;
}

async function quarantineOwnedJournal(
  projectRoot: string,
  expected: ClassicRootMoveJournal,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<QuarantinedClassicRootMoveJournal> {
  const file = journalFile(projectRoot);
  const quarantineFile = `${file}.${expected.id}.${randomUUID()}.quarantine`;
  await validateOwnedJournal(projectRoot, expected);
  const parent = await captureProtectedDirectoryChain(
    projectRoot,
    path.dirname(file),
    `Classic root move ${operation} quarantine`,
  );
  await testHooks?.beforeMutation?.(`${operation}-quarantine`);
  await validateProtectedDirectoryChain(parent, `Classic root move ${operation} quarantine`);
  await validateOwnedJournal(projectRoot, expected);
  await fs.rename(file, quarantineFile);
  await validateProtectedDirectoryChain(parent, `Classic root move ${operation} quarantine`);

  const moved = await readJournalAtPath(
    projectRoot,
    quarantineFile,
    projectRelative(projectRoot, quarantineFile),
  ).catch(async (error) => {
    await restoreQuarantinedPath(
      projectRoot,
      quarantineFile,
      `${operation}-restore-unverified`,
      testHooks,
    ).catch(() => false);
    throw new Error('Classic root move journal ownership changed while quarantining', {
      cause: error,
    });
  });
  if (!moved || !sameJournalOwnership(expected, moved)) {
    await restoreQuarantinedPath(
      projectRoot,
      quarantineFile,
      `${operation}-restore-successor`,
      testHooks,
    ).catch(() => false);
    throw new Error('Classic root move journal ownership changed while quarantining');
  }
  await testHooks?.afterJournalQuarantine?.(operation);
  return { file: quarantineFile, journal: moved };
}

async function restoreQuarantinedPath(
  projectRoot: string,
  quarantineFile: string,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<boolean> {
  const file = journalFile(projectRoot);
  let identity: BigIntStats;
  try {
    identity = await captureMutationObject(
      quarantineFile,
      'file',
      `Classic root move ${operation}`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    await linkProtectedFileExclusive(
      projectRoot,
      quarantineFile,
      file,
      `${operation}-publish`,
      testHooks,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  await unlinkProtectedFile(
    projectRoot,
    quarantineFile,
    `${operation}-cleanup-quarantine`,
    testHooks,
    { expectedIdentity: identity },
  );
  return true;
}

async function unlinkOwnedJournal(
  projectRoot: string,
  journal: ClassicRootMoveJournal,
  operation: string,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<boolean> {
  const quarantine = await quarantineOwnedJournal(projectRoot, journal, operation, testHooks);
  try {
    const removed = await unlinkProtectedFile(
      projectRoot,
      quarantine.file,
      `${operation}-quarantined`,
      testHooks,
      { expectedIdentity: journalClaim(quarantine.journal).fileIdentity },
    );
    if (!removed) {
      throw new Error('Classic root move quarantined journal disappeared before removal');
    }
    return true;
  } catch (error) {
    await restoreQuarantinedJournal(
      projectRoot,
      quarantine,
      `${operation}-restore`,
      testHooks,
    ).catch(() => false);
    throw error;
  }
}

async function updateJournal(
  projectRoot: string,
  journal: ClassicRootMoveJournal,
  stage: ClassicRootMoveJournal['stage'],
  testHooks?: ClassicRootMoveTestHooks,
): Promise<ClassicRootMoveJournal> {
  if (journal.schema === 'comet.classic-root-move.v1' && stage === 'locked') {
    throw new Error('Legacy Classic root move journals do not support the locked stage');
  }
  const updated = { ...journal, stage } as ClassicRootMoveJournal;
  return atomicWriteJournal(projectRoot, journal, updated, testHooks);
}

function transactionPaths(projectRoot: string, journal: ClassicRootMoveJournal) {
  const layouts = {
    legacy: classicLayoutPaths(projectRoot, 'legacy'),
    docs: classicLayoutPaths(projectRoot, 'docs'),
  };
  const transactionRoot = path.join(
    projectRoot,
    '.comet',
    'transactions',
    'classic-root-move',
    journal.id,
  );
  return {
    source: layouts.legacy.openSpecRoot,
    target: layouts.docs.openSpecRoot,
    staging: path.join(transactionRoot, 'openspec'),
    quarantine: path.join(transactionRoot, 'legacy-source'),
    transactionRoot,
  };
}

type TreeStatus = 'missing' | 'match' | 'mismatch';
type TargetTreeStatus = TreeStatus | 'empty';

async function treeStatus(
  projectRoot: string,
  root: string,
  manifest: ClassicRootMoveManifest,
): Promise<TreeStatus> {
  if (!(await protectedDirectoryExists(projectRoot, root, 'Classic root move tree'))) {
    return 'missing';
  }
  try {
    return sameManifest(await scanTree(projectRoot, root), manifest) ? 'match' : 'mismatch';
  } catch {
    return 'mismatch';
  }
}

async function targetTreeStatus(
  projectRoot: string,
  root: string,
  manifest: ClassicRootMoveManifest,
): Promise<TargetTreeStatus> {
  if (!(await protectedDirectoryExists(projectRoot, root, 'Classic root move target'))) {
    return 'missing';
  }
  try {
    const actual = await scanTree(projectRoot, root);
    if (sameManifest(actual, manifest)) return 'match';
    if (actual.directories.length === 0 && actual.files.length === 0) return 'empty';
    return 'mismatch';
  } catch {
    return 'mismatch';
  }
}

type ManifestSubsetStatus = 'missing' | 'complete' | 'partial' | 'mismatch';

async function manifestSubsetStatus(
  projectRoot: string,
  root: string,
  manifest: ClassicRootMoveManifest,
): Promise<{ status: ManifestSubsetStatus; actual?: ClassicRootMoveManifest }> {
  if (!(await protectedDirectoryExists(projectRoot, root, 'Classic root move manifest tree'))) {
    return { status: 'missing' };
  }
  try {
    const actual = await scanTree(projectRoot, root);
    if (sameManifest(actual, manifest)) return { status: 'complete', actual };
    const expectedDirectories = new Set(manifest.directories);
    const expectedFiles = new Map(manifest.files.map((file) => [file.path, file]));
    if (actual.directories.some((directory) => !expectedDirectories.has(directory))) {
      return { status: 'mismatch' };
    }
    for (const file of actual.files) {
      const expected = expectedFiles.get(file.path);
      if (!expected || expected.size !== file.size || expected.hash !== file.hash) {
        return { status: 'mismatch' };
      }
    }
    return { status: 'partial', actual };
  } catch {
    return { status: 'mismatch' };
  }
}

async function cleanupManifestBoundTree(
  projectRoot: string,
  root: string,
  manifest: ClassicRootMoveManifest,
  testHooks?: ClassicRootMoveTestHooks,
  operationPrefix = 'remove-quarantine',
): Promise<void> {
  const inspection = await manifestSubsetStatus(projectRoot, root, manifest);
  if (inspection.status === 'missing') return;
  if (inspection.status === 'mismatch' || !inspection.actual) {
    throw new Error('Classic quarantine contains unknown or changed content; files were preserved');
  }
  // The whole remaining tree is validated as a manifest subset before the
  // first unlink. Each file is then revalidated immediately before removal.
  for (const file of inspection.actual.files) {
    const absolute = path.join(root, ...file.path.split('/'));
    let stat: BigIntStats;
    try {
      stat = await fs.lstat(absolute, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const bytes =
      stat.isFile() && !stat.isSymbolicLink()
        ? await readRootMoveFile(
            projectRoot,
            absolute,
            Math.max(1, file.size),
            `Classic root move quarantine file ${file.path}`,
            stat,
          )
        : null;
    if (!bytes || bytes.byteLength !== file.size || hashBytes(bytes) !== file.hash) {
      throw new Error(
        'Classic quarantine contains unknown or changed content; files were preserved',
      );
    }
    await unlinkProtectedFile(
      projectRoot,
      absolute,
      `${operationPrefix}-file:${file.path}`,
      testHooks,
    );
  }
  const directories = [...inspection.actual.directories].sort((left, right) => {
    const depth = right.split('/').length - left.split('/').length;
    return depth === 0 ? right.localeCompare(left) : depth;
  });
  for (const directory of directories) {
    const absolute = path.join(root, ...directory.split('/'));
    await removeProtectedEmptyDirectory(
      projectRoot,
      absolute,
      `${operationPrefix}-directory:${directory}`,
      testHooks,
    );
  }
  await removeProtectedEmptyDirectory(projectRoot, root, `${operationPrefix}-root`, testHooks);
}

async function consumeBoundEmptyTarget(
  projectRoot: string,
  target: string,
  journal: ClassicRootMoveJournal,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  const state = await targetTreeStatus(projectRoot, target, journal.manifest);
  if (journal.targetInitialState === 'missing') {
    if (state !== 'missing') {
      throw new Error('Classic docs target changed after migration preflight');
    }
    return;
  }
  if (state === 'empty') {
    if (journal.schema === 'comet.classic-root-move.v2' && !journal.targetInitialIdentity) {
      throw new Error('Classic docs target identity is missing from the approved plan');
    }
    await removeProtectedEmptyDirectory(
      projectRoot,
      target,
      'remove-empty-target',
      testHooks,
      journal.schema === 'comet.classic-root-move.v2'
        ? (journal.targetInitialIdentity ?? undefined)
        : undefined,
    );
    return;
  }
  if (state !== 'missing') {
    throw new Error('Classic docs target changed after migration preflight');
  }
}

async function assertBoundSourceIdentity(
  projectRoot: string,
  source: string,
  journal: ClassicRootMoveJournal,
): Promise<void> {
  if (journal.schema === 'comet.classic-root-move.v1') return;
  const current = await captureStableSourceIdentity(
    projectRoot,
    source,
    'Classic legacy root identity',
  );
  if (!sameStableChain(current, journal.sourceIdentity)) {
    throw new Error('Classic legacy root identity changed after migration preflight');
  }
}

async function assertOriginalConfig(projectRoot: string, journal: ClassicRootMoveJournal) {
  if ((await projectConfigHash(projectRoot)) !== journal.originalConfigHash) {
    throw new Error('Classic project config changed after migration preflight');
  }
  if ((await readClassicArtifactLayout(projectRoot)) !== 'legacy') {
    throw new Error('Classic project config changed after migration preflight');
  }
}

async function assertExpectedConfig(projectRoot: string, journal: ClassicRootMoveJournal) {
  if ((await projectConfigHash(projectRoot)) !== journal.expectedConfigHash) {
    throw new Error('Classic project config does not match the expected post-switch config hash');
  }
  if ((await readClassicArtifactLayout(projectRoot)) !== 'docs') {
    throw new Error('Classic project config does not match the expected post-switch config hash');
  }
}

async function assertTreeMatches(
  projectRoot: string,
  root: string,
  manifest: ClassicRootMoveManifest,
  message: string,
): Promise<void> {
  if ((await treeStatus(projectRoot, root, manifest)) !== 'match') throw new Error(message);
}

async function finishJournal(
  projectRoot: string,
  journal: ClassicRootMoveJournal,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  if (journal.stage === 'locked') {
    throw new Error('Classic root move locked preflight must be approved before execution');
  }
  await assertRootMovePreflightBoundaries(projectRoot, journal.id);
  const { source, target, staging, quarantine, transactionRoot } = transactionPaths(
    projectRoot,
    journal,
  );
  let current = journal;

  if (current.stage === 'copying') {
    await assertOriginalConfig(projectRoot, current);
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      'Classic legacy root changed after migration preflight',
    );
    await consumeBoundEmptyTarget(projectRoot, target, current, testHooks);
    const staged = await treeStatus(projectRoot, staging, current.manifest);
    if (staged === 'mismatch') {
      throw new Error('Classic root move staging changed after migration preflight');
    }
    if (staged === 'missing') {
      await copyManifest(projectRoot, source, staging, current.manifest, testHooks);
    }
    await assertTreeMatches(
      projectRoot,
      staging,
      current.manifest,
      'Classic root move staging verification failed',
    );
    current = await updateJournal(projectRoot, current, 'ready', testHooks);
  }

  if (current.stage === 'ready') {
    await assertOriginalConfig(projectRoot, current);
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      'Classic legacy root changed after migration preflight',
    );
    const staged = await treeStatus(projectRoot, staging, current.manifest);
    const targetState = await targetTreeStatus(projectRoot, target, current.manifest);
    if (staged === 'missing' && targetState === 'match') {
      current = await updateJournal(projectRoot, current, 'switched', testHooks);
    } else {
      if (staged !== 'match') {
        throw new Error('Classic root move staging changed after migration preflight');
      }
      if (targetState === 'mismatch' || targetState === 'empty') {
        throw new Error('Classic docs target changed after migration preflight');
      }
      if (targetState === 'missing') {
        await ensureRootMoveDirectory(
          projectRoot,
          path.dirname(target),
          'Classic docs target parent',
          testHooks,
        );
        await renameProtectedPath(projectRoot, staging, target, 'rename-staging-target', testHooks);
        current = await updateJournal(projectRoot, current, 'switched', testHooks);
      }
    }
  }

  if (current.stage === 'switched') {
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      'Classic legacy root changed before config switch',
    );
    await assertTreeMatches(
      projectRoot,
      target,
      current.manifest,
      'Classic docs target verification failed after switch',
    );
    const layout = await readClassicArtifactLayout(projectRoot);
    if (layout === 'legacy') {
      await assertOriginalConfig(projectRoot, current);
      await writeClassicArtifactLayout(projectRoot, 'docs', {
        expectedIdentity: {
          exists: true,
          sha256: current.originalConfigHash,
        },
      });
    } else if (layout !== 'docs') {
      throw new Error('Classic project config changed after migration preflight');
    }
    await assertExpectedConfig(projectRoot, current);
    current = await updateJournal(projectRoot, current, 'configured', testHooks);
  }

  if (current.stage !== 'configured') {
    throw new Error(`Unsupported Classic root move stage: ${current.stage}`);
  }
  await assertExpectedConfig(projectRoot, current);
  await assertTreeMatches(
    projectRoot,
    target,
    current.manifest,
    'Classic docs target verification failed after config switch',
  );
  if (await protectedDirectoryExists(projectRoot, source, 'Classic legacy root')) {
    await assertBoundSourceIdentity(projectRoot, source, current);
    await assertTreeMatches(
      projectRoot,
      source,
      current.manifest,
      'Classic legacy root changed before cleanup; both roots were preserved',
    );
    if (await protectedDirectoryExists(projectRoot, quarantine, 'Classic root move quarantine')) {
      throw new Error('Classic root move quarantine conflicts with the legacy root');
    }
    await renameProtectedPath(
      projectRoot,
      source,
      quarantine,
      'rename-source-quarantine',
      testHooks,
    );
  }
  if (await protectedDirectoryExists(projectRoot, quarantine, 'Classic root move quarantine')) {
    await cleanupManifestBoundTree(projectRoot, quarantine, current.manifest, testHooks);
  }
  await removeProtectedEmptyDirectory(
    projectRoot,
    transactionRoot,
    'remove-transaction-root',
    testHooks,
  );
  await unlinkOwnedJournal(projectRoot, current, 'remove-journal', testHooks);
}

async function rollbackJournal(
  projectRoot: string,
  journal: ClassicRootMoveJournal,
  testHooks?: ClassicRootMoveTestHooks,
): Promise<void> {
  await assertRootMovePreflightBoundaries(projectRoot, journal.id);
  if (journal.stage === 'locked') {
    await unlinkOwnedJournal(projectRoot, journal, 'rollback-remove-locked-journal', testHooks);
    return;
  }
  const { source, target, staging, quarantine, transactionRoot } = transactionPaths(
    projectRoot,
    journal,
  );
  if (
    journal.stage === 'configured' ||
    (await readClassicArtifactLayout(projectRoot)) !== 'legacy'
  ) {
    throw new Error('Classic root move cannot roll back after the config switch');
  }
  await assertOriginalConfig(projectRoot, journal);
  await assertTreeMatches(
    projectRoot,
    source,
    journal.manifest,
    'Classic legacy root changed after migration preflight',
  );
  if (
    (await manifestSubsetStatus(projectRoot, quarantine, journal.manifest)).status !== 'missing'
  ) {
    throw new Error('Classic root move quarantine exists; rollback is not proven safe');
  }
  for (const [directory, label] of [[staging, 'staging']] as const) {
    const status = await treeStatus(projectRoot, directory, journal.manifest);
    if (status === 'mismatch') {
      throw new Error(`Classic root move ${label} changed after migration preflight`);
    }
    if (status === 'match') {
      await cleanupManifestBoundTree(
        projectRoot,
        directory,
        journal.manifest,
        testHooks,
        `rollback-remove-${label}`,
      );
    }
  }
  const targetState = await targetTreeStatus(projectRoot, target, journal.manifest);
  if (
    targetState === 'mismatch' ||
    (targetState === 'empty' && journal.targetInitialState !== 'empty')
  ) {
    throw new Error('Classic root move docs target changed after migration preflight');
  }
  if (targetState === 'match') {
    await cleanupManifestBoundTree(
      projectRoot,
      target,
      journal.manifest,
      testHooks,
      'rollback-remove-target',
    );
  }
  if (journal.targetInitialState === 'empty' && targetState !== 'empty') {
    await ensureRootMoveDirectory(projectRoot, target, 'Classic docs rollback target', testHooks);
  }
  await removeProtectedEmptyDirectory(
    projectRoot,
    transactionRoot,
    'rollback-remove-transaction-root',
    testHooks,
  );
  await unlinkOwnedJournal(projectRoot, journal, 'rollback-remove-journal', testHooks);
}

async function recoveryPolicy(
  projectRoot: string,
  journal: ClassicRootMoveJournal,
): Promise<{ allowedStrategies: ClassicRootMoveRecoveryStrategy[]; reason?: string }> {
  await assertRootMovePreflightBoundaries(projectRoot, journal.id);
  if (journal.stage === 'locked') {
    return {
      allowedStrategies: ['rollback'],
      reason: 'the locked apply preflight was not approved for execution',
    };
  }
  const { source, target, staging, quarantine } = transactionPaths(projectRoot, journal);
  const layout = await readClassicArtifactLayout(projectRoot);
  const currentConfigHash = await projectConfigHash(projectRoot);
  const originalConfigMatches =
    layout === 'legacy' && currentConfigHash === journal.originalConfigHash;
  const expectedConfigMatches =
    layout === 'docs' && currentConfigHash === journal.expectedConfigHash;
  const [sourceState, targetState, stagingState, quarantineInspection] = await Promise.all([
    treeStatus(projectRoot, source, journal.manifest),
    targetTreeStatus(projectRoot, target, journal.manifest),
    treeStatus(projectRoot, staging, journal.manifest),
    manifestSubsetStatus(projectRoot, quarantine, journal.manifest),
  ]);
  const quarantineState = quarantineInspection.status;
  if (sourceState === 'mismatch') {
    return {
      allowedStrategies: [],
      reason: 'Classic legacy root changed after migration preflight',
    };
  }
  if (targetState === 'mismatch') {
    return {
      allowedStrategies: [],
      reason: 'Classic docs target changed after migration preflight',
    };
  }
  if (stagingState === 'mismatch') {
    return { allowedStrategies: [], reason: 'Classic staging changed after migration preflight' };
  }
  if (quarantineState === 'mismatch') {
    return {
      allowedStrategies: [],
      reason: 'Classic quarantine contains unknown or changed content',
    };
  }
  if (journal.stage === 'configured' || layout === 'docs') {
    if (!expectedConfigMatches) {
      return {
        allowedStrategies: [],
        reason: 'project config does not match the expected post-switch config hash',
      };
    }
    const sourceRecoverable =
      (sourceState === 'match' && quarantineState === 'missing') ||
      (sourceState === 'missing' &&
        (quarantineState === 'missing' ||
          quarantineState === 'complete' ||
          quarantineState === 'partial'));
    return targetState === 'match' && sourceRecoverable
      ? { allowedStrategies: ['continue'] }
      : { allowedStrategies: [], reason: 'the configured migration trees are incomplete' };
  }
  if (!originalConfigMatches) {
    return {
      allowedStrategies: [],
      reason: 'project config changed after migration preflight',
    };
  }
  const sourceMatches = sourceState === 'match';
  const stagedOrAbsent = stagingState === 'match' || stagingState === 'missing';
  const targetOrAbsent =
    targetState === 'match' ||
    targetState === 'missing' ||
    (journal.targetInitialState === 'empty' && targetState === 'empty');
  if (!sourceMatches || !stagedOrAbsent || !targetOrAbsent || quarantineState !== 'missing') {
    return { allowedStrategies: [], reason: 'the migration trees are not recoverable' };
  }
  return { allowedStrategies: ['continue', 'rollback'] };
}

export async function planClassicRootMove(
  startPath: string,
  options: ClassicRootMoveOptions = {},
): Promise<ClassicRootMovePlan> {
  const projectRoot = await discoverClassicProject(startPath);
  const journal = await readJournal(projectRoot, options.testHooks);
  if (journal) {
    const pendingRecovery = await inspectClassicRootMove(projectRoot);
    if (!pendingRecovery)
      throw new Error('Classic root move journal disappeared during inspection');
    return {
      projectRoot,
      source: journal.source,
      target: journal.target,
      staging: journal.staging,
      artifactLayout: 'legacy',
      sourceIdentity:
        journal.schema === 'comet.classic-root-move.v2'
          ? journal.sourceIdentity.map((identity) => ({ ...identity }))
          : [],
      targetInitialIdentity:
        journal.schema === 'comet.classic-root-move.v2' && journal.targetInitialIdentity
          ? { ...journal.targetInitialIdentity }
          : null,
      fileCount: journal.manifest.files.length,
      directoryCount: journal.manifest.directories.length,
      totalBytes: journal.manifest.totalBytes,
      manifestHash: journal.manifest.hash,
      configPath: journal.configPath,
      configHash: journal.originalConfigHash,
      originalConfigHash: journal.originalConfigHash,
      expectedConfigHash: journal.expectedConfigHash,
      planId: journal.planId,
      fileSummary: journal.manifest.files.map((file) => ({ ...file })),
      configChange: { from: 'legacy', to: 'docs' },
      conflicts: pendingRecovery.reason ? [pendingRecovery.reason] : [],
      blockers: [`pending Classic root move: ${journal.id} at ${journal.stage}`],
      pendingRecovery,
      historicalPointersPreserved: [...HISTORICAL_POINTERS_PRESERVED],
      applyPreconditions: [...APPLY_PRECONDITIONS],
      allowedRecoveryStrategies: [...pendingRecovery.allowedStrategies],
      targetInitialState: journal.targetInitialState,
      readyToApply: false,
    };
  }
  return (await preflight(projectRoot, options)).plan;
}

export async function applyClassicRootMove(
  startPath: string,
  options: ClassicRootMoveOptions = {},
): Promise<ClassicRootMovePlan> {
  const projectRoot = await discoverClassicProject(startPath);
  const existing = await readJournal(projectRoot, options.testHooks);
  if (existing) {
    throw new Error(
      `Classic root move ${existing.id} is incomplete; use comet doctor --repair --strategy continue|rollback`,
    );
  }
  // This pass only provides a structurally valid journal for the exclusive
  // lock. The caller-approved plan is checked again after that lock exists.
  const initial = await preflight(projectRoot);
  const approvedPlanId = options.planId ?? initial.plan.planId;
  if (!HASH_PATTERN.test(approvedPlanId)) {
    throw new Error('Classic root move apply received an invalid internal plan ID');
  }
  const id = randomUUID();
  await assertRootMovePreflightBoundaries(projectRoot, id);
  const lockedJournal: ClassicRootMoveJournal = {
    schema: 'comet.classic-root-move.v2',
    id,
    stage: 'locked',
    source: initial.plan.source,
    target: initial.plan.target,
    staging: `.comet/transactions/classic-root-move/${id}/openspec`,
    artifactLayout: initial.plan.artifactLayout,
    sourceIdentity: initial.plan.sourceIdentity.map((identity) => ({ ...identity })),
    targetInitialIdentity: initial.plan.targetInitialIdentity
      ? { ...initial.plan.targetInitialIdentity }
      : null,
    configPath: WORKFLOW_PROJECT_CONFIG_PATH,
    originalConfigHash: initial.plan.originalConfigHash,
    expectedConfigHash: initial.plan.expectedConfigHash,
    planId: initial.plan.planId,
    approvedPlanId,
    targetInitialState: initial.plan.targetInitialState,
    manifest: initial.manifest,
  };
  await createJsonExclusive(
    projectRoot,
    journalFile(projectRoot),
    lockedJournal,
    options.testHooks,
  );
  const ownedLock = await readJournal(projectRoot);
  if (!ownedLock || ownedLock.id !== id || ownedLock.stage !== 'locked') {
    throw new Error('Classic root move lock ownership changed before locked preflight');
  }

  let executionStarted = false;
  try {
    const lockedPreflight = await preflight(projectRoot, options);
    const plan = lockedPreflight.plan;
    if (plan.planId !== approvedPlanId) {
      throw new Error(
        `Classic root move plan changed since dry-run: approved ${approvedPlanId}, current ${plan.planId}`,
      );
    }
    if (!plan.readyToApply) {
      throw new Error(
        `Classic root move apply is blocked: ${[...plan.conflicts, ...plan.blockers].join('; ')}`,
      );
    }
    if (plan.targetInitialState === 'non-empty') {
      throw new Error('Classic root move apply is blocked: Classic docs target is not empty');
    }
    const journal: ClassicRootMoveJournal = {
      schema: 'comet.classic-root-move.v2',
      id,
      stage: 'copying',
      source: plan.source,
      target: plan.target,
      staging: `.comet/transactions/classic-root-move/${id}/openspec`,
      artifactLayout: plan.artifactLayout,
      sourceIdentity: plan.sourceIdentity.map((identity) => ({ ...identity })),
      targetInitialIdentity: plan.targetInitialIdentity ? { ...plan.targetInitialIdentity } : null,
      configPath: WORKFLOW_PROJECT_CONFIG_PATH,
      originalConfigHash: plan.originalConfigHash,
      expectedConfigHash: plan.expectedConfigHash,
      planId: plan.planId,
      approvedPlanId,
      targetInitialState: plan.targetInitialState,
      manifest: lockedPreflight.manifest,
    };
    const ownedJournal = await atomicWriteJournal(
      projectRoot,
      ownedLock,
      journal,
      options.testHooks,
    );
    executionStarted = true;
    await finishJournal(projectRoot, ownedJournal, options.testHooks);
    return { ...plan, staging: journal.staging };
  } catch (error) {
    if (!executionStarted) {
      await unlinkOwnedJournal(
        projectRoot,
        ownedLock,
        'remove-rejected-lock',
        options.testHooks,
      ).catch(() => false);
    }
    throw error;
  }
}

export async function repairClassicRootMove(
  projectRoot: string,
  strategy?: ClassicRootMoveRecoveryStrategy,
  options: ClassicRootMoveOptions = {},
): Promise<boolean> {
  const journal = await readJournal(projectRoot, options.testHooks);
  if (!journal) return false;
  if (!strategy) {
    throw new Error(
      `Classic root move ${journal.id} recovery strategy is required: continue or rollback`,
    );
  }
  const policy = await recoveryPolicy(projectRoot, journal);
  if (!policy.allowedStrategies.includes(strategy)) {
    throw new Error(
      `Classic root move ${journal.id} does not allow ${strategy}: ${
        policy.reason ?? 'the persisted state is not safe for that strategy'
      }`,
    );
  }
  if (strategy === 'continue') await finishJournal(projectRoot, journal, options.testHooks);
  else await rollbackJournal(projectRoot, journal, options.testHooks);
  return true;
}

export async function inspectClassicRootMove(
  projectRoot: string,
  options: ClassicRootMoveOptions = {},
): Promise<ClassicRootMoveInspection | null> {
  const journal = await readJournal(projectRoot, options.testHooks);
  if (!journal) return null;
  const policy = await recoveryPolicy(projectRoot, journal);
  return {
    id: journal.id,
    stage: journal.stage,
    source: journal.source,
    target: journal.target,
    staging: journal.staging,
    planId: journal.planId,
    ...policy,
  };
}
