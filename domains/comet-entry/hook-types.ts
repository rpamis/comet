import type { CometWorkflow } from './types.js';

export type CometHookIntent = 'context' | 'write' | 'non-write' | 'unknown';

export interface CometHookRequest {
  intent: CometHookIntent;
  targets: string[];
  toolName: string | null;
  task?: string;
  cwd?: string;
  sessionId?: string;
}

export interface CometHookDecision {
  allowed: boolean;
  reason: string;
  workflow?: CometWorkflow;
  change?: string;
  phase?: string;
  context?: string;
}

export interface CometHookProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}
