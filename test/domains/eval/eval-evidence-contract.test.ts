import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  parseEvaluationMatrix,
  validateEvaluationCase,
} from '../../../domains/workflow-application/evaluation-case-evidence.js';
import {
  readEvalRun,
  readEvalCasePage,
  readEvalEvidenceRevision,
  setEvalBaseline,
  clearEvalBaseline,
} from '../../../domains/eval/eval-run-store.js';
import { repairEvalResults } from '../../../domains/eval/eval-run-repair.js';
const roots: string[] = [];
const producerPython = path.resolve(
  process.platform === 'win32' ? 'eval/.venv/Scripts/python.exe' : 'eval/.venv/bin/python',
);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(id: string, count = 2, promptSize = 0) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-evidence-'));
  roots.push(project);
  const root = path.join(project, '.comet/eval/runs', id);
  await fs.mkdir(path.join(root, 'reports'), { recursive: true });
  const cases = Array.from({ length: count }, (_, i) => ({
    rep: 1,
    task: `task${String(i).padStart(3, '0')}`,
    treatment: 'BASE',
  }));
  const matrix = { cases, schema: 'comet.eval.expected-case-matrix.v1' };
  const published = {
    ...matrix,
    matrix_hash: 'sha256:' + createHash('sha256').update(JSON.stringify(matrix)).digest('hex'),
  };
  await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(published));
  await fs.writeFile(
    path.join(root, 'metadata.json'),
    JSON.stringify({
      experiment_id: id,
      completed_at: '2026-10-01',
      expected_case_matrix: { case_count: count, matrix_hash: published.matrix_hash },
    }),
  );
  for (const item of cases)
    await fs.writeFile(
      path.join(root, 'reports', `${item.task}_report.json`),
      JSON.stringify({
        name: `${item.task}-BASE`,
        rep: 1,
        passed: false,
        sample_quality: { status: 'included' },
        checks_failed: ['task failed'],
        checks_passed: Array.from({ length: 105 }, (_, i) => `[RUBRIC] dim${i}: 0.5`),
        events_summary: {
          task: item.task,
          treatment: 'BASE',
          sample: 1,
          prompt: 'x'.repeat(promptSize) + '尾部检索',
          case_manifest: { task_hash: item.task, validator_hash: 'v1' },
        },
      }),
    );
  return { project, root };
}
describe('统一 Eval 证据契约', () => {
  it('Python 与 TS 共用固定身份 golden', async () => {
    const golden = JSON.parse(await fs.readFile('config/eval-evidence-golden.json', 'utf8'));
    const expected = parseEvaluationMatrix(golden.matrix);
    expect(
      validateEvaluationCase(
        golden.valid,
        golden.experiment,
        'alpha_BASE_r2_rep2_report.json',
        expected,
      ).rep,
    ).toBe(2);
    expect(() =>
      validateEvaluationCase(
        { ...golden.valid, case_identity: { ...golden.valid.case_identity, experiment: 'other' } },
        golden.experiment,
        'x_report.json',
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseEvaluationMatrix({ ...golden.matrix, cases: [...golden.matrix.cases].reverse() }),
    ).toThrow();
  });
  it('保留105维、完整失败可做基线，坏JSON版本不同且修复保留原字节', async () => {
    const { project, root } = await fixture('repair', 24, 400 * 1024);
    const before = await readEvalRun(project, 'repair', { includeCaseContent: false });
    expect(before.conclusion).toBe('failed');
    expect(Object.keys(before.cases[0].scores)).toHaveLength(105);
    await setEvalBaseline(project, 'repair');
    await fs.writeFile(
      path.join(root, 'execution-state.json'),
      JSON.stringify({ schema: 'comet.eval.execution.v1', runId: 'repair', status: 'completed' }),
    );
    await fs.writeFile(path.join(root, 'metadata.json'), '{broken:one');
    const stale = await readEvalEvidenceRevision(project, 'repair');
    await fs.writeFile(path.join(root, 'metadata.json'), '{broken:two');
    const current = await readEvalEvidenceRevision(project, 'repair');
    expect(current).not.toBe(stale);
    await expect(repairEvalResults(project, 'repair', stale, true)).rejects.toThrow('已变化');
    const repaired = await repairEvalResults(project, 'repair', current, true);
    expect(repaired.conclusion).toBe('failed');
    expect(repaired.total).toBe(24);
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'results-repair.json'), 'utf8'));
    expect(await fs.readFile(path.join(root, receipt.retained, 'metadata.json'), 'utf8')).toBe(
      '{broken:two',
    );
    expect((await fs.stat(path.join(root, 'report-generation.json'))).size).toBeLessThan(
      1024 * 1024,
    );
    await clearEvalBaseline(project, 'repair', { scope: before.baselineScope!, runId: 'repair' });
    expect((await readEvalRun(project, 'repair')).isBaseline).toBe(false);
  });
  it('修复损坏metadata不补造丢失的执行完成状态', async () => {
    const { project, root } = await fixture('unknown-execution');
    await fs.writeFile(path.join(root, 'metadata.json'), '{corrupt');
    const repaired = await repairEvalResults(
      project,
      'unknown-execution',
      await readEvalEvidenceRevision(project, 'unknown-execution'),
      true,
    );
    expect(repaired.executionStatus).toBe('unknown');
    expect(repaired.completeness).toBe('complete');
    expect(repaired.conclusion).toBe('incomplete');
    expect(repaired.baselineEligible).toBe(false);
  });
  it('坏发布索引可从完整原报告重建，旧baseline按储存scope清理', async () => {
    const { project, root } = await fixture('broken-index');
    const baseline = await setEvalBaseline(project, 'broken-index');
    await fs.writeFile(path.join(root, 'report-generation.json'), '{broken-index');
    const revision = await readEvalEvidenceRevision(project, 'broken-index');
    const repaired = await repairEvalResults(project, 'broken-index', revision, true);
    expect(repaired.baselineEligible).toBe(true);
    const receipt = JSON.parse(await fs.readFile(path.join(root, 'results-repair.json'), 'utf8'));
    expect(
      await fs.readFile(path.join(root, receipt.retained, 'report-generation.json'), 'utf8'),
    ).toBe('{broken-index');
    await fs.unlink(path.join(root, 'reports/task000_report.json'));
    const damaged = await readEvalRun(project, 'broken-index');
    expect(damaged.isBaseline).toBe(true);
    expect(damaged.storedBaselineScope).toBe(baseline.baselineScope);
    await expect(
      clearEvalBaseline(project, 'broken-index', {
        scope: baseline.baselineScope!,
        runId: 'other',
      }),
    ).rejects.toThrow('已变化');
    expect(
      (
        await clearEvalBaseline(project, 'broken-index', {
          scope: baseline.baselineScope!,
          runId: 'broken-index',
        })
      ).isBaseline,
    ).toBe(false);
  });
  it.skipIf(!existsSync(producerPython))(
    '真实Python producer大输入发布、按页仅读选中报告、尾部检索与发布中断检测',
    async () => {
      const { project, root } = await fixture('producer', 5);
      execFileSync(
        producerPython,
        [
          '-c',
          `
import json,sys
from pathlib import Path
from scaffold.python.logging import save_report
root=Path(sys.argv[1])
for file in list((root/'reports').glob('*.json')):
    report=json.loads(file.read_text());file.unlink()
    report['events_summary']['prompt']='x'*(2*1024*1024)+'尾部检索'
    save_report(root,report['name'],1,report)
`,
          root,
        ],
        { cwd: path.resolve('eval') },
      );
      const run = await readEvalRun(project, 'producer', { includeCaseContent: false });
      expect(run.conclusion).toBe('failed');
      expect(Object.keys(run.cases[0].scores)).toHaveLength(105);
      await setEvalBaseline(project, 'producer');
      const read = vi.spyOn(fs, 'readFile');
      expect((await readEvalCasePage(project, 'producer', { limit: 1 })).items).toHaveLength(1);
      expect(read.mock.calls.filter(([file]) => String(file).includes('/reports/'))).toHaveLength(
        1,
      );
      read.mockRestore();
      expect((await readEvalCasePage(project, 'producer', { q: '尾部检索' })).total).toBe(5);
      const manifest = JSON.parse(
        await fs.readFile(path.join(root, 'report-generation.json'), 'utf8'),
      );
      expect(manifest.reports[0].summary.events_summary.prompt.length).toBe(2048);
      await fs.appendFile(path.join(root, 'reports', manifest.reports[0].file), ' ');
      await expect(readEvalCasePage(project, 'producer', { limit: 1 })).rejects.toThrow('发布版本');
      expect((await readEvalRun(project, 'producer')).baselineEligible).toBe(false);
    },
  );
  it('17个大型 run 在有界读取器轮换中复用摘要并最终完成', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 17 }, (_, i) => fixture(`fair-${i}`, 4, 300 * 1024)),
    );
    const finished = new Set<number>();
    for (let round = 0; round < 30 && finished.size < 17; round++)
      for (let i = 0; i < fixtures.length; i++) {
        if (finished.has(i)) continue;
        const run = await readEvalRun(fixtures[i].project, `fair-${i}`, {
          includeCaseContent: false,
          resumable: true,
          maxReportBytes: 500 * 1024,
          maxReadMs: 1000,
        });
        if (run.completeness === 'complete') finished.add(i);
      }
    expect(finished.size).toBe(17);
  }, 30000);
});
