import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { historicalRegressionEntries } from './historical-regressions.mjs';
import {
  HISTORICAL_REGISTRY,
  WORKFLOW_REGISTRY,
  validSource,
  workflowRegressionEntries,
} from './workflow-regressions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

export function parseBadcaseDeclaration(body) {
  const matches = [
    ...String(body ?? '').matchAll(/<!--\s*badcase-registration\s*\n([\s\S]*?)-->/gu),
  ];
  if (matches.length !== 1)
    throw new Error('PR 必须包含且只包含一个 badcase-registration JSON 声明');
  return JSON.parse(matches[0][1]);
}

/** 允许追加来源和测试，不允许改写旧行为、移除断言或改为 excluded。 */
function preserves(before, after) {
  if (nonempty(before?.layer) && before.status === 'pending' && after?.status === 'verified')
    return preserves({ ...before, status: 'verified' }, after);
  if (Array.isArray(before))
    return (
      Array.isArray(after) && before.every((item) => after.some((next) => preserves(item, next)))
    );
  if (before && typeof before === 'object')
    return (
      after &&
      typeof after === 'object' &&
      Object.keys(before).every((key) => preserves(before[key], after[key]))
    );
  return isDeepStrictEqual(before, after);
}

export function assertBadcaseRegistration({
  historical,
  registry,
  baseHistorical,
  baseRegistry,
  declaration,
}) {
  historicalRegressionEntries(historical);
  const historicalCases = historical.issues.flatMap((issue) =>
    issue.cases.map((item) => ({
      ...item,
      sources: [`https://github.com/${historical.inventory.repository}/issues/${issue.number}`],
    })),
  );
  workflowRegressionEntries(
    registry,
    historicalCases.map((item) => item.id),
  );
  if (baseHistorical && !isDeepStrictEqual(baseHistorical, historical))
    throw new Error('历史清单已冻结，不得删除、改写或新增排除；请使用增量 badcase 清单');
  if (baseRegistry) {
    workflowRegressionEntries(
      baseRegistry,
      historicalCases.map((item) => item.id),
    );
    if (!preserves(baseRegistry, registry))
      throw new Error('badcase 清单相对基线缩减或改写了已有行为、来源或测试');
  }
  if (declaration === undefined) return;
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration))
    throw new Error('PR 声明必须是 JSON 对象');
  if (!Array.isArray(declaration.fixes)) throw new Error('PR 声明缺少 fixes 数组');
  if (declaration.status === 'no-user-behavior-fix') {
    if (!nonempty(declaration.reason) || declaration.fixes.length)
      throw new Error('无用户行为修复的 PR 必须说明原因，且 fixes 为空');
    return;
  }
  if (declaration.status !== 'fixes' || !declaration.fixes.length)
    throw new Error('PR 必须声明 fixes 或 no-user-behavior-fix');
  const cases = new Map([...historicalCases, ...registry.cases].map((item) => [item.id, item]));
  const seen = new Set();
  for (const fix of declaration.fixes) {
    if (
      !validSource(fix.source) ||
      !nonempty(fix.behavior) ||
      !Array.isArray(fix.caseIds) ||
      !fix.caseIds.length
    )
      throw new Error('每项修复必须有 source、具体 behavior 和非空 caseIds');
    const key = `${fix.source}\0${fix.behavior}`;
    if (seen.has(key) || new Set(fix.caseIds).size !== fix.caseIds.length)
      throw new Error('PR 修复或 caseIds 重复；相同行为应复用一个登记');
    seen.add(key);
    for (const id of fix.caseIds) {
      const item = cases.get(id);
      if (item?.additionalAcceptance?.some((acceptance) => acceptance.status !== 'verified'))
        throw new Error(`修复的附加验收仍待完成：${id}`);
      if (
        !item ||
        item.status === 'excluded' ||
        !item.tests?.length ||
        !item.sources.includes(fix.source)
      )
        throw new Error(`修复未映射到同来源的有效 badcase：${id}`);
    }
  }
}

export function readBaseRegistry(repositoryRoot, base, file, optional = false) {
  if (!/^[0-9a-f]{40}$/u.test(base)) throw new Error('比较基线必须是完整的 Git commit SHA');
  // 先验证基线可读，不能把缺失提交误当成首次引入清单。
  execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
  const files = execFileSync('git', ['ls-tree', '--name-only', base, '--', file], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (!files.trim()) {
    if (optional) return undefined;
    throw new Error(`比较基线缺少 ${file}`);
  }
  return JSON.parse(
    execFileSync('git', ['show', `${base}:${file}`], { cwd: repositoryRoot, encoding: 'utf8' }),
  );
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let base = env.BADCASE_BASE_SHA;
  let declaration;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && argv[index + 1]) base = argv[++index];
    else if (argv[index] === '--pr-body' && argv[index + 1])
      declaration = parseBadcaseDeclaration(readFileSync(argv[++index], 'utf8'));
    else throw new Error(`未知或不完整的参数：${argv[index]}`);
  }
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    declaration = parseBadcaseDeclaration(event.pull_request?.body);
    base = event.pull_request?.base?.sha;
  }
  if (!base || /^0+$/u.test(base)) throw new Error('缺少有效比较基线，请传入 --base <完整 SHA>');
  assertBadcaseRegistration({
    historical: JSON.parse(readFileSync(path.join(root, HISTORICAL_REGISTRY), 'utf8')),
    registry: JSON.parse(readFileSync(path.join(root, WORKFLOW_REGISTRY), 'utf8')),
    baseHistorical: readBaseRegistry(root, base, HISTORICAL_REGISTRY, true),
    baseRegistry: readBaseRegistry(root, base, WORKFLOW_REGISTRY, true),
    declaration,
  });
  console.log('badcase 登记及基线保留检查通过；声明是否完整、断言是否覆盖真实行为仍需审查。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
