import type { CliOutputEnvelope, CliOutputLocale } from '../workflow-contract/output-envelope.js';

/**
 * Terminology catalog for Classic CLI human lines: internal state-file field
 * names and machine markers stay in the machine lines, while the summary and
 * user lines speak plain user language in both locales. Phase tokens
 * (open/design/build/verify/archive) stay English in zh-CN phrases to match
 * the bilingual skill vocabulary.
 */
export const CLASSIC_HUMAN_TEXT_DENYLIST: readonly RegExp[] = [
  /\bverify_mode\b/iu,
  /\bbranch_status\b/iu,
  /\bbase_ref\b/iu,
  /\bdesign_doc\b/iu,
  /\btdd_mode\b/iu,
  /\bbuild_mode\b/iu,
  /\bsubagent_dispatch\b/iu,
  /\bauto_transition\b/iu,
  /\bcontext_compression\b/iu,
  /\bhandoff_hash\b/iu,
  /\bhandoff_context\b/iu,
  /\bverification_report\b/iu,
  /\barchive_confirmation\b/iu,
  /\[SET\]/,
  /\[TRANSITION\]/,
  /\[SCALE\]/,
  /\[HANDOFF\]/,
  /\bLEGACY\b/,
  /\bpending\b/iu,
];

export function classicLocale(language: unknown): CliOutputLocale {
  return language === 'zh-CN' ? 'zh-CN' : 'en';
}

function phrase(locale: CliOutputLocale, english: string, chinese: string): string {
  return locale === 'zh-CN' ? chinese : english;
}

const PHASE_PHRASES: Record<string, { en: string; zh: string }> = {
  open: { en: 'open (clarifying the request)', zh: 'open（需求澄清）' },
  design: { en: 'design', zh: 'design（方案设计）' },
  build: { en: 'build', zh: 'build（实现）' },
  verify: { en: 'verify', zh: 'verify（验证）' },
  archive: { en: 'archive', zh: 'archive（归档）' },
};

export function classicPhasePhrase(phase: string, locale: CliOutputLocale): string {
  return PHASE_PHRASES[phase]
    ? phrase(locale, PHASE_PHRASES[phase].en, PHASE_PHRASES[phase].zh)
    : phase;
}

export function classicNextEnvelope(options: {
  name: string;
  phase: string;
  skill: string;
  automatic: boolean;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, phase, skill, automatic, locale } = options;
  if (phase === 'done') {
    return {
      summary: phrase(
        locale,
        `Change ${name} has finished every phase; no further workflow action is needed.`,
        `需求 ${name} 已完成全部阶段，无需后续操作。`,
      ),
    };
  }
  const automaticNote = automatic
    ? phrase(locale, 'the next skill starts automatically', '下一阶段技能会自动接续')
    : phrase(
        locale,
        'return control and run the skill manually when asked',
        '交还控制权，由用户手动调用对应技能',
      );
  return {
    summary: phrase(
      locale,
      `Change ${name} is in the ${classicPhasePhrase(phase, locale)} stage; the next step is /${skill}, and ${automaticNote}.`,
      `需求 ${name} 当前处于 ${classicPhasePhrase(phase, locale)}阶段；下一步是 /${skill}，${automaticNote}。`,
    ),
    next: { command: `/${skill}` },
  };
}

export function classicScaleEnvelope(options: {
  name: string;
  result: 'full' | 'light';
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, result, locale } = options;
  const mode =
    result === 'full'
      ? phrase(
          locale,
          'this change touches more tasks, specs, or files, so it will use full verification',
          '本改动涉及的任务、规格或文件较多，将采用完整验证',
        )
      : phrase(
          locale,
          'this change stays small, so it will use light verification',
          '本改动规模较小，将采用轻量验证',
        );
  return {
    summary: phrase(
      locale,
      `Scale assessment for ${name}: ${mode}.`,
      `需求 ${name} 的规模评估：${mode}。`,
    ),
  };
}

export function classicTransitionEnvelope(options: {
  name: string;
  fromPhase: string;
  toPhase: string;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, fromPhase, toPhase, locale } = options;
  const to =
    toPhase === 'archive' && fromPhase === 'archive'
      ? phrase(locale, 'stays in archive', '保持 archive 阶段')
      : phrase(
          locale,
          `${classicPhasePhrase(fromPhase, locale)} → ${classicPhasePhrase(toPhase, locale)}`,
          `${classicPhasePhrase(fromPhase, locale)} → ${classicPhasePhrase(toPhase, locale)}`,
        );
  return {
    summary: phrase(locale, `Change ${name} advanced: ${to}.`, `需求 ${name} 阶段推进：${to}。`),
  };
}

export function classicRecoveryEnvelope(options: {
  name: string;
  phase: string;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, phase, locale } = options;
  return {
    summary: phrase(
      locale,
      `Recovery context for ${name} (currently in the ${classicPhasePhrase(phase, locale)} stage): the fields below show what is already recorded, and the action line says how to continue.`,
      `需求 ${name} 的恢复上下文：当前处于 ${classicPhasePhrase(phase, locale)}阶段；下方字段列出已记录的证据，最后一行说明如何继续。`,
    ),
  };
}

export function classicEntryCheckEnvelope(options: {
  name: string;
  phase: string;
  passed: number;
  total: number;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, phase, passed, total, locale } = options;
  const ok = passed === total;
  return {
    summary: phrase(
      locale,
      `Entry checks for ${name} entering the ${classicPhasePhrase(phase, locale)} stage: ${ok ? `all ${total} passed` : `${total - passed} of ${total} failed`}.`,
      `需求 ${name} 进入 ${classicPhasePhrase(phase, locale)}阶段的检查：${ok ? `全部 ${total} 项通过` : `${total - passed}/${total} 项未通过`}。`,
    ),
  };
}

