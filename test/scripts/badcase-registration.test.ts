import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertBadcaseRegistration,
  parseBadcaseDeclaration,
  readBaseRegistry,
} from '../../scripts/lint/badcase-registration.mjs';
import { assertCoreRegressionResult } from '../../scripts/lint/core-regressions.mjs';
import { mergeHistoricalRegressions } from '../../scripts/lint/historical-regressions.mjs';
import {
  assertWorkflowAcceptanceComplete,
  assertWorkflowMigrationEvidence,
  workflowRegressionEntries,
} from '../../scripts/lint/workflow-regressions.mjs';

const source = 'report:regression-fixture';
function registry() {
  return {
    schema: 'comet.release.bad-cases.v1',
    cases: [
      {
        coverageLevel: 'unit',
        reproduction: '恢复后提交旧批准',
        expected: '拒绝继续',
        forbidden: '直接放行',
        rootCause: '未重新校验批准',
        id: 'fixture-recovery',
        behavior: '恢复后仍拒绝失效批准',
        sources: [source],
        tests: [
          {
            file: 'test/scripts/badcase-registration.test.ts',
            namePattern: 'registered behavior',
            requiredNames: ['registered behavior'],
          },
        ],
      },
    ],
  };
}
function historical() {
  return {
    schema: 'comet.release.historical-bad-cases.v1',
    inventory: {
      repository: 'rpamis/comet',
      complete: true,
      sourceIssueNumbers: [1],
      outOfScopeIssues: [],
    },
    issues: [
      {
        number: 1,
        cases: [{ ...registry().cases[0], id: 'historical-recovery', status: 'covered' }],
      },
    ],
  };
}
function declaration() {
  return {
    status: 'fixes',
    fixes: [{ source, behavior: '恢复后仍拒绝失效批准', caseIds: ['fixture-recovery'] }],
  };
}
function input() {
  return {
    historical: historical(),
    registry: registry(),
    baseHistorical: historical(),
    baseRegistry: registry(),
    declaration: declaration(),
  };
}

