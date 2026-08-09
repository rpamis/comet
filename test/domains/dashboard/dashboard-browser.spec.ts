import { expect, test } from '@playwright/test';

test('loads the demo dashboard and previews an artifact', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');

  await expect(page).toHaveTitle('Comet Dashboard');
  await expect(page.getByText('Comet', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeHidden();

  const nativeWorkflow = page.getByRole('menuitem', { name: 'Native 工作流' });
  await nativeWorkflow.click();
  await expect(nativeWorkflow).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '循环与恢复' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '变更范围' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '验收状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '检查结果' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '阻塞项' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '执行历史' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '恢复状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Git 摘要' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '活跃', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '已归档', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '全部', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ship-native-dashboard' })).toBeVisible();
  const nativeCopyChangeName = page.getByRole('button', { name: '复制 Change 名称' });
  await expect(nativeCopyChangeName).toHaveCount(1);
  await nativeCopyChangeName.click();
  await expect(page.getByRole('button', { name: '已复制 Change 名称' })).toBeVisible();

  await page.getByRole('button', { name: '需求简报' }).click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeVisible();
  await expect(page.getByText('Ship a fast, recoverable Native dashboard.')).toBeVisible();
  await page.getByRole('button', { name: '关闭产物预览' }).last().click();

  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'document-native-resume' })).toBeVisible();
  await expect(page.getByLabel('Archive 已完成')).toHaveText('✓');
  await expect(page.getByText(/Build ↔ Verify Loop · 已完成/u)).toBeVisible();
  await expect(page.getByText('用户确认降级通过', { exact: true })).toBeVisible();
  await expect(page.getByText('归档只读', { exact: true }).first()).toBeVisible();

  const classicWorkflow = page.getByRole('menuitem', { name: 'Classic 工作流' });
  await classicWorkflow.click();
  await expect(classicWorkflow).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeHidden();

  const proposal = page.getByRole('button').filter({ hasText: 'proposal' }).first();
  await expect(proposal).toBeVisible();
  await proposal.click();

  await expect(page.getByRole('heading', { name: '提案', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: '全屏展示' }).click();
  await expect(page.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await page.getByRole('button', { name: '退出全屏' }).click();
  await page.getByRole('button', { name: '关闭产物预览' }).last().click();

  expect(consoleErrors).toEqual([]);
});

test('keeps Classic task progress inside the change detail column', async ({ page }) => {
  await page.setViewportSize({ width: 1580, height: 900 });
  await page.goto('/?demo');

  const taskProgress = page
    .getByRole('heading', { name: '任务进度' })
    .locator('xpath=ancestor::article[1]');
  const changeDetail = taskProgress.locator('xpath=ancestor::section[1]');

  await expect(taskProgress).toBeVisible();
  const taskProgressBox = await taskProgress.boundingBox();
  const changeDetailBox = await changeDetail.boundingBox();
  if (!taskProgressBox || !changeDetailBox) {
    throw new Error('Expected task progress and change detail to have measurable bounds');
  }

  expect(taskProgressBox.x + taskProgressBox.width).toBeLessThanOrEqual(
    changeDetailBox.x + changeDetailBox.width,
  );
});

test('gives the workbench restrained surface depth and interactive card feedback', async ({
  page,
}) => {
  await page.goto('/?demo');

  const summaryCard = page.locator('.dashboard-summary-card').first();
  await expect(summaryCard).toBeVisible();
  await expect(summaryCard).toHaveCSS('border-radius', '15px');
  await expect(summaryCard).toHaveCSS('cursor', 'pointer');

  const workbench = page.locator('.dashboard-workbench');
  await expect(workbench).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(workbench).toHaveCSS('border-radius', '24px');

  await page.getByRole('button', { name: '切换到暗色模式' }).click();
  await expect(page.locator('.ant-alert-info')).toHaveCSS('background-color', 'rgb(20, 36, 58)');
  await expect(page.locator('.ant-alert-title')).toHaveCSS('color', 'rgb(228, 232, 239)');
});

