import { test, expect } from '@playwright/test';
import { readApplicationDemo } from '../../../domains/dashboard/web/src/application-demo.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskApplication } from '../../helpers/workflow-application.js';

test('Any distribution and export use the real local backend in isolated directories', async ({
  page,
}) => {
  test.setTimeout(120000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-any-delivery-browser-'));
  const previous = process.env.COMET_DATA_DIR;
  const previousUser = process.env.COMET_USER_DATA_ROOT;
  process.env.COMET_DATA_DIR = path.join(root, 'data');
  process.env.COMET_USER_DATA_ROOT = path.join(root, 'user');
  const project = path.join(root, 'source'),
    consumer = path.join(root, 'consumer');
  await fs.mkdir(project);
  await fs.mkdir(consumer);
  const source = await createDiskApplication(project);
  await fs.cp(source.skillRoot, path.join(source.packageRoot, 'skills/writer'), {
    recursive: true,
  });
  source.manifest.skills[0].root = 'skills/writer';
  await fs.writeFile(source.file, JSON.stringify(source.manifest));
  const { loadWorkflowApplication } =
    await import('../../../domains/workflow-application/index.js');
  const { createRuntime } = await import('../../../domains/engine/runtime.js');
  const application = await loadWorkflowApplication({
    file: source.file,
    projectRoot: project,
    runId: 'browser-delivery',
  });
  await createRuntime({ ...application.implementation, store: application.store }).start({
    runId: 'browser-delivery',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'Delivery' },
  });
  const { startDashboardServer } = await import('../../../domains/dashboard/server.js');
  const server = await startDashboardServer({
    projectPath: project,
    port: 0,
    webRoot: path.resolve('dist/domains/dashboard/web'),
  });
  try {
    await page.goto(server.url);
    await page.getByRole('menuitem', { name: 'Comet Any' }).click();
    await page.getByRole('button', { name: '分发 / 导出' }).click();
    const dialog = page.getByRole('dialog', { name: '分发 / 导出应用' });
    await dialog.getByLabel('目标根目录').fill(consumer);
    await dialog.getByRole('button', { name: '预览安装' }).click();
    await expect(dialog).toContainText(path.join(consumer, '.agents/skills/editorial'));
    expect(await fs.readdir(consumer)).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await dialog.getByRole('button', { name: '确认安装' }).click();
    await expect(dialog).toContainText('分发完成');
    expect(
      await fs.readFile(path.join(consumer, '.agents/skills/writer/scripts/run.mjs'), 'utf8'),
    ).toContain('JSON.parse');
    await dialog.getByText('导出到目录', { exact: true }).click();
    const destination = path.join(root, 'export');
    await dialog.getByLabel('导出目录').fill(destination);
    await dialog.getByRole('button', { name: '预览导出' }).click();
    await expect(dialog).toContainText(destination);
    await dialog.getByRole('button', { name: '确认导出' }).click();
    await expect(dialog).toContainText('导出完成');
    expect(await fs.readFile(path.join(destination, 'application.json'), 'utf8')).toContain(
      'editorial',
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.COMET_DATA_DIR;
    else process.env.COMET_DATA_DIR = previous;
    if (previousUser === undefined) delete process.env.COMET_USER_DATA_ROOT;
    else process.env.COMET_USER_DATA_ROOT = previousUser;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Any delivery previews targets before installation and invalidates previews when options change', async ({
  page,
}) => {
  const calls: any[] = [];
  const list = readApplicationDemo('application-runs', {});
  await page.route('**/api/dashboard/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (url.pathname.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture' },
          summary: {},
          initialChanges: { items: [], total: 0 },
          git: {},
        },
      });
    if (url.pathname.endsWith('/application-runs')) return route.fulfill({ json: list });
    if (url.pathname.endsWith('/application-run')) {
      const detail = readApplicationDemo('application-run', {
        locator: url.searchParams.get('locator'),
      });
      detail.status = 'delivered';
      return route.fulfill({ json: detail });
    }
    if (url.pathname.endsWith('/application-delivery')) {
      if (request.method() === 'GET')
        return route.fulfill({
          json: {
            projectRoot: '/fixture',
            platforms: [
              { id: 'codex', name: 'Codex' },
              { id: 'cursor', name: 'Cursor' },
            ],
          },
        });
      const body = request.postDataJSON();
      calls.push(body);
      if (body.action === 'preview-install')
        return route.fulfill({
          json: {
            id: 'grill-suite',
            version: '1.2.0',
            operation: 'install',
            confirmationHash: 'preview-hash',
            target: `${body.targetDirectory}/.comet/applications`,
            files: ['application.json', 'SKILL.md'],
            platforms: [
              { id: 'codex', name: 'Codex', skillsRoot: `${body.targetDirectory}/.agents/skills` },
            ],
            hostSkills: [
              {
                name: 'grill-suite',
                root: `${body.targetDirectory}/.agents/skills/grill-suite`,
                operation: 'create',
                kind: 'entry',
              },
            ],
            hostIntegration: [
              {
                platformId: 'codex',
                files: [
                  {
                    role: 'rule',
                    path: `${body.targetDirectory}/.codex/rules/workflow.md`,
                    operation: 'create',
                  },
                ],
              },
            ],
            requiredCapabilities: ['skill-script'],
            evaluation: { status: 'not-recorded' },
          },
        });
      return route.fulfill({
        json: { file: '/consumer/.comet/applications/grill-suite/application.json' },
      });
    }
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page.getByRole('button', { name: '分发 / 导出' }).click();
  const dialog = page.getByRole('dialog', { name: '分发 / 导出应用' });
  await expect(dialog.getByRole('button', { name: '确认安装' })).toHaveCount(0);
  await dialog.getByLabel('目标根目录').fill('/consumer');
  await dialog.getByRole('button', { name: '预览安装' }).click();
  await expect(dialog).toContainText('/consumer/.agents/skills/grill-suite');
  await expect(dialog).toContainText('/consumer/.codex/rules/workflow.md');
  expect(calls.map((c) => c.action)).toEqual(['preview-install']);
  await dialog.getByLabel('目标根目录').fill('/another');
  await expect(dialog.getByRole('button', { name: '确认安装' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '预览安装' }).click();
  await dialog.getByRole('button', { name: '确认安装' }).click();
  expect(calls.at(-1)).toMatchObject({
    action: 'install',
    targetDirectory: '/another',
    confirmationHash: 'preview-hash',
  });
  await expect(dialog).toContainText('分发完成');
});

