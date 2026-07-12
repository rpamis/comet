import type { BundleCandidateSource } from './candidates.js';
import type {
  NormalizedSkillPreferences,
  SkillPreferencePolicies,
  SkillPreferenceWarning,
} from '../skill/preferences.js';
import type { WorkflowDefinitionInput, WorkflowProtocol } from '../workflow-contract/index.js';
import type { SkillCreatorIntent } from './user-facing.js';

export type BundleSkillVisibility = 'entry' | 'internal';
export type BundleCapability =
  | 'skills'
  | 'rules'
  | 'hooks'
  | 'scripts'
  | 'references'
  | 'assets'
  | 'agents';
export type BundleSideEffect = 'none' | 'read' | 'write' | 'external';

export interface BundleSkillDefinition {
  id: string;
  path: string;
  visibility: BundleSkillVisibility;
}

export interface BundleRuleDefinition {
  id: string;
  path: string;
  mode: 'always' | 'matched';
  match?: string[];
  priority?: number;
  required: boolean;
}

export interface BundleHookDefinition {
  id: string;
  path: string;
}

export interface BundleScriptDefinition {
  id: string;
  path: string;
  sideEffect: BundleSideEffect;
  runtime: 'node' | 'bash' | 'python';
  requiresConfirmation?: boolean;
}

export interface BundleAgentDefinition {
  id: string;
  path: string;
  platform: 'claude';
  required: boolean;
}

export interface BundlePlatformOverride {
  platform: string;
  replaces: string;
  path: string;
}

export interface NormalizedHook {
  event: 'session_start' | 'before_tool' | 'after_tool' | 'before_write' | 'after_write';
  matcher?: string;
  script: string;
  failure: 'block' | 'warn';
  requiresConfirmation: boolean;
}

export interface BundleManifest {
  apiVersion: 'comet/v1alpha1';
  kind: 'SkillBundle';
  metadata: {
    name: string;
    version: string;
    description: string;
    defaultLocale: string;
    locales: string[];
  };
  skills: BundleSkillDefinition[];
  resources: {
    rules: BundleRuleDefinition[];
    hooks: BundleHookDefinition[];
    references: string[];
    scripts: BundleScriptDefinition[];
    assets: string[];
    agents: BundleAgentDefinition[];
  };
  platforms: {
    requires: BundleCapability[];
    optional: BundleCapability[];
    overrides: BundlePlatformOverride[];
  };
  engine: { enabled: boolean; path?: string };
}

export interface SkillBundle {
  root: string;
  manifest: BundleManifest;
}

export interface ResolvedBundleLocale {
  bundle: SkillBundle;
  locale: string;
  files: Map<string, string>;
}

export interface BundleCompilerIr {
  bundle: { name: string; version: string; locale: string; hash: string };
  capabilities: {
    requires: BundleCapability[];
    optional: BundleCapability[];
  };
  skills: Array<{
    id: string;
    logicalRoot: string;
    visibility: BundleSkillVisibility;
    sourceRoot: string;
    files: Array<{ relativePath: string; source: string }>;
  }>;
  rules: Array<BundleRuleDefinition & { source: string }>;
  hooks: Array<NormalizedHook & { id: string; source: string }>;
  scripts: Array<BundleScriptDefinition & { source: string }>;
  references: Array<{ logicalPath: string; source: string }>;
  assets: Array<{ logicalPath: string; source: string }>;
  agents: Array<BundleAgentDefinition & { source: string }>;
  overrides: Array<BundlePlatformOverride & { source: string }>;
  engine: { sourceRoot: string } | null;
}

export interface ExecutableDisclosure {
  id: string;
  command: string;
  sideEffect: BundleSideEffect;
  destination: string;
}

export interface BundleFactoryCallChainItem {
  skill: string;
  preferenceIndex: number | null;
}

export interface BundleFactoryCompositionStep {
  id: string;
  skill: string;
  source: 'atomic' | 'flow' | 'choice';
  fromSkill?: string;
  choiceId?: string;
  preferenceIndex: number | null;
}

export interface BundleFactoryCompositionChoice {
  id: string;
  fromSkill: string;
  options: string[];
  selectedSkill: string | null;
  reason: string;
}

export interface BundleFactoryCompositionIssue {
  type:
    | 'unresolved-choice'
    | 'cycle'
    | 'unavailable-use'
    | 'duplicate-step'
    | 'duplicate-flow'
    | 'empty-flow';
  message: string;
  path?: string[];
  choiceId?: string;
  fromSkill?: string;
  skill?: string;
}

export interface BundleFactoryComposition {
  schemaVersion: 1;
  entrySkills: string[];
  steps: BundleFactoryCompositionStep[];
  choices: BundleFactoryCompositionChoice[];
  issues: BundleFactoryCompositionIssue[];
}

export interface BundleFactoryOrderDeviation {
  skill: string;
  expectedIndex: number;
  actualIndex: number;
  reason: string;
}

export interface BundleFactoryResolvedSkill {
  query: string;
  preferenceIndex: number | null;
  status: 'available' | 'missing' | 'ambiguous';
  sources: BundleCandidateSource[];
}

export interface BundleFactoryProposalConfirmationItem {
  id:
    | 'generate-scripts'
    | 'generate-rules'
    | 'generate-hooks'
    | 'run-eval'
    | 'accept-preference-deviation';
  label: string;
  required: boolean;
  reason: string;
}

