import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  prepareWorkflowApplicationPlan,
  compileWorkflowApplication,
} from '../../../domains/workflow-generation/index.js';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { readApplicationFiles } from '../../../domains/workflow-application/skill-adapter.js';
import {
  previewWorkflowApplicationEval,
  prepareWorkflowApplicationEval,
  runWorkflowApplicationEval,
} from '../../../domains/eval/application-eval.js';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../platform/process/external-command.js', async (original) => ({
  ...(await original<typeof import('../../../platform/process/external-command.js')>()),
  runExternalCommandAsync: execute,
}));
let root: string;
let options: Parameters<typeof previewWorkflowApplicationEval>[0];
const digest = (bytes: string | Buffer) =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');
beforeEach(async () => {
  execute.mockReset();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-taskset-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
  const plan = await prepareWorkflowApplicationPlan({
    projectRoot: root,
    packageRoot: path.join(root, 'package'),
    proposal: {
      schema: 'comet.workflow.application.plan.v1',
      manifest: {
        schema: 'comet.workflow.application.v1',
        id: 'taskset-report',
        version: '1',
        base: 'standalone',
        runtimeVersion: '0.4.5',
        entrySkill: 'SKILL.md',
        module: 'application.mjs',
        skills: [],
        bindings: [],
      },
      composition: { kind: 'report' },
      modules: {},
    },
  });
  const compiled = await compileWorkflowApplication({
    plan,
    confirmationHash: hashRuntimeValue(plan),
    projectRoot: root,
    packageRoot: path.join(root, 'package'),
  });
  options = {
    file: compiled.file,
    projectRoot: root,
    settings: { agent: 'codex', model: 'test-model' },
  };
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

async function frozen(
  prepared: Awaited<ReturnType<typeof prepareWorkflowApplicationEval>>,
  receipt: boolean,
) {
  const folder = path.join(root, '.comet/eval/generated/skill', 'a'.repeat(64));
  await fs.mkdir(folder, { recursive: true });
  const names = ['normal', 'rejected'];
  const manifest = stringify({
    apiVersion: 'comet.eval/v1alpha1',
    kind: 'SkillEvalManifest',
    metadata: { name: 'fixed', generationHash: 'a'.repeat(64) },
    skill: { name: 'fixed', source: prepared.skillRoot, profile: 'generic' },
    evaluation: {
      tasks: names.map((name) => ({
        name,
        prompt: `Run ${name}`,
        expect: { files: [name + '.md'] },
      })),
    },
  });
  const manifestPath = path.join(folder, 'eval.yaml');
  await fs.writeFile(manifestPath, manifest);
  const sourceFiles = await readApplicationFiles(prepared.skillRoot);
  const skillSnapshotHash =
    'sha256:' +
    hashRuntimeValue(
      Object.entries(sourceFiles)
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(([ref, bytes]) => ({ path: ref, hash: digest(Buffer.from(bytes, 'base64')) })),
    );
  const original = parse(
    await fs.readFile(path.join(prepared.skillRoot, 'comet/eval.yaml'), 'utf8'),
  );
  const interaction = {
    mode: original.interaction.mode,
    max_turns: original.interaction.maxTurns,
    simulator_prompt: original.interaction.simulatorPrompt,
    decision_patterns: [],
    decision_reply: null,
    decision_replies: [],
    continue_prompt: 'Please continue with the next phase of the workflow.',
    fresh_resume_marker: null,
  };
  const metadata = {
    schema: 'comet.eval.generation.v1',
    generator_version: 'comet-auto-task-generator.v1',
    task_schema_version: 'comet.eval/v1alpha1',
    generation_hash: 'a'.repeat(64),
    manifest_hash: digest(manifest),
    skill_path: prepared.skillRoot,
    skill_snapshot_hash: skillSnapshotHash,
    agent: 'codex',
    model: 'test-model',
    profile: 'generic',
    interaction,
  };
  const metadataBytes = JSON.stringify(metadata);
  await fs.writeFile(path.join(folder, 'generation.json'), metadataBytes);
  const taskSet = {
    manifestPath,
    manifestHash: digest(manifest),
    generationHash: 'a'.repeat(64),
    sourceRoot: prepared.skillRoot,
    sourceSnapshotHash: prepared.snapshotHash,
  };
  const matrixBody = {
    schema: 'comet.eval.expected-case-matrix.v1',
    cases: names.map((task) => ({ task, treatment: 'DYNAMIC_SKILL', rep: 1 })),
  };
  const matrixHash = 'sha256:' + hashRuntimeValue(matrixBody);
  const runRoot = path.dirname(prepared.resultFile);
  await fs.mkdir(runRoot, { recursive: true });
  await fs.writeFile(
    path.join(runRoot, 'expected-case-matrix.json'),
    JSON.stringify({ ...matrixBody, matrix_hash: matrixHash }),
  );
  if (receipt)
    await fs.writeFile(
      path.join(runRoot, 'application-task-set.json'),
      JSON.stringify({
        schema: 'comet.workflow.application.eval.task-set.v1',
        experimentId: prepared.experimentId,
        confirmationHash: prepared.preview.confirmationHash,
        snapshotHash: prepared.snapshotHash,
        taskSet,
        matrixHash,
        generationMetadataHash: digest(metadataBytes),
      }),
    );
  return taskSet;
}

it('retains a collection receipt in incomplete fallback without fabricating executed cases', async () => {
  const preview = await previewWorkflowApplicationEval(options);
  let expected: unknown;
  execute.mockImplementation(async (_command, _args, context) => {
    const prepared = JSON.parse(context.env.COMET_APPLICATION_EVAL_CONTEXT);
    expected = await frozen(prepared, true);
    throw new Error('interrupted after collection');
  });
  const result = await runWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'interrupted',
  });
  expect(result).toMatchObject({ status: 'incomplete', passed: 0, total: 0, taskSet: expected });
});