test('keeps the redesigned header focused on controls rather than helper copy', async ({
  page,
}) => {
  await page.goto('/?demo');

  const header = page.locator('.comet-workbench-header');
  await expect(header.getByText('当前项目', { exact: true })).toHaveCount(0);
  await expect(header.getByText('工作流', { exact: true })).toHaveCount(0);
  await expect(header.locator('.comet-header-sync')).toHaveCount(0);
  await expect(header).toHaveCSS('min-height', '68px');
  await expect(header.locator('.ant-segmented')).toHaveCount(0);
  const search = header.locator('.comet-header-search');
  await expect(search).toHaveCSS('position', 'absolute');
  await expect(search).toHaveCSS('width', '360px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'min-height',
    '40px',
  );
  await expect(page.getByRole('button', { name: '立即刷新' })).toHaveText('');

  const [searchBox, workbenchBox] = await Promise.all([
    search.boundingBox(),
    page.locator('.dashboard-workbench').boundingBox(),
  ]);
  if (!searchBox || !workbenchBox) {
    throw new Error('Expected the search field and workbench to have measurable bounds');
  }
  expect(
    Math.abs(searchBox.x + searchBox.width / 2 - (workbenchBox.x + workbenchBox.width / 2)),
  ).toBeLessThanOrEqual(1);
});

test('uses restrained corners for the two Header search controls', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.locator('.comet-project-select')).toHaveCSS('border-radius', '6px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'border-radius',
    '6px',
  );
});

test('fully applies dark surfaces without page-wide color-transition jank', async ({ page }) => {
  await page.goto('/?demo');
  await page.getByRole('button', { name: '切换到暗色模式' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.dashboard-overview-summary-card').nth(1)).toHaveCSS(
    'background-color',
    'rgb(23, 30, 41)',
  );
  await expect(page.locator('.dashboard-priority-banner')).toHaveCSS(
    'background-color',
    'rgb(23, 30, 41)',
  );
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'background-color',
    'rgb(21, 25, 35)',
  );
  await expect(page.locator('.comet-project-select')).toHaveCSS(
    'background-color',
    'rgb(26, 35, 49)',
  );
  await expect(page.locator('.comet-project-select')).toHaveCSS(
    'border-top-color',
    'rgb(57, 75, 102)',
  );
  await expect(page.getByRole('combobox')).toHaveCSS('color', 'rgb(213, 224, 240)');
  await expect(page.locator('.comet-project-select .ant-select-placeholder')).toHaveCSS(
    'color',
    'rgb(213, 224, 240)',
  );
  await expect(page.locator('.ant-card').first()).toHaveCSS('background-color', 'rgb(21, 25, 35)');
  await expect(page.locator('.ant-steps-item-wait .ant-steps-item-title').first()).toHaveCSS(
    'color',
    'rgb(165, 180, 200)',
  );
  await expect(page.locator('.dashboard-priority-title svg')).toHaveCSS(
    'background-color',
    'rgb(29, 59, 101)',
  );
  await expect(page.locator('.dashboard-sidebar-feature')).toHaveCSS(
    'border-top-color',
    'rgba(0, 0, 0, 0)',
  );
  await expect(page.locator('.dashboard-sidebar-feature')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.dashboard-content-shell')).toHaveCSS('transition-duration', '0s');

  await expect(page.locator('.comet-workbench-header')).toHaveCSS(
    'border-bottom-color',
    'rgb(32, 42, 58)',
  );
  await expect(page.locator('.comet-workbench-header')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.ant-steps-item-rail-wait').first()).toHaveCSS(
    'background-color',
    'rgb(58, 70, 88)',
  );

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const nativeSelectedItem = page.locator('.native-change-list-item.selected');
  await expect(nativeSelectedItem).toHaveCSS('background-color', 'rgb(27, 45, 72)');
  await expect(nativeSelectedItem).toHaveCSS('color', 'rgb(237, 242, 251)');

  await page.locator('.comet-project-select').click();
  await expect(page.locator('.comet-project-select-dropdown')).toHaveCSS(
    'background-color',
    'rgb(21, 25, 35)',
  );
  await expect(page.locator('.comet-project-select-dropdown')).toHaveCSS(
    'border-top-color',
    'rgb(41, 51, 69)',
  );
  await expect(page.locator('.comet-project-select-dropdown .ant-empty-description')).toHaveCSS(
    'color',
    'rgb(165, 180, 200)',
  );
});

test('uses the reference surface hierarchy across the workbench shell', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.locator('.dashboard-content-shell')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(page.locator('.dashboard-sidebar')).toHaveCSS(
    'border-right-color',
    'rgb(237, 240, 244)',
  );
  await expect(page.locator('.ant-card').first()).toHaveCSS('box-shadow', /rgba\(31, 43, 64/);
});

test('uses the reference dashboard rhythm for suggestions and grouped metrics', async ({
  page,
}) => {
  await page.goto('/?demo');

  const suggestion = page.getByRole('status', { name: '工作流建议' });
  await expect(suggestion).toBeVisible();
  await expect(suggestion).toContainText('下一步建议');

  const summary = page.locator('.dashboard-summary-strip');
  await expect(summary).toBeVisible();
  await expect(summary.locator('.dashboard-overview-summary-card').first()).toHaveCSS(
    'border-radius',
    '15px',
  );
  await expect(summary.locator('.dashboard-summary-metric-cell')).toHaveCount(5);
});

test('keeps Classic and Native overview metrics visually aligned and selectable', async ({
  page,
}) => {
  await page.goto('/?demo');

  const classicSummary = page.locator('.dashboard-overview-summary-strip');
  const classicCards = classicSummary.getByRole('button');
  await expect(classicCards).toHaveCount(5);
  await expect(classicSummary.locator('.dashboard-summary-icon')).toHaveCount(5);
  await expect(classicCards.first()).toHaveClass(/dashboard-summary-primary/);
  await classicCards.nth(3).click();
  await expect(classicCards.nth(3)).toHaveClass(/dashboard-summary-primary/);
  await expect(classicCards.first()).not.toHaveClass(/dashboard-summary-primary/);

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  const summary = page.locator('.dashboard-overview-summary-strip');
  const cards = summary.getByRole('button');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toHaveClass(/dashboard-summary-primary/);
  await expect(summary.locator('.dashboard-summary-icon')).toHaveCount(5);
  await expect(cards.first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveClass(/dashboard-summary-primary/);
  await expect(cards.first()).not.toHaveClass(/dashboard-summary-primary/);
});

test('balances heading scale and change-row density for dashboard scanning', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.getByRole('heading', { name: '项目概览' })).toHaveCSS('font-size', '18px');
  await expect(page.locator('.dashboard-section-hint').first()).toHaveCSS('font-size', '13px');
  await expect(page.locator('.dashboard-summary-card .dashboard-summary-metric').first()).toHaveCSS(
    'font-size',
    '30px',
  );

  const firstChange = page.getByRole('button', { name: /add-auth-rate-limiting/ });
  const firstChangeBox = await firstChange.boundingBox();
  if (!firstChangeBox) throw new Error('Expected the first Change row to have measurable bounds');
  expect(firstChangeBox.height).toBeGreaterThanOrEqual(64);
});

