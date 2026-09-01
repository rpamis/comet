import {
  type CliNextHint,
  type CliOutputEnvelope,
  type CliOutputLocale,
} from '../workflow-contract/output-envelope.js';

/**
 * Terminology catalog for Native CLI human lines: internal machine concepts
 * are mapped to plain user language in both locales, and the denylist below
 * keeps contract tests honest about the summary/user_message audience split.
 * Phase tokens (Shape/Build/Verify/Archive) intentionally stay English in
 * zh-CN phrases to match the bilingual skill vocabulary.
 */
export const NATIVE_HUMAN_TEXT_DENYLIST: readonly RegExp[] = [
  /\bstate[_ ]?versions?\b/iu,
  /\brevisions?\b/iu,
  /\breceipts?\b/iu,
  /\bbaselines?\b/iu,
  /\bpolicy[_ ]?hash(es)?\b/iu,
  /\bverify_mode\b/iu,
  /\brunner[_ ]actions?\b/iu,
  /\bcandidate[_ ]?ids?\b/iu,
  /\bcommand[_ ]?args?\b/iu,
  /\bdisposition\b/iu,
  /\bcontinuations?\b/iu,
  /\bschemas?\b/iu,
  /\bskill-coordinated\b/iu,
  /\bintegration[_ ]?checks?\b/iu,
  /\bblockers?\b/iu,
  /\bhandoffs?\b/iu,
];

function phrase(locale: CliOutputLocale, english: string, chinese: string): string {
  return locale === 'zh-CN' ? chinese : english;
}

const PHASE_PHRASES: Record<string, { en: string; zh: string }> = {
  shape: { en: 'Shape (agreeing on requirements)', zh: 'Shape（需求共识）' },
  build: { en: 'Build', zh: 'Build（实现）' },
  verify: { en: 'Verify', zh: 'Verify（验证）' },
  archive: { en: 'Archive', zh: 'Archive（归档）' },
};

function nativePhasePhrase(phase: unknown, locale: CliOutputLocale): string {
  if (typeof phase === 'string' && PHASE_PHRASES[phase])
    return phrase(locale, PHASE_PHRASES[phase].en, PHASE_PHRASES[phase].zh);
  return typeof phase === 'string' ? phase : '';
}

interface NativeAcceptanceCounts {
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  pending: number;
}

function isAcceptanceCounts(value: unknown): value is NativeAcceptanceCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NativeAcceptanceCounts>;
  return (
    typeof candidate.total === 'number' &&
    typeof candidate.passed === 'number' &&
    typeof candidate.failed === 'number' &&
    typeof candidate.blocked === 'number' &&
    typeof candidate.pending === 'number'
  );
}

function acceptanceCountsFromEntries(entries: readonly unknown[]): NativeAcceptanceCounts | null {
  const counts: NativeAcceptanceCounts = {
    total: entries.length,
    passed: 0,
    failed: 0,
    blocked: 0,
    pending: 0,
  };
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return null;
    const result = (entry as { result?: unknown }).result;
    if (
      result !== 'passed' &&
      result !== 'failed' &&
      result !== 'blocked' &&
      result !== 'pending'
    ) {
      return null;
    }
    counts[result] += 1;
  }
  return counts;
}

function nativeAcceptancePhrase(counts: NativeAcceptanceCounts, locale: CliOutputLocale): string {
  const extras: string[] = [];
  if (counts.failed > 0)
    extras.push(phrase(locale, `${counts.failed} failed`, `${counts.failed} 项失败`));
  if (counts.blocked > 0) {
    extras.push(phrase(locale, `${counts.blocked} blocked`, `${counts.blocked} 项受阻`));
  }
  if (counts.pending > 0)
    extras.push(phrase(locale, `${counts.pending} pending`, `${counts.pending} 项待验`));
  const head = phrase(
    locale,
    `acceptance ${counts.passed}/${counts.total} passed`,
    `验收 ${counts.passed}/${counts.total} 通过`,
  );
  return extras.length > 0 ? `${head} (${extras.join(', ')})` : head;
}

