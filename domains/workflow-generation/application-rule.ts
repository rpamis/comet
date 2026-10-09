import type { DefineWorkflowOptions } from '../engine/runtime.js';
import type { WorkflowApplicationManifest } from '../workflow-application/index.js';

/** 规则描述已装配图；推进与批准仍由同一 SDK Run 核对。 */
export function renderApplicationRule(
  manifest: WorkflowApplicationManifest,
  workflows: readonly DefineWorkflowOptions[],
): string {
  const rows = workflows.flatMap((workflow) =>
    Object.entries(workflow.steps).map(([id, step]) => {
      const bindings = manifest.bindings.filter(
        (binding) => binding.workflowId === workflow.id && binding.stepId === id,
      );
      const writers = bindings.filter(
        (binding) =>
          manifest.skills.find((skill) => skill.id === binding.skillId)?.adapter.sideEffect ===
          'write',
      );
      const scope = writers.flatMap(
        (binding) =>
          manifest.skills.find((skill) => skill.id === binding.skillId)?.adapter.scope ?? [],
      );
      return `| ${workflow.id}/${id} | ${step.type} | ${bindings.map((binding) => binding.skillId).join(', ') || '—'} | ${scope.join(', ') || '只读或 Runtime 本地端口'} | ${writers.map((binding) => binding.authorizationFrom ?? '由子流程确认').join(', ') || '按当前 Action/Wait'} |`;
    }),
  );
  return `# ${manifest.id} 应用规则

固定应用 ${manifest.id}@${manifest.version}；Runtime ${manifest.runtimeVersion}；基础流程 ${manifest.base}。Skill 入口与 Runtime 属于同一应用，SDK Run 是进度、执行尝试、批准与恢复的唯一依据。

## 当前工作与批准

开始和恢复时读取 Runtime 当前响应，沿同一 Run 的 Action 或 Wait 继续。核对 application 身份、固定 Skill 摘要、actionId/attempt/inputHash 或 waitId/proposalHash；来源不匹配时恢复原固定资源。
ask_user 只提交用户对当前提案的真实决定。审批发生在等待点，Skill 加载或自报完成不构成用户批准。内容、范围或执行上下文变化后处理新的确认，不沿用旧决定。

## 实际步骤

| 步骤 | 类型 | 固定 Skill | 声明的写入范围 | 批准来源 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## 写入与证据

在当前 Action 领取完成后执行其工作。SDK 默认 Guard 只允许已批准、当前 running Action 的声明写入范围，并核对同一应用子流程与实际工作区。pending、unknown、验证及等待决定期间不扩大实现权限。业务额外 Guard 在 SDK 控制资源保护与声明权限内增加约束。
运行时状态、选择记录、固定应用包与宿主配置通过正式 Runtime 或安装入口维护。临时请求放在 .comet/requests/*.json；过程证据放在 .comet/evidence/${manifest.id}/。这些文件不代替 Runtime 状态、实际检查或独立审查。
执行端口完成实际工作后回传原 Action 的真实结果与工件。Schema、验证器或摘要拒绝时保留结果与文件，修正后继续原动作；状态字符串不能代替实际业务验收。

## 恢复与宿主

未知执行先核对原结果，保留原执行者、attempt、inputHash 和 claimToken，不以断连当作未执行。冷恢复读取同一 SDK Run，已完成动作与批准不重复执行。已结束 Run 的声明产物保持固定；继续修改时启动新的 Run。
正式安装预览包括 Skill、Rule、共享 Hook Router 和平台配置。只安装当前被明确批准的预览，配置漂移、用户文件冲突或链接导致范围不明时保留现场。平台不支持 Hook 或仍需要启用/信任时如实说明。
规则文本、配置安装、实际 Hook 调用、SDK Run 和业务测试分别提供证据。Hook 只覆盖宿主投递的事件范围，不能将文件复制或一次模型运行称为所有平台完整验收。
`;
}
