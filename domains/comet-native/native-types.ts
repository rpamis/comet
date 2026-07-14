export type NativePhase = 'shape' | 'build' | 'verify' | 'archive';
export type NativeApproval = null | 'implicit' | 'confirmed';
export type NativeVerificationResult = 'pending' | 'pass' | 'fail';
export type NativeSpecOperation = 'create' | 'replace' | 'remove';

export interface NativePendingRootMove {
  id: string;
  fromArtifactRoot: string;
  toArtifactRoot: string;
  stage: 'copying' | 'ready' | 'switched';
}

export interface CometProjectConfig {
  schema: 'comet.project.v1';
  default_workflow: 'native' | 'classic';
  native: {
    artifact_root: string;
    pending_root_move?: NativePendingRootMove;
  };
}

export interface NativeProjectPaths {
  projectRoot: string;
  configFile: string;
  artifactRoot: string;
  artifactRootRef: string;
  nativeRoot: string;
  specsDir: string;
  changesDir: string;
  archiveDir: string;
  runtimeDir: string;
  locksDir: string;
  transactionsDir: string;
}

export interface NativeSpecChange {
  capability: string;
  operation: NativeSpecOperation;
  source?: string;
  base_hash: string | null;
}

export interface NativeChangeState {
  schema: 'comet.native.v1';
  name: string;
  language: 'en' | 'zh-CN';
  phase: NativePhase;
  brief: 'brief.md';
  approval: NativeApproval;
  confirmation_required: boolean;
  spec_changes: NativeSpecChange[];
  verification_result: NativeVerificationResult;
  verification_report: string | null;
  archived: boolean;
  created_at: string;
  run_id: string | null;
}

export interface NativeFinding {
  code: string;
  message: string;
  path?: string;
}

export interface NativeArtifactValidation {
  valid: boolean;
  findings: NativeFinding[];
}
