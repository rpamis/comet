import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const run = {
  id: 'eval-one',
  origin: 'cli',
  executionStatus: 'completed',
  conclusion: 'failed',
  createdAt: '2026-10-10T12:00:00Z',
  target: {
    id: 'writer',
    name: 'writer',
    type: 'application',
    version: '0.5.0',
    path: 'application.json',
    contentHash: 'content',
  },
  config: {
    target: 'application.json',
    targetType: 'application',
    agent: 'codex',
    model: 'model-a',
  },
  passed: 0,
  total: 1,
  expectedTotal: 1,
  baselineEligible: true,
  isBaseline: false,
  baselineRunId: null,
  availableActions: { stop: false, rerun: true, setBaseline: true, compare: true },
  metrics: { tokens: 100, durationSeconds: 10, knownCostUsd: null, costStatus: 'unavailable' },
  cases: [
    {
      id: 'case-one',
      task: 'clarify',
      prompt: '缺少数据源的周报请求',
      finalResponse: '生成了没有来源的周报',
      passed: false,
      quality: 'included',
      checksPassed: [],
      checksFailed: ['必须先澄清'],
      scores: {},
      scoreSources: {},
      artifacts: [],
    },
  ],
  coverage: {
    executedSteps: ['Shape'],
    coveredSteps: ['Shape'],
    uncoveredSteps: ['Archive'],
    coveredChoices: [],
    uncoveredChoices: ['approve'],
    recoveredActions: [],
    actualModels: ['model-a'],
  },
  limitations: ['仅证明当前用例'],
  failures: [],
  artifacts: [{ id: 'summary.md', label: 'summary.md', format: 'markdown' }],
  diagnostics: [],
};
test('read-only Eval demo keeps empty filters out of creation and live APIs', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/dashboard')) apiRequests.push(request.url());
  });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: /评估 Eval/ }).click();
  await expect(page.locator('.dashboard-eval-history-table')).toBeVisible();
  for (const filter of ['进行中', '仅看基线']) {
    await page.locator('.ant-segmented-item').filter({ hasText: filter }).click();
    await expect(page.getByText('没有符合筛选条件的记录', { exact: true })).toBeVisible();
    for (const button of await page.getByRole('button', { name: '新建评估', exact: true }).all())
      await expect(button).toBeDisabled();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.locator('.dashboard-eval-history-table')).toBeVisible();
  }
  await expect(page.locator('.dashboard-eval-create')).toHaveCount(0);
  expect(apiRequests).toEqual([]);
});

test('read-only Eval settings demo shows configuration without saving or requesting APIs', async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/dashboard')) apiRequests.push(request.url());
  });
  await page.goto('/?demo');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .locator('.dashboard-settings-navigation')
    .getByRole('menuitem', { name: /Eval/ })
    .click();
  const settings = page.locator('.dashboard-eval-settings');
  await expect(settings).toBeVisible();
  await expect(settings.getByText('默认执行端点', { exact: true })).toBeVisible();
  await expect(settings.getByText('默认 Judge 模型', { exact: true })).toBeVisible();
  await expect(settings.getByText('默认执行预算', { exact: true })).toBeVisible();
  await expect(
    settings.getByRole('button', { name: '保存 Eval 设置', exact: true }),
  ).toBeDisabled();
  await expect(settings.getByRole('button', { name: '检查本地环境', exact: true })).toBeDisabled();
  for (const field of await settings.locator('input').all()) await expect(field).toBeDisabled();
  expect(apiRequests).toEqual([]);
});

