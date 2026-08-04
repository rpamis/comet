import path from 'node:path';

import {
  NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER,
  NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER,
  parseNativeVerificationMachineBlock,
  serializeNativeVerificationMachineBlock,
  type NativeAcceptanceEvidenceEntry,
} from './native-acceptance.js';
import { atomicWriteText } from './native-atomic-file.js';
import { nativeChangeDir, readNativeChange } from './native-change.js';
import { readNativeBoundedTextFile } from './native-bounded-file.js';
import {
  readNativeVerificationEvidence,
  readNativeVerificationReceipt,
} from './native-evidence-storage.js';
import type { NativeProjectPaths } from './native-types.js';
import {
  assertNativeReceiptScopeCurrent,
  compareNativeReceiptBindings,
  issueNativeManualEvidenceReceipt,
  loadNativeVerificationReceiptContext,
} from './native-verification-receipt-runtime.js';
import type { NativeVerificationReceipt } from './native-verification-receipt.js';
import type { NativeAcceptanceTraceEntry } from './native-verification-evidence.js';

/**
 * A manual-evidence receipt whose bindings diverge from the current revision
 * and can be safely re-issued in place. {@link refreshNativeVerificationReceipts}
 * re-issues these automatically under `--apply`.
 */
export interface NativeReceiptRefreshManualItem {
  oldRef: string;
  acceptanceIds: string[];
}

/**
 * An automated-check receipt that is stale. Automated receipts cannot be
 * silently re-issued because they attest to a real command execution; the Agent
 * must re-run the recorded command to produce fresh evidence. This entry
 * carries the original command so the Agent can re-run it directly.
 */
export interface NativeReceiptRefreshRerunItem {
  oldRef: string;
  acceptanceIds: string[];
  command: string;
  timeoutMs: number;
}

/** A manual receipt whose contract/scope/artifact binding changed and needs a new observation. */
export interface NativeReceiptRefreshManualRequiredItem {
  oldRef: string;
  acceptanceIds: string[];
  mismatches: string[];
}

/**
 * A required-check (static-inspection) receipt that is stale. These are
 * produced by `comet native check` and re-issued automatically by `next
 * --result pass`, so a refresh reports them as a hint rather than re-issuing.
 */
export interface NativeReceiptRefreshCheckItem {
  oldRef: string;
}

export interface NativeReceiptRefreshResult {
  /** Manual receipts re-issued under `--apply` (old ref -> new ref, per acceptance). */
  refreshed: { acceptanceId: string; oldRef: string; newRef: string }[];
  /** Automated receipts that must be re-run; empty unless stale automated receipts exist. */
  requiresRerun: NativeReceiptRefreshRerunItem[];
  /** Manual receipts that cannot be re-issued because their non-revision bindings changed. */
  requiresManual: NativeReceiptRefreshManualRequiredItem[];
  /** Required-check receipts that must be re-produced via `comet native check`. */
  requiresCheck: NativeReceiptRefreshCheckItem[];
  /** True when `--apply` was used and verification.md was rewritten. */
  applied: boolean;
  /** Relative ref of the verification report updated under `--apply`. */
  verificationReport: string | null;
}

const NATIVE_RECEIPT_REFRESH_STEP_PREFIX = 'Native receipt re-issued after revision bump';

export function isManualReceiptRefreshSafe(comparison: {
  ok: boolean;
  mismatches: readonly string[];
}): boolean {
  return (
    !comparison.ok &&
    comparison.mismatches.length === 1 &&
    comparison.mismatches[0]?.startsWith('sourceRevision: ') === true
  );
}

function formatAutomatedCommand(receipt: NativeVerificationReceipt): string {
  if (receipt.kind !== 'automated-check') return '<unknown automated receipt>';
  const parts = [receipt.evidence.executable, ...receipt.evidence.args];
  return parts.map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(' ');
}

function describeManualStep(revision: number): string {
  return `${NATIVE_RECEIPT_REFRESH_STEP_PREFIX} to revision ${revision}`;
}

function describeManualObservation(): string {
  return 'Manual evidence re-issued via `comet native receipt refresh` to restore revision binding.';
}

/**
 * Inspect — and optionally repair — stale verification receipts bound to an
 * older revision than the current state.
 *
 * The revision-bound receipt model intentionally invalidates any receipt whose
 * `sourceRevision` differs from the current state revision (a tamper-resistance
 * guarantee). But ordinary state writes (checkpoints, spec refresh, advancing
 * phases) bump the revision, which can leave previously-issued receipts stale.
 * This function lets an Agent recover on its own: under `--apply` it re-issues
 * manual-evidence receipts whose only mismatch is the source revision at the
 * current revision and rewrites the acceptance-evidence block in
 * `verification.md`, while reporting receipts that require fresh evidence.
 * An implementation scope that changed after Build is a different recovery
 * class and fails before receipt inspection with the exact command for
 * returning to Build and re-freezing the scope.
 *
 * Returns a structured report so the Agent can drive recovery programmatically
 * rather than parsing prose.
 */
