import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
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
        name: '',
        assertionResults: [
          { fullName: 'fixture positive', status: 'passed' },
          { fullName: 'fixture negative', status },
        ],
      },
    ],
  };
}

describe('core regression entrypoint', () => {
  it('collects every failed group and executes later groups through the real CLI', async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'comet-core-all-errors-')),
    );
    try {
      for (const ref of ['scripts/lint', 'scripts/build', 'config', 'test/scripts'])
        await fs.mkdir(path.join(root, ref), { recursive: true });
      for (const name of ['core-regressions', 'workflow-regressions', 'historical-regressions'])
        await fs.copyFile(`scripts/lint/${name}.mjs`, path.join(root, `scripts/lint/${name}.mjs`));
      await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await fs.symlink(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      for (const name of ['runtime-schemas', 'classic-runtime', 'native-runtime', 'entry-runtime'])
        await fs.writeFile(
          path.join(root, `scripts/build/build-${name}.mjs`),
          "import fs from 'node:fs'; if (!process.argv.includes('--check')) process.exit(2); fs.appendFileSync('preflight.txt', 'checked\\n');",
        );
      const items = ['first', 'middle', 'last'].map((name) => ({
        id: `fixture-${name}`,
        sources: ['report:fixture'],
        behavior: `Execute ${name}`,
        coverageLevel: 'unit',
        reproduction: 'fixture',
        expected: 'Execute every group',
        forbidden: 'Hide a failure',
        rootCause: 'fixture',
        tests: [
          {
            file: `test/scripts/${name}.test.ts`,
            namePattern: `fixture ${name}`,
            requiredNames: [`fixture ${name}`],
          },
        ],
      }));
      await fs.writeFile(
        path.join(root, 'config/workflow-regressions.json'),
        JSON.stringify({ schema: 'comet.release.bad-cases.v1', cases: items }),
      );
      await fs.writeFile(
        path.join(root, 'config/historical-workflow-regressions.json'),
        JSON.stringify({
          schema: 'comet.release.historical-bad-cases.v1',
          inventory: { complete: true, sourceIssueNumbers: [1], outOfScopeIssues: [] },
          issues: [
            {
              number: 1,
              cases: [
                {
                  id: 'history-fixture',
                  behavior: 'Retain the passing case',
                  status: 'covered',
                  tests: items[1].tests,
                },
              ],
            },
          ],
        }),
      );
      for (const name of ['first', 'middle', 'last'])
        await fs.writeFile(
          path.join(root, `test/scripts/${name}.test.ts`),
          `import {it,expect} from 'vitest'; import fs from 'node:fs'; it('fixture ${name}', () => { fs.writeFileSync('${name}.marker','executed'); expect(${name === 'middle'}).toBe(true); });`,
        );
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, 'scripts/lint/core-regressions.mjs'),
          '--case',
          'fixture-first',
          '--case',
          'fixture-middle',
          '--case',
          'fixture-last',
        ],
        { cwd: root, encoding: 'utf8', timeout: 90_000 },
      );
      expect(result.status, result.stdout + result.stderr).toBe(1);
      for (const name of ['first', 'middle', 'last'])
        expect(await fs.readFile(path.join(root, `${name}.marker`), 'utf8')).toBe('executed');
      expect(result.stderr).toContain('registered-fixture-first');
      expect(result.stderr).toContain('registered-fixture-last');
      const summary = JSON.parse(
        await fs.readFile(path.join(root, 'coverage/core-regressions/summary.json'), 'utf8'),
      );
      expect(summary).toMatchObject({ groups: 3, passed: 1, tests: 1 });
      expect(summary.failures.map((failure: { id: string }) => failure.id)).toEqual([
        'registered-fixture-first',
        'registered-fixture-last',
      ]);
      expect(
        (await fs.readFile(path.join(root, 'preflight.txt'), 'utf8')).trim().split('\n'),
      ).toHaveLength(4);
      await fs.writeFile(
        path.join(root, 'scripts/build/build-runtime-schemas.mjs'),
        'process.exit(2);',
      );
      const blocked = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/lint/core-regressions.mjs'), '--case', 'fixture-middle'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(blocked.status, blocked.stdout + blocked.stderr).toBe(1);
      await expect(
        fs.stat(path.join(root, 'coverage/core-regressions/summary.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('keeps every reported issue linked to an executable case and invariant', async () => {
    expect(new Set(CORE_REGRESSIONS.map((item) => item.id)).size).toBe(CORE_REGRESSIONS.length);
    for (const issue of [500, 501, 502, 503, 504, 505]) {
      expect(selectCoreRegressions([String(issue)]).length).toBeGreaterThan(0);
    }
    for (const item of CORE_REGRESSIONS) {
      expect(item.invariant.length).toBeGreaterThan(0);
      expect(item.requiredNames.length).toBeGreaterThan(0);
      for (const file of item.files) {
        expect(file).toMatch(/^test\/[a-zA-Z0-9_./-]+\.test\.ts$/u);
        expect(file.split('/')).not.toContain('..');
        await expect(fs.stat(path.resolve(file))).resolves.toMatchObject({});
      }
    }
  });

  it('deduplicates issue selectors and rejects unknown cases rather than passing nothing', () => {
    const combined = selectCoreRegressions(['500', '501']);
    expect(new Set(combined.map((entry) => entry.id)).size).toBe(combined.length);
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

  it('does not substitute the same test title from a different file for a historical case', () => {
    const expected = 'test/domains/comet-classic/classic-sdk-application.test.ts';
    const input = report();
    input.testResults[0].name = path.resolve('test/other.test.ts');
    const required = { ...entry, requiredCases: [{ file: expected, name: 'fixture positive' }] };
    expect(() => assertCoreRegressionResult(required, input)).toThrow('required file regression');
    input.testResults[0].name = path.resolve(expected);
    expect(assertCoreRegressionResult(required, input)).toBe(2);
  });

  it.each([
    [
      'win32',
      'D:\\isolated\\candidate',
      'D:\\isolated\\candidate\\test\\scripts\\core-regressions.test.ts',
    ],
    ['linux', '/isolated/candidate', '/isolated/candidate/test/scripts/core-regressions.test.ts'],
  ])(
    'checks original %s report paths against their recorded project root',
    (platform, projectRoot, file) => {
      const required = {
        ...entry,
        requiredCases: [
          { file: 'test/scripts/core-regressions.test.ts', name: 'fixture positive', exact: true },
        ],
      };
      const input = report();
      input.testResults[0].name = file;
      expect(assertCoreRegressionResult(required, input, { platform, projectRoot })).toBe(2);
      expect(input.testResults[0].name).toBe(file);
      expect(() =>
        assertCoreRegressionResult(required, input, {
          platform,
          projectRoot: projectRoot + '/other',
        }),
      ).toThrow();
      expect(() =>
        assertCoreRegressionResult(required, input, { platform, projectRoot: 'relative' }),
      ).toThrow();
      input.testResults[0].name = projectRoot + '/other/core-regressions.test.ts';
      expect(() =>
        assertCoreRegressionResult(required, input, { platform, projectRoot }),
      ).toThrow();
    },
  );

  it('preserves legacy fragments but never masks a skipped exact identity or mixed duplicate', () => {
    const file = 'test/scripts/core-regressions.test.ts';
    const required = {
      id: 'legacy',
      requiredNames: ['positive'],
      requiredCases: [{ file, name: 'positive' }],
    };
    const result = (assertionResults: Array<{ fullName: string; status: string }>) => ({
      success: true,
      numFailedTests: 0,
      testResults: [{ name: path.resolve(file), assertionResults }],
    });
    expect(
      assertCoreRegressionResult(
        required,
        result([{ fullName: 'suite positive case', status: 'passed' }]),
      ),
    ).toBe(1);
    expect(() =>
      assertCoreRegressionResult(
        required,
        result([
          { fullName: 'positive', status: 'pending' },
          { fullName: 'positive other input', status: 'passed' },
        ]),
      ),
    ).toThrow();
    expect(() =>
      assertCoreRegressionResult(
        required,
        result([
          { fullName: 'suite positive case', status: 'pending' },
          { fullName: 'suite positive case', status: 'passed' },
        ]),
      ),
    ).toThrow();
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
