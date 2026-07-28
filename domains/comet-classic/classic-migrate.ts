import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { collectClassicEvidence, type ClassicEvidence } from './classic-evidence.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { readClassicState, writeClassicState } from './classic-store.js';
import {
  CLASSIC_MIGRATION_VERSION,
  type ClassicProfile,
  type ClassicState,
} from './classic-state.js';
import { startRun } from '../../domains/engine/loop.js';
import {
  appendTrajectory,
  writeArtifacts,
  writeCheckpoint,
  writeContext,
} from '../../domains/engine/run-store.js';
import type { Checkpoint, RunState, TrajectoryEvent } from '../../domains/engine/types.js';
import {
  createSkillSnapshot,
  hashSkillPackage,
  readSkillSnapshot,
} from '../../domains/skill/snapshot.js';
import type { SkillPackage } from '../../domains/skill/types.js';
import { discoverClassicProject } from './classic-layout.js';
import { readClassicProjectFile } from './classic-protected-path.js';

export interface ClassicRunContext {
  classic: ClassicState;
  run: RunState;
  evidence: ClassicEvidence[];
  migrated: boolean;
  snapshotDir: string;
}

export interface EnsureClassicRunOptions {
  skillPackage: SkillPackage;
  now?: () => Date;
  runId?: () => string;
  handoffReadHooks?: {
    afterOpen?: () => void | Promise<void>;
    beforeFinalCheck?: () => void | Promise<void>;
  };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function artifactHash(artifacts: Record<string, string>): string {
  return sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)),
      ),
    ),
  );
}

function artifactKey(code: string): string {
  return code.replaceAll('.', '_').replaceAll('-', '_');
}

async function migrationArtifacts(
  changeDir: string,
  evidence: readonly ClassicEvidence[],
): Promise<Record<string, string>> {
  const projectRoot = await discoverClassicProject(changeDir);
  const artifacts = Object.fromEntries(
    evidence
      .filter((item) => item.satisfied && item.source)
      .map((item) => [artifactKey(item.code), item.source!]),
  );
  const progress = path.join(changeDir, 'subagent-progress.md');
  if (await pathExists(progress)) {
    artifacts.subagent_progress = path.relative(projectRoot, progress).split(path.sep).join('/');
  }
  const handoff = evidence.find((item) => item.code === 'design.handoff' && item.satisfied);
  if (handoff?.source) artifacts.handoff_context = handoff.source;
  return artifacts;
}

function migrationEvents(
  run: RunState,
  profile: ClassicProfile,
  timestamp: string,
): TrajectoryEvent[] {
  return [
    {
      sequence: 1,
      timestamp,
      type: 'run_started',
      runId: run.runId,
      data: {
        skill: run.skill,
        skillVersion: run.skillVersion,
        skillHash: run.skillHash,
      },
    },
    {
      sequence: 2,
      timestamp,
      type: 'state_migrated',
      runId: run.runId,
      data: {
        kind: 'classic',
        migrationVersion: CLASSIC_MIGRATION_VERSION,
        profile,
        source: 'pre-migration',
      },
    },
  ];
}

async function removeCreatedFiles(files: readonly string[]): Promise<void> {
  await Promise.all(files.map((file) => fs.rm(file, { recursive: true, force: true })));
}

