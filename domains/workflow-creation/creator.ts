import { promises as fs, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  createRuntime,
  createFileRuntimeStore,
  createRuntimeExecutor,
  defineRuntimeHandler,
  hashRuntimeValue,
  RuntimeProtocolError,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../engine/runtime.js';
import {
  prepareWorkflowApplicationPlan,
  hashWorkflowApplicationPlanContent,
  compileWorkflowApplication,
  type WorkflowApplicationPlan,
  type WorkflowApplicationProposal,
} from '../workflow-generation/index.js';
import { loadWorkflowApplication } from '../workflow-application/index.js';
import { applicationFilesHash } from '../workflow-application/skill-adapter.js';
import {
  normalizeApplicationEvalSettings,
  previewWorkflowApplicationEval,
  prepareWorkflowApplicationEval,
  runWorkflowApplicationEval,
  readWorkflowApplicationEvalResult,
  type ApplicationEvalSettings,
  type ApplicationEvalPreview,
  type ApplicationEvalResult,
} from '../eval/index.js';

function reject(message: string): never {
  throw new RuntimeProtocolError(
    'STALE_PROPOSAL',
    `${message}；保留现场，选择 revise 后重新检查并确认`,
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('创作输入必须是JSON对象');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new Error(`${label}需要非空文本`);
  return value;
}
function contained(root: string, ref: string): string {
  if (
    path.isAbsolute(ref) ||
    ref.includes('\\') ||
    ref.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('安装目标必须是项目内相对目录');
  let cursor = root;
  for (const piece of ref.split('/')) {
    cursor = path.join(cursor, piece);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error('安装路径不能经过符号链接或junction');
  }
  return cursor;
}
function files(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const visit = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const ref = prefix + entry.name;
      const target = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('工件不能包含符号链接');
      if (entry.isDirectory()) visit(target, ref + '/');
      else if (entry.isFile()) result[ref] = readFileSync(target).toString('base64');
      else throw new Error('工件需要普通文件');
    }
  };
  visit(root);
  return result;
}
function value<T>(run: Readonly<WorkflowRun>, step: string): T {
  if (!run.outputs[step]) throw new Error(`缺少${step}结果`);
  return run.outputs[step].value as T;
}
type Prepared = {
  installTarget: string;
  plan: WorkflowApplicationPlan;
  planHash: string;
  summary: string;
  failurePaths: string[];
  limitations: string[];
  steps: Array<{ id: string; work: string; skills: string[]; output: unknown }>;
  evaluation?: ApplicationEvalSettings;
};
type Package = { file: string; contentHash: string; compositionHash: string };
type Preview = {
  target: string;
  packageHash: string;
  planHash: string;
  files: string[];
  noFilesWritten: true;
  evaluation?: unknown;
};

function assertPlan(run: Readonly<WorkflowRun>): Prepared {
  const prepared = value<Prepared>(run, 'prepare');
  if (hashRuntimeValue(prepared.plan) !== prepared.planHash) reject('方案发生变化');
  for (const skill of prepared.plan.manifest.skills) {
    if (applicationFilesHash(files(skill.root)) !== skill.contentHash)
      reject(`Skill依赖发生变化：${skill.id}`);
  }
  return prepared;
}
function assertPackage(run: Readonly<WorkflowRun>): Package {
  const compiled = value<Package>(run, 'compile');
  if (
    compiled.compositionHash !== assertPlan(run).planHash ||
    applicationFilesHash(files(path.dirname(compiled.file))) !== compiled.contentHash
  )
    reject('编译产物发生变化');
  return compiled;
}
function assertPreview(root: string, run: Readonly<WorkflowRun>): Preview {
  const preview = value<Preview>(run, 'preview');
  const compiled = assertPackage(run);
  if (
    preview.packageHash !== compiled.contentHash ||
    preview.target !== assertPlan(run).installTarget
  )
    reject('安装目标或文件变化');
  if (existsSync(contained(root, preview.target))) reject('安装目标出现冲突或变化');
  if (
    run.workflow.version === '2' &&
    hashRuntimeValue(preview.evaluation) !== hashRuntimeValue(evaluationSummary(run))
  )
    reject('安装预览绑定的 Eval 结果发生变化');
  return preview;
}

function evaluationSummary(run: Readonly<WorkflowRun>): unknown {
  if (run.workflow.version === '1') return null;
  const selection = run.waits.filter((wait) => wait.stepId === 'confirm-eval').at(-1);
  if (selection?.decision?.choice === 'skip')
    return {
      status: 'skipped',
      confirmationHash: selection.proposalHash,
      applicationHash: assertPackage(run).contentHash,
    };
  const current = run.outputs['eval-preview']?.value as unknown as
    ApplicationEvalPreview | undefined;
  const outcome = run.outputs.evaluate?.value as unknown as ApplicationEvalResult | undefined;
  if (!current || !outcome || outcome.confirmationHash !== current.confirmationHash) return null;
  const reportRoot = path.resolve(
    path.dirname((run.outputs.compile.value as unknown as Package).file),
    '../../../eval/runs',
    outcome.experimentId,
  );
  if (
    hashRuntimeValue(
      JSON.parse(readFileSync(path.join(reportRoot, 'application-result.json'), 'utf8')),
    ) !== hashRuntimeValue(outcome)
  )
    reject('原 Eval 报告发生变化');
  if (
    outcome.taskSet &&
    `sha256:${createHash('sha256').update(readFileSync(outcome.taskSet.manifestPath)).digest('hex')}` !==
      outcome.taskSet.manifestHash
  )
    reject('原固定用例发生变化');
  if (
    outcome.taskSet?.sourceRoot &&
    applicationFilesHash(files(outcome.taskSet.sourceRoot)) !== outcome.taskSet.sourceSnapshotHash
  )
    reject('原用例输入快照发生变化');
  const review = run.waits.filter((wait) => wait.stepId === 'review-eval').at(-1);
  return { ...outcome, ...(review?.decision?.choice === 'skip' ? { skipped: true } : {}) };
}

function evaluationOptions(root: string, run: Readonly<WorkflowRun>) {
  const compiled = assertPackage(run);
  const settings =
    assertPlan(run).evaluation ??
    normalizeApplicationEvalSettings({ agent: String(object(run.input).host) });
  const previous = run.outputs.evaluate?.value as unknown as ApplicationEvalResult | undefined;
  return {
    file: compiled.file,
    projectRoot: root,
    goal: String(object(run.input).goal),
    settings,
    ...(previous?.taskSet ? { reuseTaskSet: previous.taskSet } : {}),
  };
}

function evaluationRequest(root: string, run: Readonly<WorkflowRun>) {
  const action = run.actions.filter((action) => action.stepId === 'evaluate').at(-1)!;
  const preview = value<ApplicationEvalPreview>(run, 'eval-preview');
  return {
    ...evaluationOptions(root, run),
    reuseTaskSet: preview.taskSet,
    ...((run.outputs.evaluate?.value as unknown as ApplicationEvalResult | undefined)?.status ===
    'incomplete'
      ? {
          previousExperimentId: (run.outputs.evaluate.value as unknown as ApplicationEvalResult)
            .experimentId,
        }
      : {}),
    confirmationHash: preview.confirmationHash,
    experimentId: `creator-eval-${hashRuntimeValue([run.runId, action.id])}`,
  };
}

/** SDK持有创作进度；宿主只负责自然语言分析和真实Skill调查，机器步骤由固定执行器完成。 */
export function createCreatorRuntime(projectRoot: string): WorkflowRuntime {
  const root = path.resolve(projectRoot);
  const staging = contained(root, '.comet/creator/packages');
  const work = (execute: (run: Readonly<WorkflowRun>) => Promise<unknown>) =>
    defineRuntimeHandler({
      type: 'call_tool',
      parseInput: (v) => v,
      execute: async (_, { run }) => ({
        status: 'succeeded',
        output: (await execute(run!)) as RuntimeValue,
      }),
    });
  const handlers = {
    'creator.prepare': work(async (run) => {
      const analysis = object(value(run, 'analyze'));
      const plan = await prepareWorkflowApplicationPlan({
        proposal: analysis.proposal as WorkflowApplicationProposal,
        projectRoot: root,
        packageRoot: staging,
      });
      for (const skill of plan.manifest.skills)
        if (!path.isAbsolute(skill.root)) throw new Error('创作方案的Skill目录需要绝对路径');
      return {
        installTarget: text(analysis.installTarget ?? object(run.input).installTarget, '安装目标'),
        plan,
        planHash: hashRuntimeValue(plan),
        summary: analysis.summary,
        failurePaths: analysis.failurePaths,
        limitations: analysis.limitations,
        steps: plan.workflows.flatMap((w) =>
          Object.entries(w.steps).map(([id, s]) => ({
            id: `${w.id}/${id}`,
            work: s.type,
            skills: plan.manifest.bindings
              .filter((b) => b.workflowId === w.id && b.stepId === id)
              .map((b) => b.skillId),
            output: s.outputSchema ?? null,
          })),
        ),
        ...(run.workflow.version === '2'
          ? {
              evaluation: normalizeApplicationEvalSettings(
                (analysis.evaluation ??
                  object(run.input).evaluation ?? {
                    agent: object(run.input).host,
                  }) as ApplicationEvalSettings,
              ),
            }
          : {}),
      };
    }),
    'creator.compile': work(async (run) => {
      const prepared = assertPlan(run);
      await fs.mkdir(staging, { recursive: true });
      const target = path.join(staging, hashRuntimeValue([run.runId, prepared.planHash]));
      // 中断后核对已完成的同一编译，保留目录；未知结果不能盲目覆盖或再次装配。
      if (existsSync(target)) {
        const installation = JSON.parse(
          readFileSync(path.join(target, 'installation.json'), 'utf8'),
        );
        if (installation.recovery.compositionHash !== prepared.planHash) reject('原编译现场不匹配');
        if (
          applicationFilesHash(files(target)) !==
          (await hashWorkflowApplicationPlanContent(prepared.plan))
        )
          reject('原编译字节与当前方案不匹配');
        await loadWorkflowApplication({
          file: path.join(target, 'application.json'),
          projectRoot: root,
        });
        return {
          file: path.join(target, 'application.json'),
          compositionHash: prepared.planHash,
          contentHash: applicationFilesHash(files(target)),
        };
      }
      return compileWorkflowApplication({
        plan: prepared.plan,
        confirmationHash: prepared.planHash,
        projectRoot: root,
        packageRoot: target,
      });
    }),
    'creator.verify': work(async (run) => {
      const compiled = assertPackage(run);
      const loaded = await loadWorkflowApplication({ file: compiled.file, projectRoot: root });
      return {
        packageHash: compiled.contentHash,
        definitionHashes: loaded.implementation.workflows.map((w) => hashRuntimeValue(w)),
        checks: ['实际应用加载', '固定Skill与资源摘要', '已确认的有效流程及执行绑定'],
        notRun: ['本步骤不替代真实宿主、模型和完整业务验收'],
      };
    }),
    'creator.eval-preview': work(async (run) =>
      previewWorkflowApplicationEval(evaluationOptions(root, run)),
    ),
    'creator.evaluate': work(async (run) =>
      runWorkflowApplicationEval(evaluationRequest(root, run)),
    ),
    'creator.preview': work(async (run) => {
      const compiled = assertPackage(run);
      const target = assertPlan(run).installTarget;
      const destination = contained(root, target);
      if (existsSync(destination)) reject('安装目标存在冲突');
      return {
        target,
        packageHash: compiled.contentHash,
        planHash: compiled.compositionHash,
        files: Object.keys(files(path.dirname(compiled.file))),
        noFilesWritten: true,
        ...(run.workflow.version === '2' ? { evaluation: evaluationSummary(run) } : {}),
      };
    }),
    'creator.install': work(async (run) => {
      const preview = value<Preview>(run, 'preview');
      const compiled = assertPackage(run);
      const destination = contained(root, preview.target);
      if (existsSync(destination)) {
        if (applicationFilesHash(files(destination)) !== preview.packageHash)
          reject('安装现场与已批准文件不匹配');
        return { target: preview.target, contentHash: preview.packageHash, recovered: true };
      }
      assertPreview(root, run);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.mkdir(destination);
      for (const [ref, bytes] of Object.entries(files(path.dirname(compiled.file)))) {
        const file = path.join(destination, ref);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, Buffer.from(bytes, 'base64'), { flag: 'wx' });
      }
      if (applicationFilesHash(files(destination)) !== preview.packageHash)
        reject('安装文件校验未通过');
      return { target: preview.target, contentHash: preview.packageHash, recovered: false };
    }),
    'creator.stop': work(async () => ({
      stopped: true,
      message: '保留创作与工件；用户已拒绝当前决定。',
    })),
  };
  const runtime = createRuntime({
    store: createFileRuntimeStore({ rootDir: path.join(root, '.comet/runtime/creator') }),
    workflows: [1, 2].map((version) => ({
      id: 'comet-creator',
      version: String(version),
      entry: 'analyze',
      maxTransitions: 64,
      initialState: {},
      stateSchema: { type: 'object', additionalProperties: false },
      transitionHandler: { id: 'creator-decisions', version: '1' },
      steps: {
        analyze: {
          type: 'handoff',
          ref: 'creator-analysis',
          requiredCapabilities: ['skill-load', 'handoff'],
          retry: 'manual',
          validator: { id: 'creator-analysis', version: '1' },
          outputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['proposal', 'summary', 'failurePaths', 'limitations'],
            properties: {
              proposal: { type: 'object' },
              summary: { type: 'string', minLength: 1 },
              failurePaths: {
                type: 'array',
                minItems: 1,
                items: { type: 'string', minLength: 1 },
              },
              limitations: {
                type: 'array',
                minItems: 1,
                items: { type: 'string', minLength: 1 },
              },
              installTarget: { type: 'string', minLength: 1 },
              ...(version === 2 ? { evaluation: { type: 'object' } } : {}),
            },
          },
        },
        prepare: { type: 'call_tool', ref: 'creator.prepare' },
        'confirm-plan': {
          type: 'ask_user',
          proposalFrom: 'prepare',
          choices: ['approved', 'revise', 'rejected'],
        },
        compile: { type: 'call_tool', ref: 'creator.compile', retry: 'reconcile' },
        verify: { type: 'call_tool', ref: 'creator.verify' },
        ...(version === 2
          ? {
              'eval-preview': { type: 'call_tool' as const, ref: 'creator.eval-preview' },
              'confirm-eval': {
                type: 'ask_user' as const,
                proposalFrom: 'eval-preview',
                choices: ['evaluate', 'skip', 'revise'],
              },
              evaluate: {
                type: 'call_tool' as const,
                ref: 'creator.evaluate',
                retry: 'reconcile' as const,
              },
              'review-eval': {
                type: 'ask_user' as const,
                proposalFrom: 'evaluate',
                choices: ['retry', 'revise', 'skip'],
              },
            }
          : {}),
        preview: { type: 'call_tool', ref: 'creator.preview' },
        'confirm-install': {
          type: 'ask_user',
          proposalFrom: 'preview',
          choices: ['approved', 'revise', 'rejected'],
        },
        install: { type: 'call_tool', ref: 'creator.install', retry: 'reconcile' },
        stop: { type: 'call_tool', ref: 'creator.stop' },
      },
      transitions: [
        { from: 'analyze', to: 'prepare' },
        { from: 'prepare', to: 'confirm-plan' },
        { from: 'confirm-plan', to: 'compile', on: 'approved' },
        { from: 'confirm-plan', to: 'analyze', on: 'revise' },
        { from: 'confirm-plan', to: 'stop', on: 'rejected' },
        { from: 'compile', to: 'verify' },
        { from: 'verify', to: version === 2 ? 'eval-preview' : 'preview' },
        ...(version === 2
          ? [
              { from: 'eval-preview', to: 'confirm-eval' },
              { from: 'confirm-eval', to: 'evaluate', on: 'evaluate' },
              { from: 'confirm-eval', to: 'preview', on: 'skip' },
              { from: 'confirm-eval', to: 'analyze', on: 'revise' },
              { from: 'evaluate', to: 'preview' },
              { from: 'evaluate', to: 'review-eval' },
              { from: 'review-eval', to: 'evaluate', on: 'retry' },
              { from: 'review-eval', to: 'analyze', on: 'revise' },
              { from: 'review-eval', to: 'preview', on: 'skip' },
            ]
          : []),
        { from: 'preview', to: 'confirm-install' },
        { from: 'confirm-install', to: 'install', on: 'approved' },
        { from: 'confirm-install', to: 'analyze', on: 'revise' },
        { from: 'confirm-install', to: 'stop', on: 'rejected' },
      ],
    })),
    executors: [createRuntimeExecutor({ id: 'creator-local', handlers })],
    validators: [
      {
        id: 'creator-analysis',
        version: '1',
        async validate({ outcome, run }) {
          try {
            const input = object(run.input);
            text(input.goal, '自然语言目标');
            contained(root, text(input.installTarget, '安装目标'));
            if (!['codex', 'claude-code'].includes(text(input.host, '宿主')))
              throw new Error('仅支持Codex和Claude Code适配');
            const analysis = object(outcome.output);
            await prepareWorkflowApplicationPlan({
              proposal: analysis.proposal as WorkflowApplicationProposal,
              packageRoot: staging,
              projectRoot: root,
            });
            return { accepted: true };
          } catch (error) {
            return { accepted: false, reason: (error as Error).message };
          }
        },
      },
    ],
    transitionHandlers: [
      {
        id: 'creator-decisions',
        version: '1',
        apply({ run, event }) {
          if (event.kind === 'wait-resolved') {
            if (event.stepId === 'confirm-eval') {
              assertPackage(run);
              assertPlan(run);
              return {
                state: {},
                next: [
                  event.choice === 'evaluate'
                    ? 'evaluate'
                    : event.choice === 'skip'
                      ? 'preview'
                      : 'analyze',
                ],
              };
            }
            if (event.stepId === 'review-eval') {
              assertPackage(run);
              return {
                state: {},
                next: [
                  event.choice === 'retry'
                    ? 'evaluate'
                    : event.choice === 'skip'
                      ? 'preview'
                      : 'analyze',
                ],
              };
            }
            if (event.choice === 'approved') {
              if (event.stepId === 'confirm-plan') assertPlan(run);
              else assertPreview(root, run);
            }
            return {
              state: {},
              next: [
                event.choice === 'rejected'
                  ? 'stop'
                  : event.choice === 'revise'
                    ? 'analyze'
                    : event.stepId === 'confirm-plan'
                      ? 'compile'
                      : 'install',
              ],
            };
          }
          if (event.kind === 'action-outcome') {
            if (event.stepId === 'evaluate')
              return {
                state: {},
                next:
                  event.outcome.status === 'succeeded'
                    ? [object(event.outcome.output).status === 'passed' ? 'preview' : 'review-eval']
                    : [],
              };
            const successor: Record<string, string> = {
              analyze: 'prepare',
              prepare: 'confirm-plan',
              compile: 'verify',
              verify: run.workflow.version === '2' ? 'eval-preview' : 'preview',
              'eval-preview': 'confirm-eval',
              preview: 'confirm-install',
            };
            return {
              state: {},
              next:
                event.outcome.status === 'succeeded' && successor[event.stepId]
                  ? [successor[event.stepId]]
                  : [],
            };
          }
          throw new Error('Creator不支持此事件');
        },
      },
    ],
    async validateOutcome({ action, outcome, run }) {
      if (outcome.status !== 'succeeded' || action.stepId === 'analyze') return { accepted: true };
      try {
        if (['prepare', 'verify', 'preview', 'eval-preview'].includes(action.stepId)) {
          const handler = handlers[action.ref as keyof typeof handlers];
          const expected = await handler.execute(action, undefined, run);
          if (hashRuntimeValue(expected.output) !== hashRuntimeValue(outcome.output))
            reject('回报不能代替当前实际方案、验证或安装预览');
        }
        if (action.stepId === 'evaluate') {
          const prepared = await prepareWorkflowApplicationEval(evaluationRequest(root, run));
          const actual = await readWorkflowApplicationEvalResult(prepared);
          if (!actual || hashRuntimeValue(actual) !== hashRuntimeValue(outcome.output))
            reject('Eval 回报必须来自当前应用的实际固定实验报告');
        }
        if (action.stepId === 'compile') {
          const output = outcome.output as unknown as Package;
          const expectedFile = path.join(
            staging,
            hashRuntimeValue([run.runId, assertPlan(run).planHash]),
            'application.json',
          );
          if (output.file !== expectedFile) reject('编译结果不属于当前创作');
          if (
            output.contentHash !== (await hashWorkflowApplicationPlanContent(assertPlan(run).plan))
          )
            reject('编译字节与已确认实现不匹配');
          const loaded = await loadWorkflowApplication({ file: output.file, projectRoot: root });
          if (
            hashRuntimeValue(loaded.implementation.workflows) !==
            hashRuntimeValue(assertPlan(run).plan.workflows)
          )
            reject('实际流程与当前方案不匹配');
          if (
            output.compositionHash !== assertPlan(run).planHash ||
            applicationFilesHash(files(path.dirname(output.file))) !== output.contentHash
          )
            reject('编译结果不匹配实际文件');
        }
        if (
          action.stepId === 'verify' &&
          object(outcome.output).packageHash !== assertPackage(run).contentHash
        )
          reject('验证结果绑定了错误产物');
        if (action.stepId === 'install') {
          const preview = value<Preview>(run, 'preview');
          if (
            applicationFilesHash(files(contained(root, preview.target))) !== preview.packageHash ||
            object(outcome.output).contentHash !== preview.packageHash
          )
            reject('安装结果不匹配实际文件');
        }
        return { accepted: true };
      } catch (error) {
        return { accepted: false, reason: (error as Error).message };
      }
    },
    async validateRecovery({ action, outcome, run }) {
      try {
        const output = object(outcome.output);
        if (action.stepId === 'compile') {
          const prepared = assertPlan(run);
          const file = text(output.file, '编译文件');
          if (
            output.compositionHash !== prepared.planHash ||
            applicationFilesHash(files(path.dirname(file))) !== output.contentHash
          )
            reject('原编译结果无法核对');
          await loadWorkflowApplication({ file, projectRoot: root });
        } else if (action.stepId === 'evaluate') {
          const prepared = await prepareWorkflowApplicationEval(evaluationRequest(root, run));
          const actual = await readWorkflowApplicationEvalResult(prepared);
          if (!actual || hashRuntimeValue(actual) !== hashRuntimeValue(outcome.output))
            reject('原评估没有可核对的完成报告；核对运行进程与原现场');
        } else if (action.stepId === 'install') {
          const preview = value<Preview>(run, 'preview');
          if (applicationFilesHash(files(contained(root, preview.target))) !== preview.packageHash)
            reject('原安装结果无法核对');
        } else reject('此动作没有外部结果核对能力');
        return { accepted: true };
      } catch (error) {
        return { accepted: false, reason: (error as Error).message };
      }
    },
  });
  return {
    ...runtime,
    start(command) {
      const input = object(command.input);
      text(input.goal, '自然语言目标');
      if (input.evaluation !== undefined)
        normalizeApplicationEvalSettings(input.evaluation as ApplicationEvalSettings);
      contained(root, text(input.installTarget, '安装目标'));
      if (!['codex', 'claude-code'].includes(text(input.host, '宿主')))
        throw new Error(
          '当前创作仅支持Codex和Claude Code宿主适配；保留原输入，选择支持的宿主后继续',
        );
      return runtime.start(command);
    },
  };
}