interface NativeContinuationLike {
  change: string;
  phase: unknown;
  status: unknown;
  disposition: 'continue' | 'await-user' | 'blocked' | 'done';
  commandArgs: string[] | null;
  userCommunication: {
    required: boolean;
    message: string | null;
    agentInstruction: string;
  };
}

function isNativeContinuationLike(value: unknown): value is NativeContinuationLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NativeContinuationLike>;
  if (typeof candidate.change !== 'string') return false;
  if (
    candidate.disposition !== 'continue' &&
    candidate.disposition !== 'await-user' &&
    candidate.disposition !== 'blocked' &&
    candidate.disposition !== 'done'
  ) {
    return false;
  }
  if (
    candidate.commandArgs !== null &&
    candidate.commandArgs !== undefined &&
    !Array.isArray(candidate.commandArgs)
  ) {
    return false;
  }
  const communication = candidate.userCommunication;
  return Boolean(
    communication &&
    typeof communication === 'object' &&
    typeof communication.required === 'boolean' &&
    (communication.message === null || typeof communication.message === 'string') &&
    typeof communication.agentInstruction === 'string',
  );
}

/**
 * The continuation already carries localized user communication. Its locale is
 * recovered from the localized agent instruction (CJK sniffing) instead of
 * widening the public continuation schema with a language field.
 */
export function nativeContinuationLocale(continuation: NativeContinuationLike): CliOutputLocale {
  return /[\u4e00-\u9fff]/u.test(continuation.userCommunication.agentInstruction) ? 'zh-CN' : 'en';
}

function dispositionPhrase(
  disposition: NativeContinuationLike['disposition'],
  communicationRequired: boolean,
  locale: CliOutputLocale,
): string {
  if (disposition === 'done') return phrase(locale, 'complete', '已完成');
  if (disposition === 'await-user') {
    return phrase(locale, 'waiting for a user decision', '等待用户决定');
  }
  if (disposition === 'blocked')
    return phrase(locale, 'paused: needs attention', '已暂停，需要处理');
  return communicationRequired
    ? phrase(locale, 'waiting for a user decision', '等待用户决定')
    : phrase(locale, 'ready to continue', '可继续推进');
}

export function envelopeFromNativeContinuation(
  continuation: NativeContinuationLike,
  acceptance: NativeAcceptanceCounts | null,
  prefix: string | null,
): CliOutputEnvelope {
  const locale = nativeContinuationLocale(continuation);
  const parts: string[] = [];
  if (prefix) parts.push(prefix);
  const changePart = phrase(locale, `Change ${continuation.change}`, `需求 ${continuation.change}`);
  const phasePart = nativePhasePhrase(continuation.phase, locale);
  const tail = dispositionPhrase(
    continuation.disposition,
    continuation.userCommunication.required,
    locale,
  );
  parts.push([changePart, phasePart || null, tail].filter(Boolean).join(' · '));
  if (acceptance && acceptance.total > 0) parts.push(nativeAcceptancePhrase(acceptance, locale));
  const communication = continuation.userCommunication;
  const nextHint = nextHintFromContinuation(continuation, locale);
  return {
    summary: parts.join('; '),
    ...(nextHint ? { next: nextHint } : {}),
    ...(communication.required && communication.message
      ? { user_message: communication.message }
      : {}),
  };
}

function nextHintFromContinuation(
  continuation: NativeContinuationLike,
  locale: CliOutputLocale,
): CliNextHint | undefined {
  const communication = continuation.userCommunication;
  if (continuation.disposition === 'await-user' && communication.required) {
    return {
      ask_user: phrase(
        locale,
        'Relay the message below, wait for the user decision, then run the matching option (run with --json to see the exact alternative commands).',
        '先转述下方信息并等待用户选择，再执行对应命令（完整候选命令以 --json 输出为准）。',
      ),
    };
  }
  if (continuation.commandArgs && continuation.commandArgs.length > 0) {
    return { command: continuation.commandArgs.join(' ') };
  }
  if (continuation.disposition === 'done') {
    return {
      ask_user: phrase(
        locale,
        'No further workflow action; report the completed change to the user.',
        '工作流已无后续动作；向用户报告该需求已完成即可。',
      ),
    };
  }
  if (continuation.disposition === 'blocked') {
    return {
      ask_user: phrase(
        locale,
        'Resolve the paused condition before continuing; run with --json for the structured diagnosis.',
        '先解除暂停原因再继续；结构化诊断信息以 --json 输出为准。',
      ),
    };
  }
  return undefined;
}

