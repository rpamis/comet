import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { parse } from 'yaml';
import { generateFactorySkillPackage } from '../../../domains/factory/package.js';
import { collectStandaloneTasks, resolveEvalContext } from '../../../domains/eval/index.js';
import type {
  FactoryResolvedSkill,
  FactorySkillPackagePlan,
} from '../../../domains/factory/types.js';
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

async function writeGeneratedProtocol(
  packageRoot: string,
  update: (protocol: {
    state: { statePath: string };
    outputSchemas: Array<{
      artifacts: Array<{ pathBase?: string; paths: string[] }>;
    }>;
  }) => void,
): Promise<void> {
  const protocolPath = path.join(packageRoot, 'reference', 'workflow-protocol.json');
  const protocol = JSON.parse(await fs.readFile(protocolPath, 'utf8')) as {
    state: { statePath: string };
    outputSchemas: Array<{
      artifacts: Array<{ pathBase?: string; paths: string[] }>;
    }>;
  };
  update(protocol);
  await fs.writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`, 'utf8');
}

async function writeClassicProjectConfig(
  projectRoot: string,
  layout: 'legacy' | 'docs' = 'legacy',
): Promise<void> {
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      `  artifact_layout: ${layout}`,
      '  language: en',
      '',
    ].join('\n'),
    'utf8',
  );
}

type GeneratedRaceMode =
  | 'file-after-realpath'
  | 'parent-after-realpath'
  | 'parent-after-missing-lstat'
  | 'parent-after-read';

async function writeGeneratedRacePreload(
  directory: string,
  options: {
    mode: GeneratedRaceMode;
    target: string;
    outsideFile?: string;
    outsideDirectory?: string;
  },
): Promise<{ preloadPath: string; accessLog: string }> {
  const preloadPath = path.join(directory, `factory-race-${options.mode}.mjs`);
  const accessLog = path.join(directory, `factory-race-${options.mode}.log`);
  const target = path.resolve(options.target);
  const parent = path.dirname(target);
  const held =
    options.mode === 'file-after-realpath'
      ? `${target}.held`
      : path.join(path.dirname(parent), `${path.basename(parent)}.held`);
  await fs.writeFile(
    preloadPath,
    `
import { promises as fs } from 'fs';
import path from 'path';

const mode = ${JSON.stringify(options.mode)};
const target = ${JSON.stringify(target)};
const parent = ${JSON.stringify(parent)};
const held = ${JSON.stringify(held)};
const outsideFile = ${JSON.stringify(options.outsideFile ?? '')};
const outsideDirectory = ${JSON.stringify(options.outsideDirectory ?? '')};
const accessLog = ${JSON.stringify(accessLog)};
const originalLstat = fs.lstat.bind(fs);
const originalRealpath = fs.realpath.bind(fs);
const originalReadFile = fs.readFile.bind(fs);
const originalOpen = fs.open.bind(fs);
const originalWriteFile = fs.writeFile.bind(fs);
const originalMkdir = fs.mkdir.bind(fs);
const originalRename = fs.rename.bind(fs);
const originalSymlink = fs.symlink.bind(fs);
const originalAppendFile = fs.appendFile.bind(fs);
let triggered = false;

function isTarget(candidate) {
  return path.resolve(String(candidate)) === target;
}

async function recordAccess(kind) {
  await originalAppendFile(accessLog, kind + '\\n', 'utf8');
}

async function replaceFile() {
  if (triggered) return;
  triggered = true;
  await originalRename(target, held);
  await originalSymlink(outsideFile, target, 'file');
}

async function replaceParent() {
  if (triggered) return;
  triggered = true;
  await originalRename(parent, held);
  await originalSymlink(
    outsideDirectory,
    parent,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

async function resolvesInsideOutside(candidate) {
  if (!outsideDirectory) return false;
  let resolved;
  try {
    resolved = await originalRealpath(candidate);
  } catch {
    try {
      const resolvedParent = await originalRealpath(path.dirname(String(candidate)));
      resolved = path.join(resolvedParent, path.basename(String(candidate)));
    } catch {
      return false;
    }
  }
  const relative = path.relative(outsideDirectory, resolved);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith('..' + path.sep))
  );
}

fs.realpath = async (candidate, ...rest) => {
  const resolved = await originalRealpath(candidate, ...rest);
  if (mode === 'file-after-realpath' && isTarget(candidate)) {
    await replaceFile();
  } else if (mode === 'parent-after-realpath' && isTarget(candidate)) {
    await replaceParent();
  }
  return resolved;
};

fs.lstat = async (candidate, ...rest) => {
  try {
    return await originalLstat(candidate, ...rest);
  } catch (error) {
    if (
      mode === 'parent-after-missing-lstat' &&
      isTarget(candidate) &&
      error &&
      typeof error === 'object' &&
      error.code === 'ENOENT'
    ) {
      await replaceParent();
    }
    throw error;
  }
};

fs.readFile = async (candidate, ...rest) => {
  if (triggered && isTarget(candidate)) {
    await recordAccess('readFile');
  }
  const result = await originalReadFile(candidate, ...rest);
  if (mode === 'parent-after-read' && isTarget(candidate)) {
    await replaceParent();
  }
  return result;
};

fs.open = async (candidate, ...rest) => {
  if (triggered && (isTarget(candidate) || (await resolvesInsideOutside(candidate)))) {
    await recordAccess('open');
  }
  const handle = await originalOpen(candidate, ...rest);
  if (mode === 'parent-after-read' && isTarget(candidate)) {
    const originalClose = handle.close.bind(handle);
    handle.close = async () => {
      const result = await originalClose();
      await replaceParent();
      return result;
    };
  }
  return handle;
};

fs.writeFile = async (candidate, ...rest) => {
  if (triggered && (isTarget(candidate) || (await resolvesInsideOutside(candidate)))) {
    await recordAccess('writeFile');
  }
  return originalWriteFile(candidate, ...rest);
};

fs.mkdir = async (candidate, ...rest) => {
  if (triggered && (isTarget(candidate) || (await resolvesInsideOutside(candidate)))) {
    await recordAccess('mkdir');
  }
  return originalMkdir(candidate, ...rest);
};
`,
    'utf8',
  );
  return { preloadPath, accessLog };
}

function envWithGeneratedRacePreload(runRoot: string, preloadPath: string): NodeJS.ProcessEnv {
  const nodeOptions = [process.env.NODE_OPTIONS, `--import=${pathToFileURL(preloadPath).href}`]
    .filter(Boolean)
    .join(' ');
  return { ...process.env, COMET_RUN_ROOT: runRoot, NODE_OPTIONS: nodeOptions };
}

async function canCreateGeneratedRaceLink(
  projectRoot: string,
  target: string,
  kind: 'file' | 'directory',
): Promise<boolean> {
  const probe = path.join(projectRoot, `factory-link-probe-${kind}`);
  try {
    await fs.symlink(
      target,
      probe,
      kind === 'file' ? 'file' : process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.rm(probe, { force: true });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

describe('Factory skill package generation', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-package-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips its generated eval manifest through static collection and Python loading', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('eval-roundtrip'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'eval-roundtrip', workflow }),
    );
    const manifest = path.join(output.packageRoot, 'comet', 'eval.yaml');
    const context = await resolveEvalContext({ manifest, project: root });

    await expect(collectStandaloneTasks({}, context, path.resolve('.'))).resolves.toContain(
      'Tasks: recommended',
    );
    await expect(
      execFileAsync(
        'uv',
        [
          'run',
          'python',
          '-c',
          'from pathlib import Path; from scaffold.python.manifests import load_eval_manifest; load_eval_manifest(Path(__import__("sys").argv[1]))',
          manifest,
        ],
        { cwd: path.resolve('eval') },
      ),
    ).resolves.toBeDefined();
    const content = await fs.readFile(manifest, 'utf8');
    expect(content).toContain('expectedArtifacts:');
    expect(content).toContain('artifact: notes');
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

  it('keeps authoring subagent guidance portable instead of declaring a runtime-specific agent', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'agent-ready',
        goal: 'Generate portable authoring guidance.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'agent-ready', workflow }),
    );

    await expect(
      fs.access(path.join(output.packageRoot, 'agents', 'claude', 'comet-any-script-author.md')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(output.platformAgents).toEqual([]);

    const lanes = JSON.parse(
      await fs.readFile(path.join(output.packageRoot, 'reference', 'authoring-lanes.json'), 'utf8'),
    ) as { lanes: Array<{ lane?: string }> };
    expect(lanes.lanes.map((lane) => lane.lane)).toEqual([
      'script',
      'reference',
      'pause-points',
      'workflow-entry',
      'skill-core',
      'skill-review',
    ]);

    await expect(
      fs.access(path.join(output.packageRoot, 'reference', 'subagents', 'script-author.md')),
    ).resolves.toBeUndefined();
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
    expect(entry).toContain('permanent `/comet-classic` entry');
    expect(entry).not.toContain('original `/comet` entry');
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
      await writeClassicProjectConfig(runRoot);
      await fs.mkdir(path.join(runRoot, 'openspec'), { recursive: true });
      await expect(
        execFileAsync(process.execPath, [hookGuardScript, 'before_write'], { env }),
      ).rejects.toThrow(/permanent \/comet-classic entry/iu);

      await expect(execFileAsync(process.execPath, [stateScript, 'init'], { env })).rejects.toThrow(
        /permanent \/comet-classic entry/iu,
      );
      await expect(
        fs.access(path.join(runRoot, '.comet', 'runs', 'team-comet', 'state.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      const blockedStatus = await execFileAsync(process.execPath, [stateScript, 'status'], { env });
      expect(JSON.parse(blockedStatus.stdout)).toMatchObject({
        status: 'blocked',
        reason: expect.stringContaining('/comet-classic'),
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

  it('rejects a generated overlay evidence directory junction before reading or writing outside', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'evidence-boundary',
        goal: 'Keep generated evidence inside the project.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'evidence-boundary', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-evidence-boundary-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-evidence-outside-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await writeClassicProjectConfig(runRoot);
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'demo');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(path.join(changeRoot, '.comet.yaml'), 'phase: open\n', 'utf8');
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(runRoot, '.comet', 'workflow-evidence'),
          'junction',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        execFileAsync(
          process.execPath,
          [
            path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'),
            'record',
            'open',
            '{"intake-summary":"done"}',
          ],
          { env },
        ),
      ).rejects.toThrow(/symbolic link or junction/iu);
      await expect(
        fs.access(path.join(outsideRoot, 'demo', 'evidence-boundary.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a generated overlay active-state file symlink before reading it', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'state-boundary',
        goal: 'Read only a real active Classic state file.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'state-boundary', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-state-boundary-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-state-outside-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await writeClassicProjectConfig(runRoot);
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'demo');
      await fs.mkdir(changeRoot, { recursive: true });
      const outsideState = path.join(outsideRoot, 'state.yaml');
      await fs.writeFile(outsideState, 'phase: open\n', 'utf8');
      try {
        await fs.symlink(outsideState, path.join(changeRoot, '.comet.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'next'],
          { env },
        ),
      ).rejects.toThrow(/symbolic link or junction/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['state', 'file symlink', 'workflow-state.mjs', ['status'], 'file-after-realpath'],
    ['hook', 'file symlink', 'comet-hook-guard.mjs', ['before_tool'], 'file-after-realpath'],
    ['guard', 'file symlink', 'workflow-guard.mjs', ['entry', 'research'], 'file-after-realpath'],
    ['state', 'parent junction', 'workflow-state.mjs', ['status'], 'parent-after-realpath'],
    ['hook', 'parent junction', 'comet-hook-guard.mjs', ['before_tool'], 'parent-after-realpath'],
    [
      'guard',
      'parent junction',
      'workflow-guard.mjs',
      ['entry', 'research'],
      'parent-after-realpath',
    ],
  ])(
    'rejects a generated generic %s state %s replacement after inspection',
    async (_label, replacement, scriptName, args, mode) => {
      const name = `generic-read-${scriptName.replace(/[^a-z]+/gu, '-')}`;
      const workflow = normalizeWorkflowDefinition(customWorkflow(name));
      const output = await generateFactorySkillPackage(packagePlan({ root, name, workflow }));
      const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-read-race-'));
      const outsideRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'comet-factory-read-race-outside-'),
      );
      const statePath = path.join(runRoot, '.comet', 'runs', name, 'state.json');
      const outsideState = path.join(outsideRoot, 'state.json');
      try {
        await execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'init'],
          { env: { ...process.env, COMET_RUN_ROOT: runRoot } },
        );
        await fs.writeFile(
          outsideState,
          `${JSON.stringify({
            schemaVersion: 1,
            workflow: name,
            status: 'running',
            currentNode: 'research',
            completedNodes: [],
            evidence: {},
            history: [],
            outsideSecret: 'must-not-be-read',
          })}\n`,
          'utf8',
        );
        if (
          !(await canCreateGeneratedRaceLink(
            runRoot,
            replacement === 'file symlink' ? outsideState : outsideRoot,
            replacement === 'file symlink' ? 'file' : 'directory',
          ))
        ) {
          return;
        }
        const { preloadPath, accessLog } = await writeGeneratedRacePreload(runRoot, {
          mode: mode as GeneratedRaceMode,
          target: statePath,
          outsideFile: outsideState,
          outsideDirectory: outsideRoot,
        });

        await expect(
          execFileAsync(
            process.execPath,
            [path.join(output.packageRoot, 'scripts', scriptName), ...args],
            { env: envWithGeneratedRacePreload(runRoot, preloadPath) },
          ),
        ).rejects.toThrow(/symbolic link|real file|changed while opening/iu);
        await expect(fs.access(accessLog)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.readFile(outsideState, 'utf8')).resolves.toContain('must-not-be-read');
      } finally {
        await fs.rm(runRoot, { recursive: true, force: true });
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('rejects a generic state parent replaced by an external junction after statePath inspection', async () => {
    const name = 'generic-init-parent-race';
    const workflow = normalizeWorkflowDefinition(customWorkflow(name));
    const output = await generateFactorySkillPackage(packagePlan({ root, name, workflow }));
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-init-race-'));
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'comet-factory-init-race-outside-'),
    );
    const statePath = path.join(runRoot, '.comet', 'runs', name, 'state.json');
    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      if (!(await canCreateGeneratedRaceLink(runRoot, outsideRoot, 'directory'))) return;
      const { preloadPath, accessLog } = await writeGeneratedRacePreload(runRoot, {
        mode: 'parent-after-missing-lstat',
        target: statePath,
        outsideDirectory: outsideRoot,
      });

      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'init'],
          { env: envWithGeneratedRacePreload(runRoot, preloadPath) },
        ),
      ).rejects.toThrow(/symbolic link|junction|outside|changed/iu);
      await expect(fs.access(path.join(outsideRoot, 'state.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.access(accessLog)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readdir(outsideRoot)).resolves.toEqual([]);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['state record', 'workflow-state.mjs', ['record', 'research', '{"summary":"done"}']],
    ['guard apply', 'workflow-guard.mjs', ['exit', 'research', '--apply']],
  ])(
    'rejects an external parent replacement after a generated generic %s read',
    async (_label, scriptName, args) => {
      const name = `generic-write-${scriptName.replace(/[^a-z]+/gu, '-')}`;
      const workflow = normalizeWorkflowDefinition(customWorkflow(name));
      const output = await generateFactorySkillPackage(packagePlan({ root, name, workflow }));
      const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-factory-write-race-'));
      const outsideRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'comet-factory-write-race-outside-'),
      );
      const statePath = path.join(runRoot, '.comet', 'runs', name, 'state.json');
      const normalEnv = { ...process.env, COMET_RUN_ROOT: runRoot };
      try {
        const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
        await execFileAsync(process.execPath, [stateScript, 'init'], { env: normalEnv });
        if (scriptName === 'workflow-guard.mjs') {
          await execFileAsync(
            process.execPath,
            [stateScript, 'record', 'research', '{"summary":"done"}'],
            { env: normalEnv },
          );
          await fs.mkdir(path.join(runRoot, 'notes'), { recursive: true });
          await fs.writeFile(path.join(runRoot, 'notes', 'research.md'), '# Done\n', 'utf8');
        }
        if (!(await canCreateGeneratedRaceLink(runRoot, outsideRoot, 'directory'))) return;
        const { preloadPath, accessLog } = await writeGeneratedRacePreload(runRoot, {
          mode: 'parent-after-read',
          target: statePath,
          outsideDirectory: outsideRoot,
        });

        await expect(
          execFileAsync(
            process.execPath,
            [path.join(output.packageRoot, 'scripts', scriptName), ...args],
            { env: envWithGeneratedRacePreload(runRoot, preloadPath) },
          ),
        ).rejects.toThrow(/symbolic link|junction|outside|changed/iu);
        await expect(fs.access(path.join(outsideRoot, 'state.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(fs.access(accessLog)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.readdir(outsideRoot)).resolves.toEqual([]);
      } finally {
        await fs.rm(runRoot, { recursive: true, force: true });
        await fs.rm(outsideRoot, { recursive: true, force: true });
      }
    },
  );

  it('rejects an overlay evidence parent replaced by an external junction after inspection', async () => {
    const name = 'overlay-evidence-parent-race';
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name,
        goal: 'Keep overlay evidence writes inside the project.',
      }),
    );
    const output = await generateFactorySkillPackage(packagePlan({ root, name, workflow }));
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-overlay-evidence-race-'));
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'comet-overlay-evidence-race-outside-'),
    );
    const evidencePath = path.join(runRoot, '.comet', 'workflow-evidence', 'demo', `${name}.json`);
    try {
      await writeClassicProjectConfig(runRoot);
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'demo');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(path.join(changeRoot, '.comet.yaml'), 'phase: open\n', 'utf8');
      if (!(await canCreateGeneratedRaceLink(runRoot, outsideRoot, 'directory'))) return;
      const { preloadPath, accessLog } = await writeGeneratedRacePreload(runRoot, {
        mode: 'parent-after-missing-lstat',
        target: evidencePath,
        outsideDirectory: outsideRoot,
      });

      await expect(
        execFileAsync(
          process.execPath,
          [
            path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'),
            'record',
            'open',
            '{"intake-summary":"done"}',
          ],
          { env: envWithGeneratedRacePreload(runRoot, preloadPath) },
        ),
      ).rejects.toThrow(/symbolic link|junction|outside|changed/iu);
      await expect(fs.access(path.join(outsideRoot, `${name}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(fs.access(accessLog)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.readdir(outsideRoot)).resolves.toEqual([]);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['a missing project config', null],
    [
      'a Native-only project config',
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native]',
        'native:',
        '  artifact_root: docs',
        '',
      ].join('\n'),
    ],
  ])('does not scan legacy OpenSpec state for %s', async (_label, configSource) => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'classic-ownership-boundary',
        goal: 'Require explicit Classic workflow ownership.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'classic-ownership-boundary', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-ownership-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      const legacyChange = path.join(runRoot, 'openspec', 'changes', 'must-not-be-scanned');
      await fs.mkdir(legacyChange, { recursive: true });
      await fs.writeFile(path.join(legacyChange, '.comet.yaml'), 'phase: open\n', 'utf8');
      if (configSource !== null) {
        await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
        await fs.writeFile(path.join(runRoot, '.comet', 'config.yaml'), configSource, 'utf8');
      }

      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'next'],
          { env },
        ),
      ).rejects.toThrow(/Classic workflow is not enabled by \.comet\/config\.yaml/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('rejects a configured Classic docs root that does not exist', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'classic-missing-root',
        goal: 'Require the configured Classic catalogue to exist.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'classic-missing-root', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-missing-root-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'workflows: [classic]',
          'classic:',
          '  artifact_layout: docs',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.mkdir(path.join(runRoot, 'openspec'), { recursive: true });

      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'next'],
          { env },
        ),
      ).rejects.toThrow(/Configured Classic OpenSpec root does not exist/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('uses the configured Classic root when a standalone OpenSpec root also exists', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'classic-dual-root',
        goal: 'Keep standalone and Comet OpenSpec catalogues independent.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'classic-dual-root', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-dual-root-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await writeClassicProjectConfig(runRoot);
      await fs.mkdir(path.join(runRoot, 'openspec'), { recursive: true });
      await fs.mkdir(path.join(runRoot, 'docs', 'openspec'), { recursive: true });

      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-state.mjs'), 'next'],
          { env },
        ),
      ).rejects.toThrow(/No active Comet change/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('rejects a configured Native artifact root that does not exist', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('native-missing-root'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'native-missing-root', workflow }),
    );
    await writeGeneratedProtocol(output.packageRoot, (protocol) => {
      protocol.outputSchemas[0].artifacts[0].pathBase = 'native-root';
      protocol.outputSchemas[0].artifacts[0].paths = ['notes.md'];
    });
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-missing-root-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'workflows: [native]',
          'native:',
          '  artifact_root: docs',
          '',
        ].join('\n'),
        'utf8',
      );
      await execFileAsync(process.execPath, [stateScript, 'init'], { env });
      await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'research', '{"summary":"done"}'],
        { env },
      );

      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'research'], { env }),
      ).rejects.toThrow(/Configured Native artifact root does not exist/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it.each(['../outside-native', '/absolute-native', 'docs//native', 'docs/./native'])(
    'rejects native.artifact_root outside the project: %s',
    async (artifactRoot) => {
      const workflow = normalizeWorkflowDefinition(customWorkflow('native-root-boundary'));
      const output = await generateFactorySkillPackage(
        packagePlan({ root, name: 'native-root-boundary', workflow }),
      );
      await writeGeneratedProtocol(output.packageRoot, (protocol) => {
        protocol.outputSchemas[0].artifacts[0].pathBase = 'native-root';
        protocol.outputSchemas[0].artifacts[0].paths = ['notes.md'];
      });

      const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-root-boundary-'));
      const env = { ...process.env, COMET_RUN_ROOT: runRoot };
      const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
      const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
      try {
        await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
        await fs.writeFile(
          path.join(runRoot, '.comet', 'config.yaml'),
          [
            'schema: comet.project.v1',
            'default_workflow: native',
            'native:',
            `  artifact_root: ${JSON.stringify(artifactRoot)}`,
            '',
          ].join('\n'),
          'utf8',
        );
        await execFileAsync(process.execPath, [stateScript, 'init'], { env });
        await execFileAsync(
          process.execPath,
          [stateScript, 'record', 'research', '{"summary":"done"}'],
          { env },
        );
        const currentlyResolvedRoot = path.join(
          runRoot,
          ...artifactRoot.split('/').filter(Boolean),
        );
        await fs.mkdir(currentlyResolvedRoot, { recursive: true });
        await fs.writeFile(path.join(currentlyResolvedRoot, 'notes.md'), '# Notes\n', 'utf8');

        await expect(
          execFileAsync(process.execPath, [guardScript, 'exit', 'research'], { env }),
        ).rejects.toThrow(
          /native\.artifact_root must (?:be a project-relative path|stay inside|not contain empty or dot path segments)/iu,
        );
      } finally {
        await fs.rm(runRoot, { recursive: true, force: true });
      }
    },
  );

  it('rejects an invalid Classic artifact layout instead of treating it as legacy', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'classic-layout-boundary',
        goal: 'Reject invalid Classic layout configuration.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'classic-layout-boundary', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-layout-boundary-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'classic:',
          '  artifact_layout: elsewhere',
          '',
        ].join('\n'),
        'utf8',
      );
      const changeRoot = path.join(runRoot, 'openspec', 'changes', 'invalid-layout');
      await fs.mkdir(changeRoot, { recursive: true });
      await fs.writeFile(path.join(changeRoot, '.comet.yaml'), 'phase: open\n', 'utf8');

      await expect(execFileAsync(process.execPath, [stateScript, 'next'], { env })).rejects.toThrow(
        /classic\.artifact_layout must be legacy or docs/iu,
      );
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('accepts complex legal project YAML through the shared generated config helper', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('complex-project-config'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'complex-project-config', workflow }),
    );
    await writeGeneratedProtocol(output.packageRoot, (protocol) => {
      protocol.outputSchemas[0].artifacts[0].pathBase = 'native-root';
      protocol.outputSchemas[0].artifacts[0].paths = ['notes.md'];
    });
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-complex-project-config-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          '---',
          'schema: "comet.project.v1"',
          'default_workflow: native',
          'workflows:',
          '  - native',
          '  - classic',
          'ambient_resume: true',
          'native:',
          '  artifact_root: "docs/native" # quoted path',
          '  language: en',
          '  clarification_mode: batch',
          '  snapshot:',
          '    include: ["**/*.ts", "packages/**"]',
          '    exclude:',
          '      - "dist/**"',
          '    max_files: 12000',
          '    max_total_bytes: 268435456',
          '    max_duration_ms: 90000',
          'classic: { artifact_layout: docs, language: zh-CN }',
          'extension:',
          '  owners: [platform, workflow]',
          '  note: "value: with # content"',
          '...',
          '',
        ].join('\n'),
        'utf8',
      );

      const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
      await execFileAsync(process.execPath, [stateScript, 'init'], { env });
      await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'research', '{"summary":"done"}'],
        { env },
      );
      await fs.mkdir(path.join(runRoot, 'docs', 'native'), { recursive: true });
      await fs.writeFile(path.join(runRoot, 'docs', 'native', 'notes.md'), '# Notes\n');
      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs'), 'exit', 'research'],
          { env },
        ),
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'duplicate keys',
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\nextension: one\nextension: two\n',
    ],
    [
      'malformed unrelated YAML',
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\nextension: [unterminated\n',
    ],
    [
      'invalid managed fields',
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\nclassic:\n  review_mode: casual\n',
    ],
  ])('fails closed in generated runtimes for %s', async (_label, source) => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('invalid-project-config'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'invalid-project-config', workflow }),
    );
    await writeGeneratedProtocol(output.packageRoot, (protocol) => {
      protocol.outputSchemas[0].artifacts[0].pathBase = 'native-root';
      protocol.outputSchemas[0].artifacts[0].paths = ['notes.md'];
    });
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-invalid-project-config-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(path.join(runRoot, '.comet', 'config.yaml'), source, 'utf8');

      const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
      await execFileAsync(process.execPath, [stateScript, 'init'], { env });
      await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'research', '{"summary":"done"}'],
        { env },
      );
      await expect(
        execFileAsync(
          process.execPath,
          [path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs'), 'exit', 'research'],
          { env },
        ),
      ).rejects.toThrow(/(?:Invalid \.comet\/config\.yaml|classic\.review_mode must be)/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
    }
  });

  it('rejects a Native artifact path base that crosses a junction outside the project', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('native-physical-boundary'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'native-physical-boundary', workflow }),
    );
    await writeGeneratedProtocol(output.packageRoot, (protocol) => {
      protocol.outputSchemas[0].artifacts[0].pathBase = 'native-root';
      protocol.outputSchemas[0].artifacts[0].paths = ['notes.md'];
    });

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-physical-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-outside-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: native',
          'native:',
          '  artifact_root: docs',
          '',
        ].join('\n'),
        'utf8',
      );
      await execFileAsync(process.execPath, [stateScript, 'init'], { env });
      await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'research', '{"summary":"done"}'],
        { env },
      );
      await fs.writeFile(path.join(outsideRoot, 'notes.md'), '# Outside\n', 'utf8');
      try {
        await fs.symlink(outsideRoot, path.join(runRoot, 'docs'), 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'research'], { env }),
      ).rejects.toThrow(/symbolic link or junction/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a Classic docs catalogue that crosses a junction outside the project', async () => {
    const workflow = normalizeWorkflowDefinition(
      builtinCometFivePhaseWorkflow({
        name: 'classic-physical-boundary',
        goal: 'Reject an unsafe Classic catalogue.',
      }),
    );
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'classic-physical-boundary', workflow }),
    );
    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-physical-'));
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-outside-'));
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    try {
      await fs.mkdir(path.join(runRoot, '.comet'), { recursive: true });
      await fs.writeFile(
        path.join(runRoot, '.comet', 'config.yaml'),
        [
          'schema: comet.project.v1',
          'default_workflow: classic',
          'classic:',
          '  artifact_layout: docs',
          '',
        ].join('\n'),
        'utf8',
      );
      await fs.mkdir(path.join(runRoot, 'docs'), { recursive: true });
      await fs.mkdir(path.join(outsideRoot, 'changes', 'outside-change'), { recursive: true });
      await fs.writeFile(
        path.join(outsideRoot, 'changes', 'outside-change', '.comet.yaml'),
        'phase: open\narchived: false\n',
        'utf8',
      );
      try {
        await fs.symlink(outsideRoot, path.join(runRoot, 'docs', 'openspec'), 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(execFileAsync(process.execPath, [stateScript, 'next'], { env })).rejects.toThrow(
        /symbolic link or junction/iu,
      );
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a generated workflow state path that escapes the project root', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('state-path-boundary'));
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'state-path-boundary', workflow }),
    );
    const escapedName = `${path.basename(root)}-escaped-state.json`;
    await writeGeneratedProtocol(output.packageRoot, (protocol) => {
      protocol.state.statePath = `../${escapedName}`;
    });

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-state-path-boundary-'));
    const escapedPath = path.join(runRoot, '..', escapedName);
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    try {
      await expect(execFileAsync(process.execPath, [stateScript, 'init'], { env })).rejects.toThrow(
        /workflow-run statePath must stay inside the project root/iu,
      );
      await expect(fs.access(escapedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(escapedPath, { force: true });
    }
  });

  it('rejects an artifact pattern that escapes its declared path base', async () => {
    const workflowInput = customWorkflow('artifact-path-boundary');
    workflowInput.outputSchemas![0]!.artifacts[0]!.paths = ['../outside-artifact.md'];
    const workflow = normalizeWorkflowDefinition(workflowInput);
    const output = await generateFactorySkillPackage(
      packagePlan({ root, name: 'artifact-path-boundary', workflow }),
    );

    const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-artifact-path-boundary-'));
    const outsideArtifact = path.join(runRoot, '..', 'outside-artifact.md');
    const env = { ...process.env, COMET_RUN_ROOT: runRoot };
    const stateScript = path.join(output.packageRoot, 'scripts', 'workflow-state.mjs');
    const guardScript = path.join(output.packageRoot, 'scripts', 'workflow-guard.mjs');
    try {
      await fs.writeFile(outsideArtifact, '# Outside\n', 'utf8');
      await execFileAsync(process.execPath, [stateScript, 'init'], { env });
      await execFileAsync(
        process.execPath,
        [stateScript, 'record', 'research', '{"summary":"done"}'],
        { env },
      );

      await expect(
        execFileAsync(process.execPath, [guardScript, 'exit', 'research'], { env }),
      ).rejects.toThrow(/artifact path must stay inside its declared path base/iu);
    } finally {
      await fs.rm(runRoot, { recursive: true, force: true });
      await fs.rm(outsideArtifact, { force: true });
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
      await writeClassicProjectConfig(runRoot);
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
      await writeClassicProjectConfig(caseRoot);
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
      await writeClassicProjectConfig(runRoot);
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

  it('emits workflow-kernel authoring evidence that matches the Creator protocol and eval contract', async () => {
    const workflow = normalizeWorkflowDefinition(customWorkflow('evaluable-kernel'));
    const resolvedSkill: FactoryResolvedSkill = {
      query: 'research-skill',
      preferenceIndex: 0,
      status: 'available',
      sources: [
        {
          name: 'research-skill',
          preferenceIndex: 0,
          platform: 'codex',
          scope: 'project',
          origin: 'project',
          root: '/tmp/research-skill',
          description: 'Collects focused research notes.',
          skillMd: '# Research Skill\n\nCollect focused research notes.\n',
          hash: 'a'.repeat(64),
        },
      ],
    };
    const plan = packagePlan({ root, name: 'evaluable-kernel', workflow });
    plan.resolvedSkills = [resolvedSkill];
    const output = await generateFactorySkillPackage(plan);
    const entry = await fs.readFile(output.skillPath, 'utf8');

    const resolvedSkills = JSON.parse(
      await fs.readFile(path.join(output.packageRoot, 'reference', 'resolved-skills.json'), 'utf8'),
    ) as { sourceSummaries?: Array<{ name?: string; description?: string }> };
    const authoringLanes = JSON.parse(
      await fs.readFile(path.join(output.packageRoot, 'reference', 'authoring-lanes.json'), 'utf8'),
    ) as { lanes?: Array<{ lane?: string }> };
    const evalManifest = parse(
      await fs.readFile(path.join(output.packageRoot, 'comet', 'eval.yaml'), 'utf8'),
    ) as { evaluation?: { recommendedTasks?: string[] } };

    expect(entry).toContain('reference/workflow-protocol.json');
    expect(entry).toContain('reference/resolved-skills.json');
    expect(resolvedSkills.sourceSummaries).toEqual([
      expect.objectContaining({
        name: 'research-skill',
        description: 'Collects focused research notes.',
      }),
    ]);
    expect(authoringLanes.lanes?.map((lane) => lane.lane)).toEqual([
      'script',
      'reference',
      'pause-points',
      'workflow-entry',
      'skill-core',
      'skill-review',
    ]);
    expect(evalManifest.evaluation?.recommendedTasks).toEqual([
      'authoring-skill-smoke',
      'workflow-route-conformance',
    ]);
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
