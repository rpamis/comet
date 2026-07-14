import { runNativeCli } from '../../domains/comet-native/native-cli.js';

export async function runNativeFacade(args: readonly string[]): Promise<number> {
  const result = await runNativeCli(args);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr)
    process.stderr.write(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
  return result.exitCode;
}