interface NativeStatusPageLike {
  total: number;
  items: ReadonlyArray<Record<string, unknown>>;
}

/**
 * One-line human summary for a portable Native change, used by the `comet
 * status` aggregator view.
 */
export function nativeStatusSummaryLine(options: {
  name: string;
  phase: string;
  status: string;
  acceptance: { passed: number; total: number };
  locale: CliOutputLocale;
}): string {
  const { name, phase, status, acceptance, locale } = options;
  const stage = nativePhasePhrase(phase, locale) || phase;
  const state =
    status === 'await-user'
      ? phrase(locale, 'waiting for a user decision', '等待用户决定')
      : status === 'blocked'
        ? phrase(locale, 'paused', '已暂停')
        : status === 'done'
          ? phrase(locale, 'complete', '已完成')
          : phrase(locale, 'in progress', '进行中');
  const acceptanceText =
    acceptance.total > 0
      ? phrase(
          locale,
          `, acceptance ${acceptance.passed}/${acceptance.total} passed`,
          `，验收 ${acceptance.passed}/${acceptance.total} 通过`,
        )
      : '';
  return phrase(
    locale,
    `→ ${name}: in the ${stage} stage, ${state}${acceptanceText}.`,
    `→ ${name}：当前处于 ${stage}阶段，${state}${acceptanceText}。`,
  );
}

function isNativeStatusPageLike(value: unknown): value is NativeStatusPageLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NativeStatusPageLike>;
  return typeof candidate.total === 'number' && Array.isArray(candidate.items);
}

function pageItemLine(item: Record<string, unknown>, locale: CliOutputLocale): string {
  const name = typeof item.name === 'string' ? item.name : '(unnamed)';
  const phase = nativePhasePhrase(item.phase, locale);
  const status =
    item.status === 'await-user'
      ? phrase(locale, 'waiting for a user decision', '等待用户决定')
      : item.status === 'blocked'
        ? phrase(locale, 'paused', '已暂停')
        : item.status === 'done'
          ? phrase(locale, 'complete', '已完成')
          : phrase(locale, 'in progress', '进行中');
  const acceptance = isAcceptanceCounts(item.acceptance)
    ? `${phrase(locale, ', ', '，')}${nativeAcceptancePhrase(item.acceptance, locale)}`
    : '';
  return `  ${name} · ${phase || String(item.phase ?? '?')} · ${status}${acceptance}`;
}

function pageLocale(items: ReadonlyArray<Record<string, unknown>>): CliOutputLocale {
  for (const item of items) {
    const communication = item.continuation as
      | { userCommunication?: { agentInstruction?: unknown } }
      | undefined;
    if (
      communication?.userCommunication &&
      typeof communication.userCommunication.agentInstruction === 'string' &&
      /[\u4e00-\u9fff]/u.test(communication.userCommunication.agentInstruction)
    ) {
      return 'zh-CN';
    }
  }
  return 'en';
}

interface NativeDoctorLike {
  healthy: boolean;
  findings?: unknown[];
  repaired?: boolean;
  continuation?: unknown;
}

function isNativeDoctorLike(value: unknown): value is NativeDoctorLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NativeDoctorLike>;
  if (typeof candidate.healthy !== 'boolean') return false;
  return candidate.findings === undefined || Array.isArray(candidate.findings);
}

