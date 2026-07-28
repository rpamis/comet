import path from 'path';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import type { VerifyResult, VerifySummary } from './types.js';

const VALID_RESULTS: ReadonlySet<VerifyResult> = new Set(['pending', 'pass', 'fail', 'unknown']);
const DEFAULT_REPORT_RELATIVE = '.comet/verify-result.md';
const SUMMARY_LINE_BUDGET = 6;
const SUMMARY_CHAR_BUDGET = 480;
const REPORT_READ_LIMIT_BYTES = 2 * 1024 * 1024;

export interface VerifyContext {
  changeDir: string;
  yaml: Record<string, string>;
  projectRoot?: string;
}

/**
 * Resolve a change's verify state in this order:
 *  1. `yaml.verify_result` (or `verifyResult`) if it parses to a known value.
 *  2. Presence of a verify report: explicit `verification_report` path first,
 *     falling back to `.comet/verify-result.md`.
 *  3. Heuristic: if a report exists but the yaml is silent, assume `fail` —
 *     the report wouldn't usually exist for a passing run that hasn't been
 *     recorded in the yaml.
 *  4. Otherwise `unknown` / `pending` per the report's absence.
 */
export async function resolveVerify(ctx: VerifyContext): Promise<VerifySummary> {
  const declared = normalizeResult(ctx.yaml.verify_result ?? ctx.yaml.verifyResult);

  const defaultReportPath = path.join(ctx.changeDir, DEFAULT_REPORT_RELATIVE);
  const projectRoot = path.resolve(ctx.projectRoot ?? ctx.changeDir);
  const explicitReport = stripNullish(ctx.yaml.verification_report ?? ctx.yaml.verificationReport);
  const explicitPath = explicitReport
    ? await resolveProtectedReport(projectRoot, explicitReport)
    : null;
  const reportPath = explicitPath ?? defaultReportPath;
  const relativeReport = path.relative(projectRoot, reportPath).replaceAll('\\', '/');
  let reportExists = false;
  let summary: string | undefined;
  try {
    const result = await readProtectedProjectFile(
      projectRoot,
      relativeReport,
      REPORT_READ_LIMIT_BYTES,
      { label: 'Classic verification report' },
    );
    reportExists = true;
    summary = summarize(result.bytes.toString('utf-8'));
  } catch {
    // Unsafe, missing, or unreadable reports must not influence dashboard state.
  }

  let result: VerifyResult;
  if (declared) {
    result = declared;
  } else if (reportExists) {
    // A report exists but nothing in the yaml — assume a failure was recorded.
    result = 'fail';
  } else {
    result = 'unknown';
  }

  const out: VerifySummary = { result, reportExists };
  if (summary) out.summary = summary;
  return out;
}

/**
 * Resolve `candidate` against `root` only if the resolved path stays inside
 * `root`. Returns `null` when the candidate is absolute or escapes via `..`,
 * so callers can fall back to a safe default. A malicious `.comet.yaml` must
 * not be able to point the dashboard at arbitrary files on disk.
 */
async function resolveProtectedReport(root: string, candidate: string): Promise<string | null> {
  try {
    return (
      await inspectProtectedProjectPath(root, candidate, {
        label: 'Classic verification report',
        expected: 'file',
      })
    ).target;
  } catch {
    return null;
  }
}

function normalizeResult(raw: string | undefined): VerifyResult | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return VALID_RESULTS.has(value as VerifyResult) ? (value as VerifyResult) : null;
}

function stripNullish(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value || value === 'null') return undefined;
  return value;
}

function summarize(content: string): string | undefined {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, SUMMARY_LINE_BUDGET);
  const joined = lines.join('\n');
  if (!joined) return undefined;
  return joined.length > SUMMARY_CHAR_BUDGET
    ? `${joined.slice(0, SUMMARY_CHAR_BUDGET - 1)}…`
    : joined;
}
