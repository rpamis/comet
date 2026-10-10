import { expect, test, type Locator, type Page } from '@playwright/test';

type Workflow = 'classic' | 'native';
type PageRequest = {
  workflow: Workflow;
  status: string;
  query: string;
  offset: number;
  limit: number;
  cursor: string | null;
};

function classicChange(name: string, status: string) {
  return {
    id: name,
    locator: name,
    name,
    displayName: name,
    status,
    relativePath: `openspec/changes/${name}`,
    workflow: 'feature',
    phase: status === 'archived' ? 'archive' : 'build',
    updatedAt: '2026-10-10T00:00:00.000Z',
    workspace: { id: 'fixture', label: 'fixture', branch: 'fixture', current: true },
    dir: `openspec/changes/${name}`,
    changesRelative: 'openspec/changes',
    tasks: {
      completed: 0,
      total: 12,
      incomplete: [],
      sections: Array.from({ length: 12 }, (_, index) => ({
        title: `验收分组 ${index + 1}`,
        completed: 0,
        total: 1,
        status: 'pending',
      })),
    },
    artifacts: {
      proposal: false,
      design: false,
      tasks: true,
      plan: false,
      verifyReport: false,
      cometYaml: false,
      grouped: [],
    },
    artifactPreviews: [],
    verify: { result: 'pending', reportExists: false },
    next: { command: null, reason: '继续当前任务。', description: '按验收分组推进。' },
    risks: [],
  };
}

