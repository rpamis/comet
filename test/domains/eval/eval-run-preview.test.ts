import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeEvalRunConfig, previewEvalRun } from '../../../domains/eval/eval-run-preview.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import { evalMatrix } from '../../helpers/eval-matrix.js';

vi.mock('../../../platform/process/external-command.js', () => ({
  runExternalCommandAsync: vi.fn(async () => 'available'),
}));
describe('Eval preview', () => {
  let project: string;
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-preview-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(project, 'home'));
    vi.stubEnv('BENCH_API_KEY', 'preview-test-key');
    await fs.mkdir(path.join(project, 'skill'));
    await fs.writeFile(path.join(project, 'skill/SKILL.md'), '# Reporting\nUse input data.');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(project, { recursive: true, force: true });
  });
  it('previews a local Skill without creating user configuration or starting a model', async () => {
    const preview = await previewEvalRun(project, {
      target: 'skill',
      targetType: 'skill',
      agent: 'codex',
      model: 'test-model',
    });
    expect(preview.target.type).toBe('skill');
    expect(preview.noModelsStarted).toBe(true);
    expect(preview.taskSource).toBe('pending-generation');
    expect(preview.confirmationHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(fs.stat(path.join(project, 'home/.comet/eval/.env'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(JSON.stringify(preview)).not.toContain('preview-test-key');
  });
  it('binds confirmation to content and execution settings', async () => {
    const config = {
      target: 'skill',
      targetType: 'skill' as const,
      agent: 'codex',
      model: 'model-a',
    };
    const first = await previewEvalRun(project, config);
    await fs.writeFile(path.join(project, 'skill/SKILL.md'), '# Revised report');
    const changed = await previewEvalRun(project, config);
    expect(changed.confirmationHash).not.toBe(first.confirmationHash);
    const model = await previewEvalRun(project, { ...config, model: 'model-b' });
    expect(model.confirmationHash).not.toBe(changed.confirmationHash);
  });
  it('resolves relative paths against the selected project and accepts an external absolute Skill path', async () => {
    const relative = await previewEvalRun(project, {
      target: 'skill/SKILL.md',
      agent: 'codex',
      model: 'fixture-model',
    });
    expect(relative.target.path).toBe(path.join(project, 'skill/SKILL.md'));
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-other-target-'));
    try {
      await fs.writeFile(path.join(other, 'SKILL.md'), '# External skill\nUse the input.');
      const absolute = await previewEvalRun(project, {
        target: path.join(other, 'SKILL.md'),
        agent: 'codex',
        model: 'fixture-model',
      });
      expect(absolute.target.path).toBe(path.join(other, 'SKILL.md'));
      expect(absolute.target.type).toBe('skill');
      expect(absolute.noModelsStarted).toBe(true);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });
  it('trims pasted paths and explains how to correct an explicit type mismatch', async () => {
    expect(normalizeEvalRunConfig(project, { target: ' skill/SKILL.md ' }).target).toBe(
      path.join(project, 'skill/SKILL.md'),
    );
    expect(() =>
      normalizeEvalRunConfig(project, {
        target: path.join(project, 'skill/SKILL.md'),
        targetType: 'application',
      }),
    ).toThrow('请选择「Skill / Eval manifest」');
  });
  it('rejects credential fields in requests and unsupported SDK switches', async () => {
    await expect(
      previewEvalRun(project, { target: 'skill', targetType: 'skill', apiKey: 'secret' } as any),
    ).rejects.toThrow(/字段/);
    await expect(
      previewEvalRun(project, {
        target: 'application.json',
        targetType: 'application',
        quick: true,
      }),
    ).rejects.toThrow(/SDK/);
  });
  it('freezes inherited model settings while honoring an explicit Judge disable', async () => {
    await fs.mkdir(path.join(project, 'home/.comet/eval'), { recursive: true });
    await fs.writeFile(
      path.join(project, 'home/.comet/eval/.env'),
      'BENCH_MODEL=environment-model\nBENCH_LLM_JUDGE=1\nBENCH_JUDGE_MODEL=judge-model\n',
    );
    const preview = await previewEvalRun(project, {
      target: 'skill',
      targetType: 'skill',
      agent: 'codex',
      judgeEnabled: false,
    });
    expect(preview.config.model).toBe('environment-model');
    expect(preview.config.judgeModel).toBeUndefined();
    expect(preview.environment.some((item) => item.id === 'judge')).toBe(false);
  });
  it('permits an installed local adapter that declares no credentials', async () => {
    vi.stubEnv('BENCH_API_KEY', undefined);
    const adapterRoot = path.join(project, 'home/.comet/eval/adapters/local-script');
    await fs.mkdir(adapterRoot, { recursive: true });
    await fs.writeFile(
      path.join(adapterRoot, 'adapter.yaml'),
      'apiVersion: comet.eval.agent/v1alpha1\nkind: EvalAgentAdapter\nmetadata:\n  id: local-script\n  version: "1"\nruntime:\n  executable: python3\n  install:\n    kind: none\ncredentials: []\ncapabilities:\n  singleTurn: true\n  resume: false\n  structuredEvents: false\n  telemetry: false\n  skillInvocationEvidence: false\n',
    );
    const preview = await previewEvalRun(project, {
      target: 'skill',
      targetType: 'skill',
      agent: 'local-script',
      model: 'fixture',
    });
    expect(preview.environment.find((item) => item.id === 'subject')?.status).toBe('available');
  });
  it('previews a real SDK application with its supported default budget', async () => {
    const application = await createDiskApplication(project);
    const preview = await previewEvalRun(project, {
      target: application.file,
      targetType: 'application',
      agent: 'codex',
      model: 'fixture-model',
      judgeEnabled: false,
    });
    expect(preview.config.maxTurns).toBe(8);
    expect(preview.config.timeoutSeconds).toBe(1200);
    expect(preview.target).toMatchObject({ name: 'editorial', type: 'application' });
    expect(preview.application?.workflows[0].steps).toContain('draft');
    expect(preview.noModelsStarted).toBe(true);
  });
  it('inherits the Skill tracking destination and requires both Langfuse keys', async () => {
    vi.stubEnv('COMET_EVAL_SUITE', 'langfuse');
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', undefined);
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'fuse-preview-secret');
    const config = {
      target: 'skill',
      targetType: 'skill' as const,
      agent: 'codex',
      judgeEnabled: false,
    };
    const missing = await previewEvalRun(project, config);
    expect(missing.config.suite).toBe('langfuse');
    expect(missing.environment.find((item) => item.id === 'tracking')).toMatchObject({
      status: 'missing',
    });
    expect(JSON.stringify(missing)).not.toContain('fuse-preview-secret');
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'fuse-preview-public');
    const ready = await previewEvalRun(project, config);
    expect(ready.environment.find((item) => item.id === 'tracking')).toMatchObject({
      status: 'available',
    });
    expect(JSON.stringify(ready)).not.toContain('fuse-preview-public');
    expect((await previewEvalRun(project, { ...config, suite: 'local' })).config.suite).toBe(
      'local',
    );
    expect(
      normalizeEvalRunConfig(project, {
        target: 'application.json',
        agent: 'codex',
        judgeEnabled: false,
      }).suite,
    ).toBe('local');
  });
  it('previews only failed authored cases and blocks a changed original manifest', async () => {
    const yaml =
      'apiVersion: comet.eval/v1alpha1\nkind: SkillEvalManifest\nmetadata:\n  name: writer\nskill:\n  name: writer\n  source: ..\nevaluation:\n  tasks:\n    - name: passed-case\n      prompt: Write the report\n      expect:\n        files: [REPORT.md]\n    - name: failed-case\n      prompt: Ask for data\n      expect:\n        files: [DATA.md]\n';
    const manifest = path.join(project, 'skill/comet/eval.yaml');
    await fs.mkdir(path.dirname(manifest));
    await fs.writeFile(manifest, yaml);
    const root = path.join(project, '.comet/eval/runs/original');
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    const matrix = evalMatrix(
      ['passed-case', 'failed-case'].map((task) => ({ task, treatment: 'DYNAMIC_SKILL', rep: 1 })),
    );
    await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(matrix));
    await fs.writeFile(
      path.join(root, 'dashboard-run.json'),
      JSON.stringify({
        schema: 'comet.eval.managed-run.v1',
        id: 'original',
        status: 'completed',
        config: { target: path.join(project, 'skill'), targetType: 'skill' },
        targetId: path.join(project, 'skill'),
        contentHash: 'old-content',
      }),
    );
    await fs.writeFile(
      path.join(root, 'metadata.json'),
      JSON.stringify({
        experiment_id: 'original',
        completed_at: '2026-10-11',
        expected_case_matrix: { case_count: 2, matrix_hash: matrix.matrix_hash },
      }),
    );
    const hash =
      'sha256:' +
      createHash('sha256').update('F\0eval.yaml\0').update(yaml).update('\0').digest('hex');
    for (const name of ['passed-case', 'failed-case'])
      await fs.writeFile(
        path.join(root, 'reports', `${name}_report.json`),
        JSON.stringify({
          name: `${name}-DYNAMIC_SKILL`,
          rep: 1,
          passed: name === 'passed-case',
          events_summary: {
            task: name,
            treatment: 'DYNAMIC_SKILL',
            sample: 1,
            eval_manifest: manifest,
            case_manifest: {
              task_hash: 'task',
              validator_hash: 'validator',
              authored_hashes: { manifest_hash: hash },
            },
          },
        }),
      );
    const config = {
      target: 'skill',
      agent: 'codex',
      model: 'fixture',
      retrySourceRunId: 'original',
    };
    const preview = await previewEvalRun(project, config);
    expect(preview.tasks.map((task) => task.name)).toEqual(['failed-case']);
    expect(preview.retry?.cases).toHaveLength(1);
    expect(preview.taskSource).toBe('failed-retry');
    expect(preview.taskCount).toEqual({ min: 1, max: 1 });
    await fs.writeFile(manifest, yaml + '# changed\n');
    await expect(previewEvalRun(project, config)).rejects.toThrow(/清单已变化/);
  });
});
