import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { hashRuntimeValue, defineWorkflow } from '../engine/runtime.js';
import {
  loadWorkflowApplication,
  exportWorkflowApplication,
  recordApplicationEvaluationEvidence,
} from '../workflow-application/index.js';
import {
  applicationFilesHash,
  readApplicationFiles,
} from '../workflow-application/skill-adapter.js';
import { runExternalCommandAsync } from '../../platform/process/external-command.js';
import { isPathWithin } from './standalone-context.js';

export interface ApplicationEvalSettings {
  agent: string;
  model?: string;
  judgeAgent?: string;
  judgeModel?: string;
  maxTurns?: number;
  timeoutSeconds?: number;
}
interface ApplicationEvalOptions {
  file: string;
  projectRoot: string;
  goal?: string;
  settings: ApplicationEvalSettings;
  reuseTaskSet?: ApplicationEvalTaskSet;
  previousExperimentId?: string;
}
export interface ApplicationEvalTaskSet {
  manifestPath: string;
  manifestHash: string;
  generationHash?: string;
  sourceRoot?: string;
  sourceSnapshotHash?: string;
}
export interface ApplicationEvalPreview {
  application: {
    id: string;
    version: string;
    base: string;
    runtimeVersion: string;
    contentHash: string;
  };
  goal: string;
  entrySkill: string;
  runtimeIdentityHash: string;
  settings: ApplicationEvalSettings & { maxTurns: number; timeoutSeconds: number };
  workflows: Array<{
    id: string;
    version: string;
    steps: string[];
    definition: unknown;
    definitionHash: string;
  }>;
  taskCount: { min: 2; max: 4 };
  limitations: string[];
  noModelsStarted: true;
  blockedReasons: string[];
  confirmationHash: string;
  taskSet?: ApplicationEvalTaskSet;
}

async function assertPreviousEvaluationStopped(projectRoot: string, experimentId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/u.test(experimentId)) throw new Error('原评估身份无效');
  const containers = await runExternalCommandAsync(
    'docker',
    ['ps', '--quiet', '--filter', `label=comet.eval.experiment=${experimentId}`],
    { cwd: projectRoot, timeoutMs: 5000 },
  ).catch(() => {
    throw new Error('无法核对原实验容器；恢复 Docker 后继续，不重复启动评估');
  });
  if (containers.trim()) throw new Error('原评估容器仍在运行；先核对并停止原实验，不重复启动');
}
export interface PreparedApplicationEval {
  preview: ApplicationEvalPreview;
  experimentId: string;
  skillRoot: string;
  snapshotHash: string;
  resultFile: string;
}
export interface ApplicationEvalResult {
  schema: 'comet.workflow.application.eval.result.v1';
  experimentId: string;
  confirmationHash: string;
  snapshotHash: string;
  application: ApplicationEvalPreview['application'];
  settings: ApplicationEvalPreview['settings'];
  status: 'passed' | 'failed' | 'incomplete';
  taskNames: string[];
  passed: number;
  total: number;
  report: string;
  limitations: string[];
  failures: string[];
  taskSet?: ApplicationEvalTaskSet;
}

async function reusableTasks(projectRoot: string, taskSet: ApplicationEvalTaskSet) {
  const generatedRoot = await artifactPath(projectRoot, 'generated');
  const manifest = await fs.realpath(taskSet.manifestPath);
  if (!isPathWithin(generatedRoot, manifest))
    throw new Error('复用用例必须来自当前项目的 Eval 生成记录');
  const bytes = await fs.readFile(manifest);
  if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== taskSet.manifestHash)
    throw new Error('原固定用例发生变化；不能复用陈旧评估记录');
  const source = parse(bytes.toString('utf8'));
  if (
    !Array.isArray(source?.evaluation?.tasks) ||
    source.evaluation.tasks.length < 2 ||
    source.evaluation.tasks.length > 4
  )
    throw new Error('原评估没有完整的固定用例');
  if (taskSet.sourceRoot) {
    const owned = await artifactPath(projectRoot, 'cache');
    const original = await fs.realpath(taskSet.sourceRoot);
    if (
      !isPathWithin(owned, original) ||
      applicationFilesHash(await readApplicationFiles(original)) !== taskSet.sourceSnapshotHash
    )
      throw new Error('原用例输入快照发生变化；不能重用已漂移的测试数据');
  }
  return source.evaluation.tasks;
}

