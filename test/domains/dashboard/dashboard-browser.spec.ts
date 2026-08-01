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
  await expect(page.getByRole('heading', { name: '最近进展' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '变更范围' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '验收覆盖' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repair 状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Git 摘要' })).toBeVisible();
  await expect(page.getByRole('button', { name: '活跃', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '已归档', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ship-native-dashboard' })).toBeVisible();
  const nativeCopyChangeName = page.getByRole('button', { name: '复制 Change 名称' });
  await expect(nativeCopyChangeName).toHaveCount(1);
  await nativeCopyChangeName.click();
  await expect(page.getByRole('button', { name: '已复制 Change 名称' })).toBeVisible();

  await page.getByRole('button', { name: '需求简报' }).click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeVisible();
  await expect(page.getByText('Ship a dedicated Native dashboard view.')).toBeVisible();
  await page.getByRole('button', { name: '关闭产物预览' }).last().click();

  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'document-native-resume' })).toBeVisible();
  await expect(page.getByLabel('Archive 已完成')).toHaveText('✓');
  await expect(page.getByText('已完成 · 已归档', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成 · 无需后续操作', { exact: true })).toBeVisible();

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