test('Any delivery demo shows destination controls without making delivery API requests', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('application-delivery')) requests++;
  });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page.getByText('应用运行', { exact: true }).last().click();
  await page.getByRole('button', { name: '分发 / 导出' }).click();
  const dialog = page.getByRole('dialog', { name: '分发 / 导出应用' });
  await expect(dialog).toContainText('示例预览');
  await expect(dialog.getByRole('button', { name: '预览安装' })).toBeDisabled();
  await dialog.getByText('导出到目录', { exact: true }).click();
  await expect(dialog.getByLabel('导出目录')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '预览导出' })).toBeDisabled();
  expect(requests).toBe(0);
});

test('a cloned historical archive exposes its original chain and readonly Eval report', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-archive-browser-'));
  const previous = process.env.COMET_USER_DATA_ROOT;
  process.env.COMET_USER_DATA_ROOT = path.join(root, 'user');
  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, 'eval/archives'), { recursive: true });
  await fs.cp(
    path.resolve('eval/archives/grill-test-20261013'),
    path.join(project, 'eval/archives/grill-test-20261013'),
    { recursive: true },
  );
  const { startDashboardServer } = await import('../../../domains/dashboard/server.js');
  const server = await startDashboardServer({
    projectPath: project,
    port: 0,
    webRoot: path.resolve('dist/domains/dashboard/web'),
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    page.setDefaultTimeout(20_000);
    await page.goto(server.url);
    await page.getByRole('menuitem', { name: 'Comet Any' }).click();
    await expect(page.locator('.any-run-header')).toContainText('历史实验 · 只读');
    await expect(page.getByRole('button', { name: '复制只读检查上下文' })).toHaveCount(0);
    await page.getByText('应用运行', { exact: true }).last().click();
    await page.getByRole('tab', { name: '执行记录', exact: true }).click();
    await page.locator('.any-history').getByRole('button', { name: /grill/ }).click();
    await page.getByRole('button', { name: '进入子流程' }).click();
    await expect(page.getByRole('button', { name: '返回父运行' })).toBeVisible();
    await page.getByRole('button', { name: '返回父运行' }).click();
    await page.getByRole('tab', { name: '版本与证据', exact: true }).click();
    await page.getByRole('button', { name: '进入 Eval 详情' }).click();
    await expect(page.locator('.dashboard-eval-detail')).toContainText('历史实验 · 只读');
    await expect(page.locator('.dashboard-eval-detail')).toContainText('完整应用 Eval 未执行');
    await expect(page.getByRole('button', { name: '修改配置后重新评估' })).toHaveCount(0);
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await page.getByRole('menuitem', { name: '预览 专项复核报告' }).click();
    await expect(page.getByRole('dialog')).toContainText('业务成功不等于完整应用 Eval 通过');
    await page.screenshot({
      path: test.info().outputPath('archive-report.png'),
      fullPage: true,
      animations: 'disabled',
      timeout: 20_000,
    });
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('archive-narrow.png'),
      fullPage: true,
      animations: 'disabled',
      timeout: 20_000,
    });
  } finally {
    await page.close();
    await server.close();
    if (previous === undefined) delete process.env.COMET_USER_DATA_ROOT;
    else process.env.COMET_USER_DATA_ROOT = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Any preserves pinned runs, child navigation and historical selection through refresh failures', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copiedAnyContext = JSON.parse(value);
        },
      },
    });
  });
  let revision = 24,
    fail = false,
    writes = 0;
  const list = readApplicationDemo('application-runs', {});
  const parent = list.items.find((r: any) => r.runId === 'run-128')!;
  await page.route('**/api/dashboard/**', async (route) => {
    if (route.request().method() === 'POST') writes++;
    const url = new URL(route.request().url()),
      pathname = url.pathname;
    if (pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (pathname.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture' },
          summary: { activeChanges: 0, archivedChanges: 0 },
          initialChanges: { items: [], total: 0 },
          git: {},
          native: null,
        },
      });
    if (pathname.endsWith('/plugins')) return route.fulfill({ json: { pages: [] } });
    if (pathname.endsWith('/application-runs'))
      return route.fulfill({ json: { ...list, fingerprint: String(revision) } });
    if (pathname.endsWith('/application-run')) {
      if (fail)
        return route.fulfill({
          status: 503,
          json: { code: 'APPLICATION_SOURCE_UNAVAILABLE', error: 'fixture source unavailable' },
        });
      const detail = readApplicationDemo('application-run', {
        locator: url.searchParams.get('locator'),
      });
      detail.revision = revision;
      if (revision > 24 && detail.runId === 'run-128') {
        const regression = detail.records.find((r: any) => r.id === 'regression')!;
        regression.status = 'succeeded';
        regression.active = false;
        detail.currentIds = detail.currentIds.filter((id: string) => id !== 'regression');
      }
      return route.fulfill({ json: detail });
    }
    if (pathname.endsWith('/application-run-artifact'))
      return route.fulfill({
        json: readApplicationDemo('application-run-artifact', {
          locator: url.searchParams.get('locator'),
        }),
      });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.getByRole('region', { name: 'Comet Any 工作区' })).toBeVisible();
  const workspaceScroll = page.locator('[data-dashboard-scroll="workspace"]');
  await expect(page.getByRole('heading', { name: 'Comet Any', exact: true })).toHaveCount(0);
  await expect(page.locator('.any-current')).toContainText('确认安装');
  expect(
    await page.locator('.any-current').evaluate((element) => element.getBoundingClientRect().top),
  ).toBeLessThan(450);
  await expect(page.locator('.any-run-context')).not.toContainText('增加独立审查与恢复路径。');
  await page.getByRole('button', { name: '目标与运行信息' }).click();
  await expect(page.locator('.any-run-context')).toContainText('增加独立审查与恢复路径。');
  await page.getByRole('button', { name: '目标与运行信息' }).click();
  await expect(page.locator('.any-inspector')).toContainText('用户决定');
  await page.locator('.any-inspector').getByRole('button', { name: '运行标识与原始记录' }).click();
  await expect(page.locator('.any-inspector pre').last()).toContainText('user_decision');
  await page.locator('.any-inspector').getByRole('button', { name: '运行标识与原始记录' }).click();
  await page.getByRole('button', { name: '复制只读检查上下文' }).click();
  await expect(page.getByRole('dialog')).toContainText('先读取最新 Run');
  expect(await page.evaluate(() => (window as any).copiedAnyContext.runId)).toBe('creator-041');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByText('应用运行', { exact: true }).last().click();
  await expect(page.locator('.any-version')).toHaveText('v1.1.0');
  await expect(page.locator('.any-current-counts')).toContainText('2 项执行中');
  await page
    .locator('.any-active-list')
    .getByRole('button', { name: /独立审查子流程/ })
    .click();
  await workspaceScroll.evaluate((element) => element.scrollTo({ top: 160, behavior: 'instant' }));
  await page.getByRole('button', { name: '进入子流程' }).scrollIntoViewIfNeeded();
  const enterChild = page.getByRole('button', { name: '进入子流程' });
  // click 可能为按钮自动滚动；在 React 导航前记录用户实际离开的位置。
  await enterChild.evaluate((button) => {
    button.addEventListener(
      'click',
      () => {
        const workspace = document.querySelector('[data-dashboard-scroll="workspace"]')!;
        workspace.setAttribute('data-parent-scroll', String(workspace.scrollTop));
      },
      { capture: true, once: true },
    );
  });
  await enterChild.click();
  const parentScroll = Number(await workspaceScroll.getAttribute('data-parent-scroll'));
  expect(parentScroll).toBeGreaterThan(0);
  await expect(page.locator('.any-current')).toContainText('1 项等待证据');
  await page.getByRole('button', { name: '返回父运行' }).click();
  await expect(page.locator('.any-inspector h3')).toHaveText('独立审查子流程');
  await expect
    .poll(() =>
      workspaceScroll.evaluate(
        (element, saved) => Math.abs(element.scrollTop - saved),
        parentScroll,
      ),
    )
    .toBeLessThanOrEqual(1);
  await workspaceScroll.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '回到当前工作' }).click();
  await expect(page.locator('.any-step-row.selected')).toContainText('确认文档发布范围');
  await expect
    .poll(() =>
      page.locator('.any-step-row.selected').evaluate((element) => {
        const pane = element
          .closest('[data-dashboard-scroll="workspace"]')!
          .getBoundingClientRect();
        const record = element.getBoundingClientRect();
        return record.top >= pane.top && record.bottom <= pane.bottom;
      }),
    )
    .toBe(true);
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await page
    .locator('.any-history')
    .getByRole('button', { name: /追问与记录决定/ })
    .click();
  await expect(page.locator('.any-inspector h3')).toHaveText('追问与记录决定');
  await expect(page.locator('.any-history')).toContainText('交给 Agent 执行');
  await page.locator('.any-filter-line').getByRole('button', { name: '需关注' }).click();
  await page.locator('.any-stat-strip').getByRole('button', { name: /应用/ }).click();
  await page.getByRole('textbox', { name: '搜索目标或应用' }).fill('grill');
  await page.getByRole('button', { name: '目标与运行信息' }).click();
  await expect
    .poll(() =>
      page
        .locator('.any-run-context')
        .evaluate((element) =>
          element
            .getAnimations({ subtree: true })
            .some((animation) => animation.playState === 'running'),
        ),
    )
    .toBe(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await workspaceScroll.evaluate((element) => element.scrollTo({ top: 220, behavior: 'instant' }));
  await expect
    .poll(() => workspaceScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const readingScroll = await workspaceScroll.evaluate((element) => element.scrollTop);
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.getByRole('tab', { name: '执行记录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.any-inspector h3')).toHaveText('追问与记录决定');
  await expect(page.locator('.any-filter-line button.selected')).toHaveText('需关注');
  await expect(page.locator('.any-stat-strip button.selected')).toContainText('应用');
  await expect(page.getByRole('textbox', { name: '搜索目标或应用' })).toHaveValue('grill');
  await expect(page.getByRole('button', { name: '目标与运行信息' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(() =>
      workspaceScroll.evaluate(
        (element, saved) => Math.abs(element.scrollTop - saved),
        readingScroll,
      ),
    )
    .toBeLessThanOrEqual(1);
  revision = 25;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(page.locator('.any-follow-bar')).toContainText('有新进展');
  await expect(page.getByRole('tab', { name: '执行记录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.any-inspector h3')).toHaveText('追问与记录决定');
  fail = true;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(page.locator('.any-sync-line')).toContainText('刷新失败');
  await expect(page.locator('.any-inspector h3')).toHaveText('追问与记录决定');
  fail = false;
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(page.locator('.any-sync-line')).not.toContainText('刷新失败');
  await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Execution records', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.locator('.comet-language-switch').getByText('中文', { exact: true }).click();
  await page.getByRole('tab', { name: '产物', exact: true }).click();
  const artifactRow = page.locator('.any-artifact-list > button').first();
  const layout = await artifactRow.evaluate((row) => {
    const [icon, copy, arrow] = Array.from(row.children).map((child) =>
      child.getBoundingClientRect(),
    );
    return {
      iconWidth: icon.width,
      textGap: copy.left - icon.right,
      arrowInset: row.getBoundingClientRect().right - arrow.right,
    };
  });
  expect(layout.iconWidth).toBeLessThanOrEqual(24);
  expect(layout.textGap).toBeLessThanOrEqual(16);
  expect(layout.arrowInset).toBeLessThanOrEqual(16);
  await page.locator('.any-artifact-list').getByRole('button').first().click();
  await expect(page.locator('.dashboard-artifact-preview-panel h2')).not.toBeEmpty();
  await expect(page.locator('.dashboard-artifact-preview-panel')).toContainText('example');
  await expect(page.locator('.dashboard-artifact-preview-panel')).not.toContainText(
    '当前服务未返回全文内容',
  );
  await page.getByRole('button', { name: '产物预览背景', exact: true }).click();
  expect(writes).toBe(0);
  expect(parent.application.version).toBe('1.1.0');
});

test('Any early creation and the mobile inspector remain usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo');
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page.locator('.any-app-row').filter({ hasText: '让发布说明自动附带证据' }).click();
  await expect(page.locator('.any-version-line')).toContainText('尚未生成');
  await page.locator('.any-active-list').getByRole('button').click();
  await expect(page.getByRole('dialog', { name: '步骤与验证详情' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('理解目标与调查 Skills');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('Any transitions preserve the reading surface on refresh and respect reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    (window as any).dashboardMotionCalls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      if (this.hasAttribute('data-dashboard-motion'))
        (window as any).dashboardMotionCalls.push(this.getAttribute('data-dashboard-motion'));
      return animate.apply(this, args);
    };
  });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.locator('.any-tabs')).toBeVisible();
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await expect(page.locator('.any-history')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).dashboardMotionCalls.filter((kind: string) => kind === 'tab').length,
      ),
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.locator('.any-tab-content').evaluate((element) => element.getAnimations().length),
    )
    .toBe(0);
  const count = await page.evaluate(() => (window as any).dashboardMotionCalls.length);
  const history = page.locator('.any-history');
  await history.evaluate((element) => {
    (window as any).readingSurface = element;
  });
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(history).toBeVisible();
  expect(await history.evaluate((element) => element === (window as any).readingSurface)).toBe(
    true,
  );
  expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab', { name: '步骤', exact: true }).click();
  await expect(page.getByRole('tab', { name: '步骤', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
  expect(
    await page.locator('.any-tab-content').evaluate((element) => element.getAnimations().length),
  ).toBe(0);
});

test('Any self-source links retain detail and Eval returns to the originating evidence tab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const list = readApplicationDemo('application-runs', {});
  let reads = 0;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (path.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture' },
          summary: { activeChanges: 0, archivedChanges: 0 },
          initialChanges: { items: [], total: 0 },
          git: {},
          native: null,
        },
      });
    if (path.endsWith('/plugins')) return route.fulfill({ json: { pages: [] } });
    if (path.endsWith('/application-runs')) return route.fulfill({ json: list });
    if (path.endsWith('/application-run')) {
      reads++;
      const detail = readApplicationDemo('application-run', {
        locator: url.searchParams.get('locator'),
      });
      detail.sourceCreators = [{ locator: detail.locator, runId: detail.runId }];
      detail.evidence[1].evalRunId = 'linked-eval';
      return route.fulfill({ json: detail });
    }
    if (path.includes('/eval/'))
      return route.fulfill({ status: 503, json: { error: 'fixture eval unavailable' } });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.locator('.any-current')).toContainText('确认安装');
  await page.getByRole('tab', { name: '版本与证据' }).click();
  const before = reads;
  await page.getByRole('button', { name: /查看对应创作/ }).click();
  await expect(page.locator('.any-current')).toContainText('确认安装');
  await expect(page.getByRole('tab', { name: '步骤', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(reads).toBe(before);
  await page.getByRole('tab', { name: '版本与证据' }).click();
  const origin = await page.evaluate(() => window.history.state.cometDashboard);
  await page.getByRole('button', { name: '进入 Eval 详情' }).click();
  await expect(page.getByRole('button', { name: '返回 Comet Any' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '返回 Comet Any' }).click();
  await expect(page.locator('.any-current')).toContainText('确认安装');
  await expect(page.getByRole('tab', { name: '版本与证据' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await page.evaluate(() => window.history.state.cometDashboard)).toEqual(origin);
});

test('Any ignores a delayed old search page after the new search has loaded', async ({ page }) => {
  const demoList = readApplicationDemo('application-runs', {});
  const base = demoList.items.find((item: any) => item.applicationId)!;
  const item = (id: string) => ({
    ...base,
    locator: id,
    applicationId: id,
    application: { ...base.application, id },
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(String(input), location.href);
      if (url.pathname.endsWith('/application-runs') && url.searchParams.has('cursor')) {
        (window as any).oldPaginationStarted = true;
        init?.signal?.addEventListener('abort', () => {
          (window as any).oldPaginationAborted = true;
        });
        // 模拟已经接收响应、取消后仍完成的传输，验证状态层也拒绝旧结果。
        return new Promise((resolve) => {
          (window as any).releaseOldPagination = (body: unknown) =>
            resolve(new Response(JSON.stringify(body), { status: 200 }));
        });
      }
      return originalFetch(input, init);
    };
  });
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (url.pathname.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture' },
          summary: {},
          initialChanges: { items: [], total: 0 },
          git: {},
        },
      });
    if (url.pathname.endsWith('/application-runs')) {
      const fresh = url.searchParams.get('q') === 'new';
      return route.fulfill({
        json: {
          ...demoList,
          fingerprint: fresh ? 'new' : 'old',
          items: [item(fresh ? 'new-only' : 'old-first')],
          total: fresh ? 1 : 2,
          nextCursor: fresh ? null : 'old-next',
        },
      });
    }
    if (url.pathname.endsWith('/application-run')) {
      const detail = readApplicationDemo('application-run', { locator: base.locator });
      return route.fulfill({ json: { ...detail, locator: url.searchParams.get('locator') } });
    }
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.locator('.any-app-row')).toContainText(['old-first']);
  await page.getByRole('button', { name: '加载更多记录', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).oldPaginationStarted)).toBe(true);
  await page.getByPlaceholder('搜索目标或应用…').fill('new');
  await expect(page.locator('.any-app-row')).toContainText(['new-only']);
  await expect.poll(() => page.evaluate(() => (window as any).oldPaginationAborted)).toBe(true);
  await page.evaluate((late) => (window as any).releaseOldPagination(late), {
    ...demoList,
    fingerprint: 'old',
    items: [item('old-second')],
    total: 2,
    nextCursor: null,
  });
  await expect(page.locator('.any-app-row')).toHaveCount(1);
  await expect(page.locator('.any-app-row')).toContainText(['new-only']);
  await expect(page.getByRole('button', { name: '加载更多记录', exact: true })).toHaveCount(0);
});

