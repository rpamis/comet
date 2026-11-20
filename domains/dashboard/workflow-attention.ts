import type { DashboardWorkspaceIdentity } from './workspace.js';

export type WorkflowAttentionStatus =
  | 'awaiting-user'
  | 'ready'
  | 'unknown-outcome'
  | 'verification-blocker'
  | 'recovery-required'
  | 'waiting';

export type WorkflowAttentionReason =
  | 'decision'
  | 'execution'
  | 'unknown'
  | 'verification'
  | 'failed-run'
  | 'dependency'
  | 'dispatch-slot'
  | 'integration';

export interface WorkflowAttentionState {
  status: WorkflowAttentionStatus;
  reason: WorkflowAttentionReason;
  related?: readonly string[];
}

export interface WorkflowAttentionItem extends WorkflowAttentionState {
  workflow: 'classic' | 'native';
  name: string;
  locator: string;
  workspace: DashboardWorkspaceIdentity;
  runId: string | null;
  supervisorParent?: string;
  hasEvidence?: boolean;
}

export interface DashboardWorkflowAttention {
  items: WorkflowAttentionItem[];
  unavailable: Array<WorkflowAttentionItem['workflow']>;
}

export function workflowAttentionFromRun(
  runStatus: string,
  actions: readonly { status: string }[],
  waits: readonly { status: string }[],
  verificationBlocked: boolean,
  evidenceWaits: readonly { status: string }[] = [],
): WorkflowAttentionState | null {
  if (actions.some(({ status }) => status === 'unknown'))
    return { status: 'unknown-outcome', reason: 'unknown' };
  if (runStatus === 'failed') return { status: 'recovery-required', reason: 'failed-run' };
  if (verificationBlocked) return { status: 'verification-blocker', reason: 'verification' };
  if (waits.some(({ status }) => status === 'pending'))
    return { status: 'awaiting-user', reason: 'decision' };
  if ([...actions, ...evidenceWaits].some(({ status }) => status === 'pending'))
    return { status: 'ready', reason: 'execution' };
  return null;
}
