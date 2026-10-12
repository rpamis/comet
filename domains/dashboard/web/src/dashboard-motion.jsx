import React, { useCallback, useRef } from 'react';
import './dashboard-motion.css';

const presets = {
  fade: { duration: 180, offset: null, opacity: 0.65 },
  page: { duration: 280, offset: '0, 8px' },
  panel: { duration: 240, offset: '0, 6px' },
  tab: { duration: 200, offset: '0, 4px' },
  detail: { duration: 220, offset: '5px, 0' },
};

/** 仅随视图身份切换，保留 DOM、焦点和阅读状态；刷新数据不重播。 */
export function useDashboardMotion(motionKey, kind = 'panel', active = true) {
  const stop = useRef(null);
  return useCallback(
    (element) => {
      stop.current?.();
      stop.current = null;
      if (!element || !active || typeof element.animate !== 'function') return;
      const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (preference.matches) return;
      const preset = presets[kind] ?? presets.panel;
      const animation = element.animate(
        preset.offset === null
          ? [{ opacity: preset.opacity ?? 0.85 }, { opacity: 1 }]
          : [
              { opacity: 0.58, transform: `translate(${preset.offset})` },
              { opacity: 1, transform: 'translate(0, 0)' },
            ],
        { duration: preset.duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      const reduce = () => {
        if (preference.matches) animation.cancel();
      };
      preference.addEventListener('change', reduce);
      const detach = () => preference.removeEventListener('change', reduce);
      animation.finished.then(detach, detach);
      stop.current = () => {
        detach();
        animation.cancel();
      };
    },
    [motionKey, kind, active],
  );
}

export function DashboardMotion({ motionKey, kind = 'tab', active = true, children }) {
  const ref = useDashboardMotion(motionKey, kind, active);
  return (
    <div ref={ref} className="dashboard-motion-surface" data-dashboard-motion={kind}>
      {children}
    </div>
  );
}
