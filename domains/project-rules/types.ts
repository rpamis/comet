export type ProjectRuleSourceKind = 'comet-rules' | 'agent-instructions';
export type RuleCandidateStatus = 'pending' | 'ignored' | 'snoozed' | 'adopted';

export interface ProjectRuleSection {
  readonly sourcePath: string;
  readonly sourceKind: ProjectRuleSourceKind;
  readonly title: string;
  readonly text: string;
  readonly scope?: string;
}

export interface ProjectRuleSource {
  readonly path: string;
  readonly kind: ProjectRuleSourceKind;
  readonly sections: readonly ProjectRuleSection[];
}

export interface ProjectRuleSourceSnapshot {
  readonly path: string;
  readonly kind: ProjectRuleSourceKind;
  readonly sectionCount: number;
  readonly contentHash: string;
}

export interface VerificationEntrypoint {
  readonly id: string;
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly sourcePath: string;
}

export interface ProjectRuleVerificationSummary {
  readonly label: string;
  readonly sourcePath: string;
}

export interface RuleObservation {
  readonly projectId: string;
  readonly candidateKey: string;
  readonly text: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly source?: string;
  readonly observedAt: string;
}

export interface RuleCandidate {
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly status: RuleCandidateStatus;
  readonly observations: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRulesState {
  readonly version: 1;
  readonly initialized: boolean;
  readonly lastScanAt: string | null;
  readonly sources: readonly ProjectRuleSourceSnapshot[];
  readonly observations: readonly RuleObservation[];
  readonly candidates: readonly RuleCandidate[];
}

export interface ProjectRulesFileSystem {
  readText(filePath: string): Promise<string | null>;
  writeText(filePath: string, content: string): Promise<void>;
  listFiles(directoryPath: string): Promise<readonly string[]>;
}

export interface ProjectRulesSelectionRequest {
  readonly task: string;
  readonly path?: string;
  readonly sourceKinds?: readonly ProjectRuleSourceKind[];
  readonly maxSections?: number;
  readonly maxBytes?: number;
}

export interface SelectedProjectRule extends ProjectRuleSection {
  readonly score: number;
}

export interface ProjectRulesStatus {
  readonly initialized: boolean;
  readonly lastScanAt: string | null;
  readonly sources: readonly {
    path: string;
    kind: ProjectRuleSourceKind;
    sectionCount: number;
  }[];
  readonly verificationEntrypoints: readonly ProjectRuleVerificationSummary[];
  readonly candidates: readonly ProjectRuleCandidateSummary[];
}

export interface ProjectRuleCandidateSummary {
  readonly text: string;
  readonly state: 'pending' | 'snoozed';
}

export interface ProjectRulesServiceOptions {
  readonly projectRoot: string;
  readonly projectId?: string;
  readonly fileSystem?: ProjectRulesFileSystem;
  readonly now?: () => Date;
  readonly runtimeDirectory?: string;
}
