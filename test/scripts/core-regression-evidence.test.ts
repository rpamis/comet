import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coreRegressionArgs } from '../../scripts/lint/core-regressions.mjs';
import {
  assertCoreRegressionEvidence,
  combineCoreRegressionPlatforms,
  createCoreRegressionExecutionPlan,
  coreRegressionCandidateIdentity,
  recordCoreRegressionPlatform,
  runCrossPlatformCoreRegressions,
  runSinglePlatformCoreRegressions,
  verifyCoreRegressionReceipt,
} from '../../scripts/lint/core-regression-evidence.mjs';

const sampling = vi.hoisted(() => ({ onRead: undefined as (() => void) | undefined }));
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    createReadStream: (...args: Parameters<typeof original.createReadStream>) => {
      sampling.onRead?.();
      return original.createReadStream(...args);
    },
  };
});

const windowsGroup = 'registered-classic-short-timeout-supervisor-startup';
const entries = ['native-fixture', windowsGroup].map((id) => ({
  id,
  files: ['test/scripts/example.test.ts'],
  requiredNames: [id],
  requiredCases: [{ file: 'test/scripts/example.test.ts', name: id, exact: true }],
}));
const identity = { revision: 'a'.repeat(40), inputHash: 'b'.repeat(64), inputFileCount: 10 };
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const temporary: string[] = [];
afterEach(async () => {
  sampling.onRead = undefined;
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});

function platformRecord(platform: string, id: string) {
  const projectRoot = platform === 'win32' ? 'D:\\isolated\\candidate' : '/isolated/candidate';
  const api = platform === 'win32' ? path.win32 : path.posix;
  const entry = entries.find((item) => item.id === id)!;
  const reportFile = api.join(projectRoot, 'coverage', `${id}.json`);
  const reportText = JSON.stringify({
    success: true,
    numFailedTests: 0,
    numFailedTestSuites: 0,
    testResults: [
      {
        name: api.join(projectRoot, entry.files[0]),
        assertionResults: [{ fullName: id, status: 'passed' }],
      },
    ],
  });
  return {
    schema: 'comet.core-regression-platform.v1',
    identity: structuredClone(identity),
    planHash: createCoreRegressionExecutionPlan(entries).planHash,
    platform,
    projectRoot,
    groups: [
      {
        id,
        command: [
          api.join(projectRoot, 'node'),
          api.join(projectRoot, 'node_modules/vitest/vitest.mjs'),
          ...coreRegressionArgs(entry, reportFile),
        ],
        exitCode: 0,
        reportFile,
        reportText,
        reportHash: sha256(reportText),
      },
    ],
  };
}

