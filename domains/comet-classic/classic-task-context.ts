import { taskContextRequest } from '../workflow-contract/task-context.js';
import type { ClassicState } from './classic-state.js';

export function classicTaskContextRequest(
  state: ClassicState,
  projectRoot: string,
  sessionId?: string,
  change?: string,
) {
  return taskContextRequest({
    workflow: 'classic',
    change,
    phase: state.phase,
    language: state.language ?? 'en',
    projectRoot,
    sessionId,
    instruction:
      state.language === 'zh-CN'
        ? '原始请求缺失时从当前 proposal、specs 和任务范围恢复目标。子代理接收本阶段、任务范围和此请求后，以自己的会话标识获取上下文。偏好与已确认的执行方式、TDD 或审查配置冲突时说明差异，配置变更仍走现有确认流程；不静默替换固定 Skill 或跳过必需审查。记忆不写入设计交接产物或批准哈希。'
        : 'Recover a missing task goal from the current proposal, specs and task scope. Give child Agents this phase, scope and request; each receiver retrieves context with its own session ID. Explain conflicts with confirmed execution, TDD or review configuration; change configuration through its existing approval flow. Do not silently replace fixed Skills or skip required reviews. Keep memory out of design handoff artifacts and approval hashes.',
  });
}
