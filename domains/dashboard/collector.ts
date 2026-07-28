import { promises as fs } from 'fs';
import path from 'path';
import { collectGitSnapshot } from './git.js';
import { collectNativeDashboardProjection } from './native-collector.js';
import { recommendNextAction } from './next-action.js';
import { buildChangeRisks, buildProjectRisks } from './risk.js';
import { parseTasksMarkdown } from './task-parser.js';
import { parseCometYaml, type CometYaml } from './yaml.js';
import { resolveVerify } from './verify-parser.js';
import { assertClassicLayoutReadable } from '../comet-classic/classic-layout.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';
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
  DashboardSnapshot,
  GroupedArtifact,
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

const ARCHIVE_SEGMENT = 'archive';
const ARCHIVE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})-(.+)$/u;
const ARTIFACT_PREVIEW_LIMIT_BYTES = 256 * 1024;
const ARTIFACT_READ_LIMIT_BYTES = 2 * 1024 * 1024;

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
  let changesRoot: string | null = null;
  let classicError: string | null = null;
  try {
    const config = await readWorkflowProjectConfig(resolvedRoot);
    const workflows = config?.workflows ?? (config ? [config.default_workflow] : ['classic']);
    if (workflows.includes('classic')) {
      const layout = await assertClassicLayoutReadable(resolvedRoot);
      await inspectProtectedProjectPath(
        resolvedRoot,
        projectRelative(resolvedRoot, layout.changesDir),
        {
          label: 'Classic changes root',
          expected: 'directory',
        },
      );
      await inspectProtectedProjectPath(
        resolvedRoot,
        projectRelative(resolvedRoot, layout.archiveDir),
        {
          label: 'Classic archive root',
          expected: 'directory',
        },
      );
      changesRoot = layout.changesDir;
    }
  } catch (error) {
    classicError = error instanceof Error ? error.message : String(error);
  }

  const [activeChanges, archivedChanges, git, nativeResult] = await Promise.all([
    changesRoot ? collectActiveChanges(changesRoot, resolvedRoot) : Promise.resolve([]),
    changesRoot ? collectArchivedChanges(changesRoot, resolvedRoot) : Promise.resolve([]),
    collectGitSnapshot(resolvedRoot),
    collectNativeDashboardProjection(resolvedRoot, { now: options.now })
      .then((projection) => ({ projection, failed: false as const }))
      .catch(() => ({ projection: null, failed: true as const })),
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

async function collectActiveChanges(
  changesRoot: string,
  projectRoot: string,
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
  await inspectProtectedProjectPath(projectRoot, projectRelative(projectRoot, changesRoot), {
    label: 'Classic changes root',
    expected: 'directory',
  });
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    if (entry === ARCHIVE_SEGMENT) continue;

    const dir = path.join(changesRoot, entry);
    if (!(await safeProjectDirectoryExists(projectRoot, dir, `Classic change ${entry}`))) continue;

    const item = await tryBuildChangeItem({ name: entry, dir, status: 'active', projectRoot });
    if (item) items.push(item);
  }

  return items;
}

async function collectArchivedChanges(
  changesRoot: string,
  projectRoot: string,
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
  await inspectProtectedProjectPath(projectRoot, projectRelative(projectRoot, archiveRoot), {
    label: 'Classic archive root',
    expected: 'directory',
  });
  const items: ChangeDashboardItem[] = [];

  for (const entry of entries) {
    const dir = path.join(archiveRoot, entry);
    if (!(await safeProjectDirectoryExists(projectRoot, dir, `Classic archive ${entry}`))) continue;

    const item = await tryBuildChangeItem({ name: entry, dir, status: 'archived', projectRoot });
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
    id: input.status === 'archived' ? `archive/${input.name}` : input.name,
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
