#!/usr/bin/env node
/**
 * Execution Benchmark — L1 Design Phase + L2 Build Phase
 *
 * L1 (Design): Generate handoff context → Claude Code reads context → produces Design Doc
 *   Measures: token usage, design quality (spec coverage in Design Doc)
 *
 * L2 (Build): Pre-seed design artifacts → Claude Code reads handoff → implements feature → run tests
 *   Measures: token usage, test pass rate, retries, duration
 *
 * L3 (Full Workflow): Spec + tests fixture → Claude Code implements → run tests → retry
 *   Measures: token usage, test pass rate, retries, duration, cost
 *
 * Usage:
 *   node scripts/context-execution-benchmark.mjs --phase l1 --tiers small
 *   node scripts/context-execution-benchmark.mjs --phase l2 --tiers small
 *   node scripts/context-execution-benchmark.mjs --phase l3 --tiers small
 *   node scripts/context-execution-benchmark.mjs --phase all --dry-run
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  round,
  safeRatio,
  findBashCommand,
  toBashPath,
  spawnCapture,
  parseClaudeJson,
  buildClaudeArgs,
} from './benchmark-utils.mjs';

const CHANGE_NAME = 'execution-benchmark';
const MODES = ['off', 'beta'];
const TIERS = ['small', 'medium', 'large'];
const PHASES = ['l1', 'l2', 'l3', 'both', 'all'];
const IS_WIN = process.platform === 'win32';
const cmd = (bin) => (IS_WIN ? bin + '.cmd' : bin);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const MAX_RETRIES = 3;
const INSTALL_TIMEOUT_MS = 60_000;
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

function usage() {
  return [
    'Usage: node scripts/context-execution-benchmark.mjs [options]',
    '',
    'Options:',
    '  --phase <phase>         l1 (design), l2 (build), l3 (full workflow), both (l1+l2), or all (default: both)',
    '  --workspace <dir>       Workspace for generated benchmark fixtures',
    '  --repeats <n>           Number of runs per mode (default: 1)',
    '  --tiers <list>          Comma-separated tiers: small,medium,large (default: all)',
    '  --claude-command <cmd>  Claude CLI executable (default: claude)',
    '  --model <model>         Optional model passed to claude',
    '  --max-retries <n>       Max retry attempts for L2 (default: 3)',
    '  --dry-run               Generate deterministic results without invoking Claude',
    '  --help                  Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    phase: 'both',
    workspace: path.join(REPO_ROOT, '.comet', 'benchmark-runs'),
    repeats: 1,
    claudeCommand: 'claude',
    model: null,
    dryRun: false,
    tiers: TIERS,
    maxRetries: MAX_RETRIES,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { ...options, help: true };
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--phase') { options.phase = requireValue(argv, ++i, arg); continue; }
    if (arg === '--workspace') { options.workspace = requireValue(argv, ++i, arg); continue; }
    if (arg === '--repeats') { options.repeats = Number.parseInt(requireValue(argv, ++i, arg), 10); continue; }
    if (arg === '--claude-command') { options.claudeCommand = requireValue(argv, ++i, arg); continue; }
    if (arg === '--model') { options.model = requireValue(argv, ++i, arg); continue; }
    if (arg === '--max-retries') { options.maxRetries = Number.parseInt(requireValue(argv, ++i, arg), 10); continue; }
    if (arg === '--tiers') {
      options.tiers = requireValue(argv, ++i, arg).split(',').map((t) => t.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!PHASES.includes(options.phase)) throw new Error(`--phase must be one of: ${PHASES.join(', ')}`);
  if (!Number.isInteger(options.repeats) || options.repeats < 1) throw new Error('--repeats must be a positive integer');
  const unknownTiers = options.tiers.filter((t) => !TIERS.includes(t));
  if (unknownTiers.length > 0) throw new Error(`Unknown tier(s): ${unknownTiers.join(', ')}`);
  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${optionName} requires a value`);
  return value;
}

// ── Fixture generation ─────────────────────────────────────────────

function specCountFor(tier) {
  return { small: 4, medium: 8, large: 16 }[tier] ?? 4;
}

function supportingParagraphsFor(tier) {
  return { small: 1, medium: 24, large: 80 }[tier] ?? 1;
}

/**
 * Create the OpenSpec change directory with proposal/design/tasks/spec.
 * Shared by L1 and L2.
 */
async function createChangeFixture(changeDir, mode, tier) {
  await fs.mkdir(path.join(changeDir, 'specs', 'note-board'), { recursive: true });

  await fs.writeFile(
    path.join(changeDir, '.comet.yaml'),
    [
      'workflow: full', 'phase: design', `context_compression: ${mode}`,
      'build_mode: null', 'build_pause: null', 'subagent_dispatch: null',
      'tdd_mode: null', 'isolation: null', 'verify_mode: null',
      'design_doc: null', 'plan: null', 'base_ref: null',
      'verify_result: pending', 'verification_report: null',
      'branch_status: pending', 'created_at: 2026-06-07',
      'verified_at: null', 'archived: false',
      'handoff_context: null', 'handoff_hash: null', '',
    ].join('\n'),
  );

  const sp = supportingParagraphsFor(tier);
  await fs.writeFile(
    path.join(changeDir, 'proposal.md'),
    [
      '# Proposal', '',
      'Build a small note-board CLI that records notes, tags, and archive state.',
      'The implementation must preserve note order and reject empty note text.',
      '',
      ...Array.from({ length: sp }, (_, i) =>
        `Proposal rationale ${i + 1}: Implementation background and tradeoffs for the note-board feature.`),
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    path.join(changeDir, 'design.md'),
    [
      '# Design', '',
      'Use a single JSON file named notes.json in the project root.',
      'Commands should be deterministic and should not require network access.',
      '',
      ...Array.from({ length: sp }, (_, i) =>
        `Design detail ${i + 1}: Architecture decisions and constraints for the note-board module.`),
      '',
    ].join('\n'),
  );

  await fs.writeFile(
    path.join(changeDir, 'tasks.md'),
    [
      '- [ ] Create a note-board CLI with add, list, tag, and archive commands',
      '- [ ] Add tests for ordering, empty text validation, tag filtering, and archive filtering',
      '- [ ] Return a benchmark verdict JSON for this evaluation',
      ...Array.from({ length: Math.floor(sp / 2) }, (_, i) =>
        `- [ ] Supporting planning checkpoint ${i + 1}`),
      '',
    ].join('\n'),
  );

  await fs.writeFile(path.join(changeDir, 'specs', 'note-board', 'spec.md'), buildSpec(specCountFor(tier)));
}

/**
 * L1 fixture: project root with .comet config + change directory.
 * No src/tests — L1 only tests Design Doc generation.
 */
async function createL1Fixture(root, mode, tier) {
  const changeDir = path.join(root, 'openspec', 'changes', CHANGE_NAME);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.writeFile(path.join(root, '.comet', 'config.yaml'), `context_compression: ${mode}\n`);
  await createChangeFixture(changeDir, mode, tier);
}

/**
 * L2 fixture: full Node.js project with vitest tests + change directory.
 * src/note-board.js is a stub for Claude to implement.
 */
async function createL2Fixture(root, mode, tier) {
  const changeDir = path.join(root, 'openspec', 'changes', CHANGE_NAME);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.writeFile(path.join(root, '.comet', 'config.yaml'), `context_compression: ${mode}\n`);
  await createChangeFixture(changeDir, mode, tier);

  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'execution-benchmark-fixture',
    type: 'module',
    private: true,
    scripts: { test: 'vitest run --reporter=json' },
    devDependencies: { vitest: '^4.1.6' },
  }, null, 2));

  await fs.writeFile(
    path.join(root, 'vitest.config.js'),
    `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['tests/**/*.test.js'] } });\n`,
  );

  await fs.writeFile(
    path.join(root, 'src', 'note-board.js'),
    '// TODO: Implement NoteBoard class\nexport class NoteBoard {}\n',
  );

  await fs.writeFile(path.join(root, 'tests', 'note-board.test.js'), TEST_FILE_CONTENT);
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
}

const TEST_FILE_CONTENT = `import { describe, it, expect } from 'vitest';
import { NoteBoard } from '../src/note-board.js';

describe('NoteBoard', () => {
  it('preserves insertion order', () => {
    const board = new NoteBoard();
    board.add('alpha');
    board.add('beta');
    board.add('gamma');
    expect(board.list()).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('rejects empty or whitespace-only text', () => {
    const board = new NoteBoard();
    expect(() => board.add('')).toThrow('note text is required');
    expect(() => board.add('   ')).toThrow('note text is required');
  });

  it('filters by tag', () => {
    const board = new NoteBoard();
    board.add('meeting notes', { tag: 'work' });
    board.add('grocery list', { tag: 'home' });
    expect(board.list({ tag: 'work' })).toEqual(['meeting notes']);
  });

  it('hides archived notes by default', () => {
    const board = new NoteBoard();
    board.add('alpha');
    board.archive('alpha');
    expect(board.list()).toEqual([]);
  });

  it('shows archived notes when requested', () => {
    const board = new NoteBoard();
    board.add('alpha');
    board.archive('alpha');
    expect(board.list({ archived: true })).toEqual(['alpha']);
  });
});
`;

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
      `The note-board CLI MUST ${base[1]}.`, '',
      `#### Scenario: ${base[2]}${suffix}`,
      `- Given ${base[3]}`, `- When ${base[4]}`, `- Then ${base[5]}`, '',
    );
  }
  return lines.join('\n');
}