export function normalizeApplicationEvalSettings(value: ApplicationEvalSettings) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        !['agent', 'model', 'judgeAgent', 'judgeModel', 'maxTurns', 'timeoutSeconds'].includes(key),
    )
  )
    throw new Error('评估配置含未声明字段；凭据只能从当前执行环境注入');
  for (const key of ['agent', 'model', 'judgeAgent', 'judgeModel'] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || !/^[A-Za-z0-9._:@/+%-]{1,160}$/u.test(value[key]!))
    )
      throw new Error(`评估 ${key} 无效`);
  }
  if (!value.agent || !/^[a-z][a-z0-9-]{1,31}$/u.test(value.agent))
    throw new Error('需要评估 Agent 身份');
  if (value.judgeAgent && !value.judgeModel) throw new Error('独立 Judge 需要明确模型');
  const maxTurns = value.maxTurns ?? 8;
  const timeoutSeconds = value.timeoutSeconds ?? 1200;
  if (
    !Number.isSafeInteger(maxTurns) ||
    maxTurns < 1 ||
    maxTurns > 32 ||
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds < 30 ||
    timeoutSeconds > 3600
  )
    throw new Error('评估轮数需为 1–32，总时限需为 30–3600 秒');
  return { ...value, maxTurns, timeoutSeconds };
}

export async function previewWorkflowApplicationEval(
  options: ApplicationEvalOptions,
): Promise<ApplicationEvalPreview> {
  const loaded = await loadWorkflowApplication({
    file: options.file,
    projectRoot: options.projectRoot,
    readOnly: true,
  });
  const { id, version, base, runtimeVersion } = loaded.identity;
  const contentHash = applicationFilesHash(await readApplicationFiles(loaded.identity.packageRoot));
  if (options.reuseTaskSet) await reusableTasks(options.projectRoot, options.reuseTaskSet);
  const body = {
    application: { id, version, base, runtimeVersion, contentHash },
    goal: options.goal?.trim() || `运行 ${id} 的已声明流程并检查实际产物、审批和恢复行为`,
    entrySkill: loaded.manifest.entrySkill,
    runtimeIdentityHash: loaded.identity.contentHash,
    settings: normalizeApplicationEvalSettings(options.settings),
    workflows: loaded.implementation.workflows.map((workflow) => ({
      id: workflow.id,
      version: workflow.version,
      steps: Object.keys(workflow.steps),
      definition: JSON.parse(JSON.stringify(workflow)),
      definitionHash: hashRuntimeValue(defineWorkflow(workflow)),
    })),
    taskCount: { min: 2 as const, max: 4 as const },
    limitations: [
      '仅证明所选 Agent、模型和当前用例的结果；多平台安装不等于全部宿主验收。',
      '2–4 个自动生成用例不保证覆盖全部分支、外部系统或恢复路径。',
      '审批在隔离评估环境中模拟，不授权真实发布；外部集成必须使用测试替身。',
      '预算按用例数、交互轮数和总时限限制；实际模型费用另行报告。',
    ],
    noModelsStarted: true as const,
    blockedReasons: [...loaded.skills.values()]
      .filter((skill) => skill.adapter.sideEffect === 'external')
      .map(
        (skill) =>
          `外部 Skill ${skill.id} 需要固定的测试替身；修订评估应用以使用隔离实现后再运行。`,
      ),
    ...(options.reuseTaskSet ? { taskSet: options.reuseTaskSet } : {}),
  };
  return { ...body, confirmationHash: hashRuntimeValue(body) };
}

