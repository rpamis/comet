import { promises as fs } from 'fs';
import path from 'path';
import type { ClassicStateProjection } from './classic-state.js';
import { assertClassicLayoutReadable, discoverClassicProject } from './classic-layout.js';
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
): Promise<ClassicEvidence> {
  if (!relativePath) return { code, satisfied: false };
  const source = relativePath.replaceAll('\\', '/');
  try {
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
): Promise<ClassicEvidence> {
  try {
    await assertClassicLayoutReadable(projectRoot);
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
  const evidence = await linkedFileEvidence(projectRoot, 'design.handoff', relativePath);
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
  let entries: string[];
  try {
    const relativeSpecs = relativeSource(projectRoot, specsDir);
    const inspection = await inspectProtectedProjectPath(projectRoot, relativeSpecs, {
      label: 'OpenSpec delta-spec directory',
      expected: 'directory',
    });
    if (!inspection.exists) {
      return { code: 'openspec.delta-spec', satisfied: false };
    }
    entries = await fs.readdir(specsDir);
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
  const candidates = entries.map((entry) => path.join(specsDir, entry, 'spec.md'));
  const existing = (
    await Promise.all(
      candidates.map(async (file) => {
        try {
          return (await protectedProjectFileExists(projectRoot, relativeSource(projectRoot, file), {
            label: 'OpenSpec delta spec',
          }))
            ? file
            : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((file): file is string => file !== null);
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
  const tasks = [...source.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gmu)];
  const complete = tasks.filter((match) => match[1].toLowerCase() === 'x').length;
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

  const evidence = await Promise.all([
    directFileEvidence(projectRoot, 'openspec.proposal', proposal),
    directFileEvidence(projectRoot, 'openspec.design', design),
    directFileEvidence(projectRoot, 'openspec.tasks', tasks),
    deltaSpecEvidence(projectRoot, changeDir),
    linkedFileEvidence(projectRoot, 'design.document', classic?.designDoc ?? null),
    linkedFileEvidence(projectRoot, 'build.plan', classic?.plan ?? null),
    taskEvidence(projectRoot, tasks),
    linkedFileEvidence(projectRoot, 'verification.report', classic?.verificationReport ?? null),
    archivedHandoffEvidence(projectRoot, changeDir, classic?.handoffContext ?? null),
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