export function creatorSummary(run: WorkflowRun) {
  return {
    runId: run.runId,
    revision: run.revision,
    status: run.status,
    goal: object(run.input).goal,
    actions: run.actions.filter((a) => ['pending', 'running', 'unknown'].includes(a.status)),
    waits: run.waits.filter((w) => w.status === 'pending'),
    plan: run.outputs.prepare?.value ?? null,
    installationPreview: run.outputs.preview?.value ?? null,
    verification: run.outputs.verify?.value ?? null,
    evaluationPreview: run.outputs['eval-preview']?.value ?? null,
    evaluation: evaluationSummary(run),
    delivered: run.outputs.install?.value ?? null,
    hostEvidence: '本地SDK与应用校验不能代替真实宿主和模型验收。',
  };
}

/** 目录只用于发现Run身份；返回状态仍由SDK校验完整版本历史。 */
export async function listCreatorRuns(projectRoot: string) {
  const root = contained(path.resolve(projectRoot), '.comet/runtime/creator');
  if (!existsSync(root)) return [];
  const runtime = createCreatorRuntime(projectRoot);
  const summaries: ReturnType<typeof creatorSummary>[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('创作存储目录含异常项目；保留现场后修正');
    const directory = path.join(root, entry.name);
    const revisions = (await fs.readdir(directory))
      .filter((name) => /^[0-9]{16}\.json$/u.test(name))
      .sort();
    if (!revisions.length) continue;
    if (lstatSync(path.join(directory, revisions.at(-1)!)).isSymbolicLink())
      throw new Error('创作记录不能是符号链接');
    const record = JSON.parse(await fs.readFile(path.join(directory, revisions.at(-1)!), 'utf8'));
    summaries.push(creatorSummary(await runtime.inspect(text(record.runId, 'Run身份'))));
  }
  return summaries;
}
