import { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { getCurrentVersion } from '../../platform/version/version.js';
import { commandUsageForError, configureCommandUsageErrors } from './command-usage.js';

/** 公共 CLI 与轻量入口共用参数和错误协议，执行逻辑仍由 Runtime command 承担。 */
export function registerRuntimeCommand(program: Command, quietErrors = false): Command {
  const runtime = program
    .command('runtime')
    .description('Run portable Skill workflows through the Runtime SDK');

  runtime
    .command('dispatch')
    .description('Submit a JSON Runtime request and return its result as JSON')
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
    .option(
      '--details',
      'Return the complete persisted Run and history (inspect is complete by default)',
    )
    .addHelpText(
      'after',
      `
Application requests:
  comet runtime dispatch --application native --request request.json --project-root .
  comet runtime dispatch --application-file ./application.json --request request.json --project-root .
Portable workflow requests:
  comet runtime dispatch --workflow workflow.json --root-dir .comet/runs --request request.json

The request file is a JSON object, for example {"operation":"inspect","runId":"change-name"}.
Built-in applications: native, classic-full, classic-hotfix, classic-tweak.
Use --application <id> to resume an application already selected in this project.
Choose one application selector, or use --workflow with --root-dir for a portable workflow.
Mutations must use the current Run revision, Action or Wait identity required by the operation.`,
    )
    .action(async (options) => {
      const { runtimeDispatchCommand } = await import('../commands/runtime.js');
      const result = await runtimeDispatchCommand(options, { output: 'compact' });
      console.log(JSON.stringify(result.cliResponse ?? result.response, null, 2));
      process.exitCode = result.exitCode;
    });

  if (quietErrors) runtime.configureOutput({ writeErr: () => undefined });
  configureCommandUsageErrors(runtime);
  return runtime;
}

export async function reportRuntimeCliFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const usage = commandUsageForError(error);
  // 参数解析尚未执行请求，不加载 Runtime、应用、依赖审查或存储模块。
  console.log(
    JSON.stringify(
      {
        protocolVersion: 1,
        requestId: randomUUID(),
        status: 'failed',
        error: { code: 'INVALID_REQUEST', message: `Runtime 命令参数无效：${message}` },
        ...(usage ? { usage } : {}),
      },
      null,
      2,
    ),
  );
  process.exitCode = 64;
}

export async function runRuntimeCli(argv: readonly string[]): Promise<void> {
  const program = new Command()
    .name('comet')
    .version(getCurrentVersion(), '-v, --version', 'Output the current version')
    .helpOption('-h, --help', 'Display command help')
    .addHelpCommand('help [command]', 'Display help for a command')
    .exitOverride();
  registerRuntimeCommand(program, true);
  configureCommandUsageErrors(program);
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof Error && 'exitCode' in error && error.exitCode === 0) return;
    await reportRuntimeCliFailure(error);
  }
}
