import type { NativePortableState } from './native-portable-types.js';
import { taskContextRequest } from '../workflow-contract/task-context.js';

/** 只描述宿主何时获取上下文；不在状态读取或 Guard 中执行检索。 */
export function nativeTaskContextRequest(options: {
  phase: NativePortableState['phase'];
  language: NativePortableState['language'];
  projectRoot?: string;
  sessionId?: string;
  name?: string;
}) {
  return taskContextRequest({
    ...options,
    workflow: 'native',
    change: options.name,
    instruction:
      options.language === 'zh-CN'
        ? '原始请求缺失时从当前 brief 恢复目标。向 Builder、Verifier 或子任务交接时不转交 Builder 的自评结论，保留独立只读验收要求。'
        : 'Recover a missing task goal from the current brief. Hand off to the Builder, Verifier or child without Builder self-assessment, preserving independent read-only verification.',
  });
}
