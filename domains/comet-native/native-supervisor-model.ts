import { canonicalHash } from './native-canonical-hash.js';
import type { NativeChildrenContract } from './native-children-contract.js';
import type { NativeChildStatusProjection, NativeChildrenInspection } from './native-children.js';
import {
  validateNativeVerifierFinalResultConsistency,
  type NativeVerifierAcceptanceResult,
} from './native-verifier-protocol.js';

const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export function assertCommit(value: string, label: string): void {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${label} must be a Git commit`);
}

export const NATIVE_SUPERVISOR_SCHEMA = 'comet.native.supervisor.v2' as const;

export type NativeSupervisorChildStatus =
  | 'pending'
  | 'ready'
  | 'active'
  | 'verified'
  | 'integrated'
  | 'archived'
  | 'blocked'
  | 'needs-reverify';

export interface NativeSupervisorVerificationEvidence {
  summary: string;
  checks: string[];
  acceptance?: NativeVerifierAcceptanceResult[];
  receiptRef?: string;
  execution?: NativeSupervisorTask;
}

export interface NativeSupervisorIntegrationCheck {
  name: string;
  status: 'passed' | 'failed' | 'incomplete';
  reason?: string | null;
  receiptRef?: string;
}

export interface NativeSupervisorCheckExecutionState {
  id: string;
  name: string;
  status: 'planned' | 'running' | 'passed' | 'failed' | 'interrupted';
  repeatable: boolean;
  executionCount: number;
  argvDisplay: string[];
  cwdRef: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  startedAt: string | null;
  completedAt: string | null;
  logRef: string | null;
}

export interface NativeSupervisorTask {
  role: 'builder' | 'verifier';
  child: string;
  projectRoot: string;
  baseCommit: string;
  runId: string;
  acceptance?: Array<{ id: string; source: string; text: string }>;
  contractHash?: string;
  verificationBoundary?: 'child-scope-parent-reverifies-all';
  checksReason?: 'not-run' | 'running' | 'completed';
  checkExecution?: {
    operationId: string;
    key: string;
    status: 'running' | 'completed' | 'interrupted';
    ownerPid: number;
    ownerIdentity?: string;
    activeProcess?:
      | null
      | { status: 'starting'; checkId: string }
      | { status: 'running'; checkId: string; pid: number; identity?: string };
    startedAt: string;
    expiresAt?: string;
    receiptRef?: string;
    machineId?: string;
    inputFingerprint?: string;
    checkStates?: NativeSupervisorCheckExecutionState[];
  };
}

export interface NativeSupervisorEvent {
  kind:
    | 'task-dispatched'
    | 'task-reconnected'
    | 'task-cancelled'
    | 'task-blocked'
    | 'builder-result'
    | 'verifier-result'
    | 'child-integrated'
    | 'child-verified'
    | 'integration-head-reconciled'
    | 'target-refreshed'
    | 'delivery-reconciled';
  child: string | null;
  runId: string | null;
  summary: string;
  at: string;
}

export interface NativeSupervisorChildState {
  name: string;
  summary: string | null;
  dependsOn: string[];
  status: NativeSupervisorChildStatus;
  baseCommit: string | null;
  candidateCommit: string | null;
  verifiedCommit: string | null;
  integrationCommit: string | null;
  verification: NativeSupervisorVerificationEvidence | null;
  checks: NativeSupervisorIntegrationCheck[];
  blocker: string | null;
  /** Last known Child worktree; retained after a task completes for recovery/status. */
  projectRoot?: string | null;
  task: NativeSupervisorTask | null;
  acceptanceScope?: Array<{ id: string; source: string; text: string }>;
  contractHash?: string;
}

export interface NativeSupervisorState {
  schema: typeof NATIVE_SUPERVISOR_SCHEMA;
  stateVersion: number;
  parent: string;
  integration: {
    branch: string;
    worktree: string;
    targetBranch: string;
    targetCommit: string;
    headCommit: string;
    checkExecution?: NonNullable<NativeSupervisorTask['checkExecution']> & {
      child: string;
      candidateCommit: string;
      integrationCommit: string;
      checks?: NativeSupervisorIntegrationCheck[];
      error?: string;
    };
  };
  children: NativeSupervisorChildState[];
  history: NativeSupervisorEvent[];
  finalVerification: {
    status: 'pending' | 'passed' | 'failed' | 'incomplete';
    summary: string | null;
    layers?: {
      childVerification: 'complete' | 'incomplete';
      parentIntegration: 'complete' | 'incomplete';
      parentChecks: string[];
      notRerun: string[];
      incomplete: string[];
    };
  };
}

export function cloneState(state: NativeSupervisorState): NativeSupervisorState {
  return structuredClone(state);
}

export function recordEvent(
  state: NativeSupervisorState,
  event: Omit<NativeSupervisorEvent, 'at'>,
): void {
  state.history.push({ ...event, at: new Date().toISOString() });
  if (state.history.length > 256) state.history.splice(0, state.history.length - 256);
}

export function assertChildDependenciesIntegrated(
  state: NativeSupervisorState,
  child: NativeSupervisorChildState,
): void {
  for (const dependency of child.dependsOn) {
    const record = state.children.find(({ name }) => name === dependency);
    if (!record || record.status !== 'integrated') {
      throw new Error(
        `Native Supervisor child ${child.name} dependency ${dependency} is not integrated`,
      );
    }
  }
}

export function stableSupervisorIntegrationOrder(
  state: NativeSupervisorState,
): NativeSupervisorChildState[] {
  const remaining = new Set(state.children.map(({ name }) => name));
  const ordered: NativeSupervisorChildState[] = [];
  while (remaining.size > 0) {
    const candidate = state.children.find(
      (child) =>
        remaining.has(child.name) &&
        child.dependsOn.every((dependency) => !remaining.has(dependency)),
    );
    if (!candidate) {
      throw new Error('Native Supervisor Child dependencies contain a cycle');
    }
    ordered.push(candidate);
    remaining.delete(candidate.name);
  }
  return ordered;
}

export function createNativeSupervisorState(options: {
  parent: string;
  targetBranch: string;
  targetCommit: string;
  integrationBranch: string;
  integrationWorktree: string;
  contract: NativeChildrenContract;
}): NativeSupervisorState {
  assertCommit(options.targetCommit, 'Native Supervisor target commit');
  const names = new Set(options.contract.children.map(({ name }) => name));
  const children = options.contract.children.map((child) => ({
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.depends_on],
    status: child.depends_on.length === 0 ? ('ready' as const) : ('pending' as const),
    baseCommit: null,
    candidateCommit: null,
    verifiedCommit: null,
    integrationCommit: null,
    verification: null,
    checks: [],
    blocker: null,
    projectRoot: null,
    task: null,
    acceptanceScope: supervisorAcceptanceScope(options.contract, child.name),
    contractHash: canonicalHash('comet.native.supervisor-contract.v1', options.contract),
  }));
  for (const child of children) {
    for (const dependency of child.dependsOn) {
      if (!names.has(dependency)) {
        throw new Error(
          `Native Supervisor child ${child.name} depends on unknown child ${dependency}`,
        );
      }
    }
  }
  return {
    schema: NATIVE_SUPERVISOR_SCHEMA,
    stateVersion: 1,
    parent: options.parent,
    integration: {
      branch: options.integrationBranch,
      worktree: options.integrationWorktree,
      targetBranch: options.targetBranch,
      targetCommit: options.targetCommit,
      headCommit: options.targetCommit,
    },
    children,
    history: [],
    finalVerification: { status: 'pending', summary: null },
  };
}

export function supervisorAcceptanceScope(contract: NativeChildrenContract, name: string) {
  const child = contract.children.find((entry) => entry.name === name)!;
  return child.covers.length > 0
    ? child.covers.map((id) => ({
        id,
        source: contract.acceptance_index?.[id]?.source ?? 'brief.md',
        text: contract.acceptance_index?.[id]?.text ?? id,
      }))
    : [{ id: `child:${name}`, source: 'children.yaml', text: child.summary ?? name }];
}

export function reconcileNativeSupervisorState(options: {
  state: NativeSupervisorState;
  contract: NativeChildrenContract;
}): NativeSupervisorState {
  const next = cloneState(options.state);
  const declared = new Map(options.contract.children.map((child) => [child.name, child]));
  const existing = new Map(next.children.map((child) => [child.name, child]));
  for (const child of next.children) {
    const definition = declared.get(child.name);
    if (!definition) {
      if (child.status !== 'archived') {
        throw new Error(`Native Supervisor child ${child.name} cannot be removed before Archive`);
      }
      continue;
    }
    if (child.status === 'integrated' || child.status === 'archived') {
      if (
        definition.summary !== child.summary ||
        definition.depends_on.join('\0') !== child.dependsOn.join('\0')
      ) {
        throw new Error(`Native Supervisor integrated child ${child.name} history is immutable`);
      }
    }
    child.summary = definition.summary;
    child.dependsOn = [...definition.depends_on];
    const nextScope = supervisorAcceptanceScope(options.contract, child.name);
    const nextContractHash = canonicalHash('comet.native.supervisor-contract.v1', options.contract);
    if (
      child.contractHash &&
      child.contractHash !== nextContractHash &&
      child.status !== 'integrated' &&
      child.status !== 'archived'
    ) {
      child.task = null;
      child.verifiedCommit = null;
      child.verification = null;
      child.checks = [];
      child.status = child.candidateCommit ? 'needs-reverify' : 'ready';
      child.blocker =
        'Confirmed Supervisor contract changed; verify the current acceptance scope again.';
    }
    child.acceptanceScope = nextScope;
    child.contractHash = nextContractHash;
  }
  for (const definition of options.contract.children) {
    if (existing.has(definition.name)) continue;
    next.children.push({
      name: definition.name,
      summary: definition.summary,
      dependsOn: [...definition.depends_on],
      status: definition.depends_on.every((dependency) =>
        next.children.some(({ name, status }) => name === dependency && status === 'integrated'),
      )
        ? 'ready'
        : 'pending',
      baseCommit: null,
      candidateCommit: null,
      verifiedCommit: null,
      integrationCommit: null,
      verification: null,
      checks: [],
      blocker: null,
      projectRoot: null,
      task: null,
      acceptanceScope: supervisorAcceptanceScope(options.contract, definition.name),
      contractHash: canonicalHash('comet.native.supervisor-contract.v1', options.contract),
    });
  }
  next.stateVersion += 1;
  return next;
}

export function markNativeSupervisorChildVerified(
  state: NativeSupervisorState,
  options: {
    name: string;
    baseCommit: string;
    verifiedCommit: string;
    evidence: NativeSupervisorVerificationEvidence;
  },
): NativeSupervisorState {
  assertCommit(options.baseCommit, 'Native Supervisor child base commit');
  assertCommit(options.verifiedCommit, 'Native Supervisor verified commit');
  if (options.evidence.summary.trim().length === 0) {
    throw new Error('Native Supervisor verification summary must not be empty');
  }
  if (options.evidence.checks.length === 0) {
    throw new Error('Native Supervisor verification requires at least one check');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.name);
  if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
  if (child.status !== 'ready' && child.status !== 'active') {
    throw new Error(`Native Supervisor child ${options.name} is not ready for verification`);
  }
  assertChildDependenciesIntegrated(next, child);
  if (options.baseCommit !== next.integration.headCommit) {
    throw new Error(`Native Supervisor child ${options.name} base commit is stale`);
  }
  validateNativeVerifierFinalResultConsistency(
    { verdict: 'pass', acceptance: options.evidence.acceptance ?? [] },
    {
      acceptanceIds: child.acceptanceScope?.map(({ id }) => id) ?? [`child:${child.name}`],
      requiredChecksPassed: options.evidence.checks.length > 0,
    },
  );
  child.status = 'verified';
  child.baseCommit = options.baseCommit;
  child.candidateCommit = options.verifiedCommit;
  child.verifiedCommit = options.verifiedCommit;
  child.verification = {
    ...structuredClone(options.evidence),
  };
  child.blocker = null;
  recordEvent(next, {
    kind: 'child-verified',
    child: child.name,
    runId: null,
    summary: options.evidence.summary,
  });
  next.stateVersion += 1;
  return next;
}

/** Build return instructions from current task facts, including the latest receipt. */
export function projectNativeSupervisorTask(
  task: NativeSupervisorTask,
  parent: string,
  controlProjectRoot: string,
) {
  const identity = { child: task.child, runId: task.runId };
  const retryCheckIds = (task.checkExecution?.checkStates ?? [])
    .filter(({ status }) => status === 'interrupted')
    .map(({ id }) => id);
  const templates =
    task.role === 'builder'
      ? [
          { kind: 'supervisor-builder-result', ...identity, candidateCommit: '<candidate-commit>' },
          { kind: 'supervisor-builder-failure', ...identity, reason: '<failure-reason>' },
        ]
      : [
          {
            kind: 'supervisor-checks',
            ...identity,
            checks: [
              {
                id: '<check-id>',
                name: '<check-name>',
                executable: '<executable>',
                argv: [],
                cwdRef: '.',
                timeoutMs: 120000,
                repeatable: true,
              },
            ],
            materials: [],
            ...(retryCheckIds.length > 0 ? { retry_check_ids: retryCheckIds } : {}),
          },
          {
            kind: 'supervisor-verifier-result',
            ...identity,
            verdict: 'blocked',
            evidence: {
              summary: '<verification-summary>',
              checks: [],
              acceptance: (task.acceptance ?? []).map(({ id }) => ({
                id,
                result: 'blocked',
                reason: '<evidence>',
              })),
              receiptRef: task.checkExecution?.receiptRef ?? null,
            },
          },
        ];
  return {
    ...task,
    controlProjectRoot,
    returnAction: {
      cwd: controlProjectRoot,
      commandArgs: [
        'comet',
        'native',
        'next',
        parent,
        '--runner-input',
        '<temporary-json-file>',
        '--json',
      ],
      inputOptions: templates.map((template) => ({
        name: template.kind,
        exclusiveGroup: 'runner-input',
        template,
      })),
    },
  };
}

export function createNativeSupervisorTask(
  state: NativeSupervisorState,
  options: Omit<NativeSupervisorTask, 'baseCommit'>,
): { state: NativeSupervisorState; task: NativeSupervisorTask } {
  if (!options.projectRoot.trim() || !options.runId.trim()) {
    throw new Error('Native Supervisor task projectRoot and runId are required');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (child.task)
    throw new Error(`Native Supervisor child ${options.child} already has an active task`);
  let baseCommit: string;
  if (options.role === 'builder') {
    if (child.status !== 'ready') {
      throw new Error(`Native Supervisor child ${options.child} is not ready for a Builder task`);
    }
    assertChildDependenciesIntegrated(next, child);
    baseCommit = next.integration.headCommit;
    child.status = 'active';
  } else {
    if (
      (child.status !== 'active' && child.status !== 'needs-reverify') ||
      !child.candidateCommit
    ) {
      throw new Error(`Native Supervisor child ${options.child} is not ready for a Verifier task`);
    }
    baseCommit = child.candidateCommit;
  }
  const task: NativeSupervisorTask = {
    ...options,
    baseCommit,
    acceptance: child.acceptanceScope ?? [
      { id: `child:${child.name}`, source: 'children.yaml', text: child.summary ?? child.name },
    ],
    contractHash: child.contractHash,
    verificationBoundary: 'child-scope-parent-reverifies-all',
    checksReason: 'not-run',
  };
  child.projectRoot = options.projectRoot;
  child.task = task;
  child.blocker = null;
  recordEvent(next, {
    kind: 'task-dispatched',
    child: child.name,
    runId: task.runId,
    summary: `${task.role} task dispatched`,
  });
  next.stateVersion += 1;
  return { state: next, task };
}

export function reconnectNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string },
): NativeSupervisorTask {
  const child = state.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  return structuredClone(child.task);
}

/** Reconnect a task and return the auditable state transition for persistence. */
export function reconnectNativeSupervisorTaskWithState(
  state: NativeSupervisorState,
  options: { child: string; runId: string },
): { state: NativeSupervisorState; task: NativeSupervisorTask } {
  const task = reconnectNativeSupervisorTask(state, options);
  const next = cloneState(state);
  recordEvent(next, {
    kind: 'task-reconnected',
    child: options.child,
    runId: options.runId,
    summary: 'existing task reconnected',
  });
  next.stateVersion += 1;
  return { state: next, task };
}

export function cancelNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string; reason: string },
): NativeSupervisorState {
  if (options.reason.trim().length === 0)
    throw new Error('Native Supervisor cancellation reason is required');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  if (child.task.role === 'builder') {
    child.status = 'ready';
    child.candidateCommit = null;
  } else {
    // A cancelled Verifier keeps the candidate and can be safely redispatched
    // without rebuilding it. `active` has no dispatch path and would strand
    // the Child after a normal cancellation.
    child.status = 'needs-reverify';
  }
  child.task = null;
  child.blocker = options.reason;
  recordEvent(next, {
    kind: 'task-cancelled',
    child: options.child,
    runId: options.runId,
    summary: options.reason,
  });
  next.stateVersion += 1;
  return next;
}

export function blockNativeSupervisorTask(
  state: NativeSupervisorState,
  options: { child: string; runId: string; reason: string },
): NativeSupervisorState {
  if (options.reason.trim().length === 0)
    throw new Error('Native Supervisor blocker reason is required');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child?.task || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor task runId is not current for ${options.child}`);
  }
  child.blocker = options.reason;
  recordEvent(next, {
    kind: 'task-blocked',
    child: options.child,
    runId: options.runId,
    summary: options.reason,
  });
  next.stateVersion += 1;
  return next;
}

