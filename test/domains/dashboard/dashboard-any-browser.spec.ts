import { test, expect } from '@playwright/test';
import { readApplicationDemo } from '../../../domains/dashboard/web/src/application-demo.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskApplication } from '../../helpers/workflow-application.js';

test('Any retains full creation stages and delivered versions separately from custom workflow runs', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(
    page.getByRole('list', { name: '创作阶段', exact: true }).getByRole('listitem'),
  ).toHaveCount(6);
  await expect(page.locator('.any-current')).toContainText('确认创作方案');
  await expect(page.locator('.any-creator-roster>button')).toHaveCount(2);
  await expect(page.getByRole('region', { name: '应用运行记录', exact: true })).toHaveCount(0);
  await expect(page.locator('.any-creation-sidebar')).toContainText('v1.1.0');
  await page.getByRole('tab', { name: '方案与产物', exact: true }).click();
  await expect(page.locator('.any-artifact-list>button')).toHaveCount(1);
  await page.getByRole('tab', { name: '创作流程', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('any-creation-workflow.png'),
    animations: 'disabled',
  });
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  const previous = page
    .getByRole('region', { name: '应用运行记录', exact: true })
    .getByRole('button', { name: /^run-127/u });
  await previous.click();
  await expect(page.locator('.any-run-identity')).toContainText('run-127');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.locator('.any-run-identity')).toContainText('creator-041');
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.locator('.any-run-identity')).toContainText('run-127');
});

for (const width of [1600, 1280, 390]) {
  test(`Any creation workflow fits English dark 125% at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem('comet-dashboard-language', 'en');
      localStorage.setItem('comet-theme', 'dark');
      localStorage.setItem('comet-dashboard-font-scale', '125');
    });
    await page.goto('/?demo');
    if (width === 390)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Comet Any' }).click();
    await expect(
      page.getByRole('list', { name: 'Creation stages', exact: true }).getByRole('listitem'),
    ).toHaveCount(6);
    await page.getByRole('button', { name: 'Expand all stages', exact: true }).click();
    await expect(page.locator('.any-flow-node')).toHaveCount(11);
    expect(
      await page.getByRole('region', { name: 'Comet Any workspace', exact: true }).innerText(),
    ).not.toMatch(/\p{Script=Han}/u);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const card of await page.locator('.any-app-row').all()) {
      const bounds = await card.boundingBox();
      for (const tag of await card.locator('.ant-tag').all()) {
        if (!(await tag.isVisible())) continue;
        const rect = await tag.boundingBox();
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`any-creation-en-dark-${width}.png`),
      animations: 'disabled',
    });
    await page
      .locator('.any-creator-roster')
      .getByRole('button', { name: /creator-040/u })
      .click();
    await expect(page.getByRole('list', { name: 'Creation stages', exact: true })).toContainText(
      'Skipped',
    );
    expect(
      await page.getByRole('region', { name: 'Comet Any workspace', exact: true }).innerText(),
    ).not.toMatch(/\p{Script=Han}/u);
  });
}

test('Any retries run discovery and pages older runs without replacing the current trace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const list = readApplicationDemo('application-runs', {});
  const current = list.items.find((item: any) => item.runId === 'run-128')!;
  const previous = list.items.find((item: any) => item.runId === 'run-127')!;
  let rosterReads = 0;
  const limits: string[] = [];
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
      if (!url.searchParams.has('applicationId'))
        return route.fulfill({ json: { ...list, items: [current], total: 1, nextCursor: null } });
      rosterReads++;
      limits.push(url.searchParams.get('limit')!);
      if (rosterReads === 1)
        return route.fulfill({ status: 503, json: { error: 'history temporarily unavailable' } });
      const older = url.searchParams.get('cursor') === 'older';
      return route.fulfill({
        json: {
          ...list,
          fingerprint: 'run-history',
          items: [older ? previous : current],
          total: 2,
          nextCursor: older ? null : 'older',
        },
      });
    }
    if (url.pathname.endsWith('/application-run'))
      return route.fulfill({
        json: readApplicationDemo('application-run', { locator: url.searchParams.get('locator') }),
      });
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  const runs = page.getByRole('region', { name: '应用运行记录', exact: true });
  await expect(runs).toContainText('历史运行读取失败');
  await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-128');
  await runs.getByRole('button', { name: '重新读取运行列表', exact: true }).click();
  await runs.getByRole('button', { name: '加载更多历史记录', exact: true }).click();
  await expect(runs.getByRole('button', { name: /^run-127/u })).toBeVisible();
  await expect(runs.getByRole('button', { name: /^run-128/u })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await runs.getByRole('button', { name: /^run-127/u }).click();
  await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-127');
  await expect(
    page.getByRole('list', { name: '应用阶段', exact: true }).locator('.is-done'),
  ).toHaveCount(4);
  expect(limits.length).toBeGreaterThanOrEqual(3);
  expect(limits.every((limit) => limit === '100')).toBe(true);
});

for (const width of [1600, 390]) {
  test(`Any lists independent runs and keeps child workflows under their parent at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?demo');
    if (width === 390) await page.getByRole('button', { name: '打开导航' }).click();
    await page.getByRole('menuitem', { name: '自定义工作流' }).click();
    const runs = page.getByRole('region', { name: '应用运行记录', exact: true });
    await expect(runs.locator('.any-run-list > [role="listitem"]')).toHaveCount(2);
    const current = runs.getByRole('button', { name: /^run-128/u });
    const previous = runs.getByRole('button', { name: /^run-127/u });
    await expect(current).toHaveAttribute('aria-pressed', 'true');
    await previous.click();
    await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-127');
    await expect(
      page.getByRole('list', { name: '应用阶段', exact: true }).locator('.is-done'),
    ).toHaveCount(4);
    await expect(previous).toHaveAttribute('aria-pressed', 'true');
    await current.click();
    await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-128');
    await expect(
      page.getByRole('list', { name: '应用阶段', exact: true }).locator('.is-done'),
    ).toHaveCount(1);
    await runs.locator('.any-run-children > summary').click();
    await runs.getByRole('button', { name: /^review-022/u }).click();
    await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 review-022');
    await expect(page.locator('.any-current')).toContainText('等待证据');
    await page.getByRole('button', { name: /返回父运行$/u }).click();
    await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-128');
    await expect(current).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`independent-runs-${width}.png`),
      animations: 'disabled',
    });
  });
}

