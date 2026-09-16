import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { WorkflowPhaseTrack } from '../../../domains/dashboard/web/src/phase-progress-indicator.jsx';

const phases = [
  ['first', 'First'],
  ['second', 'Second'],
  ['third', 'Third'],
];

function states(props: Record<string, unknown>) {
  const html = renderToStaticMarkup(createElement(WorkflowPhaseTrack, { phases, ...props }));
  return Array.from(new JSDOM(html).window.document.querySelectorAll('[role="listitem"]')).map(
    (item) => item.className,
  );
}

describe('shared workflow phase track', () => {
  it('preserves Native and Classic sequential phase defaults', () => {
    expect(states({ currentIndex: 1, currentPhaseRunning: false })).toEqual([
      'dashboard-phase-item is-done',
      'dashboard-phase-item is-current',
      'dashboard-phase-item is-pending',
    ]);
    expect(states({ currentIndex: 1, archived: true })).toEqual(
      Array(3).fill('dashboard-phase-item is-done'),
    );
  });

  it('does not invent completion for Any nodes before the current node', () => {
    expect(
      states({
        currentIndex: 2,
        currentPhaseRunning: false,
        phaseStates: { first: 'pending', second: 'done', third: 'current' },
      }),
    ).toEqual([
      'dashboard-phase-item is-pending',
      'dashboard-phase-item is-done',
      'dashboard-phase-item is-current',
    ]);
  });
});
