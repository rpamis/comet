import { describe, expect, it } from 'vitest';

import {
  dashboardResponseError,
  isStaleNativeDashboardCursorError,
  refreshDashboardPage,
  shouldAutoLoadDashboardDetail,
  shouldShowDashboardDetailLoading,
} from '../../../domains/dashboard/web/src/dashboard-web-state.js';

function page(items: Array<{ id: string; value: string }>, total = items.length) {
  return { status: 'active', items, total, nextCursor: total > items.length ? 'next' : null };
}

describe('Dashboard web state helpers', () => {
  it('preserves a structured server error for stale Native cursor recovery', async () => {
    const error = await dashboardResponseError(
      new Response(JSON.stringify({ error: 'Stale Native Dashboard change cursor' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(isStaleNativeDashboardCursorError(error)).toBe(true);
  });

  it('preserves loaded rows when an unchanged overview refreshes', () => {
    const existing = page(
      [
        { id: 'one', value: 'old-one' },
        { id: 'two', value: 'old-two' },
        { id: 'three', value: 'old-three' },
      ],
      3,
    );
    const fresh = page(
      [
        { id: 'one', value: 'new-one' },
        { id: 'two', value: 'new-two' },
      ],
      3,
    );

    expect(refreshDashboardPage(existing, fresh)).toEqual({
      ...existing,
      items: [
        { id: 'one', value: 'new-one' },
        { id: 'two', value: 'new-two' },
        { id: 'three', value: 'old-three' },
      ],
    });
  });

  it('resets loaded rows when the refreshed first page changes order', () => {
    const existing = page(
      [
        { id: 'one', value: 'old-one' },
        { id: 'two', value: 'old-two' },
      ],
      2,
    );
    const fresh = page([{ id: 'new', value: 'new-row' }], 2);

    expect(refreshDashboardPage(existing, fresh)).toEqual(fresh);
  });

  it('recognizes a stale Native cursor error as recoverable pagination state', () => {
    expect(
      isStaleNativeDashboardCursorError(new Error('Stale Native Dashboard change cursor')),
    ).toBe(true);
    expect(isStaleNativeDashboardCursorError(new Error('network unavailable'))).toBe(false);
  });

  it('does not auto-retry a detail request that already failed for the selected change', () => {
    expect(
      shouldAutoLoadDashboardDetail({
        detailLoading: false,
        selectedId: 'change-a',
        selectedDetailId: null,
        visibleIds: ['change-a'],
        failedDetailId: 'change-a',
      }),
    ).toBe(false);
    expect(
      shouldAutoLoadDashboardDetail({
        detailLoading: false,
        selectedId: 'change-b',
        selectedDetailId: null,
        visibleIds: ['change-b'],
        failedDetailId: 'change-a',
      }),
    ).toBe(true);
  });

  it('keeps the detail surface occupied while the selected change detail is pending', () => {
    expect(
      shouldShowDashboardDetailLoading({
        detailLoading: false,
        selectedId: 'change-a',
        selectedDetailId: null,
        failedDetailId: null,
      }),
    ).toBe(true);
    expect(
      shouldShowDashboardDetailLoading({
        detailLoading: false,
        selectedId: 'change-a',
        selectedDetailId: null,
        failedDetailId: 'change-a',
      }),
    ).toBe(false);
  });
});