function envelopeFromNativeDoctor(data: NativeDoctorLike): CliOutputEnvelope {
  const locale: CliOutputLocale = 'en';
  if (data.healthy) {
    const summary = data.repaired
      ? phrase(
          locale,
          'Diagnostics passed and the reported problem was repaired automatically.',
          '诊断通过，报告的问题已自动修复。',
        )
      : phrase(locale, 'Diagnostics passed: no problems found.', '诊断通过：未发现问题。');
    const next = nextHintFromContinuationField(data.continuation);
    return next ? { summary, next } : { summary };
  }
  const count = Array.isArray(data.findings) ? data.findings.length : 0;
  return {
    summary: phrase(
      locale,
      count > 0
        ? `Diagnostics found ${count} problem${count === 1 ? '' : 's'} that need attention before this change can continue.`
        : 'Diagnostics found problems that need attention before this change can continue.',
      count > 0
        ? `诊断发现 ${count} 个需要处理的问题，处理后该需求才能继续。`
        : '诊断发现需要处理的问题，处理后该需求才能继续。',
    ),
    next: {
      ask_user: phrase(
        locale,
        'Run with --json to read the structured findings; re-run with --repair once the cause is understood.',
        '结构化诊断以 --json 输出为准；确认原因后再用 --repair 修复。',
      ),
    },
  };
}

function nextHintFromContinuationField(value: unknown): CliNextHint | undefined {
  return isNativeContinuationLike(value)
    ? nextHintFromContinuation(value, nativeContinuationLocale(value))
    : undefined;
}

/**
 * Derive the human/agent envelope from a command's existing public data
 * payload without changing that payload. Covers every result shape that
 * carries a continuation (next/new/spec/status/show/archive/doctor), the
 * status page, doctor results, and `root show`.
 */
export function deriveNativeOutputEnvelope(data: unknown): CliOutputEnvelope | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  if (isNativeDoctorLike(record)) return envelopeFromNativeDoctor(record);
  if (isNativeStatusPageLike(record)) {
    const locale = pageLocale(record.items);
    const header =
      record.total === record.items.length
        ? phrase(
            locale,
            `Native changes (${record.total})`,
            `Native 需求列表（共 ${record.total} 条）`,
          )
        : phrase(
            locale,
            `Native changes (showing ${record.items.length} of ${record.total})`,
            `Native 需求列表（显示 ${record.items.length}/${record.total} 条）`,
          );
    return {
      summary: [header, ...record.items.map((item) => pageItemLine(item, locale))].join('\n'),
    };
  }
  const continuation = record.continuation;
  if (isNativeContinuationLike(continuation)) {
    return envelopeFromNativeContinuation(
      continuation,
      acceptanceFromRecord(record),
      prefixFromRecord(record, nativeContinuationLocale(continuation)),
    );
  }
  if (typeof record.artifactRoot === 'string' && typeof record.nativeRoot === 'string') {
    const locale: CliOutputLocale = record.language === 'zh-CN' ? 'zh-CN' : 'en';
    const isRootShow = 'pendingRootMove' in record;
    return {
      summary: phrase(
        locale,
        isRootShow
          ? `Comet Native artifacts live under ${record.artifactRoot} (state root: ${record.nativeRoot}).`
          : `Initialized Comet Native at ${record.nativeRoot} (artifacts: ${record.artifactRoot}).`,
        isRootShow
          ? `Comet Native 产物位于 ${record.artifactRoot}（状态根目录：${record.nativeRoot}）。`
          : `Comet Native 已初始化于 ${record.nativeRoot}（产物目录：${record.artifactRoot}）。`,
      ),
    };
  }
  return undefined;
}

function acceptanceFromRecord(record: Record<string, unknown>): NativeAcceptanceCounts | null {
  if (isAcceptanceCounts(record.acceptance)) return record.acceptance;
  const state = record.state;
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const stateRecord = state as Record<string, unknown>;
    if (isAcceptanceCounts(stateRecord.acceptance)) return stateRecord.acceptance;
    if (Array.isArray(stateRecord.acceptance))
      return acceptanceCountsFromEntries(stateRecord.acceptance);
  }
  return null;
}

