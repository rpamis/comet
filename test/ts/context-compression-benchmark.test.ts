import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const benchmarkModule = pathToFileURL(
  path.resolve('scripts', 'context-compression-benchmark.mjs'),
).href;

describe('context compression benchmark runner', () => {
  it('computes token savings and quality metrics from off and beta results', async () => {
    const { summarizeBenchmark } = await import(benchmarkModule);

    const summary = summarizeBenchmark([
      {
        mode: 'off',
        usage: { inputTokens: 1200, outputTokens: 200, totalTokens: 1400 },
        verdict: {
          completed: true,
          specFacts: 5,
          driftedFacts: 1,
          acceptanceCriteriaTotal: 4,
          acceptanceCriteriaMet: 3,
        },
        durationMs: 1000,
      },
      {
        mode: 'beta',
        usage: { inputTokens: 700, outputTokens: 180, totalTokens: 880 },
        verdict: {
          completed: true,
          specFacts: 5,
          driftedFacts: 0,
          acceptanceCriteriaTotal: 4,
          acceptanceCriteriaMet: 4,
        },
        durationMs: 900,
      },
    ]);

    expect(summary.tokenSavings.totalTokens).toBe(520);
    expect(summary.tokenSavings.percent).toBeCloseTo(37.14, 2);
    expect(summary.modes.off.specDriftRate).toBe(0.2);
    expect(summary.modes.beta.specDriftRate).toBe(0);
    expect(summary.modes.off.taskCompletionRate).toBe(0.75);
    expect(summary.modes.beta.taskCompletionRate).toBe(1);
  });

  it('summarizes context size savings per fixture tier', async () => {
    const { summarizeBenchmark } = await import(benchmarkModule);

    const summary = summarizeBenchmark([
      {
        tier: 'small',
        mode: 'off',
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        context: { chars: 1000, lines: 30, approxTokens: 250 },
        verdict: { completed: true, specFacts: 4, driftedFacts: 0, acceptanceCriteriaTotal: 2, acceptanceCriteriaMet: 2 },
        durationMs: 100,
      },
      {
        tier: 'small',
        mode: 'beta',
        usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 },
        context: { chars: 900, lines: 26, approxTokens: 225 },
        verdict: { completed: true, specFacts: 4, driftedFacts: 0, acceptanceCriteriaTotal: 2, acceptanceCriteriaMet: 2 },
        durationMs: 100,
      },
      {
        tier: 'large',
        mode: 'off',
        usage: { inputTokens: 1000, outputTokens: 20, totalTokens: 1020 },
        context: { chars: 12000, lines: 300, approxTokens: 3000 },
        verdict: { completed: true, specFacts: 16, driftedFacts: 1, acceptanceCriteriaTotal: 8, acceptanceCriteriaMet: 7 },
        durationMs: 100,
      },
      {
        tier: 'large',
        mode: 'beta',
        usage: { inputTokens: 600, outputTokens: 20, totalTokens: 620 },
        context: { chars: 6000, lines: 160, approxTokens: 1500 },
        verdict: { completed: true, specFacts: 16, driftedFacts: 0, acceptanceCriteriaTotal: 8, acceptanceCriteriaMet: 8 },
        durationMs: 100,
      },
    ]);

    expect(summary.tiers.small.contextSavings.chars).toBe(100);
    expect(summary.tiers.small.contextSavings.percent).toBe(10);
    expect(summary.tiers.large.contextSavings.chars).toBe(6000);
    expect(summary.tiers.large.contextSavings.percent).toBe(50);
    expect(summary.tiers.large.tokenSavings.totalTokens).toBe(400);
  });

  it('extracts token usage and verdict from Codex JSONL events', async () => {
    const { parseCodexJsonl } = await import(benchmarkModule);

    const parsed = parseCodexJsonl(
      [
        JSON.stringify({ type: 'session.started' }),
        JSON.stringify({
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 111,
              output_tokens: 22,
              total_tokens: 133,
            },
          },
        }),
        JSON.stringify({
          type: 'message',
          message: {
            content:
              '{"completed":true,"specFacts":6,"driftedFacts":1,"acceptanceCriteriaTotal":3,"acceptanceCriteriaMet":2}',
          },
        }),
      ].join('\n'),
    );

    expect(parsed.usage).toEqual({ inputTokens: 111, outputTokens: 22, totalTokens: 133 });
    expect(parsed.verdict).toEqual({
      completed: true,
      specFacts: 6,
      driftedFacts: 1,
      acceptanceCriteriaTotal: 3,
      acceptanceCriteriaMet: 2,
    });
  });

  it('normalizes Windows paths before passing script paths to Bash', async () => {
    const { toBashPath } = await import(benchmarkModule);

    expect(toBashPath('D:\\Project\\Comet\\assets\\skills\\comet\\scripts\\comet-handoff.sh')).toBe(
      '/d/Project/Comet/assets/skills/comet/scripts/comet-handoff.sh',
    );
    expect(
      toBashPath(
        'D:\\Project\\Comet\\assets\\skills\\comet\\scripts\\comet-handoff.sh',
        'wsl',
      ),
    ).toBe('/mnt/d/Project/Comet/assets/skills/comet/scripts/comet-handoff.sh');
    expect(toBashPath('/tmp/comet-handoff.sh')).toBe('/tmp/comet-handoff.sh');
  });

  it('places Codex approval flags before the exec subcommand', async () => {
    const { buildCodexArgs } = await import(benchmarkModule);

    const args = buildCodexArgs({
      cwd: 'D:\\Project\\Comet\\.comet\\fixture',
      model: 'gpt-test',
    });

    expect(args.slice(0, 3)).toEqual(['--ask-for-approval', 'never', 'exec']);
    expect(args).toContain('--json');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ignore-rules');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('read-only');
    expect(args).toContain('--model');
    expect(args.at(-1)).toBe('-');
  });

  it('creates a deterministic dry-run report without invoking Codex', async () => {
    const { runBenchmark } = await import(benchmarkModule);
    const tmpDir = path.join(
      os.tmpdir(),
      `comet-context-benchmark-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    try {
      const result = await runBenchmark({
        workspace: tmpDir,
        dryRun: true,
        repeats: 1,
        codexCommand: 'codex',
      });

      const report = await fs.readFile(result.reportMarkdownPath, 'utf-8');
      const data = JSON.parse(await fs.readFile(result.reportJsonPath, 'utf-8'));

      expect(report).toContain('# Comet 上下文压缩 Benchmark 报告');
      expect(report).toContain('## 汇总');
      expect(report).toContain('| 模式 | 平均输入 tokens | 平均输出 tokens | 平均总 tokens | Spec 漂移率 | 任务完成率 | JSON 解析成功率 |');
      expect(report).toContain('## 分档明细');
      expect(report).toContain('| 档位 | off 上下文字符数 | beta 上下文字符数 | 上下文节省 | Token 节省 | Spec 漂移 off/beta | 任务完成 off/beta |');
      expect(report).toContain('| off |');
      expect(report).toContain('| beta |');
      expect(data.results).toHaveLength(6);
      expect(data.summary.tiers.small).toBeDefined();
      expect(data.summary.tiers.medium).toBeDefined();
      expect(data.summary.tiers.large).toBeDefined();
      expect(data.summary.tiers.large.contextSavings.chars).toBeGreaterThan(
        data.summary.tiers.small.contextSavings.chars,
      );
      expect(data.summary.tokenSavings.totalTokens).toBeGreaterThan(0);
      await expect(
        fs.stat(
          path.join(
            tmpDir,
            '.comet',
            'benchmark',
            'context-compression',
            'small',
            'off',
            'openspec',
            'changes',
            'context-compression-benchmark',
            'proposal.md',
          ),
        ),
      ).resolves.toBeDefined();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
