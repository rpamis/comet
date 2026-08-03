import { promises as fs } from 'fs';
import path from 'path';
import { collectGitSnapshot } from './git.js';
import {
  collectNativeDashboardOverview,
  collectNativeDashboardProjection,
} from './native-collector.js';
import { recommendNextAction } from './next-action.js';
import { buildChangeRisks, buildProjectRisks } from './risk.js';
import { parseTasksMarkdown } from './task-parser.js';
import { parseCometYaml, type CometYaml } from './yaml.js';
import { resolveVerify } from './verify-parser.js';
import {
  inspectProtectedProjectPath,
  protectedProjectFileExists,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import type {
  ArchiveInfo,
  ArtifactPreview,
  ArtifactsSummary,
  ChangeDashboardItem,
  ChangePhase,
  DashboardRisk,
  DashboardChangeListItem,
  DashboardChangePage,
  DashboardChangeTab,
  DashboardOverview,
  DashboardSnapshot,
  GroupedArtifact,
  TasksSummary,
  VerifySummary,
} from './types.js';

const VALID_PHASES: ReadonlySet<ChangePhase> = new Set([
  'open',
  'design',
  'build',
  'verify',
  'archive',
  'unknown',
]);

const ARCHIVE_SEGMENT = 'archive';
const CLASSIC_CHANGES_ROOTS = ['openspec/changes', 'docs/openspec/changes'] as const;
const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;
const ARTIFACT_PREVIEW_LIMIT_BYTES = 256 * 1024;
const ARTIFACT_READ_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHANGE_PAGE_SIZE = 5;
const MAX_CHANGE_PAGE_SIZE = 50;
const CHANGE_INDEX_CONCURRENCY = 16;

/**
 * Build a full dashboard snapshot for the project rooted at `projectPath`.
 *
 * Read-only: any missing file or directory is treated as the corresponding
 * empty state. Errors from individual changes do not abort the whole sweep.
 */
export async function collectDashboardSnapshot(
  projectPath: string,
  options: { now?: Date; projectName?: string } = {},
): Promise<DashboardSnapshot> {
  const resolvedRoot = path.resolve(projectPath);
  const [classic, git, nativeResult] = await Promise.all([
    collectClassicChanges(resolvedRoot),
    collectGitSnapshot(resolvedRoot),
    collectNativeDashboardProjection(resolvedRoot, { now: options.now })
      .then((projection) => ({ projection, failed: false as const }))
      .catch(() => ({ projection: null, failed: true as const })),
  ]);
  const { active: activeChanges, archived: archivedChanges } = classic;
  const classicError = classic.errors.length > 0 ? classic.errors.join('\n') : null;

  const sortedActive = sortActive(activeChanges);
  const sortedArchived = sortArchived(archivedChanges);

  const summary = {
    activeChanges: sortedActive.length,
    archivedChanges: sortedArchived.length,
    verifyFailed: sortedActive.filter((c) => c.verify.result === 'fail').length,
    tasksIncomplete: sortedActive.reduce((sum, c) => sum + (c.tasks.total - c.tasks.completed), 0),
    dirtyFiles: git.dirtyFiles,
  };

  const risks = buildProjectRisks({
    git,
    changes: [...sortedActive, ...sortedArchived],
  });

  const now = options.now ?? new Date();

  return {
    project: {
      name: options.projectName ?? path.basename(resolvedRoot),
      path: resolvedRoot,
      generatedAt: now.toISOString(),
    },
    summary,
    changes: {
      active: sortedActive,
      archived: sortedArchived,
    },
    git,
    risks,
    ...(nativeResult.projection ? { native: nativeResult.projection } : {}),
    ...(nativeResult.failed
      ? { nativeError: { code: 'native-dashboard-unavailable' as const } }
      : {}),
    ...(classicError
      ? {
          classicError: {
            code: 'classic-dashboard-unavailable' as const,
            message: classicError,
          },
        }
      : {}),
  };
}

export interface DashboardChangePageOptions {
  status: DashboardChangeTab;
  limit?: number;
  cursor?: string;
  query?: string;
}

export interface DashboardOverviewOptions {
  now?: Date;
  projectName?: string;
  query?: string;
}

export class DashboardChangeQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DashboardChangeQueryError';
  }
}

interface ClassicChangeCandidate {
  id: string;
  name: string;
  displayName: string;
  status: 'active' | 'archived';
  dir: string;
  changesRelative: string;
  relativePath: string;
  workflow: string | null;
  phase: ChangePhase;
  updatedAt?: string;
  archive?: ArchiveInfo;
  tasks: TasksSummary;
  verify: VerifySummary;
  risks: DashboardRisk[];
}

interface ClassicCandidateCollection {
  active: ClassicChangeCandidate[];
  archived: ClassicChangeCandidate[];
  errors: string[];
}

/**
 * Collect only the metadata needed by the paginated change explorer. Full
 * artifact previews stay behind `collectDashboardChangeDetail` so a large
 * project does not make the initial Dashboard request proportional to every
 * Markdown file in the repository.
 */