test.describe('Dashboard Eval', () => {
  test('animates view and tab changes without replaying on refresh or reduced motion', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).dashboardMotionCalls = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof animate>) {
        if (this.hasAttribute('data-dashboard-motion'))
          (window as any).dashboardMotionCalls.push(this.getAttribute('data-dashboard-motion'));
        return animate.apply(this, args);
      };
    });
    await page.reload();
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('tab', { name: '用例结果', exact: true }).click();
    await expect(page.getByRole('button', { name: 'clarify', exact: true })).toBeVisible();
    const surface = page
      .getByRole('tabpanel', { name: '用例结果', exact: true })
      .locator('[data-dashboard-motion="tab"]');
    await expect.poll(() => surface.evaluate((element) => element.getAnimations().length)).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).dashboardMotionCalls.filter((kind: string) => kind === 'tab').length,
        ),
      )
      .toBeGreaterThan(1);
    const count = await page.evaluate(() => (window as any).dashboardMotionCalls.length);
    await surface.evaluate((element) => {
      (window as any).readingSurface = element;
    });
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(page.getByRole('button', { name: 'clarify', exact: true })).toBeVisible();
    expect(await surface.evaluate((element) => element === (window as any).readingSurface)).toBe(
      true,
    );
    expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('tab', { name: '结果概览', exact: true }).click();
    await expect(page.getByRole('tab', { name: '结果概览', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
    expect(
      await page
        .getByRole('tabpanel', { name: '结果概览', exact: true })
        .locator('[data-dashboard-motion="tab"]')
        .evaluate((element) => element.getAnimations().length),
    ).toBe(0);
  });

  test('keeps a clean root URL while restoring Eval details on reload and history navigation', async ({
    page,
  }) => {
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await page.reload();
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('运行筛选')).toBeVisible();
    await expect(page.getByRole('heading', { name: '评估工作台', exact: true })).toHaveCount(0);
    await page.goForward();
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Classic 工作流' }).click();
    await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
    expect(await page.evaluate(() => history.state.cometDashboard.view)).toBe('workflow');
    await page.goBack();
    await expect.poll(() => page.evaluate(() => history.state.cometDashboard.view)).toBe('eval');
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
  });
  test('opens bookmarked Eval links and clears their visible query parameters', async ({
    page,
  }) => {
    await page.goto('/?view=eval&project=project&run=eval-one');
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:4173/');
    await page.reload();
    await expect(page.getByRole('tab', { name: '用例结果' })).toBeVisible();
  });
  test('lets the Eval settings heading scroll and translates inherited setting names', async ({
    page,
  }) => {
    await page.route('**/api/dashboard/eval/settings', (route) =>
      route.fulfill({
        json: {
          path: '/fixture/.comet/eval/.env',
          revision: 'initial',
          defaults: {
            agent: 'claude-code',
            model: '',
            baseUrl: '',
            judgeEnabled: false,
            judgeAgent: 'claude-code',
            judgeModel: '',
            judgeBaseUrl: '',
            skillTimeoutSeconds: 600,
            skillMaxTurns: 40,
            applicationTimeoutSeconds: 1200,
            applicationMaxTurns: 8,
          },
          credentials: {
            main: { configured: false, saved: false, source: 'none', kind: 'api-key' },
            judge: { configured: true, saved: false, source: 'environment', kind: 'auth-token' },
          },
          overrides: ['Judge 凭据'],
        },
      }),
    );
    await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Comet settings/u });
    const heading = dialog.locator('.dashboard-eval-settings > .dashboard-eval-heading');
    await expect(heading).toHaveCSS('position', 'static');
    const before = await heading.boundingBox();
    const budget = dialog.getByLabel('SDK application default maximum turns', { exact: true });
    await budget.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await heading.boundingBox())!.y).toBeLessThan(before!.y - 30);
    await expect(
      dialog.getByText(/Provided by the Dashboard startup environment: Judge credentials/u),
    ).toBeVisible();
    expect(await dialog.innerText()).not.toContain('Judge 凭据');
    await page.screenshot({ path: test.info().outputPath('eval-settings-scroll-english.png') });
  });
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/dashboard/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/dashboard/projects')
        return route.fulfill({
          json: {
            currentProjectId: 'project',
            projects: [
              {
                id: 'project',
                name: 'Comet',
                path: '/project',
                availability: 'available',
                isCurrent: true,
              },
            ],
          },
        });
      if (url.pathname.endsWith('/overview'))
        return route.fulfill({
          json: {
            project: { name: 'Comet', path: '/project' },
            summary: {},
            initialChanges: { items: [], total: 0 },
            git: {},
            native: null,
          },
        });
      if (url.pathname.endsWith('/plugins')) return route.fulfill({ json: { pages: [] } });
      if (url.pathname.endsWith('/eval/capabilities'))
        return route.fulfill({ json: { agents: ['codex', 'claude-code'] } });
      if (url.pathname.endsWith('/eval/runs')) return route.fulfill({ json: { items: [run] } });
      if (url.pathname.endsWith('/eval/runs/eval-one/baseline'))
        return route.fulfill({ json: { ...run, isBaseline: true, baselineRunId: run.id } });
      if (url.pathname.endsWith('/eval/runs/eval-one')) return route.fulfill({ json: run });
      if (url.pathname.endsWith('/artifact'))
        return route.fulfill({ json: { content: '# Real report', format: 'markdown' } });
      return route.fulfill({ json: { items: [], total: 0 } });
    });
    await page.goto('/');
    await page.getByRole('menuitem', { name: '评估 Eval' }).click();
  });
  test('shows project history, result evidence, SDK coverage and reports', async ({ page }) => {
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByText('已知用例费用', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '用例结果' }).click();
    await page.getByRole('button', { name: 'clarify', exact: true }).click();
    const evidence = page.getByRole('dialog', { name: 'clarify', exact: true });
    await expect(evidence.getByText('必须先澄清', { exact: true })).toBeVisible();
    await expect(evidence.getByText('缺少数据源的周报请求', { exact: true })).toBeVisible();
    await expect(evidence.getByText('生成了没有来源的周报', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'SDK 覆盖' }).click();
    await expect(page.getByText('Archive', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '日志与产物' }).click();
    await page.getByRole('button', { name: 'summary.md', exact: true }).click();
    await expect(page.getByText('Real report', { exact: true })).toBeVisible();
  });
  test('keeps the selected run and reading filters across modules and explains compact metrics', async ({
    page,
  }) => {
    await page.route('**/eval/runs/eval-one', (route) =>
      route.fulfill({
        json: {
          ...run,
          metrics: { ...run.metrics, tokens: 8761234, durationSeconds: 1563.419 },
          cases: run.cases.map((item) => ({
            ...item,
            scores: { correctness: 0.5, instruction_following: 0.4, completeness: 0.6 },
          })),
        },
      }),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    const conclusion = page.locator('.dashboard-eval-result-word');
    await expect(conclusion).toHaveText('未通过');
    expect((await conclusion.boundingBox())!.y).toBeLessThan(550);
    await expect(page.getByRole('menuitem', { name: /预览 Markdown/u })).not.toBeVisible();
    await page.getByText('26分03秒', { exact: true }).hover();
    await expect(page.getByRole('tooltip', { name: '1,563.419 秒', exact: true })).toBeVisible();
    await page.getByText('8.76M', { exact: true }).hover();
    await expect(page.getByRole('tooltip', { name: '8,761,234', exact: true })).toBeVisible();
    await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
    await expect(page.getByText('26m 03s', { exact: true })).toBeVisible();
    await page.locator('.comet-language-switch').getByText('中文', { exact: true }).click();
    const workspaceScroll = page.locator('[data-dashboard-scroll="workspace"]');
    const overview = page.getByRole('tabpanel', { name: '结果概览', exact: true });
    await expect(overview.getByText('completeness', { exact: true })).toBeVisible();
    const waitForMotion = () =>
      expect
        .poll(() =>
          page
            .locator('.dashboard-eval-page')
            .evaluate((element) =>
              element
                .getAnimations({ subtree: true })
                .some((animation) => animation.playState === 'running'),
            ),
        )
        .toBe(false);
    await waitForMotion();
    await workspaceScroll.evaluate((element) =>
      element.scrollTo({
        top: element.scrollHeight - element.clientHeight - 8,
        behavior: 'instant',
      }),
    );
    await expect
      .poll(() => workspaceScroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(80);
    const readingScroll = await workspaceScroll.evaluate((element) => element.scrollTop);
    await page.getByRole('menuitem', { name: 'Comet Any' }).click();
    await expect(page.getByRole('region', { name: 'Comet Any 工作区' })).toBeVisible();
    await page.getByRole('menuitem', { name: '评估 Eval' }).click();
    await expect(page.getByRole('tab', { name: '结果概览', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(overview.getByText('completeness', { exact: true })).toBeVisible();
    await waitForMotion();
    await expect
      .poll(() =>
        workspaceScroll.evaluate(
          (element, saved) => Math.abs(element.scrollTop - saved),
          readingScroll,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.getByRole('tab', { name: '用例结果', exact: true }).click();
    await page.getByLabel('用例筛选').getByText('仅未通过', { exact: true }).click();
    await page.getByRole('textbox', { name: '搜索用例', exact: true }).fill('clarify');
    await page.getByRole('menuitem', { name: 'Comet Any' }).click();
    await page.getByRole('menuitem', { name: '评估 Eval' }).click();
    await expect(page.getByRole('tab', { name: '用例结果', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('textbox', { name: '搜索用例', exact: true })).toHaveValue(
      'clarify',
    );
    await expect(page.getByRole('radio', { name: '仅未通过', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'clarify', exact: true })).toBeVisible();
    expect(await page.evaluate(() => history.state.cometDashboard.runId)).toBe('eval-one');
  });
  test('localizes Eval controls while preserving case evidence and report content', async ({
    page,
  }) => {
    await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
    await expect(page.getByRole('button', { name: /New evaluation/u })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Evaluation workspace', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Case results' })).toBeVisible();
    await page.getByRole('tab', { name: 'Case results' }).click();
    await page.getByRole('button', { name: 'clarify', exact: true }).click();
    const evidence = page.getByRole('dialog', { name: 'clarify', exact: true });
    await expect(evidence.getByText('Final response', { exact: true })).toBeVisible();
    await expect(evidence.getByText('缺少数据源的周报请求', { exact: true })).toBeVisible();
    await expect(evidence.getByText('生成了没有来源的周报', { exact: true })).toBeVisible();
    await expect(evidence.getByText('必须先澄清', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.route('**/eval/runs/eval-one/artifact?*', (route) =>
      route.fulfill({ json: { content: '# 原始报告\n\n中文报告正文', format: 'markdown' } }),
    );
    await page.getByRole('button', { name: 'Evaluation reports', exact: true }).click();
    await page.getByRole('menuitem', { name: /Preview Markdown/u }).click();
    const report = page.getByRole('dialog', { name: 'summary.md', exact: true });
    await expect(report.getByRole('heading', { name: '原始报告', exact: true })).toBeVisible();
    await expect(report.getByText('中文报告正文', { exact: true })).toBeVisible();
    await expect(report.getByRole('button', { name: 'Download file' })).toBeVisible();
  });
  test('keeps Eval form input and current step when the interface language changes', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /新建评估/u }).click();
    const target = 'D:/Projects/用户应用/SKILL.md';
    const goal = '保留用户填写的评估目的';
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(
      page.locator('#target_help').getByText('请选择本地目标路径', { exact: true }),
    ).toBeVisible();
    await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
    await expect(
      page.locator('#target_help').getByText('Select a local target path', { exact: true }),
    ).toBeVisible();
    await page.locator('.comet-language-switch').getByText('中文', { exact: true }).click();
    await page.getByLabel('目标路径', { exact: true }).fill(target);
    await page.getByLabel('评估目的（记录备注）', { exact: true }).fill(goal);
    await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
    await expect(page.getByLabel('Target path', { exact: true })).toHaveValue(target);
    await expect(page.getByLabel('Evaluation purpose (notes)', { exact: true })).toHaveValue(goal);
    await expect(page.getByText('Target and snapshot', { exact: true })).toBeVisible();
    await page.locator('.comet-language-switch').getByText('中文', { exact: true }).click();
    await expect(page.getByLabel('目标路径', { exact: true })).toHaveValue(target);
    await expect(page.getByLabel('评估目的（记录备注）', { exact: true })).toHaveValue(goal);
  });
  test('filters failed and infrastructure cases separately and searches their inputs', async ({
    page,
  }) => {
    const cases = [
      run.cases[0],
      {
        ...run.cases[0],
        id: 'case-pass',
        task: 'publish',
        prompt: '已确认来源的报告',
        passed: true,
        checksFailed: [],
        checksPassed: ['发布成功'],
      },
      {
        ...run.cases[0],
        id: 'case-env',
        task: 'recover',
        prompt: '中断后的恢复',
        quality: 'excluded',
        checksFailed: ['容器未启动'],
      },
    ];
    await page.route('**/eval/runs/eval-one', (route) =>
      route.fulfill({ json: { ...run, cases, total: 3, expectedTotal: 3 } }),
    );
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('tab', { name: '用例结果' }).click();
    await page.getByLabel('用例筛选').getByText('仅未通过', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'clarify', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'recover', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'publish', exact: true })).toHaveCount(0);
    await page.getByLabel('用例筛选').getByText('仅执行异常', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'recover', exact: true })).toBeVisible();
    await page.getByLabel('搜索用例').fill('不存在的输入');
    await expect(page.getByText('没有符合筛选条件的用例', { exact: true })).toBeVisible();
    await page.getByLabel('搜索用例').fill('恢复');
    await page.getByRole('button', { name: 'recover', exact: true }).click();
    const evidence = page.getByRole('dialog', { name: 'recover', exact: true });
    await expect(evidence.getByText('执行异常', { exact: true })).toBeVisible();
    await expect(evidence.getByText('容器未启动', { exact: true })).toBeVisible();
    await expect(evidence.getByText('中断后的恢复', { exact: true })).toBeVisible();
  });
  test('keeps live progress visible across tabs and follows the growing log without truncating downloads', async ({
    page,
  }) => {
    let current = {
      ...run,
      executionStatus: 'running',
      createdAt: new Date(Date.now() - 75000).toISOString(),
      expectedTotal: 2,
      cases: [],
      progress: {
        phase: 'running',
        updatedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        currentCase: { task: 'case-a', treatment: 'DYNAMIC_SKILL', repetition: 1 },
        activities: [
          { id: 'event-a', at: new Date().toISOString(), kind: 'tool', message: '读取工作区文件' },
        ],
      },
      artifacts: [{ id: 'execution.log', label: 'execution.log', format: 'text' }],
    };
    let log = '评估已启动\n';
    const fullPrefix = '完整日志前缀\n';
    await page.route('**/eval/runs/eval-one', (route) => route.fulfill({ json: current }));
    await page.route('**/eval/runs/eval-one/artifact?*', (route) => {
      const tail = new URL(route.request().url()).searchParams.get('tail') === '1';
      return route.fulfill({
        json: { content: tail ? log : fullPrefix + log, format: 'text', truncated: tail },
      });
    });
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    const progress = page.getByRole('region', { name: '实时评估进度' });
    await expect(progress.getByText('case-a', { exact: true })).toBeVisible();
    await expect(progress.getByText('读取工作区文件', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('eval-live-progress.png') });
    await page.getByRole('tab', { name: '日志与产物' }).click();
    await expect(progress).toBeVisible();
    const filename = page.getByRole('button', { name: 'execution.log', exact: true });
    await expect(filename).toHaveCSS('padding-left', '0px');
    await page.screenshot({ path: test.info().outputPath('eval-file-row.png') });
    await page.getByRole('button', { name: '预览产物 execution.log', exact: true }).click();
    const viewer = page.getByRole('dialog', { name: 'execution.log', exact: true });
    await expect(viewer.getByText('评估已启动', { exact: true })).toBeVisible();
    await page.getByRole('switch', { name: '跟随最新日志' }).click();
    await expect(page.getByRole('switch', { name: '跟随最新日志' })).not.toBeChecked();
    log += '正在独立复验\n';
    await expect(viewer.locator('pre')).toContainText('正在独立复验', { timeout: 10000 });
    const pending = page.waitForEvent('download');
    await viewer.getByRole('button', { name: /下载文件/ }).click();
    const download = await pending;
    expect(await readFile((await download.path())!, 'utf8')).toBe(fullPrefix + log);
    await page.keyboard.press('Escape');
    await expect(viewer).not.toBeVisible();
    current = {
      ...current,
      progress: {
        ...current.progress,
        phase: 'judging',
        currentCase: { ...current.progress.currentCase, task: 'case-b' },
        activities: [
          { id: 'event-b', at: new Date().toISOString(), kind: 'phase', message: '判定用例结果' },
        ],
      },
    };
    await expect(progress.getByText('case-b', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(progress.getByText('判定用例结果', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('eval-live-narrow.png'), fullPage: true });
  });
  test('renders every result screen and the evidence drawer in light, dark and narrow layouts', async ({
    page,
  }) => {
    await page.route('**/eval/runs/eval-one', (route) =>
      route.fulfill({
        json: {
          ...run,
          target: { ...run.target, contentHash: 'a'.repeat(64) },
          cases: [
            {
              ...run.cases[0],
              scores: { artifact_quality: 0.75, main_flow: 0.5 },
              model: 'model-a',
              durationSeconds: 10,
            },
          ],
          artifacts: [...run.artifacts, { id: 'worker.log', label: 'worker.log', format: 'text' }],
        },
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    for (const mode of ['light', 'dark', 'narrow']) {
      if (mode === 'dark') await page.getByRole('button', { name: '切换到暗色模式' }).click();
      if (mode === 'narrow') await page.setViewportSize({ width: 390, height: 844 });
      for (const [tab, file, content] of [
        ['结果概览', 'overview', '适用评分维度（0–1）'],
        ['用例结果', 'cases', '从结果进入输入、回答与检查证据。'],
        ['SDK 覆盖', 'coverage', '步骤覆盖'],
        ['日志与产物', 'artifacts', 'worker.log'],
        ['执行配置', 'config', '运行快照'],
      ]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          )
          .toBe(true);
        await page.screenshot({
          path: test.info().outputPath(`${file}-${mode}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.getByRole('tab', { name: '用例结果' }).click();
      await page.getByRole('button', { name: 'clarify', exact: true }).click();
      await expect(
        page
          .getByRole('dialog', { name: 'clarify', exact: true })
          .getByText('必须先澄清', { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`evidence-${mode}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
  });
  test('downloads Markdown, HTML and other artifacts directly with their contents', async ({
    page,
  }) => {
    const files: Record<string, { content: string; format: string }> = {
      'summary.md': { content: '# 评估报告\n\n通过率：80%\n', format: 'markdown' },
      'summary.html': {
        content: '<!doctype html><html><meta charset="utf-8"><body>评估报告</body></html>',
        format: 'html',
      },
      'metadata.json': { content: '{"total":5}', format: 'json' },
    };
    await page.route('**/eval/runs/eval-one', (route) =>
      route.fulfill({
        json: {
          ...run,
          artifacts: Object.entries(files).map(([id, value]) => ({
            id,
            label: id,
            format: value.format,
          })),
        },
      }),
    );
    await page.route('**/eval/runs/eval-one/artifact?*', (route) =>
      route.fulfill({
        json: files[new URL(route.request().url()).searchParams.get('ref')!],
      }),
    );
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByText('评估报告', { exact: true })).toBeVisible();
    for (const [id, label] of [
      ['summary.md', 'Markdown'],
      ['summary.html', 'HTML'],
    ]) {
      await page.getByRole('button', { name: '评估报告', exact: true }).click();
      await page.getByRole('menuitem', { name: new RegExp(`预览 ${label}`, 'u') }).click();
      const preview = page.getByRole('dialog', { name: id, exact: true });
      await expect(preview).toBeVisible();
      if (label === 'Markdown') {
        await expect(preview.getByRole('heading', { name: '评估报告', exact: true })).toBeVisible();
        await expect(preview.getByText('通过率：80%', { exact: true })).toBeVisible();
      } else {
        await expect(
          page
            .frameLocator('iframe[title="Eval HTML 报告"]')
            .getByText('评估报告', { exact: true }),
        ).toBeVisible();
        for (const viewport of [
          { width: 900, height: 1270 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await expect
            .poll(() =>
              preview.evaluate((element) => {
                const body = element.querySelector('.ant-drawer-body')!;
                const frame = element.querySelector('iframe')!;
                return Math.abs(
                  body.getBoundingClientRect().bottom -
                    parseFloat(getComputedStyle(body).paddingBottom) -
                    frame.getBoundingClientRect().bottom,
                );
              }),
            )
            .toBeLessThanOrEqual(1);
          await page.screenshot({
            path: test.info().outputPath(`eval-preview-HTML-${viewport.width}.png`),
          });
        }
        await page.setViewportSize({ width: 1280, height: 720 });
      }
      await page.screenshot({ path: test.info().outputPath(`eval-preview-${label}.png`) });
      await page.keyboard.press('Escape');
      await expect(preview).not.toBeVisible();
    }
    for (const [id, label] of [
      ['summary.md', '下载 Markdown'],
      ['summary.html', '下载 HTML'],
      ['metadata.json', '下载产物 metadata.json'],
    ]) {
      if (id === 'metadata.json') await page.getByRole('tab', { name: '日志与产物' }).click();
      else await page.getByRole('button', { name: '评估报告', exact: true }).click();
      const pending = page.waitForEvent('download');
      if (id === 'metadata.json')
        await page.getByRole('button', { name: label, exact: true }).click();
      else await page.getByRole('menuitem', { name: new RegExp(label, 'u') }).click();
      const download = await pending;
      expect(download.suggestedFilename()).toBe(`eval-one-${id}`);
      expect(await download.failure()).toBeNull();
      expect(await readFile((await download.path())!, 'utf8')).toBe(files[id].content);
    }
  });
  test('disables missing report formats and explains pending and absent reports', async ({
    page,
  }) => {
    let value: typeof run = { ...run, executionStatus: 'running', artifacts: [] };
    await page.route('**/eval/runs/eval-one', (route) => route.fulfill({ json: value }));
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /下载 Markdown/u })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /下载 HTML/u })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /预览 Markdown/u })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /预览 HTML/u })).toBeDisabled();
    await expect(page.getByText('报告生成后即可预览或下载，页面会自动更新。')).toBeVisible();
    value = { ...value, executionStatus: 'completed' };
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await expect(
      page.getByText('本次运行未生成报告，可在「日志与产物」中查看执行日志。'),
    ).toBeVisible();
    value = { ...run };
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /下载 Markdown/u })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: /下载 HTML/u })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: /预览 Markdown/u })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: /预览 HTML/u })).toBeDisabled();
  });
  test('shows artifact download failures without saving an error response as a report', async ({
    page,
  }) => {
    const saved: string[] = [];
    page.on('download', (download) => saved.push(download.suggestedFilename()));
    await page.route('**/eval/runs/eval-one/artifact?*', (route) =>
      route.fulfill({ status: 404, json: { error: '报告文件已不存在，请刷新运行记录' } }),
    );
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await page.getByRole('menuitem', { name: /下载 Markdown/u }).click();
    await expect(page.getByText('报告文件已不存在，请刷新运行记录', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '评估报告', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /下载 Markdown/u })).toBeEnabled();
    expect(saved).toEqual([]);
  });
  test('exposes baseline selection and target-specific creation fields', async ({ page }) => {
    await page.getByRole('button', { name: '设为基线', exact: true }).click();
    await expect(page.getByText('默认基线', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill('application.json');
    await expect(page.getByLabel('目标路径')).toHaveValue('application.json');
    await page.getByRole('button', { name: '返回记录', exact: true }).click();
    await expect(page.getByRole('button', { name: 'writer', exact: true })).toBeVisible();
  });
  test('automatically previews a pasted absolute Skill path and keeps it when correcting the type', async ({
    page,
  }) => {
    const target = 'D:\\OtherProject\\writer\\SKILL.md';
    await page.route('**/eval/preview', (route) => {
      const config = route.request().postDataJSON();
      if (config.targetType === 'application')
        return route.fulfill({
          status: 400,
          json: { error: '目标类型与路径不一致：请选择「Skill / Eval manifest」' },
        });
      expect(config.target).toBe(target);
      return route.fulfill({
        json: {
          config: { ...config, targetType: 'skill' },
          target: { ...run.target, type: 'skill', path: target },
          taskSource: 'quick',
          tasks: [{ name: 'clarify', instruction: 'Ask for the missing source', expected: {} }],
          taskCount: { min: 1, max: 1 },
          environment: [],
          blockedReasons: [],
          limitations: [],
          noModelsStarted: true,
          confirmationHash: 'skill-preview',
        },
      });
    });
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill(target);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('目标与用例身份', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByLabel('目标类型').click();
    await page.getByText('SDK 应用', { exact: true }).click();
    await expect(page.getByLabel('目标路径')).toHaveValue(target);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(
      page.getByText('目标类型与路径不一致：请选择「Skill / Eval manifest」', { exact: true }),
    ).toBeVisible();
    await page.getByLabel('目标类型').click();
    await page.getByText('Skill / Eval manifest', { exact: true }).click();
    await expect(page.getByLabel('目标路径')).toHaveValue(target);
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('目标与用例身份', { exact: true })).toBeVisible();
  });
  test('can cancel a baseline without losing history or the bound comparison reference', async ({
    page,
  }) => {
    let value = {
      ...run,
      baselineScope: 'fixed-cases',
      baselineRunId: run.id,
      boundBaselineRunId: run.id,
      isBaseline: true,
    };
    let writes = 0;
    await page.route('**/eval/runs', (route) => route.fulfill({ json: { items: [value] } }));
    await page.route('**/eval/runs/eval-one', (route) => route.fulfill({ json: value }));
    await page.route('**/eval/runs/eval-one/baseline/clear', (route) => {
      expect(route.request().method()).toBe('POST');
      writes++;
      value = { ...value, baselineRunId: null, isBaseline: false };
      return route.fulfill({ json: value });
    });
    await page.reload();
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('button', { name: '默认参照', exact: true }).click();
    await page.getByRole('button', { name: '取消基线', exact: true }).click();
    await page.getByRole('button', { name: '保留基线', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(writes).toBe(0);
    await page.getByRole('button', { name: '默认参照', exact: true }).click();
    await page.getByRole('button', { name: '取消基线', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '取消基线', exact: true }).click();
    await page.getByRole('button', { name: '默认参照', exact: true }).click();
    await expect(page.getByText('默认基线：未设置', { exact: true })).toBeVisible();
    await expect(page.getByText('启动时绑定：eval-one', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '设为基线', exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await page.getByRole('button', { name: /运行记录/ }).click();
    await expect(page.getByRole('button', { name: 'writer', exact: true })).toBeVisible();
  });
  test('filters active, finished and baseline records without mixing their scope', async ({
    page,
  }) => {
    const values = [
      run,
      {
        ...run,
        id: 'eval-running',
        target: { ...run.target, name: 'working' },
        executionStatus: 'running',
      },
      { ...run, id: 'eval-base', target: { ...run.target, name: 'reference' }, isBaseline: true },
    ];
    await page.route('**/eval/runs', (route) => route.fulfill({ json: { items: values } }));
    await page.reload();
    await page.getByLabel('运行筛选').getByText('进行中', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'working', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'writer', exact: true })).toHaveCount(0);
    await page.getByLabel('运行筛选').getByText('仅看基线', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'reference', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'working', exact: true })).toHaveCount(0);
    await page.getByLabel('运行筛选').getByText('已结束', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'writer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'working', exact: true })).toHaveCount(0);
  });
  test('saves, reloads and applies project presets with a fresh preflight', async ({ page }) => {
    let presets: any[] = [];
    await page.route('**/eval/presets', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.config.apiKey).toBeUndefined();
        presets = [{ id: 'preset-one', name: body.name, config: body.config, updatedAt: 'now' }];
        return route.fulfill({ json: presets[0] });
      }
      return route.fulfill({ json: { items: presets } });
    });
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill('application.json');
    await page.getByRole('button', { name: '保存为新配置' }).click();
    await page.getByLabel('配置名称').fill('日常回归');
    await page.getByRole('button', { name: /确\s*定/u }).click();
    await expect(page.getByText('常用配置已保存', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回记录', exact: true }).click();
    await page.reload();
    await page.getByLabel('常用配置', { exact: true }).click();
    await page.getByText('日常回归', { exact: true }).click();
    await page.getByRole('button', { name: '使用所选配置' }).click();
    await expect(page.getByLabel('目标路径')).toHaveValue('application.json');
    await expect(page.getByRole('button', { name: '下一步', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /开始评估/ })).toHaveCount(0);
  });
  test('shows first-use and Docker recovery instructions without starting a model', async ({
    page,
  }) => {
    await page.route('**/eval/runs', (route) => route.fulfill({ json: { items: [] } }));
    await page.route('**/eval/preview', (route) =>
      route.fulfill({
        json: {
          config: route.request().postDataJSON(),
          target: run.target,
          tasks: [],
          taskSource: 'pending-generation',
          taskCount: { min: 2, max: 4 },
          noModelsStarted: true,
          confirmationHash: 'preview',
          limitations: [],
          environment: [],
          blockedReasons: ['Docker 不可用'],
        },
      }),
    );
    await page.reload();
    await expect(page.getByText('第一次使用 Eval', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新建评估', exact: true }).first().click();
    await page.getByLabel('目标路径').fill('application.json');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText(/启动 Docker 并运行 docker info/)).toBeVisible();
    await expect(page.getByRole('button', { name: /开始评估/ })).toBeDisabled();
    await page.getByRole('button', { name: '使用指南', exact: true }).click();
    await expect(page.getByRole('button', { name: '打开 Eval 设置', exact: true })).toBeVisible();
  });
  test('opens Eval settings from missing-credential guidance without starting an evaluation', async ({
    page,
  }) => {
    let starts = 0;
    await page.route('**/eval/runs', (route) => {
      if (route.request().method() === 'POST') starts++;
      return route.fulfill({ json: { items: [] } });
    });
    await page.route('**/eval/preview', (route) =>
      route.fulfill({
        json: {
          config: route.request().postDataJSON(),
          target: run.target,
          tasks: [],
          taskSource: 'pending-generation',
          taskCount: { min: 2, max: 4 },
          noModelsStarted: true,
          confirmationHash: 'missing-key',
          limitations: [],
          environment: [
            {
              id: 'subject',
              label: '执行模型凭据',
              status: 'missing',
              detail: '请配置 BENCH_API_KEY，配置文件位于 ~/.comet/eval/.env',
            },
          ],
          blockedReasons: ['请配置 BENCH_API_KEY，配置文件位于 ~/.comet/eval/.env'],
        },
      }),
    );
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill('application.json');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByRole('button', { name: /开始评估/ })).toBeDisabled();
    expect(await page.locator('.dashboard-eval-create').innerText()).not.toContain('BENCH_API_KEY');
    await page.getByRole('button', { name: '打开 Eval 设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Comet 设置/u });
    await expect(dialog.getByRole('menuitem', { name: /Eval/u })).toHaveClass(
      /ant-menu-item-selected/,
    );
    expect(starts).toBe(0);
  });
  test('opens a failed-only rerun without silently starting or replacing the parent', async ({
    page,
  }) => {
    await page.route('**/eval/runs/eval-one/rerun-preview', (route) => {
      expect(route.request().postDataJSON()).toEqual({ failedOnly: true });
      return route.fulfill({ json: { config: { ...run.config, retrySourceRunId: 'eval-one' } } });
    });
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await page.getByRole('button', { name: '只重跑失败用例', exact: true }).click();
    await expect(page.getByText('失败用例重跑 · 原记录 eval-one', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /开始评估/ })).toBeDisabled();
  });
  test('saves global Eval settings, clears credential inputs and reuses defaults without overriding run edits', async ({
    page,
  }) => {
    let value = {
      path: 'C:/Users/fixture/.comet/eval/.env',
      revision: 'initial',
      defaults: {
        agent: 'claude-code',
        model: '',
        baseUrl: '',
        judgeEnabled: false,
        judgeAgent: 'claude-code',
        judgeModel: '',
        judgeBaseUrl: '',
        skillTimeoutSeconds: 600,
        skillMaxTurns: 40,
        applicationTimeoutSeconds: 1200,
        applicationMaxTurns: 8,
      },
      credentials: {
        main: { configured: false, saved: false, source: 'none', kind: 'api-key' },
        judge: { configured: false, saved: false, source: 'none', kind: 'api-key' },
      },
      overrides: [],
    };
    let saves = 0;
    await page.route('**/api/dashboard/eval/settings', (route) => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON();
        saves++;
        expect(input.expectedRevision).toBe(value.revision);
        if (saves === 1) expect(input.credentials.main.value).toBe('browser-test-secret');
        else expect(input.credentials).toEqual({});
        value = {
          ...value,
          defaults: input.defaults,
          revision: `saved-${saves}`,
          credentials: {
            ...value.credentials,
            main: { configured: true, saved: true, source: 'file', kind: 'api-key' },
          },
        };
      }
      return route.fulfill({ json: value });
    });
    await page.route('**/eval/preview', (route) => {
      const config = route.request().postDataJSON();
      return route.fulfill({
        json: {
          config,
          target: { ...run.target, type: 'skill' },
          tasks: [],
          taskSource: 'pending-generation',
          taskCount: { min: 2, max: 4 },
          environment: [],
          blockedReasons: [],
          limitations: [],
          noModelsStarted: true,
          confirmationHash: 'settings-preview',
        },
      });
    });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Comet 设置/u });
    await expect(dialog.getByLabel('默认执行模型')).toBeVisible();
    await dialog.getByLabel('默认执行模型').fill('global-model');
    await dialog.getByLabel('新的执行凭据').fill('browser-test-secret');
    await dialog.getByLabel('Skill 默认总时限（秒）').fill('700');
    await dialog.getByRole('button', { name: '保存 Eval 设置', exact: true }).click();
    await expect(dialog.getByLabel('新的执行凭据')).toHaveValue('');
    await expect(dialog.getByText('已配置', { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].join('\n'),
      ),
    ).not.toContain('browser-test-secret');
    await dialog.getByRole('heading', { name: 'Eval', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath('eval-settings-desktop.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('eval-settings-narrow.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill('skill/SKILL.md');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await page.getByRole('button', { name: '临时覆盖本次配置', exact: true }).click();
    await expect(page.getByLabel('执行模型', { exact: true })).toHaveValue('global-model');
    await expect(page.getByLabel('评估总时限（秒）')).toHaveValue('700');
    await page.getByLabel('执行模型', { exact: true }).fill('run-only-model');
    await page.getByRole('button', { name: '编辑 Eval 设置', exact: true }).click();
    await dialog.getByLabel('默认执行模型').fill('new-global-model');
    await dialog.getByRole('button', { name: '保存 Eval 设置', exact: true }).click();
    await expect(dialog.getByLabel('新的执行凭据')).toHaveValue('');
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByLabel('执行模型', { exact: true })).toHaveValue('run-only-model');
    expect(saves).toBe(2);
  });
  for (const language of ['zh', 'en']) {
    test(`shows saved baselines from other scopes for side-by-side viewing (${language})`, async ({
      page,
    }) => {
      const candidate = { ...run, baselineScope: 'new-workflow' };
      const references = ['eval-old-native', 'eval-old-classic'].map((id) => ({
        ...run,
        id,
        baselineScope: id,
        isBaseline: true,
        target: { ...run.target, name: id },
        cases: [{ ...run.cases[0], task: id }],
      }));
      let writes = 0;
      await page.route('**/eval/runs', (route) =>
        route.fulfill({ json: { items: [candidate, ...references] } }),
      );
      await page.route('**/eval/runs/eval-one', (route) => route.fulfill({ json: candidate }));
      await page.route('**/eval/runs/*/baseline', (route) => {
        writes++;
        return route.abort();
      });
      await page.route(/\/eval\/runs\/eval-one\/compare\?/, (route) => {
        const id = new URL(route.request().url()).searchParams.get('baseline');
        return route.fulfill({
          json: {
            comparable: false,
            reasons: ['目标、固定用例或评分规则不一致'],
            baseline: references.find((item) => item.id === id),
            candidate,
            improved: 0,
            regressed: 0,
            unchanged: 0,
            configurationChanges: [],
            // 即使旧响应包含变化标签，不可比记录也不能显示进步或退步。
            cases: [
              {
                task: 'clarify',
                repetition: 1,
                baseline: true,
                candidate: false,
                change: 'regressed',
              },
            ],
          },
        });
      });
      await page.reload();
      if (language === 'en')
        await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
      await page.getByRole('button', { name: 'writer', exact: true }).first().click();
      await page
        .getByRole('button', {
          name: language === 'en' ? 'Compare with baseline' : '与基线对比',
          exact: true,
        })
        .click();
      await expect(
        page.getByText(
          language === 'en'
            ? 'No matching reference for this evaluation'
            : '当前评估没有匹配的对比参照',
          { exact: true },
        ),
      ).toBeVisible();
      await page.getByLabel(language === 'en' ? 'Temporary reference' : '临时参照').click();
      await expect(
        page.getByText(
          language === 'en' ? 'Other baselines · Side-by-side only' : '其他基线 · 仅并列查看',
          { exact: true },
        ),
      ).toBeVisible();
      for (const reference of references)
        await expect(
          page.getByText(`${reference.target.name} · 0.5.0 · ${reference.id}`, { exact: true }),
        ).toBeVisible();
      await page.getByText('eval-old-native · 0.5.0 · eval-old-native', { exact: true }).click();
      await expect(
        page.getByText(language === 'en' ? 'Side-by-side only' : '仅并列查看', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(language === 'en' ? 'Baseline cases' : '基线用例', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(language === 'en' ? 'Current cases' : '本次用例', { exact: true }),
      ).toBeVisible();
      await expect(
        page.locator('.dashboard-eval-page .ant-tag').filter({ hasText: /^(退步|Regressed)$/ }),
      ).toHaveCount(0);
      await expect(
        page.getByText(language === 'en' ? 'Case comparison' : '逐项对比', { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText(
          language === 'en'
            ? 'No matching reference for this evaluation'
            : '当前评估没有匹配的对比参照',
          { exact: true },
        ),
      ).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath('incompatible-baselines-desktop.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        )
        .toBe(true);
      await page.screenshot({
        path: test.info().outputPath('incompatible-baselines.png'),
        fullPage: true,
        animations: 'disabled',
      });
      expect(writes).toBe(0);
    });
  }
  test('switches temporary comparison references without replacing the default baseline', async ({
    page,
  }) => {
    const candidate = { ...run, baselineRunId: 'eval-base', baselineScope: 'fixed-cases' };
    const references = ['eval-base', 'eval-temp'].map((id) => ({
      ...candidate,
      id,
      passed: 1,
      conclusion: 'passed',
      isBaseline: id === 'eval-base',
    }));
    let baselineWrites = 0;
    await page.route('**/eval/runs', (route) =>
      route.fulfill({ json: { items: [candidate, ...references] } }),
    );
    await page.route('**/eval/runs/eval-one', (route) => route.fulfill({ json: candidate }));
    await page.route('**/eval/runs/eval-one/baseline', (route) => {
      baselineWrites++;
      return route.fulfill({ json: candidate });
    });
    await page.route(/\/eval\/runs\/eval-one\/compare\?/, (route) => {
      const id = new URL(route.request().url()).searchParams.get('baseline');
      const baseline = references.find((reference) => reference.id === id);
      expect(baseline).toBeTruthy();
      return route.fulfill({
        json: {
          comparable: true,
          reasons: [],
          baseline,
          candidate,
          improved: 0,
          regressed: 1,
          unchanged: 0,
          configurationChanges: [
            {
              field: 'baseUrl',
              baseline: `https://${id}.example`,
              candidate: 'https://candidate.example',
            },
          ],
          cases: [
            {
              task: 'clarify',
              repetition: 1,
              baseline: true,
              candidate: false,
              change: 'regressed',
            },
          ],
        },
      });
    });
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'writer', exact: true }).first().click();
    await page.getByRole('button', { name: '与基线对比', exact: true }).click();
    await expect(page.getByText('执行端点', { exact: true })).toBeVisible();
    await expect(page.getByText('https://eval-base.example', { exact: true })).toBeVisible();
    await page.getByLabel('临时参照').click();
    await page.getByText('writer · 0.5.0 · eval-temp', { exact: true }).click();
    await expect(page.getByText('https://eval-temp.example', { exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('comparison-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('comparison-narrow.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: /返回详情/ }).click();
    await page.getByRole('button', { name: '默认参照', exact: true }).click();
    await expect(page.getByText('默认基线：eval-base', { exact: true })).toBeVisible();
    expect(baselineWrites).toBe(0);
  });
  test('keeps the current theme and fits desktop and narrow layouts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.dashboard-eval-pagination')).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath('eval-list-desktop.png'),
      fullPage: true,
    });
    let paginationRuns = Array.from({ length: 16 }, (_, index) => ({
      ...run,
      id: index === 0 ? run.id : `eval-${index + 1}`,
      target: { ...run.target, name: index === 0 ? 'writer' : `writer-${index + 1}` },
    }));
    await page.route('**/eval/runs', (route) => route.fulfill({ json: { items: paginationRuns } }));
    await page.reload();
    const nextPage = page.getByRole('button', { name: '下一页', exact: true });
    const previousPage = page.getByRole('button', { name: '上一页', exact: true });
    await expect(previousPage).toBeDisabled();
    await nextPage.click();
    await expect(page.getByRole('button', { name: 'writer-16', exact: true })).toBeVisible();
    await expect(nextPage).toBeDisabled();
    await expect(page.getByText('16–16 / 共 16 条', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('eval-pagination-desktop.png') });
    await page.getByRole('button', { name: '切换到暗色模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: test.info().outputPath('eval-list-dark.png'), fullPage: true });
    await page.getByRole('button', { name: '切换到亮色模式' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('eval-list-narrow.png'), fullPage: true });
    await page.locator('.dashboard-eval-pagination').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('eval-pagination-narrow.png') });
    await previousPage.click();
    await expect(page.getByRole('button', { name: 'writer', exact: true })).toBeVisible();
    await expect(previousPage).toBeDisabled();
    paginationRuns = [run];
    await page.reload();
    await expect(page.locator('.dashboard-eval-pagination')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByRole('tab', { name: '结果概览' })).toBeVisible();
    await expect(page.locator('.dashboard-eval-page .ant-spin-container').first()).toHaveCSS(
      'opacity',
      '1',
    );
    await page.screenshot({ path: test.info().outputPath('eval-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: '切换到暗色模式' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: test.info().outputPath('eval-dark.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await expect(page.getByRole('tab', { name: '结果概览' })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.dashboard-eval-stack')
          .first()
          .evaluate((element) =>
            [...element.children].every(
              (child) => child.getBoundingClientRect().right <= window.innerWidth + 1,
            ),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('eval-narrow.png'), fullPage: true });
  });
  test('keeps text actions unframed on hover and mouse press while showing keyboard focus', async ({
    page,
  }) => {
    const target = page.getByRole('button', { name: 'writer', exact: true });
    await expect(target.getByText('查看详情', { exact: true })).toBeVisible();
    await target.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(target).toBeFocused();
    await expect(target).toHaveCSS('outline-width', '2px');
    await page.screenshot({
      path: test.info().outputPath('target-keyboard-focus.png'),
      animations: 'disabled',
    });
    await target.press('Tab');
    await target.hover();
    await expect(target).toHaveCSS('outline-style', 'none');
    await expect(target).toHaveCSS('border-top-width', '0px');
    await expect(target).toHaveCSS('box-shadow', 'none');
    await page.screenshot({
      path: test.info().outputPath('target-hover.png'),
      animations: 'disabled',
    });
    await target.getByText(run.id, { exact: true }).click();
    await expect(page.locator('.dashboard-eval-result-hero')).toHaveCSS('border-top-width', '1px');
    await page.screenshot({
      path: test.info().outputPath('overview-no-stripe.png'),
      animations: 'disabled',
    });
    await page.getByRole('tab', { name: '日志与产物' }).click();
    const report = page.getByRole('button', { name: 'summary.md', exact: true });
    await report.hover();
    await page.mouse.down();
    await expect(report).toHaveCSS('border-top-width', '0px');
    await expect(report).toHaveCSS('box-shadow', 'none');
    await page.screenshot({
      path: test.info().outputPath('report-mouse-press.png'),
      animations: 'disabled',
    });
    await page.mouse.up();
    await expect(page.getByText('Real report', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await report.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(report).toBeFocused();
    await expect(report).toHaveCSS('outline-width', '2px');
    await page.screenshot({
      path: test.info().outputPath('report-keyboard-focus.png'),
      animations: 'disabled',
    });
  });
  test('separates excluded infrastructure samples from capability scores', async ({ page }) => {
    await page.route('**/eval/runs/eval-one', (route) =>
      route.fulfill({
        json: {
          ...run,
          conclusion: 'incomplete',
          cases: [{ ...run.cases[0], quality: 'excluded', scores: { artifact_quality: 0 } }],
        },
      }),
    );
    await page.getByRole('button', { name: 'writer', exact: true }).click();
    await expect(page.getByText('环境异常样本未纳入模型能力评分', { exact: true })).toBeVisible();
    await expect(page.getByText('适用评分维度（0–1）', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: '用例结果' }).click();
    await expect(page.getByText('执行异常', { exact: true })).toBeVisible();
  });
  test('previews, launches and restores one owned evaluation after reload', async ({ page }) => {
    let launched: typeof run | undefined;
    let launchCount = 0;
    await page.route('**/eval/preview', async (route) => {
      const config = route.request().postDataJSON();
      await route.fulfill({
        json: {
          config: { ...config, model: 'fixture-model' },
          target: run.target,
          taskSource: 'pending-generation',
          tasks: [],
          taskCount: { min: 2, max: 4 },
          environment: [{ id: 'uv', label: 'uv', status: 'available', detail: '已配置' }],
          blockedReasons: [],
          limitations: ['仅本次配置'],
          noModelsStarted: true,
          confirmationHash: 'fixed-preview',
        },
      });
    });
    await page.route('**/eval/runs', async (route) => {
      if (route.request().method() === 'POST') {
        launchCount++;
        const input = route.request().postDataJSON();
        expect(input.confirmationHash).toBe('fixed-preview');
        expect(input.requestId).toMatch(/^[a-f0-9-]+$/);
        launched = {
          ...run,
          id: 'eval-new',
          executionStatus: 'preparing',
          conclusion: 'incomplete',
          config: input.config,
          cases: [],
          availableActions: { ...run.availableActions, stop: true },
        };
        await route.fulfill({ status: 202, json: launched });
      } else await route.fulfill({ json: { items: launched ? [launched, run] : [run] } });
    });
    await page.route('**/eval/runs/eval-new', (route) => route.fulfill({ json: launched }));
    await page.route('**/eval/runs/eval-new/stop', (route) => {
      launched = { ...launched!, executionStatus: 'stopping' };
      return route.fulfill({ status: 202, json: launched });
    });
    await page.getByRole('button', { name: /新建评估/ }).click();
    await page.getByLabel('目标路径').fill('application.json');
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('正式运行时生成并固定 2–4 个用例', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('create-cases.png'), fullPage: true });
    await page.getByRole('button', { name: '下一步', exact: true }).click();
    await expect(page.getByText('fixture-model', { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('create-confirm.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath('create-confirm-narrow.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: /开始评估/ }).click();
    await expect(
      page.locator('.dashboard-eval-masthead').getByText('准备环境', { exact: true }),
    ).toBeVisible();
    expect(launchCount).toBe(1);
    await page.reload();
    await expect(
      page.locator('.dashboard-eval-masthead').getByText('准备环境', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '停止评估', exact: true }).click();
    await expect(page.getByText('停止中', { exact: true })).toBeVisible();
    expect(launchCount).toBe(1);
  });
});
