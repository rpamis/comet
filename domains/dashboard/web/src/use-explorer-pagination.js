import { useEffect, useRef } from 'react';

export function useExplorerPagination({
  listRef,
  sentinelRef,
  resetKey,
  itemCount,
  layoutKey,
  hasMore,
  loading,
  onLoadMore,
}) {
  const requested = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    requested.current = null;
  }, [listRef, resetKey]);

  useEffect(() => {
    const root = listRef.current;
    if (!root || !hasMore || loading || !onLoadMore) return undefined;
    let frame;
    const check = () => {
      frame = undefined;
      if (root.clientHeight <= 0 || requested.current === itemCount) return;
      const fits = root.scrollHeight <= root.clientHeight + 1;
      const nearBottom =
        root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 32;
      if (fits || nearBottom) {
        requested.current = itemCount;
        onLoadMore();
      }
    };
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(check);
    };
    const handleScroll = () => {
      requested.current = null;
      schedule();
    };
    const observer = new IntersectionObserver(schedule, { root });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    root.addEventListener('scroll', handleScroll, { passive: true });
    root.addEventListener('wheel', handleScroll, { passive: true });
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      root.removeEventListener('scroll', handleScroll);
      root.removeEventListener('wheel', handleScroll);
    };
  }, [hasMore, itemCount, layoutKey, listRef, loading, onLoadMore, resetKey, sentinelRef]);
}
