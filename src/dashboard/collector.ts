import { promises as fs } from 'fs';
import path from 'path';
import { fileExists, readDir } from '../utils/file-system.js';
import { collectGitSnapshot } from './git.js';
import { recommendNextAction } from './next-action.js';
import { buildChangeRisks, buildProjectRisks } from './risk.js';
import { parseTasksMarkdown } from './task-parser.js';
import { readCometYaml, type CometYaml } from './yaml.js';
import { resolveVerify } from './verify-parser.js';
import type {
  ArchiveInfo,
  ArtifactsSummary,
  ChangeDashboardItem,
  ChangePhase,
  DashboardRisk,
  DashboardSnapshot,
  TasksSummary,
} from './types.js';

const VALID_PHASES: ReadonlySet<ChangePhase> = new Set([
  'open',
  'design',
  'build',
  'verify',
  'archive',
  'unknown',
]);

const CHANGES_DIR = path.join('openspec', 'changes');
const ARCHIVE_SEGMENT = 'archive';
const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;

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
  const changesRoot = path.join(resolvedRoot, CHANGES_DIR);

  const [activeChanges, archivedChanges, git] = await Promise.all([
    collectActiveChanges(changesRoot),
    collectArchivedChanges(changesRoot),
    collectGitSnapshot(resolvedRoot),
  ]);

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
  };
}

async function collectActiveChanges(changesRoot: string): Promise<ChangeDashboardItem[]> {
  if (!(await fileExists(changesRoot))) return [];

  const entries = await readDir(changesRoot);
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    if (entry === ARCHIVE_SEGMENT) continue;

    const dir = path.join(changesRoot, entry);
    const stat = await safeStat(dir);
    if (!stat?.isDirectory()) continue;

    const item = await tryBuildChangeItem({ name: entry, dir, status: 'active' });
    if (item) items.push(item);
  }

  return items;
}

async function collectArchivedChanges(changesRoot: string): Promise<ChangeDashboardItem[]> {
  const archiveRoot = path.join(changesRoot, ARCHIVE_SEGMENT);
  if (!(await fileExists(archiveRoot))) return [];

  const entries = await readDir(archiveRoot);
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    const dir = path.join(archiveRoot, entry);
    const stat = await safeStat(dir);
    if (!stat?.isDirectory()) continue;

    const item = await tryBuildChangeItem({ name: entry, dir, status: 'archived' });
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
}

async function buildChangeItem(input: BuildChangeInput): Promise<ChangeDashboardItem> {
  const yamlPath = path.join(input.dir, '.comet.yaml');
  const tasksPath = path.join(input.dir, 'tasks.md');
  const designPath = path.join(input.dir, 'design.md');
  const proposalPath = path.join(input.dir, 'proposal.md');
  const planPath = path.join(input.dir, 'plan.md');

  const yaml: CometYaml = (await readCometYaml(yamlPath)) ?? {};

  const tasks = await readTasks(tasksPath);
  const verify = await resolveVerify({ changeDir: input.dir, yaml });

  const [proposal, design, hasTasks, plan] = await Promise.all([
    fileExists(proposalPath),
    fileExists(designPath),
    fileExists(tasksPath),
    fileExists(planPath),
  ]);

  const artifacts: ArtifactsSummary = {
    proposal,
    design,
    tasks: hasTasks,
    plan,
    verifyReport: verify.reportExists,
    cometYaml: await fileExists(yamlPath),
  };

  const phase = parsePhase(yaml.phase);
  const archive = input.status === 'archived' ? buildArchiveInfo(input) : undefined;
  const archiveMetadataKnown =
    input.status === 'archived' ? Boolean(archive?.archivedAt) : undefined;

  const displayName =
    input.status === 'archived' && archive?.originalName ? archive.originalName : input.name;

  const updatedAt = await readMtime(input.dir);

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
    id: input.status === 'archived' ? `archive/${input.name}` : input.name,
    name: input.name,
    displayName,
    status: input.status,
    path: input.dir,
    workflow: yaml.workflow ?? null,
    phase,
    updatedAt,
    archive,
    tasks,
    artifacts,
    verify,
    risks,
  };

  if (input.status === 'active') {
    item.next = recommendNextAction({ phase, tasks, verify });
  }

  return item;
}

async function readTasks(tasksPath: string): Promise<TasksSummary> {
  try {
    const content = await fs.readFile(tasksPath, 'utf-8');
    return parseTasksMarkdown(content);
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

async function safeStat(target: string): Promise<{ isDirectory(): boolean } | null> {
  try {
    return await fs.stat(target);
  } catch {
    return null;
  }
}

async function readMtime(target: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(target);
    return stat.mtime.toISOString();
  } catch {
    return undefined;
  }
}

function riskScore(item: ChangeDashboardItem): number {
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
    return a.name.localeCompare(b.name);
  });
}

function sortArchived(items: ChangeDashboardItem[]): ChangeDashboardItem[] {
  return [...items].sort((a, b) => {
    const byArchivedAt = (b.archive?.archivedAt ?? '').localeCompare(a.archive?.archivedAt ?? '');
    if (byArchivedAt !== 0) return byArchivedAt;
    return a.name.localeCompare(b.name);
  });
}
