import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
} from '../../../domains/workflow-generation/index.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import {
  normalizeApplicationEvalSettings,
  previewWorkflowApplicationEval,
  prepareWorkflowApplicationEval,
  readWorkflowApplicationEvalResult,
  runWorkflowApplicationEval,
} from '../../../domains/eval/application-eval.js';

it('preserves provider model aliases with context-window suffixes for the Agent and Judge', () => {
  expect(
    normalizeApplicationEvalSettings({
      agent: 'claude-code',
      model: 'glm-5.3[1M]',
      judgeAgent: 'claude-code',
      judgeModel: 'claude-sonnet-4-6[1m]',
    }),
  ).toMatchObject({ model: 'glm-5.3[1M]', judgeModel: 'claude-sonnet-4-6[1m]' });
  for (const model of ['glm;echo', 'glm\nsecret', 'glm[1M', 'glm[]', 'x'.repeat(161)]) {
    expect(() => normalizeApplicationEvalSettings({ agent: 'claude-code', model })).toThrow(
      'model 无效',
    );
  }
  expect(() => normalizeApplicationEvalSettings({ agent: 'claude-code[1M]' })).toThrow(
    'agent 无效',
  );
});

let root: string;
let file: string;
beforeAll(() => ensureCliBuilt(process.cwd()));
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-eval-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
  const plan = await prepareWorkflowApplicationPlan({
    projectRoot: root,
    packageRoot: path.join(root, 'package'),
    proposal: {
      schema: 'comet.workflow.application.plan.v1',
      manifest: {
        schema: 'comet.workflow.application.v1',
        id: 'weekly-report',
        version: '1',
        base: 'standalone',
        runtimeVersion: getCurrentVersion(),
        entrySkill: 'SKILL.md',
        module: 'application.mjs',
        skills: [],
        bindings: [],
      },
      composition: { kind: 'report' },
      modules: {},
    },
  });
  file = (
    await compileWorkflowApplication({
      plan,
      confirmationHash: hashRuntimeValue(plan),
      projectRoot: root,
      packageRoot: path.join(root, 'package'),
    })
  ).file;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it('does not execute external Skills without a fixed isolated test replacement', async () => {
  const fixtureRoot = path.join(root, 'external');
  await fs.mkdir(fixtureRoot);
  const source = await createDiskApplication(fixtureRoot, { external: true });
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const options = {
    file: source.file,
    projectRoot: root,
    settings: { agent: 'codex', model: 'test-model' },
  };
  const preview = await previewWorkflowApplicationEval(options);
  expect(preview.blockedReasons).toHaveLength(1);
  const result = await runWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'external-blocked',
  });
  expect(result).toMatchObject({ status: 'incomplete', total: 0, taskNames: [] });
  expect(result.failures[0]).toContain('测试替身');
  expect(await fs.readFile(path.join(source.skillRoot, 'SKILL.md'), 'utf8')).toContain(
    'isolated service',
  );
});

it('previews the actual workflows and execution limits without generating tasks or writing the package', async () => {
  const preview = await previewWorkflowApplicationEval({
    file,
    projectRoot: root,
    goal: '先审批再发布周报',
    settings: { agent: 'codex', model: 'test-model' },
  });
  expect(preview).toMatchObject({
    application: { id: 'weekly-report', version: '1' },
    goal: '先审批再发布周报',
    settings: { agent: 'codex', model: 'test-model', maxTurns: 8, timeoutSeconds: 1200 },
    taskCount: { min: 2, max: 4 },
    noModelsStarted: true,
  });
  expect(preview.workflows[0].steps).toContain('approve');
  expect(await fs.stat(path.join(root, '.comet/eval')).catch(() => null)).toBeNull();
  expect(await fs.stat(path.join(root, 'package/comet/eval.yaml')).catch(() => null)).toBeNull();
});

it('makes a frozen evaluation snapshot containing the actual application rather than only its entry Skill', async () => {
  const options = {
    file,
    projectRoot: root,
    goal: '先审批再发布周报',
    settings: { agent: 'codex', model: 'test-model' },
  };
  const preview = await previewWorkflowApplicationEval(options);
  const prepared = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'eval-one',
  });
  expect(
    await fs.readFile(path.join(prepared.skillRoot, 'references/workflows.json'), 'utf8'),
  ).toContain('approve');
  expect(
    await fs.readFile(
      path.join(prepared.skillRoot, 'scripts/application/application.json'),
      'utf8',
    ),
  ).toBe(await fs.readFile(file, 'utf8'));
  expect(await fs.readFile(path.join(prepared.skillRoot, 'SKILL.md'), 'utf8')).toContain(
    'scripts/application/application.json',
  );
  const resumed = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'eval-one',
  });
  expect(resumed).toEqual(prepared);
  await fs.appendFile(path.join(prepared.skillRoot, 'references/workflows.json'), 'drift');
  await expect(
    prepareWorkflowApplicationEval({
      ...options,
      confirmationHash: preview.confirmationHash,
      experimentId: 'eval-one',
    }),
  ).rejects.toThrow(/漂移|变化/);
});

