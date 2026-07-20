import type { RecordedCommandCheck } from '../comet-classic/classic-command-checks.js';
import type { NativeStatusProjection } from '../comet-native/native-types.js';

export type CometWorkflow = 'native' | 'classic';

export type InitWorkflowSelection = CometWorkflow | 'both';

export type CometEntrySkill = 'comet-native' | 'comet-classic';

export type CometEntryResolutionSource = 'project-config' | 'legacy-fallback';

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

export interface CometProjectStatus {
  schema: 'comet.status.v2';
  defaultEntry: CometEntryResolution | { error: string };
  workflows: {
    native: { changes: NativeStatusProjection[]; error?: string };
    classic: { changes: ChangeStatus[] };
  };
  unmanagedOpenSpec: ChangeStatus[];
}