test('Any bounds history pages and preserves selection when a cursor becomes stale', async ({
  page,
}) => {
  const list = readApplicationDemo('application-runs', {});
  const selected = list.items[0];
  const original = readApplicationDemo('application-run', { locator: selected.locator });
  const record = original.records[0];
  const first = { ...record, id: 'bounded-first', active: false };
  let detailLimit: string | null = null;
  let historyRequests = 0;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (url.pathname.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture' },
          summary: {},
          initialChanges: { items: [], total: 0 },
          git: {},
        },
      });
    if (url.pathname.endsWith('/application-runs'))
      return route.fulfill({ json: { ...list, items: [selected], total: 1, nextCursor: null } });
    if (url.pathname.endsWith('/application-run')) {
      detailLimit = url.searchParams.get('recordLimit');
      return route.fulfill({
        json: {
          ...original,
          records: [first],
          currentIds: [],
          recordPage: { total: 80, nextCursor: 'page-two' },
        },
      });
    }
    if (url.pathname.endsWith('/application-run-records')) {
      historyRequests++;
      if (historyRequests > 1)
        return route.fulfill({
          status: 409,
          json: { code: 'STALE_APPLICATION_CURSOR', error: '运行记录已变化，请重新读取当前页' },
        });
      return route.fulfill({
        json: {
          locator: selected.locator,
          revision: original.revision,
          items: [{ ...record, id: 'bounded-second', active: false }],
          artifacts: [],
          total: 80,
          nextCursor: 'page-three',
        },
      });
    }
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await expect.poll(() => detailLimit).toBe('40');
  await page.locator('[data-record-id="bounded-first"]').click();
  await page.getByRole('button', { name: '加载更多执行记录', exact: true }).click();
  await expect(page.locator('[data-record-id="bounded-second"]')).toBeVisible();
  await page.getByRole('button', { name: '加载更多执行记录', exact: true }).click();
  await expect(page.locator('[data-record-id="bounded-first"]')).toHaveClass(/selected/u);
  await expect(page.getByText('运行记录已变化，请重新读取当前页')).toBeVisible();
});
