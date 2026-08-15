import path from 'node:path';

import { atomicWriteText } from './native-atomic-file.js';
import {
  nativeLocalizedText,
  nativeVerificationHeading,
  type NativeArtifactLanguage,
} from './native-artifact-language.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import {
  readNativeImplementationScope,
  readNativeVerificationEvidence,
  readNativeVerificationReceipt,
} from './native-evidence-storage.js';
import type { NativeChangeState, NativeProjectPaths } from './native-types.js';
import type { NativeImplementationScope } from './native-verification-scope.js';
import type { NativeReadableVerificationEvidenceEnvelope } from './native-verification-evidence.js';
import type { NativeVerificationReceipt } from './native-verification-receipt.js';

/**
 * Relative path of the human-readable evidence projection inside a Native change.
 *
 * The projection is a read-only derivative of the content-addressed evidence in
 * the project-local Native Runtime. It exists so that people (and developers debugging a
 * change) can read what the hash-named files contain without parsing raw JSON
 * or reading runtime source. The Runtime regenerates it on every evidence-
 * bearing transition, so it must never be cited as evidence itself.
 */
export const NATIVE_EVIDENCE_PROJECTION_REF = 'evidence.md';

const NATIVE_EVIDENCE_PROJECTION_GENERATOR = 'comet-native';

/**
 * Bounded projection limits. Mirrors the bounded-projection pattern used by
 * `projectNativeAcceptancePage`: the projection always has an upper bound and
 * reports truncation rather than silently dropping entries.
 */
export const NATIVE_EVIDENCE_PROJECTION_LIMITS = Object.freeze({
  maxScopeChanges: 128,
  maxAcceptanceEntries: 64,
  maxUnresolvedReasons: 32,
  maxReceipts: 32,
});

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function sortText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function describeScopeChangeKind(
  kind: 'added' | 'modified' | 'removed',
  language: NativeArtifactLanguage,
): string {
  switch (kind) {
    case 'added':
      return nativeLocalizedText(language, 'added', '新增');
    case 'modified':
      return nativeLocalizedText(language, 'modified', '修改');
    case 'removed':
      return nativeLocalizedText(language, 'removed', '删除');
  }
}

function describeBytes(before: number | null, after: number | null): string {
  if (before === null && after === null) return 'unknown size';
  if (before === null) return `0→${after} bytes`;
  if (after === null) return `${before}→0 bytes`;
  if (before === after) return `${after} bytes`;
  return `${before}→${after} bytes`;
}

