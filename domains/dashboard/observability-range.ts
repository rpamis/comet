export interface ObservabilityRange {
  readonly from: string;
  readonly to: string;
}

export function readObservabilityRange(params: URLSearchParams): ObservabilityRange | undefined {
  const from = params.get('from'),
    to = params.get('to');
  if (from === null && to === null) return undefined;
  if (
    !from ||
    !to ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) > Date.parse(to)
  )
    throw new Error('Invalid observation time range');
  return { from, to };
}

export function withinObservationRange(
  value: string | null | undefined,
  range?: ObservabilityRange,
) {
  if (!range) return true;
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time >= Date.parse(range.from) && time <= Date.parse(range.to);
}
