import { loadWorkflowRegressions } from './workflow-regressions.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadHistoricalRegressions,
  mergeHistoricalRegressions,
} from './historical-regressions.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

// 每组同时保存历史故障和不能被修复削弱的正反向约束。
const CURRENT_CORE_REGRESSIONS = [
  {
    id: 'native-check-evidence',
    issues: [500, 501],
    invariant: '普通编辑由 Agent 判断，检查保留真实结果及原执行；失败不得按成功归档。',
    files: ['test/domains/comet-native/native-agent-content-judgment.test.ts'],
    requiredNames: [
      'continues Native Verify and Archive through the generated Runtime without content proof',
      'keeps an actual Agent-platform failure report failed after file edits without replay',
      'blocks Native Archive when a new real check fails after an accepted pass',
      'continues the original Native Run through a generated Runtime and parent directory alias',
      'preserves an Agent-selected prior report for a repaired candidate and requires full new verification',
    ],
    testNamePattern:
      'continues Native Verify and Archive through the generated Runtime without content proof|keeps an actual Agent-platform failure report failed after file edits without replay|blocks Native Archive when a new real check fails after an accepted pass|continues the original Native Run through a generated Runtime and parent directory alias|preserves an Agent-selected prior report for a repaired candidate and requires full new verification',
  },
  {
    id: 'classic-continuity',
    issues: [],
    invariant: 'Classic full/hotfix/tweak 编辑后沿原 Run 验收及归档，真实失败继续阻止交付。',
    files: ['test/domains/comet-classic/classic-agent-content-judgment.test.ts'],
    testNamePattern:
      'continues the same Classic full Verify and Archive through the generated Runtime without content proof|continues the same Classic hotfix Verify and Archive through the generated Runtime without content proof|continues the same Classic tweak Verify and Archive through the generated Runtime without content proof|blocks Classic Archive when a new real check fails after an accepted pass',
    requiredNames: [
      'continues the same Classic full Verify and Archive through the generated Runtime without content proof',
      'continues the same Classic hotfix Verify and Archive through the generated Runtime without content proof',
      'continues the same Classic tweak Verify and Archive through the generated Runtime without content proof',
      'blocks Classic Archive when a new real check fails after an accepted pass',
    ],
  },
  {
    id: 'classic-check-policy',
    issues: [502],
    invariant: '普通检查交给 Agent 平台，旧命令不执行或补造成功；CLI 自有任务保留独立时限清理。',
    files: [
      'test/domains/comet-classic/classic-platform-command.test.ts',
      'test/platform/process/owned-command-termination.test.ts',
    ],
    requiredNames: [
      'routes a legacy check invocation to platform work without executing it or claiming a pass',
      'keeps its deadline when the owner event loop cannot run its timeout timer',
    ],
    testNamePattern:
      'routes a legacy check invocation to platform work without executing it or claiming a pass|keeps its deadline when the owner event loop cannot run its timeout timer',
  },
  {
    id: 'classic-composed-timeout',
    issues: [502],
    invariant: '组合 Classic 应用沿原任务接受平台检查报告，失败或陈旧结果不得推进 Build。',
    files: ['test/domains/comet-classic/classic-application.test.ts'],
    testNamePattern:
      'keeps composed Build work on platform reports without a managed check Action|keeps an actual failed platform command from satisfying composed Build acceptance|binds composed work to its original Action input and rejects a stale claim or outcome',
    requiredNames: [
      'keeps composed Build work on platform reports without a managed check Action',
      'keeps an actual failed platform command from satisfying composed Build acceptance',
      'binds composed work to its original Action input and rejects a stale claim or outcome',
    ],
    minimumPassed: 3,
  },
  {
    id: 'classic-delivery-scope',
    issues: [503],
    invariant: '交付保留原批准的路径范围、线性多提交与原归档进度，不携带其他 change 的草稿。',
    files: ['test/domains/comet-classic/classic-sdk-delivery-scope.test.ts'],
    requiredNames: [
      'keeps parked Native',
      'linear approved commit range',
      'portable archive evidence',
      'Agent-accepted edits through a parent alias',
      'recovers Archive interrupted after moving',
    ],
    testNamePattern:
      'keeps parked Native|linear approved commit range|portable archive evidence|Agent-accepted edits through a parent alias|recovers Archive interrupted after moving',
  },
  {
    id: 'entry-resume-intent',
    issues: [],
    invariant: '明确拒绝和仅提交代码的范围优先，不误恢复或创建工作流。',
    files: ['test/domains/comet-entry/resume-probe-intent.test.ts'],
    requiredNames: [
      'gives explicit exclusions precedence over resume keywords',
      'does not infer commit ownership',
      'preserves explicit resume and commit targets',
      'does not create or advance Native Runs or tool actions',
      'commit-only probes with no active Native change',
    ],
  },
  {
    id: 'hook-physical-targets',
    issues: [295],
    invariant: '允许目录不授予保留根别名权限，悬空链接及循环也必须按物理目标判定。',
    files: [
      'test/domains/comet-entry/hook-allow-path-symlinks.test.ts',
      'test/domains/workflow-contract/hook-target-scope.test.ts',
    ],
    requiredNames: [
      'without confusing ownership',
      'before deciding the Hook allowance',
      'link chain without hanging',
      'keeps physical parent traversal in the raw Hook',
      'preserves a normal parent traversal to a missing',
      'keeps missing project files in scope',
    ],
  },
  {
    id: 'native-shape-incremental',
    issues: [504],
    invariant: '正式材料编辑不自动撤回批准；Agent 判断实际需求变化，原用户决定和独立验收继续保留。',
    files: ['test/domains/comet-native/native-agent-content-judgment.test.ts'],
    requiredNames: [
      'continues Native Verify and Archive through the generated Runtime without content proof',
      'keeps an actual Agent-platform failure report failed after file edits without replay',
      'blocks Native Archive when a new real check fails after an accepted pass',
      'continues the original Native Run through a generated Runtime and parent directory alias',
      'preserves an Agent-selected prior report for a repaired candidate and requires full new verification',
    ],
    testNamePattern:
      'continues Native Verify and Archive through the generated Runtime without content proof|keeps an actual Agent-platform failure report failed after file edits without replay|blocks Native Archive when a new real check fails after an accepted pass|continues the original Native Run through a generated Runtime and parent directory alias|preserves an Agent-selected prior report for a repaired candidate and requires full new verification',
  },
  {
    id: 'native-acceptance-boundaries',
    issues: [504],
    invariant: 'Markdown 章节和列表项保持独立验收边界。',
    files: ['test/domains/comet-native/native-acceptance-boundaries.test.ts'],
    requiredNames: ['does not append a later block', 'retains nested criterion'],
    testNamePattern: 'does not append a later block|retains nested criterion',
  },
  {
    id: 'native-blocked-recovery',
    issues: [505],
    invariant: '公布的恢复命令沿原 Run 执行，保留原检查和验收归属并拒绝陈旧 SDK 提案。',
    files: ['test/domains/comet-native/native-sdk-blocked-recovery.test.ts'],
    requiredNames: [
      'exact advertised',
      'retains candidate and one-shot',
      'rejects stale proposal',
      'current Supervisor Child blocked repair',
      'offers only executable decisions after recovered one-shot checks pass',
      'uses only the current ordinary candidate retry capability after leaving Supervisor',
    ],
    testNamePattern:
      'exact advertised|retains candidate and one-shot|rejects stale proposal|current Supervisor Child blocked repair|offers only executable decisions after recovered one-shot checks pass|uses only the current ordinary candidate retry capability after leaving Supervisor',
  },
  {
    id: 'classic-check-timeout-config',
    caseIds: ['classic-check-policy'],
    issues: [502],
    invariant: '配置解析和生成校验采用相同超时范围。',
    files: ['test/domains/workflow-contract/classic-check-timeout.test.ts'],
    requiredNames: ['validates and preserves check_timeout_ms', 'rejects invalid check_timeout_ms'],
  },
  {
    id: 'runtime-decision-reason',
    caseIds: ['native-blocked-recovery'],
    issues: [505],
    invariant: '原SDK决定的原因持久化并拒绝陈旧提案。',
    files: ['test/domains/engine/runtime-wait-reason.test.ts'],
    requiredNames: ['persists a bounded reason', 'does not save a reason on a stale proposal'],
  },
  {
    id: 'runtime-resolve-wait-reason',
    caseIds: ['native-blocked-recovery'],
    issues: [505],
    invariant: '公开Runtime决定请求保留有界文本原因和恢复身份。',
    files: ['test/app/runtime-wait-reason.test.ts'],
    requiredNames: ['accepts a reason only as bounded text'],
  },
];

