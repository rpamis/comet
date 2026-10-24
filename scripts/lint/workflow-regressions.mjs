import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOW_REGISTRY = 'config/workflow-regressions.json';
export const HISTORICAL_REGISTRY = 'config/historical-workflow-regressions.json';
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
export const validSource = (value) =>
  typeof value === 'string' &&
  (/^https:\/\/[^\s]+$/u.test(value) || /^report:[a-zA-Z0-9][a-zA-Z0-9._/-]*$/u.test(value));

/** 增量登记只接受可执行回归；历史排除记录留在冻结清单中。 */
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
    const patterns = [];
    const requiredCases = [];
    for (const test of item.tests) {
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
      files: [...new Set(item.tests.map((test) => test.file))],
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
  return workflowRegressionEntries(
    JSON.parse(readFileSync(path.join(repositoryRoot, WORKFLOW_REGISTRY), 'utf8')),
    historical.issues.flatMap((issue) => issue.cases.map((item) => item.id)),
  );
}

/** 完整发布不能用确定性测试通过替代仍待完成的额外验收。 */
export function assertWorkflowAcceptanceComplete(catalog) {
  workflowRegressionEntries(catalog);
  for (const item of catalog.cases) {
    if (item.additionalAcceptance?.some((acceptance) => acceptance.status !== 'verified'))
      throw new Error(`发布前仍需完成 badcase 附加验收：${item.id}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).join(' ') !== '--require-acceptance')
      throw new Error('请使用 --require-acceptance 检查发布附加验收');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    assertWorkflowAcceptanceComplete(
      JSON.parse(readFileSync(path.join(root, WORKFLOW_REGISTRY), 'utf8')),
    );
    console.log('badcase 附加验收登记完整；外部证据真实性仍需审查。');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
