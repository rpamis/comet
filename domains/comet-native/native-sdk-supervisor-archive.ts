import { promises as fs } from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import { inspectGitWorktree, resolveGitRef } from '../../platform/paths/git-worktree.js';
import { runGitCommand } from '../../platform/process/git.js';
import type {
  RuntimeAction,
  RuntimeExecutor,
  RuntimeValidator,
  RuntimeValue,
  WorkflowRun,
} from '../engine/runtime.js';
import { atomicWriteText } from './native-atomic-file.js';
import { readProjectConfig } from './native-config.js';
import { nativeProjectPaths } from './native-paths.js';
import {
  createNativePortableState,
  parseNativePortableState,
  readNativePortableState,
} from './native-portable-state.js';
import type { NativePortableState } from './native-portable-types.js';
import { toNativePortableText } from './native-portable-text.js';
import {
  inspectNativeVerificationReportAlignment,
  writeNativeVerificationReport,
} from './native-verification-report-v2.js';
import { supervisorAcceptanceScope } from './native-supervisor-model.js';
import { currentNativeSdkSupervisorPlan } from './native-sdk-supervisor-prepare.js';
import { nativeSupervisorChildWorktree } from './native-supervisor-workspace.js';
import { nativeWorkspaceIsClean } from './native-workspace-config.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const ACCEPTANCE_ID_PATTERN = /^A[1-9][0-9]*$/u;

export interface NativeSupervisorChildArchiveActivation {
  child: string;
  candidateCommit: string;
  integrationCommit: string;
  checksActionId: string;
  contractHash: string;
}

interface NativeSupervisorChildArchiveBinding {
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
    typeof record.checksActionId !== 'string' ||
    typeof record.contractHash !== 'string'
  ) {
    throw new Error('Native Supervisor child archive lacks its activation');
  }
  return record as unknown as NativeSupervisorChildArchiveActivation;
}

function succeededChildAction(
  run: Readonly<WorkflowRun>,
  stepId: string,
  child: string,
  predicate: (output: Record<string, unknown>) => boolean,
): { action: RuntimeAction; output: Record<string, unknown> } | null {
  for (const action of [...run.actions].reverse()) {
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
): Promise<NativeSupervisorChildArchiveBinding> {
  const plan = await currentNativeSdkSupervisorPlan(run, projectRoot);
  const state = plan.state;
  const input = activation(action.input);
  if (
    state.phase !== 'build' ||
    state.status !== 'active' ||
    !state.children_contract_hash ||
    input.contractHash !== state.children_contract_hash ||
    !plan.contract.children.some(({ name }) => name === input.child) ||
    !COMMIT_PATTERN.test(input.candidateCommit) ||
    !COMMIT_PATTERN.test(input.integrationCommit)
  ) {
    throw new Error('Native Supervisor child archive does not match the confirmed plan');
  }
  const integrationChecks = run.actions.find((candidate) => candidate.id === input.checksActionId);
  const integrationChecksOutput = integrationChecks?.outcome?.output as
    { candidateId?: unknown; completedAt?: unknown } | null | undefined;
  if (
    integrationChecks?.stepId !== 'supervisor.child.integration-checks' ||
    integrationChecks.status !== 'succeeded' ||
    (integrationChecks.input as { activation?: { child?: unknown } } | null)?.activation?.child !==
      input.child ||
    integrationChecksOutput?.candidateId !== input.integrationCommit ||
    typeof integrationChecksOutput?.completedAt !== 'string'
  ) {
    throw new Error('Native Supervisor child archive lacks its passed integration checks');
  }
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
    throw new Error('Native Supervisor child archive lacks its passing independent Verifier');
  }
  const verifierEvidence = verifier.output.evidence as {
    summary: string;
    risks?: unknown;
    acceptance?: Array<{ id?: unknown; result?: unknown; reason?: unknown }>;
  };
  const builder = succeededChildAction(
    run,
    'supervisor.child.builder',
    input.child,
    (output) => output.candidateCommit === input.candidateCommit,
  );
  const childChecks = succeededChildAction(
    run,
    'supervisor.child.checks',
    input.child,
    (output) => output.candidateId === input.candidateCommit,
  );
  if (!childChecks) {
    throw new Error('Native Supervisor child archive lacks its completed Child checks');
  }
  const childChecksOutput = childChecks.output as {
    checks?: Array<Record<string, unknown>>;
    completedAt?: unknown;
  };
  if (
    !Array.isArray(childChecksOutput.checks) ||
    childChecksOutput.checks.length === 0 ||
    typeof childChecksOutput.completedAt !== 'string'
  ) {
    throw new Error('Native Supervisor child archive has invalid Child check evidence');
  }
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
  if (!nativeWorkspaceIsClean(worktree) || !nativeWorkspaceIsClean(prepared.integrationWorktree)) {
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
  const childCheckRows = childChecksOutput.checks.map((check) => {
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
    childChecksCompletedAt: childChecksOutput.completedAt,
    integrationChecksCompletedAt: integrationChecksOutput.completedAt,
    scopedAcceptance,
  };
}

function buildChildArchiveState(binding: NativeSupervisorChildArchiveBinding): NativePortableState {
  const acceptance = binding.scopedAcceptance
    .filter(({ id }) => ACCEPTANCE_ID_PATTERN.test(id))
    .map(({ id, source, text }) => ({
      id,
      source,
      text,
      result: 'passed' as const,
      reason: binding.verifierAcceptance.get(id) ?? null,
    }));
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
      assurance: 'skill-coordinated',
      verdict: 'pass',
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

    let archiveCommit: string;
    if (await pathExists(location.target)) {
      // Recovery: the archive was materialized before. Verify it instead of rewriting.
      const recovered = await readNativePortableState(
        path.join(location.target, 'comet-state.yaml'),
      ).catch(() => null);
      if (!recovered || recovered.name !== binding.child || !recovered.archived) {
        throw new Error('Native Supervisor child archive directory holds another change');
      }
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
      await fs.mkdir(location.target, { recursive: true });
      await atomicWriteText(path.join(location.target, 'comet-state.yaml'), stringify(state), {
        containedRoot: location.nativeRoot,
      });
      await writeNativeVerificationReport({
        file: path.join(location.target, 'verification.md'),
        state,
      });
      const alignment = await inspectNativeVerificationReportAlignment({
        file: path.join(location.target, 'verification.md'),
        stateVersion: state.state_version,
      });
      if (alignment !== 'aligned') {
        throw new Error('Native Supervisor child archive report is not aligned');
      }
      runGitCommand(binding.worktree, ['add', '--', location.relative]);
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
