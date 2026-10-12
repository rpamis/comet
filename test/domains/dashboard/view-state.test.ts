// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useDashboardScrollRestoration,
  useDashboardViewState,
} from '../../../domains/dashboard/web/src/dashboard-view-state.js';

let container: HTMLDivElement;
let root: Root;
let sequence = 0;
let setValue: (value: unknown) => void;
let renders: unknown[];
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resize: () => void;
let pageHeight: number;

function State({ scope, field = 'selection', initial = 'list' }) {
  const [value, update] = useDashboardViewState(scope, field, initial);
  setValue = update;
  renders.push(value);
  return createElement('output', null, String(value));
}

function Scroll({ scope, height = 1200, ready = true }) {
  const ref = useDashboardScrollRestoration(scope);
  return createElement(
    'main',
    { ref, 'data-dashboard-scroll': 'workspace' },
    ready
      ? createElement('div', {
          'data-dashboard-scroll': 'results',
          ref: (element: HTMLDivElement | null) => {
            if (!element) return;
            Object.defineProperties(element, {
              scrollHeight: { configurable: true, value: height },
              clientHeight: { configurable: true, value: 200 },
              scrollWidth: { configurable: true, value: 900 },
              clientWidth: { configurable: true, value: 300 },
            });
          },
        })
      : null,
  );
}

function flushFrames() {
  const queued = [...frames.values()];
  frames.clear();
  queued.forEach((callback) => callback(0));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  renders = [];
  frames = new Map();
  nextFrame = 1;
  pageHeight = 2000;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperties(document.documentElement, {
    scrollHeight: { configurable: true, get: () => pageHeight },
    scrollWidth: { configurable: true, value: 1200 },
  });
  vi.stubGlobal('innerHeight', 700);
  vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('scrollX', 0);
  vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
    if (typeof options !== 'object') return;
    vi.stubGlobal('scrollY', options.top ?? 0);
    vi.stubGlobal('scrollX', options.left ?? 0);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Dashboard reading state', () => {
  it('restores a view on remount without initializing it again', () => {
    const scope = `project-${sequence++}:eval`;
    const initial = vi.fn(() => 'list');
    act(() => root.render(createElement(State, { scope, initial })));
    act(() => setValue('run-1:artifacts'));
    act(() => root.render(null));
    act(() => root.render(createElement(State, { scope, initial })));
    expect(container.textContent).toBe('run-1:artifacts');
    expect(initial).toHaveBeenCalledTimes(1);
  });

  it('switches projects and fields without rendering the previous selection', () => {
    const scope = `project-${sequence++}`;
    act(() => root.render(createElement(State, { scope: `${scope}:a` })));
    act(() => setValue('a-selected'));
    renders = [];
    act(() => root.render(createElement(State, { scope: `${scope}:b` })));
    expect(renders).toEqual(['list']);
    act(() => setValue('b-selected'));
    act(() => root.render(createElement(State, { scope: `${scope}:a` })));
    expect(container.textContent).toBe('a-selected');
    act(() => root.render(createElement(State, { scope: `${scope}:a`, field: 'filter' })));
    expect(container.textContent).toBe('list');
  });

  it('applies consecutive functional updates to the latest value', () => {
    act(() => root.render(createElement(State, { scope: `project-${sequence++}`, initial: 0 })));
    act(() => {
      setValue((previous: number) => previous + 1);
      setValue((previous: number) => previous + 1);
    });
    expect(container.textContent).toBe('2');
  });
});

