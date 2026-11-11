import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_REGISTRY = 'config/workflow-regressions.json';
export const HISTORICAL_REGISTRY = 'config/historical-workflow-regressions.json';
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
export const validSource = (value) =>
  typeof value === 'string' &&
  (/^https:\/\/[^\s]+$/u.test(value) || /^report:[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(value));

/** 冻结清单不改写；迁移沿用原 ID、来源和测试正文。 */
export function historicalTestMigrationCases(historical, catalog) {
  const migrations = Object.hasOwn(catalog, 'historicalTestMigrations')
    ? catalog.historicalTestMigrations
    : [];
  if (!Array.isArray(migrations)) throw new Error('历史测试迁移必须为数组');
  const originals = new Map(
    historical.issues.flatMap((issue) =>
      issue.cases.map((item) => [item.id, { item, issue: issue.number }]),
    ),
  );
  const seen = new Set();
  return migrations.map((entry) => {
    const original = originals.get(entry.id);
    if (
      !original ||
      original.item.status !== 'covered' ||
      seen.has(entry.id) ||
      !entry.testMigration ||
      Object.keys(entry).some((key) => !['id', 'testMigration'].includes(key))
    )
      throw new Error(`历史测试迁移 ID 无效或重复：${entry.id}`);
    seen.add(entry.id);
    const value = { ...original.item, testMigration: entry.testMigration };
    workflowRegressionEntries({
      schema: 'comet.release.bad-cases.v1',
      cases: [
        {
          ...value,
          coverageLevel: 'runtime',
          sources: [
            `https://github.com/${historical.inventory.repository}/issues/${original.issue}`,
          ],
          reproduction: '保留冻结历史登记',
          expected: value.behavior,
          forbidden: '遗漏原行为',
          rootCause: entry.testMigration.reason,
        },
      ],
    });
    return value;
  });
}

/** 后续撤下另一个功能时追加迁移，不改写已审计的旧迁移。 */
export function workflowTestMigrationChain(item) {
  const chain = [];
  const seen = new Set();
  let migration = item.testMigration;
  while (migration !== undefined) {
    if (!migration || typeof migration !== 'object' || seen.has(migration))
      throw new Error('测试迁移链无效');
    seen.add(migration);
    chain.push(migration);
    migration = migration.supersededBy;
  }
  return chain;
}

/** 原登记保持不变；明确移除功能或迁移测试时，改执行有来源记录的新契约。 */
export function workflowRegressionEntries(catalog, historicalIds = []) {
  if (catalog?.schema !== 'comet.release.bad-cases.v1' || !Array.isArray(catalog.cases))
    throw new Error('增量 badcase 清单 schema 不正确');
  const ids = new Set(historicalIds);
  return catalog.cases.map((item) => {
    if (
      typeof item.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(item.id ?? '') ||
      ids.has(item.id)
    )
      throw new Error(`badcase ID 缺失或重复：${item.id}`);
    ids.add(item.id);
    if (
      !nonempty(item.behavior) ||
      !['unit', 'runtime', 'public-cli'].includes(item.coverageLevel) ||
      !['reproduction', 'expected', 'forbidden', 'rootCause'].every((key) => nonempty(item[key])) ||
      !Array.isArray(item.sources) ||
      !item.sources.length ||
      !item.sources.every(validSource) ||
      !Array.isArray(item.tests) ||
      !item.tests.length ||
      (item.status !== undefined && item.status !== 'covered')
    )
      throw new Error(`badcase 缺少行为、来源或必过回归，不支持增量排除：${item.id}`);
    if (
      item.additionalAcceptance !== undefined &&
      (!Array.isArray(item.additionalAcceptance) ||
        item.additionalAcceptance.some(
          (acceptance) =>
            !nonempty(acceptance.layer) ||
            !['pending', 'verified'].includes(acceptance.status) ||
            !Array.isArray(acceptance.evidence) ||
            !acceptance.evidence.every(nonempty) ||
            (acceptance.status === 'verified' && !acceptance.evidence.length),
        ))
    )
      throw new Error(`附加验收必须登记 layer、pending/verified 状态及 evidence：${item.id}`);
    const migrations = workflowTestMigrationChain(item);
    const migration = migrations.at(-1);
    for (const migration of migrations) {
      if (
        migration !== undefined &&
        (!['feature-removed', 'tests-moved'].includes(migration.kind) ||
          !nonempty(migration.reason) ||
          !validSource(migration.authorization) ||
          !/^docs\/[a-zA-Z0-9_./-]+\.md$/u.test(migration.record ?? '') ||
          migration.record.split('/').includes('..') ||
          !Array.isArray(migration.tests) ||
          !migration.tests.length ||
          !migration.evidence ||
          !['registry', 'patch', 'mapping', 'tests'].every(
            (key) =>
              /^docs\/[a-zA-Z0-9_./-]+\.(?:json|patch)$/u.test(
                migration.evidence[key]?.file ?? '',
              ) &&
              !migration.evidence[key].file.split('/').includes('..') &&
              /^[a-f0-9]{64}$/u.test(migration.evidence[key]?.sha256 ?? ''),
          ))
      )
        throw new Error(`badcase 测试迁移缺少原因、授权来源、文档或替代契约：${item.id}`);
    }
    const patterns = [];
    const requiredCases = [];
    for (const test of [...item.tests, ...migrations.flatMap((migration) => migration.tests)]) {
      if (
        !/^test\/[a-zA-Z0-9_./-]+\.test\.ts$/u.test(test.file) ||
        test.file.split('/').includes('..') ||
        !nonempty(test.namePattern) ||
        !Array.isArray(test.requiredNames) ||
        !test.requiredNames.length ||
        !test.requiredNames.every(nonempty)
      )
        throw new Error(
          `badcase 回归选择不完整（仅支持 test/**/*.test.ts；其他层需附加验收证据）：${item.id}`,
        );
      new RegExp(test.namePattern, 'u');
      if (migration && !migration.tests.includes(test)) continue;
      patterns.push(test.namePattern);
      requiredCases.push(
        ...test.requiredNames.map((name) => ({ file: test.file, name, exact: true })),
      );
    }
    return {
      id: `registered-${item.id}`,
      caseIds: [item.id],
      issues: [],
      invariant: item.behavior,
      files: [...new Set((migration?.tests ?? item.tests).map((test) => test.file))],
      testNamePattern: patterns.map((pattern) => `(?:${pattern})`).join('|'),
      requiredNames: [...new Set(requiredCases.map((test) => test.name))],
      requiredCases,
    };
  });
}

export function loadWorkflowRegressions(repositoryRoot) {
  const historical = JSON.parse(
    readFileSync(path.join(repositoryRoot, HISTORICAL_REGISTRY), 'utf8'),
  );
  const catalog = JSON.parse(readFileSync(path.join(repositoryRoot, WORKFLOW_REGISTRY), 'utf8'));
  assertWorkflowMigrationEvidence(repositoryRoot, catalog);
  const entries = workflowRegressionEntries(
    catalog,
    historical.issues.flatMap((issue) => issue.cases.map((item) => item.id)),
  );
  const migrated = new Set(
    catalog.cases
      .filter((item) => workflowTestMigrationChain(item).length > 0)
      .map((item) => item.id),
  );
  // 同一测试被多个来源复用时按文件合并执行；case ID 仍选择该案例的全部文件。
  return entries.flatMap((entry) =>
    entry.files.length === 1 || !migrated.has(entry.caseIds[0])
      ? [entry]
      : entry.files.map((file, index) => ({
          ...entry,
          id: `${entry.id}-file-${index + 1}`,
          files: [file],
          requiredCases: entry.requiredCases.filter((item) => item.file === file),
          requiredNames: [
            ...new Set(
              entry.requiredCases.filter((item) => item.file === file).map((item) => item.name),
            ),
          ],
        })),
  );
}

/** 迁移必须绑定真实旧登记、旧测试补丁和逐行为新契约，不能只写一段豁免说明。 */
export function assertWorkflowMigrationEvidence(repositoryRoot, catalog) {
  workflowRegressionEntries(catalog);
  const historical = Object.hasOwn(catalog, 'historicalTestMigrations')
    ? JSON.parse(readFileSync(path.join(repositoryRoot, HISTORICAL_REGISTRY), 'utf8'))
    : null;
  const entries = [
    ...catalog.cases,
    ...(historical ? historicalTestMigrationCases(historical, catalog) : []),
  ];
  const root = realpathSync(repositoryRoot);
  const cache = new Map();
  const read = (ref) => {
    const key = `${ref.file}:${ref.sha256}`;
    if (cache.has(key)) return cache.get(key);
    const file = realpathSync(path.join(root, ref.file));
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('迁移证据必须在仓库内');
    const bytes = readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256)
      throw new Error(`迁移证据摘要不符：${ref.file}`);
    cache.set(key, bytes);
    return bytes;
  };
  for (const item of entries) {
    const migrations = workflowTestMigrationChain(item);
    for (const [index, migration] of migrations.entries()) {
      const archived = JSON.parse(read(migration.evidence.registry).toString('utf8'));
      const original = structuredClone(item);
      if (index === 0) delete original.testMigration;
      else {
        let previous = original.testMigration;
        for (let level = 1; level < index; level++) previous = previous.supersededBy;
        delete previous.supersededBy;
      }
      if (
        !isDeepStrictEqual(
          archived.cases?.find((entry) => entry.id === item.id),
          original,
        )
      )
        throw new Error(`迁移改写了旧登记：${item.id}`);
      read(migration.evidence.patch);
      const snapshots = JSON.parse(read(migration.evidence.tests).toString('utf8'));
      for (const test of index === 0 ? item.tests : migrations[index - 1].tests) {
        const snapshot = snapshots.files?.find((entry) => entry.file === test.file);
        if (
          !snapshot?.content ||
          createHash('sha256').update(snapshot.content).digest('hex') !== snapshot.sha256
        )
          throw new Error(`迁移缺少完整旧测试正文或摘要不符：${item.id}`);
      }
      const mapping = JSON.parse(read(migration.evidence.mapping).toString('utf8'));
      const entry = mapping.cases?.find((value) => value.id === item.id);
      if (
        !isDeepStrictEqual(entry, {
          id: item.id,
          kind: migration.kind,
          authorization: migration.authorization,
          record: migration.record,
          tests: migration.tests,
        })
      )
        throw new Error(`迁移与逐行为清单不符：${item.id}`);
      const record = realpathSync(path.join(root, migration.record));
      const relative = path.relative(root, record);
      if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !readFileSync(record, 'utf8').includes(migration.authorization)
      )
        throw new Error(`迁移文档缺少授权来源：${item.id}`);
      // 被后续迁移替代的断言已在下一段完整归档；只有最终契约必须仍可执行。
      for (const test of index === migrations.length - 1 ? migration.tests : []) {
        const target = realpathSync(path.join(root, test.file));
        if (path.relative(root, target).startsWith('..')) throw new Error('迁移测试必须在仓库内');
      }
    }
  }
}

/** 完整发布不能用确定性测试通过替代仍待完成的额外验收。 */
export function assertWorkflowAcceptanceComplete(catalog) {
  workflowRegressionEntries(catalog);
  for (const item of catalog.cases) {
    if (workflowTestMigrationChain(item).some((migration) => migration.kind === 'feature-removed'))
      continue;
    if (item.additionalAcceptance?.some((acceptance) => acceptance.status !== 'verified'))
      throw new Error(`发布前仍需完成 badcase 附加验收：${item.id}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).join(' ') !== '--require-acceptance')
      throw new Error('请使用 --require-acceptance 检查发布附加验收');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    assertWorkflowMigrationEvidence(
      root,
      JSON.parse(readFileSync(path.join(root, WORKFLOW_REGISTRY), 'utf8')),
    );
    assertWorkflowAcceptanceComplete(
      JSON.parse(readFileSync(path.join(root, WORKFLOW_REGISTRY), 'utf8')),
    );
    console.log('badcase 附加验收登记完整；外部证据真实性仍需审查。');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
