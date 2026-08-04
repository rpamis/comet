import React, { useLayoutEffect, useRef, useState } from 'react';

const WORKSPACE_GRID_CLASS =
  'dashboard-workspace-region grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]';

export function DashboardWorkspaceRegion({
  left,
  center,
  right,
  leftClassName = '',
  stableFrame = false,
}) {
  const centerRef = useRef(null);
  const [centerHeight, setCenterHeight] = useState(0);

  useLayoutEffect(() => {
    if (stableFrame) {
      setCenterHeight(0);
      return undefined;
    }

    const element = centerRef.current;
    if (!element) return undefined;

    const measure = () => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      setCenterHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stableFrame]);

  const style = centerHeight > 0 ? { '--dashboard-center-height': `${centerHeight}px` } : undefined;

  return (
    <div
      className={`${WORKSPACE_GRID_CLASS} ${stableFrame ? 'dashboard-workspace-region-stable' : ''}`.trim()}
      style={style}
    >
      <div className={`dashboard-workspace-side dashboard-workspace-left ${leftClassName}`.trim()}>
        {left}
      </div>
      <div ref={centerRef} className="dashboard-workspace-center min-w-0">
        {center}
      </div>
      <div className="dashboard-workspace-side dashboard-workspace-right xl:col-start-2 2xl:col-start-auto">
        {right}
      </div>
    </div>
  );
}