async function artifactPath(projectRoot: string, ...parts: string[]) {
  const root = await fs.realpath(projectRoot);
  const destination = path.join(root, '.comet/eval', ...parts);
  let current = root;
  for (const part of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (
        (await fs.lstat(current)).isSymbolicLink() ||
        !isPathWithin(root, await fs.realpath(current))
      )
        throw new Error('评估工件路径不能经过符号链接或越过项目');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return destination;
}

export async function prepareWorkflowApplicationEval(
  options: ApplicationEvalOptions & { confirmationHash: string; experimentId: string },
): Promise<PreparedApplicationEval> {
  const preview = await previewWorkflowApplicationEval(options);
  if (preview.confirmationHash !== options.confirmationHash)
    throw new Error('应用、依赖或评估配置已变化；重新确认评估');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/u.test(options.experimentId))
    throw new Error('评估身份无效');
  const directory = await artifactPath(
    options.projectRoot,
    'cache',
    `application-${preview.confirmationHash}`,
  );
  const skillRoot = path.join(directory, 'skill');
  const receiptFile = path.join(directory, 'snapshot.json');
  const resultFile = await artifactPath(
    options.projectRoot,
    'runs',
    options.experimentId,
    'application-result.json',
  );
  const receipt = await fs.readFile(receiptFile, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (receipt) {
    const saved = JSON.parse(receipt);
    if (
      saved.confirmationHash !== preview.confirmationHash ||
      saved.snapshotHash !== applicationFilesHash(await readApplicationFiles(skillRoot))
    )
      throw new Error('固定评估快照发生漂移；保留原现场后修复');
    return {
      preview,
      experimentId: options.experimentId,
      skillRoot,
      snapshotHash: saved.snapshotHash,
      resultFile,
    };
  }
  // 半写入的快照不覆盖；新进程需先核对原现场。
  await fs.mkdir(directory, { recursive: false }).catch(async (error) => {
    if (error.code === 'ENOENT') {
      await fs.mkdir(path.dirname(directory), { recursive: true });
      await fs.mkdir(directory);
    } else throw new Error('评估快照已存在但缺少完成记录；保留现场后核对', { cause: error });
  });
  await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
  await exportWorkflowApplication({
    file: options.file,
    projectRoot: options.projectRoot,
    destination: path.join(skillRoot, 'scripts/application'),
  });
  await fs.mkdir(path.join(skillRoot, 'references'));
  await fs.writeFile(
    path.join(skillRoot, 'references/workflows.json'),
    JSON.stringify(preview, null, 2),
  );
  await fs.writeFile(
    path.join(skillRoot, 'SKILL.md'),
    `---\nname: ${preview.application.id}\ndescription: 在隔离工作区运行 ${preview.application.id} SDK 应用并检查实际结果。\n---\n\n目标：${preview.goal}\n\n评估输入的完整包是 "scripts/application/application.json"，实际流程、固定依赖和验收约束见 "references/workflows.json"；真实入口是 "scripts/application/${preview.entrySkill}"。执行前由控制器安装应用及固定依赖，加载已安装的 ${preview.application.id} Skill，用 comet runtime dispatch --application ${preview.application.id} --project-root /workspace --request <JSON文件> --json 启动和恢复实际 SDK Run。保存原 Run、Action、attempt、inputHash 和 Wait；审批必须等待评估用户决定。不得绕过 Runtime、伪造结果或手写成功状态。对照当前任务检查真实输出；只在隔离工作区写入，不执行真实发布、邮件或远端推送。\n`,
  );
  await fs.mkdir(path.join(skillRoot, 'comet'));
  const settings = preview.settings;
  const reused = options.reuseTaskSet
    ? structuredClone(await reusableTasks(options.projectRoot, options.reuseTaskSet))
    : null;
  if (reused) {
    for (let index = 0; index < reused.length; index++) {
      const task = reused[index];
      if (!task.workspace) continue;
      if (!options.reuseTaskSet?.sourceRoot || typeof task.workspace !== 'string')
        throw new Error('复用工作区用例需要原固定输入快照');
      const originalRoot = await fs.realpath(options.reuseTaskSet.sourceRoot);
      const fixture = await fs.realpath(path.resolve(originalRoot, task.workspace));
      if (!isPathWithin(originalRoot, fixture)) throw new Error('原用例工作区越过固定输入快照');
      const resources = await readApplicationFiles(fixture);
      const ref = `eval-fixtures/case-${index}`;
      for (const [resource, bytes] of Object.entries(resources)) {
        const target = path.join(skillRoot, ref, resource);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.from(bytes, 'base64'), { flag: 'wx' });
      }
      task.workspace = ref;
    }
  }
  await fs.writeFile(
    path.join(skillRoot, 'comet/eval.yaml'),
    stringify({
      apiVersion: 'comet.eval/v1alpha1',
      kind: 'SkillEvalManifest',
      metadata: { name: preview.application.id },
      skill: { name: preview.application.id, source: '..', profile: 'generic' },
      execution: { agent: settings.agent, ...(settings.model ? { model: settings.model } : {}) },
      ...(settings.judgeModel
        ? { judge: { agent: settings.judgeAgent ?? settings.agent, model: settings.judgeModel } }
        : {}),
      interaction: {
        mode: 'auto_user',
        maxTurns: settings.maxTurns,
        simulatorPrompt:
          '你是隔离评估中的用户。按照任务要求作出审批或拒绝，只对 /workspace 内的测试工件授权，不允许真实邮件、发布或远端推送。',
      },
      evaluation: reused ? { tasks: reused } : {},
    }),
  );
  const snapshotHash = applicationFilesHash(await readApplicationFiles(skillRoot));
  await fs.writeFile(
    receiptFile,
    JSON.stringify({ confirmationHash: preview.confirmationHash, snapshotHash }),
    { flag: 'wx' },
  );
  return { preview, experimentId: options.experimentId, skillRoot, snapshotHash, resultFile };
}

