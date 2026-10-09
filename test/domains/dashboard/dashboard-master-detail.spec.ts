import { expect, test, type Locator } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { DEMO_SNAPSHOT, DEMO_CLASSIC_PHASE_PROGRESS } from '../../../domains/dashboard/web/demo.js';

async function svgFrames(icon: Locator, duration = 1100) {
  return icon.evaluate(async (element, duration) => {
    const frames: string[] = [];
    const started = performance.now();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    do {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      frames.push(
        JSON.stringify(
          Array.from(element.querySelectorAll('g, path'), (node) => {
            const style = getComputedStyle(node);
            return [style.transform, style.opacity, style.strokeDasharray];
          }),
        ),
      );
    } while (performance.now() - started < duration);
    return frames;
  }, duration);
}

async function expectSvgMotion(icon: Locator, moving: boolean) {
  const frames = await svgFrames(icon, moving ? 1800 : 1100);
  if (moving) expect(new Set(frames).size, 'SVG should animate').toBeGreaterThan(1);
  else expect(new Set(frames).size, 'SVG should stay still').toBe(1);
}

test('shows completed earlier phases and running illustrations in the default Classic Demo', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');
  const track = page.getByRole('list', { name: 'Classic 生命周期阶段' });
  const select = (name: string) =>
    page.locator('.dashboard-change-row').filter({ hasText: name }).click();
  const ring = () => track.locator('svg[data-status="running"]').getAttribute('data-motion');
  await expect(track.locator('.dashboard-phase-label')).toHaveText([
    '启动',
    '设计',
    '构建',
    '验证',
    '归档',
  ]);
  await expect(track.locator('.is-done [data-status-badge="success"]')).toHaveCount(2);
  await expect(track.locator('.is-current')).toContainText('构建中');
  await expect(page.locator('.change-detail .ant-card-extra')).toHaveText('构建中');
  await expect(page.locator('.dashboard-change-row-selected')).toContainText('构建中');
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(1);
  expect(await ring()).toBe('running');
  await expectSvgMotion(track.locator('svg[data-status="running"]'), true);
  expect(
    await track
      .locator('svg[data-stage]')
      .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('width'))),
  ).toEqual(['72', '72', '72', '72', '72']);
  await page.screenshot({ path: testInfo.outputPath('classic-default-demo.png') });
  for (const [name, label, completed, running] of [
    ['dashboard-redesign', '设计中', 1, 1],
    ['fix-webhook-retries', '验证失败', 3, 0],
    ['migrate-config-to-yaml', '等待依赖', 2, 0],
    ['add-auth-rate-limiting', '构建中', 2, 1],
  ] as const) {
    await select(name);
    await expect(track.locator('.is-current')).toContainText(label);
    await expect(page.locator('.change-detail .ant-card-extra')).toHaveText(label);
    await expect(track.locator('.is-done')).toHaveCount(completed);
    await expect(track.locator('svg[data-status="running"]')).toHaveCount(running);
    if (running) await expectSvgMotion(track.locator('svg[data-status="running"]'), true);
    else await expectSvgMotion(track.locator('.is-current svg[data-stage]'), false);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(ring).toBe('static');
  await expectSvgMotion(track.locator('svg[data-status="running"]'), false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(ring).toBe('running');
  await expectSvgMotion(track.locator('svg[data-status="running"]'), true);
  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await page.getByRole('button', { name: /^add-dark-mode / }).click();
  await expect(track.locator('.is-done [data-status-badge="success"]')).toHaveCount(5);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
});

test('keeps Classic source states stationary without execution evidence', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  const change = snapshot.changes.active[0];
  change.phase = 'build';
  change.verify = { result: 'pending', reportExists: false };
  Object.assign(change, {
    demoPhaseProgress: DEMO_CLASSIC_PHASE_PROGRESS['add-auth-rate-limiting'],
  });
  const second = {
    ...structuredClone(change),
    id: 'classic-second',
    name: 'classic-second',
    displayName: 'classic-second',
  };
  snapshot.changes.active = [change, second];
  snapshot.changes.archived = [];
  let heldDetail: { id: string; started: () => void; gate: Promise<void> } | null = null;
  const holdDetail = (id = change.id) => {
    let started!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    heldDetail = { id, started, gate };
    return { ready, release };
  };
  const detailRequests: string[] = [];
  let failNextDetail = false;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/projects')) {
      await route.fulfill({
        json: {
          currentProjectId: 'isolated',
          projects: [
            {
              id: 'isolated',
              name: 'Classic Demo',
              path: '/tmp/classic-demo',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: 'classic',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          ...snapshot,
          initialChanges: {
            status: 'active',
            items: snapshot.changes.active,
            total: 2,
            nextCursor: null,
          },
        },
      });
    } else if (url.pathname.endsWith('/change')) {
      const source = snapshot.changes.active.find(
        (item) => (item.locator ?? item.id) === url.searchParams.get('changeLocator'),
      )!;
      const response = structuredClone(source);
      detailRequests.push(source.id);
      if (failNextDetail) {
        failNextDetail = false;
        await route.fulfill({ status: 503, json: { error: 'isolated refresh failure' } });
        return;
      }
      if (source.id === heldDetail?.id) {
        const held = heldDetail;
        heldDetail = null;
        held.started();
        await held.gate;
      }
      await route.fulfill({ json: response }).catch(() => undefined);
    } else if (url.pathname.endsWith('/changes')) {
      await route.fulfill({
        json: { status: 'active', items: snapshot.changes.active, total: 2, nextCursor: null },
      });
    } else {
      await route.fulfill({ json: { pages: [] } });
    }
  });
  await page.goto('/');
  const track = page.getByRole('list', { name: 'Classic 生命周期阶段' });
  const title = page.locator('.change-detail .classic-change-title');
  const select = (name: string) =>
    page.locator('.dashboard-change-row').filter({ hasText: name }).click();
  const completionMotion = () => track.locator('[data-motion="success-once"]').count();
  await expect(track.locator('.dashboard-phase-label')).toHaveText([
    '启动',
    '设计',
    '构建',
    '验证',
    '归档',
  ]);
  await expect(track.locator('.is-current')).toContainText('构建阶段');
  await expect(page.locator('.change-detail .ant-card-extra')).toHaveText('构建阶段');
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(track.locator('svg[data-stage="build"]')).toHaveAttribute('data-status', 'idle');
  await expectSvgMotion(track.locator('svg[data-stage="build"]'), false);
  await expect(track.locator('.is-done')).toHaveCount(0);
  await expect(track).toContainText('未确认完成');
  expect(detailRequests).toEqual([change.id]);

  change.phase = 'verify';
  change.verify.result = 'fail';
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-current')).toContainText('验证失败');
  await expect(track.locator('.is-error [data-status-badge="error"]')).toHaveCount(1);
  change.verify.result = 'pending';
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-current')).toContainText('等待验证');
  await expect(track.locator('.is-error')).toHaveCount(0);
  change.verify.result = 'pass';
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-done [data-status-badge="success"]')).toHaveCount(1);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect.poll(completionMotion).toBe(1);
  const pendingSelection = holdDetail(second.id);
  await select(second.displayName);
  await pendingSelection.ready;
  await expect(title).toContainText(change.displayName);
  await expect.poll(completionMotion).toBe(0);
  await expectSvgMotion(track.locator('svg[data-stage="verify"]'), false);
  pendingSelection.release();
  await expect(title).toContainText(second.displayName);
  await select(change.displayName);
  await expect(title).toContainText(change.displayName);
  change.phase = 'build';
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-current')).toContainText('构建阶段');
  await expect(track.locator('.is-done')).toHaveCount(0);

  for (const switchBack of [false, true]) {
    await select(change.displayName);
    await expect(title).toContainText(change.displayName);
    const held = holdDetail();
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await held.ready;
    const oldResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith('/change') &&
        new URL(response.url()).searchParams.get('changeLocator') === (change.locator ?? change.id),
    );
    await select(second.displayName);
    await expect(title).toContainText(second.displayName);
    if (switchBack) {
      change.phase = 'verify';
      change.verify.result = 'pass';
      await select(change.displayName);
      await expect(track.locator('.is-done [data-status-badge="success"]')).toHaveCount(1);
    }
    held.release();
    await oldResponse;
    await expect(page.getByRole('button', { name: '立即刷新', exact: true })).not.toHaveClass(
      /ant-btn-loading/,
    );
    await expect(title).toContainText(switchBack ? change.displayName : second.displayName);
    await expect(track.locator('.is-done')).toHaveCount(switchBack ? 1 : 0);
    await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  }

  const held = holdDetail();
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await held.ready;
  change.phase = 'build';
  change.verify.result = 'pending';
  const requestsBeforeReload = detailRequests.length;
  await page.reload();
  held.release();
  await expect(track.locator('.is-current')).toContainText('构建阶段');
  await expect(track.locator('.is-done')).toHaveCount(0);
  expect(detailRequests.length).toBe(requestsBeforeReload + 1);
  failNextDetail = true;
  const requestsBeforeFailure = detailRequests.length;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(page.getByText('刷新失败：HTTP 503', { exact: true })).toBeVisible();
  await expect(track.locator('.is-current')).toContainText('构建阶段');
  await expect(page.getByRole('button', { name: '立即刷新', exact: true })).not.toHaveClass(
    /ant-btn-loading/,
  );
  expect(detailRequests.length).toBe(requestsBeforeFailure + 1);
});

