import React, { useLayoutEffect, useRef, useState } from 'react';

const WORKSPACE_GRID_CLASS =
  'dashboard-workspace-region grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,320px)]';

export function WorkflowEmptyIllustration({ compact = false }) {
  return (
    <svg
      className={`workflow-empty-illustration${compact ? ' is-compact' : ''}`}
      viewBox="0 0 120 96"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="60" cy="85" rx="42" ry="5" className="workflow-empty-shadow" />
      <rect
        x="29"
        y="12"
        width="68"
        height="62"
        rx="10"
        transform="rotate(9 63 43)"
        className="workflow-empty-back"
      />
      <rect x="20" y="20" width="76" height="62" rx="10" className="workflow-empty-card" />
      <path d="M20 37h76" className="workflow-empty-divider" />
      <circle cx="29" cy="29" r="2" className="workflow-empty-accent" />
      <path d="M36 29h20" className="workflow-empty-line" />
      {compact ? (
        <>
          <path d="M32 49h7m-7 11h7m-7 11h7" className="workflow-empty-line" />
          <path d="M47 49h32m-32 11h23m-23 11h28" className="workflow-empty-divider" />
          <rect x="78" y="55" width="25" height="25" rx="8" className="workflow-empty-badge" />
          <path d="M85 67h3l2-4 3 8 2-4h2" className="workflow-empty-route" />
        </>
      ) : (
        <>
          <path d="M38 52h16a6 6 0 0 1 6 6v2a6 6 0 0 0 6 6h13" className="workflow-empty-route" />
          <rect x="29" y="46" width="14" height="14" rx="4" className="workflow-empty-node" />
          <rect x="74" y="59" width="14" height="14" rx="4" className="workflow-empty-node" />
          <circle cx="36" cy="53" r="2" className="workflow-empty-accent" />
          <circle cx="81" cy="66" r="2" className="workflow-empty-accent" />
          <path d="M31 70h16m22-22h15" className="workflow-empty-divider" />
        </>
      )}
    </svg>
  );
}

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
