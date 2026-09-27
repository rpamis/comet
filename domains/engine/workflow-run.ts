import type { RuntimeAction, RuntimeOutcome } from './runtime-action.js';
import type { RuntimeValue } from './runtime-json.js';
import type { RuntimeRecord } from './runtime-store.js';

export interface WorkflowRef {
  id: string;
  version: string;
}

export interface WorkflowResult {
  sequence: number;
  value: RuntimeValue;
}

export interface WorkflowToken {
  from: string | null;
  to: string;
  results: Record<string, WorkflowResult>;
  activation?: RuntimeValue;
}

/** 同一个已声明步骤可以按不同输入激活多次。 */
export interface WorkflowStepActivation {
  stepId: string;
  input: RuntimeValue;
}

export interface RuntimeWait {
  id: string;
  stepId: string;
  sequence: number;
  status: 'pending' | 'resolved' | 'cancelled';
  proposal: RuntimeValue;
  proposalHash: string;
  choices: string[];
  results: Record<string, WorkflowResult>;
  decision?: { id: string; choice: string; proposalHash: string };
}

export interface RuntimeEvidenceWait {
  id: string;
  stepId: string;
  sequence: number;
  kind: string;
  status: 'pending' | 'resolved' | 'invalidated' | 'cancelled';
  results: Record<string, WorkflowResult>;
  receipt?: { ref: string; contentHash: string; submissionId: string };
  invalidation?: { ref: string; contentHash: string; submissionId: string; reason: string };
}

export interface WorkflowRun extends RuntimeRecord {
  protocolVersion: 1;
  schemaVersion: 1;
  workflow: WorkflowRef & { hash: string };
  definitionHashes: Record<string, string>;
  initialStateHash?: string;
  input: RuntimeValue;
  state?: RuntimeValue;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  sequence: number;
  actions: RuntimeAction[];
  commands?: { id: string; name: string; inputHash: string; actionId: string }[];
  actionContexts: Record<string, { sequence: number; results: Record<string, WorkflowResult> }>;
  waits: RuntimeWait[];
  evidenceWaits?: RuntimeEvidenceWait[];
  ready: WorkflowToken[];
  joins: Record<string, Record<string, WorkflowToken[]>>;
  outputs: Record<string, WorkflowResult>;
  children: { actionId: string; runId: string; workflow: WorkflowRef }[];
  lineage: string[];
  reason?: string;
}

export type WorkflowTransitionEvent =
  | {
      kind: 'action-outcome';
      stepId: string;
      outcome: Readonly<RuntimeOutcome>;
    }
  | {
      kind: 'wait-resolved';
      stepId: string;
      choice: string;
      proposalHash: string;
      decisionId: string;
    }
  | {
      kind: 'evidence-recorded';
      stepId: string;
      evidenceKind: string;
      ref: string;
      contentHash: string;
      submissionId: string;
    }
  | {
      kind: 'evidence-invalidated';
      stepId: string;
      evidenceKind: string;
      ref: string;
      contentHash: string;
      submissionId: string;
      reason: string;
    };

export interface WorkflowTransitionHandler {
  id: string;
  version: string;
  apply(input: { run: Readonly<WorkflowRun>; event: Readonly<WorkflowTransitionEvent> }): {
    state: RuntimeValue;
    next: Array<string | WorkflowStepActivation>;
  };
}

/** 每次请求显式携带的宿主上下文，不通过 process.chdir 或修改 process.env 传递。 */
export interface RuntimeInvocationContext {
  requestId: string;
  projectRoot?: string;
  invocationCwd?: string;
  environment?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface RuntimeValidation {
  accepted: boolean;
  reason?: string;
}

export interface RuntimeValidator {
  id: string;
  version: string;
  validate(input: {
    run: Readonly<WorkflowRun>;
    action: Readonly<RuntimeAction>;
    outcome: Readonly<RuntimeOutcome>;
    context?: RuntimeInvocationContext;
  }): RuntimeValidation | Promise<RuntimeValidation>;
}

export interface RuntimeStateValidator {
  id: string;
  version: string;
  validate(input: { state: RuntimeValue }): RuntimeValidation;
}

export interface RuntimeEvidenceValidator {
  id: string;
  version: string;
  validate(input: {
    run: Readonly<WorkflowRun>;
    kind: string;
    ref: string;
    contentHash: string;
    context?: RuntimeInvocationContext;
  }):
    | { accepted: boolean; actualHash: string; reason?: string }
    | Promise<{ accepted: boolean; actualHash: string; reason?: string }>;
}

export interface RuntimeCommandValidator {
  id: string;
  version: string;
  validate(input: {
    run: Readonly<WorkflowRun>;
    name: string;
    input: RuntimeValue;
    context?: RuntimeInvocationContext;
  }): RuntimeValidation | Promise<RuntimeValidation>;
}

export interface RuntimeExecutor {
  id: string;
  capabilities: readonly string[];
  supports(action: Readonly<RuntimeAction>): boolean;
  execute(
    action: Readonly<RuntimeAction>,
    context?: RuntimeInvocationContext,
    run?: Readonly<WorkflowRun>,
  ): Promise<
    Pick<RuntimeOutcome, 'status' | 'output' | 'artifacts' | 'summary'> & { event?: string }
  >;
}