export async function ensureClassicRun(
  changeDir: string,
  options: EnsureClassicRunOptions,
): Promise<ClassicRunContext> {
  const projection = await readClassicState(changeDir);
  if (!projection.classic) {
    throw new Error('Classic migration requires a legacy state projection');
  }
  const classic = projection.classic;
  const profile = classic.classicProfile ?? classic.workflow;

  if (projection.run) {
    if (classic.classicMigration !== CLASSIC_MIGRATION_VERSION) {
      throw new Error('Classic Run exists without a supported classic_migration marker');
    }
    if (projection.run.skill !== options.skillPackage.definition.metadata.name) {
      throw new Error(
        `Classic Run skill mismatch: expected ${options.skillPackage.definition.metadata.name}, got ${projection.run.skill}`,
      );
    }
    const installedHash = await hashSkillPackage(options.skillPackage);
    if (installedHash !== projection.run.skillHash) {
      await readSkillSnapshot(changeDir, projection.run.skillHash);
      return {
        classic,
        run: projection.run,
        evidence: await collectClassicEvidence(changeDir, projection),
        migrated: false,
        snapshotDir: path.join(changeDir, '.comet', 'skill-snapshots', projection.run.skillHash),
      };
    }

    const snapshot = await createSkillSnapshot(options.skillPackage, changeDir);
    return {
      classic,
      run: projection.run,
      evidence: await collectClassicEvidence(changeDir, projection),
      migrated: false,
      snapshotDir: snapshot.snapshotDir,
    };
  }

  const evidence = await collectClassicEvidence(changeDir, projection);
  const step = resolveClassicStepId(classic, evidence);
  if (!options.skillPackage.definition.orchestration.steps?.some((item) => item.id === step)) {
    throw new Error(`Classic Skill package does not define resolved step: ${step}`);
  }

  const expectedHash = await hashSkillPackage(options.skillPackage);
  const expectedSnapshotDir = path.join(changeDir, '.comet', 'skill-snapshots', expectedHash);
  const snapshotExisted = await pathExists(expectedSnapshotDir);
  const createdFiles: string[] = [];

  try {
    const snapshot = await createSkillSnapshot(options.skillPackage, changeDir);
    const run = startRun(options.skillPackage, options.runId?.() ?? randomUUID(), snapshot.hash);
    run.currentStep = step;
    if (step === 'completed') run.status = 'completed';

    const migratedClassic: ClassicState = {
      ...classic,
      classicProfile: profile,
      classicMigration: CLASSIC_MIGRATION_VERSION,
    };
    const artifacts = await migrationArtifacts(changeDir, evidence);
    const projectRoot = await discoverClassicProject(changeDir);
    const handoff = evidence.find((item) => item.code === 'design.handoff' && item.satisfied);
    let context: string | null = null;
    if (handoff?.source) {
      context = await readClassicProjectFile(
        projectRoot,
        handoff.resolvedSource ?? handoff.source,
        {
          label: 'Classic migration handoff context',
          hooks: options.handoffReadHooks,
        },
      );
      await writeContext(changeDir, run.contextRef, context);
      createdFiles.push(path.resolve(changeDir, run.contextRef));
    }

    await writeArtifacts(changeDir, run.artifactsRef, artifacts);
    createdFiles.push(path.resolve(changeDir, run.artifactsRef));

    const timestamp = (options.now?.() ?? new Date()).toISOString();
    const checkpoint: Checkpoint = {
      runId: run.runId,
      stateVersion: 1,
      trajectoryOffset: 2,
      contextHash: context === null ? null : sha256(context),
      artifactsHash: artifactHash(artifacts),
      createdAt: timestamp,
    };
    await writeCheckpoint(changeDir, run.checkpointRef, checkpoint);
    createdFiles.push(path.resolve(changeDir, run.checkpointRef));

    createdFiles.push(path.resolve(changeDir, run.trajectoryRef));
    for (const event of migrationEvents(run, profile, timestamp)) {
      await appendTrajectory(changeDir, run.trajectoryRef, event);
    }

    await writeClassicState(changeDir, {
      classic: migratedClassic,
      run,
      unknownKeys: projection.unknownKeys,
    });

    return {
      classic: migratedClassic,
      run,
      evidence,
      migrated: true,
      snapshotDir: snapshot.snapshotDir,
    };
  } catch (error) {
    await removeCreatedFiles(createdFiles);
    if (!snapshotExisted) await fs.rm(expectedSnapshotDir, { recursive: true, force: true });
    throw error;
  }
}
