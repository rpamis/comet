import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

// 只保存当前页面会话中的阅读选择，不保存接口数据或写入浏览器存储。
const viewStates = new Map();
const scrollPositions = new Map();
const documentPosition = Symbol('document');

function viewEntry(scope, key, initialValue) {
  if (!viewStates.has(scope)) viewStates.set(scope, new Map());
  const entries = viewStates.get(scope);
  if (!entries.has(key)) {
    const listeners = new Set();
    const entry = {
      value: typeof initialValue === 'function' ? initialValue() : initialValue,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      snapshot() {
        return entry.value;
      },
      setValue(next) {
        const value = typeof next === 'function' ? next(entry.value) : next;
        if (Object.is(value, entry.value)) return;
        entry.value = value;
        listeners.forEach((listener) => listener());
      },
    };
    entries.set(key, entry);
  }
  return entries.get(key);
}

/** scope 应包含项目和模块身份；key 只标识筛选、选中记录等阅读状态。 */
export function useDashboardViewState(scope, key, initialValue) {
  const entry = useMemo(() => viewEntry(scope, key, initialValue), [scope, key]);
  return [useSyncExternalStore(entry.subscribe, entry.snapshot, entry.snapshot), entry.setValue];
}

function observeScroll(root, scope) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  if (!scrollPositions.has(scope)) scrollPositions.set(scope, new Map());
  const positions = scrollPositions.get(scope);
  const pending = new Map(positions);
  if (!pending.has(documentPosition)) pending.set(documentPosition, { top: 0, left: 0 });
  let frame = null;
  let active = true;
  let resizeObserver;
  let mutationObserver;
  const observed = new Set();

  const panes = () =>
    new Map(
      [
        ...(root.hasAttribute('data-dashboard-scroll') ? [root] : []),
        ...root.querySelectorAll('[data-dashboard-scroll]'),
      ].map((element) => [element.getAttribute('data-dashboard-scroll'), element]),
    );
  for (const name of panes().keys()) {
    if (!pending.has(name)) pending.set(name, { top: 0, left: 0 });
  }
  const readDocument = () => ({ top: win.scrollY, left: win.scrollX });
  const readPane = (element) => ({ top: element.scrollTop, left: element.scrollLeft });
  const capture = () => {
    if (!pending.has(documentPosition)) positions.set(documentPosition, readDocument());
    for (const [name, element] of panes()) {
      if (!pending.has(name)) positions.set(name, readPane(element));
    }
  };
  const stopWaiting = () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
  };
  const restore = () => {
    frame = null;
    if (!active || !pending.size) return;
    const currentPanes = panes();
    for (const element of currentPanes.values()) {
      if (!observed.has(element)) {
        resizeObserver?.observe(element);
        observed.add(element);
      }
    }
    for (const [name, position] of pending) {
      const element =
        name === documentPosition
          ? (doc.scrollingElement ?? doc.documentElement)
          : currentPanes.get(name);
      if (!element) continue;
      const height = name === documentPosition ? win.innerHeight : element.clientHeight;
      const width = name === documentPosition ? win.innerWidth : element.clientWidth;
      // 加载占位尚未撑开页面时保留目标位置，等待内容尺寸变化。
      if (
        Math.max(0, element.scrollHeight - height) < position.top - 1 ||
        Math.max(0, element.scrollWidth - width) < position.left - 1
      )
        continue;
      pending.delete(name);
      if (name === documentPosition) {
        win.scrollTo({ top: position.top, left: position.left, behavior: 'instant' });
      } else {
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
      positions.set(name, position);
    }
    if (!pending.size) stopWaiting();
  };
  const schedule = () => {
    if (active && pending.size && frame === null) frame = win.requestAnimationFrame(restore);
  };
  const onScroll = (event) => {
    if (event.target === doc || event.target === win) {
      if (!pending.has(documentPosition)) positions.set(documentPosition, readDocument());
      return;
    }
    const element = event.target;
    if (root.contains(element) && element.hasAttribute?.('data-dashboard-scroll')) {
      const name = element.getAttribute('data-dashboard-scroll');
      if (!pending.has(name)) positions.set(name, readPane(element));
    }
  };
  const onIntent = (event) => {
    if (
      event.type === 'pointerdown' &&
      event.target !== doc.documentElement &&
      !root.contains(event.target)
    ) {
      // 侧栏导航改变子树前补记位置，覆盖尚未派发 scroll 事件的最后一次滚动。
      capture();
      return;
    }
    if (
      event.type === 'keydown' &&
      !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter'].includes(
        event.key,
      )
    )
      return;
    pending.clear();
    stopWaiting();
    capture();
  };

  if (typeof win.ResizeObserver === 'function') {
    resizeObserver = new win.ResizeObserver(schedule);
    resizeObserver.observe(root);
    resizeObserver.observe(doc.documentElement);
  }
  if (typeof win.MutationObserver === 'function') {
    mutationObserver = new win.MutationObserver(schedule);
    mutationObserver.observe(root, { childList: true, subtree: true });
  }
  doc.addEventListener('scroll', onScroll, true);
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    doc.addEventListener(type, onIntent, { capture: true, passive: true });
  }
  schedule();
  return () => {
    active = false;
    // ref 清理时内容可能已经替换，不能用被夹断的位置覆盖最后的滚动记录。
    stopWaiting();
    doc.removeEventListener('scroll', onScroll, true);
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      doc.removeEventListener(type, onIntent, true);
    }
  };
}

/** 绑定模块外层现有节点；局部滚动区用 data-dashboard-scroll 提供稳定名称。 */
export function useDashboardScrollRestoration(scope) {
  const cleanup = useRef(null);
  return useCallback(
    (element) => {
      cleanup.current?.();
      cleanup.current = element ? observeScroll(element, scope) : null;
    },
    [scope],
  );
}