export interface BundleFactoryProposalAction {
  id: 'confirm-generate' | 'revise-proposal' | 'cancel';
  label: string;
  command: string;
  writesState: boolean;
}

export interface BundleFactoryProposalSummary {
  title: string;
  goal: string;
  reusedSkills: Array<{
    skill: string;
    status: BundleFactoryResolvedSkill['status'];
    sourceCount: number;
    preferenceIndex: number | null;
    fromProjectPreference: boolean;
  }>;
  generatedControlPlane: string[];
  validationPlan: string[];
  requiredConfirmations: BundleFactoryProposalConfirmationItem[];
  preferenceNotes: string[];
}

export interface BundleFactoryProposalConfirmation {
  confirmed: boolean;
  confirmedAt: string;
  proposalHash: string;
  preferenceHash: string | null;
  acceptedCapabilities: Array<'skills' | 'scripts' | 'rules' | 'hooks' | 'references' | 'agents'>;
  warnings: string[];
}

export interface BundleControlPlaneOutput {
  checksPath: string | null;
  evalManifestPath: string | null;
  compositionReportPath: string;
  scripts: string[];
}

export interface BundleGeneratedPlatformAgent {
  id: string;
  platform: 'claude';
  path: string;
}

export type GeneratedWrapperClassification =
  | 'delegate-complete'
  | 'delegate-advisory'
  | 'scaffold-blocked'
  | 'kernel-authored';

export interface BundleGeneratedSkillPackage {
  entrySkill: string;
  internalSkills: string[];
  packageRoot: string;
  enginePath: string | null;
  evalManifestPath: string | null;
  controlPlane?: BundleControlPlaneOutput;
  platformAgents?: BundleGeneratedPlatformAgent[];
  unauthoredSubstanceNodes?: string[];
  wrapperClassification?: GeneratedWrapperClassification;
}

export interface BundleFactoryMetadata {
  goal: string;
  preferredSkills: string[];
  requiredSkills?: string[];
  skillCreatorIntent?: SkillCreatorIntent;
  workflowDefinition?: WorkflowDefinitionInput;
  workflowProtocol?: WorkflowProtocol;
  preferenceMode?: NormalizedSkillPreferences['mode'];
  preferencePolicies?: SkillPreferencePolicies;
  preferencePath?: string;
  preferenceHash?: string;
  preferenceWarnings?: SkillPreferenceWarning[];
  compositionEntrySkills?: string[];
  resolvedSkills: BundleFactoryResolvedSkill[];
  callChain: BundleFactoryCallChainItem[];
  composition?: BundleFactoryComposition;
  deviations: BundleFactoryOrderDeviation[];
  engineMode: 'none' | 'deterministic' | 'adaptive';
  runnerMode: 'change' | 'standalone';
  planPath?: string;
  planHash?: string;
  proposalConfirmation?: BundleFactoryProposalConfirmation;
  generatedSkillPackage?: BundleGeneratedSkillPackage;
  authoringContent?: Record<string, string>;
  authoringReview?: AuthoringReview;
}

export interface AuthoringReviewFinding {
  severity: 'critical' | 'important' | 'minor';
  path?: string;
  problem: string;
  fix?: string;
}

export interface AuthoringReview {
  passed: boolean;
  evidenceSource: 'deterministic-check-only' | 'llm-single' | 'llm-multivote';
  voters?: number;
  lenses?: string[];
  rounds?: number;
  findings: AuthoringReviewFinding[];
  reviewedAt: string;
}

export interface PlatformInstallFile {
  source: string;
  destination: string;
  kind: 'skill' | 'rule' | 'hook' | 'script' | 'reference' | 'asset' | 'agent' | 'engine';
  operation?:
    | {
        type: 'rule';
        format: 'md' | 'mdc' | 'copilot';
        mode: 'always' | 'matched';
        match?: string[];
      }
    | {
        type: 'hook';
        format:
          | 'claude-code'
          | 'gemini'
          | 'windsurf'
          | 'copilot'
          | 'qwen'
          | 'kiro'
          | 'qoder'
          | 'codebuddy';
        event: NormalizedHook['event'];
        matcher?: string;
        command: string;
        failure: NormalizedHook['failure'];
        requiresConfirmation: boolean;
      };
}

export type BundleAuthoringStatus =
  | 'draft'
  | 'eval-passed'
  | 'review-approved'
  | 'ready'
  | 'drift-conflict';

export interface BundleAuthoringState {
  schemaVersion: 1;
  name: string;
  mode: 'create' | 'optimize';
  status: BundleAuthoringStatus;
  draftPath: string;
  currentHash: string | null;
  base?: { root: string; version: string; hash: string };
  candidates: BundleCandidateSource[];
  defaultLocale: string;
  locales: string[];
  engineEnabled: boolean;
  factory?: BundleFactoryMetadata;
  eval?: { level: 'quick' | 'full'; hash: string; resultPath: string; passed: boolean };
  review?: {
    hash: string;
    decision: 'approved' | 'rejected';
    reviewer: string;
    at: string;
  };
  ready?: { hash: string; path: string; publishedAt: string };
  conflict?: { draftHash: string; readyHash: string };
}