export async function collectDashboardChangePage(
  projectPath: string,
  options: DashboardChangePageOptions,
): Promise<DashboardChangePage> {
  const collection = await collectClassicChangeCandidates(path.resolve(projectPath));
  return buildDashboardChangePage(collection, options);
}

/** Build the lightweight initial page and project summary in one collector pass. */
export async function collectDashboardOverview(
  projectPath: string,
  options: DashboardOverviewOptions = {},
): Promise<DashboardOverview> {
  const resolvedRoot = path.resolve(projectPath);
  const [classic, git, nativeResult] = await Promise.all([
    collectClassicChangeCandidates(resolvedRoot),
    collectGitSnapshot(resolvedRoot),
    collectNativeDashboardOverview(resolvedRoot, { now: options.now })
      .then((projection) => ({ projection, failed: false as const }))
      .catch(() => ({ projection: null, failed: true as const })),
  ]);
  const active = sortActiveCandidates(classic.active);
  const archived = sortArchivedCandidates(classic.archived);
  const summary = {
    activeChanges: active.length,
    archivedChanges: archived.length,
    verifyFailed: active.filter((change) => change.verify.result === 'fail').length,
    tasksIncomplete: active.reduce(
      (sum, change) => sum + (change.tasks.total - change.tasks.completed),
      0,
    ),
    dirtyFiles: git.dirtyFiles,
  };
  const now = options.now ?? new Date();
  const overview: DashboardOverview = {
    project: {
      name: options.projectName ?? path.basename(resolvedRoot),
      path: resolvedRoot,
      generatedAt: now.toISOString(),
    },
    summary,
    initialChanges: buildDashboardChangePage(classic, {
      status: 'active',
      limit: DEFAULT_CHANGE_PAGE_SIZE,
      query: options.query,
    }),
    git,
    risks: buildProjectRisks({ git, changes: [] }),
    ...(nativeResult.projection ? { native: nativeResult.projection } : {}),
    ...(nativeResult.failed
      ? { nativeError: { code: 'native-dashboard-unavailable' as const } }
      : {}),
    ...(classic.errors.length > 0
      ? {
          classicError: {
            code: 'classic-dashboard-unavailable' as const,
            message: classic.errors.join('\n'),
          },
        }
      : {}),
  };
  return overview;
}

/** Load one full Classic change after the user selects it in the explorer. */
export async function collectDashboardChangeDetail(
  projectPath: string,
  id: string,
): Promise<ChangeDashboardItem | null> {
  const resolvedRoot = path.resolve(projectPath);
  const location = parseClassicChangeId(id);
  if (!location) return null;
  const dir = path.join(resolvedRoot, ...location.relativePath.split('/'));
  if (!(await safeProjectDirectoryExists(resolvedRoot, dir, `Classic change ${location.name}`))) {
    return null;
  }
  return tryBuildChangeItem({
    name: location.name,
    dir,
    status: location.status,
    projectRoot: resolvedRoot,
    changesRelative: location.changesRelative,
  });
}

async function collectClassicChangeCandidates(
  projectRoot: string,
): Promise<ClassicCandidateCollection> {
  const collections = await Promise.all(
    CLASSIC_CHANGES_ROOTS.map(async (changesRelative) => {
      const changesRoot = path.join(projectRoot, ...changesRelative.split('/'));
      const [active, archived] = await Promise.all([
        collectCandidatesWithError({
          changesRoot,
          projectRoot,
          changesRelative,
          status: 'active',
        }),
        collectCandidatesWithError({
          changesRoot: path.join(changesRoot, ARCHIVE_SEGMENT),
          projectRoot,
          changesRelative,
          status: 'archived',
        }),
      ]);
      return {
        active: active.items,
        archived: archived.items,
        errors: [...active.errors, ...archived.errors],
      };
    }),
  );

  return {
    active: collections.flatMap((collection) => collection.active),
    archived: collections.flatMap((collection) => collection.archived),
    errors: collections.flatMap((collection) => collection.errors),
  };
}

async function collectCandidatesWithError(
  input: CollectCandidatesInput,
): Promise<{ items: ClassicChangeCandidate[]; errors: string[] }> {
  try {
    return { items: await collectChangeCandidatesFromRoot(input), errors: [] };
  } catch (error) {
    return {
      items: [],
      errors: [
        formatClassicCollectionError(
          input.status === 'archived'
            ? `${input.changesRelative}/${ARCHIVE_SEGMENT}`
            : input.changesRelative,
          error,
        ),
      ],
    };
  }
}

interface CollectCandidatesInput {
  changesRoot: string;
  projectRoot: string;
  changesRelative: string;
  status: 'active' | 'archived';
}

