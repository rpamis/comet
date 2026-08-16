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

export function renderNativeVerificationReport(
  state: NativePortableState,
  supervisor?: NativeSupervisorState,
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
      ? `_${localized('No Runtime checks were recorded.', '没有记录 Runtime 检查。')}_`
      : [
          `| ${localized('Check', '检查')} | ${localized('Command', '命令')} | ${localized('Working directory', '工作目录')} | ${localized('Status', '状态')} | ${localized('Exit', '退出码')} | ${localized('Duration', '耗时')} |`,
          '| --- | --- | --- | --- | ---: | ---: |',
          ...state.verification.checks.map((check) => {
            const command = check.argv_display.map(display).join(' ');
            return `| ${tableCell(display(check.name))} | ${tableCell(command || '—')} | ${tableCell(check.cwd_ref)} | ${check.status} | ${check.exit_code ?? '—'} | ${check.duration_ms} ms |`;
          }),
        ].join('\n');
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

- ${localized('Result', '结果')}: **${verdictLabel(state)}**
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
}): Promise<void> {
  await atomicWriteText(
    options.file,
    renderNativeVerificationReport(options.state, options.supervisor),
  );
}
