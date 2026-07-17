import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { parse } from 'yaml';
import { generateFactorySkillPackage } from '../../../domains/factory/package.js';
import type { FactorySkillPackagePlan } from '../../../domains/factory/types.js';
import {
  builtinCometFivePhaseWorkflow,
  normalizeWorkflowDefinition,
  type NormalizedWorkflowDefinition,
  type WorkflowDefinitionInput,
} from '../../../domains/workflow-contract/index.js';

const execFileAsync = promisify(execFile);

function frontmatterDescription(source: string): string {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  expect(match).not.toBeNull();
  const document = parse(match![1]!) as { description?: unknown };
  expect(typeof document.description).toBe('string');
  return document.description as string;
}

function packagePlan(options: {
  root: string;
  name: string;
  workflow: NormalizedWorkflowDefinition;
  engineMode?: FactorySkillPackagePlan['engineMode'];
}): FactorySkillPackagePlan {
  return {
    root: options.root,
    name: options.name,
    version: '1.0.0',
    description: `${options.name} workflow.`,
    goal: options.workflow.protocol.goal,
    defaultLocale: 'zh',
    callChain: options.workflow.requiredSkills.map((skill, index) => ({
      skill,
      preferenceIndex: index,
    })),
    workflowDefinition: options.workflow.input,
    workflowProtocol: options.workflow.protocol,
    skillCreator: {
      intent:
        options.workflow.protocol.kind === 'comet-five-phase-overlay'
          ? 'customize-comet'
          : 'new-skill',
    },
    resolvedSkills: [],
    deviations: [],
    engineMode: options.engineMode ?? 'deterministic',
  };
}

function customWorkflow(name: string): WorkflowDefinitionInput {
  return {
    kind: 'workflow-kernel',
    name,
    goal: 'Create a research and writing workflow.',
    customNodes: [
      {
        id: 'research',
        label: 'Research',
        kind: 'producer',
        responsibility: 'Collect research notes for the writing workflow.',
        implementation: { skill: 'research-skill', operation: 'default', scope: 'main' },
        operations: ['require', 'augment', 'override'],
        outputSchemas: ['research.notes.v1'],
        guardrails: [{ id: 'notes', label: 'Research notes exist', validation: 'artifact-exists' }],
      },
    ],
    outputSchemas: [
      {
        id: 'research.notes.v1',
        description: 'Research notes.',
        artifacts: [
          {
            id: 'notes',
            kind: 'file',
            required: true,
            paths: ['notes/*.md'],
            validations: ['artifact-exists'],
          },
        ],
        evidence: [{ id: 'summary', required: true }],
      },
    ],
  };
}

