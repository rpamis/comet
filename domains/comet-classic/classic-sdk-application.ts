const classicAgentCheckReportsSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name', 'result'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      result: { enum: ['passed', 'failed', 'not-run'] },
      note: { type: 'string', minLength: 1 },
    },
  },
};
import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';
import { readGitCommitPaths } from '../../platform/process/git.js';
import {
  createPortableRunCheckpoint,
  hashRuntimeValue,
  PORTABLE_RUN_CHECKPOINT_KEY,
  portableRunCheckpointMatches,
  readPortableRunCheckpoint,
  type DefineWorkflowOptions,
  type RuntimeAction,
  type RuntimeEvidenceValidator,
  type RuntimeExecutor,
  type RuntimeValidator,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowTransitionHandler,
} from '../engine/runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { archivedClassicDocumentRef } from './classic-archive-annotation.js';
import {
  classicArchivedRequirementsProblems,
  readClassicArtifactRequirements,
} from './classic-artifact-requirements.js';
import { evaluateBranchBinding, isGitWorkTree, liveGitBranch } from './classic-branch-binding.js';
import { classicConfigurationReadiness } from './classic-build-configuration.js';
import { validateClassicSdkDesignContext } from './classic-handoff.js';
import { resolveClassicLayout } from './classic-layout.js';
import { classicOpenContentProblem } from './classic-open-content.js';
import {
  inspectClassicAutonomousBuildProblems,
  inspectClassicPlanReadiness,
} from './classic-plan-readiness.js';
import { readClassicProjectFile } from './classic-protected-path.js';
import { classicArchiveDocumentOutputs } from './classic-sdk-archive-documents.js';
import {
  assertClassicArchiveExecutionReceipt,
  readClassicArchiveManifest,
} from './classic-sdk-archive-manifest.js';
import { readClassicSdkDeliveryCheckpoint } from './classic-sdk-delivery-checkpoint.js';
import {
  assertClassicSdkDeliveryFileInputs,
  assertClassicSdkDeliveryInputs,
} from './classic-sdk-delivery-inputs.js';
import { classicDeliveryActionContext } from './classic-sdk-delivery-repair-model.js';
import {
  classicSdkPullRequestMatches,
  classicSdkRemoteBranchHead,
  classicSdkRemoteIdentity,
} from './classic-sdk-remote.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicProfile, ClassicState } from './classic-state.js';
import { parseClassicTasks } from './classic-tasks.js';
import { applyClassicTransition } from './classic-transitions.js';
import { classicVerificationReportReceipt } from './classic-verification-report.js';
export interface ClassicWorkflowApplication {
  workflow: DefineWorkflowOptions;
  transitionHandler: WorkflowTransitionHandler;
  evidenceValidators: readonly RuntimeEvidenceValidator[];
  executors: readonly RuntimeExecutor[];
  validators: readonly RuntimeValidator[];
}
const openRevalidationExecutor: RuntimeExecutor = {
  id: 'comet-classic-open-revalidate',
  capabilities: [],
  supports: (action) => action.type === 'call_tool' && action.ref === 'classic-open-revalidate',
  async execute(action, context) {
    if (!context?.projectRoot) throw new Error('Classic Open requires its project root');
    return { status: 'succeeded', output: { contentHash: action.inputHash } };
  },
};
const openRevalidationValidator: RuntimeValidator = {
  id: 'comet-classic-open-revalidation',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const confirmation = run.waits.find(
      (wait) =>
        wait.stepId === 'full.open.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved',
    );
    const output = outcome.output as {
      contentHash?: string;
    } | null;
    return confirmation &&
      context?.projectRoot &&
      action.claim?.executorId === openRevalidationExecutor.id &&
      output?.contentHash === action.inputHash
      ? { accepted: true }
      : { accepted: false, reason: 'Classic Open has no approval for its current SDK request' };
  },
};
const designHandoffValidator: RuntimeValidator = {
  id: 'comet-classic-design-handoff',
  version: '1',
  async validate({ run, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const input = run.input as {
      change?: unknown;
      changeDir?: unknown;
    };
    const state = run.state as unknown as ClassicState;
    const output = outcome.output as {
      proposal?: unknown;
      handoffContext?: unknown;
      handoffHash?: unknown;
      sourceEvidence?: {
        ref: string;
        contentHash: string;
      };
      requirementsEvidence?: {
        ref: string;
        contentHash: string;
      };
    } | null;
    if (
      !context?.projectRoot ||
      typeof input.change !== 'string' ||
      typeof input.changeDir !== 'string' ||
      typeof output?.proposal !== 'string' ||
      typeof output.handoffContext !== 'string'
    ) {
      return {
        accepted: false,
        reason: 'Classic Design handoff lacks a source-bound context pack',
      };
    }
    try {
      if (output.sourceEvidence || output.requirementsEvidence) {
        const source = await classicOpenEvidenceReceipt(context.projectRoot, input.changeDir, {
          run,
        });
        const requirements = source;
        if (
          output.sourceEvidence?.ref !== source.ref ||
          output.requirementsEvidence?.ref !== requirements.ref
        ) {
          return {
            accepted: false,
            reason: 'Classic Design proposal sources changed before submission',
          };
        }
      }
      const accepted = await validateClassicSdkDesignContext({
        run,
        projectRoot: context.projectRoot,
        changeDir: path.join(context.projectRoot, input.changeDir),
        change: input.change,
        contextCompression: state.contextCompression,
        handoffContext: output.handoffContext,
        handoffHash: typeof output.handoffHash === 'string' ? output.handoffHash : null,
      });
      return {
        accepted,
        reason: 'Classic Design handoff no longer matches its OpenSpec sources',
      };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
const buildConfigurationValidator: RuntimeValidator = {
  id: 'comet-classic-build-configuration',
  version: '1',
  validate({ run, outcome }) {
    if (outcome.status === 'failed') return { accepted: true };
    const state = run.state as unknown as ClassicState;
    const output = outcome.output as Partial<
      Pick<
        ClassicState,
        | 'buildMode'
        | 'tddMode'
        | 'reviewMode'
        | 'isolation'
        | 'boundBranch'
        | 'subagentDispatch'
        | 'directOverride'
      >
    > | null;
    if (
      !output ||
      !state.isolation ||
      output.isolation !== state.isolation ||
      output.boundBranch !== state.boundBranch
    ) {
      return { accepted: false, reason: 'Classic Build workspace binding changed in the proposal' };
    }
    const candidate: ClassicState = { ...state, ...output };
    const readiness = classicConfigurationReadiness(candidate);
    if (readiness.missingFields.length || readiness.invalidFields.length) {
      return { accepted: false, reason: 'Classic Build configuration is incomplete or invalid' };
    }
    return { accepted: true };
  },
};
const archiveOutcomeValidator: RuntimeValidator = {
  id: 'comet-classic-archive-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const root = context?.projectRoot;
    const input = action.input as {
      input?: {
        changeDir?: unknown;
      };
    };
    const output = outcome.output as {
      archiveDirectory?: unknown;
    } | null;
    if (
      !root ||
      action.claim?.executorId !== 'comet-classic-archive' ||
      typeof input.input?.changeDir !== 'string' ||
      typeof output?.archiveDirectory !== 'string'
    ) {
      return { accepted: false, reason: 'Classic Archive result lacks its execution identity' };
    }
    try {
      const layout = await resolveClassicLayout(root);
      const [active, archived] = await Promise.all([
        inspectProtectedProjectPath(root, input.input.changeDir, {
          label: 'Classic active change',
          expected: 'directory',
        }),
        inspectProtectedProjectPath(root, output.archiveDirectory, {
          label: 'Classic archived change',
          expected: 'directory',
        }),
      ]);
      const relative = path.relative(layout.archiveDir, archived.target);
      const archiveName = path.basename(archived.target);
      if (
        active.exists ||
        !archived.exists ||
        path.dirname(active.target) !== layout.changesDir ||
        !relative ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        relative.includes(path.sep) ||
        !/^\d{4}-\d{2}-\d{2}-/u.test(archiveName) ||
        archiveName.slice(11) !== path.basename(active.target)
      ) {
        return { accepted: false, reason: 'Classic Archive has not moved the approved change' };
      }
      const problems = await classicArchivedRequirementsProblems(root, archived.target);
      if (problems.length > 0) {
        return { accepted: false, reason: problems.join('\n') };
      }
      const recorded = run.actions.find((entry) => entry.id === action.id);
      if (
        recorded?.status === 'succeeded' &&
        recorded.outcome &&
        hashRuntimeValue(recorded) === hashRuntimeValue(action) &&
        hashRuntimeValue(recorded.outcome) === hashRuntimeValue(outcome)
      ) {
        // 已被权威 Run 接受的同一结果可随 portable artifact 复核，不依赖原设备缓存。
        await readClassicArchiveManifest(root, run, recorded, output.archiveDirectory);
      } else {
        await assertClassicArchiveExecutionReceipt(
          root,
          run,
          action,
          output.archiveDirectory,
          outcome.artifacts,
        );
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
async function onlyRuntimeCheckpointChanged(
  root: string,
  archiveRef: string,
  dirty: string,
  run: WorkflowRun,
): Promise<boolean> {
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, archiveRef)))
    .replaceAll('\\', '/');
  if (dirty !== `M ${stateRef}`) return false;
  const committed = execFileSync('git', ['show', `HEAD:${stateRef}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const current = await readClassicProjectFile(root, path.join(root, stateRef), {
    label: 'Classic state file',
  });
  const before = parseDocument(committed, { uniqueKeys: true });
  const after = parseDocument(current, { uniqueKeys: true });
  if (before.errors.length > 0 || after.errors.length > 0) return false;
  const beforeData = before.toJS() as Record<string, unknown>;
  const afterData = after.toJS() as Record<string, unknown>;
  if (
    !readPortableRunCheckpoint(beforeData[PORTABLE_RUN_CHECKPOINT_KEY], run.runId) ||
    !readPortableRunCheckpoint(afterData[PORTABLE_RUN_CHECKPOINT_KEY], run.runId) ||
    (!portableRunCheckpointMatches(
      afterData[PORTABLE_RUN_CHECKPOINT_KEY],
      createPortableRunCheckpoint(run),
    ) &&
      !readClassicSdkDeliveryCheckpoint(afterData[PORTABLE_RUN_CHECKPOINT_KEY], run))
  ) {
    return false;
  }
  delete beforeData[PORTABLE_RUN_CHECKPOINT_KEY];
  delete afterData[PORTABLE_RUN_CHECKPOINT_KEY];
  return isDeepStrictEqual(beforeData, afterData);
}
const deliveryOutcomeValidator: RuntimeValidator = {
  id: 'comet-classic-delivery-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (outcome.status === 'failed') return { accepted: true };
    const root = context?.projectRoot;
    const profile = action.stepId.split('.')[0];
    const actionInput = action.input as {
      input?: {
        changeDir?: unknown;
      };
      outputs?: Record<string, unknown>;
    };
    const outputs = classicDeliveryActionContext(run, action)?.outputs ?? actionInput.outputs;
    const approved = outputs?.[`${profile}.archive.preflight`] as
      | {
          deliveryAction?: unknown;
          targetBranch?: unknown;
          baseCommit?: unknown;
          remote?: unknown;
          remoteIdentity?: unknown;
          prBaseBranch?: unknown;
        }
      | undefined;
    const archive = outputs?.[`${profile}.archive.execute`] as
      | {
          archiveDirectory?: unknown;
        }
      | undefined;
    const delivered = outcome.output as {
      action?: unknown;
      targetBranch?: unknown;
      commit?: unknown;
      remote?: unknown;
      prUrl?: unknown;
    } | null;
    if (
      !root ||
      !['full', 'hotfix', 'tweak'].includes(profile) ||
      !approved ||
      !delivered ||
      !['local', 'push', 'pr'].includes(String(approved.deliveryAction)) ||
      delivered.action !== approved.deliveryAction ||
      delivered.targetBranch !== approved.targetBranch ||
      typeof approved.baseCommit !== 'string' ||
      !archive ||
      typeof archive.archiveDirectory !== 'string' ||
      typeof actionInput.input?.changeDir !== 'string' ||
      typeof delivered.commit !== 'string' ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(delivered.commit)
    ) {
      return { accepted: false, reason: 'Classic delivery does not match its approval' };
    }
    try {
      const branch = liveGitBranch(root);
      if (branch !== approved.targetBranch) {
        return {
          accepted: false,
          reason: `Classic 当前分支 ${branch ?? '(detached HEAD)'} 与已批准目标 ${String(approved.targetBranch)} 不一致`,
        };
      }
      if (approved.deliveryAction !== 'local') {
        if (
          typeof approved.remote !== 'string' ||
          delivered.remote !== approved.remote ||
          typeof approved.remoteIdentity !== 'string' ||
          classicSdkRemoteIdentity(root, approved.remote) !== approved.remoteIdentity
        ) {
          return { accepted: false, reason: 'Classic delivery remote changed after approval' };
        }
      }
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      if (head !== delivered.commit) {
        return {
          accepted: false,
          reason: `Classic 当前 HEAD ${head} 与交付提交 ${delivered.commit} 不一致`,
        };
      }
      if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(approved.baseCommit)) {
        return { accepted: false, reason: 'Classic 交付缺少有效的已批准基线 baseCommit' };
      }
      const commits = execFileSync(
        'git',
        ['rev-list', '--reverse', '--parents', `${approved.baseCommit}..${head}`, '--'],
        { cwd: root, encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .filter(Boolean);
      if (!commits.length) {
        return {
          accepted: false,
          reason: `Classic 已批准基线 ${approved.baseCommit} 之后没有交付提交`,
        };
      }
      let previousCommit = approved.baseCommit;
      const changed = new Set<string>();
      const commitPaths = readGitCommitPaths(
        root,
        commits.map((row) => row.split(/\s+/u)[0]),
      );
      for (const row of commits) {
        const [commit, ...parents] = row.split(/\s+/u);
        if (parents.length !== 1) {
          return {
            accepted: false,
            reason: `Classic 交付范围包含非线性提交 ${commit}（父提交数 ${parents.length}）；只接受从已批准基线 ${approved.baseCommit} 连续产生的单父提交`,
          };
        }
        if (parents[0] !== previousCommit) {
          return {
            accepted: false,
            reason: `Classic 交付提交 ${commit} 的父提交 ${parents[0]} 不等于 ${previousCommit}；交付范围必须从已批准基线 ${approved.baseCommit} 连续开始`,
          };
        }
        // 逐提交检查，避免先夹带未批准文件、再撤销的提交躲过最终 tree 对比。
        const paths = commitPaths.get(commit)!;
        for (const file of paths) changed.add(file);
        previousCommit = commit;
      }
      const files = execFileSync(
        'git',
        ['ls-tree', '-r', '--name-only', 'HEAD', '--', archive.archiveDirectory],
        {
          cwd: root,
          encoding: 'utf8',
        },
      ).trim();
      const dirty = execFileSync(
        'git',
        ['status', '--porcelain', '--untracked-files=all', '--', archive.archiveDirectory],
        { cwd: root, encoding: 'utf8' },
      ).trim();
      const activeRef = actionInput.input.changeDir.replaceAll('\\', '/');
      const archiveRef = archive.archiveDirectory.replaceAll('\\', '/');
      const documentBinding = classicArchiveDocumentOutputs(run, action);
      const documentOutputs = documentBinding.outputs;
      const acceptedPlan = documentOutputs['full.build.plan'] as
        | {
            plan?: unknown;
            designEvidence?: {
              ref?: unknown;
              contentHash?: unknown;
            };
          }
        | undefined;
      const designDoc =
        (
          documentOutputs['full.design.document'] as
            | {
                designDoc?: unknown;
              }
            | undefined
        )?.designDoc ?? acceptedPlan?.designEvidence?.ref;
      const plan = acceptedPlan?.plan;
      if (profile === 'full' && (typeof designDoc !== 'string' || typeof plan !== 'string')) {
        return { accepted: false, reason: 'Classic Archive documents are missing' };
      }
      const archiveName = path.posix.basename(archiveRef);
      const archivedDesignDoc =
        typeof designDoc === 'string'
          ? archivedClassicDocumentRef(designDoc, activeRef, archiveRef)
          : null;
      const archivedPlan =
        typeof plan === 'string' ? archivedClassicDocumentRef(plan, activeRef, archiveRef) : null;
      const committedDesign =
        profile === 'full'
          ? execFileSync('git', ['show', `HEAD:${archivedDesignDoc}`], {
              cwd: root,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          : null;
      const committedPlan =
        profile === 'full'
          ? execFileSync('git', ['show', `HEAD:${archivedPlan}`], {
              cwd: root,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          : null;
      const implementationFiles = await assertClassicSdkDeliveryInputs(root, run);
      const archiveAction = run.actions
        .slice()
        .reverse()
        .find(
          (entry) => entry.stepId === `${profile}.archive.execute` && entry.status === 'succeeded',
        );
      if (!archiveAction) throw new Error('Classic delivery 缺少成功的 Archive Action');
      const archiveManifest = await readClassicArchiveManifest(
        root,
        run,
        archiveAction,
        archiveRef,
      );
      for (const ref of archiveManifest.optionalPaths) {
        const moved = ref.startsWith(`${archiveRef}/`)
          ? `${activeRef}/${ref.slice(archiveRef.length + 1)}`
          : null;
        const committed = execFileSync('git', ['ls-tree', '-z', 'HEAD', '--', ref], {
          cwd: root,
          encoding: 'utf8',
        });
        if (committed) archiveManifest.paths.push(ref, ...(moved ? [moved] : []));
        else {
          // The deletion of this optional file's active path is approved from the
          // optional file itself. That approval must not cover a commit which drops
          // the file instead of moving it, so require the archived copy whenever the
          // commit records the deletion. An untracked optional file never appears as
          // a deletion, so it stays unaffected.
          if (moved && [...commitPaths.values()].some((paths) => paths.includes(moved)))
            throw new Error(
              `Classic archive commit deletes an optional input without committing the archived copy: ${ref}`,
            );
        }
      }
      const archiveFiles = await assertClassicSdkDeliveryFileInputs(root, archiveManifest.paths);
      const allowed = (file: string) =>
        implementationFiles.has(file) ||
        archiveFiles.has(file) ||
        archiveManifest.stateFiles.includes(file);
      const offendingPaths = [...changed].filter((file) => !allowed(file));
      if (offendingPaths.length) {
        return {
          accepted: false,
          reason: `Classic 交付提交范围包含未批准的路径：${offendingPaths.join(', ')}`,
        };
      }
      const checkpointOnlyDirty =
        dirty !== '' && (await onlyRuntimeCheckpointChanged(root, archiveRef, dirty, run));
      if (!files) {
        return { accepted: false, reason: `Classic 交付 HEAD 缺少归档目录：${archiveRef}` };
      }
      if (dirty && !checkpointOnlyDirty) {
        return { accepted: false, reason: `Classic 归档目录与交付 HEAD 不一致：${dirty}` };
      }
      if (![...changed].some((file) => file.startsWith(`${archiveRef}/`))) {
        return {
          accepted: false,
          reason: `Classic 交付范围 ${approved.baseCommit}..${head} 未包含归档目录：${archiveRef}`,
        };
      }
      if (
        profile === 'full' &&
        (!archivedDesignDoc ||
          !archivedPlan ||
          !changed.has(archivedDesignDoc) ||
          !changed.has(archivedPlan) ||
          !committedDesign?.includes(`archived-with: ${archiveName}`) ||
          !committedDesign.includes('status: final') ||
          !committedPlan?.includes(`archived-with: ${archiveName}`))
      ) {
        return {
          accepted: false,
          reason: `Classic 交付范围缺少已归档的设计或计划，或归档标记不符：${archivedDesignDoc}, ${archivedPlan}`,
        };
      }
      if (approved.deliveryAction !== 'local') {
        const remoteHead = classicSdkRemoteBranchHead(
          root,
          approved.remote as string,
          approved.targetBranch as string,
        );
        if (remoteHead !== delivered.commit) {
          return {
            accepted: false,
            reason: 'Classic remote branch does not contain the archive commit',
          };
        }
      }
      if (approved.deliveryAction === 'pr') {
        if (
          typeof delivered.prUrl !== 'string' ||
          typeof approved.prBaseBranch !== 'string' ||
          !classicSdkPullRequestMatches({
            projectRoot: root,
            remote: approved.remote as string,
            prUrl: delivered.prUrl,
            targetBranch: approved.targetBranch as string,
            commit: delivered.commit,
            baseBranch: approved.prBaseBranch,
          })
        ) {
          return { accepted: false, reason: 'Classic PR does not match the approved delivery' };
        }
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
/** Check a host-observed delivery before claiming its SDK Action. */
export async function validateClassicSdkDeliveryCandidate(
  run: WorkflowRun,
  action: RuntimeAction,
  output: {
    action: 'local' | 'push' | 'pr';
    targetBranch: string;
    commit: string;
    remote?: string;
    prUrl?: string;
  },
  projectRoot: string,
): Promise<{
  accepted: boolean;
  reason?: string;
}> {
  return deliveryOutcomeValidator.validate({
    run,
    action,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim?.token ?? '',
      outcomeId: 'delivery-candidate',
      status: 'succeeded',
      output,
    },
    context: { requestId: 'delivery-candidate', projectRoot },
  });
}
/** Capture the current required Open artifacts without trusting a caller-supplied digest. */
export async function classicOpenEvidenceReceipt(
  projectRoot: string,
  changeDirRef: string,
  options: {
    designRequirements?: boolean;
    presetRequirements?: boolean;
    taskCheckboxes?: 'include' | 'ignore';
    run?: Readonly<WorkflowRun>;
  } = {},
): Promise<{
  ref: string;
}> {
  const inspected = await inspectProtectedProjectPath(projectRoot, changeDirRef, {
    label: 'Classic change',
    expected: 'directory',
  });
  if (
    !inspected.exists ||
    (options.run &&
      (
        options.run.input as {
          changeDir?: string;
        }
      ).changeDir !== inspected.relative)
  )
    throw new Error('Classic artifacts do not belong to the current change');
  const requirements = await readClassicArtifactRequirements(projectRoot, inspected.target);
  if (requirements.problems.length) throw new Error(requirements.problems.join('\n'));
  return { ref: inspected.relative };
}
export async function classicDesignEvidenceReceipt(
  projectRoot: string,
  designDocRef: string,
): Promise<{
  ref: string;
}> {
  const ref = normalizeWorkflowRelativePath(designDocRef, 'Classic Design document');
  const file = await readProtectedProjectFile(projectRoot, ref, Number.MAX_SAFE_INTEGER, {
    label: 'Classic Design document',
  });
  if (!file.bytes.length) throw new Error('Classic Design document is empty');
  return { ref };
}
/** Reuse only the document accepted by the latest Design evidence. */
export async function classicAcceptedDesignEvidence(projectRoot: string, run: WorkflowRun) {
  const state = run.state as unknown as ClassicState;
  const expected = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === 'full.design.evidence' &&
        wait.status === 'resolved' &&
        wait.receipt?.ref === state.designDoc,
    )?.receipt;
  if (!expected || !state.designDoc)
    throw new Error('Classic Build requires its accepted Design step');
  await inspectProtectedProjectPath(projectRoot, state.designDoc, {
    label: 'Classic accepted Design',
    expected: 'file',
  });
  return { ref: expected.ref };
}
export async function classicPlanEvidenceReceipt(
  projectRoot: string,
  planRef: string,
  changeDirRef: string,
): Promise<{
  ref: string;
}> {
  const readiness = await inspectClassicPlanReadiness(projectRoot, planRef);
  if (readiness.status !== 'ready') throw new Error('Classic Build plan is not ready');
  const plan = await inspectProtectedProjectPath(projectRoot, planRef, {
    label: 'Classic Build plan',
    expected: 'file',
  });
  const change = await inspectProtectedProjectPath(projectRoot, changeDirRef, {
    label: 'Classic change',
    expected: 'directory',
  });
  if (!plan.exists || !change.exists) throw new Error('Classic Build plan or change is missing');
  return { ref: plan.relative };
}
export async function assertClassicSdkDesignRequirementsCurrent(
  projectRoot: string,
  changeDirRef: string,
  run: WorkflowRun,
): Promise<void> {
  const state = run.state as unknown as ClassicState;
  if (state.workflow !== 'full') return;
  const open = run.waits.find(
    (wait) =>
      wait.status === 'resolved' &&
      ((wait.stepId === 'full.open.confirm' && wait.decision?.choice === 'approved') ||
        (['hotfix', 'tweak'].some(
          (profile) => wait.stepId === `${profile}.build.escalation-confirm`,
        ) &&
          wait.decision?.choice === 'upgrade')),
  );
  const handoff = run.actions
    .slice()
    .reverse()
    .find((action) => action.stepId === 'full.design.handoff' && action.status === 'succeeded');
  if (
    !open ||
    !handoff ||
    (
      run.input as {
        changeDir?: string;
      }
    ).changeDir !== changeDirRef
  )
    throw new Error('Classic Design requires its approved Open and completed handoff');
}
export async function assertClassicBuildReady(
  projectRoot: string,
  changeDirRef: string,
  state: ClassicState,
  run: WorkflowRun,
): Promise<void> {
  await assertClassicPresetRequirementsCurrent(projectRoot, changeDirRef, run);
  const configuration = classicConfigurationReadiness(state);
  if (
    state.isolation === null ||
    configuration.missingFields.length > 0 ||
    configuration.invalidFields.length > 0
  ) {
    throw new Error('Classic Build configuration is incomplete or invalid');
  }
  const currentBranch = liveGitBranch(projectRoot);
  const branch = evaluateBranchBinding({
    isolation: state.isolation,
    boundBranch: state.boundBranch,
    currentBranch,
    gitWorkTree: currentBranch === null ? isGitWorkTree(projectRoot) : true,
  });
  if (branch.status === 'needs-heal') {
    throw new Error('Classic Build Git branch is not bound in the SDK Run');
  }
  if (branch.status === 'unbound-detached' || branch.status === 'drift') {
    throw new Error('Classic Build Git branch no longer matches the SDK Run');
  }
  const change = await inspectProtectedProjectPath(projectRoot, changeDirRef, {
    label: 'Classic change',
    expected: 'directory',
  });
  if (!change.exists) throw new Error('Classic change directory does not exist');
  const tasksRef = path.posix.join(change.relative.replaceAll('\\', '/'), 'tasks.md');
  const tasksFile = await readProtectedProjectFile(projectRoot, tasksRef, Number.MAX_SAFE_INTEGER, {
    label: 'Classic Build tasks',
  });
  const tasks = parseClassicTasks(tasksFile.bytes.toString('utf8'));
  if (tasks.length === 0 || tasks.some((task) => !task.completed)) {
    throw new Error('Classic Build tasks are not all completed');
  }
  if (state.workflow === 'full') {
    await assertClassicSdkDesignRequirementsCurrent(projectRoot, changeDirRef, run);
    await classicAcceptedDesignEvidence(projectRoot, run);
    if (!state.plan) throw new Error('Classic Build plan is missing');
    const acceptedPlan = run.evidenceWaits
      ?.slice()
      .reverse()
      .find(
        (wait) =>
          wait.stepId === 'full.build.plan.evidence' &&
          wait.status === 'resolved' &&
          wait.receipt?.ref === state.plan,
      );
    if (!acceptedPlan) throw new Error('Classic Build requires its accepted plan step');
  }
  const proposalRef = path.posix.join(change.relative.replaceAll('\\', '/'), 'proposal.md');
  const proposal = await readProtectedProjectFile(
    projectRoot,
    proposalRef,
    Number.MAX_SAFE_INTEGER,
    { label: 'Classic Build proposal' },
  );
  if (!proposal.bytes.toString('utf8').trim()) throw new Error('Classic Build proposal is empty');
  const changeName = path.posix.basename(change.relative.replaceAll('\\', '/'));
  const autonomousProblems = await inspectClassicAutonomousBuildProblems(
    projectRoot,
    changeName,
    state,
  );
  if (autonomousProblems.length > 0) throw new Error(autonomousProblems.join('\n'));
}
/** 预设以已批准的需求为准；勾选完成任务不会改变需求摘要。 */
export async function assertClassicPresetRequirementsCurrent(
  projectRoot: string,
  changeDirRef: string,
  run: Readonly<WorkflowRun>,
): Promise<void> {
  const state = run.state as unknown as ClassicState;
  if (state.workflow === 'full') return;
  const accepted = run.evidenceWaits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === state.workflow + '.open.evidence' &&
        wait.status === 'resolved' &&
        wait.receipt?.ref === changeDirRef,
    );
  const open = run.actions
    .slice()
    .reverse()
    .find((action) => action.stepId === state.workflow + '.open' && action.status === 'succeeded');
  if (!accepted || !open) throw new Error('Classic preset requires its accepted Open step');
}
const openEvidenceValidator: RuntimeEvidenceValidator = {
  id: 'comet-classic-open-artifacts',
  version: '1',
  async validate({ run, ref, contentHash, context }) {
    const state = run.state as unknown as ClassicState;
    const expected = (
      run.input as {
        changeDir?: string;
      }
    ).changeDir;
    const action = run.actions
      .slice()
      .reverse()
      .find((entry) => entry.stepId === state.workflow + '.open');
    if (
      !context?.projectRoot ||
      ref !== expected ||
      action?.status !== 'succeeded' ||
      contentHash !== action.inputHash
    )
      return {
        accepted: false,
        actualHash: '',
        reason: 'Classic Open evidence does not belong to its completed Action',
      };
    try {
      await classicOpenEvidenceReceipt(context.projectRoot, ref, { run });
      const issue = await classicOpenContentProblem(context.projectRoot, ref, state.language);
      if (issue) throw new Error(issue);
      return { accepted: true, actualHash: action.inputHash };
    } catch (error) {
      return { accepted: false, actualHash: '', reason: String(error) };
    }
  },
};
const designEvidenceValidator: RuntimeEvidenceValidator = {
  id: 'comet-classic-design-document',
  version: '1',
  async validate({ run, ref, contentHash, context }) {
    const state = run.state as unknown as ClassicState;
    const action = run.actions
      .slice()
      .reverse()
      .find((entry) => entry.stepId === 'full.design.document');
    if (
      !context?.projectRoot ||
      state.designDoc !== ref ||
      action?.status !== 'succeeded' ||
      contentHash !== action.inputHash
    )
      return {
        accepted: false,
        actualHash: '',
        reason: 'Classic Design evidence does not belong to its completed Action',
      };
    try {
      await classicDesignEvidenceReceipt(context.projectRoot, ref);
      return { accepted: true, actualHash: action.inputHash };
    } catch (error) {
      return { accepted: false, actualHash: '', reason: String(error) };
    }
  },
};
const planEvidenceValidator: RuntimeEvidenceValidator = {
  id: 'comet-classic-build-plan',
  version: '1',
  async validate({ run, ref, contentHash, context }) {
    const state = run.state as unknown as ClassicState;
    const action = run.actions
      .slice()
      .reverse()
      .find((entry) => entry.stepId === 'full.build.plan');
    if (
      !context?.projectRoot ||
      state.plan !== ref ||
      action?.status !== 'succeeded' ||
      contentHash !== action.inputHash
    )
      return {
        accepted: false,
        actualHash: '',
        reason: 'Classic plan evidence does not belong to its completed Action',
      };
    try {
      await classicPlanEvidenceReceipt(
        context.projectRoot,
        ref,
        String(
          (
            run.input as {
              changeDir: string;
            }
          ).changeDir,
        ),
      );
      return { accepted: true, actualHash: action.inputHash };
    } catch (error) {
      return { accepted: false, actualHash: '', reason: String(error) };
    }
  },
};
const verificationReportEvidenceValidator: RuntimeEvidenceValidator = {
  id: 'comet-classic-verification-report',
  version: '1',
  async validate({ run, ref, contentHash, context }) {
    const state = run.state as unknown as ClassicState;
    const action = run.actions
      .slice()
      .reverse()
      .find((entry) => entry.stepId === state.workflow + '.verify.run');
    if (
      !context?.projectRoot ||
      state.phase !== 'verify' ||
      state.verificationReport !== ref ||
      action?.status !== 'succeeded' ||
      contentHash !== action.inputHash
    )
      return {
        accepted: false,
        actualHash: '',
        reason: 'Classic report does not belong to its completed Verify Action',
      };
    try {
      await classicVerificationReportReceipt(context.projectRoot, ref, state.language);
      return { accepted: true, actualHash: action.inputHash };
    } catch (error) {
      return { accepted: false, actualHash: '', reason: String(error) };
    }
  },
};
const requiredStateFields: Array<keyof ClassicState> = [
  'workflow',
  'language',
  'phase',
  'contextCompression',
  'buildMode',
  'buildPause',
  'subagentDispatch',
  'tddMode',
  'reviewMode',
  'isolation',
  'boundBranch',
  'verifyMode',
  'autoTransition',
  'baseRef',
  'designDoc',
  'plan',
  'verifyResult',
  'verifyFailures',
  'verificationReport',
  'branchStatus',
  'createdAt',
  'verifiedAt',
  'archiveConfirmation',
  'archived',
  'directOverride',
  'handoffContext',
  'handoffHash',
  'classicProfile',
  'classicMigration',
];
const nullableString = { type: ['string', 'null'] };
const nullableBoolean = { type: ['boolean', 'null'] };
const presetScopeValidator: RuntimeValidator = {
  id: 'comet-classic-preset-scope',
  version: '1',
  async validate({ run, outcome, context }) {
    const output = outcome.output as {
      event?: unknown;
      requirementsEvidence?: unknown;
    } | null;
    if (
      outcome.status !== 'succeeded' ||
      output?.event !== 'escalation-requested' ||
      !output.requirementsEvidence
    )
      return { accepted: true };
    if (!context?.projectRoot)
      return { accepted: false, reason: 'Classic preset scope requires its project root' };
    try {
      const current = await classicOpenEvidenceReceipt(
        context.projectRoot,
        (
          run.input as {
            changeDir: string;
          }
        ).changeDir,
        {
          presetRequirements: true,
        },
      );
      return {
        accepted:
          (
            output.requirementsEvidence as {
              ref?: unknown;
            }
          ).ref === current.ref,
        reason: 'Classic preset scope changed before the proposal was recorded',
      };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
/** Classic owns phase rules; the SDK owns Action acceptance, scheduling, and Run commits. */
export function defineClassicWorkflowApplication(
  profile: ClassicProfile,
): ClassicWorkflowApplication {
  const fullApplication = profile === 'full' ? null : defineClassicWorkflowApplication('full');
  const openStep = `${profile}.open`;
  const evidenceStep = `${profile}.open.evidence`;
  const followingStep = profile === 'full' ? 'full.design.handoff' : `${profile}.build.execute`;
  const transitionRef = { id: `comet-classic-${profile}-transition`, version: '2' };
  const evidenceRef = { id: 'comet-classic-open-artifacts', version: '1' };
  return {
    executors: profile === 'full' ? [openRevalidationExecutor] : fullApplication!.executors,
    validators: fullApplication?.validators ?? [
      ...(profile === 'full'
        ? [openRevalidationValidator, designHandoffValidator, buildConfigurationValidator]
        : []),
      archiveOutcomeValidator,
      deliveryOutcomeValidator,
      presetScopeValidator,
    ],
    evidenceValidators:
      fullApplication?.evidenceValidators ??
      (profile === 'full'
        ? [
            openEvidenceValidator,
            designEvidenceValidator,
            planEvidenceValidator,
            verificationReportEvidenceValidator,
          ]
        : [openEvidenceValidator, verificationReportEvidenceValidator]),
    workflow: {
      id: `comet-classic-${profile}`,
      version: '2',
      entry: openStep,
      stateSchema: {
        type: 'object',
        required: requiredStateFields,
        additionalProperties: false,
        properties: {
          workflow: { enum: profile === 'full' ? ['full'] : [profile, 'full'] },
          language: { enum: [null, 'en', 'zh-CN'] },
          phase: { enum: ['open', 'design', 'build', 'verify', 'archive'] },
          contextCompression: { enum: [null, 'off', 'beta'] },
          buildMode: {
            enum: [null, 'subagent-driven-development', 'executing-plans', 'direct', 'autonomous'],
          },
          buildPause: { enum: [null, 'plan-ready'] },
          subagentDispatch: { enum: [null, 'confirmed'] },
          tddMode: { enum: [null, 'tdd', 'direct'] },
          reviewMode: { enum: [null, 'off', 'standard', 'thorough'] },
          isolation: { enum: [null, 'current', 'branch', 'worktree'] },
          boundBranch: nullableString,
          verifyMode: { enum: [null, 'light', 'full'] },
          autoTransition: nullableBoolean,
          baseRef: nullableString,
          designDoc: nullableString,
          plan: nullableString,
          verifyResult: { enum: ['pending', 'pass', 'fail'] },
          verifyFailures: { type: 'integer', minimum: 0 },
          checkEpoch: { type: 'integer', minimum: 0 },
          verificationReport: nullableString,
          branchStatus: { enum: [null, 'pending', 'handled'] },
          createdAt: nullableString,
          verifiedAt: nullableString,
          archiveConfirmation: { enum: [null, 'pending', 'confirmed'] },
          archived: { type: 'boolean' },
          directOverride: nullableBoolean,
          handoffContext: nullableString,
          handoffHash: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[a-f0-9]{64}$' }] },
          classicProfile: { enum: [null, 'full', 'hotfix', 'tweak'] },
          classicMigration: { enum: [null, 1] },
        },
      },
      transitionHandler: transitionRef,
      steps: {
        [openStep]: {
          type: 'invoke_skill',
          ref: profile === 'full' ? 'comet-open' : `comet-${profile}`,
        },
        [evidenceStep]: {
          type: 'await_evidence',
          kind: 'classic-open-artifacts',
          validator: evidenceRef,
        },
        ...(profile === 'full'
          ? {
              'full.open.confirm': {
                type: 'ask_user' as const,
                proposalFrom: [openStep, evidenceStep],
                choices: ['approved', 'rejected'],
              },
              'full.open.revalidate': {
                type: 'call_tool' as const,
                ref: 'classic-open-revalidate',
                validator: {
                  id: openRevalidationValidator.id,
                  version: openRevalidationValidator.version,
                },
                outputSchema: {
                  type: 'object',
                  required: ['contentHash'],
                  properties: { contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
                  additionalProperties: false,
                },
              },
            }
          : {}),
        [followingStep]: {
          type: 'invoke_skill',
          ref: profile === 'full' ? 'comet-design' : 'comet-build',
          ...(profile === 'full'
            ? {
                validator: {
                  id: designHandoffValidator.id,
                  version: designHandoffValidator.version,
                },
              }
            : {
                validator: { id: presetScopeValidator.id, version: presetScopeValidator.version },
              }),
          ...(profile === 'full'
            ? {
                outputSchema: {
                  type: 'object',
                  required: ['proposal'],
                  properties: {
                    proposal: { type: 'string', minLength: 1 },
                    handoffContext: { type: 'string', minLength: 1 },
                    handoffHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                  },
                },
              }
            : {
                outputSchema: {
                  type: 'object',
                  required: ['event'],
                  properties: {
                    event: { enum: ['build-complete', 'escalation-requested'] },
                    proposal: { type: 'string', minLength: 1 },
                    requirementsEvidence: {
                      type: 'object',
                      required: ['ref', 'contentHash'],
                      properties: {
                        ref: { type: 'string', minLength: 1 },
                        contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
                      },
                      additionalProperties: false,
                    },
                    checks: classicAgentCheckReportsSchema,
                    checksReason: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              }),
        },
        ...(profile === 'full'
          ? {}
          : {
              [`${profile}.build.escalation-confirm`]: {
                type: 'ask_user' as const,
                proposalFrom: followingStep,
                choices: ['continue', 'upgrade'],
              },
            }),
        ...(profile === 'full'
          ? {
              'full.design.confirm': {
                type: 'ask_user' as const,
                proposalFrom: 'full.design.handoff',
                choices: ['approved', 'rejected'],
              },
              'full.design.document': {
                type: 'invoke_skill' as const,
                ref: 'comet-design',
                outputSchema: {
                  type: 'object',
                  required: ['designDoc'],
                  properties: { designDoc: { type: 'string', minLength: 1 } },
                },
              },
              'full.design.evidence': {
                type: 'await_evidence' as const,
                kind: 'classic-design-document',
                validator: { id: 'comet-classic-design-document', version: '1' },
              },
              'full.build.configure': {
                type: 'invoke_skill' as const,
                ref: 'comet-build',
                validator: {
                  id: buildConfigurationValidator.id,
                  version: buildConfigurationValidator.version,
                },
                outputSchema: {
                  type: 'object',
                  required: ['buildMode', 'tddMode', 'reviewMode', 'isolation'],
                  properties: {
                    buildMode: {
                      enum: [
                        'subagent-driven-development',
                        'executing-plans',
                        'direct',
                        'autonomous',
                      ],
                    },
                    tddMode: { enum: ['tdd', 'direct'] },
                    reviewMode: { enum: ['off', 'standard', 'thorough'] },
                    isolation: { enum: ['current', 'branch', 'worktree'] },
                    boundBranch: nullableString,
                    subagentDispatch: { enum: ['confirmed', null] },
                    directOverride: { type: 'boolean' },
                  },
                  additionalProperties: false,
                },
              },
              'full.build.confirm': {
                type: 'ask_user' as const,
                proposalFrom: 'full.build.configure',
                choices: ['approved', 'rejected'],
              },
              'full.build.plan': {
                type: 'invoke_skill' as const,
                ref: 'comet-build',
                outputSchema: {
                  type: 'object',
                  required: ['plan'],
                  properties: {
                    plan: { type: 'string', minLength: 1 },
                    buildPause: { enum: ['plan-ready'] },
                  },
                },
              },
              'full.build.plan.evidence': {
                type: 'await_evidence' as const,
                kind: 'classic-build-plan',
                validator: { id: 'comet-classic-build-plan', version: '1' },
              },
              'full.build.execute': {
                type: 'invoke_skill' as const,
                ref: 'comet-build',
                outputSchema: {
                  type: 'object',
                  required: ['event'],
                  properties: {
                    event: { enum: ['build-complete'] },
                    checks: classicAgentCheckReportsSchema,
                    checksReason: { type: 'string', minLength: 1 },
                  },
                },
              },
              'full.verify.run': {
                type: 'invoke_skill' as const,
                ref: 'comet-verify',
                outputSchema: {
                  type: 'object',
                  required: ['event'],
                  properties: {
                    event: { enum: ['verification-ready', 'verify-fail'] },
                    verificationReport: { type: 'string', minLength: 1 },
                    reason: { type: 'string', minLength: 1 },
                    checks: classicAgentCheckReportsSchema,
                    checksReason: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
              'full.verify.report.evidence': {
                type: 'await_evidence' as const,
                kind: 'classic-verification-report',
                validator: { id: 'comet-classic-verification-report', version: '1' },
              },
              'full.archive.prepare': {
                type: 'invoke_skill' as const,
                ref: 'comet-archive',
                outputSchema: {
                  type: 'object',
                  required: ['targetBranch', 'summary'],
                  properties: {
                    targetBranch: { type: 'string', minLength: 1 },
                    remote: { type: 'string', minLength: 1 },
                    prBaseBranch: { type: 'string', minLength: 1 },
                    summary: { type: 'string', minLength: 1 },
                    deliveryPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
                  },
                  additionalProperties: false,
                },
              },
              'full.archive.confirm': {
                type: 'ask_user' as const,
                proposalFrom: 'full.archive.prepare',
                choices: ['local', 'push', 'pr', 'reverify', 'later'],
              },
              'full.archive.preflight': {
                type: 'call_tool' as const,
                ref: 'classic-archive-preflight',
                outputSchema: {
                  type: 'object',
                  required: ['deliveryAction', 'targetBranch', 'verifiedBranch', 'baseCommit'],
                  properties: {
                    deliveryAction: { enum: ['local', 'push', 'pr'] },
                    targetBranch: { type: 'string', minLength: 1 },
                    verifiedBranch: { type: 'string', minLength: 1 },
                    baseCommit: { type: 'string', pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
                    remote: { type: 'string', minLength: 1 },
                    remoteIdentity: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                    prBaseBranch: { type: 'string', minLength: 1 },
                    deliveryPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
                  },
                  additionalProperties: false,
                },
              },
              'full.archive.execute': {
                type: 'call_tool' as const,
                ref: 'classic-archive',
                validator: { id: 'comet-classic-archive-outcome', version: '1' },
                outputSchema: {
                  type: 'object',
                  required: ['archiveDirectory'],
                  properties: {
                    archiveDirectory: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
              'full.archive.deliver': {
                type: 'invoke_skill' as const,
                ref: 'comet-archive',
                validator: { id: 'comet-classic-delivery-outcome', version: '1' },
                outputSchema: {
                  type: 'object',
                  required: ['action', 'targetBranch', 'commit'],
                  properties: {
                    action: { enum: ['local', 'push', 'pr'] },
                    targetBranch: { type: 'string', minLength: 1 },
                    commit: { type: 'string', pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
                    remote: { type: 'string', minLength: 1 },
                    prUrl: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
              'full.build.plan-ready': {
                type: 'ask_user' as const,
                proposalFrom: 'full.build.plan',
                choices: ['continue'],
              },
            }
          : {
              [`${profile}.verify.run`]: {
                type: 'invoke_skill' as const,
                ref: 'comet-verify',
                outputSchema: {
                  type: 'object',
                  required: ['event'],
                  properties: {
                    event: { enum: ['verification-ready', 'verify-fail'] },
                    verificationReport: { type: 'string', minLength: 1 },
                    reason: { type: 'string', minLength: 1 },
                    checks: classicAgentCheckReportsSchema,
                    checksReason: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
              [`${profile}.verify.report.evidence`]: {
                type: 'await_evidence' as const,
                kind: 'classic-verification-report',
                validator: { id: 'comet-classic-verification-report', version: '1' },
              },
              [`${profile}.archive.prepare`]: {
                type: 'invoke_skill' as const,
                ref: 'comet-archive',
                outputSchema: {
                  type: 'object',
                  required: ['targetBranch', 'summary'],
                  properties: {
                    targetBranch: { type: 'string', minLength: 1 },
                    remote: { type: 'string', minLength: 1 },
                    prBaseBranch: { type: 'string', minLength: 1 },
                    summary: { type: 'string', minLength: 1 },
                    deliveryPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
                  },
                  additionalProperties: false,
                },
              },
              [`${profile}.archive.confirm`]: {
                type: 'ask_user' as const,
                proposalFrom: `${profile}.archive.prepare`,
                choices: ['local', 'push', 'pr', 'reverify', 'later'],
              },
              [`${profile}.archive.preflight`]: {
                type: 'call_tool' as const,
                ref: 'classic-archive-preflight',
                outputSchema: {
                  type: 'object',
                  required: ['deliveryAction', 'targetBranch', 'verifiedBranch', 'baseCommit'],
                  properties: {
                    deliveryAction: { enum: ['local', 'push', 'pr'] },
                    targetBranch: { type: 'string', minLength: 1 },
                    verifiedBranch: { type: 'string', minLength: 1 },
                    baseCommit: { type: 'string', pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
                    remote: { type: 'string', minLength: 1 },
                    remoteIdentity: { type: 'string', pattern: '^[0-9a-f]{64}$' },
                    prBaseBranch: { type: 'string', minLength: 1 },
                    deliveryPaths: { type: 'array', items: { type: 'string', minLength: 1 } },
                  },
                  additionalProperties: false,
                },
              },
              [`${profile}.archive.execute`]: {
                type: 'call_tool' as const,
                ref: 'classic-archive',
                validator: { id: 'comet-classic-archive-outcome', version: '1' },
                outputSchema: {
                  type: 'object',
                  required: ['archiveDirectory'],
                  properties: {
                    archiveDirectory: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
              [`${profile}.archive.deliver`]: {
                type: 'invoke_skill' as const,
                ref: 'comet-archive',
                validator: { id: 'comet-classic-delivery-outcome', version: '1' },
                outputSchema: {
                  type: 'object',
                  required: ['action', 'targetBranch', 'commit'],
                  properties: {
                    action: { enum: ['local', 'push', 'pr'] },
                    targetBranch: { type: 'string', minLength: 1 },
                    commit: { type: 'string', pattern: '^[0-9a-f]{40}(?:[0-9a-f]{24})?$' },
                    remote: { type: 'string', minLength: 1 },
                    prUrl: { type: 'string', minLength: 1 },
                  },
                  additionalProperties: false,
                },
              },
            }),
        ...(fullApplication
          ? Object.fromEntries(
              Object.entries(fullApplication.workflow.steps).filter(
                ([stepId]) => stepId.startsWith('full.') && !stepId.startsWith('full.open'),
              ),
            )
          : {}),
      },
      transitions: [
        { from: openStep, to: evidenceStep },
        { from: evidenceStep, to: profile === 'full' ? 'full.open.confirm' : followingStep },
        ...(profile === 'full'
          ? [
              { from: 'full.open.confirm', to: 'full.open.revalidate', on: 'approved' },
              { from: 'full.open.confirm', to: openStep, on: 'rejected' },
              { from: 'full.open.revalidate', to: followingStep },
              { from: 'full.open.revalidate', to: openStep },
            ]
          : [
              { from: followingStep, to: `${profile}.build.escalation-confirm` },
              {
                from: `${profile}.build.escalation-confirm`,
                to: followingStep,
                on: 'continue',
              },
              {
                from: `${profile}.build.escalation-confirm`,
                to: 'full.design.handoff',
                on: 'upgrade',
              },
              { from: `${profile}.verify.run`, to: `${profile}.verify.report.evidence` },
              { from: `${profile}.verify.run`, to: `${profile}.build.execute` },
              { from: `${profile}.archive.prepare`, to: `${profile}.archive.confirm` },
              {
                from: `${profile}.archive.confirm`,
                to: `${profile}.archive.preflight`,
                on: 'local',
              },
              {
                from: `${profile}.archive.confirm`,
                to: `${profile}.archive.preflight`,
                on: 'push',
              },
              { from: `${profile}.archive.confirm`, to: `${profile}.archive.preflight`, on: 'pr' },
              { from: `${profile}.archive.confirm`, to: `${profile}.verify.run`, on: 'reverify' },
              { from: `${profile}.archive.confirm`, to: `${profile}.archive.confirm`, on: 'later' },
              { from: `${profile}.archive.preflight`, to: `${profile}.archive.execute` },
              { from: `${profile}.archive.execute`, to: `${profile}.archive.deliver` },
            ]),
        ...(profile === 'full'
          ? [
              { from: 'full.design.handoff', to: 'full.design.confirm' },
              { from: 'full.design.confirm', to: 'full.design.document', on: 'approved' },
              { from: 'full.design.confirm', to: 'full.design.handoff', on: 'rejected' },
              { from: 'full.design.document', to: 'full.design.evidence' },
              { from: 'full.design.evidence', to: 'full.build.configure' },
              { from: 'full.build.configure', to: 'full.build.confirm' },
              { from: 'full.build.confirm', to: 'full.build.plan', on: 'approved' },
              { from: 'full.build.confirm', to: 'full.build.configure', on: 'rejected' },
              { from: 'full.build.plan', to: 'full.build.plan.evidence' },
              { from: 'full.build.plan.evidence', to: 'full.build.execute' },
              { from: 'full.build.plan.evidence', to: 'full.build.plan-ready' },
              { from: 'full.build.plan-ready', to: 'full.build.plan.evidence', on: 'continue' },
              { from: 'full.verify.run', to: 'full.verify.report.evidence' },
              { from: 'full.verify.run', to: 'full.build.plan' },
              { from: 'full.archive.prepare', to: 'full.archive.confirm' },
              { from: 'full.archive.confirm', to: 'full.archive.preflight', on: 'local' },
              { from: 'full.archive.confirm', to: 'full.archive.preflight', on: 'push' },
              { from: 'full.archive.confirm', to: 'full.archive.preflight', on: 'pr' },
              { from: 'full.archive.confirm', to: 'full.verify.run', on: 'reverify' },
              { from: 'full.archive.confirm', to: 'full.archive.confirm', on: 'later' },
              { from: 'full.archive.preflight', to: 'full.archive.execute' },
              { from: 'full.archive.execute', to: 'full.archive.deliver' },
            ]
          : []),
        ...(fullApplication
          ? (fullApplication.workflow.transitions?.filter(
              (edge) => edge.from.startsWith('full.') && !edge.from.startsWith('full.open'),
            ) ?? [])
          : []),
        { from: `${profile}.build.execute`, to: `${profile}.verify.run` },
        { from: `${profile}.verify.report.evidence`, to: `${profile}.archive.prepare` },
      ],
    },
    transitionHandler: {
      ...transitionRef,
      apply({ run, event }) {
        if (
          event.kind === 'action-outcome' &&
          event.outcome.status === 'succeeded' &&
          (event.stepId.endsWith('.build.execute') || event.stepId.endsWith('.verify.run'))
        ) {
          const output = event.outcome.output as {
            event?: string;
            checks?: Array<{
              name: string;
              result: string;
              note?: string;
            }>;
            checksReason?: string;
          };
          if (['build-complete', 'verification-ready'].includes(output.event ?? '')) {
            const accepted = run.actions.find((action) => action.id === event.outcome.actionId);
            if (
              accepted?.executionOrigin?.workflow.version !== '1' ||
              accepted.status !== 'succeeded' ||
              run.outputs[event.stepId]?.sequence !== run.actionContexts[accepted.id]?.sequence ||
              !isDeepStrictEqual(run.outputs[event.stepId]?.value, accepted.outcome?.output) ||
              !isDeepStrictEqual(accepted.outcome, event.outcome)
            )
              assertClassicAgentCheckReports(output);
          }
        }
        if (event.kind === 'action-outcome' && event.outcome.status === 'failed') {
          const interrupted = run.actions.find((action) => action.id === event.outcome.actionId);
          if (interrupted?.type === 'invoke_skill') return { state: run.state!, next: [] };
        }
        if (fullApplication && event.stepId.startsWith('full.')) {
          return fullApplication.transitionHandler.apply({ run, event });
        }
        if (
          profile !== 'full' &&
          event.kind === 'wait-resolved' &&
          event.stepId === `${profile}.build.escalation-confirm`
        ) {
          if (event.choice === 'continue') return { state: run.state!, next: [followingStep] };
          if (event.choice !== 'upgrade') {
            throw new Error('Classic preset escalation choice is invalid');
          }
          const current = run.state as unknown as ClassicState;
          const escalated = applyClassicTransition(current, 'preset-escalate').classic;
          return {
            state: {
              ...escalated,
              isolation: current.isolation,
              boundBranch: current.boundBranch,
            } as unknown as RuntimeValue,
            next: ['full.design.handoff'],
          };
        }
        if (
          profile !== 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === followingStep
        ) {
          const output = event.outcome.output as {
            event?: unknown;
            proposal?: unknown;
          };
          if (
            event.outcome.status === 'succeeded' &&
            output.event === 'escalation-requested' &&
            typeof output.proposal === 'string' &&
            output.proposal.trim()
          ) {
            return { state: run.state!, next: [`${profile}.build.escalation-confirm`] };
          }
          if (event.outcome.status !== 'succeeded' || output.event !== 'build-complete') {
            throw new Error('Classic preset Build result does not match its declared transition');
          }
          return {
            state: applyClassicTransition(run.state as unknown as ClassicState, 'build-complete')
              .classic as unknown as RuntimeValue,
            next: [`${profile}.verify.run`],
          };
        }
        if (
          profile !== 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === `${profile}.verify.run`
        ) {
          const output = event.outcome.output as {
            event?: unknown;
            verificationReport?: unknown;
            reason?: unknown;
          };
          if (event.outcome.status === 'succeeded' && output.event === 'verify-fail') {
            if (typeof output.reason !== 'string' || !output.reason.trim()) {
              throw new Error('Classic preset Verify failure requires a reason');
            }
            const state = applyClassicTransition(
              run.state as unknown as ClassicState,
              'verify-fail',
            );
            return {
              state: state.classic as unknown as RuntimeValue,
              next: [`${profile}.build.execute`],
            };
          }
          if (
            event.outcome.status !== 'succeeded' ||
            output.event !== 'verification-ready' ||
            typeof output.verificationReport !== 'string'
          ) {
            throw new Error('Classic preset Verify report did not complete');
          }
          return {
            state: {
              ...(run.state as object),
              verificationReport: output.verificationReport,
            } as RuntimeValue,
            next: [`${profile}.verify.report.evidence`],
          };
        }
        if (
          profile !== 'full' &&
          event.kind === 'evidence-recorded' &&
          event.stepId === `${profile}.verify.report.evidence`
        ) {
          if (event.ref !== (run.state as unknown as ClassicState).verificationReport) {
            throw new Error('Classic preset Verify report evidence does not match');
          }
          return {
            state: applyClassicTransition(run.state as unknown as ClassicState, 'verify-pass')
              .classic as unknown as RuntimeValue,
            next: [`${profile}.archive.prepare`],
          };
        }
        if (
          profile !== 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === `${profile}.archive.prepare`
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic preset Archive preparation did not complete');
          }
          return { state: run.state!, next: [`${profile}.archive.confirm`] };
        }
        if (event.kind === 'action-outcome' && event.stepId === openStep) {
          if (
            event.outcome.status !== 'succeeded' ||
            (
              event.outcome.output as {
                event?: unknown;
              }
            )?.event !== 'open-complete'
          ) {
            throw new Error('Classic Open result does not match its declared transition');
          }
          return { state: run.state!, next: [evidenceStep] };
        }
        if (
          profile === 'full' &&
          event.kind === 'wait-resolved' &&
          event.stepId === 'full.open.confirm'
        ) {
          return {
            state: run.state!,
            next: [event.choice === 'approved' ? 'full.open.revalidate' : openStep],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.open.revalidate'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Open revalidation did not complete');
          }
          const state = applyClassicTransition(
            run.state as unknown as ClassicState,
            'open-complete',
          );
          return { state: state.classic as unknown as RuntimeValue, next: [followingStep] };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === followingStep
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Design handoff did not succeed');
          }
          const output = event.outcome.output as {
            handoffContext?: string;
            handoffHash?: string | null;
          };
          return {
            state: {
              ...(run.state as object),
              ...(run.commands?.some(
                (command) =>
                  command.name === 'revise-design' && command.actionId === event.outcome.actionId,
              )
                ? {
                    phase: 'design',
                    verifyResult: 'pending',
                    verifiedAt: null,
                    archiveConfirmation: null,
                  }
                : {}),
              ...(output.handoffContext
                ? { handoffContext: output.handoffContext, handoffHash: output.handoffHash ?? null }
                : {}),
            } as RuntimeValue,
            next: ['full.design.confirm'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'wait-resolved' &&
          event.stepId === 'full.design.confirm'
        ) {
          return {
            state: run.state!,
            next: [event.choice === 'approved' ? 'full.design.document' : 'full.design.handoff'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.design.document'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Design document work did not succeed');
          }
          const designDoc = (
            event.outcome.output as {
              designDoc: string;
            }
          ).designDoc;
          return {
            state: { ...(run.state as object), designDoc } as RuntimeValue,
            next: ['full.design.evidence'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'evidence-recorded' &&
          event.stepId === 'full.design.evidence'
        ) {
          if (event.ref !== (run.state as unknown as ClassicState).designDoc) {
            throw new Error('Classic Design evidence does not match the selected document');
          }
          const state = applyClassicTransition(
            run.state as unknown as ClassicState,
            'design-complete',
          );
          return {
            state: state.classic as unknown as RuntimeValue,
            next: [
              run.commands?.some(
                (command) =>
                  command.name === 'revise-design' &&
                  ['build', 'verify', 'archive'].includes(
                    (
                      run.actions.find((action) => action.id === command.actionId)?.input as
                        | {
                            activation?: {
                              fromPhase?: string;
                            };
                          }
                        | undefined
                    )?.activation?.fromPhase ?? '',
                  ),
              )
                ? 'full.build.plan'
                : 'full.build.configure',
            ],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.build.configure'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Build configuration did not succeed');
          }
          return { state: run.state!, next: ['full.build.confirm'] };
        }
        if (
          profile === 'full' &&
          event.kind === 'wait-resolved' &&
          event.stepId === 'full.build.confirm'
        ) {
          if (event.choice === 'rejected') {
            return { state: run.state!, next: ['full.build.configure'] };
          }
          const decision = run.waits.find(
            (wait) =>
              wait.stepId === 'full.build.confirm' &&
              wait.decision?.id === event.decisionId &&
              wait.proposalHash === event.proposalHash,
          );
          const proposed = (
            decision?.proposal as
              | {
                  outputs?: Record<string, RuntimeValue>;
                }
              | undefined
          )?.outputs?.['full.build.configure'];
          const recorded = run.outputs['full.build.configure']?.value;
          if (
            event.choice !== 'approved' ||
            proposed === undefined ||
            recorded === undefined ||
            hashRuntimeValue(proposed) !== hashRuntimeValue(recorded)
          ) {
            throw new Error('Classic Build confirmation no longer matches the proposed choices');
          }
          const configuration = proposed as Pick<
            ClassicState,
            | 'buildMode'
            | 'tddMode'
            | 'reviewMode'
            | 'isolation'
            | 'boundBranch'
            | 'subagentDispatch'
            | 'directOverride'
          >;
          const state: ClassicState = {
            ...(run.state as unknown as ClassicState),
            ...configuration,
          };
          const readiness = classicConfigurationReadiness(state);
          if (
            state.isolation === null ||
            readiness.missingFields.length > 0 ||
            readiness.invalidFields.length > 0
          ) {
            throw new Error('Classic Build configuration is incomplete or invalid');
          }
          return { state: state as unknown as RuntimeValue, next: ['full.build.plan'] };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.build.plan'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Build plan work did not succeed');
          }
          const { plan, buildPause } = event.outcome.output as {
            plan: string;
            buildPause?: 'plan-ready';
          };
          return {
            state: {
              ...(run.state as object),
              plan,
              buildPause: buildPause ?? null,
            } as RuntimeValue,
            next: ['full.build.plan.evidence'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'evidence-recorded' &&
          event.stepId === 'full.build.plan.evidence'
        ) {
          if (event.ref !== (run.state as unknown as ClassicState).plan) {
            throw new Error('Classic Build plan evidence does not match the selected plan');
          }
          return {
            state: run.state!,
            next: [
              (run.state as unknown as ClassicState).buildPause === 'plan-ready'
                ? 'full.build.plan-ready'
                : 'full.build.execute',
            ],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'wait-resolved' &&
          event.stepId === 'full.build.plan-ready'
        ) {
          if (event.choice !== 'continue') {
            throw new Error('Classic Build continuation requires explicit user choice');
          }
          return {
            state: { ...(run.state as object), buildPause: null } as RuntimeValue,
            next: ['full.build.plan.evidence'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.build.execute'
        ) {
          if (
            event.outcome.status !== 'succeeded' ||
            (
              event.outcome.output as {
                event?: unknown;
              }
            )?.event !== 'build-complete'
          ) {
            throw new Error('Classic Build work did not complete');
          }
          return {
            state: applyClassicTransition(run.state as unknown as ClassicState, 'build-complete')
              .classic as unknown as RuntimeValue,
            next: [`${profile}.verify.run`],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.verify.run'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Verify assessment did not complete');
          }
          const output = event.outcome.output as {
            event: 'verification-ready' | 'verify-fail';
            verificationReport?: string;
            reason?: string;
          };
          if (output.event === 'verify-fail') {
            if (!output.reason?.trim()) {
              throw new Error('Classic Verify failure requires a reason');
            }
            const state = applyClassicTransition(
              run.state as unknown as ClassicState,
              'verify-fail',
            );
            return { state: state.classic as unknown as RuntimeValue, next: ['full.build.plan'] };
          }
          if (output.event !== 'verification-ready' || !output.verificationReport) {
            throw new Error('Classic Verify report path is missing');
          }
          return {
            state: {
              ...(run.state as object),
              verificationReport: output.verificationReport,
            } as RuntimeValue,
            next: ['full.verify.report.evidence'],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'evidence-recorded' &&
          event.stepId === 'full.verify.report.evidence'
        ) {
          if (event.ref !== (run.state as unknown as ClassicState).verificationReport) {
            throw new Error('Classic Verify evidence does not match the selected report');
          }
          return {
            state: applyClassicTransition(run.state as unknown as ClassicState, 'verify-pass')
              .classic as unknown as RuntimeValue,
            next: [`${profile}.archive.prepare`],
          };
        }
        if (
          profile === 'full' &&
          event.kind === 'action-outcome' &&
          event.stepId === 'full.archive.prepare'
        ) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Archive preparation did not complete');
          }
          return { state: run.state!, next: ['full.archive.confirm'] };
        }
        if (event.kind === 'wait-resolved' && event.stepId === `${profile}.archive.confirm`) {
          if (event.choice === 'reverify') {
            const state = applyClassicTransition(
              run.state as unknown as ClassicState,
              'archive-reopen',
            );
            return {
              state: state.classic as unknown as RuntimeValue,
              next: [`${profile}.verify.run`],
            };
          }
          if (event.choice === 'later') {
            return { state: run.state!, next: [`${profile}.archive.confirm`] };
          }
          const decision = run.waits.find(
            (wait) =>
              wait.stepId === `${profile}.archive.confirm` &&
              wait.decision?.id === event.decisionId &&
              wait.proposalHash === event.proposalHash,
          );
          const proposed = (
            decision?.proposal as
              | {
                  outputs?: Record<string, RuntimeValue>;
                }
              | undefined
          )?.outputs?.[`${profile}.archive.prepare`];
          const recorded = run.outputs[`${profile}.archive.prepare`]?.value;
          if (
            proposed === undefined ||
            recorded === undefined ||
            hashRuntimeValue(proposed) !== hashRuntimeValue(recorded)
          ) {
            throw new Error('Classic Archive choice no longer matches its proposal');
          }
          const target = proposed as {
            targetBranch: string;
            remote?: string;
            prBaseBranch?: string;
          };
          const state = run.state as unknown as ClassicState;
          if (
            !['local', 'push', 'pr'].includes(event.choice) ||
            !state.boundBranch ||
            target.targetBranch !== state.boundBranch ||
            (event.choice !== 'local' && !target.remote) ||
            (event.choice === 'pr' && !target.prBaseBranch)
          ) {
            throw new Error('Classic Archive target does not match the bound branch or delivery');
          }
          const confirmed = applyClassicTransition(state, 'archive-confirm');
          return {
            state: confirmed.classic as unknown as RuntimeValue,
            next: [`${profile}.archive.preflight`],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === `${profile}.archive.preflight`) {
          if (event.outcome.status !== 'succeeded') {
            throw new Error('Classic Archive preflight did not pass');
          }
          const approval = run.waits
            .slice()
            .reverse()
            .find(
              (wait) =>
                wait.stepId === `${profile}.archive.confirm` &&
                wait.status === 'resolved' &&
                ['local', 'push', 'pr'].includes(wait.decision?.choice ?? ''),
            );
          const proposal = (
            approval?.proposal as
              | {
                  outputs?: Record<string, RuntimeValue>;
                }
              | undefined
          )?.outputs?.[`${profile}.archive.prepare`] as
            | {
                targetBranch?: string;
                prBaseBranch?: string;
              }
            | undefined;
          const output = event.outcome.output as {
            deliveryAction?: string;
            targetBranch?: string;
            verifiedBranch?: string;
            prBaseBranch?: string;
          };
          if (
            !approval ||
            !proposal ||
            approval.decision?.choice !== output.deliveryAction ||
            proposal.targetBranch !== output.targetBranch ||
            (approval.decision?.choice === 'pr' && proposal.prBaseBranch !== output.prBaseBranch) ||
            output.targetBranch !== output.verifiedBranch ||
            output.targetBranch !== (run.state as unknown as ClassicState).boundBranch
          ) {
            throw new Error('Classic Archive preflight no longer matches the approved target');
          }
          return { state: run.state!, next: [`${profile}.archive.execute`] };
        }
        if (event.kind === 'action-outcome' && event.stepId === `${profile}.archive.execute`) {
          if (event.outcome.status !== 'succeeded') {
            return { state: run.state!, next: [] };
          }
          const archived = applyClassicTransition(run.state as unknown as ClassicState, 'archived');
          const activeRef = (
            run.input as {
              changeDir: string;
            }
          ).changeDir.replaceAll('\\', '/');
          const archiveRef = (
            event.outcome.output as {
              archiveDirectory: string;
            }
          ).archiveDirectory.replaceAll('\\', '/');
          return {
            state: {
              ...archived.classic,
              designDoc: archivedClassicDocumentRef(
                archived.classic.designDoc,
                activeRef,
                archiveRef,
              ),
              plan: archivedClassicDocumentRef(archived.classic.plan, activeRef, archiveRef),
              verificationReport: archivedClassicDocumentRef(
                archived.classic.verificationReport,
                activeRef,
                archiveRef,
              ),
              handoffContext: archivedClassicDocumentRef(
                archived.classic.handoffContext,
                activeRef,
                archiveRef,
              ),
            } as unknown as RuntimeValue,
            next: [`${profile}.archive.deliver`],
          };
        }
        if (event.kind === 'action-outcome' && event.stepId === `${profile}.archive.deliver`) {
          if (event.outcome.status !== 'succeeded') return { state: run.state!, next: [] };
          const state = run.state as unknown as ClassicState;
          return {
            state: { ...state, branchStatus: 'handled' } as unknown as RuntimeValue,
            next: [],
          };
        }
        if (
          event.kind !== 'evidence-recorded' ||
          event.stepId !== evidenceStep ||
          event.evidenceKind !== 'classic-open-artifacts'
        ) {
          throw new Error('Classic Open evidence does not match its declared transition');
        }
        if (profile === 'full') {
          return { state: run.state!, next: ['full.open.confirm'] };
        }
        const state = applyClassicTransition(run.state as unknown as ClassicState, 'open-complete');
        return {
          state: state.classic as unknown as RuntimeValue,
          next: [followingStep],
        };
      },
    },
  };
}
/** 通用 SDK 证据接口沿用原 Action 请求身份；不读取或摘要文件内容。 */
export function classicSdkEvidenceInputHash(run: Readonly<WorkflowRun>, stepId: string): string {
  const action = run.actions
    .slice()
    .reverse()
    .find((entry) => entry.stepId === stepId);
  if (!action) throw new Error('Classic evidence has no originating Action');
  return action.inputHash;
}
/** Reports are validated when submitted, and bound to the accepted Verify Action. */
export function assertClassicAgentCheckReports(output: {
  checks?: Array<{
    name: string;
    result: string;
    note?: string;
  }>;
  checksReason?: string;
}): void {
  if (
    !Array.isArray(output.checks) ||
    (!output.checks.length && !output.checksReason?.trim()) ||
    output.checks.some(
      (check) =>
        !check.name?.trim() ||
        !['passed', 'not-run'].includes(check.result) ||
        (check.result === 'not-run' && !check.note?.trim()),
    )
  ) {
    throw new Error(
      'Classic completion requires actual check reports; explain checks not run and resolve failed checks before acceptance',
    );
  }
}
export async function readClassicAgentCheckReports(projectRoot: string, ref: string) {
  const value = JSON.parse(
    (
      await readFileRaceSafe(path.resolve(projectRoot, ref), Number.MAX_SAFE_INTEGER, {
        label: 'Classic check reports',
      })
    ).bytes.toString('utf8'),
  ) as {
    checks?: Array<{
      name: string;
      result: string;
      note?: string;
    }>;
    checksReason?: string;
  };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['checks', 'checksReason'].includes(key)) ||
    !Array.isArray(value.checks) ||
    (value.checksReason !== undefined && typeof value.checksReason !== 'string') ||
    value.checks.some(
      (check) =>
        !check ||
        typeof check !== 'object' ||
        typeof check.name !== 'string' ||
        typeof check.result !== 'string' ||
        (check.note !== undefined && typeof check.note !== 'string') ||
        Object.keys(check).some((key) => !['name', 'result', 'note'].includes(key)),
    )
  )
    throw new Error(
      'Classic checks file must contain checks with name/result/note and optional checksReason',
    );
  assertClassicAgentCheckReports(value);
  return {
    checks: value.checks,
    ...(value.checksReason === undefined ? {} : { checksReason: value.checksReason }),
  };
}

/** 保留既有工厂名称；两者都只构造当前业务图。 */
export const defineClassicAgentWorkflowApplication = defineClassicWorkflowApplication;
