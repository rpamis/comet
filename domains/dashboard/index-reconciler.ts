export type DashboardIndexRefresh<T> = () => Promise<T> | T;

/**
 * Coordinates refreshes for one or more Dashboard index keys.
 *
 * The reconciler deliberately owns no filesystem or SQLite behavior. It only
 * provides the single-flight, cooldown, and dirty-marker semantics shared by
 * collectors and future command/file notifications.
 */
export class DashboardIndexReconciler {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly lastAttempts = new Map<string, number>();

  constructor(private readonly refreshIntervalMs = 30_000) {}

  refresh<T>(key: string, task: DashboardIndexRefresh<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    this.lastAttempts.set(key, Date.now());
    const promise = Promise.resolve()
      .then(task)
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  schedule<T>(key: string, task: DashboardIndexRefresh<T>): void {
    const previous = this.lastAttempts.get(key) ?? 0;
    if (Date.now() - previous < this.refreshIntervalMs) return;
    void this.refresh(key, task).catch(() => undefined);
  }

  markDirty(key: string): void {
    this.lastAttempts.delete(key);
  }
}
