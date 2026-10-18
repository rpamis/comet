import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateApplicationEvaluationCompletion,
  recordApplicationEvaluationEvidence,
  readApplicationEvaluationEvidence,
} from '../../../domains/workflow-application/evaluation-evidence.js';
import { readWorkflowApplicationEvalResult } from '../../../domains/eval/application-eval.js';
import {
  applicationFilesHash,
  readApplicationFiles,
} from '../../../domains/workflow-application/skill-adapter.js';
import { writeApplicationCaseEvidence } from '../../helpers/application-evaluation-evidence.js';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-evidence-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const file = path.join(root, '.comet/eval/runs/example/application-result.json');
  const result = {
    schema: 'comet.workflow.application.eval.result.v1',
    experimentId: 'example',
    confirmationHash: 'b'.repeat(64),
    snapshotHash: '',
    application: { id: 'report', version: '1', contentHash: 'a'.repeat(64) },
    settings: { agent: 'test' },
    status: 'passed',
    taskNames: ['normal', 'rejected', 'recovery'],
    passed: 3,
    total: 3,
    report: 'summary.md',
    failures: [],
    limitations: [],
  };
  await writeApplicationCaseEvidence(file, result);
  const skillRoot = path.join(
    root,
    `.comet/eval/cache/application-${result.confirmationHash}/skill`,
  );
  await fs.mkdir(skillRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'SKILL.md'), 'fixed snapshot');
  result.snapshotHash = applicationFilesHash(await readApplicationFiles(skillRoot));
  await fs.writeFile(file, JSON.stringify(result));
  return {
    file,
    result,
    prepared: {
      projectRoot: root,
      resultFile: file,
      experimentId: 'example',
      skillRoot,
      snapshotHash: result.snapshotHash,
      preview: {
        application: result.application,
        settings: result.settings,
        confirmationHash: result.confirmationHash,
      },
    },
  };
}
it('accepts complete fixed evidence and revalidates historical distribution evidence', async () => {
  const { file, result } = await fixture();
  await expect(
    validateApplicationEvaluationCompletion(root, file, result),
  ).resolves.toBeUndefined();
  await recordApplicationEvaluationEvidence(root, file);
  expect((await readApplicationEvaluationEvidence(root, 'report', 'a'.repeat(64))).status).toBe(
    'passed',
  );
  await fs.unlink(path.join(path.dirname(file), 'reports/recovery_report.json'));
  expect((await readApplicationEvaluationEvidence(root, 'report', 'a'.repeat(64))).status).toBe(
    'stale',
  );
});
it.each([
  'missing',
  'duplicate',
  'extra',
  'treatment',
  'repetition',
  'repetition-conflict',
  'corrupt',
  'schema',
  'hash',
  'manifest',
  'symlink',
  'legacy',
  'matrix-duplicate',
  'metadata',
  'receipt',
  'manifest-symlink',
])('rejects incomplete or inconsistent historical evidence: %s', async (kind) => {
  const { file, result, prepared } = await fixture();
  const directory = path.dirname(file);
  const report = path.join(directory, 'reports/recovery_report.json');
  if (kind === 'missing') {
    await fs.unlink(report);
    result.taskNames = ['normal', 'rejected'];
    result.passed = 2;
    result.total = 2;
  }
  if (kind === 'duplicate')
    await fs.copyFile(path.join(directory, 'reports/normal_report.json'), report);
  if (kind === 'extra')
    await fs.copyFile(report, path.join(directory, 'reports/extra_report.json'));
  if (kind === 'corrupt') await fs.writeFile(report, '{');
  if (kind === 'treatment' || kind === 'repetition' || kind === 'repetition-conflict') {
    const raw = JSON.parse(await fs.readFile(report, 'utf8'));
    if (kind === 'treatment') raw.events_summary.treatment = 'OTHER';
    else {
      raw.rep = 2;
      if (kind === 'repetition-conflict') raw.events_summary.sample = 2;
    }
    await fs.writeFile(report, JSON.stringify(raw));
  }
  if (kind === 'schema' || kind === 'hash') {
    const matrix = path.join(directory, 'expected-case-matrix.json');
    const raw = JSON.parse(await fs.readFile(matrix, 'utf8'));
    if (kind === 'schema') raw.schema = 'unknown';
    else raw.matrix_hash = 'sha256:' + '0'.repeat(64);
    await fs.writeFile(matrix, JSON.stringify(raw));
  }
  if (kind === 'manifest') {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    const manifest = 'evaluation:\n  tasks:\n    - name: normal\n    - name: rejected\n';
    await fs.writeFile(saved.taskSet.manifestPath, manifest);
    (result as any).taskSet.manifestHash =
      'sha256:' + createHash('sha256').update(manifest).digest('hex');
  }
  if (kind === 'symlink') {
    await fs.rename(report, report + '.backup');
    await fs.symlink(report + '.backup', report);
  }

  if (kind === 'matrix-duplicate') {
    const matrixFile = path.join(directory, 'expected-case-matrix.json');
    const matrix = JSON.parse(await fs.readFile(matrixFile, 'utf8'));
    matrix.cases[1] = matrix.cases[0];
    matrix.matrix_hash =
      'sha256:' +
      createHash('sha256')
        .update(JSON.stringify({ cases: matrix.cases, schema: matrix.schema }))
        .digest('hex');
    await fs.writeFile(matrixFile, JSON.stringify(matrix));
  }
  if (kind === 'receipt')
    await fs.writeFile(
      path.join(directory, 'application-task-set.json'),
      JSON.stringify({
        schema: 'comet.workflow.application.eval.task-set.v1',
        experimentId: 'another',
      }),
    );
  if (kind === 'metadata')
    await fs.writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({ expected_case_matrix: { matrix_hash: 'changed', case_count: 3 } }),
    );
  if (kind === 'manifest-symlink') {
    const manifest = (result as any).taskSet.manifestPath;
    await fs.rename(manifest, manifest + '.original');
    await fs.symlink(manifest + '.original', manifest);
  }

  if (kind === 'legacy') await fs.unlink(path.join(directory, 'expected-case-matrix.json'));
  await fs.writeFile(file, JSON.stringify(result));
  await expect(validateApplicationEvaluationCompletion(root, file, result)).rejects.toThrow();
  await expect(readWorkflowApplicationEvalResult(prepared as any)).rejects.toThrow();
  await expect(recordApplicationEvaluationEvidence(root, file)).rejects.toThrow();
});

