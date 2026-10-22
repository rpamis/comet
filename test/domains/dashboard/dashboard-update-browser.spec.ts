import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function setDashboardTheme(page: Page, theme: 'light' | 'dark') {
  const settings = page.getByRole('button', { name: /^(设置|Settings)$/ });
  if (!(await settings.isVisible()))
    await page.getByRole('button', { name: /^(展开导航|Open navigation)$/ }).click();
  await settings.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('menuitem', { name: /外观|Appearance/ }).click();
  await dialog
    .getByRole('radio', { name: theme === 'dark' ? /^(暗色|Dark)$/ : /^(亮色|Light)$/ })
    .check();
  await dialog.getByRole('button', { name: /^(完成|Done)$/ }).click();
}

const info = {
  currentVersion: '0.5.0',
  latestVersion: '0.5.1',
  hasUpdate: true,
  checked: true,
  projectRevision: 'fixture-scope',
  projects: ['/project-a', '/project-b'],
  job: null,
};
const entry = (sequence: number, text: string, stream = 'stdout') => ({ sequence, text, stream });
const running = {
  id: 'update-one',
  status: 'running',
  version: '0.5.1',
  startedAt: '2026-10-11T12:00:00Z',
  finishedAt: null,
  exitCode: null,
  cursor: 1,
  truncated: false,
  entries: [entry(1, '$ comet update --all-projects --yes --target-version 0.5.1\n')],
};
test.beforeEach(async ({ page }) => {
  const { DEMO_PROJECT_CONFIG } = await import('../../../domains/dashboard/web/demo.js');
  await page.route('**/api/dashboard/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/dashboard/update') return route.fulfill({ json: info });
    if (pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'fixture',
          projects: [
            {
              id: 'fixture',
              name: 'Comet',
              path: '/project-a',
              availability: 'available',
              isCurrent: true,
            },
          ],
        },
      });
    if (pathname.endsWith('/overview'))
      return route.fulfill({
        json: {
          project: { name: 'Comet', path: '/project-a' },
          summary: {},
          initialChanges: { items: [], total: 0 },
          git: {},
          native: null,
        },
      });
    if (pathname.endsWith('/plugins')) return route.fulfill({ json: { pages: [] } });
    if (pathname.endsWith('/config')) return route.fulfill({ json: DEMO_PROJECT_CONFIG });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
});
test('refresh keeps the System footer quiet while version information loads', async ({
  page,
}, testInfo) => {
  let release: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/dashboard/update', async (route) => {
    await pending;
    await route.fulfill({ json: info });
  });
  await page.goto('/');
  const version = page.getByRole('button', { name: 'Comet 版本与更新' });
  try {
    await expect(version).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('footer-version-pending.png'),
      animations: 'disabled',
    });
    await expect(version.locator('.ant-spin')).toHaveCount(0);
    await expect(version).toHaveText('Comet');
  } finally {
    release!();
  }
  await expect(version).toContainText('v0.5.0');
});