function nativeChange(name: string, status: string) {
  return {
    workflow: 'native',
    locator: name,
    name,
    status,
    archivedAt: status === 'archived' ? '2026-10-10' : null,
    archiveName: status === 'archived' ? `2026-10-10-${name}` : undefined,
    phase: status === 'archived' ? 'archive' : 'build',
    lifecycleStatus: status === 'archived' ? 'done' : 'active',
    stateVersion: 2,
    legacy: false,
    migration: { status: 'none', message: null },
    workspace: { id: 'fixture', label: 'fixture', branch: 'fixture', current: true },
    loop: {
      stage: status === 'archived' ? 'done' : 'building',
      goalCycle: 1,
      iteration: 1,
      attempt: 1,
      nextAction: `继续 ${name}`,
      actor: 'builder',
    },
    acceptance: { total: 12, passed: 0, failed: 0, blocked: 0, pending: 12 },
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
    children: [] as Array<Record<string, unknown>>,
    artifacts: [],
    specs: {
      total: 0,
      create: 0,
      modify: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptanceItems: Array.from({ length: 12 }, (_, index) => ({
      id: `A${index + 1}`,
      source: 'brief.md',
      text: `检查验收条目 ${index + 1} 的实际结果。`,
      result: 'pending',
      reason: null,
    })),
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
  };
}

async function installExplorerFixture(
  page: Page,
  workflow: Workflow,
  { count = 40, withChild = false, failFirstAppend = false } = {},
) {
  const requests: PageRequest[] = [];
  const detailRequests: string[] = [];
  let failedAppend = false;
  const makeItems = (status: string) =>
    Array.from({ length: count }, (_, index) => {
      const name = `${workflow}-${status}-${index % 2 === 0 ? 'match' : 'other'}-${String(index + 1).padStart(2, '0')}`;
      return workflow === 'classic' ? classicChange(name, status) : nativeChange(name, status);
    });
  const active = makeItems('active');
  const archived = makeItems('archived');
  const child = nativeChange('native-child-match-01', 'active');
  if (withChild && workflow === 'native') {
    (active[0] as ReturnType<typeof nativeChange>).children = [
      {
        name: child.name,
        locator: child.locator,
        changeStatus: 'active',
        status: 'active',
        phase: 'build',
        dependsOn: [],
        covers: ['A1'],
        message: null,
        workspace: child.workspace,
      },
    ];
  }
  const dataset = (status: string, query = '') =>
    (status === 'all'
      ? [...active, ...archived]
      : status === 'archived'
        ? archived
        : active
    ).filter(
      (item) =>
        item.name.includes(query.toLowerCase()) ||
        ('children' in item &&
          item.children.some((child) => String(child.name).includes(query.toLowerCase()))),
    );
  const responsePage = (status: string, query: string, offset: number) => {
    const items = dataset(status, query);
    return {
      status,
      items: items.slice(offset, offset + 5),
      total: items.length,
      nextCursor:
        offset + 5 < items.length ? JSON.stringify({ status, query, offset: offset + 5 }) : null,
    };
  };
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'explorer-fixture',
          projects: [
            {
              id: 'explorer-fixture',
              name: 'Explorer fixture',
              path: '/fixture',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: workflow,
              workflowSource: 'configured',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      const initialChanges =
        workflow === 'classic'
          ? responsePage('active', url.searchParams.get('q') ?? '', 0)
          : { status: 'active', items: [], total: 0, nextCursor: null };
      await route.fulfill({
        json: {
          project: {
            name: 'Explorer fixture',
            path: '/fixture',
            generatedAt: '2026-10-10T00:00:00.000Z',
          },
          summary: {
            activeChanges: active.length,
            archivedChanges: archived.length,
            verifyFailed: 0,
            tasksIncomplete: 12,
            dirtyFiles: 0,
          },
          initialChanges,
          native: {
            schema: 'comet.dashboard.native.v2',
            generatedAt: '2026-10-10T00:00:00.000Z',
            activeChangeCount: workflow === 'native' ? active.length : 0,
            archivedChangeCount: workflow === 'native' ? archived.length : 0,
            totalChangeCount: workflow === 'native' ? active.length + archived.length : 0,
            visibleChangeCount: 0,
            omittedChangeCount: workflow === 'native' ? active.length + archived.length : 0,
            changesTruncated: workflow === 'native',
            changes: [],
          },
          git: {
            branch: 'fixture',
            head: 'abc1234',
            dirtyFiles: 0,
            dirtyFileList: [],
            recentCommits: [],
          },
          risks: [],
        },
      });
    } else if (url.pathname.endsWith('/changes') || url.pathname.endsWith('/native-changes')) {
      const requestWorkflow = url.pathname.endsWith('/native-changes') ? 'native' : 'classic';
      const status = url.searchParams.get('status') ?? 'active';
      const query = url.searchParams.get('q') ?? '';
      const cursor = url.searchParams.get('cursor');
      const cursorData = cursor
        ? (JSON.parse(cursor) as { status: string; query: string; offset: number })
        : { status, query, offset: 0 };
      const offset = cursorData.offset;
      const limit = Number(url.searchParams.get('limit'));
      requests.push({ workflow: requestWorkflow, status, query, offset, limit, cursor });
      if (cursorData.status !== status || cursorData.query !== query) {
        await route.fulfill({
          status: 400,
          json: { error: '分页 cursor 与当前搜索或筛选不匹配。' },
        });
        return;
      }
      if (requestWorkflow === workflow && offset > 0 && failFirstAppend && !failedAppend) {
        failedAppend = true;
        await route.fulfill({ status: 503, json: { error: '分页暂时不可用，请重新滚动重试。' } });
        return;
      }
      await route.fulfill({
        json:
          requestWorkflow === workflow
            ? responsePage(status, query, offset)
            : { status, items: [], total: 0, nextCursor: null },
      });
    } else if (url.pathname.endsWith('/change') || url.pathname.endsWith('/native-change')) {
      const locator = url.searchParams.get('changeLocator') ?? url.searchParams.get('changeId');
      const name = locator ?? url.searchParams.get('changeName');
      detailRequests.push(name ?? '');
      await route.fulfill({
        json: [...active, ...archived, child].find((item) => item.locator === name) ?? active[0],
      });
    } else if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({ json: { pages: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  return { requests, detailRequests, active, child };
}

function explorerLocators(page: Page, workflow: Workflow) {
  const explorer = page.locator(`.${workflow}-changes-explorer`);
  const list = explorer.locator(
    workflow === 'classic' ? '.dashboard-change-list:visible' : '.native-change-list',
  );
  const rows = list.locator(
    workflow === 'classic' ? '.dashboard-change-row' : '.native-change-row',
  );
  return { explorer, list, rows };
}

async function waitForFilledList(list: Locator, rows: Locator, total: number) {
  await expect.poll(() => rows.count()).toBeGreaterThan(5);
  await expect
    .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
    .toBe(true);
  const loaded = await rows.count();
  expect(loaded).toBeLessThan(total);
  expect(loaded % 5).toBe(0);
  await expect(list.locator('[aria-busy=true]')).toHaveCount(0);
  await list.page().waitForTimeout(350);
  await expect(rows).toHaveCount(loaded);
  return loaded;
}

async function expectOnlyListScrolls(explorer: Locator, list: Locator) {
  const scrollRoots = await explorer.evaluate((element) =>
    [element.parentElement!, element, ...element.querySelectorAll<HTMLElement>('*')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) &&
          node.scrollHeight > node.clientHeight + 1
        );
      })
      .map((node) => node.className),
  );
  expect(scrollRoots).toHaveLength(1);
  expect(scrollRoots[0]).toMatch(/dashboard-change-list|native-change-list/);
  await expect(list).toHaveCSS('overflow-y', 'auto');
  await expect(list).toHaveCSS('overscroll-behavior-y', 'auto');
  await expect(list).toHaveCSS('padding-left', '4px');
  await expect(list).toHaveCSS('padding-right', '4px');
  expect(await explorer.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await explorer.locator('..').evaluate((element) => element.scrollTop)).toBe(0);
}

async function revealList(page: Page, list: Locator) {
  await list.evaluate((element) => {
    window.scrollTo(0, Math.max(0, window.scrollY + element.getBoundingClientRect().top - 180));
  });
  const box = await list.boundingBox();
  if (!box) throw new Error('Explorer 列表没有可测量的位置');
  await page.mouse.move(
    box.x + box.width / 2,
    Math.max(120, box.y + Math.min(box.height / 2, 100)),
  );
}

async function fillAllRows(rows: Locator, list: Locator, total: number) {
  for (let attempt = 0; attempt < Math.ceil(total / 5); attempt += 1) {
    const previous = await rows.count();
    if (previous === total) break;
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => rows.count()).toBeGreaterThan(previous);
  }
  await expect(rows).toHaveCount(total);
}

for (const workflow of ['classic', 'native'] as const) {
  test(`${workflow} Explorer moves with detail during page scrolling and keeps list scrolling independent`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = await installExplorerFixture(page, workflow);
    // 固定验收统计，单独验证分页不会改变页面和列表的滚动位置。
    if (workflow === 'native') {
      for (const item of fixture.active as ReturnType<typeof nativeChange>[]) {
        item.acceptance = { ...item.acceptance, passed: item.acceptance.total, pending: 0 };
        item.acceptanceItems = item.acceptanceItems.map((entry) => ({
          ...entry,
          result: 'passed',
        }));
      }
    }
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const { explorer, list, rows } = explorerLocators(page, workflow);
      if (width > 760) await waitForFilledList(list, rows, fixture.active.length);
      else await expect(rows).toHaveCount(5);
      await expectOnlyListScrolls(explorer, list);
      await expect(explorer.locator('..')).toHaveCSS('position', 'static');
      await page.evaluate(() => window.scrollTo(0, 0));
      const beforePage = {
        left: await explorer.boundingBox(),
        right: await page.locator('.dashboard-workspace-center').boundingBox(),
      };
      const pageScroll = await page.evaluate(() => {
        const target = Math.min(300, document.documentElement.scrollHeight - innerHeight);
        window.scrollTo(0, target);
        return target;
      });
      expect(pageScroll).toBeGreaterThan(0);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(pageScroll);
      const afterPage = {
        left: await explorer.boundingBox(),
        right: await page.locator('.dashboard-workspace-center').boundingBox(),
      };
      if (!beforePage.left || !beforePage.right || !afterPage.left || !afterPage.right)
        throw new Error('左右工作区没有可测量的位置');
      const leftDelta = beforePage.left.y - afterPage.left.y;
      const rightDelta = beforePage.right.y - afterPage.right.y;
      expect(Math.abs(leftDelta - pageScroll)).toBeLessThanOrEqual(1);
      expect(Math.abs(rightDelta - pageScroll)).toBeLessThanOrEqual(1);
      expect(Math.abs(leftDelta - rightDelta)).toBeLessThanOrEqual(1);
      const title = explorer.locator('.dashboard-explorer-title');
      const tabs = explorer.locator('.ant-tabs-nav');
      const beforeList = {
        title: await title.boundingBox(),
        tabs: await tabs.boundingBox(),
        loaded: await rows.count(),
      };
      const requestedScrollTop = await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
      });
      expect(requestedScrollTop).toBeGreaterThan(0);
      await expect(rows).toHaveCount(beforeList.loaded + 5);
      expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(
        requestedScrollTop,
      );
      expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
      expect(await title.boundingBox()).toEqual(beforeList.title);
      expect(await tabs.boundingBox()).toEqual(beforeList.tabs);
      expect(await explorer.boundingBox()).toEqual(afterPage.left);
      expect(await page.locator('.dashboard-workspace-center').boundingBox()).toEqual(
        afterPage.right,
      );
    }
  });

  test(`${workflow} Explorer fills from five-item API pages, fixes its header, and loads only near the list bottom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = await installExplorerFixture(page, workflow);
    await page.goto('/');
    const { explorer, list, rows } = explorerLocators(page, workflow);
    const loaded = await waitForFilledList(list, rows, fixture.active.length);
    await expectOnlyListScrolls(explorer, list);
    const pageRequests = fixture.requests.filter((request) => request.workflow === workflow);
    expect(pageRequests.map((request) => request.offset)).toEqual(
      Array.from(
        { length: loaded / 5 - (workflow === 'classic' ? 1 : 0) },
        (_, index) => (index + (workflow === 'classic' ? 1 : 0)) * 5,
      ),
    );
    for (const request of pageRequests) {
      expect(request.limit).toBe(5);
      expect(request.offset % 5).toBe(0);
    }
    await expect(rows.first()).toHaveCSS('height', '44px');
    const title = explorer.locator('.dashboard-explorer-title');
    const tabs = explorer.locator('.ant-tabs-nav');
    const before = {
      title: await title.boundingBox(),
      tabs: await tabs.boundingBox(),
      page: await page.evaluate(() => scrollY),
    };
    const spacing = await explorer.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const title = element.querySelector('.dashboard-explorer-title')!.getBoundingClientRect();
      const tab = element.querySelector('.ant-tabs-tab')!.getBoundingClientRect();
      return {
        title: title.left - bounds.left - element.clientLeft,
        tabs: tab.left - bounds.left - element.clientLeft,
      };
    });
    expect(Math.abs(spacing.title - 12)).toBeLessThanOrEqual(1);
    expect(Math.abs(spacing.tabs - 12)).toBeLessThanOrEqual(1);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => rows.count()).toBe(loaded + 5);
    await expect(title).toHaveText(/Changes Explorer/);
    expect(await title.boundingBox()).toEqual(before.title);
    expect(await tabs.boundingBox()).toEqual(before.tabs);
    expect(await page.evaluate(() => scrollY)).toBe(before.page);
    await page.waitForTimeout(350);
    await expect(rows).toHaveCount(loaded + 5);
    expect(fixture.requests.filter((request) => request.workflow === workflow).at(-1)?.offset).toBe(
      loaded,
    );
  });

  test(`${workflow} Explorer preserves ordinary selection positions and resets its list for query and tab changes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = await installExplorerFixture(page, workflow, {
      count: workflow === 'native' ? 80 : 40,
    });
    await page.goto('/');
    const { explorer, list, rows } = explorerLocators(page, workflow);
    const initiallyLoaded = await waitForFilledList(list, rows, fixture.active.length);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(rows).toHaveCount(initiallyLoaded + 5);
    expect(await rows.count()).toBeLessThan(fixture.active.length);
    await revealList(page, list);
    await list.evaluate((element) => {
      element.scrollTop = 88;
    });
    const row = rows.nth(3);
    const name = await row.locator('.dashboard-explorer-row-name').innerText();
    const before = {
      list: await list.evaluate((element) => element.scrollTop),
      page: await page.evaluate(() => scrollY),
    };
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.dashboard-change-detail-title')).toContainText(name);
    expect(await list.evaluate((element) => element.scrollTop)).toBe(before.list);
    expect(await page.evaluate(() => scrollY)).toBe(before.page);
    const requestsBeforeQuery = fixture.requests.length;
    await page.getByPlaceholder('搜索变更、产物或文件…').fill('match');
    await expect
      .poll(() =>
        fixture.requests.some(
          (request) => request.workflow === workflow && request.query === 'match',
        ),
      )
      .toBe(true);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
    const queryTotal = fixture.active.filter((item) => item.name.includes('match')).length;
    await waitForFilledList(list, rows, queryTotal);
    expect(
      fixture.requests.slice(requestsBeforeQuery).find((request) => request.workflow === workflow),
    ).toMatchObject({ query: 'match', offset: 0, limit: 5 });
    await expect(list).not.toContainText(`${workflow}-active-other`);
    await list.evaluate((element) => {
      element.scrollTop = 88;
    });
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await explorer.getByRole('tab', { name: '已归档', exact: true }).click();
    await expect(rows.first()).toContainText(`${workflow}-archived-match-01`);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
    await waitForFilledList(list, rows, queryTotal);
    await expectOnlyListScrolls(explorer, list);
  });

  test(`${workflow} Explorer has one narrow-screen list scroll and passes wheel input to the page at both boundaries`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = await installExplorerFixture(page, workflow, { count: 20 });
    await page.goto('/');
    const { explorer, list, rows } = explorerLocators(page, workflow);
    await expect(rows).toHaveCount(5);
    await expect
      .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
      .toBe(true);
    await page.waitForTimeout(350);
    await expect(rows).toHaveCount(5);
    expect(
      fixture.requests
        .filter((request) => request.workflow === workflow)
        .map((request) => [request.offset, request.limit]),
    ).toEqual(workflow === 'classic' ? [] : [[0, 5]]);
    await fillAllRows(rows, list, fixture.active.length);
    await expectOnlyListScrolls(explorer, list);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await revealList(page, list);
    const pageStart = await page.evaluate(() => scrollY);
    expect(pageStart).toBeGreaterThan(0);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const listBottom = await list.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, 180);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(pageStart);
    expect(await list.evaluate((element) => element.scrollTop)).toBe(listBottom);
    await revealList(page, list);
    await list.evaluate((element) => {
      element.scrollTop = 0;
    });
    const beforeUp = await page.evaluate(() => scrollY);
    expect(beforeUp).toBeGreaterThan(0);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(beforeUp);
    expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
  });

  for (const failureStage of ['initial-fill', 'near-bottom'] as const) {
    test(`${workflow} Explorer retries ${failureStage} pagination failures only after another user scroll`, async ({
      page,
    }) => {
      const initialFill = failureStage === 'initial-fill';
      await page.setViewportSize({
        width: initialFill ? 1600 : 390,
        height: initialFill ? 900 : 844,
      });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fixture = await installExplorerFixture(page, workflow, { failFirstAppend: true });
      await page.goto('/');
      const { list, rows } = explorerLocators(page, workflow);
      const appendRequests = () =>
        fixture.requests.filter((request) => request.workflow === workflow && request.offset > 0);
      await expect(rows).toHaveCount(5);
      if (!initialFill) {
        await expect
          .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight))
          .toBe(true);
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      }
      await expect.poll(() => appendRequests().length).toBe(1);
      await expect(page.getByText(/变更列表加载失败/)).toBeVisible();
      expect(appendRequests()[0]).toMatchObject({ offset: 5, limit: 5 });
      if (initialFill) {
        expect(
          await list.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        ).toBe(true);
        await page.setViewportSize({ width: 1600, height: 910 });
      }
      await page.waitForTimeout(350);
      expect(appendRequests()).toHaveLength(1);
      await expect(rows).toHaveCount(5);
      if (initialFill) {
        await revealList(page, list);
        await page.mouse.wheel(0, 4);
      } else {
        await list.evaluate((element) => {
          element.scrollTop = Math.max(1, element.scrollTop - 2);
        });
      }
      await expect
        .poll(() => appendRequests().filter((request) => request.offset === 5).length)
        .toBe(2);
      await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(10);
      if (initialFill) {
        await expect
          .poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
          .toBe(true);
      } else {
        await expect(rows).toHaveCount(10);
      }
      expect(
        appendRequests()
          .slice(0, 2)
          .map((request) => [request.offset, request.limit]),
      ).toEqual([
        [5, 5],
        [5, 5],
      ]);
      expect(appendRequests()[1].cursor).toBe(appendRequests()[0].cursor);
      await page.waitForTimeout(350);
      expect(appendRequests().filter((request) => request.offset === 5)).toHaveLength(2);
      const names = await rows.locator('.dashboard-explorer-row-name').allTextContents();
      expect(names).toEqual(fixture.active.slice(0, names.length).map((item) => item.name));
    });
  }
}