// ── Handoff generation (real comet-handoff.sh) ─────────────────────

async function generateHandoff(cwd, changeName = CHANGE_NAME) {
  const bash = findBashCommand();
  if (!bash) throw new Error('Bash or Git Bash is required to generate Comet handoff context');
  const script = path.join(REPO_ROOT, 'assets', 'skills', 'comet', 'scripts', 'comet-handoff.sh');
  await spawnCapture(bash.command, [toBashPath(script, bash.pathStyle), changeName, 'design', '--write'], { cwd });
}

async function writeSyntheticHandoff(root, mode, tier) {
  const syntheticLines = { small: 4, medium: 40, large: 140 }[tier] ?? 4;
  const retainedLines = mode === 'beta' ? Math.ceil(syntheticLines / 3) : syntheticLines;
  const handoffDir = path.join(root, 'openspec', 'changes', CHANGE_NAME, '.comet', 'handoff');
  await fs.mkdir(handoffDir, { recursive: true });
  const contextName = mode === 'beta' ? 'spec-context' : 'design-context';
  await fs.writeFile(
    path.join(handoffDir, `${contextName}.md`),
    [
      mode === 'beta' ? '# Comet Spec Context' : '# Comet Design Handoff',
      '', `- Change: ${CHANGE_NAME}`, '- Phase: design',
      `- Mode: ${mode === 'beta' ? 'beta' : 'compact'}`, '',
      ...Array.from({ length: retainedLines }, (_, i) =>
        `Context line ${i + 1}: ${mode} ${tier} benchmark material.`),
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(handoffDir, `${contextName}.json`),
    JSON.stringify({ change: CHANGE_NAME, phase: 'design', mode: mode === 'beta' ? 'beta' : 'compact', files: [] }, null, 2),
  );
}

async function measureContext(root, mode) {
  const contextName = mode === 'beta' ? 'spec-context.md' : 'design-context.md';
  const content = await fs.readFile(
    path.join(root, 'openspec', 'changes', CHANGE_NAME, '.comet', 'handoff', contextName), 'utf-8',
  );
  return { chars: content.length, lines: content.split(/\r?\n/).length, approxTokens: Math.ceil(content.length / 4) };
}

async function measureL3Context(root, mode, tier) {
  const specContent = await fs.readFile(
    path.join(root, 'openspec', 'changes', L3_CHANGE_NAME, 'specs', 'dictionary', 'spec.md'), 'utf-8',
  );
  const testContent = await fs.readFile(path.join(root, 'tests', 'dictionary.test.js'), 'utf-8');
  const totalChars = specContent.length + testContent.length;
  return { chars: totalChars, lines: (specContent + testContent).split(/\r?\n/).length, approxTokens: Math.ceil(totalChars / 4) };
}

async function readHandoffContext(root, mode, changeName = CHANGE_NAME) {
  const contextFile = mode === 'beta' ? 'spec-context.md' : 'design-context.md';
  const contextPath = path.join(root, 'openspec', 'changes', changeName, '.comet', 'handoff', contextFile);
  const contextText = await fs.readFile(contextPath, 'utf-8');
  return { contextFile, contextText };
}

// ── L1: Design Phase ───────────────────────────────────────────────

function buildDesignPrompt(mode, contextFile, contextText) {
  return [
    'You are a senior engineer running a Comet design phase benchmark.',
    `Mode: ${mode} | Context source: ${contextFile}`,
    '',
    'Read the Comet handoff context below. Then produce a Design Doc that:',
    '1. Summarizes the problem and goals (from proposal)',
    '2. Lists architectural decisions (from design)',
    '3. Maps each spec requirement to a concrete implementation approach',
    '4. Identifies risks, edge cases, and open questions',
    '',
    'Output your Design Doc as markdown. At the end, include a JSON block:',
    '```json',
    '{"requirementsCovered":N,"requirementsTotal":N,"decisionsCount":N,"risksIdentified":N}',
    '```',
    'Where requirementsTotal = number of ADDED Requirements in the spec,',
    'requirementsCovered = how many you addressed in the Design Doc,',
    'decisionsCount = architectural decisions made,',
    'risksIdentified = risks/edge cases found.',
    '',
    '<comet_handoff_context>',
    contextText,
    '</comet_handoff_context>',
  ].join('\n');
}

/**
 * Parse the design quality verdict from Claude's output.
 * Looks for the JSON block at the end of the Design Doc.
 */
export function parseDesignVerdict(text) {
  const match = text.match(/\{[\s\S]*"requirementsCovered"[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]);
    return {
      requirementsCovered: Number(data.requirementsCovered ?? 0),
      requirementsTotal: Number(data.requirementsTotal ?? 0),
      decisionsCount: Number(data.decisionsCount ?? 0),
      risksIdentified: Number(data.risksIdentified ?? 0),
      coverageRate: safeRatio(Number(data.requirementsCovered ?? 0), Number(data.requirementsTotal ?? 0)),
    };
  } catch {
    return null;
  }
}

async function runL1({ claudeCommand, model, cwd, mode, contextFile, contextText }) {
  const prompt = buildDesignPrompt(mode, contextFile, contextText);
  const args = buildClaudeArgs({ cwd, model });
  const { stdout, stderr, exitCode } = await spawnCapture(claudeCommand, args, {
    cwd,
    input: prompt,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    allowFailure: true,
  });
  const parsed = parseClaudeJson(stdout);
  const verdict = parseDesignVerdict(parsed.result ?? stdout);
  return {
    phase: 'l1',
    usage: parsed.usage,
    durationMs: parsed.durationMs,
    costUsd: parsed.costUsd,
    verdict,
    designDoc: parsed.result ?? '',
    exitCode,
  };
}

// ── L2: Build Phase ────────────────────────────────────────────────

function buildBuildPrompt(mode, contextFile, contextText) {
  return [
    'You are implementing a note-board module for a Comet build phase benchmark.',
    `Mode: ${mode} | Context source: ${contextFile}`,
    '',
    'Read the spec acceptance criteria from the Comet handoff context below.',
    '',
    'TASK:',
    '1. Implement src/note-board.js that exports a NoteBoard class with methods:',
    '   - add(text, options?) — add a note; throws "note text is required" for empty/whitespace',
    '   - list(options?) — return array of note texts; options.tag filters, options.archived shows archived',
    '   - archive(text) — mark a note as archived',
    '2. Do NOT modify tests/note-board.test.js',
    '3. Run `npx vitest run` to verify. Fix failures until all tests pass.',
    '',
    '<comet_handoff_context>',
    contextText,
    '</comet_handoff_context>',
  ].join('\n');
}

export function parseTestOutput(stdout) {
  try {
    const data = JSON.parse(stdout);
    // Use top-level summary when available (Vitest JSON reporter)
    if (typeof data.numTotalTests === 'number') {
      const passed = data.numPassedTests ?? 0;
      const failedNames = [];
      for (const suite of data.testResults ?? []) {
        for (const assertion of suite.assertionResults ?? []) {
          if (assertion.status === 'failed') {
            failedNames.push(assertion.fullName ?? assertion.name ?? 'unknown');
          }
        }
      }
      return {
        testsTotal: data.numTotalTests,
        testsPassed: passed,
        testsFailed: failedNames,
        testPassRate: safeRatio(passed, data.numTotalTests),
      };
    }
  } catch { /* not JSON */ }

  const passMatch = stdout.match(/(\d+) passed/);
  const failMatch = stdout.match(/(\d+) failed/);
  const testsPassed = passMatch ? Number(passMatch[1]) : 0;
  const testsFailedCount = failMatch ? Number(failMatch[1]) : 0;
  const total = testsPassed + testsFailedCount;
  return {
    testsTotal: total,
    testsPassed,
    testsFailed: testsFailedCount > 0 ? [`${testsFailedCount} test(s) failed`] : [],
    testPassRate: safeRatio(testsPassed, total),
  };
}

async function runTests(cwd) {
  try {
    const { stdout, stderr } = await spawnCapture(cmd('npx'), ['vitest', 'run', '--reporter=json'], {
      cwd,
      timeoutMs: 30_000,
      allowFailure: true,
    });
    return parseTestOutput(stdout + '\n' + stderr);
  } catch (error) {
    return { testsTotal: 0, testsPassed: 0, testsFailed: [`Test error: ${error.message}`], testPassRate: 0 };
  }
}

async function runL2({ claudeCommand, model, cwd, mode, contextFile, contextText, maxRetries }) {
  const basePrompt = buildBuildPrompt(mode, contextFile, contextText);
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalDurationMs = 0;
  let totalCostUsd = 0;
  let lastResult = null;
  let testResult = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = attempt === 1 ? basePrompt : buildRetryPrompt(basePrompt, testResult);
    const args = buildClaudeArgs({ cwd, model });
    const { stdout, stderr, exitCode } = await spawnCapture(claudeCommand, args, {
      cwd,
      input: prompt,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      allowFailure: true,
    });
    const parsed = parseClaudeJson(stdout);
    lastResult = { ...parsed, stdout, stderr, exitCode };

    totalUsage.inputTokens += parsed.usage.inputTokens;
    totalUsage.outputTokens += parsed.usage.outputTokens;
    totalUsage.totalTokens += parsed.usage.totalTokens;
    totalDurationMs += parsed.durationMs;
    totalCostUsd += parsed.costUsd;

    testResult = await runTests(cwd);
    if (testResult.testsTotal > 0 && testResult.testsPassed === testResult.testsTotal) {
      return {
        phase: 'l2',
        usage: totalUsage,
        attempts: attempt,
        testResult,
        completed: true,
        durationMs: totalDurationMs,
        costUsd: totalCostUsd,
        lastResult,
      };
    }
  }

  return {
    phase: 'l2',
    usage: totalUsage,
    attempts: maxRetries,
    testResult,
    completed: false,
    durationMs: totalDurationMs,
    costUsd: totalCostUsd,
    lastResult,
  };
}