test('shows the version beside System and opens a reviewable update without executing it', async ({
  page,
}) => {
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST') writes++;
  });
  await page.goto('/');
  const version = page.getByRole('button', { name: 'Comet 版本与更新' });
  await expect(version).toContainText('v0.5.0');
  await expect(version).toContainText('new');
  await expect(version.locator('.dashboard-version-number')).toHaveCSS('font-size', '14px');
  await expect(version.locator('.dashboard-version-new')).toHaveCSS('color', 'rgb(220, 38, 38)');
  const heading = page.locator('.dashboard-sidebar-footer .dashboard-system-heading');
  await expect(heading).toContainText('系统');
  const bounds = await heading.boundingBox();
  expect(bounds!.width).toBeLessThan(210);
  const historyLength = await page.evaluate(() => history.length);
  await version.click();
  const dialog = page.getByRole('dialog', { name: /^Comet 更新/u });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(page.getByRole('heading', { name: 'v0.5.1', exact: true })).toBeVisible();
  await expect(page.getByText('/project-b', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认更新', exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await expect(page).toHaveURL(new URL('/', test.info().project.use.baseURL).href);
  await page.screenshot({
    path: test.info().outputPath('update-review-desktop.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '暂不更新', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toBe(0);
  await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
  await page.getByRole('button', { name: 'Comet version and updates' }).click();
  await expect(page.getByRole('button', { name: 'Confirm update', exact: true })).toBeVisible();
  await expect(page.getByText('Current Dashboard version', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^Comet update/u })).toBeHidden();
  await page.getByRole('button', { name: 'Comet version and updates' }).click();
  await page
    .locator('.dashboard-update-modal-root .ant-modal-wrap')
    .click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole('dialog', { name: /^Comet update/u })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Comet version and updates' }).click();
  await expect(page.getByRole('dialog', { name: /^Comet update/u })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath('update-review-narrow.png'),
    animations: 'disabled',
  });
  expect(writes).toBe(0);
});
test('streams progress, survives navigation and reload, then shows completion and restart guidance', async ({
  page,
}) => {
  let job: typeof running | null = null;
  let starts = 0;
  await page.route('**/api/dashboard/update', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toEqual({
        confirmed: true,
        version: '0.5.1',
        projectRevision: 'fixture-scope',
      });
      starts++;
      job = structuredClone(running);
      return route.fulfill({ status: 202, json: job });
    }
    return route.fulfill({ json: { ...info, job } });
  });
  await page.route('**/api/dashboard/update/job?*', (route) => {
    const after = Number(new URL(route.request().url()).searchParams.get('after'));
    return route.fulfill({
      json: job && { ...job, entries: job.entries.filter((item) => item.sequence > after) },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Comet 版本与更新' }).click();
  await page.getByRole('button', { name: '确认更新', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('--all-projects');
  job = {
    ...running,
    cursor: 2,
    entries: [...running.entries, entry(2, 'Updating /project-a\nnpm installing packages\n')],
  };
  await expect(page.getByRole('log')).toContainText('npm installing packages');
  await expect(page.getByRole('button', { name: '确认更新', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /^Comet 更新/u })).toBeHidden();
  job = {
    ...job!,
    cursor: 3,
    entries: [...job!.entries, entry(3, 'Continuing while dialog is closed\n')],
  };
  await page.getByRole('menuitem', { name: 'Classic 工作流' }).click();
  await page.getByRole('button', { name: 'Comet 版本与更新' }).click();
  await expect(page.getByRole('log')).toContainText('Updating /project-a');
  await page.reload();
  await expect(page.getByRole('dialog', { name: /^Comet 更新/u })).toHaveCount(0);
  await page.getByRole('button', { name: 'Comet 版本与更新' }).click();
  await expect(page.getByRole('log')).toContainText('Updating /project-a');
  await expect(page.getByRole('log')).toContainText('Continuing while dialog is closed');
  expect(starts).toBe(1);
  job = {
    ...job!,
    status: 'completed',
    exitCode: 0,
    cursor: 4,
    entries: [...job!.entries, entry(4, 'Updated 2 indexed project(s).\n')],
  } as typeof running;
  await expect(page.getByText('更新命令执行完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('Updated 2 indexed project(s).');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await setDashboardTheme(page, 'dark');
  await page.getByRole('button', { name: 'Comet 版本与更新' }).click();
  await page.screenshot({
    path: test.info().outputPath('update-log-dark.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: test.info().outputPath('update-log-narrow.png'),
    animations: 'disabled',
  });
  expect(starts).toBe(1);
});
test('reports update failures with the exit code and allows an explicit retry', async ({
  page,
}) => {
  await page.route('**/api/dashboard/update', (route) =>
    route.fulfill({
      json: {
        ...info,
        job: {
          ...running,
          status: 'failed',
          exitCode: 1,
          entries: [entry(1, 'npm ERR! update failed\n', 'stderr')],
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Comet 版本与更新' }).click();
  await expect(page.getByRole('log')).toContainText('npm ERR! update failed');
  await expect(page.getByRole('button', { name: '确认重试更新', exact: true })).toBeVisible();
  await expect(page.getByText(/退出码：1/)).toBeVisible();
});
for (const checked of [true, false]) {
  test(`does not offer confirmation when no newer release is known (${checked})`, async ({
    page,
  }) => {
    await page.route('**/api/dashboard/update', (route) =>
      route.fulfill({
        json: { ...info, latestVersion: checked ? '0.5.0' : null, hasUpdate: false, checked },
      }),
    );
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Comet 版本与更新' });
    await expect(button).not.toContainText('new');
    await button.click();
    await expect(
      page.getByText(checked ? '当前无需更新' : '版本检查暂不可用', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '确认更新', exact: true })).toHaveCount(0);
  });
}
