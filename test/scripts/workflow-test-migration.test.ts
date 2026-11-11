import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { assertWorkflowMigrationEvidence } from '../../scripts/lint/workflow-regressions.mjs';
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
it('requires complete archives for removed superseded targets and still requires the active target', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'migration-chain-'));
  const digest = (content: string) => createHash('sha256').update(content).digest('hex');
  const original = registry().cases[0];
  const authorization = 'report:fixture-retirement',
    record = 'docs/retirement.md';
  const target = (name: string) => ({
    file: 'test/scripts/' + name + '.test.ts',
    namePattern: '^fixture$',
    requiredNames: ['fixture'],
  });
  const evidence = (prefix: string, prior: any, next: any) => {
    const ref = (kind: string, content: string) => {
      const file = 'docs/' + prefix + '-' + kind + (kind === 'patch' ? '.patch' : '.json');
      writeFileSync(path.join(root, file), content);
      return { file, sha256: digest(content) };
    };
    return {
      registry: ref('registry', JSON.stringify({ cases: [prior] })),
      tests: ref(
        'tests',
        JSON.stringify({
          files: (prior.testMigration?.tests ?? prior.tests).map((test: any) => ({
            file: test.file,
            content: 'preserved original assertion',
            sha256: digest('preserved original assertion'),
          })),
        }),
      ),
      mapping: ref(
        'mapping',
        JSON.stringify({
          cases: [{ id: prior.id, kind: next.kind, authorization, record, tests: next.tests }],
        }),
      ),
      patch: ref('patch', 'preserved original deletion patch'),
    };
  };
  try {
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    mkdirSync(path.join(root, 'test/scripts'), { recursive: true });
    writeFileSync(path.join(root, record), authorization);
    const first: any = {
      kind: 'tests-moved',
      reason: 'Move the original assertion',
      authorization,
      record,
      tests: [target('superseded')],
    };
    first.evidence = evidence('first', original, first);
    const prior = { ...original, testMigration: structuredClone(first) };
    const last: any = {
      kind: 'feature-removed',
      reason: 'Remove the requested mechanism',
      authorization,
      record,
      tests: [target('active')],
    };
    last.evidence = evidence('last', prior, last);
    first.supersededBy = last;
    const catalog = {
      schema: 'comet.release.bad-cases.v1',
      cases: [{ ...original, testMigration: first }],
    };
    writeFileSync(path.join(root, 'test/scripts/active.test.ts'), 'current replacement contract');
    expect(() => assertWorkflowMigrationEvidence(root, catalog)).not.toThrow();
    const changed = structuredClone(catalog);
    changed.cases[0].testMigration.supersededBy.evidence.tests.sha256 = '0'.repeat(64);
    expect(() => assertWorkflowMigrationEvidence(root, changed)).toThrow('摘要不符');
    rmSync(path.join(root, 'test/scripts/active.test.ts'));
    expect(() => assertWorkflowMigrationEvidence(root, catalog)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
