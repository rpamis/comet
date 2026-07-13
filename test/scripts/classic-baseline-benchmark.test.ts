import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClassicBaselineBenchmark } from '../../scripts/benchmark/classic-baseline-regression.mjs';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe('Classic baseline benchmark', () => {
  it('reports perfect deterministic migration and recovery rates', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-benchmark-test-'));
    temporary.push(workspace);

    const report = await runClassicBaselineBenchmark({ workspace });

    expect(report).toMatchObject({
      scenarios: 7,
      transitionAccuracy: 1,
      migrationSuccessRate: 1,
      idempotencyRate: 1,
      contractMatchRate: 1,
    });
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.results).toHaveLength(7);
    expect(report.results.map((result) => result.name)).toEqual([
      'profile-full',
      'profile-hotfix',
      'profile-tweak',
      'retry-fix',
      'handoff-resume',
      'archive-recovery',
      'malformed-rejection',
    ]);
    expect(report.results.slice(0, 4)).toMatchObject(
      ['open', 'open', 'open', 'build'].map((phase) => ({
        detail: {
          migrationGuard: {
            phase,
            status: 1,
            signal: null,
            controlledOutcome: true,
            diagnostic: 'BLOCKED — fix failing checks before proceeding to next phase',
          },
        },
      })),
    );
  }, 120_000);
});
