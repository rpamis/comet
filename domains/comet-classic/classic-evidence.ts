import { promises as fs } from 'fs';
import path from 'path';
import type { ClassicStateProjection } from './classic-state.js';

export interface ClassicEvidence {
  code: string;
  satisfied: boolean;
  source?: string;
  detail?: string;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function projectRootFor(changeDir: string): string {
  let cursor = path.resolve(changeDir);
  while (path.dirname(cursor) !== cursor) {
    if (path.basename(cursor) === 'openspec') return path.dirname(cursor);
    cursor = path.dirname(cursor);
  }
  throw new Error(`Classic change is not inside an openspec directory: ${changeDir}`);
}

function relativeSource(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}

async function linkedFileEvidence(
  projectRoot: string,
  code: string,
  relativePath: string | null,
): Promise<ClassicEvidence> {
  if (!relativePath) return { code, satisfied: false };
  const file = path.resolve(projectRoot, relativePath);
  return {
    code,
    satisfied: await fileExists(file),
    source: relativeSource(projectRoot, file),
  };
}

async function directFileEvidence(
  projectRoot: string,
  code: string,
  file: string,
): Promise<ClassicEvidence> {
  return {
    code,
    satisfied: await fileExists(file),
    source: relativeSource(projectRoot, file),
  };
}

async function deltaSpecEvidence(projectRoot: string, changeDir: string): Promise<ClassicEvidence> {
  const specsDir = path.join(changeDir, 'specs');
  let entries: string[];
  try {
    entries = await fs.readdir(specsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { code: 'openspec.delta-spec', satisfied: false };
    }
    throw error;
  }
  const candidates = entries.map((entry) => path.join(specsDir, entry, 'spec.md'));
  const existing = (
    await Promise.all(candidates.map(async (file) => ((await fileExists(file)) ? file : null)))
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
  try {
    source = await fs.readFile(tasksFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { code: 'build.tasks-complete', satisfied: false };
    }
    throw error;
  }
  const tasks = [...source.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+/gmu)];
  const complete = tasks.filter((match) => match[1].toLowerCase() === 'x').length;
  return {
    code: 'build.tasks-complete',
    satisfied: tasks.length > 0 && complete === tasks.length,
    source: relativeSource(projectRoot, tasksFile),
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
  const projectRoot = projectRootFor(changeDir);
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
    linkedFileEvidence(projectRoot, 'design.handoff', classic?.handoffContext ?? null),
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
