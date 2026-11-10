import { spawnSync } from 'child_process';
import {
  assertNodeCliCommandAvailable,
  resolveNodeCliCommand,
} from '../../platform/process/node-cli-command.js';
import type { ClassicCommandResult } from './classic-cli.js';
import { assertClassicLayoutWritable, discoverClassicProject } from './classic-layout.js';
import { assertClassicOpenSpecRootHealthy } from './classic-openspec-root.js';

export async function executeClassicOpenSpec(
  args: readonly string[],
  startPath = process.cwd(),
): Promise<ClassicCommandResult & { executionStarted?: false; executionCompleted?: boolean }> {
  const openSpecArgs = args[0] === '--' ? args.slice(1) : [...args];
  if (openSpecArgs.length === 0) {
    return {
      exitCode: 64,
      stderr: 'Usage: comet classic openspec -- <openspec-args...>',
    };
  }

  const projectRoot = await discoverClassicProject(startPath);
  const layout = await assertClassicLayoutWritable(projectRoot);
  await assertClassicOpenSpecRootHealthy(projectRoot, layout);
  const command = process.env.COMET_OPENSPEC || 'openspec';
  let launch: ReturnType<typeof resolveNodeCliCommand>;
  try {
    assertNodeCliCommandAvailable(command, openSpecArgs, { cwd: layout.openSpecBase });
    launch = resolveNodeCliCommand(command, openSpecArgs, { cwd: layout.openSpecBase });
  } catch (error) {
    // 启动器或其 Node 入口在领取后消失时，尚未调用 spawnSync。
    return {
      exitCode: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 70,
      executionStarted: false,
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
  const result = spawnSync(launch.command, launch.args, {
    cwd: layout.openSpecBase,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    // A wedged OpenSpec process must not hang the whole comet command with it.
    timeout: 120_000,
    ...(launch.env ? { env: launch.env } : {}),
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      exitCode: code === 'ENOENT' ? 127 : 70,
      // 只接受操作系统确认未启动的错误；退出码或错误文本不能证明没有副作用。
      ...(result.pid === 0 && ['ENOENT', 'EACCES', 'ENOTDIR', 'ENOEXEC'].includes(code ?? '')
        ? { executionStarted: false as const }
        : {}),
      stdout: result.stdout || undefined,
      stderr:
        result.stderr ||
        (code === 'ENOENT' ? `OpenSpec CLI not found: ${command}` : result.error.message),
    };
  }
  return {
    exitCode: result.status ?? 1,
    executionCompleted: result.status !== null && result.signal === null,
    stdout: result.stdout || undefined,
    stderr: result.stderr || undefined,
  };
}