export async function refreshNativeVerificationReceipts(options: {
  paths: NativeProjectPaths;
  name: string;
  apply: boolean;
}): Promise<NativeReceiptRefreshResult> {
  const state = await readNativeChange(options.paths, options.name);
  if (state.phase !== 'verify') {
    throw new Error(
      `Native receipt refresh requires Verify, got ${state.phase} for ${options.name}`,
    );
  }
  const context = state.implementation_scope
    ? await loadNativeVerificationReceiptContext(options.paths, state)
    : null;
  if (context) {
    await assertNativeReceiptScopeCurrent({ paths: options.paths, state, context });
  }
  if (!state.verification_evidence) {
    // No envelope yet: nothing has been verified, so there is nothing to refresh.
    return {
      refreshed: [],
      requiresRerun: [],
      requiresManual: [],
      requiresCheck: [],
      applied: false,
      verificationReport: null,
    };
  }
  if (!context) {
    throw new Error('Native receipt refresh requires an implementation scope');
  }
  const envelope = await readNativeVerificationEvidence(
    options.paths,
    options.name,
    state.verification_evidence,
  );

  const manualItems: NativeReceiptRefreshManualItem[] = [];
  const manualRequiredItems: NativeReceiptRefreshManualRequiredItem[] = [];
  const rerunItems: NativeReceiptRefreshRerunItem[] = [];
  const checkItems: NativeReceiptRefreshCheckItem[] = [];
  // Track which refs are fresh so the entry reconstruction can preserve them.
  const staleRefs = new Set<string>();

  const allRefs = [...new Set([...envelope.requiredReceiptRefs, ...envelope.receiptRefs])];
  for (const ref of allRefs) {
    const receipt = await readNativeVerificationReceipt(options.paths, options.name, ref);
    const comparison = compareNativeReceiptBindings(receipt, context.bindings);
    if (comparison.ok) continue;
    staleRefs.add(ref);
    if (receipt.kind === 'manual-evidence') {
      const item = { oldRef: ref, acceptanceIds: [...receipt.acceptanceIds] };
      if (isManualReceiptRefreshSafe(comparison)) {
        manualItems.push(item);
      } else {
        manualRequiredItems.push({ ...item, mismatches: comparison.mismatches });
      }
    } else if (receipt.kind === 'automated-check') {
      rerunItems.push({
        oldRef: ref,
        acceptanceIds: [...receipt.acceptanceIds],
        command: formatAutomatedCommand(receipt),
        timeoutMs: receipt.evidence.timeoutMs,
      });
    } else if (receipt.kind === 'static-inspection') {
      checkItems.push({ oldRef: ref });
    }
  }

  // When there are stale automated receipts, never auto-apply: the Agent must
  // re-run those commands to produce honest evidence. Surface the report so it
  // can do exactly that.
  const canAutoApply =
    options.apply &&
    rerunItems.length === 0 &&
    manualRequiredItems.length === 0 &&
    manualItems.length > 0;
  if (!canAutoApply) {
    return {
      refreshed: [],
      requiresRerun: rerunItems,
      requiresManual: manualRequiredItems,
      requiresCheck: checkItems,
      applied: false,
      verificationReport: state.verification_report,
    };
  }

  // Re-issue a single manual receipt covering every stale-manual acceptance so
  // the evidence block stays compact and the binding is uniform at the current
  // revision. Issue per acceptance-id set to map old->new precisely.
  const refreshed: NativeReceiptRefreshResult['refreshed'] = [];
  const newRefByAcceptance = new Map<string, string>();
  // Group stale manual receipts by their acceptance-id set to re-issue faithfully.
  const groupsByKey = new Map<string, string[]>();
  for (const item of manualItems) {
    const key = [...item.acceptanceIds].sort().join('\n');
    const bucket = groupsByKey.get(key);
    if (bucket) {
      bucket.push(item.oldRef);
    } else {
      groupsByKey.set(key, [item.oldRef]);
    }
  }
  for (const [acceptanceKey, oldRefs] of groupsByKey) {
    const acceptanceIds = acceptanceKey.split('\n');
    const issued = await issueNativeManualEvidenceReceipt({
      paths: options.paths,
      name: options.name,
      acceptanceIds,
      steps: [describeManualStep(state.revision)],
      observations: [describeManualObservation()],
    });
    for (const acceptanceId of acceptanceIds) {
      newRefByAcceptance.set(acceptanceId, issued.ref);
    }
    for (const oldRef of oldRefs) {
      // Map each old ref to the new one for the first acceptance it carried.
      const primaryAcceptanceId = manualItems.find((item) => item.oldRef === oldRef)
        ?.acceptanceIds[0];
      if (primaryAcceptanceId) {
        refreshed.push({ acceptanceId: primaryAcceptanceId, oldRef, newRef: issued.ref });
      }
    }
  }

  // Rebuild the acceptance-evidence entries from the trace, substituting stale
  // manual refs with the freshly issued ones while preserving fresh refs.
  const reportRef = state.verification_report;
  if (!reportRef) {
    throw new Error(
      `Native receipt refresh cannot rewrite verification report: ${options.name} has no report ref`,
    );
  }
  const changeDir = nativeChangeDir(options.paths, options.name);
  const report = await readNativeBoundedTextFile({ root: changeDir, ref: reportRef });
  const existingEntries = parseNativeVerificationMachineBlock(report.text);
  const newEntries = rebuildAcceptanceEvidenceEntries(
    envelope.acceptanceTrace.entries,
    existingEntries,
    staleRefs,
    newRefByAcceptance,
  );
  const block = serializeNativeVerificationMachineBlock(newEntries);
  const updatedReport = replaceAcceptanceEvidenceBlock(report.text, block);
  await atomicWriteText(path.join(changeDir, ...reportRef.split('/')), updatedReport);

  return {
    refreshed,
    requiresRerun: [],
    requiresManual: [],
    requiresCheck: checkItems,
    applied: true,
    verificationReport: reportRef,
  };
}

