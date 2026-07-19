import { expect, test } from '@playwright/test';

test('loads the demo dashboard and previews an artifact', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');

  await expect(page).toHaveTitle('Comet Dashboard');
  await expect(page.getByText('Comet Dashboard').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeHidden();

  await page.getByRole('button', { name: 'Native', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Native', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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

  await page.getByRole('button', { name: 'Classic', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Classic', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
