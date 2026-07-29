import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { BigIntStats } from 'fs';
import path from 'path';

import { atomicWriteContainedJson } from '../workflow-contract/contained-atomic-write.js';
import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  type WorkflowProjectConfigIdentity,
} from '../workflow-contract/project-config-reader.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  assertClassicLayoutWritable,
  classicLayoutPaths,
  classicProjectRelative,
  type ClassicArtifactLayout,
  type ClassicLayoutPaths,
} from './classic-layout.js';

const ROOT_MOVE_JOURNAL = '.comet/classic-root-move.json';
const INIT_OWNERSHIP_JOURNAL = '.comet/classic-init-ownership.json';
const INIT_OWNERSHIP_MAX_BYTES = 16 * 1024 * 1024;
const INIT_OWNERSHIP_MAX_FILES = 50_000;
const INIT_OWNERSHIP_MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const initializationPermitBrand = Symbol('ClassicLayoutInitializationPermit');
const ownershipClaimBrand = Symbol('ClassicInitOwnershipClaim');

interface ClassicInitObjectIdentity {
  dev: string;
  ino: string;
  birthtime: string;
  ctime: string;
}

interface ClassicInitManifestFile {
  path: string;
  size: number;
  hash: string;
  identity: ClassicInitObjectIdentity;
}

interface ClassicInitManifest {
  directories: string[];
  files: ClassicInitManifestFile[];
  totalBytes: number;
  hash: string;
}

interface ClassicInitOwnershipJournal {
  schema: 'comet.classic-init-ownership.v1';
  id: string;
  stage: 'initializing' | 'quarantining' | 'quarantined';
  artifactLayout: ClassicArtifactLayout;
  root: 'openspec' | 'docs/openspec';
  quarantine: string | null;
  configIdentity: WorkflowProjectConfigIdentity;
  rootIdentity: ClassicInitObjectIdentity | null;
  manifest: ClassicInitManifest | null;
  readonly [ownershipClaimBrand]?: ClassicInitOwnershipClaim;
}

interface ClassicInitOwnershipClaim {
  fileIdentity: BigIntStats;
  contentHash: string;
}

interface ClassicInitTestHooks {
  afterJournalQuarantine?: (operation: string) => void | Promise<void>;
  afterRootQuarantine?: (quarantine: string) => void | Promise<void>;
}

interface ClassicInitOperationOptions {
  testHooks?: ClassicInitTestHooks;
}

export interface ClassicLayoutInitializationPermit {
  readonly projectRoot: string;
  readonly artifactLayout: ClassicArtifactLayout;
  readonly configIdentity: WorkflowProjectConfigIdentity;
  readonly ownershipId?: string;
  readonly [initializationPermitBrand]: true;
}

export interface ClassicLayoutInitialization extends ClassicLayoutPaths {
  readonly initializationPermit: ClassicLayoutInitializationPermit;
}

function permitsDesiredRoot(
  permit: ClassicLayoutInitializationPermit | undefined,
  projectRoot: string,
  desiredLayout: ClassicArtifactLayout,
): permit is ClassicLayoutInitializationPermit {
  return (
    permit?.[initializationPermitBrand] === true &&
    permit.projectRoot === projectRoot &&
    permit.artifactLayout === desiredLayout
  );
}

function initializationPermit(
  projectRoot: string,
  artifactLayout: ClassicArtifactLayout,
  configIdentity: WorkflowProjectConfigIdentity,
  ownershipId?: string,
): ClassicLayoutInitializationPermit {
  return {
    projectRoot,
    artifactLayout,
    configIdentity,
    ...(ownershipId ? { ownershipId } : {}),
    [initializationPermitBrand]: true,
  };
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function manifestHash(manifest: Omit<ClassicInitManifest, 'hash'>): string {
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

function objectIdentity(stat: import('fs').BigIntStats): ClassicInitObjectIdentity {
  if (stat.dev === 0n || stat.ino === 0n) {
    throw new Error(
      'Classic init ownership requires a filesystem with stable device and file identities',
    );
  }
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtime: String(stat.birthtimeNs),
    ctime: String(stat.ctimeNs),
  };
}

function sameObjectIdentity(
  left: ClassicInitObjectIdentity,
  right: ClassicInitObjectIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtime === right.birthtime;
}

function sameCheckpointIdentity(
  left: ClassicInitObjectIdentity,
  right: ClassicInitObjectIdentity,
): boolean {
  return sameObjectIdentity(left, right) && left.ctime === right.ctime;
}

function safeManifestPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid Classic init ownership journal: ${label} is unsafe`);
  }
  return value;
}

function parseManifest(value: unknown): ClassicInitManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic init ownership journal: manifest is invalid');
  }
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.directories) ||
    !Array.isArray(raw.files) ||
    !Number.isSafeInteger(raw.totalBytes) ||
    (raw.totalBytes as number) < 0 ||
    (raw.totalBytes as number) > INIT_OWNERSHIP_MAX_TOTAL_BYTES ||
    typeof raw.hash !== 'string' ||
    !HASH_PATTERN.test(raw.hash)
  ) {
    throw new Error('Invalid Classic init ownership journal: manifest shape is invalid');
  }
  const directories = raw.directories.map((entry, index) =>
    safeManifestPath(entry, `directories[${index}]`),
  );
  const files = raw.files.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Invalid Classic init ownership journal: files[${index}] is invalid`);
    }
    const file = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(file.size) ||
      (file.size as number) < 0 ||
      typeof file.hash !== 'string' ||
      !HASH_PATTERN.test(file.hash)
    ) {
      throw new Error(`Invalid Classic init ownership journal: files[${index}] is invalid`);
    }
    return {
      path: safeManifestPath(file.path, `files[${index}].path`),
      size: file.size as number,
      hash: file.hash,
      identity: parseObjectIdentity(file.identity),
    };
  });
  if (files.length > INIT_OWNERSHIP_MAX_FILES) {
    throw new Error('Invalid Classic init ownership journal: manifest contains too many files');
  }
  if (
    directories.some((entry, index) => index > 0 && directories[index - 1] >= entry) ||
    files.some((entry, index) => index > 0 && files[index - 1].path >= entry.path)
  ) {
    throw new Error('Invalid Classic init ownership journal: manifest paths are not sorted');
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  const normalized = { directories, files, totalBytes };
  if (totalBytes !== raw.totalBytes || manifestHash(normalized) !== raw.hash) {
    throw new Error('Invalid Classic init ownership journal: manifest hash is invalid');
  }
  return { ...normalized, hash: raw.hash };
}

