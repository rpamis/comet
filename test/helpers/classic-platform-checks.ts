import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Run a real isolated platform check, then write the report consumed by the public CLI. */
export async function writeClassicPlatformChecks(root: string, argv: string[]): Promise<string> {
  let exitCode = 0;
  try {
    execFileSync(argv[0], argv.slice(1), { cwd: root, stdio: 'ignore', windowsHide: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (typeof status !== 'number') throw error;
    exitCode = status;
  }
  const report = path.join(root, '.comet', 'platform-checks.json');
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(
    report,
    JSON.stringify({
      checks: [
        {
          name: argv.join(' '),
          result: exitCode === 0 ? 'passed' : 'failed',
          note: `Observed platform process exit ${exitCode}`,
        },
      ],
    }),
  );
  return report;
}
