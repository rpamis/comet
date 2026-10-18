import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';
import { describe, expect, it, vi } from 'vitest';

type AstNode = {
  type?: string;
  name?: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
};

async function dashboardCallback(name: string, context: Record<string, unknown>) {
  const source = await readFile('domains/dashboard/web/src/main.jsx', 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  function find(value: unknown): AstNode | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const node = value as AstNode;
    if (node.type === 'VariableDeclarator' && (node.id as AstNode)?.name === name) return node;
    for (const child of Object.values(node)) {
      const found = Array.isArray(child) ? child.map(find).find(Boolean) : find(child);
      if (found) return found;
    }
    return undefined;
  }
  const declaration = find(ast);
  const callback = (declaration?.init as { arguments?: AstNode[] })?.arguments?.[0];
  expect(callback?.type).toBe('ArrowFunctionExpression');
  return new Function(
    ...Object.keys(context),
    `return (${source.slice(callback!.start!, callback!.end!)});`,
  )(...Object.values(context));
}

function refreshContext(tab = 'active') {
  const items = Array.from({ length: 70 }, (_, index) => ({
    id: `change-${index}`,
    status: tab,
    tasks: { total: 1, completed: 0 },
  }));
  const context = {
    useDemo: false,
    activeProjectId: 'project',
    snapshotRequestRef: { current: null as AbortController | null },
    pageRequestRef: { current: new AbortController() },
    detailRequestRef: { current: new AbortController() as AbortController | null },
    queryRef: { current: '' },
    tabRef: { current: tab },
    workflowRef: { current: 'classic' },
    selectedIdRef: { current: 'change-59' },
    lastLoadedQueryRef: { current: '' },
    pagesRef: {
      current: {
        active: null,
        archived: null,
        all: null,
        [tab]: { items, total: 70, nextCursor: null },
      },
    },
    nativePagesRef: { current: {} },
    setLoading: vi.fn(),
    setSnapshot: vi.fn(),
    setPages: vi.fn(),
    setNativePages: vi.fn(),
    setPageLoading: vi.fn(),
    setSelectedId: vi.fn(),
    setSelectedDetail: vi.fn(),
    setDetailError: vi.fn(),
    setDetailLoading: vi.fn(),
    toast: vi.fn(),
    t: (text: string) => text,
    materializeOverview: (next: unknown) => next,
    pickSelectedFromPage: (page: { items: { id: string }[] }, id: string) =>
      page.items.some((item) => item.id === id) ? id : page.items[0]?.id,
    fetchDashboardOverview: vi.fn(async () => ({
      initialChanges: { items: items.slice(0, 5), total: 70, nextCursor: '5' },
    })),
    fetchDashboardChangePage: vi.fn(async () => ({
      items: items.map((item) => ({ ...item, tasks: { total: 1, completed: 1 } })),
      total: 70,
      nextCursor: null,
    })),
    fetchDashboardChangeDetail: vi.fn(
      async (_project: string, id: string, _signal: AbortSignal) => ({ id, revision: 'fresh' }),
    ),
  };
  return context;
}

describe('Classic refresh callbacks', () => {
  it.each(['active', 'archived', 'all'])(
    'refreshes the expanded %s page and selected detail without changing selection',
    async (tab) => {
      const context = refreshContext(tab);
      const oldPageRequest = context.pageRequestRef.current;
      const oldDetailRequest = context.detailRequestRef.current!;
      const refresh = await dashboardCallback('refresh', context);
      await refresh(true);
      expect(context.fetchDashboardChangePage).toHaveBeenCalledWith(
        'project',
        tab,
        expect.objectContaining({ summaryLimit: 70, query: '' }),
      );
      expect(context.pagesRef.current[tab].items).toHaveLength(70);
      expect(context.pagesRef.current[tab].items[59].tasks.completed).toBe(1);
      expect(context.selectedIdRef.current).toBe('change-59');
      expect(context.setSelectedDetail).toHaveBeenLastCalledWith({
        id: 'change-59',
        revision: 'fresh',
      });
      expect(oldPageRequest.signal.aborted).toBe(true);
      expect(oldDetailRequest.signal.aborted).toBe(true);
      expect(context.toast).toHaveBeenCalledWith('状态已刷新');
    },
  );

  it('ignores old detail responses when a newer refresh finishes first', async () => {
    const context = refreshContext();
    let release!: (value: { id: string; revision: string }) => void;
    context.fetchDashboardChangeDetail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const refresh = await dashboardCallback('refresh', context);
    const first = refresh(false);
    await vi.waitFor(() => expect(context.fetchDashboardChangeDetail).toHaveBeenCalledTimes(1));
    const oldSignal = context.fetchDashboardChangeDetail.mock.calls[0][2];
    await refresh(true);
    expect(oldSignal.aborted).toBe(true);
    release({ id: 'change-59', revision: 'stale' });
    await first;
    expect(context.setSelectedDetail).toHaveBeenCalledTimes(1);
    expect(context.setSelectedDetail).toHaveBeenLastCalledWith({
      id: 'change-59',
      revision: 'fresh',
    });
  });

  it('does not overwrite a changed search or tab after an overview completes', async () => {
    const context = refreshContext();
    let release!: (value: {
      initialChanges: { items: never[]; total: number; nextCursor: string };
    }) => void;
    context.fetchDashboardOverview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const refresh = await dashboardCallback('refresh', context);
    const pending = refresh(false);
    context.queryRef.current = 'new search';
    context.tabRef.current = 'archived';
    release({ initialChanges: { items: [], total: 0, nextCursor: '' } });
    await pending;
    expect(context.setSnapshot).not.toHaveBeenCalled();
    expect(context.setSelectedDetail).not.toHaveBeenCalled();
  });
});
