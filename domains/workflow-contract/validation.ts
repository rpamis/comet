import {
  BUILTIN_COMET_NATIVE_OUTPUT_SCHEMAS,
  BUILTIN_COMET_OUTPUT_SCHEMAS,
  COMET_FIVE_PHASE_NODES,
  COMET_NATIVE_NODES,
} from './builtins.js';
import type {
  WorkflowBindingOperation,
  WorkflowDefinitionInput,
  WorkflowNodeTemplate,
  WorkflowValidationFinding,
  WorkflowValidationResult,
} from './types.js';

function templatesFor(input: WorkflowDefinitionInput): WorkflowNodeTemplate[] {
  if (input.kind === 'comet-five-phase-overlay') {
    return [...COMET_FIVE_PHASE_NODES, ...(input.customNodes ?? [])];
  }
  if (input.kind === 'comet-native') {
    return [...COMET_NATIVE_NODES, ...(input.customNodes ?? [])];
  }
  return input.customNodes ?? [];
}

function schemaIdsFor(input: WorkflowDefinitionInput): Set<string> {
  const schemas =
    input.kind === 'comet-five-phase-overlay'
      ? BUILTIN_COMET_OUTPUT_SCHEMAS
      : input.kind === 'comet-native'
        ? BUILTIN_COMET_NATIVE_OUTPUT_SCHEMAS
        : [];
  return new Set([...schemas, ...(input.outputSchemas ?? [])].map((schema) => schema.id));
}

function uniqueTemplates(templates: WorkflowNodeTemplate[]): {
  byId: Map<string, WorkflowNodeTemplate>;
  findings: WorkflowValidationFinding[];
} {
  const byId = new Map<string, WorkflowNodeTemplate>();
  const findings: WorkflowValidationFinding[] = [];
  for (const template of templates) {
    if (byId.has(template.id)) {
      findings.push({
        code: 'duplicate-node',
        nodeId: template.id,
        message: `${template.id}: duplicate Workflow Node definition`,
      });
      continue;
    }
    byId.set(template.id, template);
  }
  return { byId, findings };
}

function validateBindingOperation(options: {
  findings: WorkflowValidationFinding[];
  node: WorkflowNodeTemplate;
  skill: string;
  operation: WorkflowBindingOperation;
  label: string;
}): void {
  if (options.operation === 'default') return;
  if (options.node.operations.includes(options.operation)) return;
  options.findings.push({
    code: 'unsupported-operation',
    nodeId: options.node.id,
    skill: options.skill,
    message: `${options.node.id}: ${options.label} cannot use ${options.operation}`,
  });
}

export function validateWorkflowDefinition(
  input: WorkflowDefinitionInput,
): WorkflowValidationResult {
  const { byId, findings } = uniqueTemplates(templatesFor(input));
  const schemaIds = schemaIdsFor(input);

  for (const template of byId.values()) {
    validateBindingOperation({
      findings,
      node: template,
      skill: template.implementation.skill,
      operation: template.implementation.operation,
      label: 'implementation',
    });
    for (const binding of template.requiredSkillCalls ?? []) {
      validateBindingOperation({
        findings,
        node: template,
        skill: binding.skill,
        operation: binding.operation ?? 'require',
        label: 'required Skill call',
      });
    }
    for (const binding of template.augmentations ?? []) {
      validateBindingOperation({
        findings,
        node: template,
        skill: binding.skill,
        operation: binding.operation ?? 'augment',
        label: 'augmentation',
      });
    }
  }

  for (const [nodeId, patch] of Object.entries(input.nodes ?? {})) {
    const template = byId.get(nodeId);
    if (!template) {
      findings.push({
        code: 'unknown-node',
        nodeId,
        message: `${nodeId}: unknown Workflow Node for ${input.kind}`,
      });
      continue;
    }
    if (patch.disabled && !template.optional) {
      findings.push({
        code: 'disabled-required-node',
        nodeId,
        message: `${nodeId}: required Workflow Node cannot be disabled`,
      });
    }
    if (patch.implementation) {
      const operation = patch.implementation.operation ?? 'override';
      if (operation !== 'default' && !template.operations.includes(operation)) {
        findings.push({
          code: 'unsupported-operation',
          nodeId,
          skill: patch.implementation.skill,
          message: `${nodeId}: ${template.kind} Node does not support ${operation}`,
        });
      }
      if (template.kind === 'control' && operation === 'override') {
        findings.push({
          code: 'control-node-override',
          nodeId,
          skill: patch.implementation.skill,
          message: `${nodeId}: control Node cannot use override in ordinary mode`,
        });
      }
      if (template.kind === 'producer' && operation === 'override') {
        const missing = template.outputSchemas.filter(
          (schema) => !(patch.satisfies ?? []).includes(schema),
        );
        if (missing.length > 0) {
          findings.push({
            code: 'producer-missing-output-schema',
            nodeId,
            skill: patch.implementation.skill,
            message: `${nodeId}: producer override must satisfy Output Schema ${missing.join(', ')}`,
          });
        }
      }
    }
    for (const binding of patch.requiredSkillCalls ?? []) {
      validateBindingOperation({
        findings,
        node: template,
        skill: binding.skill,
        operation: binding.operation ?? 'require',
        label: 'required Skill call',
      });
    }
    for (const binding of patch.augmentations ?? []) {
      validateBindingOperation({
        findings,
        node: template,
        skill: binding.skill,
        operation: binding.operation ?? 'augment',
        label: 'augmentation',
      });
    }
    for (const schema of patch.outputSchemas ?? []) {
      if (!schemaIds.has(schema)) {
        findings.push({
          code: 'missing-output-schema',
          nodeId,
          message: `${nodeId}: Output Schema ${schema} is not defined`,
        });
      }
    }
  }

  for (const template of byId.values()) {
    for (const schema of template.outputSchemas) {
      if (!schemaIds.has(schema)) {
        findings.push({
          code: 'missing-output-schema',
          nodeId: template.id,
          message: `${template.id}: Output Schema ${schema} is not defined`,
        });
      }
    }
  }

  const attachedSchemas = new Set<string>();
  for (const template of byId.values()) {
    for (const schema of template.outputSchemas) attachedSchemas.add(schema);
  }
  for (const [nodeId, patch] of Object.entries(input.nodes ?? {})) {
    if (!byId.has(nodeId)) continue;
    for (const schema of patch.outputSchemas ?? []) attachedSchemas.add(schema);
  }
  const builtinSchemas = new Set(
    (input.kind === 'comet-five-phase-overlay'
      ? BUILTIN_COMET_OUTPUT_SCHEMAS
      : input.kind === 'comet-native'
        ? BUILTIN_COMET_NATIVE_OUTPUT_SCHEMAS
        : []
    ).map((schema) => schema.id),
  );
  for (const schema of input.outputSchemas ?? []) {
    if (!builtinSchemas.has(schema.id) && !attachedSchemas.has(schema.id)) {
      findings.push({
        code: 'orphan-output-schema',
        message: `Output Schema ${schema.id} is defined but not attached to any Workflow Node`,
      });
    }
  }

  return { valid: findings.length === 0, findings };
}
