import { describe, expect, it } from 'vitest';
import { cliHumanTextViolations } from '../../../domains/workflow-contract/output-envelope.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  CLASSIC_HUMAN_TEXT_DENYLIST,
  classicArchiveEnvelope,
  classicEntryCheckEnvelope,
  classicGuardCheckEnvelope,
  classicGuardUserMessage,
  classicHandoffEnvelope,
  classicLocale,
  classicNextEnvelope,
  classicPhasePhrase,
  classicRecoveryEnvelope,
  classicScaleEnvelope,
  classicStatusSummaryLine,
  classicTransitionEnvelope,
} from '../../../domains/comet-classic/classic-output-language.js';

const LOCALES = ['en', 'zh-CN'] as const;

describe('classic output envelopes', () => {
  it('resolves the locale defensively', () => {
    expect(classicLocale('zh-CN')).toBe('zh-CN');
    expect(classicLocale('en')).toBe('en');
    expect(classicLocale(null)).toBe('en');
    expect(classicLocale('null')).toBe('en');
  });

  it('keeps phase tokens bilingual', () => {
    expect(classicPhasePhrase('verify', 'en')).toBe('verify');
    expect(classicPhasePhrase('verify', 'zh-CN')).toContain('verify');
    expect(classicPhasePhrase('verify', 'zh-CN')).toContain('验证');
  });

  it('describes the next step for humans while keeping the skill command for the agent', () => {
    for (const locale of LOCALES) {
      const envelope = classicNextEnvelope({
        name: 'recover-open',
        phase: 'design',
        skill: 'comet-design',
        automatic: true,
        locale,
      });
      expect(envelope.summary).toContain('recover-open');
      expect(envelope.summary).toContain('comet-design');
      expect(envelope.next).toEqual({ command: '/comet-design' });
    }
    const done = classicNextEnvelope({
      name: 'recover-open',
      phase: 'done',
      skill: '',
      automatic: true,
      locale: 'zh-CN',
    });
    expect(done.summary).toContain('已完成全部阶段');
    expect(done.next).toBeUndefined();
  });

  it('describes scale, transition, recovery, entry-check, handoff, and archive outcomes', () => {
    for (const locale of LOCALES) {
      expect(classicScaleEnvelope({ name: 'x', result: 'full', locale }).summary).toContain(
        locale === 'zh-CN' ? '完整验证' : 'full verification',
      );
      expect(
        classicTransitionEnvelope({ name: 'x', fromPhase: 'design', toPhase: 'build', locale })
          .summary,
      ).toContain('→');
      expect(classicRecoveryEnvelope({ name: 'x', phase: 'build', locale }).summary).toContain('x');
      expect(
        classicEntryCheckEnvelope({ name: 'x', phase: 'build', passed: 3, total: 4, locale })
          .summary,
      ).toContain(locale === 'zh-CN' ? '1/4' : '1 of 4');
      expect(classicHandoffEnvelope({ name: 'x', locale }).summary).toContain('x');
      expect(
        classicArchiveEnvelope({ name: 'x', stepsOk: 5, stepsTotal: 5, dryRun: false, locale })
          .summary,
      ).toContain(locale === 'zh-CN' ? '5/5' : '5/5');
      expect(
        classicArchiveEnvelope({ name: 'x', stepsOk: 3, stepsTotal: 5, dryRun: true, locale })
          .summary,
      ).toContain(locale === 'zh-CN' ? '2/5' : '2 of 5');
    }
  });

  it('explains guard blocks as deliberate pauses with a relay line', () => {
    for (const locale of LOCALES) {
      const guard = classicGuardUserMessage('verify', locale);
      expect(guard.summary).not.toContain('BLOCKED');
      expect(guard.user_message.length).toBeGreaterThan(4);
    }
    expect(classicGuardUserMessage('design', 'zh-CN').user_message).toContain('暂不修改源代码');
  });

  it('summarizes manual guard check results for humans', () => {
    for (const locale of LOCALES) {
      const passed = classicGuardCheckEnvelope({
        name: 'x',
        phase: 'design',
        failed: 0,
        total: 9,
        locale,
      });
      expect(passed.summary).toContain('9');
      expect(passed.user_message).toBeUndefined();
      const blocked = classicGuardCheckEnvelope({
        name: 'x',
        phase: 'design',
        failed: 5,
        total: 9,
        locale,
      });
      expect(blocked.summary).toContain(locale === 'zh-CN' ? '5/9' : '5 of 9');
      expect(blocked.user_message).toContain(locale === 'zh-CN' ? 'Agent' : 'Agent');
    }
  });

  it('writes one-line status summaries for the aggregator view', () => {
    for (const locale of LOCALES) {
      expect(
        classicStatusSummaryLine({
          name: 'x',
          phase: 'build',
          tasksCompleted: 2,
          tasksTotal: 5,
          managed: true,
          locale,
        }),
      ).toContain(locale === 'zh-CN' ? '2/5' : '2/5');
      expect(
        classicStatusSummaryLine({ name: 'x', phase: null, error: true, managed: true, locale }),
      ).toContain('doctor');
      expect(
        classicStatusSummaryLine({ name: 'x', phase: null, managed: false, locale }),
      ).toContain(locale === 'zh-CN' ? '未纳入 Comet 管理' : 'not managed by Comet');
    }
  });
});