test('runs stage illustrations only for explicit execution and preserves state identity', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?demo');
  await expect(page.getByRole('list', { name: 'Classic 生命周期阶段' })).toBeVisible();
  // 展示输入隔离在测试中，不给生产投影添加执行字段。
  const demo = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      resolveDir: path.resolve('domains/dashboard/web/src'),
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { WorkflowPhaseTrack } from './phase-progress-indicator.jsx';
        const phases = [['open','启动'],['design','设计'],['build','构建'],['verify','验证'],['archive','归档']];
        const scenarios = {
          执行: ['process', true, 'running', '执行中'],
          等待用户: ['process', false, 'waiting', '等待用户'],
          等待依赖: ['process', false, 'waiting', '等待依赖'],
          暂停: ['process', false, 'running', '已暂停'],
          阻塞: ['error', false, 'blocked', '已阻塞'],
          失败: ['error', false, 'error', '执行失败'],
          完成: ['finish', false, 'success', '已完成'],
          未开始: ['process', false, 'idle', '当前阶段'],
        };
        function Demo() {
          const [scenario, setScenario] = useState('执行');
          const [phase, setPhase] = useState('build');
          const [identity, setIdentity] = useState('first');
          const [, setRevision] = useState(0);
          window.refreshStageFixture = () => flushSync(() => setRevision(value => value + 1));
          const [status, running, iconStatus, label] = scenarios[scenario];
          const statuses = Object.fromEntries(phases.map(([key]) => [key, key === phase ? status : 'wait']));
          const icons = Object.fromEntries(phases.map(([key]) => [key, key === phase ? iconStatus : 'idle']));
          return React.createElement('section', {},
            ...phases.map(([key]) => React.createElement('button', {key, onClick:()=>{setPhase(key);setScenario('执行')}}, '阶段 '+key)),
            ...Object.keys(scenarios).map(name => React.createElement('button', {key:name, onClick:()=>setScenario(name)}, name)),
            React.createElement('button', {onClick:()=>{setIdentity('second');setScenario('完成')}}, '切换已完成变更'),
            React.createElement('button', {onClick:()=>{setIdentity('third');setScenario('等待用户')}}, '切换等待变更'),
            React.createElement(WorkflowPhaseTrack, {key:identity, phases, phaseStatuses:statuses, phaseIconStatuses:icons, currentPhase:phase,
              currentPhaseRunning:running, currentPhaseLabel:label, ariaLabel:'Classic 动效 Demo'}));
        }
        const root = document.createElement('div'); root.id = 'phase-fixture'; document.body.append(root);
        createRoot(root).render(React.createElement(Demo));
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.addStyleTag({
    content:
      '#root {display:none} #phase-fixture {padding:32px} #phase-fixture button {margin:8px}',
  });
  await page.addScriptTag({ content: demo.outputFiles[0].text });
  const fixture = page.locator('#phase-fixture');
  const track = fixture.getByRole('list', { name: 'Classic 动效 Demo' });
  const select = (name: string) => fixture.getByRole('button', { name, exact: true }).click();
  const current = () => track.locator('svg[data-status="running"]');
  await expect(track.locator('.dashboard-phase-label')).toHaveText([
    '启动',
    '设计',
    '构建',
    '验证',
    '归档',
  ]);
  expect(
    await track
      .locator('svg[data-stage]')
      .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('data-stage'))),
  ).toEqual(['launch', 'design', 'build', 'verify', 'archive']);
  for (const phase of ['open', 'design', 'build', 'verify', 'archive']) {
    await select(`阶段 ${phase}`);
    await expect(current()).toHaveCount(1);
    await expectSvgMotion(current(), true);
  }
  await select('阶段 build');
  await expectSvgMotion(current(), true);
  const refresh = await current().evaluate((icon) => {
    const fixtureWindow = window as Window & { refreshStageFixture: () => void };
    const frame = () =>
      Array.from(icon.querySelectorAll('g'), (node) => getComputedStyle(node).transform);
    const before = frame();
    fixtureWindow.refreshStageFixture();
    return {
      same: icon === document.querySelector('#phase-fixture svg[data-status="running"]'),
      before,
      after: frame(),
    };
  });
  expect(refresh.same).toBe(true);
  expect(refresh.after).toEqual(refresh.before);
  await expectSvgMotion(current(), true);
  await page.screenshot({ path: testInfo.outputPath('classic-execution.png') });
  for (const [scenario, status] of [
    ['等待用户', 'waiting'],
    ['等待依赖', 'waiting'],
    ['暂停', 'idle'],
    ['阻塞', 'blocked'],
    ['失败', 'error'],
    ['未开始', 'idle'],
  ]) {
    await select('执行');
    await select(scenario);
    const icon = track.locator('svg[data-stage="build"]');
    await expect(icon).toHaveAttribute('data-status', status);
    await expect(icon).toHaveAttribute('data-motion', 'static');
    await expectSvgMotion(icon, false);
    await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  }
  await expect(track.locator('[aria-label="check"], [aria-label="close"]')).toHaveCount(0);
  await select('阶段 verify');
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(0);
  await select('完成');
  const verify = track.locator('svg[data-stage="verify"]');
  await expect(verify).toHaveAttribute('data-motion', 'success-once');
  const successFrames = await track
    .locator('[data-success-mark="verify"]')
    .evaluate(async (path) => {
      const frames: string[] = [];
      const started = performance.now();
      do {
        frames.push(getComputedStyle(path).strokeDasharray);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      } while (performance.now() - started < 500);
      return frames;
    });
  expect(new Set(successFrames).size).toBeGreaterThan(1);
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(1);
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await expectSvgMotion(verify, false);
  await select('执行');
  await select('完成');
  await expect(verify).toHaveAttribute('data-motion', 'success-once');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await expectSvgMotion(verify, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await select('执行');
  await expectSvgMotion(verify, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await expectSvgMotion(verify, false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(verify).toHaveAttribute('data-motion', 'running');
  await expectSvgMotion(verify, true);
  await select('切换已完成变更');
  await expect(verify).toHaveAttribute('data-status', 'success');
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await expectSvgMotion(verify, false);
  await select('执行');
  await select('切换等待变更');
  await expect(verify).toHaveAttribute('data-status', 'waiting');
  await expect(verify).toHaveAttribute('data-motion', 'static');
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(0);
  await expectSvgMotion(verify, false);
});

test('preserves Native stage meaning and selection while details load', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const phaseWindow = window as Window & { phaseCheckTransitions: string[] };
    phaseWindow.phaseCheckTransitions = [];
    const previous = new WeakMap<Element, string | null>();
    new MutationObserver((records) => {
      for (const { target } of records) {
        if (!(target instanceof SVGSVGElement)) continue;
        const motion = target.getAttribute('data-motion');
        if (motion === 'success-once' && previous.get(target) !== motion)
          phaseWindow.phaseCheckTransitions.push(
            target.closest('.dashboard-phase-item')?.textContent ?? '',
          );
        previous.set(target, motion);
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-motion'],
    });
  });
  const base = {
    status: 'active',
    lifecycleStatus: null as string | null,
    stateVersion: 8,
    verificationResult: 'pending',
    migration: { status: 'none' },
    artifacts: [],
    checks: [],
    history: [],
    blockers: [],
    acceptanceItems: [],
    acceptance: { total: 0, passed: 0, failed: 0, blocked: 0, pending: 0 },
    specs: { total: 0, create: 0, modify: 0, remove: 0, capabilities: [] },
    localExecution: { status: 'idle', reason: 'idle', stage: null as string | null, checks: [] },
  };
  const loop = (stage: string) => ({
    stage,
    goalCycle: 1,
    iteration: 2,
    attempt: 1,
    actor: null,
    nextAction: '隔离验收输入',
  });
  const changes = [
    {
      ...base,
      name: 'waiting-for-user',
      phase: 'verify',
      lifecycleStatus: 'await-user',
      loop: loop('await-user'),
      verificationResult: 'pass',
      localExecution: { ...base.localExecution, status: 'running', stage: 'verifying' },
    },
    {
      ...base,
      name: 'repair-after-verify',
      phase: 'build',
      loop: loop('repairing'),
      verificationResult: 'fail',
    },
    {
      ...base,
      name: 'blocked-verification',
      phase: 'verify',
      lifecycleStatus: 'blocked',
      loop: loop('blocked'),
      localExecution: { ...base.localExecution, status: 'running', stage: 'verifying' },
      blockers: [
        {
          owner: 'verifier',
          reason: { text: '缺少验收证据' },
          acceptanceIds: ['A1'],
          resolutionAction: '补充证据',
        },
      ],
    },
    {
      ...base,
      name: 'running-build',
      phase: 'build',
      loop: loop('building'),
      localExecution: { ...base.localExecution, status: 'running', stage: 'building' },
    },
    {
      ...base,
      name: 'failed-verification',
      phase: 'verify',
      loop: loop('verify-ready'),
      verificationResult: 'fail',
    },
    {
      ...base,
      name: 'interrupted-build',
      phase: 'build',
      loop: loop('building'),
      localExecution: { ...base.localExecution, status: 'interrupted', stage: 'building' },
    },
    { ...base, name: 'rolled-back-shape', phase: 'shape', loop: loop('shape') },
    { ...base, name: 'archived-change', phase: 'archive', status: 'archived', loop: loop('done') },
    {
      ...base,
      name: 'missing-state',
      phase: null,
      loop: null,
      migration: { status: 'invalid', message: '状态不可读' },
    },
  ];
  let releaseRepair!: () => void;
  const repairGate = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });
  const requests: string[] = [];
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/projects')) {
      await route.fulfill({
        json: {
          currentProjectId: 'isolated',
          projects: [
            {
              id: 'isolated',
              name: 'Isolated stage fixtures',
              path: '/tmp/comet-stage-fixtures',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: 'native',
              workflowSource: 'configured',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: {
            name: 'Isolated stage fixtures',
            path: '/tmp/comet-stage-fixtures',
            generatedAt: '2026-10-09T00:00:00.000Z',
          },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          git: null,
          risks: [],
          native: {
            activeChangeCount: changes.length - 1,
            archivedChangeCount: 1,
            totalChangeCount: changes.length,
            changes: [],
          },
        },
      });
    } else if (url.pathname.endsWith('/native-changes')) {
      const status = url.searchParams.get('status');
      const items = changes.filter((change) => status === 'all' || change.status === status);
      await route.fulfill({ json: { status, items, total: items.length, nextCursor: null } });
    } else if (url.pathname.endsWith('/native-change')) {
      const name = url.searchParams.get('changeName')!;
      requests.push(name);
      if (name === 'repair-after-verify') await repairGate;
      await route.fulfill({ json: changes.find((change) => change.name === name) });
    } else if (url.pathname.endsWith('/changes')) {
      await route.fulfill({
        json: { status: url.searchParams.get('status'), items: [], total: 0, nextCursor: null },
      });
    } else {
      await route.fulfill({ json: { pages: [] } });
    }
  });
  await page.goto('/');
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
    'waiting-for-user',
  );
  const track = page.getByRole('list', { name: 'Native 生命周期阶段' });
  const transitions = () =>
    page.evaluate(
      () => (window as Window & { phaseCheckTransitions: string[] }).phaseCheckTransitions,
    );
  await expect(track).toHaveClass(/ant-steps/);
  expect(
    await track
      .locator('svg[data-stage]')
      .evaluateAll((icons) => icons.map((icon) => icon.getAttribute('data-stage'))),
  ).toEqual(['design', 'build', 'verify', 'archive']);
  await expect(track.locator('.is-done')).toHaveCount(2);
  await expect(track.locator('.is-done svg[data-stage]').first()).toHaveAttribute(
    'data-motion',
    'static',
  );
  await expect(track.locator('.is-current')).toContainText('Verify');
  await expect(track.locator('.is-current')).toContainText('等待用户');
  await expect(track.locator('.is-active')).toHaveCount(0);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'waiting');
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(0);
  await expectSvgMotion(track.locator('svg[data-stage="verify"]'), false);
  expect(await transitions()).toEqual([]);
  await page.locator('.native-change-row').filter({ hasText: 'repair-after-verify' }).click();
  await expect.poll(() => requests).toContain('repair-after-verify');
  await expect(page.locator('.native-change-detail h3.text-base')).toHaveCount(0);
  await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
  releaseRepair();
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
    'repair-after-verify',
  );
  await expect(track.locator('.is-current')).toContainText('Build');
  await expect(track.locator('.is-done')).toHaveCount(1);
  await expect(track.locator('.is-error')).toContainText('Verify');
  await expect(track.locator('.is-error [data-status-badge="error"]')).toHaveCount(1);
  await expect(track.locator('.is-pending')).toHaveCount(1);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await page.locator('.native-change-row').filter({ hasText: 'blocked-verification' }).click();
  await expect(track.locator('.is-current')).toContainText('已阻塞');
  await expect(track.locator('.is-active')).toHaveCount(0);
  await expect(track.locator('.is-current')).toHaveClass(/is-error/);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(page.locator('.change-guidance')).toContainText('缺少验收证据');
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'blocked');
  await expectSvgMotion(track.locator('svg[data-stage="verify"]'), false);

  await page.locator('.native-change-row').filter({ hasText: 'failed-verification' }).click();
  await expect(track.locator('.is-current')).toHaveClass(/is-error/);
  await expect(track.locator('.is-current')).toContainText('Verify');
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'error');
  await expectSvgMotion(track.locator('svg[data-stage="verify"]'), false);
  await page.locator('.native-change-row').filter({ hasText: 'interrupted-build' }).click();
  await expect(track.locator('.is-current')).toHaveClass(/is-error/);
  await expect(track.locator('.is-current')).toContainText('执行中断');
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(track.locator('svg[data-stage="build"]')).toHaveAttribute('data-status', 'blocked');
  await page.locator('.native-change-row').filter({ hasText: 'rolled-back-shape' }).click();
  await expect(track.locator('.is-current')).toContainText('Shape');
  await expect(track.locator('.is-done')).toHaveCount(0);
  await expect(track.locator('.is-pending')).toHaveCount(3);
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);

  await page.locator('.native-change-row').filter({ hasText: 'running-build' }).click();
  await expect(track.locator('.is-current svg[data-status="running"]')).toHaveCount(1);
  await expect(track.locator('svg[data-status="running"]')).toHaveAttribute(
    'data-motion',
    'running',
  );
  await expectSvgMotion(track.locator('svg[data-status="running"]'), true);
  const sameBuild = await track.locator('svg[data-stage="build"]').elementHandle();
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  expect(
    await track
      .locator('svg[data-stage="build"]')
      .evaluate((icon, previous) => icon === previous, sameBuild),
  ).toBe(true);
  await expectSvgMotion(track.locator('svg[data-status="running"]'), true);
  expect(await transitions()).toEqual([]);
  const running = changes.find((change) => change.name === 'running-build')!;
  running.phase = 'verify';
  running.loop = loop('verify-ready');
  running.verificationResult = 'fail';
  running.localExecution = { ...base.localExecution, status: 'running', stage: 'verifying' };
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-current')).toContainText('Verify');
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'running');
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(0);
  await expect.poll(transitions).toEqual([expect.stringContaining('Build')]);
  await expectSvgMotion(track.locator('svg[data-stage="verify"]'), true);
  await expectSvgMotion(track.locator('svg[data-stage="build"]'), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(track.locator('svg[data-status="running"]')).toHaveAttribute(
    'data-motion',
    'static',
  );
  await expectSvgMotion(track.locator('svg[data-status="running"]'), false);
  running.phase = 'archive';
  running.loop = loop('archive-ready');
  running.verificationResult = 'pass';
  running.localExecution = base.localExecution;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(track.locator('.is-done')).toHaveCount(3);
  await expect(track.locator('.is-current')).toContainText('可归档');
  await expect(track.locator('svg[data-status="running"]')).toHaveCount(0);
  await expect(track.locator('svg[data-stage="archive"]')).toHaveAttribute(
    'data-status',
    'waiting',
  );
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'success');
  expect(await transitions()).toEqual([expect.stringContaining('Build')]);

  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await expect.poll(() => errors).toEqual([]);
  await page.locator('.native-change-row').filter({ hasText: 'archived-change' }).click();
  await expect(track.locator('.is-done')).toHaveCount(4);
  await expect(track.locator('svg[data-stage="verify"]')).toHaveAttribute('data-status', 'idle');
  await expect(track.locator('[data-success-mark="verify"]')).toHaveCount(0);
  await expect(track.locator('.is-current')).toHaveCount(0);
  await page.locator('.native-change-row').filter({ hasText: 'missing-state' }).click();
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText('missing-state');
  await expect(track.locator('.is-done')).toHaveCount(0);
  await expect(track.locator('.is-current')).toHaveCount(0);
  await expect(track.locator('.is-pending')).toHaveCount(4);
  await expect(track.getByRole('button')).toHaveCount(0);
  expect(await transitions()).toEqual([expect.stringContaining('Build')]);
});

