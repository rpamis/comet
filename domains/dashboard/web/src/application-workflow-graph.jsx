import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { t } from './dashboard-i18n.js';
import { applicationWorkflowLayers } from './application-data.js';
import './application-workflow-graph.css';

export function ApplicationWorkflowGraph({ flow, renderNode }) {
  const root = useRef(null);
  const [paths, setPaths] = useState([]);
  const marker = `workflow-arrow-${useId().replace(/[^a-z0-9]/giu, '')}`;
  useLayoutEffect(() => {
    const element = root.current;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const frameBounds = element.getBoundingClientRect();
        const scaleX = frameBounds.width ? element.offsetWidth / frameBounds.width : 1;
        const scaleY = frameBounds.height ? element.offsetHeight / frameBounds.height : 1;
        const bounds = { left: 0, top: 0 };
        const boxes = new Map(
          [...element.querySelectorAll('[data-step-id]')].map((node) => [
            node.dataset.stepId,
            (() => {
              const rect = node.getBoundingClientRect();
              return {
                left: (rect.left - frameBounds.left) * scaleX,
                right: (rect.right - frameBounds.left) * scaleX,
                top: (rect.top - frameBounds.top) * scaleY,
                bottom: (rect.bottom - frameBounds.top) * scaleY,
                width: rect.width * scaleX,
                height: rect.height * scaleY,
              };
            })(),
          ]),
        );
        setPaths(
          flow.edges.flatMap((edge, index) => {
            const from = boxes.get(edge.from),
              to = boxes.get(edge.to);
            if (!from || !to) return [];
            const x1 = from.left + from.width / 2 - bounds.left;
            const y1 = from.bottom - bounds.top;
            const x2 = to.left + to.width / 2 - bounds.left;
            const y2 = to.top - bounds.top;
            const forward = y2 > y1 + 8;
            const d = forward
              ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 4}`
              : `M${from.right - bounds.left},${from.top + from.height / 2 - bounds.top} C${Math.max(from.right, to.right) - bounds.left + 16},${from.top - bounds.top - 16} ${Math.max(from.right, to.right) - bounds.left + 16},${to.bottom - bounds.top + 16} ${to.right - bounds.left},${to.top + to.height / 2 - bounds.top}`;
            return [{ ...edge, key: index, d }];
          }),
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const node of element.querySelectorAll('[data-step-id]')) observer.observe(node);
    measure();
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [flow]);
  return (
    <div ref={root} className="application-workflow-graph" aria-label={t('运行流程图')}>
      <svg className="application-graph-edges" aria-hidden="true">
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" />
          </marker>
        </defs>
        {paths.map((edge) => (
          <path
            key={edge.key}
            d={edge.d}
            className={edge.cyclic ? 'is-cycle' : ''}
            markerEnd={`url(#${marker})`}
          />
        ))}
      </svg>
      {applicationWorkflowLayers(flow).map((nodes, index) => (
        <div className="application-graph-layer" key={index}>
          {nodes.map(renderNode)}
        </div>
      ))}
      <p className="application-graph-note">
        {t(
          '每个步骤仅展示一次；连线表示定义允许的路径，虚线表示循环。点击步骤查看条件、执行历史与汇合依赖。',
        )}
      </p>
    </div>
  );
}
