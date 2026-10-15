import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const workflow of ['Classic', 'Native']) {
  test(`${workflow} keeps the center frame when a summary filter has no matches`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1760, height: 1000 });
    await page.goto('/?demo');
    await page.getByRole('menuitem', { name: `${workflow} 工作流` }).click();
    const search = page.locator('.comet-header-search input');
    await page
      .locator('.dashboard-overview-summary-strip')
      .getByRole('button', { name: workflow === 'Native' ? /失败或阻塞/ : /Verify 失败/ })
      .click();
    await search.fill('no-matching-change-frame-check');
    await expect(page.getByText('没有符合当前筛选的变更', { exact: true })).toBeVisible();
    const center = page.locator('.dashboard-workspace-center > *').first();
    const right = page.locator('.dashboard-workspace-right');
    const style = (element: Element) => {
      const css = getComputedStyle(element);
      return {
        borderWidth: css.borderTopWidth,
        borderColor: css.borderTopColor,
        radius: css.borderTopLeftRadius,
        background: css.backgroundColor,
      };
    };
    const expected = await right.evaluate(style);
    expect(await center.evaluate(style)).toEqual(expected);
    expect((await center.boundingBox())!.height).toBeGreaterThanOrEqual(320);
    await page.getByRole('button', { name: '切换到暗色模式', exact: true }).click();
    expect(await center.evaluate(style)).toEqual(await right.evaluate(style));
    await page.screenshot({
      path: path.join(os.tmpdir(), `comet-${workflow.toLowerCase()}-empty-frame.png`),
    });
    await page.setViewportSize({ width: 720, height: 1000 });
    expect(await center.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await search.fill('');
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(page.getByText('没有符合当前筛选的变更', { exact: true })).toHaveCount(0);
    await expect(
      page.locator(
        `.dashboard-workspace-center .${workflow === 'Native' ? 'native-change-detail' : 'change-detail'}`,
      ),
    ).toBeVisible();
  });
}

test('drags the font slider in dark mode and scales Tailwind, code and AntD controls once', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.getByRole('button', { name: '切换到暗色模式', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('menuitem', { name: '外观' }).click();
  const selectors = [
    '.dashboard-section-heading',
    '.dashboard-workbench code',
    '.dashboard-font-size-actions .ant-btn',
  ];
  const sizes = async () =>
    page.evaluate(
      (selectors) =>
        selectors.map((selector) =>
          parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize),
        ),
      selectors,
    );
  const original = await sizes();
  const track = dialog.locator('.ant-slider');
  const bounds = (await track.boundingBox())!;
  await page.mouse.click(
    bounds.x + (bounds.width * (125 - 90)) / (150 - 90),
    bounds.y + bounds.height / 2,
  );
  await expect(dialog.getByRole('slider')).toHaveAttribute('aria-valuenow', '125');
  await expect.poll(sizes).toEqual(original.map((size) => size * 1.25));
  const second = await context.newPage();
  await second.goto('/?demo');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() =>
      second.evaluate(() =>
        document.documentElement.style.getPropertyValue('--dashboard-font-scale'),
      ),
    )
    .toBe('1.25');
  await dialog.getByRole('slider').focus();
  await dialog.getByRole('slider').press('Home');
  await expect
    .poll(() =>
      second.evaluate(() =>
        document.documentElement.style.getPropertyValue('--dashboard-font-scale'),
      ),
    )
    .toBe('0.9');
  await dialog.getByRole('slider').press('End');
  await page.screenshot({ path: path.join(os.tmpdir(), 'comet-dashboard-font-size-dark.png') });
  await second.close();
});

