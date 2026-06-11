#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  round,
  safeRatio,
  findBashCommand,
  toBashPath,
  parseCodexJsonl,
  normalizeVerdict,
  spawnCapture,
} from './benchmark-utils.mjs';

const CHANGE_NAME = 'context-compression-benchmark';
const MODES = ['off', 'beta'];
const TIERS = ['small', 'medium', 'large'];
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function usage() {
  return [
    'Usage: node scripts/context-compression-benchmark.mjs [options]',
    '',
    'Options:',
    '  --workspace <dir>       Workspace for generated benchmark fixtures',
    '  --repeats <n>           Number of runs per mode (default: 1)',
    '  --tiers <list>          Comma-separated tiers: small,medium,large (default: all)',
    '  --codex-command <cmd>   Codex executable (default: codex)',
    '  --model <model>         Optional model passed to codex exec',
    '  --dry-run               Generate deterministic local results without invoking Codex',
    '  --help                  Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    workspace: path.join(REPO_ROOT, '.comet', 'benchmark-runs'),
    repeats: 1,
    codexCommand: 'codex',
    model: null,
    dryRun: false,
    tiers: TIERS,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      return { ...options, help: true };
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--workspace') {
      options.workspace = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg === '--repeats') {
      options.repeats = Number.parseInt(requireValue(argv, ++i, arg), 10);
      continue;
    }
    if (arg === '--codex-command') {
      options.codexCommand = requireValue(argv, ++i, arg);
      continue;
    }
    if (arg === '--tiers') {
      options.tiers = requireValue(argv, ++i, arg)
        .split(',')
        .map((tier) => tier.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === '--model') {
      options.model = requireValue(argv, ++i, arg);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.repeats) || options.repeats < 1) {
    throw new Error('--repeats must be a positive integer');
  }
  const unknownTiers = options.tiers.filter((tier) => !TIERS.includes(tier));
  if (unknownTiers.length > 0) {
    throw new Error(`Unknown tier(s): ${unknownTiers.join(', ')}`);
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

export { parseCodexJsonl, toBashPath };

export function summarizeBenchmark(results) {
  const modes = summarizeModes(results);
  const tiers = {};
  for (const tier of [...new Set(results.map((result) => result.tier).filter(Boolean))]) {
    const tierResults = results.filter((result) => result.tier === tier);
    const tierModes = summarizeModes(tierResults);
    tiers[tier] = {
      modes: tierModes,
      tokenSavings: savings(tierModes, 'avgTotalTokens', 'avgInputTokens'),
      contextSavings: contextSavings(tierModes),
    };
  }

  return {
    modes,
    tiers,
    tokenSavings: savings(modes, 'avgTotalTokens', 'avgInputTokens'),
    contextSavings: contextSavings(modes),
  };
}

function summarizeModes(results) {
  const byMode = {};
  for (const mode of MODES) {
    const modeResults = results.filter((result) => result.mode === mode);
    const totals = modeResults.reduce(
      (acc, result) => {
        const verdict = normalizeVerdict(result.verdict);
        acc.inputTokens += result.usage.inputTokens;
        acc.outputTokens += result.usage.outputTokens;
        acc.totalTokens += result.usage.totalTokens;
        acc.durationMs += result.durationMs;
        acc.completed += verdict.completed ? 1 : 0;
        acc.specFacts += verdict.specFacts;
        acc.driftedFacts += verdict.driftedFacts;
        acc.acceptanceCriteriaTotal += verdict.acceptanceCriteriaTotal;
        acc.acceptanceCriteriaMet += verdict.acceptanceCriteriaMet;
        acc.contextChars += result.context?.chars ?? 0;
        acc.contextLines += result.context?.lines ?? 0;
        acc.contextApproxTokens += result.context?.approxTokens ?? 0;
        return acc;
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 0,
        completed: 0,
        specFacts: 0,
        driftedFacts: 0,
        acceptanceCriteriaTotal: 0,
        acceptanceCriteriaMet: 0,
        contextChars: 0,
        contextLines: 0,
        contextApproxTokens: 0,
      },
    );
    const count = modeResults.length || 1;
    byMode[mode] = {
      runs: modeResults.length,
      avgInputTokens: round(totals.inputTokens / count),
      avgOutputTokens: round(totals.outputTokens / count),
      avgTotalTokens: round(totals.totalTokens / count),
      avgDurationMs: round(totals.durationMs / count),
      parseSuccessRate: safeRatio(modeResults.filter((result) => result.verdict).length, count),
      completionSuccessRate: safeRatio(totals.completed, count),
      specDriftRate: safeRatio(totals.driftedFacts, totals.specFacts),
      taskCompletionRate: safeRatio(totals.acceptanceCriteriaMet, totals.acceptanceCriteriaTotal),
      avgContextChars: round(totals.contextChars / count),
      avgContextLines: round(totals.contextLines / count),
      avgContextApproxTokens: round(totals.contextApproxTokens / count),
    };
  }
  return byMode;
}

function savings(byMode, totalKey, inputKey) {
  const totalTokenSavings = byMode.off[totalKey] - byMode.beta[totalKey];
  const inputTokenSavings = byMode.off[inputKey] - byMode.beta[inputKey];
  return {
    inputTokens: round(inputTokenSavings),
    totalTokens: round(totalTokenSavings),
    percent: round(safeRatio(totalTokenSavings, byMode.off[totalKey]) * 100),
  };
}

function contextSavings(byMode) {
  const chars = byMode.off.avgContextChars - byMode.beta.avgContextChars;
  const approxTokens = byMode.off.avgContextApproxTokens - byMode.beta.avgContextApproxTokens;
  return {
    chars: round(chars),
    approxTokens: round(approxTokens),
    percent: round(safeRatio(chars, byMode.off.avgContextChars) * 100),
  };
}

export async function runBenchmark(options = {}) {
  const config = {
    workspace: path.resolve(options.workspace ?? path.join(REPO_ROOT, '.comet', 'benchmark-runs')),
    repeats: options.repeats ?? 1,
    codexCommand: options.codexCommand ?? 'codex',
    model: options.model ?? null,
    dryRun: Boolean(options.dryRun),
    tiers: options.tiers ?? TIERS,
  };
  const root = path.join(config.workspace, '.comet', 'benchmark', 'context-compression');
  await fs.mkdir(root, { recursive: true });

  const results = [];
  for (let repeat = 1; repeat <= config.repeats; repeat++) {
    for (const tier of config.tiers) {
      for (const mode of MODES) {
        const fixtureRoot = path.join(root, tier, mode);
        await createFixture(fixtureRoot, mode, tier);
        if (!config.dryRun) {
          await generateHandoff(fixtureRoot);
        } else {
          await writeSyntheticHandoff(fixtureRoot, mode, tier);
        }
        const context = await measureContext(fixtureRoot, mode);

        const started = Date.now();
        const runResult = config.dryRun
          ? dryRunResult(mode, tier, context)
          : await runCodexMode({
              codexCommand: config.codexCommand,
              model: config.model,
              cwd: fixtureRoot,
              mode,
            });
        results.push({
          tier,
          mode,
          repeat,
          fixtureRoot,
          context,
          durationMs: Date.now() - started,
          ...runResult,
        });
      }
    }
  }

  const summary = summarizeBenchmark(results);
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    repeats: config.repeats,
    tiers: config.tiers,
    codexCommand: config.codexCommand,
    model: config.model,
    results,
    summary,
  };
  const reportJsonPath = path.join(root, 'report.json');
  const reportMarkdownPath = path.join(root, 'report.md');
  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(reportMarkdownPath, renderMarkdownReport(report));
  return { ...report, reportJsonPath, reportMarkdownPath };
}

async function createFixture(root, mode, tier = 'small') {
  const specCount = { small: 4, medium: 8, large: 16 }[tier] ?? 4;
  const supportingParagraphs = { small: 1, medium: 24, large: 80 }[tier] ?? 1;
  const changeDir = path.join(root, 'openspec', 'changes', CHANGE_NAME);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(path.join(changeDir, 'specs', 'note-board'), { recursive: true });
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.writeFile(path.join(root, '.comet', 'config.yaml'), `context_compression: ${mode}\n`);
  await fs.writeFile(
    path.join(changeDir, '.comet.yaml'),
    [
      'workflow: full',
      'phase: design',
      `context_compression: ${mode}`,
      'build_mode: null',
      'build_pause: null',
      'subagent_dispatch: null',
      'tdd_mode: null',
      'isolation: null',
      'verify_mode: null',
      'design_doc: null',
      'plan: null',
      'base_ref: null',
      'verify_result: pending',
      'verification_report: null',
      'branch_status: pending',
      'created_at: 2026-06-07',
      'verified_at: null',
      'archived: false',
      'handoff_context: null',
      'handoff_hash: null',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(changeDir, 'proposal.md'),
    [
      '# Proposal',
      '',
      'Build a small note-board CLI that records notes, tags, and archive state.',
      'The implementation must preserve note order and reject empty note text.',
      '',
      ...supportingLines('Proposal rationale', supportingParagraphs),
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(changeDir, 'design.md'),
    [
      '# Design',
      '',
      'Use a single JSON file named notes.json in the project root.',
      'Commands should be deterministic and should not require network access.',
      '',
      ...supportingLines('Design detail', supportingParagraphs),
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(changeDir, 'tasks.md'),
    [
      '- [ ] Create a note-board CLI with add, list, tag, and archive commands',
      '- [ ] Add tests for ordering, empty text validation, tag filtering, and archive filtering',
      '- [ ] Return a benchmark verdict JSON for this evaluation',
      ...supportingTaskLines(supportingParagraphs),
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(changeDir, 'specs', 'note-board', 'spec.md'),
    buildSpec(specCount),
  );
}

function supportingLines(label, count) {
  return Array.from({ length: count }, (_, index) =>
    `${label} ${index + 1}: This supporting note records implementation background, tradeoffs, and non-canonical context that helps planning but should not be required to preserve acceptance criteria.`,
  );
}

function supportingTaskLines(count) {
  return Array.from(
    { length: Math.floor(count / 2) },
    (_, index) => `- [ ] Supporting planning checkpoint ${index + 1}`,
  );
}

function buildSpec(count) {
  const requirements = [
    ['Notes are stored in creation order', 'list active notes in the same order they were added', 'List preserves insertion order', 'notes "alpha", "beta", and "gamma" were added', 'the user lists active notes', 'the output order is "alpha", "beta", "gamma"'],
    ['Empty note text is rejected', 'reject empty or whitespace-only note text', 'Whitespace text fails validation', 'no note text except spaces', 'the user adds the note', 'the command fails with "note text is required"'],
    ['Tags filter active notes', 'allow active notes to be filtered by tag', 'Tag filter returns only matching notes', 'one note tagged "work" and one note tagged "home"', 'the user lists notes with tag "work"', 'only the "work" note is shown'],
    ['Archived notes are hidden by default', 'hide archived notes unless the user requests archived notes', 'Archived note is omitted from default list', 'note "alpha" is archived', 'the user lists active notes', '"alpha" is not shown'],
  ];
  const lines = ['## ADDED Requirements', ''];
  for (let index = 0; index < count; index++) {
    const base = requirements[index % requirements.length];
    const suffix = index < requirements.length ? '' : ` ${Math.floor(index / requirements.length) + 1}`;
    lines.push(
      `### Requirement: ${base[0]}${suffix}`,
      `The note-board CLI MUST ${base[1]}.`,
      '',
      `#### Scenario: ${base[2]}${suffix}`,
      `- Given ${base[3]}`,
      `- When ${base[4]}`,
      `- Then ${base[5]}`,
      '',
    );
  }
  return lines.join('\n');
}

async function generateHandoff(cwd) {
  const bash = findBashCommand();
  if (!bash) {
    throw new Error('Bash or Git Bash is required to generate Comet handoff context');
  }
  const script = path.join(REPO_ROOT, 'assets', 'skills', 'comet', 'scripts', 'comet-handoff.sh');
  await spawnCapture(bash.command, [toBashPath(script, bash.pathStyle), CHANGE_NAME, 'design', '--write'], {
    cwd,
  });
}

async function writeSyntheticHandoff(root, mode, tier = 'small') {
  const syntheticLines = { small: 4, medium: 40, large: 140 }[tier] ?? 4;
  const retainedLines = mode === 'beta' ? Math.ceil(syntheticLines / 3) : syntheticLines;
  const handoffDir = path.join(
    root,
    'openspec',
    'changes',
    CHANGE_NAME,
    '.comet',
    'handoff',
  );
  await fs.mkdir(handoffDir, { recursive: true });
  const contextName = mode === 'beta' ? 'spec-context' : 'design-context';
  const contextPath = path.join(handoffDir, `${contextName}.md`);
  const jsonPath = path.join(handoffDir, `${contextName}.json`);
  await fs.writeFile(
    contextPath,
    [
      mode === 'beta' ? '# Comet Spec Context' : '# Comet Design Handoff',
      '',
      `- Change: ${CHANGE_NAME}`,
      '- Phase: design',
      `- Mode: ${mode === 'beta' ? 'beta' : 'compact'}`,
      '',
      mode === 'beta'
        ? 'Synthetic dry-run context: spec files are projected verbatim.'
        : 'Synthetic dry-run context: supporting files are excerpted.',
      `Synthetic tier: ${tier}`,
      ...Array.from(
        { length: retainedLines },
        (_, index) =>
          `Synthetic context line ${index + 1}: ${mode} ${tier} benchmark material for deterministic size measurement.`,
      ),
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        change: CHANGE_NAME,
        phase: 'design',
        mode: mode === 'beta' ? 'beta' : 'compact',
        canonical_spec: 'openspec',
        generated_by: 'context-compression-benchmark.mjs dry-run',
        context_hash: '0'.repeat(64),
        files: [],
      },
      null,
      2,
    ),
  );
}

async function measureContext(root, mode) {
  const contextName = mode === 'beta' ? 'spec-context.md' : 'design-context.md';
  const contextPath = path.join(
    root,
    'openspec',
    'changes',
    CHANGE_NAME,
    '.comet',
    'handoff',
    contextName,
  );
  const content = await fs.readFile(contextPath, 'utf-8');
  return {
    chars: content.length,
    lines: content.split(/\r?\n/).length,
    approxTokens: Math.ceil(content.length / 4),
  };
}

function dryRunResult(mode, tier = 'small', context = { approxTokens: 0 }) {
  const beta = mode === 'beta';
  const tierMultiplier = { small: 1, medium: 2, large: 4 }[tier] ?? 1;
  const baseInput = context.approxTokens + 500 * tierMultiplier;
  return {
    usage: beta
      ? { inputTokens: baseInput, outputTokens: 160, totalTokens: baseInput + 160 }
      : { inputTokens: baseInput + 120 * tierMultiplier, outputTokens: 210, totalTokens: baseInput + 210 + 120 * tierMultiplier },
    verdict: {
      completed: true,
      specFacts: 8 * tierMultiplier,
      driftedFacts: beta ? 0 : 1,
      acceptanceCriteriaTotal: 4 * tierMultiplier,
      acceptanceCriteriaMet: beta ? 4 * tierMultiplier : 4 * tierMultiplier - 1,
    },
    stdout: '',
    stderr: '',
    exitCode: 0,
  };
}

async function runCodexMode({ codexCommand, model, cwd, mode }) {
  const contextFile =
    mode === 'beta'
      ? `openspec/changes/${CHANGE_NAME}/.comet/handoff/spec-context.md`
      : `openspec/changes/${CHANGE_NAME}/.comet/handoff/design-context.md`;
  const contextText = await fs.readFile(path.join(cwd, contextFile), 'utf-8');
  const prompt = buildPrompt(mode, contextFile, contextText);
  const args = buildCodexArgs({ cwd, model });
  const { stdout, stderr, exitCode } = await spawnCapture(codexCommand, args, {
    cwd,
    input: prompt,
    timeoutMs: 15 * 60 * 1000,
  });
  const parsed = parseCodexJsonl(stdout);
  return {
    usage: parsed.usage,
    verdict: parsed.verdict,
    stdout,
    stderr,
    exitCode,
  };
}

export function buildCodexArgs({ cwd, model = null }) {
  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--cd',
    cwd,
    '--sandbox',
    'read-only',
  ];
  if (model) args.push('--model', model);
  args.push('-');
  return args;
}

function buildPrompt(mode, contextFile, contextText) {
  return [
    'You are running a local Comet context-compression benchmark.',
    `Mode: ${mode}`,
    `Context source: ${contextFile}`,
    'Use only the inline Comet handoff context below. Do not call tools and do not inspect files.',
    'Evaluate whether an implementation agent could complete the note-board task from this context.',
    'Return only compact JSON with this exact shape:',
    '{"completed":true,"specFacts":8,"driftedFacts":0,"acceptanceCriteriaTotal":4,"acceptanceCriteriaMet":4}',
    'Definitions:',
    '- completed: true only if the requirements are clear enough to implement without asking follow-up questions.',
    '- specFacts: count of concrete requirement/scenario facts you used.',
    '- driftedFacts: count of facts you stated that conflict with the OpenSpec source.',
    '- acceptanceCriteriaTotal: number of acceptance scenarios in the spec.',
    '- acceptanceCriteriaMet: number of scenarios preserved clearly enough in the context for implementation.',
    '',
    '<comet_handoff_context>',
    contextText,
    '</comet_handoff_context>',
  ].join('\n');
}

function renderMarkdownReport(report) {
  const lines = [
    '# Comet 上下文压缩 Benchmark 报告',
    '',
    `- 生成时间: ${report.generatedAt}`,
    `- Dry run: ${report.dryRun ? '是' : '否'}`,
    `- 每组重复次数: ${report.repeats}`,
    `- 测试档位: ${(report.tiers ?? Object.keys(report.summary.tiers)).join(', ')}`,
    '',
    '## 汇总',
    '',
    `- 总 token 节省: ${report.summary.tokenSavings.totalTokens}`,
    `- 节省比例: ${report.summary.tokenSavings.percent}%`,
    `- 输入 token 节省: ${report.summary.tokenSavings.inputTokens}`,
    `- 上下文字符节省: ${report.summary.contextSavings.chars} (${report.summary.contextSavings.percent}%)`,
    '',
    '| 模式 | 平均输入 tokens | 平均输出 tokens | 平均总 tokens | Spec 漂移率 | 任务完成率 | JSON 解析成功率 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const mode of MODES) {
    const metrics = report.summary.modes[mode];
    lines.push(
      `| ${mode} | ${metrics.avgInputTokens} | ${metrics.avgOutputTokens} | ${metrics.avgTotalTokens} | ${round(metrics.specDriftRate * 100)}% | ${round(metrics.taskCompletionRate * 100)}% | ${round(metrics.parseSuccessRate * 100)}% |`,
    );
  }
  lines.push(
    '',
    '## 分档明细',
    '',
    '| 档位 | off 上下文字符数 | beta 上下文字符数 | 上下文节省 | Token 节省 | Spec 漂移 off/beta | 任务完成 off/beta |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const tier of Object.keys(report.summary.tiers)) {
    const tierSummary = report.summary.tiers[tier];
    lines.push(
      `| ${tier} | ${tierSummary.modes.off.avgContextChars} | ${tierSummary.modes.beta.avgContextChars} | ${tierSummary.contextSavings.chars} (${tierSummary.contextSavings.percent}%) | ${tierSummary.tokenSavings.totalTokens} (${tierSummary.tokenSavings.percent}%) | ${round(tierSummary.modes.off.specDriftRate * 100)}% / ${round(tierSummary.modes.beta.specDriftRate * 100)}% | ${round(tierSummary.modes.off.taskCompletionRate * 100)}% / ${round(tierSummary.modes.beta.taskCompletionRate * 100)}% |`,
    );
  }
  lines.push(
    '',
    '## 原始数据',
    '',
    '- `report.json` 包含每次运行的 stdout、stderr、usage、verdict 和上下文大小数据。',
    '',
  );
  return lines.join('\n');
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const report = await runBenchmark(options);
    console.log(`Report: ${report.reportMarkdownPath}`);
    console.log(`Data:   ${report.reportJsonPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}