async function collectChangeCandidatesFromRoot(
  input: CollectCandidatesInput,
): Promise<ClassicChangeCandidate[]> {
  const relativeRoot =
    input.status === 'archived'
      ? `${input.changesRelative}/${ARCHIVE_SEGMENT}`
      : input.changesRelative;
  let inspection;
  try {
    inspection = await inspectProtectedProjectPath(input.projectRoot, relativeRoot, {
      label: `Classic ${input.status} changes root`,
      expected: 'directory',
    });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  if (!inspection.exists) return [];

  const entries = await fs.readdir(inspection.target);
  const candidates = await mapWithConcurrency(
    entries.filter((entry) => entry !== ARCHIVE_SEGMENT),
    CHANGE_INDEX_CONCURRENCY,
    async (entry) => {
      const dir = path.join(input.changesRoot, entry);
      if (!(await safeProjectDirectoryExists(input.projectRoot, dir, `Classic change ${entry}`))) {
        return null;
      }
      return tryBuildChangeCandidate({ ...input, name: entry, dir });
    },
  );
  return candidates.filter((candidate): candidate is ClassicChangeCandidate => candidate !== null);
}

async function tryBuildChangeCandidate(
  input: CollectCandidatesInput & { name: string; dir: string },
): Promise<ClassicChangeCandidate | null> {
  try {
    return await buildChangeCandidate(input);
  } catch (error) {
    console.warn(
      `[dashboard] skipping change index "${input.name}": ${(error as Error).message ?? error}`,
    );
    return null;
  }
}

async function buildChangeCandidate(
  input: CollectCandidatesInput & { name: string; dir: string },
): Promise<ClassicChangeCandidate> {
  const yamlPath = path.join(input.dir, '.comet.yaml');
  const tasksPath = path.join(input.dir, 'tasks.md');
  const proposalPath = path.join(input.dir, 'proposal.md');
  const designPath = path.join(input.dir, 'design.md');
  const localPlanPath = path.join(input.dir, 'plan.md');
  const yaml: CometYaml = (await readProjectCometYaml(input.projectRoot, yamlPath)) ?? {};
  const yamlPlanPath = stripNullish(yaml.plan);
  const resolvedPlanPath =
    (yamlPlanPath
      ? await resolveArtifactPointer(input.projectRoot, yamlPlanPath, 'Classic plan artifact')
      : null) ?? localPlanPath;
  const [tasks, verify, proposal, design, hasTasks, plan, cometYamlExists, updatedAt] =
    await Promise.all([
      readTasks(input.projectRoot, tasksPath),
      resolveVerify({
        changeDir: input.dir,
        yaml,
        projectRoot: input.projectRoot,
        includeSummary: false,
      }),
      safeProjectFileExists(input.projectRoot, proposalPath, 'Classic proposal artifact'),
      safeProjectFileExists(input.projectRoot, designPath, 'Classic design artifact'),
      safeProjectFileExists(input.projectRoot, tasksPath, 'Classic tasks artifact'),
      safeProjectFileExists(input.projectRoot, resolvedPlanPath, 'Classic plan artifact'),
      safeProjectFileExists(input.projectRoot, yamlPath, 'Classic state artifact'),
      readMtime(input.projectRoot, input.dir),
    ]);

  const phase = parsePhase(yaml.phase);
  const archive = input.status === 'archived' ? buildArchiveInfo(input) : undefined;
  const artifacts: ArtifactsSummary = {
    proposal,
    design,
    tasks: hasTasks,
    plan,
    verifyReport: verify.reportExists,
    cometYaml: cometYamlExists,
    grouped: [],
  };
  const risks = buildChangeRisks({
    status: input.status,
    phase,
    hasCometYaml: cometYamlExists,
    tasks,
    verify,
    artifacts,
    archiveMetadataKnown: input.status === 'archived' ? Boolean(archive?.archivedAt) : undefined,
  });
  const id =
    input.status === 'archived'
      ? `${input.changesRelative}/${ARCHIVE_SEGMENT}/${input.name}`
      : `${input.changesRelative}/${input.name}`;
  return {
    id,
    name: input.name,
    displayName:
      input.status === 'archived' && archive?.originalName ? archive.originalName : input.name,
    status: input.status,
    dir: input.dir,
    changesRelative: input.changesRelative,
    relativePath: path.relative(input.projectRoot, input.dir).replaceAll('\\', '/'),
    workflow: yaml.workflow ?? null,
    phase,
    updatedAt,
    archive,
    tasks,
    verify,
    risks,
  };
}

function buildDashboardChangePage(
  collection: ClassicCandidateCollection,
  options: DashboardChangePageOptions,
): DashboardChangePage {
  const limit = normalizeChangePageLimit(options.limit);
  const active = filterAndSortCandidates(collection.active, options.query, 'active');
  const archived = filterAndSortCandidates(collection.archived, options.query, 'archived');
  const candidates =
    options.status === 'active'
      ? active
      : options.status === 'archived'
        ? archived
        : [...active, ...archived];
  const offset = decodeChangeCursor(options.cursor, options.status);
  const items = candidates.slice(offset, offset + limit).map(toDashboardChangeListItem);
  const nextOffset = offset + items.length;
  return {
    status: options.status,
    items,
    total: candidates.length,
    nextCursor:
      nextOffset < candidates.length ? encodeChangeCursor(options.status, nextOffset) : null,
  };
}

function filterAndSortCandidates(
  candidates: ClassicChangeCandidate[],
  query: string | undefined,
  status: 'active' | 'archived',
): ClassicChangeCandidate[] {
  const normalized = query?.trim().toLowerCase() ?? '';
  const filtered = normalized
    ? candidates.filter((candidate) =>
        [candidate.name, candidate.displayName, candidate.workflow, candidate.phase]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      )
    : candidates;
  return status === 'active' ? sortActiveCandidates(filtered) : sortArchivedCandidates(filtered);
}

function toDashboardChangeListItem(candidate: ClassicChangeCandidate): DashboardChangeListItem {
  return {
    id: candidate.id,
    name: candidate.name,
    displayName: candidate.displayName,
    status: candidate.status,
    relativePath: candidate.relativePath,
    workflow: candidate.workflow,
    phase: candidate.phase,
    updatedAt: candidate.updatedAt,
    tasks: { completed: candidate.tasks.completed, total: candidate.tasks.total },
    verify: { result: candidate.verify.result },
  };
}

function sortActiveCandidates(items: ClassicChangeCandidate[]): ClassicChangeCandidate[] {
  return [...items].sort(compareActiveCandidates);
}

function sortArchivedCandidates(items: ClassicChangeCandidate[]): ClassicChangeCandidate[] {
  return [...items].sort((left, right) => {
    const byArchivedAt = (right.archive?.archivedAt ?? '').localeCompare(
      left.archive?.archivedAt ?? '',
    );
    if (byArchivedAt !== 0) return byArchivedAt;
    const byName = left.name.localeCompare(right.name);
    return byName !== 0 ? byName : left.relativePath.localeCompare(right.relativePath);
  });
}

function compareActiveCandidates(
  left: ClassicChangeCandidate,
  right: ClassicChangeCandidate,
): number {
  const byRisk = riskScore(left) - riskScore(right);
  if (byRisk !== 0) return byRisk;
  const byUpdated = (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  if (byUpdated !== 0) return byUpdated;
  const byName = left.name.localeCompare(right.name);
  return byName !== 0 ? byName : left.relativePath.localeCompare(right.relativePath);
}

function normalizeChangePageLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_CHANGE_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CHANGE_PAGE_SIZE) {
    throw new DashboardChangeQueryError(
      `Change page limit must be an integer between 1 and ${MAX_CHANGE_PAGE_SIZE}`,
    );
  }
  return value;
}