describe('continuous badcase registration', () => {
  it('requires an auditable replacement contract for explicitly removed features', () => {
    const catalog = registry();
    const entry = catalog.cases[0] as Record<string, any>;
    entry.testMigration = {
      evidence: JSON.parse(
        readFileSync(path.resolve('config/workflow-regressions.json'), 'utf8'),
      ).cases.find((item) => item.testMigration).testMigration.evidence,
      kind: 'feature-removed',
      reason: '用户明确要求撤下该入口，旧行为和断言保留在历史记录。',
      authorization: 'report:feature-removal-request',
      record: 'docs/research/retirement.md',
      tests: [
        {
          file: 'test/app/removed.test.ts',
          namePattern: '^rejects removed entry$',
          requiredNames: ['rejects removed entry'],
        },
      ],
    };
    expect(workflowRegressionEntries(catalog)[0].files).toEqual(['test/app/removed.test.ts']);
    expect(workflowRegressionEntries(catalog)[0].requiredNames).toEqual(['rejects removed entry']);
    expect(() =>
      assertBadcaseRegistration({ ...input(), registry: catalog, declaration: undefined }),
    ).not.toThrow();
    expect(() => assertBadcaseRegistration({ ...input(), registry: catalog })).toThrow(
      '原问题修复',
    );
    for (const key of ['reason', 'authorization', 'record', 'tests']) {
      const invalid = structuredClone(catalog);
      delete (invalid.cases[0] as Record<string, any>).testMigration[key];
      expect(() => workflowRegressionEntries(invalid)).toThrow('迁移');
    }
    const changed = structuredClone(catalog);
    changed.cases[0].behavior = '偷偷替换历史行为';
    expect(() =>
      assertBadcaseRegistration({ ...input(), registry: changed, declaration: undefined }),
    ).toThrow('缩减');
  });
  it('rejects missing documents, changed archives and forged migration mappings', () => {
    const root = path.resolve('.');
    const catalog = JSON.parse(
      readFileSync(path.join(root, 'config/workflow-regressions.json'), 'utf8'),
    );
    expect(() => assertWorkflowMigrationEvidence(root, catalog)).not.toThrow();
    const index = catalog.cases.findIndex((item) => item.testMigration);
    for (const mutate of [
      (item) => {
        item.testMigration.record = 'docs/research/nonexistent-retirement-record.md';
      },
      (item) => {
        item.testMigration.evidence.registry.sha256 = '0'.repeat(64);
      },
      (item) => {
        item.behavior = '改写旧行为';
      },
      (item) => {
        item.testMigration.tests[0].requiredNames = ['fake'];
      },
    ]) {
      const changed = structuredClone(catalog);
      mutate(changed.cases[index]);
      expect(() => assertWorkflowMigrationEvidence(root, changed)).toThrow();
    }
  });
  it('appends a second audited migration without replacing the first migration', () => {
    const catalog = registry();
    const first = JSON.parse(readFileSync('config/workflow-regressions.json', 'utf8')).cases.find(
      (item) => item.testMigration,
    ).testMigration;
    delete first.supersededBy;
    Object.assign(catalog.cases[0], { testMigration: { ...first, kind: 'tests-moved' } });
    const before = structuredClone(catalog);
    const entry = catalog.cases[0] as Record<string, any>;
    entry.testMigration.supersededBy = {
      ...first,
      kind: 'feature-removed',
      tests: [
        {
          file: 'test/app/replacement.test.ts',
          namePattern: '^latest contract$',
          requiredNames: ['latest contract'],
        },
      ],
    };
    expect(workflowRegressionEntries(catalog)[0].requiredNames).toEqual(['latest contract']);
    expect(() =>
      assertBadcaseRegistration({
        ...input(),
        baseRegistry: before,
        registry: catalog,
        declaration: undefined,
      }),
    ).not.toThrow();
    expect(() =>
      assertBadcaseRegistration({ ...input(), baseRegistry: before, registry: catalog }),
    ).toThrow('原问题修复');
    const changed = structuredClone(catalog) as Record<string, any>;
    changed.cases[0].testMigration.reason = '覆盖旧迁移';
    expect(() =>
      assertBadcaseRegistration({
        ...input(),
        baseRegistry: before,
        registry: changed,
        declaration: undefined,
      }),
    ).toThrow('缩减');
    entry.testMigration.supersededBy.authorization = '';
    expect(() => workflowRegressionEntries(catalog)).toThrow('迁移');
  });
  it('keeps a removed feature retired when only its replacement tests move', () => {
    const catalog = registry();
    const migration = structuredClone(
      JSON.parse(readFileSync('config/workflow-regressions.json', 'utf8')).cases.find(
        (item) => item.testMigration,
      ).testMigration,
    );
    delete migration.supersededBy;
    Object.assign(catalog.cases[0], {
      testMigration: {
        ...migration,
        kind: 'feature-removed',
        supersededBy: { ...migration, kind: 'tests-moved' },
      },
      additionalAcceptance: [{ layer: 'retired-model-protocol', status: 'pending', evidence: [] }],
    });
    expect(() => assertBadcaseRegistration({ ...input(), registry: catalog })).toThrow(
      '原问题修复',
    );
    expect(() => assertWorkflowAcceptanceComplete(catalog)).not.toThrow();
  });
  it('requires exactly one structured PR declaration, not closing keywords', () => {
    expect(() => parseBadcaseDeclaration('Fixes #1')).toThrow('只包含一个');
    const block = `<!-- badcase-registration\n${JSON.stringify(declaration())}\n-->`;
    expect(parseBadcaseDeclaration(block)).toEqual(declaration());
    expect(() => parseBadcaseDeclaration(`${block}\n${block}`)).toThrow('只包含一个');
    expect(() => parseBadcaseDeclaration('<!-- badcase-registration\nnot json\n-->')).toThrow();
    for (const value of [null, [], false, {}]) {
      expect(() => assertBadcaseRegistration({ ...input(), declaration: value })).toThrow();
    }
  });

  it('accepts an explicit no-fix reason but rejects empty or conflicting declarations', () => {
    expect(() =>
      assertBadcaseRegistration({
        ...input(),
        declaration: {
          status: 'no-user-behavior-fix',
          reason: '只补充文档中的环境说明。',
          fixes: [],
        },
      }),
    ).not.toThrow();
    for (const value of [
      { status: 'fixes', fixes: [] },
      { status: 'no-user-behavior-fix', reason: '', fixes: [] },
      { ...declaration(), status: 'no-user-behavior-fix', reason: '有实际修复' },
    ]) {
      expect(() => assertBadcaseRegistration({ ...input(), declaration: value })).toThrow();
    }
  });

  it('requires each reported behavior to map to a registered case from the same source', () => {
    expect(() => assertBadcaseRegistration(input())).not.toThrow();
    for (const fix of [
      { ...declaration().fixes[0], caseIds: [] },
      { ...declaration().fixes[0], caseIds: ['missing'] },
      { ...declaration().fixes[0], source: 'report:another-report' },
      { ...declaration().fixes[0], behavior: '' },
    ]) {
      expect(() =>
        assertBadcaseRegistration({ ...input(), declaration: { status: 'fixes', fixes: [fix] } }),
      ).toThrow();
    }
  });

  it('reuses historical cases only for the matching issue and rejects duplicate IDs', () => {
    const value = input();
    value.declaration.fixes[0].caseIds = ['historical-recovery'];
    value.declaration.fixes[0].source = 'https://github.com/rpamis/comet/issues/1';
    expect(() => assertBadcaseRegistration(value)).not.toThrow();
    value.registry.cases[0].id = 'historical-recovery';
    expect(() => assertBadcaseRegistration(value)).toThrow('重复');
    const duplicate = input();
    duplicate.declaration.fixes[0].caseIds.push('fixture-recovery');
    expect(() => assertBadcaseRegistration(duplicate)).toThrow('重复');
  });

  it('prevents removal, source loss, assertion shrinkage and unsupported exclusion against base', () => {
    const mutations = [
      (value: ReturnType<typeof input>) => {
        value.registry.cases = [];
      },
      (value: ReturnType<typeof input>) => {
        value.registry.cases[0].sources = ['report:other'];
      },
      (value: ReturnType<typeof input>) => {
        value.registry.cases[0].tests[0].requiredNames = ['weaker assertion'];
      },
      (value: ReturnType<typeof input>) => {
        Object.assign(value.registry.cases[0], { status: 'excluded', reason: '不再需要' });
      },
      (value: ReturnType<typeof input>) => {
        value.historical.issues[0].cases[0].status = 'excluded';
        Object.assign(value.historical.issues[0].cases[0], {
          reason: 'removed',
          evidence: ['anything'],
        });
      },
    ];
    for (const mutate of mutations) {
      const value = input();
      mutate(value);
      expect(() => assertBadcaseRegistration(value)).toThrow();
    }
  });

  it('permits additive cases and sources without rewriting the historical census', () => {
    const value = input();
    value.registry.cases[0].sources.push('https://github.com/rpamis/comet/issues/999');
    value.registry.cases[0].tests[0].requiredNames.push('another required assertion');
    value.registry.cases.push({
      ...structuredClone(value.registry.cases[0]),
      id: 'another-recovery',
    });
    expect(() => assertBadcaseRegistration(value)).not.toThrow();
  });

  it('rejects unexecutable or unsafe selectors rather than treating them as exclusions', () => {
    for (const file of [
      'test/../escape.test.ts',
      'test/browser/flow.spec.ts',
      'eval/test_flow.py',
    ]) {
      const value = registry();
      value.cases[0].tests[0].file = file;
      expect(() => workflowRegressionEntries(value)).toThrow('不完整');
    }
    const value = registry();
    value.cases[0].tests[0].namePattern = '[';
    expect(() => workflowRegressionEntries(value)).toThrow();
  });

  it('registered behavior must really pass in its declared file, never skip or pass elsewhere', () => {
    const entry = workflowRegressionEntries(registry())[0];
    const report = (status: string, file: string) => ({
      success: true,
      numFailedTests: 0,
      testResults: [
        {
          name: path.resolve(file),
          assertionResults: [{ fullName: 'registered behavior', status }],
        },
      ],
    });
    expect(assertCoreRegressionResult(entry, report('passed', entry.files[0]))).toBe(1);
    for (const status of ['pending', 'skipped', 'todo', 'failed']) {
      expect(() => assertCoreRegressionResult(entry, report(status, entry.files[0]))).toThrow();
    }
    expect(() =>
      assertCoreRegressionResult(entry, report('passed', 'test/scripts/other.test.ts')),
    ).toThrow('required file regression');
  });

  it('does not mask a skipped exact assertion with a passing duplicate or longer name', () => {
    const entry = workflowRegressionEntries(registry())[0];
    for (const name of ['registered behavior', 'registered behavior for another input']) {
      const report = {
        success: true,
        numFailedTests: 0,
        testResults: [
          {
            name: path.resolve(entry.files[0]),
            assertionResults: [
              { fullName: 'registered behavior', status: 'pending' },
              { fullName: name, status: 'passed' },
            ],
          },
        ],
      };
      expect(() => assertCoreRegressionResult(entry, report)).toThrow('required file regression');
    }
    const duplicatePassed = {
      success: true,
      numFailedTests: 0,
      testResults: [
        {
          name: path.resolve(entry.files[0]),
          assertionResults: [
            { fullName: 'registered behavior', status: 'passed' },
            { fullName: 'registered behavior', status: 'passed' },
          ],
        },
      ],
    };
    expect(() => assertCoreRegressionResult(entry, duplicatePassed)).toThrow(
      'required file regression',
    );
    const onlyLongerName = {
      success: true,
      numFailedTests: 0,
      testResults: [
        {
          name: path.resolve(entry.files[0]),
          assertionResults: [
            { fullName: 'registered behavior for another input', status: 'passed' },
          ],
        },
      ],
    };
    expect(() => assertCoreRegressionResult(entry, onlyLongerName)).toThrow(
      'required file regression',
    );
  });

  it('blocks a resolved claim until additional required acceptance has evidence', () => {
    const value = input();
    const additionalAcceptance = [
      { layer: 'real-platform-hook', status: 'pending', evidence: [] as string[] },
    ];
    Object.assign(value.registry.cases[0], { additionalAcceptance });
    expect(() => assertBadcaseRegistration(value)).toThrow('待完成');
    expect(() => assertWorkflowAcceptanceComplete(value.registry)).toThrow('发布前');
    Object.assign(value.baseRegistry.cases[0], {
      additionalAcceptance: structuredClone(additionalAcceptance),
    });
    additionalAcceptance[0].status = 'verified';
    expect(() => assertBadcaseRegistration(value)).toThrow('附加验收');
    additionalAcceptance[0].evidence.push('https://example.com/reviewed-run');
    expect(() => assertWorkflowAcceptanceComplete(value.registry)).not.toThrow();
    expect(() => assertBadcaseRegistration(value)).not.toThrow();
  });

  it('retains all files when an incremental case spans several files', () => {
    const value = registry();
    value.cases[0].tests.push({ ...value.cases[0].tests[0], file: 'test/scripts/another.test.ts' });
    const entry = workflowRegressionEntries(value)[0];
    const core = {
      id: 'existing',
      files: [entry.files[0]],
      issues: [],
      requiredNames: [],
      invariant: 'existing',
    };
    const result = mergeHistoricalRegressions([core], [entry]);
    expect(result).toHaveLength(2);
    expect(result[1].files).toHaveLength(2);
    const oneFile = workflowRegressionEntries(registry())[0];
    const merged = mergeHistoricalRegressions([core], [oneFile]);
    expect(merged).toHaveLength(1);
    expect(merged[0].caseIds).toContain('fixture-recovery');
    expect(merged[0].requiredCases).toEqual(oneFile.requiredCases);
    expect(merged[0].requiredCases[0].exact).toBe(true);
  });

  it('keeps the declaration guard in the ordinary PR job and refreshes edited PR bodies', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('types: [opened, synchronize, reopened, edited]');
    expect(workflow).not.toContain('pull_request_target');
    const job = workflow.slice(
      workflow.indexOf('  core-regressions:'),
      workflow.indexOf('  node-compatibility:'),
    );
    expect(job).toContain(
      "name: Badcase regressions (${{ matrix.os }}${{ matrix.shards > 1 && format(', shard {0}/{1}', matrix.shard, matrix.shards) || '' }})",
    );
    expect(job).toContain('fetch-depth: 0');
    expect(job).toContain('persist-credentials: false');
    expect(job).toContain('run: pnpm check:badcase-registration');
    expect(job).toContain(
      'run: pnpm test:core-regressions --shard=${{ matrix.shard }}/${{ matrix.shards }}',
    );
    expect(job).not.toContain('github.event.pull_request.body');
    const placeholder = parseBadcaseDeclaration(
      readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8'),
    );
    expect(() => assertBadcaseRegistration({ ...input(), declaration: placeholder })).toThrow();
  });

  it('reads a committed baseline registry larger than the default process output buffer', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'badcase-large-base-'));
    try {
      const expected = registry();
      expected.cases[0].reproduction = 'x'.repeat(2 * 1024 * 1024);
      mkdirSync(path.join(dir, 'config'));
      writeFileSync(path.join(dir, 'config/workflow-regressions.json'), JSON.stringify(expected));
      execFileSync('git', ['init', '--quiet'], { cwd: dir });
      execFileSync('git', ['add', 'config/workflow-regressions.json'], { cwd: dir });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '--quiet',
          '-m',
          'large baseline',
        ],
        { cwd: dir },
      );
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      expect(readBaseRegistry(dir, sha, 'config/workflow-regressions.json')).toEqual(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows first incremental registry introduction but never treats an unreadable base as empty', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'badcase-base-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: dir });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          'commit',
          '--quiet',
          '--allow-empty',
          '-m',
          'fixture',
        ],
        { cwd: dir },
      );
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      expect(readBaseRegistry(dir, sha, 'config/workflow-regressions.json', true)).toBeUndefined();
      const firstAdoption = {
        ...input(),
        baseHistorical: readBaseRegistry(
          dir,
          sha,
          'config/historical-workflow-regressions.json',
          true,
        ),
        baseRegistry: readBaseRegistry(dir, sha, 'config/workflow-regressions.json', true),
      };
      expect(() => assertBadcaseRegistration(firstAdoption)).not.toThrow();
      expect(() => assertBadcaseRegistration({ ...firstAdoption, historical: {} })).toThrow();

      expect(() =>
        readBaseRegistry(dir, sha, 'config/historical-workflow-regressions.json'),
      ).toThrow('缺少');
      expect(() =>
        readBaseRegistry(dir, '1'.repeat(40), 'config/workflow-regressions.json', true),
      ).toThrow();
      expect(() =>
        readBaseRegistry(dir, '--all', 'config/workflow-regressions.json', true),
      ).toThrow('完整');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
