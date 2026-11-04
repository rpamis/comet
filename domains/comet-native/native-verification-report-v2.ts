import type { NativeVerifyMode } from './native-verification-policy.js';
import { promises as fs } from 'node:fs';

import { atomicWriteText } from './native-atomic-file.js';
import { nativeLocalizedText, nativeVerificationHeading } from './native-artifact-language.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type { NativePortableState, NativePortableText } from './native-portable-types.js';
import type { NativeSupervisorState } from './native-supervisor.js';

function display(value: NativePortableText | null): string {
  if (value === null) return '—';
  const normalized = value.text.replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
  return `${normalized || '—'}${value.truncated ? ' … (truncated)' : ''}`;
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/gu, '<br>');
}

function passedVerdictLabel(state: NativePortableState): string {
  if (state.archived) {
    return nativeLocalizedText(state.language, 'Archived', '已归档');
  }
  if (state.phase === 'verify' && state.loop.next_action === 'confirm-skill-coordinated-pass') {
    return nativeLocalizedText(
      state.language,
      'Verification passed; your confirmation is required',
      '验收通过，需要你确认',
    );
  }
  if (state.phase === 'archive' && state.loop.next_action === 'archive') {
    return nativeLocalizedText(
      state.language,
      'Verification passed; ready to archive',
      '验收通过，可归档',
    );
  }
  return nativeLocalizedText(state.language, 'Verification passed', '验收通过');
}

function verdictLabel(state: NativePortableState): string {
  const language = state.language;
  if (state.verification?.assurance === 'semantic-verification-unavailable') {
    return nativeLocalizedText(
      language,
      'Full verification was unavailable; only automatic checks completed',
      '无法完成完整验证，只完成了自动检查',
    );
  }
  if (state.verification_result === 'pass') {
    return passedVerdictLabel(state);
  }
  if (state.verification_result === 'blocked') {
    return nativeLocalizedText(language, 'Blocked', '已阻塞');
  }
  if (state.verification_result === 'fail') {
    return nativeLocalizedText(language, 'Failed', '未通过');
  }
  return nativeLocalizedText(language, 'Pending', '待处理');
}

function verificationStatusLabel(state: NativePortableState): string {
  if (state.verification?.assurance === 'semantic-verification-unavailable') {
    return nativeLocalizedText(
      state.language,
      'Full verification was unavailable; only automatic checks completed',
      '无法完成完整验证，只完成了自动检查',
    );
  }
  if (state.verification_result === 'fail') {
    return nativeLocalizedText(
      state.language,
      'Fix unresolved acceptance criteria and verify again',
      '修复未通过的验收项后重新验证',
    );
  }
  if (state.verification_result === 'blocked') {
    return nativeLocalizedText(
      state.language,
      'Resolve the reported blockers and resume verification',
      '解决报告中的阻塞项后恢复验证',
    );
  }
  const assurance =
    state.verification?.assurance ??
    (state.builder_handoff?.identity_provider === NATIVE_SKILL_COORDINATION
      ? NATIVE_SKILL_COORDINATION
      : 'host-attested');
  const skillCoordinationConfirmed =
    assurance === NATIVE_SKILL_COORDINATION &&
    (state.archived || (state.phase === 'archive' && state.loop.next_action === 'archive'));
  const labels =
    state.language === 'en'
      ? {
          'host-attested': 'Host independently verified',
          'skill-coordinated': skillCoordinationConfirmed
            ? 'Checks completed; result confirmed'
            : 'Checks completed, but your confirmation is required',
          'semantic-verification-unavailable':
            'Full verification was unavailable; only automatic checks completed',
          'user-confirmed-degraded': 'You accepted the incomplete verification result',
        }
      : {
          'host-attested': '已完成独立验证',
          'skill-coordinated': skillCoordinationConfirmed
            ? '已完成检查，验证结果已确认'
            : '已完成检查，但需要你确认验证结果',
          'semantic-verification-unavailable': '无法完成完整验证，只完成了自动检查',
          'user-confirmed-degraded': '你已确认接受不完整验证结果',
        };
  return labels[assurance as keyof typeof labels] ?? assurance;
}

export interface NativePreviousCheckFailure {
  actionId: string;
  candidateId: string;
  checkId: string;
  name: string;
  status: string;
  exitCode: number | null;
  logRef: string;
  currentCheck: 'executed' | 'reused' | 'not-run';
}

export interface NativeCheckSource {
  actionId: string;
  candidateId: string;
  checkId: string;
  logRef: string;
  reusedFrom?: {
    actionId: string;
    attempt: number;
    candidateId: string;
    checkId: string;
  };
}