it('recovers one matching interrupted cache in a new preview without changing the old report', async () => {
  const preview = await previewWorkflowApplicationEval(options);
  const prepared = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'original',
  });
  const taskSet = await frozen(prepared, false);
  const result = {
    schema: 'comet.workflow.application.eval.result.v1',
    experimentId: 'original',
    confirmationHash: preview.confirmationHash,
    snapshotHash: prepared.snapshotHash,
    application: preview.application,
    settings: preview.settings,
    status: 'incomplete',
    taskNames: [],
    passed: 0,
    total: 0,
    report: 'summary.md',
    limitations: [],
    failures: ['interrupted'],
  };
  const bytes = JSON.stringify(result);
  await fs.writeFile(prepared.resultFile, bytes);
  const recovered = await previewWorkflowApplicationEval({
    ...options,
    previousExperimentId: 'original',
  });
  expect(recovered.taskSet).toEqual(taskSet);
  expect(await fs.readFile(prepared.resultFile, 'utf8')).toBe(bytes);
  const nextRoot = path.join(root, 'version-two');
  await fs.cp(path.dirname(options.file), nextRoot, { recursive: true });
  const nextFile = path.join(nextRoot, 'application.json');
  const definition = JSON.parse(await fs.readFile(nextFile, 'utf8'));
  definition.version = '2';
  await fs.writeFile(nextFile, JSON.stringify(definition));
  const revised = { ...options, file: nextFile, previousExperimentId: 'original' };
  const nextPreview = await previewWorkflowApplicationEval(revised);
  const next = await prepareWorkflowApplicationEval({
    ...revised,
    confirmationHash: nextPreview.confirmationHash,
    experimentId: 'revised',
  });
  expect(
    parse(
      await fs.readFile(path.join(next.skillRoot, 'comet/eval.yaml'), 'utf8'),
    ).evaluation.tasks.map((task: { name: string }) => task.name),
  ).toEqual(['normal', 'rejected']);
  expect(await fs.readFile(prepared.resultFile, 'utf8')).toBe(bytes);
  expect(execute).not.toHaveBeenCalled();
  const nextRunRoot = path.dirname(next.resultFile);
  await fs.mkdir(nextRunRoot, { recursive: true });
  await fs.copyFile(
    path.join(path.dirname(prepared.resultFile), 'expected-case-matrix.json'),
    path.join(nextRunRoot, 'expected-case-matrix.json'),
  );
  await fs.writeFile(
    next.resultFile,
    JSON.stringify({
      ...result,
      experimentId: 'revised',
      confirmationHash: next.preview.confirmationHash,
      snapshotHash: next.snapshotHash,
      application: next.preview.application,
      settings: next.preview.settings,
    }),
  );
  const resumed = await previewWorkflowApplicationEval({
    ...options,
    file: nextFile,
    previousExperimentId: 'revised',
  });
  expect(resumed.taskSet).toEqual(taskSet);
  expect(execute).not.toHaveBeenCalled();
  await fs.unlink(path.join(nextRunRoot, 'expected-case-matrix.json'));
  expect(
    (
      await previewWorkflowApplicationEval({
        ...options,
        file: nextFile,
        previousExperimentId: 'revised',
      })
    ).taskSet,
  ).toEqual(taskSet);
});

