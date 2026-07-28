/**
 * Stable public trust-policy path shared by snapshot capture and review validation.
 * Keep this low-level module free of verification/snapshot imports to avoid a runtime cycle.
 */
export const NATIVE_REVIEW_TRUST_POLICY_REF = '.comet/native-review-trust.json';
