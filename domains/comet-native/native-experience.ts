export interface NativeOutcomeEvidence {
  reviewResolved: boolean;
  failureResolved: boolean;
  summary?: string;
}

export interface NativeLifecycleEvidence {
  changedPaths: string[];
  artifactRefs: string[];
}

export interface NativeExperienceEvidence {
  lifecycle: NativeLifecycleEvidence;
  outcome: NativeOutcomeEvidence;
}

export function projectNativeExperienceEvidence(
  data: unknown,
  structuredDataVisible: boolean,
): NativeExperienceEvidence {
  return structuredDataVisible
    ? {
        lifecycle: projectNativeLifecycleEvidence(data),
        outcome: projectNativeOutcomeEvidence(data),
      }
    : { lifecycle: emptyLifecycle(), outcome: emptyOutcome() };
}

function emptyOutcome(): NativeOutcomeEvidence {
  return { reviewResolved: false, failureResolved: false };
}

export function projectNativeOutcomeEvidence(data: unknown): NativeOutcomeEvidence {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyOutcome();
    const record = data as Record<string, unknown>;
    const raw =
      typeof record.change === 'object' && record.change !== null
        ? record.change
        : (record.state ?? record);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyOutcome();
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
    const learning =
      change.learning && typeof change.learning === 'object'
        ? (change.learning as Record<string, unknown>)
        : {};
    const failureResolved =
      reviewResolved &&
      (learning.failureResolved === true ||
        history.some(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            ((entry as Record<string, unknown>).outcome === 'fail' ||
              (entry as Record<string, unknown>).verdict === 'fail'),
        ));
    const summary =
      typeof verification.summary === 'string'
        ? verification.summary.trim()
        : verification.summary &&
            typeof verification.summary === 'object' &&
            typeof (verification.summary as { text?: unknown }).text === 'string'
          ? (verification.summary as { text: string }).text.trim()
          : typeof learning.summary === 'string'
            ? learning.summary.trim()
            : typeof change.summary === 'string'
              ? change.summary.trim()
              : undefined;
    return { reviewResolved, failureResolved, ...(summary ? { summary } : {}) };
  } catch {
    return emptyOutcome();
  }
}

function emptyLifecycle(): NativeLifecycleEvidence {
  return { changedPaths: [], artifactRefs: [] };
}

export function projectNativeLifecycleEvidence(data: unknown): NativeLifecycleEvidence {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyLifecycle();
    const record = data as Record<string, unknown>;
    const list = (candidate: unknown): string[] =>
      Array.isArray(candidate)
        ? candidate.filter((entry): entry is string => typeof entry === 'string').slice(0, 24)
        : [];
    const state =
      typeof record.change === 'object' && record.change !== null
        ? record.change
        : (record.state ?? record);
    return {
      changedPaths: list(record.changedPaths),
      artifactRefs: list(
        record.artifactRefs ??
          record.artifacts ??
          (state as Record<string, { artifactRefs?: unknown }>).learning?.artifactRefs,
      ),
    };
  } catch {
    return emptyLifecycle();
  }
}

export function parseNativeOutcomeEvidence(stdout: string | undefined): NativeOutcomeEvidence {
  if (!stdout?.trim()) return emptyOutcome();
  try {
    return projectNativeOutcomeEvidence(nativeResultData(stdout));
  } catch {
    return emptyOutcome();
  }
}

export function parseNativeLifecycleEvidence(stdout: string | undefined): NativeLifecycleEvidence {
  if (!stdout?.trim()) return emptyLifecycle();
  try {
    return projectNativeLifecycleEvidence(nativeResultData(stdout));
  } catch {
    return emptyLifecycle();
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
