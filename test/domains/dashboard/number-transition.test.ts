// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimatedNumber } from '../../../domains/dashboard/web/src/number-transition.jsx';

type Frame = (time: number) => void;

const listeners = new Set<(event: MediaQueryListEvent) => void>();
let reducedMotion = false;
const mediaQuery = {
  media: '(prefers-reduced-motion: reduce)',
  get matches() {
    return reducedMotion;
  },
  addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
    listeners.add(listener),
  removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
    listeners.delete(listener),
} as unknown as MediaQueryList;

describe('AnimatedNumber', () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let clock: number;
  let frames: Map<number, Frame>;

  const value = () => Number(container.textContent?.trim());

  const render = (number: number, identity: string, numberEntryKey: string | null = null) => {
    act(() =>
      root.render(createElement(AnimatedNumber, { value: number, identity, numberEntryKey })),
    );
  };

  const advance = (delta: number) => {
    const pending = [...frames.values()];
    frames.clear();
    clock += delta;
    act(() => pending.forEach((frame) => frame(clock)));
  };

  const fireFramesAt = (timestamp: number) => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((frame) => frame(timestamp)));
  };

  const setReducedMotion = (matches: boolean) => {
    act(() => {
      reducedMotion = matches;
      const event = { matches, media: mediaQuery.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    });
  };

  beforeEach(() => {
    reducedMotion = false;
    listeners.clear();
    nextFrameId = 0;
    clock = 0;
    frames = new Map();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => mediaQuery,
    });
    const requestFrame = (callback: Frame) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    };
    const cancelFrame = (id: number) => frames.delete(id);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: requestFrame,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: cancelFrame,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as Window & { matchMedia?: typeof window.matchMedia }).matchMedia;
    delete (window as Window & { requestAnimationFrame?: typeof window.requestAnimationFrame })
      .requestAnimationFrame;
    delete (window as Window & { cancelAnimationFrame?: typeof window.cancelAnimationFrame })
      .cancelAnimationFrame;
  });

  it('starts at the target, animates both directions and retargets from the displayed value', () => {
    render(4, 'project-a/classic/active');
    expect(value()).toBe(4);
    expect(frames.size).toBe(0);

    render(20, 'project-a/classic/active');
    advance(0);
    advance(125);
    const upwardMidpoint = value();
    expect(upwardMidpoint).toBeGreaterThan(4);
    expect(upwardMidpoint).toBeLessThan(20);

    render(30, 'project-a/classic/active');
    expect(value()).toBe(upwardMidpoint);
    advance(0);
    advance(125);
    const retargetedMidpoint = value();
    expect(retargetedMidpoint).toBeGreaterThan(upwardMidpoint);
    expect(retargetedMidpoint).toBeLessThan(30);
    advance(250);
    expect(value()).toBe(30);

    render(0, 'project-a/classic/active');
    advance(0);
    advance(125);
    expect(value()).toBeGreaterThan(0);
    expect(value()).toBeLessThan(30);
    advance(250);
    expect(value()).toBe(0);
  });

  it('switches identity immediately and finishes an active transition when reduced motion turns on', () => {
    render(12, 'project-a/native/ship');
    render(80, 'project-a/native/ship');
    advance(0);
    advance(100);
    expect(value()).toBeGreaterThan(12);
    expect(value()).toBeLessThan(80);

    render(3, 'project-a/native/align');
    expect(value()).toBe(3);
    expect(frames.size).toBe(0);

    render(3, 'project-a/native/ship');
    render(42, 'project-a/native/ship');
    advance(0);
    advance(100);
    expect(value()).toBeGreaterThan(3);
    expect(value()).toBeLessThan(42);

    setReducedMotion(true);
    expect(value()).toBe(42);
    expect(frames.size).toBe(0);
  });

  it('renders the initial target without an animation when reduced motion is already enabled', () => {
    reducedMotion = true;
    render(17, 'project-a/native/ship');

    expect(value()).toBe(17);
    expect(frames.size).toBe(0);
  });

  it('keeps the starting value when the first animation frame timestamp predates its start', () => {
    render(16, 'project-a/classic/active');
    clock = 1000;
    render(120, 'project-a/classic/active');

    fireFramesAt(984);
    expect(value()).toBe(16);

    advance(125);
    expect(value()).toBeGreaterThan(16);
    expect(value()).toBeLessThan(120);
    advance(125);
    expect(value()).toBe(120);
  });

  it('starts at zero only for a new workflow entry and continues through its first-page identity', () => {
    render(16, 'project-a/classic/active');
    expect(value()).toBe(16);

    render(80, 'project-a/native/active/loading', 'native-entry-1');
    expect(value()).toBe(0);
    advance(100);
    const entryMidpoint = value();
    expect(entryMidpoint).toBeGreaterThan(0);
    expect(entryMidpoint).toBeLessThan(80);

    render(120, 'project-a/native/active/ready', 'native-entry-1');
    expect(value()).toBe(entryMidpoint);
    advance(100);
    const readyMidpoint = value();
    expect(readyMidpoint).toBeGreaterThan(entryMidpoint);
    expect(readyMidpoint).toBeLessThan(120);
    render(120, 'project-a/native/active/ready');
    expect(value()).toBe(readyMidpoint);
    advance(250);
    expect(value()).toBe(120);

    render(7, 'project-a/native/active/another-change');
    expect(value()).toBe(7);
    expect(frames.size).toBe(0);

    render(16, 'project-a/classic/active', 'classic-entry-2');
    expect(value()).toBe(0);
    advance(250);
    expect(value()).toBe(16);
  });

  it('animates a delayed workflow entry mount and immediately settles it when reduced motion turns on', () => {
    render(80, 'project-a/native/active/ship', 'native-entry-1');
    expect(value()).toBe(0);
    advance(100);
    expect(value()).toBeGreaterThan(0);
    expect(value()).toBeLessThan(80);

    setReducedMotion(true);
    expect(value()).toBe(80);
    expect(frames.size).toBe(0);
    render(42, 'project-a/classic/active', 'classic-entry-2');
    expect(value()).toBe(42);
    expect(frames.size).toBe(0);
  });
});