/**
 * Rebuild acceptance-evidence entries by swapping stale manual receipt refs for
 * the freshly issued ones. Fresh (non-stale) refs are preserved verbatim so
 * unrelated evidence is not invalidated.
 */
function rebuildAcceptanceEvidenceEntries(
  traceEntries: readonly NativeAcceptanceTraceEntry[],
  existingEntries: readonly NativeAcceptanceEvidenceEntry[],
  staleRefs: ReadonlySet<string>,
  newRefByAcceptance: ReadonlyMap<string, string>,
): NativeAcceptanceEvidenceEntry[] {
  const entriesByAcceptance = new Map<string, NativeAcceptanceEvidenceEntry>();
  for (const entry of existingEntries) {
    entriesByAcceptance.set(entry.acceptance_id, entry);
  }
  const rebuilt: NativeAcceptanceEvidenceEntry[] = [];
  for (const trace of traceEntries) {
    const existing = entriesByAcceptance.get(trace.acceptanceId);
    if (!existing) continue;
    if (trace.status === 'failed') {
      // Failed entries are not refreshed here; keep as-is.
      rebuilt.push(existing);
      continue;
    }
    const preservedRefs = existing.evidence_refs.filter((ref) => !staleRefs.has(ref));
    const newRef = newRefByAcceptance.get(trace.acceptanceId);
    const evidenceRefs = newRef !== undefined ? [...preservedRefs, newRef] : preservedRefs;
    if (evidenceRefs.length === 0) {
      // No evidence to reference after refresh; keep the original entry so the
      // problem surfaces in the next `next` attempt rather than silently dropping.
      rebuilt.push(existing);
      continue;
    }
    const entry: NativeAcceptanceEvidenceEntry = {
      acceptance_id: existing.acceptance_id,
      status: existing.status,
      evidence_refs: [...new Set(evidenceRefs)].sort(),
    };
    if (existing.skipped_reason !== undefined) {
      entry.skipped_reason = existing.skipped_reason;
    }
    rebuilt.push(entry);
  }
  return rebuilt;
}

/**
 * Replace the marker-delimited acceptance-evidence machine block in a
 * verification report while leaving all surrounding markdown (required H1
 * sections, prose) untouched.
 */
export function replaceAcceptanceEvidenceBlock(markdown: string, newBlock: string): string {
  const startIndex = markdown.indexOf(NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER);
  if (startIndex < 0) {
    throw new Error('Native verification report is missing the acceptance-evidence start marker');
  }
  const endIndex = markdown.indexOf(NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER, startIndex);
  if (endIndex < 0) {
    throw new Error('Native verification report is missing the acceptance-evidence end marker');
  }
  const before = markdown.slice(0, startIndex);
  const after = markdown.slice(endIndex + NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER.length);
  // The serialized block already contains both markers; keep the surrounding
  // line structure stable by anchoring on the marker positions.
  return `${before}${newBlock}${after}`;
}
