import { describe, expect, it } from 'vitest';
import { evalRunListLoading } from '../../../domains/dashboard/web/src/eval-list-loading.js';

describe('Eval list loading', () => {
  it('holds the list in a skeleton until the selected results are ready', () => {
    expect(evalRunListLoading('all', null, null, 0)).toEqual({
      summarySkeleton: true,
      listSkeleton: true,
      syncing: false,
    });
    expect(evalRunListLoading('finished', 'all', { indexing: false, sourceCount: 1 }, 1)).toEqual({
      summarySkeleton: false,
      listSkeleton: true,
      syncing: false,
    });
    expect(
      evalRunListLoading('finished', 'finished', { indexing: true, sourceCount: 0 }, 0),
    ).toEqual({
      summarySkeleton: true,
      listSkeleton: true,
      syncing: false,
    });
    expect(
      evalRunListLoading('finished', 'finished', { indexing: false, sourceCount: 0 }, 0),
    ).toEqual({
      summarySkeleton: false,
      listSkeleton: false,
      syncing: false,
    });
  });

  it('keeps available results while reporting real indexing progress', () => {
    expect(evalRunListLoading('all', 'all', { indexing: true, sourceCount: 100 }, 1)).toEqual({
      summarySkeleton: false,
      listSkeleton: false,
      syncing: true,
    });
  });
});