function renderScopeSection(
  scope: NativeImplementationScope,
  language: NativeArtifactLanguage,
): string[] {
  const localized = (english: string, chinese: string) =>
    nativeLocalizedText(language, english, chinese);
  const lines: string[] = [
    `## ${localized('Implementation scope', '实现范围')}`,
    '',
    `- ${localized('Source', '基线')}: ${scope.baselineProjectionRef.replace(/^runtime\/evidence\/snapshots\//u, 'evidence/snapshots/')}`,
    `- ${localized('Current', '当前')}: ${scope.currentProjectionRef.replace(/^runtime\/evidence\/snapshots\//u, 'evidence/snapshots/')}`,
    `- ${localized('Scope', '范围')}: evidence/scopes/${shortHash(scope.scopeHash)}.json`,
    `- ${localized('Status', '状态')}: ${scope.complete ? localized('complete', '完整') : localized('partial (has unresolved scope)', '部分完成（存在未解决范围）')}`,
    `- ${localized('Declared artifacts', '声明的产物')}: ${scope.declaredArtifacts.length}`,
  ];

  if (scope.noCodeReason) {
    lines.push(`- ${localized('No-code reason', '无代码原因')}: ${scope.noCodeReason}`);
  }
  if (scope.unattributed.length > 0) {
    lines.push(
      `- ${localized('Unattributed changes', '未归因的变更')}: ${scope.unattributed.length}`,
    );
  }

  lines.push('');

  const changes = [...scope.changes].sort((a, b) => sortText(a.path, b.path));
  const limit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxScopeChanges;
  const shown = changes.slice(0, limit);
  const truncated = changes.length - shown.length;

  if (shown.length === 0) {
    lines.push(
      localized(
        'No implementation changes detected between baseline and current snapshots.',
        '基线与当前快照之间未检测到实现变更。',
      ),
      '',
    );
  } else {
    for (const change of shown) {
      const attribution =
        change.attributedTo.length > 0
          ? ` (covers: ${change.attributedTo.map((artifact) => artifact.path).join(', ')})`
          : '';
      lines.push(
        `- ${change.path} ${describeScopeChangeKind(change.kind, language)} ${describeBytes(
          change.before?.size ?? null,
          change.after?.size ?? null,
        )}${attribution}`,
      );
    }
    if (truncated > 0) {
      lines.push(
        `- ... ${truncated} ${localized('more changes truncated; read the scope evidence for the full set', '项变更已截断；完整内容请查看范围证据')}`,
      );
    }
    lines.push('');
  }

  const unresolved = [...scope.unresolvedScopes].sort((a, b) => sortText(a.reason, b.reason));
  const unresolvedLimit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxUnresolvedReasons;
  const unresolvedShown = unresolved.slice(0, unresolvedLimit);
  if (unresolvedShown.length > 0) {
    lines.push(`### ${localized('Unresolved scope', '未解决范围')}`, '');
    for (const entry of unresolvedShown) {
      lines.push(`- ${entry.reason}`);
    }
    const unresolvedTruncated = unresolved.length - unresolvedShown.length;
    if (unresolvedTruncated > 0) {
      lines.push(
        `- ... ${unresolvedTruncated} ${localized('more unresolved reason(s) truncated', '项未解决原因已截断')}`,
      );
    }
    lines.push('');
  }

  return lines;
}

function describeAcceptanceStatus(
  status: 'passed' | 'failed' | 'missing',
  language: NativeArtifactLanguage,
): string {
  switch (status) {
    case 'passed':
      return nativeLocalizedText(language, 'passed', '通过');
    case 'failed':
      return nativeLocalizedText(language, 'failed', '未通过');
    case 'missing':
      return nativeLocalizedText(language, 'missing', '缺失');
  }
}