export const CORE_REGRESSIONS = mergeHistoricalRegressions(
  mergeHistoricalRegressions(
    [],
    CURRENT_CORE_REGRESSIONS.map((entry) => ({
      ...entry,
      caseIds: [...(entry.caseIds ?? []), entry.id],
    })),
  ),
  [...loadHistoricalRegressions(repositoryRoot), ...loadWorkflowRegressions(repositoryRoot)],
);

export function selectCoreRegressions(selectors = [], shard) {
  const selected = new Set(selectors.length ? [] : CORE_REGRESSIONS);
  for (const selector of selectors) {
    const matches = CORE_REGRESSIONS.filter(
      (entry) =>
        entry.id === selector ||
        entry.caseIds?.includes(selector) ||
        entry.caseIds?.some((id) => `registered-${id}` === selector) ||
        entry.issues.some((issue) => String(issue) === selector),
    );
    if (!matches.length) throw new Error(`Unknown core regression: ${selector}`);
    matches.forEach((entry) => selected.add(entry));
  }
  const entries = [...selected];
  if (shard === undefined) return entries;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(shard);
  const index = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    index > count ||
    count > entries.length
  )
    throw new Error(
      'Invalid core regression shard: expected index/count with a non-empty assignment',
    );
  return entries.filter((_, position) => position % count === index - 1);
}