export function classicGuardCheckEnvelope(options: {
  name: string;
  phase: string;
  failed: number;
  total: number;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, phase, failed, total, locale } = options;
  if (failed === 0) {
    return {
      summary: phrase(
        locale,
        `Change ${name} passed every check for leaving the ${classicPhasePhrase(phase, locale)} stage (${total} total) and is ready to proceed.`,
        `需求 ${name} 通过了离开 ${classicPhasePhrase(phase, locale)}阶段的全部 ${total} 项检查，可以继续推进。`,
      ),
    };
  }
  return {
    summary: phrase(
      locale,
      `Change ${name} is not ready to leave the ${classicPhasePhrase(phase, locale)} stage yet: ${failed} of ${total} checks failed. The failing items below are the Agent's checklist, not user actions.`,
      `需求 ${name} 暂时还不能离开 ${classicPhasePhrase(phase, locale)}阶段：${failed}/${total} 项检查未通过。下方的失败项是给 Agent 的检查清单，不需要用户处理。`,
    ),
    user_message: phrase(
      locale,
      'A few preparation items are still missing before this change can move to the next stage; the Agent is filling them in and will continue afterwards.',
      '这条需求要进入下一阶段还差几项准备工作；Agent 正在补齐，之后会自动继续。',
    ),
  };
}

export function classicStatusSummaryLine(options: {
  name: string;
  phase: string | null;
  tasksCompleted?: number;
  tasksTotal?: number;
  error?: boolean;
  managed: boolean;
  locale: CliOutputLocale;
}): string {
  const { name, phase, tasksCompleted, tasksTotal, error, managed, locale } = options;
  if (error) {
    return phrase(
      locale,
      `→ ${name}: its status could not be read; comet doctor can repair it.`,
      `→ ${name}：状态读取失败，可用 comet doctor 修复。`,
    );
  }
  if (!managed) {
    return phrase(
      locale,
      `→ ${name}: a plain OpenSpec change, not managed by Comet.`,
      `→ ${name}：普通 OpenSpec 变更，未纳入 Comet 管理。`,
    );
  }
  const stage = phase
    ? classicPhasePhrase(phase, locale)
    : phrase(locale, 'unknown stage', '未知阶段');
  const tasks =
    tasksTotal && tasksTotal > 0
      ? phrase(
          locale,
          `, tasks ${tasksCompleted ?? 0}/${tasksTotal} done`,
          `，任务完成 ${tasksCompleted ?? 0}/${tasksTotal}`,
        )
      : '';
  return phrase(
    locale,
    `→ ${name}: in the ${stage} stage${tasks}.`,
    `→ ${name}：当前处于 ${stage}阶段${tasks}。`,
  );
}

export function classicGuardUserMessage(
  phase: string,
  locale: CliOutputLocale,
): { summary: string; user_message: string } {
  const byPhase: Record<string, { en: string; zh: string }> = {
    open: {
      en: 'Source code edits are paused while the request is still being clarified.',
      zh: '需求仍在澄清中，暂时不修改源代码。',
    },
    design: {
      en: 'Source code edits are paused until the design is agreed and recorded.',
      zh: '方案确定并记录之前，暂不修改源代码。',
    },
    build: {
      en: 'A required design or plan record is missing, so source edits stay paused.',
      zh: '缺少必需的设计或计划记录，源代码修改暂被搁置。',
    },
    verify: {
      en: 'Implementation edits are paused during verification; only verification output is accepted.',
      zh: '验证期间暂停修改实现，仅接受验证产出。',
    },
    archive: {
      en: 'Source code edits are paused while the change is being archived.',
      zh: '归档期间暂不修改源代码。',
    },
  };
  const entry = byPhase[phase] ?? {
    en: 'This write is paused by the current workflow stage.',
    zh: '当前工作流阶段暂不允许这次写入。',
  };
  return {
    summary: phrase(
      locale,
      'This write was blocked on purpose, not by an error.',
      '这次写入是被有意拦下的，不是发生了错误。',
    ),
    user_message: phrase(locale, entry.en, entry.zh),
  };
}

export function classicHandoffEnvelope(options: {
  name: string;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, locale } = options;
  return {
    summary: phrase(
      locale,
      `Handoff context for ${name} was written and recorded; the Build phase can resume from it.`,
      `需求 ${name} 的交接上下文已写入并记录，Build 阶段可据此继续。`,
    ),
  };
}

export function classicArchiveEnvelope(options: {
  name: string;
  stepsOk: number;
  stepsTotal: number;
  dryRun: boolean;
  locale: CliOutputLocale;
}): CliOutputEnvelope {
  const { name, stepsOk, stepsTotal, dryRun, locale } = options;
  const complete = stepsOk === stepsTotal;
  if (dryRun) {
    return {
      summary: phrase(
        locale,
        `Archive dry run for ${name}: ${complete ? `all ${stepsTotal} steps would succeed` : `${stepsTotal - stepsOk} of ${stepsTotal} steps would fail`}.`,
        `需求 ${name} 归档预演：${complete ? `全部 ${stepsTotal} 步均可成功` : `${stepsTotal - stepsOk}/${stepsTotal} 步会失败`}。`,
      ),
    };
  }
  return {
    summary: phrase(
      locale,
      complete
        ? `Change ${name} was archived successfully (${stepsOk}/${stepsTotal} steps).`
        : `Archive for ${name} stopped: ${stepsTotal - stepsOk} of ${stepsTotal} steps failed.`,
      complete
        ? `需求 ${name} 归档成功（${stepsOk}/${stepsTotal} 步）。`
        : `需求 ${name} 归档中止：${stepsTotal - stepsOk}/${stepsTotal} 步失败。`,
    ),
  };
}
