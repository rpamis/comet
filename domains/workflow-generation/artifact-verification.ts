import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  runtimeDependencyPermissions,
  splitNodePermissionArguments,
} from '../../platform/process/runtime-dependency-permissions.js';
import { spawn } from 'node:child_process';
import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import type { WorkflowApplicationPlan } from './compiler.js';
import { inspectWorkflowApplicationPackage } from '../workflow-application/index.js';

export interface ApplicationArtifactTestCase {
  workflowId: string;
  stepId: string;
  input?: RuntimeValue;
  activation?: RuntimeValue;
  state?: RuntimeValue;
  output: RuntimeValue;
  files: Readonly<Record<string, string>>;
  invalidCases?: readonly {
    name: string;
    output?: RuntimeValue;
    files: Readonly<Record<string, string>>;
  }[];
}
export interface ApplicationArtifactVerification {
  schema: 'comet.workflow.artifact-verification.v1';
  packageHash: string;
  contractsHash: string;
  checks: { workflowId: string; stepId: string; name: string; accepted: boolean }[];
  workflowChecks?: { workflowId: string; status: 'completed'; childRuns: number }[];
  workflowTestsHash?: string;
}
/** 仅在隔离项目中调用固定测试模块；审批与宿主结果使用样例，不调用真实模型。 */
export interface ApplicationWorkflowTestCase {
  workflowId: string;
  input: RuntimeValue;
  module: string;
  exportName: string;
}

export function assertWorkflowVerificationCases(
  plan: WorkflowApplicationPlan,
  required = false,
): void {
  const tests = plan.workflowTests ?? [];
  const seen = new Set<string>();
  if (tests.length > 32) throw new Error('完整流程验收样例超过上限');
  for (const test of tests) {
    if (
      plan.composition.kind !== 'standalone' ||
      plan.workflows.filter((w) => w.id === test.workflowId).length !== 1 ||
      seen.has(test.workflowId) ||
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/u.test(test.module) ||
      !Object.hasOwn(plan.modules, test.module) ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(test.exportName)
    )
      throw new Error(`完整流程验收样例无效：${test.workflowId}`);
    seen.add(test.workflowId);
  }
  if (required && plan.composition.kind === 'standalone') {
    if (!tests.length)
      throw new Error(
        '独立组合缺少完整流程验收样例；在 workflowTests 声明 workflowId、input、module、exportName。',
      );
    const children = new Set(
      plan.workflows.flatMap((w) =>
        Object.values(w.steps).flatMap((s) => (s.type === 'child_workflow' ? [s.workflow.id] : [])),
      ),
    );
    for (const workflow of plan.workflows)
      if (!children.has(workflow.id) && !seen.has(workflow.id))
        throw new Error(
          `独立组合缺少完整流程验收样例：${workflow.id}；在 workflowTests 声明 workflowId、input、module、exportName，测试模块推进真实 SDK Run 到完成。`,
        );
  }
}
export function assertArtifactVerificationCases(plan: WorkflowApplicationPlan): void {
  const contracts = plan.manifest.artifactContracts ?? [];
  const tests = plan.artifactTests ?? [];
  const seen = new Set<string>();
  if (tests.length > 256) throw new Error('产物验收样例超过上限');
  for (const test of tests) {
    const key = `${test.workflowId}/${test.stepId}`;
    if (
      seen.has(key) ||
      !contracts.some(
        (c) => c.workflowId === test.workflowId && c.stepId === test.stepId && c.artifacts.length,
      )
    )
      throw new Error(`产物验收样例重复或没有对应契约：${key}`);
    seen.add(key);
    if (
      !test.files ||
      typeof test.files !== 'object' ||
      Array.isArray(test.files) ||
      Object.values(test.files).some((text) => typeof text !== 'string') ||
      Object.values(test.files).reduce((sum, text) => sum + Buffer.byteLength(text), 0) >
        2 * 1024 * 1024
    )
      throw new Error(`产物正常样例无效：${key}`);
    const step = plan.workflows.find((w) => w.id === test.workflowId)?.steps[test.stepId];
    if (step?.validator && !test.invalidCases?.length)
      throw new Error(`业务验证器需要至少一个异常样例：${key}`);
    if (
      test.invalidCases !== undefined &&
      (!Array.isArray(test.invalidCases) || test.invalidCases.length > 64)
    )
      throw new Error(`业务异常样例超过上限：${key}`);
    const names = new Set<string>(['valid']);
    for (const invalid of test.invalidCases ?? []) {
      if (
        typeof invalid.name !== 'string' ||
        !invalid.name.trim() ||
        names.has(invalid.name) ||
        /^(missing|empty|invalid-content|changed):/u.test(invalid.name) ||
        !invalid.files ||
        Array.isArray(invalid.files) ||
        Object.values(invalid.files).some((text) => typeof text !== 'string') ||
        Object.values(invalid.files).reduce<number>(
          (sum, source) => sum + (typeof source === 'string' ? Buffer.byteLength(source) : 0),
          0,
        ) >
          2 * 1024 * 1024
      )
        throw new Error(`业务异常样例无效：${key}`);
      names.add(invalid.name);
    }
  }
  for (const contract of contracts)
    if (contract.artifacts.length && !seen.has(`${contract.workflowId}/${contract.stepId}`))
      throw new Error(`必需产物缺少正常验收样例：${contract.workflowId}/${contract.stepId}`);
}

