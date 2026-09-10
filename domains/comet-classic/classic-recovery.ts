import path from 'node:path';
import type { ClassicState } from './classic-state.js';
import { assertClassicLayoutReadable } from './classic-layout.js';
import { classicProjectTargetExists, readClassicProjectFile } from './classic-protected-path.js';
import {
  classicTaskRevision,
  inspectClassicPlanTasks,
  parseClassicTasks,
} from './classic-tasks.js';
import { readClassicCheckpoint, readClassicDelivery } from './classic-progress.js';
import { inspectClassicPlanReadiness } from './classic-plan-readiness.js';
import { inspectClassicDesignReadiness } from './classic-design-readiness.js';
import { readClassicState } from './classic-store.js';

export interface ClassicNextAction {
  kind: string;
  reason: string;
  taskId?: string | null;
  cwd?: string;
  argv?: string[];
}

/** A compact projection shared by normal entry and cold recovery, not another state machine. */
export async function classicRecoveryContext(
  root: string,
  directory: string,
  state: ClassicState,
  details = false,
) {
  const paths = await assertClassicLayoutReadable(root);
  const projection = await readClassicState(directory, { migrate: false });
  const taskFile = path.join(directory, 'tasks.md');
  const taskFileExists = await classicProjectTargetExists(root, taskFile, {
    label: 'Classic task authority',
    expected: 'file',
  });
  const source = taskFileExists
    ? await readClassicProjectFile(root, taskFile, { label: 'Classic recovery task authority' })
    : '';
  const tasks = parseClassicTasks(source);
  const next = tasks.find((task) => !task.completed) ?? null;
  const planExists = Boolean(
    state.plan &&
    (await classicProjectTargetExists(root, state.plan, {
      label: 'Classic plan',
      expected: 'file',
    })),
  );
  const plan = planExists
    ? await readClassicProjectFile(root, state.plan!, { label: 'Classic recovery plan mapping' })
    : '';
  const mapping = inspectClassicPlanTasks(plan, tasks);
  const planReadiness =
    state.workflow === 'full' ? await inspectClassicPlanReadiness(root, state.plan) : null;
  const coordination = await readClassicCheckpoint(root, directory, source);
  const delivery = state.phase === 'archive' ? await readClassicDelivery(root, directory) : null;
  let nextAction: ClassicNextAction = {
    kind: 'continue-phase',
    reason: 'Continue the current phase using confirmed artifacts.',
  };
  const designReadiness =
    state.phase === 'design' ? await inspectClassicDesignReadiness(root, directory, state) : null;
  if (designReadiness) {
    nextAction = {
      kind:
        designReadiness.design === 'invalid'
          ? 'repair-design'
          : designReadiness.design === 'missing'
            ? 'design'
            : 'complete-design',
      reason:
        designReadiness.design === 'invalid'
          ? 'Repair only the reported Design Doc metadata or reference; preserve existing confirmed work.'
          : designReadiness.design === 'missing'
            ? 'Continue the existing design and obtain explicit confirmation before registering it.'
            : `Retain the registered Design Doc. Handoff is ${designReadiness.handoff}; after confirming recorded user authorization, complete only the remaining Design steps.`,
      ...(designReadiness.design === 'ready'
        ? {
            cwd: root,
            argv: [
              'comet',
              'state',
              'complete-design',
              path.basename(directory),
              '--design-doc',
              state.designDoc!,
              '--json',
            ],
          }
        : {}),
    };
  } else if (state.phase === 'build') {
    if (state.workflow === 'full' && !state.isolation)
      nextAction = {
        kind: 'workspace',
        reason:
          'Resume /comet-open to restore the missing isolation decision without regenerating valid artifacts.',
      };
    else if (
      state.workflow === 'full' &&
      (!state.buildMode ||
        !state.tddMode ||
        !state.reviewMode ||
        (state.buildMode === 'autonomous' && state.reviewMode === 'off') ||
        (state.buildMode === 'subagent-driven-development' &&
          state.subagentDispatch !== 'confirmed'))
    )
      nextAction = {
        kind: 'configure',
        reason:
          'Complete only missing execution, TDD and review decisions in /comet-build before planning; retain confirmed settings and any valid plan.',
      };
    else if (state.workflow === 'full' && planReadiness?.status !== 'ready')
      nextAction = {
        kind: 'plan',
        reason:
          state.buildMode === 'autonomous'
            ? 'Restore or create the compact implementation plan in the configured plans directory using confirmed design and task IDs. No external planning Skill is required. Preserve existing work.'
            : 'Restore the implementation plan in the configured plans directory, or use the confirmed planning method to create it. Preserve existing work and confirmed execution strategy.',
      };
    else if (mapping.unmapped.length)
      nextAction = {
        kind: 'reconcile-plan',
        reason:
          'Inspect implementation and acceptance, then map legacy plan items to task IDs or add genuinely extra tasks. Do not reimplement from checkbox state.',
      };
    else if (state.buildPause)
      nextAction = {
        kind: 'paused',
        reason:
          'Keep the valid plan and confirmed configuration. Clear the explicit plan-ready pause only after the user asks to continue.',
      };
    else if (!tasks.length)
      nextAction = {
        kind: 'reconcile-task',
        reason: 'Restore the task authority and match existing work before proceeding.',
      };
    else if (next)
      nextAction = {
        kind: 'reconcile-task',
        taskId: next.id,
        reason:
          'Check current code, checks and review evidence. Record accepted completion; otherwise finish only the missing implementation, checks or review.',
      };
    else
      nextAction = {
        kind: 'check',
        reason:
          'All tasks done in the authoritative tasks.md. Revalidate or execute Build checks, then run guard --apply.',
      };
    if (nextAction.kind === 'reconcile-task' && coordination.checkpoint && !coordination.stale) {
      const checkpointTask = tasks.find(
        (task) => coordination.checkpoint!.taskIds.includes(task.id ?? '') && !task.completed,
      );
      if (checkpointTask)
        nextAction = {
          kind:
            coordination.checkpoint.stage === 'task-review'
              ? 'review'
              : ['checkoff', 'done'].includes(coordination.checkpoint.stage)
                ? coordination.checkpoint.unresolved.length
                  ? 'blocked'
                  : 'checkoff'
                : coordination.checkpoint.stage === 'blocked'
                  ? 'blocked'
                  : 'reconcile-task',
          taskId: checkpointTask.id,
          reason:
            ['checkoff', 'done'].includes(coordination.checkpoint.stage) &&
            coordination.checkpoint.unresolved.length
              ? 'Resolve the recorded unresolved items and reconcile acceptance evidence before recording task completion.'
              : 'Reconcile the recorded work package with current code and evidence, then resume its exact missing step; do not restart implementation from checkbox state.',
        };
    }
  } else if (state.phase === 'verify') {
    nextAction = {
      kind: state.verifyResult === 'pass' ? 'transition' : 'verify',
      reason:
        state.verifyResult === 'pass'
          ? 'Verification passed; continue to Archive.'
          : 'Resume missing checks or independent review; retain valid evidence.',
    };
  } else if (state.phase === 'archive') {
    nextAction = {
      kind: state.archived
        ? 'delivery'
        : state.archiveConfirmation === 'confirmed'
          ? 'archive'
          : 'confirm-archive',
      reason: state.archived
        ? 'Do not archive again. Inspect recorded authorization and actual delivery before continuing.'
        : 'Preserve explicit archive and delivery authorization; do not infer it from branch_status.',
    };
  }
  return {
    projectRoot: root,
    workspace: { projectRoot: root },
    status: projection.run?.status ?? null,
    stateVersion: null,
    iteration: projection.run?.iteration ?? null,
    changeDir: directory,
    artifactRefs: {
      change: path.relative(root, directory).replaceAll('\\', '/'),
      tasks: path.relative(root, taskFile).replaceAll('\\', '/'),
      designDoc:
        state.designDoc ??
        path.relative(root, path.join(directory, 'design.md')).replaceAll('\\', '/'),
      plan: state.plan,
      plansRoot: path
        .relative(root, path.join(paths.superpowersRoot, 'plans'))
        .replaceAll('\\', '/'),
      handoffContext: state.handoffContext,
    },
    ...(designReadiness ? { designReadiness, issues: designReadiness.issues } : {}),
    layout: {
      schema: 'comet.classic-layout.v1',
      openSpecRoot: paths.openSpecRoot,
      changesRoot: paths.changesDir,
      archiveRoot: paths.archiveDir,
      specsRoot: paths.specsDir,
      superpowersRoot: paths.superpowersRoot,
    },
    nextAction,
    continuation: {
      ...nextAction,
      cwd: root,
      skill:
        state.phase === 'build' && ['hotfix', 'tweak'].includes(state.workflow)
          ? `comet-${state.workflow}`
          : `comet-${state.phase}`,
      automatic: state.autoTransition ?? true,
    },
    evidence: { status: 'not-revalidated', reason: 'entry' },
    nextTask: next?.text ?? null,
    taskState: {
      authority: taskFile,
      exists: taskFileExists,
      revision: classicTaskRevision(source),
      total: tasks.length,
      completed: tasks.filter((task) => task.completed).length,
      needsIds: tasks.some((task) => !task.id),
      next,
      ...(details ? { tasks } : {}),
    },
    planMapping: {
      status: mapping.unmapped.length ? 'reconciliation-required' : 'ready',
      unmappedCount: mapping.unmapped.length,
      ...(details ? { unmapped: mapping.unmapped } : {}),
    },
    coordination: {
      path: coordination.checkpoint ? path.join(directory, '.comet', 'coordination.json') : null,
      stale: coordination.stale,
      ...(coordination.checkpoint
        ? {
            taskIds: coordination.checkpoint.taskIds,
            stage: coordination.checkpoint.stage,
            sessionId: coordination.checkpoint.sessionId,
            reviewRounds: coordination.checkpoint.reviewRounds,
            unresolved: coordination.checkpoint.unresolved,
            ...(details ? { checkpoint: coordination.checkpoint } : {}),
          }
        : {}),
    },
    delivery,
    requiredFiles: [taskFile, ...(state.plan ? [path.resolve(root, state.plan)] : [])],
  };
}
