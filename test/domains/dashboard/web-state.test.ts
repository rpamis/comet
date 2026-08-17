import { describe, expect, it } from 'vitest';

import {
  dashboardChangeKey,
  dashboardResponseError,
  isStaleNativeDashboardCursorError,
  nativeDashboardChangeKey,
  refreshDashboardPage,
  refreshNativeDashboardPage,
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

  it('keeps the plugin identity in dashboard API errors', async () => {
    const error = await dashboardResponseError(
      new Response(JSON.stringify({ error: '能力执行失败', pluginId: 'comet.personal-memory' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(error.message).toBe('插件 comet.personal-memory：能力执行失败');
    expect((error as Error & { pluginId?: string }).pluginId).toBe('comet.personal-memory');
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

  it('uses worktree locators to distinguish same-name Classic and Native rows', () => {
    const classicA = { id: 'openspec/changes/same', locator: 'classic-a' };
    const classicB = { id: 'openspec/changes/same', locator: 'classic-b' };
    const nativeA = { status: 'active', name: 'same', locator: 'native-a' };
    const nativeB = { status: 'active', name: 'same', locator: 'native-b' };

    expect(dashboardChangeKey(classicA)).not.toBe(dashboardChangeKey(classicB));
    expect(nativeDashboardChangeKey(nativeA)).not.toBe(nativeDashboardChangeKey(nativeB));
  });

  it('recognizes a stale Native cursor error as recoverable pagination state', () => {
    expect(
      isStaleNativeDashboardCursorError(new Error('Stale Native Dashboard change cursor')),
    ).toBe(true);
    expect(isStaleNativeDashboardCursorError(new Error('network unavailable'))).toBe(false);
  });

  it('refreshes Native v2 head rows while preserving already appended rows', () => {
    const existing = {
      status: 'active',
      total: 3,
      nextCursor: null,
      items: [
        { status: 'active', name: 'one', loop: { iteration: 1 } },
        { status: 'active', name: 'two', loop: { iteration: 1 } },
        { status: 'active', name: 'three', loop: { iteration: 1 } },
      ],
    };
    const fresh = {
      status: 'active',
      total: 3,
      nextCursor: 'next',
      items: [
        { status: 'active', name: 'one', loop: { iteration: 2 } },
        { status: 'active', name: 'two', loop: { iteration: 2 } },
      ],
    };

    expect(refreshNativeDashboardPage(existing, fresh)).toEqual({
      ...existing,
      items: [
        { status: 'active', name: 'one', loop: { iteration: 2 } },
        { status: 'active', name: 'two', loop: { iteration: 2 } },
        { status: 'active', name: 'three', loop: { iteration: 1 } },
      ],
    });
  });

  it('resets Native rows when order changes and distinguishes same-name archives', () => {
    const existing = {
      status: 'all',
      total: 2,
      nextCursor: null,
      items: [
        { status: 'active', name: 'same' },
        { status: 'archived', archiveName: '2026-08-09-same', name: 'same' },
      ],
    };
    const fresh = { ...existing, items: existing.items.slice().reverse() };

    expect(refreshNativeDashboardPage(existing, fresh)).toEqual(fresh);
    expect(nativeDashboardChangeKey(existing.items[0])).not.toBe(
      nativeDashboardChangeKey(existing.items[1]),
    );
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
