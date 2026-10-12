import { describe, expect, it, vi } from 'vitest';
import {
  readDashboardNavigation,
  navigateDashboard,
} from '../../../domains/dashboard/web/src/dashboard-navigation.js';

function browser(url = 'http://localhost:4399/') {
  const location = new URL(url);
  const history = { state: { other: 'kept' }, pushState: vi.fn(), replaceState: vi.fn() };
  for (const method of ['pushState', 'replaceState'] as const)
    history[method].mockImplementation((state, _unused, next) => {
      history.state = state;
      location.href = String(next);
    });
  return { location, history, dispatchEvent: vi.fn() };
}

describe('Dashboard navigation without URL suffixes', () => {
  it('resumes each project workspace without replacing explicit list navigation', () => {
    const page = browser();
    navigateDashboard({ view: 'eval', projectId: 'one', runId: 'run-one' }, {}, page);
    navigateDashboard(
      {
        view: 'workflow',
        projectId: 'one',
        workflow: 'any',
        runLocator: 'app:one',
        recordId: 'action:one:2',
        runTab: 'history',
      },
      {},
      page,
    );
    navigateDashboard({ view: 'eval', projectId: 'two', runId: 'run-two' }, {}, page);
    navigateDashboard({ view: 'eval', projectId: 'one' }, { restore: true }, page);
    expect(readDashboardNavigation(page).runId).toBe('run-one');
    navigateDashboard(
      { view: 'workflow', projectId: 'one', workflow: 'any' },
      { restore: true },
      page,
    );
    expect(readDashboardNavigation(page)).toMatchObject({
      runLocator: 'app:one',
      recordId: 'action:one:2',
      runTab: 'history',
    });
    navigateDashboard({ view: 'eval', projectId: 'one' }, {}, page);
    expect(readDashboardNavigation(page).runId).toBeNull();
    navigateDashboard({ view: 'eval', projectId: 'two' }, { restore: true }, page);
    expect(readDashboardNavigation(page).runId).toBe('run-two');
    navigateDashboard({ view: 'eval', projectId: 'one' }, { restore: true }, page);
    expect(readDashboardNavigation(page).runId).toBeNull();
  });

  it('does not restore an abandoned creation form or share workspace memory across browser instances', () => {
    const page = browser();
    navigateDashboard({ view: 'eval', projectId: 'one', runId: 'run-one' }, {}, page);
    navigateDashboard({ view: 'eval', projectId: 'one', mode: 'new' }, {}, page);
    navigateDashboard({ view: 'workflow', projectId: 'one', workflow: 'any' }, {}, page);
    navigateDashboard({ view: 'eval', projectId: 'one' }, { restore: true }, page);
    expect(readDashboardNavigation(page)).toMatchObject({ runId: 'run-one', mode: 'list' });
    const other = browser();
    navigateDashboard({ view: 'eval', projectId: 'one' }, { restore: true }, other);
    expect(readDashboardNavigation(other).runId).toBeNull();
  });
  it('preserves the Any run and activation without persisting execution requests', () => {
    const page = browser();
    navigateDashboard(
      {
        view: 'workflow',
        workflow: 'any',
        projectId: 'one',
        runLocator: 'application:fixed',
        recordId: 'action:run:2',
        runTab: 'history',
        claimToken: 'never-store',
      },
      {},
      page,
    );
    expect(readDashboardNavigation(page)).toMatchObject({
      workflow: 'any',
      runLocator: 'application:fixed',
      recordId: 'action:run:2',
      runTab: 'history',
    });
    expect(JSON.stringify(page.history.state)).not.toContain('never-store');
  });
  it('accepts legacy links and migrates them without removing unrelated options', () => {
    const page = browser('http://localhost:4399/?view=eval&project=project&run=run-one&demo');
    const route = readDashboardNavigation(page);
    expect(route).toMatchObject({ view: 'eval', projectId: 'project', runId: 'run-one' });
    navigateDashboard(route, { replace: true }, page);
    expect(page.location.search).toBe('?demo=');
    expect(page.history.replaceState).toHaveBeenCalledOnce();
    expect(page.history.state.other).toBe('kept');
    expect(readDashboardNavigation(page)).toEqual(route);
  });
  it('stores only page identity, keeps the root URL, and avoids duplicate history entries', () => {
    const page = browser();
    const route = {
      view: 'eval',
      projectId: 'project',
      runId: 'run-one',
      credential: 'never-store',
      config: { target: '/private' },
    };
    navigateDashboard(route, {}, page);
    expect(page.location.href).toBe('http://localhost:4399/');
    expect(JSON.stringify(page.history.state)).not.toContain('never-store');
    expect(JSON.stringify(page.history.state)).not.toContain('/private');
    navigateDashboard(route, {}, page);
    expect(page.history.pushState).toHaveBeenCalledOnce();
    expect(page.history.replaceState).toHaveBeenCalledOnce();
  });
  it('restores saved destinations and safely falls back from invalid state', () => {
    const page = browser();
    navigateDashboard(
      { view: 'plugin', pluginId: 'comet.personal-memory', projectId: 'project' },
      {},
      page,
    );
    expect(readDashboardNavigation(page)).toMatchObject({
      view: 'plugin',
      pluginId: 'comet.personal-memory',
    });
    navigateDashboard({ view: 'unknown', workflow: 'invalid', projectId: '\n' }, {}, page);
    expect(readDashboardNavigation(page)).toEqual({
      view: 'workflow',
      workflow: null,
      projectId: null,
    });
  });
  it('falls back from the former update route without saving a confirmation or command', () => {
    const page = browser();
    navigateDashboard(
      {
        view: 'update',
        projectId: 'project',
        confirmed: true,
        version: '0.5.1',
        command: 'never-replay',
      },
      {},
      page,
    );
    expect(readDashboardNavigation(page)).toEqual({
      view: 'workflow',
      workflow: null,
      projectId: 'project',
    });
    expect(page.location.search).toBe('');
  });
});
