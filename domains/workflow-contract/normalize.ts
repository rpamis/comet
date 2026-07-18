import {
  BUILTIN_COMET_NATIVE_OUTPUT_SCHEMAS,
  BUILTIN_COMET_OUTPUT_SCHEMAS,
  COMET_FIVE_PHASE_NODES,
  COMET_NATIVE_NODES,
} from './builtins.js';
import type {
  NormalizedWorkflowDefinition,
  WorkflowDefinitionInput,
  WorkflowEdge,
  WorkflowKind,
  WorkflowNodeProtocol,
  WorkflowNodeTemplate,
  WorkflowOutputSchema,
  WorkflowProtocol,
  WorkflowSkillBinding,
  WorkflowSkillBindingInput,
} from './types.js';
import { validateWorkflowDefinition } from './validation.js';

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function defaultEnforcement(
  operation: WorkflowSkillBinding['operation'],
  scope: WorkflowSkillBinding['scope'],
): WorkflowSkillBinding['enforcement'] {
  if (scope === 'handoff') return 'handoff-guarded';
  if (operation === 'require') return 'guarded';
  if (operation === 'augment') return 'advisory';
  return 'guarded';
}

function normalizeBinding(
  input: WorkflowSkillBindingInput,
  operation: WorkflowSkillBinding['operation'],
): WorkflowSkillBinding {
  const scope = input.scope ?? 'main';
  const normalizedOperation = input.operation ?? operation;
  return {
    skill: input.skill,
    operation: normalizedOperation,
    scope,
    enforcement: input.enforcement ?? defaultEnforcement(normalizedOperation, scope),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function cloneTemplate(template: WorkflowNodeTemplate): WorkflowNodeTemplate {
  return {
    ...template,
    implementation: { ...template.implementation },
    ...(template.requiredSkillCalls
      ? { requiredSkillCalls: template.requiredSkillCalls.map((binding) => ({ ...binding })) }
      : {}),
    ...(template.augmentations
      ? { augmentations: template.augmentations.map((binding) => ({ ...binding })) }
      : {}),
    ...(template.satisfies ? { satisfies: [...template.satisfies] } : {}),
    operations: [...template.operations],
    outputSchemas: [...template.outputSchemas],
    guardrails: template.guardrails.map((guardrail) => ({ ...guardrail })),
  };
}

function templatesFor(
  kind: WorkflowKind,
  customNodes: WorkflowNodeTemplate[] = [],
): WorkflowNodeTemplate[] {
  if (kind === 'comet-five-phase-overlay') {
    return [...COMET_FIVE_PHASE_NODES.map(cloneTemplate), ...customNodes.map(cloneTemplate)];
  }
  if (kind === 'comet-native') {
    return [...COMET_NATIVE_NODES.map(cloneTemplate), ...customNodes.map(cloneTemplate)];
  }
  return customNodes.map(cloneTemplate);
}

function outputSchemasFor(input: WorkflowDefinitionInput): WorkflowOutputSchema[] {
  const schemas =
    input.kind === 'comet-five-phase-overlay'
      ? BUILTIN_COMET_OUTPUT_SCHEMAS
      : input.kind === 'comet-native'
        ? BUILTIN_COMET_NATIVE_OUTPUT_SCHEMAS
        : [];
  const byId = new Map<string, WorkflowOutputSchema>();
  for (const schema of [...schemas, ...(input.outputSchemas ?? [])]) {
    byId.set(schema.id, structuredClone(schema));
  }
  return [...byId.values()];
}

function workflowEdges(nodes: WorkflowNodeProtocol[]): WorkflowEdge[] {
  return nodes.flatMap((node, index) => [
    {
      from: node.id,
      to: nodes[index + 1]?.id ?? null,
      condition: 'success' as const,
    },
    {
      from: node.id,
      to: node.id,
      condition: 'failure' as const,
    },
    {
      from: node.id,
      to: node.id,
      condition: 'pause' as const,
    },
  ]);
}

export function normalizeWorkflowDefinition(
  input: WorkflowDefinitionInput,
): NormalizedWorkflowDefinition {
  const validation = validateWorkflowDefinition(input);
  if (!validation.valid) {
    throw new Error(validation.findings.map((finding) => finding.message).join('\n'));
  }

  const patches = input.nodes ?? {};
  const nodes = templatesFor(input.kind, input.customNodes).map((template) => {
    const patch = patches[template.id] ?? {};
    const implementation = patch.implementation
      ? normalizeBinding(patch.implementation, 'override')
      : normalizeBinding(template.implementation, 'default');
    return {
      ...template,
      implementation,
      requiredSkillCalls: [
        ...(template.requiredSkillCalls ?? []),
        ...(patch.requiredSkillCalls ?? []),
      ].map((binding) => normalizeBinding(binding, 'require')),
      augmentations: [...(template.augmentations ?? []), ...(patch.augmentations ?? [])].map(
        (binding) => normalizeBinding(binding, 'augment'),
      ),
      outputSchemas: dedupe([...(template.outputSchemas ?? []), ...(patch.outputSchemas ?? [])]),
      satisfies: dedupe([...(template.satisfies ?? []), ...(patch.satisfies ?? [])]),
      disabled: patch.disabled ?? template.disabled ?? false,
    };
  });
  const outputSchemas = outputSchemasFor(input);
  const requiredSkills = dedupe(
    nodes.flatMap((node) => [
      node.implementation.skill,
      ...node.requiredSkillCalls.map((binding) => binding.skill),
      ...node.augmentations.map((binding) => binding.skill),
    ]),
  );
  const sourceSkills = dedupe(nodes.map((node) => node.implementation.skill));
  const protocol: WorkflowProtocol = {
    schemaVersion: 1,
    kind: input.kind,
    name: input.name,
    goal: input.goal,
    nodes,
    edges: workflowEdges(nodes),
    outputSchemas,
    state:
      input.kind === 'comet-five-phase-overlay'
        ? {
            kind: 'comet-overlay',
            statePath: 'openspec/changes/*/.comet.yaml',
            currentNodeField: 'phase',
            completedNodesField: 'completedNodes',
            evidenceField: 'evidence',
          }
        : input.kind === 'comet-native'
          ? {
              kind: 'native-change',
              statePath: 'changes/*/comet-state.yaml',
              pathBase: 'native-root',
              currentNodeField: 'phase',
              completedNodesField: 'runtime.completedNodes',
              evidenceField: 'runtime.trajectory',
            }
          : {
              kind: 'workflow-run',
              statePath: `.comet/runs/${input.name}/state.json`,
              currentNodeField: 'currentNode',
              completedNodesField: 'completedNodes',
              evidenceField: 'evidence',
            },
    evals: [
      {
        id:
          input.kind === 'comet-five-phase-overlay'
            ? 'comet-five-phase-contract'
            : input.kind === 'comet-native'
              ? 'comet-native-contract'
              : 'workflow-route-conformance',
        expectedNodeOrder: nodes.filter((node) => !node.disabled).map((node) => node.id),
        requiredOutputSchemas: dedupe(nodes.flatMap((node) => node.outputSchemas)),
      },
    ],
  };
  return {
    input: structuredClone(input),
    protocol,
    requiredSkills,
    sourceSkills,
  };
}
