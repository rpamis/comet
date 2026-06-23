import path from 'path';
import { collectDashboardSnapshot } from '../dashboard/collector.js';
import { openInBrowser } from '../dashboard/open-browser.js';
import { startDashboardServer } from '../dashboard/server.js';

export interface DashboardOptions {
  port?: number;
  open?: boolean;
  json?: boolean;
}

/**
 * `comet dashboard` — launch the local read-only dashboard server.
 *
 * Modes:
 *  - default: start the HTTP server, optionally open the browser, keep the
 *    process alive until SIGINT/SIGTERM.
 *  - `--json`: collect a single snapshot, print it to stdout, exit. Useful
 *    for scripting and inspection without running a server.
 */
export async function dashboardCommand(
  targetPath: string,
  options: DashboardOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);

  if (options.json) {
    const snapshot = await collectDashboardSnapshot(projectPath);
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const port = normalizePort(options.port);
  const handle = await startDashboardServer({ projectPath, port });

  console.log(`Comet Dashboard running at ${handle.url}`);
  console.log('Press Ctrl+C to stop.');

  if (options.open !== false) {
    openInBrowser(handle.url);
  }

  await waitForExitSignal();
  await handle.close();
}

function normalizePort(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isInteger(raw) || raw < 0 || raw > 65535) {
    throw new Error(`Invalid --port value: ${raw}. Use an integer between 0 and 65535.`);
  }
  return raw;
}

function waitForExitSignal(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
