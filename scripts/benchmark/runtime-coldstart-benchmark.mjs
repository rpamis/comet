#!/usr/bin/env node
/**
 * Cold-start micro-benchmark for the high-frequency Comet entry points.
 *
 * Each PreToolUse Hook and every CLI invocation pays a one-time Node process
 * startup cost before any logic runs. Issue #239 reported this as the main
 * source of "simple tasks slowing down". This benchmark measures that fixed
 * cost per entry point so regressions are visible.
 *
 * Run modes:
 *   node scripts/benchmark/runtime-coldstart-benchmark.mjs           # print medians
 *   node scripts/benchmark/runtime-coldstart-benchmark.mjs --record   # write/refresh baseline
 *   node scripts/benchmark/runtime-coldstart-benchmark.mjs --check    # compare to baseline, exit 1 on regression
 *
 * The baseline is intentionally machine-local (committed for trend tracking,
 * not as an absolute SLA). The --check threshold defaults to +30% over the
 * recorded median.
 */
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const RUNTIME_SCRIPTS = path.join(REPO_ROOT, 'assets', 'skills', 'comet', 'scripts');
const NATIVE_SCRIPTS = path.join(REPO_ROOT, 'assets', 'skills', 'comet-native', 'scripts');
const BIN = path.join(REPO_ROOT, 'bin', 'comet.js');
const BASELINE_FILE = path.join(
  REPO_ROOT,
  'scripts',
  'benchmark',
  'runtime-coldstart-baseline.json',
);
const DEFAULT_THRESHOLD = 0.3; // +30% over baseline median counts as a regression
const RUNS = 9;

const TARGETS = [
  // High-frequency Hook path: triggered on every Write|Edit.
  {
    name: 'hook-router',
    script: path.join(RUNTIME_SCRIPTS, 'comet-hook-router.mjs'),
    args: ['--platform', 'claude'],
  },
  // Per-command Classic launchers (now self-contained bundles).
  {
    name: 'classic-state',
    script: path.join(RUNTIME_SCRIPTS, 'comet-state.mjs'),
    args: ['current', '--json'],
  },
  {
    name: 'classic-hook-guard',
    script: path.join(RUNTIME_SCRIPTS, 'comet-hook-guard.mjs'),
    args: [],
  },
  {
    name: 'classic-resume-probe',
    script: path.join(RUNTIME_SCRIPTS, 'comet-resume-probe.mjs'),
    args: ['--help'],
  },
  {
    name: 'classic-intent',
    script: path.join(RUNTIME_SCRIPTS, 'comet-intent.mjs'),
    args: ['--help'],
  },
  // Native runtime.
  {
    name: 'native-runtime',
    script: path.join(NATIVE_SCRIPTS, 'comet-native-runtime.mjs'),
    args: ['--help'],
  },
  {
    name: 'native-status',
    script: path.join(NATIVE_SCRIPTS, 'comet-native-status.mjs'),
    args: ['--json'],
  },
  {
    name: 'entry-workflow-resolve',
    script: path.join(RUNTIME_SCRIPTS, 'comet-entry-runtime.mjs'),
    args: ['.', '--json'],
  },
  // Per-command Native launchers (self-contained bundles).
  {
    name: 'native-hook-guard',
    script: path.join(NATIVE_SCRIPTS, 'comet-native-hook-guard.mjs'),
    args: ['--hook-output', 'copilot'],
  },
  // CLI entry (npm bin).
  { name: 'cli-version', script: BIN, args: ['--version'] },
  { name: 'cli-help', script: BIN, args: ['--help'] },
  // Public fast paths must be measured through `comet`, not by leaking the
  // package-internal bundle paths into Skills or documentation.
  { name: 'cli-classic-state', script: BIN, args: ['state', 'current', '--json'] },
  { name: 'cli-native-status', script: BIN, args: ['native', 'status', '--json'] },
  { name: 'cli-workflow-resolve', script: BIN, args: ['workflow', 'resolve', '.', '--json'] },
];

function measureOne(script, args) {
  const start = process.hrtime.bigint();
  spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
    env: { ...process.env, COMET_SKIP_UPDATE_CHECK: '1' },
  });
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measureAll() {
  const results = {};
  // Warm the filesystem cache with one untimed run so the first measurement
  // does not dominate the median with a cold OS file cache.
  for (const target of TARGETS) {
    measureOne(target.script, target.args);
  }
  for (const target of TARGETS) {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      samples.push(measureOne(target.script, target.args));
    }
    results[target.name] = { median: Number(median(samples).toFixed(1)), samples };
  }
  return results;
}

async function readBaseline() {
  try {
    const content = await fs.readFile(BASELINE_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeBaseline(results) {
  const baseline = {
    node: process.version,
    platform: process.platform,
    threshold: DEFAULT_THRESHOLD,
    results,
  };
  await fs.writeFile(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

function formatRow(name, medianMs, note = '') {
  return `${name.padEnd(22)} ${String(medianMs).padStart(7)} ms  ${note}`;
}

async function main() {
  const mode = process.argv[2] ?? '--print';
  const results = await measureAll();

  if (mode === '--record') {
    await writeBaseline(results);
    console.log('Recorded cold-start baseline:');
    for (const [name, data] of Object.entries(results)) {
      console.log(formatRow(name, data.median));
    }
    console.log(`\nWrote ${path.relative(REPO_ROOT, BASELINE_FILE)}`);
    return;
  }

  if (mode === '--check') {
    const baseline = await readBaseline();
    if (!baseline) {
      console.log('No baseline recorded; run with --record first.');
      process.exitCode = 0;
      return;
    }
    const threshold = baseline.threshold ?? DEFAULT_THRESHOLD;
    let regressions = 0;
    console.log('Cold-start vs baseline:');
    for (const [name, data] of Object.entries(results)) {
      const base = baseline.results[name]?.median;
      if (base === undefined) {
        console.log(formatRow(name, data.median, '(no baseline)'));
        continue;
      }
      const ratio = data.median / base;
      if (ratio > 1 + threshold) {
        regressions++;
        console.log(
          formatRow(
            name,
            data.median,
            `REGRESSION +${((ratio - 1) * 100).toFixed(0)}% over ${base}ms`,
          ),
        );
      } else {
        const delta =
          data.median <= base
            ? `-${((1 - ratio) * 100).toFixed(0)}%`
            : `+${((ratio - 1) * 100).toFixed(0)}%`;
        console.log(formatRow(name, data.median, `vs ${base}ms (${delta})`));
      }
    }
    if (regressions > 0) {
      console.error(
        `\n${regressions} cold-start regression(s) above ${(threshold * 100).toFixed(0)}% threshold.`,
      );
      process.exitCode = 1;
    }
    return;
  }

  // Default: print medians.
  console.log('Cold-start medians (ms):');
  for (const [name, data] of Object.entries(results)) {
    console.log(formatRow(name, data.median));
  }
}

await main();
