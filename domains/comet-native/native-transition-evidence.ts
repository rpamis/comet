import { sha256Text } from './native-hash.js';
import type { NativeAdvanceEvidence } from './native-types.js';

/** Stable hash for the model-supplied phase evidence; it deliberately excludes hidden reasoning. */
export function nativeAdvanceEvidenceHash(evidence: NativeAdvanceEvidence): string {
  return sha256Text(
    JSON.stringify({
      summary: evidence.summary,
      confirmed: evidence.confirmed ?? false,
      artifacts: [...(evidence.artifacts ?? [])].sort(),
      noCodeReason: evidence.noCodeReason ?? null,
      verificationResult: evidence.verificationResult ?? null,
      verificationReport: evidence.verificationReport ?? null,
      verificationReceipt: evidence.verificationReceipt ?? null,
      verificationReceiptRefs:
        evidence.verificationReceiptRefs === undefined
          ? null
          : [...evidence.verificationReceiptRefs].sort(),
      verificationWaiverRefs:
        evidence.verificationWaiverRefs === undefined
          ? null
          : [...evidence.verificationWaiverRefs].sort(),
      independentReviewReceiptRef: evidence.independentReviewReceiptRef ?? null,
      allowPartialScopeHash: evidence.allowPartialScopeHash ?? null,
      partialReason: evidence.partialReason ?? null,
      repairFailureCategories: [...(evidence.repairFailureCategories ?? [])].sort(),
      repairFailedCheckIds: [...(evidence.repairFailedCheckIds ?? [])].sort(),
      repairOverrideSignature: evidence.repairOverrideSignature ?? null,
      repairOverrideSummary: evidence.repairOverrideSummary ?? null,
    }),
  );
}
