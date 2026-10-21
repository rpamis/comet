import { useEffect, useState } from 'react';

const EVENT = 'comet-dashboard-navigation';
const workspaceRoutes = new WeakMap();

function workspaceKey(route) {
  return JSON.stringify([route.projectId, route.view, route.workflow ?? route.pluginId ?? null]);
}

function rememberWorkspace(route, browser) {
  // 新建表单不作为恢复目标，避免重进页面时误以为未保存配置仍然存在。
  if (route.view === 'eval' && route.mode === 'new') return;
  let routes = workspaceRoutes.get(browser);
  if (!routes) workspaceRoutes.set(browser, (routes = new Map()));
  routes.set(workspaceKey(route), route);
}
const id = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 512 &&
  // eslint-disable-next-line no-control-regex -- Route identifiers must reject control characters.
  !/[\u0000-\u001f]/u.test(value)
    ? value
    : null;

function normalize(value) {
  const projectId = id(value?.projectId);
  if (value?.view === 'context-usage') return { view: 'context-usage', projectId };
  if (value?.view === 'eval') {
    const route = {
      view: 'eval',
      projectId,
      runId: id(value.runId),
      mode: value.mode === 'new' ? 'new' : 'list',
    };
    if (
      value.returnTo?.view === 'workflow' &&
      ['any', 'application'].includes(value.returnTo.workflow) &&
      id(value.returnTo.projectId) === projectId
    )
      route.returnTo = normalize(value.returnTo);
    return route;
  }
  if (value?.view === 'plugin' && id(value.pluginId))
    return {
      view: 'plugin',
      projectId,
      pluginId: value.pluginId,
    };
  const route = {
    view: 'workflow',
    projectId,
    workflow: ['native', 'classic', 'any', 'application'].includes(value?.workflow)
      ? value.workflow
      : null,
  };
  if (['any', 'application'].includes(route.workflow)) {
    if (id(value.runLocator)) route.runLocator = id(value.runLocator);
    if (id(value.recordId)) route.recordId = id(value.recordId);
    if (['steps', 'history', 'artifacts', 'evidence'].includes(value.runTab))
      route.runTab = value.runTab;
  }
  return route;
}

export function readDashboardNavigation(browser = window) {
  const query = new URLSearchParams(browser.location.search);
  if (query.get('view') === 'eval')
    return normalize({ view: 'eval', projectId: query.get('project'), runId: query.get('run') });
  return normalize(browser.history.state?.cometDashboard);
}

/** Store page identity in this history entry, leaving the visible Dashboard URL clean. */
export function navigateDashboard(
  value,
  { replace = false, restore = false } = {},
  browser = window,
) {
  rememberWorkspace(readDashboardNavigation(browser), browser);
  const requested = normalize(value);
  const route =
    (restore && workspaceRoutes.get(browser)?.get(workspaceKey(requested))) || requested;
  const url = new URL(browser.location.href);
  for (const key of ['view', 'project', 'run']) url.searchParams.delete(key);
  const state = { ...browser.history.state, cometDashboard: route };
  const current = browser.history.state?.cometDashboard;
  const same = current && JSON.stringify(normalize(current)) === JSON.stringify(route);
  browser.history[replace || same ? 'replaceState' : 'pushState'](state, '', url);
  rememberWorkspace(route, browser);
  browser.dispatchEvent(new Event(EVENT));
}

export function useDashboardNavigation({ embedded = false } = {}) {
  const isEmbedded = embedded || globalThis.__COMET_DASHBOARD_EMBED__ === true;
  const [route, setRoute] = useState(() =>
    isEmbedded ? normalize(null) : readDashboardNavigation(),
  );
  useEffect(() => {
    if (isEmbedded) return undefined;
    const update = () => {
      const next = readDashboardNavigation();
      rememberWorkspace(next, window);
      setRoute(next);
    };
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    // Keep bookmarked Eval links working, then move their identity into history state.
    if (new URLSearchParams(window.location.search).get('view') === 'eval') {
      navigateDashboard(readDashboardNavigation(), { replace: true });
    } else if (!window.history.state?.cometDashboard) {
      navigateDashboard(readDashboardNavigation(), { replace: true });
    }
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, [isEmbedded]);
  return route;
}
