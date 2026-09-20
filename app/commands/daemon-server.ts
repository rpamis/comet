import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createCometDaemonServer,
  type CometDaemonRequest,
  type CometDaemonHandlerResult,
} from '../../platform/process/comet-daemon.js';
import { runClassicCli } from '../../domains/comet-classic/classic-cli.js';
import { runNativeCliDetailed } from '../../domains/comet-native/native-cli.js';

function requiredArgument(value: string | undefined, name: string): string {
  if (!value || value.startsWith('--')) throw new Error(`${name} is required`);
  return value;
}

function optionNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function explicitProjectRoot(argv: readonly string[], fallback: string): string {
  const index = argv.indexOf('--project-root');
  if (index < 0) return fallback;
  const value = argv[index + 1];
  return requiredArgument(value, '--project-root');
}

async function handleRequest(request: CometDaemonRequest): Promise<CometDaemonHandlerResult> {
  const argv = request.argv ?? [];
  if (request.runtime === 'classic') {
    const result = await runClassicCli(argv, undefined, {
      invocationCwd: request.cwd,
      projectRoot: request.projectRoot,
    });
    return result;
  }

  const root = explicitProjectRoot(argv, request.projectRoot);
  const detailed = await runNativeCliDetailed(
    argv.includes('--project-root') ? argv : [...argv, '--project-root', root],
  );
  return detailed.output;
}

export async function runCometDaemonServer(argv: readonly string[]): Promise<void> {
  const endpoint = requiredArgument(argv[0], 'daemon endpoint');
  const buildId = requiredArgument(argv[1], 'daemon build ID');
  const projectRoot = path.resolve(requiredArgument(argv[2], 'daemon project root'));
  const idleTimeoutMs = optionNumber(process.env.COMET_DAEMON_IDLE_TIMEOUT_MS, 10 * 60 * 1000);
  try {
    await createCometDaemonServer({
      endpoint,
      buildId,
      projectRoot,
      idleTimeoutMs,
      handler: handleRequest,
    });
  } finally {
    const lockPath = process.env.COMET_DAEMON_START_LOCK;
    if (lockPath) {
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
  }
  // The listening socket is the process lifetime. Keep this promise pending
  // without a polling interval so idle shutdown remains the only normal exit.
  await new Promise<void>(() => undefined);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  void runCometDaemonServer(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 70;
  });
}