function parseObjectIdentity(value: unknown): ClassicInitObjectIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic init ownership journal: rootIdentity is invalid');
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.dev !== 'string' ||
    raw.dev === '0' ||
    typeof raw.ino !== 'string' ||
    raw.ino === '0' ||
    typeof raw.birthtime !== 'string' ||
    typeof raw.ctime !== 'string'
  ) {
    throw new Error('Invalid Classic init ownership journal: rootIdentity is invalid');
  }
  return { dev: raw.dev, ino: raw.ino, birthtime: raw.birthtime, ctime: raw.ctime };
}

function parseOwnershipJournal(value: unknown): ClassicInitOwnershipJournal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Classic init ownership journal: root is invalid');
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schema !== 'comet.classic-init-ownership.v1' ||
    typeof raw.id !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(raw.id) ||
    !['initializing', 'quarantining', 'quarantined'].includes(String(raw.stage)) ||
    (raw.artifactLayout !== 'legacy' && raw.artifactLayout !== 'docs')
  ) {
    throw new Error('Invalid Classic init ownership journal: identity is invalid');
  }
  const expectedRoot = raw.artifactLayout === 'docs' ? 'docs/openspec' : 'openspec';
  if (raw.root !== expectedRoot) {
    throw new Error('Invalid Classic init ownership journal: root does not match layout');
  }
  if (
    !(
      (raw.stage === 'initializing' && raw.quarantine === null) ||
      ((raw.stage === 'quarantining' || raw.stage === 'quarantined') &&
        typeof raw.quarantine === 'string' &&
        raw.quarantine.startsWith('.comet/transactions/classic-init/'))
    )
  ) {
    throw new Error('Invalid Classic init ownership journal: quarantine does not match stage');
  }
  if (typeof raw.quarantine === 'string') {
    safeManifestPath(raw.quarantine, 'quarantine');
  }
  if (
    !raw.configIdentity ||
    typeof raw.configIdentity !== 'object' ||
    Array.isArray(raw.configIdentity)
  ) {
    throw new Error('Invalid Classic init ownership journal: config identity is invalid');
  }
  const configIdentity = raw.configIdentity as Record<string, unknown>;
  if (
    typeof configIdentity.exists !== 'boolean' ||
    !(
      (configIdentity.exists === false && configIdentity.sha256 === null) ||
      (configIdentity.exists === true &&
        typeof configIdentity.sha256 === 'string' &&
        HASH_PATTERN.test(configIdentity.sha256))
    )
  ) {
    throw new Error('Invalid Classic init ownership journal: config identity is invalid');
  }
  if ((raw.rootIdentity === null) !== (raw.manifest === null)) {
    throw new Error(
      'Invalid Classic init ownership journal: root identity and manifest must be checkpointed together',
    );
  }
  return {
    schema: 'comet.classic-init-ownership.v1',
    id: raw.id,
    stage: raw.stage as ClassicInitOwnershipJournal['stage'],
    artifactLayout: raw.artifactLayout,
    root: expectedRoot,
    quarantine: raw.quarantine as string | null,
    configIdentity: {
      exists: configIdentity.exists,
      sha256: configIdentity.sha256 as string | null,
    },
    rootIdentity: raw.rootIdentity === null ? null : parseObjectIdentity(raw.rootIdentity),
    manifest: raw.manifest === null ? null : parseManifest(raw.manifest),
  };
}

async function readOwnershipJournal(
  projectRoot: string,
): Promise<ClassicInitOwnershipJournal | null> {
  return readOwnershipJournalAtPath(projectRoot, INIT_OWNERSHIP_JOURNAL);
}