test('shares change-detail spacing across workflows, themes, and viewports', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');

  const selectWorkflow = async (workflow: 'Classic' | 'Native') => {
    await page.getByRole('tab', { name: `${workflow} 工作流` }).click();
    const name = workflow === 'Classic' ? 'Classic 生命周期阶段' : 'Native 生命周期阶段';
    const track = page.getByRole('list', { name });
    await expect(track).toBeVisible();
    const detail = page.locator('.dashboard-workspace-center .dashboard-change-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.dashboard-change-detail-meta')).toBeVisible();
    await expect(detail.getByRole('button', { name: '复制 Change 名称' })).toBeVisible();
    await expect(detail.locator('.ant-card-extra')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.dashboard-overview-summary-strip .dashboard-summary-card').evaluateAll(
          (cards) =>
            cards.length === 5 &&
            cards.every((card) => {
              const target = Number(card.getAttribute('aria-label')?.match(/ (\d+) /)?.[1]);
              const displayed = Number(
                card.querySelector('.ant-statistic-content-value')?.textContent?.trim(),
              );
              return Number.isFinite(target) && displayed === target;
            }),
        ),
      )
      .toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() =>
        track.evaluate(
          async (element, count) => {
            const ready = () => {
              const rails = Array.from(
                element.querySelectorAll(
                  '.dashboard-phase-item:not(:last-child) .dashboard-phase-rail',
                ),
              );
              return (
                rails.length === count &&
                rails.every((rail) => rail.getBoundingClientRect().width > 0)
              );
            };
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (!ready()) return false;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            return ready();
          },
          workflow === 'Classic' ? 4 : 3,
        ),
      )
      .toBe(true);
    return detail;
  };

  const measure = async (detail: import('@playwright/test').Locator) =>
    detail.evaluate((element) => {
      const required = (selector: string) => {
        const match = element.querySelector<HTMLElement>(selector);
        if (!match) throw new Error(`Missing detail layout element: ${selector}`);
        return match;
      };
      const bounds = (target: Element) => {
        const rect = target.getBoundingClientRect();
        return {
          x: Math.round(rect.x * 100) / 100,
          y: Math.round(rect.y * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
        };
      };
      const padding = (target: Element) => {
        const style = getComputedStyle(target);
        return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft];
      };
      const head = required('.ant-card-head');
      const body = required('.ant-card-body');
      const title = required('.dashboard-change-detail-title');
      const titleText = required('.classic-change-title, h3.text-base');
      const meta = required('.dashboard-change-detail-meta');
      const extra = required('.ant-card-extra');
      const track = required('.dashboard-phase-track');
      const progress = required('.dashboard-phase-progress');
      const guidance = required('.change-guidance');
      const panels = element.querySelector<HTMLElement>('.change-detail-panels');
      const cards = Array.from(guidance.children);
      const firstCard = cards[0];
      const secondCard = cards[1];
      if (!firstCard || !secondCard) throw new Error('Expected two guidance cards');
      const cardContent = (card: Element) => card.querySelector('.ant-card-body') ?? card;
      const firstContent = cardContent(firstCard);
      const secondContent = cardContent(secondCard);
      const firstBox = bounds(firstCard);
      const secondBox = bounds(secondCard);
      const guidanceGap =
        Math.abs(firstBox.y - secondBox.y) <= 1
          ? secondBox.x - firstBox.right
          : secondBox.y - firstBox.bottom;
      const titleStyle = getComputedStyle(title);
      const titleTextStyle = getComputedStyle(titleText);
      const headStyle = getComputedStyle(head);
      const bodyStyle = getComputedStyle(body);
      const progressStyle = getComputedStyle(progress);
      const guidanceStyle = getComputedStyle(guidance);
      const itemWrapper = track.querySelector<HTMLElement>('.ant-steps-item-wrapper');
      const node = track.querySelector<HTMLElement>('svg[data-stage]');
      const label = track.querySelector<HTMLElement>('.dashboard-phase-label');
      if (!itemWrapper || !node || !label) throw new Error('Missing shared phase-track nodes');
      const nodeBox = bounds(node);
      const region = document.querySelector<HTMLElement>('.dashboard-master-detail');
      const left = document.querySelector<HTMLElement>('.dashboard-workspace-left');
      const center = document.querySelector<HTMLElement>('.dashboard-workspace-center');
      const summary = document.querySelector<HTMLElement>('.dashboard-overview-summary-strip');
      if (!region || !left || !center || !summary)
        throw new Error('Missing master-detail workspace');
      const leftBox = bounds(left);
      const centerBox = bounds(center);
      const detailBox = bounds(element);
      const summaryBox = bounds(summary);
      const regionBox = bounds(region);
      const explorer = document.querySelector<HTMLElement>('.dashboard-changes-explorer');
      if (!explorer) throw new Error('Missing shared Changes Explorer');
      const requireExplorer = (selector: string) => {
        const match = explorer.querySelector<HTMLElement>(selector);
        if (!match) throw new Error(`Missing explorer layout element: ${selector}`);
        return match;
      };
      const explorerHeader = requireExplorer('.ant-card-head, .native-changes-explorer-header');
      const explorerBody = requireExplorer('.ant-card-body, .native-changes-explorer-body');
      const explorerTitle = requireExplorer('.dashboard-explorer-title');
      const badge = requireExplorer('.dashboard-explorer-count .ant-badge-count');
      const badgeDigit = badge.querySelector<HTMLElement>('.ant-scroll-number-only-unit') ?? badge;
      const explorerTabs = requireExplorer('.ant-tabs');
      const explorerTab = explorerTabs.querySelector<HTMLElement>('.ant-tabs-tab');
      const explorerTabButton = explorerTabs.querySelector<HTMLElement>('.ant-tabs-tab-btn');
      const tabsNav = requireExplorer('.ant-tabs-nav');
      const listHost = requireExplorer('.dashboard-change-list, .native-change-list');
      const firstListItem = requireExplorer(
        '.dashboard-change-list-item, .native-change-list-item',
      );
      const firstRow = firstListItem.querySelector<HTMLElement>('.dashboard-explorer-row');
      const firstRowTitle = firstRow?.querySelector<HTMLElement>('.dashboard-explorer-row-name');
      const firstRowCount = firstRow?.querySelector<HTMLElement>('.dashboard-explorer-row-count');
      const firstStatus = firstRow?.querySelector<HTMLElement>('.dashboard-explorer-row-status');
      const firstPill = firstStatus?.querySelector<HTMLElement>('.dashboard-status-pill');
      const selectedFrame = explorer.querySelector<HTMLElement>(
        '.dashboard-explorer-row[aria-pressed="true"]',
      );
      if (
        !explorerTab ||
        !explorerTabButton ||
        !firstRow ||
        !firstRowTitle ||
        !firstRowCount ||
        !firstStatus ||
        !firstPill ||
        !selectedFrame
      ) {
        throw new Error('Missing shared Explorer tab, row, or selected-frame nodes');
      }
      const detailSectionTitles = Array.from(
        element.querySelectorAll<HTMLElement>('.dashboard-detail-section-title'),
      );
      const typography = (target: Element) => {
        const style = getComputedStyle(target);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
        };
      };
      const normalizedFont = (value: string) =>
        value.replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();
      const fontDisplay = getComputedStyle(document.documentElement)
        .getPropertyValue('--font-display')
        .trim();
      const usesDisplayFont = (target: Element) =>
        normalizedFont(getComputedStyle(target).fontFamily) === normalizedFont(fontDisplay);
      const explorerBox = bounds(explorer);
      const explorerHeaderBox = bounds(explorerHeader);
      const explorerTitleBox = bounds(explorerTitle);
      const explorerTabBox = bounds(explorerTab);
      const tabsNavBox = bounds(tabsNav);
      const listHostBox = bounds(listHost);
      const firstRowBox = bounds(firstRow);
      const firstPillBox = bounds(firstPill);
      const firstStatusBox = bounds(firstStatus);
      const firstTitleBox = bounds(firstRowTitle);
      const selectedFrameBox = bounds(selectedFrame);
      const selectedFrameStyle = getComputedStyle(selectedFrame);
      const titleStatusOverlap = firstTitleBox.right > firstStatusBox.x;
      const explorerHeaderStyle = getComputedStyle(explorerHeader);
      const rowCountStyle = getComputedStyle(firstRowCount);
      const selectedWrapper = selectedFrame.closest<HTMLElement>(
        '.dashboard-change-list-item, .native-change-list-item',
      );
      return {
        padding: {
          head: padding(head),
          body: padding(body),
          guidance: [padding(firstContent), padding(secondContent)],
          panels: panels ? Array.from(panels.children).map((panel) => padding(panel)) : [],
        },
        divider: {
          width: headStyle.borderBottomWidth,
          style: headStyle.borderBottomStyle,
          color: headStyle.borderBottomColor,
          headBodyBoundary: Math.round((bounds(body).y - bounds(head).bottom) * 100) / 100,
        },
        title: {
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight,
          statusAlignment: Math.abs(bounds(title).y - bounds(extra).y),
          metaGap: bounds(meta).y - bounds(title).bottom,
          overflows: title.scrollWidth > title.clientWidth || head.scrollWidth > head.clientWidth,
        },
        explorer: {
          background: getComputedStyle(explorer).backgroundColor,
          header: {
            minHeight: explorerHeaderStyle.minHeight,
            height: explorerHeaderBox.height,
            margins: [explorerHeaderStyle.marginTop, explorerHeaderStyle.marginBottom],
            padding: padding(explorerHeader),
            bodyPadding: padding(explorerBody),
            topToTabs: Math.round((tabsNavBox.y - explorerHeaderBox.bottom) * 100) / 100,
          },
          title: {
            ...typography(explorerTitle),
            displayFont: usesDisplayFont(explorerTitle),
            xOffset: Math.round((explorerTitleBox.x - explorerBox.x) * 100) / 100,
          },
          badge: {
            ...typography(badgeDigit),
          },
          tabs: {
            tab: typography(explorerTab),
            button: typography(explorerTabButton),
            padding: padding(explorerTab),
            height: explorerTabBox.height,
            xOffset: Math.round((explorerTabBox.x - explorerBox.x) * 100) / 100,
            navMarginBottom: getComputedStyle(tabsNav).marginBottom,
            toList: Math.round((listHostBox.y - tabsNavBox.bottom) * 100) / 100,
          },
          row: {
            wrapperPadding: firstListItem.matches('.dashboard-change-list-item')
              ? padding(firstListItem)
              : null,
            framePadding: padding(firstRow),
            frameHeight: firstRowBox.height,
            frameXOffset: Math.round((firstRowBox.x - explorerBox.x) * 100) / 100,
            frameTopOffset: Math.round((firstRowBox.y - listHostBox.y) * 100) / 100,
            title: typography(firstRowTitle),
            count: {
              ...typography(firstRowCount),
              marginTop: rowCountStyle.marginTop,
            },
            pill: typography(firstPill),
            pillOverflow: firstPill.scrollWidth > firstPill.clientWidth,
            statusWidth: firstStatusBox.width,
            statusMaxWidth: getComputedStyle(firstStatus).maxWidth,
            titleStatusOverlap,
            radius: getComputedStyle(firstRow).borderRadius,
            wrapperBackground: selectedWrapper
              ? getComputedStyle(selectedWrapper).backgroundColor
              : null,
          },
          selected: {
            padding: padding(selectedFrame),
            boxShadow: selectedFrameStyle.boxShadow,
            background: selectedFrameStyle.backgroundColor,
            radius: selectedFrameStyle.borderRadius,
            x: selectedFrameBox.x,
          },
        },
        textTypography: {
          fontSize: titleTextStyle.fontSize,
          fontWeight: titleTextStyle.fontWeight,
          fontFamily: titleTextStyle.fontFamily,
          lineHeight: titleTextStyle.lineHeight,
          letterSpacing: titleTextStyle.letterSpacing,
        },
        detailSectionTitles: detailSectionTitles.map((heading) => ({
          text: heading.textContent?.trim() ?? '',
          ...typography(heading),
          displayFont: usesDisplayFont(heading),
          margins: [getComputedStyle(heading).marginTop, getComputedStyle(heading).marginBottom],
        })),
        bodyGap: bodyStyle.rowGap,
        progress: {
          gap: progressStyle.rowGap,
          trackTopPadding: getComputedStyle(track).paddingTop,
          trackMargins: [getComputedStyle(track).marginTop, getComputedStyle(track).marginBottom],
          node: [nodeBox.width, nodeBox.height],
          railWidths: Array.from(
            track.querySelectorAll('.dashboard-phase-item:not(:last-child) .dashboard-phase-rail'),
            (rail) => bounds(rail).width,
          ),
          iconGaps: Array.from(track.querySelectorAll('svg[data-stage]'), bounds).flatMap(
            (icon, index, icons) => (index === 0 ? [] : [icon.x - icons[index - 1].right]),
          ),
          labelGap: getComputedStyle(itemWrapper).rowGap,
          labelFontSize: getComputedStyle(label).fontSize,
          labelLineHeight: getComputedStyle(label).lineHeight,
        },
        guidance: {
          columnGap: guidanceStyle.columnGap,
          rowGap: guidanceStyle.rowGap,
          measuredGap: Math.round(guidanceGap * 100) / 100,
          overflow: guidance.scrollWidth > guidance.clientWidth,
        },
        progressToGuidance: Math.round((bounds(guidance).y - bounds(progress).bottom) * 100) / 100,
        phaseCount: track.querySelectorAll('.dashboard-phase-item').length,
        phaseOverflow: track.scrollWidth > track.clientWidth,
        geometry: {
          scrollY: window.scrollY,
          summary: summaryBox,
          left: leftBox,
          center: centerBox,
          detail: detailBox,
          summaryToWorkspace: Math.round((regionBox.y - summaryBox.bottom) * 100) / 100,
          columnsGap: getComputedStyle(region).columnGap,
          rowsGap: getComputedStyle(region).rowGap,
          measuredColumnsGap: Math.round((centerBox.x - leftBox.right) * 100) / 100,
          measuredRowsGap: Math.round((centerBox.y - leftBox.bottom) * 100) / 100,
        },
      };
    });

  for (const theme of ['light', 'dark'] as const) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page
        .getByRole('button', {
          name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
        })
        .click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const detailPadding = width <= 760 ? '16px' : '24px';
      const compact = width <= 760;
      const classic = await selectWorkflow('Classic');
      const classicLayout = await measure(classic);
      expect(classicLayout.padding.panels).toEqual([
        Array(4).fill(detailPadding),
        Array(4).fill(detailPadding),
      ]);
      const classicPanels = classic.locator('.change-detail-panels');
      await expect(classicPanels.locator(':scope > article')).toHaveCount(2);
      await expect(classicPanels.locator('.ant-card')).toHaveCount(0);
      await expect(classicPanels.getByRole('heading', { name: '关键产物' })).toHaveCount(1);
      expect(classicLayout.explorer.row.wrapperPadding).toEqual(Array(4).fill('0px'));
      const native = await selectWorkflow('Native');
      const nativeLayout = await measure(native);

      for (const layout of [classicLayout, nativeLayout]) {
        expect(layout.explorer.background).toBe('rgba(0, 0, 0, 0)');
        expect(layout.explorer.header.minHeight).toBe('40px');
        expect(layout.explorer.header.height).toBeGreaterThanOrEqual(40);
        expect(layout.explorer.header.margins).toEqual(['0px', '0px']);
        expect(layout.explorer.header.padding).toEqual(Array(4).fill('0px'));
        expect(layout.explorer.header.bodyPadding).toEqual(Array(4).fill('0px'));
        expect(layout.explorer.header.topToTabs).toBe(0);
        expect(layout.explorer.title).toMatchObject({
          fontSize: '13px',
          fontWeight: '560',
          lineHeight: '20px',
          letterSpacing: 'normal',
          displayFont: true,
          xOffset: 0,
        });
        expect(layout.explorer.badge).toMatchObject({
          fontSize: '12px',
          lineHeight: '20px',
          letterSpacing: 'normal',
        });
        expect(layout.explorer.tabs.tab).toMatchObject({
          fontSize: '13px',
          lineHeight: '20px',
          letterSpacing: 'normal',
        });
        expect(layout.explorer.tabs.button).toMatchObject({
          fontSize: '13px',
          lineHeight: '20px',
          letterSpacing: 'normal',
        });
        expect(layout.explorer.tabs.padding).toEqual(['8px', '2px', '8px', '2px']);
        expect(layout.explorer.tabs.height).toBe(36);
        expect(layout.explorer.tabs.xOffset).toBe(0);
        expect(layout.explorer.tabs.navMarginBottom).toBe('8px');
        expect(layout.explorer.tabs.toList).toBe(8);
        expect(layout.explorer.row.framePadding).toEqual(['8px', '8px', '8px', '8px']);
        expect(layout.explorer.row.frameHeight).toBe(44);
        expect(layout.explorer.row.frameXOffset).toBeGreaterThanOrEqual(0);
        if (layout === classicLayout) expect(layout.explorer.row.frameXOffset).toBe(0);
        expect(layout.explorer.row.title).toMatchObject({
          fontSize: '13px',
          fontWeight: '500',
          lineHeight: '16px',
          letterSpacing: 'normal',
        });
        expect(layout.explorer.row.count).toMatchObject({
          fontSize: '12px',
          lineHeight: '12px',
          letterSpacing: 'normal',
          marginTop: '0px',
        });
        expect(layout.explorer.row.pill).toMatchObject({
          fontSize: '12px',
          fontWeight: '500',
          lineHeight: '18px',
          letterSpacing: 'normal',
        });
        expect(layout.explorer.row.pillOverflow).toBe(false);
        expect(layout.explorer.row.statusWidth).toBeLessThanOrEqual(84);
        expect(layout.explorer.row.statusMaxWidth).toBe('min(35%, 84px)');
        expect(layout.explorer.row.titleStatusOverlap).toBe(false);
        expect(layout.explorer.row.radius).toBe('0px');
        expect(layout.explorer.row.wrapperBackground).toBe('rgba(0, 0, 0, 0)');
        expect(layout.explorer.selected.padding).toEqual(Array(4).fill('8px'));
        expect(layout.explorer.selected.boxShadow).toContain('inset');
        expect(layout.explorer.selected.background).not.toBe('rgba(0, 0, 0, 0)');
        expect(layout.explorer.selected.radius).toBe('0px');
        expect(layout.explorer.selected.x).toBeGreaterThanOrEqual(layout.geometry.left.x);
        expect(layout.explorer.selected.x).toBeLessThan(
          layout.geometry.left.x + layout.geometry.left.width,
        );
        expect(layout.detailSectionTitles.length).toBeGreaterThan(0);
        for (const heading of layout.detailSectionTitles) {
          expect(heading).toMatchObject({
            fontSize: '14px',
            fontWeight: '560',
            lineHeight: '22px',
            letterSpacing: 'normal',
            displayFont: true,
            margins: ['0px', '0px'],
          });
        }
        expect(layout.padding.head).toEqual(Array(4).fill(detailPadding));
        expect(layout.padding.body).toEqual(Array(4).fill(detailPadding));
        expect(layout.padding.guidance).toEqual([
          Array(4).fill(detailPadding),
          Array(4).fill(detailPadding),
        ]);
        expect(layout.divider.width).toBe('1px');
        expect(layout.divider.style).toBe('solid');
        expect(layout.divider.headBodyBoundary).toBe(0);
        expect(layout.title.fontSize).toBe('16px');
        expect(layout.title.lineHeight).toBe('24px');
        expect(layout.textTypography).toMatchObject({
          fontSize: '16px',
          fontWeight: '600',
          lineHeight: '24px',
          letterSpacing: 'normal',
        });
        expect(layout.title.statusAlignment).toBeLessThanOrEqual(1);
        expect(layout.title.metaGap).toBeGreaterThanOrEqual(0);
        expect(layout.title.overflows).toBe(false);
        expect(layout.bodyGap).toBe('24px');
        expect(layout.progress.gap).toBe('16px');
        expect(layout.progress.trackTopPadding).toBe('28px');
        expect(layout.progress.trackMargins).toEqual(['0px', '0px']);
        const iconSize = width === 1600 ? 72 : 48;
        expect(layout.progress.node).toEqual([iconSize, iconSize]);
        if (width === 390) {
          expect(layout.progress.railWidths).toHaveLength(layout.phaseCount - 1);
          for (const railWidth of layout.progress.railWidths) expect(railWidth).toBeGreaterThan(0);
          expect(layout.progress.iconGaps).toHaveLength(layout.phaseCount - 1);
          for (const gap of layout.progress.iconGaps) expect(gap).toBeGreaterThanOrEqual(0);
        }
        expect(layout.progress.labelGap).toBe('12px');
        expect(layout.progress.labelFontSize).toBe(compact ? '14px' : '18px');
        expect(layout.progress.labelLineHeight).toBe('24px');
        expect(layout.guidance.columnGap).toBe('16px');
        expect(layout.guidance.rowGap).toBe('24px');
        expect(layout.guidance.measuredGap).toBe(compact ? 24 : 16);
        expect(layout.guidance.overflow).toBe(false);
        expect(layout.progressToGuidance).toBe(24);
        expect(layout.phaseOverflow).toBe(false);
        expect(layout.geometry.summaryToWorkspace).toBe(24);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (compact) {
          expect(layout.geometry.left.x).toBeCloseTo(layout.geometry.center.x, 0);
          expect(layout.geometry.measuredRowsGap).toBe(24);
        } else {
          expect(layout.geometry.left.y).toBeCloseTo(layout.geometry.center.y, 0);
          expect(layout.geometry.columnsGap).toBe('24px');
          expect(layout.geometry.measuredColumnsGap).toBe(24);
        }
      }
      expect(classicLayout.phaseCount).toBe(5);
      expect(nativeLayout.phaseCount).toBe(4);
      expect(nativeLayout.explorer.background).toBe(classicLayout.explorer.background);
      expect(nativeLayout.explorer.header.height).toBe(classicLayout.explorer.header.height);
      expect(nativeLayout.explorer.title).toEqual(classicLayout.explorer.title);
      expect(nativeLayout.explorer.badge).toEqual(classicLayout.explorer.badge);
      expect(nativeLayout.explorer.tabs.tab).toEqual(classicLayout.explorer.tabs.tab);
      expect(nativeLayout.explorer.tabs.button).toEqual(classicLayout.explorer.tabs.button);
      expect(nativeLayout.explorer.tabs.padding).toEqual(classicLayout.explorer.tabs.padding);
      expect(nativeLayout.explorer.tabs.toList).toBe(classicLayout.explorer.tabs.toList);
      expect(nativeLayout.explorer.row.framePadding).toEqual(
        classicLayout.explorer.row.framePadding,
      );
      expect(nativeLayout.explorer.row.frameTopOffset).toBe(
        classicLayout.explorer.row.frameTopOffset,
      );
      expect(nativeLayout.explorer.row.title).toEqual(classicLayout.explorer.row.title);
      expect(nativeLayout.explorer.row.count).toEqual(classicLayout.explorer.row.count);
      expect(nativeLayout.explorer.row.pill).toEqual(classicLayout.explorer.row.pill);
      expect(nativeLayout.explorer.selected.boxShadow).toBe(
        classicLayout.explorer.selected.boxShadow,
      );
      expect(nativeLayout.explorer.selected.background).toBe(
        classicLayout.explorer.selected.background,
      );
      expect(nativeLayout.explorer.selected.x).toBeGreaterThanOrEqual(nativeLayout.geometry.left.x);
      expect(nativeLayout.explorer.selected.x).toBeLessThan(
        nativeLayout.geometry.left.x + nativeLayout.geometry.left.width,
      );
      expect(classicLayout.detailSectionTitles.map((heading) => heading.text)).toEqual(
        expect.arrayContaining(['下一步建议', '风险提示', '关键产物', '任务进度']),
      );
      expect(nativeLayout.detailSectionTitles.map((heading) => heading.text)).toContain(
        '下一步建议',
      );
      expect(nativeLayout.textTypography).toEqual(classicLayout.textTypography);
      expect(classicLayout.divider.color).toBe(nativeLayout.divider.color);
      expect(nativeLayout.progress.node).toEqual(classicLayout.progress.node);
      expect(nativeLayout.progress.labelGap).toBe(classicLayout.progress.labelGap);
      expect(nativeLayout.progress.labelFontSize).toBe(classicLayout.progress.labelFontSize);
      expect(nativeLayout.geometry.left.x).toBeCloseTo(classicLayout.geometry.left.x, 0);
      expect(nativeLayout.geometry.left.width).toBeCloseTo(classicLayout.geometry.left.width, 0);
      expect(nativeLayout.geometry.scrollY).toBe(0);
      expect(classicLayout.geometry.scrollY).toBe(0);
      expect(nativeLayout.geometry.center.x).toBeCloseTo(classicLayout.geometry.center.x, 0);
      expect(nativeLayout.geometry.center.width).toBeCloseTo(
        classicLayout.geometry.center.width,
        0,
      );
      expect(nativeLayout.geometry.detail.x).toBeCloseTo(classicLayout.geometry.detail.x, 0);
      expect(nativeLayout.geometry.detail.width).toBeCloseTo(
        classicLayout.geometry.detail.width,
        0,
      );
      await expect(native.locator('.dashboard-phase-note')).toContainText('轮 / 第');
      await expect(native.getByRole('heading', { name: '生命周期阶段' })).toHaveCount(0);
      await expect(
        page.locator('.dashboard-overview-summary-strip .dashboard-summary-card'),
      ).toHaveCount(5);
      await expect(page.locator('.native-child-change-list').first()).toBeVisible();

      if (width === 1600 || (theme === 'light' && width === 390)) {
        await page.screenshot({
          path: testInfo.outputPath(`shared-detail-${theme}-${width}-native.png`),
        });
      }
      const classicAgain = await selectWorkflow('Classic');
      const classicAgainLayout = await measure(classicAgain);
      expect(classicAgainLayout.geometry.detail.x).toBeCloseTo(classicLayout.geometry.detail.x, 0);
      expect(
        classicAgainLayout.geometry.detail.y,
        JSON.stringify({
          initial: classicLayout.geometry,
          returned: classicAgainLayout.geometry,
        }),
      ).toBeCloseTo(classicLayout.geometry.detail.y, 0);
      expect(classicAgainLayout.geometry.detail.width).toBeCloseTo(
        classicLayout.geometry.detail.width,
        0,
      );
      if (width === 1600 || (theme === 'light' && width === 390)) {
        await page.screenshot({
          path: testInfo.outputPath(`shared-detail-${theme}-${width}-classic.png`),
        });
      }
    }
  }
});

