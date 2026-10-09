import path from 'node:path';
import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import {
  assertApplicationSkillAction,
  assertApplicationSkillExecutionScope,
} from './skill-executor.js';
import type {
  AdaptedSkill,
  ApplicationSkillBinding,
  WorkflowApplicationImplementation,
  WorkflowApplicationManifest,
} from './types.js';

type Options = {
  projectRoot: string;
  packageRoot: string;
  manifest: WorkflowApplicationManifest;
  skills: ReadonlyMap<string, AdaptedSkill>;
  readChild(runId: string): Promise<WorkflowRun>;
  custom?: WorkflowApplicationImplementation['inspectHook'];
};
function contains(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return (
    !relative ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}
function workspace(
  options: Options,
  binding: ApplicationSkillBinding,
  action?: RuntimeAction,
): string {
  if (!binding.workspaceFrom) return options.projectRoot;
  let value: unknown = action?.input;
  for (const segment of binding.workspaceFrom.split('.'))
    value =
      value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
  if (typeof value !== 'string' || !path.isAbsolute(value))
    throw new Error('当前 Action 缺少已声明的实际写入工作区');
  return value;
}

/** 新 SDK 应用的通用保护；业务 Guard 在声明的写入权限内增加约束。 */
export function createApplicationHook(
  options: Options,
): NonNullable<WorkflowApplicationImplementation['inspectHook']> {
  const root = path.resolve(options.projectRoot);
  const trees = [
    '.git',
    'node_modules',
    '.claude',
    '.agents',
    '.codex',
    '.cursor',
    '.comet/runtime',
    '.comet/applications',
    '.comet/creator',
  ].map((ref) => path.resolve(root, ref));
  const application = { manifest: options.manifest, skills: options.skills };
  const instructions = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md'].map((ref) =>
    path.join(root, ref),
  );
  const writes = options.manifest.bindings.filter(
    (binding) =>
      binding.usage === 'action' &&
      options.skills.get(binding.skillId)?.adapter.sideEffect === 'write',
  );
  const scopedSkills = options.manifest.bindings.some((binding) => binding.usage === 'action');
  return async (run, request) => {
    if (request.intent !== 'write')
      return { allowed: true, reason: '此请求没有可归属的 SDK 应用写入' };
    try {
      if (!request.targets.length) throw new Error('SDK 应用写入必须声明实际文件');
      const targets: string[] = [];
      for (const target of request.targets) {
        const absolute = path.resolve(root, target);
        const relative = path.relative(root, absolute);
        if (!relative || !contains(root, absolute)) throw new Error('写入目标必须位于当前项目内');
        await inspectProtectedProjectPath(root, relative.replaceAll('\\', '/'), {
          expected: 'file',
          label: 'SDK 应用写入',
        });
        if (
          contains(path.resolve(options.packageRoot), absolute) ||
          trees.some((tree) => contains(tree, absolute)) ||
          instructions.some((file) => !path.relative(file, absolute)) ||
          !path.relative(path.join(root, '.comet/current-change.json'), absolute)
        )
          throw new Error('固定应用、SDK 状态与宿主配置只能由正式 Runtime 或安装入口维护');
        targets.push(absolute);
      }
      const requests = path.join(root, '.comet/requests');
      if (targets.every((target) => contains(requests, target) && target.endsWith('.json')))
        return { allowed: true, reason: '临时协议请求不是推进状态；Runtime 仍核对身份与批准' };
      const runs: WorkflowRun[] = [];
      const seen = new Set<string>();
      const visit = async (current: WorkflowRun) => {
        if (seen.has(current.runId) || seen.size >= 128)
          throw new Error('子流程归属循环或超出安全读取范围');
        seen.add(current.runId);
        runs.push(current);
        for (const child of current.children) {
          const action = current.actions.find((candidate) => candidate.id === child.actionId);
          if (!action || action.type !== 'child_workflow')
            throw new Error('子流程与 SDK Action 归属不一致');
          if (!action.claim) continue;
          const state = await options.readChild(child.runId);
          if (
            state.workflow.id !== child.workflow.id ||
            state.workflow.version !== child.workflow.version ||
            !state.lineage.includes(current.runId)
          )
            throw new Error('子流程没有当前 SDK Run 的有效归属');
          await visit(state);
        }
      };
      await visit(run);
      const terminal = ['completed', 'cancelled', 'failed'].includes(run.status);
      const permitted: string[] = [];
      const owned: string[] = [];
      for (const current of runs)
        for (const binding of writes.filter(
          (binding) => binding.workflowId === current.workflow.id,
        )) {
          const skill = options.skills.get(binding.skillId)!;
          const actions = current.actions.filter((action) => action.stepId === binding.stepId);
          for (const action of actions) {
            const base = workspace(options, binding, action);
            owned.push(...skill.adapter.scope.map((ref) => path.resolve(base, ref)));
            if (
              terminal ||
              ['cancelled', 'failed'].includes(current.status) ||
              action.status !== 'running'
            )
              continue;
            assertApplicationSkillAction(application, action, current);
            assertApplicationSkillExecutionScope(application, current, action);
            permitted.push(...skill.adapter.scope.map((ref) => path.resolve(base, ref)));
          }
          if (!binding.workspaceFrom && !actions.length)
            owned.push(...skill.adapter.scope.map((ref) => path.resolve(root, ref)));
        }
      const evidence = path.join(root, '.comet/evidence', options.manifest.id);
      const canRecord =
        !terminal &&
        runs.some((current) =>
          current.actions.some((action) => ['running', 'unknown'].includes(action.status)),
        );
      for (const target of targets) {
        if (contains(requests, target) && target.endsWith('.json')) continue;
        if (canRecord && contains(evidence, target)) continue;
        if (terminal) {
          if (
            owned.some((scope) => contains(scope, target)) ||
            contains(path.join(root, '.comet'), target)
          )
            throw new Error('已结束 Run 的声明产物保持固定；继续修改应启动新的 Run');
        } else if (
          (!options.custom || scopedSkills) &&
          !permitted.some((scope) => contains(scope, target))
        )
          throw new Error('当前 SDK Action 没有此写入权限；先确认当前提案并领取允许写入的 Action');
      }
      if (options.custom) return await options.custom(run, request);
      return {
        allowed: true,
        reason: terminal
          ? '目标不属于已结束应用或控制资源'
          : '写入属于当前已批准且已领取的 SDK Action',
      };
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : '无法安全核对 SDK 应用写入',
      };
    }
  };
}
