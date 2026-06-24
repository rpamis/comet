import { promises as fs } from 'fs';
import path from 'path';
import { fileExists } from '../utils/file-system.js';
import type { VerifyResult, VerifySummary } from './types.js';

const VALID_RESULTS: ReadonlySet<VerifyResult> = new Set(['pending', 'pass', 'fail', 'unknown']);
const DEFAULT_REPORT_RELATIVE = '.comet/verify-result.md';
const SUMMARY_LINE_BUDGET = 6;
const SUMMARY_CHAR_BUDGET = 480;

export interface VerifyContext {
  changeDir: string;
  yaml: Record<string, string>;
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
  const explicitReport = stripNullish(ctx.yaml.verification_report ?? ctx.yaml.verificationReport);
  const reportPath = explicitReport
    ? (safeJoin(ctx.changeDir, explicitReport) ?? defaultReportPath)
    : defaultReportPath;

  const reportExists = await fileExists(reportPath);
  const summary = reportExists ? await readSummary(reportPath) : undefined;

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
function safeJoin(root: string, candidate: string): string | null {
  if (path.isAbsolute(candidate)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return resolved;
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

async function readSummary(reportPath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(reportPath, 'utf-8');
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
  } catch {
    return undefined;
  }
}