test('adjusts all dashboard typography live and restores the browser preference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  const sidebarText = page
    .locator('.dashboard-sidebar')
    .getByRole('menuitem', { name: '个人记忆' });
  const original = await sidebarText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Comet 设置/u });
  await dialog.getByRole('menuitem', { name: '外观' }).click();
  const slider = dialog.getByRole('slider', { name: '字体大小', exact: true });
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  const sample = dialog.locator(
    '.dashboard-appearance-settings .dashboard-settings-section-head p',
  );
  const sampleSize = await sample.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '150');
  await expect
    .poll(() => sample.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeCloseTo(sampleSize * 1.5, 1);
  await expect
    .poll(() => sidebarText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeCloseTo(original * 1.5, 1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('comet-dashboard-font-scale')))
    .toBe('150');
  await page.reload();
  await expect
    .poll(() => sidebarText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeCloseTo(original * 1.5, 1);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await dialog.getByRole('menuitem', { name: '外观' }).click();
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(dialog.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  await expect
    .poll(() => sidebarText.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeCloseTo(original, 1);
});

test('keeps appearance usable in a narrow English dashboard without project data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await page.route('**/api/dashboard/**', (route) =>
    route.fulfill({ json: { projects: [], pages: [] } }),
  );
  await page.goto('/');
  await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('menuitem', { name: 'Appearance' }).click();
  const slider = dialog.getByRole('slider', { name: 'Font size', exact: true });
  await slider.focus();
  await slider.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '150');
  await expect(dialog.getByRole('button', { name: 'Reset to default', exact: true })).toBeVisible();
  expect(
    await dialog
      .locator('.dashboard-settings-content')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
});

test('restores memory and knowledge reading state when switching workspaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const memory = page.locator('.dashboard-tool-page-memory');
  await expect(page.locator('.comet-header-search')).toHaveCount(0);
  await memory
    .locator('.dashboard-memory-filter-rail button')
    .filter({ hasText: '协作约定' })
    .click();
  await page.getByLabel('搜索个人记忆').fill('Dashboard');
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expect(page.locator('.comet-header-search')).toHaveCount(0);
  await page.getByRole('tab', { name: '项目规范', exact: true }).click();
  await page.getByLabel('搜索项目知识记录').fill('测试');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await expect(page.getByLabel('搜索个人记忆')).toHaveValue('Dashboard');
  await expect(memory.locator('.dashboard-memory-filter-rail button.is-active')).toContainText(
    '协作约定',
  );
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expect(page.getByRole('tab', { name: '项目规范', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('搜索项目知识记录')).toHaveValue('测试');
});

test('localizes legacy system metadata while keeping authored knowledge and memory unchanged', async ({
  page,
}) => {
  const { DEMO_PLUGIN_PAGES } = await import('../../../domains/dashboard/web/demo.js');
  const pages = structuredClone(DEMO_PLUGIN_PAGES);
  const knowledge = pages.find((entry) => entry.pluginId === 'comet.project-knowledge')!;
  const generated = {
    ...knowledge.data.records[0],
    id: 'generated-module-dashboard',
    type: 'dependency',
    authority: 'repository',
    title: '模块入口与依赖：domains/dashboard',
    summary: '可确认入口：domains/dashboard/server.ts。 跨模块依赖：domains/eval。',
    conclusions: [],
    applicationHistory: [],
    lastApplication: null,
  };
  const authored = { ...generated, id: 'authored-record', authority: 'user' };
  knowledge.data.records = [generated, authored];
  knowledge.data.diagnostics = [
    {
      code: 'index-budget',
      message: '未进入检索：索引刷新超过时间预算，尚未处理的语料当前不会参与召回。',
    },
  ];
  const memory = pages.find((entry) => entry.pluginId === 'comet.personal-memory')!;
  const base =
    memory.data.management.records.find((record) => record.memoryType === 'collaboration-policy') ??
    memory.data.management.records[0];
  const remembered = {
    ...base,
    id: 'memory-language',
    authority: 'explicit',
    category: '项目约定',
    text: '回答问题都用中文',
    memoryType: 'collaboration-policy',
    lastApplication: {
      ...base.lastApplication,
      whyApplied: '由用户明确要求，立即更新个人记忆；用户明确设置；当前项目已匹配',
    },
  };
  memory.data.management.records = [remembered];
  memory.data.retrieval.records = [remembered];
  memory.data.retrieval.profileRecords = [];
  let writes = 0;
  await page.route('**/api/dashboard/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST') writes++;
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
    if (pathname.endsWith('/plugins')) return route.fulfill({ json: { pages } });
    const plugin = pages.find((entry) => pathname.endsWith('/plugins/' + entry.pluginId));
    return route.fulfill({ json: plugin ?? { items: [], total: 0 } });
  });
  await page.goto('/');
  await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Project knowledge' }).click();
  await expect(
    page
      .getByText('Module entry points and dependencies: domains/dashboard', { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText(/index refresh exceeded its time budget/u)).toBeVisible();
  await expect(
    page.locator('.dashboard-knowledge-ledger-row').getByText(authored.title, { exact: true }),
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Personal memory' }).click();
  const row = page.locator('.dashboard-memory-table-row');
  await expect(row.getByText('回答问题都用中文', { exact: true })).toBeVisible();
  await expect(row.locator('.dashboard-memory-why')).toContainText(
    'Requested directly by the user; Explicitly set by the user; Current project matches',
  );
  expect(writes).toBe(0);
});

test('switches the interface language across workspaces and keeps the choice after reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  const language = page.locator('.comet-language-switch');
  await language.getByText('EN', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByText('Project overview', { exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Project knowledge' })).toBeVisible();
  const messages = JSON.parse(
    await readFile('domains/dashboard/web/src/messages.en.json', 'utf8'),
  ) as Record<string, string>;
  const checkInterface = async () => {
    const copy = await page
      .locator(
        'button, label, [role="tab"], [role="menuitem"], [role="option"], input[placeholder], [aria-label], [title]',
      )
      .evaluateAll((elements) =>
        elements.flatMap((element) =>
          [
            element.textContent?.trim(),
            element.getAttribute('aria-label'),
            element.getAttribute('placeholder'),
            element.getAttribute('title'),
          ].filter((value): value is string => Boolean(value)),
        ),
      );
    expect
      .soft([
        ...new Set(
          copy.filter(
            (value) =>
              value !== '中文' && Object.hasOwn(messages, value) && messages[value] !== value,
          ),
        ),
      ])
      .toEqual([]);
  };
  await checkInterface();
  await page.getByRole('menuitem', { name: 'Native workflow' }).click();
  await expect(page.getByText('Native change workspace', { exact: true })).toBeVisible();
  await checkInterface();
  await page.getByRole('menuitem', { name: 'Personal memory' }).click();
  await expect(page.getByLabel('Search personal memories')).toBeVisible();
  await checkInterface();
  await page.getByRole('menuitem', { name: 'Project knowledge' }).click();
  await expect(page.getByRole('tab', { name: 'Project overview', exact: true })).toBeVisible();
  await checkInterface();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: /Comet settings/u });
  await expect(settings).toBeVisible();
  await settings.getByRole('menuitem', { name: 'Comet configuration' }).click();
  await expect(settings.getByText('Workflows and recovery', { exact: true })).toBeVisible();
  await checkInterface();
  await page.screenshot({ path: test.info().outputPath('dashboard-english-settings.png') });
  await settings.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByRole('tab', { name: 'Project overview', exact: true })).toBeVisible();
  await language.getByText('中文', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('tab', { name: '项目概况', exact: true })).toBeVisible();
});

test('keeps the language switch accessible in both themes and on narrow screens', async ({
  page,
}) => {
  await page.goto('/?demo');
  await page.locator('.comet-language-switch').getByText('EN', { exact: true }).click();
  for (const width of [1440, 1180, 1024, 900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const control = page.locator('.comet-language-switch');
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThan(width / 2);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y).toBeLessThan(160);
    await page.screenshot({ path: test.info().outputPath(`dashboard-english-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.comet-language-switch').getByText('中文', { exact: true }).click();
  await expect(page.getByRole('button', { name: '切换到亮色模式' })).toBeVisible();
});

test.describe('Dashboard project selection', () => {
  const projects = Array.from({ length: 45 }, (_, index) => ({
    id: `path-${index}`,
    name: index < 2 ? 'same-repository' : `project-${index}`,
    path: `/worktrees/project-${index}`,
    lastSeenAt: null,
    availability: 'available',
    isCurrent: index === 0,
  }));
  const overview = (index: number) => ({
    project: {
      name: projects[index].name,
      path: projects[index].path,
      generatedAt: '2026-09-10T00:00:00.000Z',
    },
    summary: {
      activeChanges: 0,
      archivedChanges: 0,
      verifyFailed: 0,
      tasksIncomplete: 0,
      dirtyFiles: index,
    },
    initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
    git: {
      branch: `branch-${index}`,
      head: 'abc1234',
      dirtyFiles: 0,
      dirtyFileList: [],
      recentCommits: [],
    },
    risks: [],
    native: null,
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.addInitScript(() => localStorage.setItem('comet-dashboard-project', 'path-1'));
    await page.route('**/api/dashboard/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/dashboard/projects') {
        await route.fulfill({ json: { currentProjectId: 'path-0', projects } });
      } else if (url.pathname.endsWith('/overview')) {
        const index = Number(url.pathname.split('/')[4].replace('path-', ''));
        await route.fulfill({ json: overview(index) });
      } else if (url.pathname.endsWith('/changes')) {
        await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
      } else if (url.pathname.endsWith('/plugins')) {
        await route.fulfill({ json: { pages: [] } });
      } else {
        await route.fulfill({ json: {} });
      }
    });
  });

  test('prefers the launch project over remembered selection and resets on reload', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
    await page.locator('.comet-project-select').click();
    const response = page.waitForResponse('**/projects/path-1/overview*');
    await page
      .locator('.comet-project-select-dropdown .comet-project-option')
      .filter({ hasText: '/worktrees/project-1' })
      .first()
      .click();
    expect((await (await response).json()).project.path).toBe('/worktrees/project-1');
    await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toBeVisible();
    const changes = page.waitForRequest('**/projects/path-1/changes*');
    await page.getByRole('tab', { name: '已归档', exact: true }).click();
    await changes;
    await page.reload();
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toHaveCount(0);
  });

  test('keeps option names and paths paired through scrolling and searching', async ({ page }) => {
    await page.goto('/');
    const selector = page.locator('.comet-project-select');
    await selector.click();
    const popup = page.locator('.comet-project-select-dropdown');
    const scroller = popup.locator('.ant-select-dropdown-list-holder');
    const assertLabels = async () => {
      const visible = await popup.locator('.comet-project-option').evaluateAll((entries) =>
        entries.map((entry) => ({
          name: entry.querySelector('.comet-project-option-name')?.textContent,
          path: entry.querySelector('.comet-project-option-path')?.textContent,
        })),
      );
      expect(visible.length).toBeGreaterThan(1);
      expect(new Set(visible.map((entry) => entry.path)).size).toBe(visible.length);
      for (const entry of visible)
        expect(projects.find((project) => project.path === entry.path)?.name).toBe(entry.name);
    };
    await assertLabels();
    for (const fraction of [1, 0.5, 0]) {
      const target = fraction === 1 ? 44 : fraction === 0 ? 0 : 22;
      // Check visibility first and only nudge scrollTop when the virtual list
      // has not rendered the target yet. Rewriting scrollTop on every poll
      // tick fights rc-virtual-list's own re-rendering and can livelock on a
      // slow runner.
      await expect
        .poll(
          async () => {
            if (await popup.getByText(`/worktrees/project-${target}`, { exact: true }).isVisible())
              return true;
            await scroller.evaluate((element, amount) => {
              element.scrollTop = amount * element.scrollHeight;
            }, fraction);
            return false;
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await assertLabels();
    }
    await selector.getByRole('combobox').fill('/worktrees/project-44');
    await expect(popup.locator('.comet-project-option')).toHaveCount(1);
    await popup.getByText('/worktrees/project-44', { exact: true }).click();
    await expect(selector.locator('.comet-project-selected-label')).toHaveText('project-44');
    await expect(page.getByRole('button', { name: /^Git 未提交 44 / })).toBeVisible();
  }, 60_000);

  test('ignores a slow overview response after switching back', async ({ page }) => {
    let release!: () => void;
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/projects/path-1/overview*', async (route) => {
      await held;
      await route.fulfill({ json: overview(1) }).catch(() => undefined);
      finish();
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
    const selector = page.locator('.comet-project-select');
    await selector.click();
    const started = page.waitForRequest('**/projects/path-1/overview*');
    await page.getByText('/worktrees/project-1', { exact: true }).click();
    await started;
    await selector.click();
    await page.getByText('/worktrees/project-0', { exact: true }).click();
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
    release();
    await completed;
    await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
  });

  for (const noAvailable of [false, true]) {
    test(`handles unavailable launch projects with ${noAvailable ? 'an empty state' : 'an available fallback'}`, async ({
      page,
    }) => {
      await page.route('**/api/dashboard/projects', (route) =>
        route.fulfill({
          json: {
            currentProjectId: 'path-0',
            projects: [
              { ...projects[0], availability: 'missing' },
              { ...projects[1], availability: noAvailable ? 'unreadable' : 'available' },
            ],
          },
        }),
      );
      const overviewRequests: string[] = [];
      page.on('request', (request) => {
        if (request.url().includes('/overview')) overviewRequests.push(request.url());
      });
      await page.goto('/');
      if (noAvailable) {
        await expect(page.getByText('暂无可用项目', { exact: true })).toBeVisible();
        expect(overviewRequests).toHaveLength(0);
      } else {
        await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toBeVisible();
      }
      await page.locator('.comet-project-select').click();
      await expect(
        page.locator('.comet-project-select-dropdown .ant-select-item-option-disabled'),
      ).toHaveCount(noAvailable ? 2 : 1);
    });
  }

  test('marks missing projects and removes only the confirmed index entry', async ({ page }) => {
    const missing = { ...projects[1], availability: 'missing' };
    const remaining = { currentProjectId: 'path-0', projects: [projects[0]] };
    await page.route('**/api/dashboard/projects', (route) =>
      route.fulfill({
        json: { currentProjectId: 'path-0', projects: [projects[0], missing] },
      }),
    );
    let removed = false;
    await page.route('**/api/dashboard/projects/path-1/forget', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['content-type']).toBe('application/json');
      removed = true;
      await route.fulfill({ json: remaining });
    });
    await page.goto('/');
    await page.locator('.comet-project-select').click();
    await expect(page.getByText(/目录已不存在/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '管理缺失项目' }).click();
    await page.screenshot({ path: test.info().outputPath('missing-projects.png') });
    await page.getByRole('button', { name: '从索引移除', exact: true }).click();
    await page.getByRole('button', { name: /^取\s*消$/ }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(removed).toBe(false);
    await page.getByRole('button', { name: '管理缺失项目' }).click();
    await page.getByRole('button', { name: '从索引移除', exact: true }).click();
    await page.getByRole('button', { name: /^移\s*除$/ }).click();
    await expect(page.getByRole('button', { name: '管理缺失项目' })).toHaveCount(0);
    expect(removed).toBe(true);
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
  });
});

test('uses each project default workflow during startup and project switching', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const projects = [
    {
      id: 'native-project',
      name: 'native-project',
      path: '/worktrees/native-project',
      lastSeenAt: null,
      availability: 'available',
      isCurrent: true,
      defaultWorkflow: 'native',
      workflowSource: 'configured',
    },
    {
      id: 'classic-project',
      name: 'classic-project',
      path: '/worktrees/classic-project',
      lastSeenAt: null,
      availability: 'available',
      isCurrent: false,
      defaultWorkflow: 'classic',
      workflowSource: 'configured',
    },
  ];
  const overview = (project: (typeof projects)[number]) => ({
    project: {
      name: project.name,
      path: project.path,
      generatedAt: '2026-09-10T00:00:00.000Z',
    },
    summary: {
      activeChanges: 0,
      archivedChanges: 0,
      verifyFailed: 0,
      tasksIncomplete: 0,
      dirtyFiles: 0,
    },
    initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
    git: {
      branch: project.name,
      head: 'abc1234',
      dirtyFiles: 0,
      dirtyFileList: [],
      recentCommits: [],
    },
    risks: [],
    native: {
      activeChangeCount: 0,
      archivedChangeCount: 0,
      totalChangeCount: 0,
      changes: [],
    },
  });
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({ json: { currentProjectId: 'native-project', projects } });
    } else if (url.pathname.endsWith('/overview')) {
      const project = projects.find((entry) => url.pathname.includes(entry.id));
      await route.fulfill({ json: overview(project ?? projects[0]) });
    } else if (url.pathname.endsWith('/changes') || url.pathname.endsWith('/native-changes')) {
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
    } else if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({ json: { pages: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto('/');
  await expect(page.locator('.dashboard-workflow-menu .ant-menu-item-selected')).toContainText(
    'Native 工作流',
  );
  await expect(page.locator('[aria-label="项目默认工作流来源：configured"]')).toBeVisible();

  await page.locator('.comet-project-select').click();
  await page.getByText('/worktrees/classic-project', { exact: true }).click();
  await expect(page.locator('.dashboard-workflow-menu .ant-menu-item-selected')).toContainText(
    'Classic 工作流',
  );
});

test('revalidates a cached plugin page when it is first entered', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const project = {
    id: 'fresh-project',
    name: 'fresh-project',
    path: '/worktrees/fresh-project',
    lastSeenAt: null,
    availability: 'available',
    isCurrent: true,
    defaultWorkflow: 'classic',
    workflowSource: 'configured',
  };
  let pluginPageLoads = 0;
  let pluginPageResponses = 0;
  let releasePluginPageLoad: (() => void) | undefined;
  const pluginPageLoadPending = new Promise<void>((resolve) => {
    releasePluginPageLoad = resolve;
  });
  await page.addInitScript(
    ({ cacheKey, cachedPage }) => {
      localStorage.setItem(cacheKey, JSON.stringify({ version: 1, value: cachedPage }));
    },
    {
      cacheKey: `comet-dashboard-plugin:${project.id}:test.plugin`,
      cachedPage: {
        pluginId: 'test.plugin',
        label: '测试插件',
        route: '/plugins/test',
        status: 'enabled',
        globallyDisabled: false,
        projectPaused: false,
        diagnostics: [],
        data: { version: 'cached' },
      },
    },
  );
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({ json: { currentProjectId: project.id, projects: [project] } });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: project.name, path: project.path, generatedAt: '2026-09-10' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          git: {
            branch: 'main',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
          native: null,
        },
      });
    } else if (url.pathname.endsWith('/changes')) {
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
    } else if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({
        json: {
          pages: [
            {
              pluginId: 'test.plugin',
              label: '测试插件',
              route: '/plugins/test',
              status: 'enabled',
              globallyDisabled: false,
              projectPaused: false,
              diagnostics: [],
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/plugins/test.plugin')) {
      pluginPageLoads += 1;
      await pluginPageLoadPending;
      await route.fulfill({
        json: {
          pluginId: 'test.plugin',
          label: '测试插件',
          route: '/plugins/test',
          status: 'enabled',
          globallyDisabled: false,
          projectPaused: false,
          diagnostics: [],
          data: { version: 'fresh' },
        },
      });
      pluginPageResponses += 1;
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto('/');
  await expect(page.getByRole('menuitem', { name: '测试插件' })).toBeVisible();
  await page.getByRole('menuitem', { name: '测试插件' }).click();
  await expect(page.getByText('该插件暂未提供可视化中心页。')).toBeVisible();
  await expect.poll(() => pluginPageLoads).toBe(1);
  const cachedContent = page.getByText('该插件暂未提供可视化中心页。');
  const topWhileRefreshing = await cachedContent.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  await expect(page.getByText('正在同步最新数据…', { exact: true })).toHaveCount(0);
  releasePluginPageLoad?.();
  await expect.poll(() => pluginPageResponses).toBe(1);
  await expect
    .poll(async () => cachedContent.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(topWhileRefreshing);
});

test('keeps cached settings visible when fresh revalidation fails', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const project = {
    id: 'settings-fresh-project',
    name: 'settings-fresh-project',
    path: '/worktrees/settings-fresh-project',
    lastSeenAt: null,
    availability: 'available',
    isCurrent: true,
    defaultWorkflow: 'native',
    workflowSource: 'configured',
  };
  const cachedConfig = {
    path: '.comet/config.yaml',
    revision: 'cached-revision',
    schema: 'comet.project.v1',
    defaultWorkflow: 'native',
    workflows: ['native', 'classic'],
    ambientResume: true,
    hookAllowPaths: [],
    knowledge: { provider: 'local', localInclude: [], maxFileMb: 2, maxTotalMb: 64 },
    native: {
      artifactRoot: 'docs',
      language: 'zh-CN',
      clarificationMode: 'sequential',
      archiveConfirmation: 'required',
      maxVerifyFailures: 3,
    },
    classic: {
      artifactLayout: 'docs',
      language: 'zh-CN',
      contextCompression: 'off',
      reviewMode: 'standard',
      autoTransition: false,
    },
  };
  let configLoads = 0;
  let releaseSettingsRefresh: (() => void) | undefined;
  const settingsRefreshPending = new Promise<void>((resolve) => {
    releaseSettingsRefresh = resolve;
  });
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({ json: { currentProjectId: project.id, projects: [project] } });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: project.name, path: project.path, generatedAt: '2026-09-10' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          git: {
            branch: 'main',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
          native: null,
        },
      });
    } else if (url.pathname.endsWith('/changes')) {
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
    } else if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({ json: { pages: [] } });
    } else if (url.pathname.endsWith('/config')) {
      configLoads += 1;
      if (configLoads === 1) await route.fulfill({ json: cachedConfig });
      else {
        if (configLoads === 2) await settingsRefreshPending;
        await route.fulfill({ status: 503, json: { message: 'fresh settings unavailable' } });
      }
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto('/');
  await expect(page.locator('.dashboard-workflow-menu .ant-menu-item-selected')).toContainText(
    'Native 工作流',
  );
  await expect.poll(() => configLoads).toBe(1);
  const settingsDialog = page.getByRole('dialog', { name: /Comet 设置/u });
  await page.getByRole('button', { name: '设置' }).click();
  await expect(
    settingsDialog
      .locator('.dashboard-config-control')
      .first()
      .getByText('Native', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => configLoads).toBe(2);
  await expect(settingsDialog.getByText('正在同步最新数据…', { exact: true })).toHaveCount(0);
  releaseSettingsRefresh?.();
  await expect(
    settingsDialog.getByText('最新数据同步失败，当前显示缓存', { exact: true }),
  ).toBeVisible();
  await settingsDialog.getByRole('button', { name: /重\s*试/u }).click();
  await expect.poll(() => configLoads).toBe(3);
  await expect(
    settingsDialog
      .locator('.dashboard-config-control')
      .first()
      .getByText('Native', { exact: true }),
  ).toBeVisible();
  await expect(
    settingsDialog.getByText('最新数据同步失败，当前显示缓存', { exact: true }),
  ).toBeVisible();
});

test('shows Project Knowledge status and project pause transitions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  let paused = false;
  let uninstalled = false;
  let sourceReadCount = 0;
  let projectKnowledgePageLoadCount = 0;
  let projectKnowledgeListCount = 0;
  const queryTasks: string[] = [];
  const manualRecords: Array<Record<string, unknown>> = [];
  const baseRecord = {
    id: 'record-focused-tests',
    projectId: 'fixture-project',
    type: 'topology',
    state: 'proven',
    authority: 'automatic',
    title: 'Focused tests',
    summary: '## 使用建议\n\nPrefer focused tests for small changes.',
    applicablePaths: ['domains/'],
    operations: ['verify'],
    conclusions: [
      {
        text: 'Run focused tests first.',
        sources: [
          { source: 'docs/rule.md', anchor: 'rule' },
          { source: 'domains/project-knowledge/local-provider.ts', anchor: 'query' },
        ],
      },
    ],
    relations: [],
    verification: [],
    sourceVersions: [],
    applicationHistory: [
      {
        applicationId: 'application-focused-tests-2',
        task: '复核项目测试策略',
        whyApplied: '当前任务与验证阶段匹配',
        delivery: 'manifest',
        appliedAt: '2026-08-23T08:00:00.000Z',
        outcome: 'used-successfully',
      },
      {
        applicationId: 'application-focused-tests-1',
        task: '实现项目知识检索',
        whyApplied: '当前路径与项目规范匹配',
        delivery: 'expanded',
        appliedAt: '2026-08-22T08:00:00.000Z',
        outcome: 'used-successfully',
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        applicationId: `application-focused-tests-history-${index}`,
        task: `历史验证任务 ${index + 1}`,
        whyApplied: '当前项目与验证操作匹配',
        delivery: 'manifest',
        appliedAt: `2026-08-${String(21 - index).padStart(2, '0')}T08:00:00.000Z`,
        outcome: index % 2 === 0 ? 'used-successfully' : 'ignored',
      })),
    ],
    lastApplication: {
      task: '复核项目测试策略',
      whyApplied: '当前任务与验证阶段匹配',
      delivery: 'manifest',
      appliedAt: '2026-08-23T08:00:00.000Z',
      outcome: 'used-successfully',
      outcomeEvents: [
        {
          revision: 1,
          status: 'used-successfully',
          occurredAt: '2026-08-23T08:10:00.000Z',
          evidence: {
            decision: '先验证检索与上下文衔接，再扩大测试范围',
            verification: { command: 'pnpm test --filter project-knowledge', success: true },
          },
        },
      ],
    },
    updatedAt: '2026-08-22T12:00:00.000Z',
  };

  const policyRecord = {
    id: 'record-policy-checks',
    projectId: 'fixture-project',
    type: 'constraint',
    state: 'proven',
    authority: 'repository',
    title: 'Policy checks',
    summary: 'Run the project checks before delivery.',
    applicablePaths: ['domains/'],
    operations: ['verify'],
    conclusions: [
      {
        text: 'Run project checks before delivery.',
        sources: [{ source: 'docs/policy.md', anchor: 'checks' }],
      },
    ],
    relations: [],
    verification: [],
    sourceVersions: [],
    applicationHistory: [],
    updatedAt: '2026-08-23T12:00:00.000Z',
  };
  const projectKnowledgePage = () => ({
    pluginId: 'comet.project-knowledge',
    label: '项目知识',
    route: '/plugins/project-knowledge',
    status: paused ? 'disabled' : 'enabled',
    globallyDisabled: false,
    projectPaused: paused,
    diagnostics: [],
    data: paused
      ? null
      : {
          provider: 'remote',
          configured: true,
          remote: {
            endpoint: 'https://example.test/retrieve',
            tokenEnv: 'COMET_KNOWLEDGE_TOKEN',
            tokenConfigured: true,
            scope: 'team-a',
            timeoutMs: 1200,
          },
          retrieval: 'Remote 配置仅表示已配置，不代表最近一次请求成功。',
          local: {
            available: true,
            repositoryId: 'fixture-repository',
            workspaceId: 'fixture-workspace',
            sourceCount: 124,
            sources: [
              {
                source: 'docs/rule.md',
                kind: 'custom',
                updatedAt: '2026-08-23T12:00:00.000Z',
              },
              {
                source: 'docs/policy.md',
                kind: 'custom',
                updatedAt: '2026-08-23T12:00:00.000Z',
              },
              {
                source: 'docs/legacy.md',
                kind: 'classic-archive',
                updatedAt: '2026-08-21T12:00:00.000Z',
              },
              {
                source: 'docs/verify-result.md',
                kind: 'native-archive',
                updatedAt: '2026-08-20T12:00:00.000Z',
              },
              ...Array.from({ length: 120 }, (_, index) => ({
                source: `docs/generated/source-${String(index + 5).padStart(3, '0')}.md`,
                kind: 'custom',
                updatedAt: '2026-08-19T12:00:00.000Z',
              })),
            ],
            sectionCount: 4,
            updatedAt: '2026-08-23T12:00:00.000Z',
            channels: ['records', 'sections'],
          },
          records: [baseRecord, policyRecord, ...manualRecords],
          manifestPreview: [
            {
              id: baseRecord.id,
              memoryType: 'project-model',
              title: baseRecord.title,
              summary: baseRecord.summary,
              whyApplied: '当前任务与验证阶段匹配',
              delivery: 'manifest',
              appliedAt: '2026-08-23T08:00:00.000Z',
              outcome: 'used-successfully',
              lastApplication: {
                task: '复核项目测试策略',
                whyApplied: '当前任务与验证阶段匹配',
                delivery: 'manifest',
                appliedAt: '2026-08-23T08:00:00.000Z',
                outcome: 'used-successfully',
                outcomeEvents: [
                  {
                    revision: 1,
                    status: 'used-successfully',
                    occurredAt: '2026-08-23T08:10:00.000Z',
                    evidence: {
                      decision: '先验证检索与上下文衔接，再扩大测试范围',
                      verification: {
                        command: 'pnpm test --filter project-knowledge',
                        success: true,
                      },
                    },
                  },
                ],
              },
            },
            {
              id: policyRecord.id,
              memoryType: 'project-policy',
              title: policyRecord.title,
              summary: policyRecord.summary,
              whyApplied: '当前项目与验证操作匹配',
              delivery: 'expanded',
              appliedAt: '2026-08-23T07:00:00.000Z',
              outcome: 'used-successfully',
              lastApplication: {
                task: '复核项目规范',
                whyApplied: '当前项目与验证操作匹配',
                delivery: 'expanded',
                appliedAt: '2026-08-23T07:00:00.000Z',
                outcome: 'used-successfully',
              },
            },
          ],
          counts: {
            trial: manualRecords.filter((record) => record.state === 'trial').length,
            proven: 2 + manualRecords.filter((record) => record.state === 'proven').length,
            enforced: manualRecords.filter((record) => record.state === 'enforced').length,
            superseded: manualRecords.filter((record) => record.state === 'superseded').length,
          },
          diagnostics: [],
        },
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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-20T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
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
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.project-knowledge/lifecycle')) {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === 'uninstall') {
        uninstalled = true;
      } else {
        paused = body.action === 'disable';
      }
      await route.fulfill({ json: {} });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.project-knowledge/invoke')) {
      const body = route.request().postDataJSON() as {
        capability?: string;
        input?: Record<string, unknown>;
      };
      if (body.capability === 'read-source') {
        sourceReadCount += 1;
        const source = body.input?.source;
        expect(['docs/rule.md', 'docs/verify-result.md']).toContain(source);
        const isVerifyResult = source === 'docs/verify-result.md';
        await route.fulfill({
          json: {
            result: {
              kind: 'source',
              source,
              content: isVerifyResult
                ? '# Verification result\n\n- Status: passed\n- Acceptance: acceptance-1\n'
                : '# Rule\n\nRun focused tests first.\n',
              size: isVerifyResult ? 67 : 33,
              modifiedAt: '2026-08-23T12:00:00.000Z',
              truncated: false,
            },
          },
        });
        return;
      }
      if (body.capability === 'create') {
        expect(body.input).toMatchObject({
          type: 'constraint',
          title: '未文档化约定',
          summary: '修改后先运行定向测试。',
          applicablePaths: ['domains/'],
          operations: ['verify'],
          sources: [],
          verification: ['pnpm test --filter project-knowledge'],
        });
        manualRecords.push({
          id: 'manual-undocumented-convention',
          projectId: 'fixture-project',
          type: 'constraint',
          state: 'enforced',
          authority: 'user',
          title: '未文档化约定',
          summary: '修改后先运行定向测试。',
          applicablePaths: ['domains/'],
          operations: ['verify'],
          conclusions: [],
          relations: [],
          verification: [{ command: 'pnpm test --filter project-knowledge' }],
          sourceVersions: [],
          updatedAt: '2026-08-23T12:00:00.000Z',
        });
        await route.fulfill({
          json: { result: { kind: 'upsert', changed: true, record: manualRecords.at(-1) } },
        });
        return;
      }
      if (body.capability === 'forget') {
        const recordIndex = manualRecords.findIndex((record) => record.id === body.input?.id);
        expect(recordIndex).toBeGreaterThanOrEqual(0);
        manualRecords[recordIndex] = {
          ...manualRecords[recordIndex],
          state: 'superseded',
          updatedAt: '2026-08-23T12:30:00.000Z',
        };
        await route.fulfill({
          json: {
            result: {
              kind: 'supersede',
              changed: true,
              record: manualRecords[recordIndex],
              diagnostics: [],
            },
          },
        });
        return;
      }
      if (body.capability === 'correct') {
        const recordIndex = manualRecords.findIndex((record) => record.id === body.input?.id);
        expect(recordIndex).toBeGreaterThanOrEqual(0);
        expect(body.input?.restore).toBe(true);
        manualRecords[recordIndex] = {
          ...manualRecords[recordIndex],
          state: 'enforced',
          authority: 'user',
          summary: String(body.input?.text ?? ''),
          updatedAt: '2026-08-23T12:45:00.000Z',
        };
        await route.fulfill({
          json: {
            result: {
              kind: 'correct',
              changed: true,
              record: manualRecords[recordIndex],
              diagnostics: [],
            },
          },
        });
        return;
      }
      expect(body.capability).toBe('query');
      queryTasks.push(String(body.input?.task ?? ''));
      const results =
        body.input?.task === '1231'
          ? []
          : Array.from({ length: 8 }, (_, index) => ({
              source: 'docs/rule.md#rule',
              title: `Focused tests ${index + 1}`,
              content:
                '# Focused tests\n\nRun focused tests first.\n\n' +
                'Long retrieval evidence.\n\n'.repeat(80),
            }));
      await route.fulfill({
        json: {
          result: {
            kind: 'search',
            hits: [],
            records: [],
            truncated: false,
            diagnostics: [],
            results,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.project-knowledge')) {
      projectKnowledgePageLoadCount += 1;
      if (uninstalled) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ json: projectKnowledgePage() });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      projectKnowledgeListCount += 1;
      const current = projectKnowledgePage();
      await route.fulfill({
        json: {
          pages: uninstalled
            ? []
            : [
                {
                  pluginId: current.pluginId,
                  label: current.label,
                  route: current.route,
                  status: current.status,
                  globallyDisabled: current.globallyDisabled,
                  projectPaused: current.projectPaused,
                  diagnostics: current.diagnostics,
                },
              ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  const projectManifest = page.getByRole('region', { name: '最近一次任务使用的项目知识' });
  await expect(projectManifest).toContainText('最近使用');
  await expect(projectManifest).toContainText('任务：复核项目测试策略');
  await expect(projectManifest).toContainText('2 条项目知识');
  await expect(projectManifest).not.toContainText('Focused tests');
  await expect(projectManifest).not.toContainText('当前任务与验证阶段匹配');
  await expect(projectManifest).not.toContainText('## 使用建议');
  await projectManifest.getByRole('button', { name: '查看使用明细' }).click();
  const focusedManifestDetail = projectManifest.getByRole('region', {
    name: '项目知识详情：Focused tests',
  });
  await expect(focusedManifestDetail).toHaveCount(0);
  const focusedManifestDialog = page.getByRole('dialog', {
    name: /Focused tests/u,
  });
  await expect(focusedManifestDialog).toBeVisible();
  const focusedManifestTitle = focusedManifestDialog.locator('.dashboard-settings-modal-title-row');
  await expect(focusedManifestTitle.locator('strong')).toHaveText('Focused tests');
  await expect(focusedManifestTitle.locator('span')).toHaveCount(0);
  await expect(focusedManifestDialog.locator('.dashboard-settings-modal-title p')).toHaveCount(0);
  await expect(focusedManifestTitle).toHaveCSS('border-left-width', '0px');
  const manifestDetails = focusedManifestDialog.getByRole('navigation', {
    name: '本次使用的项目知识',
  });
  await expect(manifestDetails).toContainText('Focused tests');
  await expect(manifestDetails).toContainText('Policy checks');
  await expect(focusedManifestDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
  await expect(focusedManifestDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await expect(
    focusedManifestDialog
      .locator('.dashboard-settings-modal-title-row')
      .getByRole('button', { name: '全屏展示' }),
  ).toHaveCount(0);
  await expect(focusedManifestDialog).toContainText('项目知识内容');
  await expect(
    focusedManifestDialog.getByRole('heading', { name: '使用建议', level: 2 }),
  ).toBeVisible();
  await expect(focusedManifestDialog).toContainText('Prefer focused tests for small changes.');
  await expect(focusedManifestDialog).not.toContainText('## 使用建议');
  const focusedPreviewContainer = focusedManifestDialog.locator('.ant-modal-container');
  await expect(focusedPreviewContainer).toHaveCSS('transition-duration', /0\.36s/u);
  await expect(focusedPreviewContainer).toHaveCSS(
    'transition-timing-function',
    /cubic-bezier\(0\.22, 1, 0\.36, 1\)/u,
  );
  await expect(focusedManifestDialog).toContainText('为什么使用');
  await expect(focusedManifestDialog).toContainText('提供给 Agent 的内容');
  await expect(focusedManifestDialog).toContainText('项目概况');
  await focusedManifestDialog.getByRole('button', { name: '全屏展示' }).click();
  await expect(focusedManifestDialog.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(focusedManifestDialog).toBeVisible();
  await expect(focusedManifestDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(focusedManifestDialog).toBeHidden();
  await projectManifest.getByRole('button', { name: '查看使用明细' }).click();
  const reopenedManifestDialog = page.getByRole('dialog', {
    name: /Focused tests/u,
  });
  await reopenedManifestDialog
    .getByRole('button', { name: '查看项目知识详情：Policy checks' })
    .click();
  const policyManifestDialog = page.getByRole('dialog', {
    name: /Policy checks/u,
  });
  await expect(policyManifestDialog).toContainText('Run the project checks before delivery.');
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(policyManifestDialog).toBeHidden();
  await expect(page.getByLabel('项目规则状态与操作')).toBeVisible();
  await expect(page.getByRole('tablist', { name: '项目知识视图' })).toBeVisible();
  await page.getByRole('tab', { name: '项目概况' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '项目规范' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '项目规范' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page
      .getByRole('complementary', { name: '知识分类' })
      .getByRole('button', { name: /项目结构/u }),
  ).toHaveCount(0);
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: '项目概况' })).toBeFocused();
  await expect(page.getByRole('complementary', { name: '知识分类' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '记录详情' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '项目概况' })).toBeVisible();
  const projectKnowledgeHelp = page.getByRole('button', { name: '了解项目知识分类' });
  await projectKnowledgeHelp.click();
  const projectKnowledgeGuide = page.locator('.ant-popover:visible');
  await expect(projectKnowledgeGuide).toContainText('项目概况回答“项目是什么”');
  await expect(projectKnowledgeGuide).toContainText('项目规范回答“在项目中应该怎么做”');
  await projectKnowledgeHelp.click();
  const projectStructureCategory = page.getByRole('button', { name: /项目结构/u });
  await projectStructureCategory.hover();
  await expect(
    page.getByRole('tooltip', { name: '项目由哪些目录、模块和入口组成', exact: true }),
  ).toBeVisible();
  await projectStructureCategory.click();
  const projectStructureHelp = page.getByRole('button', { name: '了解项目结构' });
  await projectStructureHelp.click();
  await expect(page.getByText('例如：入口目录、模块边界和运行入口。')).toBeVisible();
  await projectStructureHelp.click();
  await page.getByRole('button', { name: /项目事实 0/u }).click();
  await expect(
    page
      .locator('.dashboard-knowledge-ledger .dashboard-knowledge-empty')
      .getByText('已确认的项目属性、技术信息和运行条件', { exact: true }),
  ).toBeVisible();
  await projectStructureCategory.click();
  await expect(page.getByText('内置', { exact: true })).toHaveCount(1);
  await expect(page.getByText('COMET_KNOWLEDGE_TOKEN')).toHaveCount(0);
  await expect(page.getByText('docs/rule.md#rule', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText(
    '复核项目测试策略',
  );
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText(
    '实现项目知识检索',
  );
  const applicationHistory = page
    .getByRole('complementary', { name: '记录详情' })
    .locator('.dashboard-context-application-history');
  await expect(applicationHistory.locator('article')).toHaveCount(6);
  await page.getByRole('button', { name: '查看全部 8 条' }).click();
  await expect(applicationHistory.locator('article')).toHaveCount(8);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(applicationHistory.locator('article')).toHaveCount(6);
  await expect(page.getByText(/2026-08-22/u).first()).toBeVisible();
  const registryBounds = await page.locator('.dashboard-knowledge-registry').boundingBox();
  const workbenchBounds = await page.locator('.dashboard-workbench').boundingBox();
  expect(registryBounds).not.toBeNull();
  expect(workbenchBounds).not.toBeNull();
  expect((registryBounds?.y ?? 0) + (registryBounds?.height ?? 0)).toBeLessThanOrEqual(
    (workbenchBounds?.y ?? 0) + (workbenchBounds?.height ?? 0),
  );
  await expect(page.getByText('知识提供方式', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText(
    '同时参与文档检索',
  );
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText(
    '仅支持此结论，不参与全文检索',
  );
  const inspectorFooter = page
    .getByRole('complementary', { name: '记录详情' })
    .locator(':scope > footer');
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText(
    '先验证检索与上下文衔接，再扩大测试范围',
  );
  await expect(page.getByRole('complementary', { name: '记录详情' })).toContainText('宿主验证结果');
  const correctionAction = inspectorFooter.getByRole('button', { name: '纠正记录' });
  await correctionAction.click();
  const correctionDialog = page.getByRole('dialog', { name: /纠正项目知识记录/u });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const expectedWidth = Math.min(800, viewport.width - 32);
    await expect
      .poll(async () => {
        const box = await correctionDialog.locator('.ant-modal-container').boundingBox();
        if (!box) return false;
        return (
          Math.abs(box.width - expectedWidth) < 3 &&
          Math.abs(box.x + box.width / 2 - viewport.width / 2) < 3 &&
          Math.abs(box.y + box.height / 2 - viewport.height / 2) < 3
        );
      })
      .toBe(true);
    const editor = correctionDialog.getByRole('textbox');
    await expect.poll(async () => (await editor.boundingBox())?.height ?? 0).toBeGreaterThan(250);
    await editor.fill('长篇纠正内容\n'.repeat(80));
    await editor.press('Control+End');
    await expect.poll(() => editor.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await correctionDialog.getByRole('button', { name: /取\s*消/u }).click();
  await page.setViewportSize({ width: 1600, height: 900 });
  const supersedeAction = inspectorFooter.getByRole('button', { name: '标记已替代' });
  const correctionBounds = await correctionAction.boundingBox();
  const supersedeBounds = await supersedeAction.boundingBox();
  expect(correctionBounds).not.toBeNull();
  expect(supersedeBounds).not.toBeNull();
  expect(
    (supersedeBounds?.x ?? 0) - ((correctionBounds?.x ?? 0) + (correctionBounds?.width ?? 0)),
  ).toBeGreaterThanOrEqual(8);
  expect(
    (supersedeBounds?.x ?? 0) - ((correctionBounds?.x ?? 0) + (correctionBounds?.width ?? 0)),
  ).toBeLessThanOrEqual(16);
  await expect(supersedeAction).toHaveClass(/ant-btn-text/u);

  await page.getByRole('tab', { name: '项目概况' }).click();
  await page.getByRole('button', { name: '项目结构 1' }).click();
  await page.getByRole('tab', { name: '项目规范' }).click();
  await expect(page.getByLabel('项目知识记录列表')).toContainText('Policy checks');
  await expect(page.getByLabel('项目知识记录列表')).not.toContainText('Focused tests');
  await expect(page.getByRole('tab', { name: '项目规范' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('tab', { name: '检索语料' }).click();
  await expect(page.getByRole('heading', { name: '检索语料' })).toHaveCount(0);
  await expect(page.locator('.dashboard-knowledge-source-toolbar')).toContainText(/提供器/u);
  await expect(page.getByLabel('项目知识检索语料列表')).toContainText('docs/rule.md');
  await expect(page.getByLabel('项目知识检索语料列表')).not.toContainText(
    'domains/project-knowledge/local-provider.ts',
  );
  await expect(page.getByLabel('搜索项目知识检索语料')).toBeVisible();
  await expect(page.getByText('共 124 个语料文件', { exact: true })).toBeVisible();
  const sourceList = page.getByLabel('项目知识检索语料列表');
  await expect(sourceList.getByRole('button')).toHaveCount(124);
  await expect(sourceList.getByRole('button', { name: '查看来源：docs/rule.md' })).toContainText(
    '1 条',
  );
  const sourceRows = page.locator('.dashboard-knowledge-source-rows');
  await expect
    .poll(() => sourceRows.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  const sourceHeaderFirstColumn = await page
    .locator('.dashboard-knowledge-source-head > span')
    .first()
    .boundingBox();
  const sourceRowFirstColumn = await sourceList
    .getByRole('button')
    .first()
    .locator('span')
    .first()
    .boundingBox();
  expect(sourceHeaderFirstColumn).not.toBeNull();
  expect(sourceRowFirstColumn).not.toBeNull();
  expect(
    Math.abs((sourceHeaderFirstColumn?.x ?? 0) - (sourceRowFirstColumn?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  const sourceHeaderRelatedColumn = await page
    .locator('.dashboard-knowledge-source-head > span')
    .nth(2)
    .boundingBox();
  const sourceRowRelatedColumn = await sourceList
    .getByRole('button')
    .first()
    .locator('strong')
    .boundingBox();
  expect(sourceHeaderRelatedColumn).not.toBeNull();
  expect(sourceRowRelatedColumn).not.toBeNull();
  expect(
    Math.abs((sourceHeaderRelatedColumn?.x ?? 0) - (sourceRowRelatedColumn?.x ?? 0)),
  ).toBeLessThanOrEqual(1);
  await sourceRows.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    sourceList.getByRole('button', { name: '查看来源：docs/generated/source-124.md' }),
  ).toBeVisible();
  await page.getByLabel('搜索项目知识检索语料').fill('rule.md');
  await expect(page.getByLabel('项目知识检索语料列表')).toContainText('docs/rule.md');
  await expect(page.getByLabel('项目知识检索语料列表')).not.toContainText('docs/policy.md');
  const pageLoadsBeforeSourceRead = projectKnowledgePageLoadCount;
  const pluginListsBeforeSourceRead = projectKnowledgeListCount;
  await page.getByRole('button', { name: '查看来源：docs/rule.md' }).click();
  const sourcePreview = page.getByRole('dialog', { name: /检索语料详情/u });
  await expect(sourcePreview).toContainText('docs/rule.md');
  expect(projectKnowledgePageLoadCount).toBe(pageLoadsBeforeSourceRead);
  expect(projectKnowledgeListCount).toBe(pluginListsBeforeSourceRead);
  expect(await page.locator('.ant-message').allTextContents()).not.toContain('操作已完成');
  await expect(sourcePreview.locator('.dashboard-settings-modal-title-row')).not.toContainText(
    'docs/rule.md',
  );
  await expect(sourcePreview.locator('button[aria-label="Close"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  const [sourceHeaderBox, sourceExpandBox] = await Promise.all([
    sourcePreview.locator('.ant-modal-header').boundingBox(),
    sourcePreview.getByRole('button', { name: '全屏展示' }).boundingBox(),
  ]);
  if (!sourceHeaderBox || !sourceExpandBox) {
    throw new Error('Expected the source preview header and fullscreen button bounds');
  }
  expect(
    Math.abs(
      sourceHeaderBox.x + sourceHeaderBox.width - (sourceExpandBox.x + sourceExpandBox.width) - 20,
    ),
  ).toBeLessThanOrEqual(2);
  await expect(sourcePreview.getByRole('heading', { name: 'Rule', level: 1 })).toBeVisible();
  await expect(sourcePreview).toContainText('Run focused tests first.');
  await expect(sourcePreview).not.toContainText('# Rule');
  await expect(sourcePreview.locator('.ant-modal-container')).toHaveCSS(
    'transition-duration',
    /0\.36s/u,
  );
  await sourcePreview.getByRole('button', { name: '全屏展示' }).click();
  await expect(sourcePreview.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await sourcePreview.getByRole('button', { name: '退出全屏' }).click();
  await expect(sourcePreview.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(sourcePreview).toBeHidden();
  await page.getByRole('button', { name: '查看来源：docs/rule.md' }).click();
  await expect(page.getByRole('dialog', { name: /检索语料详情/u })).toContainText(
    'Run focused tests first.',
  );
  expect(sourceReadCount).toBe(1);
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await page.getByLabel('搜索项目知识检索语料').fill('verify-result.md');
  await page.getByRole('button', { name: '查看来源：docs/verify-result.md' }).click();
  const verifyPreview = page.getByRole('dialog', { name: /检索语料详情/u });
  await expect(verifyPreview.getByRole('heading', { name: 'Verification result' })).toBeVisible();
  await expect(verifyPreview.getByText('Acceptance: acceptance-1', { exact: true })).toBeVisible();
  await expect(verifyPreview.locator('button[aria-label="Close"]')).toHaveCount(0);
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });

  await page.getByRole('tab', { name: '检索测试' }).click();
  await expect(page.getByRole('heading', { name: '检索测试' })).toHaveCount(0);
  await expect(page.locator('.dashboard-knowledge-query-hint')).toHaveText(
    '输入任务描述，预览匹配的项目知识',
  );
  const queryForm = page.locator('.dashboard-knowledge-query-form');
  const queryInput = page.getByLabel('查询项目知识');
  const queryAction = page.locator('.dashboard-knowledge-query-action');
  const queryInputBounds = await queryInput.boundingBox();
  const queryActionBounds = await queryAction.boundingBox();
  expect(queryInputBounds).not.toBeNull();
  expect(queryActionBounds).not.toBeNull();
  expect(queryActionBounds?.y ?? 0).toBeGreaterThanOrEqual(
    (queryInputBounds?.y ?? 0) + (queryInputBounds?.height ?? 0) - 1,
  );
  expect(queryActionBounds?.width ?? 0).toBeGreaterThan((queryInputBounds?.width ?? 0) * 0.9);
  await expect(queryForm).toContainText('测试检索');
  await page.getByLabel('查询项目知识').fill('focused tests');
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect(page.getByLabel('项目知识查询结果')).toContainText('Run focused tests first.');
  const queryView = page.getByRole('region', { name: '检索测试', exact: true });
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await queryView.hover();
    await page.mouse.wheel(0, 10000);
    await expect.poll(() => queryView.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button', { name: '查看检索结果：Focused tests 8' }).click();
    const resultDialog = page.getByRole('dialog', { name: /检索结果详情/u });
    await expect(
      resultDialog.getByRole('heading', { name: 'Focused tests', exact: true }),
    ).toBeVisible();
    const resultScroll = resultDialog.locator('.dashboard-knowledge-preview-scroll');
    await expect
      .poll(async () => {
        await resultScroll.hover();
        await page.mouse.wheel(0, 1000);
        return resultScroll.evaluate((element) => element.scrollTop);
      })
      .toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(resultDialog).toBeHidden();
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByLabel('查询项目知识').fill('1231');
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect.poll(() => queryTasks).toEqual(['focused tests', '1231']);
  await expect(page.getByLabel('项目知识查询结果')).toContainText(
    '检索已完成，没有找到与当前任务匹配的项目知识',
  );
  await page.getByRole('tab', { name: '项目概况' }).click();

  await page.getByRole('button', { name: '新增项目知识' }).click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toContainText('新增项目知识');
  await expect(createDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
  await expect(createDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await createDialog.getByRole('button', { name: '全屏展示' }).click();
  await expect(createDialog.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await createDialog.getByLabel('项目知识标题').fill('暂存标题');
  await createDialog.getByRole('button', { name: '退出全屏' }).click();
  await expect(createDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await expect(createDialog.getByLabel('项目知识标题')).toHaveValue('暂存标题');
  await expect(page.locator('.dashboard-create-modal-content')).toHaveCSS('border-radius', '10px');
  await expect(createDialog.locator('.dashboard-project-knowledge-create-form')).toHaveCSS(
    'display',
    'grid',
  );
  await createDialog.getByLabel('项目知识标题').fill('未文档化约定');
  await createDialog.getByLabel('项目知识摘要').fill('修改后先运行定向测试。');
  await createDialog.getByLabel('项目知识适用路径').fill('domains/');
  await createDialog.getByLabel('项目知识适用操作').fill('verify');
  await createDialog.getByLabel('项目知识验证命令').fill('pnpm test --filter project-knowledge');
  await page.getByRole('button', { name: /保\s*存/u }).click();
  await page.getByRole('tab', { name: '项目规范' }).click();
  await page.getByLabel('项目知识记录状态').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '强制执行' }).click();
  const manualRecordButton = page
    .getByLabel('项目知识记录列表')
    .getByRole('button', { name: /未文档化约定/u });
  await expect(manualRecordButton).toBeVisible();
  await manualRecordButton.click();
  await expect(page.getByText('用户确认', { exact: true }).last()).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: '记录详情' }).getByRole('status'),
  ).toContainText('缺少来源或验证记录');
  await page.getByRole('button', { name: '标记已替代' }).click();
  const archiveDialog = page.getByRole('dialog');
  await expect(archiveDialog).toContainText('将这条项目知识标记为已替代？');
  await archiveDialog.getByRole('button', { name: /标记已替代/u }).click();
  await expect(
    page.locator('.dashboard-knowledge-empty').getByText('项目规范回答“在项目中应该怎么做”'),
  ).toBeVisible();
  await page.getByLabel('项目知识记录状态').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '已替代' }).click();
  await expect(page.getByLabel('项目知识记录列表')).toContainText('未文档化约定');
  await expect(
    page.getByLabel('项目知识记录列表').getByText('已替代', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '纠正并恢复' }).click();
  const restoreDialog = page.getByRole('dialog');
  await expect(restoreDialog).toContainText('纠正并恢复项目知识');
  await restoreDialog.getByRole('textbox').fill('修改后先运行定向测试，并记录验证结果。');
  await restoreDialog.getByRole('button', { name: /保存\s*并\s*恢复/u }).click();
  await expect(page.getByText('项目知识已更新并恢复使用')).toBeVisible();
  await expect(
    page.locator('.dashboard-knowledge-empty').getByText('项目规范回答“在项目中应该怎么做”'),
  ).toBeVisible();
  await page.getByLabel('项目知识记录状态').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '强制执行' }).click();
  await expect(page.getByLabel('项目知识记录列表')).toContainText('未文档化约定');
  await expect(page.getByLabel('项目知识记录列表')).toContainText(
    '修改后先运行定向测试，并记录验证结果。',
  );

  await page.getByRole('button', { name: '设置' }).click();
  const settingsDialog = page.getByRole('dialog', { name: /Comet 设置/u });
  await expect(settingsDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
  await expect(settingsDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await settingsDialog.getByRole('button', { name: '全屏展示' }).click();
  await expect(settingsDialog.getByRole('button', { name: '退出全屏' })).toBeVisible();
  await settingsDialog.getByRole('button', { name: '退出全屏' }).click();
  await expect(settingsDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await expect(settingsDialog.getByLabel('项目知识设置')).toBeVisible();
  await expect(page.getByRole('heading', { name: '知识服务与检索' })).toBeVisible();
  await expect(settingsDialog.getByLabel('Token 环境变量名（可选）')).toHaveValue(
    'COMET_KNOWLEDGE_TOKEN',
  );
  await expect(page.getByRole('button', { name: '保存配置' })).toBeVisible();
  await expect(page.getByText('bearer-secret', { exact: true })).toHaveCount(0);

  await page.getByRole('switch', { name: '切换当前项目知识检索' }).click();
  await expect(settingsDialog.getByText('当前项目已暂停项目知识', { exact: true })).toBeVisible();
  await expect(
    page.locator('.dashboard-plugin-menu-item').filter({ hasText: '项目知识' }),
  ).toHaveText('项目知识暂停');
  const projectSettings = settingsDialog.getByRole('region', { name: '当前项目' });
  await expect(projectSettings).toContainText('当前项目已暂停向 Agent 提供知识');
  await expect(
    projectSettings.getByRole('switch', { name: '切换当前项目知识检索' }),
  ).not.toBeChecked();
  await expect(page.getByRole('heading', { name: '知识服务与检索' })).toHaveCount(0);
  await page.getByRole('switch', { name: '切换当前项目知识检索' }).click();
  await expect(page.getByRole('heading', { name: '知识服务与检索' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '切换当前项目知识检索' })).toBeChecked();

  await page.getByRole('button', { name: '卸载插件' }).click();
  await page
    .getByRole('dialog', { name: '卸载项目知识插件？' })
    .getByRole('button', { name: /卸\s*载/u })
    .click();
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
  await expect(page.getByLabel('项目规则设置')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: '项目知识' })).toHaveCount(0);
});

test('adds global or project memory, explains application, and permanently deletes records', async ({
  page,
}) => {
  const profileRecords = [
    {
      id: 'profile-memory',
      category: '沟通偏好',
      memoryClass: 'user-preference',
      memoryType: 'core-profile',
      scope: 'global',
      status: 'proven',
      text: '默认使用中文回复',
      evidenceCount: 2,
      applicationCount: 1,
      successCount: 1,
      failureCount: 0,
      lastApplication: {
        applicationId: 'application-profile-memory',
        whyApplied: '用户明确设置',
        delivery: 'manifest',
        appliedAt: '2026-08-23T00:00:00.000Z',
        outcome: 'used-successfully',
      },
      applicationHistory: [
        {
          applicationId: 'application-profile-memory-2',
          task: '撰写发布说明',
          whyApplied: '用户明确设置',
          delivery: 'full',
          appliedAt: '2026-08-23T00:00:00.000Z',
          outcome: 'used-successfully',
        },
        {
          applicationId: 'application-profile-memory-1',
          task: '回答项目问题',
          whyApplied: '用户明确设置',
          delivery: 'manifest',
          appliedAt: '2026-08-22T00:00:00.000Z',
          outcome: 'used-successfully',
        },
      ],
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
  ];
  const projectRecords: Array<Record<string, unknown>> = [];
  const managedRecords: Array<Record<string, unknown>> = [...profileRecords];
  const personalMemoryPage = {
    pluginId: 'comet.personal-memory',
    label: '个人记忆',
    route: '/plugins/personal-memory',
    status: 'enabled',
    globallyDisabled: false,
    projectPaused: false,
    diagnostics: [],
    data: {
      status: {
        learningEnabled: true,
        retrievalEnabled: true,
        files: ['MEMORY.md'],
        pausedLearningProjects: [],
        pausedRetrievalProjects: [],
        profile: { usedChars: 18, maxChars: 2000 },
        provider: { provider: 'local', configured: true },
        learning: {
          lastCheckedAt: '2026-08-23T00:00:00.000Z',
          lastCheck: 'submitted',
          lastResult: 'candidate-created',
          lastReason: '等待另一个独立成功 change 的证据',
          lastProjectKey: 'fixture-project',
          lastWorkflow: 'native',
          lastChangeId: 'change-learning-1',
          observedCount: 1,
          validObservationCount: 1,
        },
      },
      retrieval: { records: projectRecords, profileRecords },
      management: { records: managedRecords, conflicts: [] },
      policy: { learning: true, retrieval: true },
      projectKey: 'fixture-project',
      providerConfig: {
        provider: 'local',
        profileCharLimit: 2000,
        taskContextCharLimit: 6000,
      },
      manifestPreview: [
        {
          id: 'profile-memory',
          title: '沟通偏好',
          summary: '默认使用中文回复',
          whyApplied: '用户明确设置',
          delivery: 'manifest',
          appliedAt: '2026-08-23T00:00:00.000Z',
          outcome: 'used-successfully',
          lastApplication: {
            task: '撰写发布说明',
            whyApplied: '用户明确设置',
            delivery: 'manifest',
            appliedAt: '2026-08-23T00:00:00.000Z',
            outcome: 'used-successfully',
          },
        },
      ],
    },
  };
  let rememberRequest: unknown;
  let removeRequest: unknown;

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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-23T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
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
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.personal-memory/invoke')) {
      const body = route.request().postDataJSON() as {
        capability: string;
        input: {
          id?: string;
          permanent?: boolean;
          scope?: string;
          memoryClass: string;
          category: string;
          text: string;
        };
      };
      rememberRequest = body;
      const existingRecord = managedRecords.find((record) => record.id === body.input.id);
      const targetRecords =
        existingRecord?.scope === 'project' || body.input.scope === 'project'
          ? projectRecords
          : profileRecords;
      if (body.capability === 'remove') {
        removeRequest = body;
        if (body.input.permanent === true) {
          const targetIndex = targetRecords.findIndex((record) => record.id === body.input.id);
          if (targetIndex >= 0) targetRecords.splice(targetIndex, 1);
          const managedIndex = managedRecords.findIndex((record) => record.id === body.input.id);
          if (managedIndex >= 0) managedRecords.splice(managedIndex, 1);
        } else {
          const target = targetRecords.find((record) => record.id === body.input.id);
          if (target) target.status = 'superseded';
        }
        await route.fulfill({ json: { result: null } });
        return;
      }
      const addedRecord = {
        id: body.input.scope === 'project' ? 'new-project-memory' : 'new-profile-memory',
        ...body.input,
        memoryType: body.input.scope === 'project' ? 'collaboration-policy' : 'core-profile',
        status: 'proven',
        evidenceCount: 1,
        updatedAt: '2026-08-23T00:00:00.000Z',
      };
      targetRecords.push(addedRecord);
      managedRecords.push(addedRecord);
      await route.fulfill({ json: { result: { id: 'new-profile-memory' } } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.personal-memory')) {
      await route.fulfill({ json: personalMemoryPage });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({
        json: {
          pages: [
            {
              pluginId: personalMemoryPage.pluginId,
              label: personalMemoryPage.label,
              route: personalMemoryPage.route,
              status: personalMemoryPage.status,
              globallyDisabled: personalMemoryPage.globallyDisabled,
              projectPaused: personalMemoryPage.projectPaused,
              diagnostics: personalMemoryPage.diagnostics,
            },
          ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const learningStatus = page.locator('.dashboard-memory-learning-diagnostic');
  await expect(learningStatus).toContainText('已形成候选，等待独立证据');
  await expect(learningStatus).toContainText('时间：2026-08-23T00:00:00.000Z');
  await expect(learningStatus).toContainText(
    '归属：项目 fixture-project · workflow native · change change-learning-1',
  );
  await expect(learningStatus).toContainText('原因：等待另一个独立成功 change 的证据');
  await expect(page.getByRole('button', { name: '个人偏好与事实 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: '协作约定 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: '任务经验 0' })).toBeVisible();
  const personalMemoryHelp = page.getByRole('button', { name: '了解个人记忆分类' });
  await personalMemoryHelp.click();
  await expect(page.getByText('个人偏好与事实保存长期稳定的信息')).toBeVisible();
  await expect(page.getByText('任务经验只在相似场景中参考')).toBeVisible();
  await personalMemoryHelp.click();
  const collaborationCategory = page.getByRole('button', { name: '协作约定 0' });
  await collaborationCategory.hover();
  await expect(
    page.getByRole('tooltip', { name: '希望 Agent 持续采用的沟通和工作方式', exact: true }),
  ).toBeVisible();
  await collaborationCategory.click();
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .getByText('希望 Agent 持续采用的沟通和工作方式', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '个人偏好与事实 1' }).click();
  const profileHelp = page.getByRole('button', { name: '了解个人偏好与事实' });
  await profileHelp.click();
  await expect(page.getByText('例如：语言、角色和表达方式。')).toBeVisible();
  await profileHelp.click();
  await page.getByRole('button', { name: '全部记忆 1' }).click();
  const memorySort = page.getByRole('combobox', { name: '记忆排序方式' });
  const memorySortControl = memorySort.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ant-select ')][1]",
  );
  await expect(memorySortControl).toHaveCSS('height', '32px');
  const memoryManifest = page.getByRole('region', { name: '最近一次任务使用的记忆' });
  await expect(memoryManifest).toContainText('最近使用');
  await expect(memoryManifest).toContainText('任务：撰写发布说明');
  await expect(memoryManifest).toContainText('1 条记忆');
  await expect(memoryManifest).not.toContainText('默认使用中文回复');
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .locator('.dashboard-memory-table-row')
      .filter({ hasText: '默认使用中文回复' }),
  ).toContainText('用户确认');
  const manifestMemoryButton = memoryManifest.getByRole('button', {
    name: '查看使用明细',
  });
  await expect(manifestMemoryButton).toBeVisible();
  await manifestMemoryButton.click();
  const manifestMemoryDialog = page.getByRole('dialog', {
    name: /沟通偏好/u,
  });
  await expect(manifestMemoryDialog).toBeVisible();
  const manifestMemoryTitle = manifestMemoryDialog.locator('.dashboard-settings-modal-title-row');
  await expect(manifestMemoryTitle.locator('strong')).toHaveText('沟通偏好');
  await expect(manifestMemoryTitle.locator('span')).toHaveCount(0);
  await expect(manifestMemoryDialog.locator('.dashboard-settings-modal-title p')).toHaveCount(0);
  await expect(manifestMemoryDialog).toContainText('默认使用中文回复');
  await expect(manifestMemoryDialog).toContainText('为什么使用');
  await expect(manifestMemoryDialog).toContainText('用户明确设置');
  await expect(manifestMemoryDialog).toContainText('应用成功');
  await expect(page.getByLabel('记忆应用详情')).toContainText('撰写发布说明');
  await expect(page.getByLabel('记忆应用详情')).toContainText('回答项目问题');
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(manifestMemoryDialog).toBeHidden();
  await page.getByRole('button', { name: '新增偏好' }).click();

  const profileDialog = page.getByRole('dialog').last();
  await expect(profileDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
  await expect(profileDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  const profileInput = profileDialog.getByLabel('偏好内容');
  await expect(profileInput).toBeVisible();
  await expect(profileDialog.getByLabel('主题（可选）')).toBeVisible();
  await expect(profileDialog).toContainText('不会创建新的系统分组');
  await expect(profileInput).toBeFocused();
  await expect(profileDialog.getByRole('button', { name: /保\s*存/u })).toBeDisabled();

  await profileInput.fill('提交前先运行最小相关测试');
  await page.route(
    '**/api/dashboard/**/invoke',
    async (route) => {
      await route.fulfill({ status: 500, json: { error: 'Save unavailable' } });
    },
    { times: 1 },
  );
  await profileDialog.getByRole('button', { name: /保\s*存/u }).click();
  await expect(profileDialog).toBeVisible();
  await expect(profileInput).toHaveValue('提交前先运行最小相关测试');
  await profileDialog.getByRole('button', { name: /保\s*存/u }).click();

  await expect(profileDialog).toBeHidden();
  await expect
    .poll(() => rememberRequest)
    .toEqual({
      capability: 'remember',
      input: {
        scope: 'global',
        memoryClass: 'user-preference',
        category: '沟通偏好',
        text: '提交前先运行最小相关测试',
      },
    });
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .getByText('提交前先运行最小相关测试', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '新增项目记忆' }).click();
  const projectDialog = page.getByRole('dialog').last();
  const projectInput = projectDialog.getByLabel('记忆内容');
  await expect(projectInput).toBeVisible();
  await expect(projectDialog.getByLabel('主题（可选）')).toBeVisible();
  await expect(projectDialog).toContainText('不会创建新的系统分组');
  await expect(projectInput).toBeFocused();
  await projectInput.fill('这个项目优先使用最小相关测试');
  await projectDialog.getByRole('button', { name: /保\s*存/u }).click();

  await expect
    .poll(() => rememberRequest)
    .toEqual({
      capability: 'remember',
      input: {
        scope: 'project',
        projectKey: 'fixture-project',
        memoryClass: 'project-convention',
        category: '项目约定',
        text: '这个项目优先使用最小相关测试',
      },
    });
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .getByText('这个项目优先使用最小相关测试', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .locator('.dashboard-memory-table-row')
      .filter({ hasText: '这个项目优先使用最小相关测试' })
      .getByRole('button', { name: '为什么应用：尚未应用' }),
  ).toBeVisible();

  const projectSection = page.getByRole('region', { name: '个人记忆列表' });
  await projectSection
    .locator('.dashboard-memory-table-row')
    .filter({ hasText: '这个项目优先使用最小相关测试' })
    .getByLabel('删除记忆')
    .click();
  await expect
    .poll(() => removeRequest)
    .toMatchObject({
      capability: 'remove',
      input: expect.objectContaining({ permanent: true }),
    });
  await expect(
    projectSection
      .locator('.dashboard-memory-table-row')
      .filter({ hasText: '这个项目优先使用最小相关测试' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '协作约定 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: '历史记录 0' })).toBeVisible();

  const profileSection = page.getByRole('region', { name: '个人记忆列表' });
  await profileSection
    .locator('.dashboard-memory-table-row')
    .filter({ hasText: '默认使用中文回复' })
    .getByLabel('删除记忆')
    .click();
  await expect
    .poll(() => removeRequest)
    .toMatchObject({
      capability: 'remove',
      input: expect.objectContaining({ id: 'profile-memory', permanent: true }),
    });
  await expect(memoryManifest).not.toContainText('默认使用中文回复');
  await profileSection
    .locator('.dashboard-memory-table-row')
    .filter({ hasText: '提交前先运行最小相关测试' })
    .getByLabel('删除记忆')
    .click();
  await expect(page.getByRole('region', { name: '个人记忆列表' })).toContainText(
    '当前没有有效个人记忆；已有记忆文件中暂无可复用的内容',
  );
  await expect(page.locator('.dashboard-tool-page-memory')).not.toContainText('投影');
});

test('collapses long personal memory records until the user expands them', async ({ page }) => {
  const record = {
    id: 'long-memory',
    category: 'preference',
    memoryType: 'collaboration-policy',
    scope: 'project',
    status: 'proven',
    text: '长记忆内容。'.repeat(80),
    evidenceCount: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
  const personalMemoryPage = {
    pluginId: 'comet.personal-memory',
    label: '个人记忆',
    route: '/plugins/personal-memory',
    status: 'enabled',
    globallyDisabled: false,
    projectPaused: false,
    diagnostics: [],
    data: {
      status: {
        learningEnabled: true,
        retrievalEnabled: true,
        files: [],
        pausedLearningProjects: [],
        pausedRetrievalProjects: [],
        profile: { usedChars: 18, maxChars: 2000 },
        provider: { provider: 'local', configured: true },
      },
      retrieval: {
        records: [record],
        profileRecords: [
          {
            id: 'profile-memory',
            category: '沟通偏好',
            memoryClass: 'user-preference',
            memoryType: 'core-profile',
            scope: 'global',
            status: 'proven',
            text: '默认使用中文回复',
            evidenceCount: 2,
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
        ],
      },
      management: {
        records: [
          {
            id: 'profile-memory',
            category: '沟通偏好',
            memoryClass: 'user-preference',
            memoryType: 'core-profile',
            scope: 'global',
            status: 'proven',
            text: '默认使用中文回复',
            evidenceCount: 2,
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
          record,
        ],
        conflicts: [],
      },
      policy: { learning: true, retrieval: true },
      projectKey: 'fixture-project',
      providerConfig: {
        provider: 'local',
        profileCharLimit: 2000,
        taskContextCharLimit: 6000,
      },
    },
  };

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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-20T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
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
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.personal-memory')) {
      await route.fulfill({ json: personalMemoryPage });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({
        json: {
          pages: [
            {
              pluginId: personalMemoryPage.pluginId,
              label: personalMemoryPage.label,
              route: personalMemoryPage.route,
              status: personalMemoryPage.status,
              globallyDisabled: personalMemoryPage.globallyDisabled,
              projectPaused: personalMemoryPage.projectPaused,
              diagnostics: personalMemoryPage.diagnostics,
            },
          ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();

  await expect(page.getByLabel('个人记忆状态与操作')).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: '个人记忆列表' })
      .getByText('默认使用中文回复', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '新增偏好' }).click();
  const profileDialog = page.getByRole('dialog', { name: '新增偏好' });
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByRole('button', { name: /取\s*消/u }).click();
  const memoryText = page
    .getByRole('region', { name: '个人记忆列表' })
    .locator('.dashboard-memory-table-row')
    .filter({ hasText: '长记忆内容。长记忆内容。' })
    .locator('.dashboard-memory-table-copy > p');
  const toggle = page.getByRole('button', { name: '展开完整记忆', exact: true });
  await expect(memoryText).toHaveClass(/is-collapsed/);
  await expect(memoryText).toHaveText(`${record.text.slice(0, 240)}…`);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(memoryText).not.toHaveClass(/is-collapsed/);
  await expect(memoryText).toHaveText(record.text);
  await expect(page.getByRole('button', { name: '收起完整记忆', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('个人记忆设置')).toBeVisible();
  await expect(
    page.getByText(
      '服务切换不会迁移或删除已有数据。请先保存配置，再测试连接；测试使用已保存的配置。',
    ),
  ).toBeVisible();
});

test('shows a corrected personal memory immediately after persistence succeeds', async ({
  page,
}) => {
  const originalRecord = {
    id: 'memory-to-correct',
    category: '协作偏好',
    scope: 'project',
    text: '纠正前的项目记忆',
    evidenceCount: 1,
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
  let correctedRecord: typeof originalRecord | null = null;
  let postCorrectionSnapshotReads = 0;
  const pageSnapshot = (record: typeof originalRecord) => ({
    pluginId: 'comet.personal-memory',
    label: '个人记忆',
    route: '/plugins/personal-memory',
    status: 'enabled',
    globallyDisabled: false,
    projectPaused: false,
    diagnostics: [],
    data: {
      status: {
        learningEnabled: true,
        retrievalEnabled: true,
        files: [],
        profile: { usedChars: 0, maxChars: 2000 },
        provider: { provider: 'local', configured: true },
      },
      retrieval: { records: [record], profileRecords: [] },
      management: { records: [record], conflicts: [] },
      policy: { learning: true, retrieval: true },
      projectKey: 'fixture-project',
    },
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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-20T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
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
      await route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.personal-memory/invoke')) {
      const body = route.request().postDataJSON() as {
        capability?: string;
        input?: { id?: string; correction?: { text?: string } };
      };
      if (
        body.capability === 'correct' &&
        body.input?.id === originalRecord.id &&
        typeof body.input.correction?.text === 'string'
      ) {
        correctedRecord = {
          ...originalRecord,
          text: body.input.correction.text,
          updatedAt: '2026-08-23T00:00:00.000Z',
        };
      }
      await route.fulfill({ json: { result: correctedRecord ?? originalRecord } });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.personal-memory')) {
      const snapshotRecord =
        correctedRecord !== null && postCorrectionSnapshotReads++ > 0
          ? correctedRecord
          : originalRecord;
      await route.fulfill({ json: pageSnapshot(snapshotRecord) });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      const snapshot = pageSnapshot(originalRecord);
      await route.fulfill({
        json: {
          pages: [
            {
              pluginId: snapshot.pluginId,
              label: snapshot.label,
              route: snapshot.route,
              status: snapshot.status,
              globallyDisabled: snapshot.globallyDisabled,
              projectPaused: snapshot.projectPaused,
              diagnostics: snapshot.diagnostics,
            },
          ],
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const projectMemory = page.getByRole('region', { name: '个人记忆列表' });
  const projectMemoryRow = projectMemory.locator('.dashboard-memory-table-row').first();
  await expect(projectMemoryRow.getByText(originalRecord.text, { exact: true })).toBeVisible();

  await projectMemoryRow.getByRole('button', { name: '纠正记忆', exact: true }).click();
  const correctionDialog = page.getByRole('dialog', { name: '纠正这条记忆' });
  await expect(correctionDialog.locator('button[aria-label="Close"]')).toHaveCount(0);
  await expect(correctionDialog.getByRole('button', { name: '全屏展示' })).toBeVisible();
  await correctionDialog.getByRole('textbox').fill('纠正后的项目记忆');
  await correctionDialog.getByRole('button', { name: /保\s*存/u }).click();

  await expect(correctionDialog).toBeHidden();
  await expect(projectMemoryRow.getByText('纠正后的项目记忆', { exact: true })).toBeVisible();
  await expect(projectMemoryRow.getByText(originalRecord.text, { exact: true })).toHaveCount(0);
});

test('loads the demo dashboard and previews an artifact', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');

  await expect(page).toHaveTitle('Comet Dashboard');
  const sidebarBrandTitle = page.locator('.dashboard-sidebar-brand-copy > strong');
  await expect(sidebarBrandTitle).toHaveText('Comet Dashboard');
  await expect(page.locator('.dashboard-sidebar')).toHaveCSS('width', '228px');
  await expect
    .poll(() =>
      sidebarBrandTitle.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
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
  const nativeSelectedRow = page
    .locator('.native-change-row')
    .filter({ hasText: 'ship-native-dashboard' });
  await expect(nativeSelectedRow).toContainText('构建中');
  await expect(nativeSelectedRow).not.toContainText('待验证');
  const nativePhaseTrack = page.getByRole('list', { name: 'Native 生命周期阶段' });
  await expect(nativePhaseTrack.locator('.dashboard-phase-item')).toHaveCount(4);
  const nativeCurrentPhase = nativePhaseTrack.locator('.dashboard-phase-item.is-current');
  await expect(nativeCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS('width', '32px');
  await expect(nativeCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS('height', '32px');
  await expect(nativeCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS(
    'border-width',
    '0px',
  );
  await expect(nativeCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  const nativeOriginWave = nativeCurrentPhase.getByRole('status', { name: 'Build 正在进行' });
  const nativeOriginWaveDots = nativeOriginWave.locator('.dashboard-phase-origin-wave-dot');
  await expect(nativeOriginWave).toHaveClass(/dashboard-phase-origin-wave/);
  await expect(nativeOriginWaveDots).toHaveCount(25);
  await expect(nativeOriginWave).toHaveCSS('width', '28px');
  await expect(nativeOriginWaveDots.first()).toHaveCSS(
    'animation-name',
    'comet-phase-origin-wave, comet-phase-origin-wave-spectrum-start',
  );
  await expect(nativeOriginWaveDots.first()).toHaveCSS('animation-duration', '1.2s, 8.4s');
  const samplePhasePalette = (currentTime) =>
    nativeOriginWaveDots.first().evaluate((element, time) => {
      for (const animation of element.getAnimations({ subtree: true })) {
        if (!animation.animationName.includes('spectrum')) continue;
        animation.currentTime = time;
        animation.pause();
      }
      return {
        start: getComputedStyle(element).backgroundColor,
        middle: getComputedStyle(element, '::before').backgroundColor,
        end: getComputedStyle(element, '::after').backgroundColor,
      };
    }, currentTime);
  await expect
    .poll(() => samplePhasePalette(2_900))
    .toEqual({
      start: 'rgb(198, 93, 14)',
      middle: 'rgb(249, 115, 22)',
      end: 'rgb(245, 185, 66)',
    });
  await expect
    .poll(() => samplePhasePalette(6_500))
    .toEqual({
      start: 'rgb(255, 77, 109)',
      middle: 'rgb(255, 209, 102)',
      end: 'rgb(6, 214, 160)',
    });
  await expect
    .poll(() =>
      nativeOriginWaveDots
        .first()
        .evaluate((element) => getComputedStyle(element, '::before').animationName),
    )
    .toBe('comet-phase-origin-wave-middle, comet-phase-origin-wave-spectrum-middle');
  await expect
    .poll(() =>
      nativeOriginWaveDots
        .first()
        .evaluate((element) => getComputedStyle(element, '::after').animationName),
    )
    .toBe('comet-phase-origin-wave-end, comet-phase-origin-wave-spectrum-end');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(nativeOriginWaveDots.first()).toHaveCSS('animation-name', 'none');
  await expect
    .poll(() =>
      nativeOriginWaveDots
        .first()
        .evaluate((element) => getComputedStyle(element, '::before').animationName),
    )
    .toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const nativeCopyChangeName = page.getByRole('button', { name: '复制 Change 名称' });
  await expect(nativeCopyChangeName).toHaveCount(1);
  await nativeCopyChangeName.click();
  await expect(page.getByRole('button', { name: '已复制 Change 名称' })).toBeVisible();

  await page.getByRole('button', { name: '需求简报' }).click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeVisible();
  const nativeArtifactPreview = page.locator('.dashboard-artifact-preview-panel');
  await expect(
    nativeArtifactPreview.getByRole('heading', {
      name: 'Brief: 交付可恢复的 Native Dashboard',
    }),
  ).toBeVisible();
  await expect(nativeArtifactPreview).toContainText('验收标准');
  await expect(
    page.locator('.dashboard-artifact-preview-panel > header > .dashboard-artifact-preview-close'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭产物预览' })).toBeVisible();
  await expect(page.getByRole('button', { name: '全屏展示' })).toHaveCount(0);
  await page.locator('.dashboard-artifact-preview-backdrop').click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeHidden();

  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'document-native-resume' })).toBeVisible();
  await expect(page.getByLabel('Archive 已完成')).toHaveText('✓');
  await expect(
    page.getByRole('list', { name: 'Native 生命周期阶段' }).locator('.dashboard-phase-origin-wave'),
  ).toHaveCount(0);
  await expect(page.getByText(/Build ↔ Verify Loop · 已完成/u)).toBeVisible();
  await expect(page.getByText('你已确认接受不完整验证结果', { exact: true })).toBeVisible();
  await expect(page.getByText('归档只读', { exact: true }).first()).toBeVisible();

  const classicWorkflow = page.getByRole('menuitem', { name: 'Classic 工作流' });
  await classicWorkflow.click();
  await expect(classicWorkflow).toHaveClass(/ant-menu-item-selected/);
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeHidden();
  const classicSelectedRow = page
    .locator('.dashboard-change-row')
    .filter({ hasText: 'add-auth-rate-limiting' });
  await expect(classicSelectedRow).toContainText('构建中');
  await expect(classicSelectedRow).not.toContainText('待验证');
  const classicPhaseTrack = page.getByRole('list', { name: 'Classic 生命周期阶段' });
  await expect(classicPhaseTrack.locator('.dashboard-phase-item')).toHaveCount(5);
  const classicCurrentPhase = classicPhaseTrack.locator('.dashboard-phase-item.is-current');
  await expect(classicCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS('width', '32px');
  await expect(classicCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS('height', '32px');
  await expect(classicCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS(
    'border-width',
    '0px',
  );
  await expect(classicCurrentPhase.locator('.dashboard-phase-node')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(classicCurrentPhase.locator('.dashboard-phase-origin-wave-dot')).toHaveCount(25);

  const proposal = page.getByRole('button').filter({ hasText: 'proposal' }).first();
  await expect(proposal).toBeVisible();
  await proposal.click();

  await expect(page.getByRole('heading', { name: '提案', level: 2 })).toBeVisible();
  const classicArtifactPreview = page.locator('.dashboard-artifact-preview-panel');
  await expect(
    classicArtifactPreview.getByRole('heading', {
      name: 'Proposal: 为认证接口增加分布式限流',
    }),
  ).toBeVisible();
  await expect(classicArtifactPreview).toContainText('登录和令牌刷新接口在活动流量峰值期间');
  await expect(page.getByRole('button', { name: '全屏展示' })).toHaveCount(0);
  await page.locator('.dashboard-artifact-preview-backdrop').click();
  await expect(page.getByRole('heading', { name: '提案', level: 2 })).toBeHidden();

  const personalMemory = page.getByRole('menuitem', { name: '个人记忆' });
  await expect(personalMemory).not.toHaveClass(/ant-menu-item-disabled/);
  await personalMemory.click();
  const personalMemoryList = page.getByRole('region', { name: '个人记忆列表' });
  await expect(personalMemoryList).toBeVisible();
  await expect(
    personalMemoryList.getByText(/默认使用中文沟通。代码任务的最终回复先给结论/u),
  ).toBeVisible();
  const demoMemoryManifest = page.getByRole('region', { name: '最近一次任务使用的记忆' });
  await expect(demoMemoryManifest).toContainText('任务：调整官网 Dashboard 数据');
  await expect(demoMemoryManifest).toContainText('2 条记忆');
  await expect(demoMemoryManifest).not.toContainText('默认使用中文沟通');
  await demoMemoryManifest.getByRole('button', { name: '查看使用明细' }).click();
  const demoMemoryDialog = page.getByRole('dialog', {
    name: /交付语言与结构/u,
  });
  await expect(demoMemoryDialog).toBeVisible();
  const demoMemoryNavigation = demoMemoryDialog.getByRole('navigation', {
    name: '本次使用的个人记忆',
  });
  await expect(demoMemoryNavigation).toContainText('交付语言与结构');
  await expect(demoMemoryNavigation).toContainText('个人偏好');
  await expect(demoMemoryNavigation).toContainText('Dashboard 验收基线');
  await expect(demoMemoryNavigation).toContainText('协作约定');
  await demoMemoryNavigation
    .getByRole('button', { name: '查看个人记忆详情：Dashboard 验收基线' })
    .click();
  await expect(page.getByRole('dialog', { name: /Dashboard 验收基线/u })).toContainText(
    '移动端按 390 × 844 检查',
  );
  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(demoMemoryDialog).toBeHidden();

  const projectKnowledge = page.getByRole('menuitem', { name: '项目知识' });
  await expect(projectKnowledge).not.toHaveClass(/ant-menu-item-disabled/);
  await projectKnowledge.click();
  await expect(page.getByRole('tablist', { name: '项目知识视图' })).toBeVisible();
  await expect(
    page.locator('[aria-label="项目知识记录列表"]').getByText('Dashboard 数据采集与详情读取链路'),
  ).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('keeps change summaries single-line and explains Native workflow state', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const nativeSummaries = page.locator('.native-change-row .text-meta').filter({ hasText: '·' });
  await expect(nativeSummaries.first()).toBeVisible();
  await expect
    .poll(() =>
      nativeSummaries.evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).whiteSpace === 'nowrap'),
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: '工作流状态' }).click();
  const preview = page.locator('.dashboard-artifact-preview-panel');
  await expect(preview.getByRole('columnheader', { name: '说明' })).toBeVisible();
  await expect(preview.getByText('当前所处的工作流阶段。')).toBeVisible();
  await expect(preview.locator('tbody tr').first().locator('td').first()).toContainText(
    'Native 状态文件的格式版本。',
  );
  await expect(
    preview.locator('pre.structured-json-value code.language-json').first(),
  ).toBeVisible();

  await page.locator('.dashboard-artifact-preview-backdrop').click();
  await page.getByRole('menuitem', { name: 'Classic 工作流' }).click();
  const classicSummaries = page
    .locator('.dashboard-change-row .text-meta')
    .filter({ hasText: '·' });
  await expect(classicSummaries.first()).toBeVisible();
  await expect
    .poll(() =>
      classicSummaries.evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).whiteSpace === 'nowrap'),
      ),
    )
    .toBe(true);
});

test('keeps personal memory and project knowledge text readable at desktop density', async ({
  page,
}) => {
  const supportingText = /^(1[2-9]|[2-9]\\d)px$/u;
  const bodyText = /^(1[3-9]|[2-9]\\d)px$/u;

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');

  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const memoryManifest = page.getByRole('region', { name: '最近一次任务使用的记忆' });
  const memoryInspector = page.getByLabel('记忆应用详情');
  await expect(memoryManifest.locator('.dashboard-context-manifest-summary-copy span')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(memoryManifest.locator('.dashboard-context-manifest-summary-meta time')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(memoryInspector.locator('.dashboard-memory-inspector-list span').first()).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(
    memoryInspector.locator('.dashboard-memory-inspector-list strong').first(),
  ).toHaveCSS('font-size', bodyText);

  await page.getByRole('menuitem', { name: '项目知识' }).click();
  const projectManifest = page.getByRole('region', { name: '最近一次任务使用的项目知识' });
  const projectInspector = page.getByRole('complementary', { name: '记录详情' });
  await expect(projectManifest.locator('.dashboard-context-manifest-summary-copy span')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(projectManifest.locator('.dashboard-context-manifest-summary-meta time')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(page.locator('.dashboard-knowledge-category').first()).toHaveCSS(
    'font-size',
    bodyText,
  );
  await expect(page.locator('.dashboard-knowledge-category > span:last-child').first()).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(page.locator('.dashboard-knowledge-ledger-head')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(
    page.locator('.dashboard-knowledge-record-copy .dashboard-record-title-line > strong').first(),
  ).toHaveCSS('font-size', bodyText);
  await expect(page.locator('.dashboard-knowledge-record-copy > span').first()).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(projectInspector.locator('h4').first()).toHaveCSS('font-size', bodyText);
  await expect(projectInspector.locator('dt').first()).toHaveCSS('font-size', supportingText);
  await expect(projectInspector.locator('dd').first()).toHaveCSS('font-size', bodyText);

  await page.getByRole('tab', { name: '检索语料' }).click();
  await expect(page.locator('.dashboard-knowledge-source-head')).toHaveCSS(
    'font-size',
    supportingText,
  );
  await expect(page.locator('.dashboard-knowledge-source-row code').first()).toHaveCSS(
    'font-size',
    supportingText,
  );

  await page.getByRole('tab', { name: '检索测试' }).click();
  await expect(page.locator('.dashboard-knowledge-query-hint')).toHaveCSS(
    'font-size',
    supportingText,
  );
});

test('keeps context detail previews flat and readable', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');

  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await page
    .getByRole('region', { name: '最近一次任务使用的记忆' })
    .getByRole('button', { name: '查看使用明细' })
    .click();
  const memoryDialog = page.getByRole('dialog', { name: /交付语言与结构/u });
  await expect(memoryDialog.locator('.dashboard-settings-modal-title-row')).toHaveCSS(
    'border-left-width',
    '0px',
  );
  await expect(memoryDialog.locator('.dashboard-settings-modal-title-row > strong')).toHaveCSS(
    'font-size',
    '18px',
  );
  const memoryField = memoryDialog
    .locator('.dashboard-project-knowledge-detail > dl > div')
    .first();
  await expect(memoryField).toHaveCSS('border-radius', '0px');
  await expect(memoryField).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(memoryField).toHaveCSS('border-left-width', '0px');

  await page
    .locator('.dashboard-knowledge-preview-modal-root .ant-modal-wrap')
    .click({ position: { x: 5, y: 5 } });
  await expect(memoryDialog).toBeHidden();

  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await page.getByRole('tab', { name: '检索语料' }).click();
  await page
    .getByLabel('项目知识检索语料列表')
    .getByRole('button', { name: '查看来源：docs/comet/specs/dashboard.md' })
    .click();
  const sourceDialog = page.getByRole('dialog', { name: /检索语料详情/u });
  await expect(sourceDialog.locator('.dashboard-settings-modal-title-row')).toHaveCSS(
    'border-left-width',
    '0px',
  );
  await expect(sourceDialog.locator('.dashboard-settings-modal-title-row > strong')).toHaveCSS(
    'font-size',
    '18px',
  );
  await expect(
    sourceDialog.getByRole('heading', { name: 'Dashboard 检索语料', level: 1 }),
  ).toBeVisible();
  await expect(
    sourceDialog.locator('.dashboard-knowledge-source-rendered-content > pre'),
  ).toHaveCount(0);
  await expect(sourceDialog).not.toContainText('# Dashboard Web App');
  await expect(sourceDialog.locator('.dashboard-knowledge-source-detail dt').first()).toHaveCSS(
    'font-size',
    '12px',
  );
  await expect(sourceDialog.locator('.dashboard-knowledge-source-detail dd').first()).toHaveCSS(
    'font-size',
    '14px',
  );
  const sourceMarkdown = sourceDialog.locator('.dashboard-knowledge-source-rendered-content');
  await expect(sourceMarkdown).toHaveCSS('font-size', '14px');
  await expect(sourceMarkdown.locator('h1')).toHaveCSS('font-size', '20px');
  await expect(sourceMarkdown.locator('p').first()).toHaveCSS('font-size', '14px');
});

test('keeps personal memory and project knowledge three-pane widths aligned on desktop', async ({
  page,
}) => {
  const expectWorkflowHeaderToShareShellGutter = async () => {
    const [shellBox, headerContextBox, headerActionsBox] = await Promise.all([
      page.locator('.dashboard-content-shell').boundingBox(),
      page.locator('.comet-header-context').boundingBox(),
      page.locator('.comet-header-actions').boundingBox(),
    ]);
    expect(shellBox).not.toBeNull();
    expect(headerContextBox).not.toBeNull();
    expect(headerActionsBox).not.toBeNull();
    expect(Math.abs((headerContextBox?.x ?? 0) - (shellBox?.x ?? 0) - 34)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (shellBox?.x ?? 0) +
          (shellBox?.width ?? 0) -
          ((headerActionsBox?.x ?? 0) + (headerActionsBox?.width ?? 0)) -
          34,
      ),
    ).toBeLessThanOrEqual(1);
  };

  const expectPluginContentToStartAtShellEdge = async () => {
    const [shellBox, innerBox] = await Promise.all([
      page.locator('.dashboard-content-shell-plugin-center').boundingBox(),
      page.locator('.dashboard-content-inner-plugin-center').boundingBox(),
    ]);
    const [headerContextBox, headerActionsBox] = await Promise.all([
      page.locator('.comet-header-context').boundingBox(),
      page.locator('.comet-header-actions').boundingBox(),
    ]);
    expect(shellBox).not.toBeNull();
    expect(innerBox).not.toBeNull();
    expect(headerContextBox).not.toBeNull();
    expect(headerActionsBox).not.toBeNull();
    expect(Math.abs((innerBox?.x ?? 0) - (shellBox?.x ?? 0) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs((headerContextBox?.x ?? 0) - (shellBox?.x ?? 0) - 34)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (shellBox?.x ?? 0) +
          (shellBox?.width ?? 0) -
          (innerBox?.x ?? 0) -
          (innerBox?.width ?? 0) -
          16,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (shellBox?.x ?? 0) +
          (shellBox?.width ?? 0) -
          ((headerActionsBox?.x ?? 0) + (headerActionsBox?.width ?? 0)) -
          34,
      ),
    ).toBeLessThanOrEqual(1);
  };

  const paneWidths = async (selectors) =>
    Promise.all(
      selectors.map(async (selector) => {
        const bounds = await page.locator(selector).boundingBox();
        expect(bounds).not.toBeNull();
        return Math.round(bounds?.width ?? 0);
      }),
    );

  const expectRailSeparatorToStopBeforeDivider = async (selector, pseudo, borderColorProperty) => {
    const separator = await page.locator(selector).evaluate(
      (element, { pseudo, borderColorProperty }) => {
        const styles = getComputedStyle(element);
        const line = getComputedStyle(element, pseudo);
        return {
          content: line.content,
          left: line.left,
          right: line.right,
          borderColor: styles[borderColorProperty],
        };
      },
      { pseudo, borderColorProperty },
    );
    expect(separator.content).not.toBe('none');
    expect(separator.left).toBe('16px');
    expect(separator.right).toBe('16px');
    expect(separator.borderColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/u);
  };

  const expectRailElementsToShareSeparatorInset = async (
    railSelector,
    elementSelectors,
    footerSelector,
  ) => {
    const railBox = await page.locator(railSelector).boundingBox();
    expect(railBox).not.toBeNull();
    for (const selector of elementSelectors) {
      const elementBox = await page.locator(selector).boundingBox();
      expect(elementBox).not.toBeNull();
      expect(Math.abs((elementBox?.x ?? 0) - (railBox?.x ?? 0) - 16)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          (railBox?.x ?? 0) +
            (railBox?.width ?? 0) -
            ((elementBox?.x ?? 0) + (elementBox?.width ?? 0)) -
            16,
        ),
      ).toBeLessThanOrEqual(1);
    }
    const footerInsets = await page.locator(footerSelector).evaluate((element) => {
      const styles = getComputedStyle(element);
      return { left: styles.paddingLeft, right: styles.paddingRight };
    });
    expect(footerInsets).toEqual({ left: '16px', right: '16px' });
  };

  await page.setViewportSize({ width: 2200, height: 1100 });
  await page.goto('/?demo');

  await expectWorkflowHeaderToShareShellGutter();
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await expectPluginContentToStartAtShellEdge();
  await expectRailSeparatorToStopBeforeDivider(
    '.dashboard-memory-filter-search',
    '::after',
    'borderBottomColor',
  );
  await expectRailSeparatorToStopBeforeDivider(
    '.dashboard-memory-filter-summary',
    '::before',
    'borderTopColor',
  );
  await expectRailElementsToShareSeparatorInset(
    '.dashboard-memory-filter-rail',
    [
      '.dashboard-memory-filter-search .ant-input-affix-wrapper',
      '.dashboard-memory-filter-rail nav button.is-active',
    ],
    '.dashboard-memory-filter-summary',
  );
  const memoryWidths = await paneWidths([
    '.dashboard-memory-filter-rail',
    '.dashboard-memory-registry',
    '.dashboard-memory-inspector',
  ]);

  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expectPluginContentToStartAtShellEdge();
  await expectRailSeparatorToStopBeforeDivider(
    '.dashboard-knowledge-explorer-search',
    '::after',
    'borderBottomColor',
  );
  await expectRailSeparatorToStopBeforeDivider(
    '.dashboard-knowledge-explorer-foot',
    '::before',
    'borderTopColor',
  );
  await expectRailElementsToShareSeparatorInset(
    '.dashboard-knowledge-explorer',
    [
      '.dashboard-knowledge-explorer-search .ant-input-affix-wrapper',
      '.dashboard-knowledge-explorer > .dashboard-knowledge-category.is-active',
      '.dashboard-knowledge-category-groups section:first-child .dashboard-knowledge-category:first-of-type',
    ],
    '.dashboard-knowledge-explorer-foot',
  );
  const projectKnowledgeWidths = await paneWidths([
    '.dashboard-knowledge-explorer',
    '.dashboard-knowledge-ledger',
    '.dashboard-knowledge-inspector',
  ]);

  expect(memoryWidths).toEqual(projectKnowledgeWidths);
});

test('keeps memory columns aligned and project knowledge timestamps visible', async ({ page }) => {
  const compareColumnStart = async (header, row) => {
    const [headerBox, rowBox] = await Promise.all([header.boundingBox(), row.boundingBox()]);
    expect(headerBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(Math.abs((headerBox?.x ?? 0) - (rowBox?.x ?? 0))).toBeLessThanOrEqual(1);
  };

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');

  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const memoryHead = page.locator('.dashboard-memory-table-head');
  const memoryRow = page.locator('.dashboard-memory-table-row').first();
  await compareColumnStart(
    memoryHead.locator('span').nth(1),
    memoryRow.locator('.dashboard-memory-table-scope'),
  );
  await compareColumnStart(
    memoryHead.locator('span').nth(2),
    memoryRow.locator('.dashboard-memory-table-status'),
  );
  await compareColumnStart(
    memoryHead.locator('span').nth(3),
    memoryRow.locator('.dashboard-memory-table-time'),
  );

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect
    .poll(() =>
      page
        .locator('.dashboard-memory-table-body')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    )
    .toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  const knowledgeHead = page.locator('.dashboard-knowledge-ledger-head');
  const knowledgeRow = page.locator('.dashboard-knowledge-ledger-row').first();
  const knowledgeTime = knowledgeRow.locator('time');
  await compareColumnStart(knowledgeHead.locator('span').nth(3), knowledgeTime);
  await expect(knowledgeTime).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
  await expect
    .poll(() => knowledgeTime.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test('keeps personal memory context and application history easy to scan', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();

  const contextBar = page.getByLabel('个人记忆状态与操作');
  const contextItems = contextBar.locator('.dashboard-plugin-context-item');
  await expect(contextItems).toHaveCount(4);
  await expect(contextBar).toContainText('本地提供器');
  await expect(contextBar).toContainText('当前项目');
  await expect(contextBar).toContainText('3 条记忆');
  await expect(contextBar).toContainText('历史：1 条');
  await expect(contextItems.first()).toHaveCSS('font-size', '13px');
  await expect(contextItems.nth(1)).toHaveCSS('border-left-width', '1px');

  const applicationHistory = page
    .getByLabel('记忆应用详情')
    .locator('.dashboard-context-application-history');
  const historyEntry = applicationHistory.locator('article').first();
  await expect(historyEntry.getByText('修复 Dashboard 手机端展示', { exact: true })).toHaveCSS(
    'font-size',
    '13px',
  );
  await expect(
    historyEntry.getByText('需要先给出可见结果，再说明响应式实现和验证范围', { exact: true }),
  ).toHaveCSS('font-size', '12px');
  const historyMeta = historyEntry.locator('footer');
  await expect(historyMeta).toContainText('2026-08-29 02:16');
  await expect(historyMeta).toContainText('应用成功');
  await expect(historyMeta.locator('time')).toHaveCSS('font-size', '12px');
  await expect(historyMeta.locator('span')).toHaveCSS('font-size', '12px');

  const memoryInspector = page.getByLabel('记忆应用详情');
  await expect(memoryInspector.locator('strong').first()).toHaveText('交付语言与结构');
  await expect(memoryInspector.getByText('这条记忆为什么被应用', { exact: true })).toHaveCount(0);
  await expect(memoryInspector.getByRole('heading', { name: '适用条件' })).toBeVisible();

  await page.getByRole('menuitem', { name: '项目知识' }).click();
  const knowledgeInspector = page.getByRole('complementary', { name: '记录详情' });
  await expect(knowledgeInspector.locator('h3').first()).toHaveText('Dashboard 前端验证入口');
  await expect(knowledgeInspector.getByRole('heading', { name: '应用条件' })).toBeVisible();
});

test('keeps the demo Native detail visible after selecting a child change', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  const childRow = page
    .locator('.native-child-change-row')
    .filter({ hasText: 'prepare-parent-workspace' });
  await expect(childRow).toBeVisible();
  await childRow.click();

  await expect(page.locator('.native-change-detail h3')).toHaveText('prepare-parent-workspace');
  await expect(page.getByRole('button', { name: 'brief 需求简报' })).toBeVisible();
  await expect(page.getByText('100% 已处理', { exact: true })).toBeVisible();
  await expect(page.getByText('准备工作区已完成并归档。', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Native 变更工作区' })).toBeVisible();
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
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?demo');

  const header = page.locator('.comet-workbench-header');
  await expect(header.getByText('当前项目', { exact: true })).toHaveCount(0);
  await expect(header.getByText('工作流', { exact: true })).toHaveCount(0);
  await expect(header.locator('.comet-header-sync')).toHaveCount(0);
  await expect(header).toHaveCSS('min-height', '68px');
  await expect(header.locator('.ant-segmented')).toHaveCount(1);
  await expect(header.locator('.comet-language-switch')).toBeVisible();
  const search = header.locator('.comet-header-search');
  const mainWorkspace = page.locator('.dashboard-workbench > section');
  await expect(search).toHaveCSS('position', 'static');
  await expect(search).toHaveCSS('max-width', '420px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'min-height',
    '40px',
  );
  await expect(page.getByRole('button', { name: '立即刷新' })).toHaveText('');

  const expectSearchCenteredInMainWorkspace = async () => {
    const [searchBox, mainWorkspaceBox] = await Promise.all([
      search.boundingBox(),
      mainWorkspace.boundingBox(),
    ]);
    if (!searchBox || !mainWorkspaceBox) {
      throw new Error('Expected the search field and main workspace to have measurable bounds');
    }
    expect(Math.abs(searchBox.width - 420)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        searchBox.x + searchBox.width / 2 - (mainWorkspaceBox.x + mainWorkspaceBox.width / 2),
      ),
    ).toBeLessThanOrEqual(1);
  };

  await expectSearchCenteredInMainWorkspace();

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.waitForTimeout(260);
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await expectSearchCenteredInMainWorkspace();
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
  await expect(
    page.locator('.dashboard-phase-item.is-pending .dashboard-phase-label').first(),
  ).toHaveCSS('color', 'rgb(165, 180, 200)');
  await expect(page.locator('.dashboard-priority-title svg')).toHaveCSS(
    'background-color',
    'rgb(29, 59, 101)',
  );
  await expect(page.locator('.dashboard-sidebar')).toHaveCSS(
    'border-right-color',
    'rgb(37, 44, 55)',
  );
  await expect(page.locator('.dashboard-sidebar')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.dashboard-content-shell')).toHaveCSS('transition-duration', '0s');

  await expect(page.locator('.comet-workbench-header')).toHaveCSS(
    'border-bottom-color',
    'rgb(32, 42, 58)',
  );
  await expect(page.locator('.comet-workbench-header')).toHaveCSS('box-shadow', 'none');
  await expect(
    page.locator('.dashboard-phase-item.is-pending .dashboard-phase-rail').first(),
  ).toHaveCSS('background-color', 'rgb(58, 70, 88)');

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const nativeSelectedItem = page.locator('.native-change-list-item.selected');
  await expect(nativeSelectedItem).toHaveCSS('background-color', 'rgb(27, 45, 72)');
  await expect(nativeSelectedItem).toHaveCSS('color', 'rgb(237, 242, 251)');
  const nativeSummaryStatuses = page.locator(
    '.dashboard-overview-summary-card .dashboard-summary-status',
  );
  await expect(nativeSummaryStatuses.nth(0)).toHaveCSS('color', 'rgb(23, 78, 166)');
  await expect(nativeSummaryStatuses.nth(0)).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(nativeSummaryStatuses.nth(1)).toHaveCSS('color', 'rgb(183, 192, 206)');
  await expect(nativeSummaryStatuses.nth(2)).toHaveCSS('color', 'rgb(255, 154, 174)');
  await expect(nativeSummaryStatuses.nth(3)).toHaveCSS('color', 'rgb(121, 217, 155)');
  await expect(nativeSummaryStatuses.nth(4)).toHaveCSS('color', 'rgb(243, 200, 102)');
  await page.locator('.dashboard-overview-summary-card').nth(2).click();
  await expect(nativeSummaryStatuses.nth(2)).toHaveCSS('color', 'rgb(255, 154, 174)');
  await expect(nativeSummaryStatuses.nth(2)).toHaveCSS(
    'background-color',
    'rgba(240, 113, 142, 0.14)',
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

  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await page.getByRole('button', { name: '新增项目知识' }).click();
  const createDialog = page.getByRole('dialog');
  const titleInput = createDialog.getByLabel('项目知识标题');
  await expect(titleInput).toHaveCSS('color', 'rgb(237, 242, 251)');
  await expect
    .poll(() => titleInput.evaluate((element) => getComputedStyle(element, '::placeholder').color))
    .toBe('rgb(135, 145, 162)');
  const disabledSave = createDialog.getByRole('button', { name: /保\s*存/u });
  await expect(disabledSave).toBeDisabled();
  await expect(disabledSave).toHaveCSS('color', 'rgb(135, 145, 162)');
  await expect(disabledSave).not.toHaveCSS('background-color', 'rgb(47, 131, 232)');
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
  await expect(page.locator('.dashboard-sidebar .ant-menu-item-selected')).toHaveCSS(
    'background-color',
    'rgb(231, 242, 255)',
  );
  await expect(page.locator('.ant-card').first()).toHaveCSS('box-shadow', /rgba\(31, 43, 64/);

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const summaryStatuses = page.locator(
    '.dashboard-overview-summary-card .dashboard-summary-status',
  );
  await expect(summaryStatuses.nth(0)).toHaveCSS('color', 'rgb(23, 78, 166)');
  await expect(summaryStatuses.nth(0)).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  await expect(summaryStatuses.nth(1)).toHaveCSS('color', 'rgb(102, 112, 133)');
  await expect(summaryStatuses.nth(2)).toHaveCSS('color', 'rgb(201, 68, 98)');
  await expect(summaryStatuses.nth(3)).toHaveCSS('color', 'rgb(35, 131, 75)');
  await expect(summaryStatuses.nth(4)).toHaveCSS('color', 'rgb(154, 101, 14)');
  await page.locator('.dashboard-overview-summary-card').nth(2).click();
  await expect(summaryStatuses.nth(2)).toHaveCSS('color', 'rgb(201, 68, 98)');
  await expect(summaryStatuses.nth(2)).toHaveCSS('background-color', 'rgb(253, 236, 239)');
  const archivedIcon = page.locator(
    '.dashboard-overview-summary-card.dashboard-summary-tone-2 .dashboard-summary-icon',
  );
  await expect(archivedIcon).toHaveCSS('color', 'rgb(111, 122, 138)');
  await expect(archivedIcon).toHaveCSS('background-color', 'rgb(238, 241, 245)');
});

test('keeps the desktop sidebar transition unified and settings reachable when collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/?demo');

  const workbench = page.locator('.dashboard-workbench');
  const sidebar = page.locator('.dashboard-sidebar');
  const sidebarContent = sidebar.locator('.dashboard-sidebar-content');
  const footer = sidebar.locator('.dashboard-sidebar-footer');
  const settings = sidebar.locator('.dashboard-sidebar-settings');

  await expect(workbench).toHaveCSS('transition-duration', '0.28s');
  await expect(sidebar).toHaveCSS('transition-property', 'none');
  await expect(footer).toHaveCSS('flex-shrink', '0');
  await expect(settings).toBeInViewport();

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.waitForTimeout(60);

  const [sidebarWidth, sidebarContentWidth] = await Promise.all([
    sidebar.evaluate((element) => element.getBoundingClientRect().width),
    sidebarContent.evaluate((element) => element.getBoundingClientRect().width),
  ]);
  expect(Math.abs(sidebarWidth - sidebarContentWidth)).toBeLessThanOrEqual(1);

  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await expect(settings).toHaveCSS('width', '40px');
  await expect(settings).toBeInViewport();
  await expect(settings).toBeEnabled();
  await expect(sidebar.locator('.dashboard-sidebar-footer-label')).toHaveCSS(
    'visibility',
    'hidden',
  );
  await expect(settings.locator('.anticon-setting')).toBeVisible();
  await expect(settings.locator('.dashboard-sidebar-settings-label')).toHaveCSS('opacity', '0');
  await settings.click();
  await expect(page.getByRole('dialog', { name: /Comet 设置/u })).toBeVisible();
});

test('removes horizontal overflow from the collapsed sidebar on narrow desktop screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/?demo');

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.waitForTimeout(260);

  const navigation = page.locator('.dashboard-sidebar-navigation');
  await expect(navigation).toHaveCSS('overflow-x', 'hidden');
  const { clientWidth, scrollWidth } = await navigation.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test('keeps collapsed sidebar menu icons aligned with their expanded positions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo');
  await expect(page.locator('.dashboard-plugin-menu .ant-menu-item')).toHaveCount(2);
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 1024, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ['收起侧边栏', '展开侧边栏']) {
      await page.evaluate(() => {
        const icons = [
          ...document.querySelectorAll(
            '.dashboard-sidebar .ant-menu-item > .anticon svg, .dashboard-sidebar-settings > .anticon svg',
          ),
        ];
        (window as any).sidebarIconFrames = [];
        const until = performance.now() + 500;
        const capture = () => {
          (window as any).sidebarIconFrames.push(
            icons.map((icon) => {
              const box = icon.getBoundingClientRect();
              return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            }),
          );
          if (performance.now() < until) requestAnimationFrame(capture);
        };
        capture();
      });
      await page.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(550);
      const frames = await page.evaluate(
        () => (window as any).sidebarIconFrames as { x: number; y: number }[][],
      );
      expect(frames[0].length).toBe(7);
      const drift = frames[0].map((_, index) => {
        const ys = frames.map((frame) => frame[index].y);
        return Math.max(...ys) - Math.min(...ys);
      });
      expect(Math.max(...drift), JSON.stringify(drift)).toBeLessThanOrEqual(1);
      const horizontalDrift = frames[0].map((_, index) => {
        const xs = frames.map((frame) => frame[index].x);
        return Math.max(...xs) - Math.min(...xs);
      });
      expect(Math.max(...horizontalDrift), JSON.stringify(horizontalDrift)).toBeLessThanOrEqual(1);
    }
  }
});

test('sidebar labels reveal after expansion and rapid reversals respect reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo');
  const workbench = page.locator('.dashboard-workbench');
  const label = page.locator('.dashboard-sidebar .ant-menu-title-content').first();
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await expect(label).toHaveCSS('opacity', '0');
  await expect(workbench).toHaveCSS('transition-duration', '0.24s');
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(label).toHaveCSS('transition-delay', '0.08s, 0.06s');
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(label).toHaveCSS('opacity', '1');
  await expect(page.getByRole('button', { name: '收起侧边栏', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: '切换到暗色模式' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await expect(workbench).toHaveCSS('transition-duration', '0s');
  await expect(label).toHaveCSS('transition-duration', '0s');
  await expect(label).toHaveCSS('opacity', '0');
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(label).toHaveCSS('opacity', '1');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await expect(page.getByRole('region', { name: '个人记忆列表' })).toBeVisible();
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
  const pendingDialog = page.getByRole('dialog', { name: '未完成任务', exact: true });
  await expect(pendingDialog).toBeVisible();
  await pendingDialog.getByRole('button', { name: /关.*闭/ }).click();
  await expect(pendingDialog).toBeHidden();

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
    page.locator('.dashboard-phase-track').boundingBox(),
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

test('keeps Classic and Native three-pane workspaces during empty and loading views', async ({
  page,
}) => {
  const nativePageRequests: string[] = [];
  const classicPageRequests: string[] = [];
  let releaseClassicArchive = () => {};
  const classicArchiveGate = new Promise<void>((resolve) => {
    releaseClassicArchive = resolve;
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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-24T00:00:00.000Z' },
          summary: {
            activeChanges: 0,
            archivedChanges: 1,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: {
            schema: 'comet.dashboard.native.v2',
            generatedAt: '2026-08-24T00:00:00.000Z',
            totalChangeCount: 1,
            visibleChangeCount: 0,
            archivedChangeCount: 1,
            changes: [],
            activeChangeCount: 0,
            omittedChangeCount: 1,
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
    if (url.pathname.endsWith('/changes')) {
      classicPageRequests.push(url.search);
      if (url.searchParams.get('status') === 'archived') await classicArchiveGate;
      await route.fulfill({
        json: { status: 'archived', items: [], total: 1, nextCursor: null },
      });
      return;
    }
    if (url.pathname.endsWith('/native-changes')) {
      nativePageRequests.push(url.search);
      await route.fulfill({
        json: {
          status: url.searchParams.get('status'),
          items: [],
          total: url.searchParams.get('status') === 'archived' ? 1 : 0,
          nextCursor: null,
        },
      });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Classic change' })).toBeVisible();
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(1);
  await expect(page.locator('.classic-changes-explorer')).toHaveCount(1);
  await expect(page.getByLabel('Classic 变更状态')).toBeVisible();
  await page.getByRole('tab', { name: '已归档' }).click();
  await expect
    .poll(() => classicPageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.classic-change-detail-skeleton')).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: '正在加载 Classic 变更状态', exact: true }),
  ).toBeVisible();
  const classicSideSkeletons = page.locator('.classic-side-panel-skeleton .ant-skeleton');
  await expect(classicSideSkeletons).toHaveCount(3);
  for (const skeleton of await classicSideSkeletons.all()) {
    await expect(skeleton).toBeVisible();
  }
  await expect(page.locator('.classic-changes-explorer .ant-spin')).toHaveCount(0);
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(1);
  releaseClassicArchive();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  await expect(page.getByRole('tab', { name: '活跃' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Native change' })).toBeVisible();
  await expect(page.locator('.native-changes-explorer')).toHaveCount(1);
  await expect(page.getByLabel('Native 变更状态')).toBeVisible();
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(1);
  expect(nativePageRequests).toEqual([]);
});

test('pins the desktop workbench frame while rich content scrolls in the center pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const shell = document.querySelector('.dashboard-content-shell');
          if (!(shell instanceof HTMLElement)) return 0;
          return shell.scrollHeight - shell.clientHeight;
        }),
      { message: 'Expected the workbench shell to render scrollable content' },
    )
    .toBeGreaterThan(0);

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
      const selected = url.searchParams.get('changeLocator') ?? url.searchParams.get('changeId');
      const item = items.find((entry) => entry.id === selected) ?? items[0];
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
  await page.addInitScript(() => {
    (window as any).nativeArchiveCounts = [];
    new MutationObserver(() => {
      const card = [...document.querySelectorAll('.native-summary-strip button')].find((el) =>
        el.textContent?.includes('已归档变更'),
      );
      const value = card?.querySelector('.dashboard-summary-metric')?.textContent;
      if (value) (window as any).nativeArchiveCounts.push(Number(value));
    }).observe(document, { childList: true, characterData: true, subtree: true });
  });
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
      assurance: index === 0 ? 'skill-coordinated' : 'host-attested',
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
  let releaseFirstDetail = () => {};
  const firstPageGate = new Promise<void>((resolve) => {
    releaseFirstPage = resolve;
  });
  const firstDetailGate = new Promise<void>((resolve) => {
    releaseFirstDetail = resolve;
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
      if (name === 'native-1') await firstDetailGate;
      await route.fulfill({ json: nativeItems.find((change) => change.name === name) });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 896, height: 2000 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开导航' }).click();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Native change' })).toBeVisible();
  await expect(page.locator('.native-changes-explorer')).toHaveCount(1);
  await expect(page.locator('.dashboard-workspace-right')).toHaveCount(1);
  await page.getByRole('tab', { name: '已归档' }).click();

  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.native-workspace-empty')).toHaveCount(0);
  await expect(page.locator('.native-change-list-skeleton')).toBeVisible();
  await expect(page.locator('.native-change-list .ant-spin')).toHaveCount(0);
  await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
  await expect(page.locator('.native-side-panel-skeleton')).toBeVisible();
  releaseFirstPage();
  await expect.poll(() => pageRequests.length).toBeGreaterThanOrEqual(2);
  const list = page.locator('.native-change-list');
  await expect(page.locator('.native-changes-count')).toHaveText('8');
  await expect(list.locator('.native-change-row')).toHaveCount(8);
  await expect(
    page
      .locator('.native-summary-strip button')
      .filter({ hasText: '已归档变更' })
      .locator('.dashboard-summary-metric'),
  ).toHaveText('8');
  expect(
    await page.evaluate(() =>
      (window as any).nativeArchiveCounts.some((value: number) => value > 0 && value < 8),
    ),
  ).toBe(true);
  await expect.poll(() => detailRequests).toContain('native-1');
  await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
  await expect(page.locator('.native-side-panel-skeleton')).toBeVisible();
  await expect(page.getByText('正在加载 Native 变更详情…')).toHaveCount(0);
  const [loadingCenter, loadingRight] = await Promise.all([
    page.locator('.dashboard-workspace-center').boundingBox(),
    page.locator('.dashboard-workspace-right').boundingBox(),
  ]);
  releaseFirstDetail();
  await list.locator('.native-change-row').nth(0).click();
  await expect(page.locator('.native-change-detail h3')).toHaveText('native-1');
  await expect(page.getByText('已完成检查，验证结果已确认', { exact: true })).toBeVisible();
  const [loadedCenter, loadedRight] = await Promise.all([
    page.locator('.dashboard-workspace-center').boundingBox(),
    page.locator('.dashboard-workspace-right').boundingBox(),
  ]);
  if (!loadingCenter || !loadingRight || !loadedCenter || !loadedRight) {
    throw new Error('Expected Native loading and loaded workspace bounds');
  }
  expect(Math.abs(loadedCenter.x - loadingCenter.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedCenter.width - loadingCenter.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedRight.x - loadingRight.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedRight.width - loadingRight.width)).toBeLessThanOrEqual(1);
  await list.locator('.native-change-row').nth(1).click();
  await expect.poll(() => detailRequests).toContain('native-2');
  await expect(page.locator('.native-change-detail h3')).toHaveText('native-2');
});

test('expands a Native parent and keeps child selection in the existing detail center', async ({
  page,
}) => {
  const workspace = (id: string, label: string, current: boolean) => ({
    id,
    label,
    branch: label,
    current,
  });
  type BrowserWorkspace = ReturnType<typeof workspace>;
  const nativeDetail = (
    name: string,
    locator: string,
    source: BrowserWorkspace,
    children: Array<Record<string, unknown>> = [],
  ) => ({
    workflow: 'native',
    locator,
    workspace: source,
    name,
    status: 'active',
    archivedAt: null,
    phase: 'build',
    lifecycleStatus: 'active',
    stateVersion: 2,
    legacy: false,
    migration: { status: 'none', message: null },
    loop: {
      stage: 'building',
      goalCycle: 1,
      iteration: 1,
      attempt: 1,
      nextAction: `继续 ${name}`,
      actor: 'builder',
    },
    acceptance: { total: 1, passed: 0, failed: 0, blocked: 0, pending: 1 },
    verificationResult: 'pending',
    localExecution: {
      status: 'absent',
      reason: 'missing',
      stage: null,
      actor: null,
      startedAt: null,
      requestCheckRounds: 0,
      checks: [],
      recoverableFromStage: 'building',
    },
    children,
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
      { id: 'A1', source: 'brief.md', text: `${name} 验收`, result: 'pending', reason: null },
    ],
    builderHandoff: null,
    verification: null,
    checks: [],
    blockers: [],
    history: [],
    historyOverflow: {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  });
  const parentWorkspace = workspace('parent-workspace', 'integration', true);
  const childWorkspace = workspace('child-workspace', 'native/child-a', false);
  const childSummary = {
    name: 'child-a',
    dependsOn: [],
    covers: ['A1'],
    status: 'active',
    phase: 'build',
    message: null,
    locator: 'child-locator',
    changeStatus: 'active',
    workspace: childWorkspace,
  };
  const supervisorStates = [
    ['verified', '已验收', '验收通过', 'ok'],
    ['integrated', '已集成', '已合入集成分支', 'ok'],
    ['archived', '已归档', '归档完成', 'neutral'],
    ['needs-reverify', '需要重新验收', '等待重新验收', 'warn'],
    ['pending', '等待依赖', '等待前置子任务完成', 'neutral'],
    ['ready', '可开始', '等待开始执行', 'info'],
    ['active', '进行中', '正在执行', 'warn'],
    ['blocked', '已阻塞', '等待解除阻塞', 'danger'],
  ];
  const parent = nativeDetail('parent-change', 'parent-locator', parentWorkspace, [
    childSummary,
    ...supervisorStates.map(([status]) => ({
      ...childSummary,
      name: `supervisor-${status}`,
      status,
      phase: null,
      locator: null,
      changeStatus: null,
      workspace: null,
    })),
  ]);
  const child = nativeDetail('child-a', 'child-locator', childWorkspace);
  const detailRequests: string[] = [];

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
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-08-11T00:00:00.000Z' },
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
            generatedAt: '2026-08-11T00:00:00.000Z',
            totalChangeCount: 2,
            activeChangeCount: 2,
            archivedChangeCount: 0,
            visibleChangeCount: 0,
            omittedChangeCount: 2,
            changesTruncated: true,
            changes: [],
          },
          git: {
            branch: 'integration',
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
      await route.fulfill({
        json: { status: 'active', items: [parent], total: 1, nextCursor: null },
      });
      return;
    }
    if (url.pathname.endsWith('/native-change')) {
      const locator = url.searchParams.get('changeLocator') ?? '';
      detailRequests.push(locator);
      await route.fulfill({ json: locator === child.locator ? child : parent });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  const disclosure = page.locator('.native-change-disclosure');
  await expect(disclosure).toHaveAccessibleName('收起 parent-change 的子变更');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.locator('.native-change-row-shell').filter({ hasText: 'parent-change' }),
  ).toContainText('3/9 子变更');
  const childRow = page.locator('.native-child-change-row').filter({ hasText: 'child-a' });
  await expect(childRow).toBeVisible();
  await expect(childRow).toContainText('native/child-a');
  await expect(childRow).toContainText('Build');
  for (const [status, label, description, tone] of supervisorStates) {
    const row = page
      .locator('.native-child-change-row')
      .filter({ hasText: `supervisor-${status}` });
    await expect(row).toContainText(label);
    await expect(row).toContainText(description);
    await expect(row).not.toContainText('尚未创建');
    const toneClass = {
      ok: 'text-success',
      neutral: 'text-fg-2',
      warn: 'text-warn',
      info: 'text-info',
      danger: 'text-danger',
    }[tone]!;
    await expect(row.locator(`.${toneClass}`)).toHaveText(label);
    const dot = row.locator('.native-child-status-dot');
    const token = {
      ok: 'success',
      neutral: 'meta',
      warn: 'warn',
      info: 'accent',
      danger: 'danger',
    }[tone]!;
    const colors = await dot.evaluate((element, token) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(--color-${token})`;
      element.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [getComputedStyle(element).backgroundColor, expected];
    }, token);
    expect(colors[0]).toBe(colors[1]);
  }
  await childRow.click();
  await expect.poll(() => detailRequests).toContain('child-locator');
  await expect(page.locator('.native-change-detail h3')).toHaveText('child-a');
  await expect(page.locator('.dashboard-workspace-center .native-change-detail')).toBeVisible();

  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toHaveAccessibleName('展开 parent-change 的子变更');
  await expect(childRow).toBeHidden();
});

test('keeps the current Classic detail visible while another change loads', async ({ page }) => {
  const changes = [
    {
      id: 'classic-one',
      locator: 'classic-locator-one',
      displayName: 'classic-one',
      workspace: { id: 'main', label: 'main', branch: 'main', current: true },
    },
    {
      id: 'classic-two',
      locator: 'classic-locator-two',
      displayName: 'classic-two',
      workspace: {
        id: 'classic-two',
        label: 'classic/two',
        branch: 'classic/two',
        current: false,
      },
    },
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
        changes.find((entry) => entry.locator === url.searchParams.get('changeLocator')) ??
        changes[0];
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
  await expect(page.getByText('classic/two', { exact: true })).toBeVisible();
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
      const nativeCount = nativeExplorer.locator('.native-changes-count .ant-badge-count');
      await expect(nativeCount).toHaveText(/^\d+$/);
      await expect(nativeCount).toHaveClass(/ant-scroll-number/u);
      await expect
        .poll(() => nativeCount.locator('.ant-scroll-number-only').count())
        .toBeGreaterThan(0);
      await expect(nativeCount).toHaveCSS('background-color', 'rgb(11, 24, 51)');
      await expect(nativeCount).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(nativeCount).toHaveCSS('min-width', '20px');
      await expect(nativeCount).toHaveCSS('padding', '0px 8px');
      await expect(nativeCount).toHaveCSS('font-weight', '400');
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
      await expect(selectedNativeRow.locator('.truncate').first()).toHaveCSS('font-size', '14px');
      await expect(selectedNativeRow.getByText('◇', { exact: true })).toHaveCount(0);
      await expect(selectedNativeRow).toContainText('Build · 1/3 子变更构建中');
      const nativeProgress = selectedNativeRow.getByRole('progressbar');
      await expect(nativeProgress).toHaveCount(1);
      await expect(nativeProgress).toHaveAttribute('aria-valuenow', '33');
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

test('keeps the project selector inset when switching from a workflow to plugin center', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');

  const projectSelector = page.locator('.comet-project-select');
  await expect(projectSelector).toBeVisible();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expect(page.locator('.native-changes-explorer')).toBeVisible();

  const workflowLeft = (await projectSelector.boundingBox())?.x;
  if (workflowLeft === undefined) throw new Error('Expected workflow project selector bounds');

  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await expect(page.locator('.dashboard-tool-page-memory')).toBeVisible();
  const memoryLeft = (await projectSelector.boundingBox())?.x;
  if (memoryLeft === undefined) throw new Error('Expected personal memory project selector bounds');
  expect(Math.abs(memoryLeft - workflowLeft)).toBeLessThanOrEqual(1);

  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expect(page.locator('.dashboard-tool-page-knowledge')).toBeVisible();
  const knowledgeLeft = (await projectSelector.boundingBox())?.x;
  if (knowledgeLeft === undefined)
    throw new Error('Expected project knowledge project selector bounds');
  expect(Math.abs(knowledgeLeft - workflowLeft)).toBeLessThanOrEqual(1);
});

test('keeps long project names discoverable without widening the selector', async ({ page }) => {
  const longProjectName = 'comet-supervisor-config-and-runtime-monitoring';

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'long-project',
          projects: [
            {
              id: 'long-project',
              name: longProjectName,
              path: 'D:/Project/comet-supervisor-config-and-runtime-monitoring',
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
          project: {
            name: longProjectName,
            path: 'D:/Project/comet-supervisor-config-and-runtime-monitoring',
            generatedAt: '2026-08-28T00:00:00.000Z',
          },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          git: { branch: 'main', dirty: false, dirtyFiles: 0, ahead: 0, behind: 0 },
          native: null,
        },
      });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto('/');

  const projectSelector = page.locator('.comet-project-select');
  const selectedProject = projectSelector.locator('.comet-project-selected-label');
  await expect(selectedProject).toBeVisible();
  await expect(selectedProject).toHaveAttribute('title', longProjectName);
  await expect(selectedProject).toHaveText(longProjectName);
  await expect(selectedProject).toHaveCSS('text-overflow', 'ellipsis');
  await expect(selectedProject).toHaveCSS('white-space', 'nowrap');
  await expect(projectSelector).toHaveCSS('width', '180px');

  await projectSelector.click();
  const projectOption = page
    .locator('.comet-project-select-dropdown .comet-project-option-name')
    .first();
  await expect(projectOption).toHaveAttribute('title', longProjectName);
});

for (const workspace of ['个人记忆', '项目知识'] as const) {
  test(`${workspace} transitions preserve input and respect reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      (window as any).dashboardMotionCalls = [];
      (window as any).pluginMotionTransforms = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof animate>) {
        if (this.closest('.dashboard-tool-page-memory, .dashboard-tool-page-knowledge')) {
          for (const frame of Array.isArray(args[0]) ? args[0] : []) {
            if (frame.transform) (window as any).pluginMotionTransforms.push(frame.transform);
          }
        }
        if (this.hasAttribute('data-dashboard-motion'))
          (window as any).dashboardMotionCalls.push(this.getAttribute('data-dashboard-motion'));
        return animate.apply(this, args);
      };
    });
    await page.goto('/?demo');
    await page.getByRole('menuitem', { name: workspace }).click();
    const personal = workspace === '个人记忆';
    const surface = page.locator(
      personal ? '.dashboard-tool-page-memory' : '.dashboard-tool-page-knowledge',
    );
    await expect(surface).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).dashboardMotionCalls.filter((kind: string) => kind === 'enter'),
      ),
    ).toEqual([]);
    await expect(surface).not.toHaveAttribute('data-dashboard-motion');
    expect(await surface.locator('[data-dashboard-motion] [data-dashboard-motion]').count()).toBe(
      0,
    );
    const before = await page.evaluate(() => (window as any).dashboardMotionCalls.length);
    if (personal) {
      await surface
        .locator('.dashboard-memory-filter-rail button')
        .filter({ hasText: '协作约定' })
        .click();
      await expect(surface.getByRole('region', { name: '个人记忆列表' })).toContainText('协作约定');
    } else {
      await page.getByRole('tab', { name: '项目规范', exact: true }).click();
      await expect(page.getByRole('tab', { name: '项目规范', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await expect
      .poll(() => page.evaluate(() => (window as any).dashboardMotionCalls.length))
      .toBeGreaterThan(before);
    expect(await page.evaluate(() => (window as any).pluginMotionTransforms)).toEqual([]);
    const search = page.getByLabel(personal ? '搜索个人记忆' : '搜索项目知识记录');
    await search.fill('Dashboard');
    await search.fill('');
    const count = await page.evaluate(() => (window as any).dashboardMotionCalls.length);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (personal)
      await surface
        .locator('.dashboard-memory-filter-rail button')
        .filter({ hasText: '全部记忆' })
        .click();
    else await page.getByRole('tab', { name: '项目概况', exact: true }).click();
    expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
    await expect
      .poll(() => surface.evaluate((element) => element.getAnimations({ subtree: true }).length))
      .toBe(0);
    await search.fill('Dashboard');
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(search).toHaveValue('Dashboard');
    expect(await page.evaluate(() => (window as any).dashboardMotionCalls.length)).toBe(count);
  });
}

test('shows the project memory tab on the demo knowledge page', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: '项目知识' }).click();

  const projectManifest = page.getByRole('region', { name: '最近一次任务使用的项目知识' });
  await expect(projectManifest).toContainText('3 条项目知识');
  await projectManifest.getByRole('button', { name: '查看使用明细' }).click();
  const usageDialog = page.getByRole('dialog');
  await usageDialog.getByRole('button', { name: /项目记忆索引/u }).click();
  const panel = page.locator('.dashboard-project-memory');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');

  const memoryList = page.getByRole('region', { name: '项目记忆列表' });
  await expect(memoryList).toContainText('Dashboard 改动验证顺序');
  await expect(memoryList).toContainText('Windows 测试临时目录清理');
  await expect(memoryList).toContainText('2 条');
  await expect(memoryList).toContainText('已随任务注入 3 次');
  await expect(memoryList.getByRole('button', { name: '新增项目记忆' })).toHaveCount(0);

  const inspector = page.getByRole('complementary', { name: '项目记忆详情' });
  await expect(inspector).toContainText('Dashboard 改动验证顺序');
  await expect(inspector).toContainText('cacheRoot');
  await expect(inspector).toContainText(
    '--expand-context "project-memory:dashboard-change-verification"',
  );

  await page.getByLabel('搜索项目记忆').fill('Windows');
  await expect(memoryList).toContainText('Windows 测试临时目录清理');
  await expect(memoryList).not.toContainText('Dashboard 改动验证顺序');

  await page.getByLabel('搜索项目记忆').fill('');
  await inspector.getByRole('button', { name: '删除这条项目记忆' }).click();
  await expect(page.getByText('当前为只读预览，不会写入本地项目')).toBeVisible();

  await expect(consoleErrors).toEqual([]);
});

test('scrolls a long project memory list inside the knowledge page', async ({ page }) => {
  const { DEMO_PLUGIN_PAGES } = await import('../../../domains/dashboard/web/demo.js');
  const source = DEMO_PLUGIN_PAGES.find((entry) => entry.pluginId === 'comet.project-knowledge')!;
  const records = Array.from({ length: 32 }, (_, index) => ({
    ...source.data.records[0],
    id: `knowledge-${index}`,
    title: `项目模型 ${index + 1}`,
  }));
  const entries = Array.from({ length: 24 }, (_, index) => ({
    slug: `memory-${String(index + 1).padStart(2, '0')}`,
    title: `项目记忆 ${index + 1}`,
    description: '用于验证项目记忆条数过多时，列表可以沿用 Dashboard 内页滚动查看。',
    type: 'procedure',
    created: '2026-09-20T09:12:00.000Z',
    updated: '2026-09-20T09:12:00.000Z',
    body: Array.from(
      { length: 80 },
      (_, line) => `项目记忆 ${index + 1} 的完整内容，第 ${line + 1} 行。`,
    ).join('\n'),
  }));
  const knowledgePage = {
    pluginId: 'comet.project-knowledge',
    label: '项目知识',
    route: '/plugins/project-knowledge',
    status: 'enabled',
    globallyDisabled: false,
    projectPaused: false,
    diagnostics: [],
    data: {
      provider: 'local',
      configured: true,
      records,
      manifestPreview: [],
      counts: { trial: 0, proven: 0, enforced: 0, superseded: 0 },
      diagnostics: [],
      projectMemory: {
        directory: '/tmp/comet-project-memory',
        total: entries.length,
        entries,
        applicationCount: 0,
      },
    },
  };
  let delayMemoryRead = false;
  let releaseMemoryRead: () => void = () => {};
  const memoryReadGate = new Promise<void>((resolve) => {
    releaseMemoryRead = resolve;
  });

  await page.setViewportSize({ width: 1600, height: 900 });
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
          project: {
            name: 'Fixture',
            path: '/fixture',
            generatedAt: '2026-09-24T00:00:00.000Z',
          },
          summary: {
            activeChanges: 0,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 0,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          git: { branch: 'main', dirty: false, dirtyFiles: 0, ahead: 0, behind: 0 },
          native: null,
        },
      });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({
        json: {
          pages: [
            {
              pluginId: knowledgePage.pluginId,
              label: knowledgePage.label,
              route: knowledgePage.route,
              status: knowledgePage.status,
              globallyDisabled: knowledgePage.globallyDisabled,
              projectPaused: knowledgePage.projectPaused,
              diagnostics: knowledgePage.diagnostics,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.project-knowledge')) {
      await route.fulfill({ json: knowledgePage });
      return;
    }
    if (url.pathname.endsWith('/plugins/comet.project-knowledge/invoke')) {
      const body = route.request().postDataJSON() as {
        capability?: string;
        input?: { slug?: string };
      };
      const memory = entries.find((entry) => entry.slug === body.input?.slug) ?? entries[0];
      if (delayMemoryRead) await memoryReadGate;
      await route.fulfill({ json: { result: { kind: 'memory', ...memory } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto('/');
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  const knowledgeRows = page.getByLabel('项目知识记录列表');
  await expect(knowledgeRows.locator('button')).toHaveCount(32);
  await knowledgeRows.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => knowledgeRows.evaluate((element) => element.scrollTop))
    .toBeCloseTo(400, 0);
  const knowledgeTop = await knowledgeRows.evaluate((element) => element.scrollTop);
  await page.getByRole('menuitem', { name: 'Classic 工作流' }).click();
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expect
    .poll(() => knowledgeRows.evaluate((element) => element.scrollTop))
    .toBeCloseTo(knowledgeTop, 0);
  await page.getByRole('tab', { name: '项目记忆' }).click();

  const memoryList = page.getByRole('region', { name: '项目记忆列表' });
  const memoryRows = memoryList.locator('.dashboard-memory-table-body');
  await expect(memoryList).toContainText('项目记忆 1');
  await expect(memoryList).toContainText('24 条');

  const memoryFoot = memoryList.locator('.dashboard-project-memory-foot');
  for (const viewport of [
    { width: 1600, height: 900 },
    { width: 1280, height: 720 },
    { width: 1280, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(() => memoryRows.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await memoryRows.evaluate((element) => {
      element.scrollTop = 0;
    });
    await memoryRows.hover();
    await page.mouse.wheel(0, 10000);
    await expect.poll(() => memoryRows.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const lastRow = memoryList.getByText('项目记忆 24', { exact: true });
    await expect
      .poll(async () => {
        const [rowBox, bodyBox] = await Promise.all([
          lastRow.boundingBox(),
          memoryRows.boundingBox(),
        ]);
        if (!rowBox || !bodyBox) return false;
        return (
          rowBox.y >= bodyBox.y - 1 && rowBox.y + rowBox.height <= bodyBox.y + bodyBox.height + 1
        );
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const box = await memoryFoot.boundingBox();
        return box ? box.y + box.height : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(viewport.height);
    await expect
      .poll(() => memoryFoot.evaluate((element) => element.scrollHeight <= element.clientHeight))
      .toBe(true);
  }
  await page.setViewportSize({ width: 1600, height: 900 });
  const body = page.locator('.dashboard-project-memory-body');
  await expect(body).toContainText('第 80 行');
  await body.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeCloseTo(420, 0);
  const bodyTop = await body.evaluate((element) => element.scrollTop);
  const listTop = await memoryRows.evaluate((element) => element.scrollTop);
  await page.getByRole('menuitem', { name: 'Classic 工作流' }).click();
  delayMemoryRead = true;
  await page.getByRole('menuitem', { name: '项目知识' }).click();
  await expect(page.getByRole('tab', { name: '项目记忆' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  try {
    await expect(
      page.getByRole('complementary', { name: '项目记忆详情' }).locator('.ant-skeleton'),
    ).toBeVisible();
  } finally {
    releaseMemoryRead();
  }
  await expect(body).toContainText('第 80 行');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeCloseTo(bodyTop, 0);
  await expect
    .poll(() => memoryRows.evaluate((element) => element.scrollTop))
    .toBeCloseTo(listTop, 0);
});

for (const scenario of ['stable reads', 'loading spacing'] as const) {
  test(`project memory detail ${scenario}`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).memoryMotionCount = 0;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args: Parameters<typeof animate>) {
        if (this.hasAttribute('data-dashboard-motion')) (window as any).memoryMotionCount++;
        return animate.apply(this, args);
      };
    });
    let reads = 0;
    let holdReads = scenario === 'loading spacing';
    let releaseRead: () => void = () => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const entries = Array.from({ length: 2 }, (_, index) => ({
      slug: `memory-${String(index + 1).padStart(2, '0')}`,
      title: `项目记忆 ${index + 1}`,
      description: '用于验证项目记忆条数过多时，列表可以沿用 Dashboard 内页滚动查看。',
      type: 'procedure',
      created: '2026-09-20T09:12:00.000Z',
      updated: '2026-09-20T09:12:00.000Z',
      body: `项目记忆 ${index + 1} 的完整内容。`,
    }));
    const knowledgePage = {
      pluginId: 'comet.project-knowledge',
      label: '项目知识',
      route: '/plugins/project-knowledge',
      status: 'enabled',
      globallyDisabled: false,
      projectPaused: false,
      diagnostics: [],
      data: {
        provider: 'local',
        configured: true,
        records: [],
        manifestPreview: [],
        counts: { trial: 0, proven: 0, enforced: 0, superseded: 0 },
        diagnostics: [],
        projectMemory: {
          directory: '/tmp/comet-project-memory',
          total: entries.length,
          entries,
          applicationCount: 0,
        },
      },
    };

    await page.setViewportSize({ width: 1600, height: 900 });
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
            project: {
              name: 'Fixture',
              path: '/fixture',
              generatedAt: '2026-09-24T00:00:00.000Z',
            },
            summary: {
              activeChanges: 0,
              archivedChanges: 0,
              verifyFailed: 0,
              tasksIncomplete: 0,
              dirtyFiles: 0,
            },
            initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
            git: { branch: 'main', dirty: false, dirtyFiles: 0, ahead: 0, behind: 0 },
            native: null,
          },
        });
        return;
      }
      if (url.pathname.endsWith('/plugins')) {
        await route.fulfill({
          json: {
            pages: [
              {
                pluginId: knowledgePage.pluginId,
                label: knowledgePage.label,
                route: knowledgePage.route,
                status: knowledgePage.status,
                globallyDisabled: knowledgePage.globallyDisabled,
                projectPaused: knowledgePage.projectPaused,
                diagnostics: knowledgePage.diagnostics,
              },
            ],
          },
        });
        return;
      }
      if (url.pathname.endsWith('/plugins/comet.project-knowledge')) {
        await route.fulfill({ json: knowledgePage });
        return;
      }
      if (url.pathname.endsWith('/plugins/comet.project-knowledge/invoke')) {
        const body = route.request().postDataJSON() as {
          capability?: string;
          input?: { slug?: string };
        };
        reads += 1;
        if (holdReads) await readGate;
        const memory = entries.find((entry) => entry.slug === body.input?.slug) ?? entries[0];
        await route.fulfill({ json: { result: { kind: 'memory', ...memory } } });
        return;
      }
      await route.fulfill({ json: {} });
    });

    await page.clock.install();
    await page.goto('/');
    await page.getByRole('menuitem', { name: '项目知识' }).click();
    await page.getByRole('tab', { name: '项目记忆' }).click();

    const inspector = page.getByRole('complementary', { name: '项目记忆详情' });
    if (scenario === 'loading spacing') {
      try {
        const skeleton = inspector.locator('.ant-skeleton');
        await expect(skeleton).toBeVisible();
        for (const width of [1600, 1280, 1181]) {
          await page.setViewportSize({ width, height: 900 });
          const [pane, placeholder] = await Promise.all([
            inspector.boundingBox(),
            skeleton.boundingBox(),
          ]);
          expect(placeholder!.x - pane!.x).toBeGreaterThanOrEqual(16);
          expect(
            pane!.x + pane!.width - placeholder!.x - placeholder!.width,
          ).toBeGreaterThanOrEqual(16);
        }
        await page.setViewportSize({ width: 900, height: 900 });
        await expect(
          page.locator('.dashboard-project-memory > .dashboard-memory-inspector'),
        ).toBeHidden();
        await page.setViewportSize({ width: 1600, height: 900 });
        await page.screenshot({ path: test.info().outputPath('project-memory-loading.png') });
      } finally {
        releaseRead();
      }
    } else {
      await expect(inspector.locator('.dashboard-project-memory-body')).toHaveText(entries[0].body);
      const motionCount = await page.evaluate(() => (window as any).memoryMotionCount);
      await inspector.evaluate((element) => {
        (window as any).memoryReadingSurface = element;
      });
      await page.clock.runFor(31_000);
      await page.waitForTimeout(700);
      expect(reads).toBe(1);
      entries.push({ ...entries[1], slug: 'unrelated-memory', title: '其他项目记忆' });
      knowledgePage.data.projectMemory.total = entries.length;
      await page.clock.runFor(31_000);
      await expect(page.getByRole('region', { name: '项目记忆列表' })).toContainText('3 条');
      expect(reads).toBe(1);
      expect(await page.evaluate(() => (window as any).memoryMotionCount)).toBe(motionCount);
      expect(
        await inspector.evaluate((element) => element === (window as any).memoryReadingSurface),
      ).toBe(true);

      holdReads = true;
      const previousBody = entries[0].body;
      entries[0].updated = '2026-09-20T10:12:00.000Z';
      entries[0].body = '更新后的项目记忆正文';
      await page.clock.runFor(31_000);
      await expect.poll(() => reads).toBe(2);
      await expect(inspector.locator('.dashboard-project-memory-body')).toHaveText(previousBody);
      await expect(inspector.locator('.ant-skeleton')).toHaveCount(0);
      releaseRead();
      await expect(inspector.locator('.dashboard-project-memory-body')).toHaveText(entries[0].body);
      expect(await page.evaluate(() => (window as any).memoryMotionCount)).toBe(motionCount);
      await page
        .getByRole('region', { name: '项目记忆列表' })
        .getByText('项目记忆 2', { exact: true })
        .click();
      await expect(inspector.locator('.dashboard-project-memory-body')).toHaveText(entries[1].body);
      expect(reads).toBe(3);
      expect(await page.evaluate(() => (window as any).memoryMotionCount)).toBeGreaterThan(
        motionCount,
      );
    }
  });
}

test('rolls the Native explorer badge upward when the total is known before mounting', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).nativeBadgeRolled = false;
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('.native-changes-count .ant-scroll-number-only')].some(
          (element) => (element as HTMLElement).style.transform.startsWith('translateY(-'),
        )
      )
        (window as any).nativeBadgeRolled = true;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).nativeBadgeRolled)).toBe(true);
  await expect
    .poll(() =>
      page
        .locator('.native-changes-count .ant-scroll-number-only')
        .evaluateAll((elements) =>
          elements.every((element) => !(element as HTMLElement).style.transform),
        ),
    )
    .toBe(true);
});

test('keeps plugin content visible during refresh after a structured first-load skeleton', async ({
  page,
}) => {
  const { DEMO_PLUGIN_PAGES } = await import('../../../domains/dashboard/web/demo.js');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/dashboard/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
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
    if (pathname.endsWith('/plugins')) return route.fulfill({ json: { pages: DEMO_PLUGIN_PAGES } });
    const plugin = DEMO_PLUGIN_PAGES.find((entry) =>
      pathname.endsWith('/plugins/' + entry.pluginId),
    );
    if (plugin?.pluginId === 'comet.personal-memory') {
      requests++;
      await gate;
    }
    return route.fulfill({ json: plugin ?? { items: [], total: 0 } });
  });
  await page.goto('/');
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  await expect(page.locator('.dashboard-plugin-skeleton')).toBeVisible();
  await expect(page.locator('.dashboard-plugin-skeleton-panes > div')).toHaveCount(3);
  release();
  const surface = page.locator('.dashboard-tool-page-memory');
  await expect(surface).toBeVisible();
  const search = page.getByLabel('搜索个人记忆');
  await search.fill('Dashboard');
  const before = requests;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(surface).toBeVisible();
  await expect(search).toHaveValue('Dashboard');
  await expect(page.locator('.dashboard-plugin-skeleton')).toHaveCount(0);
});

test('opens the Any proposal on the first frame without a height transition', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Comet Any' }).click();
  await page.locator('.any-active-list button').first().click();
  const disclosure = page.locator('.any-proposal-disclosure');
  const summary = disclosure.locator('summary');
  const heights = await summary.evaluate(async (element) => {
    (element as HTMLElement).click();
    const body = element.parentElement!.querySelector('.any-proposal-body')!;
    const result = [];
    for (let frame = 0; frame < 4; frame++) {
      await new Promise(requestAnimationFrame);
      result.push(body.getBoundingClientRect().height);
    }
    return result;
  });
  expect(heights[0]).toBeGreaterThan(100);
  expect(new Set(heights).size).toBe(1);
  await expect(disclosure.locator('pre')).toContainText('proposal');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).not.toHaveAttribute('open');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Space');
  await expect(disclosure).toHaveAttribute('open');
  expect(
    await disclosure.evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
});

test('animates artifact previews and exposes only the close control', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const open = page.getByRole('button', { name: '需求简报' });
  await open.click();
  const panel = page.locator('.dashboard-artifact-preview-panel');
  await expect(panel).toHaveCSS('animation-name', 'dashboard-artifact-enter');
  const close = page.getByRole('button', { name: '关闭产物预览' });
  await expect(close.locator('.anticon-close')).toBeVisible();
  await expect(panel.getByRole('button', { name: '全屏展示' })).toHaveCount(0);
  await close.click();
  await expect(panel).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open.click();
  await expect(panel).toHaveCSS('animation-name', 'none');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('explains external memory and knowledge service fields before saving', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const [section, service, address] of [
    ['个人记忆', '个人记忆服务', '记忆服务接口地址'],
    ['项目知识', '项目知识服务', '知识服务接口地址'],
  ]) {
    await page
      .locator('.dashboard-settings-navigation')
      .getByRole('menuitem', { name: section })
      .click();
    await page.getByRole('combobox', { name: service }).click();
    await page.getByTitle('外部服务', { exact: true }).click();
    await expect(page.getByLabel(address, { exact: true })).toBeVisible();
    const form = page.locator('.dashboard-settings-page');
    await expect(form).toContainText('通过接口调用外部');
    await expect(form).toContainText('不能直接填写模型 API 地址');
    await expect(form).toContainText('不要填写 Token 本身');
    await expect(form).not.toContainText('使用本地个人记忆存储');
    await form.getByRole('button', { name: '接口示例', exact: true }).click();
    const guide = page.getByRole('dialog', {
      name: section === '个人记忆' ? '个人记忆接口示例' : '项目知识接口示例',
      exact: true,
    });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('POST');
    await expect(guide).toContainText('不是完整服务实现');
    const statusRequest = JSON.parse(
      await guide.locator('[data-api-example="request"]:visible').innerText(),
    );
    const statusResponse = JSON.parse(
      await guide.locator('[data-api-example="response"]:visible').innerText(),
    );
    expect(statusRequest.operation).toBe('status');
    expect(statusRequest.schema).toBe(
      section === '个人记忆'
        ? 'comet.personal-memory.provider.v1'
        : 'comet.project-knowledge.provider.v1',
    );
    expect(statusResponse.result).toBeTruthy();
    if (section === '项目知识') expect(statusResponse.projectId).toBe(statusRequest.projectId);
    await guide.getByRole('tab', { name: '读取示例' }).click();
    await expect(guide.locator('[data-api-example="request"]:visible')).toContainText(
      '"operation": "query"',
    );
    const query = JSON.parse(
      await guide.locator('[data-api-example="request"]:visible').innerText(),
    );
    expect(query.operation).toBe('query');
    expect(section === '个人记忆' ? query.payload.view : query.input.kind).toBe(
      section === '个人记忆' ? 'combined' : 'list',
    );
    await guide.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(guide).toBeHidden();
    const endpoint = page.getByLabel(address, { exact: true });
    await endpoint.fill('https://service.example.com/comet');
    await expect(endpoint).toHaveValue('https://service.example.com/comet');
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await form.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});

test('workflow summary cards filter changes, open pending items and respect dark hover', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?demo');
  const cards = page.locator('.dashboard-overview-summary-strip');
  await cards.getByRole('button', { name: /已归档变更/ }).click();
  await expect(
    page.locator('.classic-changes-explorer').getByRole('tab', { name: '已归档', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await cards.getByRole('button', { name: /Verify 失败/ }).click();
  await expect(page.locator('.dashboard-summary-filter')).toContainText('Verify 失败');
  await expect(cards.getByRole('button', { name: /Verify 失败/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.locator('.dashboard-summary-filter')).toHaveCount(0);
  await cards.getByRole('button', { name: /未完成任务/ }).click();
  let dialog = page.getByRole('dialog', { name: '未完成任务', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.locator('.ant-collapse-header').first().click();
  await expect(dialog.locator('.dashboard-summary-items li').first()).toBeVisible();
  await dialog.locator('.dashboard-summary-item-link').first().click();
  await expect(dialog).toBeHidden();
  await cards.getByRole('button', { name: /Git 未提交/ }).click();
  dialog = page.getByRole('dialog', { name: 'Git 未提交', exact: true });
  await expect(dialog.locator('.dashboard-summary-git li')).toHaveCount(3);
  await dialog.getByRole('button', { name: /关.*闭/ }).click();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await cards.getByRole('button', { name: /正在执行/ }).click();
  await expect(page.locator('.dashboard-summary-filter')).toContainText('正在执行');
  await cards.getByRole('button', { name: /正在执行/ }).click();
  await expect(page.locator('.dashboard-summary-filter')).toHaveCount(0);
  await cards.getByRole('button', { name: /待验收项/ }).click();
  dialog = page.getByRole('dialog', { name: '待验收项', exact: true });
  await expect(dialog).toBeVisible();
  const pendingGroup = dialog.locator('.ant-collapse-header').last();
  const targetName = await pendingGroup.evaluate((element) => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.ant-tag, .ant-collapse-expand-icon').forEach((node) => node.remove());
    return clone.textContent?.trim() ?? '';
  });
  await pendingGroup.click();
  await expect(dialog.locator('.dashboard-summary-items li').first()).toBeVisible();
  await dialog.getByRole('button', { name: '定位到变更详情', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.native-change-detail h3')).toHaveText(targetName);
  await page.getByRole('button', { name: '切换到暗色模式', exact: true }).click();
  const memory = page.getByRole('menuitem', { name: '个人记忆' });
  await memory.hover();
  await expect
    .poll(() =>
      memory.evaluate((e) => {
        const color = getComputedStyle(e).backgroundColor;
        const rgb = color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
        return rgb.length === 3 && Math.max(...rgb) < 100;
      }),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('Native summary reads every active page and retries failures without reporting zero', async ({
  page,
}) => {
  const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');
  const base = structuredClone(DEMO_SNAPSHOT);
  const template = base.native.changes.find((change) => change.status === 'active');
  const rows = [0, 1, 2].map((index) => ({
    ...structuredClone(template),
    locator: 'summary-' + index,
    name: 'summary-' + index,
    status: 'active',
    children: [],
    loop: { ...template.loop, stage: 'building' },
    localExecution: { ...template.localExecution, status: index === 2 ? 'running' : 'absent' },
    verificationResult: 'pass',
    blockers: [],
    acceptance: { total: 1, passed: 1, failed: 0, blocked: 0, pending: 0 },
  }));
  let fail = true;
  let revision = 1;
  let delaySummary = false;
  const summaryCursors: string[] = [];
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'summary-fixture',
          projects: [
            {
              id: 'summary-fixture',
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
          project: { ...base.project, generatedAt: new Date(revision * 1000).toISOString() },
          summary: { ...base.summary, activeChanges: 0, archivedChanges: 0 },
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: {
            ...base.native,
            changes: [],
            totalChangeCount: 3,
            activeChangeCount: 3,
            archivedChangeCount: 0,
          },
          git: base.git,
          risks: [],
        },
      });
    if (url.pathname.endsWith('/changes'))
      return route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
    if (url.pathname.endsWith('/native-changes')) {
      const offset = Number(url.searchParams.get('cursor') ?? 0);
      if (Number(url.searchParams.get('limit')) > 50)
        return route.fulfill({ status: 400, json: { error: 'Page limit exceeds 50' } });
      if (url.searchParams.get('limit') === '50') {
        summaryCursors.push(String(offset));
        if (delaySummary) await new Promise((resolve) => setTimeout(resolve, 300));
        if (fail && offset === 1)
          return route.fulfill({ status: 503, json: { error: 'Temporary failure' } });
      }
      return route.fulfill({
        json: {
          status: 'active',
          items: [rows[offset]],
          total: 3,
          nextCursor: offset < 2 ? String(offset + 1) : null,
        },
      });
    }
    if (url.pathname.endsWith('/native-change'))
      return route.fulfill({
        json: rows.find((row) => row.name === url.searchParams.get('changeName')),
      });
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expect(page.getByText('统计读取失败', { exact: true })).toBeVisible();
  const ready = page.locator('.native-summary-strip').getByRole('button', { name: /正在执行/ });
  await expect(ready.locator('.dashboard-summary-metric')).toHaveText('—');
  fail = false;
  await page.getByRole('button', { name: /重.*试/ }).click();
  await expect(ready.locator('.dashboard-summary-metric')).toHaveText('1');
  expect(summaryCursors).toContain('2');
  const metric = ready.locator('.dashboard-summary-metric');
  await metric.evaluate((element) => {
    (window as any).summaryRefreshValues = [];
    new MutationObserver(() =>
      (window as any).summaryRefreshValues.push(element.textContent),
    ).observe(element, { subtree: true, childList: true, characterData: true });
  });
  revision++;
  delaySummary = true;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect.poll(() => summaryCursors.length).toBeGreaterThan(5);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => (window as any).summaryRefreshValues)).not.toContain('—');
  await expect(metric).toHaveText('1');

  await ready.click();
  await expect(page.locator('.native-changes-explorer')).toContainText('summary-2');
  await expect(page.locator('.native-changes-explorer')).not.toContainText('summary-0');
  await expect(page.locator('.native-change-detail h3')).toHaveText('summary-2');
});

test('uses the same Eval selection style for memory and knowledge in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark')
      await page.getByRole('button', { name: '切换到暗色模式', exact: true }).click();
    const style = async (name: string) => {
      const item = page.getByRole('menuitem', { name, exact: false });
      await item.click();
      await expect(item).toHaveClass(/ant-menu-item-selected/);
      await item.evaluate(async (element) => {
        getComputedStyle(element).backgroundColor;
        await Promise.all(
          element.getAnimations().map((animation) => animation.finished.catch(() => {})),
        );
      });
      return item.evaluate((element) => {
        const css = getComputedStyle(element);
        const icon = getComputedStyle(element.querySelector('.anticon')!);
        const marker = getComputedStyle(element, '::before');
        return {
          color: css.color,
          background: css.backgroundColor,
          icon: icon.color,
          marker: marker.display,
        };
      });
    };
    const reference = await style('评估 Eval');
    for (const name of ['个人记忆', '项目知识']) {
      await style(name);
      await expect
        .poll(() =>
          page.getByRole('menuitem', { name }).evaluate((element) => {
            const css = getComputedStyle(element);
            const icon = getComputedStyle(element.querySelector('.anticon')!);
            const marker = getComputedStyle(element, '::before');
            return {
              color: css.color,
              background: css.backgroundColor,
              icon: icon.color,
              marker: marker.display,
            };
          }),
        )
        .toEqual(reference);
    }
  }
});

test('keeps Native search typing local and refreshes one selected detail once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counters = window as typeof window & { nativeAcceptanceReads: number };
    counters.nativeAcceptanceReads = 0;
    const json = Response.prototype.json;
    Response.prototype.json = async function () {
      const value = await json.call(this);
      if (/\/native-change(?:\?|$)/u.test(this.url) && value?.acceptanceItems) {
        const items = value.acceptanceItems;
        Object.defineProperty(value, 'acceptanceItems', {
          enumerable: true,
          get() {
            counters.nativeAcceptanceReads += 1;
            return items;
          },
        });
      }
      return value;
    };
  });
  const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');
  const base = structuredClone(DEMO_SNAPSHOT);
  const row = structuredClone(base.native.changes.find((change) => change.status === 'active')!);
  row.name = 'search-performance-fixture';
  row.locator = 'search-performance-fixture';
  row.children = [];
  row.acceptanceItems = Array.from({ length: 260 }, (_, index) => ({
    ...row.acceptanceItems[0],
    id: 'A' + index,
    text: 'Acceptance item ' + index,
  }));
  row.acceptance = { total: 260, passed: 0, failed: 0, blocked: 0, pending: 260 };
  let detailRequests = 0;
  let listRequests = 0;
  let holdSearch = false;
  let releaseSearch: (() => void) | undefined;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects')
      return route.fulfill({
        json: {
          currentProjectId: 'search-fixture',
          projects: [
            {
              id: 'search-fixture',
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
          project: base.project,
          summary: base.summary,
          git: base.git,
          risks: [],
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: {
            ...base.native,
            changes: [],
            activeChangeCount: 1,
            archivedChangeCount: 0,
            totalChangeCount: 1,
          },
        },
      });
    if (url.pathname.endsWith('/changes'))
      return route.fulfill({ json: { status: 'active', items: [], total: 0, nextCursor: null } });
    if (url.pathname.endsWith('/native-changes')) {
      listRequests++;
      if (holdSearch && url.searchParams.get('q')) {
        await new Promise<void>((resolve) => {
          releaseSearch = resolve;
        });
      }
      return route.fulfill({
        json: { status: 'active', items: [row], total: 1, nextCursor: null },
      });
    }
    if (url.pathname.endsWith('/native-change')) {
      detailRequests++;
      return route.fulfill({ json: row });
    }
    if (url.pathname.endsWith('/plugins')) return route.fulfill({ json: { pages: [] } });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  await expect(page.locator('.native-change-detail h3.truncate')).toHaveText(row.name);
  const acceptance = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: '验收状态', exact: true }) });
  await expect(acceptance.locator('ul.space-y-2 > li')).toHaveCount(20);
  await acceptance.getByTitle('2', { exact: true }).click();
  await expect(acceptance.getByText('Acceptance item 20', { exact: true })).toBeVisible();
  await acceptance.getByTitle('1', { exact: true }).click();
  const firstDetails = detailRequests;
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(page.getByText('状态已刷新', { exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  expect(detailRequests - firstDetails).toBe(1);
  await page.clock.install();
  const beforeLists = listRequests;
  const beforeDetails = detailRequests;
  const beforeAcceptanceReads = await page.evaluate(
    () => (window as typeof window & { nativeAcceptanceReads: number }).nativeAcceptanceReads,
  );
  expect(beforeAcceptanceReads).toBeGreaterThan(0);
  const search = page.locator('.comet-header-search input');
  holdSearch = true;
  await search.pressSequentially('search', { delay: 10 });
  await expect(search).toHaveValue('search');
  expect(listRequests).toBe(beforeLists);
  expect(detailRequests).toBe(beforeDetails);
  expect(
    await page.evaluate(
      () => (window as typeof window & { nativeAcceptanceReads: number }).nativeAcceptanceReads,
    ),
  ).toBe(beforeAcceptanceReads);
  await expect(page.locator('.native-change-detail h3.truncate')).toHaveText(row.name);
  await page.clock.runFor(250);
  await expect.poll(() => listRequests).toBeGreaterThan(beforeLists);
  await expect(page.locator('.native-change-detail h3.truncate')).toHaveText(row.name);
  expect(detailRequests).toBe(beforeDetails);
  holdSearch = false;
  releaseSearch?.();
  const beforeComposition = listRequests;
  await search.dispatchEvent('compositionstart');
  await search.fill('输入');
  await page.clock.runFor(700);
  expect(listRequests).toBe(beforeComposition);
  await search.dispatchEvent('compositionend');
  await page.clock.runFor(700);
  await expect.poll(() => listRequests).toBeGreaterThan(beforeComposition);
  await search.fill('');
  await page.clock.runFor(700);
  await expect(search).toHaveValue('');
  await expect(page.locator('.native-change-detail h3.truncate')).toHaveText(row.name);
});
