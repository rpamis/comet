import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_SNAPSHOT } from '../../../domains/dashboard/web/demo.js';

async function expectClassicSharedFrame(page: Page) {
  const shell = page.locator(
    '.classic-change-workspace > .classic-change-overview > .classic-change-shell',
  );
  await expect(shell).toHaveCount(1);
  await expect(
    shell.locator(':scope > .dashboard-workspace-left > .classic-changes-explorer'),
  ).toHaveCount(1);
  await expect(shell.locator(':scope > .dashboard-workspace-center > .change-detail')).toHaveCount(
    1,
  );
  await expect(
    shell.locator('.classic-project-context, .classic-change-risks, .dashboard-project-git'),
  ).toHaveCount(0);
  const measure = () =>
    shell.evaluate((element) => {
      const required = (root: ParentNode, selector: string) => {
        const node = root.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing Classic shared-frame element: ${selector}`);
        return node;
      };
      const bounds = (node: Element) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      };
      const skin = (node: Element) => {
        const style = getComputedStyle(node);
        return {
          border: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          radius: style.borderRadius,
          background: style.backgroundColor,
          shadow: style.boxShadow,
        };
      };
      const left = required(element, ':scope > .dashboard-workspace-left');
      const center = required(element, ':scope > .dashboard-workspace-center');
      const explorer = required(left, '.classic-changes-explorer');
      const detail = required(center, '.change-detail');
      const head = required(detail, ':scope > .ant-card-head');
      const body = required(detail, ':scope > .ant-card-body');
      const phase = detail.querySelector('.dashboard-phase-progress');
      const panels = detail.querySelector('.change-detail-panels');
      const style = getComputedStyle(element);
      const bodyStyle = getComputedStyle(body);
      return {
        shell: bounds(element),
        left: bounds(left),
        center: bounds(center),
        explorer: bounds(explorer),
        detail: bounds(detail),
        head: bounds(head),
        phase: phase ? bounds(phase) : null,
        panels: panels ? bounds(panels) : null,
        columns: style.gridTemplateColumns.split(' ').length,
        gap: [style.rowGap, style.columnGap],
        shellSkin: skin(element),
        leftSkin: skin(left),
        explorerSkin: skin(explorer),
        detailSkin: skin(detail),
        phaseSkin: phase ? skin(phase) : null,
        panelsSkin: panels ? skin(panels) : null,
        panelSections: panels
          ? Array.from(panels.children, (node) => ({ ...skin(node), ...bounds(node) }))
          : [],
        panelColumns: panels
          ? getComputedStyle(panels).gridTemplateColumns.split(' ').length
          : null,
        bodyContentWidth:
          body.clientWidth - parseFloat(bodyStyle.paddingLeft) - parseFloat(bodyStyle.paddingRight),
        bodyPadding: parseFloat(bodyStyle.paddingLeft),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  let layout = await measure();
  let previous: string | undefined;
  await expect
    .poll(async () => {
      layout = await measure();
      const current = JSON.stringify(layout);
      const stable = current === previous;
      previous = current;
      const expectedHeight = Math.max(
        Math.min(720, page.viewportSize()!.height * 0.75),
        Math.ceil(layout.detail.height + 2),
      );
      return (
        stable &&
        !layout.pageOverflow &&
        (page.viewportSize()!.width <= 760 || Math.abs(layout.shell.height - expectedHeight) <= 1)
      );
    })
    .toBe(true);
  const aligned = (first: number, second: number) =>
    expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
  expect(layout.shellSkin.border).toEqual(Array(4).fill('1px'));
  expect(layout.shellSkin.radius).toBe('12px');
  expect(layout.gap).toEqual(['0px', '0px']);
  for (const skin of [
    layout.explorerSkin,
    layout.detailSkin,
    ...(layout.phaseSkin ? [layout.phaseSkin] : []),
  ]) {
    expect(skin.border).toEqual(Array(4).fill('0px'));
    expect(skin.radius).toBe('0px');
    expect(skin.background).toBe('rgba(0, 0, 0, 0)');
    expect(skin.shadow).toBe('none');
  }
  aligned(layout.left.x, layout.shell.x + 1);
  aligned(layout.left.y, layout.shell.y + 1);
  aligned(layout.detail.x, layout.center.x);
  aligned(layout.detail.right, layout.shell.right - 1);
  aligned(layout.explorer.x, layout.left.x);
  if (page.viewportSize()!.width > 760) {
    expect(layout.columns).toBe(2);
    expect(layout.leftSkin.border).toEqual(['0px', '1px', '0px', '0px']);
    aligned(layout.center.x, layout.left.right);
    aligned(layout.center.y, layout.left.y);
    aligned(layout.explorer.right, layout.left.right - 1);
    aligned(layout.explorer.height, layout.shell.height - 2);
  } else {
    expect(layout.columns).toBe(1);
    expect(layout.leftSkin.border).toEqual(['0px', '0px', '1px', '0px']);
    expect(layout.left.height).toBe(281);
    aligned(layout.explorer.height, 280);
    aligned(layout.center.x, layout.left.x);
    aligned(layout.center.y, layout.left.bottom);
    aligned(layout.shell.height, layout.left.height + layout.detail.height + 2);
  }
  if (layout.panels && layout.phase && layout.panelsSkin) {
    aligned(layout.panels.x, layout.phase.x);
    aligned(layout.panels.width, layout.phase.width);
    aligned(layout.panels.y - layout.phase.bottom, 24);
    expect(layout.panelsSkin.border).toEqual(['1px', '0px', '0px', '0px']);
    expect(layout.panelsSkin.padding).toEqual(['24px', '0px', '0px', '0px']);
    expect(layout.panelSections).toHaveLength(2);
    const [artifacts, tasks] = layout.panelSections;
    expect(artifacts.border).toEqual(Array(4).fill('0px'));
    expect(artifacts.padding).toEqual(Array(4).fill('0px'));
    const split = layout.bodyContentWidth >= 700;
    expect(layout.panelColumns).toBe(split ? 2 : 1);
    expect(tasks.border).toEqual(
      split ? ['0px', '0px', '0px', '1px'] : ['1px', '0px', '0px', '0px'],
    );
    expect(tasks.padding).toEqual(
      split ? ['0px', '0px', '0px', '24px'] : ['24px', '0px', '0px', '0px'],
    );
    for (const section of layout.panelSections) {
      expect(section.radius).toBe('0px');
      expect(section.background).toBe('rgba(0, 0, 0, 0)');
      expect(section.shadow).toBe('none');
    }
  }
  return layout;
}

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
    await expect(page.getByRole('region', { name: '仓库 Git', exact: true })).toContainText(
      'branch-0',
    );
    await page.locator('.comet-project-select').click();
    const response = page.waitForResponse('**/projects/path-1/overview*');
    await page
      .locator('.comet-project-select-dropdown .comet-project-option')
      .filter({ hasText: '/worktrees/project-1' })
      .first()
      .click();
    expect((await (await response).json()).project.path).toBe('/worktrees/project-1');
    await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toBeVisible();
    await expect(page.getByRole('region', { name: '仓库 Git', exact: true })).toContainText(
      'branch-1',
    );
    const changes = page.waitForRequest('**/projects/path-1/changes*');
    await page.getByRole('tab', { name: '已归档', exact: true }).click();
    await changes;
    await page.reload();
    await expect(page.getByRole('button', { name: /^Git 未提交 0 / })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Git 未提交 1 / })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '仓库 Git', exact: true })).toContainText(
      'branch-0',
    );
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

  test('fills the shared frame while the Dashboard overview is loading', async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/projects/path-0/overview*', async (route) => {
      await held;
      await route.fulfill({ json: overview(0) });
    });
    await page.goto('/');
    const loading = page.locator('.dashboard-loading-state');
    await expect(loading).toBeVisible();
    for (const width of [1440, 2048, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const gutter = width <= 760 ? 16 : 32;
      for (const selector of [
        '.comet-workbench-header',
        '.dashboard-content-inner',
        '.dashboard-loading-state',
      ]) {
        const box = await page.locator(selector).boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.x - gutter)).toBeLessThanOrEqual(1);
        expect(Math.abs(box!.width - (width - 2 * gutter))).toBeLessThanOrEqual(1);
      }
    }
    release();
    await expect(loading).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '当前没有 Classic change' })).toBeVisible();
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
    const missingProjectManager = page.getByRole('button', { name: '管理缺失项目' });
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(missingProjectManager).toBeVisible();
      const headerBounds = await page.locator('.comet-workbench-header').boundingBox();
      const managerBounds = await missingProjectManager.boundingBox();
      expect(headerBounds).not.toBeNull();
      expect(managerBounds).not.toBeNull();
      expect(managerBounds!.x).toBeGreaterThanOrEqual(headerBounds!.x);
      expect(managerBounds!.x + managerBounds!.width).toBeLessThanOrEqual(
        headerBounds!.x + headerBounds!.width + 1,
      );
      expect(managerBounds!.y + managerBounds!.height).toBeLessThanOrEqual(
        headerBounds!.y + headerBounds!.height + 1,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await page.setViewportSize({ width: 1600, height: 900 });
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
  await expect(
    page.locator('.dashboard-workflow-tabs [role=tab][aria-selected=true]'),
  ).toContainText('Native 工作流');
  await expect(page.locator('[aria-label="项目默认工作流来源：configured"]')).toBeVisible();

  await page.locator('.comet-project-select').click();
  await page.getByText('/worktrees/classic-project', { exact: true }).click();
  await expect(
    page.locator('.dashboard-workflow-tabs [role=tab][aria-selected=true]'),
  ).toContainText('Classic 工作流');
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
  await expect(page.getByRole('button', { name: '测试插件' })).toBeVisible();
  await page.getByRole('button', { name: '测试插件' }).click();
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
  await expect(
    page.locator('.dashboard-workflow-tabs [role=tab][aria-selected=true]'),
  ).toContainText('Native 工作流');
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
  await page.getByRole('button', { name: '项目知识' }).click();
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
  await expect(page.getByRole('heading', { name: 'Provider 与检索' })).toBeVisible();
  await expect(page.getByText('COMET_KNOWLEDGE_TOKEN')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存配置' })).toBeVisible();
  await expect(page.getByText('bearer-secret', { exact: true })).toHaveCount(0);

  await page.getByRole('switch', { name: '切换当前项目知识检索' }).click();
  await expect(settingsDialog.getByText('当前项目已暂停项目知识', { exact: true })).toBeVisible();
  await expect(page.locator('.comet-header-utility').filter({ hasText: '项目知识' })).toHaveText(
    '项目知识暂停',
  );
  const projectSettings = settingsDialog.getByRole('region', { name: '当前项目' });
  await expect(projectSettings).toContainText('当前项目已暂停向 Agent 提供知识');
  await expect(
    projectSettings.getByRole('switch', { name: '切换当前项目知识检索' }),
  ).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Provider 与检索' })).toHaveCount(0);
  await page.getByRole('switch', { name: '切换当前项目知识检索' }).click();
  await expect(page.getByRole('heading', { name: 'Provider 与检索' })).toBeVisible();
  await expect(page.getByRole('switch', { name: '切换当前项目知识检索' })).toBeChecked();

  await page.getByRole('button', { name: '卸载插件' }).click();
  await page
    .getByRole('dialog', { name: '卸载项目知识插件？' })
    .getByRole('button', { name: /卸\s*载/u })
    .click();
  await expect(page.getByRole('heading', { name: '项目概览' })).toBeVisible();
  await expect(page.getByLabel('项目规则设置')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目知识' })).toHaveCount(0);
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
  await page.getByRole('button', { name: '个人记忆' }).click();
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
  await page.getByRole('button', { name: '个人记忆' }).click();

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
    page.getByText('Provider 切换不会迁移或删除已有数据；保存后重新加载页面即可生效'),
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
  await page.getByRole('button', { name: '个人记忆' }).click();
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?demo');
  await expect(page).toHaveTitle('Comet Dashboard');
  await expect(page.locator('.comet-header-brand')).toHaveText('comet');
  await expect(page.getByRole('list', { name: 'Classic 生命周期阶段' })).toBeVisible();
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  const nativeDetail = page.locator('.native-change-detail');
  for (const [tab, headings] of [
    ['变更详情', ['关键产物', '变更范围', '仓库 Git']],
    ['验收状态', ['验收状态', '检查结果']],
    ['当前阻塞', ['当前阻塞']],
    ['执行历史', ['执行历史']],
  ] as const) {
    await nativeDetail.getByRole('tab', { name: tab, exact: true }).click();
    for (const name of headings) {
      await expect(nativeDetail.getByRole('heading', { name, exact: true })).toBeVisible();
    }
  }
  for (const name of ['执行与恢复', '循环进度', '恢复与交接']) {
    await expect(
      page.locator('.native-project-context').getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  }
  const track = page.getByRole('list', { name: 'Native 生命周期阶段' });
  await expect(track).toBeVisible();
  await expect(track.locator('.dashboard-phase-item')).toHaveCount(4);
  await expect(track).toHaveClass(/ant-steps/);
  await expect(track.locator('.is-done')).toHaveCount(1);
  await expect(track.locator('.is-current')).toContainText('Build');
  await expect(track.locator('.is-pending')).toHaveCount(2);
  await expect(track.locator('svg[data-stage]')).toHaveCount(4);
  await expect(track.locator('[data-status-badge="success"]')).toHaveCount(1);
  await expect(track.locator('.dashboard-phase-origin-wave-dot')).toHaveCount(0);
  await expect(track.getByRole('button')).toHaveCount(0);
  await nativeDetail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await page.getByRole('button', { name: 'comet-state.yaml 工作流状态' }).click();
  await expect(page.locator('.dashboard-artifact-preview-panel')).toBeVisible();
  await page.getByRole('button', { name: '全屏展示', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dashboard-artifact-preview-panel')).not.toHaveClass(/is-fullscreen/);
  await page.locator('.dashboard-artifact-preview-backdrop').click();
  await expect(page.locator('.dashboard-artifact-preview-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('keeps compact shared explorer rows free of left-side progress summaries', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');

  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  const nativeRow = page.locator('.native-change-row').first();
  await expect(nativeRow.locator('.dashboard-explorer-row-name')).toBeVisible();
  await expect(nativeRow.locator('.dashboard-explorer-row-count')).toContainText('子变更');
  await expect(nativeRow.locator('.dashboard-explorer-row-status')).toBeVisible();
  await expect(nativeRow.locator('[role="progressbar"]')).toHaveCount(0);

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
  await page.getByRole('tab', { name: 'Classic 工作流' }).click();
  const classicRow = page.locator('.dashboard-change-row').first();
  await expect(classicRow.locator('.dashboard-explorer-row-name')).toBeVisible();
  await expect(classicRow.locator('.dashboard-explorer-row-count')).toHaveText('构建 · 8/12');
  await expect(classicRow.locator('.dashboard-explorer-row-status')).toBeVisible();
  await expect(classicRow.locator('[role="progressbar"]')).toHaveCount(0);
});

test('keeps personal memory and project knowledge text readable at desktop density', async ({
  page,
}) => {
  const supportingText = /^(1[2-9]|[2-9]\\d)px$/u;
  const bodyText = /^(1[3-9]|[2-9]\\d)px$/u;

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');

  await page.getByRole('button', { name: '个人记忆' }).click();
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

  await page.getByRole('button', { name: '项目知识' }).click();
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

  await page.getByRole('button', { name: '个人记忆' }).click();
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

  await page.getByRole('button', { name: '项目知识' }).click();
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

for (const theme of ['light', 'dark'] as const) {
  test(`aligns the shared page container in ${theme} theme across workflows and plugins`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?demo');
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page
        .getByRole('button', {
          name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
        })
        .click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    for (const width of [2048, 1600, 1440, 1280, 1024, 768, 761, 760, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const expectedWidth = width - (width <= 760 ? 32 : 64);
      for (const view of [
        { role: 'tab', name: 'Native 工作流', body: '.native-change-workspace' },
        { role: 'tab', name: 'Classic 工作流', body: '.classic-change-overview' },
        { role: 'button', name: '个人记忆', body: '.dashboard-tool-page-memory' },
        { role: 'button', name: '项目知识', body: '.dashboard-tool-page-knowledge' },
      ] as const) {
        await page.getByRole(view.role, { name: view.name, exact: true }).click();
        await expect(page.locator(view.body)).toBeVisible();
        for (const selector of [
          '.comet-workbench-header',
          '.dashboard-content-inner',
          '.dashboard-page-heading',
          view.body,
        ]) {
          const box = await page.locator(selector).boundingBox();
          expect(box, `${view.name}: ${selector} at ${width}px`).not.toBeNull();
          expect(Math.abs(box!.width - expectedWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(box!.x - (width - expectedWidth) / 2)).toBeLessThanOrEqual(1);
        }
        const headerBox = await page.locator('.comet-workbench-header').boundingBox();
        const workflowBox = await page.locator('.dashboard-workflow-tabs').boundingBox();
        expect(workflowBox).not.toBeNull();
        expect(workflowBox!.x).toBeGreaterThanOrEqual(headerBox!.x);
        expect(workflowBox!.x + workflowBox!.width).toBeLessThanOrEqual(
          headerBox!.x + headerBox!.width,
        );
        expect(workflowBox!.y + workflowBox!.height).toBeLessThanOrEqual(
          headerBox!.y + headerBox!.height,
        );
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true);
        if (view.name === 'Native 工作流' && [1440, 2048, 390].includes(width)) {
          await page.screenshot({
            path: test.info().outputPath(`dashboard-native-${theme}-${width}.png`),
          });
        }
      }
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const settings = page.getByRole('dialog', { name: /Comet 设置/u });
      await expect(settings).toBeVisible();
      const box = await settings.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(920);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const content = await page.locator('.dashboard-content-inner').boundingBox();
      expect(Math.abs(content!.width - expectedWidth)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('keeps project context fixed while switching between plugin workspaces', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/?demo');
  const selector = page.locator('.comet-project-select');
  const before = await selector.boundingBox();
  for (const name of ['个人记忆', '项目知识']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(
      page.locator(
        name === '个人记忆' ? '.dashboard-tool-page-memory' : '.dashboard-tool-page-knowledge',
      ),
    ).toBeVisible();
    const after = await selector.boundingBox();
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
  }
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

  await page.getByRole('button', { name: '个人记忆' }).click();
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
  await page.getByRole('button', { name: '项目知识' }).click();
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
  await page.getByRole('button', { name: '个人记忆' }).click();

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

  await page.getByRole('button', { name: '项目知识' }).click();
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
  await page.getByRole('tab', { name: 'Native 工作流' }).click();

  const childRow = page
    .locator('.native-child-change-row')
    .filter({ hasText: 'prepare-parent-workspace' });
  await expect(childRow).toBeVisible();
  await childRow.click();

  await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
    'prepare-parent-workspace',
  );
  await expect(page.getByRole('tab', { name: '验收状态', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('100% 已处理', { exact: true })).toBeVisible();
  await expect(page.getByText('准备工作区已完成并归档。', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect(page.getByRole('button', { name: 'brief 需求简报' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '项目概览', exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('keeps Classic task progress inside the change detail column', async ({ page }) => {
  await page.setViewportSize({ width: 1580, height: 900 });
  await page.goto('/?demo');

  const workspace = page.locator('.classic-change-workspace');
  const detail = workspace.locator('.change-detail');
  const panels = detail.locator(':scope > .ant-card-body > .change-detail-panels');
  const phase = detail.locator('.dashboard-phase-progress');
  const taskProgress = panels
    .getByRole('heading', { name: '任务进度' })
    .locator('xpath=ancestor::article[1]');

  await expect(taskProgress).toBeVisible();
  const [taskProgressBox, panelsBox, detailBox, phaseBox] = await Promise.all([
    taskProgress.boundingBox(),
    panels.boundingBox(),
    detail.boundingBox(),
    phase.boundingBox(),
  ]);
  if (!taskProgressBox || !panelsBox || !detailBox || !phaseBox) {
    throw new Error('任务进度、阶段进度、产物面板和 Classic 详情列没有可测量的位置');
  }

  expect(Math.abs(panelsBox.x - phaseBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(panelsBox.width - phaseBox.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(panelsBox.y - phaseBox.y - phaseBox.height - 24)).toBeLessThanOrEqual(1);
  expect(panelsBox.x).toBeGreaterThanOrEqual(detailBox.x);
  expect(panelsBox.x + panelsBox.width).toBeLessThanOrEqual(detailBox.x + detailBox.width);
  expect(panelsBox.y + panelsBox.height).toBeLessThanOrEqual(detailBox.y + detailBox.height);
  expect(taskProgressBox.x).toBeGreaterThanOrEqual(panelsBox.x);
  expect(taskProgressBox.x + taskProgressBox.width).toBeLessThanOrEqual(
    panelsBox.x + panelsBox.width,
  );
  expect(taskProgressBox.y).toBeGreaterThanOrEqual(panelsBox.y);
  expect(taskProgressBox.y + taskProgressBox.height).toBeLessThanOrEqual(
    panelsBox.y + panelsBox.height,
  );
});

test('keeps project metrics above detail and Git in each workflow context', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');
  const summary = page.locator('.dashboard-summary-strip');
  const workspace = page.locator('.classic-change-workspace');
  const detail = workspace.locator('.change-detail');
  const context = workspace.locator('.classic-project-context');
  const git = page.getByRole('region', { name: '仓库 Git', exact: true });
  const expectProjectGitPreview = async () => {
    await expect(git).toContainText(DEMO_SNAPSHOT.git.branch);
    await expect(git).toContainText(DEMO_SNAPSHOT.git.head);
    await expect(git.locator('.dashboard-git-list.is-commits li')).toHaveText(
      DEMO_SNAPSHOT.git.recentCommits.slice(0, 5),
    );
    await expect(git.locator('.dashboard-git-list.is-files li')).toHaveText(
      DEMO_SNAPSHOT.git.dirtyFileList.slice(0, 5),
    );
  };
  await expect(summary.getByRole('button')).toHaveCount(5);
  await expect(detail.locator('.ant-card-head .dashboard-change-suggestion')).toContainText(
    '下一步建议',
  );
  await expect(git).toHaveCount(1);
  await expect(git).toBeVisible();
  await expect(context.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(1);
  await expect(git).toHaveClass(/\bclassic-project-git\b/);
  await expectProjectGitPreview();
  await expect(git.getByRole('region', { name: '仓库 Git内容', exact: true })).toBeVisible();
  await expect(detail.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(0);
  const [summaryBox, detailBox] = await Promise.all([summary.boundingBox(), detail.boundingBox()]);
  expect(summaryBox!.y + summaryBox!.height).toBeLessThan(detailBox!.y);
  const projectGit = await git.textContent();
  expect(projectGit).not.toBeNull();
  const otherChange = page.locator('.dashboard-change-row').nth(1);
  const otherName = await otherChange.locator('.dashboard-explorer-row-name').innerText();
  await otherChange.click();
  await expect(otherChange).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.locator('.dashboard-change-detail-title')).toContainText(otherName);
  await expect(git).toHaveCount(1);
  await expect(git).toHaveText(projectGit!);
  await expectProjectGitPreview();
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await expect(page.locator('.classic-project-context')).toHaveCount(0);
  await expect(git).toHaveCount(1);
  await expect(git).toHaveText(projectGit!);
  await expectProjectGitPreview();
  await expect(
    page.locator('.native-project-context').locator('.dashboard-project-git'),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.dashboard-workspace-center')
      .getByRole('region', { name: '仓库 Git', exact: true }),
  ).toHaveCount(1);
  const nativeLayout = await git.evaluate((element) => {
    const center = document.querySelector('.dashboard-workspace-center');
    if (!center) throw new Error('Native 详情工作区不存在');
    const centerBox = center.getBoundingClientRect();
    const gitBox = element.getBoundingClientRect();
    return {
      detailLeft: centerBox.left,
      detailRight: centerBox.right,
      gitLeft: gitBox.left,
      gitRight: gitBox.right,
    };
  });
  expect(nativeLayout.gitLeft).toBeGreaterThanOrEqual(nativeLayout.detailLeft);
  expect(nativeLayout.gitRight).toBeLessThanOrEqual(nativeLayout.detailRight);
});

test('keeps project, search, plugins, settings, refresh and theme in the top bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?demo');
  const header = page.locator('.comet-workbench-header');
  await expect(header.getByRole('combobox', { name: '选择项目' })).toBeVisible();
  await expect(header.getByPlaceholder('搜索变更、产物或文件…')).toBeVisible();
  for (const name of ['个人记忆', '项目知识', '设置', '立即刷新', '切换到暗色模式']) {
    await expect(header.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Native 工作流' })).toBeVisible();
});

test('uses restrained corners for the two Header search controls', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.locator('.comet-project-select')).toHaveCSS('border-radius', '6px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'border-radius',
    '6px',
  );
});

test('applies the approved dark palette to the canvas, selection and phase graph', async ({
  page,
}) => {
  await page.goto('/?demo');
  await page.getByRole('button', { name: '切换到暗色模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.comet-workbench-header')).toHaveCSS(
    'background-color',
    'rgb(17, 24, 36)',
  );
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  const selectedNativeRow = page.locator('.native-change-row[aria-pressed="true"]');
  await expect(selectedNativeRow).toBeVisible();
  await expect(selectedNativeRow).toHaveCSS('background-color', 'rgb(27, 45, 72)');
  await expect(selectedNativeRow).toHaveCSS('border-radius', '6px');
  const track = page.getByRole('list', { name: 'Native 生命周期阶段' });
  await expect(track.locator('.is-done .dashboard-phase-label')).toHaveCSS(
    'color',
    'rgb(137, 221, 179)',
  );
  await expect(track.locator('.is-current .dashboard-phase-label')).toHaveCSS(
    'color',
    'rgb(139, 180, 255)',
  );
  await expect
    .poll(() =>
      track
        .locator('.is-pending .dashboard-phase-rail')
        .first()
        .evaluate((element) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'var(--color-border)';
          element.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return getComputedStyle(element).borderTopColor === expected;
        }),
    )
    .toBe(true);
  const images = page.locator('.comet-reference-icon');
  await expect
    .poll(() =>
      images.evaluateAll((elements) =>
        elements.every(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      track
        .locator('svg[data-stage]')
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              element.getAttribute('data-motion') === 'static' &&
              element.getAttribute('data-reduced-motion') === 'true',
          ),
        ),
    )
    .toBe(true);
});

test('keeps plugin pages and settings usable after moving their entry points', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?demo');
  await page.getByRole('button', { name: '个人记忆', exact: true }).click();
  await expect(page.locator('.dashboard-tool-page-memory')).toBeVisible();
  await page.getByRole('button', { name: '项目知识', exact: true }).click();
  await expect(page.locator('.dashboard-tool-page-knowledge')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await expect(page.locator('.native-change-detail')).toBeVisible();
  expect(errors).toEqual([]);
});

test('supports keyboard navigation between workflows and change filters', async ({ page }) => {
  await page.goto('/?demo');
  const classic = page.getByRole('tab', { name: 'Classic 工作流' });
  await classic.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const native = page.getByRole('tab', { name: 'Native 工作流' });
  await expect(native).toHaveAttribute('aria-selected', 'true');
  const nativeRow = page.locator('.native-change-row').first();
  await nativeRow.focus();
  await expect(nativeRow).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText(
    await nativeRow.locator('.dashboard-explorer-row-name').innerText(),
  );
  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await expect(
    page.locator('.native-changes-explorer-tabs [role=tab][aria-selected=true]'),
  ).toContainText('已归档');
  await page.getByRole('tab', { name: '活跃', exact: true }).click();
  const active = page.getByRole('tab', { name: '活跃', exact: true });
  await active.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('.native-changes-explorer-tabs [role=tab][aria-selected=true]'),
  ).toContainText('已归档');
  await page.getByRole('tab', { name: 'Classic 工作流' }).click();
  const classicRow = page.locator('.dashboard-change-row').first();
  await classicRow.focus();
  await expect(classicRow).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText(
    await classicRow.locator('.dashboard-explorer-row-name').innerText(),
  );
});

test('keeps the master-detail workspace within desktop, tablet and mobile viewports', async ({
  page,
}) => {
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  for (const width of [1600, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
});

test('keeps a single filtered change selected and clears details for no results', async ({
  page,
}) => {
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  const search = page.getByPlaceholder('搜索变更、产物或文件…');
  await search.fill('prepare-parent-workspace');
  const matchingChild = page
    .locator('.native-child-change-row')
    .filter({ hasText: 'prepare-parent-workspace' });
  await expect(matchingChild).toBeVisible();
  await expect(matchingChild).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.native-change-disclosure[aria-expanded="true"]')).toHaveCount(1);
  await search.fill('align-dashboard-copy');
  await expect(page.locator('.native-change-row')).toHaveCount(1);
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
    'align-dashboard-copy',
  );
  await expect(page.locator('.native-change-row')).toHaveAttribute('aria-pressed', 'true');
  await search.fill('no-such-isolated-change');
  await expect(page.getByRole('heading', { name: '没有匹配的 Native change' })).toBeVisible();
  await expect(page.locator('.native-change-detail h3.text-base')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('.native-change-row').first()).toBeVisible();
});

test('keeps suggestions and blockers within the selected change', async ({ page }) => {
  await page.goto('/?demo');
  const workspace = page.locator('.classic-change-workspace');
  const detail = workspace.locator('.change-detail');
  const risks = workspace.locator('.classic-change-risks');
  const riskContent = risks.getByRole('region', { name: '风险提示内容', exact: true });
  await expect(detail.locator('.ant-card-head .dashboard-change-suggestion')).toContainText(
    '下一步建议',
  );
  await expect(risks.getByRole('heading', { name: '风险提示', exact: true })).toBeVisible();
  await expect(riskContent).toBeVisible();
  const selectedName = await page
    .locator('.dashboard-change-row[aria-pressed=true] .dashboard-explorer-row-name')
    .innerText();
  await expect(detail.locator('.dashboard-change-detail-title')).toContainText(selectedName);
  const selected = DEMO_SNAPSHOT.changes.active.find(
    (change: { name: string }) => change.name === selectedName,
  );
  expect(selected).toBeDefined();
  await expect(riskContent.locator('.dashboard-guidance-item')).toHaveCount(selected!.risks.length);
  for (const risk of selected!.risks) {
    await expect(riskContent).toContainText(risk.message);
    await expect(riskContent).toContainText(risk.code);
  }
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  const native = page.locator('.native-change-detail');
  await expect(native.getByRole('status', { name: '工作流建议' })).toBeVisible();
  await expect(page.locator('.native-project-context .native-blockers-card')).toHaveCount(0);
  await native.getByRole('tab', { name: '当前阻塞', exact: true }).click();
  await expect(native.getByRole('heading', { name: '当前阻塞', exact: true })).toBeVisible();
});

test('keeps Classic and Native overview metrics visually aligned and selectable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo');

  const classicSummary = page.locator('.dashboard-overview-summary-strip');
  const classicCards = classicSummary.getByRole('button');
  await expect(classicCards).toHaveCount(5);
  await expect(classicSummary.locator('.ant-card')).toHaveCount(5);
  await expect(classicSummary.locator('.ant-statistic-content-value')).toHaveText(
    [
      DEMO_SNAPSHOT.summary.activeChanges,
      DEMO_SNAPSHOT.summary.archivedChanges,
      DEMO_SNAPSHOT.summary.verifyFailed,
      DEMO_SNAPSHOT.summary.tasksIncomplete,
      DEMO_SNAPSHOT.summary.dirtyFiles,
    ].map(String),
  );
  await expect(classicSummary.locator('.dashboard-summary-icon')).toHaveCount(5);
  await expect(classicCards.first()).toHaveClass(/dashboard-summary-primary/);
  await classicCards.nth(3).click();
  await expect(classicCards.nth(3)).toHaveClass(/dashboard-summary-primary/);
  await expect(classicCards.first()).not.toHaveClass(/dashboard-summary-primary/);
  await classicCards.nth(2).focus();
  await page.keyboard.press('Enter');
  await expect(classicCards.nth(2)).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('tab', { name: 'Native 工作流' }).click();

  const summary = page.locator('.dashboard-overview-summary-strip');
  const cards = summary.getByRole('button');
  await expect(cards).toHaveCount(5);
  await expect(summary.locator('.ant-card')).toHaveCount(5);
  await expect(summary.locator('.ant-statistic-content-value').first()).toHaveText(
    String(DEMO_SNAPSHOT.native.activeChangeCount),
  );
  await expect(cards.first()).toHaveClass(/dashboard-summary-primary/);
  await expect(summary.locator('.dashboard-summary-icon')).toHaveCount(5);
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveClass(/dashboard-summary-primary/);
  await expect(cards.first()).not.toHaveClass(/dashboard-summary-primary/);
  await cards.nth(4).focus();
  await page.keyboard.press('Space');
  await expect(cards.nth(4)).toHaveAttribute('aria-pressed', 'true');

  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page
        .getByRole('button', { name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式' })
        .click();
    }
    const accent = theme === 'light' ? 'rgb(37, 94, 216)' : 'rgb(110, 159, 255)';
    const selectedBorder = theme === 'light' ? 'rgb(47, 123, 234)' : 'rgb(61, 139, 255)';
    const selectedGradient =
      theme === 'light'
        ? 'linear-gradient(135deg, rgb(31, 115, 237) 0%, rgb(60, 146, 250) 100%)'
        : 'linear-gradient(135deg, rgb(31, 111, 229) 0%, rgb(54, 127, 233) 100%)';
    const neutralBackground = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(23, 30, 41)';
    const businessColors =
      theme === 'light'
        ? [
            'rgb(31, 99, 216)',
            'rgb(102, 112, 133)',
            'rgb(201, 68, 98)',
            'rgb(35, 131, 75)',
            'rgb(154, 101, 14)',
          ]
        : [
            'rgb(159, 193, 255)',
            'rgb(183, 192, 206)',
            'rgb(255, 154, 174)',
            'rgb(121, 217, 155)',
            'rgb(243, 200, 102)',
          ];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const workflow of ['Classic', 'Native']) {
        await page.getByRole('tab', { name: `${workflow} 工作流` }).click();
        const name =
          workflow === 'Classic'
            ? DEMO_SNAPSHOT.changes.active[0].name
            : DEMO_SNAPSHOT.native.changes[0].name;
        await page.getByPlaceholder('搜索变更、产物或文件…').fill(name);
        const rows = page.locator(
          workflow === 'Classic' ? '.dashboard-change-row' : '.native-change-row',
        );
        await expect(rows).toHaveCount(1);
        await expect(rows.locator('.dashboard-explorer-row-name')).toHaveText(name);
        const statuses = summary.locator('.dashboard-summary-status');
        const statusTexts = await statuses.allTextContents();
        const numbers = await summary.locator('.ant-statistic-content-value').allTextContents();
        const labels = await cards.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('aria-label')),
        );
        const measure = () =>
          cards.evaluateAll((elements) =>
            elements.map((element) => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            }),
          );
        const bounds = await measure();
        await cards.first().click();
        await page.mouse.move(0, 0);
        await expect(cards.first()).toHaveCSS('border-color', selectedBorder);
        const appearance = (card: Locator) =>
          card.evaluate((element) => {
            const style = getComputedStyle(element);
            const childStyle = (selector: string) => {
              const child = getComputedStyle(element.querySelector(selector)!);
              return { color: child.color, background: child.backgroundColor };
            };
            return {
              background: style.backgroundColor,
              gradient: style.backgroundImage,
              border: style.borderColor,
              shadow: style.boxShadow,
              transform: style.transform,
              title: childStyle('.dashboard-summary-title'),
              note: childStyle('.dashboard-summary-note'),
              metric: childStyle('.dashboard-summary-metric'),
              icon: childStyle('.dashboard-summary-icon'),
              status: childStyle('.dashboard-summary-status'),
            };
          });
        const activeAppearance = await appearance(cards.first());
        for (let index = 0; index < 5; index += 1) {
          const card = cards.nth(index);
          await card.focus();
          await page.keyboard.press(index % 2 ? 'Space' : 'Enter');
          await expect(summary.locator('.dashboard-summary-card[aria-pressed="true"]')).toHaveCount(
            1,
          );
          await expect(card).toHaveAttribute('aria-pressed', 'true');
          await expect(statuses).toHaveText(statusTexts);
          await expect(summary.locator('.ant-statistic-content-value')).toHaveText(numbers);
          expect(
            await cards.evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('aria-label')),
            ),
          ).toEqual(labels);
          await expect(card).toHaveCSS('background-image', selectedGradient);
          await expect(card).toHaveCSS('border-color', selectedBorder);
          await expect(card).toHaveCSS('outline-color', accent);
          await expect(statuses.nth(index)).toHaveCSS('background-color', 'rgb(219, 234, 254)');
          await expect(statuses.nth(index)).toHaveCSS('color', 'rgb(23, 78, 166)');
          await expect.poll(() => appearance(card)).toEqual(activeAppearance);
          await card.hover();
          await expect.poll(() => appearance(card)).toEqual(activeAppearance);
          const nextIndex = (index + 1) % 5;
          await expect(cards.nth(nextIndex)).toHaveCSS('background-color', neutralBackground);
          await expect(statuses.nth(nextIndex)).toHaveCSS('color', businessColors[nextIndex]);
          await cards.nth(nextIndex).hover();
          await expect(cards.nth(nextIndex)).toHaveCSS('border-color', accent);
          await expect(cards.nth(nextIndex)).toHaveCSS('background-color', neutralBackground);
          await expect(statuses.nth(nextIndex)).toHaveCSS('color', businessColors[nextIndex]);
          await page.mouse.move(0, 0);
          expect(await measure()).toEqual(bounds);
        }
      }
    }
  }
});

test('aligns the active statistic card with Explorer and wraps without narrowing the canvas', async ({
  page,
}) => {
  await page.goto('/?demo');
  for (const workflow of ['Classic 工作流', 'Native 工作流']) {
    await page.getByRole('tab', { name: workflow }).click();
    const summary = page.locator('.dashboard-overview-summary-strip');
    const cards = summary.locator('.dashboard-summary-card.ant-card');
    await expect(cards).toHaveCount(5);
    await expect(summary.locator('.ant-statistic')).toHaveCount(5);
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
        await page
          .getByRole('button', { name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式' })
          .click();
      }
      for (const width of [2048, 1600, 1440, 1100, 701, 700, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        const boxes = await cards.evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          }),
        );
        const columns = width > 1100 ? 5 : width > 700 ? 3 : 2;
        const gutter = width <= 760 ? 16 : 32;
        expect(Math.abs(boxes[0].x - gutter)).toBeLessThanOrEqual(1);
        expect(
          Math.max(
            ...boxes
              .filter((_, index) => width <= 760 || index % columns !== 0)
              .map((box) => box.width),
          ) -
            Math.min(
              ...boxes
                .filter((_, index) => width <= 760 || index % columns !== 0)
                .map((box) => box.width),
            ),
        ).toBeLessThanOrEqual(1);
        if (width > 760) {
          const explorer = await page.locator('.dashboard-changes-explorer').boundingBox();
          expect(boxes[0].width).toBeGreaterThanOrEqual(260);
          const region = await page.locator('.dashboard-workspace-left').boundingBox();
          expect(region).not.toBeNull();
          expect(Math.abs(region!.width - (boxes[0].width - 1))).toBeLessThanOrEqual(1);
          expect(
            Math.abs(region!.x + region!.width - boxes[0].x - boxes[0].width),
          ).toBeLessThanOrEqual(1);
          expect(Math.abs(explorer!.x - boxes[0].x - 1)).toBeLessThanOrEqual(1);
          expect(Math.abs(explorer!.width - (boxes[0].width - 2))).toBeLessThanOrEqual(1);
          for (let index = columns; index < boxes.length; index += columns)
            expect(Math.abs(boxes[index].width - boxes[0].width)).toBeLessThanOrEqual(1);
        }
        expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(Math.ceil(5 / columns));
        expect(
          Math.abs(boxes[columns - 1].x + boxes[columns - 1].width - (width - gutter)),
        ).toBeLessThanOrEqual(1);
        if (width >= 1440) {
          expect(Math.min(...boxes.map((box) => box.height))).toBeGreaterThanOrEqual(88);
          expect(Math.max(...boxes.map((box) => box.height))).toBeLessThanOrEqual(96);
          expect(
            Math.max(...boxes.map((box) => box.height)) -
              Math.min(...boxes.map((box) => box.height)),
          ).toBeLessThanOrEqual(1);
        }
        for (let index = 0; index < 5; index += 1) {
          const card = cards.nth(index);
          await expect(card).toHaveCSS('border-top-width', '1px');
          await expect(card).toHaveCSS('border-top-style', 'solid');
          await expect(card.locator('.ant-statistic-title')).toBeVisible();
          await expect(card.locator('.dashboard-summary-note')).toBeVisible();
          await expect(
            card.locator('.dashboard-summary-title .dashboard-summary-status'),
          ).toBeVisible();
          await expect(card.locator('.ant-statistic-content-value')).toHaveText(/^\d+$/);
          await expect(card.locator('.dashboard-summary-metric')).toHaveCSS('font-size', '32px');
          await expect(card.locator('.ant-card-body')).toHaveCSS('padding', '12px 16px');
          const layout = await card.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const title = element.querySelector('.ant-statistic-title')!;
            const note = element.querySelector('.dashboard-summary-note')!;
            const metric = element.querySelector('.dashboard-summary-metric')!;
            const status = element.querySelector('.dashboard-summary-status')!;
            const titleBox = title.getBoundingClientRect();
            const noteBox = note.getBoundingClientRect();
            const metricBox = metric.getBoundingClientRect();
            const statusBox = status.getBoundingClientRect();
            return {
              textBeforeNumber: Math.max(titleBox.right, noteBox.right) <= metricBox.left,
              numberCentered: Math.abs(
                metricBox.top + metricBox.height / 2 - (box.top + box.height / 2),
              ),
              contained: [titleBox, noteBox, metricBox, statusBox].every(
                (child) =>
                  child.left >= box.left &&
                  child.right <= box.right &&
                  child.top >= box.top &&
                  child.bottom <= box.bottom,
              ),
              noteComplete:
                note.scrollWidth <= note.clientWidth && note.scrollHeight <= note.clientHeight,
              statusComplete:
                status.scrollWidth <= status.clientWidth &&
                status.scrollHeight <= status.clientHeight,
              overflow: element.scrollWidth > element.clientWidth,
              noteHeight: noteBox.height,
            };
          });
          expect(layout.textBeforeNumber).toBe(true);
          expect(layout.numberCentered).toBeLessThanOrEqual(1);
          expect(layout.contained).toBe(true);
          expect(layout.noteComplete).toBe(true);
          expect(layout.statusComplete).toBe(true);
          expect(layout.overflow).toBe(false);
          if (width >= 1440) expect(layout.noteHeight).toBeLessThanOrEqual(19);
        }
        expect(
          await summary
            .locator('.ant-statistic')
            .evaluateAll((elements) =>
              elements.every((element) => element.getAnimations({ subtree: true }).length === 0),
            ),
        ).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        if (workflow === 'Native 工作流' && [2048, 1600, 1440, 390].includes(width)) {
          await page.screenshot({
            path: test.info().outputPath(`dashboard-${theme}-${width}.png`),
          });
        }
        if (workflow === 'Native 工作流' && theme === 'light' && width === 390) {
          await page.screenshot({ path: test.info().outputPath('dashboard-light-narrow.png') });
          await page
            .getByRole('list', { name: 'Native 生命周期阶段' })
            .locator('xpath=..')
            .screenshot({
              path: test.info().outputPath('dashboard-light-narrow-steps.png'),
            });
        }
      }
    }
  }
});

for (const populated of [false, true]) {
  test(`restores statistic status labels for ${populated ? 'nonzero' : 'zero'} data in both themes`, async ({
    page,
  }) => {
    const count = populated ? 1 : 0;
    const nativeChange = {
      ...DEMO_SNAPSHOT.native.changes[0],
      children: [],
      loop: { ...DEMO_SNAPSHOT.native.changes[0].loop, stage: 'archive-ready' },
      localExecution: { status: 'running' },
      verificationResult: 'fail',
      acceptance: { total: 3, passed: 0, failed: 1, blocked: 0, pending: 2 },
    };
    const nativeItems = populated ? [nativeChange] : [];
    await page.route('**/api/dashboard/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/dashboard/projects') {
        await route.fulfill({
          json: {
            currentProjectId: 'status-fixture',
            projects: [
              {
                id: 'status-fixture',
                name: 'Status fixture',
                path: '/fixture',
                availability: 'available',
                isCurrent: true,
              },
            ],
          },
        });
      } else if (url.pathname.endsWith('/overview')) {
        await route.fulfill({
          json: {
            ...DEMO_SNAPSHOT,
            summary: {
              activeChanges: count,
              archivedChanges: count,
              verifyFailed: count,
              tasksIncomplete: count,
              dirtyFiles: count,
            },
            initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
            native: {
              ...DEMO_SNAPSHOT.native,
              activeChangeCount: count,
              archivedChangeCount: 0,
              totalChangeCount: count,
              changes: nativeItems,
            },
          },
        });
      } else if (url.pathname.endsWith('/native-changes')) {
        await route.fulfill({
          json: { status: 'active', items: nativeItems, total: count, nextCursor: null },
        });
      } else if (url.pathname.endsWith('/native-change')) {
        await route.fulfill({ json: nativeChange });
      } else if (url.pathname.endsWith('/plugins')) {
        await route.fulfill({ json: { pages: [] } });
      } else {
        await route.fulfill({ json: {} });
      }
    });
    await page.goto('/');
    for (const workflow of ['Classic 工作流', 'Native 工作流']) {
      await page.getByRole('tab', { name: workflow, exact: true }).click();
      const statuses = page.locator('.dashboard-summary-card .dashboard-summary-status');
      const expected =
        workflow === 'Classic 工作流'
          ? [
              '进行中',
              '已完成',
              populated ? '阻塞' : '健康',
              populated ? '待办' : '清零',
              populated ? '未提交' : '干净',
            ]
          : populated
            ? ['进行中', '就绪', '运行中', '需处理', '待验证']
            : ['清零', '暂无', '空闲', '健康', '已处理'];
      await expect(statuses).toHaveText(expected);
      for (const theme of ['light', 'dark']) {
        if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
          await page
            .getByRole('button', { name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式' })
            .click();
        }
        const colors =
          theme === 'light'
            ? [
                'rgb(23, 78, 166)',
                'rgb(102, 112, 133)',
                'rgb(201, 68, 98)',
                'rgb(35, 131, 75)',
                'rgb(154, 101, 14)',
              ]
            : [
                'rgb(23, 78, 166)',
                'rgb(183, 192, 206)',
                'rgb(255, 154, 174)',
                'rgb(121, 217, 155)',
                'rgb(243, 200, 102)',
              ];
        await page.mouse.move(0, 0);
        for (const width of [1440, 2048, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          await expect(statuses).toHaveText(expected);
          for (let index = 0; index < 5; index += 1) {
            const status = statuses.nth(index);
            await expect(status).toBeVisible();
            await expect(status).toHaveCSS('color', colors[index]);
            expect(
              await status.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const title = element.closest('.ant-statistic-title')!.getBoundingClientRect();
                return (
                  element.scrollWidth <= element.clientWidth &&
                  element.scrollHeight <= element.clientHeight &&
                  box.left >= title.left &&
                  box.right <= title.right &&
                  box.top >= title.top &&
                  box.bottom <= title.bottom
                );
              }),
            ).toBe(true);
          }
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
            .toBe(true);
        }
      }
    }
  });
}

test('balances heading scale with compact 44px change rows', async ({ page }) => {
  await page.goto('/?demo');

  await expect(page.getByRole('heading', { name: '项目概览' })).toHaveCSS('font-size', '28px');
  await expect(page.locator('.dashboard-page-heading > span').first()).toHaveCSS(
    'font-size',
    '13px',
  );
  await expect(page.locator('.dashboard-summary-card .dashboard-summary-metric').first()).toHaveCSS(
    'font-size',
    '32px',
  );

  const firstChange = page.getByRole('button', { name: /add-auth-rate-limiting/ });
  const firstChangeBox = await firstChange.boundingBox();
  if (!firstChangeBox) throw new Error('Expected the first Change row to have measurable bounds');
  expect(firstChangeBox.height).toBeGreaterThanOrEqual(40);
  expect(firstChangeBox.height).toBeLessThanOrEqual(44);
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

test('aligns Classic detail with summary cards and keeps panels directly below phase progress', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo');
  const workspace = page.locator('.classic-change-workspace');
  const overview = workspace.locator('.classic-change-overview');
  const detail = overview.locator('.change-detail');
  const context = overview.locator('.classic-project-context');
  const risks = context.locator('.classic-change-risks');
  const git = context.getByRole('region', { name: '仓库 Git', exact: true });
  const panels = detail.locator(':scope > .ant-card-body > .change-detail-panels');
  const cards = page.locator('.dashboard-summary-strip .dashboard-summary-card');
  await expect(cards).toHaveCount(5);
  await expect(detail.locator('.classic-change-risks')).toHaveCount(0);
  await expect(detail.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(0);
  await expect(detail.locator('.change-detail-panels')).toHaveCount(1);
  await expect(git).toHaveCount(1);
  await expect(git).toBeVisible();
  await expect(risks.getByRole('heading', { name: '风险提示', exact: true })).toBeVisible();
  await expect(panels.getByRole('heading', { name: '关键产物', exact: true })).toBeVisible();
  await expect(panels.getByRole('heading', { name: '任务进度', exact: true })).toBeVisible();
  const measure = () =>
    workspace.evaluate((element) => {
      const bounds = (node: Element | null) => {
        if (!node) return null;
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      const detail = element.querySelector('.classic-change-overview .change-detail');
      const cards = document.querySelectorAll('.dashboard-summary-strip .dashboard-summary-card');
      return {
        centerBox: bounds(element.querySelector('.dashboard-workspace-center')),
        shellBox: bounds(element.querySelector('.classic-change-shell')),
        workspaceBox: bounds(element),
        detailBox: bounds(detail),
        headBox: bounds(detail?.querySelector(':scope > .ant-card-head') ?? null),
        phaseBox: bounds(detail?.querySelector('.dashboard-phase-progress') ?? null),
        contextBox: bounds(element.querySelector('.classic-project-context')),
        riskBox: bounds(element.querySelector('.classic-change-overview .classic-change-risks')),
        gitBox: bounds(element.querySelector('.classic-project-context .classic-project-git')),
        explorerBox: bounds(document.querySelector('.classic-changes-explorer')),
        panelsBox: bounds(
          detail?.querySelector(':scope > .ant-card-body > .change-detail-panels') ?? null,
        ),
        fourth: bounds(cards.item(3)),
        fifth: bounds(cards.item(4)),
      };
    });

  for (const width of [1600, 1280, 1279, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        overview.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        ),
      )
      .toBe(width >= 1280 ? 2 : 1);
    const frame = await expectClassicSharedFrame(page);
    let layout = await measure();
    let previousBounds: string | undefined;
    await expect
      .poll(async () => {
        layout = await measure();
        const currentBounds = JSON.stringify(layout);
        const stable = currentBounds === previousBounds;
        previousBounds = currentBounds;
        return (
          stable &&
          layout.phaseBox !== null &&
          layout.panelsBox !== null &&
          Math.abs(layout.panelsBox.y - layout.phaseBox.y - layout.phaseBox.height - 24) <= 1
        );
      })
      .toBe(true);
    const {
      centerBox,
      workspaceBox,
      shellBox,
      detailBox,
      headBox,
      phaseBox,
      contextBox,
      riskBox,
      gitBox,
      explorerBox,
      panelsBox,
      fourth,
      fifth,
    } = layout;
    if (
      !centerBox ||
      !workspaceBox ||
      !shellBox ||
      !detailBox ||
      !headBox ||
      !phaseBox ||
      !contextBox ||
      !riskBox ||
      !gitBox ||
      !explorerBox ||
      !panelsBox ||
      !fourth ||
      !fifth
    ) {
      throw new Error(`Classic 在 ${width}px 下没有完整的可测量布局`);
    }
    expect(Math.abs(workspaceBox.x - (width <= 760 ? 16 : 32))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(workspaceBox.width - (width - 2 * (width <= 760 ? 16 : 32))),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(detailBox.width - centerBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(headBox.x - detailBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(headBox.width - detailBox.width)).toBeLessThanOrEqual(1);
    const detailPadding = width <= 760 ? 16 : 24;
    expect(Math.abs(phaseBox.y - headBox.y - headBox.height - detailPadding)).toBeLessThanOrEqual(
      1,
    );
    expect(phaseBox.x).toBeGreaterThanOrEqual(detailBox.x);
    expect(phaseBox.x + phaseBox.width).toBeLessThanOrEqual(detailBox.x + detailBox.width);
    expect(phaseBox.y + phaseBox.height).toBeLessThanOrEqual(detailBox.y + detailBox.height);
    expect(Math.abs(panelsBox.x - phaseBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(panelsBox.width - phaseBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(panelsBox.y - phaseBox.y - phaseBox.height - 24)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(detailBox.y + detailBox.height - panelsBox.y - panelsBox.height - detailPadding),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(riskBox.x - contextBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(riskBox.width - contextBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(riskBox.y - contextBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(gitBox.x - contextBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(gitBox.width - contextBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(gitBox.y - riskBox.y - riskBox.height - 16)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(gitBox.y + gitBox.height - contextBox.y - contextBox.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(riskBox.height + gitBox.height + 16 - contextBox.height)).toBeLessThanOrEqual(
      1,
    );
    if (width >= 1280) {
      expect(Math.abs(contextBox.height - shellBox.height)).toBeLessThanOrEqual(1);
      const baselineHeight = Math.min(720, page.viewportSize()!.height * 0.75);
      expect(contextBox.height).toBeGreaterThanOrEqual(baselineHeight - 1);
      expect(contextBox.height).toBeGreaterThanOrEqual(detailBox.height - 1);
      expect(
        Math.abs(contextBox.height - Math.max(baselineHeight, Math.ceil(detailBox.height + 2))),
      ).toBeLessThanOrEqual(1);
      const cardHeightBudget = contextBox.height - 16;
      expect(Math.abs(riskBox.height - cardHeightBudget * 0.55)).toBeLessThanOrEqual(1);
      expect(Math.abs(gitBox.height - cardHeightBudget * 0.45)).toBeLessThanOrEqual(1);
      expect(Math.abs(shellBox.x + shellBox.width - fourth.x - fourth.width)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(contextBox.x - fifth.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.width - fifth.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.y - shellBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.x - shellBox.x - shellBox.width - 16)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(shellBox.width - workspaceBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.x - workspaceBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.width - workspaceBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(contextBox.y - shellBox.y - shellBox.height - 24)).toBeLessThanOrEqual(1);
      expect(Math.abs(riskBox.height - 360)).toBeLessThanOrEqual(1);
      expect(Math.abs(gitBox.height - 440)).toBeLessThanOrEqual(1);
    }
    await expect
      .poll(() =>
        panels.evaluate(
          (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
        ),
      )
      .toBe(frame.bodyContentWidth >= 700 ? 2 : 1);
    const riskItems = await risks
      .locator('.dashboard-guidance-items')
      .evaluateAll((elements) =>
        elements.map((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      );
    expect(riskItems).toEqual([1]);
    const rails = await detail
      .locator('.dashboard-phase-item:not(:last-child) .dashboard-phase-rail')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(rails).toHaveLength(4);
    expect(rails.every((rail) => rail > 0)).toBe(true);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  }
});

test('keeps twelve Classic artifact slots readable and shares their full detail height after change switches', async ({
  page,
}) => {
  const slots = [
    ['proposal', '提案', 'openspec', 'proposal.md'],
    ['design', '设计文档', 'openspec', 'design.md'],
    ['tasks', '任务清单', 'openspec', 'tasks.md'],
    ['deltaSpec', 'Delta Spec', 'openspec', 'specs/auth/spec.md'],
    ['designDoc', '技术设计', 'superpowers', 'docs/superpowers/specs/design.md'],
    ['plan', '实施计划', 'superpowers', 'docs/superpowers/plans/plan.md'],
    ['verifyReport', '验证报告', 'superpowers', '.comet/verify-result.md'],
    ['cometYaml', '.comet.yaml', 'comet', '.comet.yaml'],
    ['handoff', 'Handoff 上下文', 'comet', '.comet/handoff/design-context.json'],
    ['checkpoint', 'Checkpoint', 'comet', '.comet/checkpoint.json'],
    ['brainstorm', 'Brainstorm 摘要', 'comet', '.comet/handoff/brainstorm-summary.md'],
    ['subagentProgress', 'Subagent 进度', 'comet', '.comet/subagent-progress.md'],
  ] as const;
  const readyKeys = new Set<string>([
    'proposal',
    'design',
    'tasks',
    'designDoc',
    'cometYaml',
    'brainstorm',
  ]);
  const longLabel = `技术设计：${'需要逐项核对的技术设计产物'.repeat(8)}${'LongUnbrokenArtifactLabel'.repeat(4)}`;
  const details = [false, true].map((long) => {
    const name = long ? 'classic-artifacts-long' : 'classic-artifacts-short';
    const relativePath = `openspec/changes/${name}`;
    const grouped = slots
      .filter(([key]) => !long || (key !== 'deltaSpec' && key !== 'checkpoint'))
      .map(([key, label, source, file]) => ({
        key,
        label: long && key === 'designDoc' ? longLabel : label,
        source,
        exists: readyKeys.has(key),
        path:
          key === 'designDoc' && long
            ? `/fixture/docs/superpowers/specs/${'LongArtifactFilename'.repeat(8)}.md`
            : file.startsWith('docs/')
              ? `/fixture/${file}`
              : `/fixture/${relativePath}/${file}`,
        ...(key === 'subagentProgress' ? { notApplicable: true } : {}),
      }));
    return {
      id: name,
      locator: name,
      name,
      displayName: name,
      status: 'active' as const,
      path: `/fixture/${relativePath}`,
      relativePath,
      workflow: 'feature',
      phase: 'build' as const,
      updatedAt: '2026-10-10T00:00:00.000Z',
      workspace: { id: 'main', label: 'main', branch: 'main', current: true },
      tasks: { completed: 1, total: 2, incomplete: ['完成验证'], sections: [] },
      artifacts: {
        proposal: true,
        design: true,
        tasks: true,
        plan: false,
        verifyReport: false,
        cometYaml: true,
        grouped,
      },
      artifactPreviews: [
        {
          key: 'proposal',
          label: '提案',
          path: `/fixture/${relativePath}/proposal.md`,
          exists: true,
          content: '# Classic fixture artifact\n\n完整提案预览。',
        },
      ],
      verify: { result: 'pending', reportExists: false },
      next: { command: null, reason: '', description: '' },
      risks: [{ level: 'warning', code: 'tasks-incomplete', message: '尚有 1 个任务未完成' }],
    };
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
              availability: 'available',
              lastSeenAt: null,
              isCurrent: true,
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          project: { name: 'Fixture', path: '/fixture', generatedAt: '2026-10-10T00:00:00.000Z' },
          summary: {
            activeChanges: 2,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: 2,
            dirtyFiles: 0,
          },
          initialChanges: { status: 'active', items: details, total: 2, nextCursor: null },
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
    } else if (url.pathname.endsWith('/changes')) {
      await route.fulfill({
        json: { status: 'active', items: details, total: 2, nextCursor: null },
      });
    } else if (url.pathname.endsWith('/change')) {
      const locator = url.searchParams.get('changeLocator') ?? url.searchParams.get('changeId');
      await route.fulfill({ json: details.find((item) => item.locator === locator) ?? details[0] });
    } else {
      await route.continue();
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  const workspace = page.locator('.classic-change-workspace');
  const detail = workspace.locator('.change-detail');
  const artifacts = detail
    .getByRole('heading', { name: '关键产物', exact: true })
    .locator('xpath=ancestor::article[1]');
  const rows = artifacts.locator('.classic-artifact-row');
  const measure = () =>
    workspace.evaluate((element) => {
      const bounds = (selector: string, root: ParentNode = element) => {
        const node = root.querySelector(selector);
        if (!node) throw new Error(`缺少 Classic 高度测量节点：${selector}`);
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        detail: bounds('.change-detail'),
        shell: bounds('.classic-change-shell'),
        left: bounds('.dashboard-workspace-left'),
        context: bounds('.classic-project-context'),
        explorer: bounds('.classic-changes-explorer', document),
        risk: bounds('.classic-change-risks'),
        git: bounds('.classic-project-git'),
        phase: bounds('.dashboard-phase-progress'),
        panels: bounds('.change-detail-panels'),
        baseline: Math.min(720, innerHeight * 0.75),
      };
    });
  const expectArtifactSlots = async (name: string) => {
    await expect(detail.locator('.dashboard-change-detail-title')).toContainText(name);
    await expect(rows).toHaveCount(12);
    await expect(artifacts.getByText('6/12', { exact: true })).toBeVisible();
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((row) => row.querySelector(':scope > span:nth-child(2)')?.textContent),
      ),
    ).toEqual(slots.map(([key]) => key));
    for (const [group, count] of [
      ['OpenSpec', 4],
      ['Superpowers', 3],
      ['Comet', 5],
    ] as const) {
      const section = artifacts.getByText(group, { exact: true }).locator('xpath=ancestor::div[2]');
      await expect(section.locator('.classic-artifact-row')).toHaveCount(count);
    }
    for (const [key] of slots) {
      const row = rows.filter({ has: page.getByText(key, { exact: true }) });
      if (readyKeys.has(key)) await expect(row).toBeEnabled();
      else {
        await expect(row).toBeDisabled();
        await expect(row).toContainText(key === 'subagentProgress' ? '无需生成' : '未生成');
      }
    }
  };
  const waitForSharedHeight = async () => {
    let layout = await measure();
    let previous: string | undefined;
    await expect
      .poll(async () => {
        layout = await measure();
        const current = JSON.stringify(layout);
        const stable = previous === current;
        previous = current;
        return (
          stable &&
          Math.abs(layout.context.height - layout.shell.height) <= 1 &&
          Math.abs(layout.explorer.height - layout.shell.height + 2) <= 1 &&
          Math.abs(
            layout.context.height - Math.max(layout.baseline, Math.ceil(layout.detail.height + 2)),
          ) <= 1
        );
      })
      .toBe(true);
    expect(layout.explorer.height).toBeGreaterThanOrEqual(layout.detail.height - 1);
    expect(layout.context.height).toBeGreaterThanOrEqual(layout.baseline - 1);
    expect(
      Math.abs(layout.panels.y - layout.phase.y - layout.phase.height - 24),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(layout.risk.height + layout.git.height + 16 - layout.context.height),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.risk.height - (layout.context.height - 16) * 0.55)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(layout.git.height - (layout.context.height - 16) * 0.45)).toBeLessThanOrEqual(
      1,
    );
    await expectClassicSharedFrame(page);
    return layout;
  };
  await expectArtifactSlots(details[0].name);
  const short = await waitForSharedHeight();
  const longChange = page.locator('.dashboard-change-row').filter({ hasText: details[1].name });
  await longChange.click();
  await expectArtifactSlots(details[1].name);
  await expect(artifacts.getByText(longLabel, { exact: true })).toBeVisible();
  const long = await waitForSharedHeight();
  expect(long.detail.height).toBeGreaterThan(short.detail.height);
  expect(long.explorer.height).toBeGreaterThan(short.explorer.height);
  await page.locator('.dashboard-change-row').filter({ hasText: details[0].name }).click();
  await expectArtifactSlots(details[0].name);
  const restored = await waitForSharedHeight();
  expect(Math.abs(restored.detail.height - short.detail.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(restored.explorer.height - short.explorer.height)).toBeLessThanOrEqual(1);
  for (const [key] of slots) {
    const row = rows.filter({ has: page.getByText(key, { exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeInViewport();
  }
  const proposal = rows.filter({ has: page.getByText('proposal', { exact: true }) });
  await proposal.scrollIntoViewIfNeeded();
  const scrollBeforePreview = await page.evaluate(() => ({
    page: scrollY,
    list: document.querySelector('.dashboard-change-list')!.scrollTop,
  }));
  await proposal.click();
  const preview = page.locator('.dashboard-artifact-preview-panel');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Classic fixture artifact');
  await expect(preview).toContainText('完整提案预览。');
  await page.getByRole('button', { name: '全屏展示', exact: true }).click();
  await expect(page.locator('.dashboard-artifact-preview-overlay')).toHaveClass(/is-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dashboard-artifact-preview-overlay')).not.toHaveClass(
    /is-fullscreen/,
  );
  await expect(preview).toBeVisible();
  await page
    .getByRole('button', { name: '产物预览背景', exact: true })
    .click({ position: { x: 10, y: 10 } });
  await expect(preview).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        page: scrollY,
        list: document.querySelector('.dashboard-change-list')!.scrollTop,
      })),
    )
    .toEqual(scrollBeforePreview);
  await expectArtifactSlots(details[0].name);
  await expectClassicSharedFrame(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await longChange.click();
  await expectArtifactSlots(details[1].name);
  const label = artifacts.getByText(longLabel, { exact: true });
  await expect(label).toBeVisible();
  await expect(label).not.toHaveCSS('white-space', 'nowrap');
  await expect(label).not.toHaveCSS('overflow', 'hidden');
  await expect.poll(async () => (await measure()).left.height).toBe(281);
  await expectClassicSharedFrame(page);
  const readable = await rows.evaluateAll((elements) =>
    elements.every((row) => {
      const box = row.getBoundingClientRect();
      return Array.from(row.querySelectorAll(':scope > span')).every((span) => {
        const spanBox = span.getBoundingClientRect();
        return (
          span.scrollWidth <= span.clientWidth + 1 &&
          span.scrollHeight <= span.clientHeight + 1 &&
          spanBox.left >= box.left - 1 &&
          spanBox.right <= box.right + 1 &&
          spanBox.bottom <= box.bottom + 1
        );
      });
    }),
  );
  expect(readable).toBe(true);
  expect(await label.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(
    18,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});

test('keeps a useful center-panel empty state when the Native change filter has no results', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1728, height: 1000 });
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('does-not-match-any-native-change');

  const emptyState = page
    .getByRole('heading', { name: '没有匹配的 Native change' })
    .locator('xpath=ancestor::section[1]');
  await expect(emptyState).toBeVisible();

  const emptyBox = await emptyState.boundingBox();
  if (!emptyBox) throw new Error('Expected Native center empty state to have measurable bounds');
  expect(emptyBox.width).toBeGreaterThan(700);
});

test('keeps Classic and Native master-detail workspaces during empty and loading views', async ({
  page,
}) => {
  const expectFullWidthWorkspace = async () => {
    for (const width of [1440, 2048, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const gutter = width <= 760 ? 16 : 32;
      const classic = await page.locator('.classic-change-workspace').count();
      const box = await page
        .locator(classic ? '.classic-change-overview' : '.native-change-workspace')
        .boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs(box!.x - gutter)).toBeLessThanOrEqual(1);
      expect(Math.abs(box!.width - (width - 2 * gutter))).toBeLessThanOrEqual(1);
      if (classic) {
        const frame = await expectClassicSharedFrame(page);
        const cards = await page.locator('.dashboard-summary-card').evaluateAll((nodes) =>
          nodes.map((node) => ({
            left: node.getBoundingClientRect().left,
            right: node.getBoundingClientRect().right,
          })),
        );
        expect(Math.abs(frame.shell.x - cards[0].left)).toBeLessThanOrEqual(1);
        expect(
          Math.abs(frame.shell.right - (width >= 1280 ? cards[3].right : width - gutter)),
        ).toBeLessThanOrEqual(1);
        await expect(page.locator('.classic-project-context')).toHaveCount(1);
      }
    }
  };
  const expectClassicProjectGit = async () => {
    const context = page.locator('.classic-project-context');
    const git = page.getByRole('region', { name: '仓库 Git', exact: true });
    await expect(context).toHaveClass(/\bis-git-only\b/);
    await expect(git).toHaveCount(1);
    await expect(context.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(1);
    await expect(context.getByRole('heading', { name: '风险提示', exact: true })).toHaveCount(0);
    await expect(git).toBeVisible();
    const content = git.getByRole('region', { name: '仓库 Git内容', exact: true });
    await expect(content).toContainText('main');
    await expect(content).toContainText('abc1234');
  };
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
  await expectClassicProjectGit();
  await expectFullWidthWorkspace();
  await page.getByRole('tab', { name: '已归档' }).click();
  await expect
    .poll(() => classicPageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.classic-change-detail-skeleton')).toBeVisible();
  await expectClassicProjectGit();
  await expectFullWidthWorkspace();
  await expect(page.locator('.classic-changes-explorer .ant-spin')).toHaveCount(0);
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(1);
  releaseClassicArchive();
  await page.getByRole('tab', { name: 'Native 工作流' }).click();

  await expect(page.getByRole('tab', { name: '活跃' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Native change' })).toBeVisible();
  await expect(page.locator('.native-changes-explorer')).toHaveCount(1);
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(1);
  const nativeGit = page.getByRole('region', { name: '仓库 Git', exact: true });
  await expect(nativeGit).toHaveCount(1);
  await expect(nativeGit).toBeVisible();
  await expect(nativeGit).toContainText('main');
  await expect(nativeGit).toContainText('abc1234');
  await expect(page.locator('.classic-project-context')).toHaveCount(0);
  await expect(
    page
      .locator('.dashboard-workspace-center')
      .getByRole('region', { name: '仓库 Git', exact: true }),
  ).toHaveCount(1);
  await expectFullWidthWorkspace();
  expect(nativePageRequests).toEqual([]);
});

test('allows the full selected change to scroll without an independent inspector', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await expect(page.locator('.dashboard-workspace-right')).toHaveCount(0);
  const detail = page.locator('.native-change-detail');
  await detail.getByRole('tab', { name: '执行历史', exact: true }).click();
  await expect(
    detail.getByRole('region', { name: '保留执行历史', exact: true }).locator('li'),
  ).toHaveCount(18);
  await expect(detail.getByRole('tabpanel')).toContainText('Goal cycle 2 · #18.1');
  await expect(page.locator('.dashboard-workspace-center')).toHaveCSS('overflow-y', 'visible');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect(page.getByRole('heading', { name: '仓库 Git' })).toBeVisible();
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
  const items = Array.from({ length: 40 }, (_, index) => ({
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

  const list = page.locator('.classic-changes-explorer .dashboard-change-list');
  await expect(list.locator('.dashboard-change-list-item')).toHaveCount(15);
  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=all')).length)
    .toBe(3);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.waitForTimeout(350);
  await expect(list.locator('.dashboard-change-list-item')).toHaveCount(15);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=all')).length)
    .toBe(4);
  await expect(list.locator('.dashboard-change-list-item')).toHaveCount(20);
});

test('keeps the Native change list scrollable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流' }).click();

  const list = page.locator('.native-change-list');
  await expect(list.locator('.native-change-row')).toHaveCount(5);
  const initialCount = await list.locator('.native-change-row').count();

  const metrics = await list.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight))
    .toBe(true);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
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
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Native change' })).toBeVisible();
  await expect(page.locator('.native-changes-explorer')).toHaveCount(1);
  await expect(page.locator('.dashboard-workspace-right')).toHaveCount(0);
  await page.getByRole('tab', { name: '已归档' }).click();

  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.native-workspace-empty')).toHaveCount(0);
  await expect(page.locator('.native-change-list-skeleton')).toBeVisible();
  await expect(page.locator('.native-change-list .ant-spin')).toHaveCount(0);
  await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
  for (const width of [1440, 2048, 390]) {
    await page.setViewportSize({ width, height: 2000 });
    const gutter = width <= 760 ? 16 : 32;
    const box = await page.locator('.native-change-workspace').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - gutter)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - (width - 2 * gutter))).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 896, height: 2000 });
  releaseFirstPage();
  await expect.poll(() => pageRequests.length).toBeGreaterThanOrEqual(2);
  const list = page.locator('.native-change-list');
  await expect(page.locator('.native-changes-count')).toHaveText('8');
  await expect(list.locator('.native-change-row')).toHaveCount(8);
  await expect.poll(() => detailRequests).toContain('native-1');
  await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
  await expect(page.getByText('正在加载 Native 变更详情…')).toHaveCount(0);
  const [loadingCenter] = await Promise.all([
    page.locator('.dashboard-workspace-center').boundingBox(),
  ]);
  releaseFirstDetail();
  await list.locator('.native-change-row').nth(0).click();
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText('native-1');
  await expect(page.getByText('已完成检查，验证结果已确认', { exact: true })).toBeVisible();
  const [loadedCenter] = await Promise.all([
    page.locator('.dashboard-workspace-center').boundingBox(),
  ]);
  if (!loadingCenter || !loadedCenter) {
    throw new Error('Expected Native loading and loaded workspace bounds');
  }
  expect(Math.abs(loadedCenter.x - loadingCenter.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedCenter.width - loadingCenter.width)).toBeLessThanOrEqual(1);
  await list.locator('.native-change-row').nth(1).click();
  await expect.poll(() => detailRequests).toContain('native-2');
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText('native-2');
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
    ...supervisorStates.map(([status, , description]) => ({
      ...childSummary,
      name: `supervisor-${status}`,
      status,
      message: description,
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
  await page.getByRole('tab', { name: 'Native 工作流' }).click();

  const disclosure = page.locator('.native-change-disclosure');
  await expect(disclosure).toHaveAccessibleName('收起 parent-change 的子变更');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  const parentRow = page.locator('.native-change-row').filter({ hasText: 'parent-change' });
  await expect(parentRow.locator('.dashboard-explorer-row-count')).toContainText('3/9 子变更');
  await expect(parentRow.locator('.dashboard-explorer-row-count')).toHaveText('Build · 3/9 子变更');
  const childRow = page.locator('.native-child-change-row').filter({ hasText: 'child-a' });
  await expect(childRow).toBeVisible();
  await expect(childRow.locator('.dashboard-explorer-row-count')).toHaveText(
    'Build · native/child-a',
  );
  await childRow.focus();
  await expect(childRow).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('native/child-a');
  await expect(childRow).toHaveAttribute('aria-disabled', 'false');
  for (const [status, label, description, tone] of supervisorStates) {
    const row = page
      .locator('.native-child-change-row')
      .filter({ hasText: `supervisor-${status}` });
    await expect(row).toContainText(label);
    await expect(row.locator('.dashboard-explorer-row-count')).toHaveText(description);
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await row.focus();
    await expect(row).toBeFocused();
    await expect(page.getByRole('tooltip').filter({ hasText: description }).last()).toBeVisible();
    const toneClass = {
      ok: 'text-success',
      neutral: 'text-fg-2',
      warn: 'text-warn',
      info: 'text-info',
      danger: 'text-danger',
    }[tone]!;
    await expect(row.locator(`.${toneClass}`)).toHaveText(label);
  }
  const unlocatable = page
    .locator('.native-child-change-row')
    .filter({ hasText: 'supervisor-pending' });
  const requestsBeforeUnlocatableClick = detailRequests.length;
  await unlocatable.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(unlocatable).toHaveAttribute('aria-disabled', 'true');
  await expect(unlocatable).toHaveAttribute('aria-pressed', 'false');
  expect(detailRequests).toHaveLength(requestsBeforeUnlocatableClick);

  await childRow.click();
  await expect.poll(() => detailRequests).toContain('child-locator');
  await expect(childRow).toHaveAttribute('aria-pressed', 'true');
  await expect(parentRow).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.locator(
      '.native-change-row[aria-pressed="true"], .native-child-change-row[aria-pressed="true"]',
    ),
  ).toHaveCount(1);
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText('child-a');
  await expect(page.locator('.dashboard-workspace-center .native-change-detail')).toBeVisible();

  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(disclosure).toHaveAccessibleName('展开 parent-change 的子变更');
  await expect(childRow).toBeHidden();
  await expect(page.locator('.native-change-detail h3.text-base')).toContainText('parent-change');
  await expect(parentRow).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator(
      '.native-change-row[aria-pressed="true"], .native-child-change-row[aria-pressed="true"]',
    ),
  ).toHaveCount(1);
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
  await expect(detailTitle).toContainText('classic-one');
  const otherRow = page.locator('.dashboard-change-row').filter({ hasText: 'classic-two' });
  await expect(otherRow).not.toContainText('classic/two');
  await otherRow.focus();
  const workspaceHint = page.getByRole('tooltip');
  await expect(workspaceHint).toBeVisible();
  await expect(workspaceHint).toHaveText('classic-two构建阶段构建 · 2/2classic/two · classic/two');
  await page.getByRole('button', { name: '立即刷新' }).focus();
  await expect(workspaceHint).toBeHidden();
  const loadedExplorer = await page.locator('.classic-changes-explorer').boundingBox();
  if (!loadingExplorer || !loadedExplorer) throw new Error('Expected Classic explorer bounds');
  expect(Math.abs(loadedExplorer.x - loadingExplorer.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedExplorer.width - loadingExplorer.width)).toBeLessThanOrEqual(1);
  await expectClassicSharedFrame(page);
  const before = await page.locator('.dashboard-workspace-center').boundingBox();

  await page.locator('.dashboard-change-row').filter({ hasText: 'classic-two' }).click();
  await expect.poll(() => secondDetailStarted).toBe(true);
  await expect(detailTitle).toContainText('classic-one');
  const during = await page.locator('.dashboard-workspace-center').boundingBox();
  if (!before || !during) throw new Error('Expected detail layout bounds');
  expect(Math.abs(during.height - before.height)).toBeLessThanOrEqual(1);

  await expect(detailTitle).toContainText('classic-two');
});

test('uses one selection surface for the Classic change row', async ({ page }) => {
  await page.goto('/?demo');

  const row = page.locator('.dashboard-change-row').nth(1);
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');

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
  expect(layers.rowClassName).toContain('selected');
  await expect(row).toHaveCSS('background-color', 'rgb(237, 244, 255)');
  await expect(row).toHaveCSS('box-shadow', 'none');
  await expect(
    page.locator('.classic-changes-explorer .dashboard-change-row[aria-pressed="true"]'),
  ).toHaveCount(1);
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

test('uses two columns on desktop and stacks the explorer above detail on mobile', async ({
  page,
}) => {
  await page.goto('/?demo');
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of ['Classic 工作流', 'Native 工作流']) {
      await page.getByRole('tab', { name }).click();
      if (name === 'Classic 工作流') {
        const frame = await expectClassicSharedFrame(page);
        if (width > 760) {
          const activeCard = await page.locator('.dashboard-summary-card').first().boundingBox();
          expect(Math.abs(frame.left.width - activeCard!.width + 1)).toBeLessThanOrEqual(1);
          expect(
            Math.abs(frame.left.right - activeCard!.x - activeCard!.width),
          ).toBeLessThanOrEqual(1);
        }
      } else {
        const [left, detail] = await Promise.all([
          page.locator('.dashboard-workspace-left').boundingBox(),
          page.locator('.dashboard-workspace-center').boundingBox(),
        ]);
        if (width > 760) {
          const activeCard = await page.locator('.dashboard-summary-card').first().boundingBox();
          expect(left!.width).toBeGreaterThanOrEqual(260);
          expect(Math.abs(left!.width - activeCard!.width + 1)).toBeLessThanOrEqual(1);
          expect(Math.abs(detail!.x - left!.x - left!.width)).toBeLessThanOrEqual(1);
        } else {
          expect(Math.abs(left!.x - detail!.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(detail!.y - left!.y - left!.height)).toBeLessThanOrEqual(1);
        }
      }
    }
  }
});

test('keeps the project selector inset when switching from a workflow to plugin center', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?demo');

  const projectSelector = page.locator('.comet-project-select');
  await expect(projectSelector).toBeVisible();
  await page.getByRole('tab', { name: 'Native 工作流' }).click();
  await expect(page.locator('.native-changes-explorer')).toBeVisible();

  const workflowLeft = (await projectSelector.boundingBox())?.x;
  if (workflowLeft === undefined) throw new Error('Expected workflow project selector bounds');

  await page.getByRole('button', { name: '个人记忆' }).click();
  await expect(page.locator('.dashboard-tool-page-memory')).toBeVisible();
  const memoryLeft = (await projectSelector.boundingBox())?.x;
  if (memoryLeft === undefined) throw new Error('Expected personal memory project selector bounds');
  expect(Math.abs(memoryLeft - workflowLeft)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '项目知识' }).click();
  await expect(page.locator('.dashboard-tool-page-knowledge')).toBeVisible();
  const knowledgeLeft = (await projectSelector.boundingBox())?.x;
  if (knowledgeLeft === undefined)
    throw new Error('Expected project knowledge project selector bounds');
  expect(Math.abs(knowledgeLeft - workflowLeft)).toBeLessThanOrEqual(1);
});

test('keeps long project names discoverable without widening the selector', async ({ page }) => {
  const longProjectName = 'comet-supervisor-config-and-runtime-monitoring';
  let projectName = 'comet';

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
              name: projectName,
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
            name: projectName,
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
  await expect(selectedProject).toHaveText(projectName);
  await page.evaluate(() => document.fonts.ready);
  const shortNameWidth = await projectSelector.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  projectName = longProjectName;
  await page.reload();
  await expect(selectedProject).toBeVisible();
  await expect(selectedProject).toHaveAttribute('title', longProjectName);
  await expect(selectedProject).toHaveText(longProjectName);
  await expect(selectedProject).toHaveCSS('text-overflow', 'ellipsis');
  await expect(selectedProject).toHaveCSS('white-space', 'nowrap');
  const longNameWidth = await projectSelector.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(Math.abs(longNameWidth - shortNameWidth)).toBeLessThanOrEqual(1);
  expect(longNameWidth).toBeGreaterThanOrEqual(160);
  expect(longNameWidth).toBeLessThanOrEqual(220);

  await projectSelector.click();
  const projectOption = page
    .locator('.comet-project-select-dropdown .comet-project-option-name')
    .first();
  await expect(projectOption).toHaveAttribute('title', longProjectName);
});

test('shows the project memory tab on the demo knowledge page', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/?demo');
  await page.getByRole('button', { name: '项目知识' }).click();

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
  const entries = Array.from({ length: 24 }, (_, index) => ({
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
      const memory = entries.find((entry) => entry.slug === body.input?.slug) ?? entries[0];
      await route.fulfill({ json: { result: { kind: 'memory', ...memory } } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '项目知识' }).click();
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
});

type NumberAuditNativeOptions = {
  specs?: Partial<{ total: number; create: number; modify: number; remove: number }>;
  acceptance?: Partial<{
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    pending: number;
  }>;
  stage?: string;
  localStatus?: string;
  childCompleted?: number;
  childTotal?: number;
};

function numberAuditNativeChange(name: string, options: NumberAuditNativeOptions = {}) {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  return {
    ...source,
    name,
    locator: `numeric-audit/${name}`,
    status: 'active',
    children: Array.from({ length: options.childTotal ?? 0 }, (_, index) => ({
      name: `${name}-child-${index + 1}`,
      status: index < (options.childCompleted ?? 0) ? 'done' : 'pending',
      dependsOn: [],
    })),
    specs: {
      ...source.specs,
      total: 1,
      create: 0,
      modify: 1,
      remove: 0,
      capabilities: [],
      ...options.specs,
    },
    acceptance: { total: 4, passed: 1, failed: 0, blocked: 0, pending: 3, ...options.acceptance },
    acceptanceItems: [],
    loop: { ...source.loop, stage: options.stage ?? 'building' },
    localExecution: { ...source.localExecution, status: options.localStatus ?? 'queued' },
  };
}

function numberAuditState(
  projectId: string,
  summaryValues: number[],
  options: {
    classicTotal?: number;
    classicCompleted?: number;
    classicTaskTotal?: number;
    nativeTotal?: number;
    nativeActiveCount?: number;
    nativeChanges?: ReturnType<typeof numberAuditNativeChange>[];
  } = {},
) {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  const [activeChanges, archivedChanges, verifyFailed, tasksIncomplete, dirtyFiles] = summaryValues;
  snapshot.project = { ...snapshot.project, name: projectId, path: `/${projectId}` };
  snapshot.summary = { activeChanges, archivedChanges, verifyFailed, tasksIncomplete, dirtyFiles };
  const classic = {
    ...snapshot.changes.active[0],
    id: 'numeric-classic-change',
    name: 'numeric-classic-change',
    displayName: 'numeric-classic-change',
    path: 'docs/openspec/changes/numeric-classic-change',
    tasks: {
      ...snapshot.changes.active[0].tasks,
      completed: options.classicCompleted ?? 1,
      total: options.classicTaskTotal ?? 4,
      incomplete: [],
    },
  };
  const nativeChanges = options.nativeChanges ?? [numberAuditNativeChange('ship-native-dashboard')];
  snapshot.changes.active = [classic];
  snapshot.native = {
    ...snapshot.native,
    activeChangeCount: options.nativeActiveCount ?? nativeChanges.length,
    archivedChangeCount: 0,
    totalChangeCount: options.nativeTotal ?? nativeChanges.length,
    visibleChangeCount: nativeChanges.length,
    changes: nativeChanges,
  };
  return {
    projectId,
    snapshot,
    classic,
    classicTotal: options.classicTotal ?? 1,
    nativeChanges,
    nativeTotal: options.nativeTotal ?? nativeChanges.length,
  };
}

function numberAuditFixture(states: ReturnType<typeof numberAuditState>[]) {
  const projects = states.map(({ projectId }) => ({
    id: projectId,
    name: projectId === 'numeric-a' ? 'Numeric A' : 'Numeric B',
    path: `/${projectId}`,
    lastSeenAt: null,
    availability: 'available',
    isCurrent: projectId === 'numeric-a',
  }));
  return {
    projects,
    states: new Map(states.map((state) => [state.projectId, state])),
    queryGate: null as null | { query: string; held: Promise<void>; start: () => void },
    classicPageGate: null as null | {
      status: string;
      held: Promise<void>;
      start: () => void;
      responseStatus: number;
    },
    detailGate: null as null | {
      name: string;
      held: Promise<void>;
      start: () => void;
      responseStatus?: number;
    },
  };
}

async function installNumberAuditRoutes(
  page: Page,
  fixture: ReturnType<typeof numberAuditFixture>,
) {
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({ json: { currentProjectId: 'numeric-a', projects: fixture.projects } });
      return;
    }
    const projectId = url.pathname.split('/')[4];
    const state = fixture.states.get(projectId) ?? fixture.states.get('numeric-a')!;
    if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          ...state.snapshot,
          initialChanges: {
            status: 'active',
            items: state.classicTotal ? [state.classic] : [],
            total: state.classicTotal,
            nextCursor: null,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith('/native-changes')) {
      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const gate = fixture.queryGate;
      if (gate && query === gate.query.toLowerCase()) {
        gate.start();
        await gate.held;
      }
      const items = state.nativeChanges.filter(
        (change) => !query || change.name.toLowerCase().includes(query),
      );
      await route.fulfill({
        json: {
          status: url.searchParams.get('status') ?? 'active',
          items,
          total: query ? items.length : state.nativeTotal,
          nextCursor: null,
        },
      });
      return;
    }
    if (url.pathname.endsWith('/native-change')) {
      const name = url.searchParams.get('changeName');
      const gate = fixture.detailGate;
      if (gate && name === gate.name) {
        gate.start();
        await gate.held;
        if (gate.responseStatus && gate.responseStatus !== 200) {
          await route.fulfill({
            status: gate.responseStatus,
            json: { error: 'Numeric audit detail failed' },
          });
          return;
        }
      }
      await route.fulfill({
        json: state.nativeChanges.find((change) => change.name === name) ?? state.nativeChanges[0],
      });
      return;
    }
    if (url.pathname.endsWith('/changes')) {
      const gate = fixture.classicPageGate;
      if (gate && url.searchParams.get('status') === gate.status) {
        gate.start();
        await gate.held;
        await route.fulfill({
          status: gate.responseStatus,
          json: { error: 'Numeric audit old page failed' },
        });
        return;
      }
      await route.fulfill({
        json: {
          status: url.searchParams.get('status') ?? 'active',
          items: state.classicTotal ? [state.classic] : [],
          total: state.classicTotal,
          nextCursor: null,
        },
      });
      return;
    }
    if (url.pathname.endsWith('/change')) {
      await route.fulfill({ json: state.classic });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({ json: { pages: [] } });
      return;
    }
    await route.fulfill({ json: {} });
  });
}

async function numberAuditSummaryValues(page: Page) {
  return page
    .locator('.dashboard-overview-summary-strip .ant-statistic-content-value')
    .evaluateAll((values) => values.map((value) => Number(value.innerText.trim())));
}

async function numberAuditBadgeValue(page: Page, selector: string) {
  return page.locator(selector).evaluate((badge) => {
    const counter = badge.querySelector('.ant-scroll-number');
    const title = counter?.getAttribute('title');
    if (title !== null && title !== undefined) return Number(title);
    const digits = Array.from(
      counter?.querySelectorAll('.ant-scroll-number-only-unit.current') ?? [],
    ).map((digit) => digit.textContent?.trim() ?? '');
    return Number(digits.join(''));
  });
}

async function numberAuditNativeValues(page: Page) {
  return page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll('.native-change-detail article'));
    const scope = articles.find((article) => article.querySelector('h4')?.innerText === '变更范围');
    const acceptance = articles.find(
      (article) => article.querySelector('h4')?.innerText === '验收状态',
    );
    const scopeCounts = Array.from(
      scope?.querySelectorAll('.native-scope-metrics .ant-statistic-content-value') ?? [],
    ).map((node) => Number(node.innerText.trim()));
    const acceptanceHeader =
      acceptance?.querySelector('.native-acceptance-header')?.innerText ?? '';
    const acceptanceCounts = Array.from(
      acceptance?.querySelectorAll('.native-acceptance-metrics .ant-statistic-content-value') ?? [],
    ).map((node) => Number(node.innerText.trim()));
    return {
      scope: scopeCounts,
      acceptance: acceptance
        ? [Number(acceptanceHeader.match(/(\d+)% 已处理/)?.[1]), ...acceptanceCounts]
        : [],
    };
  });
}

async function expectNumberAuditNativeValues(
  page: Page,
  expected: { scope: number[]; acceptance: number[] },
) {
  const detail = page.locator('.native-change-detail');
  await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect
    .poll(async () => (await numberAuditNativeValues(page)).scope)
    .toEqual(expected.scope);
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await expect
    .poll(async () => (await numberAuditNativeValues(page)).acceptance)
    .toEqual(expected.acceptance);
}

async function enableNumberAuditReducedMotion(page: Page) {
  await page.evaluate(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const auditWindow = window as Window & { __numberAuditMotionChange?: Promise<void> };
    auditWindow.__numberAuditMotionChange = query.matches
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          query.addEventListener('change', () => resolve(), { once: true });
        });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    const auditWindow = window as Window & { __numberAuditMotionChange?: Promise<void> };
    await auditWindow.__numberAuditMotionChange;
  });
}

async function numberAuditAcceptanceProgress(page: Page) {
  const progress = page.locator('.native-acceptance-progress > span');
  return progress.evaluate((element) => {
    const parentWidth = element.parentElement?.getBoundingClientRect().width ?? 0;
    return parentWidth ? element.getBoundingClientRect().width / parentWidth : 0;
  });
}

async function numberAuditClassicTasks(page: Page) {
  return page
    .locator('.classic-changes-explorer .dashboard-explorer-row-count')
    .first()
    .evaluate((element) => {
      const values = element.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
      return values ? [Number(values[1]), Number(values[2])] : null;
    });
}

async function captureNumberAuditDetailFrames(page: Page, changeName: string) {
  await page.evaluate((name) => {
    const auditWindow = window as Window & {
      __numberAuditDetailFrames?: number[][];
      __numberAuditDetailFrame?: number;
    };
    window.cancelAnimationFrame(auditWindow.__numberAuditDetailFrame ?? 0);
    const frames: number[][] = [];
    auditWindow.__numberAuditDetailFrames = frames;
    let remaining = 8;
    const capture = () => {
      if (auditWindow.__numberAuditDetailFrames !== frames) return;
      const detail = Array.from(document.querySelectorAll('.native-change-detail')).find((entry) =>
        entry.querySelector('h3.text-base')?.innerText.includes(name),
      );
      if (detail) {
        const scopeCounts = Array.from(
          detail.querySelectorAll('.native-scope-metrics .ant-statistic-content-value'),
        ).map((node) => Number(node.innerText.trim()));
        if (scopeCounts.length === 4) {
          frames.push(scopeCounts);
          remaining -= 1;
        }
      }
      if (remaining > 0)
        auditWindow.__numberAuditDetailFrame = window.requestAnimationFrame(capture);
    };
    auditWindow.__numberAuditDetailFrame = window.requestAnimationFrame(capture);
  }, changeName);
}

async function captureNumberAuditClassicFrames(page: Page, summary: number[]) {
  await page.evaluate((expectedSummary) => {
    const auditWindow = window as Window & { __numberAuditClassicFrames?: number[][] };
    auditWindow.__numberAuditClassicFrames = [];
    let remaining = 8;
    const capture = () => {
      const cards = Array.from(document.querySelectorAll('.dashboard-overview-summary-card'));
      const targetsMatch =
        cards.length === expectedSummary.length &&
        cards.every((card, index) =>
          card.getAttribute('aria-label')?.includes(` ${expectedSummary[index]} `),
        );
      if (targetsMatch) {
        const displayedSummary = cards.map((card) =>
          Number(card.querySelector('.ant-statistic-content-value')?.textContent?.trim()),
        );
        const badge = document.querySelector(
          '.classic-changes-explorer .dashboard-change-count-badge .ant-scroll-number',
        );
        const badgeValue = Number(badge?.getAttribute('title'));
        const taskText =
          document.querySelector('.dashboard-change-row .dashboard-explorer-row-count')
            ?.textContent ?? '';
        const tasks = taskText.match(/(\d+)\s*\/\s*(\d+)/);
        if (tasks) {
          auditWindow.__numberAuditClassicFrames?.push([
            ...displayedSummary,
            badgeValue,
            Number(tasks[1]),
            Number(tasks[2]),
          ]);
          remaining -= 1;
        }
      }
      if (remaining > 0) window.requestAnimationFrame(capture);
    };
    window.requestAnimationFrame(capture);
  }, summary);
}

async function captureNumberAuditClassicTaskFrames(page: Page) {
  await page.evaluate(() => {
    const auditWindow = window as Window & { __numberAuditClassicTaskFrames?: number[][] };
    const frames: number[][] = [];
    auditWindow.__numberAuditClassicTaskFrames = frames;
    let remaining = 40;
    const capture = () => {
      const text =
        document.querySelector('.dashboard-change-row .dashboard-explorer-row-count')
          ?.textContent ?? '';
      const counts = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (counts) frames.push([Number(counts[1]), Number(counts[2])]);
      if (remaining > 0) {
        remaining -= 1;
        window.requestAnimationFrame(capture);
      }
    };
    window.requestAnimationFrame(capture);
  });
}

async function captureNumberAuditSummaryFrames(page: Page, workflow: 'classic' | 'native') {
  await page.evaluate((selectedWorkflow) => {
    const auditWindow = window as Window & { __numberAuditSummaryFrames?: number[][] };
    const frames: number[][] = [];
    auditWindow.__numberAuditSummaryFrames = frames;
    const capture = () => {
      if (auditWindow.__numberAuditSummaryFrames !== frames) return;
      const values = Array.from(
        document.querySelectorAll('.dashboard-overview-summary-strip .ant-statistic-content-value'),
      );
      if (document.querySelector(`.${selectedWorkflow}-changes-explorer`) && values.length === 5) {
        frames.push(values.map((value) => Number(value.textContent?.trim())));
      }
      if (frames.length < 8) window.requestAnimationFrame(capture);
    };
    window.requestAnimationFrame(capture);
  }, workflow);
}

async function captureNumberAuditNativeExplorerFrames(page: Page) {
  await page.evaluate(() => {
    const auditWindow = window as Window & { __numberAuditNativeExplorerFrames?: number[][] };
    const frames: number[][] = [];
    auditWindow.__numberAuditNativeExplorerFrames = frames;
    let remaining = 40;
    const capture = () => {
      if (auditWindow.__numberAuditNativeExplorerFrames !== frames) return;
      const row = document.querySelector('.native-change-row');
      const countText = row?.querySelector('.dashboard-explorer-row-count')?.textContent ?? '';
      const counts = countText.match(/(\d+)\s*\/\s*(\d+)/);
      if (counts) frames.push([Number(counts[1]), Number(counts[2])]);
      if (remaining > 0) {
        remaining -= 1;
        window.requestAnimationFrame(capture);
      }
    };
    window.requestAnimationFrame(capture);
  });
}

test.describe('Dashboard numeric transitions', () => {
  test('preserves the Explorer Badge digit scroll for dataset changes and immediately settles reduced motion', async ({
    page,
  }) => {
    const fixture = numberAuditFixture([
      numberAuditState('numeric-a', [1, 1, 1, 1, 1]),
      numberAuditState('numeric-b', [1, 1, 1, 1, 1]),
    ]);
    const setCount = (projectId: string, count: number) => {
      fixture.states.set(
        projectId,
        numberAuditState(projectId, [1, 1, 1, 1, 1], {
          classicTotal: count,
          nativeTotal: count,
          nativeActiveCount: count,
          nativeChanges: count ? [numberAuditNativeChange('numeric-classic-change')] : [],
        }),
      );
    };
    await installNumberAuditRoutes(page, fixture);
    for (const workflow of ['classic', 'native'] as const) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      fixture.projects.forEach((project) =>
        Object.assign(project, {
          defaultWorkflow: workflow,
          workflowSource: 'configured',
        }),
      );
      setCount('numeric-a', 16);
      setCount('numeric-b', 7);
      const badge = (selectedWorkflow = workflow) =>
        page.locator(
          `.${selectedWorkflow}-changes-explorer .dashboard-change-count-badge .ant-scroll-number`,
        );
      const snapshot = () =>
        badge().evaluate((counter) => {
          const bounds = counter.getBoundingClientRect();
          const center = bounds.top + bounds.height / 2;
          const digits = Array.from(counter.querySelectorAll('.ant-scroll-number-only'));
          const visible = digits.length
            ? digits
                .map((digit) => {
                  const units = Array.from(digit.querySelectorAll('.ant-scroll-number-only-unit'));
                  const nearest = units.reduce((best, unit) => {
                    const box = unit.getBoundingClientRect();
                    const previous = best.getBoundingClientRect();
                    return Math.abs(box.top + box.height / 2 - center) <
                      Math.abs(previous.top + previous.height / 2 - center)
                      ? unit
                      : best;
                  });
                  return nearest.textContent?.trim() ?? '';
                })
                .join('')
            : counter.textContent?.trim();
          return {
            target: Number(counter.getAttribute('title')),
            visible: Number(visible),
            animations: counter
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === 'running').length,
            digitTransitions: digits
              .flatMap((digit) => digit.getAnimations())
              .filter(
                (animation) =>
                  animation.playState === 'running' &&
                  animation instanceof CSSTransition &&
                  animation.transitionProperty === 'transform',
              ).length,
          };
        });
      const settled = async (count: number) =>
        expect
          .poll(async () => {
            const state = await snapshot();
            return state.target === count && state.visible === count && state.animations === 0;
          })
          .toBe(true);
      const rolling = async (count: number, action: () => Promise<unknown>) => {
        await action();
        await expect
          .poll(
            async () => {
              const state = await snapshot();
              return (
                state.target === count && state.digitTransitions > 0 && state.visible !== count
              );
            },
            { intervals: [10, 20, 30] },
          )
          .toBe(true);
      };

      await page.goto('/');
      await expect(badge()).toHaveAttribute('title', '16');
      expect(await snapshot()).toMatchObject({ visible: 16, animations: 0 });
      await page.locator('.comet-project-select').click();
      await page
        .locator('.comet-project-select-dropdown .comet-project-option')
        .filter({ hasText: '/numeric-b' })
        .click();
      await expect(badge()).toHaveAttribute('title', '7');
      expect(await snapshot()).toMatchObject({ visible: 7, animations: 0 });
      const otherWorkflow = workflow === 'classic' ? 'native' : 'classic';
      await page
        .getByRole('tab', {
          name: otherWorkflow === 'classic' ? 'Classic 工作流' : 'Native 工作流',
          exact: true,
        })
        .click();
      await expect(badge(otherWorkflow)).toHaveAttribute('title', '7');
      expect(
        await badge(otherWorkflow).evaluate(
          (counter) => counter.getAnimations({ subtree: true }).length,
        ),
      ).toBe(0);
      await page.goto('/?demo');
      if (workflow === 'native')
        await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
      await settled(workflow === 'classic' ? 16 : 18);
      await rolling(9, () => page.getByRole('tab', { name: '已归档', exact: true }).click());
      await settled(9);
      const archivedName =
        workflow === 'classic'
          ? DEMO_SNAPSHOT.changes.archived[0].name
          : DEMO_SNAPSHOT.native.changes.find((change) => change.status === 'archived')!.name;
      await rolling(1, () => page.getByPlaceholder('搜索变更、产物或文件…').fill(archivedName));
      await settled(1);

      await page.goto('/');
      await expect(badge()).toHaveAttribute('title', '16');
      await settled(16);
      for (const count of [120, 106]) {
        setCount('numeric-a', count);
        await rolling(count, () => page.getByRole('button', { name: '立即刷新' }).click());
        await settled(count);
      }
      setCount('numeric-a', 129);
      await rolling(129, () => page.getByRole('button', { name: '立即刷新' }).click());
      setCount('numeric-a', 71);
      await rolling(71, () => page.getByRole('button', { name: '立即刷新' }).click());
      await enableNumberAuditReducedMotion(page);
      expect(await snapshot()).toMatchObject({
        target: 71,
        visible: 71,
        animations: 0,
        digitTransitions: 0,
      });
      setCount('numeric-a', 0);
      await page.getByRole('button', { name: '立即刷新' }).click();
      await expect(badge()).toHaveAttribute('title', '0');
      expect(await snapshot()).toMatchObject({ target: 0, visible: 0, animations: 0 });
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/?demo');
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    const explorer = page.locator('.native-changes-explorer');
    const children = DEMO_SNAPSHOT.native.changes[0].children;
    if (children.length) {
      const completed = children.filter(({ status }) =>
        ['done', 'verified', 'integrated', 'archived'].includes(status),
      ).length;
      await expect(
        page.locator('.native-change-row').first().locator('.dashboard-explorer-row-count'),
      ).toContainText(`${completed}/${children.length} 子变更`);
    }
    const clip = await explorer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const tabs = element.querySelector('.native-changes-explorer-tabs')!.getBoundingClientRect();
      return {
        x: bounds.left - 8,
        y: bounds.top - 8,
        width: bounds.width + 16,
        height: tabs.bottom - bounds.top + 104,
      };
    });
    await page.screenshot({
      path: test.info().outputPath('changes-explorer-count-scroll-final.png'),
      clip,
    });
  });

  test('starts a real workflow switch at zero across delayed Native data and cached returns', async ({
    page,
  }) => {
    const entryChange = numberAuditNativeChange('ship-native-dashboard', {
      specs: { total: 64, create: 20, modify: 30, remove: 14 },
      acceptance: { total: 100, passed: 70, failed: 0, blocked: 0, pending: 30 },
    });
    const fixture = numberAuditFixture([
      numberAuditState('numeric-a', [16, 9, 4, 36, 3], {
        classicCompleted: 4,
        classicTaskTotal: 8,
        nativeActiveCount: 16,
        nativeChanges: [entryChange],
      }),
    ]);
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([16, 9, 4, 36, 3]);

    let releaseOldPage!: () => void;
    let startOldPage!: () => void;
    const oldPageStarted = new Promise<void>((resolve) => {
      startOldPage = resolve;
    });
    fixture.classicPageGate = {
      status: 'archived',
      held: new Promise<void>((resolve) => {
        releaseOldPage = resolve;
      }),
      start: startOldPage,
      responseStatus: 500,
    };
    await page.getByRole('tab', { name: '已归档', exact: true }).click();
    await oldPageStarted;

    let releaseList!: () => void;
    let releaseDetail!: () => void;
    let startList!: () => void;
    let startDetail!: () => void;
    const listStarted = new Promise<void>((resolve) => {
      startList = resolve;
    });
    const detailStarted = new Promise<void>((resolve) => {
      startDetail = resolve;
    });
    fixture.queryGate = {
      query: '',
      held: new Promise<void>((resolve) => {
        releaseList = resolve;
      }),
      start: startList,
    };
    fixture.detailGate = {
      name: entryChange.name,
      held: new Promise<void>((resolve) => {
        releaseDetail = resolve;
      }),
      start: startDetail,
    };
    await captureNumberAuditSummaryFrames(page, 'native');
    await captureNumberAuditDetailFrames(page, entryChange.name);
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await listStarted;
    await expect(page.locator('.native-change-list-skeleton')).toBeVisible();
    releaseOldPage();
    await expect(page.getByText(/^变更列表加载失败：/)).toBeVisible();
    releaseList();
    await detailStarted;
    await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
    releaseDetail();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
          return auditWindow.__numberAuditDetailFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const delayedDetailFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
      return auditWindow.__numberAuditDetailFrames ?? [];
    });
    expect(delayedDetailFrames[0][0]).toBeLessThan(64);
    expect(delayedDetailFrames.some(([total]) => total > 0 && total < 64)).toBe(true);
    const summaryFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditSummaryFrames?: number[][] };
      return auditWindow.__numberAuditSummaryFrames ?? [];
    });
    expect(summaryFrames[0][0]).toBeLessThan(16);
    await expectNumberAuditNativeValues(page, {
      scope: [64, 20, 30, 14],
      acceptance: [70, 70, 0, 0, 30],
    });

    await captureNumberAuditClassicFrames(page, [16, 9, 4, 36, 3]);
    await page.getByRole('tab', { name: 'Classic 工作流', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditClassicFrames?: number[][] };
          return auditWindow.__numberAuditClassicFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const classicFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditClassicFrames?: number[][] };
      return auditWindow.__numberAuditClassicFrames ?? [];
    });
    expect(classicFrames[0][0]).toBeLessThan(16);
    expect(classicFrames[0][6]).toBeLessThan(4);
    expect(classicFrames[0][7]).toBeLessThan(8);
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([16, 9, 4, 36, 3]);
    await expect(page.locator('.dashboard-change-row').first()).toContainText('4/8');

    await captureNumberAuditDetailFrames(page, entryChange.name);
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
          return auditWindow.__numberAuditDetailFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const cachedDetailFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
      return auditWindow.__numberAuditDetailFrames ?? [];
    });
    expect(cachedDetailFrames[0][0]).toBeLessThan(64);
    await enableNumberAuditReducedMotion(page);
    await expectNumberAuditNativeValues(page, {
      scope: [64, 20, 30, 14],
      acceptance: [70, 70, 0, 0, 30],
    });
    expect(await numberAuditSummaryValues(page)).toEqual([16, 0, 0, 0, 30]);
    expect(await numberAuditAcceptanceProgress(page)).toBeCloseTo(0.7, 2);
  });

  test('starts a delayed Native detail retry at zero after a failed visit and workflow return', async ({
    page,
  }) => {
    const entryChange = numberAuditNativeChange('ship-native-dashboard', {
      specs: { total: 64, create: 20, modify: 30, remove: 14 },
      acceptance: { total: 100, passed: 70, failed: 0, blocked: 0, pending: 30 },
    });
    const fixture = numberAuditFixture([
      numberAuditState('numeric-a', [16, 9, 4, 36, 3], { nativeChanges: [entryChange] }),
    ]);
    fixture.detailGate = {
      name: entryChange.name,
      held: Promise.resolve(),
      start: () => {},
      responseStatus: 500,
    };
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([16, 9, 4, 36, 3]);
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await expect(page.locator('.native-change-detail [role="alert"]')).toContainText(
      'Native 变更详情加载失败',
    );
    await page.getByRole('tab', { name: 'Classic 工作流', exact: true }).click();
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([16, 9, 4, 36, 3]);

    let releaseDetail!: () => void;
    let startDetail!: () => void;
    const detailStarted = new Promise<void>((resolve) => {
      startDetail = resolve;
    });
    fixture.detailGate = {
      name: entryChange.name,
      held: new Promise<void>((resolve) => {
        releaseDetail = resolve;
      }),
      start: startDetail,
    };
    await captureNumberAuditDetailFrames(page, entryChange.name);
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await detailStarted;
    await expect(page.locator('.native-change-detail-skeleton')).toBeVisible();
    releaseDetail();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
          return auditWindow.__numberAuditDetailFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const retryFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
      return auditWindow.__numberAuditDetailFrames ?? [];
    });
    expect(retryFrames[0][0]).toBeLessThan(64);
    expect(retryFrames.some(([total]) => total > 0 && total < 64)).toBe(true);
    await expectNumberAuditNativeValues(page, {
      scope: [64, 20, 30, 14],
      acceptance: [70, 70, 0, 0, 30],
    });
  });

  test('animates Classic counters to the latest value and preserves zero and 100 badge counts', async ({
    page,
  }) => {
    const initial = numberAuditState('numeric-a', [1, 1, 1, 1, 1], {
      classicTotal: 1,
      classicCompleted: 0,
      classicTaskTotal: 0,
      nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
    });
    const fixture = numberAuditFixture([initial]);
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Classic 工作流', exact: true }).click();
    await expect(
      page.locator('.dashboard-overview-summary-strip .dashboard-summary-card'),
    ).toHaveCount(5);
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([1, 1, 1, 1, 1]);
    await expect(
      page.locator('.classic-changes-explorer .dashboard-explorer-row-count').first(),
    ).toContainText('0/0');
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.classic-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(1);

    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [6, 5, 4, 7, 8], {
        classicTotal: 100,
        classicCompleted: 1,
        classicTaskTotal: 4,
        nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
      }),
    );
    const firstRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await firstRefresh;
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([6, 5, 4, 7, 8]);
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.classic-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(100);
    await expect(page.locator('.dashboard-change-row').first()).toContainText('1/4');

    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [2, 3, 4, 5, 6], {
        classicTotal: 100,
        classicCompleted: 3,
        classicTaskTotal: 4,
        nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
      }),
    );
    const secondRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await captureNumberAuditClassicTaskFrames(page);
    await page.getByRole('button', { name: '立即刷新' }).click();
    await secondRefresh;
    await expect
      .poll(async () => {
        const value = (await numberAuditSummaryValues(page))[0];
        return value > 2 && value < 6;
      })
      .toBe(true);
    await expect.poll(() => numberAuditClassicTasks(page)).toEqual([3, 4]);
    const classicTaskFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditClassicTaskFrames?: number[][] };
      return auditWindow.__numberAuditClassicTaskFrames ?? [];
    });
    expect(classicTaskFrames.some(([completed, total]) => completed === 2 && total === 4)).toBe(
      true,
    );

    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [8, 7, 6, 5, 4], {
        classicTotal: 100,
        classicCompleted: 2,
        classicTaskTotal: 5,
        nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
      }),
    );
    const thirdRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await thirdRefresh;
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([8, 7, 6, 5, 4]);
    await expect(page.locator('.dashboard-change-row').first()).toContainText('2/5');
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.classic-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(100);

    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [5, 4, 3, 2, 1], {
        classicTotal: 100,
        classicCompleted: 1,
        classicTaskTotal: 4,
        nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
      }),
    );
    const countRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: '立即刷新' }).click();
    await countRefresh;
    await expect.poll(() => numberAuditClassicTasks(page)).toEqual([1, 4]);
    await enableNumberAuditReducedMotion(page);
    expect(await numberAuditClassicTasks(page)).toEqual([1, 4]);
    expect(await numberAuditSummaryValues(page)).toEqual([5, 4, 3, 2, 1]);

    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [0, 0, 0, 0, 0], {
        classicTotal: 0,
        nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
      }),
    );
    const zeroRefresh = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await zeroRefresh;
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([0, 0, 0, 0, 0]);
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.classic-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(0);
  });

  test('animates Native scope and acceptance counts, settles progress with reduced motion, and captures the final state', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1800, height: 1500 });
    const initialNative = numberAuditNativeChange('ship-native-dashboard', {
      specs: { total: 1, create: 0, modify: 1, remove: 0 },
      acceptance: { total: 4, passed: 1, failed: 1, blocked: 0, pending: 2 },
      stage: 'building',
      localStatus: 'queued',
      childCompleted: 1,
      childTotal: 4,
    });
    const initial = numberAuditState('numeric-a', [1, 1, 1, 1, 1], {
      nativeTotal: 2,
      nativeActiveCount: 1,
      nativeChanges: [initialNative],
    });
    const fixture = numberAuditFixture([initial]);
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
      'ship-native-dashboard',
    );
    await expectNumberAuditNativeValues(page, {
      scope: [1, 0, 1, 0],
      acceptance: [50, 1, 1, 0, 2],
    });
    await page.getByRole('tab', { name: '变更详情', exact: true }).click();
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.native-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(2);
    await expect(page.locator('.native-change-row').first()).toContainText('1/4 子变更');

    const updatedNative = numberAuditNativeChange('ship-native-dashboard', {
      specs: { total: 6, create: 2, modify: 3, remove: 1 },
      acceptance: { total: 8, passed: 3, failed: 2, blocked: 1, pending: 2 },
      stage: 'archive-ready',
      localStatus: 'running',
      childCompleted: 3,
      childTotal: 8,
    });
    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [4, 2, 1, 3, 5], {
        nativeTotal: 6,
        nativeActiveCount: 4,
        nativeChanges: [updatedNative],
      }),
    );
    const updatedOverview = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await captureNumberAuditNativeExplorerFrames(page);
    await page.getByRole('button', { name: '立即刷新' }).click();
    await updatedOverview;
    await expect
      .poll(async () => {
        const numbers = await numberAuditNativeValues(page);
        return numbers.scope[0] > 1 && numbers.scope[0] < 6;
      })
      .toBe(true);
    await expect
      .poll(() =>
        numberAuditBadgeValue(page, '.native-changes-explorer .dashboard-change-count-badge'),
      )
      .toBe(6);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditNativeExplorerFrames?: number[][] };
          return auditWindow.__numberAuditNativeExplorerFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const explorerFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditNativeExplorerFrames?: number[][] };
      return auditWindow.__numberAuditNativeExplorerFrames ?? [];
    });
    expect(
      explorerFrames.some(
        ([resolved, total]) => resolved > 1 && resolved < 3 && total > 4 && total < 8,
      ),
    ).toBe(true);
    await expect(page.locator('.native-change-row').first()).toContainText('3/8 子变更');
    await expectNumberAuditNativeValues(page, {
      scope: [6, 2, 3, 1],
      acceptance: [75, 3, 2, 1, 2],
    });
    await expect.poll(() => numberAuditAcceptanceProgress(page)).toBeCloseTo(0.75, 1);
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([4, 1, 1, 1, 2]);

    const reducedNative = numberAuditNativeChange('ship-native-dashboard', {
      specs: { total: 80, create: 40, modify: 20, remove: 20 },
      acceptance: { total: 10, passed: 2, failed: 0, blocked: 2, pending: 6 },
      stage: 'building',
      localStatus: 'queued',
      childCompleted: 2,
      childTotal: 5,
    });
    fixture.states.set(
      'numeric-a',
      numberAuditState('numeric-a', [3, 1, 1, 4, 2], {
        nativeTotal: 7,
        nativeActiveCount: 3,
        nativeChanges: [reducedNative],
      }),
    );
    const reducedOverview = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/overview'),
    );
    await page.getByRole('button', { name: '立即刷新' }).click();
    await reducedOverview;
    await expect
      .poll(async () => {
        const numbers = await numberAuditNativeValues(page);
        return numbers.acceptance[4] > 2 && numbers.acceptance[4] < 6;
      })
      .toBe(true);
    await enableNumberAuditReducedMotion(page);
    expect((await numberAuditNativeValues(page)).acceptance).toEqual([40, 2, 0, 2, 6]);
    await expectNumberAuditNativeValues(page, {
      scope: [80, 40, 20, 20],
      acceptance: [40, 2, 0, 2, 6],
    });
    expect(await numberAuditAcceptanceProgress(page)).toBeCloseTo(0.4, 2);
    await expect(page.locator('.native-change-row').first()).toContainText('2/5 子变更');
    expect(
      await page
        .locator('.native-acceptance-progress > span')
        .evaluate((element) => element.getAnimations().length),
    ).toBe(0);
    await page.goto('/?demo');
    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await expect(page.locator('.native-change-detail h3.text-base')).toContainText(
      'ship-native-dashboard',
    );
    const clip = await page.evaluate(() => {
      const regions = [
        document.querySelector('.dashboard-overview-summary-strip'),
        document.querySelector('.native-changes-explorer'),
        ...Array.from(document.querySelectorAll('.native-change-detail article')).filter(
          (article) =>
            ['变更范围', '验收状态'].includes(article.querySelector('h4')?.innerText ?? ''),
        ),
      ];
      const bounds = regions.map((region) => {
        if (!region) throw new Error('Numeric audit capture region is missing');
        return region.getBoundingClientRect();
      });
      const x = Math.min(...bounds.map((bound) => bound.left));
      const y = Math.min(...bounds.map((bound) => bound.top));
      return {
        x,
        y,
        width: Math.max(...bounds.map((bound) => bound.right)) - x,
        height: Math.max(...bounds.map((bound) => bound.bottom)) - y,
      };
    });
    await page.screenshot({ path: test.info().outputPath('numeric-native-final.png'), clip });
  });

  test('resets numbers on project, change and delayed filter result identity changes', async ({
    page,
  }) => {
    const projectA = numberAuditState('numeric-a', [16, 9, 4, 36, 3], {
      nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
    });
    const projectB = numberAuditState('numeric-b', [20, 12, 2, 24, 0], {
      classicTotal: 3,
      classicCompleted: 3,
      classicTaskTotal: 5,
      nativeTotal: 2,
      nativeActiveCount: 2,
      nativeChanges: [
        numberAuditNativeChange('ship-native-dashboard', {
          specs: { total: 2, create: 1, modify: 1, remove: 0 },
          acceptance: { total: 4, passed: 1, failed: 0, blocked: 0, pending: 3 },
        }),
        numberAuditNativeChange('align-dashboard-copy', {
          specs: { total: 7, create: 2, modify: 3, remove: 2 },
          acceptance: { total: 8, passed: 3, failed: 2, blocked: 1, pending: 2 },
        }),
      ],
    });
    const fixture = numberAuditFixture([projectA, projectB]);
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([16, 9, 4, 36, 3]);
    const projectOverview = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/numeric-b/overview'),
    );
    await page.locator('.comet-project-select').click();
    await page
      .locator('.comet-project-select-dropdown .comet-project-option')
      .filter({ hasText: '/numeric-b' })
      .click();
    await projectOverview;
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([20, 12, 2, 24, 0]);

    await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
    await expect(
      page.locator('.native-change-detail h3:not(.ant-skeleton-title)').first(),
    ).toContainText('ship-native-dashboard');
    await captureNumberAuditDetailFrames(page, 'align-dashboard-copy');
    await page.locator('.native-change-row').filter({ hasText: 'align-dashboard-copy' }).click();
    await expect(
      page.locator('.native-change-detail h3:not(.ant-skeleton-title)').first(),
    ).toContainText('align-dashboard-copy');
    await page.getByRole('tab', { name: '变更详情', exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
          return auditWindow.__numberAuditDetailFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    await expectNumberAuditNativeValues(page, {
      scope: [7, 2, 3, 2],
      acceptance: [75, 3, 2, 1, 2],
    });
    const changeFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
      return auditWindow.__numberAuditDetailFrames ?? [];
    });
    expect(changeFrames.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => [7, 2, 3, 2]));

    let releaseFilter!: () => void;
    let startFilter!: () => void;
    const filterHeld = new Promise<void>((resolve) => {
      releaseFilter = resolve;
    });
    const filterStarted = new Promise<void>((resolve) => {
      startFilter = resolve;
    });
    fixture.queryGate = {
      query: 'ship-native-dashboard',
      held: filterHeld,
      start: startFilter,
    };
    await captureNumberAuditDetailFrames(page, 'ship-native-dashboard');
    await page.getByPlaceholder('搜索变更、产物或文件…').fill('ship-native-dashboard');
    await filterStarted;
    await expect(page.locator('.native-change-row')).toHaveCount(0);
    releaseFilter();
    await expect(
      page.locator('.native-change-detail h3:not(.ant-skeleton-title)').first(),
    ).toContainText('ship-native-dashboard');
    await page.getByRole('tab', { name: '变更详情', exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
          return auditWindow.__numberAuditDetailFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    await expectNumberAuditNativeValues(page, {
      scope: [2, 1, 1, 0],
      acceptance: [25, 1, 0, 0, 3],
    });
    const filterFrames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditDetailFrames?: number[][] };
      return auditWindow.__numberAuditDetailFrames ?? [];
    });
    expect(filterFrames.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => [2, 1, 1, 0]));
  });

  test('keeps a filtered Classic refresh immediate when it completes before the query debounce', async ({
    page,
  }) => {
    const initial = numberAuditState('numeric-a', [1, 1, 1, 1, 1], {
      classicTotal: 1,
      classicCompleted: 1,
      classicTaskTotal: 4,
      nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
    });
    const fixture = numberAuditFixture([initial]);
    await installNumberAuditRoutes(page, fixture);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Classic 工作流', exact: true }).click();
    await expect.poll(() => numberAuditSummaryValues(page)).toEqual([1, 1, 1, 1, 1]);
    await expect(page.locator('.dashboard-change-row').first()).toContainText('1/4');

    const filtered = numberAuditState('numeric-a', [9, 8, 7, 6, 5], {
      classicTotal: 4,
      classicCompleted: 3,
      classicTaskTotal: 5,
      nativeChanges: [numberAuditNativeChange('ship-native-dashboard')],
    });
    fixture.states.set('numeric-a', filtered);
    await captureNumberAuditClassicFrames(page, [9, 8, 7, 6, 5]);
    const filteredOverview = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/overview') && url.searchParams.get('q') === 'numeric-classic-change'
      );
    });
    const elapsed = await page.evaluate(async () => {
      const input = document.querySelector<HTMLInputElement>('.comet-header-search input');
      const button = document.querySelector<HTMLButtonElement>('.comet-refresh-button');
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!input || !button || !setValue) throw new Error('Numeric audit controls are missing');
      const startedAt = performance.now();
      setValue.call(input, 'numeric-classic-change');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      button.click();
      return performance.now() - startedAt;
    });
    const response = await filteredOverview;
    expect(elapsed).toBeLessThan(250);
    expect(new URL(response.url()).searchParams.get('q')).toBe('numeric-classic-change');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const auditWindow = window as Window & { __numberAuditClassicFrames?: number[][] };
          return auditWindow.__numberAuditClassicFrames?.length ?? 0;
        }),
      )
      .toBeGreaterThanOrEqual(4);
    const frames = await page.evaluate(() => {
      const auditWindow = window as Window & { __numberAuditClassicFrames?: number[][] };
      return auditWindow.__numberAuditClassicFrames ?? [];
    });
    expect(frames.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => [9, 8, 7, 6, 5, 4, 3, 5]));
  });
});
