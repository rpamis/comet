export const workflowRegressionCases = [
  {
    id: 'native-interrupted-recovery',
    workflow: 'native',
    task: 'comet-native-sdk-recovery',
    treatment: 'COMET_NATIVE_SDK_CURRENT',
    expected:
      'Restore the original candidate and checks in a fresh session after a blocked verifier; finish with a new independent verifier.',
    forbidden:
      'Recreate the change, repeat a one-shot check, or substitute a fabricated verification result.',
  },
  {
    id: 'native-independent-verify',
    workflow: 'native',
    task: 'comet-native-workflow',
    treatment: 'COMET_NATIVE_SDK_CURRENT',
    expected:
      'Record an unresolved acceptance item, fix the candidate and independently verify all acceptance items before Archive.',
    forbidden:
      'Treat the Builder report or a failed acceptance result as independent verification.',
  },
  {
    id: 'classic-scope-reconfirmation',
    workflow: 'classic',
    task: 'comet-classic-full-recovery',
    treatment: 'COMET_CLASSIC_DOCS_LAYOUT',
    expected:
      'Resume the same Run, present its changed output-only delivery scope and obtain a separate approval before delivery.',
    forbidden:
      'Reuse the original approval for the changed scope, replay Archive or touch the parked change.',
  },
] as const;

export function workflowRegressionCaseOf(task: string, treatment: string) {
  return workflowRegressionCases.find(
    (entry) => entry.task === task && entry.treatment === treatment,
  );
}

const units = {
  contextBytes: 'bytes',
  inputTokens: 'tokens',
  toolRoundTrips: 'calls',
  waitMs: 'ms',
} as const;
type MetricName = keyof typeof units;
type Measurement = {
  value: number;
  unit: (typeof units)[MetricName];
  kind: 'estimated' | 'observed';
  source: string;
  phase?: 'open' | 'design' | 'build' | 'verify' | 'archive';
};
export type WorkflowMetrics = Record<MetricName, Measurement | null>;
export type WorkflowMetricComparison = Record<
  MetricName,
  {
    baseline: Measurement | null;
    candidate: Measurement | null;
    delta: number | null;
    reason: 'unavailable' | 'different-measurement' | 'unmatched-case' | null;
  }
>;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const phases = ['open', 'design', 'build', 'verify', 'archive'] as const;

export function classicContextMetricsOf(
  value: unknown,
  redact: (value: string) => string,
): WorkflowMetrics | null {
  const context = record(value);
  const scope = record(context.scope);
  const phase = phases.find((phase) => phase === scope.phase);
  if (
    context.schema !== 'comet.classic.context-cost.v1' ||
    !phase ||
    typeof scope.change !== 'string' ||
    !scope.change ||
    typeof scope.projectRoot !== 'string' ||
    !scope.projectRoot
  )
    return null;
  const contextMetrics = record(context.metrics);
  const fromClassic = (name: MetricName): Measurement | null => {
    const metric = record(contextMetrics[name]);
    if (
      !nonnegative(metric.value) ||
      metric.unit !== units[name] ||
      (metric.kind !== 'estimated' && metric.kind !== 'observed') ||
      typeof metric.source !== 'string' ||
      !metric.source.trim()
    )
      return null;
    return {
      value: metric.value,
      unit: units[name],
      kind: metric.kind,
      source: redact(metric.source).slice(0, 256),
      phase,
    };
  };
  return {
    contextBytes: fromClassic('contextBytes'),
    inputTokens: fromClassic('inputTokens'),
    toolRoundTrips: fromClassic('toolRoundTrips'),
    waitMs: fromClassic('waitMs'),
  };
}

export function mergeWorkflowMetrics(
  primary: WorkflowMetrics | null,
  fallback?: WorkflowMetrics,
): WorkflowMetrics {
  return {
    contextBytes: primary?.contextBytes ?? fallback?.contextBytes ?? null,
    inputTokens: primary?.inputTokens ?? fallback?.inputTokens ?? null,
    toolRoundTrips: primary?.toolRoundTrips ?? fallback?.toolRoundTrips ?? null,
    waitMs: primary?.waitMs ?? fallback?.waitMs ?? null,
  };
}

export function workflowMetricsOf(
  events: Record<string, unknown>,
  redact: (value: string) => string,
): WorkflowMetrics {
  const classic =
    typeof events.treatment === 'string' && events.treatment.startsWith('COMET_CLASSIC_')
      ? classicContextMetricsOf(events.classic_context_cost, redact)
      : null;
  const observed = (name: MetricName, value: unknown, source: string): Measurement | null =>
    nonnegative(value) ? { value, unit: units[name], kind: 'observed', source } : null;
  const calls =
    Array.isArray(events.tool_calls) && events.telemetry_status !== 'N/A'
      ? events.tool_calls.map(record)
      : null;
  const completed =
    calls?.every(
      (call) =>
        typeof call.tool_call_id === 'string' &&
        call.tool_call_id.length > 0 &&
        (call.status === 'completed' || call.status === 'failed'),
    ) &&
    (calls.length > 0 || events.telemetry_status === 'available')
      ? calls
      : null;
  // Concurrent calls can overlap. The metric sums actual call durations, not wall-clock wait.
  const clock = completed?.[0]?.time_source;
  const toolWait =
    completed &&
    typeof clock === 'string' &&
    completed.every(
      (call) =>
        call.time_source === clock &&
        call.timing_scope === 'tool-round-trip' &&
        nonnegative(call.duration_ms),
    )
      ? observed(
          'waitMs',
          completed.reduce((total, call) => total + Number(call.duration_ms), 0),
          `events_summary.tool_calls.duration_ms (${redact(clock)})`,
        )
      : null;
  return mergeWorkflowMetrics(classic, {
    contextBytes: null,
    inputTokens: observed(
      'inputTokens',
      events.input_tokens,
      'events_summary.input_tokens (non-cache)',
    ),
    toolRoundTrips: observed(
      'toolRoundTrips',
      completed?.length,
      'events_summary.tool_calls (completed pairs)',
    ),
    waitMs: toolWait,
  });
}

export function compareWorkflowMetrics(
  baseline: WorkflowMetrics | undefined,
  candidate: WorkflowMetrics | undefined,
  compatibleCase: boolean,
  sameModel: boolean,
): WorkflowMetricComparison {
  const metric = (name: MetricName): WorkflowMetricComparison[MetricName] => {
    const before = baseline?.[name] ?? null;
    const after = candidate?.[name] ?? null;
    const reason = !compatibleCase
      ? 'unmatched-case'
      : !before || !after
        ? 'unavailable'
        : before.kind !== after.kind ||
            before.source !== after.source ||
            before.unit !== after.unit ||
            before.phase !== after.phase ||
            (name === 'inputTokens' && !sameModel)
          ? 'different-measurement'
          : null;
    return {
      baseline: before,
      candidate: after,
      delta: reason === null && before && after ? after.value - before.value : null,
      reason,
    };
  };
  return {
    contextBytes: metric('contextBytes'),
    inputTokens: metric('inputTokens'),
    toolRoundTrips: metric('toolRoundTrips'),
    waitMs: metric('waitMs'),
  };
}
