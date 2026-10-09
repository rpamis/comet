import path from 'path';
import { promises as fs } from 'node:fs';
import type { WorkflowRuntime } from '../../domains/engine/runtime.js';

export interface CreatorCommandOptions {
  project?: string;
  json?: boolean;
}

function projectRoot(options: CreatorCommandOptions): string {
  return path.resolve(options.project ?? '.');
}

export async function creatorListCommand(options: CreatorCommandOptions = {}): Promise<void> {
  const { listCreatorRuns } = await import('../../domains/workflow-creation/index.js');
  console.log(JSON.stringify(await listCreatorRuns(projectRoot(options)), null, 2));
}

export async function creatorStatusCommand(
  name: string,
  options: CreatorCommandOptions = {},
): Promise<void> {
  const { createCreatorRuntime, creatorSummary } =
    await import('../../domains/workflow-creation/index.js');
  const run = await createCreatorRuntime(projectRoot(options)).inspect(name);
  console.log(JSON.stringify(creatorSummary(run), null, 2));
}

export async function creatorNextCommand(
  name: string,
  options: CreatorCommandOptions = {},
): Promise<void> {
  const { createCreatorRuntime, creatorSummary } =
    await import('../../domains/workflow-creation/index.js');
  const runtime = createCreatorRuntime(projectRoot(options));
  const progress = await runtime.runUntilBlocked({ runId: name, executorId: 'creator-local' });
  console.log(
    JSON.stringify({ ...creatorSummary(progress.run), reason: progress.reason }, null, 2),
  );
}

export async function creatorGuideCommand(_options: CreatorCommandOptions = {}): Promise<void> {
  console.log(
    JSON.stringify(
      {
        message:
          '描述目标后启动创作；原Run ID用于继续。先读取真实Skill并确认方案，编译后选择是否执行Eval；安装预览单独确认。',
        start:
          'comet creator start <name> --goal <自然语言目标> --install-target <项目内相对目录> --host codex|claude-code --json',
        inspect: 'comet creator status <name> --json',
        resume: 'comet creator next <name> --json',
        dispatch: 'comet creator dispatch <name> --request <json-file> --json',
        continuation:
          'status只读当前Run；next执行本地步骤直到需要宿主Action或用户决定。dispatch使用当前Run的revision和Action或Wait身份，不能复用旧请求。',
        authoring:
          'analyze 由 Agent 创作完整组合 Skill 与业务 Rule，写入 proposal.documents 的 SKILL.md 和 rules/workflow-guard.md；与流程、执行绑定和验收器一起确认。SDK 保留正文并附加通用执行协议，不以入口模板替代业务创作。',
        supported: ['Native新增步骤', 'Classic full/hotfix/tweak编排', '独立SDK流程与报告审批样板'],
        delivery:
          '新创作使用 Creator v3：SDK Skill 应用包含 Skill、Runtime 和对应 Rule/Hook；安装预览同时展示项目内完整包导出、固定依赖及当前宿主的正式安装计划。install-target 是独立导出目录，例如 .comet/creator/exports/<应用名>，不能与平台入口重叠。',
        evaluation:
          '可用 --eval-config <JSON文件> 设置 agent、model、judgeAgent、judgeModel、maxTurns、timeoutSeconds。选择评估后自动生成2–4个用例并执行；失败可重试、修复方案或明确跳过，安装预览保留实际结果。凭据只来自执行环境。',
        limits: [
          '仅提供当前 Creator 定义；旧创作保留现场并重新创建',
          'Eval只证明当前用例和所选宿主，不代表全部平台验收',
          '活动Run与依赖漂移保留原现场',
        ],
      },
      null,
      2,
    ),
  );
}

export async function creatorStartCommand(
  name: string,
  options: CreatorCommandOptions & {
    goal: string;
    installTarget: string;
    host: string;
    evalConfig?: string;
  },
): Promise<void> {
  const { createCreatorRuntime, creatorSummary } =
    await import('../../domains/workflow-creation/index.js');
  const runtime = createCreatorRuntime(projectRoot(options));
  const run = await runtime.start({
    runId: name,
    workflow: { id: 'comet-creator', version: '3' },
    input: {
      goal: options.goal,
      installTarget: options.installTarget,
      host: options.host,
      ...(options.evalConfig
        ? { evaluation: JSON.parse(await fs.readFile(path.resolve(options.evalConfig), 'utf8')) }
        : {}),
    },
  });
  console.log(JSON.stringify(creatorSummary(run), null, 2));
}

/** 只转交公开SDK协议；用户决定必须来自当前Wait，宿主领取保留原Action身份。 */
export async function creatorDispatchCommand(
  name: string,
  options: CreatorCommandOptions & { request: string },
): Promise<void> {
  const request = JSON.parse(await fs.readFile(path.resolve(options.request), 'utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.runId !== name)
    throw new Error('请求必须属于当前Creator Run');
  const { createCreatorRuntime, creatorSummary } =
    await import('../../domains/workflow-creation/index.js');
  const runtime = createCreatorRuntime(projectRoot(options));
  const operations = {
    claim: runtime.claim,
    'record-outcome': runtime.recordOutcome,
    'resolve-wait': runtime.resolveWait,
    'mark-unknown': runtime.markUnknown,
    retry: runtime.retry,
    cancel: runtime.cancel,
  } as const;
  if (!Object.hasOwn(operations, request.operation))
    throw new Error('不支持此Creator动作；使用当前Action或Wait继续');
  const fields: Record<string, string[]> = {
    claim: [
      'actionId',
      'attempt',
      'inputHash',
      'executorId',
      'sessionId',
      'claimToken',
      'capabilities',
    ],
    'record-outcome': ['outcome'],
    'resolve-wait': ['waitId', 'proposalHash', 'decisionId', 'choice'],
    'mark-unknown': ['actionId', 'attempt', 'reason'],
    retry: ['actionId', 'attempt', 'proposalHash', 'reconciliation'],
    cancel: ['reason'],
  };
  if (
    Object.keys(request).some(
      (key) =>
        !['operation', 'runId', 'expectedRevision', ...fields[request.operation]].includes(key),
    )
  )
    throw new Error('请求含未声明字段；按当前SDK动作修正');
  const { operation, ...input } = request;
  const invoke = operations[operation as keyof typeof operations] as (
    input: Parameters<WorkflowRuntime['claim']>[0],
  ) => ReturnType<WorkflowRuntime['claim']>;
  const run = await invoke(input);
  console.log(JSON.stringify(creatorSummary(run), null, 2));
}

export async function creatorCandidatesCommand(options: CreatorCommandOptions = {}): Promise<void> {
  const [{ discoverBundleCandidates }, { readSkillPreferences }] = await Promise.all([
    import('../../domains/bundle/candidates.js'),
    import('../../domains/bundle/preferences.js'),
  ]);
  const root = projectRoot(options);
  const preferences = await readSkillPreferences(root);
  const candidates = await discoverBundleCandidates({ projectRoot: root, preferences });
  console.log(
    options.json
      ? JSON.stringify({ candidates }, null, 2)
      : candidates.map((candidate) => `${candidate.name}: ${candidate.status}`).join('\n'),
  );
}
