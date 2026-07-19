import type { CometWorkflow } from './types.js';

export type CometHookIntent = 'write' | 'non-write' | 'unknown';

export interface CometHookRequest {
  intent: CometHookIntent;
  targets: string[];
  toolName: string | null;
}

export interface CometHookDecision {
  allowed: boolean;
  reason: string;
  workflow?: CometWorkflow;
  change?: string;
  phase?: string;
}

export interface CometHookProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}
