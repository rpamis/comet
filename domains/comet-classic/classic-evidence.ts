import path from 'path';
import { inspectClassicPlanReadiness } from './classic-plan-readiness.js';
import { parseClassicTasks } from './classic-tasks.js';
import { collectClassicSpecFiles } from './classic-paths.js';
import type { ClassicStateProjection } from './classic-state.js';
import {
  assertClassicLayoutReadable,
  classicLayoutPaths,
  classicProjectRelative,
  discoverClassicProject,
  type ClassicLayoutPaths,
} from './classic-layout.js';
import { readLegacyArchivedHandoffFallback } from './classic-archive-pointer.js';
import {
  inspectProtectedProjectPath,
  protectedProjectFileExists,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';

export interface ClassicEvidence {
  code: string;
  satisfied: boolean;
  source?: string;
  resolvedSource?: string;
  detail?: string;
}

const CLASSIC_ARTIFACT_MAX_BYTES = 2 * 1024 * 1024;

function relativeSource(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

async function linkedFileEvidence(
  projectRoot: string,
  code: string,
  relativePath: string | null,
  layout?: ClassicLayoutPaths,
  layoutError?: unknown,
): Promise<ClassicEvidence> {
  if (!relativePath) return { code, satisfied: false };
  const source = relativePath.replaceAll('\\', '/');
  if (layoutError) {
    return {
      code,
      satisfied: false,
      source,
      detail: `Classic layout is unsafe or unavailable: ${
        layoutError instanceof Error ? layoutError.message : String(layoutError)
      }`,
    };
  }
  try {
    if (layout) {
      const alternateLayout = layout.artifactLayout === 'legacy' ? 'docs' : 'legacy';
      const alternateRoot = classicProjectRelative(
        projectRoot,
        classicLayoutPaths(projectRoot, alternateLayout).openSpecRoot,
      );
      if (source === alternateRoot || source.startsWith(`${alternateRoot}/`)) {
        const alternate = await inspectProtectedProjectPath(projectRoot, source, {
          label: `${code} artifact`,
          expected: 'file',
        });
        if (alternate.exists) {
          return {
            code,
            satisfied: false,
            source,
            detail: 'standalone OpenSpec root is not a Comet artifact root',
          };
        }
      }
    }
    const satisfied = await protectedProjectFileExists(projectRoot, source, {
      label: `${code} artifact`,
    });
    return {
      code,
      satisfied,
      source,
      ...(satisfied ? { resolvedSource: source } : {}),
    };
  } catch (error) {
    return {
      code,
      satisfied: false,
      source,
      detail: `unsafe artifact pointer outside the project or through a special path: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function archivedHandoffEvidence(
  projectRoot: string,
  changeDir: string,
  relativePath: string | null,
  layout?: ClassicLayoutPaths,
): Promise<ClassicEvidence> {
  try {
    layout ??= await assertClassicLayoutReadable(projectRoot);
  } catch (error) {
    return {
      code: 'design.handoff',
      satisfied: false,
      ...(relativePath ? { source: relativePath.replaceAll('\\', '/') } : {}),
      detail: `Classic layout is unsafe or unavailable for handoff evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const evidence = await linkedFileEvidence(projectRoot, 'design.handoff', relativePath, layout);
  if (!relativePath || evidence.satisfied || evidence.detail) return evidence;
  try {
    const mapped = await readLegacyArchivedHandoffFallback(
      projectRoot,
      changeDir,
      relativePath,
      CLASSIC_ARTIFACT_MAX_BYTES,
    );
    if (!mapped) return evidence;
    return {
      ...evidence,
      satisfied: true,
      resolvedSource: mapped,
      detail: `resolved historical legacy pointer from archived change: ${mapped}`,
    };
  } catch (error) {
    return {
      ...evidence,
      satisfied: false,
      detail: `unsafe archived handoff fallback: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

async function directFileEvidence(
  projectRoot: string,
  code: string,
  file: string,
): Promise<ClassicEvidence> {
  return linkedFileEvidence(projectRoot, code, relativeSource(projectRoot, file));
}

async function deltaSpecEvidence(projectRoot: string, changeDir: string): Promise<ClassicEvidence> {
  const specsDir = path.join(changeDir, 'specs');
  let existing: string[];
  try {
    existing = await collectClassicSpecFiles(projectRoot, specsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { code: 'openspec.delta-spec', satisfied: false };
    }
    return {
      code: 'openspec.delta-spec',
      satisfied: false,
      detail: `unsafe delta-spec path: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    code: 'openspec.delta-spec',
    satisfied: existing.length > 0,
    source: existing[0] ? relativeSource(projectRoot, existing[0]) : undefined,
    detail: `${existing.length} delta spec${existing.length === 1 ? '' : 's'}`,
  };
}

async function taskEvidence(projectRoot: string, tasksFile: string): Promise<ClassicEvidence> {
  let source: string;
  const relative = relativeSource(projectRoot, tasksFile);
  try {
    source = (
      await readProtectedProjectFile(projectRoot, relative, CLASSIC_ARTIFACT_MAX_BYTES, {
        label: 'Classic tasks artifact',
      })
    ).bytes.toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { code: 'build.tasks-complete', satisfied: false };
    }
    return {
      code: 'build.tasks-complete',
      satisfied: false,
      source: relative,
      detail: `unsafe tasks artifact: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const tasks = parseClassicTasks(source);
  const complete = tasks.filter((task) => task.completed).length;
  return {
    code: 'build.tasks-complete',
    satisfied: tasks.length > 0 && complete === tasks.length,
    source: relative,
    detail: `${complete} of ${tasks.length} tasks complete`,
  };
}

export function evidenceSatisfied(evidence: readonly ClassicEvidence[], code: string): boolean {
  return evidence.some((item) => item.code === code && item.satisfied);
}

export async function collectClassicEvidence(
  changeDir: string,
  projection: ClassicStateProjection,
): Promise<ClassicEvidence[]> {
  const projectRoot = await discoverClassicProject(changeDir);
  const classic = projection.classic;
  const proposal = path.join(changeDir, 'proposal.md');
  const design = path.join(changeDir, 'design.md');
  const tasks = path.join(changeDir, 'tasks.md');
  const checkpoint = projection.run
    ? path.resolve(changeDir, projection.run.checkpointRef)
    : path.join(changeDir, '.comet', 'checkpoint.json');
  let layout: ClassicLayoutPaths | undefined;
  let layoutError: unknown;
  try {
    layout = await assertClassicLayoutReadable(projectRoot);
  } catch (error) {
    layoutError = error;
    // The individual evidence item keeps reporting the precise unavailable
    // layout error; pointers are only scoped when a valid layout is known.
  }

  const evidence = await Promise.all([
    directFileEvidence(projectRoot, 'openspec.proposal', proposal),
    directFileEvidence(projectRoot, 'openspec.design', design),
    directFileEvidence(projectRoot, 'openspec.tasks', tasks),
    deltaSpecEvidence(projectRoot, changeDir),
    linkedFileEvidence(
      projectRoot,
      'design.document',
      classic?.designDoc ?? null,
      layout,
      layoutError,
    ),
    (async (): Promise<ClassicEvidence> => {
      const item = await linkedFileEvidence(
        projectRoot,
        'build.plan',
        classic?.plan ?? null,
        layout,
        layoutError,
      );
      if (!item.satisfied) return item;
      try {
        const readiness = await inspectClassicPlanReadiness(projectRoot, classic?.plan ?? null, {
          requireNonempty: classic?.buildMode === 'autonomous',
        });
        if (readiness.status === 'ready') return item;
        return {
          code: item.code,
          source: item.source,
          satisfied: false,
          detail: `Implementation plan is ${readiness.status}`,
        };
      } catch (error) {
        return {
          code: item.code,
          source: item.source,
          satisfied: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    })(),
    taskEvidence(projectRoot, tasks),
    linkedFileEvidence(
      projectRoot,
      'verification.report',
      classic?.verificationReport ?? null,
      layout,
      layoutError,
    ),
    archivedHandoffEvidence(projectRoot, changeDir, classic?.handoffContext ?? null, layout),
    directFileEvidence(projectRoot, 'run.checkpoint', checkpoint),
  ]);

  const handoff = evidence.find((item) => item.code === 'design.handoff');
  if (handoff && !classic?.handoffHash) {
    handoff.satisfied = false;
    handoff.detail = 'handoff hash is missing';
  }

  evidence.push({
    code: 'archive.confirmed',
    satisfied: classic?.archiveConfirmation === 'confirmed',
  });

  return evidence;
}
