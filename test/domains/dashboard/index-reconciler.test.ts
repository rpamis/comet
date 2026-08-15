import { describe, expect, it } from 'vitest';

import { DashboardIndexReconciler } from '../../../domains/dashboard/index-reconciler.js';

describe('DashboardIndexReconciler', () => {
  it('shares one in-flight refresh for concurrent readers', async () => {
    const reconciler = new DashboardIndexReconciler();
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = () =>
      reconciler.refresh('repo', async () => {
        calls += 1;
        await gate;
        return { generation: calls };
      });

    const first = refresh();
    const second = refresh();
    await Promise.resolve();
    expect(calls).toBe(1);
    release?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { generation: 1 },
      { generation: 1 },
    ]);
  });

  it('allows a dirty marker to schedule a new refresh immediately', async () => {
    const reconciler = new DashboardIndexReconciler(60_000);
    let calls = 0;
    await reconciler.refresh('repo', async () => {
      calls += 1;
      return calls;
    });
    reconciler.schedule('repo', async () => {
      calls += 1;
      return calls;
    });
    expect(calls).toBe(1);
    reconciler.markDirty('repo');
    await new Promise<void>((resolve) => {
      reconciler.schedule('repo', async () => {
        calls += 1;
        resolve();
        return calls;
      });
    });
    expect(calls).toBe(2);
  });
});
