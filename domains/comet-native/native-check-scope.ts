import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { hashRuntimeValue, type RuntimeValue } from '../engine/runtime.js';
import { hashProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { nativeCheckPlanKey, type NativeCheckPlan } from './native-check-executor.js';

/** Runtime 能确定完整读取范围的检查。普通 shell 命令不接受 Agent 自报的依赖范围。 */
export interface NativeCheckScope {
  schema: 'comet.native.check-scope.v1';
  kind: 'node-syntax';
  planKey: string;
  inputDigest: string;
  contextDigest: string;
  files: Array<{ path: string; digest: string | null }>;
}

function isNodeSyntaxPlan(plan: NativeCheckPlan): boolean {
  return (
    plan.repeatable &&
    path.isAbsolute(plan.executable) &&
    plan.argv.length === 2 &&
    ['--check', '-c'].includes(plan.argv[0]) &&
    /\.(?:mjs|cjs)$/u.test(plan.argv[1]) &&
    !plan.argv[1].startsWith('-')
  );
}

function syntaxSource(projectRoot: string, plan: NativeCheckPlan): string | null {
  if (!isNodeSyntaxPlan(plan) || plan.executable !== process.execPath) return null;
  const target = path.resolve(projectRoot, plan.cwdRef, plan.argv[1]);
  const relative = path.relative(projectRoot, target).replaceAll('\\', '/');
  return relative && !relative.startsWith('../') && !path.isAbsolute(relative) ? relative : null;
}

export function isNativeCheckScope(
  value: unknown,
  plan: NativeCheckPlan,
): value is NativeCheckScope {
  if (!isNodeSyntaxPlan(plan) || !value || typeof value !== 'object') return false;
  const scope = value as NativeCheckScope;
  return (
    scope.schema === 'comet.native.check-scope.v1' &&
    scope.kind === 'node-syntax' &&
    scope.planKey === nativeCheckPlanKey(plan) &&
    /^[a-f0-9]{64}$/u.test(scope.inputDigest) &&
    /^[a-f0-9]{64}$/u.test(scope.contextDigest) &&
    Array.isArray(scope.files) &&
    scope.files.length > 0 &&
    scope.files.every(
      (file) =>
        typeof file.path === 'string' &&
        (file.digest === null || /^[a-f0-9]{64}$/u.test(file.digest)),
    )
  );
}

export async function captureNativeCheckScope(options: {
  projectRoot: string;
  plan: NativeCheckPlan;
  contract: RuntimeValue;
}): Promise<NativeCheckScope | null> {
  const { projectRoot, plan } = options;
  const source = syntaxSource(projectRoot, plan);
  // NODE_OPTIONS 支持预加载代码；动态链接器也可加载任意代码。这些执行不具有单文件读取范围。
  if (
    !source ||
    Object.entries(process.env).some(([name, value]) => {
      const key = name.toUpperCase();
      return (
        value &&
        (/^(?:LD_|DYLD_)/u.test(key) ||
          (/^NODE_/u.test(key) &&
            !['NODE_ENV', 'NODE_PATH'].includes(key) &&
            !key.startsWith('NODE_REPL_')))
      );
    })
  )
    return null;
  try {
    const files: NativeCheckScope['files'] = [];
    files.push({
      path: source,
      digest: (
        await hashProtectedProjectFile(projectRoot, source, {
          label: 'Native syntax check input',
        })
      ).digest,
    });
    // 绑定祖先包声明以及声明的缺失，避免后续新增 package.json 改变解析条件。
    let directory = path.posix.dirname(source);
    while (true) {
      const ref = directory === '.' ? 'package.json' : `${directory}/package.json`;
      try {
        files.push({
          path: ref,
          digest: (
            await hashProtectedProjectFile(projectRoot, ref, {
              label: 'Native syntax package declaration',
            })
          ).digest,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        files.push({ path: ref, digest: null });
      }
      if (directory === '.') break;
      directory = path.posix.dirname(directory);
    }
    const executablePath = await fs.realpath(process.execPath);
    const executable = await hashProtectedProjectFile(
      path.dirname(executablePath),
      path.basename(executablePath),
      {
        label: 'Native syntax check executable',
      },
    );
    const planKey = nativeCheckPlanKey(plan);
    return {
      schema: 'comet.native.check-scope.v1',
      kind: 'node-syntax',
      planKey,
      files,
      inputDigest: hashRuntimeValue({
        projectRoot: path.resolve(projectRoot),
        contract: options.contract,
        files: files as unknown as RuntimeValue,
      }),
      contextDigest: hashRuntimeValue({
        planKey,
        executable: executable.digest,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        machine: os.hostname(),
        environment: Object.entries(process.env).sort(([a], [b]) =>
          a.localeCompare(b),
        ) as RuntimeValue,
      }),
    };
  } catch {
    // 无法证明完整范围时执行原计划；不会把无法读取当成可以复用。
    return null;
  }
}

export function sameNativeCheckScope(left: NativeCheckScope, right: NativeCheckScope): boolean {
  return (
    left.planKey === right.planKey &&
    left.inputDigest === right.inputDigest &&
    left.contextDigest === right.contextDigest
  );
}