test('keeps workbench detail text comfortably readable without enlarging the overview', async ({
  page,
}) => {
  await page.goto('/?demo');

  await expect(page.locator('.dashboard-change-list .text-xs').first()).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(page.locator('.dashboard-workspace-region .text-\\[11px\\]').first()).toHaveCSS(
    'font-size',
    '12px',
  );
});

test('keeps the next-step alert clear of its neighboring detail sections', async ({ page }) => {
  await page.goto('/?demo');

  const [stepsBox, alertBox, panelsBox] = await Promise.all([
    page.locator('.ant-steps').boundingBox(),
    page.getByRole('alert').boundingBox(),
    page.locator('.change-detail-panels').boundingBox(),
  ]);
  if (!stepsBox || !alertBox || !panelsBox) {
    throw new Error('Expected the next-step alert and adjacent sections to have measurable bounds');
  }

  expect(alertBox.y - (stepsBox.y + stepsBox.height)).toBeGreaterThanOrEqual(28);
  expect(panelsBox.y - (alertBox.y + alertBox.height)).toBeGreaterThanOrEqual(28);
});

test('keeps a useful center-panel empty state when the Native change filter has no results', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('does-not-match-any-native-change');

  const emptyState = page
    .getByRole('heading', { name: '没有匹配的 Native change' })
    .locator('xpath=ancestor::section[1]');
  await expect(emptyState).toBeVisible();

  const emptyBox = await emptyState.boundingBox();
  if (!emptyBox) throw new Error('Expected Native center empty state to have measurable bounds');
  expect(emptyBox.width).toBeGreaterThan(700);
});

test('pins the desktop workbench frame while rich content scrolls in the center pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');

  const metrics = await page.evaluate(() => {
    const workbench = document.querySelector('.dashboard-workbench');
    const shell = document.querySelector('.dashboard-content-shell');
    if (!(workbench instanceof HTMLElement) || !(shell instanceof HTMLElement)) {
      throw new Error('Expected workbench and content shell elements');
    }
    return {
      pageScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      workbenchHeight: workbench.getBoundingClientRect().height,
      shellClientHeight: shell.clientHeight,
      shellScrollHeight: shell.scrollHeight,
      shellOverflowY: getComputedStyle(shell).overflowY,
    };
  });

  expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  expect(metrics.workbenchHeight).toBeLessThanOrEqual(metrics.viewportHeight - 31);
  expect(metrics.shellOverflowY).toBe('auto');
  expect(metrics.shellScrollHeight).toBeGreaterThan(metrics.shellClientHeight);
});

