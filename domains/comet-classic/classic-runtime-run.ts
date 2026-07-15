import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectClassicEvidence } from './classic-evidence.js';
import { ensureClassicRun, type ClassicRunContext } from './classic-migrate.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { readClassicState, writeClassicState } from './classic-store.js';
import {
  CLASSIC_MIGRATION_VERSION,
  type ClassicState,
  type ClassicStateProjection,
} from './classic-state.js';
import { appendTrajectory, readTrajectory } from '../../domains/engine/run-store.js';
import type { RunState } from '../../domains/engine/types.js';
import { loadRuntimePackage, loadSkillPackage } from '../../domains/skill/load.js';
import { readSkillSnapshot } from '../../domains/skill/snapshot.js';
import type { SkillPackage } from '../../domains/skill/types.js';

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isClassicRuntimePackageRoot(root: string): Promise<boolean> {
  if (!(await directoryExists(root))) return false;
  if (await fileExists(path.join(root, 'skill.yaml'))) return true;
  return (
    (await fileExists(path.join(root, 'SKILL.md'))) &&
    (await fileExists(path.join(root, 'comet', 'skill.yaml')))
  );
}

function embeddedClassicRuntimePackage(root: string): SkillPackage {
  return {
    root,
    packageKind: 'runtime',
    definition: {
      apiVersion: 'comet/v1alpha1',
      kind: 'Skill',
      metadata: {
        name: 'comet-classic',
        version: '1',
        description:
          'Internal compatibility orchestration for classic Comet full, hotfix, and tweak workflows',
      },
      goal: {
        statement:
          'Advance or restore a classic Comet Run without changing the user command surface',
        inputs: [
          {
            name: 'classic-state',
            description: 'Validated ClassicState consistent with the Run projection',
            required: true,
          },
          {
            name: 'evidence',
            description: 'Structured evidence produced by the Classic Evidence collector',
            required: true,
          },
        ],
        outputs: [
          {
            name: 'run-state',
            description: 'Atomically synchronized Classic and Run state',
            required: true,
          },
        ],
        success: [
          'Legacy fields and Run fields remain consistent',
          'Every step invokes only a declared public Comet Skill',
          'The completed state passes its completion eval',
        ],
      },
      orchestration: {
        mode: 'deterministic',
        entry: 'full.open',
        steps: [
          {
            id: 'full.open',
            action: { type: 'invoke_skill', ref: 'comet-open' },
            next: 'full.design.handoff',
          },
          {
            id: 'full.design.handoff',
            action: { type: 'invoke_skill', ref: 'comet-design' },
            next: 'full.design.document',
          },
          {
            id: 'full.design.document',
            action: { type: 'invoke_skill', ref: 'comet-design' },
            next: 'full.build.plan',
          },
          {
            id: 'full.build.plan',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.plan-ready',
          },
          {
            id: 'full.build.plan-ready',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.configure',
          },
          {
            id: 'full.build.configure',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.execute',
          },
          {
            id: 'full.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.complete',
          },
          {
            id: 'full.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.verify.run',
          },
          {
            id: 'full.build.fix',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'full.build.execute',
          },
          {
            id: 'full.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'full.verify.branch',
          },
          {
            id: 'full.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'full.archive.confirm',
          },
          {
            id: 'full.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'full.archive.execute',
          },
          {
            id: 'full.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'hotfix.open',
            action: { type: 'invoke_skill', ref: 'comet-hotfix' },
            next: 'hotfix.build.execute',
          },
          {
            id: 'hotfix.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'hotfix.build.complete',
          },
          {
            id: 'hotfix.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'hotfix.verify.run',
          },
          {
            id: 'hotfix.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'hotfix.verify.branch',
          },
          {
            id: 'hotfix.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'hotfix.archive.confirm',
          },
          {
            id: 'hotfix.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'hotfix.archive.execute',
          },
          {
            id: 'hotfix.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'tweak.open',
            action: { type: 'invoke_skill', ref: 'comet-tweak' },
            next: 'tweak.build.execute',
          },
          {
            id: 'tweak.build.execute',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'tweak.build.complete',
          },
          {
            id: 'tweak.build.complete',
            action: { type: 'invoke_skill', ref: 'comet-build' },
            next: 'tweak.verify.run',
          },
          {
            id: 'tweak.verify.run',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'tweak.verify.branch',
          },
          {
            id: 'tweak.verify.branch',
            action: { type: 'invoke_skill', ref: 'comet-verify' },
            next: 'tweak.archive.confirm',
          },
          {
            id: 'tweak.archive.confirm',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'tweak.archive.execute',
          },
          {
            id: 'tweak.archive.execute',
            action: { type: 'invoke_skill', ref: 'comet-archive' },
            next: 'completed',
          },
          {
            id: 'completed',
            action: { type: 'checkpoint' },
            completionEvals: ['classic-completed'],
          },
        ],
      },
      skills: [
        { id: 'comet-open' },
        { id: 'comet-design' },
        { id: 'comet-build' },
        { id: 'comet-verify' },
        { id: 'comet-archive' },
        { id: 'comet-hotfix' },
        { id: 'comet-tweak' },
      ],
      agents: [],
      tools: [],
    },
    guardrails: {
      allowedSkills: [
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-verify',
        'comet-archive',
        'comet-hotfix',
        'comet-tweak',
      ],
      allowedAgents: [],
      allowedTools: [],
      maxIterations: 500,
      maxRetriesPerAction: 3,
      confirmationRequiredFor: [],
    },
    evals: [
      {
        id: 'classic-completed',
        scope: 'completion',
        type: 'state_equals',
        field: 'status',
        equals: 'completed',
      },
    ],
  };
}