function buildRetryPrompt(originalPrompt, testResult) {
  return [
    originalPrompt,
    '',
    '--- PREVIOUS ATTEMPT FAILED ---',
    `Tests passed: ${testResult.testsPassed}/${testResult.testsTotal}`,
    `Failed tests: ${testResult.testsFailed.join(', ')}`,
    'Fix src/note-board.js and run tests again.',
  ].join('\n');
}

// ── L3: Full Workflow ────────────────────────────────────────────────

const L3_CHANGE_NAME = 'dict-benchmark';

/** L3 test count scales with tier: small=10, medium=25, large=50 */
function l3TestCountFor(tier) {
  return { small: 10, medium: 25, large: 50 }[tier] ?? 10;
}

/** L3 requirement count scales with tier: small=8, medium=20, large=40 */
function l3ReqCountFor(tier) {
  return { small: 8, medium: 20, large: 40 }[tier] ?? 8;
}

/**
 * Generate tier-scaled test file content for L3.
 * Base tests (10) cover core CRUD operations.
 * Medium adds: sort stability, empty category, overwrite category, multiple deprecated, mixed active+deprecated list.
 * Large adds: bulk operations, concurrent-style sequential writes, edge-case unicode, long definitions, many categories.
 */
function buildL3TestContent(tier) {
  const base = `import { describe, it, expect, beforeEach } from 'vitest';
import { Dictionary } from '../src/dictionary.js';

let dict;
beforeEach(() => { dict = new Dictionary(); });

describe('Dictionary core', () => {
  it('adds and retrieves a definition', () => {
    dict.add('alacrity', 'brisk and cheerful readiness', 'temperament');
    const entry = dict.getDefinition('alacrity');
    expect(entry).toEqual({ word: 'alacrity', definition: 'brisk and cheerful readiness', category: 'temperament', deprecated: false });
  });

  it('returns undefined for unknown word', () => {
    expect(dict.getDefinition('unknown')).toBeUndefined();
  });

  it('looks up case-insensitively', () => {
    dict.add('Alacrity', 'brisk and cheerful readiness');
    expect(dict.lookup('alacrity')).toBe('brisk and cheerful readiness');
    expect(dict.lookup('ALACRITY')).toBe('brisk and cheerful readiness');
  });

  it('filters by category', () => {
    dict.add('alacrity', 'brisk readiness', 'temperament');
    dict.add('brevity', 'concise expression', 'writing');
    dict.add('celerity', 'swiftness', 'temperament');
    const result = dict.getByCategory('temperament');
    expect(result).toHaveLength(2);
    expect(result.map(e => e.word)).toEqual(['alacrity', 'celerity']);
  });

  it('overwrites duplicate word on add', () => {
    dict.add('brevity', 'old definition');
    dict.add('brevity', 'new definition', 'writing');
    expect(dict.lookup('brevity')).toBe('new definition');
    expect(dict.getDefinition('brevity').category).toBe('writing');
    expect(dict.list()).toHaveLength(1);
  });

  it('lists all entries sorted alphabetically', () => {
    dict.add('celerity', 'swiftness');
    dict.add('alacrity', 'readiness');
    dict.add('brevity', 'conciseness');
    expect(dict.list().map(e => e.word)).toEqual(['alacrity', 'brevity', 'celerity']);
  });

  it('marks a word as deprecated', () => {
    dict.add('forsooth', 'in truth', 'archaic');
    dict.deprecate('forsooth');
    expect(dict.getDefinition('forsooth').deprecated).toBe(true);
  });

  it('throws when deprecating unknown word', () => {
    expect(() => dict.deprecate('unknown')).toThrow('word not found: unknown');
  });

  it('reports existence correctly', () => {
    dict.add('brevity', 'conciseness');
    expect(dict.exists('brevity')).toBe(true);
    expect(dict.exists('BREVITY')).toBe(true);
    expect(dict.exists('unknown')).toBe(false);
  });

  it('filters deprecated words from list', () => {
    dict.add('alacrity', 'readiness');
    dict.add('forsooth', 'in truth');
    dict.deprecate('forsooth');
    const active = dict.list({ excludeDeprecated: true });
    expect(active).toHaveLength(1);
    expect(active[0].word).toBe('alacrity');
  });
});
`;

  if (tier === 'small') return base;

  const medium = `describe('Dictionary medium', () => {
  it('maintains sort stability after overwrites', () => {
    dict.add('delta', 'fourth');
    dict.add('alpha', 'first');
    dict.add('charlie', 'third');
    dict.add('bravo', 'second');
    dict.add('alpha', 'updated first');
    expect(dict.list().map(e => e.word)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('returns empty array for category with no entries', () => {
    dict.add('alpha', 'first', 'common');
    expect(dict.getByCategory('rare')).toEqual([]);
  });

  it('updates category on overwrite', () => {
    dict.add('brevity', 'conciseness', 'writing');
    dict.add('brevity', 'shortness', 'speech');
    expect(dict.getDefinition('brevity').category).toBe('speech');
    expect(dict.getByCategory('writing')).toHaveLength(0);
    expect(dict.getByCategory('speech')).toHaveLength(1);
  });

  it('handles multiple deprecated entries correctly', () => {
    dict.add('alpha', 'first');
    dict.add('bravo', 'second');
    dict.add('charlie', 'third');
    dict.deprecate('alpha');
    dict.deprecate('charlie');
    const active = dict.list({ excludeDeprecated: true });
    expect(active).toHaveLength(1);
    expect(active[0].word).toBe('bravo');
    const all = dict.list();
    expect(all).toHaveLength(3);
  });

  it('getByCategory returns all entries including deprecated', () => {
    dict.add('alpha', 'first', 'common');
    dict.add('bravo', 'second', 'common');
    dict.deprecate('alpha');
    const result = dict.getByCategory('common');
    expect(result).toHaveLength(2);
  });

  it('handles empty string category', () => {
    dict.add('alpha', 'first', '');
    dict.add('bravo', 'second');
    expect(dict.getDefinition('alpha').category).toBe('');
    expect(dict.getDefinition('bravo').category).toBeUndefined();
  });

  it('preserves deprecated flag after overwrite', () => {
    dict.add('alpha', 'old');
    dict.deprecate('alpha');
    dict.add('alpha', 'new');
    expect(dict.getDefinition('alpha').deprecated).toBe(false);
    expect(dict.getDefinition('alpha').definition).toBe('new');
  });

  it('handles single-entry dictionary', () => {
    dict.add('only', 'the one');
    expect(dict.list()).toHaveLength(1);
    expect(dict.lookup('only')).toBe('the one');
    expect(dict.exists('only')).toBe(true);
    dict.deprecate('only');
    expect(dict.list({ excludeDeprecated: true })).toHaveLength(0);
  });

  it('getByCategory returns empty array for empty dictionary', () => {
    expect(dict.getByCategory('any')).toEqual([]);
  });

  it('getDefinition is case-sensitive while lookup is case-insensitive', () => {
    dict.add('Alpha', 'uppercase entry');
    expect(dict.getDefinition('alpha')).toBeUndefined();
    expect(dict.getDefinition('Alpha')).toBeDefined();
    expect(dict.lookup('alpha')).toBe('uppercase entry');
  });

  it('list returns copies not references', () => {
    dict.add('alpha', 'first');
    const list1 = dict.list();
    const list2 = dict.list();
    expect(list1).not.toBe(list2);
    expect(list1).toEqual(list2);
  });

  it('handles many categories correctly', () => {
    const cats = ['a', 'b', 'c', 'd', 'e'];
    cats.forEach((c, i) => dict.add(\`word\${i}\`, \`def\${i}\`, c));
    cats.forEach(c => expect(dict.getByCategory(c)).toHaveLength(1));
    expect(dict.getByCategory('nonexistent')).toEqual([]);
  });

  it('deprecate then re-add removes deprecated status', () => {
    dict.add('alpha', 'first');
    dict.deprecate('alpha');
    expect(dict.getDefinition('alpha').deprecated).toBe(true);
    dict.add('alpha', 'refreshed');
    expect(dict.getDefinition('alpha').deprecated).toBe(false);
  });

  it('handles 20 entries correctly', () => {
    for (let i = 0; i < 20; i++) dict.add(\`word\${String(i).padStart(2, '0')}\`, \`def\${i}\`);
    expect(dict.list()).toHaveLength(20);
    expect(dict.list()[0].word).toBe('word00');
    expect(dict.list()[19].word).toBe('word19');
  });
});
`;

  if (tier === 'medium') return base + medium;

  const large = `describe('Dictionary large', () => {
  it('handles 100 bulk insertions sorted', () => {
    const words = Array.from({ length: 100 }, (_, i) => \`bulk\${String(i).padStart(3, '0')}\`);
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    shuffled.forEach(w => dict.add(w, \`def-\${w}\`));
    const listed = dict.list();
    expect(listed).toHaveLength(100);
    expect(listed.map(e => e.word)).toEqual(words);
  });

  it('handles unicode words correctly', () => {
    dict.add('日本語', 'Japanese word', 'language');
    dict.add('café', 'coffee house', 'french');
    dict.add('naïve', 'lacking experience', 'french');
    expect(dict.lookup('日本語')).toBe('Japanese word');
    expect(dict.lookup('café')).toBe('coffee house');
    expect(dict.getByCategory('french')).toHaveLength(2);
  });

  it('handles very long definitions', () => {
    const longDef = 'A'.repeat(10000);
    dict.add('verbose', longDef);
    expect(dict.lookup('verbose')).toBe(longDef);
    expect(dict.lookup('verbose')).toHaveLength(10000);
  });

  it('handles words with special characters', () => {
    dict.add('hello-world', 'hyphenated');
    dict.add('foo.bar', 'dotted');
    dict.add('under_score', 'underscored');
    expect(dict.list()).toHaveLength(3);
    expect(dict.lookup('hello-world')).toBe('hyphenated');
  });

  it('supports rapid overwrite cycles', () => {
    for (let i = 0; i < 50; i++) dict.add('cyclic', \`version-\${i}\`);
    expect(dict.list()).toHaveLength(1);
    expect(dict.lookup('cyclic')).toBe('version-49');
  });

  it('handles mixed deprecate and add operations', () => {
    for (let i = 0; i < 20; i++) dict.add(\`word\${i}\`, \`def\${i}\`, i % 2 === 0 ? 'even' : 'odd');
    for (let i = 0; i < 20; i += 3) dict.deprecate(\`word\${i}\`);
    const active = dict.list({ excludeDeprecated: true });
    expect(active.length).toBeLessThan(20);
    active.forEach(e => expect(e.deprecated).toBe(false));
    expect(dict.getByCategory('even')).toHaveLength(10);
  });

  it('handles 5 distinct categories with 10 entries each', () => {
    const cats = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    for (let i = 0; i < 50; i++) dict.add(\`w\${i}\`, \`d\${i}\`, cats[i % 5]);
    cats.forEach(c => expect(dict.getByCategory(c)).toHaveLength(10));
    expect(dict.list()).toHaveLength(50);
  });

  it('getDefinition returns undefined for all case variants of missing word', () => {
    dict.add('Defined', 'exists');
    expect(dict.getDefinition('defined')).toBeUndefined();
    expect(dict.getDefinition('DEFINED')).toBeUndefined();
    expect(dict.getDefinition('dEfInEd')).toBeUndefined();
  });

  it('list excludeDeprecated with all deprecated returns empty', () => {
    dict.add('a', '1');
    dict.add('b', '2');
    dict.deprecate('a');
    dict.deprecate('b');
    expect(dict.list({ excludeDeprecated: true })).toEqual([]);
    expect(dict.list()).toHaveLength(2);
  });

  it('overwrite with same word and definition is idempotent', () => {
    dict.add('stable', 'unchanged', 'test');
    dict.add('stable', 'unchanged', 'test');
    expect(dict.list()).toHaveLength(1);
    expect(dict.getDefinition('stable')).toEqual({ word: 'stable', definition: 'unchanged', category: 'test', deprecated: false });
  });

  it('handles interleaved add-deprecate-add sequences', () => {
    dict.add('alpha', 'first');
    dict.deprecate('alpha');
    dict.add('bravo', 'second');
    dict.add('alpha', 'reborn');
    expect(dict.getDefinition('alpha').deprecated).toBe(false);
    expect(dict.list({ excludeDeprecated: true })).toHaveLength(2);
  });

  it('handles 200 entries with random operations', () => {
    const ops = [];
    for (let i = 0; i < 200; i++) {
      const word = \`entry\${String(i).padStart(3, '0')}\`;
      dict.add(word, \`definition for \${word}\`, \`cat\${i % 10}\`);
      ops.push(word);
    }
    expect(dict.list()).toHaveLength(200);
    // Deprecate every 5th entry
    for (let i = 0; i < 200; i += 5) dict.deprecate(ops[i]);
    expect(dict.list({ excludeDeprecated: true })).toHaveLength(160);
    expect(dict.list()).toHaveLength(200);
  });

  it('getByCategory preserves insertion order within category', () => {
    dict.add('zulu', 'last', 'military');
    dict.add('alpha', 'first', 'military');
    dict.add('mike', 'middle', 'military');
    const result = dict.getByCategory('military');
    expect(result.map(e => e.word)).toEqual(['zulu', 'alpha', 'mike']);
  });

  it('exists returns false after deprecation', () => {
    dict.add('ghost', 'haunting');
    expect(dict.exists('ghost')).toBe(true);
    dict.deprecate('ghost');
    expect(dict.exists('ghost')).toBe(true); // still exists, just deprecated
  });

  it('handles empty string as word', () => {
    dict.add('', 'empty key');
    expect(dict.lookup('')).toBe('empty key');
    expect(dict.list()).toHaveLength(1);
  });

  it('handles category-based filtering with 50 categories', () => {
    for (let i = 0; i < 50; i++) dict.add(\`cat\${i}word\`, \`def\`, \`category\${i}\`);
    for (let i = 0; i < 50; i++) expect(dict.getByCategory(\`category\${i}\`)).toHaveLength(1);
  });

  it('maintains performance with repeated list calls', () => {
    for (let i = 0; i < 100; i++) dict.add(\`perf\${i}\`, \`d\${i}\`);
    const start = Date.now();
    for (let i = 0; i < 1000; i++) dict.list();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000); // should complete in under 5s
  });

  it('handles sequential deprecate-all then list', () => {
    for (let i = 0; i < 30; i++) dict.add(\`w\${i}\`, \`d\${i}\`);
    for (let i = 0; i < 30; i++) dict.deprecate(\`w\${i}\`);
    expect(dict.list({ excludeDeprecated: true })).toEqual([]);
    expect(dict.list()).toHaveLength(30);
    expect(dict.list().every(e => e.deprecated)).toBe(true);
  });

  it('getByCategory with deprecated entries mixed', () => {
    dict.add('a', '1', 'x');
    dict.add('b', '2', 'x');
    dict.add('c', '3', 'x');
    dict.deprecate('b');
    const result = dict.getByCategory('x');
    expect(result).toHaveLength(3); // includes deprecated
    expect(result.filter(e => !e.deprecated)).toHaveLength(2);
  });
});
`;

  return base + medium + large;
}

