import { describe, expect, it, vi } from 'vitest';

import {
  createDashboardRequestCoordinator,
  resolveDashboardProjectWorkflow,
} from '../../../domains/dashboard/web/src/dashboard-data.js';

describe('Dashboard data coordination', () => {
  it('uses configured workflow values and falls back to Classic for unavailable values', () => {
    expect(
      resolveDashboardProjectWorkflow({
        defaultWorkflow: 'native',
        workflowSource: 'configured',
      }),
    ).toEqual({ workflow: 'native', source: 'configured' });
    expect(
      resolveDashboardProjectWorkflow({
        defaultWorkflow: 'native',
        workflowSource: 'fallback',
      }),
    ).toEqual({ workflow: 'classic', source: 'fallback' });
    expect(resolveDashboardProjectWorkflow(null)).toEqual({
      workflow: 'classic',
      source: 'fallback',
    });
  });

  it('deduplicates equivalent requests for one cache key', async () => {
    const coordinator = createDashboardRequestCoordinator();
    const request = vi.fn(async () => ({ value: 'fresh' }));
    const first = coordinator.load('project:plugin', request);
    const second = coordinator.load('project:plugin', request);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ value: 'fresh' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects a cancelled request before a forced refresh replaces it', async () => {
    const coordinator = createDashboardRequestCoordinator();
    const resolvers: Array<(value: { value: string }) => void> = [];
    const writes: Array<{ value: string }> = [];
    const request = vi.fn(
      () =>
        new Promise<{ value: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const options = { writePersisted: (value: { value: string }) => writes.push(value) };
    const stale = coordinator.load('project:plugin', request, options);
    coordinator.cancel('project:plugin');
    const fresh = coordinator.load('project:plugin', request, { ...options, force: true });

    resolvers[0]({ value: 'stale' });
    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toEqual([]);
    resolvers[1]({ value: 'fresh' });
    await expect(fresh).resolves.toEqual({ value: 'fresh' });
    expect(writes).toEqual([{ value: 'fresh' }]);
    expect(coordinator.read('project:plugin')).toEqual({ value: 'fresh' });
  });

  it('keeps a shared request alive until every consumer releases it', async () => {
    const coordinator = createDashboardRequestCoordinator();
    let resolveRequest!: (value: string) => void;
    const request = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const page = coordinator.load('project:plugin', request, { owner: 'page' });
    const settings = coordinator.load('project:plugin', request, {
      force: true,
      owner: 'settings',
    });

    expect(settings).toBe(page);
    coordinator.release('project:plugin', 'page');
    resolveRequest('fresh');
    await expect(settings).resolves.toBe('fresh');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('cancels a request without allowing its eventual response to populate the cache', async () => {
    const coordinator = createDashboardRequestCoordinator();
    let resolveRequest!: (value: string) => void;
    const request = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const pending = coordinator.load('project:plugin', request);
    coordinator.cancel('project:plugin');
    resolveRequest('late');

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(coordinator.read('project:plugin')).toBeUndefined();
  });
});
