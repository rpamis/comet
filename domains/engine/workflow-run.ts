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

export interface WorkflowRun extends RuntimeRecord {
  protocolVersion: 1;
  schemaVersion: 1;
  workflow: WorkflowRef & { hash: string };
  definitionHashes: Record<string, string>;
  input: RuntimeValue;
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  sequence: number;
  actions: RuntimeAction[];
  actionContexts: Record<string, { sequence: number; results: Record<string, WorkflowResult> }>;
  waits: RuntimeWait[];
  ready: WorkflowToken[];
  joins: Record<string, Record<string, WorkflowToken[]>>;
  outputs: Record<string, WorkflowResult>;
  children: { actionId: string; runId: string; workflow: WorkflowRef }[];
  lineage: string[];
  reason?: string;
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
    action: Readonly<RuntimeAction>;
    outcome: Readonly<RuntimeOutcome>;
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
  ): Promise<
    Pick<RuntimeOutcome, 'status' | 'output' | 'artifacts' | 'summary'> & { event?: string }
  >;
}