test('acknowledges a copied Change name and keeps the workbench within a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo');

  const copyChangeName = page.getByRole('button', { name: '复制 Change 名称' });
  await expect(copyChangeName).toHaveCount(1);
  await copyChangeName.click();
  await expect(page.getByRole('button', { name: '已复制 Change 名称' })).toBeVisible();

  const firstSummaryCard = page.locator('.dashboard-summary-card').nth(0);
  const secondSummaryCard = page.locator('.dashboard-summary-card').nth(1);
  const [firstSummaryBox, secondSummaryBox] = await Promise.all([
    firstSummaryCard.boundingBox(),
    secondSummaryCard.boundingBox(),
  ]);
  if (!firstSummaryBox || !secondSummaryBox) {
    throw new Error('Expected summary cards to have measurable bounds');
  }
  expect(secondSummaryBox.x).toBeGreaterThan(firstSummaryBox.x);
  expect(Math.abs(secondSummaryBox.y - firstSummaryBox.y)).toBeLessThanOrEqual(1);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test('fills the change explorer from five-row pages and continues on scroll', async ({ page }) => {
  const items = Array.from({ length: 13 }, (_, index) => ({
    id: `change-${index + 1}`,
    name: `change-${index + 1}`,
    displayName: `change-${index + 1}`,
    status: 'active',
    relativePath: `openspec/changes/change-${index + 1}`,
    workflow: 'feature',
    phase: 'build',
    updatedAt: '2026-08-03T00:00:00.000Z',
    tasks: { completed: index, total: 10 },
    verify: { result: 'pending' },
  }));
  const detailFor = (item) => ({
    ...item,
    dir: item.relativePath,
    changesRelative: 'openspec/changes',
    tasks: { ...item.tasks, incomplete: [], sections: [] },
    artifacts: {
      proposal: false,
      design: false,
      tasks: false,
      plan: false,
      verifyReport: false,
      cometYaml: false,
      grouped: [],
    },
    artifactPreviews: [],
    verify: { ...item.verify, reportExists: false },
    next: { command: null, reason: '', description: '' },
    risks: [],
  });
  const pageRequests: string[] = [];

  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'fixture-project',
          projects: [
            {
              id: 'fixture-project',
              name: 'Fixture',
              path: '/fixture',
              lastSeenAt: null,
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-03T00:00:00.000Z' },
          summary: {
            activeChanges: items.length,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 36,
            dirtyFiles: 0,
          },
          initialChanges: {
            status: 'active',
            items: items.slice(0, 5),
            total: items.length,
            nextCursor: '5',
          },
          git: {
            branch: 'main',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/changes')) {
      pageRequests.push(url.search);
      const status = url.searchParams.get('status') ?? 'active';
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      await route.fulfill({
        json: {
          status,
          items: items.slice(offset, offset + 5),
          total: items.length,
          nextCursor: offset + 5 < items.length ? String(offset + 5) : null,
        },
      });
      return;
    }
    if (url.pathname.endsWith('/change')) {
      const item = items.find((entry) => entry.id === url.searchParams.get('changeId')) ?? items[0];
      await route.fulfill({ json: detailFor(item) });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.locator('.dashboard-workspace-center')).toBeVisible();
  await page.getByRole('tab', { name: '全部' }).click();

  const list = page.getByRole('tabpanel', { name: '全部' }).locator('.dashboard-change-list');
  await expect(list.locator('.dashboard-change-list-item')).toHaveCount(10);
  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=all')).length)
    .toBeGreaterThanOrEqual(2);

  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=all')).length)
    .toBeGreaterThanOrEqual(3);
  await expect(list.locator('.dashboard-change-list-item')).toHaveCount(13);
});

test('keeps the Native change list scrollable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo');
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  const list = page.locator('.native-change-list');
  await expect(list.locator('.native-change-row')).toHaveCount(5);
  const initialCount = await list.locator('.native-change-row').count();

  const metrics = await list.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(metrics.overflowY).toBe('visible');
  expect(metrics.scrollHeight).toBe(metrics.clientHeight);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => list.locator('.native-change-row').count()).toBeGreaterThan(initialCount);
});