async function classicRuntimeRoot(): Promise<string | null> {
  const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.COMET_RUNTIME_CLASSIC_ROOT,
    path.resolve(runtimeDirectory, '..', 'runtime', 'classic'),
    path.resolve(runtimeDirectory, '..', '..', 'comet', 'runtime', 'classic'),
    path.resolve(runtimeDirectory, '..', '..', 'assets', 'skills', 'comet', 'runtime', 'classic'),
    path.resolve('assets', 'skills', 'comet', 'runtime', 'classic'),
    process.env.COMET_CLASSIC_SKILL_ROOT,
    path.resolve(runtimeDirectory, '..', '..', 'comet-classic'),
    path.resolve(runtimeDirectory, '..', '..', 'assets', 'skills', 'comet-classic'),
    path.resolve('assets', 'skills', 'comet-classic'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await isClassicRuntimePackageRoot(candidate)) return candidate;
  }
  return null;
}

async function loadClassicRuntimePackage(root: string) {
  if (await fileExists(path.join(root, 'skill.yaml'))) {
    return loadRuntimePackage(root);
  }
  return loadSkillPackage(root);
}

export async function ensureClassicRuntimeRun(changeDir: string): Promise<ClassicRunContext> {
  const root = await classicRuntimeRoot();
  return ensureClassicRun(changeDir, {
    skillPackage: root
      ? await loadClassicRuntimePackage(root)
      : embeddedClassicRuntimePackage(path.dirname(fileURLToPath(import.meta.url))),
  });
}

export async function ensureStrictClassicRuntimeRun(changeDir: string): Promise<ClassicRunContext> {
  const projection = await readClassicState(changeDir);
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
  }
  return ensureClassicRuntimeRun(changeDir);
}

export async function validateClassicRuntimeRun(
  changeDir: string,
  existingProjection?: ClassicStateProjection,
): Promise<ClassicRunContext> {
  const projection = existingProjection ?? (await readClassicState(changeDir, { migrate: false }));
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`);
  }
  if (!projection.classic || !projection.run) {
    throw new Error('Classic runtime validation requires synchronized Classic and Run projections');
  }
  if (projection.classic.classicMigration !== CLASSIC_MIGRATION_VERSION) {
    throw new Error('Classic Run exists without a supported classic_migration marker');
  }

  const root = await classicRuntimeRoot();
  const skillPackage = root
    ? await loadClassicRuntimePackage(root)
    : embeddedClassicRuntimePackage(path.dirname(fileURLToPath(import.meta.url)));
  if (projection.run.skill !== skillPackage.definition.metadata.name) {
    throw new Error(
      `Classic Run skill mismatch: expected ${skillPackage.definition.metadata.name}, got ${projection.run.skill}`,
    );
  }

  const snapshot = await readSkillSnapshot(changeDir, projection.run.skillHash);
  if (snapshot.definition.metadata.name !== projection.run.skill) {
    throw new Error(
      `Classic Run snapshot skill mismatch: expected ${projection.run.skill}, got ${snapshot.definition.metadata.name}`,
    );
  }
  const evidence = await collectClassicEvidence(changeDir, projection);
  const currentStep = resolveClassicStepId(projection.classic, evidence);
  if (projection.run.currentStep !== currentStep) {
    throw new Error(
      `Classic Run step mismatch: expected ${currentStep}, got ${projection.run.currentStep}`,
    );
  }
  return {
    classic: projection.classic,
    run: projection.run,
    evidence,
    migrated: false,
    snapshotDir: path.join(changeDir, '.comet', 'skill-snapshots', projection.run.skillHash),
  };
}

export async function transitionClassicRuntimeRun(
  changeDir: string,
  classic: ClassicState,
  run: RunState,
  data: Record<string, unknown>,
): Promise<RunState> {
  const projection = await readClassicState(changeDir);
  if (!projection.classic || !projection.run) {
    throw new Error('Classic transition requires synchronized Classic and Run projections');
  }

  const evidence = await collectClassicEvidence(changeDir, {
    classic,
    run,
    unknownKeys: projection.unknownKeys,
  });
  const currentStep = resolveClassicStepId(classic, evidence);
  const nextRun: RunState = {
    ...run,
    currentStep,
    iteration: run.iteration + 1,
    status: currentStep === 'completed' ? 'completed' : 'running',
  };

  await writeClassicState(changeDir, {
    classic,
    run: nextRun,
    unknownKeys: projection.unknownKeys,
  });

  const trajectory = await readTrajectory(changeDir, nextRun.trajectoryRef);
  await appendTrajectory(changeDir, nextRun.trajectoryRef, {
    sequence: trajectory.length + 1,
    timestamp: new Date().toISOString(),
    type: 'state_transitioned',
    runId: nextRun.runId,
    data: {
      kind: 'classic',
      fromStep: run.currentStep,
      toStep: currentStep,
      ...data,
    },
  });
  return nextRun;
}
