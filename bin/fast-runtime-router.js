import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const CLASSIC_COMMANDS = new Set(['state', 'check', 'guard', 'handoff', 'archive']);

const NATIVE_COMMANDS = new Set([
  'init',
  'root',
  'new',
  'spec',
  'show',
  'status',
  'select',
  'next',
  'archive',
  'doctor',
]);

function hasHelpFlag(args) {
  const separator = args.indexOf('--');
  const commandArgs = separator < 0 ? args : args.slice(0, separator);
  return commandArgs.includes('--help') || commandArgs.includes('-h');
}

/**
 * Resolves only public commands whose package-owned self-contained runtime has
 * the same argv contract. Returning null preserves Commander for all other
 * commands, including help and unknown-command diagnostics.
 */
export function resolveFastRuntime(argv) {
  if (argv.length === 0 || hasHelpFlag(argv)) return null;

  const [group, command, ...tail] = argv;
  if (CLASSIC_COMMANDS.has(group))
    return {
      assetPath: 'dist/app/commands/classic.js',
      args: argv.slice(1),
      classicCommand: group,
    };

  if (group === 'workflow' && command === 'resolve') {
    if (tail.some((arg) => arg.startsWith('-') && !['--json', '--activate'].includes(arg)))
      return null;
    if (tail.includes('--activate'))
      return {
        assetPath: 'dist/domains/comet-entry/entry-runtime.js',
        args: tail,
        configuredEntry: true,
      };
    return {
      assetPath: 'assets/skills/comet/scripts/comet-entry-runtime.mjs',
      args: tail,
    };
  }

  if (group === 'native' && command && NATIVE_COMMANDS.has(command)) {
    return {
      assetPath: `assets/skills/comet-native/scripts/comet-native-${command}.mjs`,
      args: tail,
    };
  }

  return null;
}

function assetUrl(assetPath) {
  return new URL(`../${assetPath}`, import.meta.url);
}

/**
 * Runs a fast runtime in this same Node process. Package-relative resolution
 * deliberately belongs to the CLI; Skills never locate or invoke bundles.
 */
export async function tryRunFastRuntime(argv = process.argv.slice(2)) {
  const route = resolveFastRuntime(argv);
  if (!route) return false;

  const runtimeUrl = assetUrl(route.assetPath);
  const runtimePath = fileURLToPath(runtimeUrl);
  if (!existsSync(runtimePath)) return false;

  if (route.classicCommand) {
    const classicRuntimeUrl = assetUrl('assets/skills/comet/scripts/comet-runtime.mjs');
    if (!existsSync(fileURLToPath(classicRuntimeUrl))) return false;
    const [{ runClassicFacade }, { runClassicCli }] = await Promise.all([
      import(runtimeUrl.href),
      import(classicRuntimeUrl.href),
    ]);
    process.exitCode = await runClassicFacade(route.classicCommand, route.args, runClassicCli);
    return true;
  }
  if (route.configuredEntry) {
    const { tryRunConfiguredCometEntryRuntime } = await import(runtimeUrl.href);
    return await tryRunConfiguredCometEntryRuntime(route.args);
  }

  process.argv = [process.execPath, runtimePath, ...route.args];
  await import(runtimeUrl.href);
  return true;
}