async function readOwnershipJournalAtPath(
  projectRoot: string,
  relativePath: string,
): Promise<ClassicInitOwnershipJournal | null> {
  try {
    const { bytes, stat } = await readProtectedProjectFile(
      projectRoot,
      relativePath,
      INIT_OWNERSHIP_MAX_BYTES,
      { label: relativePath, bigint: true },
    );
    const journal = parseOwnershipJournal(JSON.parse(bytes.toString('utf8')) as unknown);
    Object.defineProperty(journal, ownershipClaimBrand, {
      value: {
        fileIdentity: stat as BigIntStats,
        contentHash: hashBytes(bytes),
      } satisfies ClassicInitOwnershipClaim,
      enumerable: false,
    });
    return journal;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function scanOwnedRoot(
  projectRoot: string,
  rootRelative: string,
): Promise<{ identity: ClassicInitObjectIdentity; manifest: ClassicInitManifest }> {
  safeManifestPath(rootRelative, 'root');
  const root = path.join(projectRoot, ...rootRelative.split('/'));
  await inspectProtectedProjectPath(projectRoot, rootRelative, {
    label: 'Classic init owned root',
    expected: 'directory',
  });
  const initial = await fs.lstat(root, { bigint: true });
  if (!initial.isDirectory() || initial.isSymbolicLink()) {
    throw new Error('Classic init owned root must be a real directory');
  }
  const identity = objectIdentity(initial);
  const directories: string[] = [];
  const files: ClassicInitManifestFile[] = [];
  let totalBytes = 0;

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = await fs.lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink()) {
        throw new Error(`Classic init ownership does not support links: ${relative}`);
      }
      if (stat.isDirectory()) {
        directories.push(relative);
        await visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Classic init ownership supports only regular files: ${relative}`);
      }
      if (files.length + 1 > INIT_OWNERSHIP_MAX_FILES) {
        throw new Error('Classic init ownership manifest contains too many files');
      }
      const bytes = await fs.readFile(absolute);
      totalBytes += bytes.byteLength;
      if (totalBytes > INIT_OWNERSHIP_MAX_TOTAL_BYTES) {
        throw new Error('Classic init ownership manifest exceeds its byte budget');
      }
      const current = await fs.lstat(absolute, { bigint: true });
      if (
        !current.isFile() ||
        current.isSymbolicLink() ||
        !sameCheckpointIdentity(objectIdentity(stat), objectIdentity(current)) ||
        current.size !== stat.size
      ) {
        throw new Error(`Classic init owned file changed while reading: ${relative}`);
      }
      files.push({
        path: relative,
        size: bytes.byteLength,
        hash: hashBytes(bytes),
        identity: objectIdentity(stat),
      });
    }
  }

  await visit(root, '');
  directories.sort((left, right) => left.localeCompare(right));
  files.sort((left, right) => left.path.localeCompare(right.path));
  const current = await fs.lstat(root, { bigint: true });
  if (!current.isDirectory() || !sameCheckpointIdentity(identity, objectIdentity(current))) {
    throw new Error('Classic init owned root changed while scanning');
  }
  const normalized = { directories, files, totalBytes };
  return { identity, manifest: { ...normalized, hash: manifestHash(normalized) } };
}

function sameManifest(left: ClassicInitManifest, right: ClassicInitManifest): boolean {
  return left.hash === right.hash && JSON.stringify(left) === JSON.stringify(right);
}

function ownershipJournalFile(projectRoot: string): string {
  return path.join(projectRoot, ...INIT_OWNERSHIP_JOURNAL.split('/'));
}

function ownershipClaim(journal: ClassicInitOwnershipJournal): ClassicInitOwnershipClaim {
  const claim = journal[ownershipClaimBrand];
  if (!claim) throw new Error('Classic init ownership journal has no bound file identity');
  return claim;
}

function sameOwnership(
  expected: ClassicInitOwnershipJournal,
  actual: ClassicInitOwnershipJournal,
): boolean {
  const expectedClaim = ownershipClaim(expected);
  const actualClaim = ownershipClaim(actual);
  return (
    sameObjectIdentity(
      objectIdentity(expectedClaim.fileIdentity),
      objectIdentity(actualClaim.fileIdentity),
    ) &&
    expectedClaim.contentHash === actualClaim.contentHash &&
    expected.id === actual.id &&
    expected.stage === actual.stage
  );
}

async function validateOwnedJournal(
  projectRoot: string,
  expected: ClassicInitOwnershipJournal,
): Promise<void> {
  const current = await readOwnershipJournal(projectRoot);
  if (!current || !sameOwnership(expected, current)) {
    throw new Error('Classic init ownership changed');
  }
}

async function createOwnershipJournal(
  projectRoot: string,
  journal: ClassicInitOwnershipJournal,
): Promise<ClassicInitOwnershipJournal> {
  await ensureProtectedProjectDirectory(projectRoot, '.comet', {
    label: 'Classic init ownership journal parent',
  });
  await atomicWriteContainedJson(ownershipJournalFile(projectRoot), journal, {
    containedRoot: projectRoot,
    exclusive: true,
  });
  const persisted = await readOwnershipJournal(projectRoot);
  if (!persisted || persisted.id !== journal.id || persisted.stage !== journal.stage) {
    throw new Error('Classic init ownership changed while publishing');
  }
  return persisted;
}

interface QuarantinedOwnershipJournal {
  relativePath: string;
  absolutePath: string;
  journal: ClassicInitOwnershipJournal;
}

async function restoreQuarantinedOwnershipPath(
  projectRoot: string,
  quarantine: string,
): Promise<boolean> {
  try {
    await fs.link(quarantine, ownershipJournalFile(projectRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  await fs.unlink(quarantine);
  return true;
}

async function quarantineOwnershipJournal(
  projectRoot: string,
  expected: ClassicInitOwnershipJournal,
  operation: string,
  options: ClassicInitOperationOptions = {},
): Promise<QuarantinedOwnershipJournal> {
  await validateOwnedJournal(projectRoot, expected);
  const relativePath = `.comet/classic-init-ownership.${expected.id}.${randomUUID()}.quarantine`;
  const absolutePath = path.join(projectRoot, ...relativePath.split('/'));
  await fs.rename(ownershipJournalFile(projectRoot), absolutePath);
  const moved = await readOwnershipJournalAtPath(projectRoot, relativePath).catch(async (error) => {
    await restoreQuarantinedOwnershipPath(projectRoot, absolutePath).catch(() => false);
    throw new Error('Classic init ownership changed while entering journal quarantine', {
      cause: error,
    });
  });
  if (!moved || !sameOwnership(expected, moved)) {
    await restoreQuarantinedOwnershipPath(projectRoot, absolutePath).catch(() => false);
    throw new Error('Classic init ownership changed while entering journal quarantine');
  }
  await options.testHooks?.afterJournalQuarantine?.(operation);
  return { relativePath, absolutePath, journal: moved };
}

async function restoreQuarantinedOwnership(
  projectRoot: string,
  quarantine: QuarantinedOwnershipJournal,
): Promise<boolean> {
  await validateOwnedJournalAtPath(projectRoot, quarantine);
  return restoreQuarantinedOwnershipPath(projectRoot, quarantine.absolutePath);
}

async function validateOwnedJournalAtPath(
  projectRoot: string,
  quarantine: QuarantinedOwnershipJournal,
): Promise<void> {
  const current = await readOwnershipJournalAtPath(projectRoot, quarantine.relativePath);
  if (!current || !sameOwnership(quarantine.journal, current)) {
    throw new Error('Classic init quarantined journal ownership changed');
  }
}

async function updateOwnershipJournal(
  projectRoot: string,
  expected: ClassicInitOwnershipJournal,
  updated: ClassicInitOwnershipJournal,
  operation: string,
  options: ClassicInitOperationOptions = {},
): Promise<ClassicInitOwnershipJournal> {
  const temporaryRelative = `.comet/classic-init-ownership.${randomUUID()}.tmp`;
  const temporary = path.join(projectRoot, ...temporaryRelative.split('/'));
  const serialized = JSON.stringify(updated, null, 2) + '\n';
  let quarantine: QuarantinedOwnershipJournal | undefined;
  try {
    await atomicWriteContainedJson(temporary, updated, {
      containedRoot: projectRoot,
      exclusive: true,
    });
    const temporaryStat = await fs.lstat(temporary, { bigint: true });
    quarantine = await quarantineOwnershipJournal(projectRoot, expected, operation, options);
    try {
      await fs.link(temporary, ownershipJournalFile(projectRoot));
    } catch (error) {
      throw new Error('Classic init ownership publish failed; a successor journal was preserved', {
        cause: error,
      });
    }
    const persisted = await readOwnershipJournal(projectRoot);
    const persistedClaim = persisted ? ownershipClaim(persisted) : null;
    if (
      !persisted ||
      persisted.id !== updated.id ||
      persisted.stage !== updated.stage ||
      !persistedClaim ||
      persistedClaim.contentHash !== hashBytes(Buffer.from(serialized)) ||
      !sameObjectIdentity(
        objectIdentity(temporaryStat),
        objectIdentity(persistedClaim.fileIdentity),
      )
    ) {
      throw new Error('Classic init ownership changed while updating');
    }
    await validateOwnedJournalAtPath(projectRoot, quarantine);
    await fs.unlink(quarantine.absolutePath);
    quarantine = undefined;
    return persisted;
  } catch (error) {
    if (quarantine) {
      await restoreQuarantinedOwnership(projectRoot, quarantine).catch(() => false);
    }
    throw error;
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function removeOwnershipJournal(
  projectRoot: string,
  expected: ClassicInitOwnershipJournal,
  options: ClassicInitOperationOptions = {},
): Promise<boolean> {
  const quarantine = await quarantineOwnershipJournal(
    projectRoot,
    expected,
    'remove-journal',
    options,
  );
  await validateOwnedJournalAtPath(projectRoot, quarantine);
  await fs.unlink(quarantine.absolutePath);
  return true;
}

function ownedRootRelative(artifactLayout: ClassicArtifactLayout): 'openspec' | 'docs/openspec' {
  return artifactLayout === 'docs' ? 'docs/openspec' : 'openspec';
}

function assertOwnershipPermit(
  projectRoot: string,
  permit: ClassicLayoutInitializationPermit,
  journal: ClassicInitOwnershipJournal,
): void {
  if (
    permit.projectRoot !== projectRoot ||
    permit.artifactLayout !== journal.artifactLayout ||
    permit.ownershipId !== journal.id
  ) {
    throw new Error('Classic init ownership permit does not match the active initialization');
  }
}

async function assertCheckpointMatches(
  projectRoot: string,
  journal: ClassicInitOwnershipJournal,
): Promise<{ identity: ClassicInitObjectIdentity; manifest: ClassicInitManifest }> {
  if (!journal.rootIdentity || !journal.manifest) {
    throw new Error('Classic init ownership has no completed root checkpoint');
  }
  let current: Awaited<ReturnType<typeof scanOwnedRoot>>;
  try {
    current = await scanOwnedRoot(projectRoot, journal.root);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR'
    ) {
      throw new Error('Classic init root changed after the ownership checkpoint', {
        cause: error,
      });
    }
    throw error;
  }
  if (
    !sameCheckpointIdentity(current.identity, journal.rootIdentity) ||
    !sameManifest(current.manifest, journal.manifest)
  ) {
    throw new Error('Classic init root changed after the ownership checkpoint');
  }
  return current;
}

async function quarantineCheckpointedRoot(
  projectRoot: string,
  journal: ClassicInitOwnershipJournal,
  options: ClassicInitOperationOptions = {},
): Promise<ClassicInitOwnershipJournal> {
  await assertCheckpointMatches(projectRoot, journal);
  const root = path.join(projectRoot, ...journal.root.split('/'));
  const quarantineRelative = `.comet/transactions/classic-init/${journal.id}/openspec`;
  const quarantine = path.join(projectRoot, ...quarantineRelative.split('/'));
  await ensureProtectedProjectDirectory(
    projectRoot,
    `.comet/transactions/classic-init/${journal.id}`,
    { label: 'Classic init rollback quarantine parent' },
  );
  const quarantineInspection = await inspectProtectedProjectPath(projectRoot, quarantineRelative, {
    label: 'Classic init rollback quarantine',
    expected: 'directory',
  });
  if (quarantineInspection.exists) {
    throw new Error(`Classic init rollback quarantine already exists: ${quarantineRelative}`);
  }
  let current = await updateOwnershipJournal(
    projectRoot,
    journal,
    {
      ...journal,
      stage: 'quarantining',
      quarantine: quarantineRelative,
    },
    'begin-root-quarantine',
    options,
  );
  await fs.rename(root, quarantine);
  await options.testHooks?.afterRootQuarantine?.(quarantineRelative);
  const quarantined = await scanOwnedRoot(projectRoot, quarantineRelative);
  if (
    !sameObjectIdentity(quarantined.identity, journal.rootIdentity!) ||
    !sameManifest(quarantined.manifest, journal.manifest!)
  ) {
    throw new Error(
      `Classic init root changed while entering quarantine; content was preserved at ${quarantineRelative}`,
    );
  }
  current = await updateOwnershipJournal(
    projectRoot,
    current,
    {
      ...current,
      stage: 'quarantined',
      quarantine: quarantineRelative,
    },
    'finish-root-quarantine',
    options,
  );
  return current;
}

/**
 * Persist ownership before an external OpenSpec process is allowed to create a
 * previously missing Classic root. Existing roots are never claimed.
 */
export async function beginClassicLayoutInitialization(
  projectRoot: string,
  initialization: ClassicLayoutInitialization,
  options: ClassicInitOperationOptions = {},
): Promise<ClassicLayoutInitialization> {
  const root = path.resolve(projectRoot);
  const permit = initialization.initializationPermit;
  if (
    permit.projectRoot !== root ||
    permit.artifactLayout !== initialization.artifactLayout ||
    initialization.projectRoot !== root
  ) {
    throw new Error('Classic layout initialization does not match the project root');
  }
  const currentConfigIdentity = await readWorkflowProjectConfigIdentity(root);
  if (!workflowProjectConfigIdentityEquals(currentConfigIdentity, permit.configIdentity)) {
    throw new Error('Project config changed before Classic layout initialization began');
  }

  const existingJournal = await readOwnershipJournal(root);
  if (existingJournal) {
    if (!permit.ownershipId) {
      throw new Error('Another Classic layout initialization is already in progress');
    }
    assertOwnershipPermit(root, permit, existingJournal);
    if (existingJournal.stage !== 'initializing') {
      throw new Error(
        `Classic init ownership is ${existingJournal.stage}; recover it with comet doctor before continuing`,
      );
    }
    return initialization;
  }
  if (permit.ownershipId) {
    throw new Error('Classic init ownership journal is missing');
  }

  const rootRelative = ownedRootRelative(initialization.artifactLayout);
  const rootInspection = await inspectProtectedProjectPath(root, rootRelative, {
    label: 'Classic init root before ownership',
    expected: 'directory',
  });
  if (rootInspection.exists) return initialization;

  const journal: ClassicInitOwnershipJournal = {
    schema: 'comet.classic-init-ownership.v1',
    id: randomUUID(),
    stage: 'initializing',
    artifactLayout: initialization.artifactLayout,
    root: rootRelative,
    quarantine: null,
    configIdentity: currentConfigIdentity,
    rootIdentity: null,
    manifest: null,
  };
  const ownedJournal = await createOwnershipJournal(root, journal);
  const afterOwnership = await inspectProtectedProjectPath(root, rootRelative, {
    label: 'Classic init root after ownership',
    expected: 'directory',
  });
  if (afterOwnership.exists) {
    await removeOwnershipJournal(root, ownedJournal, options).catch(() => false);
    throw new Error('Classic init root appeared while ownership was being established');
  }
  return {
    ...initialization,
    initializationPermit: initializationPermit(
      root,
      initialization.artifactLayout,
      currentConfigIdentity,
      journal.id,
    ),
  };
}

/**
 * Bind the current root object and exact contents to the durable ownership
 * journal. Rollback is allowed only while this checkpoint remains unchanged.
 */
export async function checkpointClassicLayoutInitialization(
  projectRoot: string,
  permit: ClassicLayoutInitializationPermit,
  options: ClassicInitOperationOptions = {},
): Promise<boolean> {
  if (!permit.ownershipId) return false;
  const root = path.resolve(projectRoot);
  const journal = await readOwnershipJournal(root);
  if (!journal) throw new Error('Classic init ownership journal is missing');
  assertOwnershipPermit(root, permit, journal);
  if (journal.stage !== 'initializing') {
    throw new Error(`Classic init ownership cannot checkpoint from ${journal.stage}`);
  }
  const currentConfigIdentity = await readWorkflowProjectConfigIdentity(root);
  if (!workflowProjectConfigIdentityEquals(currentConfigIdentity, journal.configIdentity)) {
    throw new Error('Project config changed during Classic layout initialization');
  }
  const checkpoint = await scanOwnedRoot(root, journal.root);
  if (journal.rootIdentity && !sameObjectIdentity(journal.rootIdentity, checkpoint.identity)) {
    throw new Error('Classic init root changed after the ownership checkpoint');
  }
  const persisted = await updateOwnershipJournal(
    root,
    journal,
    {
      ...journal,
      rootIdentity: checkpoint.identity,
      manifest: checkpoint.manifest,
    },
    'checkpoint-journal',
    options,
  );
  if (
    !persisted ||
    persisted.id !== journal.id ||
    !persisted.rootIdentity ||
    !persisted.manifest ||
    !sameCheckpointIdentity(persisted.rootIdentity, checkpoint.identity) ||
    !sameManifest(persisted.manifest, checkpoint.manifest)
  ) {
    throw new Error('Classic init ownership changed while checkpointing');
  }
  return true;
}

export async function completeClassicLayoutInitialization(
  projectRoot: string,
  permit: ClassicLayoutInitializationPermit,
  options: ClassicInitOperationOptions = {},
): Promise<boolean> {
  if (!permit.ownershipId) return false;
  const root = path.resolve(projectRoot);
  const journal = await readOwnershipJournal(root);
  if (!journal) return false;
  assertOwnershipPermit(root, permit, journal);
  if (journal.stage !== 'initializing') {
    throw new Error(`Classic init ownership cannot complete from ${journal.stage}`);
  }
  await assertCheckpointMatches(root, journal);
  return removeOwnershipJournal(root, journal, options);
}

export async function rollbackClassicLayoutInitialization(
  projectRoot: string,
  permit: ClassicLayoutInitializationPermit,
  options: ClassicInitOperationOptions = {},
): Promise<boolean> {
  if (!permit.ownershipId) return false;
  const root = path.resolve(projectRoot);
  const journal = await readOwnershipJournal(root);
  if (!journal) return false;
  assertOwnershipPermit(root, permit, journal);
  if (journal.stage !== 'initializing') {
    throw new Error(`Classic init ownership cannot rollback from ${journal.stage}`);
  }
  const currentConfigIdentity = await readWorkflowProjectConfigIdentity(root);
  if (!workflowProjectConfigIdentityEquals(currentConfigIdentity, journal.configIdentity)) {
    throw new Error('Project config changed during Classic layout initialization');
  }
  await quarantineCheckpointedRoot(root, journal, options);
  return true;
}

export interface ClassicLayoutInitializationInspection {
  id: string;
  stage: ClassicInitOwnershipJournal['stage'];
  artifactLayout: ClassicArtifactLayout;
  root: string;
  quarantine: string | null;
  allowedStrategies: Array<'continue' | 'rollback'>;
}

export async function inspectClassicLayoutInitialization(
  projectRoot: string,
): Promise<ClassicLayoutInitializationInspection | null> {
  const root = path.resolve(projectRoot);
  const journal = await readOwnershipJournal(root);
  if (!journal) return null;
  return {
    id: journal.id,
    stage: journal.stage,
    artifactLayout: journal.artifactLayout,
    root: journal.root,
    quarantine: journal.quarantine,
    allowedStrategies: journal.stage === 'initializing' ? ['continue', 'rollback'] : ['rollback'],
  };
}

export async function repairClassicLayoutInitialization(
  projectRoot: string,
  strategy: 'continue' | 'rollback',
): Promise<boolean> {
  const root = path.resolve(projectRoot);
  let journal = await readOwnershipJournal(root);
  if (!journal) return false;
  if (strategy === 'continue') {
    if (journal.stage !== 'initializing') {
      throw new Error(
        `Classic init ${journal.id} is ${journal.stage}; its preserved quarantine cannot be restored automatically`,
      );
    }
    const snapshot = await readWorkflowProjectConfigSnapshot(root, {
      allowPartialProject: true,
    });
    const workflows =
      snapshot.document?.config?.workflows ??
      (snapshot.document?.config ? [snapshot.document.config.default_workflow] : []);
    const configuredLayout = snapshot.document?.classic?.artifact_layout ?? journal.artifactLayout;
    if (
      !workflows.includes('classic') ||
      configuredLayout !== journal.artifactLayout ||
      workflowProjectConfigIdentityEquals(snapshot.identity, journal.configIdentity)
    ) {
      throw new Error(
        `Classic init ${journal.id} is still resumable; rerun comet init to continue it`,
      );
    }
    await assertCheckpointMatches(root, journal);
    await removeOwnershipJournal(root, journal);
    return true;
  }

  if (journal.stage === 'initializing') {
    await quarantineCheckpointedRoot(root, journal);
    return true;
  }
  if (journal.stage === 'quarantined') return true;
  if (!journal.quarantine) {
    throw new Error('Classic init quarantining journal has no quarantine path');
  }
  const quarantineInspection = await inspectProtectedProjectPath(root, journal.quarantine, {
    label: 'Classic init rollback quarantine',
    expected: 'directory',
  });
  if (!quarantineInspection.exists) {
    const sourceInspection = await inspectProtectedProjectPath(root, journal.root, {
      label: 'Classic init rollback source',
      expected: 'directory',
    });
    if (!sourceInspection.exists) {
      throw new Error('Classic init rollback source and quarantine are both missing');
    }
    await fs.rename(
      path.join(root, ...journal.root.split('/')),
      path.join(root, ...journal.quarantine.split('/')),
    );
  }
  const quarantined = await scanOwnedRoot(root, journal.quarantine);
  if (
    !journal.rootIdentity ||
    !journal.manifest ||
    !sameObjectIdentity(quarantined.identity, journal.rootIdentity) ||
    !sameManifest(quarantined.manifest, journal.manifest)
  ) {
    throw new Error('Classic init rollback quarantine changed; all content was preserved');
  }
  journal = await updateOwnershipJournal(
    root,
    journal,
    { ...journal, stage: 'quarantined' },
    'repair-root-quarantine',
  );
  return journal.stage === 'quarantined';
}

/**
 * Validate the only two safe OpenSpec initialization states:
 * an existing configured Classic layout that is already writable, or a truly
 * fresh project where neither managed OpenSpec root exists.
 */
export async function assertClassicLayoutInitializationSafe(
  projectRoot: string,
  desiredLayout: ClassicArtifactLayout,
  permit?: ClassicLayoutInitializationPermit,
  expectedConfigIdentity?: WorkflowProjectConfigIdentity,
): Promise<ClassicLayoutInitialization> {
  const root = path.resolve(projectRoot);
  const configSnapshot = await readWorkflowProjectConfigSnapshot(root, {
    allowPartialProject: true,
  });
  const configIdentity = await readWorkflowProjectConfigIdentity(root);
  if (!workflowProjectConfigIdentityEquals(configIdentity, configSnapshot.identity)) {
    throw new Error('Project config changed while inspecting Classic layout initialization');
  }
  if (
    expectedConfigIdentity &&
    !workflowProjectConfigIdentityEquals(configIdentity, expectedConfigIdentity)
  ) {
    throw new Error('Project config changed after the workflow decision');
  }
  if (
    permit?.[initializationPermitBrand] === true &&
    permit.projectRoot === root &&
    permit.artifactLayout === desiredLayout &&
    !workflowProjectConfigIdentityEquals(permit.configIdentity, configIdentity)
  ) {
    throw new Error('Project config changed during Classic layout initialization');
  }
  const config = configSnapshot.document;
  const configuredWorkflows =
    config?.config?.workflows ?? (config?.config ? [config.config.default_workflow] : []);
  const legacyClassicConfigured =
    config !== null &&
    ['language', 'context_compression', 'review_mode', 'auto_transition'].some((key) =>
      Object.prototype.hasOwnProperty.call(config.value, key),
    );
  const classicEnabled =
    configuredWorkflows.includes('classic') ||
    (!config?.config && (config?.classic !== undefined || legacyClassicConfigured));

  const pendingMove = await inspectProtectedProjectPath(root, ROOT_MOVE_JOURNAL, {
    label: ROOT_MOVE_JOURNAL,
    expected: 'file',
  });
  if (pendingMove.exists) {
    throw new Error(
      'Classic root move transaction is incomplete; inspect it with comet doctor and recover it explicitly before writing',
    );
  }

  const legacy = classicLayoutPaths(root, 'legacy');
  const docs = classicLayoutPaths(root, 'docs');
  const [legacyRoot, docsRoot] = await Promise.all([
    inspectProtectedProjectPath(root, classicProjectRelative(root, legacy.openSpecRoot), {
      label: 'Classic managed physical path openspec',
      expected: 'directory',
    }),
    inspectProtectedProjectPath(root, classicProjectRelative(root, docs.openSpecRoot), {
      label: 'Classic managed physical path docs/openspec',
      expected: 'directory',
    }),
  ]);
  const desired = desiredLayout === 'docs' ? docs : legacy;
  const desiredRoot = desiredLayout === 'docs' ? docsRoot : legacyRoot;
  const alternateRoot = desiredLayout === 'docs' ? legacyRoot : docsRoot;
  const ownership = await readOwnershipJournal(root);

  if (ownership) {
    if (ownership.artifactLayout !== desiredLayout) {
      throw new Error(
        `Classic init ownership is bound to ${ownership.artifactLayout}, not ${desiredLayout}`,
      );
    }
    if (permit?.ownershipId && permit.ownershipId !== ownership.id) {
      throw new Error('Classic init ownership permit does not match the active initialization');
    }
    if (ownership.stage !== 'initializing') {
      throw new Error(
        `Classic init ownership is ${ownership.stage}; recover it with comet doctor before continuing`,
      );
    }
    if (alternateRoot.exists) {
      throw new Error(
        'Classic layout conflict: the alternate OpenSpec root appeared during initialization',
      );
    }
    const originalConfigStillMatches = workflowProjectConfigIdentityEquals(
      configIdentity,
      ownership.configIdentity,
    );
    const configuredLayout = config?.classic?.artifact_layout ?? desiredLayout;
    const committedConfigurationMatches =
      Boolean(config && classicEnabled && configuredLayout === desiredLayout) &&
      ownership.rootIdentity !== null &&
      ownership.manifest !== null;
    if (!originalConfigStillMatches && !committedConfigurationMatches) {
      throw new Error('Project config changed during Classic layout initialization');
    }
    if (desiredRoot.exists) {
      if (ownership.rootIdentity && ownership.manifest) {
        await assertCheckpointMatches(root, ownership);
      }
    } else if (ownership.rootIdentity || ownership.manifest) {
      throw new Error('Classic init root changed after the ownership checkpoint');
    }
    return {
      ...desired,
      initializationPermit: initializationPermit(root, desiredLayout, configIdentity, ownership.id),
    };
  }
  if (permit?.ownershipId) {
    throw new Error('Classic init ownership journal is missing');
  }

  if (config && classicEnabled) {
    const configuredLayout = config.classic?.artifact_layout ?? desiredLayout;
    if (configuredLayout !== desiredLayout) {
      throw new Error(
        `Configured Classic layout is ${configuredLayout}, but OpenSpec initialization requested ${desiredLayout}`,
      );
    }
    if (!legacyRoot.exists && !docsRoot.exists) {
      return {
        ...desired,
        initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
          ? permit
          : initializationPermit(root, desiredLayout, configIdentity),
      };
    }
    if (!config.config) {
      if (desiredRoot.exists && !alternateRoot.exists) {
        return {
          ...desired,
          initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
            ? permit
            : initializationPermit(root, desiredLayout, configIdentity),
        };
      }
      if (desiredRoot.exists && alternateRoot.exists) {
        throw new Error(
          'Classic layout conflict: both openspec/ and docs/openspec/ exist; resolve the conflict before writing',
        );
      }
      throw new Error(
        `Configured Classic OpenSpec root is missing for ${desiredLayout} layout while the alternate root exists`,
      );
    }
    const configured = await assertClassicLayoutWritable(root);
    return {
      ...configured,
      initializationPermit: permitsDesiredRoot(permit, root, desiredLayout)
        ? permit
        : initializationPermit(root, desiredLayout, configIdentity),
    };
  }

  if (legacyRoot.exists || docsRoot.exists) {
    if (
      permitsDesiredRoot(permit, root, desiredLayout) &&
      desiredRoot.exists &&
      !alternateRoot.exists
    ) {
      return { ...desired, initializationPermit: permit };
    }
    throw new Error(
      'Cannot initialize Classic layout without .comet/config.yaml when openspec/ or docs/openspec/ already exists',
    );
  }

  return {
    ...desired,
    initializationPermit: initializationPermit(root, desiredLayout, configIdentity),
  };
}