describe('classic human-line jargon lint', () => {
  it('keeps state-file field names and machine markers out of human lines', () => {
    const humanTexts = [
      ...LOCALES.flatMap((locale) => [
        classicNextEnvelope({
          name: 'x',
          phase: 'open',
          skill: 'comet-open',
          automatic: true,
          locale,
        }).summary,
        classicNextEnvelope({
          name: 'x',
          phase: 'done',
          skill: '',
          automatic: false,
          locale,
        }).summary,
        classicScaleEnvelope({ name: 'x', result: 'full', locale }).summary,
        classicScaleEnvelope({ name: 'x', result: 'light', locale }).summary,
        classicTransitionEnvelope({ name: 'x', fromPhase: 'build', toPhase: 'verify', locale })
          .summary,
        classicRecoveryEnvelope({ name: 'x', phase: 'verify', locale }).summary,
        classicEntryCheckEnvelope({ name: 'x', phase: 'design', passed: 2, total: 2, locale })
          .summary,
        classicEntryCheckEnvelope({ name: 'x', phase: 'design', passed: 1, total: 2, locale })
          .summary,
        classicHandoffEnvelope({ name: 'x', locale }).summary,
        classicArchiveEnvelope({ name: 'x', stepsOk: 4, stepsTotal: 4, dryRun: false, locale })
          .summary,
        classicArchiveEnvelope({ name: 'x', stepsOk: 2, stepsTotal: 4, dryRun: true, locale })
          .summary,
        classicGuardUserMessage('open', locale).summary,
        classicGuardUserMessage('open', locale).user_message,
        classicGuardUserMessage('design', locale).user_message,
        classicGuardUserMessage('build', locale).user_message,
        classicGuardUserMessage('verify', locale).user_message,
        classicGuardUserMessage('archive', locale).user_message,
        classicGuardCheckEnvelope({ name: 'x', phase: 'build', failed: 0, total: 8, locale })
          .summary,
        classicGuardCheckEnvelope({ name: 'x', phase: 'build', failed: 3, total: 8, locale })
          .summary,
        classicGuardCheckEnvelope({ name: 'x', phase: 'build', failed: 3, total: 8, locale })
          .user_message!,
        classicStatusSummaryLine({
          name: 'x',
          phase: 'verify',
          tasksCompleted: 1,
          tasksTotal: 2,
          managed: true,
          locale,
        }),
        classicStatusSummaryLine({ name: 'x', phase: null, error: true, managed: true, locale }),
        classicStatusSummaryLine({ name: 'x', phase: null, managed: false, locale }),
      ]),
    ];
    for (const text of humanTexts) {
      const violations = cliHumanTextViolations(text, CLASSIC_HUMAN_TEXT_DENYLIST);
      expect(violations, `"${text}" must stay human-only`).toEqual([]);
    }
  });
});

describe('classic JSON envelope passthrough', () => {
  it('adds summary/next/user_message additively to the JSON contract', async () => {
    const result = await runClassicCli(['state', 'next', 'demo-change', '--json'], {
      state: async () => ({
        exitCode: 0,
        stdout: 'Change demo-change is in the design stage.\nNEXT: auto\nSKILL: comet-design\n',
        envelope: classicNextEnvelope({
          name: 'demo-change',
          phase: 'design',
          skill: 'comet-design',
          automatic: true,
          locale: 'en',
        }),
      }),
    });
    const parsed = JSON.parse(result.stdout!) as Record<string, unknown>;
    expect(parsed.command).toBe('state');
    expect(parsed.exitCode).toBe(0);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.next).toEqual({ command: '/comet-design' });
    expect(parsed.stdout).toContain('NEXT: auto');
  });

  it('leaves results without an envelope byte-identical', async () => {
    const result = await runClassicCli(['state', 'get', 'demo', 'phase', '--json'], {
      state: async () => ({ exitCode: 0, stdout: 'open\n' }),
    });
    const parsed = JSON.parse(result.stdout!) as Record<string, unknown>;
    expect(parsed.summary).toBeUndefined();
    expect(parsed.stdout).toBe('open\n');
  });
});