/**
 * Generate tier-scaled spec content for L3.
 * Core requirements (8) + medium-specific + large-specific.
 */
function buildL3SpecContent(tier) {
  const core = `## ADDED Requirements

### Requirement: Add and retrieve definitions
The dictionary MUST store word-definition pairs with optional category and allow retrieval.

#### Scenario: Add and retrieve
- Given a word "alacrity" with definition "brisk and cheerful readiness" and category "temperament"
- When the user looks up "alacrity"
- Then the full entry is returned with word, definition, category, and deprecated=false

### Requirement: Case-insensitive lookup
The dictionary MUST resolve lookups regardless of case.

#### Scenario: Case-insensitive
- Given the word "Alacrity" is stored
- When the user looks up "alacrity" or "ALACRITY"
- Then the same definition is returned

### Requirement: Filter by category
The dictionary MUST support filtering entries by their category.

#### Scenario: Category filter
- Given words in categories "temperament" and "writing"
- When the user requests entries for "temperament"
- Then only temperament entries are returned

### Requirement: Overwrite duplicates
The dictionary MUST overwrite an existing entry when the same word is added again.

#### Scenario: Duplicate overwrite
- Given "brevity" already exists with an old definition
- When the user adds "brevity" with a new definition and category
- Then the entry is updated and the list still contains only one "brevity"

### Requirement: Sorted listing
The dictionary MUST return entries in alphabetical order by word.

#### Scenario: Alphabetical list
- Given entries "celerity", "alacrity", "brevity"
- When the user lists all entries
- Then entries are ordered "alacrity", "brevity", "celerity"

### Requirement: Deprecate and exclude
The dictionary MUST allow marking a word as deprecated and filtering deprecated entries from the list.

#### Scenario: Deprecate
- Given "forsooth" is added and then deprecated
- When the user lists with excludeDeprecated=true
- Then "forsooth" is not included

### Requirement: Throw on unknown deprecate
The dictionary MUST throw when attempting to deprecate a word that does not exist.

#### Scenario: Unknown deprecate
- Given the dictionary is empty
- When the user calls deprecate("unknown")
- Then an error "word not found: unknown" is thrown

### Requirement: Existence check
The dictionary MUST report whether a word exists (case-insensitive).

#### Scenario: Exists check
- Given "brevity" is stored
- When the user checks exists("BREVITY")
- Then true is returned; exists("unknown") returns false
`;

  if (tier === 'small') return core;

  const medium = `
### Requirement: Sort stability after overwrites
The dictionary MUST maintain alphabetical order even after overwriting entries.

#### Scenario: Sort stability
- Given entries "delta", "alpha", "charlie", "bravo" are added, then "alpha" is overwritten
- When the user lists all entries
- Then the order is "alpha", "bravo", "charlie", "delta"

### Requirement: Empty category handling
The dictionary MUST return an empty array when filtering by a category with no entries.

#### Scenario: Empty category
- Given one entry in category "common"
- When the user requests entries for "rare"
- Then an empty array is returned

### Requirement: Category update on overwrite
The dictionary MUST update the category when overwriting an existing word.

#### Scenario: Category update
- Given "brevity" is in category "writing"
- When "brevity" is re-added with category "speech"
- Then getByCategory("writing") returns empty and getByCategory("speech") returns "brevity"

### Requirement: Multiple deprecated entries
The dictionary MUST correctly handle multiple deprecated entries in list filtering.

#### Scenario: Multiple deprecated
- Given three entries with two deprecated
- When the user lists with excludeDeprecated=true
- Then only the non-deprecated entry is returned

### Requirement: Category includes deprecated entries
The dictionary MUST include deprecated entries in category filter results.

#### Scenario: Category with deprecated
- Given two entries in "common" category, one deprecated
- When the user requests getByCategory("common")
- Then both entries are returned

### Requirement: Deprecated flag reset on overwrite
The dictionary MUST reset the deprecated flag to false when a deprecated word is re-added.

#### Scenario: Reset deprecated
- Given "alpha" is deprecated
- When "alpha" is re-added with a new definition
- Then deprecated is false

### Requirement: Case-sensitive getDefinition
The dictionary MUST perform case-sensitive matching for getDefinition while lookup remains case-insensitive.

#### Scenario: Case-sensitive getDefinition
- Given "Alpha" is stored with uppercase
- When the user calls getDefinition("alpha")
- Then undefined is returned; getDefinition("Alpha") returns the entry

### Requirement: List returns independent copies
The dictionary MUST return independent array copies from list() to prevent external mutation.

#### Scenario: List independence
- Given entries are stored
- When the user calls list() twice
- Then the returned arrays are distinct references with equal content

### Requirement: Many categories support
The dictionary MUST correctly support at least 5 distinct categories.

#### Scenario: Many categories
- Given entries across 5 categories
- When the user filters by each category
- Then each category returns exactly its entries
`;

  if (tier === 'medium') return core + medium;

  const large = `
### Requirement: Bulk insertion ordering
The dictionary MUST correctly sort 100+ entries alphabetically regardless of insertion order.

#### Scenario: Bulk insert
- Given 100 entries inserted in random order
- When the user lists all entries
- Then entries are in alphabetical order and count is 100

### Requirement: Unicode word support
The dictionary MUST support Unicode characters in word keys.

#### Scenario: Unicode words
- Given entries with Japanese, accented Latin, and special characters
- When the user looks up each word
- Then definitions are returned correctly

### Requirement: Long definition support
The dictionary MUST handle definitions of at least 10,000 characters.

#### Scenario: Long definition
- Given an entry with a 10,000-character definition
- When the user looks up the word
- Then the full definition is returned

### Requirement: Special characters in words
The dictionary MUST support hyphens, dots, and underscores in word keys.

#### Scenario: Special characters
- Given entries "hello-world", "foo.bar", "under_score"
- When the user lists all entries
- Then all three are present and retrievable

### Requirement: Rapid overwrite cycles
The dictionary MUST handle 50 consecutive overwrites of the same word without data corruption.

#### Scenario: Rapid overwrite
- Given "cyclic" is overwritten 50 times
- When the user looks up "cyclic"
- Then the 50th definition is returned and list length is 1

### Requirement: Mixed deprecate-add operations
The dictionary MUST maintain correctness when deprecate and add operations are interleaved across many entries.

#### Scenario: Mixed operations
- Given 20 entries with every 3rd deprecated
- When the user lists active entries
- Then deprecated entries are excluded and counts are correct

### Requirement: Many categories with equal distribution
The dictionary MUST support 10+ categories with correct per-category counts.

#### Scenario: 10 categories
- Given 50 entries distributed across 10 categories (5 each)
- When the user filters by any category
- Then exactly 5 entries are returned

### Requirement: Idempotent overwrite
The dictionary MUST produce identical state when overwriting with the same word and definition.

#### Scenario: Idempotent overwrite
- Given an entry is overwritten with identical data
- When the user lists entries
- Then count is 1 and entry data is unchanged

### Requirement: Interleaved deprecate-add lifecycle
The dictionary MUST correctly handle deprecate followed by re-add of the same word.

#### Scenario: Deprecate then re-add
- Given "alpha" is added, deprecated, then re-added
- When the user lists active entries
- Then "alpha" is included with deprecated=false

### Requirement: Large dataset operations
The dictionary MUST support 200 entries with batch deprecate operations.

#### Scenario: 200 entries
- Given 200 entries with every 5th deprecated
- When the user lists active entries
- Then 160 active entries are returned

### Requirement: Category insertion order preservation
The dictionary MUST preserve insertion order within category filter results.

#### Scenario: Category insertion order
- Given "zulu", "alpha", "mike" added to "military" category in that order
- When the user calls getByCategory("military")
- Then order is "zulu", "alpha", "mike"

### Requirement: Exists after deprecation
The dictionary MUST return true for exists() on deprecated words.

#### Scenario: Exists after deprecate
- Given "ghost" is deprecated
- When the user checks exists("ghost")
- Then true is returned

### Requirement: Empty string word key
The dictionary MUST support empty string as a valid word key.

#### Scenario: Empty string key
- Given an entry with word ""
- When the user looks up ""
- Then the definition is returned

### Requirement: 50 distinct categories
The dictionary MUST support filtering across 50 distinct categories.

#### Scenario: 50 categories
- Given 50 entries each in a unique category
- When the user filters by any category
- Then exactly 1 entry is returned

### Requirement: Repeated list call performance
The dictionary MUST complete 1000 list() calls on a 100-entry dictionary in under 5 seconds.

#### Scenario: Performance
- Given 100 entries
- When the user calls list() 1000 times
- Then total time is under 5000ms

### Requirement: Deprecate-all then list
The dictionary MUST return an empty active list when all entries are deprecated.

#### Scenario: All deprecated
- Given 30 entries all deprecated
- When the user lists with excludeDeprecated=true
- Then an empty array is returned

### Requirement: Category filter includes deprecated
The dictionary MUST include deprecated entries in getByCategory results.

#### Scenario: Category with mixed deprecated
- Given 3 entries in category "x" with 1 deprecated
- When the user calls getByCategory("x")
- Then 3 entries are returned, 2 not deprecated
`;

  return core + medium + large;
}

