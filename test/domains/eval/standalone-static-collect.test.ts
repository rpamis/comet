import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectStandaloneTasks,
  loadInstalledCustomAgent,
  resolveEvalContext,
} from '../../../domains/eval/index.js';

const repository = path.resolve('.');
const packageRoot = repository;
const evalRoot = path.join(repository, 'eval');
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function skillRoot(manifest?: string): Promise<{ root: string; manifest: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-static-collect-'));
  temporary.push(root);
  const skill = path.join(root, 'skill');
  const comet = path.join(skill, 'comet');
  await fs.mkdir(comet, { recursive: true });
  await fs.writeFile(path.join(skill, 'SKILL.md'), '# Skill\n', 'utf8');
  const target = path.join(comet, 'eval.yaml');
  await fs.writeFile(
    target,
    manifest ??
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation: {}',
        '',
      ].join('\n'),
    'utf8',
  );
  return { root: skill, manifest: target };
}

async function withEnvironment<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function pythonAccepts(manifest: string): boolean {
  try {
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'from pathlib import Path; from scaffold.python.manifests import load_eval_manifest; load_eval_manifest(Path(__import__("sys").argv[1]))',
        manifest,
      ],
      { cwd: evalRoot, stdio: 'pipe' },
    );
    return true;
  } catch {
    return false;
  }
}

