import path from 'node:path';
import type { ClassicCommandHandler } from './classic-cli.js';
import {
  classicCommandInvocationCwd,
  classicCommandProjectRoot,
  withProjectContext,
} from './classic-command-context.js';
import { assertClassicLayoutWritable } from './classic-layout.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { ensureClassicRuntimeRun } from './classic-runtime-run.js';
import {
  executeCommandCheck,
  latestCommandCheck,
  latestInterruptedCommandCheck,
  type RecordedCommandCheck,
} from './classic-command-checks.js';

function unstableInputDiagnostic(record: RecordedCommandCheck): string {
  const changed = record.changedDuringExecution ?? [];
  if (changed.length === 0) {
    return 'Inputs changed during check; rerun after the workspace is stable.';
  }
  const shown = changed.slice(0, 20);
  const remainder = changed.length - shown.length;
  return [
    'Inputs changed during check.',
    `Changed inputs: ${shown.join(', ')}${remainder > 0 ? ` (+${remainder} more)` : ''}.`,
    'If these paths are generated artifacts, add them to the matching command outputs in .comet/check-policy.json; otherwise stabilize the inputs before rerunning.',
  ].join('\n');
}

export const classicCheckCommand: ClassicCommandHandler = withProjectContext(async (args) => {
  const [operation, name, scope] = args;
  const separator = args.indexOf('--');
  const rerun = operation === 'rerun';
  if (
    (operation !== 'run' && !rerun) ||
    !name ||
    !['build', 'verify'].includes(scope) ||
    (rerun ? args.length !== 3 : separator < 3 || !args[separator + 1])
  ) {
    throw new Error(
      'Usage: comet check run <change> <build|verify> [--local] [--incremental] [--cwd <path>] [--timeout-ms <ms>] -- <program> [args...] | comet check rerun <change> <build|verify>',
    );
  }
  const root = classicCommandProjectRoot();
  const layout = await assertClassicLayoutWritable(root);
  const change = await resolveClassicChangeDirectory(name, root);
  if (path.dirname(change.directory) !== layout.changesDir)
    throw new Error('Checks require an active change');
  const context = await ensureClassicRuntimeRun(change.directory);
  if (rerun) {
    const previous = await latestCommandCheck(
      root,
      change.directory,
      context.run,
      scope as 'build' | 'verify',
    );
    const interrupted = previous
      ? null
      : await latestInterruptedCommandCheck(
          root,
          change.directory,
          context.run,
          scope as 'build' | 'verify',
        );
    const retry =
      previous?.argv?.length && previous.provenance === 'runtime' ? previous : interrupted;
    if (!retry) {
      throw new Error(`No Runtime ${scope} check is available to rerun`);
    }
    const retryArgv = retry.argv;
    if (!retryArgv?.length) {
      throw new Error(`No Runtime ${scope} check is available to rerun`);
    }
    const recorded = await executeCommandCheck(root, change.directory, context.run, {
      scope: scope as 'build' | 'verify',
      argv: retryArgv,
      cwd: retry.cwd,
      timeoutMs: retry.timeoutMs ?? 300_000,
      reusable: retry.reusable === true,
      tier: retry.tier ?? 'full',
    });
    return {
      exitCode: recorded.exitCode || (recorded.inputBefore === recorded.inputAfter ? 0 : 1),
      data: recorded,
      stdout: `Check ${recorded.scope}: exit=${recorded.exitCode}; reused=${recorded.reused === true}; tier=${recorded.tier ?? 'full'}; log=${recorded.logRef}\n`,
      ...(recorded.inputBefore !== recorded.inputAfter
        ? { stderr: unstableInputDiagnostic(recorded) }
        : {}),
    };
  }
  let cwd = path.relative(root, classicCommandInvocationCwd()) || '.';
  let timeoutMs = 300_000;
  let reusable = false;
  let incremental = false;
  for (let index = 3; index < separator; index += 1) {
    const option = args[index];
    if (option === '--local') reusable = true;
    else if (option === '--incremental') incremental = true;
    else if (option === '--cwd' && index + 1 < separator) cwd = args[++index];
    else if (option === '--timeout-ms' && index + 1 < separator) timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown or incomplete check option: ${option}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)
    throw new Error('Check timeout must be 1..3600000 milliseconds');
  const recorded = await executeCommandCheck(root, change.directory, context.run, {
    scope: scope as 'build' | 'verify',
    argv: args.slice(separator + 1),
    cwd,
    timeoutMs,
    reusable,
    tier: incremental ? 'incremental' : 'full',
  });
  return {
    exitCode: recorded.exitCode || (recorded.inputBefore === recorded.inputAfter ? 0 : 1),
    data: recorded,
    stdout: `Check ${recorded.scope}: exit=${recorded.exitCode}; reused=${recorded.reused === true}; tier=${recorded.tier ?? 'full'}; log=${recorded.logRef}\n`,
    ...(recorded.inputBefore !== recorded.inputAfter
      ? { stderr: unstableInputDiagnostic(recorded) }
      : {}),
  };
});