test('fills a server-paged Native list when its footer is already visible', async ({ page }) => {
  const nativeItems = Array.from({ length: 8 }, (_, index) => ({
    workflow: 'native',
    name: `native-${index + 1}`,
    status: 'archived',
    archiveName: `2026-08-04-native-${index + 1}`,
    archivedAt: '2026-08-04',
    phase: 'archive',
    lifecycleStatus: 'done',
    stateVersion: index + 1,
    legacy: false,
    migration: { status: 'none', message: null },
    loop: {
      stage: 'done',
      goalCycle: 1,
      iteration: index + 1,
      attempt: 1,
      nextAction: null,
      actor: null,
    },
    acceptance: { total: 1, passed: 1, failed: 0, blocked: 0, pending: 0 },
    verificationResult: 'pass',
    localExecution: {
      status: 'absent',
      reason: 'archived',
      stage: null,
      actor: null,
      startedAt: null,
      requestCheckRounds: 0,
      checks: [],
      recoverableFromStage: null,
    },
    artifacts: [],
    specs: {
      total: 0,
      create: 0,
      modify: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [
      { id: 'A1', source: 'brief.md', text: '归档验收通过。', result: 'passed', reason: null },
    ],
    builderHandoff: null,
    verification: {
      verdict: 'pass',
      assurance: 'host-attested',
      summary: { text: '验证通过。', truncated: false },
      risks: [],
      risksTruncated: false,
      completedAt: '2026-08-04T00:00:00.000Z',
    },
    checks: [],
    blockers: [],
    history: [],
    historyOverflow: {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  }));

  const pageRequests: string[] = [];
  const detailRequests: string[] = [];
  let releaseFirstPage = () => {};
  const firstPageGate = new Promise<void>((resolve) => {
    releaseFirstPage = resolve;
  });
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'fixture-project',
          projects: [
            {
              id: 'fixture-project',
              name: 'Fixture',
              path: '/fixture',
              lastSeenAt: null,
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-04T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: {
            schema: 'comet.dashboard.native.v2',
            generatedAt: '2026-08-04T00:00:00.000Z',
            totalChangeCount: nativeItems.length,
            visibleChangeCount: 0,
            archivedChangeCount: nativeItems.length,
            changes: [],
            activeChangeCount: 0,
            omittedChangeCount: nativeItems.length,
            changesTruncated: true,
          },
          git: {
            branch: 'main',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/native-changes')) {
      pageRequests.push(url.search);
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      if (offset === 0) await firstPageGate;
      await route.fulfill({
        json: {
          status: 'archived',
          items: nativeItems.slice(offset, offset + 5),
          total: nativeItems.length,
          nextCursor: offset + 5 < nativeItems.length ? String(offset + 5) : null,
        },
      });
      return;
    }
    if (url.pathname.endsWith('/native-change')) {
      const name = url.searchParams.get('changeName');
      detailRequests.push(name ?? '');
      await route.fulfill({ json: nativeItems.find((change) => change.name === name) });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 896, height: 2000 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await page.getByRole('tab', { name: '已归档' }).click();

  const list = page.locator('.native-change-list');
  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.native-changes-count')).toHaveText('8');
  await expect(list.locator('.ant-spin')).toBeVisible();
  await expect(list.getByText('暂无已归档变更')).toHaveCount(0);
  releaseFirstPage();
  await expect.poll(() => pageRequests.length).toBeGreaterThanOrEqual(2);
  await expect(list.locator('.native-change-row')).toHaveCount(8);
  await expect.poll(() => detailRequests).toContain('native-1');
  await list.locator('.native-change-row').nth(1).click();
  await expect.poll(() => detailRequests).toContain('native-2');
  await expect(page.locator('.native-change-detail h3')).toHaveText('native-2');
});

test('keeps the current Classic detail visible while another change loads', async ({ page }) => {
  const changes = [
    { id: 'classic-one', displayName: 'classic-one' },
    { id: 'classic-two', displayName: 'classic-two' },
  ].map((entry, index) => ({
    ...entry,
    name: entry.id,
    status: 'active',
    relativePath: `openspec/changes/${entry.id}`,
    workflow: 'feature',
    phase: 'build',
    updatedAt: '2026-08-04T00:00:00.000Z',
    tasks: { completed: index + 1, total: 2 },
    verify: { result: 'pending', reportExists: false },
  }));
  let firstDetailStarted = false;
  let secondDetailStarted = false;

  const detailFor = (change) => ({
    ...change,
    dir: change.relativePath,
    changesRelative: 'openspec/changes',
    tasks: { ...change.tasks, incomplete: [], sections: [] },
    artifacts: {
      proposal: false,
      design: false,
      tasks: false,
      plan: false,
      verifyReport: false,
      cometYaml: false,
      grouped: [],
    },
    artifactPreviews: [],
    verify: { ...change.verify, reportExists: false },
    next: { command: null, reason: '', description: '' },
    risks: [],
  });

  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'fixture-project',
          projects: [
            {
              id: 'fixture-project',
              name: 'Fixture',
              path: '/fixture',
              lastSeenAt: null,
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-04T00:00:00.000Z' },
          summary: {
            activeChanges: changes.length,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 1,
            dirtyFiles: 0,
          },
          initialChanges: {
            status: 'active',
            items: changes,
            total: changes.length,
            nextCursor: null,
          },
          git: {
            branch: 'main',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/changes')) {
      await route.fulfill({
        json: { status: 'active', items: changes, total: changes.length, nextCursor: null },
      });
      return;
    }
    if (url.pathname.endsWith('/change')) {
      const change =
        changes.find((entry) => entry.id === url.searchParams.get('changeId')) ?? changes[0];
      if (change.id === 'classic-one') {
        firstDetailStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 600));
      } else if (change.id === 'classic-two') {
        secondDetailStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await route.fulfill({ json: detailFor(change) });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect.poll(() => firstDetailStarted).toBe(true);
  const loadingCenter = await page.locator('.dashboard-workspace-center').boundingBox();
  const loadingExplorer = await page.locator('.classic-changes-explorer').boundingBox();
  if (!loadingCenter) throw new Error('Expected loading detail layout bounds');
  expect(loadingCenter.height).toBeGreaterThanOrEqual(480);

  const detailTitle = page.locator('.change-detail > .ant-card-head .ant-card-head-title');
  await expect(detailTitle).toHaveText('classic-one');
  const loadedExplorer = await page.locator('.classic-changes-explorer').boundingBox();
  if (!loadingExplorer || !loadedExplorer) throw new Error('Expected Classic explorer bounds');
  expect(Math.abs(loadedExplorer.height - loadingExplorer.height)).toBeLessThanOrEqual(1);
  const before = await page.locator('.dashboard-workspace-center').boundingBox();

  await page.locator('.dashboard-change-row').filter({ hasText: 'classic-two' }).click();
  await expect.poll(() => secondDetailStarted).toBe(true);
  await expect(detailTitle).toHaveText('classic-one');
  const during = await page.locator('.dashboard-workspace-center').boundingBox();
  if (!before || !during) throw new Error('Expected detail layout bounds');
  expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1);

  await expect(detailTitle).toHaveText('classic-two');
});

test('uses one selection surface for the Classic change row', async ({ page }) => {
  await page.goto('/?demo');

  const row = page.locator('.dashboard-change-row').nth(1);
  await row.click();
  await expect(row).toHaveCSS('background-color', 'rgb(237, 244, 255)');

  const layers = await row.evaluate((element) => {
    const wrapper = element.parentElement;
    if (!(wrapper instanceof HTMLElement)) throw new Error('Missing change row wrapper');
    return {
      wrapperBackground: getComputedStyle(wrapper).backgroundColor,
      rowBackground: getComputedStyle(element).backgroundColor,
      rowClassName: element.className,
    };
  });

  expect(layers.wrapperBackground).toBe('rgba(0, 0, 0, 0)');
  expect(layers.rowClassName).toContain('dashboard-change-row-selected');
  expect(layers.rowBackground).toBe('rgb(237, 244, 255)');
});

test('keeps the Classic change explorer frame stable when selecting a change', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1005 });
  await page.goto('/?demo');
  const row = page.locator('.dashboard-change-row').nth(1);
  await expect(row).toBeVisible();
  const before = await page.locator('.classic-changes-explorer').boundingBox();
  await row.click({ noWaitAfter: true });
  const after = await page.locator('.classic-changes-explorer').boundingBox();
  if (!before || !after) throw new Error('Expected Classic change explorer bounds');
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test('keeps Classic and Native side panels within the center panel height', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1005 });
  await page.goto('/?demo');

  const expectWorkspacePanels = async ({ native = false } = {}) => {
    const workspace = page.locator('.dashboard-workspace-region');
    const center = workspace.locator('.dashboard-workspace-center');
    const sides = workspace.locator('.dashboard-workspace-side');
    const changeList = page.locator('.dashboard-change-list');
    const contentShell = page.locator('.dashboard-content-shell');
    await expect(center).toBeVisible();
    await expect(sides).toHaveCount(2);
    if (await changeList.count()) {
      await expect(changeList).toHaveCSS('scrollbar-width', 'none');
    }
    await expect(contentShell).toHaveCSS('scrollbar-width', 'none');
    const rightPanel = workspace.locator('.dashboard-workspace-right');
    await expect(rightPanel).toHaveCSS('border-top-width', '1px');
    if (!native) {
      await expect
        .poll(() => rightPanel.evaluate((element) => element.scrollHeight > element.clientHeight))
        .toBe(true);
    }
    const workspaceFrame = workspace.locator(
      native ? '.native-changes-explorer' : '.classic-changes-explorer',
    );
    await expect(workspaceFrame).toHaveCSS('border-top-width', '1px');
    await expect(workspaceFrame).toHaveCSS('border-bottom-width', '1px');
    await expect(workspaceFrame).toHaveCSS('overflow-y', 'hidden');
    const [centerBox, frameBox] = await Promise.all([
      center.boundingBox(),
      workspaceFrame.boundingBox(),
    ]);
    if (!centerBox || !frameBox) throw new Error('Expected workspace frame bounds');
    expect(frameBox.height).toBeLessThanOrEqual(centerBox.height + 1);
    expect(frameBox.height).toBeGreaterThanOrEqual(centerBox.height - 1);
    if (!native) {
      const classicDetail = workspace.locator('.change-detail');
      const detailBox = await classicDetail.boundingBox();
      if (!detailBox) throw new Error('Expected Classic detail bounds');
      expect(Math.abs(detailBox.height - centerBox.height)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(detailBox.y + detailBox.height - (centerBox.y + centerBox.height)),
      ).toBeLessThanOrEqual(1);
      await expect(classicDetail).toHaveCSS('overflow-y', 'auto');
    }
    if (native) {
      await expect(workspace.locator('.dashboard-workspace-left')).toHaveCSS('overflow-y', 'auto');
      const nativeExplorer = workspace.locator('.native-changes-explorer');
      const nativeList = workspace.locator('.native-change-list');
      const nativeDetail = workspace.locator('.native-change-detail');
      const rightPanel = workspace.locator('.dashboard-workspace-right');
      const nativeCount = nativeExplorer.locator('.native-changes-count');
      await expect(nativeCount).toHaveText(/^\d+$/);
      await expect(nativeCount).toHaveCSS('background-color', 'rgb(11, 24, 51)');
      await expect(nativeCount).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(nativeCount).toHaveCSS('min-width', '20px');
      await expect(nativeCount).toHaveCSS('padding', '0px 8px');
      await expect(nativeCount).toHaveCSS('font-weight', '400');
      await expect(nativeCount).toHaveCSS(
        'font-family',
        '"Segoe UI Variable", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
      );
      await expect(nativeCount).toHaveCSS('letter-spacing', '-0.182px');
      await expect(nativeCount).toHaveCSS('white-space', 'nowrap');
      await expect(nativeExplorer).toHaveCSS('font-size', '14px');
      const nativeHeader = nativeExplorer.locator('.native-changes-explorer-header');
      await expect(nativeHeader).toHaveCSS('min-height', '57px');
      await expect(nativeHeader).toHaveCSS('padding-left', '20px');
      const nativeBody = nativeExplorer.locator('.native-changes-explorer-body');
      await expect(nativeBody).toHaveCSS('padding', '20px');
      const nativeTabs = nativeExplorer.locator('.native-changes-explorer-tabs');
      await expect(nativeTabs).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(nativeTabs).toHaveCSS('border-bottom-width', '1px');
      await expect(nativeTabs).toHaveCSS('height', '44px');
      await expect(nativeTabs).toHaveCSS('margin-bottom', '16px');
      await expect(nativeTabs.getByRole('tab')).toHaveCount(3);
      const activeNativeTab = nativeTabs.locator('[role="tab"][aria-selected="true"]');
      await expect(activeNativeTab).toHaveCSS('border-bottom-width', '2px');
      await expect(activeNativeTab).toHaveCSS('border-bottom-color', 'rgb(37, 94, 216)');
      await expect(rightPanel).toHaveCSS('border-radius', '15px');
      await expect(nativeExplorer).toHaveCSS('border-radius', '15px');
      await expect(nativeDetail).toHaveCSS('border-radius', '15px');
      const [nativeCenterBox, nativeDetailBox] = await Promise.all([
        center.boundingBox(),
        nativeDetail.boundingBox(),
      ]);
      if (!nativeCenterBox || !nativeDetailBox) throw new Error('Expected Native detail bounds');
      expect(Math.abs(nativeDetailBox.height - nativeCenterBox.height)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          nativeDetailBox.y + nativeDetailBox.height - (nativeCenterBox.y + nativeCenterBox.height),
        ),
      ).toBeLessThanOrEqual(1);
      await expect(nativeDetail).toHaveCSS('overflow-y', 'auto');
      await expect(nativeExplorer).toHaveCSS('border-top-width', '1px');
      await expect(nativeExplorer).toHaveCSS('border-bottom-width', '1px');
      await expect(nativeExplorer).toHaveCSS('overflow-y', 'hidden');
      await expect(nativeList).toHaveCSS('overflow-y', 'auto');
      await expect(nativeList).toHaveCSS('scrollbar-width', 'none');
      await expect(nativeList).toHaveCSS('font-size', '14px');
      const selectedNativeItem = nativeList.locator('.native-change-list-item.selected');
      await expect(selectedNativeItem).toHaveCount(1);
      await expect(selectedNativeItem).toHaveCSS('background-color', 'rgb(237, 244, 255)');
      await expect(selectedNativeItem).toHaveCSS('border-radius', '11px');
      const selectedNativeRow = selectedNativeItem.locator('.native-change-row');
      await expect(selectedNativeRow).toHaveCSS('min-height', '72px');
      await expect(selectedNativeRow).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)');
      await expect(selectedNativeRow).toHaveCSS('border-radius', '10px');
      await expect(selectedNativeRow.locator('.truncate')).toHaveCSS('font-size', '14px');
      await expect(selectedNativeRow.getByText('◇', { exact: true })).toHaveCount(0);
      await expect(selectedNativeRow).toContainText('Build · 构建中 · 第2轮/第1次');
      const nativeProgress = selectedNativeRow.getByRole('progressbar');
      await expect(nativeProgress).toHaveCount(1);
      await expect(nativeProgress).toHaveAttribute('aria-valuenow', '50');
      const recoverySection = rightPanel
        .getByRole('heading', { name: '恢复状态' })
        .locator('..')
        .locator('..');
      await expect(recoverySection).toContainText('与当前 YAML 一致');
      await expect(recoverySection).toContainText('Builder');
    }

    const metrics = await workspace.evaluate((element) => {
      const centerElement = element.querySelector('.dashboard-workspace-center');
      if (!(centerElement instanceof HTMLElement)) throw new Error('Missing center panel');
      const centerBox = centerElement.getBoundingClientRect();
      return [...element.querySelectorAll('.dashboard-workspace-side')].map((side) => {
        if (!(side instanceof HTMLElement)) throw new Error('Invalid side panel');
        const box = side.getBoundingClientRect();
        return {
          centerHeight: centerBox.height,
          sideHeight: box.height,
          contentHeight: side.scrollHeight,
          visibleHeight: side.clientHeight,
          overflowY: getComputedStyle(side).overflowY,
          maxHeight: getComputedStyle(side).maxHeight,
          scrollbarWidth: getComputedStyle(side).scrollbarWidth,
        };
      });
    });

    for (const metric of metrics) {
      expect(metric.sideHeight).toBeLessThanOrEqual(metric.centerHeight + 1);
      expect(['auto', 'visible']).toContain(metric.overflowY);
      expect(metric.maxHeight).not.toBe('none');
      expect(metric.scrollbarWidth).toBe('none');
    }

    const scrollTarget = native
      ? workspace.locator('.native-change-list')
      : workspace.locator('.dashboard-change-list');
    await expect
      .poll(() => scrollTarget.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
  };

  await expectWorkspacePanels();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expectWorkspacePanels({ native: true });

  const nativeList = page.locator('.native-change-list');
  const initiallyRendered = await nativeList.locator('.native-change-row').count();
  expect(initiallyRendered).toBeGreaterThanOrEqual(5);
  expect(initiallyRendered).toBeLessThan(27);
  await nativeList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => nativeList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(() => nativeList.locator('.native-change-row').count())
    .toBeGreaterThan(initiallyRendered);
});
