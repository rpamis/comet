import path from 'node:path';

import { atomicWriteText } from './native-atomic-file.js';
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

function describeScopeChangeKind(kind: 'added' | 'modified' | 'removed'): string {
  switch (kind) {
    case 'added':
      return 'added';
    case 'modified':
      return 'modified';
    case 'removed':
      return 'removed';
  }
}

function describeBytes(before: number | null, after: number | null): string {
  if (before === null && after === null) return 'unknown size';
  if (before === null) return `0→${after} bytes`;
  if (after === null) return `${before}→0 bytes`;
  if (before === after) return `${after} bytes`;
  return `${before}→${after} bytes`;
}

function renderScopeSection(scope: NativeImplementationScope): string[] {
  const lines: string[] = [
    '## Implementation scope',
    '',
    `- Source: ${scope.baselineProjectionRef.replace(/^runtime\/evidence\/snapshots\//u, 'evidence/snapshots/')}`,
    `- Current: ${scope.currentProjectionRef.replace(/^runtime\/evidence\/snapshots\//u, 'evidence/snapshots/')}`,
    `- Scope: evidence/scopes/${shortHash(scope.scopeHash)}.json`,
    `- Status: ${scope.complete ? 'complete' : 'partial (has unresolved scope)'}`,
    `- Declared artifacts: ${scope.declaredArtifacts.length}`,
  ];

  if (scope.noCodeReason) {
    lines.push(`- No-code reason: ${scope.noCodeReason}`);
  }
  if (scope.unattributed.length > 0) {
    lines.push(`- Unattributed changes: ${scope.unattributed.length}`);
  }

  lines.push('');

  const changes = [...scope.changes].sort((a, b) => sortText(a.path, b.path));
  const limit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxScopeChanges;
  const shown = changes.slice(0, limit);
  const truncated = changes.length - shown.length;

  if (shown.length === 0) {
    lines.push('No implementation changes detected between baseline and current snapshots.', '');
  } else {
    for (const change of shown) {
      const attribution =
        change.attributedTo.length > 0
          ? ` (covers: ${change.attributedTo.map((artifact) => artifact.path).join(', ')})`
          : '';
      lines.push(
        `- ${change.path} ${describeScopeChangeKind(change.kind)} ${describeBytes(
          change.before?.size ?? null,
          change.after?.size ?? null,
        )}${attribution}`,
      );
    }
    if (truncated > 0) {
      lines.push(
        `- ... ${truncated} more change(s) truncated; read the scope evidence for the full set`,
      );
    }
    lines.push('');
  }

  const unresolved = [...scope.unresolvedScopes].sort((a, b) => sortText(a.reason, b.reason));
  const unresolvedLimit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxUnresolvedReasons;
  const unresolvedShown = unresolved.slice(0, unresolvedLimit);
  if (unresolvedShown.length > 0) {
    lines.push('### Unresolved scope', '');
    for (const entry of unresolvedShown) {
      lines.push(`- ${entry.reason}`);
    }
    const unresolvedTruncated = unresolved.length - unresolvedShown.length;
    if (unresolvedTruncated > 0) {
      lines.push(`- ... ${unresolvedTruncated} more unresolved reason(s) truncated`);
    }
    lines.push('');
  }

  return lines;
}

function describeAcceptanceStatus(status: 'passed' | 'failed' | 'missing'): string {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'missing':
      return 'missing';
  }
}