export function renderNativeVerificationReport(
  state: NativePortableState,
  supervisor?: NativeSupervisorState,
  verifyMode: NativeVerifyMode = 'standard',
  previousCheckFailures: readonly NativePreviousCheckFailure[] = [],
  checkSources: readonly NativeCheckSource[] = [],
): string {
  if (state.verification === null) {
    throw new Error('Native verification report requires a stable Verifier result');
  }
  const language = state.language;
  const heading = (section: Parameters<typeof nativeVerificationHeading>[1]) =>
    nativeVerificationHeading(language, section);
  const localized = (english: string, chinese: string) =>
    nativeLocalizedText(language, english, chinese);
  const acceptance = state.acceptance
    .map(
      (entry) =>
        `| ${tableCell(entry.id)} | ${tableCell(entry.result)} | ${tableCell(entry.source)} | ${tableCell(entry.text)} | ${tableCell(display(entry.reason))} |`,
    )
    .join('\n');
  const checks =
    state.verification.checks.length === 0
      ? `_${localized('No Runtime checks were recorded.', verifyMode === 'bugfree' ? '本轮未执行命令检查。' : '没有记录 Runtime 检查。')}_`
      : [
          `| ${localized('Check', '检查')} | ${localized('Command', '命令')} | ${localized('Working directory', '工作目录')} | ${localized('Status', '状态')} | ${localized('Exit', '退出码')} | ${localized('Duration', '耗时')} |`,
          '| --- | --- | --- | --- | ---: | ---: |',
          ...state.verification.checks.map((check) => {
            const command = check.argv_display.map(display).join(' ');
            return `| ${tableCell(display(check.name))} | ${tableCell(command || '—')} | ${tableCell(check.cwd_ref)} | ${check.status} | ${check.exit_code ?? '—'} | ${check.duration_ms} ms |`;
          }),
        ].join('\n');
  const sources =
    verifyMode === 'bugfree' && checkSources.length > 0
      ? [
          `### ${localized('Check execution sources', '检查执行来源')}`,
          '',
          ...checkSources.map(
            (check) =>
              `- ${tableCell(check.checkId)}: ${check.reusedFrom ? localized('Reused; not executed again.', '复用记录，本轮未重新执行。') : localized('Executed for this candidate.', '本轮实际执行。')} Action=${check.actionId}; ${localized('candidate', '候选')}=${check.candidateId}; ${localized('log', '日志')}=${check.logRef}${check.reusedFrom ? `; ${localized('original source', '原执行来源')}=${check.reusedFrom.actionId}, attempt=${check.reusedFrom.attempt}, candidate=${check.reusedFrom.candidateId}, check=${check.reusedFrom.checkId}` : ''}`,
          ),
          '',
        ].join('\n')
      : '';
  const previousFailures =
    previousCheckFailures.length === 0
      ? ''
      : [
          `### ${localized('Previous candidate check failures', '前轮候选检查失败')}`,
          '',
          localized(
            'These executions failed on previous candidates. Their original results are retained; current semantic acceptance does not turn them into passed checks.',
            '这些检查在前轮候选中失败。原结果保留；当前语义验收通过不会把它们改写为检查通过。',
          ),
          '',
          ...previousCheckFailures.map(
            (check) =>
              `- ${tableCell(check.name)} (${check.checkId}): ${check.status}; exit=${check.exitCode ?? '—'}; ${localized('candidate', '候选')}=${check.candidateId}; Action=${check.actionId}; ${localized('log', '日志')}=${check.logRef}; ${check.currentCheck === 'executed' ? localized('A matching command was run for the current candidate; see its actual result above.', '当前候选执行了相同命令，实际结果见上表。') : check.currentCheck === 'reused' ? localized('The current candidate reused a matching check receipt; it was not run again.', '当前候选复用了相同命令的检查凭据，本轮未重新执行。') : localized('Not rerun for the current candidate.', '本轮未重跑。')}`,
          ),
          '',
        ].join('\n');
  const builderEvidence = state.builder_handoff
    ? [
        `### ${localized('Builder-reported evidence', 'Builder 报告的证据')}`,
        '',
        localized(
          'These are Builder reports, not Runtime check receipts or independent verification results.',
          '以下为 Builder 报告，不等同于 Runtime 检查凭据或独立验收结果。',
        ),
        '',
        ...state.builder_handoff.checks.map(
          (check) => `- ${display(check.name)}: ${check.result} — ${display(check.note)}`,
        ),
        ...(state.builder_handoff.checks_truncated
          ? [localized('Check list was truncated.', '检查列表已截断。')]
          : []),
        ...state.builder_handoff.known_limits.map(
          (limit) => `- ${localized('Known limitation', '已知限制')}: ${display(limit)}`,
        ),
        ...(state.builder_handoff.known_limits_truncated
          ? [localized('Limitations list was truncated.', '限制列表已截断。')]
          : []),
      ].join('\n')
    : '';
  const blockers =
    state.blockers.length === 0
      ? `_${localized('None.', '无。')}_`
      : state.blockers
          .map(
            (blocker) =>
              `- **${blocker.owner}**: ${display(blocker.reason)}${
                blocker.acceptance_ids.length > 0
                  ? ` (acceptance: ${blocker.acceptance_ids.join(', ')})`
                  : ''
              } — next: \`${blocker.resolution_action}\``,
          )
          .join('\n');
  const risks =
    state.verification.risks.length === 0
      ? `_${localized('None reported.', '未报告风险。')}_`
      : state.verification.risks.map((risk) => `- ${display(risk)}`).join('\n');
  const history =
    state.history.length === 0
      ? `_${localized('No previous iterations.', '没有之前的迭代。')}_`
      : [
          `| ${localized('Goal cycle', '目标周期')} | ${localized('Iteration', '迭代')} | ${localized('Attempt', '尝试')} | ${localized('Outcome', '结果')} | ${localized('Unresolved', '未解决项')} | ${localized('Summary', '摘要')} | ${localized('Completed', '完成时间')} |`,
          '| ---: | ---: | ---: | --- | --- | --- | --- |',
          ...state.history.map(
            (entry) =>
              `| ${entry.goal_cycle} | ${entry.iteration} | ${entry.attempt} | ${entry.outcome} | ${entry.unresolved_ids.join(', ') || '—'} | ${tableCell(display(entry.summary))} | ${entry.completed_at} |`,
          ),
        ].join('\n');

  const supervisorEvidence = supervisor?.finalVerification.layers
    ? `
## ${localized('Supervisor evidence layers', 'Supervisor 分层证据')}

- ${localized('Child verification', 'Child 验证')}: ${supervisor.finalVerification.layers.childVerification}
- ${localized('Parent integration', '父级集成')}: ${supervisor.finalVerification.layers.parentIntegration}
- ${localized('Parent checks', '父级检查')}: ${supervisor.finalVerification.layers.parentChecks.join(', ') || '—'}
- ${localized('Not rerun', '未重跑')}: ${supervisor.finalVerification.layers.notRerun.join(', ') || '—'}
- ${localized('Incomplete', '未完成')}: ${supervisor.finalVerification.layers.incomplete.join(', ') || '—'}
`
    : '';
  return `---
generated_from_state_version: ${state.state_version}
---

# ${heading('verification')}

## ${heading('currentResult')}

${verifyMode === 'bugfree' ? `- ${localized('Verification mode', '验证模式')}: bugfree\n- ${localized('Method', '方法')}: ${localized('Independent semantic review with checks as needed.', '独立语义审查，按需执行检查。')}\n` : ''}- ${localized('Result', '结果')}: **${verdictLabel(state)}**
- ${localized('Verification status', '验证情况')}: **${verificationStatusLabel(state)}**
- ${localized('Goal cycle', '目标周期')}: ${state.loop.goal_cycle}
- ${localized('Iteration', '迭代')}: ${state.verification.iteration}
- ${localized('Verifier attempt', '验证器尝试次数')}: ${state.verification.attempt}
- ${localized('Completed', '完成时间')}: ${state.verification.completed_at}
- ${localized('Summary', '摘要')}: ${display(state.verification.summary)}

## ${heading('acceptance')}

| ${localized('ID', '编号')} | ${localized('Result', '结果')} | ${localized('Source', '来源')} | ${localized('Criterion', '验收项')} | ${localized('Reason', '原因')} |
| --- | --- | --- | --- | --- |
${acceptance}

## ${heading('checks')}

${checks}

${sources}${previousFailures}${builderEvidence}

## ${heading('blockers')}

${blockers}

## ${heading('risks')}

${risks}

## ${heading('previousIterations')}

${history}

${supervisorEvidence}

${
  state.history_overflow.dropped_entries > 0
    ? `${localized('Earlier history entries folded into summary', '更早的历史记录已折叠到摘要中')}: ${state.history_overflow.dropped_entries}.\n\n`
    : ''
}## ${heading('conclusion')}

${display(state.verification.summary)}
`;
}

