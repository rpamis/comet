// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StageIcon } from '../../../domains/dashboard/web/src/stage-icons/StageIcon';

describe('StageIcon reduced motion compatibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = () => act(() => root.render(createElement(StageIcon, { stage: 'verify' })));

  it('renders when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    render();
    expect(container.querySelector('svg')?.getAttribute('data-reduced-motion')).toBe('false');
  });

  it('reads a media query that has no listener APIs', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render();
    expect(container.querySelector('svg')?.getAttribute('data-reduced-motion')).toBe('true');
  });

  it.each(['modern', 'legacy', 'partial-modern'] as const)(
    'subscribes and cleans up %s media listeners',
    (api) => {
      let notify = () => {};
      const add = vi.fn((...args: unknown[]) => {
        notify = args.at(-1) as () => void;
      });
      const remove = vi.fn();
      const query = {
        matches: false,
        ...(api === 'modern'
          ? { addEventListener: add, removeEventListener: remove }
          : {
              addListener: add,
              removeListener: remove,
              ...(api === 'partial-modern' ? { addEventListener: vi.fn() } : {}),
            }),
      };
      vi.stubGlobal('matchMedia', () => query);
      render();
      expect(add).toHaveBeenCalledOnce();
      act(() => {
        query.matches = true;
        notify();
      });
      expect(container.querySelector('svg')?.getAttribute('data-reduced-motion')).toBe('true');
      act(() => root.render(null));
      expect(remove).toHaveBeenCalledWith(...add.mock.calls[0]);
    },
  );
});