export function applyNativeSupervisorBuilderResult(
  state: NativeSupervisorState,
  options: { child: string; runId: string; candidateCommit: string },
): NativeSupervisorState {
  assertCommit(options.candidateCommit, 'Native Supervisor candidate commit');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (!child.task || child.task.role !== 'builder' || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor Builder result runId is not current for ${options.child}`);
  }
  if (child.status !== 'active') {
    throw new Error(`Native Supervisor child ${options.child} is not active for Builder result`);
  }
  child.candidateCommit = options.candidateCommit;
  child.task = null;
  child.blocker = null;
  recordEvent(next, {
    kind: 'builder-result',
    child: child.name,
    runId: options.runId,
    summary: 'Builder candidate recorded',
  });
  next.stateVersion += 1;
  return next;
}

export function applyNativeSupervisorVerifierResult(
  state: NativeSupervisorState,
  options: {
    child: string;
    runId: string;
    verdict: 'pass' | 'fail' | 'blocked';
    evidence: NativeSupervisorVerificationEvidence;
  },
): NativeSupervisorState {
  if (options.evidence.summary.trim().length === 0) {
    throw new Error('Native Supervisor verification summary must not be empty');
  }
  if (options.verdict === 'pass' && options.evidence.checks.length === 0) {
    throw new Error('Native Supervisor verification pass requires at least one check');
  }
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.child);
  if (!child) throw new Error(`Native Supervisor child ${options.child} does not exist`);
  if (!child.task || child.task.role !== 'verifier' || child.task.runId !== options.runId) {
    throw new Error(`Native Supervisor Verifier result runId is not current for ${options.child}`);
  }
  if ((child.status !== 'active' && child.status !== 'needs-reverify') || !child.candidateCommit) {
    throw new Error(`Native Supervisor child ${options.child} is not ready for Verifier result`);
  }
  validateNativeVerifierFinalResultConsistency(
    { verdict: options.verdict, acceptance: options.evidence.acceptance ?? [] },
    {
      acceptanceIds: child.task.acceptance?.map(({ id }) => id) ??
        child.acceptanceScope?.map(({ id }) => id) ?? [`child:${child.name}`],
      requiredChecksPassed: options.evidence.checks.length > 0,
    },
  );
  child.verification = {
    ...structuredClone(options.evidence),
  };
  child.task = null;
  if (options.verdict === 'pass') {
    child.status = 'verified';
    child.verifiedCommit = child.candidateCommit;
    child.blocker = null;
  } else {
    child.status = 'needs-reverify';
    child.blocker = options.evidence.summary;
  }
  recordEvent(next, {
    kind: 'verifier-result',
    child: child.name,
    runId: options.runId,
    summary: options.evidence.summary,
  });
  next.stateVersion += 1;
  return next;
}

export function integrateNativeSupervisorChild(
  state: NativeSupervisorState,
  options: {
    name: string;
    integrationCommit: string;
    checks: NativeSupervisorIntegrationCheck[];
  },
): NativeSupervisorState {
  assertCommit(options.integrationCommit, 'Native Supervisor integration commit');
  const next = cloneState(state);
  const child = next.children.find(({ name }) => name === options.name);
  if (!child) throw new Error(`Native Supervisor child ${options.name} does not exist`);
  if (child.status !== 'verified' || !child.verifiedCommit) {
    throw new Error(`Native Supervisor child ${options.name} must be verified before integration`);
  }
  if (options.checks.length === 0 || options.checks.some(({ status }) => status !== 'passed')) {
    throw new Error(`Native Supervisor child ${options.name} integration checks are incomplete`);
  }
  child.status = 'integrated';
  child.integrationCommit = options.integrationCommit;
  child.checks = structuredClone(options.checks);
  child.blocker = null;
  next.integration.headCommit = options.integrationCommit;
  recordEvent(next, {
    kind: 'child-integrated',
    child: child.name,
    runId: null,
    summary: 'Child integrated into the Supervisor branch',
  });
  for (const candidate of next.children) {
    if (candidate.status !== 'pending') continue;
    if (
      candidate.dependsOn.every((dependency) =>
        next.children.some(({ name, status }) => name === dependency && status === 'integrated'),
      )
    ) {
      candidate.status = 'ready';
    }
  }
  next.stateVersion += 1;
  return next;
}

export function projectNativeSupervisorChildren(
  state: NativeSupervisorState,
): NativeChildrenInspection {
  const confirmed = state.children.every(
    (child) =>
      child.acceptanceScope &&
      child.acceptanceScope.length > 0 &&
      (!child.task || (child.task.acceptance && child.task.acceptance.length > 0)),
  );
  const children: NativeChildStatusProjection[] = state.children.map((child) => ({
    name: child.name,
    summary: child.summary,
    dependsOn: [...child.dependsOn],
    covers: child.acceptanceScope?.map(({ id }) => id) ?? [],
    status:
      child.status === 'ready' &&
      child.blocker &&
      [...state.history].reverse().find((event) => event.child === child.name)?.kind ===
        'task-blocked'
        ? 'blocked'
        : child.status,
    phase: null,
    projectRoot: child.projectRoot ?? child.task?.projectRoot ?? null,
    message: confirmed
      ? child.blocker
      : 'Supervisor acceptance scope is unavailable; restore children.yaml and confirm Shape before continuing',
  }));
  return {
    contractHash: null,
    confirmed,
    parentBranch: state.integration.branch,
    children,
    readyChildren: confirmed
      ? children.filter(({ status }) => status === 'ready').map(({ name }) => name)
      : [],
    allDone:
      confirmed && children.every(({ status }) => status === 'integrated' || status === 'archived'),
  };
}