export async function readWorkflowApplicationEvalResult(
  prepared: PreparedApplicationEval,
): Promise<ApplicationEvalResult | null> {
  const text = await fs.readFile(prepared.resultFile, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!text) return null;
  const result = JSON.parse(text) as ApplicationEvalResult;
  if (
    result.schema !== 'comet.workflow.application.eval.result.v1' ||
    result.experimentId !== prepared.experimentId ||
    result.confirmationHash !== prepared.preview.confirmationHash ||
    result.snapshotHash !== prepared.snapshotHash ||
    hashRuntimeValue(result.application) !== hashRuntimeValue(prepared.preview.application) ||
    hashRuntimeValue(result.settings) !== hashRuntimeValue(prepared.preview.settings)
  )
    throw new Error('评估结果与当前应用、用例快照或执行配置不匹配');
  if (
    !['passed', 'failed', 'incomplete'].includes(result.status) ||
    !Array.isArray(result.taskNames) ||
    (result.status !== 'incomplete' && result.taskNames.length < 2) ||
    result.taskNames.length > 4 ||
    result.taskNames.some((name) => typeof name !== 'string') ||
    new Set(result.taskNames).size !== result.taskNames.length ||
    !Number.isSafeInteger(result.total) ||
    !Number.isSafeInteger(result.passed) ||
    result.passed < 0 ||
    result.passed > result.total ||
    (result.status === 'passed' &&
      (result.total !== result.taskNames.length || result.passed !== result.total)) ||
    !Array.isArray(result.failures) ||
    !Array.isArray(result.limitations) ||
    !['summary.md', 'summary.html'].includes(result.report)
  )
    throw new Error('评估结果缺少完整用例和实际执行证据');
  if (
    applicationFilesHash(await readApplicationFiles(prepared.skillRoot)) !== prepared.snapshotHash
  )
    throw new Error('评估快照发生变化；原结果失效');
  if (result.status === 'passed' && !result.taskSet) throw new Error('通过结果缺少固定用例集');
  if (result.taskSet)
    await reusableTasks(
      path.resolve(path.dirname(prepared.resultFile), '../../../..'),
      result.taskSet,
    );
  return result;
}

