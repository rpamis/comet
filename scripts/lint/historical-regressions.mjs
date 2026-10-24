import { readFileSync } from 'node:fs';
import path from 'node:path';

const testPath = /^test\/[a-zA-Z0-9_./-]+\.test\.ts$/u;

/** 历史清单必须逐项有回归或明确移除证据；gap 不能被发布入口静默跳过。 */
export function historicalRegressionEntries(catalog) {
  if (catalog?.schema !== 'comet.release.historical-bad-cases.v1' || !Array.isArray(catalog.issues))
    throw new Error('历史 bad case 清单缺失或 schema 不正确');
  if (!catalog.issues.length) throw new Error('历史 bad case 清单不能为空');
  const inventory = catalog.inventory;
  if (
    inventory?.complete !== true ||
    !Array.isArray(inventory.sourceIssueNumbers) ||
    !inventory.sourceIssueNumbers.length ||
    !Array.isArray(inventory.outOfScopeIssues)
  )
    throw new Error('历史 issue 清单尚未完成全集核对');
  const source = new Set(inventory.sourceIssueNumbers);
  if (
    source.size !== inventory.sourceIssueNumbers.length ||
    [...source].some((number) => !Number.isInteger(number) || number <= 0)
  )
    throw new Error('历史全集编号缺失或重复');
  const accounted = new Set();
  for (const entry of inventory.outOfScopeIssues) {
    if (
      !source.has(entry.number) ||
      accounted.has(entry.number) ||
      typeof entry.reason !== 'string' ||
      !entry.reason.trim()
    )
      throw new Error('历史界外 issue 缺少编号或排除理由');
    accounted.add(entry.number);
  }
  const ids = new Set();
  const files = new Map();
  for (const issue of catalog.issues) {
    if (
      !Number.isInteger(issue.number) ||
      issue.number <= 0 ||
      !Array.isArray(issue.cases) ||
      !issue.cases.length
    )
      throw new Error('历史 issue 必须有编号及逐项行为记录');
    if (!source.has(issue.number) || accounted.has(issue.number))
      throw new Error(`历史 issue 不在全集或被重复归类：${issue.number}`);
    accounted.add(issue.number);
    for (const item of issue.cases) {
      if (typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id))
        throw new Error(`历史 case ID 缺失或重复：${item.id}`);
      ids.add(item.id);
      if (typeof item.behavior !== 'string' || !item.behavior.trim())
        throw new Error(`历史 case 缺少可验证行为：${item.id}`);
      if (item.status === 'excluded') {
        if (
          typeof item.reason !== 'string' ||
          !item.reason.trim() ||
          !Array.isArray(item.evidence) ||
          !item.evidence.length
        )
          throw new Error(`已排除行为缺少 050 移除依据：${item.id}`);
        continue;
      }
      if (item.status !== 'covered' || !Array.isArray(item.tests) || !item.tests.length)
        throw new Error(`历史 case 尚无必过回归：${item.id}`);
      for (const test of item.tests) {
        if (
          !testPath.test(test.file) ||
          test.file.split('/').includes('..') ||
          typeof test.namePattern !== 'string' ||
          !test.namePattern.trim() ||
          !Array.isArray(test.requiredNames) ||
          !test.requiredNames.length ||
          test.requiredNames.some((name) => typeof name !== 'string' || !name.trim())
        )
          throw new Error(`历史回归选择不完整：${item.id}`);
        new RegExp(test.namePattern, 'u');
        const entry = files.get(test.file) ?? {
          id: `history-${test.file.slice(5, -8).replaceAll('/', '-')}`,
          issues: [],
          invariant: '保留 040 beta 至 050 仍适用的用户历史故障回归。',
          files: [test.file],
          requiredNames: [],
          requiredCases: [],
          patterns: [],
        };
        if (!entry.issues.includes(issue.number)) entry.issues.push(issue.number);
        entry.patterns.push(test.namePattern);
        entry.requiredNames.push(...test.requiredNames);
        entry.requiredCases.push(...test.requiredNames.map((name) => ({ file: test.file, name })));
        files.set(test.file, entry);
      }
    }
  }
  if (accounted.size !== source.size) throw new Error('历史全集仍有未归类的 issue');
  return [...files.values()].map(({ patterns, ...entry }) => ({
    ...entry,
    testNamePattern: [...new Set(patterns)].map((pattern) => `(?:${pattern})`).join('|'),
    requiredNames: [...new Set(entry.requiredNames)],
    requiredCases: [
      ...new Map(entry.requiredCases.map((item) => [`${item.file}\0${item.name}`, item])).values(),
    ],
  }));
}

export function loadHistoricalRegressions(repositoryRoot) {
  return historicalRegressionEntries(
    JSON.parse(
      readFileSync(
        path.join(repositoryRoot, 'config/historical-workflow-regressions.json'),
        'utf8',
      ),
    ),
  );
}

/** 相同文件已被核心组完整执行时只增加必需断言，不重复整组运行。 */
export function mergeHistoricalRegressions(core, historical) {
  const merged = structuredClone(core);
  for (const entry of historical) {
    const existing = merged.find(
      (group) =>
        group.files.includes(entry.files[0]) &&
        (!group.testNamePattern || group.files.length === 1),
    );
    if (!existing) {
      merged.push(structuredClone(entry));
      continue;
    }
    existing.issues = [...new Set([...existing.issues, ...entry.issues])];
    existing.requiredNames = [...new Set([...existing.requiredNames, ...entry.requiredNames])];
    existing.requiredCases = [...(existing.requiredCases ?? []), ...(entry.requiredCases ?? [])];
    if (existing.testNamePattern)
      existing.testNamePattern = `(?:${existing.testNamePattern})|(?:${entry.testNamePattern})`;
  }
  return merged;
}