function renderVerificationSection(
  envelope: NativeReadableVerificationEvidenceEnvelope,
  receipts: readonly NativeVerificationReceipt[],
  language: NativeArtifactLanguage,
): string[] {
  const localized = (english: string, chinese: string) =>
    nativeLocalizedText(language, english, chinese);
  const lines: string[] = [
    `## ${nativeVerificationHeading(language, 'verification')}`,
    '',
    `- ${localized('Result', '结果')}: ${envelope.result}`,
    `- ${localized('Freshness', '新鲜度')}: ${envelope.freshness}`,
    `- ${localized('Evidence', '证据')}: evidence/verifications/${shortHash(envelope.envelopeHash)}.json`,
    `- ${localized('Contract', '契约')}: ${shortHash(envelope.contractHash)}`,
    `- ${localized('Acceptance criteria', '验收标准')}: ${shortHash(envelope.acceptanceCriteriaHash)}`,
  ];

  if (envelope.partialAllowanceRef) {
    lines.push(
      `- ${localized('Partial allowance', '部分许可')}: ${envelope.partialAllowanceRef.replace(/^runtime\/evidence\/allowances\//u, 'evidence/allowances/')}`,
    );
  }

  lines.push(
    `- ${localized('Acceptance coverage', '验收覆盖')}: ${envelope.acceptanceTrace.evidenced}/${envelope.acceptanceTrace.total} ${localized('evidenced', '有证据')}, ${envelope.acceptanceTrace.skipped} ${localized('skipped', '跳过')}`,
    '',
  );

  const entries = [...envelope.acceptanceTrace.entries].sort((a, b) =>
    sortText(a.acceptanceId, b.acceptanceId),
  );
  const limit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxAcceptanceEntries;
  const shown = entries.slice(0, limit);
  const truncated = entries.length - shown.length;

  if (shown.length > 0) {
    lines.push(`### ${localized('Acceptance trace', '验收追踪')}`, '');
    for (const entry of shown) {
      const reason = entry.skippedReason ? ` — ${entry.skippedReason}` : '';
      const refs =
        entry.evidenceRefs.length > 0
          ? ` (${entry.evidenceRefs
              .map((ref) => ref.replace(/^runtime\/evidence\/receipts\//u, 'evidence/receipts/'))
              .join(', ')})`
          : '';
      lines.push(
        `- ${shortHash(entry.acceptanceId)} (${entry.kind}, ${entry.source}) ${describeAcceptanceStatus(entry.status, language)}${refs}${reason}`,
      );
    }
    if (truncated > 0) {
      lines.push(
        `- ... ${truncated} ${localized('more acceptance entries truncated', '项验收追踪已截断')}`,
      );
    }
    lines.push('');
  }

  if (receipts.length > 0) {
    const sortedReceipts = [...receipts].sort((a, b) => sortText(a.receiptHash, b.receiptHash));
    const receiptLimit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxReceipts;
    const shownReceipts = sortedReceipts.slice(0, receiptLimit);
    const receiptsTruncated = sortedReceipts.length - shownReceipts.length;
    lines.push(`### ${localized('Check receipts', '检查收据')}`, '');
    for (const receipt of shownReceipts) {
      lines.push(...renderReceipt(receipt, language));
    }
    if (receiptsTruncated > 0) {
      lines.push(
        `- ... ${receiptsTruncated} ${localized('more receipts truncated', '项收据已截断')}`,
      );
    }
    lines.push('');
  }

  return lines;
}

function renderReceipt(
  receipt: NativeVerificationReceipt,
  language: NativeArtifactLanguage,
): string[] {
  const localized = (english: string, chinese: string) =>
    nativeLocalizedText(language, english, chinese);
  const lines: string[] = [
    `- ${receipt.kind} (${receipt.role}) ${receipt.status} — evidence/receipts/${shortHash(receipt.receiptHash)}.json`,
  ];
  if (receipt.kind === 'automated-check') {
    const evidence = receipt.evidence;
    const command = [evidence.executable, ...evidence.args].join(' ');
    lines.push(`  - ${localized('command', '命令')}: \`${command}\``);
    lines.push(`  - ${localized('exit code', '退出码')}: ${evidence.exitCode}`);
    if (evidence.timedOut) {
      lines.push(`  - ${localized('timed out after', '超时，耗时')} ${evidence.timeoutMs}ms`);
    }
    lines.push(
      `  - ${localized('summary', '摘要')}: ${evidence.outputSummary}${evidence.outputTruncated ? ` (${localized('truncated', '已截断')})` : ''}`,
    );
  } else if (receipt.kind === 'static-inspection') {
    const evidence = receipt.evidence;
    lines.push(`  - ${localized('rule', '规则')}: ${evidence.rule}`);
    lines.push(`  - ${localized('subjects', '对象数')}: ${evidence.subjects.length}`);
    lines.push(`  - ${localized('summary', '摘要')}: ${evidence.resultSummary}`);
  } else {
    const evidence = receipt.evidence;
    if (evidence.steps.length > 0) {
      lines.push(`  - ${localized('steps', '步骤数')}: ${evidence.steps.length}`);
    }
    if (evidence.observations.length > 0) {
      lines.push(`  - ${localized('observations', '观察数')}: ${evidence.observations.length}`);
    }
  }
  return lines;
}

/**
 * Render a deterministic, human-readable markdown projection from already-read
 * evidence. Pure function: identical inputs produce identical bytes, so the
 * atomic write is idempotent across regenerations.
 */
