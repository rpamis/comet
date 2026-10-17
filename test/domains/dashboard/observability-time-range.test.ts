import { describe, expect, it } from 'vitest';
import {
  filterContextUsage,
  resolveObservabilityRange,
} from '../../../domains/dashboard/web/src/observability-time-range.js';
import {
  readObservabilityRange,
  withinObservationRange,
} from '../../../domains/dashboard/observability-range.js';

describe('observability time filtering', () => {
  it('rejects partial, invalid and reversed ranges and excludes unknown timestamps', () => {
    for (const query of ['from=bad&to=bad', 'from=2026-10-17', 'from=2026-10-17&to=2026-10-16'])
      expect(() => readObservabilityRange(new URLSearchParams(query))).toThrow();
    const range = readObservabilityRange(new URLSearchParams('from=2026-10-16&to=2026-10-17'));
    expect(withinObservationRange(null, range)).toBe(false);
    expect(withinObservationRange('2026-10-16T12:00:00Z', range)).toBe(true);
    expect(withinObservationRange('2026-10-15T12:00:00Z', range)).toBe(false);
  });
  it('resolves rolling ranges and keeps custom boundaries exact', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(resolveObservabilityRange({ preset: '1h' }, now)).toEqual({
      from: '2026-10-17T11:00:00.000Z',
      to: '2026-10-17T12:00:00.000Z',
    });
    expect(
      resolveObservabilityRange(
        { preset: 'custom', from: '2026-10-15T12:00:00Z', to: '2026-10-16T12:00:00Z' },
        now,
      ),
    ).toEqual({
      from: '2026-10-15T12:00:00Z',
      to: '2026-10-16T12:00:00Z',
    });
  });
  it('recomputes totals, deduplicated deliveries and outcomes from all bounded samples', () => {
    const snapshot = {
      available: true,
      requests: 30,
      recentTasks: [],
      samples: [
        {
          episodeId: 'outside',
          occurredAt: '2026-10-16T10:00:00Z',
          counted: true,
          elapsedMs: 999,
          candidateCount: 1,
          items: [],
        },
        {
          episodeId: 'zero',
          occurredAt: '2026-10-17T11:00:00Z',
          counted: true,
          elapsedMs: 10,
          candidateCount: 0,
          items: [],
        },
        {
          episodeId: 'hit',
          occurredAt: '2026-10-17T11:30:00Z',
          counted: true,
          elapsedMs: 30,
          candidateCount: 1,
          items: [
            {
              applicationId: 'a',
              candidateId: 'a',
              delivery: 'manifest',
              outcome: 'used-successfully',
            },
          ],
        },
        {
          episodeId: 'expand',
          occurredAt: '2026-10-17T12:00:00Z',
          counted: false,
          elapsedMs: 900,
          items: [
            {
              applicationId: 'a',
              candidateId: 'a',
              delivery: 'full',
              outcome: 'used-successfully',
            },
          ],
        },
      ],
    };
    const result = filterContextUsage(snapshot, {
      from: '2026-10-17T11:00:00Z',
      to: '2026-10-17T12:00:00Z',
    });
    expect(result).toMatchObject({
      requests: 2,
      hits: 1,
      hitRate: 0.5,
      fullDeliveries: 1,
      recommendations: 1,
      feedbackCount: 1,
      successes: 1,
      p95Ms: 30,
      lastQueryMs: 30,
    });
    expect(result.recentTasks).toHaveLength(3);
    expect(snapshot.requests).toBe(30);
    expect(
      filterContextUsage(snapshot, { from: '2026-10-18T11:00:00Z', to: '2026-10-18T12:00:00Z' }),
    ).toMatchObject({ requests: 0, successRate: null, p95Ms: null });
  });
});
