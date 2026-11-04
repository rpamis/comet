import type { WorkflowRun } from '../engine/runtime.js';

export type NativeVerifyMode = 'standard' | 'bugfree';

/** Run 输入是唯一策略来源，项目配置变化不能更改已创建的验收策略。 */
export function nativeVerifyMode(run: Pick<WorkflowRun, 'input'>): NativeVerifyMode {
  const value = (run.input as { verifyMode?: unknown }).verifyMode;
  if (value === undefined || value === 'standard') return 'standard';
  if (value === 'bugfree') return value;
  throw new Error('Native verifyMode must be standard or bugfree');
}

export function assertNativeVerifyModeSupported(
  run: Pick<WorkflowRun, 'input'>,
  verifierVersion: string,
): NativeVerifyMode {
  const mode = nativeVerifyMode(run);
  if (mode === 'bugfree' && verifierVersion !== '2') {
    throw new Error('Native bugfree requires its pinned verifier definition');
  }
  return mode;
}
