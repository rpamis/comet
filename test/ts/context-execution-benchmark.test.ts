import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const benchmarkModule = pathToFileURL(
  path.resolve('scripts', 'context-execution-benchmark.mjs'),
).href;

const utilsModule = pathToFileURL(path.resolve('scripts', 'benchmark-utils.mjs')).href;

describe('context execution benchmark runner', () => {
  it('computes L1 design metrics from off and beta results', async () => {
    const { summarizeExecution } = await import(benchmarkModule);

    const summary = summarizeExecution([
      {
        phase: 'l1',
        mode: 'off',
        tier: 'medium',
        usage: { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 },
        durationMs: 10000,
        costUsd: 0.1,
        context: { chars: 3000, lines: 80, approxTokens: 750 },
        verdict: {
          requirementsCovered: 7,
          requirementsTotal: 8,
          decisionsCount: 4,
          risksIdentified: 3,
          coverageRate: 0.875,
        },
      },
      {
        phase: 'l1',
        mode: 'beta',
        tier: 'medium',
        usage: { inputTokens: 1200, outputTokens: 400, totalTokens: 1600 },
        durationMs: 7000,
        costUsd: 0.06,
        context: { chars: 1500, lines: 40, approxTokens: 375 },
        verdict: {
          requirementsCovered: 8,
          requirementsTotal: 8,
          decisionsCount: 3,
          risksIdentified: 2,
          coverageRate: 1,
        },
      },
    ]);

    expect(summary.l1).toBeDefined();
    expect(summary.l1.tokenSavings.totalTokens).toBe(900);
    expect(summary.l1.tokenSavings.percent).toBe(36);
    expect(summary.l1.modes.off.avgCoverageRate).toBe(0.88);
    expect(summary.l1.modes.beta.avgCoverageRate).toBe(1);
    expect(summary.l1.modes.beta.avgDecisionsCount).toBe(3);
  });

  it('computes L2 build metrics from off and beta results', async () => {
    const { summarizeExecution } = await import(benchmarkModule);

    const summary = summarizeExecution([
      {
        phase: 'l2',
        mode: 'off',
        tier: 'medium',
        usage: { inputTokens: 2000, outputTokens: 500, totalTokens: 2500 },
        attempts: 2,
        testResult: {
          testsTotal: 5,
          testsPassed: 4,
          testsFailed: ['empty text'],
          testPassRate: 0.8,
        },
        completed: false,
        durationMs: 15000,
        costUsd: 0.12,
        context: { chars: 3000, lines: 80, approxTokens: 750 },
      },
      {
        phase: 'l2',
        mode: 'beta',
        tier: 'medium',
        usage: { inputTokens: 1200, outputTokens: 400, totalTokens: 1600 },
        attempts: 1,
        testResult: { testsTotal: 5, testsPassed: 5, testsFailed: [], testPassRate: 1 },
        completed: true,
        durationMs: 8000,
        costUsd: 0.06,
        context: { chars: 1500, lines: 40, approxTokens: 375 },
      },
    ]);

    expect(summary.l2).toBeDefined();
    expect(summary.l2.tokenSavings.totalTokens).toBe(900);
    expect(summary.l2.modes.off.avgTestPassRate).toBe(0.8);
    expect(summary.l2.modes.beta.avgTestPassRate).toBe(1);
    expect(summary.l2.modes.off.completionRate).toBe(0);
    expect(summary.l2.modes.beta.completionRate).toBe(1);
    expect(summary.l2.modes.off.avgAttempts).toBe(2);
    expect(summary.l2.modes.beta.avgAttempts).toBe(1);
  });

  it('handles both phases together', async () => {
    const { summarizeExecution } = await import(benchmarkModule);

    const summary = summarizeExecution([
      {
        phase: 'l1',
        mode: 'off',
        tier: 'small',
        usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
        durationMs: 3000,
        costUsd: 0.03,
        context: { chars: 500, lines: 15, approxTokens: 125 },
        verdict: {
          requirementsCovered: 4,
          requirementsTotal: 4,
          decisionsCount: 3,
          risksIdentified: 1,
          coverageRate: 1,
        },
      },
      {
        phase: 'l1',
        mode: 'beta',
        tier: 'small',
        usage: { inputTokens: 300, outputTokens: 80, totalTokens: 380 },
        durationMs: 2000,
        costUsd: 0.02,
        context: { chars: 300, lines: 10, approxTokens: 75 },
        verdict: {
          requirementsCovered: 4,
          requirementsTotal: 4,
          decisionsCount: 2,
          risksIdentified: 1,
          coverageRate: 1,
        },
      },
      {
        phase: 'l2',
        mode: 'off',
        tier: 'small',
        usage: { inputTokens: 600, outputTokens: 150, totalTokens: 750 },
        attempts: 1,
        testResult: { testsTotal: 5, testsPassed: 5, testsFailed: [], testPassRate: 1 },
        completed: true,
        durationMs: 5000,
        costUsd: 0.04,
        context: { chars: 500, lines: 15, approxTokens: 125 },
      },
      {
        phase: 'l2',
        mode: 'beta',
        tier: 'small',
        usage: { inputTokens: 400, outputTokens: 120, totalTokens: 520 },
        attempts: 1,
        testResult: { testsTotal: 5, testsPassed: 5, testsFailed: [], testPassRate: 1 },
        completed: true,
        durationMs: 4000,
        costUsd: 0.03,
        context: { chars: 300, lines: 10, approxTokens: 75 },
      },
    ]);

    expect(summary.l1).toBeDefined();
    expect(summary.l2).toBeDefined();
    expect(summary.l1.tokenSavings.totalTokens).toBe(220);
    expect(summary.l2.tokenSavings.totalTokens).toBe(230);
  });

  it('parses design verdict from Claude output', async () => {
    const { parseDesignVerdict } = await import(benchmarkModule);

    const text = `# Design Doc\n\n## Decisions\n1. Use JSON file\n2. In-memory operations\n\n## Risks\n- File locking\n\n\`\`\`json\n{"requirementsCovered":8,"requirementsTotal":8,"decisionsCount":2,"risksIdentified":1}\n\`\`\``;
    const verdict = parseDesignVerdict(text);
    expect(verdict).toEqual({
      requirementsCovered: 8,
      requirementsTotal: 8,
      decisionsCount: 2,
      risksIdentified: 1,
      coverageRate: 1,
    });
  });

  it('parses vitest JSON reporter output', async () => {
    const { parseTestOutput } = await import(benchmarkModule);

    const jsonOutput = JSON.stringify({
      numTotalTests: 5,
      numPassedTests: 4,
      numFailedTests: 1,
      testResults: [
        {
          assertionResults: [
            { fullName: 'preserves insertion order', status: 'passed' },
            { fullName: 'rejects empty text', status: 'passed' },
            { fullName: 'filters by tag', status: 'failed' },
            { fullName: 'hides archived', status: 'passed' },
            { fullName: 'shows archived when requested', status: 'passed' },
          ],
        },
      ],
    });

    const result = parseTestOutput(jsonOutput);
    expect(result.testsTotal).toBe(5);
    expect(result.testsPassed).toBe(4);
    expect(result.testsFailed).toEqual(['filters by tag']);
    expect(result.testPassRate).toBe(0.8);
  });

  it('builds Claude args without --sandbox flag', async () => {
    const { buildClaudeArgs } = await import(utilsModule);

    const args = buildClaudeArgs({ cwd: '/tmp/fixture', model: 'sonnet' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
    expect(args).not.toContain('--sandbox');
  });

  it('creates a deterministic dry-run report for both phases', async () => {
    const { runExecutionBenchmark } = await import(benchmarkModule);
    const tmpDir = path.join(
      os.tmpdir(),
      `comet-execution-benchmark-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const result = await runExecutionBenchmark({
        workspace: tmpDir,
        dryRun: true,
        repeats: 1,
        tiers: ['small'],
        phase: 'both',
      });

      const report = await fs.readFile(result.reportMarkdownPath, 'utf-8');
      const data = JSON.parse(await fs.readFile(result.reportJsonPath, 'utf-8'));

      expect(report).toContain('# Comet Execution Benchmark 报告');
      expect(report).toContain('## L1: 设计阶段');
      expect(report).toContain('## L2: 构建阶段');
      expect(report).toContain('| 模式 |');

      // L1 results: 2 (small × 2 modes)
      // L2 results: 2 (small × 2 modes)
      expect(data.results).toHaveLength(4);
      expect(data.summary.l1).toBeDefined();
      expect(data.summary.l2).toBeDefined();
      expect(data.summary.l1.tokenSavings.totalTokens).toBeGreaterThan(0);
      expect(data.summary.l2.tokenSavings.totalTokens).toBeGreaterThan(0);
      expect(data.summary.l2.modes.beta.completionRate).toBe(1);
      expect(data.summary.l2.modes.off.completionRate).toBe(1);

      // Verify L2 fixture files exist
      await expect(
        fs.stat(
          path.join(
            tmpDir,
            '.comet',
            'benchmark',
            'execution',
            'l2',
            'small',
            'beta',
            'package.json',
          ),
        ),
      ).resolves.toBeDefined();
      await expect(
        fs.stat(
          path.join(
            tmpDir,
            '.comet',
            'benchmark',
            'execution',
            'l2',
            'small',
            'beta',
            'tests',
            'note-board.test.js',
          ),
        ),
      ).resolves.toBeDefined();

      // Verify L1 fixture has no src/ (design only)
      await expect(
        fs.stat(
          path.join(tmpDir, '.comet', 'benchmark', 'execution', 'l1', 'small', 'beta', 'openspec'),
        ),
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('computes L3 full-workflow metrics from off and beta results', async () => {
    const { summarizeExecution } = await import(benchmarkModule);

    const summary = summarizeExecution([
      {
        phase: 'l3',
        mode: 'off',
        tier: 'small',
        usage: { inputTokens: 900, outputTokens: 200, totalTokens: 1100 },
        attempts: 2,
        testResult: {
          testsTotal: 10,
          testsPassed: 8,
          testsFailed: ['deprecated', 'exists'],
          testPassRate: 0.8,
        },
        completed: false,
        durationMs: 8000,
        costUsd: 0.08,
        context: { chars: 1000, lines: 30, approxTokens: 250 },
      },
      {
        phase: 'l3',
        mode: 'beta',
        tier: 'small',
        usage: { inputTokens: 600, outputTokens: 150, totalTokens: 750 },
        attempts: 1,
        testResult: { testsTotal: 10, testsPassed: 10, testsFailed: [], testPassRate: 1 },
        completed: true,
        durationMs: 5000,
        costUsd: 0.05,
        context: { chars: 400, lines: 12, approxTokens: 100 },
      },
    ]);

    expect(summary.l3).toBeDefined();
    expect(summary.l3.tokenSavings.totalTokens).toBe(350);
    expect(summary.l3.modes.off.completionRate).toBe(0);
    expect(summary.l3.modes.beta.completionRate).toBe(1);
    expect(summary.l3.modes.beta.avgTestPassRate).toBe(1);
    expect(summary.l3.modes.off.avgTestPassRate).toBe(0.8);
  });

  it('runs L3 dry-run with correct fixture structure', async () => {
    const { runExecutionBenchmark } = await import(benchmarkModule);
    const tmpDir = path.join(
      os.tmpdir(),
      `comet-execution-l3-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const result = await runExecutionBenchmark({
        workspace: tmpDir,
        dryRun: true,
        repeats: 1,
        tiers: ['small'],
        phase: 'l3',
      });

      expect(result.results).toHaveLength(2); // 2 modes × 1 tier
      expect(result.results.every((r: any) => r.phase === 'l3')).toBe(true);
      expect(result.summary.l3).toBeDefined();
      expect(result.summary.l3.modes.beta.completionRate).toBe(1);
      expect(result.summary.l3.modes.off.completionRate).toBe(1);
      expect(result.summary.l3.tokenSavings.totalTokens).toBeGreaterThan(0);

      // L3 now measures spec coverage from design phase
      const offResult = result.results.find((r: any) => r.mode === 'off');
      const betaResult = result.results.find((r: any) => r.mode === 'beta');
      expect(offResult.specCoverage).toBe(1);
      expect(betaResult.specCoverage).toBe(0.95);
      expect(result.summary.l3.modes.off.avgSpecCoverage).toBe(1);
      expect(result.summary.l3.modes.beta.avgSpecCoverage).toBe(0.95);

      // Verify L3 fixture files exist
      await expect(
        fs.stat(
          path.join(
            tmpDir,
            '.comet',
            'benchmark',
            'execution',
            'l3',
            'small',
            'beta',
            'src',
            'dictionary.js',
          ),
        ),
      ).resolves.toBeDefined();
      await expect(
        fs.stat(
          path.join(
            tmpDir,
            '.comet',
            'benchmark',
            'execution',
            'l3',
            'small',
            'beta',
            'tests',
            'dictionary.test.js',
          ),
        ),
      ).resolves.toBeDefined();

      // Verify report contains L3 section
      const report = await fs.readFile(result.reportMarkdownPath, 'utf-8');
      expect(report).toContain('L3: 全流程');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('runs all phases (l1+l2+l3) together in dry-run', async () => {
    const { runExecutionBenchmark } = await import(benchmarkModule);
    const tmpDir = path.join(
      os.tmpdir(),
      `comet-execution-all-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const result = await runExecutionBenchmark({
        workspace: tmpDir,
        dryRun: true,
        repeats: 1,
        tiers: ['small'],
        phase: 'all',
      });

      expect(result.results).toHaveLength(6); // 2 modes × 3 phases
      expect(Object.keys(result.summary)).toEqual(expect.arrayContaining(['l1', 'l2', 'l3']));

      const report = await fs.readFile(result.reportMarkdownPath, 'utf-8');
      expect(report).toContain('L1: 设计阶段');
      expect(report).toContain('L2: 构建阶段');
      expect(report).toContain('L3: 全流程');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
