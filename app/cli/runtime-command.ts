import { Command } from 'commander';
import { getCurrentVersion } from '../../platform/version/version.js';

/** 公共 CLI 与轻量入口共用参数和错误协议，执行逻辑仍由 Runtime command 承担。 */
export function registerRuntimeCommand(program: Command, quietErrors = false): Command {
  const runtime = program
    .command('runtime')
    .description('Run portable Skill workflows through the Runtime SDK');

  runtime
    .command('dispatch')
    .description('Submit a JSON Runtime request and return its persisted Run as JSON')
    .requiredOption('--request <file>', 'JSON request containing operation and command fields')
    .option(
      '--workflow <file>',
      'JSON workflow definition; repeat to register multiple workflows',
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option('--application <id>', '内置应用或当前项目已启动的 SDK 应用身份')
    .option('--application-file <file>', '完整 SDK 应用包的 application.json 入口')
    .option(
      '--root-dir <dir>',
      'Directory for persistent Runtime state; fixed for built-in applications',
    )
    .option('--project-root <dir>', 'Project context passed to this request', '.')
    .option('--json', 'Output as JSON (default)')
    .action(async (options) => {
      const { runtimeDispatchCommand } = await import('../commands/runtime.js');
      const result = await runtimeDispatchCommand(options);
      console.log(JSON.stringify(result.response, null, 2));
      process.exitCode = result.exitCode;
    });

  if (quietErrors) runtime.configureOutput({ writeErr: () => undefined });
  return runtime;
}

export async function reportRuntimeCliFailure(error: unknown): Promise<void> {
  const { runtimeCommandFailure } = await import('../commands/runtime.js');
  const { RuntimeProtocolError } = await import('../../domains/engine/runtime.js');
  const message = error instanceof Error ? error.message : String(error);
  const result = runtimeCommandFailure(
    new RuntimeProtocolError('INVALID_REQUEST', `Runtime 命令参数无效：${message}`),
  );
  console.log(JSON.stringify(result.response, null, 2));
  process.exitCode = result.exitCode;
}

export async function runRuntimeCli(argv: readonly string[]): Promise<void> {
  const program = new Command()
    .name('comet')
    .version(getCurrentVersion(), '-v, --version', 'Output the current version')
    .helpOption('-h, --help', 'Display command help')
    .addHelpCommand('help [command]', 'Display help for a command')
    .exitOverride();
  registerRuntimeCommand(program, true);
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof Error && 'exitCode' in error && error.exitCode === 0) return;
    await reportRuntimeCliFailure(error);
  }
}