export function renderNativeEvidenceProjectionMarkdown(input: {
  change: string;
  phase: NativeChangeState['phase'];
  revision: number;
  language?: NativeArtifactLanguage;
  scope: NativeImplementationScope | null;
  envelope: NativeReadableVerificationEvidenceEnvelope | null;
  receipts: readonly NativeVerificationReceipt[];
  generatedAt: string;
}): string {
  const language = input.language ?? 'en';
  const localized = (english: string, chinese: string) =>
    nativeLocalizedText(language, english, chinese);
  const lines: string[] = [
    language === 'zh-CN' ? '# Comet Native 证据概览' : '# Comet Native Evidence Projection',
    '',
    `- ${localized('Change', '变更')}: ${input.change}`,
    `- ${localized('Phase', '阶段')}: ${input.phase}`,
    `- ${localized('Revision', '修订号')}: ${input.revision}`,
    `- ${localized('Generated-at', '生成时间')}: ${input.generatedAt}`,
    '',
    `Generated-by: ${NATIVE_EVIDENCE_PROJECTION_GENERATOR}`,
    '',
    '<!--',
    '  This file is a read-only projection of the content-addressed evidence under',
    '  .comet/runtime/native directory. The Native Runtime regenerates it on every evidence-bearing',
    '  transition. Do not hand-edit, and never cite this file as verification proof —',
    '  the canonical facts live in the hash-named evidence documents.',
    '-->',
    '',
  ];

  if (input.scope) {
    lines.push(...renderScopeSection(input.scope, language));
  } else {
    lines.push(
      `## ${localized('Implementation scope', '实现范围')}`,
      '',
      localized('No implementation scope evidence recorded yet.', '尚未记录实现范围证据。'),
      '',
    );
  }

  if (input.envelope) {
    lines.push(...renderVerificationSection(input.envelope, input.receipts, language));
  } else {
    lines.push(
      `## ${nativeVerificationHeading(language, 'verification')}`,
      '',
      localized('No verification evidence recorded yet.', '尚未记录验证证据。'),
      '',
    );
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`;
}

function nativeEvidenceProjectionFile(paths: NativeProjectPaths, name: string): string {
  const changeDir = nativeChangeDir(paths, name);
  return path.join(changeDir, ...NATIVE_EVIDENCE_PROJECTION_REF.split('/'));
}

/**
 * Read the current evidence for a change and write the human-readable
 * projection. No-op when no evidence is recorded yet (e.g. during the shape
 * phase). All reads go through the content-addressed readers, which re-hash on
 * read, so a corrupt or tampered evidence document surfaces as an error here
 * rather than being projected.
 */
export async function writeNativeEvidenceProjection(
  paths: NativeProjectPaths,
  name: string,
  options: { now?: Date } = {},
): Promise<void> {
  const state = await readNativeChange(paths, name);
  const scopeRef = state.implementation_scope;
  const verificationRef = state.verification_evidence;

  if (!scopeRef && !verificationRef) {
    return;
  }

  const scope = scopeRef ? await readNativeImplementationScope(paths, name, scopeRef) : null;
  const envelope = verificationRef
    ? await readNativeVerificationEvidence(paths, name, verificationRef)
    : null;

  const receiptRefs = envelope ? [...new Set(envelope.receiptRefs)].sort(sortText) : [];
  const receipts: NativeVerificationReceipt[] = [];
  for (const ref of receiptRefs) {
    try {
      receipts.push(await readNativeVerificationReceipt(paths, name, ref));
    } catch {
      // A receipt ref that cannot be read is still surfaced by the verification
      // evidence reader's dependency check; the projection lists what it can.
    }
  }

  const markdown = renderNativeEvidenceProjectionMarkdown({
    change: name,
    phase: state.phase,
    revision: state.revision,
    language: state.language,
    scope,
    envelope,
    receipts,
    generatedAt: (options.now ?? new Date()).toISOString(),
  });

  await atomicWriteText(nativeEvidenceProjectionFile(paths, name), markdown, {
    containedRoot: nativeChangeDir(paths, name),
  });
}
