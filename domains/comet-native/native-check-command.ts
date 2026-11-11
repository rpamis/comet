import {
  assertNoArguments,
  success,
  requiredPositional,
  type DispatchResult,
} from './native-cli-shared.js';
export async function nativeCheckCommand(
  args: string[],
  _projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  return success('check', {
    name,
    status: 'platform-execution-required',
    checksExecuted: false,
    next: '使用 Agent 平台工具执行实际检查，并按 comet native next 返回的任务模板报告结果。',
  });
}
