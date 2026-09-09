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
import { executeCommandCheck } from './classic-command-checks.js';

export const classicCheckCommand: ClassicCommandHandler = withProjectContext(async (args) => {
  const [operation, name, scope] = args;
  const separator = args.indexOf('--');
  if (
    operation !== 'run' ||
    !name ||
    !['build', 'verify'].includes(scope) ||
    separator < 3 ||
    !args[separator + 1]
  ) {
    throw new Error(
      'Usage: comet check run <change> <build|verify> [--local] [--cwd <path>] [--timeout-ms <ms>] -- <program> [args...]',
    );
  }
  const root = classicCommandProjectRoot();
  const layout = await assertClassicLayoutWritable(root);
  const change = await resolveClassicChangeDirectory(name, root);
  if (path.dirname(change.directory) !== layout.changesDir)
    throw new Error('Checks require an active change');
  let cwd = path.relative(root, classicCommandInvocationCwd()) || '.';
  let timeoutMs = 300_000;
  let reusable = false;
  for (let index = 3; index < separator; index += 1) {
    const option = args[index];
    if (option === '--local') reusable = true;
    else if (option === '--cwd' && index + 1 < separator) cwd = args[++index];
    else if (option === '--timeout-ms' && index + 1 < separator) timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown or incomplete check option: ${option}`);
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000)
    throw new Error('Check timeout must be 1..3600000 milliseconds');
  const context = await ensureClassicRuntimeRun(change.directory);
  const recorded = await executeCommandCheck(root, change.directory, context.run, {
    scope: scope as 'build' | 'verify',
    argv: args.slice(separator + 1),
    cwd,
    timeoutMs,
    reusable,
  });
  return {
    exitCode: recorded.exitCode || (recorded.inputBefore === recorded.inputAfter ? 0 : 1),
    data: recorded,
    stdout: `Check ${recorded.scope}: exit=${recorded.exitCode}; reused=${recorded.reused === true}; log=${recorded.logRef}\n`,
    ...(recorded.inputBefore !== recorded.inputAfter
      ? { stderr: 'Inputs changed during check; rerun after the workspace is stable.' }
      : {}),
  };
});
