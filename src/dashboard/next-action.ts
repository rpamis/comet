import type { ChangePhase, NextAction, TasksSummary, VerifySummary } from './types.js';

const PHASE_COMMAND: Record<ChangePhase, string | null> = {
  open: '/comet-open',
  design: '/comet-design',
  build: '/comet-build',
  verify: '/comet-verify',
  archive: '/comet-archive',
  unknown: null,
};

interface NextActionInput {
  phase: ChangePhase;
  tasks: TasksSummary;
  verify: VerifySummary;
}

/**
 * Recommend a next slash-command for an active change. Combines the phase
 * with task / verify state so the reason text matches what the user will
 * actually see when they run the command.
 *
 * Returns `null` for archived changes — the dashboard surfaces an archive
 * summary in that case instead of a next-action card.
 */
export function recommendNextAction(input: NextActionInput): NextAction {
  const command = PHASE_COMMAND[input.phase];

  if (input.verify.result === 'fail') {
    return {
      command: '/comet-verify',
      reason: '最近一次 verify 失败。',
      description: '先打开 verify-result.md 逐项修复失败用例，再重新运行 /comet-verify。',
    };
  }

  if (input.phase === 'unknown') {
    return {
      command: null,
      reason: '当前 change 的 phase 未知。',
      description: '检查 .comet.yaml 是否完整；可能需要重新运行 /comet-open 重新初始化状态。',
    };
  }

  if (input.phase === 'build') {
    const remaining = input.tasks.total - input.tasks.completed;
    if (remaining > 0) {
      return {
        command,
        reason: `当前处于 Build 阶段，还有 ${remaining} 个任务未完成。`,
        description: '继续完成 tasks.md 中剩余任务后再进入 verify。',
      };
    }
    return {
      command: '/comet-verify',
      reason: 'Build 任务已完成。',
      description: '可以运行 /comet-verify 验证实现。',
    };
  }

  if (input.phase === 'verify') {
    if (input.verify.result === 'pass') {
      return {
        command: '/comet-archive',
        reason: 'Verify 已通过。',
        description: '可以运行 /comet-archive 进入归档流程。',
      };
    }
    return {
      command,
      reason: 'Verify 尚未完成。',
      description: '运行 /comet-verify 生成验证报告。',
    };
  }

  if (input.phase === 'archive') {
    return {
      command,
      reason: '当前 change 已进入归档阶段。',
      description: '运行 /comet-archive 完成归档。',
    };
  }

  if (input.phase === 'design') {
    return {
      command,
      reason: '当前 change 仍处于 Design 阶段。',
      description: '运行 /comet-design 推进设计，产出 tasks.md 和 plan.md。',
    };
  }

  // phase === 'open'
  return {
    command,
    reason: '当前 change 处于 Open 阶段。',
    description: '运行 /comet-open 完成初始化或继续推进到 design。',
  };
}
