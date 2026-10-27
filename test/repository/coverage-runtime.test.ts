import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('preserves source coverage while Supervisor recovery loads the built application', async () => {
  const repositoryRoot = path.resolve('.');
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-coverage-')),
  );
  try {
    const config = path.join(root, 'vitest.config.mjs');
    const report = path.join(root, 'report');
    await fs.writeFile(
      config,
      `import base from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'vitest.config.ts')).href)};
export default { ...base, test: { ...base.test,
  include: ['test/domains/comet-native/native-lock.test.ts', 'test/domains/comet-native/native-sdk-supervisor-verifier-recovery.test.ts'],
  maxWorkers: 1,
  coverage: { ...base.test.coverage, include: ['domains/comet-native/native-lock.ts'], reporter: ['json'], reportsDirectory: ${JSON.stringify(report)} }
} };
`,
    );
    const vitest = path.join(
      path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    );
    const resultsFile = path.join(root, 'results.json');
    const result = spawnSync(
      process.execPath,
      [
        vitest,
        'run',
        '--config',
        config,
        '--coverage',
        '--reporter=json',
        `--outputFile=${resultsFile}`,
        '-t',
        'Native operation locks|preserves a real custom application failure and receipts, advances its sibling, and retries only its review',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: 180_000, windowsHide: true },
    );
    const tests = JSON.parse(await fs.readFile(resultsFile, 'utf8'));
    expect(tests.numFailedTests, result.stdout + result.stderr).toBe(0);
    expect(
      tests.testResults.flatMap(
        (suite: { assertionResults: { title: string; status: string }[] }) =>
          suite.assertionResults
            .filter((test) => test.status === 'passed')
            .map((test) => test.title),
      ),
    ).toContain(
      'preserves a real custom application failure and receipts, advances its sibling, and retries only its review',
    );
    const coverage = JSON.parse(
      await fs.readFile(path.join(report, 'coverage-final.json'), 'utf8'),
    );
    const subject = coverage[path.join(repositoryRoot, 'domains/comet-native/native-lock.ts')];
    const inspected = Object.entries(subject.fnMap).find(
      ([, fn]) => (fn as { name: string }).name === 'inspectNativeProjectLocks',
    )!;
    expect(
      subject.f[inspected[0]],
      'successful lock inspections must retain their source hits',
    ).toBeGreaterThan(0);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}, 240_000);

it('keeps executed and uncalled source ranges distinct when another worker exits during import', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'comet-coverage-')));
  try {
    await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'junction');
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'test'));
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.writeFile(
      path.join(root, 'vitest.config.mjs'),
      `
import { BaseSequencer } from 'vitest/node';
class Ordered extends BaseSequencer {
  sort(tests) { return tests.sort((a, b) => a.moduleId.localeCompare(b.moduleId)); }
}
export default { test: {
  include: ['test/*.test.ts'], fileParallelism: false,
  sequence: { sequencer: Ordered },
  coverage: { provider: 'v8', include: ['src/*.ts'], reporter: ['json'], reportsDirectory: 'report' }
} };
`,
    );
    // 复现上游 #10581/#10643：未完成导入的零偏移会污染另一个 worker 的真实覆盖。
    await fs.writeFile(
      path.join(root, 'src/slow-module.ts'),
      `import { setTimeout } from "node:timers/promises";

const delay = parseInt(process.env.COMET_COVERAGE_DELAY ?? "100", 10);

if (delay > 0) {
  await setTimeout(delay);
}

export const response = { ok: true };
`,
    );
    await fs.writeFile(
      path.join(root, 'src/subject.ts'),
      `import { response } from "./slow-module";

export function uncovered() {
  throw new Error("uncovered");
}

export function uncovered2() {
  throw new Error("uncovered");
}

export function covered(value: number) {
  if(!response.ok) {
    throw new Error("response not ok");
  }

  return value + 100;
}
`,
    );
    await fs.writeFile(
      path.join(root, 'test/01-awaited.test.ts'),
      `import { expect, test } from 'vitest';
import { covered } from '../src/subject.js';
test('executes the covered function', () => { expect(covered(2)).toBe(102); });
`,
    );
    await fs.writeFile(
      path.join(root, 'test/02-pending.test.ts'),
      `import { expect, test } from 'vitest';
process.env.COMET_COVERAGE_DELAY = '10000';
test('exits with a pending import', async () => {
  const pending = import('../src/subject.js');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(pending).toBeTruthy();
});
`,
    );
    const vitest = path.join(
      path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
      'vitest.mjs',
    );
    const result = spawnSync(
      process.execPath,
      [vitest, 'run', '--coverage', '--reporter=json', '--outputFile=results.json'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        env: { ...process.env, COMET_COVERAGE_DELAY: '100' },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const tests = JSON.parse(await fs.readFile(path.join(root, 'results.json'), 'utf8'));
    expect(tests.numPassedTests).toBe(2);
    const report = JSON.parse(
      await fs.readFile(path.join(root, 'report/coverage-final.json'), 'utf8'),
    ) as Record<
      string,
      {
        path: string;
        fnMap: Record<string, { name: string }>;
        f: Record<string, number>;
        statementMap: Record<string, { start: { line: number } }>;
        s: Record<string, number>;
      }
    >;
    const subject = Object.values(report).find(
      (entry) => path.basename(entry.path) === 'subject.ts',
    )!;
    expect(
      Object.fromEntries(Object.entries(subject.fnMap).map(([id, fn]) => [fn.name, subject.f[id]])),
    ).toEqual({
      uncovered: 0,
      uncovered2: 0,
      covered: 1,
    });
    const hitsAt = (line: number) =>
      Object.entries(subject.statementMap)
        .filter(([, location]) => location.start.line === line)
        .map(([id]) => subject.s[id]);
    expect(hitsAt(4)).toEqual([0]);
    expect(hitsAt(8)).toEqual([0]);
    expect(hitsAt(13)).toEqual([0]);
    expect(hitsAt(16)).toEqual([1]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