export function coreRegressionArgs(entry, reportFile) {
  return [
    'run',
    ...entry.files,
    ...(entry.testNamePattern ? ['--testNamePattern', entry.testNamePattern] : []),
    '--maxWorkers=2',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${reportFile}`,
  ];
}

export function assertCoreRegressionResult(entry, report, context = {}) {
  const platform = context.platform ?? process.platform;
  if (!['win32', 'linux', 'darwin'].includes(platform))
    throw new Error(`${entry.id}: unsupported report platform`);
  const reportPath = platform === 'win32' ? path.win32 : path.posix;
  const projectRoot = context.projectRoot ?? repositoryRoot;
  if (!reportPath.isAbsolute(projectRoot))
    throw new Error(`${entry.id}: report project root must be absolute`);
  const assertions = (report.testResults ?? []).flatMap((file) => file.assertionResults ?? []);
  const passed = assertions.filter((test) => test.status === 'passed');
  if (
    report.success !== true ||
    report.numFailedTests !== 0 ||
    (report.numFailedTestSuites ?? 0) !== 0 ||
    (report.numRuntimeErrorTestSuites ?? 0) !== 0 ||
    passed.length < (entry.minimumPassed ?? 1)
  ) {
    throw new Error(`${entry.id}: failed, incomplete, or empty regression result`);
  }
  for (const name of entry.requiredNames) {
    if (!passed.some((test) => String(test.fullName ?? test.title).includes(name)))
      throw new Error(`${entry.id}: required regression did not pass: ${name}`);
  }
  for (const required of entry.requiredCases ?? []) {
    const normalize = (value) => {
      if (!reportPath.isAbsolute(value)) return null;
      const resolved = reportPath.normalize(value).replaceAll('\\', '/');
      return platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const file = (report.testResults ?? []).find(
      (result) =>
        typeof result.name === 'string' &&
        normalize(result.name) === normalize(reportPath.join(projectRoot, required.file)),
    );
    const matches = (file?.assertionResults ?? []).filter((test) =>
      required.exact
        ? String(test.fullName ?? test.title) === required.name
        : String(test.fullName ?? test.title).includes(required.name),
    );
    const valid = required.exact
      ? matches.length === 1 && matches[0].status === 'passed'
      : !matches.some(
          (test) =>
            String(test.fullName ?? test.title) === required.name && test.status !== 'passed',
        ) &&
        matches.some(
          (test) =>
            test.status === 'passed' &&
            matches.every(
              (other) =>
                String(other.fullName ?? other.title) !== String(test.fullName ?? test.title) ||
                other.status === 'passed',
            ),
        );
    if (!valid)
      throw new Error(
        `${entry.id}: required file regression did not pass: ${required.file}: ${required.name}`,
      );
  }
  return passed.length;
}

/** Validate every registered requirement against one completed Vitest run, without rerunning tests. */
export function assertCoreRegressionReport(entries, report, context = {}) {
  const reportPath = (context.platform ?? process.platform) === 'win32' ? path.win32 : path.posix;
  const normalize = (file) => {
    const value = reportPath.normalize(file).replaceAll('\\', '/');
    return (context.platform ?? process.platform) === 'win32' ? value.toLowerCase() : value;
  };
  for (const entry of entries) {
    const files = new Set(
      entry.files.map((file) =>
        normalize(reportPath.join(context.projectRoot ?? repositoryRoot, file)),
      ),
    );
    const pattern = entry.testNamePattern ? new RegExp(entry.testNamePattern) : null;
    const testResults = (report.testResults ?? [])
      .filter((file) => files.has(normalize(file.name)))
      .map((file) => ({
        ...file,
        assertionResults: (file.assertionResults ?? []).filter(
          (test) => !pattern || pattern.test(String(test.fullName ?? test.title)),
        ),
      }));
    assertCoreRegressionResult(entry, { ...report, testResults }, context);
  }
  return { groups: entries.length };
}

async function main(argv) {
  const selectors = [];
  let list = false;
  let shard;
  let recordPlatform;
  let recordAll;
  let verifyEvidence;
  let verifyReport;
  let crossPlatform = false;
  let combinePlatforms = false;
  const platformFiles = [];
  const crossOptions = {};
  const crossArguments = {
    '--linux-image': 'linuxImage',
    '--linux-node-modules': 'linuxNodeModules',
    '--linux-venv': 'linuxVenv',
    '--output': 'outputFile',
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--list') list = true;
    else if (argv[index] === '--shard' && argv[index + 1]) shard = argv[++index];
    else if (argv[index].startsWith('--shard=')) shard = argv[index].slice('--shard='.length);
    else if (argv[index] === '--case' && argv[index + 1]) selectors.push(argv[++index]);
    else if (argv[index] === '--record-platform' && argv[index + 1]) recordPlatform = argv[++index];
    else if (argv[index] === '--record-all' && argv[index + 1]) recordAll = argv[++index];
    else if (argv[index] === '--verify-evidence' && argv[index + 1]) verifyEvidence = argv[++index];
    else if (argv[index] === '--verify-report' && argv[index + 1]) verifyReport = argv[++index];
    else if (argv[index] === '--cross-platform') crossPlatform = true;
    else if (argv[index] === '--combine-platform-evidence') combinePlatforms = true;
    else if (argv[index] === '--platform-record' && argv[index + 1])
      platformFiles.push(argv[++index]);
    else if (crossArguments[argv[index]] && argv[index + 1])
      crossOptions[crossArguments[argv[index]]] = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  const entries = selectCoreRegressions(selectors, shard);
  if (verifyReport) {
    if (
      [
        list,
        shard,
        recordPlatform,
        recordAll,
        verifyEvidence,
        crossPlatform,
        combinePlatforms,
        platformFiles.length,
        Object.keys(crossOptions).length,
      ].some(Boolean)
    )
      throw new Error('Report verification cannot be combined with execution or evidence modes');
    const summary = assertCoreRegressionReport(
      entries,
      JSON.parse(readFileSync(verifyReport, 'utf8')),
    );
    console.log(
      `Core regressions verified from existing test report: ${summary.groups} groups; no tests rerun.`,
    );
    return;
  }
  if (
    [recordPlatform, recordAll, verifyEvidence, crossPlatform, combinePlatforms].filter(Boolean)
      .length > 1 ||
    ([recordPlatform, recordAll, verifyEvidence, crossPlatform, combinePlatforms].some(Boolean) &&
      (list || selectors.length || shard !== undefined))
  )
    throw new Error('Platform evidence must execute its complete assigned partition');
  if (Object.keys(crossOptions).length && !crossPlatform && !combinePlatforms)
    throw new Error('Linux runner arguments require --cross-platform');
  if (platformFiles.length && !combinePlatforms)
    throw new Error('Platform records require --combine-platform-evidence');
  if (
    combinePlatforms &&
    (platformFiles.length !== 2 ||
      !crossOptions.outputFile ||
      Object.keys(crossOptions).length !== 1)
  )
    throw new Error('CI evidence requires two complete platform records and an output file');
  if (
    crossPlatform &&
    !['linuxImage', 'linuxNodeModules', 'linuxVenv', 'outputFile'].every(
      (key) => typeof crossOptions[key] === 'string' && crossOptions[key],
    )
  )
    throw new Error(
      'Cross-platform regressions require a prepared Linux image, dependencies, virtual environment and output file',
    );
  if (list) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (verifyEvidence) {
    const { verifyCoreRegressionReceipt } = await import('./core-regression-evidence.mjs');
    const receipt = await verifyCoreRegressionReceipt(repositoryRoot, entries, verifyEvidence);
    console.log(
      JSON.stringify({
        evidenceHash: receipt.evidenceHash,
        groups: receipt.groups,
        tests: receipt.tests,
      }),
    );
    return;
  }
  const reports = path.join(repositoryRoot, 'coverage', 'core-regressions');
  const summaryFile = path.join(reports, 'summary.json');
  if (![combinePlatforms, crossPlatform, recordAll, recordPlatform].some(Boolean)) {
    mkdirSync(reports, { recursive: true });
    rmSync(summaryFile, { force: true });
  }
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Command failed (${result.signal ?? result.status}): ${args[0]}`);
  };
  // 不自动重建或忽略失效产物：开发者必须先构建将要交付的 Runtime。
  for (const name of ['runtime-schemas', 'classic-runtime', 'native-runtime', 'entry-runtime'])
    run([`scripts/build/build-${name}.mjs`, '--check']);
  if (combinePlatforms) {
    const { combineCoreRegressionPlatforms } = await import('./core-regression-evidence.mjs');
    const receipt = await combineCoreRegressionPlatforms(
      repositoryRoot,
      entries,
      platformFiles,
      crossOptions.outputFile,
    );
    console.log(
      `Core regressions verified: ${receipt.groups} complete groups from both CI platforms. Evidence: ${path.resolve(crossOptions.outputFile)}`,
    );
    return;
  }
  if (recordAll) {
    const { runSinglePlatformCoreRegressions } = await import('./core-regression-evidence.mjs');
    const receipt = await runSinglePlatformCoreRegressions(repositoryRoot, entries, recordAll);
    console.log(
      `Core regressions passed: ${receipt.groups} complete groups. Evidence: ${path.resolve(recordAll)}`,
    );
    return;
  }
  if (crossPlatform) {
    const { runCrossPlatformCoreRegressions } = await import('./core-regression-evidence.mjs');
    const evidence = await runCrossPlatformCoreRegressions(repositoryRoot, entries, crossOptions);
    console.log(
      `Core regressions passed: ${evidence.groups} groups, ${evidence.tests} executed tests across both platforms. Evidence: ${path.resolve(crossOptions.outputFile)}`,
    );
    return;
  }
  if (recordPlatform) {
    const { recordCoreRegressionPlatform } = await import('./core-regression-evidence.mjs');
    const record = await recordCoreRegressionPlatform(repositoryRoot, entries, recordPlatform);
    console.log(
      `Platform core regressions passed: ${record.platform}, ${record.groups.length} complete groups. The other platform is still required.`,
    );
    return;
  }
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  let total = 0;
  const failures = [];
  for (const entry of entries) {
    console.log(`\n${entry.id}: ${entry.invariant}`);
    const reportFile = path.join(reports, `${entry.id}.json`);
    try {
      rmSync(reportFile, { force: true });
      run([vitest, ...coreRegressionArgs(entry, reportFile)]);
      total += assertCoreRegressionResult(entry, JSON.parse(readFileSync(reportFile, 'utf8')));
    } catch (error) {
      // 继续执行后续组，一轮收齐问题；失败、缺失报告和跳过仍不能算通过。
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: entry.id, message });
      console.error(`${entry.id}: ${message}`);
    }
  }
  writeFileSync(
    summaryFile,
    JSON.stringify(
      {
        groups: entries.length,
        passed: entries.length - failures.length,
        tests: total,
        failures,
        ...(shard !== undefined ? { shard } : {}),
      },
      null,
      2,
    ) + '\n',
  );
  if (failures.length)
    throw new Error(
      `Core regressions failed: ${failures.length}/${entries.length} groups.\n${failures.map(({ id, message }) => `${id}: ${message}`).join('\n')}`,
    );
  console.log(`\nCore regressions passed: ${entries.length} groups, ${total} executed tests.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
