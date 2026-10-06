import path from 'path';
import { promises as fs } from 'node:fs';
import {
  createCreatorRuntime,
  creatorSummary,
  listCreatorRuns,
} from '../../domains/workflow-creation/index.js';
import type { WorkflowRuntime } from '../../domains/engine/runtime.js';
import { bundleCandidatesCommand, type BundleCommandOptions } from './bundle.js';

export type CreatorCommandOptions = BundleCommandOptions;

function projectRoot(options: CreatorCommandOptions): string {
  return path.resolve(options.project ?? '.');
}

export async function creatorListCommand(options: CreatorCommandOptions = {}): Promise<void> {
  console.log(JSON.stringify(await listCreatorRuns(projectRoot(options)), null, 2));
}

export async function creatorStatusCommand(
  name: string,
  options: CreatorCommandOptions = {},
): Promise<void> {
  const run = await createCreatorRuntime(projectRoot(options)).inspect(name);
  console.log(JSON.stringify(creatorSummary(run), null, 2));
}

export async function creatorNextCommand(
  name: string,
  options: CreatorCommandOptions = {},
): Promise<void> {
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
          '描述目标后启动创作；原Run ID用于继续。先读取真实Skill并提出具体方案，用户确认后编译，安装预览单独确认。',
        start:
          'comet creator start <name> --goal <自然语言目标> --install-target <项目内相对目录> --host codex|claude-code --json',
        resume: 'comet creator next <name> --json',
        supported: ['Native新增步骤', 'Classic full/hotfix/tweak编排', '独立SDK流程与报告审批样板'],
        limits: ['不静默迁移旧格式', '真实宿主和模型验收另行记录', '活动Run与依赖漂移保留原现场'],
      },
      null,
      2,
    ),
  );
}

export async function creatorStartCommand(
  name: string,
  options: CreatorCommandOptions & { goal: string; installTarget: string; host: string },
): Promise<void> {
  const runtime = createCreatorRuntime(projectRoot(options));
  const run = await runtime.start({
    runId: name,
    workflow: { id: 'comet-creator', version: '1' },
    input: { goal: options.goal, installTarget: options.installTarget, host: options.host },
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
  await bundleCandidatesCommand(options);
}

export async function creatorProposeCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}

export async function creatorInitCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}

export async function creatorResolveCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}

export async function creatorAuthoringPlanCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}

export async function creatorAuthoringRecordCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}

export async function creatorGenerateCommand(
  name: string,
  _options: CreatorCommandOptions = {},
): Promise<void> {
  throw new Error('旧创作格式不再推进；保留用户文件，使用 comet creator start 重新生成SDK应用');
}