test('contains long-title, empty, selected, and animated-count states in both workflows', async ({
  page,
}) => {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  const longTitle = 'share-classic-native-detail-layout-'.repeat(4);
  const classicBase = structuredClone(snapshot.changes.active[0]);
  const classicChanges = [
    {
      ...classicBase,
      id: 'layout-classic-long',
      locator: 'layout-classic-long',
      name: 'layout-classic-long',
      displayName: longTitle,
      tasks: { ...classicBase.tasks, completed: 0, total: 0 },
      artifacts: { ...classicBase.artifacts, tasks: true },
    },
    {
      ...structuredClone(classicBase),
      id: 'layout-classic-selected',
      locator: 'layout-classic-selected',
      name: 'layout-classic-selected',
      displayName: 'selected-classic-detail',
    },
  ];
  const nativeBase = structuredClone(snapshot.native.changes[0]);
  const nativeChanges = [
    {
      ...nativeBase,
      name: longTitle,
      locator: 'layout-native-long',
      children: Array.from({ length: 12 }, (_, index) => ({
        name: `layout-child-${index + 1}`,
        status: index < 10 ? 'done' : 'pending',
        dependsOn: [],
      })),
    },
    {
      ...structuredClone(nativeBase),
      name: 'selected-native-detail',
      locator: 'layout-native-selected',
      children: [],
    },
  ];
  let summaryValues = [classicChanges.length, 0, 0, 0, 0];
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get('q') ?? '').toLowerCase();
    const matches = (change: { name?: string; displayName?: string }) =>
      !query || `${change.name ?? ''} ${change.displayName ?? ''}`.toLowerCase().includes(query);
    if (url.pathname.endsWith('/projects')) {
      await route.fulfill({
        json: {
          currentProjectId: 'layout-fixture',
          projects: [
            {
              id: 'layout-fixture',
              name: 'Layout fixtures',
              path: '/tmp/layout-fixture',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: 'classic',
              workflowSource: 'configured',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      const items = classicChanges.filter(matches);
      await route.fulfill({
        json: {
          project: { name: 'Layout fixtures', path: '/tmp/layout-fixture', generatedAt: null },
          summary: {
            activeChanges: summaryValues[0],
            archivedChanges: summaryValues[1],
            verifyFailed: summaryValues[2],
            tasksIncomplete: summaryValues[3],
            dirtyFiles: summaryValues[4],
          },
          initialChanges: { status: 'active', items, total: items.length, nextCursor: null },
          git: null,
          risks: [],
          native: {
            ...snapshot.native,
            activeChangeCount: summaryValues[0],
            archivedChangeCount: 0,
            totalChangeCount: Math.max(summaryValues[0], nativeChanges.length),
            visibleChangeCount: nativeChanges.length,
            changes: [],
          },
        },
      });
    } else if (url.pathname.endsWith('/native-changes')) {
      const items = nativeChanges.filter(matches);
      await route.fulfill({
        json: {
          status: url.searchParams.get('status'),
          items,
          total: query ? items.length : Math.max(summaryValues[0], items.length),
          nextCursor: null,
        },
      });
    } else if (url.pathname.endsWith('/native-change')) {
      await route.fulfill({
        json: nativeChanges.find((change) => change.name === url.searchParams.get('changeName')),
      });
    } else if (url.pathname.endsWith('/changes')) {
      const items = classicChanges.filter(matches);
      await route.fulfill({
        json: {
          status: url.searchParams.get('status'),
          items,
          total: items.length,
          nextCursor: null,
        },
      });
    } else if (url.pathname.endsWith('/change')) {
      await route.fulfill({
        json: classicChanges.find(
          (change) => (change.locator ?? change.id) === url.searchParams.get('changeLocator'),
        ),
      });
    } else {
      await route.fulfill({ json: { pages: [] } });
    }
  });

  await page.goto('/');
  const classicTitle = page.locator('.dashboard-change-detail-title');
  const search = page.getByPlaceholder('搜索变更、产物或文件…');
  const assertContained = async () => {
    const detail = page.locator('.dashboard-workspace-center .dashboard-change-detail');
    const title = detail.locator('.dashboard-change-detail-title');
    const result = await detail.evaluate((element) => {
      const head = element.querySelector<HTMLElement>('.ant-card-head')!;
      const cardTitle = element.querySelector<HTMLElement>('.dashboard-change-detail-title')!;
      const extra = element.querySelector<HTMLElement>('.ant-card-extra')!;
      const detailRect = element.getBoundingClientRect();
      const titleRect = cardTitle.getBoundingClientRect();
      const extraRect = extra.getBoundingClientRect();
      return {
        horizontalOverflow: element.scrollWidth > element.clientWidth,
        titleOverflow: cardTitle.scrollWidth > cardTitle.clientWidth,
        headOverflow: head.scrollWidth > head.clientWidth,
        titleFullyInside:
          titleRect.left >= head.getBoundingClientRect().left &&
          titleRect.right <= head.getBoundingClientRect().right,
        statusFullyInside:
          extraRect.left >= head.getBoundingClientRect().left &&
          extraRect.right <= head.getBoundingClientRect().right,
        titleHeight: titleRect.height,
        detailWidth: detailRect.width,
      };
    });
    expect(result.horizontalOverflow).toBe(false);
    expect(result.titleOverflow).toBe(false);
    expect(result.headOverflow).toBe(false);
    expect(result.titleFullyInside).toBe(true);
    expect(result.statusFullyInside).toBe(true);
    expect(result.titleHeight).toBeGreaterThan(24);
    expect(result.detailWidth).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(title).toBeVisible();
  };
  const assertExplorerRowContained = async () => {
    const row = page
      .locator('.dashboard-changes-explorer .dashboard-explorer-row')
      .filter({ hasText: longTitle })
      .first();
    await expect(row).toBeVisible();
    const isNativeRow = await row.evaluate((element) =>
      element.classList.contains('native-change-row'),
    );
    await expect(row.locator('.dashboard-explorer-row-count')).toHaveText(
      isNativeRow ? '子变更 10/12' : '任务 0/0',
    );
    const result = await row.evaluate((element) => {
      const name = element.querySelector<HTMLElement>('.dashboard-explorer-row-name');
      const count = element.querySelector<HTMLElement>('.dashboard-explorer-row-count');
      const status = element.querySelector<HTMLElement>('.dashboard-explorer-row-status');
      const pill = status?.querySelector<HTMLElement>('.dashboard-status-pill');
      if (!name || !count || !status || !pill)
        throw new Error('Missing shared row name, count, or status');
      const rowRect = element.getBoundingClientRect();
      const nameRect = name.getBoundingClientRect();
      const statusRect = status.getBoundingClientRect();
      const statusStyle = getComputedStyle(pill);
      const nameStyle = getComputedStyle(name);
      return {
        rowHeight: rowRect.height,
        rowOverflow: element.scrollWidth > element.clientWidth,
        nameWidth: nameRect.width,
        nameOverflow: name.scrollWidth > name.clientWidth,
        nameEllipsis: nameStyle.textOverflow === 'ellipsis' && nameStyle.whiteSpace === 'nowrap',
        countText: count.innerText,
        statusWidth: statusRect.width,
        statusMaxWidth: getComputedStyle(status).maxWidth,
        statusOverflow: pill.scrollWidth > pill.clientWidth,
        statusEllipsis:
          statusStyle.textOverflow === 'ellipsis' && statusStyle.whiteSpace === 'nowrap',
        nameStatusOverlap: nameRect.right > statusRect.left,
        viewportOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(result.rowHeight).toBe(44);
    expect(result.rowOverflow).toBe(false);
    expect(result.nameWidth).toBeGreaterThan(40);
    expect(result.nameOverflow).toBe(true);
    expect(result.nameEllipsis).toBe(true);
    expect(result.countText).toBe(isNativeRow ? '子变更 10/12' : '任务 0/0');
    expect(result.statusWidth).toBeLessThanOrEqual(84);
    expect(result.statusMaxWidth).toBe('min(35%, 84px)');
    expect(result.statusOverflow).toBe(false);
    expect(result.statusEllipsis).toBe(true);
    expect(result.nameStatusOverlap).toBe(false);
    expect(result.viewportOverflow).toBe(false);
    await row.focus();
    await expect(row).toBeFocused();
    await expect(page.getByRole('tooltip')).toContainText(longTitle);
  };
  type SummaryFrame = {
    mode: 'classic' | 'native';
    targets: number[];
    values: number[];
    metricWidths: number[];
    metricMinWidths: string[];
    textAligns: string[];
    summaryHeight: number;
    workspaceY: number;
  };
  const captureSummaryFrames = async () =>
    page.evaluate(() => {
      const targetWindow = window as Window & { __detailSummaryFrames?: unknown[] };
      const frames: unknown[] = [];
      targetWindow.__detailSummaryFrames = frames;
      const capture = () => {
        const cards = Array.from(
          document.querySelectorAll('.dashboard-overview-summary-strip .dashboard-summary-card'),
        );
        const summary = document.querySelector('.dashboard-overview-summary-strip');
        const workspace = document.querySelector('.dashboard-master-detail');
        const activeWorkflow = Array.from(
          document.querySelectorAll('.dashboard-workflow-tabs [role="tab"]'),
        ).find((tab) => tab.getAttribute('aria-selected') === 'true');
        if (cards.length === 5 && summary && workspace) {
          const summaryRect = summary.getBoundingClientRect();
          const workspaceRect = workspace.getBoundingClientRect();
          frames.push({
            mode: activeWorkflow?.textContent?.includes('Native') ? 'native' : 'classic',
            targets: cards.map((card) =>
              Number(card.getAttribute('aria-label')?.match(/ (\d+) /)?.[1]),
            ),
            values: cards.map((card) =>
              Number(
                card
                  .querySelector('.dashboard-summary-metric')
                  ?.textContent?.replaceAll(',', '')
                  .trim(),
              ),
            ),
            metricWidths: cards.map(
              (card) =>
                card.querySelector('.dashboard-summary-metric')?.getBoundingClientRect().width ?? 0,
            ),
            metricMinWidths: cards.map(
              (card) =>
                (card.querySelector('.dashboard-summary-metric') as HTMLElement | null)?.style
                  .minWidth ?? '',
            ),
            textAligns: cards.map(
              (card) =>
                getComputedStyle(card.querySelector('.dashboard-summary-metric')!).textAlign,
            ),
            summaryHeight: Math.round(summaryRect.height * 100) / 100,
            workspaceY: Math.round((workspaceRect.y + window.scrollY) * 100) / 100,
          });
        }
        if (frames.length < 32) window.requestAnimationFrame(capture);
      };
      window.requestAnimationFrame(capture);
    });
  const assertCounterMotion = async (
    target: number,
    mode: 'classic' | 'native',
    trigger: () => Promise<void>,
  ) => {
    await captureSummaryFrames();
    await trigger();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __detailSummaryFrames?: unknown[] }).__detailSummaryFrames
              ?.length,
        ),
      )
      .toBe(32);
    const frames = (await page.evaluate(
      () => (window as Window & { __detailSummaryFrames?: SummaryFrame[] }).__detailSummaryFrames,
    ))!;
    const targetFrames = frames.filter(
      (frame) => frame.mode === mode && frame.targets[0] === target,
    );
    expect(targetFrames.length).toBeGreaterThan(5);
    expect(new Set(targetFrames.map((frame) => frame.values[0])).size).toBeGreaterThan(1);
    expect(targetFrames.at(-1)?.values).toEqual(targetFrames.at(-1)?.targets);
    expect(targetFrames.at(-1)?.values[0]).toBe(target);
    const drift = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(drift(targetFrames.map((frame) => frame.summaryHeight))).toBeLessThanOrEqual(1);
    expect(drift(targetFrames.map((frame) => frame.workspaceY))).toBeLessThanOrEqual(1);
    for (let index = 0; index < 5; index += 1) {
      expect(drift(targetFrames.map((frame) => frame.metricWidths[index]))).toBeLessThanOrEqual(1);
      expect(new Set(targetFrames.map((frame) => frame.metricMinWidths[index])).size).toBe(1);
      expect(targetFrames.at(-1)?.metricMinWidths[index]).toBe(
        `${targetFrames.at(-1)!.targets[index].toLocaleString('en-US').length}ch`,
      );
      expect(targetFrames.at(-1)?.textAligns[index]).toBe('right');
    }
  };
  const nativeTitle = page.locator('.dashboard-change-detail-title');
  for (const theme of ['light', 'dark'] as const) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page
        .getByRole('button', {
          name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
        })
        .click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('tab', { name: 'Classic 工作流' }).click();
      await expect(classicTitle).toContainText(longTitle);
      await expect(page.getByRole('button', { name: '复制 Change 名称' })).toBeVisible();
      await assertContained();
      await assertExplorerRowContained();
      await page
        .locator('.dashboard-change-row')
        .filter({ hasText: 'selected-classic-detail' })
        .click();
      await expect(classicTitle).toContainText('selected-classic-detail');
      await page.locator('.dashboard-change-row').filter({ hasText: longTitle }).click();
      await expect(classicTitle).toContainText(longTitle);
      await search.fill('no-layout-match');
      await expect(page.locator('.dashboard-change-detail-empty')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: '当前范围没有可展示的 Classic change' }),
      ).toBeVisible();
      await expect(
        page.locator('.dashboard-changes-explorer .dashboard-explorer-title'),
      ).toBeVisible();
      await expect(
        page.locator('.dashboard-changes-explorer .ant-tabs-tab-btn').first(),
      ).toBeVisible();
      expect(
        await page
          .locator('.dashboard-changes-explorer')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.reload();
      await expect(classicTitle).toContainText(longTitle);

      await page.getByRole('tab', { name: 'Native 工作流' }).click();
      await expect(nativeTitle).toContainText(longTitle);
      await assertContained();
      await assertExplorerRowContained();
      await page
        .locator('.native-change-row')
        .filter({ hasText: 'selected-native-detail' })
        .click();
      await expect(nativeTitle).toContainText('selected-native-detail');
      await expect(page.locator('.native-child-change-list').first()).toBeVisible();
      await page.locator('.native-change-row').filter({ hasText: longTitle }).click();
      await expect(nativeTitle).toContainText(longTitle);
      await search.fill('no-layout-match');
      await expect(page.locator('.native-change-detail-empty')).toBeVisible();
      await expect(page.getByText('没有匹配的 Native change', { exact: true })).toBeVisible();
      await expect(
        page.locator('.dashboard-changes-explorer .dashboard-explorer-title'),
      ).toBeVisible();
      await expect(
        page.locator('.dashboard-changes-explorer .ant-tabs-tab-btn').first(),
      ).toBeVisible();
      expect(
        await page
          .locator('.dashboard-changes-explorer')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.reload();
    }
  }

  summaryValues = [0, 0, 0, 0, 0];
  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload();
  const readSummaryValues = () =>
    page
      .locator('.dashboard-overview-summary-strip .dashboard-summary-metric')
      .evaluateAll((metrics) =>
        metrics.map((metric) => Number(metric.textContent?.replaceAll(',', '').trim())),
      );
  await expect(
    page.locator('.dashboard-overview-summary-strip .dashboard-summary-card'),
  ).toHaveCount(5);
  await expect.poll(readSummaryValues).toEqual([0, 0, 0, 0, 0]);
  await assertCounterMotion(10, 'classic', async () => {
    summaryValues = [10, 10, 10, 10, 10];
    const response = page.waitForResponse((result) =>
      new URL(result.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await response;
  });
  await expect.poll(readSummaryValues).toEqual([10, 10, 10, 10, 10]);
  await assertCounterMotion(1000, 'classic', async () => {
    summaryValues = [1000, 1000, 1000, 1000, 1000];
    const response = page.waitForResponse((result) =>
      new URL(result.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await response;
  });
  await expect.poll(readSummaryValues).toEqual([1000, 1000, 1000, 1000, 1000]);
  await assertCounterMotion(1000, 'native', async () => {
    await page.getByRole('tab', { name: 'Native 工作流' }).click();
    await expect(page.getByRole('list', { name: 'Native 生命周期阶段' })).toBeVisible();
  });
});

test('keeps long explorer names, statuses, and counts readable from keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo');
  const name = 'a-very-long-change-name-that-must-remain-available-in-the-tooltip-'.repeat(2);
  const status = '等待多个上游子变更完成后继续执行并重新验证'.repeat(2);
  const workspace = {
    label: 'native/feature-worktree',
    branch: 'feature/long-name',
    current: false,
  };
  const fixture = await build({
    absWorkingDir: process.cwd(),
    stdin: {
      resolveDir: path.resolve('domains/dashboard/web/src'),
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { DashboardExplorerRowContent, DashboardExplorerRowTooltip } from './workspace-layout.jsx';
        const name = ${JSON.stringify(name)};
        const status = ${JSON.stringify(status)};
        const workspace = ${JSON.stringify(workspace)};
        function Fixture() {
          const [selected, setSelected] = useState(false);
          return React.createElement('div', { className: 'dashboard-changes-explorer' },
            React.createElement(DashboardExplorerRowTooltip, { name, status, workspace },
              React.createElement('button', {
                type: 'button',
                className: 'dashboard-explorer-row',
                'aria-pressed': selected,
                onClick: () => setSelected(true),
              }, React.createElement(DashboardExplorerRowContent, {
                name,
                count: React.createElement(React.Fragment, null, '任务 123456/789012'),
                status: React.createElement('span', { className: 'dashboard-status-pill' },
                  React.createElement('span', null, status)),
              })),
            ),
          );
        }
        const container = document.createElement('div');
        container.id = 'explorer-row-fixture';
        document.body.append(container);
        createRoot(container).render(React.createElement(Fixture));
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.addStyleTag({
    content:
      '#explorer-row-fixture { position: fixed; z-index: 10000; top: 320px; left: 32px; width: 260px; }',
  });
  await page.addScriptTag({ content: fixture.outputFiles[0].text });

  const row = page.locator('#explorer-row-fixture .dashboard-explorer-row');
  await expect(row).toHaveCount(1);
  const metrics = await row.evaluate((element) => {
    const nameNode = element.querySelector<HTMLElement>('.dashboard-explorer-row-name')!;
    const countNode = element.querySelector<HTMLElement>('.dashboard-explorer-row-count')!;
    const statusNode = element.querySelector<HTMLElement>('.dashboard-explorer-row-status')!;
    const pill = statusNode.querySelector<HTMLElement>('.dashboard-status-pill')!;
    const text = pill.querySelector<HTMLElement>('span')!;
    const nameBox = nameNode.getBoundingClientRect();
    const statusBox = statusNode.getBoundingClientRect();
    return {
      height: element.getBoundingClientRect().height,
      radius: getComputedStyle(element).borderRadius,
      rowOverflow: element.scrollWidth > element.clientWidth,
      nameOverflow: nameNode.scrollWidth > nameNode.clientWidth,
      nameEllipsis: getComputedStyle(nameNode).textOverflow,
      countText: countNode.innerText,
      statusWidth: statusBox.width,
      statusMaxWidth: getComputedStyle(statusNode).maxWidth,
      statusOverflow: text.scrollWidth > text.clientWidth,
      statusEllipsis: getComputedStyle(text).textOverflow,
      nameStatusOverlap: nameBox.right > statusBox.left,
    };
  });
  expect(metrics).toMatchObject({
    height: 44,
    radius: '0px',
    rowOverflow: false,
    nameOverflow: true,
    nameEllipsis: 'ellipsis',
    countText: '任务 123456/789012',
    statusMaxWidth: 'min(35%, 84px)',
    statusOverflow: true,
    statusEllipsis: 'ellipsis',
    nameStatusOverlap: false,
  });
  expect(metrics.statusWidth).toBeLessThanOrEqual(84);
  await row.focus();
  await expect(row).toBeFocused();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText(name);
  await expect(tooltip).toContainText(status);
  await expect(tooltip).toContainText(workspace.label);
  await expect(tooltip).toContainText(workspace.branch);
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('places explorer tooltips beside wide layouts and above stacked layouts after resize', async ({
  page,
}) => {
  await page.goto('/?demo');
  for (const workflow of ['Classic', 'Native']) {
    const tab = page.getByRole('tab', { name: `${workflow} 工作流` });
    await tab.click();
    const row = page.locator('.dashboard-changes-explorer .dashboard-explorer-row').first();
    await expect(row).toBeVisible();
    const name = await row.locator('.dashboard-explorer-row-name').innerText();
    for (const width of [1600, 1200, 761, 760, 761]) {
      await page.setViewportSize({ width, height: 900 });
      const stacked = width <= 760;
      await expect
        .poll(() =>
          page
            .locator('.dashboard-master-detail')
            .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
        )
        .toBe(stacked ? 1 : 2);
      for (const trigger of ['hover', 'focus']) {
        await row.scrollIntoViewIfNeeded();
        if (trigger === 'hover') await row.hover();
        else await row.focus();
        const popup = page.locator('.ant-tooltip:visible');
        await expect(popup).toContainText(name);
        await expect(popup).toHaveClass(
          new RegExp(`ant-tooltip-placement-${stacked ? 'top' : 'right'}(?:\\s|$)`),
        );
        await expect(popup).toHaveCSS('pointer-events', 'none');
        await expect
          .poll(async () => {
            const rowBox = (await row.boundingBox())!;
            const tooltipBox = (await popup.boundingBox())!;
            return stacked
              ? tooltipBox.y + tooltipBox.height <= rowBox.y + 1
              : tooltipBox.x >= rowBox.x + rowBox.width - 1;
          })
          .toBe(true);
        await page.mouse.move(0, 0);
        await tab.focus();
        await expect(popup).toHaveCount(0);
      }
    }
  }
});