describe('Dashboard scroll restoration', () => {
  it.each(['unchanged', 'clamped during teardown', 'awaiting a scroll event before navigation'])(
    'restores the root scroll container when the document stays fixed and its DOM is %s',
    (geometry) => {
      const scope = `scroll-${sequence++}`;
      const prepareShell = () => {
        const shell = container.querySelector('main')!;
        Object.defineProperties(shell, {
          scrollHeight: { configurable: true, value: 1800 },
          clientHeight: { configurable: true, value: 600 },
          scrollWidth: { configurable: true, value: 1200 },
          clientWidth: { configurable: true, value: 1200 },
        });
        return shell;
      };
      act(() => root.render(createElement(Scroll, { scope })));
      const shell = prepareShell();
      flushFrames();
      shell.scrollTop = 450;
      if (geometry === 'awaiting a scroll event before navigation') {
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      } else {
        shell.dispatchEvent(new Event('scroll'));
      }
      // React 替换子树后，旧 ref 的清理可能读到被短内容夹断的位置。
      if (geometry !== 'unchanged') shell.scrollTop = 300;
      act(() => root.render(null));
      act(() => root.render(createElement(Scroll, { scope })));
      const restored = prepareShell();
      flushFrames();
      expect(window.scrollY).toBe(0);
      expect(restored.scrollTop).toBe(450);
    },
  );

  it('restores document and named pane positions when returning to a module', () => {
    const scope = `scroll-${sequence++}`;
    act(() => root.render(createElement(Scroll, { scope })));
    flushFrames();
    vi.stubGlobal('scrollY', 600);
    document.dispatchEvent(new Event('scroll'));
    const pane = container.querySelector('[data-dashboard-scroll="results"]') as HTMLElement;
    pane.scrollTop = 400;
    pane.scrollLeft = 80;
    pane.dispatchEvent(new Event('scroll'));
    act(() => root.render(null));
    vi.stubGlobal('scrollY', 0);
    act(() => root.render(createElement(Scroll, { scope })));
    flushFrames();
    const restored = container.querySelector('[data-dashboard-scroll="results"]') as HTMLElement;
    expect(window.scrollY).toBe(600);
    expect(restored.scrollTop).toBe(400);
    expect(restored.scrollLeft).toBe(80);
  });

  it('waits for async content and preserves the target through an early unmount', async () => {
    const scope = `scroll-${sequence++}`;
    act(() => root.render(createElement(Scroll, { scope })));
    flushFrames();
    vi.stubGlobal('scrollY', 600);
    document.dispatchEvent(new Event('scroll'));
    const pane = container.querySelector('[data-dashboard-scroll="results"]') as HTMLElement;
    pane.scrollTop = 400;
    pane.dispatchEvent(new Event('scroll'));
    act(() => root.render(null));
    pageHeight = 700;
    vi.stubGlobal('scrollY', 0);
    act(() => root.render(createElement(Scroll, { scope, ready: false })));
    flushFrames();
    document.dispatchEvent(new Event('scroll'));
    act(() => root.render(null));
    act(() => root.render(createElement(Scroll, { scope, height: 200 })));
    flushFrames();
    expect(window.scrollY).toBe(0);
    pageHeight = 2000;
    await act(async () => root.render(createElement(Scroll, { scope })));
    resize();
    flushFrames();
    expect(window.scrollY).toBe(600);
    expect(
      (container.querySelector('[data-dashboard-scroll="results"]') as HTMLElement).scrollTop,
    ).toBe(400);
  });

  it('isolates project scroll positions and restores a previously visited scope', () => {
    const scope = `scroll-${sequence++}`;
    act(() => root.render(createElement(Scroll, { scope: `${scope}:a` })));
    flushFrames();
    vi.stubGlobal('scrollY', 500);
    document.dispatchEvent(new Event('scroll'));
    const pane = container.querySelector('[data-dashboard-scroll="results"]') as HTMLElement;
    pane.scrollTop = 300;
    pane.dispatchEvent(new Event('scroll'));
    act(() => root.render(createElement(Scroll, { scope: `${scope}:b` })));
    flushFrames();
    expect(window.scrollY).toBe(0);
    expect(pane.scrollTop).toBe(0);
    act(() => root.render(createElement(Scroll, { scope: `${scope}:a` })));
    flushFrames();
    expect(window.scrollY).toBe(500);
    expect(pane.scrollTop).toBe(300);
  });

  it('gives scrolling back to the user before delayed content arrives', () => {
    const scope = `scroll-${sequence++}`;
    act(() => root.render(createElement(Scroll, { scope })));
    flushFrames();
    vi.stubGlobal('scrollY', 600);
    document.dispatchEvent(new Event('scroll'));
    act(() => root.render(null));
    pageHeight = 700;
    vi.stubGlobal('scrollY', 0);
    act(() => root.render(createElement(Scroll, { scope })));
    flushFrames();
    document.dispatchEvent(new WheelEvent('wheel'));
    vi.stubGlobal('scrollY', 100);
    document.dispatchEvent(new Event('scroll'));
    pageHeight = 2000;
    resize();
    flushFrames();
    expect(window.scrollY).toBe(100);
  });
});
