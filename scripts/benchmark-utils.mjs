#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import path from 'path';

export function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

export function safeRatio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

export function findBashCommand() {
  const candidates = [
    process.env.COMET_BENCHMARK_BASH,
    'bash',
    ...(process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        ]
      : []),
  ].filter(Boolean);
  let wslFallback = null;
  for (const candidate of [...new Set(candidates)]) {
    const probe = spawnSync(candidate, ['-lc', 'uname -s'], { encoding: 'utf-8' });
    if (probe.status !== 0 || !probe.stdout.trim()) continue;
    if (process.platform === 'win32' && /linux/i.test(probe.stdout)) {
      wslFallback = { command: candidate, pathStyle: 'wsl' };
      continue;
    }
    return { command: candidate, pathStyle: 'git-bash' };
  }
  return wslFallback;
}

export function toBashPath(filePath, pathStyle = 'git-bash') {
  if (filePath.startsWith('/')) return filePath.replace(/\\/g, '/');
  // Detect Windows drive-letter paths (C:\, D:\, etc.) before path.resolve
  // so they are not treated as relative paths on Linux/CI.
  const winNormalized = filePath.replace(/\\/g, '/');
  const driveMatch = winNormalized.match(/^([A-Za-z]):\/(.*)$/);
  if (driveMatch) {
    if (pathStyle === 'wsl') {
      return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
    }
    return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
  }
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return normalized;
}

export function parseCodexJsonl(jsonl) {
  const events = jsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    usage: extractUsage(events),
    verdict: extractVerdict(events),
    events,
  };
}

export function extractUsage(events) {
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const event of events) {
    const candidate = findUsageObject(event);
    if (candidate) usage = candidate;
  }
  return usage;
}

export function findUsageObject(value) {
  if (!value || typeof value !== 'object') return null;
  const input = value.input_tokens ?? value.inputTokens ?? value.prompt_tokens ?? value.promptTokens;
  const output =
    value.output_tokens ?? value.outputTokens ?? value.completion_tokens ?? value.completionTokens;
  const total = value.total_tokens ?? value.totalTokens;
  if (Number.isFinite(input) || Number.isFinite(output) || Number.isFinite(total)) {
    const inputTokens = Number(input ?? 0);
    const outputTokens = Number(output ?? 0);
    return {
      inputTokens,
      outputTokens,
      totalTokens: Number(total ?? inputTokens + outputTokens),
    };
  }
  for (const child of Object.values(value)) {
    const found = findUsageObject(child);
    if (found) return found;
  }
  return null;
}

export function collectText(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  const texts = [];
  for (const child of Object.values(value)) {
    texts.push(...collectText(child));
  }
  return texts;
}

export function normalizeVerdict(verdict) {
  return {
    completed: Boolean(verdict?.completed),
    specFacts: Number(verdict?.specFacts ?? 0),
    driftedFacts: Number(verdict?.driftedFacts ?? 0),
    acceptanceCriteriaTotal: Number(verdict?.acceptanceCriteriaTotal ?? 0),
    acceptanceCriteriaMet: Number(verdict?.acceptanceCriteriaMet ?? 0),
  };
}

function extractVerdict(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const text = collectText(events[i]).reverse().join('\n');
    const parsed = parseVerdictText(text);
    if (parsed) return normalizeVerdict(parsed);
  }
  return null;
}

function parseVerdictText(text) {
  const candidates = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);
  const match = trimmed.match(/\{[\s\S]*"acceptanceCriteriaMet"[\s\S]*\}/);
  if (match) candidates.push(match[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function spawnCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command timed out: ${command} ${args.join(' ')}`));
        }, options.timeoutMs)
      : null;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      if (exitCode !== 0 && !options.allowFailure) {
        reject(new Error(`${command} exited ${exitCode}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/**
 * Parse Claude Code JSON output (--output-format json).
 * Returns { usage, result, durationMs, numTurns, costUsd, isError }.
 */
export function parseClaudeJson(stdout) {
  let data;
  try {
    data = JSON.parse(stdout.trim());
  } catch {
    return {
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      result: stdout.trim(),
      durationMs: 0,
      numTurns: 0,
      costUsd: 0,
      isError: true,
    };
  }

  const usage = data.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;

  return {
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    result: data.result ?? '',
    durationMs: data.duration_ms ?? 0,
    numTurns: data.num_turns ?? 0,
    costUsd: data.total_cost_usd ?? 0,
    isError: data.is_error ?? false,
  };
}

/**
 * Build Claude Code CLI args for execution benchmark.
 * Uses --print for non-interactive mode, --dangerously-skip-permissions for file writes.
 */
export function buildClaudeArgs({ cwd, model = null, permissionMode = 'bypassPermissions' }) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--permission-mode', permissionMode,
  ];
  if (model) args.push('--model', model);
  return args;
}
