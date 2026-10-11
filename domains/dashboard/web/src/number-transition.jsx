import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Badge } from 'antd';

let reducedMotionQuery;

function motionQuery() {
  reducedMotionQuery ??= window.matchMedia?.('(prefers-reduced-motion: reduce)');
  return reducedMotionQuery;
}

function subscribeReducedMotion(listener) {
  const query = motionQuery();
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

function reducedMotionSnapshot() {
  return motionQuery()?.matches ?? false;
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false);
}

export function useNumberTransition(value, identity, numberEntryKey = null) {
  const reducedMotion = useReducedMotion();
  const current = useRef({ identity, value });
  const consumedEntryKey = useRef(null);
  const [displayed, setDisplayed] = useState(current.current);
  const entryKey = numberEntryKey ?? consumedEntryKey.current;

  useLayoutEffect(() => {
    const update = (nextValue) => {
      current.current = { identity, value: nextValue };
      setDisplayed(current.current);
    };
    const entering = numberEntryKey !== null && consumedEntryKey.current !== numberEntryKey;
    const continuingEntry = numberEntryKey !== null && consumedEntryKey.current === numberEntryKey;
    if (entering) consumedEntryKey.current = numberEntryKey;
    if (
      reducedMotion ||
      (!entering && !continuingEntry && !Object.is(current.current.identity, identity))
    ) {
      update(value);
      return undefined;
    }
    const from = entering ? 0 : current.current.value;
    update(from);
    if (Object.is(from, value)) return undefined;

    const startedAt = performance.now();
    let frame;
    let cancelled = false;
    const tick = (now) => {
      if (cancelled) return;
      const progress = Math.max(0, Math.min(1, (now - startedAt) / 250));
      const eased = 1 - (1 - progress) ** 3;
      update(progress === 1 ? value : Math.round(from + (value - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [identity, reducedMotion, value, entryKey]);

  const continuingEntry = numberEntryKey !== null && consumedEntryKey.current === numberEntryKey;
  return reducedMotion || (!continuingEntry && !Object.is(displayed.identity, identity))
    ? value
    : displayed.value;
}

export function AnimatedNumber({ value, identity, numberEntryKey = null }) {
  return useNumberTransition(value, identity, numberEntryKey);
}

export function ChangeCountBadge({ count, className = '' }) {
  const reducedMotion = useReducedMotion();
  return (
    <Badge
      key={reducedMotion}
      count={count}
      overflowCount={Infinity}
      showZero
      className={`dashboard-change-count-badge ${className}`}
    />
  );
}
