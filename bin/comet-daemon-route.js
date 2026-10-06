const CLASSIC_READ_COMMANDS = new Set(['current', 'next']);
const NATIVE_READ_COMMANDS = new Set(['status', 'show', 'root']);

export function resolveCometDaemonRoute(argv, environment = process.env) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return null;
  if (argv.some((value) => value.startsWith('--comet-'))) return null;
  const classicArgs = argv[0] === 'classic' ? argv.slice(1) : argv;
  if (classicArgs[0] === 'state' && CLASSIC_READ_COMMANDS.has(classicArgs[1])) {
    // daemon 直接调用领域 CLI；有上下文任务时必须保留 facade 的注入和结果记录。
    if (environment.COMET_TASK?.trim() || classicArgs.includes('--summary')) return null;
    return { runtime: 'classic', commandArgs: [...classicArgs] };
  }
  if (
    argv[0] === 'native' &&
    NATIVE_READ_COMMANDS.has(argv[1]) &&
    !(argv[1] === 'root' && argv[2] && argv[2] !== 'show')
  ) {
    return { runtime: 'native', commandArgs: [argv[1], ...argv.slice(2)] };
  }
  return null;
}

export function shouldAutoStartCometDaemon(environment = process.env) {
  return environment.COMET_DAEMON !== 'off';
}

export function shouldTryCometDaemon(argv, environment = process.env) {
  return (
    argv[0] === 'daemon' ||
    (shouldAutoStartCometDaemon(environment) &&
      environment.COMET_DAEMON_SERVER !== '1' &&
      resolveCometDaemonRoute(argv, environment) !== null)
  );
}
