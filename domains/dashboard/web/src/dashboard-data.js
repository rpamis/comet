const DASHBOARD_WORKFLOWS = new Set(['native', 'classic']);

export function resolveDashboardProjectWorkflow(project) {
  if (
    project?.workflowSource === 'configured' &&
    DASHBOARD_WORKFLOWS.has(project.defaultWorkflow)
  ) {
    return { workflow: project.defaultWorkflow, source: 'configured' };
  }
  return { workflow: 'classic', source: 'fallback' };
}

function abortError() {
  return Object.assign(new Error('Dashboard request was superseded'), { name: 'AbortError' });
}

export function createDashboardRequestCoordinator() {
  const cache = new Map();
  const pending = new Map();
  const generations = new Map();

  const read = (key, readPersisted) => {
    if (cache.has(key)) return cache.get(key);
    const persisted = readPersisted?.();
    if (persisted !== undefined && persisted !== null) {
      cache.set(key, persisted);
      return persisted;
    }
    return undefined;
  };

  const load = (key, request, { force = false, owner, readPersisted, writePersisted } = {}) => {
    const cached = read(key, readPersisted);
    if (!force && cached !== undefined) return Promise.resolve(cached);

    const existing = pending.get(key);
    if (existing) {
      if (owner) existing.owners.add(owner);
      else existing.background = true;
      return existing.promise;
    }

    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const controller = new AbortController();
    const promise = Promise.resolve(request(controller.signal))
      .then((value) => {
        if (controller.signal.aborted || generations.get(key) !== generation) {
          throw abortError();
        }
        cache.set(key, value);
        writePersisted?.(value);
        return value;
      })
      .finally(() => {
        if (pending.get(key)?.generation === generation) pending.delete(key);
      });
    pending.set(key, {
      controller,
      generation,
      promise,
      owners: owner ? new Set([owner]) : new Set(),
      background: !owner,
    });
    return promise;
  };

  const release = (key, owner) => {
    const current = pending.get(key);
    if (!current) return;
    if (owner) current.owners.delete(owner);
    if (current.background || current.owners.size > 0) return;
    generations.set(key, (generations.get(key) ?? 0) + 1);
    current.controller.abort();
    if (pending.get(key) === current) pending.delete(key);
  };

  const cancel = (key) => {
    generations.set(key, (generations.get(key) ?? 0) + 1);
    const current = pending.get(key);
    current?.controller.abort();
    if (current && pending.get(key) === current) pending.delete(key);
  };

  const invalidate = (key) => {
    cancel(key);
    cache.delete(key);
  };

  const set = (key, value) => {
    cancel(key);
    cache.set(key, value);
  };

  return { read, load, release, cancel, invalidate, set };
}
