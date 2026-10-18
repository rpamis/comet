import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';
import { mergeApplicationRunPages } from '../../../domains/dashboard/web/src/application-data.js';

const source = await readFile('domains/dashboard/web/src/any-workflow-panel.jsx', 'utf8');
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
function find(value: any, predicate: (node: any) => boolean): any {
  if (!value || typeof value !== 'object') return;
  if (predicate(value)) return value;
  for (const child of Object.values(value)) {
    const found = Array.isArray(child)
      ? child.map((node) => find(node, predicate)).find(Boolean)
      : find(child, predicate);
    if (found) return found;
  }
}
function evaluate(node: any, context: Record<string, unknown>) {
  return new Function(...Object.keys(context), `return (${source.slice(node.start, node.end)});`)(
    ...Object.values(context),
  );
}
function callback(name: string, context: Record<string, unknown>) {
  return evaluate(
    find(ast, (node) => node.type === 'VariableDeclarator' && node.id.name === name).init,
    context,
  );
}
function invalidate(kind: string, context: Record<string, unknown>) {
  const marker =
    kind === 'list'
      ? 'currentListContext.current = listContext'
      : 'currentRosterGeneration.current = rosterGeneration';
  const effect = find(
    ast,
    (node) =>
      node.type === 'CallExpression' &&
      node.callee.name === 'useLayoutEffect' &&
      source.slice(node.start, node.end).includes(marker),
  );
  return evaluate(effect.arguments[0], context)();
}
function fixture(kind: string) {
  const generation = {};
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const pending = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const page = { fingerprint: 'old', items: [{ locator: 'first' }], nextCursor: 'second' };
  const state = { page, rosters: { app: page } };
  const context = {
    page,
    roster: page,
    moreLoading: false,
    rosterLoading: false,
    pageContext: { current: generation },
    listContext: generation,
    currentListContext: { current: generation },
    moreRequest: { current: null as AbortController | null },
    rosterContext: { current: generation },
    rosterGeneration: generation,
    currentRosterGeneration: { current: generation },
    rosterMoreRequest: { current: null as AbortController | null },
    pageRequest: { current: new AbortController() },
    rosterRequest: { current: new AbortController() },
    search: 'old',
    scope: 'all',
    applicationId: 'app',
    detail: { runId: 'old-run' },
    request: vi.fn((_endpoint: string, _params: unknown, _signal: AbortSignal) => pending),
    setPage: vi.fn((update) => {
      state.page = update(state.page);
    }),
    setRosters: vi.fn((update) => {
      state.rosters = update(state.rosters);
    }),
    setMoreLoading: vi.fn(),
    setRosterLoading: vi.fn(),
    setNews: vi.fn(),
    setTick: vi.fn(),
    setPageError: vi.fn(),
    setDrawer: vi.fn(),
    t: (value: string) => value,
    mergeApplicationRunPages,
  };
  const load = callback(kind === 'list' ? 'loadMore' : 'loadRoster', context);
  const replace = () => {
    context.listContext = context.rosterGeneration = {};
    invalidate(kind, context);
    state.page = { fingerprint: 'new', items: [{ locator: 'new-only' }], nextCursor: 'new-second' };
    state.rosters = { app: state.page };
  };
  return { context, state, load, resolve, reject, replace };
}