function prefixFromRecord(record: Record<string, unknown>, locale: CliOutputLocale): string | null {
  if (record.selected !== undefined && typeof record.selected === 'string') {
    return phrase(locale, `Selected ${record.selected}.`, `已选择需求 ${record.selected}。`);
  }
  const migration = record.migration;
  if (
    migration &&
    typeof migration === 'object' &&
    (migration as { completed?: unknown }).completed === true
  ) {
    return phrase(
      locale,
      'Upgraded this change to the current Native format.',
      '已将该需求升级到当前 Native 格式。',
    );
  }
  return null;
}

interface NativeErrorEnvelopeInput {
  code: string;
  message: string;
  data?: unknown;
}

/**
 * Human envelopes for stable error codes. Returns undefined when the raw
 * message is already the best human story (usage corrections, guard reasons,
 * unexpected internal errors).
 */
export function nativeErrorEnvelope(
  input: NativeErrorEnvelopeInput,
): CliOutputEnvelope | undefined {
  const locale: CliOutputLocale = 'en';
  const record =
    input.data && typeof input.data === 'object' && !Array.isArray(input.data)
      ? (input.data as Record<string, unknown>)
      : {};
  switch (input.code) {
    case 'conflict':
      return {
        summary: phrase(
          locale,
          'This change was updated elsewhere while the command ran, so the command stopped without changing anything. Nothing was lost — reload the latest state and continue from there.',
          '这条需求刚被另一个会话更新，本次命令未做任何改动。没有工作丢失——重新读取最新状态后继续即可。',
        ),
        ...(typeof record.change === 'string'
          ? { next: { command: `comet native status ${record.change} --json` } }
          : {}),
      };
    case 'baseline-incomplete':
      return {
        summary: phrase(
          locale,
          'The safety snapshot for this change exceeded its configured size budget, so the command stopped before changing anything. Raise the snapshot limits in .comet/config.yaml or exclude out-of-scope data, then retry.',
          '该需求的安全快照超出配置的容量预算，命令在改动任何内容前已停止。请在 .comet/config.yaml 中调高快照上限，或将范围外的数据加入排除列表后重试。',
        ),
        next: {
          ask_user: phrase(
            locale,
            'Run with --json to see the exact limits, omitted paths, and supported fixes.',
            '具体上限、被省略的路径和支持的修复方式以 --json 输出为准。',
          ),
        },
      };
    case 'workspace-isolation-required':
      return {
        summary: phrase(
          locale,
          'This change runs in its own Git worktree to keep work isolated. Create the linked worktree first, then continue inside it.',
          '这条需求需要在独立的 Git worktree 中执行以保证隔离。请先创建关联的 worktree，然后在其中继续。',
        ),
        next: {
          ask_user: phrase(
            locale,
            'Run with --json to see the exact worktree creation command.',
            '完整的 worktree 创建命令以 --json 输出为准。',
          ),
        },
      };
    case 'workspace-preparation-incomplete':
      return {
        summary: phrase(
          locale,
          'The change workspace is not fully prepared (for example a branch or worktree is missing). Finish the preparation steps, then retry.',
          '需求的工作区尚未准备完成（例如分支或 worktree 缺失）。请先完成准备步骤，再重试。',
        ),
        next: {
          ask_user: phrase(
            locale,
            'Run with --json to see the remaining preparation steps.',
            '剩余的准备步骤以 --json 输出为准。',
          ),
        },
      };
    case 'implementation-scope-stale':
      return {
        summary: phrase(
          locale,
          'The recorded implementation scope no longer matches the current files. Refresh the scope, then retry.',
          '记录的实现范围与当前文件不再一致。请刷新范围后重试。',
        ),
        next: {
          ask_user: phrase(
            locale,
            'Run with --json to see the exact recovery steps.',
            '具体恢复步骤以 --json 输出为准。',
          ),
        },
      };
    default:
      return undefined;
  }
}
