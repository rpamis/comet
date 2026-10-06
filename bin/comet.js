#!/usr/bin/env node

try {
  const { enableCompileCache } = await import('node:module');
  enableCompileCache?.();
} catch {
  // Compile cache is an optional startup optimization on supported Node
  // versions; a missing or unwritable cache must never affect the CLI.
}

const args = process.argv.slice(2);
const { shouldTryCometDaemon } = await import('./comet-daemon-route.js');
let handled = false;
if (shouldTryCometDaemon(args)) {
  const { runCometDaemonCommand, tryRunCometDaemon } = await import('./comet-daemon-router.js');
  handled = (await runCometDaemonCommand(args)) || (await tryRunCometDaemon(args));
}
if (!handled) {
  const { tryRunFastRuntime } = await import('./fast-runtime-router.js');
  if (!(await tryRunFastRuntime(args))) {
    await import('../dist/app/cli/index.js');
  }
}