describe.each(['list', 'roster'])('Any %s pagination callbacks', (kind) => {
  it('passes an abort signal and merges only the active snapshot', async () => {
    const f = fixture(kind);
    const pending = f.load();
    expect(f.context.request.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    f.resolve({ fingerprint: 'old', items: [{ locator: 'second' }], nextCursor: null });
    await pending;
    expect((kind === 'list' ? f.state.page : f.state.rosters.app).items).toEqual([
      { locator: 'first' },
      { locator: 'second' },
    ]);
    expect(
      (kind === 'list' ? f.context.setMoreLoading : f.context.setRosterLoading).mock.calls,
    ).toEqual([[true], [false]]);
  });
  it('aborts an old generation and ignores its response even when the transport resolves', async () => {
    const f = fixture(kind);
    const pending = f.load();
    const signal = f.context.request.mock.calls[0][2] as AbortSignal;
    f.replace();
    expect(signal.aborted).toBe(true);
    const loading = kind === 'list' ? f.context.setMoreLoading : f.context.setRosterLoading;
    loading.mockClear();
    f.resolve({ fingerprint: 'old', items: [{ locator: 'old-second' }], nextCursor: null });
    await pending;
    expect(f.state.page.items).toEqual([{ locator: 'new-only' }]);
    expect(f.state.rosters.app.items).toEqual([{ locator: 'new-only' }]);
    expect(f.context.setPage).not.toHaveBeenCalled();
    expect(f.context.setRosters).not.toHaveBeenCalled();
    expect(loading).not.toHaveBeenCalled();
  });
  it.each(['STALE_APPLICATION_CURSOR', 'FAILED'])(
    'ignores stale %s errors and finally callbacks',
    async (code) => {
      const f = fixture(kind);
      const pending = f.load();
      f.replace();
      const loading = kind === 'list' ? f.context.setMoreLoading : f.context.setRosterLoading;
      loading.mockClear();
      f.reject({ code, message: 'old failure' });
      await pending;
      for (const fn of [
        f.context.setNews,
        f.context.setTick,
        f.context.setPageError,
        f.context.setDrawer,
        loading,
      ])
        expect(fn).not.toHaveBeenCalled();
    },
  );
  it('leaves a newer pagination request and its loading indicator untouched', async () => {
    const f = fixture(kind);
    const oldPending = f.load();
    f.replace();
    f.context.pageContext.current = f.context.listContext;
    f.context.rosterContext.current = f.context.rosterGeneration;
    f.context.page = f.context.roster = f.state.page;
    let resolveNew!: (value: unknown) => void;
    f.context.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
    );
    const newPending = callback(kind === 'list' ? 'loadMore' : 'loadRoster', f.context)();
    const requestRef = kind === 'list' ? f.context.moreRequest : f.context.rosterMoreRequest;
    const newController = requestRef.current;
    const loading = kind === 'list' ? f.context.setMoreLoading : f.context.setRosterLoading;
    loading.mockClear();
    f.resolve({ fingerprint: 'old', items: [{ locator: 'old-second' }], nextCursor: null });
    await oldPending;
    expect(requestRef.current).toBe(newController);
    expect(loading).not.toHaveBeenCalled();
    resolveNew({ fingerprint: 'new', items: [{ locator: 'new-second' }], nextCursor: null });
    await newPending;
    expect((kind === 'list' ? f.state.page : f.state.rosters.app).items).toEqual([
      { locator: 'new-only' },
      { locator: 'new-second' },
    ]);
    expect(loading).toHaveBeenCalledWith(false);
  });
  it('does not reuse a retained cursor before the new first page succeeds', async () => {
    const f = fixture(kind);
    f.replace();
    const load = callback(kind === 'list' ? 'loadMore' : 'loadRoster', f.context);
    await load();
    expect(f.context.request).not.toHaveBeenCalled();
  });
  it('blocks duplicate clicks before React renders the loading state', async () => {
    const f = fixture(kind);
    const pending = f.load();
    await f.load();
    expect(f.context.request).toHaveBeenCalledTimes(1);
    f.resolve({ fingerprint: 'old', items: [], nextCursor: null });
    await pending;
  });
  it('rejects a state updater queued before a generation switch', async () => {
    const f = fixture(kind);
    const setter = kind === 'list' ? f.context.setPage : f.context.setRosters;
    setter.mockImplementation(() => undefined);
    const pending = f.load();
    f.resolve({ fingerprint: 'old', items: [{ locator: 'late' }], nextCursor: null });
    await pending;
    const updater = setter.mock.calls[0][0];
    f.replace();
    const current = kind === 'list' ? f.state.page : f.state.rosters;
    expect(updater(current)).toBe(current);
  });
});

it('invalidates pagination for raw and debounced search, project, scope and refresh changes', () => {
  const declaration = find(
    ast,
    (node) => node.type === 'VariableDeclarator' && node.id.name === 'listContext',
  );
  expect(declaration.init.arguments[1].elements.map((node: any) => node.name)).toEqual([
    'projectId',
    'demo',
    'query',
    'search',
    'scope',
    'filter',
    'refreshToken',
    'tick',
  ]);
});