test('custom workflow A shows each step once and preserves path details in the drawer', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  const graph = page.getByLabel('运行流程图', { exact: true });
  await expect(graph.locator('[data-step-id]')).toHaveCount(6);
  await expect(graph.locator('[data-step-id="deliver"]')).toHaveCount(1);
  await expect(graph.locator('.application-graph-edges>path')).toHaveCount(9);
  await graph.locator('[data-step-id="interview"]>.any-step-row').click();
  const drawer = page.getByRole('dialog', { name: '步骤与验证详情', exact: true });
  await expect(drawer.locator('.any-flow-connections')).toContainText('同时启动');
  await expect(drawer.locator('.any-flow-connections button')).toHaveCount(4);
  await page.screenshot({
    path: testInfo.outputPath('custom-workflow-A.png'),
    animations: 'disabled',
  });
});

for (const width of [1600, 1280, 390]) {
  test(`Any demo phase navigation and Eval setting rows fit English dark 125% at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => {
      localStorage.setItem('comet-dashboard-language', 'en');
      localStorage.setItem('comet-theme', 'dark');
      localStorage.setItem('comet-dashboard-font-scale', '125');
    });
    await page.goto('/?demo');
    if (width === 390)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Custom workflows' }).click();
    const flow = page.getByLabel('Full workflow', { exact: true });
    await expect(
      page.getByRole('region', { name: 'Application run records', exact: true }),
    ).toBeVisible();
    const phases = flow.getByRole('list', { name: 'Application stages', exact: true });
    await expect(phases.getByRole('listitem')).toHaveCount(4);
    await expect(phases.locator('.is-done')).toHaveCount(1);
    await flow.getByRole('button', { name: 'Workflow notes', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toContainText('Unstarted branches are not failures');
    await expect(flow.locator('.any-flow-connections')).toHaveCount(0);
    await expect(flow.locator('[data-step-id="regression"] [data-record-id]')).toHaveCount(1);
    if (width >= 1280) {
      const compactStep = await flow.locator('[data-step-id="interview"]').boundingBox();
      expect(compactStep!.height).toBeLessThan(210);
    }
    await phases.getByRole('button', { name: 'Delivery Upcoming', exact: true }).click();
    await expect(flow.locator('[data-step-id="deliver"]')).toBeAttached();
    await expect(flow.locator('[data-step-id="deliver"]')).toContainText('Not started');
    await page
      .getByRole('dialog', { name: 'Step and verification details', exact: true })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await phases.scrollIntoViewIfNeeded();
    expect(
      await page.getByRole('region', { name: 'Custom workflow workspace' }).innerText(),
    ).not.toMatch(/\p{Script=Han}/u);
    await page.screenshot({
      path: testInfo.outputPath(`any-phases-en-dark-${width}.png`),
      animations: 'disabled',
    });
    if (width === 390)
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page
      .locator('.dashboard-settings-navigation')
      .getByRole('menuitem', { name: /Eval/ })
      .click();
    const settings = page.locator('.dashboard-eval-settings');
    await expect(settings.locator('.ant-card')).toHaveCount(0);
    const fields = settings.locator('.dashboard-eval-setting-row .ant-form-item-control');
    const bounds = await fields.first().boundingBox();
    expect(bounds!.width).toBeGreaterThan(150);
    expect(
      await settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`eval-rows-en-dark-${width}.png`),
      animations: 'disabled',
    });
  });
}

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
  await page
    .locator('.any-creator-roster')
    .getByRole('button', { name: /creator-040/u })
    .click();
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
    await page.getByRole('menuitem', { name: '自定义工作流' }).click();
    await expect(page.locator('.any-run-header')).toContainText('历史实验 · 只读');
    await expect(page.getByRole('button', { name: '复制只读检查上下文' })).toHaveCount(0);
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
    await test.step('close archive browser context', () => page.context().close());
    await test.step('close archive HTTP server', () => server.close());
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
  await expect(page.locator('.any-current')).toContainText('确认创作方案');
  await page.locator('.any-active-list').getByRole('button').click();
  const inspector = page.getByRole('dialog', { name: '步骤与验证详情', exact: true });
  await expect(inspector).toContainText('用户决定');
  await inspector.getByRole('button', { name: '运行标识与原始记录' }).click();
  await expect(inspector.locator('pre').last()).toContainText('user_decision');
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '复制只读检查上下文' }).click();
  const context = page.getByRole('dialog', { name: '已复制只读检查上下文', exact: true });
  await expect(context).toContainText('先读取最新 Run');
  expect(await page.evaluate(() => (window as any).copiedAnyContext.runId)).toBe('creator-041');
  await context.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.locator('.any-current-counts')).toContainText('2 项执行中');
  await page.locator('[data-step-id="review"]>.any-step-row').click();
  await inspector.getByRole('button', { name: '进入子流程' }).click();
  await expect(page.locator('.any-current')).toContainText('1 项等待证据');
  await page.getByRole('button', { name: '返回父运行' }).click();
  await expect(page.locator('.any-run-identity')).toContainText('run-128');
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await page
    .locator('.any-history')
    .getByRole('button', { name: /追问与记录决定/u })
    .click();
  await expect(inspector.locator('h3').first()).toHaveText('追问与记录决定');
  await inspector.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.any-filter-line').getByRole('button', { name: '需关注' }).click();
  await page.getByRole('textbox', { name: '搜索目标或应用' }).fill('grill');
  await expect(page.locator('.any-history>button.selected')).toContainText('追问与记录决定');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.getByRole('tab', { name: '执行记录', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.any-history>button.selected')).toContainText('追问与记录决定');
  revision++;
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.locator('.any-follow-bar')).toContainText('有新进展');
  await expect(page.locator('.any-history>button.selected')).toContainText('追问与记录决定');
  fail = true;
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.locator('.any-sync-line')).toContainText('刷新失败');
  await expect(page.locator('.any-history>button.selected')).toContainText('追问与记录决定');
  fail = false;
  revision++;
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(page.locator('.any-sync-line')).not.toContainText('刷新失败');
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
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
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
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.locator('.any-current-counts')).toContainText('1 项等待确认');
  await page.getByRole('tab', { name: '版本与证据' }).click();
  const before = reads;
  await page.getByRole('button', { name: /查看对应创作/ }).click();
  await expect(page.locator('.any-current-counts')).toContainText('1 项等待确认');
  await expect(page.getByRole('tab', { name: '步骤', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(reads).toBe(before);
  await page.getByRole('tab', { name: '版本与证据' }).click();
  const origin = await page.evaluate(() => window.history.state.cometDashboard);
  await page.getByRole('button', { name: '进入 Eval 详情' }).click();
  await expect(page.getByRole('button', { name: '返回自定义工作流' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '返回自定义工作流' }).click();
  await expect(page.locator('.any-current-counts')).toContainText('1 项等待确认');
  await expect(page.getByRole('tab', { name: '版本与证据' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await page.evaluate(() => window.history.state.cometDashboard)).toEqual(origin);
});

test('Any completes an in-flight Run read while discovery is still indexing', async ({ page }) => {
  let finished = 0;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/projects'))
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
      return route.fulfill({
        json: { ...readApplicationDemo('application-runs', {}), indexing: true },
      });
    if (url.pathname.endsWith('/application-run')) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route
        .fulfill({
          json: readApplicationDemo('application-run', {
            locator: url.searchParams.get('locator'),
          }),
        })
        .catch(() => {});
      finished++;
      return;
    }
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.getByRole('tab', { name: '步骤', exact: true })).toBeVisible({ timeout: 6500 });
  expect(finished).toBeGreaterThan(0);
});

test('Any pages mixed creation and application records with the same query', async ({ page }) => {
  const list = readApplicationDemo('application-runs', {});
  const base = list.items.find((item: any) => item.kind === 'creator')!;
  const item = (index: number) => ({
    ...base,
    locator: `creation-${index}`,
    applicationId: `application-${index}`,
    application: { ...base.application, id: `application-${index}` },
  });
  const kinds: (string | null)[] = [];
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
      if (url.searchParams.has('applicationId'))
        return route.fulfill({ json: { ...list, items: [], nextCursor: null } });
      kinds.push(url.searchParams.get('kind'));
      const more = url.searchParams.has('cursor');
      if (more && url.searchParams.get('kind') !== 'all')
        return route.fulfill({
          status: 409,
          json: { error: 'Query changed', code: 'STALE_APPLICATION_CURSOR' },
        });
      return route.fulfill({
        json: {
          ...list,
          fingerprint: 'mixed-list',
          items: more ? [item(100)] : Array.from({ length: 100 }, (_, index) => item(index)),
          total: 101,
          nextCursor: more ? null : 'mixed-next',
        },
      });
    }
    if (url.pathname.endsWith('/application-run'))
      return route.fulfill({
        json: {
          ...readApplicationDemo('application-run', { locator: base.locator }),
          locator: url.searchParams.get('locator'),
        },
      });
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await expect(page.locator('.any-app-row')).toHaveCount(100);
  await page.getByRole('button', { name: '加载更多记录', exact: true }).click();
  await expect(page.locator('.any-app-row')).toHaveCount(101, { timeout: 3000 });
  expect(kinds).toEqual(['all', 'all']);
});

test('Any ignores a delayed old search page after the new search has loaded', async ({ page }) => {
  const demoList = readApplicationDemo('application-runs', {});
  const base = demoList.items.find((item: any) => item.kind === 'application')!;
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
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
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
  const selected = list.items.find((item: { kind: string }) => item.kind === 'application')!;
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
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await expect.poll(() => detailLimit).toBe('40');
  await page.locator('.any-history [data-record-id="bounded-first"]').click();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page
    .getByRole('region', { name: '自定义工作流工作区', exact: true })
    .getByRole('button', { name: '加载更多执行记录', exact: true })
    .click();
  await expect(page.locator('.any-history [data-record-id="bounded-second"]')).toBeVisible();
  const loadMore = page
    .getByRole('region', { name: '自定义工作流工作区', exact: true })
    .getByRole('button', { name: /加载更多执行记录$/u });
  await expect(loadMore).not.toHaveClass(/ant-btn-loading/u);
  await loadMore.click();
  await expect(page.locator('.any-history [data-record-id="bounded-first"]')).toHaveClass(
    /selected/u,
  );
  await expect(page.getByText('运行记录已变化，请重新读取当前页')).toBeVisible();
});

for (const width of [1600, 1280, 390]) {
  test(`Any complete workflow exposes pending paths and real concurrent records at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const list = readApplicationDemo('application-runs', {});
    const selected = list.items.find((item: any) => item.kind === 'application' && !item.isChild);
    const original = readApplicationDemo('application-run', { locator: selected.locator });
    const records = [
      {
        ...original.records[0],
        id: 'draft-old',
        stepId: 'draft',
        title: '撰写稿件',
        status: 'succeeded',
        active: false,
        data: {
          outcome: {
            attempt: 1,
            status: 'succeeded',
            output: { article: { words: 1260, approved: false } },
          },
        },
      },
      {
        ...original.records[1],
        id: 'draft-a',
        stepId: 'draft',
        title: '撰写稿件',
        active: true,
        sequence: 8,
      },
      {
        ...original.records[1],
        id: 'draft-b',
        stepId: 'draft',
        title: '撰写稿件',
        status: 'unknown',
        active: true,
        sequence: 9,
      },
    ];
    const pagedRecord = {
      ...original.records[0],
      id: 'check-paged',
      stepId: 'check',
      title: '内容校验',
      active: false,
    };
    let requestedRecord: string | null = null;
    const definition = {
      status: 'available',
      title: '内容创作与审查',
      description: '并行检查、人工确认和修订循环。',
      workflow: {
        id: 'editorial',
        version: '1',
        entry: ['draft'],
        maxTransitions: 100,
        dynamicRouting: false,
        commands: { cleanup: { stepId: 'discard' } },
        steps: {
          draft: { type: 'invoke_skill', ref: 'writer' },
          check: { type: 'call_tool', ref: 'check' },
          review: { type: 'child_workflow', workflow: { id: 'review', version: '1' } },
          publish: { type: 'ask_user', join: ['check', 'review'], choices: ['approved', 'revise'] },
          discard: { type: 'call_tool', ref: 'discard' },
        },
        transitions: [
          { from: 'draft', to: 'check', on: 'succeeded' },
          { from: 'draft', to: 'review', on: 'succeeded' },
          { from: 'check', to: 'publish', on: 'succeeded' },
          { from: 'review', to: 'publish', on: 'succeeded' },
          { from: 'publish', to: 'draft', on: 'revise' },
          { from: 'publish', to: 'discard', on: 'rejected' },
        ],
      },
      steps: [
        {
          stepId: 'draft',
          title: '撰写稿件',
          phase: '创作',
          type: 'invoke_skill',
          skills: ['writer'],
          observation: 'action',
          recordCount: 3,
          activeRecordIds: ['draft-a', 'draft-b'],
          latestRecordId: 'draft-b',
          latestStatus: 'unknown',
          outputFields: [
            { path: 'article.words', label: '字数' },
            { path: 'article.approved', label: '已批准' },
          ],
        },
        {
          stepId: 'check',
          title: '内容校验',
          phase: '审查',
          type: 'call_tool',
          skills: [],
          observation: 'action',
          recordCount: 4,
          activeRecordIds: [],
          latestRecordId: 'check-paged',
          latestStatus: 'succeeded',
        },
        {
          stepId: 'review',
          title: '独立审查',
          phase: '审查',
          type: 'child_workflow',
          skills: [],
          observation: 'subworkflow',
          recordCount: 0,
          activeRecordIds: [],
          latestRecordId: null,
          latestStatus: null,
        },
        {
          stepId: 'publish',
          title: '确认发布范围和最终内容',
          phase: '交付',
          type: 'ask_user',
          skills: [],
          observation: 'action',
          recordCount: 0,
          activeRecordIds: [],
          latestRecordId: null,
          latestStatus: null,
          description: '发布前确认这次内容和交付路径。',
          outputFields: [{ path: 'report.ref', label: '发布清单' }],
          artifactContract: {
            workflowId: 'editorial',
            stepId: 'publish',
            artifacts: [
              { ref: 'output/release.md', nonEmpty: true, requiredHeadings: ['发布清单'] },
            ],
          },
        },
        {
          stepId: 'discard',
          title: '清理未采用内容',
          phase: '交付',
          type: 'call_tool',
          skills: [],
          observation: 'action',
          recordCount: 0,
          activeRecordIds: [],
          latestRecordId: null,
          latestStatus: null,
        },
      ],
    };
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
        return route.fulfill({
          json: { ...list, items: [selected], total: 1, nextCursor: null },
        });
      if (url.pathname.endsWith('/application-run')) {
        requestedRecord = url.searchParams.get('recordId');
        return route.fulfill({
          json: {
            ...original,
            definition,
            records: requestedRecord === 'check-paged' ? [...records, pagedRecord] : records,
            currentIds: ['draft-a', 'draft-b'],
            recordPage: { total: 7, nextCursor: 'more' },
          },
        });
      }
      return route.fulfill({ json: { items: [], pages: [] } });
    });
    await page.goto('/');
    if (width === 390) await page.getByRole('button', { name: '打开导航' }).click();
    await page.getByRole('menuitem', { name: '自定义工作流' }).click();
    const flow = page.getByLabel('完整流程', { exact: true });
    const phases = flow.getByRole('list', { name: '应用阶段', exact: true });
    await expect(phases.getByRole('listitem')).toHaveCount(3);
    await expect(phases.locator('.is-done')).toHaveCount(0);
    await expect(
      phases.getByRole('button', { name: '创作 结果待核对', exact: true }),
    ).toBeVisible();
    await expect(phases.getByRole('button', { name: '审查 部分完成', exact: true })).toBeVisible();
    await expect(flow.locator('[data-step-id]')).toHaveCount(5);
    await expect(flow.locator('[data-step-id="draft"] [data-record-id]')).toHaveCount(2);
    await expect(flow.locator('[data-record-id="draft-a"]')).toContainText('执行中');
    await expect(flow.locator('[data-record-id="draft-b"]')).toContainText('结果待核对');
    await phases.getByRole('button', { name: '交付 待进行', exact: true }).click();
    const inspector = page.getByRole('dialog', { name: '步骤与验证详情', exact: true });
    await expect(inspector).toContainText('预期产物');
    await expect(inspector).toContainText('output/release.md');
    await expect(inspector).toContainText('预期输出字段');
    await expect(inspector).toContainText('report.ref');
    await expect(inspector).toContainText('汇合依赖：内容校验 · 独立审查');
    await expect(inspector).toContainText('循环路径');
    await page.screenshot({
      path: testInfo.outputPath(`workflow-definition-${width}.png`),
      animations: 'disabled',
    });
    await inspector.getByRole('button', { name: '关闭', exact: true }).click();
    await flow.locator('[data-step-id="discard"]>.any-step-row').click();
    await expect(inspector).toContainText('命令入口：cleanup');
    await inspector.getByRole('button', { name: '关闭', exact: true }).click();
    await flow.locator('[data-step-id="check"]>.any-step-row').click();
    await expect.poll(() => requestedRecord).toBe('check-paged');
    await expect(inspector).toContainText('已完成');
    await inspector.getByRole('button', { name: '关闭', exact: true }).click();
    await flow.locator('[data-step-id="draft"]>.any-step-row').click();
    await expect(inspector.locator('.any-flow-connections')).toContainText('同时启动');
    await inspector.locator('[data-record-id="draft-old"]').click();
    await expect(inspector).toContainText('业务结果');
    await expect(inspector).toContainText('1260');
    await expect(inspector).toContainText('false');
    await expect(inspector).toContainText('内部操作只有拆成步骤或子流程后才能逐项展示');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`workflow-output-${width}.png`),
      animations: 'disabled',
      fullPage: width === 1600,
    });
  });
}