test('Native Explorer preserves its search query and continues paging after a refreshed first page changes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await installExplorerFixture(page, 'native', { count: 80 });
  const queryTotal = fixture.active.filter((item) => item.name.includes('match')).length;
  await page.goto('/');
  const { explorer, list, rows } = explorerLocators(page, 'native');
  await waitForFilledList(list, rows, fixture.active.length);
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('match');
  await expect
    .poll(() =>
      fixture.requests.some(
        (request) =>
          request.workflow === 'native' && request.query === 'match' && request.offset === 0,
      ),
    )
    .toBe(true);
  await waitForFilledList(list, rows, queryTotal);
  await expect(list).not.toContainText('native-active-other');
  const refreshed = nativeChange('native-active-match-refreshed', 'active');
  fixture.active.unshift(refreshed);
  const requestStart = fixture.requests.length;
  const refreshedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith('/native-changes') &&
      url.searchParams.get('q') === 'match' &&
      !url.searchParams.has('cursor')
    );
  });
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await refreshedResponse;
  await expect(rows.first()).toContainText(refreshed.name);
  const loaded = await waitForFilledList(list, rows, queryTotal + 1);
  const refreshRequests = fixture.requests
    .slice(requestStart)
    .filter((request) => request.workflow === 'native');
  expect(refreshRequests.map((request) => [request.query, request.offset, request.limit])).toEqual(
    Array.from({ length: loaded / 5 }, (_, index) => ['match', index * 5, 5]),
  );
  await expect(explorer.locator('.native-changes-count .ant-scroll-number')).toHaveAttribute(
    'title',
    String(queryTotal + 1),
  );
  await expect(list).not.toContainText('native-active-other');
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rows).toHaveCount(loaded + 5);
  expect(fixture.requests.at(-1)).toMatchObject({
    workflow: 'native',
    query: 'match',
    offset: loaded,
    limit: 5,
  });
});

