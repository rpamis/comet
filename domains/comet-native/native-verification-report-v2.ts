import { promises as fs } from 'node:fs';

import { atomicWriteText } from './native-atomic-file.js';
import { nativeLocalizedText, nativeVerificationHeading } from './native-artifact-language.js';
import { NATIVE_SKILL_COORDINATION } from './native-runner-protocol.js';
import type { NativePortableState, NativePortableText } from './native-portable-types.js';

function display(value: NativePortableText | null): string {
  if (value === null) return '—';
  const normalized = value.text.replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
  return `${normalized || '—'}${value.truncated ? ' … (truncated)' : ''}`;
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\r?\n/gu, '<br>');
}

function verdictLabel(state: NativePortableState): string {
  const language = state.language;
  if (state.verification?.assurance === 'semantic-verification-unavailable') {
    return nativeLocalizedText(
      language,
      'Semantic verification unavailable, user confirmation required',
      '语义验证不可用，需要用户确认',
    );
  }
  if (state.verification?.assurance === 'user-confirmed-degraded') {
    return nativeLocalizedText(
      language,
      'Passed with user-confirmed degraded assurance',
      '已通过，但采用了用户确认的降级保证',
    );
  }
  if (state.verification_result === 'pass') {
    return nativeLocalizedText(
      language,
      state.phase === 'verify' && state.loop.next_action === 'confirm-skill-coordinated-pass'
        ? 'Passed, user confirmation required'
        : 'Passed',
      state.phase === 'verify' && state.loop.next_action === 'confirm-skill-coordinated-pass'
        ? '已通过，需要用户确认'
        : '已通过',
    );
  }
  if (state.verification_result === 'blocked') {
    return nativeLocalizedText(language, 'Blocked', '已阻塞');
  }
  if (state.verification_result === 'fail') {
    return nativeLocalizedText(language, 'Failed', '未通过');
  }
  return nativeLocalizedText(language, 'Pending', '待处理');
}

function assuranceLabel(state: NativePortableState): string {
  const assurance =
    state.verification?.assurance ??
    (state.builder_handoff?.identity_provider === NATIVE_SKILL_COORDINATION
      ? NATIVE_SKILL_COORDINATION
      : 'host-attested');
  if (state.language === 'en') return assurance;
  return (
    (
      {
        'host-attested': '宿主验证',
        'skill-coordinated': 'Skill 协同',
        'semantic-verification-unavailable': '语义验证不可用',
        'user-confirmed-degraded': '用户确认的降级保证',
      } as Record<string, string>
    )[assurance] ?? assurance
  );
}

export function renderNativeVerificationReport(state: NativePortableState): string {
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

  return `---
generated_from_state_version: ${state.state_version}
---

# ${heading('verification')}

## ${heading('currentResult')}

- ${localized('Result', '结果')}: **${verdictLabel(state)}**
- ${localized('Assurance', '保证级别')}: **${assuranceLabel(state)}**
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
}): Promise<void> {
  await atomicWriteText(options.file, renderNativeVerificationReport(options.state));
}