it('keeps a complete failed evaluation failed rather than rejecting its valid evidence', async () => {
  const { file, result, prepared } = await fixture();
  result.status = 'failed';
  result.passed = 2;
  await writeApplicationCaseEvidence(file, result);
  await fs.writeFile(file, JSON.stringify(result));
  await expect(readWorkflowApplicationEvalResult(prepared as any)).resolves.toMatchObject({
    status: 'failed',
  });
  await recordApplicationEvaluationEvidence(root, file);
  expect((await readApplicationEvaluationEvidence(root, 'report', 'a'.repeat(64))).status).toBe(
    'failed',
  );
});

it.each(['result', 'snapshot', 'root', 'absent', 'hash-traversal'])(
  'rejects prepared evidence outside the trusted project binding: %s',
  async (kind) => {
    const { prepared } = await fixture();
    if (kind === 'result') prepared.resultFile = path.join(root, 'application-result.json');
    if (kind === 'snapshot') prepared.skillRoot = path.join(root, 'skill');
    if (kind === 'root') prepared.projectRoot = path.dirname(root);
    if (kind === 'hash-traversal') prepared.preview.confirmationHash = '../../outside';
    if (kind === 'absent') delete (prepared as any).projectRoot;
    await expect(readWorkflowApplicationEvalResult(prepared as any)).rejects.toThrow(/项目|实验/);
  },
);

it('rejects a valid alternative fixed case set that was not confirmed', async () => {
  const { file, prepared } = await fixture();
  const result = JSON.parse(await fs.readFile(file, 'utf8'));
  (prepared.preview as any).taskSet = {
    ...result.taskSet,
    manifestHash: 'sha256:' + '0'.repeat(64),
  };
  await expect(readWorkflowApplicationEvalResult(prepared as any)).rejects.toThrow(/已确认预览/);
});

it('invalidates distribution evidence when the original fixed input snapshot drifts', async () => {
  const { file, result, prepared } = await fixture();
  Object.assign((result as any).taskSet, {
    sourceRoot: prepared.skillRoot,
    sourceSnapshotHash: prepared.snapshotHash,
  });
  await fs.writeFile(file, JSON.stringify(result));
  await recordApplicationEvaluationEvidence(root, file);
  expect((await readApplicationEvaluationEvidence(root, 'report', 'a'.repeat(64))).status).toBe(
    'passed',
  );
  await fs.appendFile(path.join(prepared.skillRoot, 'SKILL.md'), 'changed');
  expect((await readApplicationEvaluationEvidence(root, 'report', 'a'.repeat(64))).status).toBe(
    'stale',
  );
});
