import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  readEvalRun,
  readEvalCasePage,
  readEvalCase,
  evalRunPath,
  listEvalRuns,
  setEvalBaseline,
  clearEvalBaseline,
  compareEvalRuns,
  readEvalArtifact,
  forgetEvalEvidenceReader,
} from '../../../domains/eval/eval-run-store.js';

function expectedMatrix(
  cases = [
    { rep: 1, task: 'task-0', treatment: 'task-0' },
    { rep: 1, task: 'task-1', treatment: 'task-1' },
  ],
) {
  const value = { cases, schema: 'comet.eval.expected-case-matrix.v1' };
  return {
    ...value,
    matrix_hash: `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`,
  };
}

describe('Eval run history and baselines', () => {
  let project: string;
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-runs-'));
  });
  afterEach(async () => {
    const runs = path.join(project, '.comet/eval/runs');
    for (const id of await fs.readdir(runs).catch(() => []))
      forgetEvalEvidenceReader(path.join(runs, id));
    await fs.rm(project, { recursive: true, force: true });
  });
  async function report(id: string, outcomes: boolean[], quality = 'included', model = 'model-a') {
    const root = path.join(project, '.comet/eval/runs', id);
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'expected-case-matrix.json'),
      JSON.stringify(
        expectedMatrix(
          outcomes
            .map((_, index) => ({ rep: 1, task: `task-${index}`, treatment: `task-${index}` }))
            .sort((a, b) => (a.task < b.task ? -1 : 1)),
        ),
      ),
    );
    await fs.writeFile(
      path.join(root, 'metadata.json'),
      JSON.stringify({
        experiment_id: id,
        started_at: '2026-10-10T10:00:00Z',
        completed_at: '2026-10-10T10:01:00Z',
        expected_case_matrix: { case_count: outcomes.length },
      }),
    );
    for (let index = 0; index < outcomes.length; index++) {
      await fs.writeFile(
        path.join(root, 'reports', `case-${index}_report.json`),
        JSON.stringify({
          name: `task-${index}-task-${index}`,
          passed: outcomes[index],
          rep: 1,
          checks_passed: ['[RUBRIC] artifact_quality: 0.80'],
          checks_failed: outcomes[index] ? [] : ['Expected clarification'],
          sample_quality: { status: quality, include_in_analysis: quality !== 'excluded' },
          events_summary: {
            task: `task-${index}`,
            treatment: `task-${index}`,
            sample: 1,
            prompt: '请生成本周报告',
            final_response: '请先提供本周数据',
            total_tokens: 100,
            duration_seconds: 10,
            role_models: { subject: model },
            role_agents: { subject: 'codex' },
            skill_sources: [
              { name: 'report-writer', path: 'skills/report-writer', hash: 'old-content' },
            ],
            case_manifest: {
              task_hash: `task-${index}`,
              validator_hash: 'rubric-v1',
              data_hash: 'data-v1',
            },
          },
        }),
      );
    }
    await fs.writeFile(path.join(root, 'summary.md'), '# Eval report');
    return root;
  }
  it('repairs only legacy repetitions proven by controller name, file identity and validated matrix', async () => {
    const root = await report('legacy-reps', [true, true]);
    const matrix = expectedMatrix([
      { rep: 1, task: 'task', treatment: 'BASE' },
      { rep: 2, task: 'task', treatment: 'BASE' },
    ]);
    await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(matrix));
    for (let i = 0; i < 2; i++) {
      const file = path.join(root, `reports/case-${i}_report.json`);
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      raw.name = `task-BASE-r${i + 1}`;
      raw.events_summary.task = 'task';
      raw.events_summary.treatment = 'BASE';
      raw.events_summary.sample = 1;
      await fs.writeFile(
        path.join(root, `reports/task_BASE_r${i + 1}_rep1_report.json`),
        JSON.stringify(raw),
      );
      await fs.unlink(file);
    }
    const run = await readEvalRun(project, 'legacy-reps');
    expect(run.cases.map((item) => item.repetition)).toEqual([1, 2]);
    expect(run.conclusion).toBe('passed');
    expect(
      (await readEvalCase(project, 'legacy-reps', 'task_BASE_r2_rep1_report.json')).repetition,
    ).toBe(2);
    const warm = await readEvalRun(project, 'legacy-reps', { includeCaseContent: false });
    expect(warm.cases.map((item) => item.repetition)).toEqual([1, 2]);
    const metadataPath = path.join(root, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    metadata.expected_case_matrix.matrix_hash = 'forged-declaration';
    await fs.writeFile(metadataPath, JSON.stringify(metadata));
    expect(
      (await readEvalRun(project, 'legacy-reps', { includeCaseContent: false })).cases.map(
        (item) => item.repetition,
      ),
    ).toEqual([1, 1]);
    delete metadata.expected_case_matrix.matrix_hash;
    await fs.writeFile(metadataPath, JSON.stringify(metadata));
    expect(
      (await readEvalRun(project, 'legacy-reps', { includeCaseContent: false })).cases.map(
        (item) => item.repetition,
      ),
    ).toEqual([1, 2]);
    matrix.cases[1].rep = 3;
    await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(matrix));
    expect(
      (await readEvalRun(project, 'legacy-reps', { includeCaseContent: false })).cases.map(
        (item) => item.repetition,
      ),
    ).toEqual([1, 1]);
    matrix.matrix_hash = 'forged';
    await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(matrix));
    expect((await readEvalRun(project, 'legacy-reps')).conclusion).toBe('incomplete');
  });
  it('aggregates every report beyond 2000 and pages failed cases with on-demand evidence', async () => {
    await report(
      'large',
      Array.from({ length: 2001 }, (_, i) => i !== 999),
    );
    const summary = await readEvalRun(project, 'large', { includeCaseContent: false });
    expect(summary.total).toBe(2001);
    expect(summary.conclusion).toBe('failed');
    expect(summary.baselineEligible).toBe(true);
    expect(summary.cases.every((item) => item.finalResponse === null)).toBe(true);
    const page = await readEvalCasePage(project, 'large', {
      status: 'failed',
      q: 'task-999',
      limit: 1,
    });
    expect(page.total).toBe(1);
    expect(page.items[0].task).toBe('task-999');
    expect((await readEvalCase(project, 'large', page.items[0].id)).finalResponse).toBe(
      '请先提供本周数据',
    );
    const last = await readEvalCasePage(project, 'large', { offset: 2000, limit: 1 });
    expect(last.items).toHaveLength(1);
    expect(last.nextOffset).toBeNull();
  }, 30000);
  it('keeps report bodies out of summary caches and rereads only changed files', async () => {
    const root = await report('bodies', [true, true]);
    const file = path.join(root, 'reports/case-0_report.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    raw.events_summary.final_response = 'x'.repeat(1024 * 1024);
    raw.events_summary.prompt = 'p'.repeat(1024 * 1024) + 'needle-beyond-excerpt';
    await fs.writeFile(file, JSON.stringify(raw));
    const summary = await readEvalRun(project, 'bodies', { includeCaseContent: false });
    expect(JSON.stringify(summary).length).toBeLessThan(20000);
    expect((await readEvalCasePage(project, 'bodies', { q: 'needle-beyond-excerpt' })).total).toBe(
      1,
    );
    const spy = vi.spyOn(fs, 'readFile');
    try {
      await readEvalRun(project, 'bodies', { includeCaseContent: false });
      expect(spy.mock.calls.filter(([name]) => String(name).endsWith('_report.json'))).toHaveLength(
        0,
      );
      raw.passed = false;
      await fs.writeFile(file, JSON.stringify(raw));
      expect((await readEvalRun(project, 'bodies', { includeCaseContent: false })).conclusion).toBe(
        'failed',
      );
      expect(spy.mock.calls.filter(([name]) => String(name).endsWith('_report.json'))).toHaveLength(
        1,
      );
    } finally {
      spy.mockRestore();
    }
  });
  it('skips individually oversized reports without starving other runs or later files', async () => {
    for (const id of ['large-a', 'large-b']) {
      const root = await report(id, [true, true]);
      const file = path.join(root, 'reports/case-0_report.json');
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      raw.events_summary.prompt = 'x'.repeat(8 * 1024 * 1024);
      await fs.writeFile(file, JSON.stringify(raw));
    }
    await report('healthy', [true]);
    for (let pass = 0; pass < 3; pass++) {
      for (const id of ['large-a', 'large-b', 'healthy']) {
        const run = await readEvalRun(project, id, {
          resumable: true,
          includeCaseContent: false,
          maxReportBytes: 8 * 1024 * 1024,
        });
        expect(run.cases).toHaveLength(1);
        expect(run.diagnostics.join(' ')).not.toContain('等待公平续扫');
        if (id !== 'healthy') {
          expect(run.diagnostics.join(' ')).toContain('单份报告超过 maxReportBytes');
          expect(run.baselineEligible).toBe(false);
        }
      }
    }
    await report('large-a', [true, true]);
    const expanded = await readEvalRun(project, 'large-a', {
      resumable: true,
      includeCaseContent: false,
      maxReportBytes: 16 * 1024 * 1024,
    });
    expect(expanded.cases).toHaveLength(2);
  });
  it('discloses exhausted report budgets rather than silently truncating', async () => {
    await report('budget', [true, true]);
    const run = await readEvalRun(project, 'budget', {
      includeCaseContent: false,
      maxReportBytes: 1,
    });
    expect(run.conclusion).toBe('incomplete');
    expect(run.baselineEligible).toBe(false);
    expect(run.diagnostics.join(' ')).toContain('单份报告超过 maxReportBytes');
  });
  it('converges across three large interleaved runs without rereading validated evidence', async () => {
    const ids = ['fair-a', 'fair-b', 'fair-c'];
    const original = new Map<string, string>();
    for (const id of ids) {
      const root = await report(
        id,
        Array.from({ length: 100 }, () => false),
      );
      for (const file of await fs.readdir(path.join(root, 'reports'))) {
        const name = path.join(root, 'reports', file);
        const raw = JSON.parse(await fs.readFile(name, 'utf8'));
        raw.checks_failed = Array.from({ length: 100 }, (_, n) => `${n}: ${'x'.repeat(990)}`);
        const bytes = JSON.stringify(raw);
        await fs.writeFile(name, bytes);
        original.set(name, createHash('sha256').update(bytes).digest('hex'));
      }
    }
    const options = {
      resumable: true,
      includeCaseContent: false,
      maxReportBytes: 8 * 1024 * 1024,
      maxReadMs: 60000,
    };
    const spy = vi.spyOn(fs, 'readFile');
    try {
      for (let pass = 0; pass < 4; pass++) {
        for (const id of ids) {
          const run = await readEvalRun(project, id, options);
          if (!pass) expect(run.total).toBeLessThan(100);
          else {
            expect(run.total).toBe(100);
            expect(run.conclusion).toBe('failed');
            expect(run.baselineEligible).toBe(true);
            expect(run.diagnostics).toEqual([]);
          }
        }
      }
      expect(spy.mock.calls.filter(([file]) => String(file).endsWith('_report.json'))).toHaveLength(
        300,
      );
    } finally {
      spy.mockRestore();
    }
    for (const [file, hash] of original)
      expect(
        createHash('sha256')
          .update(await fs.readFile(file))
          .digest('hex'),
      ).toBe(hash);
    // 完整读取释放旧续扫状态；后续仍能通过原始报告重新收敛。
    await readEvalRun(project, ids[0], { includeCaseContent: false });
    expect((await readEvalRun(project, ids[0], options)).total).toBe(100);
  }, 60000);

  it('revalidates changed reports and refuses tampered continuation summaries', async () => {
    const root = await report('integrity', [true, true]);
    const reportFile = path.join(root, 'reports/case-0_report.json');
    const spy = vi.spyOn(fs, 'writeFile');
    const options = { resumable: true, includeCaseContent: false };
    await readEvalRun(project, 'integrity', options);
    const spoolFile = spy.mock.calls
      .map(([file]) => String(file))
      .find((file) => file.includes('comet-eval-readers-'));
    spy.mockRestore();
    expect(spoolFile).toBeTruthy();
    const spool = JSON.parse(await fs.readFile(spoolFile!, 'utf8'));
    spool.entries[0][1].item.passed = false;
    await fs.writeFile(spoolFile!, JSON.stringify(spool));
    expect((await readEvalRun(project, 'integrity', options)).conclusion).toBe('passed');
    const raw = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    raw.passed = false;
    await fs.writeFile(reportFile, JSON.stringify(raw));
    expect((await readEvalRun(project, 'integrity', options)).conclusion).toBe('failed');
  });
  it('queues concurrent runs fairly with at most two active readers', async () => {
    const ids = ['concurrent-a', 'concurrent-b', 'concurrent-c', 'concurrent-d'];
    for (const id of ids) await report(id, [true, true]);
    const original = fs.readFile;
    let active = 0,
      maximum = 0;
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockImplementation(async (...args: Parameters<typeof fs.readFile>) => {
        if (!String(args[0]).endsWith('_report.json')) return original(...args);
        active++;
        maximum = Math.max(maximum, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return await original(...args);
        } finally {
          active--;
        }
      });
    try {
      for (let pass = 0; pass < 3; pass++) {
        const runs = await Promise.all(
          ids.map((id) => readEvalRun(project, id, { resumable: true, includeCaseContent: false })),
        );
        expect(runs.map((run) => run.total)).toEqual([2, 2, 2, 2]);
        expect(runs.every((run) => run.conclusion === 'passed' && !run.diagnostics.length)).toBe(
          true,
        );
      }
      expect(maximum).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
  it('makes progress when cached path checks exceed the uncached report time budget', async () => {
    const root = await report(
      'slow-paths',
      Array.from({ length: 12 }, () => true),
    );
    const size = (await fs.stat(path.join(root, 'reports/case-0_report.json'))).size;
    const original = fs.lstat;
    const spy = vi
      .spyOn(fs, 'lstat')
      .mockImplementation(async (...args: Parameters<typeof fs.lstat>) => {
        if (String(args[0]).endsWith('_report.json'))
          await new Promise((resolve) => setTimeout(resolve, 5));
        return original(...args);
      });
    try {
      let total = 0;
      for (let pass = 0; pass < 13; pass++) {
        const run = await readEvalRun(project, 'slow-paths', {
          resumable: true,
          includeCaseContent: false,
          maxReportBytes: size * 2,
          maxReadMs: 1,
        });
        expect(run.total).toBeGreaterThan(total);
        total = run.total;
        if (total === 12) {
          expect(run.conclusion).toBe('passed');
          expect(run.baselineEligible).toBe(true);
          expect(run.diagnostics).toEqual([]);
          break;
        }
      }
      expect(total).toBe(12);
    } finally {
      spy.mockRestore();
    }
  });
  it('recreates a removed private cache directory and retries a transient creation failure', async () => {
    await report('cache-recovery', [true, true]);
    const options = { resumable: true, includeCaseContent: false };
    const writes = vi.spyOn(fs, 'writeFile');
    try {
      await readEvalRun(project, 'cache-recovery', options);
      const file = writes.mock.calls
        .map(([name]) => String(name))
        .find((name) => name.includes('comet-eval-readers-'))!;
      expect(file).toBeTruthy();
      await fs.unlink(file);
      await fs.rmdir(path.dirname(file));
      const mkdir = vi
        .spyOn(fs, 'mkdtemp')
        .mockRejectedValueOnce(
          Object.assign(new Error('temporarily unavailable'), { code: 'EACCES' }),
        );
      try {
        expect(
          (await readEvalRun(project, 'cache-recovery', options)).diagnostics.join(' '),
        ).toContain('temporarily unavailable');
        const recovered = await readEvalRun(project, 'cache-recovery', options);
        expect(recovered.conclusion).toBe('passed');
        expect(recovered.diagnostics).toEqual([]);
        expect(mkdir).toHaveBeenCalledTimes(2);
        const nextFile = String(writes.mock.calls.at(-1)![0]);
        expect(path.dirname(nextFile)).not.toBe(path.dirname(file));
        await expect(fs.access(nextFile)).resolves.toBeUndefined();
        await readEvalRun(project, 'cache-recovery', { includeCaseContent: false });
        await expect(fs.access(nextFile)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        mkdir.mockRestore();
      }
    } finally {
      writes.mockRestore();
    }
  });
  it('checks every path component once and never reuses a previous symlink check', async () => {
    const root = await report('paths', [true]);
    const canonicalProject = await fs.realpath(project);
    const inspected: string[] = [];
    const lstat = fs.lstat;
    const spy = vi.spyOn(fs, 'lstat').mockImplementation((...args: Parameters<typeof fs.lstat>) => {
      inspected.push(String(args[0]));
      return lstat(...args);
    });
    try {
      await evalRunPath(project, 'paths', 'reports/case-0_report.json');
      expect(inspected).toEqual(
        [
          '.comet',
          '.comet/eval',
          '.comet/eval/runs',
          '.comet/eval/runs/paths',
          '.comet/eval/runs/paths/reports',
          '.comet/eval/runs/paths/reports/case-0_report.json',
        ].map((relative) => path.join(canonicalProject, relative)),
      );
    } finally {
      spy.mockRestore();
    }
    await expect(evalRunPath(project, 'paths', '../other/metadata.json')).rejects.toThrow(/越界/);
    const file = path.join(root, 'reports/case-0_report.json');
    await fs.rm(file);
    await fs.symlink(path.join(root, 'metadata.json'), file);
    await expect(evalRunPath(project, 'paths', 'reports/case-0_report.json')).rejects.toThrow(
      /符号链接/,
    );
  });

  it('keeps bounded parallel report reads and diagnostics in sorted file order', async () => {
    const root = await report(
      'ordered',
      Array.from({ length: 12 }, () => true),
    );
    for (const index of [2, 10])
      await fs.writeFile(path.join(root, `reports/case-${index}_report.json`), '{broken');
    const run = await readEvalRun(project, 'ordered');
    expect(run.cases.map((item) => item.task)).toEqual([
      'task-0',
      'task-11',
      'task-1',
      'task-3',
      'task-4',
      'task-5',
      'task-6',
      'task-7',
      'task-8',
      'task-9',
    ]);
    expect(
      run.diagnostics
        .filter((message) => message.startsWith('reports/'))
        .map((message) => message.split('：')[0]),
    ).toEqual(['reports/case-10_report.json', 'reports/case-2_report.json']);
    expect(run.baselineEligible).toBe(false);
  });

  it('discovers completed CLI reports without treating missing cost as zero', async () => {
    await report('run-a', [true, false]);
    const runs = await listEvalRuns(project);
    expect(runs).toHaveLength(1);
    const detail = await readEvalRun(project, 'run-a');
    expect(detail).toMatchObject({
      id: 'run-a',
      executionStatus: 'completed',
      conclusion: 'failed',
      passed: 1,
      total: 2,
    });
    expect(detail.metrics.knownCostUsd).toBeNull();
    expect(detail.metrics.tokens).toBe(200);
    expect(detail.cases[1].checksFailed).toEqual(['Expected clarification']);
    expect(detail.cases[1]).toMatchObject({
      prompt: '请生成本周报告',
      finalResponse: '请先提供本周数据',
    });
  });
  it('accepts complete matrix identities and rejects a missing declared matrix', async () => {
    // Python aligned_comparison 的 canonical JSON 摘要。
    expect(expectedMatrix().matrix_hash).toBe(
      'sha256:1df97462f707cd25cdc31ecea8c11e8b9e7e97ec1eeb9e735fb62fd178ba5fe7',
    );
    const root = await report('matrix', [true, true]);
    const metadataFile = path.join(root, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
    metadata.expected_case_matrix.matrix_hash = expectedMatrix().matrix_hash;
    await fs.unlink(path.join(root, 'expected-case-matrix.json'));
    await fs.writeFile(metadataFile, JSON.stringify(metadata));
    expect((await readEvalRun(project, 'matrix')).baselineEligible).toBe(false);
    await fs.writeFile(
      path.join(root, 'expected-case-matrix.json'),
      JSON.stringify(expectedMatrix()),
    );
    expect((await readEvalRun(project, 'matrix')).baselineEligible).toBe(true);
    expect((await setEvalBaseline(project, 'matrix')).isBaseline).toBe(true);
  });

  it.each(['null', '[]', '{broken'])(
    'rejects unreadable matrix JSON %s without falling back to the case count',
    async (contents) => {
      const root = await report('invalid-json', [true, true]);
      await fs.writeFile(path.join(root, 'expected-case-matrix.json'), contents);
      const run = await readEvalRun(project, 'invalid-json');
      expect(run.baselineEligible).toBe(false);
      expect(run.cases).toHaveLength(2);
      expect(run.diagnostics.join(' ')).toContain('expected-case-matrix.json');
    },
  );

  it.each(['hash', 'schema', 'metadata-binding', 'order', 'extra-field', 'rep'])(
    'rejects invalid matrix %s even when all reports pass',
    async (damage) => {
      const root = await report('invalid-matrix', [true, true]);
      const matrix = expectedMatrix();
      const metadataFile = path.join(root, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
      metadata.expected_case_matrix.matrix_hash =
        damage === 'metadata-binding' ? 'sha256:original' : matrix.matrix_hash;
      await fs.writeFile(metadataFile, JSON.stringify(metadata));
      if (damage === 'hash') matrix.matrix_hash = 'sha256:changed';
      if (damage === 'schema') matrix.schema = 'wrong-schema';
      if (damage === 'order') matrix.cases.reverse();
      if (damage === 'extra-field') Object.assign(matrix, { unexpected: true });
      if (damage === 'rep') matrix.cases[0].rep = 1.5;
      await fs.writeFile(path.join(root, 'expected-case-matrix.json'), JSON.stringify(matrix));
      const run = await readEvalRun(project, 'invalid-matrix');
      expect(run.cases).toHaveLength(2);
      expect(run.conclusion).toBe('incomplete');
      expect(run.baselineEligible).toBe(false);
      await expect(setEvalBaseline(project, 'invalid-matrix')).rejects.toThrow(/完整/);
    },
  );

  it.each(['missing', 'duplicate', 'wrong-case'])(
    'rejects a passed application summary with %s case evidence',
    async (damage) => {
      const root = await report('application', [true, true]);
      await fs.writeFile(
        path.join(root, 'application-result.json'),
        JSON.stringify({ status: 'passed', application: { id: 'app' }, passed: 2, total: 2 }),
      );
      const first = path.join(root, 'reports/case-0_report.json');
      const second = path.join(root, 'reports/case-1_report.json');
      if (damage === 'missing') await fs.rm(second);
      if (damage === 'duplicate') await fs.copyFile(first, second);
      if (damage === 'wrong-case')
        await fs.writeFile(
          path.join(root, 'expected-case-matrix.json'),
          JSON.stringify({
            cases: [
              { task: 'task-0', treatment: 'task-0', rep: 1 },
              { task: 'missing-task', treatment: 'missing-task', rep: 1 },
            ],
          }),
        );
      const run = await readEvalRun(project, 'application');
      expect(run.conclusion).toBe('incomplete');
      expect(run.baselineEligible).toBe(false);
      expect(run.availableActions.setBaseline).toBe(false);
      await expect(setEvalBaseline(project, 'application')).rejects.toThrow(/完整/);
    },
  );

  it.each(['reports', 'report-file'])(
    'rejects cross-run evidence through a %s symlink',
    async (kind) => {
      const root = await report('linked', [true]);
      const other = await report('other', [true]);
      const ref = kind === 'reports' ? 'reports' : 'reports/case-0_report.json';
      await fs.rm(path.join(root, ref), { recursive: true });
      await fs.symlink(
        path.join(other, ref),
        path.join(root, ref),
        kind === 'reports' ? 'junction' : 'file',
      );
      const run = await readEvalRun(project, 'linked');
      expect(run.cases).toHaveLength(0);
      expect(run.conclusion).toBe('incomplete');
      expect(run.baselineEligible).toBe(false);
      expect(run.diagnostics.join(' ')).toMatch(/符号链接/);
      await expect(setEvalBaseline(project, 'linked')).rejects.toThrow(/完整/);
    },
  );

  it('permits complete failed evidence as baseline and requires explicit replacement', async () => {
    await report('baseline', [true, false]);
    await report('candidate', [true, true]);
    await setEvalBaseline(project, 'baseline');
    await expect(setEvalBaseline(project, 'candidate')).rejects.toThrow(/确认/);
    await setEvalBaseline(project, 'candidate', 'baseline');
    expect((await readEvalRun(project, 'candidate')).isBaseline).toBe(true);
    expect((await readEvalRun(project, 'baseline')).isBaseline).toBe(false);
    expect((await readEvalRun(project, 'baseline')).passed).toBe(1);
  });
  it('excludes infrastructure failures from baseline eligibility and comparison scores', async () => {
    await report('broken', [false], 'excluded');
    const run = await readEvalRun(project, 'broken');
    expect(run.conclusion).toBe('incomplete');
    await expect(setEvalBaseline(project, 'broken')).rejects.toThrow(/完整|异常/);
  });
  it.each([
    { exit: 1, outcomes: [true], expected: 'incomplete' },
    { exit: 2, outcomes: [true, false], expected: 'incomplete' },
    { exit: 3, outcomes: [true], expected: 'incomplete' },
    { exit: 1, outcomes: [true, false], expected: 'failed' },
    { exit: 0, outcomes: [true], expected: 'passed' },
  ])(
    'keeps harness exit $exit with $outcomes results $expected',
    async ({ exit, outcomes, expected }) => {
      const root = await report('harness-exit', outcomes);
      const metadataFile = path.join(root, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
      await fs.writeFile(metadataFile, JSON.stringify({ ...metadata, pytest_exitstatus: exit }));
      const run = await readEvalRun(project, 'harness-exit');
      expect(run.conclusion).toBe(expected);
      expect(run.baselineEligible).toBe(expected !== 'incomplete');
      if (expected === 'incomplete') {
        expect(run.diagnostics.join('\n')).toMatch(/pytest|执行|异常/);
        await expect(setEvalBaseline(project, 'harness-exit')).rejects.toThrow(/完整|异常/);
      }
    },
  );
  it('keeps mixed case failures and harness errors out of baselines', async () => {
    const root = await report('mixed-error', [true, false]);
    const file = path.join(root, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(
      file,
      JSON.stringify({ ...metadata, pytest_exitstatus: 1, pytest_errors: 1 }),
    );
    expect((await readEvalRun(project, 'mixed-error')).conclusion).toBe('incomplete');
    await expect(setEvalBaseline(project, 'mixed-error')).rejects.toThrow(/完整|异常/);
  });

  it('keeps one baseline per fixed case set and clears only that set', async () => {
    const root = await report('baseline', [true, false]);
    await report('other-cases', [true]);
    await setEvalBaseline(project, 'baseline');
    await setEvalBaseline(project, 'other-cases');
    await fs.writeFile(
      path.join(root, 'dashboard-run.json'),
      JSON.stringify({
        schema: 'comet.eval.managed-run.v1',
        id: 'baseline',
        baselineRunId: 'bound-reference',
        config: {},
        status: 'completed',
      }),
    );
    const result = await clearEvalBaseline(project, 'baseline');
    expect(result).toMatchObject({
      isBaseline: false,
      baselineRunId: null,
      boundBaselineRunId: 'bound-reference',
      passed: 1,
    });
    expect(result.cases).toHaveLength(2);
    expect((await readEvalRun(project, 'other-cases')).isBaseline).toBe(true);
    await setEvalBaseline(project, 'baseline');
    expect((await readEvalRun(project, 'baseline')).isBaseline).toBe(true);
  });
  it('rejects clearing a replaced baseline so a stale page cannot remove the new one', async () => {
    await report('old', [true]);
    await report('new', [false]);
    await setEvalBaseline(project, 'old');
    await setEvalBaseline(project, 'new', 'old');
    await expect(clearEvalBaseline(project, 'old')).rejects.toMatchObject({ statusCode: 409 });
    expect((await readEvalRun(project, 'new')).isBaseline).toBe(true);
  });
  it('includes endpoint and Judge enablement changes in fixed-case comparisons', async () => {
    for (const [id, baseUrl, judgeEnabled] of [
      ['baseline', 'https://endpoint-a.example', true],
      ['candidate', 'https://endpoint-b.example', false],
    ] as const) {
      const root = await report(id, [true]);
      await fs.writeFile(
        path.join(root, 'dashboard-run.json'),
        JSON.stringify({
          schema: 'comet.eval.managed-run.v1',
          id,
          origin: 'dashboard',
          status: 'completed',
          config: {
            target: 'skills/report-writer',
            targetType: 'skill',
            agent: 'codex',
            model: 'model-a',
            baseUrl,
            judgeEnabled,
          },
          targetId: 'skills/report-writer',
          contentHash: 'old-content',
          createdAt: '2026-10-10T10:00:00Z',
          updatedAt: '2026-10-10T10:01:00Z',
        }),
      );
    }
    const comparison = await compareEvalRuns(project, 'candidate', 'baseline');
    expect(comparison.comparable).toBe(true);
    expect(comparison.configurationChanges).toContainEqual({
      field: 'baseUrl',
      baseline: 'https://endpoint-a.example',
      candidate: 'https://endpoint-b.example',
    });
    expect(comparison.configurationChanges).toContainEqual({
      field: 'judgeEnabled',
      baseline: true,
      candidate: false,
    });
  });
  it('compares fixed cases and reports model differences without changing the default', async () => {
    await report('baseline', [true, false]);
    await report('candidate', [true, true], 'included', 'model-b');
    await setEvalBaseline(project, 'baseline');
    const comparison = await compareEvalRuns(project, 'candidate', 'baseline');
    expect(comparison).toMatchObject({ comparable: true, improved: 1, regressed: 0 });
    expect(comparison.configurationChanges).toContainEqual({
      field: 'model',
      baseline: 'model-a',
      candidate: 'model-b',
    });
    expect((await readEvalRun(project, 'baseline')).isBaseline).toBe(true);
  });
  it('rejects traversal and only exposes contained artifact files', async () => {
    await report('run-a', [true]);
    await expect(readEvalRun(project, '..')).rejects.toThrow();
    await expect(readEvalArtifact(project, 'run-a', '../metadata.json')).rejects.toThrow();
    expect(await readEvalArtifact(project, 'run-a', 'summary.md')).toMatchObject({
      content: '# Eval report',
      format: 'markdown',
    });
  });
  it('reads bounded progress without letting it change case conclusions', async () => {
    const root = await report('run-a', [false]);
    const secret = 'private-progress-secret';
    const previous = process.env.TEST_PROGRESS_TOKEN;
    process.env.TEST_PROGRESS_TOKEN = secret;
    try {
      await fs.writeFile(
        path.join(root, 'progress.json'),
        JSON.stringify({
          schema: 'comet.eval.progress.v1',
          runId: 'run-a',
          phase: 'judging',
          passed: true,
          updatedAt: '2026-10-11T10:00:00Z',
          currentCase: { task: 'task-0', repetition: 2 },
          activities: [
            { id: 'event-1', at: '2026-10-11T10:00:00Z', kind: 'tool', message: `Read ${secret}` },
          ],
        }),
      );
      const run = await readEvalRun(project, 'run-a');
      expect(run.conclusion).toBe('failed');
      expect(run.progress).toMatchObject({
        phase: 'judging',
        currentCase: { task: 'task-0', repetition: 2 },
      });
      expect(JSON.stringify(run.progress)).not.toContain(secret);
      await fs.writeFile(
        path.join(root, 'progress.json'),
        JSON.stringify({ schema: 'comet.eval.progress.v1', runId: 'another', phase: 'running' }),
      );
      expect((await readEvalRun(project, 'run-a')).progress).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.TEST_PROGRESS_TOKEN;
      else process.env.TEST_PROGRESS_TOKEN = previous;
    }
  });
  it('previews recent complete log lines while preserving full downloads', async () => {
    const root = await report('run-a', [true]);
    const content = '旧日志\n'.repeat(50000) + '最新执行活动\n';
    await fs.writeFile(path.join(root, 'execution.log'), content);
    const tail = await readEvalArtifact(project, 'run-a', 'execution.log', { tail: true });
    expect(tail.truncated).toBe(true);
    expect(tail.content.endsWith('最新执行活动\n')).toBe(true);
    expect(Buffer.byteLength(tail.content)).toBeLessThanOrEqual(256 * 1024);
    expect(tail.content).not.toContain('\ufffd');
    expect((await readEvalArtifact(project, 'run-a', 'execution.log')).content).toBe(content);
    await expect(readEvalArtifact(project, 'run-a', 'summary.md', { tail: true })).rejects.toThrow(
      /执行日志/,
    );
  });
  it('labels a completed retry subset without allowing a full baseline', async () => {
    const root = await report('subset', [true]);
    await fs.writeFile(
      path.join(root, 'dashboard-run.json'),
      JSON.stringify({
        schema: 'comet.eval.managed-run.v1',
        id: 'subset',
        status: 'completed',
        config: {
          target: 'skills/report-writer',
          targetType: 'skill',
          retrySourceRunId: 'original',
        },
        targetId: 'writer',
        contentHash: 'current',
      }),
    );
    const run = await readEvalRun(project, 'subset');
    expect(run.conclusion).toBe('incomplete');
    expect(run.subsetConclusion).toBe('passed');
    expect(run.baselineEligible).toBe(false);
    expect(run.availableActions.compare).toBe(false);
    await expect(setEvalBaseline(project, 'subset')).rejects.toThrow(/失败用例重跑/);
  });
});
