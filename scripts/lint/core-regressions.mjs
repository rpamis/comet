import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

// 每组同时保存历史故障和不能被修复削弱的正反向约束。
export const CORE_REGRESSIONS = [
  {
    id: 'native-check-evidence',
    issues: [500, 501],
    invariant: '跨会话不误拒绝，实际输入变化与不完整证据不能放行。',
    files: [
      'test/domains/comet-native/native-sdk-verification-inputs.test.ts',
      'test/domains/comet-native/native-check-input-fingerprint.test.ts',
    ],
    requiredNames: ['completes Archive', 'rejects source-changing checks', '0.5.0'],
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
    files: ['test/domains/comet-classic/classic-sdk-delivery-scope.test.ts'],
    requiredNames: [
      'keeps parked Native',
      'documented delivery --verify',
      'linear approved commit range',
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
    ],
  },
];

export function selectCoreRegressions(selectors = []) {
  if (!selectors.length) return [...CORE_REGRESSIONS];
  const selected = new Set();
  for (const selector of selectors) {
    const matches = CORE_REGRESSIONS.filter(
      (entry) => entry.id === selector || entry.issues.some((issue) => String(issue) === selector),
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

export function assertCoreRegressionResult(entry, report) {
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
  return passed.length;
}

function main(argv) {
  const selectors = [];
  let list = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--list') list = true;
    else if (argv[index] === '--case' && argv[index + 1]) selectors.push(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  const entries = selectCoreRegressions(selectors);
  if (list) {
    console.log(JSON.stringify(entries, null, 2));
    return;
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
  const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const reports = path.join(repositoryRoot, 'coverage', 'core-regressions');
  mkdirSync(reports, { recursive: true });
  let total = 0;
  for (const entry of entries) {
    console.log(`\n${entry.id}: ${entry.invariant}`);
    const reportFile = path.join(reports, `${entry.id}.json`);
    rmSync(reportFile, { force: true });
    run([vitest, ...coreRegressionArgs(entry, reportFile)]);
    total += assertCoreRegressionResult(entry, JSON.parse(readFileSync(reportFile, 'utf8')));
  }
  console.log(`\nCore regressions passed: ${entries.length} groups, ${total} executed tests.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