function renderVerificationSection(
  envelope: NativeReadableVerificationEvidenceEnvelope,
  receipts: readonly NativeVerificationReceipt[],
): string[] {
  const lines: string[] = [
    '## Verification',
    '',
    `- Result: ${envelope.result}`,
    `- Freshness: ${envelope.freshness}`,
    `- Evidence: evidence/verifications/${shortHash(envelope.envelopeHash)}.json`,
    `- Contract: ${shortHash(envelope.contractHash)}`,
    `- Acceptance criteria: ${shortHash(envelope.acceptanceCriteriaHash)}`,
  ];

  if (envelope.partialAllowanceRef) {
    lines.push(
      `- Partial allowance: ${envelope.partialAllowanceRef.replace(/^runtime\/evidence\/allowances\//u, 'evidence/allowances/')}`,
    );
  }

  lines.push(
    `- Acceptance coverage: ${envelope.acceptanceTrace.evidenced}/${envelope.acceptanceTrace.total} evidenced, ${envelope.acceptanceTrace.skipped} skipped`,
    '',
  );

  const entries = [...envelope.acceptanceTrace.entries].sort((a, b) =>
    sortText(a.acceptanceId, b.acceptanceId),
  );
  const limit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxAcceptanceEntries;
  const shown = entries.slice(0, limit);
  const truncated = entries.length - shown.length;

  if (shown.length > 0) {
    lines.push('### Acceptance trace', '');
    for (const entry of shown) {
      const reason = entry.skippedReason ? ` — ${entry.skippedReason}` : '';
      const refs =
        entry.evidenceRefs.length > 0
          ? ` (${entry.evidenceRefs
              .map((ref) => ref.replace(/^runtime\/evidence\/receipts\//u, 'evidence/receipts/'))
              .join(', ')})`
          : '';
      lines.push(
        `- ${shortHash(entry.acceptanceId)} (${entry.kind}, ${entry.source}) ${describeAcceptanceStatus(entry.status)}${refs}${reason}`,
      );
    }
    if (truncated > 0) {
      lines.push(
        `- ... ${truncated} more acceptance entr${truncated === 1 ? 'y' : 'ies'} truncated`,
      );
    }
    lines.push('');
  }

  if (receipts.length > 0) {
    const sortedReceipts = [...receipts].sort((a, b) => sortText(a.receiptHash, b.receiptHash));
    const receiptLimit = NATIVE_EVIDENCE_PROJECTION_LIMITS.maxReceipts;
    const shownReceipts = sortedReceipts.slice(0, receiptLimit);
    const receiptsTruncated = sortedReceipts.length - shownReceipts.length;
    lines.push('### Check receipts', '');
    for (const receipt of shownReceipts) {
      lines.push(...renderReceipt(receipt));
    }
    if (receiptsTruncated > 0) {
      lines.push(`- ... ${receiptsTruncated} more receipt(s) truncated`);
    }
    lines.push('');
  }

  return lines;
}

function renderReceipt(receipt: NativeVerificationReceipt): string[] {
  const lines: string[] = [
    `- ${receipt.kind} (${receipt.role}) ${receipt.status} — evidence/receipts/${shortHash(receipt.receiptHash)}.json`,
  ];
  if (receipt.kind === 'automated-check') {
    const evidence = receipt.evidence;
    const command = [evidence.executable, ...evidence.args].join(' ');
    lines.push(`  - command: \`${command}\``);
    lines.push(`  - exit code: ${evidence.exitCode}`);
    if (evidence.timedOut) {
      lines.push(`  - timed out after ${evidence.timeoutMs}ms`);
    }
    lines.push(
      `  - summary: ${evidence.outputSummary}${evidence.outputTruncated ? ' (truncated)' : ''}`,
    );
  } else if (receipt.kind === 'static-inspection') {
    const evidence = receipt.evidence;
    lines.push(`  - rule: ${evidence.rule}`);
    lines.push(`  - subjects: ${evidence.subjects.length}`);
    lines.push(`  - summary: ${evidence.resultSummary}`);
  } else {
    const evidence = receipt.evidence;
    if (evidence.steps.length > 0) {
      lines.push(`  - steps: ${evidence.steps.length}`);
    }
    if (evidence.observations.length > 0) {
      lines.push(`  - observations: ${evidence.observations.length}`);
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
  scope: NativeImplementationScope | null;
  envelope: NativeReadableVerificationEvidenceEnvelope | null;
  receipts: readonly NativeVerificationReceipt[];
  generatedAt: string;
}): string {
  const lines: string[] = [
    '# Comet Native Evidence Projection',
    '',
    `- Change: ${input.change}`,
    `- Phase: ${input.phase}`,
    `- Revision: ${input.revision}`,
    `- Generated-at: ${input.generatedAt}`,
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
    lines.push(...renderScopeSection(input.scope));
  } else {
    lines.push('## Implementation scope', '', 'No implementation scope evidence recorded yet.', '');
  }

  if (input.envelope) {
    lines.push(...renderVerificationSection(input.envelope, input.receipts));
  } else {
    lines.push('## Verification', '', 'No verification evidence recorded yet.', '');
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
    scope,
    envelope,
    receipts,
    generatedAt: (options.now ?? new Date()).toISOString(),
  });

  await atomicWriteText(nativeEvidenceProjectionFile(paths, name), markdown, {
    containedRoot: nativeChangeDir(paths, name),
  });
}
