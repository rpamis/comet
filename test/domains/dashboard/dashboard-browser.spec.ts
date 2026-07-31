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

  await page.getByText('Native', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Native', exact: true })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近进展' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '变更范围' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '验收覆盖' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Repair 状态' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Git 摘要' })).toBeVisible();
  await expect(page.getByRole('button', { name: '活跃' })).toBeVisible();
  await expect(page.getByRole('button', { name: '已归档' })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ship-native-dashboard' })).toBeVisible();

  await page.getByRole('button', { name: '需求简报' }).click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeVisible();
  await expect(page.getByText('Ship a dedicated Native dashboard view.')).toBeVisible();
  await page.getByRole('button', { name: '关闭产物预览' }).last().click();

  await page.getByRole('button', { name: '已归档' }).click();
  await expect(page.getByRole('heading', { name: 'document-native-resume' })).toBeVisible();
  await expect(page.getByLabel('Archive 已完成')).toHaveText('✓');
  await expect(page.getByText('已完成 · 已归档', { exact: true })).toBeVisible();
  await expect(page.getByText('已完成 · 无需后续操作', { exact: true })).toBeVisible();

  await page.getByText('Classic', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Classic', exact: true })).toBeChecked();
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
  await expect(summaryCard).toHaveCSS('border-top-color', 'rgb(221, 226, 232)');

  await summaryCard.hover();
  await expect(summaryCard).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -1)');

  const workbench = page.locator('.dashboard-workbench');
  await expect(workbench).toHaveCSS('background-color', 'rgb(246, 248, 251)');

  await page.getByRole('button', { name: '切换到暗色模式' }).click();
  await expect(page.locator('.ant-alert-info')).toHaveCSS('background-color', 'rgb(26, 32, 43)');
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
  await expect(header).toHaveCSS('min-height', '60px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'min-height',
    '38px',
  );
  await expect(page.getByRole('button', { name: '立即刷新' })).toHaveText('');
});

test('balances heading scale and change-row density for dashboard scanning', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.getByRole('heading', { name: '项目概览' })).toHaveCSS('font-size', '20px');
  await expect(page.getByText('生成于 2026-06-25 22:32')).toHaveCSS('font-size', '13px');
  await expect(page.locator('.dashboard-summary-card .ant-statistic-content').first()).toHaveCSS(
    'font-size',
    '28px',
  );

  const firstChange = page.getByRole('button', { name: /add-auth-rate-limiting/ });
  const firstChangeBox = await firstChange.boundingBox();
  if (!firstChangeBox) throw new Error('Expected the first Change row to have measurable bounds');
  expect(firstChangeBox.height).toBeGreaterThanOrEqual(64);
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
