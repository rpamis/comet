#!/usr/bin/env node

try {
  const { enableCompileCache } = await import('node:module');
  enableCompileCache?.();
} catch {
  // Compile cache is an optional startup optimization on supported Node
  // versions; a missing or unwritable cache must never affect the CLI.
}

const args = process.argv.slice(2);
const { runCometDaemonCommand, tryRunCometDaemon } = await import('./comet-daemon-router.js');
if (await runCometDaemonCommand(args)) {
  // The daemon control command handled its own output and exit code.
} else if (await tryRunCometDaemon(args)) {
  // The daemon handled this eligible read-only command.
} else {
  const { tryRunFastRuntime } = await import('./fast-runtime-router.js');
  if (!(await tryRunFastRuntime(args))) {
    await import('../dist/app/cli/index.js');
  }
}