it('blocks ambiguity and manifest drift instead of generating replacement cases', async () => {
  const preview = await previewWorkflowApplicationEval(options);
  const prepared = await prepareWorkflowApplicationEval({
    ...options,
    confirmationHash: preview.confirmationHash,
    experimentId: 'original',
  });
  const taskSet = await frozen(prepared, false);
  await fs.writeFile(
    prepared.resultFile,
    JSON.stringify({
      schema: 'comet.workflow.application.eval.result.v1',
      experimentId: 'original',
      confirmationHash: preview.confirmationHash,
      snapshotHash: prepared.snapshotHash,
      application: preview.application,
      settings: preview.settings,
      status: 'incomplete',
      taskNames: [],
      passed: 0,
      total: 0,
      report: 'summary.md',
      limitations: [],
      failures: ['interrupted'],
    }),
  );
  const duplicate = path.join(root, '.comet/eval/generated/skill', 'b'.repeat(64));
  await fs.cp(path.dirname(taskSet.manifestPath), duplicate, { recursive: true });
  const duplicateManifest = parse(await fs.readFile(path.join(duplicate, 'eval.yaml'), 'utf8'));
  duplicateManifest.metadata.generationHash = 'b'.repeat(64);
  const duplicateBytes = stringify(duplicateManifest);
  await fs.writeFile(path.join(duplicate, 'eval.yaml'), duplicateBytes);
  const duplicateMetadata = JSON.parse(
    await fs.readFile(path.join(duplicate, 'generation.json'), 'utf8'),
  );
  duplicateMetadata.generation_hash = 'b'.repeat(64);
  duplicateMetadata.manifest_hash = digest(duplicateBytes);
  await fs.writeFile(path.join(duplicate, 'generation.json'), JSON.stringify(duplicateMetadata));
  await expect(
    previewWorkflowApplicationEval({ ...options, previousExperimentId: 'original' }),
  ).rejects.toThrow(/唯一|歧义|重复/);
  await fs.rm(duplicate, { recursive: true, force: true });
  await fs.appendFile(taskSet.manifestPath, '# changed');
  await expect(
    previewWorkflowApplicationEval({ ...options, previousExperimentId: 'original' }),
  ).rejects.toThrow(/变化|漂移/);
  expect(execute).not.toHaveBeenCalled();
});

it.each(['receipt', 'source', 'matrix', 'manifest', 'metadata'])(
  'refuses %s drift in a collection receipt without mutating the original result',
  async (changed) => {
    const preview = await previewWorkflowApplicationEval(options);
    const prepared = await prepareWorkflowApplicationEval({
      ...options,
      confirmationHash: preview.confirmationHash,
      experimentId: 'original',
    });
    const taskSet = await frozen(prepared, true);
    const bytes = JSON.stringify({
      schema: 'comet.workflow.application.eval.result.v1',
      experimentId: 'original',
      confirmationHash: preview.confirmationHash,
      snapshotHash: prepared.snapshotHash,
      application: preview.application,
      settings: preview.settings,
      status: 'incomplete',
      taskNames: [],
      passed: 0,
      total: 0,
      report: 'summary.md',
      limitations: [],
      failures: ['interrupted'],
    });
    await fs.writeFile(prepared.resultFile, bytes);
    if (changed === 'source')
      await fs.appendFile(path.join(prepared.skillRoot, 'SKILL.md'), 'changed');
    if (changed === 'manifest') await fs.appendFile(taskSet.manifestPath, '# drift');
    if (changed === 'metadata')
      await fs.appendFile(path.join(path.dirname(taskSet.manifestPath), 'generation.json'), ' ');
    if (changed === 'receipt') {
      const file = path.join(path.dirname(prepared.resultFile), 'application-task-set.json');
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      saved.experimentId = 'another';
      await fs.writeFile(file, JSON.stringify(saved));
    }
    if (changed === 'matrix') {
      const file = path.join(path.dirname(prepared.resultFile), 'expected-case-matrix.json');
      const saved = JSON.parse(await fs.readFile(file, 'utf8'));
      saved.cases[0].task = 'other';
      await fs.writeFile(file, JSON.stringify(saved));
    }
    await expect(
      previewWorkflowApplicationEval({ ...options, previousExperimentId: 'original' }),
    ).rejects.toThrow(/变化|不匹配|漂移|无效/);
    expect(await fs.readFile(prepared.resultFile, 'utf8')).toBe(bytes);
    expect(execute).not.toHaveBeenCalled();
  },
);
