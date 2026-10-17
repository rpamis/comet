const durations = { '1h': 3600000, '24h': 86400000, '3d': 3 * 86400000, '7d': 7 * 86400000 };

export function resolveObservabilityRange(selection, now = Date.now()) {
  if (selection.preset === 'custom') return { from: selection.from, to: selection.to };
  return {
    from: new Date(now - (durations[selection.preset] ?? durations['7d'])).toISOString(),
    to: new Date(now).toISOString(),
  };
}

export function inObservabilityRange(value, range) {
  const time = Date.parse(value);
  return (
    !range ||
    (Number.isFinite(time) && time >= Date.parse(range.from) && time <= Date.parse(range.to))
  );
}

export function observabilityRangeQuery(range) {
  return range ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '';
}

export function filterContextUsage(snapshot, range) {
  if (!snapshot?.available || !range) return snapshot;
  // Recent task previews are incomplete and must never stand in for aggregate samples.
  if (!snapshot.samples) return { ...snapshot, available: false };
  const rows = snapshot.samples
    .filter((row) => inObservabilityRange(row.occurredAt, range))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const queries = rows.filter((row) => row.counted);
  const items = new Map();
  for (const row of rows)
    for (const item of row.items) {
      const key = item.applicationId ?? `${row.requestKey ?? row.episodeId}:${item.candidateId}`;
      const previous = items.get(key);
      items.set(key, { ...item, delivery: previous?.delivery === 'full' ? 'full' : item.delivery });
    }
  const outcomes = [...items.values()];
  const count = (outcome) => outcomes.filter((item) => item.outcome === outcome).length;
  const successes = count('used-successfully'),
    corrections = count('corrected'),
    failures = count('contributed-to-failure');
  const timings = queries.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const hits = queries.filter((row) => row.candidateCount > 0).length;
  const feedbackCount = outcomes.filter((item) => item.outcome !== undefined).length;
  return {
    ...snapshot,
    requests: queries.length,
    hits,
    hitRate: queries.length ? hits / queries.length : null,
    limitedRequests: queries.filter((row) => row.limited).length,
    fullDeliveries: outcomes.filter((item) => item.delivery === 'full').length,
    recommendations: outcomes.length,
    feedbackCount,
    feedbackRate: outcomes.length ? feedbackCount / outcomes.length : null,
    successes,
    corrections,
    failures,
    ignored: count('ignored'),
    overridden: count('overridden'),
    successRate:
      successes + corrections + failures ? successes / (successes + corrections + failures) : null,
    p95Ms: timings.length ? timings[Math.ceil(timings.length * 0.95) - 1] : null,
    lastQueryMs: queries.at(-1)?.elapsedMs ?? null,
    recentTasks: rows.slice(-10).reverse(),
  };
}
