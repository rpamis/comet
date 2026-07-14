export type WorkflowKind = 'comet-five-phase-overlay' | 'comet-native' | 'workflow-kernel';

export type WorkflowNodeKind = 'control' | 'producer' | 'action' | 'handoff' | 'guardrail';

export type WorkflowNodeOperation = 'require' | 'augment' | 'override' | 'disable';

export type WorkflowBindingOperation = 'default' | WorkflowNodeOperation;

export type WorkflowEnforcementLevel = 'guarded' | 'handoff-guarded' | 'evidence-only' | 'advisory';

export type OutputValidationKind =
  | 'evidence-only'
  | 'artifact-exists'
  | 'artifact-structured'
  | 'semantic'
  | 'state-transition';

export interface WorkflowArtifactSchema {
  id: string;
  kind: 'file' | 'directory' | 'state' | 'report';
  required: boolean;
  paths: string[];
  pathBase?: 'project' | 'native-root';
  validations: OutputValidationKind[];
}

export interface WorkflowEvidenceSchema {
  id: string;
  required: boolean;
}

export interface WorkflowOutputSchema {
  id: string;
  description: string;
  artifacts: WorkflowArtifactSchema[];
  evidence: WorkflowEvidenceSchema[];
}

export interface WorkflowSkillBindingInput {
  skill: string;
  operation?: WorkflowBindingOperation;
  reason?: string;
  scope?: 'main' | 'handoff' | 'review';
  enforcement?: WorkflowEnforcementLevel;
}

export interface WorkflowSkillBinding {
  skill: string;
  operation: WorkflowBindingOperation;
  reason?: string;
  scope: 'main' | 'handoff' | 'review';
  enforcement: WorkflowEnforcementLevel;
}

export interface WorkflowGuardrail {
  id: string;
  label: string;
  validation: OutputValidationKind;
}

export interface WorkflowNodeTemplate {
  id: string;
  label: string;
  kind: WorkflowNodeKind;
  responsibility: string;
  optional?: boolean;
  implementation: WorkflowSkillBindingInput & {
    operation: WorkflowBindingOperation;
    scope: 'main' | 'handoff' | 'review';
  };
  requiredSkillCalls?: WorkflowSkillBindingInput[];
  augmentations?: WorkflowSkillBindingInput[];
  satisfies?: string[];
  disabled?: boolean;
  operations: WorkflowNodeOperation[];
  outputSchemas: string[];
  guardrails: WorkflowGuardrail[];
}

export interface WorkflowNodePatch {
  implementation?: WorkflowSkillBindingInput;
  requiredSkillCalls?: WorkflowSkillBindingInput[];
  augmentations?: WorkflowSkillBindingInput[];
  outputSchemas?: string[];
  satisfies?: string[];
  disabled?: boolean;
}

export interface WorkflowDefinitionInput {
  kind: WorkflowKind;
  name: string;
  goal: string;
  nodes?: Record<string, WorkflowNodePatch>;
  customNodes?: WorkflowNodeTemplate[];
  outputSchemas?: WorkflowOutputSchema[];
}

export interface WorkflowNodeProtocol extends WorkflowNodeTemplate {
  implementation: WorkflowSkillBinding;
  requiredSkillCalls: WorkflowSkillBinding[];
  augmentations: WorkflowSkillBinding[];
  satisfies: string[];
  disabled: boolean;
}

export interface WorkflowEdge {
  from: string;
  to: string | null;
  condition: 'success' | 'failure' | 'pause';
}

export interface WorkflowStateSpec {
  kind: 'comet-overlay' | 'native-change' | 'workflow-run';
  statePath: string;
  pathBase?: 'project' | 'native-root';
  currentNodeField: string;
  completedNodesField: string;
  evidenceField: string;
}

export interface WorkflowEvalSpec {
  id: string;
  expectedNodeOrder: string[];
  requiredOutputSchemas: string[];
}

export interface WorkflowProtocol {
  schemaVersion: 1;
  kind: WorkflowKind;
  name: string;
  goal: string;
  nodes: WorkflowNodeProtocol[];
  edges: WorkflowEdge[];
  outputSchemas: WorkflowOutputSchema[];
  state: WorkflowStateSpec;
  evals: WorkflowEvalSpec[];
}

export interface NormalizedWorkflowDefinition {
  input: WorkflowDefinitionInput;
  protocol: WorkflowProtocol;
  requiredSkills: string[];
  sourceSkills: string[];
}

export interface WorkflowValidationFinding {
  code:
    | 'unknown-node'
    | 'unsupported-operation'
    | 'control-node-override'
    | 'producer-missing-output-schema'
    | 'missing-output-schema'
    | 'orphan-output-schema'
    | 'duplicate-node'
    | 'disabled-required-node';
  message: string;
  nodeId?: string;
  skill?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  findings: WorkflowValidationFinding[];
}