describe('cross-platform core regression evidence', () => {
  it('ignores unrelated submodule content but rejects a changed gitlink revision', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-core-gitlink-'));
    temporary.push(parent);
    const root = path.join(parent, 'candidate');
    const child = path.join(parent, 'upstream');
    const git = (directory: string, ...args: string[]) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    await fs.mkdir(child);
    await fs.mkdir(root);
    git(child, 'init', '--quiet');
    await fs.writeFile(path.join(child, 'content.txt'), 'original\n');
    git(child, 'add', '.');
    git(child, 'commit', '--quiet', '-m', 'original child');
    git(root, 'init', '--quiet');
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
    git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', child, 'website');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'original parent');
    const original = await coreRegressionCandidateIdentity(root);
    const worktree = path.join(root, 'website');
    await fs.appendFile(path.join(worktree, 'content.txt'), 'unrelated edit\n');
    await fs.writeFile(path.join(worktree, 'untracked.txt'), 'unrelated file\n');
    expect(await coreRegressionCandidateIdentity(root)).toEqual(original);
    git(worktree, 'add', '.');
    git(worktree, 'commit', '--quiet', '-m', 'changed child');
    await expect(coreRegressionCandidateIdentity(root)).rejects.toThrow(/dirty/iu);
    git(root, 'add', 'website');
    await expect(coreRegressionCandidateIdentity(root)).rejects.toThrow(/dirty/iu);
  });
  it('does not start a coordinator with foreign code or a caller-supplied reduced plan', async () => {
    const foreign = path.join(os.tmpdir(), 'comet-foreign-core-' + Date.now());
    await expect(runCrossPlatformCoreRegressions(foreign, entries, {})).rejects.toThrow(
      /complete plan.*same candidate/iu,
    );
    await expect(fs.stat(foreign)).rejects.toThrow();
    await expect(runCrossPlatformCoreRegressions(path.resolve('.'), entries, {})).rejects.toThrow(
      /complete plan.*same candidate/iu,
    );
  });
  it('records only this platform using real commands and preserves exact raw reports', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-core-recorder-'));
    temporary.push(root);
    await fs.mkdir(path.join(root, 'test/scripts'), { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture","type":"module"}\n');
    await fs.writeFile(path.join(root, '.gitignore'), '/node_modules\ncoverage/\n');
    await fs.writeFile(
      path.join(root, 'test/scripts/example.test.ts'),
      `import { it, expect } from 'vitest';\nit('native-fixture', () => expect(true).toBe(true));\nit('${windowsGroup}', () => expect(true).toBe(true));\n`,
    );
    await fs.symlink(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const outputFile = path.join(root, 'coverage/platform.json');
    // 默认发布分区固定为 Linux/Windows；macOS 用已支持的单平台模式执行同一夹具。
    const recordOptions = process.platform === 'darwin' ? { singlePlatform: true } : {};
    const record = await recordCoreRegressionPlatform(root, entries, outputFile, recordOptions);
    expect(record.platform).toBe(process.platform);
    expect(record.projectRoot).toBe(root);
    expect(record.groups).toHaveLength(recordOptions.singlePlatform ? entries.length : 1);
    expect(record.groups[0].id).toBe(
      process.platform === 'win32' ? windowsGroup : 'native-fixture',
    );
    expect(record.groups[0].reportText).toBe(
      await fs.readFile(record.groups[0].reportFile, 'utf8'),
    );
    expect(record.groups[0].reportHash).toBe(sha256(record.groups[0].reportText));
    expect(JSON.parse(await fs.readFile(outputFile, 'utf8'))).toEqual(record);
    expect(() => assertCoreRegressionEvidence(entries, record.identity, [record])).toThrow(
      /Missing/iu,
    );
    if (recordOptions.singlePlatform)
      expect(() =>
        assertCoreRegressionEvidence(entries, record.identity, [record], {
          singlePlatform: process.platform,
        }),
      ).not.toThrow();
    await expect(
      recordCoreRegressionPlatform(root, entries, outputFile, recordOptions),
    ).rejects.toThrow(/exist/iu);
    const completeFile = path.join(root, 'coverage/complete.json');
    const complete = await runSinglePlatformCoreRegressions(root, entries, completeFile);
    expect(complete.groups).toBe(entries.length);
    expect(complete.executionPlan.singlePlatform).toBe(process.platform);
    expect(await verifyCoreRegressionReceipt(root, entries, completeFile)).toEqual(complete);
    const rawFile = path.join(path.dirname(completeFile), complete.recordsFile);
    const originalRaw = await fs.readFile(rawFile, 'utf8');
    await fs.appendFile(rawFile, ' ');
    await expect(verifyCoreRegressionReceipt(root, entries, completeFile)).rejects.toThrow(
      /changed/iu,
    );
    await fs.writeFile(rawFile, originalRaw);
    await fs.appendFile(
      path.join(root, 'test/scripts/example.test.ts'),
      '// changed after execution\n',
    );
    await expect(verifyCoreRegressionReceipt(root, entries, completeFile)).rejects.toThrow(
      /dirty/iu,
    );
    if (process.platform !== 'win32') {
      execFileSync(
        'git',
        ['add', '--force', '--', 'node_modules', 'test/scripts/example.test.ts'],
        {
          cwd: root,
        },
      );
      expect(
        execFileSync('git', ['ls-files', '--stage', '--', 'node_modules'], {
          cwd: root,
          encoding: 'utf8',
        }),
      ).toMatch(/^120000 /u);
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          'deliberately tracked dependency link',
        ],
        { cwd: root },
      );
      await expect(coreRegressionCandidateIdentity(root)).rejects.toThrow(
        /Unstable core regression input: node_modules/u,
      );
    }
  }, 60_000);
  it('combines only complete original CI platform records for the current clean candidate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-core-ci-'));
    temporary.push(root);
    await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'coverage/\n');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const actual = await coreRegressionCandidateIdentity(root);
    const records = [
      platformRecord('linux', 'native-fixture'),
      platformRecord('win32', windowsGroup),
    ];
    const files = [];
    await fs.mkdir(path.join(root, 'coverage'));
    for (const record of records) {
      record.identity = actual;
      const file = path.join(root, 'coverage', record.platform + '.json');
      files.push(file);
      await fs.writeFile(file, JSON.stringify(record));
    }
    const output = path.join(root, 'coverage', 'combined.json');
    const proof = await combineCoreRegressionPlatforms(root, entries, files, output);
    expect(proof.groups).toBe(entries.length);
    expect(await verifyCoreRegressionReceipt(root, entries, output)).toEqual(proof);
    await expect(
      combineCoreRegressionPlatforms(root, entries, files.slice(0, 1), output + '.missing'),
    ).rejects.toThrow(/Missing/iu);
    records[1].identity = { ...actual, inputHash: 'c'.repeat(64) };
    await fs.writeFile(files[1], JSON.stringify(records[1]));
    await expect(
      combineCoreRegressionPlatforms(root, entries, files, output + '.stale'),
    ).rejects.toThrow(/Stale/iu);
    expect(JSON.parse(await fs.readFile(files[0], 'utf8'))).toEqual(records[0]);
  });
  it('assigns complete groups without removing any registered behavior', () => {
    const plan = createCoreRegressionExecutionPlan(entries);
    expect(plan.groups).toEqual([
      { id: 'native-fixture', platform: 'linux' },
      { id: windowsGroup, platform: 'win32' },
    ]);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      createCoreRegressionExecutionPlan([...entries, { ...entries[0], id: 'new-case' }]).planHash,
    ).not.toBe(plan.planHash);
    expect(() => createCoreRegressionExecutionPlan([...entries, entries[0]])).toThrow();
  });

  it('checks original Windows and Linux reports without rewriting paths', () => {
    const records = [
      platformRecord('linux', 'native-fixture'),
      platformRecord('win32', windowsGroup),
    ];
    const original = JSON.stringify(records);
    const result = assertCoreRegressionEvidence(entries, identity, records);
    expect(result.groups).toBe(2);
    expect(result.tests).toBe(2);
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(records)).toBe(original);
  });

  it('rejects missing platforms, stale inputs, altered reports, skipped cases and wrong commands', () => {
    const good = [platformRecord('linux', 'native-fixture'), platformRecord('win32', windowsGroup)];
    for (const mutate of [
      (records: typeof good) => records.pop(),
      (records: typeof good) => records.push(records[1]),
      (records: typeof good) => {
        records[1].identity.revision = 'c'.repeat(40);
      },
      (records: typeof good) => {
        records[1].identity.inputHash = 'c'.repeat(64);
      },
      (records: typeof good) => {
        records[1].planHash = 'c'.repeat(64);
      },
      (records: typeof good) => {
        records[1].projectRoot = 'relative';
      },
      (records: typeof good) => {
        records[1].platform = 'linux';
      },
      (records: typeof good) => {
        records[1].groups[0].exitCode = 1;
      },
      (records: typeof good) => {
        records[1].groups[0].reportText += ' ';
      },
      (records: typeof good) => {
        records[1].groups[0].command.push('--passWithNoTests');
      },
      (records: typeof good) => {
        records[1].groups.push(records[1].groups[0]);
      },
    ]) {
      const records = structuredClone(good);
      mutate(records);
      expect(() => assertCoreRegressionEvidence(entries, identity, records)).toThrow();
    }
    for (const status of ['pending', 'skipped', 'failed']) {
      const records = structuredClone(good);
      const group = records[1].groups[0];
      const report = JSON.parse(group.reportText);
      report.testResults[0].assertionResults[0].status = status;
      group.reportText = JSON.stringify(report);
      group.reportHash = sha256(group.reportText);
      expect(() => assertCoreRegressionEvidence(entries, identity, records)).toThrow();
    }
    const records = structuredClone(good);
    const group = records[1].groups[0];
    const report = JSON.parse(group.reportText);
    report.testResults[0].name = 'D:\\unrelated\\test\\scripts\\example.test.ts';
    group.reportText = JSON.stringify(report);
    group.reportHash = sha256(group.reportText);
    expect(() => assertCoreRegressionEvidence(entries, identity, records)).toThrow();
  });

  it('binds tests, helpers, configuration and product inputs and rejects dirty tracked sources', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-core-evidence-'));
    temporary.push(root);
    const files = {
      'package.json': '{"name":"fixture"}',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'vitest.config.ts': 'export default {};\n',
      'test/helpers/example.ts': 'export const value = 1;\n',
      'domains/example/index.ts': 'export const value = 1;\n',
      'config/workflow-regressions.json': '{}\n',
      'eval/local/skills/example/SKILL.md': '# Authored skill\n',
      '.gitignore': 'eval/local/skills/**/.comet/eval/\n',
    };
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), content);
    }
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: root },
    );
    const before = await coreRegressionCandidateIdentity(root);
    expect(before.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(before.inputFileCount).toBe(Object.keys(files).length);
    const generated = path.join(root, 'eval/local/skills/example/.comet/eval/runs/old.json');
    await fs.mkdir(path.dirname(generated), { recursive: true });
    await fs.writeFile(generated, '{"result":"old output"}\n');
    expect(await coreRegressionCandidateIdentity(root)).toEqual(before);
    await fs.writeFile(generated, '{"result":"changed output"}\n');
    expect(await coreRegressionCandidateIdentity(root)).toEqual(before);
    await fs.appendFile(path.join(root, 'test/helpers/example.ts'), '// changed\n');
    await expect(coreRegressionCandidateIdentity(root)).rejects.toThrow(/dirty|未提交/iu);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'changed test',
      ],
      { cwd: root },
    );
    const after = await coreRegressionCandidateIdentity(root);
    expect(after.revision).not.toBe(before.revision);
    expect(after.inputHash).not.toBe(before.inputHash);
    await fs.appendFile(path.join(root, '.git/info/exclude'), '\ntest/helpers/ignored.ts\n');
    await fs.writeFile(
      path.join(root, 'test/helpers/ignored.ts'),
      'export const ignored = true;\n',
    );
    const withIgnoredInput = await coreRegressionCandidateIdentity(root);
    expect(withIgnoredInput.revision).toBe(after.revision);
    expect(withIgnoredInput.inputHash).not.toBe(after.inputHash);
    expect(withIgnoredInput.inputFileCount).toBe(after.inputFileCount + 1);
    await fs.appendFile(path.join(root, '.git/info/exclude'), '\ndomains/example/late.ts\n');
    sampling.onRead = () => {
      sampling.onRead = undefined;
      writeFileSync(path.join(root, 'domains/example/late.ts'), 'export const late = true;\n');
    };
    await expect(coreRegressionCandidateIdentity(root)).rejects.toThrow(/unstable|changed|变化/iu);
    const stable = await coreRegressionCandidateIdentity(root);
    const authoredConfig = 'eval/local/skills/example/.comet/config.yaml';
    await fs.appendFile(path.join(root, '.git/info/exclude'), '\n' + authoredConfig + '\n');
    await fs.writeFile(path.join(root, authoredConfig), 'authored: true\n');
    const withConfig = await coreRegressionCandidateIdentity(root);
    expect(withConfig.revision).toBe(stable.revision);
    expect(withConfig.inputHash).not.toBe(stable.inputHash);
    execFileSync('git', ['add', '-f', path.relative(root, generated)], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'explicitly tracked fixture',
      ],
      { cwd: root },
    );
    const trackedOutput = await coreRegressionCandidateIdentity(root);
    expect(trackedOutput.inputFileCount).toBe(withConfig.inputFileCount + 1);
    expect(trackedOutput.inputHash).not.toBe(withConfig.inputHash);
  });
});
