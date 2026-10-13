export type EvalExecutionStatus =
  | 'queued'
  | 'preparing'
  | 'generating'
  | 'running'
  | 'judging'
  | 'finalizing'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'interrupted'
  | 'unknown';
export type EvalConclusion = 'passed' | 'failed' | 'incomplete';
export interface EvalRunConfig {
  target: string;
  targetType: 'skill' | 'application';
  agent?: string;
  model?: string;
  judgeAgent?: string;
  judgeModel?: string;
  judgeEnabled?: boolean;
  baseUrl?: string;
  judgeBaseUrl?: string;
  suite?: 'local' | 'langsmith' | 'langfuse';
  task?: string;
  quick?: boolean;
  profile?: string;
  goal?: string;
  timeoutSeconds?: number;
  maxTurns?: number;
  previousExperimentId?: string;
  retrySourceRunId?: string;
}
export interface EvalManagedRun {
  schema: 'comet.eval.managed-run.v1';
  id: string;
  origin: 'dashboard' | 'cli';
  createdAt: string;
  updatedAt: string;
  status: EvalExecutionStatus;
  config: EvalRunConfig;
  targetId: string;
  contentHash: string;
  previewHash: string;
  requestId?: string;
  baselineRunId?: string | null;
  owner?: { pid: number; identity?: string };
  child?: { pid: number; identity?: string };
  error?: string;
  exitCode?: number | null;
}
export interface EvalCaseResult {
  id: string;
  task: string;
  prompt: string | null;
  finalResponse: string | null;
  treatment: string;
  repetition: number;
  passed: boolean | null;
  quality: 'included' | 'flagged' | 'excluded' | 'unknown';
  qualityReason: string | null;
  checksPassed: string[];
  checksFailed: string[];
  scores: Record<string, number | null>;
  scoreSources: Record<string, 'check' | 'judge'>;
  failureAttribution: Array<{ bucket: string; check: string; reason?: string }>;
  durationSeconds: number | null;
  tokens: number | null;
  costUsd: number | null;
  model: string | null;
  agent: string | null;
  caseHash: string | null;
  validatorHash: string | null;
  artifacts: Array<{ id: string; label: string }>;
}
export interface EvalRunDetail {
  archiveId?: string;
  archiveAssessment?: {
    taskCompleted: boolean;
    originalTestsPassed: number;
    regressionTestsPassed: number;
  };
  id: string;
  origin: 'dashboard' | 'cli' | 'history';
  createdAt: string | null;
  completedAt: string | null;
  executionStatus: EvalExecutionStatus;
  conclusion: EvalConclusion;
  target: {
    id: string;
    name: string;
    type: 'skill' | 'application' | 'unknown';
    version: string | null;
    path: string | null;
    contentHash: string | null;
  };
  config: Partial<EvalRunConfig>;
  passed: number;
  total: number;
  expectedTotal: number | null;
  cases: EvalCaseResult[];
  progress?: {
    phase: 'preparing' | 'generating' | 'running' | 'judging' | 'finalizing';
    updatedAt: string | null;
    lastEventAt: string | null;
    currentCase: { task: string; treatment: string | null; repetition: number } | null;
    activities: Array<{
      id: string;
      at: string;
      kind: 'phase' | 'model' | 'tool';
      message: string;
    }>;
  } | null;
  metrics: {
    durationSeconds: number | null;
    tokens: number | null;
    knownCostUsd: number | null;
    costStatus: 'case-costs-only' | 'partial' | 'unavailable';
    generationCostUsd: number | null;
  };
  coverage: {
    executedSteps: string[];
    coveredSteps: string[];
    uncoveredSteps: string[];
    coveredChoices: string[];
    uncoveredChoices: string[];
    recoveredActions: string[];
    actualModels: string[];
  } | null;
  limitations: string[];
  failures: string[];
  artifacts: Array<{ id: string; label: string; format: 'markdown' | 'html' | 'json' | 'text' }>;
  baselineScope: string | null;
  baselineRunId: string | null;
  boundBaselineRunId: string | null;
  isBaseline: boolean;
  baselineEligible: boolean;
  baselineDisabledReason: string | null;
  availableActions: { stop: boolean; rerun: boolean; setBaseline: boolean; compare: boolean };
  stale: boolean | null;
  diagnostics: string[];
}
export interface EvalRunComparison {
  comparable: boolean;
  reasons: string[];
  baseline: EvalRunDetail;
  candidate: EvalRunDetail;
  improved: number;
  regressed: number;
  unchanged: number;
  configurationChanges: Array<{ field: string; baseline: unknown; candidate: unknown }>;
  cases: Array<{
    task: string;
    repetition: number;
    baseline: boolean | null;
    candidate: boolean | null;
    change: 'improved' | 'regressed' | 'unchanged' | 'unmatched';
  }>;
}
