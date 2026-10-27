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

describe('personal memory Dashboard callbacks', () => {
  it('loads and manually refreshes the demo without invocation-only variables', async () => {
    const snapshot = { changes: [{ id: 'demo-change' }] };
    const setSnapshot = vi.fn();
    const setSelectedDetail = vi.fn();
    const setLoading = vi.fn();
    const toast = vi.fn();
    const refresh = await dashboardCallback('refresh', {
      useDemo: true,
      snapshotRequestRef: { current: null },
      selectedIdRef: { current: null },
      lastLoadedQueryRef: { current: '' },
      query: '',
      queryRef: { current: '' },
      tabRef: { current: 'active' },
      loadDemoSnapshot: async () => snapshot,
      pickSelected: () => 'demo-change',
      findChange: () => snapshot.changes[0],
      setSnapshot,
      setSelectedId: vi.fn(),
      setSelectedDetail,
      setLoading,
      toast,
      t: (text: string) => text,
    });
    await refresh(false);
    expect(setSnapshot).toHaveBeenCalledWith(snapshot);
    expect(setSelectedDetail).toHaveBeenCalledWith(snapshot.changes[0]);
    expect(toast).not.toHaveBeenCalled();
    await refresh(true);
    expect(setSnapshot).toHaveBeenCalledTimes(2);
    expect(setLoading.mock.calls).toEqual([[true], [false]]);
    expect(toast.mock.calls).toEqual([['状态已刷新']]);
  });

  it('executes demo management search only inside the invocation callback', async () => {
    const toast = vi.fn();
    const invoke = await dashboardCallback('invokeActivePlugin', {
      useDemo: true,
      pluginPage: {
        data: {
          retrieval: {
            records: [
              { id: 'old', text: 'Old preference', memoryType: 'core-profile', status: 'proven' },
              {
                id: 'recent',
                text: 'Recent preference',
                memoryType: 'core-profile',
                status: 'proven',
              },
              {
                id: 'history',
                text: 'Old retired preference',
                memoryType: 'core-profile',
                status: 'superseded',
              },
            ],
          },
        },
      },
      isActiveMemoryRecord: (record: { status: string }) => record.status === 'proven',
      toast,
      t: (text: string) => text,
    });
    await expect(
      invoke('comet.personal-memory', 'manage', { query: 'old', managementFilter: 'profile' }),
    ).resolves.toMatchObject({ total: 1, records: [{ id: 'old' }] });
    await expect(
      invoke('comet.personal-memory', 'manage', { query: 'old', managementFilter: 'history' }),
    ).resolves.toMatchObject({ total: 1, records: [{ id: 'history' }] });
    expect(toast).not.toHaveBeenCalled();
  });
});