test('Native Explorer selects the visible parent when its selected child is collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await installExplorerFixture(page, 'native', { count: 80, withChild: true });
  await page.goto('/');
  const { explorer, list, rows } = explorerLocators(page, 'native');
  await waitForFilledList(list, rows, fixture.active.length);
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('match');
  await expect
    .poll(() =>
      fixture.requests.some(
        (request) =>
          request.workflow === 'native' && request.query === 'match' && request.offset === 0,
      ),
    )
    .toBe(true);
  await waitForFilledList(
    list,
    rows,
    fixture.active.filter((item) => item.name.includes('match')).length,
  );
  const parent = rows.first();
  const child = list.locator('.native-child-change-row').filter({ hasText: fixture.child.name });
  await expect(child).toBeVisible();
  await child.click();
  await expect(child).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dashboard-change-detail-title')).toContainText(fixture.child.name);
  await explorer.getByRole('button', { name: `收起 ${fixture.active[0].name} 的子变更` }).click();
  await expect(child).toBeHidden();
  await expect(parent).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('[aria-pressed=true]')).toHaveCount(1);
  await expect(parent).toBeInViewport();
  await expect(page.locator('.dashboard-change-detail-title')).toContainText(
    fixture.active[0].name,
  );
  expect(fixture.detailRequests.at(-1)).toBe(fixture.active[0].locator);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(child).toBeHidden();
  const loaded = await rows.count();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(rows).toHaveCount(loaded + 5);
  await expect(child).toBeHidden();
  await expect(
    explorer.getByRole('button', { name: `展开 ${fixture.active[0].name} 的子变更` }),
  ).toHaveAttribute('aria-expanded', 'false');
});