async function createL3Fixture(root, mode, tier) {
  const changeDir = path.join(root, 'openspec', 'changes', L3_CHANGE_NAME);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.mkdir(path.join(root, '.comet'), { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, 'tests'), { recursive: true });
  await fs.mkdir(path.join(changeDir, 'specs', 'dictionary'), { recursive: true });
  await fs.writeFile(path.join(root, '.comet', 'config.yaml'), `context_compression: ${mode}\n`);

  // OpenSpec change artifacts
  await fs.writeFile(path.join(changeDir, '.comet.yaml'), [
    'workflow: full', 'phase: open', `context_compression: ${mode}`,
    'build_mode: null', 'build_pause: null', 'subagent_dispatch: null',
    'tdd_mode: null', 'isolation: null', 'verify_mode: null',
    'design_doc: null', 'plan: null', 'base_ref: null',
    'verify_result: pending', 'verification_report: null',
    'branch_status: pending', 'created_at: 2026-06-07',
    'verified_at: null', 'archived: false',
    'handoff_context: null', 'handoff_hash: null', '',
  ].join('\n'));

  const sp = supportingParagraphsFor(tier);
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal', '',
    'Build a dictionary module that stores word-definition pairs with categories.',
    'Support case-insensitive lookup, category filtering, deprecation, and sorted listing.',
    '',
    ...Array.from({ length: sp }, (_, i) =>
      `Proposal rationale ${i + 1}: Dictionary module background and tradeoffs.`),
    '',
  ].join('\n'));

  await fs.writeFile(path.join(changeDir, 'design.md'), [
    '# Design', '',
    'Use an in-memory Map keyed by lowercase word.',
    'Each entry stores word, definition, category, and deprecated flag.',
    '',
    ...Array.from({ length: sp }, (_, i) =>
      `Design detail ${i + 1}: Architecture decisions for the dictionary module.`),
    '',
  ].join('\n'));

  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] Implement Dictionary class with add, getDefinition, lookup, getByCategory, list, deprecate, exists',
    '- [ ] Write tests for all dictionary operations',
    '- [ ] Ensure all tests pass',
    '',
  ].join('\n'));

  await fs.writeFile(path.join(changeDir, 'specs', 'dictionary', 'spec.md'), buildL3SpecContent(tier));

  // Project files
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'dict-benchmark-fixture',
    type: 'module',
    private: true,
    scripts: { test: 'vitest run --reporter=json' },
    devDependencies: { vitest: '^4.1.6' },
  }, null, 2));

  await fs.writeFile(
    path.join(root, 'vitest.config.js'),
    `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['tests/**/*.test.js'] } });\n`,
  );

  await fs.writeFile(
    path.join(root, 'src', 'dictionary.js'),
    '// TODO: Implement Dictionary class\nexport class Dictionary {}\n',
  );

  await fs.writeFile(path.join(root, 'tests', 'dictionary.test.js'), buildL3TestContent(tier));
  await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
}

