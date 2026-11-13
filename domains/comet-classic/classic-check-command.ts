import path from 'node:path';
import type { ClassicCommandHandler } from './classic-cli.js';
import { classicCommandProjectRoot, withProjectContext } from './classic-command-context.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';

/** 旧检查命令只提供平台执行说明；检查由 Agent 执行，再提交真实报告。 */
export const classicCheckCommand: ClassicCommandHandler = withProjectContext(async (args) => {
  const [operation, change, scope] = args,
    separator = args.indexOf('--');
  if (!['run', 'rerun'].includes(operation) || !change || !['build', 'verify'].includes(scope))
    throw new Error(
      'Usage: comet check run <change> <build|verify> [--cwd <path>] -- <program> [args...] | comet check rerun <change> <build|verify>',
    );
  const root = classicCommandProjectRoot();
  let cwd = '.';
  const end = separator < 0 ? args.length : separator;
  for (let i = 3; i < end; i++) {
    if (['--cwd', '--timeout-ms', '--report'].includes(args[i])) {
      const flag = args[i],
        value = args[++i];
      if (value === undefined) throw new Error('Missing value for ' + flag);
      if (flag === '--cwd') cwd = value;
    } else if (!['--local', '--incremental'].includes(args[i]))
      throw new Error('Unknown check option: ' + args[i]);
  }
  if (operation === 'run' && (separator < 3 || !args[separator + 1]))
    throw new Error('Provide the program and arguments after --');
  const resolved = path.resolve(root, cwd),
    relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error('Check cwd must be within the selected project');
  await resolveClassicChangeDirectory(change, root);
  return {
    exitCode: 0,
    data: {
      change,
      scope,
      status: 'platform-execution-required',
      checksExecuted: false,
      ...(separator >= 0
        ? { platformCommand: { argv: args.slice(separator + 1), cwd: resolved } }
        : {}),
      instruction:
        '使用 Agent 平台工具执行所选检查，由平台处理超时、取消和进程清理；核对实际结果后，按当前任务提交平台检查报告。Comet 没有执行本条命令，也没有登记通过结果。',
      commandArgs: ['comet', 'state', 'next', change, '--json'],
    },
    stdout: '请使用 Agent 平台工具执行检查，并提交真实结果；当前命令没有运行检查。\n',
  };
});
