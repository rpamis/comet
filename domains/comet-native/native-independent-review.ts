import { canonicalHash } from './native-canonical-hash.js';
import { redactNativeCredentialText } from './native-redaction.js';

const HASH_TAG = 'comet.native.independent-review.v1';
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_TEXT = 2_000;

export interface NativeIndependentReviewFinding {
  severity: 'P0' | 'P1' | 'P2';
  status: 'resolved' | 'open';
  summary: string;
}

export interface NativeIndependentReview {
  schema: 'comet.native.independent-review.v1';
  implementationAuthor: string;
  reviewer: string;
  acceptanceIds: string[];
  checked: {
    unifiedIo: boolean;
    adversarialPaths: boolean;
    generatedAssets: boolean;
    lifecycleEval: boolean;
  };
  findings: NativeIndependentReviewFinding[];
  reviewHash: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label} fields are invalid`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = redactNativeCredentialText(value).trim();
  if (!normalized || normalized.length > MAX_TEXT) throw new Error(`${label} is invalid`);
  return normalized;
}

function reviewContent(
  value: unknown,
  expectedAcceptanceIds: readonly string[],
): Omit<NativeIndependentReview, 'reviewHash'> {
  const root = object(value, 'Native independent review');
  exactKeys(
    root,
    ['implementation_author', 'reviewer', 'acceptance_ids', 'checked', 'findings'],
    'Native independent review',
  );
  const implementationAuthor = text(root.implementation_author, 'Native implementation author');
  const reviewer = text(root.reviewer, 'Native review reviewer');
  if (implementationAuthor === reviewer)
    throw new Error('Native independent review reviewer must differ from implementation author');
  if (!Array.isArray(root.acceptance_ids)) throw new Error('Native independent review is invalid');
  const acceptanceIds = root.acceptance_ids.map((entry) => {
    if (typeof entry !== 'string' || !/^acceptance-[a-f0-9]{64}$/u.test(entry))
      throw new Error('Native independent review acceptance ID is invalid');
    return entry;
  });
  const expected = [...expectedAcceptanceIds].sort();
  if (
    new Set(acceptanceIds).size !== acceptanceIds.length ||
    JSON.stringify([...acceptanceIds].sort()) !== JSON.stringify(expected)
  )
    throw new Error('Native independent review does not cover every acceptance ID');
  const checked = object(root.checked, 'Native independent review checked');
  exactKeys(
    checked,
    ['unified_io', 'adversarial_paths', 'generated_assets', 'lifecycle_eval'],
    'Native independent review checked',
  );
  if (Object.values(checked).some((entry) => entry !== true))
    throw new Error('Native independent review has incomplete required checks');
  if (!Array.isArray(root.findings) || root.findings.length > 128)
    throw new Error('Native independent review findings are invalid');
  const findings = root.findings.map((entry, index): NativeIndependentReviewFinding => {
    const finding = object(entry, `Native independent review finding ${index}`);
    exactKeys(
      finding,
      ['severity', 'status', 'summary'],
      `Native independent review finding ${index}`,
    );
    if (
      !['P0', 'P1', 'P2'].includes(finding.severity as string) ||
      !['resolved', 'open'].includes(finding.status as string)
    )
      throw new Error(`Native independent review finding ${index} is invalid`);
    return {
      severity: finding.severity as NativeIndependentReviewFinding['severity'],
      status: finding.status as NativeIndependentReviewFinding['status'],
      summary: text(finding.summary, `Native independent review finding ${index} summary`),
    };
  });
  if (
    findings.some((finding) => finding.status === 'open' && ['P0', 'P1'].includes(finding.severity))
  )
    throw new Error('Native independent review has unresolved P0/P1 findings');
  return {
    schema: 'comet.native.independent-review.v1',
    implementationAuthor,
    reviewer,
    acceptanceIds: [...acceptanceIds].sort(),
    checked: {
      unifiedIo: true,
      adversarialPaths: true,
      generatedAssets: true,
      lifecycleEval: true,
    },
    findings,
  };
}

export function formatNativeIndependentReview(
  value: unknown,
  expectedAcceptanceIds: readonly string[],
): Record<string, unknown> {
  const content = reviewContent(value, expectedAcceptanceIds);
  return {
    schema: content.schema,
    implementation_author: content.implementationAuthor,
    reviewer: content.reviewer,
    acceptance_ids: content.acceptanceIds,
    checked: {
      unified_io: true,
      adversarial_paths: true,
      generated_assets: true,
      lifecycle_eval: true,
    },
    findings: content.findings,
    review_hash: canonicalHash(HASH_TAG, content),
  };
}

/** Parse a review supplied by an independent reviewer and bind it to the current acceptance set. */
export function parseNativeIndependentReview(
  value: unknown,
  expectedAcceptanceIds: readonly string[],
): NativeIndependentReview {
  const root = object(value, 'Native independent review');
  exactKeys(
    root,
    [
      'schema',
      'implementation_author',
      'reviewer',
      'acceptance_ids',
      'checked',
      'findings',
      'review_hash',
    ],
    'Native independent review',
  );
  if (root.schema !== 'comet.native.independent-review.v1')
    throw new Error('Native independent review is invalid');
  const { review_hash: _hash, schema: _schema, ...input } = root;
  void _hash;
  void _schema;
  const content = reviewContent(input, expectedAcceptanceIds);
  if (
    typeof root.review_hash !== 'string' ||
    !HASH_PATTERN.test(root.review_hash) ||
    canonicalHash(HASH_TAG, content) !== root.review_hash
  ) {
    throw new Error('Native independent review hash is invalid');
  }
  return { ...content, reviewHash: root.review_hash };
}

export function isNativeHighRiskScope(
  changes: readonly (string | { path: string; before: unknown | null; after: unknown | null })[],
): boolean {
  return changes.some((change) => {
    if (typeof change !== 'string' && change.before !== null && change.after === null) {
      return true;
    }
    const rawPath = typeof change === 'string' ? change : change.path;
    const path = rawPath.replaceAll('\\', '/');
    return (
      /^(?:app|domains|platform|config)\//u.test(path) ||
      /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/u.test(path) ||
      /^assets\/(?:manifest\.json|skills(?:-zh)?\/)/u.test(path) ||
      /^scripts\/.*(?:build.*runtime|runtime.*build|release|install|uninstall|migrat|manifest)/iu.test(
        path,
      ) ||
      /^(?:app|domains)\/.*(?:security|permission|persist|archive|transaction|migration|protected|path|process|state|schema|hook|router|runtime|install|uninstall)[a-z0-9-]*\.(?:[cm]?[jt]s|tsx?)$/iu.test(
        path,
      )
    );
  });
}