describe('standalone static collector parity', () => {
  it.each([
    ['valid inline', '        files: [result.md]', true, 'evaluation.tasks[0]'],
    ['unsafe files', '        files: [../secret]', false, 'evaluation.tasks[0]'],
    ['unsafe contains', '        contains: {../secret: [bad]}', false, 'evaluation.tasks[0]'],
    [
      'invalid jsonpath',
      '        json: [{file: result.json, path: nope, equals: ok}]',
      false,
      'evaluation.tasks[0]',
    ],
    ['invalid command', '        commands: [{run: "", timeout: 0}]', false, 'evaluation.tasks[0]'],
    ['unknown field', '        unknown: true', false, 'evaluation.tasks[0].expect.unknown'],
  ])('%s has the same acceptance as Python', async (_name, expectBody, accepted, field) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks:',
        '    - name: authored',
        '      prompt: work',
        '      rubric: [clear]',
        '      expect:',
        expectBody,
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    const node = collectStandaloneTasks({}, context, packageRoot);
    if (accepted) await expect(node).resolves.toContain('Tasks: authored');
    else await expect(node).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(accepted);
  });

  it('uses metadata.name, not another TOML section, for source tasks', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks: [{name: public-alias, source: tasks/source}]',
        '',
      ].join('\n'),
    );
    const source = path.join(root, 'tasks', 'source');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, 'task.toml'),
      '[other]\nname = "wrong"\n[metadata]\nname = "right"\n',
    );
    await fs.writeFile(path.join(source, 'instruction.md'), 'do work\n');
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      '- public-alias',
    );
    expect(pythonAccepts(manifest)).toBe(true);
    await fs.writeFile(path.join(source, 'task.toml'), '[metadata\nname = "bad"\n');
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow('task.toml');
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('rejects source task TOML that the normal loader cannot execute', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  tasks: [{source: tasks/source}]',
        '',
      ].join('\n'),
    );
    const source = path.join(root, 'tasks', 'source');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(
      path.join(source, 'task.toml'),
      '[metadata]\nname = "invalid-source"\n[evaluation]\nnative_terminal = "invalid"\n',
    );
    await fs.writeFile(path.join(source, 'instruction.md'), 'do work\n');
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.native_terminal',
    );
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it.each([
    ['execution.agent', 'execution:\n  agent: "unknown agent"\n'],
    ['judge.agent', 'judge:\n  agent: "unknown agent"\n  model: judge-model\n'],
  ])('rejects an unknown %s before task selection', async (field, section) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        section.trimEnd(),
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('rejects an unknown CLI Agent before returning pending generation', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(
      collectStandaloneTasks({ agent: 'unknown agent' }, context, packageRoot),
    ).rejects.toThrow('CLI evaluation agent');
  });

  it('validates a custom Agent against the explicitly installed adapter registry', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'execution:',
        '  agent: fixture-agent',
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const registry = path.join(path.dirname(root), 'adapters');
    await fs.mkdir(path.join(registry, 'fixture-agent'), { recursive: true });
    await fs.writeFile(
      path.join(registry, 'fixture-agent', 'adapter.yaml'),
      [
        'apiVersion: comet.eval.agent/v1alpha1',
        'kind: EvalAgentAdapter',
        'metadata: { id: fixture-agent, version: 1.0.0 }',
        'runtime: { executable: fixture-agent, install: { kind: none } }',
        'credentials: [FIXTURE_AGENT_API_KEY]',
        'modelEnv: FIXTURE_AGENT_MODEL',
        'baseUrlEnv: FIXTURE_AGENT_BASE_URL',
        'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
        '',
      ].join('\n'),
      'utf8',
    );
    const previous = process.env.COMET_EVAL_ADAPTERS_DIR;
    process.env.COMET_EVAL_ADAPTERS_DIR = registry;
    try {
      await expect(loadInstalledCustomAgent('fixture-agent')).resolves.toEqual({
        id: 'fixture-agent',
        modelEnv: 'FIXTURE_AGENT_MODEL',
        baseUrlEnv: 'FIXTURE_AGENT_BASE_URL',
      });
      const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
      await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
        'Tasks: pending generation',
      );
    } finally {
      if (previous === undefined) delete process.env.COMET_EVAL_ADAPTERS_DIR;
      else process.env.COMET_EVAL_ADAPTERS_DIR = previous;
    }
  });

  it('fails closed across the installed custom adapter metadata matrix', async () => {
    const { root } = await skillRoot();
    const registry = path.join(path.dirname(root), 'adapters');
    const candidate = path.join(registry, 'matrix-agent');
    await fs.mkdir(candidate, { recursive: true });
    const valid = () =>
      [
        'apiVersion: comet.eval.agent/v1alpha1',
        'kind: EvalAgentAdapter',
        'metadata: { id: matrix-agent, version: 1.0.0 }',
        'runtime: { executable: matrix-agent, install: { kind: none } }',
        'credentials: [MATRIX_AGENT_KEY]',
        'modelEnv: MATRIX_AGENT_MODEL',
        'baseUrlEnv: MATRIX_AGENT_BASE_URL',
        'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
        '',
      ].join('\n');
    const previous = process.env.COMET_EVAL_ADAPTERS_DIR;
    process.env.COMET_EVAL_ADAPTERS_DIR = registry;
    try {
      await expect(loadInstalledCustomAgent('codex')).resolves.toBeNull();
      await expect(loadInstalledCustomAgent('bad id')).resolves.toBeNull();
      await expect(loadInstalledCustomAgent('missing-agent')).rejects.toThrow('not installed');

      const cases: Array<[string, string, string]> = [
        ['invalid YAML', 'not: [valid', 'invalid adapter.yaml'],
        ['scalar document', 'true\n', 'must be a mapping'],
        ['unknown field', `${valid()}extra: true\n`, 'invalid adapter metadata'],
        [
          'API version',
          valid().replace('comet.eval.agent/v1alpha1', 'wrong/v1'),
          'invalid adapter metadata',
        ],
        [
          'metadata id',
          valid().replace('id: matrix-agent', 'id: other-agent'),
          'invalid adapter metadata',
        ],
        [
          'metadata version',
          valid().replace('version: 1.0.0', 'version: "not safe"'),
          'invalid metadata.version',
        ],
        [
          'runtime missing',
          valid().replace('runtime: { executable: matrix-agent, install: { kind: none } }\n', ''),
          'runtime must be a mapping',
        ],
        [
          'runtime fields',
          valid().replace(
            'runtime: { executable: matrix-agent, install: { kind: none } }',
            'runtime: { executable: matrix-agent, unknown: true }',
          ),
          'runtime has unknown fields',
        ],
        [
          'runtime executable',
          valid().replace('executable: matrix-agent', 'executable: "bad token"'),
          'runtime.executable is invalid',
        ],
        [
          'install mapping',
          valid().replace('install: { kind: none }', 'install: invalid'),
          'runtime.install must be a mapping',
        ],
        [
          'install kind',
          valid().replace('kind: none', 'kind: cargo'),
          'runtime.install.kind is invalid',
        ],
        [
          'install package without kind',
          valid().replace('install: { kind: none }', 'install: { kind: none, package: package }'),
          'package requires npm or pip',
        ],
        [
          'install package',
          valid().replace(
            'install: { kind: none }',
            'install: { kind: npm, package: "bad package" }',
          ),
          'runtime.install package is invalid',
        ],
        [
          'credentials count',
          valid().replace('credentials: [MATRIX_AGENT_KEY]', 'credentials: [A, B, C]'),
          'credentials are invalid',
        ],
        [
          'credentials name',
          valid().replace('credentials: [MATRIX_AGENT_KEY]', 'credentials: [bad-name]'),
          'credentials are invalid',
        ],
        [
          'duplicate credentials',
          valid().replace(
            'credentials: [MATRIX_AGENT_KEY]',
            'credentials: [MATRIX_AGENT_KEY, MATRIX_AGENT_KEY]',
          ),
          'credentials are invalid',
        ],
        [
          'capabilities missing',
          valid().replace(
            'capabilities: { singleTurn: true, resume: true, structuredEvents: true, telemetry: false, skillInvocationEvidence: true }',
            '',
          ),
          'capabilities are invalid',
        ],
        [
          'capability unknown',
          valid().replace(
            'skillInvocationEvidence: true }',
            'skillInvocationEvidence: true, unknown: true }',
          ),
          'capabilities are invalid',
        ],
        [
          'capability type',
          valid().replace('singleTurn: true', 'singleTurn: yes'),
          'capabilities are invalid',
        ],
        [
          'model env',
          valid().replace('modelEnv: MATRIX_AGENT_MODEL', 'modelEnv: bad-name'),
          'modelEnv must be an environment variable name',
        ],
        [
          'base URL env',
          valid().replace('baseUrlEnv: MATRIX_AGENT_BASE_URL', 'baseUrlEnv: bad-name'),
          'baseUrlEnv must be an environment variable name',
        ],
      ];
      for (const [label, content, message] of cases) {
        await fs.writeFile(path.join(candidate, 'adapter.yaml'), content, 'utf8');
        await expect(loadInstalledCustomAgent('matrix-agent'), label).rejects.toThrow(message);
      }

      await fs.rm(path.join(candidate, 'adapter.yaml'));
      await expect(loadInstalledCustomAgent('matrix-agent')).rejects.toThrow(
        'missing adapter.yaml',
      );
    } finally {
      if (previous === undefined) delete process.env.COMET_EVAL_ADAPTERS_DIR;
      else process.env.COMET_EVAL_ADAPTERS_DIR = previous;
    }
  });

  it('rejects manifests that set both alias spellings', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  recommendedTasks: [generic-skill-smoke]',
        '  recommended_tasks: [workflow-route-conformance]',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.recommendedTasks and evaluation.recommended_tasks cannot both be set',
    );
  });

  it('rejects duplicate recommended task names with the Python field diagnostic', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'evaluation:',
        '  recommendedTasks: [generic-skill-smoke, generic-skill-smoke]',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'evaluation.recommendedTasks[1] duplicates evaluation.recommendedTasks[0]: "generic-skill-smoke"',
    );
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('accepts preserved main and Judge model routing fields during static collection', async () => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        'execution:',
        '  agent: codex',
        '  model: gpt-main',
        '  baseUrl: https://main.example.com/v1',
        'judge:',
        '  agent: claude-code',
        '  model: claude-judge',
        '  baseUrl: https://judge.example.com',
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      'Tasks: pending generation',
    );
    expect(pythonAccepts(manifest)).toBe(true);
  });

  it('rejects an enabled environment Judge without a dedicated model', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await withEnvironment({ BENCH_LLM_JUDGE: '1', BENCH_JUDGE_MODEL: undefined }, async () => {
      await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
        'BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1',
      );
    });
  });

  it('validates environment-provided main and Judge base URLs during static collection', async () => {
    const { root, manifest } = await skillRoot();
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await withEnvironment(
      {
        BENCH_EVAL_AGENT: 'claude-code',
        ANTHROPIC_BASE_URL: 'relative/main-url',
        BENCH_LLM_JUDGE: undefined,
        BENCH_JUDGE_MODEL: undefined,
        BENCH_JUDGE_BASE_URL: undefined,
      },
      async () => {
        await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
          'execution.baseUrl',
        );
      },
    );
    await withEnvironment(
      {
        BENCH_EVAL_AGENT: undefined,
        ANTHROPIC_BASE_URL: undefined,
        BENCH_LLM_JUDGE: '1',
        BENCH_JUDGE_MODEL: 'judge-model',
        BENCH_JUDGE_BASE_URL: 'relative/judge-url',
      },
      async () => {
        await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
          'judge.baseUrl',
        );
      },
    );
  });

  it.each([
    ['execution.model', 'execution:\n  model: "   "\n'],
    ['execution.baseUrl', 'execution:\n  baseUrl: ftp://main.example.com\n'],
    ['execution.baseUrl', 'execution:\n  baseUrl: https://main.example.com:99999/v1\n'],
    ['judge.model', 'judge:\n  agent: codex\n'],
    ['judge.model', 'judge:\n  model: "   "\n'],
    ['judge.baseUrl', 'judge:\n  model: judge-model\n  baseUrl: relative/path\n'],
  ])('rejects invalid %s instead of silently ignoring it', async (field, section) => {
    const { root, manifest } = await skillRoot(
      [
        'apiVersion: comet.eval/v1alpha1',
        'kind: SkillEvalManifest',
        'metadata: { name: demo }',
        'skill: { name: demo, source: .. }',
        section.trimEnd(),
        'evaluation: {}',
        '',
      ].join('\n'),
    );
    const context = await resolveEvalContext({ manifest, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(field);
    expect(pythonAccepts(manifest)).toBe(false);
  });

  it('hits a Python-generated cache and falls back to pending for corrupt cache content', async () => {
    const { root } = await skillRoot();
    execFileSync(
      'uv',
      [
        'run',
        'python',
        '-c',
        'from pathlib import Path; import sys; from scaffold.python.auto_tasks import ensure_generated_manifest; ensure_generated_manifest(Path(sys.argv[1]), Path(sys.argv[2]), agent="claude-code", model=None, profile="generic", interaction={"mode":"none","max_turns":12,"simulator_prompt":None,"decision_patterns":[],"decision_reply":None,"decision_replies":[],"continue_prompt":"Please continue with the next phase of the workflow.","fresh_resume_marker":None}, generate=lambda _: {"tasks":[{"name":"python-one","prompt":"one","expect":{"files":["one.md"]}},{"name":"python-two","prompt":"two","expect":{"commands":[{"run":"true","timeout":1}]}}]})',
        root,
        path.dirname(root),
      ],
      { cwd: evalRoot, stdio: 'pipe' },
    );
    const context = await resolveEvalContext({ skillPath: root, project: path.dirname(root) });
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toEqual(
      expect.arrayContaining(['Tasks: generated cache', '- python-one', '- python-two']),
    );
    const generatedRoot = path.join(path.dirname(root), '.comet', 'eval', 'generated');
    const [safe] = await fs.readdir(generatedRoot);
    const [key] = await fs.readdir(path.join(generatedRoot, safe));
    await fs.writeFile(path.join(generatedRoot, safe, key, 'eval.yaml'), 'unknownTopLevel: true\n');
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain(
      'Tasks: pending generation',
    );
  });

  it('hard-fails when generated cache components escape the owner-local artifact root', async () => {
    const { root } = await skillRoot();
    const owner = path.dirname(root);
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-static-external-'));
    temporary.push(external);
    const generatedRoot = path.join(owner, '.comet', 'eval', 'generated');
    await fs.mkdir(generatedRoot, { recursive: true });
    const link = path.join(generatedRoot, path.basename(root));
    try {
      await fs.symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    const context = await resolveEvalContext({ skillPath: root, project: owner });
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow(
      'Eval managed path',
    );
  });
});