it('rejects stale approvals, credentials in settings and unsafe experiment IDs before execution', async () => {
  const options = { file, projectRoot: root, goal: '周报', settings: { agent: 'codex' } };
  await expect(
    prepareWorkflowApplicationEval({
      ...options,
      confirmationHash: 'stale',
      experimentId: 'eval-one',
    }),
  ).rejects.toThrow(/变化|确认/);
  await expect(
    previewWorkflowApplicationEval({
      ...options,
      settings: { agent: 'codex', apiKey: 'never-store' } as never,
    }),
  ).rejects.toThrow(/字段|凭据/);
  const preview = await previewWorkflowApplicationEval(options);
  await expect(
    prepareWorkflowApplicationEval({
      ...options,
      confirmationHash: preview.confirmationHash,
      experimentId: '../escape',
    }),
  ).rejects.toThrow(/身份/);
});

it('keeps original case fixtures when the candidate resources change during a repair', async () => {
  const fixture = path.join(root, 'package/fixtures/input.json');
  await fs.mkdir(path.dirname(fixture));
  await fs.writeFile(fixture, '{"seed":"original"}');
  const options = { file, projectRoot: root, settings: { agent: 'codex', model: 'test-model' } };
  const preview = await previewWorkflowApplicationEval(options);
  const original = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'original',
  });
  const manifestPath = path.join(root, '.comet/eval/generated/frozen/eval.yaml');
  const manifest = stringify({
    skill: { source: original.skillRoot },
    evaluation: {
      tasks: [
        {
          name: 'normal',
          prompt: 'Run the SDK',
          workspace: 'scripts/application/fixtures',
          expect: { files: ['output.json'] },
        },
        { name: 'rejected', prompt: 'Reject approval', expect: { files: ['draft.md'] } },
      ],
    },
  });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, manifest);
  const reuseTaskSet = {
    manifestPath,
    manifestHash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
    sourceRoot: original.skillRoot,
    sourceSnapshotHash: original.snapshotHash,
  };
  const repairedRoot = path.join(root, 'repaired-package');
  await fs.cp(path.dirname(file), repairedRoot, { recursive: true });
  await fs.writeFile(path.join(repairedRoot, 'fixtures/input.json'), '{"seed":"changed"}');
  const repaired = { ...options, file: path.join(repairedRoot, 'application.json'), reuseTaskSet };
  const next = await previewWorkflowApplicationEval(repaired);
  const prepared = await prepareWorkflowApplicationEval({
    ...repaired,
    confirmationHash: next.confirmationHash,
    experimentId: 'repaired',
  });
  const tasks = parse(await fs.readFile(path.join(prepared.skillRoot, 'comet/eval.yaml'), 'utf8'))
    .evaluation.tasks;
  expect(
    await fs.readFile(path.join(prepared.skillRoot, tasks[0].workspace, 'input.json'), 'utf8'),
  ).toBe('{"seed":"original"}');
  expect(
    await fs.readFile(
      path.join(prepared.skillRoot, 'scripts/application/fixtures/input.json'),
      'utf8',
    ),
  ).toBe('{"seed":"changed"}');
});

it('accepts only the matching immutable evaluation result and retains failures as failures', async () => {
  const options = {
    file,
    projectRoot: root,
    goal: '周报',
    settings: { agent: 'codex', model: 'test-model' },
  };
  const preview = await previewWorkflowApplicationEval(options);
  const prepared = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'eval-one',
  });
  const result = {
    schema: 'comet.workflow.application.eval.result.v1',
    experimentId: 'eval-one',
    confirmationHash: preview.confirmationHash,
    snapshotHash: prepared.snapshotHash,
    application: preview.application,
    settings: preview.settings,
    status: 'failed',
    taskNames: ['normal', 'rejected'],
    passed: 1,
    total: 2,
    report: 'summary.md',
    limitations: ['Only codex was evaluated'],
    failures: ['approval bypass'],
  };
  await fs.mkdir(path.dirname(prepared.resultFile), { recursive: true });
  await fs.writeFile(prepared.resultFile, JSON.stringify(result));
  expect(await readWorkflowApplicationEvalResult(prepared)).toMatchObject({
    status: 'failed',
    failures: ['approval bypass'],
  });
  await fs.writeFile(
    prepared.resultFile,
    JSON.stringify({ ...result, confirmationHash: 'another-version' }),
  );
  await expect(readWorkflowApplicationEvalResult(prepared)).rejects.toThrow(/绑定|匹配/);
});
