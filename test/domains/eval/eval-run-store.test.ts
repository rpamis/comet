import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readEvalRun,
  listEvalRuns,
  setEvalBaseline,
  clearEvalBaseline,
  compareEvalRuns,
  readEvalArtifact,
} from '../../../domains/eval/eval-run-store.js';

describe('Eval run history and baselines', () => {
  let project: string;
  beforeEach(async () => {
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-runs-'));
  });
  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });
  async function report(id: string, outcomes: boolean[], quality = 'included', model = 'model-a') {
    const root = path.join(project, '.comet/eval/runs', id);
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
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
          name: `task-${index}`,
          passed: outcomes[index],
          rep: 1,
          checks_passed: ['[RUBRIC] artifact_quality: 0.80'],
          checks_failed: outcomes[index] ? [] : ['Expected clarification'],
          sample_quality: { status: quality, include_in_analysis: quality !== 'excluded' },
          events_summary: {
            task: `task-${index}`,
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
    expect(run.conclusion).toBe('passed');
    expect(run.baselineEligible).toBe(false);
    expect(run.availableActions.compare).toBe(false);
    await expect(setEvalBaseline(project, 'subset')).rejects.toThrow(/失败用例重跑/);
  });
});