/** 固定包中的验证器在隔离项目和无凭据子进程内运行；失败不能跳过后安装。 */
export async function verifyWorkflowApplicationArtifactContracts(options: {
  file: string;
  plan: WorkflowApplicationPlan;
  packageHash: string;
}): Promise<ApplicationArtifactVerification> {
  assertArtifactVerificationCases(options.plan);
  assertWorkflowVerificationCases(options.plan);
  const assertPackage = async () => {
    if (
      (await inspectWorkflowApplicationPackage(path.dirname(options.file), options.packageHash))
        .status !== 'matched'
    )
      throw new Error('本地验收的固定包内容已变化');
  };
  await assertPackage();
  const manifest = JSON.parse(await fs.readFile(options.file, 'utf8'));
  if (
    hashRuntimeValue(manifest.artifactContracts ?? []) !==
    hashRuntimeValue(options.plan.manifest.artifactContracts ?? [])
  )
    throw new Error('阶段产物契约与固定包不匹配');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-artifact-verification-'));
  const request = path.join(root, 'request.json');
  try {
    await fs.writeFile(
      request,
      JSON.stringify({
        file: options.file,
        tests: options.plan.artifactTests ?? [],
        contracts: options.plan.manifest.artifactContracts ?? [],
        composition: options.plan.composition,
        workflowTests: options.plan.workflowTests ?? [],
        root,
        packageHash: options.packageHash,
      }),
    );
    let script = fileURLToPath(new URL('./artifact-verification-entry.js', import.meta.url));
    if (!existsSync(script))
      script = path.resolve(
        path.dirname(script),
        '../../dist/domains/workflow-generation/artifact-verification-entry.js',
      );
    const sdkRoot = path.resolve(path.dirname(script), '../../..');
    const permission = process.allowedNodeEnvironmentFlags.has('--permission')
      ? '--permission'
      : '--experimental-permission';
    const dependencies = runtimeDependencyPermissions(sdkRoot);
    const preload = path.join(root, 'dependency-resolution.mjs');
    await fs.writeFile(preload, dependencies.preloadSource);
    const readRoots = [
      root,
      path.dirname(options.file),
      path.join(sdkRoot, 'dist'),
      ...dependencies.readRoots,
      path.join(sdkRoot, 'assets'),
      path.join(sdkRoot, 'package.json'),
    ];
    const { args, nodeOptions } = splitNodePermissionArguments(readRoots, [
      permission,
      `--allow-fs-write=${root}`,
      '--import',
      pathToFileURL(preload).href,
      script,
      request,
    ]);
    const env: Record<string, string> = {
      COMET_DATA_DIR: path.join(root, 'data'),
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      COMET_RUNTIME_DAEMON: '0',
      NODE_OPTIONS: nodeOptions,
    };
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP'])
      if (process.env[key]) env[key] = process.env[key]!;
    const report = await new Promise<ApplicationArtifactVerification>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '',
        settled = false;
      let stopped: Error | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error('产物验收子进程没有返回有效报告'));
          }
        }
      };
      const timer = setTimeout(() => {
        stopped = new Error('产物验收超过60秒；修订检查或样例后继续原Creator动作');
        child.kill();
      }, 60000);
      child.stdout.on('data', (bytes) => {
        stdout += bytes;
        if (stdout.length > 1024 * 1024) {
          stopped = new Error('产物验收报告超过上限');
          child.kill();
        }
      });
      child.stderr.on('data', (bytes) => {
        stderr = (stderr + bytes).slice(-8192);
      });
      child.on('error', (error) => finish(error));
      child.on('close', (code) =>
        finish(
          stopped ??
            (code === 0
              ? undefined
              : new Error(`产物验收失败：${stderr.trim() || `exit ${code}`}`)),
        ),
      );
    });
    if (
      report.schema !== 'comet.workflow.artifact-verification.v1' ||
      report.packageHash !== options.packageHash ||
      report.contractsHash !== hashRuntimeValue(options.plan.manifest.artifactContracts ?? []) ||
      !Array.isArray(report.checks) ||
      report.checks.some((check) => check.accepted !== (check.name === 'valid'))
    )
      throw new Error('阶段产物验收报告与当前固定包或反例结果不匹配');
    const workflowTests = options.plan.workflowTests ?? [];
    if (
      (report.workflowChecks ?? []).length !== workflowTests.length ||
      (workflowTests.length > 0 && report.workflowTestsHash !== hashRuntimeValue(workflowTests)) ||
      workflowTests.some(
        (test) =>
          !(report.workflowChecks ?? []).some(
            (check) =>
              check.workflowId === test.workflowId &&
              check.status === 'completed' &&
              Number.isInteger(check.childRuns) &&
              check.childRuns >= 0,
          ),
      )
    )
      throw new Error('完整流程验收报告缺失或未完成');
    const expected = new Set<string>();
    for (const test of options.plan.artifactTests ?? []) {
      const add = (name: string) =>
        expected.add(JSON.stringify([test.workflowId, test.stepId, name]));
      add('valid');
      const contract = options.plan.manifest.artifactContracts!.find(
        (c) => c.workflowId === test.workflowId && c.stepId === test.stepId,
      )!;
      for (const artifact of contract.artifacts) {
        const ref =
          artifact.ref ??
          artifact
            .refFrom!.split('.')
            .reduce<unknown>(
              (value, key) =>
                value && typeof value === 'object'
                  ? (value as Record<string, unknown>)[key]
                  : undefined,
              test.output,
            );
        add(`missing:${ref}`);
        add(`changed:${ref}`);
        if (artifact.nonEmpty !== false) add(`empty:${ref}`);
        if (
          artifact.schema !== undefined ||
          artifact.requiredText?.length ||
          artifact.requiredHeadings?.length
        )
          add(`invalid-content:${ref}`);
      }
      for (const invalid of test.invalidCases ?? []) add(invalid.name);
    }
    if (
      report.checks.length !== expected.size ||
      report.checks.some(
        (c) => !expected.delete(JSON.stringify([c.workflowId, c.stepId, c.name])),
      ) ||
      expected.size
    )
      throw new Error('阶段产物验收缺少或重复正常及异常样例结果');
    await assertPackage();
    return report;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
