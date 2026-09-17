import type { CometTaskCommandOptions } from './comet-task.js';

// The fast path parses only the exact argv shapes the Commander entry accepts.
// Anything unexpected (unknown option, missing value, invalid choice, `--`)
// returns false so `bin/comet.js` falls back to the full entry and its
// diagnostics stay identical for every input this facade declines.

const VALUE_OPTIONS = new Set([
  '--task',
  '--path',
  '--phase',
  '--operation',
  '--session',
  '--context-budget',
  '--expand-context',
  '--application',
  '--decision',
  '--verification',
  '--verification-result',
  '--outcome',
  '--learning-check',
  '--workflow',
  '--change',
]);

const FLAG_OPTIONS = new Set(['--complete', '--json']);

const CHOICES: Record<string, readonly string[]> = {
  '--verification-result': ['passed', 'failed'],
  '--outcome': [
    'used-successfully',
    'ignored',
    'overridden',
    'corrected',
    'contributed-to-failure',
  ],
  '--learning-check': ['submitted', 'no-observation', 'not-run'],
};

interface ParsedTaskArgs {
  readonly targetPath: string;
  readonly options: CometTaskCommandOptions;
}

function parseTaskArgs(args: readonly string[]): ParsedTaskArgs | null {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') return null;
    if (arg.startsWith('-')) {
      const separator = arg.indexOf('=');
      const name = separator > 0 ? arg.slice(0, separator) : arg;
      const inlineValue = separator > 0 ? arg.slice(separator + 1) : undefined;
      if (FLAG_OPTIONS.has(name)) {
        if (inlineValue !== undefined) return null;
        flags.add(name);
        continue;
      }
      if (!VALUE_OPTIONS.has(name)) return null;
      let value = inlineValue;
      if (value === undefined) {
        const next = args[index + 1];
        if (next === undefined || next.startsWith('-')) return null;
        value = next;
        index += 1;
      }
      const allowed = CHOICES[name];
      if (allowed && !allowed.includes(value)) return null;
      values.set(name, value);
      continue;
    }
    positional.push(arg);
  }
  if (positional.length > 1) return null;
  const task = values.get('--task');
  if (task === undefined || !task.trim()) return null;
  const value = (name: string): string | undefined => values.get(name);
  return {
    targetPath: positional[0] ?? '.',
    options: {
      task,
      ...(value('--path') !== undefined ? { path: value('--path') } : {}),
      ...(value('--phase') !== undefined ? { phase: value('--phase') } : {}),
      ...(value('--operation') !== undefined ? { operation: value('--operation') } : {}),
      ...(value('--session') !== undefined ? { session: value('--session') } : {}),
      ...(value('--context-budget') !== undefined
        ? { contextBudget: value('--context-budget') }
        : {}),
      ...(value('--expand-context') !== undefined
        ? { expandContext: value('--expand-context') }
        : {}),
      ...(value('--application') !== undefined ? { application: value('--application') } : {}),
      ...(value('--decision') !== undefined ? { decision: value('--decision') } : {}),
      ...(value('--verification') !== undefined ? { verification: value('--verification') } : {}),
      ...(value('--verification-result') !== undefined
        ? { verificationResult: value('--verification-result') as 'passed' | 'failed' }
        : {}),
      ...(value('--outcome') !== undefined
        ? { outcome: value('--outcome') as CometTaskCommandOptions['outcome'] }
        : {}),
      ...(flags.has('--complete') ? { complete: true } : {}),
      ...(value('--learning-check') !== undefined
        ? { learningCheck: value('--learning-check') as CometTaskCommandOptions['learningCheck'] }
        : {}),
      ...(value('--workflow') !== undefined ? { workflow: value('--workflow') } : {}),
      ...(value('--change') !== undefined ? { change: value('--change') } : {}),
      ...(flags.has('--json') ? { json: true } : {}),
    },
  };
}

export function resolveTaskFacadeOptions(args: readonly string[]): ParsedTaskArgs | null {
  return parseTaskArgs(args);
}

export async function runTaskFacade(args: readonly string[]): Promise<boolean> {
  const parsed = parseTaskArgs(args);
  if (!parsed) return false;
  const { cometTaskCommand } = await import('./comet-task.js');
  await cometTaskCommand(parsed.targetPath, parsed.options);
  return true;
}
