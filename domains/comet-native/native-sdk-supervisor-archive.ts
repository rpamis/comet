import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeSupervisorContractRef } from './native-children-contract.js';

import { stringify } from 'yaml';

import { inspectGitWorktree, resolveGitRef, samePath } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  RuntimeValue,
  WorkflowRun,
} from '../engine/runtime.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import { DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN, readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  createNativePortableState,
  parseNativePortableState,
  parseNativeReportedChecks,
  readNativePortableState,
} from './native-portable-state.js';
import { toNativePortableText } from './native-portable-text.js';
import type { NativeBuilderCheckSummary, NativePortableState } from './native-portable-types.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import { currentNativeSdkSupervisorActions } from './native-sdk-supervisor-plan.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';
import { nativeSupervisorChildWorktree } from './native-supervisor-workspace.js';
import {
  inspectNativeVerificationReportAlignment,
  renderNativeVerificationReport,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
import { nativeWorkspaceIsClean } from './native-workspace-config.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ACCEPTANCE_ID_PATTERN = /^A[1-9][0-9]*$/u;

export interface NativeSupervisorChildArchiveActivation {
  child: string;
  candidateCommit: string;
  integrationCommit: string;
  checksActionId?: string;
  mergeActionId?: string;
  repairActionId?: string;
  contractRef: string;
}

interface NativeSupervisorChildArchiveBinding {
  maxParallelChildren: number;
  parent: string;
  child: string;
  language: 'en' | 'zh-CN';
  targetBranch: string;
  worktree: string;
  branch: string;
  candidateCommit: string;
  integrationBranch: string;
  integrationWorktree: string;
  integrationCommit: string;
  builderSessionId: string | null;
  builderSummary: string | null;
  verifierSessionId: string;
  verifierSummary: string;
  verifierRisks: string[];
  verifierAcceptance: Map<string, string>;
  childChecks: Array<{
    id: string;
    name: string;
    argvDisplay: string[];
    cwdRef: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
  }>;
  reportedChecks?: NativeBuilderCheckSummary[];
  childChecksCompletedAt: string;
  integrationChecksCompletedAt: string;
  scopedAcceptance: Array<{ id: string; source: string; text: string }>;
}

function activation(input: unknown): NativeSupervisorChildArchiveActivation {
  const record = (input as { activation?: Record<string, unknown> } | null)?.activation;
  if (
    !record ||
    typeof record.child !== 'string' ||
    typeof record.candidateCommit !== 'string' ||
    typeof record.integrationCommit !== 'string' ||
    (typeof record.checksActionId !== 'string' && typeof record.mergeActionId !== 'string') ||
    typeof nativeSupervisorContractRef(record) !== 'string'
  ) {
    throw new Error('Native Supervisor child archive lacks its activation');
  }
  return {
    ...record,
    contractRef: nativeSupervisorContractRef(record)!,
  } as unknown as NativeSupervisorChildArchiveActivation;
}

function succeededChildAction(
  run: Readonly<WorkflowRun>,
  stepId: string,
  child: string,
  predicate: (output: Record<string, unknown>) => boolean,
): { action: RuntimeAction; output: Record<string, unknown> } | null {
  for (const action of [...currentNativeSdkSupervisorActions(run)].reverse()) {
    if (action.stepId !== stepId || action.status !== 'succeeded' || !action.outcome) continue;
    const activationChild = (action.input as { activation?: { child?: unknown } } | null)
      ?.activation?.child;
    if (activationChild !== child) continue;
    const output = action.outcome.output as Record<string, unknown> | null;
    if (!output || !predicate(output)) continue;
    return { action, output };
  }
  return null;
}

async function childArchiveBinding(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  materialsOnly = false,
): Promise<NativeSupervisorChildArchiveBinding> {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const state = plan.state;
  const input = activation(action.input);
  if (
    state.phase !== 'build' ||
    state.status !== 'active' ||
    !state.children_contract_ref ||
    nativeSupervisorContractRef(input, run) !== state.children_contract_ref ||
    !plan.contract.children.some(({ name }) => name === input.child) ||
    !COMMIT_PATTERN.test(input.candidateCommit) ||
    !COMMIT_PATTERN.test(input.integrationCommit)
  ) {
    throw new Error('Native Supervisor child archive does not match the confirmed plan');
  }
  // 旧归档输入仅从原已接受记录解析来源，不恢复检查任务。
  const legacyCheck = input.checksActionId
    ? run.actions.find((candidate) => candidate.id === input.checksActionId)
    : undefined;
  const legacyOutput = legacyCheck?.outcome?.output as
    { candidateId?: string; completedAt?: string } | undefined;
  if (
    legacyCheck &&
    (legacyCheck.stepId !== 'supervisor.child.integration-checks' ||
      legacyCheck.status !== 'succeeded' ||
      legacyOutput?.candidateId !== input.integrationCommit ||
      typeof legacyOutput.completedAt !== 'string')
  )
    throw new Error('Native legacy archive lacks its original accepted integration result');
  const mergeActionId =
    input.mergeActionId ??
    (legacyCheck?.input as { activation?: { mergeActionId?: string } } | undefined)?.activation
      ?.mergeActionId;
  const merge = run.actions.find((candidate) => candidate.id === mergeActionId);
  const merged = merge?.outcome?.output as
    { child?: string; integrationCommit?: string } | undefined;
  const repairActionId =
    input.repairActionId ??
    (legacyCheck?.input as { activation?: { repairActionId?: string } } | undefined)?.activation
      ?.repairActionId;
  const repair = repairActionId
    ? run.actions.find((candidate) => candidate.id === repairActionId)
    : undefined;
  const repaired = repair?.outcome?.output as
    { integrationCommit?: string; checks?: unknown } | undefined;
  if (
    merge?.stepId !== 'supervisor.child.integrate' ||
    merge.status !== 'succeeded' ||
    merged?.child !== input.child ||
    (repair
      ? repair.stepId !== 'supervisor.child.integration-repair' ||
        repair.status !== 'succeeded' ||
        (
          repair.input as {
            activation?: { mergeActionId?: string; child?: string; candidateCommit?: string };
          }
        ).activation?.mergeActionId !== merge.id ||
        (repair.input as { activation: { child: string; candidateCommit: string } }).activation
          .child !== input.child ||
        (repair.input as { activation: { candidateCommit: string } }).activation.candidateCommit !==
          input.candidateCommit ||
        nativeSupervisorContractRef(
          (repair.input as { activation: Record<string, unknown> }).activation,
          run,
        ) !== state.children_contract_ref ||
        repaired?.integrationCommit !== input.integrationCommit
      : merged.integrationCommit !== input.integrationCommit)
  )
    throw new Error('Native Supervisor child archive lacks its accepted integration task');
  const integrationCompletedAt =
    legacyOutput?.completedAt ??
    runGitCommand(
      (run.outputs['supervisor.prepare']?.value as { integrationWorktree: string })
        .integrationWorktree,
      ['show', '-s', '--format=%cI', input.integrationCommit],
    ).trim();
  const verifier = succeededChildAction(run, 'supervisor.child.verifier', input.child, (output) => {
    const evidence = output.evidence as { summary?: unknown } | null | undefined;
    return (
      output.verdict === 'pass' &&
      output.candidateCommit === input.candidateCommit &&
      typeof evidence?.summary === 'string' &&
      Boolean(evidence.summary.trim())
    );
  });
  if (!verifier || !verifier.action.claim?.sessionId) {
    throw new Error('Native Supervisor child archive lacks its passing Verifier');
  }
  const verifierEvidence = verifier.output.evidence as {
    summary: string;
    risks?: unknown;
    acceptance?: Array<{ id?: unknown; result?: unknown; reason?: unknown }>;
    checks?: unknown;
  };
  const builder = succeededChildAction(
    run,
    'supervisor.child.builder',
    input.child,
    (output) => output.candidateCommit === input.candidateCommit,
  );
  const legacyVerifier = ['1', '2', '3'].includes(
    verifier.action.executionOrigin?.workflow.version ?? '',
  );
  const childChecks = legacyVerifier
    ? succeededChildAction(
        run,
        'supervisor.child.checks',
        input.child,
        (output) => output.candidateId === input.candidateCommit,
      )
    : null;
  if (legacyVerifier && !childChecks)
    throw new Error('Legacy Child archive lacks its original accepted checks');
  const childChecksOutput = childChecks?.output as
    { checks?: Array<Record<string, unknown>>; completedAt?: string } | undefined;
  const prepared = run.outputs['supervisor.prepare']?.value as
    { integrationWorktree?: unknown; integrationBranch?: unknown } | undefined;
  if (
    typeof prepared?.integrationWorktree !== 'string' ||
    typeof prepared.integrationBranch !== 'string'
  ) {
    throw new Error('Native Supervisor child archive lacks its integration workspace');
  }
  const worktree = nativeSupervisorChildWorktree(projectRoot, state.name, input.child);
  const branch = `comet/supervisor/${state.name}/${input.child}`;
  if (inspectGitWorktree(worktree).currentBranch !== branch) {
    throw new Error('Native Supervisor child worktree moved before the child archive');
  }
  if (
    inspectGitWorktree(prepared.integrationWorktree).currentBranch !== prepared.integrationBranch
  ) {
    throw new Error('Native Supervisor integration worktree moved before the child archive');
  }
  const untrackedPaths = runGitCommand(worktree, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .split('\0')
    .filter((file) => file && file !== '.comet/config.yaml')
    .map((file) => file.replaceAll('\\', '/'));
  // 只提交归档文件，保留 Child 中与候选无关的未跟踪文件。
  if (
    !materialsOnly &&
    (!nativeWorkspaceIsClean(worktree, untrackedPaths) ||
      !nativeWorkspaceIsClean(prepared.integrationWorktree))
  ) {
    throw new Error('Native Supervisor child archive requires clean worktrees');
  }
  const verifierAcceptance = new Map<string, string>();
  if (Array.isArray(verifierEvidence.acceptance)) {
    for (const entry of verifierEvidence.acceptance) {
      if (typeof entry?.id !== 'string' || typeof entry?.result !== 'string') continue;
      verifierAcceptance.set(entry.id, typeof entry.reason === 'string' ? entry.reason : '');
    }
  }
  const scopedAcceptance = supervisorAcceptanceScope(plan.contract, input.child);
  for (const { id } of scopedAcceptance) {
    if (!verifierAcceptance.has(id)) {
      throw new Error(`Native Supervisor child archive evidence does not cover acceptance ${id}`);
    }
  }
  const childCheckRows = (childChecksOutput?.checks ?? []).map((check) => {
    if (
      typeof check.id !== 'string' ||
      typeof check.name !== 'string' ||
      !Array.isArray(check.argvDisplay) ||
      typeof check.cwdRef !== 'string' ||
      check.status !== 'passed' ||
      !Number.isSafeInteger(check.durationMs)
    ) {
      throw new Error('Native Supervisor child archive requires passed Child checks');
    }
    return {
      id: check.id,
      name: check.name,
      argvDisplay: check.argvDisplay as string[],
      cwdRef: check.cwdRef,
      status: check.status as string,
      exitCode: typeof check.exitCode === 'number' ? check.exitCode : null,
      durationMs: check.durationMs as number,
    };
  });
  const risks = Array.isArray(verifierEvidence.risks)
    ? verifierEvidence.risks.filter((risk): risk is string => typeof risk === 'string')
    : [];
  return {
    parent: state.name,
    maxParallelChildren:
      plan.state.coordination_mode === 'single-session'
        ? 1
        : (plan.config.native.max_parallel_children ?? DEFAULT_NATIVE_MAX_PARALLEL_CHILDREN),
    child: input.child,
    language: state.language,
    targetBranch: plan.targetBranch,
    worktree,
    branch,
    candidateCommit: input.candidateCommit,
    integrationBranch: prepared.integrationBranch,
    integrationWorktree: prepared.integrationWorktree,
    integrationCommit: input.integrationCommit,
    builderSessionId: builder?.action.claim?.sessionId ?? null,
    builderSummary: typeof builder?.output.summary === 'string' ? builder.output.summary : null,
    verifierSessionId: verifier.action.claim.sessionId,
    verifierSummary: verifierEvidence.summary,
    verifierRisks: risks,
    verifierAcceptance,
    childChecks: childCheckRows,
    ...(legacyVerifier
      ? {}
      : { reportedChecks: parseNativeReportedChecks(verifierEvidence.checks ?? []) }),
    childChecksCompletedAt: childChecksOutput?.completedAt ?? integrationCompletedAt,
    integrationChecksCompletedAt: integrationCompletedAt,
    scopedAcceptance,
  };
}

async function childArchiveMaterials(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  projectRoot: string,
  binding: NativeSupervisorChildArchiveBinding,
): Promise<Record<string, string>> {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const paths = await nativeProjectPaths(projectRoot, plan.config.native.artifact_root);
  const parentDir = path.join(paths.changesDir, binding.parent);
  const brief = await readNativeBoundedTextFile({
    root: parentDir,
    ref: plan.state.brief,
    includeHash: false,
  });
  const specs = await Promise.all(
    plan.state.spec_changes.flatMap((spec) =>
      spec.source
        ? [readNativeBoundedTextFile({ root: parentDir, ref: spec.source, includeHash: false })]
        : [],
    ),
  );
  const title = binding.language === 'zh-CN' ? '子任务归档' : 'Archived Child';
  const scope = binding.scopedAcceptance.map((item) => `- ${item.id}: ${item.text}`).join('\n');
  const sources = [brief, ...specs].map((source) => `- ${source.ref}`).join('\n');
  return {
    'brief.md': `# ${binding.child}\n\n${title}: ${binding.parent}\n\n${binding.language === 'zh-CN' ? '本归档仅覆盖以下已确认验收项。Spec 是 Parent 已确认内容的快照，不表示独立 Child Spec 变更或新增验收。' : 'This archive covers only the confirmed acceptance below. The Spec is a snapshot of the confirmed Parent, not an independent Child Spec change or additional acceptance.'}\n\n${scope}\n\n[Parent Spec](spec.md) · [${binding.language === 'zh-CN' ? '来源与原始简报' : 'Sources and original brief'}](archive-source.md) · [${binding.language === 'zh-CN' ? '验收记录' : 'Verification'}](verification.md)\n`,
    'spec.md':
      specs.length === 0
        ? '# Parent Spec\n\nNo Spec change was declared by the confirmed Parent.\n'
        : specs.length === 1
          ? specs[0].text
          : specs.map((spec) => `# ${spec.ref}\n\n${spec.text}`).join('\n\n'),
    'archive-source.md': `# ${binding.language === 'zh-CN' ? '归档材料来源' : 'Archive material sources'}\n\n- Parent Run: ${run.runId}\n- Archive Action: ${action.id}\n- Contract: ${nativeSupervisorContractRef(activation(action.input), run)}\n- Candidate: ${binding.candidateCommit}\n- Verifier: ${binding.verifierSessionId}\n- Integration Action: ${activation(action.input).mergeActionId ?? activation(action.input).checksActionId}\n\n${sources}\n\n## ${binding.language === 'zh-CN' ? 'Parent 原始简报' : 'Original Parent brief'}\n\n${brief.text}`,
  };
}

export async function writeMissingNativeSupervisorArchiveMaterials(
  directory: string,
  materials: Record<string, string>,
  dryRun: boolean,
) {
  const missing: string[] = [];
  for (const ref of Object.keys(materials)) {
    const existing = await readNativeBoundedTextFile({ root: directory, ref }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!existing) missing.push(ref);
  }
  if (!dryRun)
    for (const ref of missing)
      await atomicWriteText(path.join(directory, ref), materials[ref], {
        containedRoot: directory,
      });
  return missing;
}

/** 使用命令层读取的原 Parent，仅补材料，不重写验收和状态。 */
export async function restoreNativeSupervisorChildArchiveMaterials(
  options: {
    projectRoot: string;
    targetProjectRoot: string;
    parent: string;
    expectedRevision: number;
    dryRun: boolean;
  },
  inspection: { run: WorkflowRun; state: NativePortableState; artifactRootRef: string },
) {
  const { run, state, artifactRootRef } = inspection;
  if (run.revision !== options.expectedRevision)
    throw new Error('Native Parent revision changed before archive material recovery');
  const prepared = run.outputs['supervisor.prepare']?.value as
    { integrationWorktree?: string } | undefined;
  if (
    !prepared?.integrationWorktree ||
    !samePath(prepared.integrationWorktree, options.targetProjectRoot)
  )
    throw new Error('Native archive material recovery requires the recorded integration worktree');
  const paths = await nativeProjectPaths(options.targetProjectRoot, artifactRootRef);
  const recovered = [];
  for (const action of currentNativeSdkSupervisorActions(run).filter(
    (action) =>
      action.stepId === 'supervisor.child.archive' &&
      action.status === 'succeeded' &&
      nativeSupervisorContractRef(activation(action.input), run) === state.children_contract_ref,
  )) {
    if (action.claim?.executorId !== nativeSdkSupervisorChildArchiveExecutor.id)
      throw new Error('Native child archive receipt lacks its Runtime executor');
    const binding = await childArchiveBinding(run, action, options.projectRoot, true);
    const receipt = action.outcome?.output as Record<string, unknown> | undefined;
    if (
      !receipt ||
      receipt.child !== binding.child ||
      receipt.archiveRef !== archiveRefFor(binding) ||
      receipt.candidateCommit !== binding.candidateCommit ||
      typeof receipt.archiveCommit !== 'string' ||
      !COMMIT_PATTERN.test(receipt.archiveCommit)
    )
      throw new Error('Native archive receipt does not match its original checks');
    runGitCommand(options.targetProjectRoot, [
      'merge-base',
      '--is-ancestor',
      receipt.archiveCommit,
      'HEAD',
    ]);
    const directory = path.join(paths.archiveDir, receipt.archiveRef as string);
    const archived = await readNativePortableState(path.join(directory, 'comet-state.yaml'));
    if (
      archived.name !== binding.child ||
      !archived.archived ||
      archived.status !== 'done' ||
      archived.verification?.candidate_id !== binding.candidateCommit ||
      archived.verification.verifier_execution_ref !== binding.verifierSessionId ||
      archived.verification.completed_at !== binding.integrationChecksCompletedAt
    )
      throw new Error('Native archived record does not match its accepted candidate');
    const materials = await childArchiveMaterials(run, action, options.projectRoot, binding);
    const missing = await writeMissingNativeSupervisorArchiveMaterials(directory, materials, true);
    recovered.push({
      child: binding.child,
      archiveActionId: action.id,
      archiveRef: receipt.archiveRef,
      candidateCommit: binding.candidateCommit,
      missing,
      directory,
      materials,
    });
  }
  if (!options.dryRun)
    for (const archive of recovered)
      await writeMissingNativeSupervisorArchiveMaterials(
        archive.directory,
        archive.materials,
        false,
      );
  return {
    parent: run.runId,
    revision: run.revision,
    dryRun: options.dryRun,
    archives: recovered.map(
      ({ directory: _directory, materials: _materials, ...archive }) => archive,
    ),
  };
}

function buildChildArchiveState(binding: NativeSupervisorChildArchiveBinding): NativePortableState {
  const acceptance = binding.scopedAcceptance
    .filter(({ id }) => ACCEPTANCE_ID_PATTERN.test(id))
    .map(({ id, source, text }) => {
      const reason = binding.verifierAcceptance.get(id);
      return {
        id,
        source,
        text,
        result: 'passed' as const,
        reason: reason ? toNativePortableText(reason) : null,
      };
    });
  const base = createNativePortableState({
    name: binding.child,
    language: binding.language,
    workspace: {
      isolation: 'worktree',
      change_branch: binding.branch,
      target_branch: binding.targetBranch,
      finish: 'merge',
    },
  });
  return parseNativePortableState({
    ...base,
    created_at: binding.childChecksCompletedAt,
    phase: 'archive',
    status: 'done',
    archived: true,
    loop: {
      ...base.loop,
      iteration: 1,
      attempt: 1,
      stage: 'done',
      next_action: null,
    },
    acceptance,
    builder_handoff: {
      candidate_id: binding.candidateCommit,
      identity_provider: NATIVE_SKILL_COORDINATION,
      builder_execution_ref: binding.builderSessionId ?? binding.verifierSessionId,
      iteration: 1,
      summary: toNativePortableText(binding.builderSummary ?? binding.verifierSummary),
      addressed_acceptance_ids: acceptance.map(({ id }) => id),
      checks: binding.childChecks.map((check) => ({
        name: toNativePortableText(check.name),
        result: 'passed' as const,
        note: null,
      })),
      checks_truncated: false,
      known_limits: [],
      known_limits_truncated: false,
      review: null,
      submitted_at: binding.childChecksCompletedAt,
    },
    verification: {
      candidate_id: binding.candidateCommit,
      identity_provider: NATIVE_SKILL_COORDINATION,
      verifier_execution_ref: binding.verifierSessionId,
      iteration: 1,
      attempt: 1,
      assurance:
        binding.builderSessionId === binding.verifierSessionId
          ? 'self-reviewed'
          : 'skill-coordinated',
      verdict: 'pass',
      ...(binding.reportedChecks ? { reported_checks: binding.reportedChecks } : {}),
      checks: binding.childChecks.map((check) => ({
        id: check.id,
        name: toNativePortableText(check.name),
        argv_display: check.argvDisplay.map((argument) => toNativePortableText(argument)),
        argv_truncated: false,
        cwd_ref: check.cwdRef,
        status: 'passed' as const,
        exit_code: check.exitCode,
        duration_ms: check.durationMs,
      })),
      summary: toNativePortableText(binding.verifierSummary),
      risks: binding.verifierRisks.map((risk) => toNativePortableText(risk)),
      risks_truncated: false,
      completed_at: binding.integrationChecksCompletedAt,
    },
    verification_result: 'pass',
    verification_report: 'verification.md',
    history: [],
  });
}

async function childArchiveLocation(
  binding: NativeSupervisorChildArchiveBinding,
  archiveRef: string,
): Promise<{ target: string; relative: string; changesDir: string; nativeRoot: string }> {
  const projectConfig = await readProjectConfig(binding.worktree);
  if (!projectConfig) throw new Error('Native Supervisor child worktree has no project config');
  const paths = await nativeProjectPaths(binding.worktree, projectConfig.native.artifact_root);
  const target = path.join(paths.archiveDir, archiveRef);
  const resolved = path.resolve(target);
  const archiveRoot = path.resolve(paths.archiveDir);
  if (
    !resolved.toLowerCase().startsWith(`${archiveRoot.toLowerCase()}${path.sep}`) &&
    resolved.toLowerCase() !== archiveRoot.toLowerCase()
  ) {
    throw new Error('Native Supervisor child archive path escaped the archive root');
  }
  return {
    target: resolved,
    relative: path.relative(binding.worktree, resolved).replaceAll('\\', '/'),
    changesDir: paths.changesDir,
    nativeRoot: paths.nativeRoot,
  };
}

function archiveRefFor(binding: NativeSupervisorChildArchiveBinding): string {
  const date = binding.integrationChecksCompletedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Native Supervisor child archive lacks a valid archive date');
  }
  return `${date}-${binding.child}`;
}

function assertArchiveOnlyCommit(worktree: string, commit: string, archiveRelative: string): void {
  const files = runGitCommand(worktree, ['show', '--name-only', '--format=', commit])
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
  if (files.length === 0 || files.some((file) => !file.startsWith(`${archiveRelative}/`))) {
    throw new Error(
      `Native Supervisor child archive commit ${commit} touches paths outside ${archiveRelative}`,
    );
  }
}

async function assertChildArchivePredecessor(
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  binding: NativeSupervisorChildArchiveBinding,
  location: { relative: string },
): Promise<void> {
  const index = run.actions.findIndex((candidate) => candidate.id === action.id);
  const previous =
    index < 0
      ? undefined
      : run.actions
          .slice(0, index)
          .reverse()
          .find((candidate) => {
            return (
              candidate.stepId === 'supervisor.child.archive' &&
              candidate.status === 'succeeded' &&
              (candidate.input as { activation?: { child?: unknown } } | null)?.activation
                ?.child === binding.child
            );
          });
  const receipt = previous?.outcome?.output as Record<string, unknown> | undefined;
  if (
    !previous ||
    previous.claim?.executorId !== nativeSdkSupervisorChildArchiveExecutor.id ||
    receipt?.child !== binding.child ||
    receipt.archiveRef !== archiveRefFor(binding) ||
    receipt.candidateCommit !== activation(previous.input).candidateCommit ||
    receipt?.baseCommit !== activation(previous.input).integrationCommit ||
    typeof receipt.archiveCommit !== 'string' ||
    !COMMIT_PATTERN.test(receipt.archiveCommit)
  )
    throw new Error('Native Supervisor child archive lacks its accepted predecessor receipt');
  assertArchiveOnlyCommit(binding.worktree, receipt.archiveCommit, location.relative);

  for (const [worktree, commit] of [
    [binding.worktree, binding.candidateCommit],
    [binding.integrationWorktree, binding.integrationCommit],
  ]) {
    runGitCommand(worktree, ['merge-base', '--is-ancestor', receipt.archiveCommit, commit]);
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export const nativeSdkSupervisorChildArchiveExecutor: RuntimeExecutor = {
  id: 'native-supervisor-child-archive',
  capabilities: [],
  supports(action) {
    return action.stepId === 'supervisor.child.archive' && action.type === 'call_tool';
  },
  async execute(action, context, run) {
    if (!context?.projectRoot || !run || !this.supports(action)) {
      throw new Error('Native Supervisor child archive requires a bound Run and project');
    }
    const binding = await childArchiveBinding(run, action, context.projectRoot);
    if (resolveGitRef(binding.worktree, binding.branch) !== binding.candidateCommit) {
      throw new Error('Native Supervisor child worktree moved before the child archive');
    }
    if (
      resolveGitRef(binding.integrationWorktree, binding.integrationBranch) !==
      binding.integrationCommit
    ) {
      throw new Error('Native Supervisor integration head moved before the child archive');
    }
    const archiveRef = archiveRefFor(binding);
    const location = await childArchiveLocation(binding, archiveRef);

    let recovered: NativePortableState | null = null;
    if (await pathExists(location.target)) {
      recovered = await readNativePortableState(
        path.join(location.target, 'comet-state.yaml'),
      ).catch(() => null);
      if (
        !recovered ||
        recovered.name !== binding.child ||
        !recovered.archived ||
        recovered.workspace.change_branch !== binding.branch
      ) {
        throw new Error('Native Supervisor child archive directory holds another change');
      }
    }

    let archiveCommit: string;
    if (
      recovered?.verification?.candidate_id === binding.candidateCommit &&
      recovered.verification.verifier_execution_ref === binding.verifierSessionId &&
      recovered.verification.completed_at === binding.integrationChecksCompletedAt
    ) {
      // 恢复同一份归档；新的候选或验证记录生成新的归档提交，保留已有 Git 历史。
      const recoveredCommit = resolveGitRef(binding.worktree, binding.branch);
      if (!recoveredCommit || !COMMIT_PATTERN.test(recoveredCommit)) {
        throw new Error('Native Supervisor child worktree has no archive commit');
      }
      assertArchiveOnlyCommit(binding.worktree, recoveredCommit, location.relative);
      archiveCommit = recoveredCommit;
    } else {
      if (await pathExists(path.join(location.changesDir, binding.child))) {
        throw new Error(
          `Native Supervisor child ${binding.child} still has an active change directory; archive it through the normal flow first`,
        );
      }
      const state = buildChildArchiveState(binding);
      const materials = await childArchiveMaterials(run, action, context.projectRoot, binding);
      if (recovered) await assertChildArchivePredecessor(run, action, binding, location);
      await fs.mkdir(location.target, { recursive: true });
      if (recovered) {
        const records = {
          ...materials,
          'comet-state.yaml': stringify(state),
          'verification.md': renderNativeVerificationReport(state),
        };
        for (const [ref, content] of Object.entries(records))
          await atomicWriteText(path.join(location.target, ref), content, {
            containedRoot: location.nativeRoot,
          });
      } else {
        await writeMissingNativeSupervisorArchiveMaterials(location.target, materials, false);
        await atomicWriteText(path.join(location.target, 'comet-state.yaml'), stringify(state), {
          containedRoot: location.nativeRoot,
        });
        await writeNativeVerificationReport({
          file: path.join(location.target, 'verification.md'),
          state,
        });
      }
      const alignment = await inspectNativeVerificationReportAlignment({
        file: path.join(location.target, 'verification.md'),
        stateVersion: state.state_version,
      });
      if (alignment !== 'aligned') {
        throw new Error('Native Supervisor child archive report is not aligned');
      }
      runGitCommand(binding.worktree, [
        'add',
        '--force',
        '--',
        `${location.relative}/comet-state.yaml`,
        `${location.relative}/verification.md`,
        `${location.relative}/brief.md`,
        `${location.relative}/spec.md`,
        `${location.relative}/archive-source.md`,
      ]);
      const staged = runGitCommand(binding.worktree, [
        'diff',
        '--cached',
        '--name-only',
        '--',
        location.relative,
      ])
        .split('\n')
        .filter(Boolean);
      if (staged.length === 0) {
        throw new Error('Native Supervisor child archive produced no committable content');
      }
      const stagedOutside = staged.filter((file) => !file.startsWith(`${location.relative}/`));
      if (stagedOutside.length > 0) {
        throw new Error(
          `Native Supervisor child archive staging left unrelated paths: ${stagedOutside.join(', ')}`,
        );
      }
      runGitCommand(binding.worktree, ['commit', '-m', `chore(native): archive ${binding.child}`]);
      const committed = resolveGitRef(binding.worktree, binding.branch);
      if (!committed || !COMMIT_PATTERN.test(committed)) {
        throw new Error('Native Supervisor child archive commit is missing');
      }
      assertArchiveOnlyCommit(binding.worktree, committed, location.relative);
      archiveCommit = committed;
    }

    const integrationHead = resolveGitRef(binding.integrationWorktree, binding.integrationBranch);
    if (!integrationHead || !COMMIT_PATTERN.test(integrationHead)) {
      throw new Error('Native Supervisor integration branch has no head');
    }
    let integrationCommit = integrationHead;
    try {
      runGitCommand(binding.integrationWorktree, [
        'merge-base',
        '--is-ancestor',
        archiveCommit,
        integrationHead,
      ]);
    } catch {
      runGitCommand(binding.integrationWorktree, ['merge', '--no-ff', '--no-edit', binding.branch]);
      const merged = resolveGitRef(binding.integrationWorktree, binding.integrationBranch);
      if (!merged || !COMMIT_PATTERN.test(merged)) {
        throw new Error('Native Supervisor child archive merge produced no head');
      }
      integrationCommit = merged;
      const parents = runGitCommand(binding.integrationWorktree, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        integrationCommit,
      ]).split(' ');
      if (parents.length !== 3 || parents[1] !== integrationHead || parents[2] !== archiveCommit) {
        throw new Error('Native Supervisor child archive merge is not the expected commit');
      }
    }
    if (resolveGitRef(binding.worktree, binding.branch) !== archiveCommit) {
      throw new Error('Native Supervisor child branch moved after the archive commit');
    }
    return {
      status: 'succeeded',
      output: {
        child: binding.child,
        archiveRef,
        candidateCommit: binding.candidateCommit,
        archiveCommit,
        baseCommit: binding.integrationCommit,
        integrationCommit,
        maxParallelChildren: binding.maxParallelChildren,
      } as unknown as RuntimeValue,
    };
  },
};

export const nativeSdkSupervisorChildArchiveValidator: RuntimeValidator = {
  id: 'native-supervisor-child-archive-outcome',
  version: '1',
  async validate({ run, action, outcome, context }) {
    if (
      !context?.projectRoot ||
      action.claim?.executorId !== nativeSdkSupervisorChildArchiveExecutor.id ||
      outcome.status !== 'succeeded'
    ) {
      return {
        accepted: false,
        reason: 'Native Supervisor child archive was not executed by Runtime',
      };
    }
    try {
      const binding = await childArchiveBinding(run, action, context.projectRoot);
      const output = outcome.output as Record<string, unknown> | null;
      const expectedRef = archiveRefFor(binding);
      if (
        !output ||
        output.child !== binding.child ||
        output.archiveRef !== expectedRef ||
        output.candidateCommit !== binding.candidateCommit ||
        output.baseCommit !== binding.integrationCommit ||
        typeof output.archiveCommit !== 'string' ||
        typeof output.integrationCommit !== 'string'
      ) {
        throw new Error('Native Supervisor child archive outcome does not match its binding');
      }
      const location = await childArchiveLocation(binding, expectedRef);
      const state = await readNativePortableState(path.join(location.target, 'comet-state.yaml'));
      if (
        state.name !== binding.child ||
        !state.archived ||
        state.status !== 'done' ||
        state.verification?.verdict !== 'pass' ||
        state.workspace.change_branch !== binding.branch
      ) {
        throw new Error('Native Supervisor child archive state does not match the child');
      }
      assertArchiveOnlyCommit(binding.worktree, output.archiveCommit, location.relative);
      if (resolveGitRef(binding.worktree, binding.branch) !== output.archiveCommit) {
        throw new Error('Native Supervisor child branch is not at its archive commit');
      }
      const parents = runGitCommand(binding.integrationWorktree, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        output.integrationCommit,
      ]).split(' ');
      if (!parents.includes(output.archiveCommit) || !parents.includes(binding.integrationCommit)) {
        throw new Error('Native Supervisor integration did not receive the child archive commit');
      }
      if (
        resolveGitRef(binding.integrationWorktree, binding.integrationBranch) !==
        output.integrationCommit
      ) {
        throw new Error('Native Supervisor integration head moved after the child archive');
      }
      return { accepted: true };
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
    }
  },
};