test('Explorer keeps rounded compact rows and accessible folder expansion across workflows, widths, and themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const expectRowShape = async (row: Locator) => {
    await expect(row).toHaveCSS('height', '44px');
    await expect(row).toHaveCSS('border-radius', '6px');
    await expect(row).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  };

  for (const workflow of ['classic', 'native'] as const) {
    await page.unroute('**/api/dashboard/**');
    const fixture = await installExplorerFixture(page, workflow, { count: 5, withChild: true });
    for (const width of [1600, 390]) {
      for (const theme of ['light', 'dark'] as const) {
        await test.step(`${workflow}, ${width}px, ${theme}`, async () => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto('/');
          if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
            await page
              .getByRole('button', {
                name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
                exact: true,
              })
              .click();
          }
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          const { list, rows } = explorerLocators(page, workflow);
          await expect(rows).toHaveCount(5);
          const leaf = rows.nth(1);
          await expect(leaf).toHaveAttribute('aria-pressed', 'false');
          await leaf.hover();
          await expectRowShape(leaf);
          await leaf.click();
          await expect(leaf).toHaveAttribute('aria-pressed', 'true');
          await page.mouse.move(0, 0);
          await expectRowShape(leaf);
          await expect(leaf).not.toHaveAttribute('aria-expanded');
          await expect(leaf.locator('.dashboard-explorer-folder-stack')).toHaveCount(0);
          await expect(leaf.locator('.anticon-folder')).toHaveCount(1);

          if (workflow === 'native') {
            const parent = rows.first();
            const disclosure = parent.locator('..').locator('button.native-change-disclosure');
            const stack = disclosure.locator('.dashboard-explorer-folder-stack');
            const child = list
              .locator('.native-child-change-row')
              .filter({ hasText: fixture.child.name });
            await expect(disclosure).toHaveAttribute('type', 'button');
            await expect(disclosure).toHaveAttribute(
              'aria-label',
              `收起 ${fixture.active[0].name} 的子变更`,
            );
            await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
            await expect(disclosure).toHaveCSS('height', '44px');
            await expect(disclosure).toHaveCSS('width', '22px');
            await expect(disclosure.locator('.anticon-down, .anticon-right')).toHaveCount(0);
            await expect(stack).toHaveAttribute('data-folder-state', 'expanded');
            await expect(stack.locator('svg')).toHaveCount(2);
            await expect(stack.locator('.anticon-folder')).toHaveCount(1);
            await expect(stack.locator('.anticon-folder-open')).toHaveCount(1);
            const overlap = await stack.evaluate((element) => {
              const [back, front] = Array.from(element.querySelectorAll('svg'), (icon) =>
                icon.getBoundingClientRect(),
              );
              return (
                Math.min(back.right, front.right) > Math.max(back.left, front.left) &&
                Math.min(back.bottom, front.bottom) > Math.max(back.top, front.top)
              );
            });
            expect(overlap).toBe(true);
            const rowWidth = await parent.evaluate((element) => ({
              row: element.getBoundingClientRect().width,
              shell: element.closest('.native-change-row-shell')!.getBoundingClientRect().width,
            }));
            expect(Math.abs(rowWidth.row - rowWidth.shell)).toBeLessThanOrEqual(1);
            await expect(parent).not.toHaveAttribute('aria-expanded');
            await expect(parent.locator('.dashboard-explorer-row-icon')).toHaveCount(0);
            await expect(child).toBeVisible();
            await expect(child).not.toHaveAttribute('aria-expanded');
            await expect(child.locator('.dashboard-explorer-folder-stack')).toHaveCount(0);
            await expect(child.locator('.anticon-folder')).toHaveCount(1);
            await child.click();
            await expect(child).toHaveAttribute('aria-pressed', 'true');
            await expectRowShape(child);
            await expect(page.locator('.dashboard-change-detail-title')).toContainText(
              fixture.child.name,
            );
            await disclosure.focus();
            await disclosure.press('Enter');
            await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
            await expect(disclosure).toHaveAttribute(
              'aria-label',
              `展开 ${fixture.active[0].name} 的子变更`,
            );
            await expect(disclosure).toBeFocused();
            await expect(stack).toHaveAttribute('data-folder-state', 'collapsed');
            await expect(stack.locator('.anticon-folder')).toHaveCount(2);
            await expect(stack.locator('.anticon-folder-open')).toHaveCount(0);
            await expect(child).toBeHidden();
            await expect(parent).toHaveAttribute('aria-pressed', 'true');
            await expectRowShape(parent);
            await expect(list.locator('[aria-pressed=true]')).toHaveCount(1);
            await expect(page.locator('.dashboard-change-detail-title')).toContainText(
              fixture.active[0].name,
            );
            await disclosure.press('Space');
            await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
            await expect(disclosure).toHaveAttribute(
              'aria-label',
              `收起 ${fixture.active[0].name} 的子变更`,
            );
            await expect(disclosure).toBeFocused();
            await expect(stack).toHaveAttribute('data-folder-state', 'expanded');
            await expect(stack.locator('.anticon-folder-open')).toHaveCount(1);
            await expect(child).toBeVisible();
            await expect(parent).toHaveAttribute('aria-pressed', 'true');
          }
        });
      }
    }
  }
});

