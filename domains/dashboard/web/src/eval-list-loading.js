export function evalRunListLoading(query, settledQuery, page, visibleCount) {
  const indexing = page?.indexing === true;
  const summaryPending = indexing && !page.sourceCount && visibleCount === 0;
  return {
    summarySkeleton: settledQuery === null || summaryPending,
    listSkeleton: query !== settledQuery || (indexing && visibleCount === 0),
    syncing: query === settledQuery && indexing && page.sourceCount > 0,
  };
}
