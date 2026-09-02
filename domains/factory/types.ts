import type { WorkflowDefinitionInput, WorkflowProtocol } from '../workflow-contract/index.js';
import type { AuthoringReview } from '../bundle/types.js';

export interface FactoryCallChainItem {
  skill: string;
  preferenceIndex: number | null;
}

export interface FactoryCompositionStep {
  id: string;
  skill: string;
  source: 'atomic' | 'flow' | 'choice';
  fromSkill?: string;
  choiceId?: string;
  preferenceIndex: number | null;
}

export interface FactoryCompositionChoice {
  id: string;
  fromSkill: string;
  options: string[];
  selectedSkill: string | null;
  reason: string;
}

export interface FactoryCompositionIssue {
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

export interface FactoryComposition {
  schemaVersion: 1;
  entrySkills: string[];
  steps: FactoryCompositionStep[];
  choices: FactoryCompositionChoice[];
  issues: FactoryCompositionIssue[];
}

export interface FactoryOrderDeviation {
  skill: string;
  expectedIndex: number;
  actualIndex: number;
  reason: string;
}

export interface FactoryResolvedSkill {
  query: string;
  preferenceIndex: number | null;
  status: 'available' | 'missing' | 'ambiguous';
  sources: Array<{
    name: string;
    preferenceIndex: number | null;
    platform: string;
    scope: 'project' | 'global' | 'builtin' | 'plugin' | 'explicit';
    origin: 'project' | 'global' | 'builtin' | 'plugin' | 'explicit';
    factory?: { query: string };
    root: string;
    description: string;
    skillMd: string;
    references?: Array<{ path: string; contentHash: string }>;
    scripts?: Array<{
      path: string;
      sideEffect: 'unknown' | 'none' | 'read' | 'write' | 'external';
    }>;
    hash: string;
  }>;
}

export interface FactorySkillPackagePlan {
  root: string;
  name: string;
  version: string;
  description: string;
  goal: string;
  defaultLocale: string;
  callChain: FactoryCallChainItem[];
  workflowDefinition?: WorkflowDefinitionInput;
  workflowProtocol?: WorkflowProtocol;
  skillCreator?: {
    intent: 'customize-comet' | 'new-skill' | 'upgrade-existing';
  };
  composition?: FactoryComposition;
  resolvedSkills?: FactoryResolvedSkill[];
  preference?: {
    mode?: 'advisory' | 'strict';
    policies?: {
      missing?: string;
      ambiguous?: string;
      deviation?: string;
      scripts?: string;
      hooks?: string;
    };
    requiredSkills?: string[];
    sourcePath?: string;
    sourceHash?: string;
    warnings?: unknown[];
  };
  deviations: FactoryOrderDeviation[];
  engineMode: 'none' | 'deterministic' | 'adaptive';
  contentDrafts?: Record<string, string>;
  authoringReview?: AuthoringReview;
}

export interface FactoryControlPlaneOutput {
  checksPath: string | null;
  evalManifestPath: string | null;
  compositionReportPath: string;
  scripts: string[];
}

export interface GeneratedFactoryPlatformAgent {
  id: string;
  platform: 'claude';
  path: string;
}

export type GeneratedWrapperClassification =
  'delegate-complete' | 'delegate-advisory' | 'scaffold-blocked' | 'kernel-authored';

export interface GeneratedFactorySkillPackage {
  packageRoot: string;
  skillPath: string;
  internalSkills: string[];
  enginePath: string | null;
  evalManifestPath: string | null;
  controlPlane: FactoryControlPlaneOutput;
  platformAgents: GeneratedFactoryPlatformAgent[];
  unauthoredSubstanceNodes?: string[];
  wrapperClassification?: GeneratedWrapperClassification;
}
