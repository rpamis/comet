import type { RecordedCommandCheck } from '../comet-classic/classic-command-checks.js';
import type { classicSdkNextAction } from '../comet-classic/classic-sdk-status.js';
import type { NativeSdkStatusProjection } from '../comet-native/native-sdk-status.js';
import type { SelectedWorkflowApplicationStatus } from '../workflow-application/index.js';
import type { NativePortableStatusProjection } from '../comet-native/native-portable-status.js';
import type { NativeStatusProjection } from '../comet-native/native-types.js';
import type { CometProjectWorkflow } from '../workflow-contract/types.js';

export type CometWorkflow = CometProjectWorkflow;

export type InitWorkflowSelection = CometWorkflow | 'both';

export type CometEntrySkill = 'comet-native' | 'comet-classic';

export type CometEntryResolutionSource =
  'project-config' | 'global-config' | 'built-in-default' | 'legacy-project' | 'legacy-fallback';

export interface CometEntryResolution {
  workflow: CometWorkflow;
  skill: CometEntrySkill;
  source: CometEntryResolutionSource;
}

export interface ChangeStatus {
  name: string;
  cometManaged: boolean;
  archived?: boolean;
  archiveReady: boolean;
  recommendedArchiveCommand: string;
  workflow: string | null;
  phase: string | null;
  buildMode: string | null;
  isolation: string | null;
  boundBranch: string | null;
  verifyMode: string | null;
  verifyResult: string | null;
  designDoc: string | null;
  plan: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  nextCommand: string | null;
  currentStep: string | null;
  runtimeMode: string | null;
  runtimeEval: {
    stepId: string;
    passed: boolean;
    requiredEvidence: string[];
    missingEvidence: string[];
  } | null;
  commandChecks: {
    build: RecordedCommandCheck | null;
    verify: RecordedCommandCheck | null;
  } | null;
  run?: { id: string; revision: number; status: string };
  nextAction?: ReturnType<typeof classicSdkNextAction>;
  inspection?: { commandArgs: string[]; request: { operation: 'inspect'; runId: string } };
  error?: string;
}

export interface NativeChangeStatusError {
  name: string;
  error: string;
  inspection?: { commandArgs: string[] };
}

export interface CometProjectStatus {
  schema: 'comet.status.v2';
  discovery: { projectRoot: string; scope: 'current-worktree'; applications: 'current-selection' };
  applications: { changes: SelectedWorkflowApplicationStatus[]; error?: string };
  defaultEntry: CometEntryResolution | { error: string };
  workflows: {
    native: {
      changes: Array<
        | NativeStatusProjection
        | NativePortableStatusProjection
        | NativeSdkStatusProjection
        | NativeChangeStatusError
      >;
      error?: string;
    };
    classic: { changes: ChangeStatus[]; error?: string };
  };
  unmanagedOpenSpec: ChangeStatus[];
}
