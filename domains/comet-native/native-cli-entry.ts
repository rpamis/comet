import { pathToFileURL } from 'url';

import { runNativeCli } from './native-cli.js';

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const result = await runNativeCli(argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) {
    process.stderr.write(result.stderr + (result.stderr.endsWith('\n') ? '' : '\n'));
  }
  return result.exitCode;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
