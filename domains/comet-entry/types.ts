import type { RecordedCommandCheck } from '../comet-classic/classic-command-checks.js';
import type { NativePortableStatusProjection } from '../comet-native/native-portable-status.js';
import type { NativeStatusProjection } from '../comet-native/native-types.js';

export type CometWorkflow = 'native' | 'classic';

export type InitWorkflowSelection = CometWorkflow | 'both';

export type CometEntrySkill = 'comet-native' | 'comet-classic';

export type CometEntryResolutionSource =
  | 'project-config'
  | 'global-config'
  | 'built-in-default'
  | 'legacy-project'
  | 'legacy-fallback';

export interface CometEntryResolution {
  workflow: CometWorkflow;
  skill: CometEntrySkill;
  source: CometEntryResolutionSource;
}

export interface ChangeStatus {
  name: string;
  cometManaged: boolean;
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
  error?: string;
}

export interface NativeChangeStatusError {
  name: string;
  error: string;
}

export interface CometProjectStatus {
  schema: 'comet.status.v2';
  defaultEntry: CometEntryResolution | { error: string };
  workflows: {
    native: {
      changes: Array<
        NativeStatusProjection | NativePortableStatusProjection | NativeChangeStatusError
      >;
      error?: string;
    };
    classic: { changes: ChangeStatus[]; error?: string };
  };
  unmanagedOpenSpec: ChangeStatus[];
}