function encodeChangeCursor(status: DashboardChangeTab, offset: number): string {
  return Buffer.from(JSON.stringify({ status, offset }), 'utf8').toString('base64url');
}

function decodeChangeCursor(cursor: string | undefined, status: DashboardChangeTab): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      status?: unknown;
      offset?: unknown;
    };
    if (
      parsed.status !== status ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset as number) < 0
    ) {
      throw new Error('invalid cursor');
    }
    return parsed.offset as number;
  } catch {
    throw new DashboardChangeQueryError('Invalid dashboard change cursor');
  }
}

function parseClassicChangeId(id: string): {
  name: string;
  status: 'active' | 'archived';
  changesRelative: string;
  relativePath: string;
} | null {
  for (const changesRelative of CLASSIC_CHANGES_ROOTS) {
    const archivePrefix = `${changesRelative}/${ARCHIVE_SEGMENT}/`;
    if (id.startsWith(archivePrefix)) {
      const name = id.slice(archivePrefix.length);
      if (name && !hasPathSeparator(name) && name !== '.' && name !== '..') {
        return {
          name,
          status: 'archived',
          changesRelative,
          relativePath: `${archivePrefix}${name}`,
        };
      }
    }
    const activePrefix = `${changesRelative}/`;
    if (id.startsWith(activePrefix)) {
      const name = id.slice(activePrefix.length);
      if (
        name &&
        !hasPathSeparator(name) &&
        name !== ARCHIVE_SEGMENT &&
        name !== '.' &&
        name !== '..'
      ) {
        return {
          name,
          status: 'active',
          changesRelative,
          relativePath: `${activePrefix}${name}`,
        };
      }
    }
  }
  return null;
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= values.length) return;
        results[index] = await worker(values[index]);
      }
    }),
  );
  return results;
}

interface ClassicCollection {
  active: ChangeDashboardItem[];
  archived: ChangeDashboardItem[];
  errors: string[];
}

async function collectClassicChanges(projectRoot: string): Promise<ClassicCollection> {
  const active: ChangeDashboardItem[] = [];
  const archived: ChangeDashboardItem[] = [];
  const errors: string[] = [];

  for (const changesRelative of CLASSIC_CHANGES_ROOTS) {
    const changesRoot = path.join(projectRoot, ...changesRelative.split('/'));
    try {
      active.push(...(await collectActiveChanges(changesRoot, projectRoot, changesRelative)));
    } catch (error) {
      errors.push(formatClassicCollectionError(changesRelative, error));
    }
    try {
      archived.push(...(await collectArchivedChanges(changesRoot, projectRoot, changesRelative)));
    } catch (error) {
      errors.push(formatClassicCollectionError(`${changesRelative}/archive`, error));
    }
  }

  return { active, archived, errors };
}