/**
 * L3 Design Phase: Claude reads spec → produces Design Doc.
 * Returns { designDoc, specCoverage, usage, durationMs, costUsd }.
 */
function buildL3DesignPrompt(tier) {
  const reqCount = l3ReqCountFor(tier);
  return [
    'You are a senior engineer producing a Design Doc for a dictionary module.',
    '',
    'Read the spec at openspec/changes/dict-benchmark/specs/dictionary/spec.md',
    '',
    'Produce a Design Doc that:',
    '1. Summarizes the problem and goals',
    '2. Lists architectural decisions (data structure, API design, error handling)',
    '3. Maps each ADDED Requirement to a concrete implementation approach',
    '4. Identifies risks, edge cases, and open questions',
    '',
    'Save the Design Doc to docs/superpowers/specs/dict-design.md',
    '',
    'At the end of the Design Doc, include a JSON block:',
    '```json',
    '{"requirementsCovered":N,"requirementsTotal":N}',
    '```',
    `Where requirementsTotal = ${reqCount} (number of ADDED Requirements in the spec),`,
    'requirementsCovered = how many you addressed in the Design Doc.',
  ].join('\n');
}

async function runL3Design({ claudeCommand, model, cwd, tier }) {
  const prompt = buildL3DesignPrompt(tier);
  const args = buildClaudeArgs({ cwd, model });
  const { stdout, exitCode } = await spawnCapture(claudeCommand, args, {
    cwd,
    input: prompt,
    timeoutMs: CLAUDE_TIMEOUT_MS,
    allowFailure: true,
  });
  const parsed = parseClaudeJson(stdout);
  const verdict = parseDesignVerdict(parsed.result ?? stdout);
  return {
    usage: parsed.usage,
    durationMs: parsed.durationMs,
    costUsd: parsed.costUsd,
    specCoverage: verdict ? safeRatio(verdict.requirementsCovered, verdict.requirementsTotal) : 0,
    designDoc: parsed.result ?? '',
    exitCode,
  };
}

/**
 * L3 Build Phase: Claude reads compressed handoff context → implements → tests.
 * Returns { usage, attempts, testResult, completed, durationMs, costUsd }.
 */
function buildL3BuildPrompt(mode, contextFile, contextText, tier) {
  const testCount = l3TestCountFor(tier);
  return [
    'You are implementing a dictionary module based on a Design Doc and spec.',
    `Mode: ${mode} | Context source: ${contextFile}`,
    '',
    'Read the handoff context below. It contains the Design Doc and spec acceptance criteria.',
    '',
    'TASK:',
    '1. Implement src/dictionary.js that exports a Dictionary class with methods:',
    '   - add(word, definition, category?) — add or overwrite a word entry',
    '   - getDefinition(word) — return full entry object or undefined (case-sensitive)',
    '   - lookup(word) — return definition string or undefined (case-insensitive)',
    '   - getByCategory(category) — return array of entries matching category',
    '   - list(options?) — return all entries sorted by word; options.excludeDeprecated filters out deprecated',
    '   - deprecate(word) — set deprecated=true; throws "word not found: <word>" if not found',
    '   - exists(word) — return boolean (case-insensitive)',
    '2. Do NOT modify tests/dictionary.test.js',
    `3. Run \`npx vitest run\` to verify. Fix failures until all ${testCount} tests pass.`,
    '',
    '<comet_handoff_context>',
    contextText,
    '</comet_handoff_context>',
  ].join('\n');
}

async function runL3Build({ claudeCommand, model, cwd, mode, contextFile, contextText, tier, maxRetries }) {
  const basePrompt = buildL3BuildPrompt(mode, contextFile, contextText, tier);
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let totalDurationMs = 0;
  let totalCostUsd = 0;
  let lastResult = null;
  let testResult = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const prompt = attempt === 1 ? basePrompt : buildRetryPrompt(basePrompt, testResult);
    const args = buildClaudeArgs({ cwd, model });
    const { stdout, stderr, exitCode } = await spawnCapture(claudeCommand, args, {
      cwd,
      input: prompt,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      allowFailure: true,
    });
    const parsed = parseClaudeJson(stdout);
    lastResult = { ...parsed, stdout, stderr, exitCode };

    totalUsage.inputTokens += parsed.usage.inputTokens;
    totalUsage.outputTokens += parsed.usage.outputTokens;
    totalUsage.totalTokens += parsed.usage.totalTokens;
    totalDurationMs += parsed.durationMs;
    totalCostUsd += parsed.costUsd;

    testResult = await runTests(cwd);
    if (testResult.testsTotal > 0 && testResult.testsPassed === testResult.testsTotal) {
      return {
        usage: totalUsage,
        attempts: attempt,
        testResult,
        completed: true,
        durationMs: totalDurationMs,
        costUsd: totalCostUsd,
        lastResult,
      };
    }
  }

  return {
    usage: totalUsage,
    attempts: maxRetries,
    testResult,
    completed: false,
    durationMs: totalDurationMs,
    costUsd: totalCostUsd,
    lastResult,
  };
}

/**
 * L3 Full Workflow: Design → Handoff → Build.
 * 1. Claude produces Design Doc from spec
 * 2. comet-handoff.sh compresses context (off=full excerpts, beta=spec-only projection)
 * 3. Claude reads compressed handoff → implements → tests
 */
async function runL3({ claudeCommand, model, cwd, mode, tier, maxRetries }) {
  // Phase 1: Design
  await fs.mkdir(path.join(cwd, 'docs', 'superpowers', 'specs'), { recursive: true });
  const designResult = await runL3Design({ claudeCommand, model, cwd, tier });

  // Generate handoff (real comet-handoff.sh compression)
  await generateHandoff(cwd, L3_CHANGE_NAME);

  // Read compressed handoff context
  const { contextFile, contextText } = await readHandoffContext(cwd, mode, L3_CHANGE_NAME);

  // Phase 2: Build (from compressed handoff)
  const buildResult = await runL3Build({
    claudeCommand, model, cwd, mode,
    contextFile, contextText, tier, maxRetries,
  });

  // Aggregate metrics across both phases
  return {
    phase: 'l3',
    usage: {
      inputTokens: designResult.usage.inputTokens + buildResult.usage.inputTokens,
      outputTokens: designResult.usage.outputTokens + buildResult.usage.outputTokens,
      totalTokens: designResult.usage.totalTokens + buildResult.usage.totalTokens,
    },
    attempts: buildResult.attempts,
    testResult: buildResult.testResult,
    completed: buildResult.completed,
    specCoverage: designResult.specCoverage,
    durationMs: designResult.durationMs + buildResult.durationMs,
    costUsd: designResult.costUsd + buildResult.costUsd,
    lastResult: buildResult.lastResult,
  };
}

// ── Dry-run ────────────────────────────────────────────────────────

function dryRunL1(mode, tier, context) {
  const beta = mode === 'beta';
  const tierMultiplier = { small: 1, medium: 2, large: 4 }[tier] ?? 1;
  const baseInput = context.approxTokens + 600 * tierMultiplier;
  const reqTotal = specCountFor(tier);
  return {
    phase: 'l1',
    usage: beta
      ? { inputTokens: baseInput, outputTokens: 400, totalTokens: baseInput + 400 }
      : { inputTokens: baseInput + 150 * tierMultiplier, outputTokens: 500, totalTokens: baseInput + 500 + 150 * tierMultiplier },
    durationMs: beta ? 4000 * tierMultiplier : 6000 * tierMultiplier,
    costUsd: beta ? 0.04 : 0.06,
    verdict: {
      requirementsCovered: reqTotal,
      requirementsTotal: reqTotal,
      decisionsCount: beta ? 3 : 4,
      risksIdentified: beta ? 2 : 3,
      coverageRate: 1,
    },
    designDoc: '# Design Doc (dry-run)',
    exitCode: 0,
  };
}

function dryRunL2(mode, tier, context) {
  const beta = mode === 'beta';
  const tierMultiplier = { small: 1, medium: 2, large: 4 }[tier] ?? 1;
  const baseInput = context.approxTokens + 800 * tierMultiplier;
  const testsTotal = 5;
  return {
    phase: 'l2',
    usage: beta
      ? { inputTokens: baseInput, outputTokens: 300, totalTokens: baseInput + 300 }
      : { inputTokens: baseInput + 200 * tierMultiplier, outputTokens: 400, totalTokens: baseInput + 400 + 200 * tierMultiplier },
    attempts: beta ? 1 : 2,
    testResult: {
      testsTotal,
      testsPassed: testsTotal,
      testsFailed: [],
      testPassRate: 1,
    },
    completed: true,
    durationMs: beta ? 5000 * tierMultiplier : 8000 * tierMultiplier,
    costUsd: beta ? 0.05 : 0.08,
    lastResult: { isError: false },
  };
}

