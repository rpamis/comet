import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectStandaloneTasks, resolveEvalContext } from '../../../domains/eval/index.js';

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
        '  tasks: [{source: tasks/source}]',
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
    await expect(collectStandaloneTasks({}, context, packageRoot)).resolves.toContain('- right');
    expect(pythonAccepts(manifest)).toBe(true);
    await fs.writeFile(path.join(source, 'task.toml'), '[metadata\nname = "bad"\n');
    await expect(collectStandaloneTasks({}, context, packageRoot)).rejects.toThrow('task.toml');
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
});