describe('Factory skill package generation', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-package-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('classifies scaffolded overlay packages when the Decision Core is not authored', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'scaffolded-comet',
        goal: 'Route Comet through generated workflow wrappers.',
      }),
    );

    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'scaffolded-comet', workflow }),
    );
    const compositionReport = await fs.readFile(
      path.join(output.packageRoot, 'reference', 'composition-report.md'),
      'utf8',
    );
    const decisionPoints = await fs.readFile(
      path.join(output.packageRoot, 'reference', 'decision-points.md'),
      'utf8',
    );

    expect(output.wrapperClassification).toBe('scaffold-blocked');
    expect(compositionReport).toContain('Wrapper classification: scaffold-blocked');
    expect(decisionPoints).toContain('No decision points have been authored');
    expect(decisionPoints).toContain('pause only when at least two valid choices');
    expect(decisionPoints).not.toContain('confirm Output Schemas');
  });

  it('generates Claude Code custom agent definitions separately from portable role briefs', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'agent-ready',
        goal: 'Generate native authoring agents.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'agent-ready', workflow }),
    );

    const agentPath = path.join(
      output.packageRoot,
      'agents',
      'claude',
      'comet-any-script-author.md',
    );
    const agent = await fs.readFile(agentPath, 'utf8');
    expect(agent).toContain('---\nname: comet-any-script-author');
    expect(agent).toContain('description: Use when authoring workflow script contracts');
    expect(agent).toContain('tools: Read, Write, Glob, Grep');
    expect(agent).toContain('model: inherit');
    expect(agent).toContain('# Script Author Agent');

    const lanes = JSON.parse(
      await fs.readFile(path.join(output.packageRoot, 'reference', 'authoring-lanes.json'), 'utf8'),
    ) as { lanes: unknown[] };
    expect(JSON.stringify(lanes)).toContain('platform-agent');

    await expect(
      fs.access(path.join(output.packageRoot, 'reference', 'subagents', 'script-author.md')),
    ).resolves.toBeUndefined();
    expect(agentPath).not.toContain(path.join('reference', 'subagents'));
  });

  it('generates workflow contract packages from Nodes and Output Schemas', async () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'team-comet',
        goal: 'Require component and review Skills in the Comet workflow.',
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
        review: {
          requiredSkillCalls: [{ skill: 'whitebox-code-standard', scope: 'review' }],
        },
      },
    });

    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'team-comet', workflow }),
    );

    const entry = await fs.readFile(output.skillPath, 'utf8');
    const protocol = JSON.parse(
      await fs.readFile(
        path.join(output.packageRoot, 'reference', 'workflow-protocol.json'),
        'utf8',
      ),
    ) as {
      kind: string;
      nodes: Array<{ id: string; requiredSkillCalls?: Array<{ skill: string }> }>;
    };
    const skillYaml = parse(
      await fs.readFile(path.join(output.packageRoot, 'comet', 'skill.yaml'), 'utf8'),
    ) as { orchestration?: { steps?: Array<{ action?: { ref?: string } }> } };

    expect(protocol.kind).toBe('comet-five-phase-overlay');
    expect(protocol.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['execute', 'subagent-execute', 'review']),
    );
    expect(protocol.nodes.find((node) => node.id === 'execute')).toMatchObject({
      requiredSkillCalls: [expect.objectContaining({ skill: 'elementui' })],
    });
    expect(entry).toContain('## Workflow Nodes');
    expect(entry).toContain('Output Schemas');
    expect(entry).not.toContain('workflow-state.mjs init');
    expect(entry).toContain('/comet-open');
    expect(frontmatterDescription(entry)).toContain('team-comet managed workflow');
    expect(frontmatterDescription(entry)).toContain('Route through this entry Skill');
    const openNode = await fs.readFile(
      path.join(output.packageRoot, '..', 'team-comet-open', 'SKILL.md'),
      'utf8',
    );
    expect(frontmatterDescription(openNode)).toContain(
      'Use only when explicitly invoked as /team-comet-open or routed by the team-comet entry/runtime',
    );
    expect(frontmatterDescription(openNode)).toContain(
      'Do not use for ordinary standalone tasks or as the workflow entry',
    );
    expect(skillYaml.orchestration?.steps?.[0]?.action?.ref).toBe('team-comet-open');

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workflow-contract-run-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    const hookGuardScript = path.join(output.packageRoot, 'scripts', 'comet-hook-guard.mjs');
    try {
      await expect(
        execFileAsync(process.execPath, [hookGuardScript, 'before_write'], { env }),
      ).rejects.toThrow(/No active Comet change/iu);

      await expect(execFileAsync(process.execPath, [stateScript, 'init'], { env })).rejects.toThrow(
        /\/comet-open|active Comet change/iu,
      );
      await expect(
        fs.access(path.join(runRoot, '.comet', 'runs', 'team-comet', 'state.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      const blockedStatus = await execFileAsync(process.execPath, [stateScript, 'status'], { env });
      expect(JSON.parse(blockedStatus.stdout)).toMatchObject({
        status: 'blocked',
        reason: expect.stringContaining('No active Comet change'),
      });

      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'contract-test');
      await fs.mkdir(path.join(changeRoot, 'specs', 'demo'), { recursive: true });
      await fs.mkdir(path.join(runRoot, 'docs', 'superpowers', 'specs'), { recursive: true });
      await fs.mkdir(path.join(runRoot, 'docs', 'superpowers', 'plans'), { recursive: true });
      await fs.writeFile(path.join(changeRoot, '.comet.yaml'), 'phase: open\n', 'utf8');
      await fs.writeFile(
        path.join(changeRoot, 'specs', 'demo', 'spec.md'),
        '# Demo Spec\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(runRoot, 'docs', 'superpowers', 'specs', 'design.md'),
        '# Design\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(runRoot, 'docs', 'superpowers', 'plans', 'plan.md'),
        '# Plan\n',
        'utf8',
      );
      await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [x] Done\n', 'utf8');

      const hook = await execFileAsync(process.execPath, [hookGuardScript, 'before_write'], {
        env,
      });
      expect(hook.stdout).toContain('workflow-hook-guard-ok');

      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'open', '--apply'], { env }),
      ).rejects.toThrow(/missing evidence/iu);

      const nodeEvidence: Record<string, string> = {
        open: '{"intake-summary":"done"}',
        design: '{"design-summary":"done","user-confirmation":"yes"}',
        plan: '{"producer-summary":"done"}',
      };
      for (const node of ['open', 'design', 'plan']) {
        await execFileAsync(process.execPath, [stateScript, 'record', node, nodeEvidence[node]!], {
          env,
        });
        const exit = await execFileAsync(process.execPath, [guardScript, 'exit', node, '--apply'], {
          env,
        });
        expect(exit.stdout).toContain('ALL CHECKS PASSED');
      }

      await execFileAsync(
        process.execPath,
        [
          stateScript,
          'record',
          'execute',
          '{"implementation-summary":"done","test-evidence":"done"}',
        ],
        { env },
      );
      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'execute', '--apply'], { env }),
      ).rejects.toThrow(/required Skill evidence/iu);

      await execFileAsync(
        process.execPath,
        [
          stateScript,
          'record',
          'execute',
          '{"implementation-summary":"done","test-evidence":"done","completedChecks":["required-skill:execute.elementui"]}',
        ],
        { env },
      );
      const executeExit = await execFileAsync(
        process.execPath,
        [guardScript, 'exit', 'execute', '--apply'],
        { env },
      );
      expect(executeExit.stdout).toContain('COMET STATE: unchanged');
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('uses .comet.yaml for comet-five-phase-overlay state routing and sidecar evidence', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'overlay-state',
        goal: 'Route from the active Comet change state.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'overlay-state', workflow }),
    );

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-overlay-state-run-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    try {
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'stateful-change');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(
        path.join(changeRoot, '.comet.yaml'),
        'phase: build\nbuild_pause: plan-ready\nreview_mode: standard\n',
        'utf8',
      );

      const next = await execFileAsync(process.execPath, [stateScript, 'next'], { env });
      expect(next.stdout).toContain('NODE: plan');

      const record = await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'plan', '{"producer-summary":"done"}'],
        { env },
      );
      expect(record.stdout).toContain('EVIDENCE: plan');
      await expect(
        fs.access(path.join(runRoot, '.comet', 'runs', 'overlay-state', 'state.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        fs.access(
          path.join(
            runRoot,
            '.comet',
            'workflow-evidence',
            'stateful-change',
            'overlay-state.json',
          ),
        ),
      ).resolves.toBeUndefined();
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }

    async function createOverlayRun(changeName: string, stateYaml: string, evidence?: unknown) {
      const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-overlay-state-case-'));
      const caseEnv = { ...process.env, COMET_RUN_ROOT: caseRoot };
      const caseChangeRoot = path.join(caseRoot, 'openspec', 'changes', changeName);
      await fs.mkdir(caseChangeRoot, { recursive: true });
      await fs.writeFile(path.join(caseChangeRoot, '.comet.yaml'), stateYaml, 'utf8');
      if (evidence !== undefined) {
        const evidencePath = path.join(
          caseRoot,
          '.comet',
          'workflow-evidence',
          changeName,
          'overlay-state.json',
        );
        await fs.mkdir(path.dirname(evidencePath), { recursive: true });
        await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      }
      return { caseRoot, caseEnv };
    }

    async function expectOverlayNode(
      stateYaml: string,
      expectedNode: string,
      blockedNode?: string,
      evidence?: unknown,
    ) {
      const { caseRoot, caseEnv } = await createOverlayRun(
        `${expectedNode}-routing`,
        stateYaml,
        evidence,
      );
      try {
        const next = await execFileAsync(process.execPath, [stateScript, 'next'], {
          env: caseEnv,
        });
        expect(next.stdout).toContain(`NODE: ${expectedNode}`);

        const entry = await execFileAsync(process.execPath, [guardScript, 'entry', expectedNode], {
          env: caseEnv,
        });
        expect(entry.stdout).toContain(`ENTRY OK: ${expectedNode}`);

        if (blockedNode) {
          await expect(
            execFileAsync(process.execPath, [guardScript, 'entry', blockedNode], {
              env: caseEnv,
            }),
          ).rejects.toThrow(new RegExp(`current Node is ${expectedNode}`, 'u'));
        }
      } finally {
        await fs.rm(caseRoot, { recursive: true, force: true });
      }
    }

    await expectOverlayNode('phase: build\nplan: null\nreview_mode: standard\n', 'plan', 'review');
    await expectOverlayNode(
      'phase: build\nplan: docs/superpowers/plans/demo.md\nbuild_mode: executing-plans\nreview_mode: standard\n',
      'execute',
      'review',
    );
    await expectOverlayNode(
      'phase: build\nplan: docs/superpowers/plans/demo.md\nbuild_mode: subagent-driven-development\nsubagent_dispatch: confirmed\nreview_mode: standard\n',
      'subagent-execute',
    );
    await expectOverlayNode(
      'phase: build\nplan: docs/superpowers/plans/demo.md\nbuild_mode: executing-plans\nreview_mode: standard\n',
      'review',
      undefined,
      {
        execute: {
          'implementation-summary': 'done',
          'test-evidence': 'done',
        },
      },
    );
    await expectOverlayNode(
      'phase: build\nplan: docs/superpowers/plans/demo.md\nbuild_mode: subagent-driven-development\nsubagent_dispatch: confirmed\nreview_mode: standard\n',
      'review',
      undefined,
      {
        'subagent-execute': {
          'handoff-request': 'done',
          'handoff-result': 'done',
        },
      },
    );
    await expectOverlayNode(
      'phase: build\nplan: docs/superpowers/plans/demo.md\nbuild_mode: executing-plans\nreview_mode: off\n',
      'execute',
      'review',
      {
        execute: {
          'implementation-summary': 'done',
          'test-evidence': 'done',
        },
      },
    );
  });

  it('renders augmentations into entry, node, and handoff outputs', async () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'augmented-comet',
        goal: 'Use grill-me as an enforced review augmentation.',
      }),
      nodes: {
        verify: {
          augmentations: [
            {
              skill: 'grill-me',
              scope: 'review',
              reason: 'Stress-test verification evidence.',
              enforcement: 'guarded',
            },
          ],
        },
      },
    });
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'augmented-comet', workflow }),
    );

    const entry = await fs.readFile(output.skillPath, 'utf8');
    const verifySkill = await fs.readFile(
      path.join(output.packageRoot, '..', 'augmented-comet-verify', 'SKILL.md'),
      'utf8',
    );
    const handoff = await execFileAsync(
      process.execPath,
      [path.join(output.packageRoot, 'scripts', 'workflow-handoff.mjs')],
      { env: { ...process.env, COMET_RUN_ROOT: root } },
    );

    expect(entry).toContain('Augmentations: `grill-me`');
    expect(entry).toContain('guarded');
    expect(verifySkill).toContain('## Augmentations');
    expect(verifySkill).toContain('augmentation:verify.grill-me');
    expect(handoff.stdout).toContain('"augmentations"');
    expect(handoff.stdout).toContain('"grill-me"');

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-augmentation-run-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    try {
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'augmentation-test');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(
        path.join(changeRoot, '.comet.yaml'),
        'phase: verify\nreview_mode: off\n',
        'utf8',
      );
      await execFileAsync(
        process.execPath,
        [
          stateScript,
          'record',
          'verify',
          '{"verification-commands":"npx vitest","verification-result":"pass"}',
        ],
        { env },
      );
      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'verify', '--apply'], { env }),
      ).rejects.toThrow(/missing augmentation evidence/iu);

      await execFileAsync(
        process.execPath,
        [
          stateScript,
          'record',
          'verify',
          '{"verification-commands":"npx vitest","verification-result":"pass","completedChecks":["augmentation:verify.grill-me"]}',
        ],
        { env },
      );
      const exit = await execFileAsync(
        process.execPath,
        [guardScript, 'exit', 'verify', '--apply'],
        { env },
      );
      expect(exit.stdout).toContain('ALL CHECKS PASSED');
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('writes overlay eval manifests with task suite, baselines, gates, and evidence requirements', async () => {
    const workflow = normalizeWorkflowDefinition({
      ...builtinCometFivePhaseWorkflow({
        name: 'evaluable-comet',
        goal: 'Evaluate a generated Comet overlay workflow contract.',
      }),
      nodes: {
        design: {
          augmentations: [
            {
              skill: 'grill-me',
              scope: 'review',
              reason: 'Stress-test the design before implementation.',
              enforcement: 'guarded',
            },
          ],
          outputSchemas: ['comet.grill-me.v1'],
        },
        review: {
          disabled: true,
          requiredSkillCalls: [
            {
              skill: 'disabled-review-required',
              reason: 'This disabled Node must not leak into eval evidence.',
            },
          ],
          augmentations: [
            {
              skill: 'disabled-review-augment',
              reason: 'This disabled augmentation must not leak into eval evidence.',
              enforcement: 'guarded',
            },
          ],
          outputSchemas: ['disabled.review.v1'],
        },
      },
      outputSchemas: [
        {
          id: 'comet.grill-me.v1',
          description: 'Grill-me review evidence.',
          artifacts: [],
          evidence: [{ id: 'challenge-summary', required: true }],
        },
        {
          id: 'disabled.review.v1',
          description: 'Disabled review evidence.',
          artifacts: [
            {
              id: 'disabled-review-report',
              kind: 'file',
              required: true,
              paths: ['disabled-review.md'],
              validations: ['artifact-exists'],
            },
          ],
          evidence: [{ id: 'disabled-summary', required: true }],
        },
      ],
    });
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'evaluable-comet', workflow }),
    );

    const evalManifest = parse(
      await fs.readFile(path.join(output.packageRoot, 'comet', 'eval.yaml'), 'utf8'),
    ) as {
      metadata?: { draftHash?: string };
      evaluation?: {
        recommendedTasks?: string[];
        baselineTreatments?: string[];
        qualityGates?: Record<string, number>;
        requiredOutputSchemas?: string[];
        expectedEvidence?: Array<{
          node?: string;
          check?: string;
          schema?: string;
          evidence?: string;
          enforcement?: string;
        }>;
        expectedArtifacts?: Array<{ node?: string; schema?: string; artifact?: string }>;
      };
    };

    expect(evalManifest.evaluation?.recommendedTasks).toEqual(
      expect.arrayContaining([
        'workflow-overlay-contract',
        'comet-full-workflow',
        'comet-fix-median',
      ]),
    );
    expect(evalManifest.evaluation?.baselineTreatments).toEqual(['CONTROL', 'COMET_FULL_040_BETA']);
    expect(evalManifest.evaluation?.qualityGates).toEqual({
      minWeightedScore: 0.8,
      minPassAt1: 0.6,
      maxInstabilityGap: 0.4,
    });
    expect(evalManifest.evaluation?.requiredOutputSchemas).toContain('comet.grill-me.v1');
    expect(evalManifest.evaluation?.requiredOutputSchemas).not.toContain('comet.review.v1');
    expect(evalManifest.evaluation?.requiredOutputSchemas).not.toContain('disabled.review.v1');
    expect(evalManifest.evaluation?.expectedEvidence).toContainEqual({
      node: 'design',
      check: 'augmentation:design.grill-me',
      enforcement: 'guarded',
    });
    expect(evalManifest.evaluation?.expectedEvidence).toContainEqual({
      node: 'design',
      check: 'output-schema:design.comet.grill-me.v1.challenge-summary',
      schema: 'comet.grill-me.v1',
      evidence: 'challenge-summary',
    });
    expect(evalManifest.evaluation?.expectedEvidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: 'review' }),
        expect.objectContaining({ check: 'required-skill:review.disabled-review-required' }),
        expect.objectContaining({ check: 'augmentation:review.disabled-review-augment' }),
        expect.objectContaining({
          check: 'output-schema:review.disabled.review.v1.disabled-summary',
        }),
      ]),
    );
    expect(evalManifest.evaluation?.expectedArtifacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: 'review' }),
        expect.objectContaining({ schema: 'disabled.review.v1' }),
        expect.objectContaining({ artifact: 'disabled-review-report' }),
      ]),
    );
    expect(evalManifest.metadata?.draftHash).toBe('<current-bundle-hash>');
  });

  it('does not generate engine manifests when engine mode is none', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('plain-workflow'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'plain-workflow', workflow, engineMode: 'none' }),
    );
    const entry = await fs.readFile(output.skillPath, 'utf8');

    expect(entry).toContain('workflow-state.mjs init');
    expect(output.enginePath).toBeNull();
    expect(output.evalManifestPath).toBeNull();
    await expect(
      fs.access(path.join(output.packageRoot, 'comet', 'skill.yaml')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(output.packageRoot, 'reference', 'workflow-protocol.json')),
    ).resolves.toBeUndefined();
  });

  it('rejects package generation without a workflow contract', async () => {
    await expect(
      generateFactorySkillPackage({
        root,
        name: 'legacy-package',
        version: '1.0.0',
        description: 'Legacy package.',
        goal: 'Generate without a workflow.',
        defaultLocale: 'zh',
        callChain: [{ skill: 'research-skill', preferenceIndex: 0 }],
        resolvedSkills: [],
        deviations: [],
        engineMode: 'deterministic',
      }),
    ).rejects.toThrow(/workflowProtocol is required/iu);
  });
});