function formatClassicCollectionError(relativePath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Classic ${relativePath}: ${message}`;
}

async function collectActiveChanges(
  changesRoot: string,
  projectRoot: string,
  changesRelative: string,
): Promise<ChangeDashboardItem[]> {
  const inspection = await inspectProtectedProjectPath(
    projectRoot,
    projectRelative(projectRoot, changesRoot),
    {
      label: 'Classic changes root',
      expected: 'directory',
    },
  );
  if (!inspection.exists) return [];
  const entries = await fs.readdir(inspection.target);
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    if (entry === ARCHIVE_SEGMENT) continue;

    const dir = path.join(changesRoot, entry);
    if (!(await safeProjectDirectoryExists(projectRoot, dir, `Classic change ${entry}`))) continue;

    const item = await tryBuildChangeItem({
      name: entry,
      dir,
      status: 'active',
      projectRoot,
      changesRelative,
    });
    if (item) items.push(item);
  }

  return items;
}

async function collectArchivedChanges(
  changesRoot: string,
  projectRoot: string,
  changesRelative: string,
): Promise<ChangeDashboardItem[]> {
  const archiveRoot = path.join(changesRoot, ARCHIVE_SEGMENT);
  const inspection = await inspectProtectedProjectPath(
    projectRoot,
    projectRelative(projectRoot, archiveRoot),
    {
      label: 'Classic archive root',
      expected: 'directory',
    },
  );
  if (!inspection.exists) return [];
  const entries = await fs.readdir(inspection.target);
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    const dir = path.join(archiveRoot, entry);
    if (!(await safeProjectDirectoryExists(projectRoot, dir, `Classic archive ${entry}`))) continue;

    const item = await tryBuildChangeItem({
      name: entry,
      dir,
      status: 'archived',
      projectRoot,
      changesRelative,
    });
    if (item) items.push(item);
  }

  return items;
}

/**
 * Build one change item, swallowing per-change errors so the rest of the
 * sweep continues. The dashboard is read-only and "best effort by design";
 * a single malformed yaml or unreadable directory shouldn't blank the page.
 */
async function tryBuildChangeItem(input: BuildChangeInput): Promise<ChangeDashboardItem | null> {
  try {
    return await buildChangeItem(input);
  } catch (error) {
    console.warn(
      `[dashboard] skipping change "${input.name}": ${(error as Error).message ?? error}`,
    );
    return null;
  }
}

interface BuildChangeInput {
  name: string;
  dir: string;
  status: 'active' | 'archived';
  projectRoot: string;
  changesRelative: string;
}

async function buildChangeItem(input: BuildChangeInput): Promise<ChangeDashboardItem> {
  const changeInspection = await inspectProtectedProjectPath(
    input.projectRoot,
    projectRelative(input.projectRoot, input.dir),
    {
      label: `Classic change ${input.name}`,
      expected: 'directory',
    },
  );
  if (!changeInspection.exists) {
    throw new Error(`Classic change ${input.name} disappeared during collection`);
  }
  const yamlPath = path.join(input.dir, '.comet.yaml');
  const tasksPath = path.join(input.dir, 'tasks.md');
  const designPath = path.join(input.dir, 'design.md');
  const proposalPath = path.join(input.dir, 'proposal.md');
  const localPlanPath = path.join(input.dir, 'plan.md');

  const yaml: CometYaml = (await readProjectCometYaml(input.projectRoot, yamlPath)) ?? {};

  const projectRoot = input.projectRoot;

  // Read yaml path-pointers for Superpowers artifacts
  const yamlPlanPath = stripNullish(yaml.plan);
  const yamlVerifyPath = stripNullish(yaml.verification_report ?? yaml.verificationReport);
  const yamlDesignDocPath = stripNullish(yaml.design_doc ?? yaml.designDoc);

  // Resolve Superpowers artifact paths (yaml paths are relative to project root)
  const resolvedPlanPath =
    (yamlPlanPath
      ? await resolveArtifactPointer(projectRoot, yamlPlanPath, 'Classic plan artifact')
      : null) ?? localPlanPath;
  const resolvedVerifyPath =
    (yamlVerifyPath
      ? await resolveArtifactPointer(projectRoot, yamlVerifyPath, 'Classic verification artifact')
      : null) ?? path.join(input.dir, '.comet', 'verify-result.md');
  const resolvedDesignDocPath = yamlDesignDocPath
    ? ((await resolveArtifactPointer(projectRoot, yamlDesignDocPath, 'Classic design artifact')) ??
      '')
    : '';

  const tasks = await readTasks(projectRoot, tasksPath);
  const verify = await resolveVerify({ changeDir: input.dir, yaml, projectRoot });

  // Detect delta specs in change directory
  const deltaSpecPath = await findDeltaSpec(projectRoot, input.dir);

  // Comet intermediate artifacts
  const handoffPath = path.join(input.dir, '.comet', 'handoff', 'design-context.json');
  const checkpointPath = path.join(input.dir, '.comet', 'checkpoint.json');
  const brainstormPath = path.join(input.dir, '.comet', 'handoff', 'brainstorm-summary.md');
  const subagentProgressPath = path.join(input.dir, '.comet', 'subagent-progress.md');

  const [
    proposal,
    design,
    hasTasks,
    localPlan,
    plan,
    designDocExists,
    cometYamlExists,
    handoffExists,
    checkpointExists,
    brainstormExists,
    subagentProgressExists,
  ] = await Promise.all([
    safeProjectFileExists(projectRoot, proposalPath, 'Classic proposal artifact'),
    safeProjectFileExists(projectRoot, designPath, 'Classic design artifact'),
    safeProjectFileExists(projectRoot, tasksPath, 'Classic tasks artifact'),
    safeProjectFileExists(projectRoot, localPlanPath, 'Classic local plan artifact'),
    safeProjectFileExists(projectRoot, resolvedPlanPath, 'Classic plan artifact'),
    resolvedDesignDocPath
      ? safeProjectFileExists(projectRoot, resolvedDesignDocPath, 'Classic design artifact')
      : Promise.resolve(false),
    safeProjectFileExists(projectRoot, yamlPath, 'Classic state artifact'),
    safeProjectFileExists(projectRoot, handoffPath, 'Classic handoff artifact'),
    safeProjectFileExists(projectRoot, checkpointPath, 'Classic checkpoint artifact'),
    safeProjectFileExists(projectRoot, brainstormPath, 'Classic brainstorm artifact'),
    safeProjectFileExists(projectRoot, subagentProgressPath, 'Classic progress artifact'),
  ]);

  const artifacts: ArtifactsSummary = {
    proposal,
    design,
    tasks: hasTasks,
    plan: plan || localPlan,
    verifyReport: verify.reportExists,
    cometYaml: cometYamlExists,
    grouped: buildGroupedArtifacts({
      phase: yaml.phase,
      buildMode: yaml.build_mode ?? yaml.buildMode,
      proposal,
      proposalPath,
      design,
      designPath,
      hasTasks,
      tasksPath,
      deltaSpecPath,
      designDocExists,
      resolvedDesignDocPath,
      plan: plan || localPlan,
      resolvedPlanPath: plan ? resolvedPlanPath : localPlanPath,
      verifyReportExists: verify.reportExists,
      resolvedVerifyPath,
      cometYamlExists,
      cometYamlPath: yamlPath,
      handoffExists,
      handoffPath,
      checkpointExists,
      checkpointPath,
      brainstormExists,
      brainstormPath,
      subagentProgressExists,
      subagentProgressPath,
    }),
  };

  const artifactPreviews = await readArtifactPreviews(projectRoot, [
    ['proposal', '提案', proposalPath],
    ['design', '设计文档', designPath],
    ['tasks', '任务清单', tasksPath],
    ['plan', '实施计划', plan ? resolvedPlanPath : localPlanPath],
    [
      'verifyReport',
      '验证报告',
      verify.reportExists ? resolvedVerifyPath : path.join(input.dir, '.comet', 'verify-result.md'),
    ],
    ['cometYaml', '变更配置', yamlPath],
    ['handoff', 'Handoff 上下文', handoffPath],
    ['checkpoint', 'Checkpoint', checkpointPath],
    ['brainstorm', 'Brainstorm 摘要', brainstormPath],
    ['subagentProgress', 'Subagent 进度', subagentProgressPath],
    ...(designDocExists && resolvedDesignDocPath
      ? ([['designDoc', '技术设计', resolvedDesignDocPath]] as Array<[string, string, string]>)
      : []),
    ...(deltaSpecPath
      ? ([['deltaSpec', 'Delta Spec', deltaSpecPath]] as Array<[string, string, string]>)
      : []),
  ]);

  const phase = parsePhase(yaml.phase);
  const archive = input.status === 'archived' ? buildArchiveInfo(input) : undefined;
  const archiveMetadataKnown =
    input.status === 'archived' ? Boolean(archive?.archivedAt) : undefined;

  const displayName =
    input.status === 'archived' && archive?.originalName ? archive.originalName : input.name;

  const updatedAt = await readMtime(projectRoot, input.dir);

  const risks: DashboardRisk[] = buildChangeRisks({
    status: input.status,
    phase,
    hasCometYaml: artifacts.cometYaml,
    tasks,
    verify,
    artifacts,
    archiveMetadataKnown,
  });

  const item: ChangeDashboardItem = {
    id:
      input.status === 'archived'
        ? `${input.changesRelative}/archive/${input.name}`
        : `${input.changesRelative}/${input.name}`,
    name: input.name,
    displayName,
    status: input.status,
    path: input.dir,
    relativePath: path.relative(projectRoot, input.dir).replaceAll('\\', '/'),
    workflow: yaml.workflow ?? null,
    phase,
    updatedAt,
    archive,
    tasks,
    artifacts,
    artifactPreviews,
    verify,
    risks,
  };

  if (input.status === 'active') {
    item.next = recommendNextAction({ phase, tasks, verify });
  }

  return item;
}

async function readArtifactPreviews(
  projectRoot: string,
  files: Array<[string, string, string]>,
): Promise<ArtifactPreview[]> {
  return Promise.all(
    files.map(async ([key, label, filePath]) => {
      const preview: ArtifactPreview = {
        key,
        label,
        path: filePath,
        exists: false,
      };

      try {
        const relative = path.relative(projectRoot, filePath).replaceAll('\\', '/');
        const result = await readProtectedProjectFile(
          projectRoot,
          relative,
          ARTIFACT_READ_LIMIT_BYTES,
          { label: `${label} preview` },
        );
        const stat = result.stat;
        preview.exists = true;
        preview.size = Number(stat.size);
        preview.updatedAt = stat.mtime.toISOString();
        preview.content = result.bytes.subarray(0, ARTIFACT_PREVIEW_LIMIT_BYTES).toString('utf-8');
        preview.truncated = Number(stat.size) > ARTIFACT_PREVIEW_LIMIT_BYTES;
      } catch {
        // Missing or unreadable artifacts are represented as absent previews.
      }

      return preview;
    }),
  );
}

async function resolveArtifactPointer(
  projectRoot: string,
  candidate: string,
  label: string,
): Promise<string | null> {
  try {
    return (
      await inspectProtectedProjectPath(projectRoot, candidate, {
        label,
        expected: 'file',
      })
    ).target;
  } catch {
    return null;
  }
}

async function safeProjectFileExists(
  projectRoot: string,
  file: string,
  label: string,
): Promise<boolean> {
  try {
    return await protectedProjectFileExists(
      projectRoot,
      path.relative(projectRoot, file).replaceAll('\\', '/'),
      { label },
    );
  } catch {
    return false;
  }
}

async function safeProjectDirectoryExists(
  projectRoot: string,
  directory: string,
  label: string,
): Promise<boolean> {
  try {
    return (
      await inspectProtectedProjectPath(projectRoot, projectRelative(projectRoot, directory), {
        label,
        expected: 'directory',
      })
    ).exists;
  } catch {
    return false;
  }
}

async function readProjectCometYaml(
  projectRoot: string,
  yamlPath: string,
): Promise<CometYaml | null> {
  try {
    const result = await readProtectedProjectFile(
      projectRoot,
      projectRelative(projectRoot, yamlPath),
      ARTIFACT_READ_LIMIT_BYTES,
      { label: 'Classic state artifact' },
    );
    return parseCometYaml(result.bytes.toString('utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readTasks(projectRoot: string, tasksPath: string): Promise<TasksSummary> {
  try {
    const result = await readProtectedProjectFile(
      projectRoot,
      projectRelative(projectRoot, tasksPath),
      ARTIFACT_READ_LIMIT_BYTES,
      { label: 'Classic tasks artifact' },
    );
    return parseTasksMarkdown(result.bytes.toString('utf8'));
  } catch {
    return { completed: 0, total: 0, incomplete: [], sections: [] };
  }
}

function parsePhase(raw: string | undefined): ChangePhase {
  if (!raw) return 'unknown';
  const value = raw.trim().toLowerCase();
  return VALID_PHASES.has(value as ChangePhase) ? (value as ChangePhase) : 'unknown';
}

function buildArchiveInfo(input: BuildChangeInput): ArchiveInfo {
  const match = input.name.match(ARCHIVE_NAME_PATTERN);
  const info: ArchiveInfo = {
    archiveName: input.name,
    archivePath: input.dir,
  };
  if (match) {
    info.archivedAt = match[1];
    info.originalName = match[2];
  }
  return info;
}

async function readMtime(projectRoot: string, target: string): Promise<string | undefined> {
  try {
    const inspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative(projectRoot, target),
      {
        label: 'Classic change directory',
        expected: 'directory',
      },
    );
    if (!inspection.exists) return undefined;
    const stat = await fs.lstat(inspection.target);
    return stat.mtime.toISOString();
  } catch {
    return undefined;
  }
}

function stripNullish(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value === 'null') return undefined;
  return value;
}

async function findDeltaSpec(projectRoot: string, changeDir: string): Promise<string | undefined> {
  const specsDir = path.join(changeDir, 'specs');
  try {
    const specsInspection = await inspectProtectedProjectPath(
      projectRoot,
      projectRelative(projectRoot, specsDir),
      {
        label: 'Classic delta spec root',
        expected: 'directory',
      },
    );
    if (!specsInspection.exists) return undefined;
    const entries = await fs.readdir(specsInspection.target, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const specFile = path.join(specsDir, entry.name, 'spec.md');
      if (
        await protectedProjectFileExists(projectRoot, projectRelative(projectRoot, specFile), {
          label: `Classic delta spec ${entry.name}`,
        })
      ) {
        return specFile;
      }
    }
  } catch {
    // specs/ directory doesn't exist
  }
  return undefined;
}

function projectRelative(projectRoot: string, target: string): string {
  return path.relative(projectRoot, target).replaceAll('\\', '/');
}

interface GroupedInput {
  phase: string | undefined;
  buildMode: string | undefined;
  proposal: boolean;
  proposalPath: string;
  design: boolean;
  designPath: string;
  hasTasks: boolean;
  tasksPath: string;
  deltaSpecPath: string | undefined;
  designDocExists: boolean;
  resolvedDesignDocPath: string;
  plan: boolean;
  resolvedPlanPath: string;
  verifyReportExists: boolean;
  resolvedVerifyPath: string;
  cometYamlExists: boolean;
  cometYamlPath: string;
  handoffExists: boolean;
  handoffPath: string;
  checkpointExists: boolean;
  checkpointPath: string;
  brainstormExists: boolean;
  brainstormPath: string;
  subagentProgressExists: boolean;
  subagentProgressPath: string;
}

function buildGroupedArtifacts(input: GroupedInput): GroupedArtifact[] {
  const defaultDesignDocPath = input.resolvedDesignDocPath || '';
  const phase = input.phase ?? '';
  const subagentNotApplicable =
    input.buildMode === 'executing-plans' || input.buildMode === 'direct';
  const brainstormNotApplicable = phase === 'open';
  const handoffNotApplicable = phase === 'open' || phase === 'design';
  const checkpointNotApplicable = phase === 'open' || phase === 'design';

  return [
    {
      key: 'proposal',
      label: '提案',
      source: 'openspec',
      exists: input.proposal,
      path: input.proposalPath,
    },
    {
      key: 'design',
      label: '设计文档',
      source: 'openspec',
      exists: input.design,
      path: input.designPath,
    },
    {
      key: 'tasks',
      label: '任务清单',
      source: 'openspec',
      exists: input.hasTasks,
      path: input.tasksPath,
    },
    {
      key: 'deltaSpec',
      label: 'Delta Spec',
      source: 'openspec',
      exists: !!input.deltaSpecPath,
      path: input.deltaSpecPath || '',
    },
    {
      key: 'designDoc',
      label: '技术设计',
      source: 'superpowers',
      exists: input.designDocExists,
      path: defaultDesignDocPath || '',
    },
    {
      key: 'plan',
      label: '实施计划',
      source: 'superpowers',
      exists: input.plan,
      path: input.resolvedPlanPath,
    },
    {
      key: 'verifyReport',
      label: '验证报告',
      source: 'superpowers',
      exists: input.verifyReportExists,
      path: input.resolvedVerifyPath,
    },
    {
      key: 'cometYaml',
      label: '.comet.yaml',
      source: 'comet',
      exists: input.cometYamlExists,
      path: input.cometYamlPath,
    },
    {
      key: 'handoff',
      label: 'Handoff 上下文',
      source: 'comet',
      exists: input.handoffExists,
      path: input.handoffPath,
      notApplicable: handoffNotApplicable,
    },
    {
      key: 'checkpoint',
      label: 'Checkpoint',
      source: 'comet',
      exists: input.checkpointExists,
      path: input.checkpointPath,
      notApplicable: checkpointNotApplicable,
    },
    {
      key: 'brainstorm',
      label: 'Brainstorm 摘要',
      source: 'comet',
      exists: input.brainstormExists,
      path: input.brainstormPath,
      notApplicable: brainstormNotApplicable,
    },
    {
      key: 'subagentProgress',
      label: 'Subagent 进度',
      source: 'comet',
      exists: input.subagentProgressExists,
      path: input.subagentProgressPath,
      notApplicable: subagentNotApplicable,
    },
  ];
}

function riskScore(item: Pick<ChangeDashboardItem, 'verify' | 'risks'>): number {
  if (item.verify.result === 'fail' || item.risks.some((r) => r.level === 'error')) return 0;
  if (item.risks.some((r) => r.level === 'warning')) return 1;
  return 2;
}

function sortActive(items: ChangeDashboardItem[]): ChangeDashboardItem[] {
  return [...items].sort((a, b) => {
    const byRisk = riskScore(a) - riskScore(b);
    if (byRisk !== 0) return byRisk;
    const byUpdated = (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    if (byUpdated !== 0) return byUpdated;
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.relativePath.localeCompare(b.relativePath);
  });
}

function sortArchived(items: ChangeDashboardItem[]): ChangeDashboardItem[] {
  return [...items].sort((a, b) => {
    const byArchivedAt = (b.archive?.archivedAt ?? '').localeCompare(a.archive?.archivedAt ?? '');
    if (byArchivedAt !== 0) return byArchivedAt;
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.relativePath.localeCompare(b.relativePath);
  });
}