/** 固定实验身份用于冷恢复；有完成报告时读取，不重复消费模型预算。 */
export async function runWorkflowApplicationEval(
  options: ApplicationEvalOptions & { confirmationHash: string; experimentId: string },
): Promise<ApplicationEvalResult> {
  const prepared = await prepareWorkflowApplicationEval(options);
  const existing = await readWorkflowApplicationEvalResult(prepared);
  if (existing) {
    await recordApplicationEvaluationEvidence(options.projectRoot, prepared.resultFile);
    return existing;
  }
  const runRoot = path.dirname(prepared.resultFile);
  if (options.previousExperimentId)
    await assertPreviousEvaluationStopped(options.projectRoot, options.previousExperimentId);
  await fs.mkdir(runRoot, { recursive: true });
  const lock = await fs.open(path.join(runRoot, 'execution.lock'), 'wx').catch(() => {
    throw new Error('原评估可能仍在执行或已中断；核对原报告和进程，不重复启动');
  });
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packageRoot = path.basename(moduleRoot) === 'dist' ? path.dirname(moduleRoot) : moduleRoot;
  try {
    await (
      prepared.preview.blockedReasons.length
        ? Promise.reject(new Error(prepared.preview.blockedReasons.join('\n')))
        : runExternalCommandAsync(
            process.execPath,
            [
              path.join(packageRoot, 'bin/comet.js'),
              'eval',
              prepared.skillRoot,
              '--project',
              path.resolve(options.projectRoot),
              '--html',
            ],
            {
              cwd: options.projectRoot,
              timeoutMs: prepared.preview.settings.timeoutSeconds * 1000,
              env: {
                ...process.env,
                COMET_EVAL_EXPERIMENT_ID: options.experimentId,
                COMET_APPLICATION_EVAL_CONTEXT: JSON.stringify(prepared),
                PYTHONDONTWRITEBYTECODE: '1',
              },
            },
          )
    ).catch(async () => {
      const reported = await readWorkflowApplicationEvalResult(prepared);
      if (reported?.status === 'passed') {
        await fs.writeFile(path.join(runRoot, 'model-result.json'), JSON.stringify(reported), {
          flag: 'wx',
        });
        await fs.writeFile(
          prepared.resultFile,
          JSON.stringify({
            ...reported,
            status: 'incomplete',
            failures: [
              ...reported.failures,
              'Eval 进程异常结束或超过预算；原用例结果保留在 model-result.json。',
            ],
          }),
        );
      } else if (!reported) {
        const incomplete: ApplicationEvalResult = {
          schema: 'comet.workflow.application.eval.result.v1',
          experimentId: prepared.experimentId,
          confirmationHash: prepared.preview.confirmationHash,
          snapshotHash: prepared.snapshotHash,
          application: prepared.preview.application,
          settings: prepared.preview.settings,
          status: 'incomplete',
          taskNames: [],
          passed: 0,
          total: 0,
          report: 'summary.md',
          limitations: prepared.preview.limitations,
          failures: prepared.preview.blockedReasons.length
            ? prepared.preview.blockedReasons
            : ['Eval 未完成；检查模型配置、环境和原运行报告后重试。'],
        };
        await fs
          .writeFile(
            path.join(runRoot, 'summary.md'),
            '# Eval 未完成\n\n检查模型配置、环境和原运行日志；没有完整验收结果。\n',
            { flag: 'wx' },
          )
          .catch((error) => {
            if (error.code !== 'EEXIST') throw error;
          });
        await fs.writeFile(prepared.resultFile, JSON.stringify(incomplete), { flag: 'wx' });
      }
    });
    const result = await readWorkflowApplicationEvalResult(prepared);
    if (!result) throw new Error('Eval 未生成与当前应用绑定的结果');
    await recordApplicationEvaluationEvidence(options.projectRoot, prepared.resultFile);
    return result;
  } finally {
    await lock.close();
    await fs.unlink(path.join(runRoot, 'execution.lock'));
  }
}
