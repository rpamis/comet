#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function releaseOptions(args, env = process.env) {
  let regressionsOnly = false;
  let evalReport = env.COMET_RELEASE_EVAL_REPORT;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--regressions-only') regressionsOnly = true;
    else if (argument === '--eval-report' && args[index + 1] && !args[index + 1].startsWith('--'))
      evalReport = args[++index];
    else throw new Error(`不支持的发布检查参数：${argument}`);
  }
  if (regressionsOnly && evalReport)
    throw new Error('无模型回归检查不能同时声明完整 Eval 放行凭证。');
  if (!regressionsOnly && (typeof evalReport !== 'string' || !evalReport.trim()))
    throw new Error(
      '发布前必须提供当前候选的完整 Eval 凭证：--eval-report <release-gate.json>，或 COMET_RELEASE_EVAL_REPORT。仅检查无模型回归请使用 test:release-regressions；这不代表可以发布。',
    );
  return { regressionsOnly, evalReport: evalReport?.trim() };
}

export function releaseSteps(options, repositoryRoot = root) {
  const node = (label, args) => ({ label, command: process.execPath, args, cwd: repositoryRoot });
  const python = (label, args) => ({
    label,
    command: 'uv',
    args: ['run', '--locked', '--no-sync', '--no-python-downloads', 'python', ...args],
    cwd: path.join(repositoryRoot, 'eval'),
  });
  return [
    node('构建当前候选', ['build.js']),
    node('扫描实际构建后的发布文件', ['scripts/release/prepublish-check.js']),
    node('SDK API 兼容检查', ['scripts/release/check-sdk-api.mjs']),
    node('发布元数据与检查入口回归', [
      'node_modules/vitest/vitest.mjs',
      'run',
      'test/repository/release-metadata.test.ts',
      'test/scripts/core-regressions.test.ts',
      'test/scripts/historical-regressions.test.ts',
      'test/scripts/badcase-registration.test.ts',
      'test/scripts/verify-release.test.ts',
      '--maxWorkers=2',
    ]),
    node('核心历史故障回归', ['scripts/lint/core-regressions.mjs']),
    python('Eval 判定器无模型反例回归', [
      '-m',
      'pytest',
      '-q',
      'local/tests/scaffold/test_regression_check.py',
    ]),
    ...(!options.regressionsOnly
      ? [
          node('核对 badcase 附加验收', [
            'scripts/lint/workflow-regressions.mjs',
            '--require-acceptance',
          ]),
          python('核对当前候选完整 Eval 凭证', [
            'local/scripts/regression_check.py',
            '--verify-receipt',
            path.resolve(repositoryRoot, options.evalReport),
          ]),
        ]
      : []),
  ];
}

export function verifyRelease(options, run = spawnSync, repositoryRoot = root) {
  for (const step of releaseSteps(options, repositoryRoot)) {
    console.log(`\n${step.label}`);
    const result = run(step.command, step.args, { cwd: step.cwd, stdio: 'inherit', shell: false });
    if (result.error || result.status !== 0)
      throw new Error(
        `${step.label}未通过：${result.error?.message ?? result.signal ?? `退出码 ${result.status}`}。未完成的检查不能作为发布证据。`,
      );
  }
  console.log(
    options.regressionsOnly
      ? '无模型发布回归通过；尚未核对完整模型 Eval，不构成发布放行。'
      : '当前候选的核心回归和完整 Eval 凭证均已核对通过。',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyRelease(releaseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
