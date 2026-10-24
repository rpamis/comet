import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CORE_REGRESSIONS,
  assertCoreRegressionResult,
  coreRegressionArgs,
  selectCoreRegressions,
} from '../../scripts/lint/core-regressions.mjs';

const entry = {
  id: 'fixture',
  requiredNames: ['positive', 'negative'],
  minimumPassed: 2,
};
function report(status = 'passed') {
  return {
    success: true,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    testResults: [
      {
        assertionResults: [
          { fullName: 'fixture positive', status: 'passed' },
          { fullName: 'fixture negative', status },
        ],
      },
    ],
  };
}

describe('core regression entrypoint', () => {
  it('keeps every reported issue linked to an executable case and invariant', async () => {
    expect(new Set(CORE_REGRESSIONS.map((item) => item.id)).size).toBe(CORE_REGRESSIONS.length);
    for (const issue of [500, 501, 502, 503, 504, 505]) {
      expect(selectCoreRegressions([String(issue)]).length).toBeGreaterThan(0);
    }
    for (const item of CORE_REGRESSIONS) {
      expect(item.invariant.length).toBeGreaterThan(0);
      expect(item.requiredNames.length).toBeGreaterThan(0);
      for (const file of item.files) {
        expect(file).toMatch(
          /^test\/(?:domains\/(?:comet-native|comet-classic|engine|workflow-contract)|app)\/[^/]+\.test\.ts$/u,
        );
        await expect(fs.stat(path.resolve(file))).resolves.toMatchObject({});
      }
    }
  });

  it('deduplicates issue selectors and rejects unknown cases rather than passing nothing', () => {
    expect(selectCoreRegressions(['500', '501'])).toHaveLength(1);
    expect(selectCoreRegressions([])).toHaveLength(CORE_REGRESSIONS.length);
    expect(() => selectCoreRegressions(['missing'])).toThrow('Unknown core regression');
  });

  it('passes filenames and test patterns as separate arguments with bounded concurrency', () => {
    const item = selectCoreRegressions(['classic-continuity'])[0];
    const args = coreRegressionArgs(item, '/tmp/path with spaces/result.json');
    expect(args).toContain('--maxWorkers=2');
    expect(args).toContain('--outputFile=/tmp/path with spaces/result.json');
    expect(args).not.toContain('--passWithNoTests');
    expect(args[args.indexOf('--testNamePattern') + 1]).toBe(item.testNamePattern);
  });

  it('accepts only a successful result with every mandatory behavior executed', () => {
    expect(assertCoreRegressionResult(entry, report())).toBe(2);
  });

  it.each(['pending', 'skipped', 'todo', 'failed'])(
    'does not count a %s required case as passed',
    (status) => {
      expect(() => assertCoreRegressionResult(entry, report(status))).toThrow();
    },
  );

  it('rejects empty reports, missing required behaviors, and runtime failures', () => {
    expect(() => assertCoreRegressionResult(entry, { success: true, numFailedTests: 0 })).toThrow();
    expect(() =>
      assertCoreRegressionResult({ ...entry, requiredNames: ['not executed'] }, report()),
    ).toThrow('required regression did not pass');
    expect(() =>
      assertCoreRegressionResult(entry, { ...report(), numRuntimeErrorTestSuites: 1 }),
    ).toThrow();
  });

  it('exposes one stable repository command without automatically installing dependencies', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.scripts['test:core-regressions']).toBe('node scripts/lint/core-regressions.mjs');
    const source = await fs.readFile('scripts/lint/core-regressions.mjs', 'utf8');
    expect(source).toContain('rmSync(reportFile, { force: true })');
    expect(source).not.toContain('pnpm install');
    expect(source).not.toContain('shell: true');
  });
});
