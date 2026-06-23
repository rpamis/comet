import type {
  ArtifactsSummary,
  ChangeDashboardItem,
  ChangePhase,
  DashboardRisk,
  GitSnapshot,
  TasksSummary,
  VerifySummary,
} from './types.js';

interface ChangeRiskInput {
  status: 'active' | 'archived';
  phase: ChangePhase;
  hasCometYaml: boolean;
  tasks: TasksSummary;
  verify: VerifySummary;
  artifacts: ArtifactsSummary;
  archiveMetadataKnown?: boolean;
}

/**
 * Risk rules per the dashboard PRD. Each rule is independent so the same
 * change can surface several risks at once (e.g. failed verify + missing
 * artifact). Codes are stable identifiers for the frontend / future API
 * consumers.
 */
export function buildChangeRisks(input: ChangeRiskInput): DashboardRisk[] {
  const risks: DashboardRisk[] = [];

  if (!input.hasCometYaml) {
    risks.push({
      level: 'warning',
      code: 'MISSING_COMET_YAML',
      message: '该 change 缺少 .comet.yaml，无法判定准确状态。',
      suggestion: '运行 /comet-open 或手动补齐 .comet.yaml。',
    });
  }

  if (input.phase === 'unknown') {
    risks.push({
      level: 'warning',
      code: 'UNKNOWN_PHASE',
      message: '当前 change 的 phase 未知。',
      suggestion: '检查 .comet.yaml 的 phase 字段，或重新运行对应阶段命令。',
    });
  }

  if (!input.artifacts.tasks) {
    risks.push({
      level: 'warning',
      code: 'TASKS_MISSING',
      message: '未找到 tasks.md，任务进度无法统计。',
      suggestion: '在 change 目录下创建 tasks.md 并填入任务清单。',
    });
  } else if (input.status === 'active' && input.tasks.total > 0) {
    const remaining = input.tasks.total - input.tasks.completed;
    if (remaining > 0) {
      risks.push({
        level: 'warning',
        code: 'TASKS_INCOMPLETE',
        message: `仍有 ${remaining} 个任务未完成。`,
        suggestion: '继续执行 /comet-build 完成剩余任务后再进入 verify。',
      });
    }
  }

  if (input.verify.result === 'fail') {
    risks.push({
      level: 'error',
      code: 'VERIFY_FAILED',
      message: '最近一次 verify 失败。',
      suggestion: '打开 verify-result.md 修复失败项后重新运行 /comet-verify。',
    });
  } else if (input.status === 'active' && input.verify.result === 'pending') {
    risks.push({
      level: 'info',
      code: 'VERIFY_PENDING',
      message: '验证尚未执行或报告未生成。',
      suggestion: '完成 build 任务后运行 /comet-verify。',
    });
  }

  const missingArtifacts: string[] = [];
  if (!input.artifacts.proposal) missingArtifacts.push('proposal.md');
  if (!input.artifacts.design) missingArtifacts.push('design.md');
  if (!input.artifacts.plan) missingArtifacts.push('plan.md');
  if (missingArtifacts.length > 0) {
    risks.push({
      level: 'info',
      code: 'ARTIFACT_MISSING',
      message: `缺少关键产物：${missingArtifacts.join(', ')}。`,
      suggestion: '按当前 phase 补齐对应产物。',
    });
  }

  if (input.status === 'archived' && input.archiveMetadataKnown === false) {
    risks.push({
      level: 'info',
      code: 'ARCHIVE_METADATA_MISSING',
      message: '归档目录名不符合 YYYY-MM-DD-<name> 规范，无法推断 archivedAt。',
      suggestion: '后续归档时遵守标准命名，或在 .comet.yaml 中记录 archived_at。',
    });
  }

  return risks;
}

interface ProjectRiskInput {
  git: GitSnapshot;
  changes: ChangeDashboardItem[];
}

export function buildProjectRisks(input: ProjectRiskInput): DashboardRisk[] {
  const risks: DashboardRisk[] = [];

  if (input.git.dirtyFiles > 0) {
    risks.push({
      level: 'warning',
      code: 'GIT_DIRTY',
      message: `当前 repo 有 ${input.git.dirtyFiles} 个未提交文件。`,
      suggestion: '在 verify / archive 前复核 git diff。',
    });
  }

  return risks;
}