// 预期文案对照 0fd42a0 的 Explorer 第二行 JSX，包含旧模板的异常值显示。
for (const workflow of ['classic', 'native'] as const) {
  test(`${workflow} Explorer second-line matches 0fd42a0 across layouts and themes`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture = await installExplorerFixture(page, workflow, { count: 5, withChild: true });
    let expected: string[];
    const longWorkspace = '需要完整保留的子变更工作区名称。'.repeat(12);
    const expectedChildren = [
      'Build · fixture',
      'custom-child-phase · 外部工作区',
      '等待前置子任务完成 · ' + longWorkspace,
      '等待开始执行',
      '正在执行',
      '执行完成',
      '验收通过',
      '已合入集成分支',
      '归档完成',
      '等待重新验收',
      '等待解除阻塞',
      '阶段信息不可用',
    ];
    if (workflow === 'classic') {
      const items = fixture.active as Array<ReturnType<typeof classicChange>>;
      items[0].phase = 'archive';
      items[0].tasks.completed = 3;
      items[0].tasks.total = 3;
      items[1].phase = 'verify';
      items[1].artifacts.tasks = false;
      items[1].tasks.total = 0;
      items[2].tasks.total = 0;
      Object.assign(items[3], {
        phase: 'custom-classic-phase',
        tasks: { completed: -1, total: 2.5, sections: [], incomplete: [] },
      });
      Object.assign(items[4], {
        phase: null,
        tasks: { completed: null, total: undefined, sections: [], incomplete: [] },
      });
      expected = [
        '归档 · 3/3',
        '验证 · 0/0',
        '构建 · 0/0',
        'custom-classic-phase · -1/2.5',
        '未知 · /',
      ];
    } else {
      const items = fixture.active as Array<ReturnType<typeof nativeChange>>;
      items[0].loop.iteration = 2;
      items[0].loop.attempt = 3;
      items[0].children = expectedChildren.map((_, index) => ({
        name: `native-description-child-${index}`,
        locator: `native-description-child-${index}`,
        changeStatus: 'active',
        status: [
          'active',
          'active',
          'pending',
          'ready',
          'active',
          'done',
          'verified',
          'integrated',
          'archived',
          'needs-reverify',
          'blocked',
          'custom-status',
        ][index],
        phase: index === 0 ? 'build' : index === 1 ? 'custom-child-phase' : null,
        workspace:
          index === 0
            ? { label: 'fixture' }
            : index === 1
              ? { label: '外部工作区' }
              : index === 2
                ? { label: longWorkspace }
                : index === 3
                  ? { label: '' }
                  : null,
        loop: { stage: 'building', iteration: 9, attempt: 7 },
      }));
      items[1].phase = 'verify';
      items[1].loop.stage = 'verify-ready';
      items[1].loop.iteration = 3;
      items[1].loop.attempt = 2;
      Object.assign(items[2], { phase: 'shape', loop: null });
      Object.assign(items[3], {
        phase: 'custom-native-phase',
        loop: { stage: 'custom-loop-stage', iteration: null },
      });
      Object.assign(items[4], {
        phase: null,
        loop: { stage: null, iteration: 0, attempt: -1 },
      });
      expected = [
        'Build · 4/12 子变更',
        'Verify · 等待验证 · 第3轮/第2次',
        'Shape',
        '状态异常 · undefined · 第null轮/第undefined次',
        '状态异常 · undefined · 第0轮/第-1次',
      ];
    }
    for (const width of [1600, 390]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('/');
        if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
          await page.getByRole('button', { name: /切换到.*色模式/ }).click();
        }
        const { rows, list } = explorerLocators(page, workflow);
        await expect(rows).toHaveCount(5);
        const descriptions = rows.locator('.dashboard-explorer-row-count');
        await expect(descriptions).toHaveText(expected);
        for (const [index, text] of expected.entries()) {
          await rows.nth(index).hover();
          const tooltip = page.getByRole('tooltip').filter({ hasText: fixture.active[index].name });
          await expect(tooltip.getByText(text, { exact: true })).toHaveText(text);
          await page.mouse.move(0, 0);
          await rows.nth(index).focus();
          await expect(tooltip.getByText(text, { exact: true })).toHaveText(text);
          await rows.nth(index).blur();
        }
        if (workflow === 'native') {
          const childRows = list.locator('.native-child-change-row');
          await expect(childRows.locator('.dashboard-explorer-row-count')).toHaveText(
            expectedChildren,
          );
          for (const row of await childRows.all()) {
            await expect(row).toHaveCSS('height', '44px');
            await expect(row.locator('.dashboard-explorer-row-count')).toHaveCSS(
              'font-size',
              '12px',
            );
          }
          const child = childRows.nth(2);
          const longDescription = child.locator('.dashboard-explorer-row-count');
          await expect(longDescription).toHaveCSS('white-space', 'nowrap');
          await expect(longDescription).toHaveCSS('text-overflow', 'ellipsis');
          expect(
            await longDescription.evaluate((element) => element.scrollWidth > element.clientWidth),
          ).toBe(true);
          await child.hover();
          const tooltip = page
            .getByRole('tooltip')
            .filter({ hasText: 'native-description-child-2' });
          await expect(tooltip.getByText(expectedChildren[2], { exact: true })).toHaveText(
            expectedChildren[2],
          );
          await page.mouse.move(0, 0);
          await child.focus();
          await expect(tooltip.getByText(expectedChildren[2], { exact: true })).toHaveText(
            expectedChildren[2],
          );
          await child.blur();
          await rows.nth(1).press('Enter');
          await expect(rows.nth(1)).toHaveAttribute('aria-pressed', 'true');
        }
        for (const row of await rows.all()) await expect(row).toHaveCSS('height', '44px');
        for (const description of await descriptions.all())
          await expect(description).toHaveCSS('font-size', '12px');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
        await page.screenshot({
          path: test.info().outputPath(`${workflow}-descriptions-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  });
}

test('Explorer keeps the old empty phase and malformed value display conditions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const classic = await installExplorerFixture(page, 'classic', { count: 5 });
  const classicItems = classic.active as Array<ReturnType<typeof classicChange>>;
  Object.assign(classicItems[1], {
    phase: '',
    tasks: { completed: '02', total: '4', sections: [], incomplete: [] },
  });
  Object.assign(classicItems[2], {
    status: 'archived',
    phase: undefined,
    tasks: { completed: undefined, total: null, sections: [], incomplete: [] },
  });
  Object.assign(classicItems[3], {
    tasks: { completed: 4, total: 2, sections: [], incomplete: [] },
  });
  await page.goto('/');
  const classicDescriptions = explorerLocators(page, 'classic').rows.locator(
    '.dashboard-explorer-row-count',
  );
  await expect(classicDescriptions.nth(1)).toHaveText(' · 02/4');
  await expect(classicDescriptions.nth(2)).toHaveText('未知 · /');
  await expect(classicDescriptions.nth(3)).toHaveText('构建 · 4/2');

  await page.unroute('**/api/dashboard/**');
  const native = await installExplorerFixture(page, 'native', { count: 5, withChild: true });
  const items = native.active as Array<ReturnType<typeof nativeChange>>;
  Object.assign(items[0], { phase: 'unknown-parent', loop: null });
  items[0].children = [
    { name: 'empty-child', phase: '', status: 'pending', workspace: { label: '' } },
    { name: 'undefined-child', status: 'unknown' },
  ];
  Object.assign(items[1], {
    phase: 'build',
    loop: { stage: 'building', iteration: 2, attempt: 1 },
  });
  Object.assign(items[2], { phase: null, loop: null });
  Object.assign(items[3], { phase: 'build', loop: {} });
  Object.assign(items[4], {
    phase: '',
    loop: { stage: 'repairing', iteration: 1.5, attempt: 'retry' },
  });
  await page.goto('/');
  const { rows, list } = explorerLocators(page, 'native');
  await expect(rows.locator('.dashboard-explorer-row-count')).toHaveText([
    '状态异常 · 0/2 子变更',
    'Build · 构建中 · 第2轮/第1次',
    '状态异常',
    'Build · undefined · 第undefined轮/第undefined次',
    '状态异常 · 修复中 · 第1.5轮/第retry次',
  ]);
  await expect(list.locator('.native-child-change-row .dashboard-explorer-row-count')).toHaveText([
    '等待前置子任务完成',
    '阶段信息不可用',
  ]);
});

test('Native Explorer retains count animation with the original parent description', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const fixture = await installExplorerFixture(page, 'native', { count: 5, withChild: true });
  const parent = fixture.active[0] as ReturnType<typeof nativeChange>;
  parent.children = Array.from({ length: 12 }, (_, index) => ({
    name: `animated-child-${index}`,
    status: 'active',
  }));
  await page.goto('/');
  const description = explorerLocators(page, 'native')
    .rows.first()
    .locator('.dashboard-explorer-row-count');
  await expect(description).toHaveText('Build · 0/12 子变更');
  for (const child of parent.children) child.status = 'done';
  const frames = description.evaluate(async (element) => {
    const text: string[] = [];
    const started = performance.now();
    do {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      text.push(element.textContent ?? '');
    } while (performance.now() - started < 700);
    return text;
  });
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(description).toHaveText('Build · 12/12 子变更');
  const captured = await frames;
  expect(captured.some((text) => /^Build · ([1-9]|1[01])\/12 子变更$/.test(text))).toBe(true);
  expect(captured.every((text) => /^Build · \d+\/12 子变更$/.test(text))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const child of parent.children) child.status = 'active';
  await page.getByRole('button', { name: '立即刷新' }).click();
  await expect(description).toHaveText('Build · 0/12 子变更');

  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
  await expect(
    page.locator('.native-change-row').first().locator('.dashboard-explorer-row-count'),
  ).toHaveText('Build · 1/3 子变更');
  await page.screenshot({ path: test.info().outputPath('explorer-restored-native-demo.png') });
});
