export interface NativeOutcomeEvidence {
  reviewResolved: boolean;
  failureResolved: boolean;
  summary?: string;
}

export interface NativeLifecycleEvidence {
  changedPaths: string[];
  artifactRefs: string[];
}

export function parseNativeOutcomeEvidence(stdout: string | undefined): NativeOutcomeEvidence {
  if (!stdout?.trim()) return { reviewResolved: false, failureResolved: false };
  try {
    const data = nativeResultData(stdout);
    if (data === null) return { reviewResolved: false, failureResolved: false };
    const raw = data.change ?? data.state ?? data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { reviewResolved: false, failureResolved: false };
    }
    const change = raw as Record<string, unknown>;
    const verification =
      change.verification &&
      typeof change.verification === 'object' &&
      !Array.isArray(change.verification)
        ? (change.verification as Record<string, unknown>)
        : {};
    const verdict = verification.verdict ?? change.verification_result;
    const reviewResolved = change.phase === 'archive' && verdict === 'pass';
    const history = Array.isArray(change.history) ? change.history : [];
    const failureResolved =
      reviewResolved &&
      history.some(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          ((entry as Record<string, unknown>).outcome === 'fail' ||
            (entry as Record<string, unknown>).verdict === 'fail'),
      );
    const summary =
      typeof verification.summary === 'string'
        ? verification.summary.trim()
        : typeof change.summary === 'string'
          ? change.summary.trim()
          : undefined;
    return {
      reviewResolved,
      failureResolved,
      ...(summary ? { summary } : {}),
    };
  } catch {
    return { reviewResolved: false, failureResolved: false };
  }
}

export function parseNativeLifecycleEvidence(stdout: string | undefined): NativeLifecycleEvidence {
  if (!stdout?.trim()) return { changedPaths: [], artifactRefs: [] };
  try {
    const data = nativeResultData(stdout);
    if (data === null) return { changedPaths: [], artifactRefs: [] };
    const list = (candidate: unknown): string[] =>
      Array.isArray(candidate)
        ? candidate.filter((entry): entry is string => typeof entry === 'string').slice(0, 24)
        : [];
    return {
      changedPaths: list(data.changedPaths),
      artifactRefs: list(data.artifactRefs ?? data.artifacts),
    };
  } catch {
    return { changedPaths: [], artifactRefs: [] };
  }
}

function nativeResultData(stdout: string): Record<string, unknown> | null {
  const value = JSON.parse(stdout) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : record;
}
