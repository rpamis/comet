import type { OrchestrationMode, StepAction } from '../skill/types.js';

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface RunState {
  runId: string;
  skill: string;
  skillVersion: string;
  skillHash: string;
  orchestration: OrchestrationMode;
  currentStep: string | null;
  iteration: number;
  pending: string | null;
  pendingRef: string;
  trajectoryRef: string;
  contextRef: string;
  artifactsRef: string;
  checkpointRef: string;
  status: RunStatus;
  retries: Record<string, number>;
}

export interface EngineAction extends StepAction {
  id: string;
  stepId: string | null;
}

export interface ActionOutcome {
  actionId: string;
  status: 'succeeded' | 'failed';
  summary: string;
  artifacts?: Record<string, string>;
  state?: Record<string, string>;
}

export interface TrajectoryEvent {
  sequence: number;
  timestamp: string;
  type:
    | 'run_started'
    | 'action_proposed'
    | 'action_completed'
    | 'eval_completed'
    | 'checkpoint'
    | 'state_migrated'
    | 'state_transitioned'
    | 'command_check_recorded'
    | 'recovery_reconciled';
  runId: string;
  data: Record<string, unknown>;
}

export interface EvalResult {
  evalId: string;
  passed: boolean;
  evidence: string;
}

export interface Checkpoint {
  runId: string;
  stateVersion: number;
  trajectoryOffset: number;
  contextHash: string | null;
  artifactsHash: string;
  createdAt: string;
}