export function nativeVerificationReportStateVersion(source: string): number | null {
  const match = /^---\r?\ngenerated_from_state_version: ([1-9]\d*)\r?\n---(?:\r?\n|$)/u.exec(
    source,
  );
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export async function inspectNativeVerificationReportAlignment(options: {
  file: string;
  stateVersion: number;
}): Promise<'aligned' | 'missing' | 'stale' | 'invalid'> {
  let source: string;
  try {
    source = await fs.readFile(options.file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
  const version = nativeVerificationReportStateVersion(source);
  if (version === null) return 'invalid';
  return version === options.stateVersion ? 'aligned' : 'stale';
}

export async function writeNativeVerificationReport(options: {
  file: string;
  state: NativePortableState;
  supervisor?: NativeSupervisorState;
  verifyMode?: NativeVerifyMode;
  previousCheckFailures?: readonly NativePreviousCheckFailure[];
  checkSources?: readonly NativeCheckSource[];
  beforeCommit?: () => void | Promise<void>;
}): Promise<void> {
  await atomicWriteText(
    options.file,
    renderNativeVerificationReport(
      options.state,
      options.supervisor,
      options.verifyMode,
      options.previousCheckFailures,
      options.checkSources,
    ),
    { beforeCommit: options.beforeCommit },
  );
}