test('custom workflow remains navigable at the 4096-step definition limit', async ({
  page,
}, testInfo) => {
  const list = readApplicationDemo('application-runs', {});
  const selected = list.items.find((item: any) => item.runId === 'run-128')!;
  const original = readApplicationDemo('application-run', { locator: selected.locator });
  const count = 4096;
  const steps = Array.from({ length: count }, (_, i) => ({
    stepId: `step-${i}`,
    title: `Scale step ${i}`,
    phase: 'Scale workflow',
    type: 'call_tool',
    recordCount: 0,
    activeRecordIds: [],
    latestRecordId: null,
    latestStatus: null,
  }));
  const definition = {
    status: 'available',
    title: 'Scale workflow',
    steps,
    workflow: {
      id: 'scale',
      version: '1',
      entry: ['step-0'],
      steps: Object.fromEntries(
        steps.map((step) => [step.stepId, { type: step.type, ref: 'scale-tool' }]),
      ),
      transitions: steps
        .slice(1)
        .map((step, i) => ({ from: `step-${i}`, to: step.stepId, on: 'succeeded' })),
    },
  };
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.addInitScript(() => {
    (window as any).scaleLongTasks = [];
    new PerformanceObserver((list) =>
      (window as any).scaleLongTasks.push(...list.getEntries().map((entry) => entry.duration)),
    ).observe({ type: 'longtask', buffered: true });
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
    if (url.pathname.endsWith('/application-runs'))
      return route.fulfill({ json: { ...list, items: [selected], total: 1, nextCursor: null } });
    if (url.pathname.endsWith('/application-run'))
      return route.fulfill({
        json: {
          ...original,
          definition,
          records: [],
          currentIds: [],
          recordPage: { total: 0, nextCursor: null },
        },
      });
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  const start = performance.now();
  await page.getByRole('menuitem', { name: '自定义工作流' }).click();
  await expect(page.locator('.application-graph-layer .any-flow-node')).toHaveCount(count);
  await expect(page.locator('.application-graph-edges > path')).toHaveCount(count - 1);
  const graphMs = Math.round(performance.now() - start);
  await page.locator('#any-flow-step-step-4095 > button').click();
  await expect(page.getByRole('dialog')).toContainText('Scale step 4095');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('tab', { name: '执行记录', exact: true }).click();
  await expect(page.locator('.application-workflow-graph')).toHaveCount(0);
  const metrics = {
    steps: count,
    graphMs,
    longTasksMs: await page.evaluate(() => (window as any).scaleLongTasks),
  };
  console.log('Workflow scale render:', JSON.stringify(metrics));
  await testInfo.attach('workflow-scale.json', {
    body: JSON.stringify(metrics),
    contentType: 'application/json',
  });
});

test('Any retries and pages one application creation history without losing delivered evidence sources', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const list = readApplicationDemo('application-runs', {});
  const current = list.items.find((item: any) => item.runId === 'creator-041')!;
  const delivered = list.items.find((item: any) => item.runId === 'creator-040')!;
  const applicationRun = list.items.find((item: any) => item.runId === 'run-127')!;
  const installed = {
    ...applicationRun,
    locator: 'application:imported-v2',
    runId: 'imported-run-v2',
    application: { ...applicationRun.application, version: '2.0.0' },
  };
  const recent = Array.from({ length: 100 }, (_, index) =>
    index === 0
      ? current
      : {
          ...current,
          locator: `creator:recent-${index}`,
          runId: `creator-recent-${index}`,
        },
  );
  const rosterQueries: { kind: string | null; cursor: string | null }[] = [];
  let rosterReads = 0;
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
      if (!url.searchParams.has('applicationId'))
        return route.fulfill({
          json: { ...list, items: [current], total: 1, nextCursor: null },
        });
      if (url.searchParams.get('kind') === 'application') {
        const older = url.searchParams.get('cursor') === 'older-versions';
        return route.fulfill({
          json: {
            ...list,
            fingerprint: 'version-history',
            items: older ? [installed] : [applicationRun],
            total: 2,
            nextCursor: older ? null : 'older-versions',
          },
        });
      }
      rosterReads++;
      rosterQueries.push({
        kind: url.searchParams.get('kind'),
        cursor: url.searchParams.get('cursor'),
      });
      if (rosterReads === 1)
        return route.fulfill({ status: 503, json: { error: 'creation history unavailable' } });
      const older = url.searchParams.get('cursor') === 'older-creations';
      return route.fulfill({
        json: {
          ...list,
          fingerprint: 'application-creation-history',
          items: older ? [delivered] : recent,
          total: 101,
          nextCursor: older ? null : 'older-creations',
        },
      });
    }
    if (url.pathname.endsWith('/application-run')) {
      if (url.searchParams.get('locator') === installed.locator)
        return route.fulfill({
          json: {
            ...readApplicationDemo('application-run', { locator: applicationRun.locator }),
            ...installed,
            sourceCreators: [],
          },
        });
      const detail = readApplicationDemo('application-run', {
        locator: url.searchParams.get('locator'),
      });
      if (detail.locator === delivered.locator)
        detail.evidence = detail.evidence.map((evidence: any) => ({
          ...evidence,
          sourceLocator: delivered.locator,
          sourceRunId: delivered.runId,
        }));
      return route.fulfill({ json: detail });
    }
    return route.fulfill({ json: { items: [], pages: [] } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  const roster = page.locator('.any-creator-roster');
  await expect(roster).toContainText('历史记录读取失败');
  await expect(page.locator('.any-run-identity')).toHaveText('创作记录 creator-041');
  await roster.getByRole('button', { name: '重新读取创作记录', exact: true }).click();
  await expect(roster.locator(':scope > button')).toHaveCount(100);
  await roster.getByRole('button', { name: '加载更多创作记录', exact: true }).click();
  await expect(roster.locator(':scope > button')).toHaveCount(101);
  await expect(page.locator('.any-run-identity')).toHaveText('创作记录 creator-041');
  const version = page.locator('.any-creation-sidebar .any-delivered-version').filter({
    hasText: 'creator-040',
  });
  await expect(version).toContainText('v1.1.0');
  const installedVersion = page
    .locator('.any-creation-sidebar .any-delivered-version')
    .filter({ hasText: 'v2.0.0' });
  const moreVersions = page.getByRole('button', { name: /加载更多版本记录$/u });
  await expect(moreVersions).not.toHaveClass(/ant-btn-loading/u);
  await moreVersions.click();
  await expect(installedVersion).toBeVisible();
  await installedVersion.click();
  await expect(page.locator('.any-run-identity')).toHaveText('版本来源 imported-run-v2');
  await expect(page.locator('.any-run-header .any-version')).toHaveText('v2.0.0');
  await expect(page.getByRole('button', { name: '分发 / 导出', exact: true })).toBeEnabled();
  await version.click();
  await expect(page.locator('.any-run-identity')).toHaveText('创作记录 creator-040');
  await expect(page.getByRole('button', { name: '分发 / 导出', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '验证证据', exact: true }).click();
  const evidence = page.locator('.any-evidence-page');
  await expect(evidence).toContainText('v1.1.0');
  await expect(evidence).toContainText('creator-040');
  await expect(evidence).not.toContainText('creator-041');
  expect(rosterQueries.slice(0, 3)).toEqual([
    { kind: 'creator', cursor: null },
    { kind: 'creator', cursor: null },
    { kind: 'creator', cursor: 'older-creations' },
  ]);
  expect(rosterQueries.every((query) => query.kind === 'creator')).toBe(true);
  await page
    .locator('.any-creation-sidebar')
    .getByRole('button', { name: '查看自定义工作流', exact: true })
    .click();
  await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-127');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page
    .locator('.any-workspace-heading')
    .getByRole('button', { name: '查看自定义工作流', exact: true })
    .click();
  await expect(page.locator('.any-run-identity')).toHaveText('运行轨迹 run-127');
});