function dryRunL3(mode, tier, context) {
  const beta = mode === 'beta';
  // Dramatic scaling: small=1, medium=5, large=15
  const tierMultiplier = { small: 1, medium: 5, large: 15 }[tier] ?? 1;
  const testsTotal = l3TestCountFor(tier);
  // Realistic token counts: small ~3K, medium ~15K, large ~60K
  const baseInput = context.approxTokens + 2000 * tierMultiplier;
  const offExtra = 800 * tierMultiplier; // off mode overhead from larger context
  return {
    phase: 'l3',
    usage: beta
      ? { inputTokens: baseInput, outputTokens: 600 * tierMultiplier, totalTokens: baseInput + 600 * tierMultiplier }
      : { inputTokens: baseInput + offExtra, outputTokens: 800 * tierMultiplier, totalTokens: baseInput + offExtra + 800 * tierMultiplier },
    attempts: beta ? 1 : 2,
    testResult: {
      testsTotal,
      testsPassed: testsTotal,
      testsFailed: [],
      testPassRate: 1,
    },
    completed: true,
    specCoverage: beta ? 0.95 : 1, // beta mode compresses, may lose minor details
    durationMs: beta ? 8000 * tierMultiplier : 14000 * tierMultiplier,
    costUsd: beta ? 0.08 * tierMultiplier : 0.14 * tierMultiplier,
    lastResult: { isError: false },
  };
}

// ── Summarization ──────────────────────────────────────────────────

export function summarizeExecution(results) {
  const phases = {};
  for (const phase of ['l1', 'l2', 'l3']) {
    const phaseResults = results.filter((r) => r.phase === phase);
    if (phaseResults.length === 0) continue;

    const modes = {};
    for (const mode of MODES) {
      const modeResults = phaseResults.filter((r) => r.mode === mode);
      const count = modeResults.length || 1;

      if (phase === 'l1') {
        const totals = modeResults.reduce((acc, r) => {
          acc.inputTokens += r.usage.inputTokens;
          acc.outputTokens += r.usage.outputTokens;
          acc.totalTokens += r.usage.totalTokens;
          acc.durationMs += r.durationMs;
          acc.costUsd += r.costUsd ?? 0;
          acc.requirementsCovered += r.verdict?.requirementsCovered ?? 0;
          acc.requirementsTotal += r.verdict?.requirementsTotal ?? 0;
          acc.decisionsCount += r.verdict?.decisionsCount ?? 0;
          acc.risksIdentified += r.verdict?.risksIdentified ?? 0;
          acc.contextChars += r.context?.chars ?? 0;
          return acc;
        }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0, costUsd: 0, requirementsCovered: 0, requirementsTotal: 0, decisionsCount: 0, risksIdentified: 0, contextChars: 0 });

        modes[mode] = {
          runs: modeResults.length,
          avgInputTokens: round(totals.inputTokens / count),
          avgOutputTokens: round(totals.outputTokens / count),
          avgTotalTokens: round(totals.totalTokens / count),
          avgDurationMs: round(totals.durationMs / count),
          avgCostUsd: round(totals.costUsd / count),
          avgContextChars: round(totals.contextChars / count),
          avgRequirementsCovered: round(totals.requirementsCovered / count),
          avgRequirementsTotal: round(totals.requirementsTotal / count),
          avgCoverageRate: round(safeRatio(totals.requirementsCovered, totals.requirementsTotal)),
          avgDecisionsCount: round(totals.decisionsCount / count),
          avgRisksIdentified: round(totals.risksIdentified / count),
        };
      } else {
        const totals = modeResults.reduce((acc, r) => {
          acc.inputTokens += r.usage.inputTokens;
          acc.outputTokens += r.usage.outputTokens;
          acc.totalTokens += r.usage.totalTokens;
          acc.durationMs += r.durationMs;
          acc.costUsd += r.costUsd ?? 0;
          acc.attempts += r.attempts;
          acc.testsPassed += r.testResult?.testsPassed ?? 0;
          acc.testsTotal += r.testResult?.testsTotal ?? 0;
          acc.completed += r.completed ? 1 : 0;
          acc.specCoverageSum += r.specCoverage ?? 0;
          acc.specCoverageCount += r.specCoverage != null ? 1 : 0;
          acc.contextChars += r.context?.chars ?? 0;
          return acc;
        }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0, costUsd: 0, attempts: 0, testsPassed: 0, testsTotal: 0, completed: 0, specCoverageSum: 0, specCoverageCount: 0, contextChars: 0 });

        modes[mode] = {
          runs: modeResults.length,
          avgInputTokens: round(totals.inputTokens / count),
          avgOutputTokens: round(totals.outputTokens / count),
          avgTotalTokens: round(totals.totalTokens / count),
          avgDurationMs: round(totals.durationMs / count),
          avgCostUsd: round(totals.costUsd / count),
          avgAttempts: round(totals.attempts / count),
          avgTestPassRate: round(safeRatio(totals.testsPassed, totals.testsTotal)),
          completionRate: round(safeRatio(totals.completed, count)),
          avgSpecCoverage: totals.specCoverageCount > 0 ? round(totals.specCoverageSum / totals.specCoverageCount) : null,
          avgContextChars: round(totals.contextChars / count),
        };
      }
    }

    const off = modes.off;
    const beta = modes.beta;
    phases[phase] = {
      modes,
      tokenSavings: {
        totalTokens: round(off.avgTotalTokens - beta.avgTotalTokens),
        inputTokens: round(off.avgInputTokens - beta.avgInputTokens),
        percent: round(safeRatio(off.avgTotalTokens - beta.avgTotalTokens, off.avgTotalTokens) * 100),
      },
    };
  }

  return phases;
}

// ── Report ─────────────────────────────────────────────────────────

