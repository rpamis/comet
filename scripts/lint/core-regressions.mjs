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
    invariant: '跨会话不误拒绝，实际输入变化与不完整证据不能放行。',
    files: [
      'test/domains/comet-native/native-sdk-verification-inputs.test.ts',
      'test/domains/comet-native/native-check-input-fingerprint.test.ts',
    ],
    requiredNames: [
      'completes Archive',
      'rejects source-changing checks',
      '0.5.0',
      'keeps nested linked worktrees outside the complete project input boundary',
    ],
  },
  {
    id: 'classic-continuity',
    issues: [],
    invariant: '三种 Classic 流程可重开验证并完成交付，命令身份与批准文档仍受保护。',
    files: ['test/domains/comet-classic/classic-sdk-verify-rounds.test.ts'],
    testNamePattern:
      'Runtime lifecycle|newly selected PATH command|recovers only accepted Build document',
    requiredNames: [
      'source Runtime lifecycle',
      'generated Runtime lifecycle',
      'newly selected PATH command',
      'recovers only accepted Build document',
    ],
    minimumPassed: 9,
  },
  {
    id: 'classic-check-policy',
    issues: [502],
    invariant: '项目超时与 CLI 覆盖一致；只排除明确输出，显式声明的 ignored 输入仍绑定。',
    files: [
      'test/domains/comet-classic/classic-check-defaults.test.ts',
      'test/domains/workflow-contract/classic-check-timeout.test.ts',
    ],
    requiredNames: [
      'applies project timeout',
      'override the project default',
      'includes ignored files',
    ],
  },
  {
    id: 'classic-composed-timeout',
    issues: [502],
    invariant: '通过公开工厂组合的 Classic SDK 应用采用相同项目超时契约。',
    files: ['test/domains/comet-classic/classic-application.test.ts'],
    testNamePattern: 'project default timeout',
    requiredNames: ['project default timeout'],
    minimumPassed: 3,
  },
  {
    id: 'classic-delivery-scope',
    issues: [503],
    invariant: '交付只包含批准范围，允许线性多提交，不携带其他 change 的草稿。',
    files: [
      'test/domains/comet-classic/classic-sdk-delivery-scope.test.ts',
      'test/domains/comet-classic/classic-sdk-delivery-inputs.test.ts',
      'test/domains/comet-classic/classic-sdk-archive-legacy-manifest.test.ts',
      'test/domains/comet-classic/classic-sdk-delivery-checkpoint.test.ts',
    ],
    requiredNames: [
      'keeps parked Native',
      'documented delivery --verify',
      'linear approved commit range',
      'includes staged deletions',
      'declared directory no longer exists',
      'changes after Archive execution without claiming or replaying delivery',
      'actual OpenSpec delta synchronization output',
      'archived proposal through a freshly bundled public runtime',
      'restores the original archive manifest',
      'portable archive evidence',
      'manifest symlink',
      'unapproved archived requirements even when a later commit',
      'keeps the committed archive checkpoint',
      'rejects changed archived checkpoint',
      'restores only the portable archived baseline',
      'interrupted delivery is reconciled',
      'active-source history',
      'deleted-source commit history',
      'revalidates a portable historical archive outcome',
    ],
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
    invariant: '辅助计划更新保留批准，正式差异需复核，Hook 不得分叉 SDK 状态。',
    files: ['test/domains/comet-native/native-shape-incremental.test.ts'],
    requiredNames: [
      'keeps SDK Run and projection identical when Hook detects formal drift',
      'preserves SDK and Compat Shape for approved test-plan line updates',
      'rejects requirement changes and undeclared auxiliary edits',
      'reviews formal comments without replacing the SDK candidate or Verifier claim',
      'upgrades a restored 0.5.0 Run through spec snapshot',
      'rejects tampered original snapshot bytes',
      'preserves a legacy Verify candidate gate',
      'requires review when the same formal comment moves across',
    ],
  },
  {
    id: 'native-acceptance-boundaries',
    issues: [504],
    invariant: 'Markdown 章节与列表项有独立边界；真正的批准内容变更仍需重新确认。',
    files: ['test/domains/comet-native/native-acceptance-boundaries.test.ts'],
    requiredNames: [
      'does not append a later block',
      'retains nested criterion',
      'original full approval fingerprint',
    ],
  },
  {
    id: 'native-blocked-recovery',
    issues: [505],
    invariant: '公布的恢复命令可在公布状态执行，复验保留有效证据但拒绝过期批准。',
    files: [
      'test/domains/comet-native/native-sdk-blocked-recovery.test.ts',
      'test/domains/engine/runtime-wait-reason.test.ts',
      'test/app/runtime-wait-reason.test.ts',
    ],
    requiredNames: [
      'exact advertised',
      'retains candidate and one-shot',
      'rejects stale proposal',
      'existing 0.5.0 blocked Run',
      'current Supervisor Child blocked repair',
      'advertises executable repair',
      'offers only executable decisions after recovered one-shot checks pass',
      'uses only the current ordinary candidate retry capability after leaving Supervisor',
    ],
  },
];

export const CORE_REGRESSIONS = mergeHistoricalRegressions(CURRENT_CORE_REGRESSIONS, [
  ...loadHistoricalRegressions(repositoryRoot),
  ...loadWorkflowRegressions(repositoryRoot),
]);

export function selectCoreRegressions(selectors = []) {
  if (!selectors.length) return [...CORE_REGRESSIONS];
  const selected = new Set();
  for (const selector of selectors) {
    const matches = CORE_REGRESSIONS.filter(
      (entry) =>
        entry.id === selector ||
        entry.caseIds?.includes(selector) ||
        entry.issues.some((issue) => String(issue) === selector),
    );
    if (!matches.length) throw new Error(`Unknown core regression: ${selector}`);
    matches.forEach((entry) => selected.add(entry));
  }
  return [...selected];
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

async function main(argv) {
  const selectors = [];
  let list = false;
  let recordPlatform;
  let recordAll;
  let verifyEvidence;
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
    else if (argv[index] === '--case' && argv[index + 1]) selectors.push(argv[++index]);
    else if (argv[index] === '--record-platform' && argv[index + 1]) recordPlatform = argv[++index];
    else if (argv[index] === '--record-all' && argv[index + 1]) recordAll = argv[++index];
    else if (argv[index] === '--verify-evidence' && argv[index + 1]) verifyEvidence = argv[++index];
    else if (argv[index] === '--cross-platform') crossPlatform = true;
    else if (argv[index] === '--combine-platform-evidence') combinePlatforms = true;
    else if (argv[index] === '--platform-record' && argv[index + 1])
      platformFiles.push(argv[++index]);
    else if (crossArguments[argv[index]] && argv[index + 1])
      crossOptions[crossArguments[argv[index]]] = argv[++index];
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  const entries = selectCoreRegressions(selectors);
  if (
    [recordPlatform, recordAll, verifyEvidence, crossPlatform, combinePlatforms].filter(Boolean)
      .length > 1 ||
    ([recordPlatform, recordAll, verifyEvidence, crossPlatform, combinePlatforms].some(Boolean) &&
      (list || selectors.length))
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
      { groups: entries.length, passed: entries.length - failures.length, tests: total, failures },
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
