import {
  assertNoArguments,
  NativeUsageError,
  requiredPositional,
  type DispatchResult,
} from './native-cli-shared.js';
export async function nativeCheckCommand(
  args: string[],
  _projectRoot: string,
): Promise<DispatchResult> {
  const name = requiredPositional(args, 'change name');
  assertNoArguments(args);
  throw new NativeUsageError(
    'Native 内容证明检查已移除。运行 comet native status ' +
      name +
      ' --json，按原 Run 的 continuation 执行实际检查；旧需求通过 comet native next ' +
      name +
      ' --summary <迁移说明> 使用现有迁移入口。',
  );
}