function renderMarkdownReport(report) {
  const lines = [
    '# Comet Execution Benchmark 报告', '',
    `- 生成时间: ${report.generatedAt}`,
    `- Dry run: ${report.dryRun ? '是' : '否'}`,
    `- 测试阶段: ${report.phase}`,
    `- 每组重复次数: ${report.repeats}`,
    `- 测试档位: ${report.tiers.join(', ')}`, '',
  ];

  if (report.summary.l1) {
    const l1 = report.summary.l1;
    lines.push(
      '## L1: 设计阶段', '',
      `- Token 节省: ${l1.tokenSavings.totalTokens} (${l1.tokenSavings.percent}%)`,
      `- 输入 token 节省: ${l1.tokenSavings.inputTokens}`, '',
      '| 模式 | 平均总 tokens | 需求覆盖率 | 平均决策数 | 平均风险数 | 平均耗时(s) | 平均成本($) |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const mode of MODES) {
      const m = l1.modes[mode];
      if (!m) continue;
      lines.push(`| ${mode} | ${m.avgTotalTokens} | ${round(m.avgCoverageRate * 100)}% | ${m.avgDecisionsCount} | ${m.avgRisksIdentified} | ${round(m.avgDurationMs / 1000)} | ${m.avgCostUsd} |`);
    }
    lines.push('');
  }

  if (report.summary.l2) {
    const l2 = report.summary.l2;
    lines.push(
      '## L2: 构建阶段', '',
      `- Token 节省: ${l2.tokenSavings.totalTokens} (${l2.tokenSavings.percent}%)`,
      `- 输入 token 节省: ${l2.tokenSavings.inputTokens}`, '',
      '| 模式 | 平均总 tokens | 测试通过率 | 完成率 | 平均重试 | 平均耗时(s) | 平均成本($) |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const mode of MODES) {
      const m = l2.modes[mode];
      if (!m) continue;
      lines.push(`| ${mode} | ${m.avgTotalTokens} | ${round(m.avgTestPassRate * 100)}% | ${round(m.completionRate * 100)}% | ${m.avgAttempts} | ${round(m.avgDurationMs / 1000)} | ${m.avgCostUsd} |`);
    }
    lines.push('');

    // Tier breakdown for L2
    lines.push('### L2 分档明细', '',
      '| 档位 | off 总 tokens | beta 总 tokens | Token 节省 | off 通过率 | beta 通过率 | off 完成率 | beta 完成率 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const tier of report.tiers) {
      const tierResults = report.results.filter((r) => r.tier === tier && r.phase === 'l2');
      if (tierResults.length === 0) continue;
      const tierModes = {};
      for (const mode of MODES) {
        const mr = tierResults.filter((r) => r.mode === mode);
        const c = mr.length || 1;
        const t = mr.reduce((acc, r) => {
          acc.totalTokens += r.usage.totalTokens;
          acc.testsPassed += r.testResult?.testsPassed ?? 0;
          acc.testsTotal += r.testResult?.testsTotal ?? 0;
          acc.completed += r.completed ? 1 : 0;
          return acc;
        }, { totalTokens: 0, testsPassed: 0, testsTotal: 0, completed: 0 });
        tierModes[mode] = {
          avgTotalTokens: round(t.totalTokens / c),
          avgTestPassRate: round(safeRatio(t.testsPassed, t.testsTotal)),
          completionRate: round(safeRatio(t.completed, c)),
        };
      }
      const savings = round(tierModes.off.avgTotalTokens - tierModes.beta.avgTotalTokens);
      const savingsPct = round(safeRatio(savings, tierModes.off.avgTotalTokens) * 100);
      lines.push(`| ${tier} | ${tierModes.off.avgTotalTokens} | ${tierModes.beta.avgTotalTokens} | ${savings} (${savingsPct}%) | ${round(tierModes.off.avgTestPassRate * 100)}% | ${round(tierModes.beta.avgTestPassRate * 100)}% | ${round(tierModes.off.completionRate * 100)}% | ${round(tierModes.beta.completionRate * 100)}% |`);
    }
    lines.push('');
  }

  if (report.summary.l3) {
    const l3 = report.summary.l3;
    lines.push(
      '## L3: 全流程（spec → design doc → handoff 压缩 → 实现 → 测试）', '',
      `- Token 节省: ${l3.tokenSavings.totalTokens} (${l3.tokenSavings.percent}%)`,
      `- 输入 token 节省: ${l3.tokenSavings.inputTokens}`, '',
      '| 模式 | 平均总 tokens | Spec 覆盖率 | 测试通过率 | 平均重试 | 平均耗时(s) | 平均成本($) |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const mode of MODES) {
      const m = l3.modes[mode];
      if (!m) continue;
      const specCov = m.avgSpecCoverage != null ? `${round(m.avgSpecCoverage * 100)}%` : '-';
      lines.push(`| ${mode} | ${m.avgTotalTokens} | ${specCov} | ${round(m.avgTestPassRate * 100)}% | ${m.avgAttempts} | ${round(m.avgDurationMs / 1000)} | ${m.avgCostUsd} |`);
    }
    lines.push('');

    // Tier breakdown for L3
    lines.push('### L3 分档明细', '',
      '| 档位 | off tokens | beta tokens | Token 节省 | off 测试通过率 | beta 测试通过率 | off Spec覆盖 | beta Spec覆盖 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const tier of report.tiers) {
      const tierResults = report.results.filter((r) => r.tier === tier && r.phase === 'l3');
      if (tierResults.length === 0) continue;
      const tierModes = {};
      for (const mode of MODES) {
        const mr = tierResults.filter((r) => r.mode === mode);
        const c = mr.length || 1;
        const t = mr.reduce((acc, r) => {
          acc.totalTokens += r.usage.totalTokens;
          acc.testsPassed += r.testResult?.testsPassed ?? 0;
          acc.testsTotal += r.testResult?.testsTotal ?? 0;
          acc.specCoverageSum += r.specCoverage ?? 0;
          acc.specCoverageCount += r.specCoverage != null ? 1 : 0;
          return acc;
        }, { totalTokens: 0, testsPassed: 0, testsTotal: 0, specCoverageSum: 0, specCoverageCount: 0 });
        tierModes[mode] = {
          avgTotalTokens: round(t.totalTokens / c),
          avgTestPassRate: round(safeRatio(t.testsPassed, t.testsTotal)),
          avgSpecCoverage: t.specCoverageCount > 0 ? round(t.specCoverageSum / t.specCoverageCount) : null,
        };
      }
      const savings = round(tierModes.off.avgTotalTokens - tierModes.beta.avgTotalTokens);
      const savingsPct = round(safeRatio(savings, tierModes.off.avgTotalTokens) * 100);
      const offSpec = tierModes.off.avgSpecCoverage != null ? `${round(tierModes.off.avgSpecCoverage * 100)}%` : '-';
      const betaSpec = tierModes.beta.avgSpecCoverage != null ? `${round(tierModes.beta.avgSpecCoverage * 100)}%` : '-';
      lines.push(`| ${tier} | ${tierModes.off.avgTotalTokens} | ${tierModes.beta.avgTotalTokens} | ${savings} (${savingsPct}%) | ${round(tierModes.off.avgTestPassRate * 100)}% | ${round(tierModes.beta.avgTestPassRate * 100)}% | ${offSpec} | ${betaSpec} |`);
    }
    lines.push('');
  }

  lines.push('## 原始数据', '', '- `report.json` 包含每次运行的完整 token usage、verdict、测试结果和耗时。', '');
  return lines.join('\n');
}

// ── Main entry ─────────────────────────────────────────────────────

export async function runExecutionBenchmark(options = {}) {
  const config = {
    phase: options.phase ?? 'both',
    workspace: path.resolve(options.workspace ?? path.join(REPO_ROOT, '.comet', 'benchmark-runs')),
    repeats: options.repeats ?? 1,
    claudeCommand: options.claudeCommand ?? 'claude',
    model: options.model ?? null,
    dryRun: Boolean(options.dryRun),
    tiers: options.tiers ?? TIERS,
    maxRetries: options.maxRetries ?? MAX_RETRIES,
  };

  const runL1Phase = config.phase === 'l1' || config.phase === 'both' || config.phase === 'all';
  const runL2Phase = config.phase === 'l2' || config.phase === 'both' || config.phase === 'all';
  const runL3Phase = config.phase === 'l3' || config.phase === 'all';

  const root = path.join(config.workspace, '.comet', 'benchmark', 'execution');
  await fs.mkdir(root, { recursive: true });

  const results = [];

  for (let repeat = 1; repeat <= config.repeats; repeat++) {
    for (const tier of config.tiers) {
      for (const mode of MODES) {
        // ── L1: Design Phase ──
        if (runL1Phase) {
          const l1Root = path.join(root, 'l1', tier, mode);
          await createL1Fixture(l1Root, mode, tier);

          if (!config.dryRun) {
            await generateHandoff(l1Root);
          } else {
            await writeSyntheticHandoff(l1Root, mode, tier);
          }

          const context = await measureContext(l1Root, mode);
          const { contextFile, contextText } = await readHandoffContext(l1Root, mode);

          const started = Date.now();
          const l1Result = config.dryRun
            ? dryRunL1(mode, tier, context)
            : await runL1({
                claudeCommand: config.claudeCommand,
                model: config.model,
                cwd: l1Root,
                mode,
                contextFile,
                contextText,
              });

          results.push({ tier, mode, repeat, fixtureRoot: l1Root, context, durationMs: Date.now() - started, ...l1Result });
        }

        // ── L2: Build Phase ──
        if (runL2Phase) {
          const l2Root = path.join(root, 'l2', tier, mode);
          await createL2Fixture(l2Root, mode, tier);

          if (!config.dryRun) {
            await generateHandoff(l2Root);
            await installDependencies(l2Root);
            await initGitRepo(l2Root);
          } else {
            await writeSyntheticHandoff(l2Root, mode, tier);
          }

          const context = await measureContext(l2Root, mode);
          const { contextFile, contextText } = await readHandoffContext(l2Root, mode);

          const started = Date.now();
          const l2Result = config.dryRun
            ? dryRunL2(mode, tier, context)
            : await runL2({
                claudeCommand: config.claudeCommand,
                model: config.model,
                cwd: l2Root,
                mode,
                contextFile,
                contextText,
                maxRetries: config.maxRetries,
              });

          results.push({ tier, mode, repeat, fixtureRoot: l2Root, context, durationMs: Date.now() - started, ...l2Result });
        }

        // ── L3: Full Workflow ──
        if (runL3Phase) {
          const l3Root = path.join(root, 'l3', tier, mode);
          await createL3Fixture(l3Root, mode, tier);

          if (!config.dryRun) {
            await installDependencies(l3Root);
            await initGitRepo(l3Root);
          }

          const context = await measureL3Context(l3Root, mode, tier);

          const started = Date.now();
          const l3Result = config.dryRun
            ? dryRunL3(mode, tier, context)
            : await runL3({
                claudeCommand: config.claudeCommand,
                model: config.model,
                cwd: l3Root,
                mode,
                tier,
                maxRetries: config.maxRetries,
              });

          results.push({ tier, mode, repeat, fixtureRoot: l3Root, context, durationMs: Date.now() - started, ...l3Result });
        }
      }
    }
  }

  const summary = summarizeExecution(results);
  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    phase: config.phase,
    repeats: config.repeats,
    tiers: config.tiers,
    maxRetries: config.maxRetries,
    claudeCommand: config.claudeCommand,
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

async function installDependencies(cwd) {
  try {
    await spawnCapture(cmd('pnpm'), ['install', '--no-frozen-lockfile'], { cwd, timeoutMs: INSTALL_TIMEOUT_MS });
  } catch {
    await spawnCapture(cmd('npm'), ['install'], { cwd, timeoutMs: INSTALL_TIMEOUT_MS });
  }
}

async function initGitRepo(cwd) {
  try {
    await spawnCapture('git', ['init'], { cwd, allowFailure: true });
    await spawnCapture('git', ['add', '-A'], { cwd, allowFailure: true });
    await spawnCapture('git', ['commit', '-m', 'initial fixture'], { cwd, allowFailure: true });
  } catch { /* non-fatal */ }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log(usage()); return; }
    const report = await runExecutionBenchmark(options);
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
