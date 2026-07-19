import { describe, expect, it } from 'vitest';
import {
  builtinCometFivePhaseWorkflow,
  builtinCometNativeWorkflow,
  hashWorkflowProtocol,
  normalizeWorkflowDefinition,
  validateWorkflowDefinition,
} from '../../../domains/workflow-contract/index.js';

describe('workflow contract normalization', () => {
  it('normalizes the self-contained Native workflow without external Skill calls', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometNativeWorkflow({
        name: 'native-product-change',
        goal: 'Ship through the lightweight Native workflow.',
      }),
    );

    expect(workflow.protocol.kind).toBe('comet-native');
    expect(workflow.protocol.nodes.map((node) => node.id)).toEqual([
      'shape',
      'build',
      'verify',
      'archive',
    ]);
    expect(
      workflow.protocol.nodes.every((node) => node.implementation.skill === 'comet-native'),
    ).toBe(true);
    expect(workflow.protocol.nodes.every((node) => node.requiredSkillCalls.length === 0)).toBe(
      true,
    );
    expect(workflow.protocol.nodes.every((node) => node.augmentations.length === 0)).toBe(true);
    expect(workflow.requiredSkills).toEqual(['comet-native']);
    expect(workflow.protocol.outputSchemas.map((schema) => schema.id)).toEqual([
      'comet.native.brief.v1',
      'comet.native.spec-change.v1',
      'comet.native.implementation.v1',
      'comet.native.verify.v1',
      'comet.native.archive.v1',
    ]);
    expect(workflow.protocol.state).toEqual({
      kind: 'native-change',
      statePath: 'changes/*/comet-state.yaml',
      pathBase: 'native-root',
      currentNodeField: 'phase',
      completedNodesField: 'runtime.completedNodes',
      evidenceField: 'runtime.trajectory',
    });
  });

  it('normalizes the Comet five-phase template into Nodes with Output Schemas', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Use the project component library in Comet execution.',
      }),
    );

    expect(workflow.protocol.schemaVersion).toBe(1);
    expect(workflow.protocol.kind).toBe('comet-five-phase-overlay');
    expect(workflow.protocol.nodes.map((node) => node.id)).toEqual([
      'open',
      'design',
      'plan',
      'execute',
      'subagent-execute',
      'review',
      'verify',
      'archive',
    ]);
    expect(workflow.protocol.nodes.find((node) => node.id === 'open')).toMatchObject({
      kind: 'control',
      responsibility: expect.stringContaining('Intake'),
      operations: ['require', 'augment'],
      outputSchemas: ['comet.intake.v1'],
    });
    expect(workflow.protocol.nodes.find((node) => node.id === 'plan')).toMatchObject({
      kind: 'producer',
      responsibility: expect.stringContaining('implementation plan'),
      operations: ['require', 'augment', 'override'],
      outputSchemas: ['comet.plan.v1'],
    });
    expect(workflow.protocol.outputSchemas.map((schema) => schema.id)).toEqual(
      expect.arrayContaining(['comet.plan.v1', 'comet.handoff.v1', 'comet.review.v1']),
    );
    expect(workflow.protocol.state).toEqual({
      kind: 'comet-overlay',
      statePath: 'openspec/changes/*/.comet.yaml',
      currentNodeField: 'phase',
      completedNodesField: 'completedNodes',
      evidenceField: 'evidence',
    });
  });

  it('allows required Skill calls without replacing Node implementations', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Require project Skills during execution.',
      }),
      nodes: {
        execute: {
          requiredSkillCalls: [
            {
              skill: 'elementui',
              reason: 'Use project component library during direct implementation.',
            },
          ],
        },
        'subagent-execute': {
          requiredSkillCalls: [{ skill: 'elementui', scope: 'handoff' }],
        },
        review: {
          requiredSkillCalls: [{ skill: 'whitebox-code-standard' }],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'execute')).toMatchObject({
      implementation: { skill: 'comet-build', operation: 'default' },
      requiredSkillCalls: [expect.objectContaining({ skill: 'elementui', operation: 'require' })],
    });
    expect(workflow.requiredSkills).toEqual(
      expect.arrayContaining(['elementui', 'whitebox-code-standard']),
    );
  });

  it('normalizes Required Skill Call and augmentation enforcement levels', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'enforced-comet',
        goal: 'Require and augment a Comet Node.',
      }),
      nodes: {
        execute: {
          requiredSkillCalls: [{ skill: 'elementui' }],
          augmentations: [{ skill: 'grill-me', enforcement: 'guarded' }],
        },
        'subagent-execute': {
          augmentations: [{ skill: 'grill-me', scope: 'handoff' }],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'execute')).toMatchObject({
      requiredSkillCalls: [expect.objectContaining({ skill: 'elementui', enforcement: 'guarded' })],
      augmentations: [expect.objectContaining({ skill: 'grill-me', enforcement: 'guarded' })],
    });
    expect(workflow.protocol.nodes.find((node) => node.id === 'subagent-execute')).toMatchObject({
      augmentations: [
        expect.objectContaining({ skill: 'grill-me', enforcement: 'handoff-guarded' }),
      ],
    });
  });

  it('attaches custom Output Schemas through Node patches', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'comet-grill-me',
        goal: 'Use grill-me during design, planning, and review.',
      }),
      nodes: {
        design: { outputSchemas: ['comet.grill-me.v1'] },
        plan: { outputSchemas: ['comet.grill-me.v1'] },
        review: { outputSchemas: ['comet.grill-me.v1'] },
      },
      outputSchemas: [
        {
          id: 'comet.grill-me.v1',
          description: 'Grill-me critique evidence.',
          artifacts: [],
          evidence: [{ id: 'grill-summary', required: true }],
        },
      ],
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'design')?.outputSchemas).toEqual([
      'comet.design.v1',
      'comet.grill-me.v1',
    ]);
    expect(workflow.protocol.evals[0]?.requiredOutputSchemas).toEqual(
      expect.arrayContaining(['comet.grill-me.v1']),
    );
  });

  it('reports custom Output Schemas that are defined but not attached to any Node', () => {
    const result = validateWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'orphan-schema',
        goal: 'Define but do not attach a schema.',
      }),
      outputSchemas: [
        {
          id: 'orphan.schema.v1',
          description: 'Unused schema.',
          artifacts: [],
          evidence: [{ id: 'summary', required: true }],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'orphan-output-schema',
          message: expect.stringContaining('orphan.schema.v1'),
        }),
      ]),
    );
  });

  it('rejects patch Output Schemas that are not defined', () => {
    const result = validateWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'missing-patch-schema',
        goal: 'Attach a missing schema.',
      }),
      nodes: {
        plan: { outputSchemas: ['missing.schema.v1'] },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-output-schema',
          nodeId: 'plan',
          message: expect.stringContaining('missing.schema.v1'),
        }),
      ]),
    );
  });

  it('rejects ordinary override of Comet control Nodes', () => {
    expect(() =>
      normalizeWorkflowDefinition({
        ...builtinCometFivePhaseWorkflow({
          name: 'unsafe-comet',
          goal: 'Replace execution.',
        }),
        nodes: {
          execute: {
            implementation: { skill: 'custom-executor', operation: 'override' },
            satisfies: ['comet.execution-evidence.v1'],
          },
        },
      }),
    ).toThrow(/execute.*control.*override/iu);
  });

  it('rejects producer override without a satisfied Output Schema', () => {
    expect(() =>
      normalizeWorkflowDefinition({
        ...builtinCometFivePhaseWorkflow({
          name: 'team-comet',
          goal: 'Replace planning.',
        }),
        nodes: {
          plan: {
            implementation: { skill: 'team-planning', operation: 'override' },
          },
        },
      }),
    ).toThrow(/plan.*Output Schema/iu);
  });

  it('accepts producer override when it satisfies the Node Output Schema', () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Replace planning.',
      }),
      nodes: {
        plan: {
          implementation: { skill: 'team-planning', operation: 'override' },
          satisfies: ['comet.plan.v1'],
        },
      },
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'plan')).toMatchObject({
      implementation: { skill: 'team-planning', operation: 'override' },
    });
  });

  it('preserves required Skill calls declared by custom Workflow Nodes', () => {
    const workflow = normalizeWorkflowDefinition({
      kind: 'workflow-kernel',
      name: 'release-handoff',
      goal: 'Profile a change, delegate release notes, and run security review.',
      customNodes: [
        {
          id: 'delegate-notes',
          label: 'Delegate Notes',
          kind: 'handoff',
          responsibility: 'Delegate release note drafting and require returned evidence.',
          implementation: { skill: 'handoff-coordinator', operation: 'default', scope: 'handoff' },
          requiredSkillCalls: [
            {
              skill: 'release-notes',
              scope: 'handoff',
              reason: 'The delegated agent must write release notes.',
            },
          ],
          operations: ['require', 'augment'],
          outputSchemas: ['release.notes.v1'],
          guardrails: [
            { id: 'handoff-returned', label: 'Handoff returned evidence', validation: 'semantic' },
          ],
        },
      ],
      outputSchemas: [
        {
          id: 'release.notes.v1',
          description: 'Release note handoff result.',
          artifacts: [],
          evidence: [{ id: 'summary', required: true }],
        },
      ],
    });

    expect(workflow.protocol.nodes.find((node) => node.id === 'delegate-notes')).toMatchObject({
      responsibility: expect.stringContaining('Delegate'),
      requiredSkillCalls: [
        expect.objectContaining({
          skill: 'release-notes',
          operation: 'require',
          scope: 'handoff',
        }),
      ],
    });
    expect(workflow.requiredSkills).toEqual(
      expect.arrayContaining(['handoff-coordinator', 'release-notes']),
    );
  });

  it('hashes protocols deterministically', () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({ name: 'hashable-comet', goal: 'Hash protocol.' }),
    );

    expect(hashWorkflowProtocol(workflow.protocol)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashWorkflowProtocol(workflow.protocol)).toBe(hashWorkflowProtocol(workflow.protocol));
  });

  it('returns validation findings for advanced callers', () => {
    const result = validateWorkflowDefinition({
      kind: 'comet-five-phase-overlay',
      name: 'bad-comet',
      goal: 'Bad override.',
      nodes: {
        archive: {
          implementation: { skill: 'skip-archive', operation: 'override' },
          satisfies: ['comet.archive.v1'],
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.findings.map((finding) => finding.code)).toContain('control-node-override');
  });
});
