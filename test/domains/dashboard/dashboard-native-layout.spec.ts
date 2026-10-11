import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_SNAPSHOT } from '../../../domains/dashboard/web/demo.js';

test('aligns four Native tabs, full-width detail Git and one recovery card across themes and viewports', async ({
  page,
}, testInfo) => {
  await page.goto('/?demo');
  await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
  const detail = page.locator('.native-change-detail');
  const context = page.locator('.native-project-context');
  await expect(context.locator(':scope > *')).toHaveCount(1);
  await expect(context.locator('h4')).toHaveText(['执行与恢复']);
  await expect(detail.locator('.native-progress-details')).toContainText('Goal cycle');
  await expect(detail.getByRole('tab')).toHaveText([
    '变更详情',
    '验收状态',
    '当前阻塞',
    '执行历史',
  ]);
  await expect(detail.getByRole('tab', { name: '变更详情', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await expect(detail.locator('h4')).toHaveText(['验收状态', '检查结果']);
  await expect(detail.locator('.native-recovery-status, .native-blockers-card')).toHaveCount(0);

  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.getByRole('button', { name: /切换到.*色模式/ }).click();
    }
    for (const width of [1600, 1280, 1100, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const currentTab of ['变更详情', '验收状态', '当前阻塞', '执行历史']) {
        await detail.getByRole('tab', { name: new RegExp(`${currentTab}$`) }).click();
        await expectNativeSharedFrame(page);
        const layout = await page.evaluate((currentTab) => {
          const box = (selector: string) => {
            const element = document.querySelector(selector)!;
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
            };
          };
          const cards = Array.from(document.querySelectorAll('.native-project-context > *'));
          return {
            shell: box('.native-change-shell'),
            left: box('.native-change-shell .dashboard-workspace-left'),
            explorer: box('.native-changes-explorer'),
            detail: box('.native-change-detail'),
            phase: box('.native-change-detail .dashboard-phase-progress'),
            context: box('.native-project-context'),
            tabContent: {
              nav: box('.native-detail-tabs > .ant-tabs-nav'),
              card: box('.native-detail-tabs [role="tabpanel"] article'),
              title: box('.native-detail-tabs [role="tabpanel"] article h4'),
            },
            acceptance:
              currentTab === '验收状态'
                ? {
                    progress: box('.native-acceptance-progress'),
                    note: box('.native-acceptance-note'),
                    metrics: box('.native-acceptance-metrics'),
                    items: box('.native-acceptance-card > .native-expanded-list'),
                    card: box('.native-acceptance-card'),
                    checks: box('.native-verification-card'),
                  }
                : null,
            source:
              currentTab === '变更详情'
                ? {
                    frame: box('.native-detail-source'),
                    artifacts: box('.native-artifacts-card'),
                    scope: box('.native-scope-card'),
                    git: box('.native-detail-project-git'),
                  }
                : null,
            first: box('.dashboard-summary-card:first-child'),
            fourth: box('.dashboard-summary-card:nth-child(4)'),
            fifth: box('.dashboard-summary-card:nth-child(5)'),
            cards: cards.map((element) => {
              const rect = element.getBoundingClientRect();
              return { x: rect.x, width: rect.width, y: rect.y, bottom: rect.bottom };
            }),
            overflow: document.documentElement.scrollWidth > innerWidth,
            backgrounds: ['.native-change-shell', '.native-recovery-status > section'].map(
              (selector) => getComputedStyle(document.querySelector(selector)!).backgroundColor,
            ),
          };
        }, currentTab);
        expect(layout.overflow).toBe(false);
        expect(layout.shell.x).toBe(width <= 760 ? 16 : 32);
        expect(layout.explorer.x).toBe(layout.shell.x + 1);
        expect(new Set(layout.backgrounds).size).toBe(1);
        for (const card of layout.cards) {
          expect(card.x).toBeCloseTo(layout.context.x, 0);
          expect(card.width).toBeCloseTo(layout.context.width, 0);
        }
        expect(layout.cards).toHaveLength(1);
        await expect(context.locator('.dashboard-project-git')).toHaveCount(0);
        await expect(detail.locator('.dashboard-project-git')).toHaveCount(
          currentTab === '变更详情' ? 1 : 0,
        );
        expect(layout.tabContent.card.y - layout.tabContent.nav.bottom).toBeCloseTo(18, 1);
        const titleInset = layout.tabContent.title.y - layout.tabContent.card.y;
        if (currentTab === '变更详情') {
          expect(titleInset).toBeCloseTo(17, 1);
        } else {
          expect(titleInset).toBeGreaterThanOrEqual(0);
          expect(titleInset).toBeLessThanOrEqual(1);
        }
        if (layout.source) {
          const { frame, artifacts, scope, git } = layout.source;
          if (frame.width >= 480 && width > 760) {
            expect(artifacts.y).toBeCloseTo(scope.y, 0);
            expect(scope.x - artifacts.right).toBeCloseTo(18, 0);
          } else {
            expect(artifacts.width).toBeCloseTo(frame.width, 0);
            expect(scope.y - artifacts.bottom).toBeCloseTo(18, 0);
          }
          expect(git.width).toBeCloseTo(frame.width, 0);
          expect(git.y - Math.max(artifacts.bottom, scope.bottom)).toBeCloseTo(18, 0);
          for (const card of [
            '.native-artifacts-card',
            '.native-scope-card',
            '.native-detail-project-git article',
          ]) {
            await expect(detail.locator(card)).toHaveCSS('padding', '16px');
            await expect(detail.locator(card)).toHaveCSS('border-width', '1px');
          }
        }
        if (layout.acceptance) {
          const { progress, note, metrics, items, card, checks } = layout.acceptance;
          expect(note.y - progress.bottom).toBeCloseTo(8, 0);
          expect(metrics.y - note.bottom).toBeCloseTo(16, 0);
          expect(items.y - metrics.bottom).toBeCloseTo(16, 0);
          expect(checks.y).toBeGreaterThanOrEqual(card.bottom);
        }
        if (width >= 1280) {
          expect(Math.abs(layout.left.right - layout.first.right)).toBeLessThanOrEqual(1);
          expect(layout.shell.right).toBeCloseTo(layout.fourth.right, 0);
          expect(layout.detail.right).toBeCloseTo(layout.shell.right - 1, 0);
          expect(layout.context.x).toBeCloseTo(layout.fifth.x, 0);
          expect(layout.context.width).toBeCloseTo(layout.fifth.width, 0);
          expect(layout.context.y).toBeCloseTo(layout.shell.y, 0);
          expect(layout.context.bottom).toBeCloseTo(layout.shell.bottom, 0);
          expect(layout.phase.right).toBeLessThanOrEqual(layout.detail.right);
        } else {
          expect(layout.context.y).toBeGreaterThan(layout.detail.bottom);
          if (width <= 760) {
            expect(layout.detail.y).toBeCloseTo(layout.left.bottom, 0);
          }
        }
      }
    }
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole('button', { name: '切换到亮色模式', exact: true }).click();
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('native-layout-light.png') });
  await page.locator('.native-change-row').filter({ hasText: 'align-dashboard-copy' }).click();
  await detail.getByRole('tab', { name: '当前阻塞', exact: true }).click();
  await expect(detail.getByRole('region', { name: '当前阻塞内容', exact: true })).toContainText(
    '失败态文案仍不清楚。',
  );
  await page.screenshot({ path: testInfo.outputPath('native-blockers-light.png') });
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('no-native-shared-card-result');
  await expect(detail).toContainText('没有匹配的 Native change');
  for (const width of [1600, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNativeSharedFrame(page);
    await expect(context.locator('h4')).toHaveText(['执行与恢复']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
});

async function expectNativeSharedFrame(page: Page) {
  const shell = page.locator('.native-change-shell');
  const explorer = shell.locator('.native-changes-explorer');
  const detail = shell.locator('.native-change-detail');
  await expect(shell).toHaveCSS('border-width', '1px');
  await expect(shell).toHaveCSS('border-radius', '12px');
  await expect(shell).toHaveCSS('gap', '0px');
  await expect(shell).toHaveCSS('position', 'static');
  await expect(explorer).toHaveCSS('border-width', '0px');
  await expect(explorer).toHaveCSS('border-radius', '0px');
  await expect(detail).toHaveCSS('border-width', '0px');
  await expect(detail).toHaveCSS('border-radius', '0px');
  await expect(explorer.locator('.dashboard-explorer-title')).toHaveCSS('font-size', '16px');
  await expect(shell.locator('.native-project-context')).toHaveCount(0);
  const left = shell.locator('.dashboard-workspace-left');
  const stacked = (page.viewportSize()?.width ?? 0) <= 760;
  await expect(left).toHaveCSS('border-right-width', stacked ? '0px' : '1px');
  await expect(left).toHaveCSS('border-bottom-width', stacked ? '1px' : '0px');
  if (!stacked) {
    await expect
      .poll(() =>
        shell.evaluate((element) => {
          const tabs = element.querySelector('.native-changes-explorer .ant-tabs-nav')!;
          const head = element.querySelector('.native-change-detail > .ant-card-head')!;
          return Math.abs(
            tabs.getBoundingClientRect().bottom - head.getBoundingClientRect().bottom,
          );
        }),
      )
      .toBeLessThanOrEqual(1);
  }
}

test('aligns merged Native headers during loading and with long names across themes and widths', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const longName = 'native-long-change-name-'.repeat(9);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockNativeDetail(
    page,
    { ...source, name: longName, locator: 'local:long-name', children: [] },
    undefined,
    () => gate,
  );
  await expect(page.getByLabel('正在加载 Native 变更详情', { exact: true })).toBeVisible();
  for (const width of [1600, 1100, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectNativeSharedFrame(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  }
  release();
  const detail = page.locator('.native-change-detail');
  await expect(detail.locator('.dashboard-change-detail-title')).toContainText(longName);
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.getByRole('button', { name: /切换到.*色模式/ }).click();
    }
    for (const width of [1600, 1280, 1100, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNativeSharedFrame(page);
      await expect(detail.locator('.dashboard-change-detail-title')).toContainText(longName);
      await expect(detail.getByRole('tab')).toHaveText([
        '变更详情',
        '验收状态',
        '当前阻塞',
        '执行历史',
      ]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
  }
});

test('keeps recovery and long blocker details change-scoped while Git stays project-scoped', async ({
  page,
}) => {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  const source = snapshot.native.changes[0];
  const changes = [
    {
      ...source,
      name: 'recoverable-change',
      locator: 'local:recoverable-change',
      children: [],
      localExecution: {
        status: 'interrupted',
        reason: 'version-mismatch',
        recoverableFromStage: 'verify-ready',
        requestCheckRounds: 3,
        checks: [],
      },
      blockers: Array.from({ length: 12 }, (_, index) => ({
        owner: 'verifier',
        reason: { text: `诊断 ${index + 1}：${'缺少可复核的验收证据；'.repeat(12)}` },
        acceptanceIds: [`A${index + 1}`],
        resolutionAction: `补充第 ${index + 1} 项证据后重新验收`,
      })),
    },
    {
      ...source,
      name: 'stable-change',
      locator: 'local:stable-change',
      children: [],
      localExecution: { status: 'idle', reason: 'idle', checks: [] },
      blockers: [],
      history: [
        {
          goalCycle: 1,
          iteration: 1,
          attempt: 1,
          outcome: 'pass',
          summary: { text: '稳定变更记录' },
          completedAt: '2026-08-10T00:00:00.000Z',
        },
      ],
    },
  ];
  const files = Array.from(
    { length: 6 },
    (_, index) => `domains/dashboard/${'long-path/'.repeat(10)}file-${index + 1}.ts`,
  );
  let gitRequests = 0;
  let gitAvailable = true;
  const writes: string[] = [];
  await page.route('**/api/dashboard/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') writes.push(request.method());
    if (url.pathname.endsWith('/projects')) {
      await route.fulfill({
        json: {
          currentProjectId: 'native-layout',
          projects: [
            {
              id: 'native-layout',
              name: 'Native layout',
              path: '/tmp/native-layout',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: 'native',
              workflowSource: 'configured',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          ...snapshot,
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: { ...snapshot.native, activeChangeCount: 2, totalChangeCount: 2, changes: [] },
          git: gitAvailable
            ? {
                branch: 'project-branch',
                head: '1234567',
                dirtyFiles: 6,
                dirtyFileList: files,
                recentCommits: [],
              }
            : null,
        },
      });
    } else if (url.pathname.endsWith('/native-changes')) {
      const query = url.searchParams.get('q') ?? '';
      const items = changes.filter((change) => change.name.includes(query));
      await route.fulfill({
        json: { status: 'active', query, items, total: items.length, nextCursor: null },
      });
    } else if (url.pathname.endsWith('/native-change')) {
      await route.fulfill({
        json: changes.find((change) => change.name === url.searchParams.get('changeName')),
      });
    } else if (url.pathname.endsWith('/git/files')) {
      gitRequests += 1;
      expect(url.pathname).toContain('/projects/native-layout/');
      await route.fulfill({ json: { items: files, nextCursor: null, total: files.length } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  const recovery = page.getByRole('region', { name: '执行与恢复内容', exact: true });
  const blockers = page.getByRole('region', { name: '当前阻塞内容', exact: true });
  const git = page.locator('.native-change-detail .dashboard-project-git');
  await expect(recovery).toContainText('本机状态已过期，可从 YAML 恢复');
  await expect(recovery).toContainText('等待验证');
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '当前阻塞', exact: true })
    .click();
  await expect(blockers.locator('li')).toHaveCount(12);
  await expect(blockers).toContainText('验收：A12 · 处理：补充第 12 项证据后重新验收');
  expect(await blockers.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await expect(blockers).toHaveCSS('scrollbar-width', 'none');
  await blockers.focus();
  await blockers.press('End');
  await expect.poll(() => blockers.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '变更详情', exact: true })
    .click();
  await expect(git).toContainText('project-branch');
  await expect(git).toContainText('暂无最近提交');
  await expect(git.locator('.dashboard-git-preview-list li')).toHaveCount(5);
  expect(gitRequests).toBe(0);
  const trigger = git.getByRole('button', { name: '展开完整未提交文件' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '完整未提交文件', exact: true });
  await expect(dialog).toContainText(files[5]);
  expect(gitRequests).toBe(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(trigger).toBeFocused();
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '执行历史', exact: true })
    .click();
  await expect(page.locator('.native-history-card ol')).toBeVisible();
  await page.locator('.native-change-row').filter({ hasText: 'stable-change' }).click();
  await expect(
    page.locator('.native-change-detail').getByRole('tab', { name: '变更详情', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '执行历史', exact: true })
    .click();
  await expect(page.locator('.native-history-card ol')).toContainText('稳定变更记录');
  await expect(recovery).toContainText('当前无执行任务');
  await expect(recovery).not.toContainText('本机状态已过期');
  await expect(blockers).toHaveCount(0);
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '当前阻塞', exact: true })
    .click();
  await expect(blockers).toContainText('当前没有持久化阻塞项');
  await expect(blockers).not.toContainText('补充第 12 项证据');
  await expect(git).toHaveCount(0);
  await page.getByPlaceholder('搜索变更、产物或文件…').fill('missing-change');
  await expect(recovery).toContainText('选择变更后查看执行与恢复信息');
  await expect(blockers).toHaveCount(0);
  await expect(page.locator('.native-project-context .native-blockers-card')).toHaveCount(0);
  await expect(git).toContainText('project-branch');
  expect(writes).toEqual([]);
  gitAvailable = false;
  await page.reload();
  await page
    .locator('.native-change-detail')
    .getByRole('tab', { name: '变更详情', exact: true })
    .click();
  await expect(git).toContainText('当前项目暂无 Git 信息');
  await expect(page.locator('.native-project-context > *')).toHaveCount(1);
});

test('merges current execution, portable loop and submitted handoffs without confusing their scope', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const stale = {
    ...source,
    name: 'stale-recovery',
    locator: 'stale-recovery',
    children: [],
    phase: 'build',
    loop: {
      stage: 'repairing',
      goalCycle: 2,
      iteration: 4,
      attempt: 2,
      actor: null,
      nextAction: '修复后重新提交候选。',
    },
    localExecution: {
      status: 'absent',
      reason: 'version-mismatch',
      stage: null,
      actor: null,
      requestCheckRounds: 0,
      recoverableFromStage: 'repairing',
      checks: [],
    },
    builderHandoff: { iteration: 3, summary: { text: '先前轮次完整交接', truncated: true } },
  };
  const current = {
    ...source,
    name: 'current-execution',
    locator: 'current-execution',
    children: [],
    loop: {
      stage: 'building',
      goalCycle: 3,
      iteration: 5,
      attempt: 1,
      actor: 'builder',
      nextAction: '当前构建下一步。',
    },
    localExecution: {
      status: 'running',
      reason: 'current',
      stage: 'checking',
      actor: 'builder',
      requestCheckRounds: 2,
      recoverableFromStage: null,
      checks: [
        { id: 'local-passed', status: 'passed' },
        { id: 'local-failed', status: 'failed' },
        { id: 'local-running', status: 'running' },
      ],
    },
    builderHandoff: { iteration: 5, summary: { text: '本轮已提交完整交接' } },
  };
  const missing = {
    ...source,
    name: 'missing-recovery',
    locator: 'missing-recovery',
    children: [],
    loop: null,
    localExecution: null,
    builderHandoff: null,
  };
  await mockNativeDetail(page, [stale, current, missing]);
  const region = page.getByRole('region', { name: '执行与恢复内容', exact: true });
  const value = (label: string) =>
    region
      .locator('dl > div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator('dd');
  const detail = page.locator('.native-change-detail');
  await expect(page.locator('.native-project-context h4')).toHaveText(['执行与恢复']);
  await expect(region.locator('h5')).toHaveText(['当前执行', '循环进度', '恢复与交接']);
  await expect(value('本机状态')).toHaveText('本机状态已过期，可从 YAML 恢复');
  await expect(value('执行阶段')).toHaveText('—');
  await expect(value('循环阶段')).toHaveText('修复中');
  await expect(value('Goal cycle')).toHaveText('2');
  await expect(value('轮次 / 尝试')).toHaveText('4 / 2');
  await expect(value('检查请求轮次')).toHaveText('0');
  await expect(value('执行者')).toHaveCount(1);
  await expect(region).toContainText('可从 YAML 的 修复中 阶段恢复。');
  await expect(region).toContainText('下一步：修复后重新提交候选。');
  await expect(region).toContainText('Builder handoff · 第 3 轮（已提交）');
  await expect(region).toContainText('先前轮次完整交接');
  await expect(region).toContainText('交接摘要已在 Runtime 中截断。');
  await expect(region.locator('details')).toHaveCount(0);
  await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect(detail.locator('h4')).toHaveText(['关键产物', '变更范围', '仓库 Git']);
  await expect(detail).not.toContainText('先前轮次完整交接');
  await page.locator('.native-change-row').filter({ hasText: 'current-execution' }).click();
  await expect(value('循环阶段')).toHaveText('构建中');
  await expect(value('执行阶段')).toHaveText('执行检查');
  await expect(value('执行者')).toHaveText('Builder');
  await expect(value('检查请求轮次')).toHaveText('2');
  await expect(value('轮次 / 尝试')).toHaveText('5 / 1');
  await expect(region).toContainText('本机检查摘要：1 通过 / 1 失败 / 1 进行中');
  await expect(region).toContainText('Builder handoff · 第 5 轮（已提交）');
  await expect(region).not.toContainText('先前轮次完整交接');
  await expect(region).not.toContainText('可从 YAML');
  await expect(region).not.toContainText('已过期');
  for (const tab of ['验收状态', '当前阻塞', '执行历史']) {
    await detail.getByRole('tab', { name: tab, exact: true }).click();
    await expect(region).toContainText('本轮已提交完整交接');
  }
  await page.locator('.native-change-row').filter({ hasText: 'missing-recovery' }).click();
  await expect(region).toContainText('未提供本机执行状态。');
  await expect(region).toContainText('未提供可移植 Loop 状态。');
  await expect(region).toContainText('尚无 Builder 交接详情。');
  await expect(region.locator('h5')).toHaveCount(0);
  await expect(region).not.toContainText('当前构建下一步。');
  await expect(region).not.toContainText('先前轮次完整交接');
  await expect(region).not.toContainText('本轮已提交完整交接');
});

for (const count of [0, 8]) {
  test(`keeps Native detail Git previews bounded and opens complete lists only on request (${count})`, async ({
    page,
  }) => {
    const source = structuredClone(
      DEMO_SNAPSHOT.native.changes.find(
        (change) => change.name === 'stabilize-workspace-recovery',
      )!,
    );
    const commits = Array.from(
      { length: count },
      (_, i) => `commit-${i + 1} ${'完整提交说明'.repeat(20)}`,
    );
    const files = Array.from(
      { length: count },
      (_, i) => `domains/${'long-path/'.repeat(20)}file-${i + 1}.ts`,
    );
    const git = {
      ...DEMO_SNAPSHOT.git,
      branch: 'feature/native-detail-git',
      head: '1234567',
      dirtyFiles: count,
      recentCommits: commits,
      dirtyFileList: files,
    };
    await mockNativeDetail(
      page,
      { ...source, children: [] },
      () => {},
      () => {},
      git,
    );
    const requests: string[] = [];
    await page.route('**/api/dashboard/projects/*/git/**', async (route) => {
      const url = new URL(route.request().url());
      expect(route.request().method()).toBe('GET');
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.pathname).toContain('/projects/native-hierarchy/');
      const kind = url.pathname.endsWith('/commits') ? 'commits' : 'files';
      requests.push(kind);
      await route.fulfill({
        json: { items: kind === 'commits' ? commits : files, total: count, nextCursor: null },
      });
    });
    const detail = page.locator('.native-change-detail');
    const card = detail.locator('.native-detail-project-git');
    const recovery = page.getByRole('region', { name: '执行与恢复内容', exact: true });
    await expect(page.locator('.native-project-context > *')).toHaveCount(1);
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme)
        await page.getByRole('button', { name: /切换到.*色模式/ }).click();
      for (const width of [1600, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await expect(card.locator('.dashboard-git-preview-list li')).toHaveCount(
          Math.min(count, 5) * 2,
        );
        await expect(card).toContainText('feature/native-detail-git');
        await expect(card.locator('.classic-git-content')).toHaveCSS('overflow-y', 'visible');
        const gitWidths = await card.evaluate((element) => ({
          card: element.querySelector('article')!.getBoundingClientRect().width,
          content: element.querySelector('.classic-git-content')!.getBoundingClientRect().width,
        }));
        expect(gitWidths.card - gitWidths.content).toBeCloseTo(34, 0);
        const columns = await card
          .locator('.classic-git-content')
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
        expect(columns).toBe(width === 1600 ? 2 : 1);
        // 常规本机执行、循环和短交接信息完整显示，不再被Git占用的高度或旧560px上限遮住。
        expect(
          await recovery.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        ).toBe(true);
        await expect(recovery).toContainText('Builder handoff · 第 1 轮（已提交）');
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
    expect(requests).toEqual([]);
    if (count > 0) {
      for (const [kind, title, items] of [
        ['commits', '最近提交', commits],
        ['files', '未提交文件', files],
      ] as const) {
        const trigger = card.getByRole('button', { name: `展开完整${title}`, exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: `完整${title}`, exact: true });
        await expect(dialog).toContainText(items[7]);
        await expect(dialog.locator('.dashboard-git-full-list li')).toHaveCount(8);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(requests.at(-1)).toBe(kind);
      }
      expect(requests).toEqual(['commits', 'files']);
    } else {
      await expect(card).toContainText('暂无最近提交');
      await expect(card).toContainText('暂无未提交文件');
      await expect(card.getByRole('button', { name: /展开完整/ })).toHaveCount(0);
    }
    for (const tab of ['验收状态', '当前阻塞', '执行历史']) {
      await detail.getByRole('tab', { name: tab, exact: true }).click();
      await expect(card).toHaveCount(0);
      await expect(recovery).toContainText('Builder handoff · 第 1 轮（已提交）');
    }
    await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
    await expect(card.locator('.dashboard-git-preview-list li')).toHaveCount(
      Math.min(count, 5) * 2,
    );
    expect(requests).toHaveLength(count > 0 ? 2 : 0);
  });
}

async function mockNativeDetail(
  page: Page,
  change: Record<string, unknown> | Array<Record<string, unknown>>,
  onArtifact: (method: string, key: string | null) => void | Promise<void> = () => {},
  onDetail: () => void | Promise<void> = () => {},
  git: typeof DEMO_SNAPSHOT.git | null = DEMO_SNAPSHOT.git,
) {
  const snapshot = structuredClone(DEMO_SNAPSHOT);
  snapshot.git = git;
  const changes = Array.isArray(change) ? change : [change];
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/projects')) {
      await route.fulfill({
        json: {
          currentProjectId: 'native-hierarchy',
          projects: [
            {
              id: 'native-hierarchy',
              name: 'Native hierarchy',
              path: '/tmp/native-hierarchy',
              availability: 'available',
              isCurrent: true,
              defaultWorkflow: 'native',
              workflowSource: 'configured',
            },
          ],
        },
      });
    } else if (url.pathname.endsWith('/overview')) {
      await route.fulfill({
        json: {
          ...snapshot,
          initialChanges: { status: 'active', items: [], total: 0, nextCursor: null },
          native: {
            ...snapshot.native,
            activeChangeCount: changes.length,
            totalChangeCount: changes.length,
            changes: [],
          },
        },
      });
    } else if (url.pathname.endsWith('/native-changes')) {
      await route.fulfill({
        json: { status: 'active', items: changes, total: changes.length, nextCursor: null },
      });
    } else if (url.pathname.endsWith('/native-change')) {
      await onDetail();
      await route.fulfill({
        json: changes.find((item) => item.name === url.searchParams.get('changeName')),
      });
    } else if (url.pathname.endsWith('/native-artifact')) {
      await onArtifact(route.request().method(), url.searchParams.get('key'));
      await route.fulfill({
        json: {
          key: url.searchParams.get('key'),
          label: '长文档',
          path: 'specs/long.md',
          exists: true,
          content: '# 按需读取产物\n' + '正文'.repeat(500),
          truncated: true,
          previewBytes: 48 * 1024,
        },
      });
    } else await route.fulfill({ json: {} });
  });
  await page.goto('/');
}

for (const { phase, tab } of [
  { phase: 'shape', tab: '变更详情' },
  { phase: 'build', tab: '变更详情' },
  { phase: 'verify', tab: '验收状态' },
  { phase: 'archive', tab: '验收状态' },
  { phase: 'unknown-phase', tab: '验收状态' },
  { phase: null, tab: '验收状态' },
  { phase: undefined, tab: '验收状态' },
]) {
  test(`selects the Native detail tab from the reported phase (${String(phase)})`, async ({
    page,
  }) => {
    await mockNativeDetail(page, {
      ...structuredClone(DEMO_SNAPSHOT.native.changes[0]),
      name: `phase-${String(phase)}`,
      locator: `local:phase-${String(phase)}`,
      children: [],
      phase,
    });
    await expect(
      page.locator('.native-change-detail').getByRole('tab', { name: tab, exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  });
}

for (const phase of ['build', 'verify']) {
  for (const verificationResult of ['fail', 'blocked']) {
    test(`prioritizes current Native blockers (${phase}, ${verificationResult})`, async ({
      page,
    }) => {
      const change = {
        ...structuredClone(
          DEMO_SNAPSHOT.native.changes.find((change) => change.name === 'align-dashboard-copy'),
        ),
        phase,
        verificationResult,
      };
      await mockNativeDetail(page, change);
      const detail = page.locator('.native-change-detail');
      const tab = (name: string) => detail.getByRole('tab', { name, exact: true });
      await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
      await expect(detail.locator('.native-blockers-card')).toContainText('失败态文案仍不清楚。');
      await expect(detail.locator('.native-blockers-card')).toContainText('等待浏览器环境。');
      await tab('验收状态').click();
      await page.getByRole('button', { name: '立即刷新', exact: true }).click();
      await expect(tab('验收状态')).toHaveAttribute('aria-selected', 'true');
    });
  }
}

for (const signal of ['verification', 'acceptance', 'blocker', 'local-check']) {
  test(`uses current Native failure evidence independently (${signal})`, async ({ page }) => {
    const change = { ...structuredClone(DEMO_SNAPSHOT.native.changes[0]), children: [] };
    if (signal === 'verification') change.verificationResult = 'fail';
    if (signal === 'acceptance') {
      change.acceptance.failed = 1;
      change.acceptance.passed = 0;
      change.acceptanceItems[0].result = 'failed';
    }
    if (signal === 'blocker') {
      change.blockers = [
        {
          owner: 'runtime',
          reason: { text: '当前 Verifier 执行失败，需要重试。' },
          acceptanceIds: [],
          resolutionAction: 'retry-verifier',
        },
      ];
    }
    if (signal === 'local-check') {
      change.localExecution.checks = [{ id: 'current-failed-check', status: 'failed' }];
    }
    await mockNativeDetail(page, change);
    const detail = page.locator('.native-change-detail');
    await expect(detail.getByRole('tab', { name: '当前阻塞', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(detail.locator('.native-blockers-card')).toBeVisible();
    if (signal !== 'blocker')
      await expect(detail.locator('.native-blockers-card')).toHaveClass(/is-empty/);
  });
}

for (const phase of ['build', 'verify']) {
  test(`restores Native phase defaults when current failure clears (${phase})`, async ({
    page,
  }) => {
    const change = {
      ...structuredClone(
        DEMO_SNAPSHOT.native.changes.find((change) => change.name === 'align-dashboard-copy'),
      ),
      phase,
    };
    await page.clock.install();
    await mockNativeDetail(page, change);
    const detail = page.locator('.native-change-detail');
    const tab = (name: string) => detail.getByRole('tab', { name, exact: true });
    const phaseDefault = phase === 'build' ? '变更详情' : '验收状态';
    await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
    await tab('执行历史').click();
    await page.clock.fastForward(30_001);
    await expect(tab('执行历史')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('执行历史')).toBeFocused();
    change.verificationResult = 'pending';
    change.acceptanceItems = change.acceptanceItems.map((item) => ({
      ...item,
      result: 'pending',
      reason: null,
    }));
    change.acceptance = { total: 4, passed: 0, failed: 0, blocked: 0, pending: 4 };
    change.blockers = [];
    change.verification = null;
    change.checks = [];
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(tab(phaseDefault)).toHaveAttribute('aria-selected', 'true');
    await tab('执行历史').click();
    await expect(detail).toContainText('Verifier 返回修复。');
    change.verificationResult = 'fail';
    await page.clock.fastForward(30_001);
    await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
    await tab('变更详情').click();
    change.verificationResult = 'blocked';
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(tab('变更详情')).toHaveAttribute('aria-selected', 'true');
  });
}

for (const state of ['retained-report', 'stale-local-check', 'pass-confirmation']) {
  test(`does not treat historical Native failure as current (${state})`, async ({ page }) => {
    const change = {
      ...structuredClone(DEMO_SNAPSHOT.native.changes[0]),
      children: [],
      history: [{ outcome: 'fail', unresolvedIds: ['A1'], summary: { text: '已经处理的旧失败' } }],
    };
    if (state === 'retained-report') {
      change.verification = { verdict: 'fail', summary: { text: '保留的旧失败报告' }, risks: [] };
      change.checks = [
        { id: 'old-failed-check', name: { text: '旧报告中的失败检查' }, status: 'failed' },
      ];
    }
    if (state === 'stale-local-check') {
      change.localExecution.reason = 'version-mismatch';
      change.localExecution.checks = [{ id: 'old-local-check', status: 'failed' }];
    }
    if (state === 'pass-confirmation') {
      change.phase = 'verify';
      change.verificationResult = 'pass';
      change.loop.stage = 'await-user';
      change.acceptanceItems = change.acceptanceItems.map((item) => ({
        ...item,
        result: 'passed',
      }));
      change.acceptance = { total: 2, passed: 2, failed: 0, blocked: 0, pending: 0 };
      change.verification = {
        verdict: 'pass',
        assurance: 'skill-coordinated',
        summary: { text: '验证已经通过，等待确认。' },
        risks: [],
      };
      change.blockers = [
        {
          owner: 'user',
          reason: { text: '确认已经通过的验证结果。' },
          acceptanceIds: [],
          resolutionAction: 'await-user',
        },
      ];
    }
    await mockNativeDetail(page, change);
    const detail = page.locator('.native-change-detail');
    await expect(
      detail.getByRole('tab', {
        name: state === 'pass-confirmation' ? '验收状态' : '变更详情',
        exact: true,
      }),
    ).toHaveAttribute('aria-selected', 'true');
  });
}

test('ignores a delayed Native failure response after rapidly switching changes', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const changes = [
    { ...source, name: 'clean-build', locator: 'local:clean-build', children: [] },
    {
      ...structuredClone(source),
      name: 'delayed-failure',
      locator: 'local:delayed-failure',
      children: [],
      verificationResult: 'fail',
      blockers: [
        {
          owner: 'builder',
          reason: { text: '迟到的失败阻塞' },
          acceptanceIds: [],
          resolutionAction: 'return-build',
        },
      ],
    },
    {
      ...structuredClone(source),
      name: 'clean-verify',
      locator: 'local:clean-verify',
      children: [],
      phase: 'verify',
    },
  ];
  let holdDetail = false;
  let detailRequests = 0;
  let release = () => {};
  const heldDetail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockNativeDetail(page, changes, undefined, async () => {
    detailRequests += 1;
    if (holdDetail) await heldDetail;
  });
  const detail = page.locator('.native-change-detail');
  await expect(detail.getByRole('tab', { name: '变更详情', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const beforeSwitch = detailRequests;
  holdDetail = true;
  await page.locator('.native-change-row').filter({ hasText: 'delayed-failure' }).click();
  await expect.poll(() => detailRequests).toBeGreaterThan(beforeSwitch);
  await expect(detail).toHaveClass(/native-change-detail-skeleton/);
  holdDetail = false;
  await page.locator('.native-change-row').filter({ hasText: 'clean-verify' }).click();
  await expect(detail.getByRole('tab', { name: '验收状态', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  release();
  await expect(detail).not.toContainText('迟到的失败阻塞');
  await expect(detail.locator('h3')).toHaveText('当前变更 · clean-verify');
  await page.locator('.native-change-row').filter({ hasText: 'delayed-failure' }).click();
  await expect(detail.getByRole('tab', { name: '当前阻塞', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(detail.locator('.native-blockers-card')).toContainText('迟到的失败阻塞');
});

test('keeps manual Native tabs during polling and resets them for phase and change transitions', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const changes = ['first', 'second'].map((name, index) => ({
    ...structuredClone(source),
    name: `phase-${name}`,
    locator: `local:phase-${name}`,
    children: [],
    phase: index === 0 ? 'build' : 'verify',
    verification: { summary: { text: `${name} 的检查摘要` }, risks: [] },
    history: [
      {
        goalCycle: 1,
        iteration: 1,
        attempt: 1,
        outcome: 'recovery',
        summary: { text: `${name} 的执行记录` },
        completedAt: '2026-08-09T00:00:00.000Z',
      },
    ],
  }));
  let holdDetail = false;
  let detailRequests = 0;
  let release = () => {};
  const heldDetail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.clock.install();
  await mockNativeDetail(page, changes, undefined, async () => {
    detailRequests += 1;
    if (holdDetail) await heldDetail;
  });
  const detail = page.locator('.native-change-detail');
  const tab = (name: string) => detail.getByRole('tab', { name, exact: true });
  await expect(tab('变更详情')).toHaveAttribute('aria-selected', 'true');
  await tab('执行历史').click();
  changes[0].history[0].summary.text = '轮询更新后的执行记录';
  const beforePoll = detailRequests;
  await page.clock.fastForward(30_001);
  await expect.poll(() => detailRequests).toBeGreaterThan(beforePoll);
  await expect(detail.locator('.native-history-card')).toContainText('轮询更新后的执行记录');
  await expect(tab('执行历史')).toHaveAttribute('aria-selected', 'true');
  changes[0].history[0].summary.text = '手动刷新后的执行记录';
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(detail.locator('.native-history-card')).toContainText('手动刷新后的执行记录');
  await expect(tab('执行历史')).toHaveAttribute('aria-selected', 'true');
  for (const [phase, expectedTab] of [
    ['verify', '验收状态'],
    ['archive', '验收状态'],
    ['build', '变更详情'],
    ['shape', '变更详情'],
    ['unknown-phase', '验收状态'],
  ]) {
    await tab('当前阻塞').click();
    changes[0].phase = phase;
    await page.getByRole('button', { name: '立即刷新', exact: true }).click();
    await expect(tab(expectedTab)).toHaveAttribute('aria-selected', 'true');
  }
  await tab('执行历史').click();
  holdDetail = true;
  await page.locator('.native-change-row').filter({ hasText: 'phase-second' }).click();
  await expect(detail).toHaveClass(/native-change-detail-skeleton/);
  await expect(detail).not.toContainText('手动刷新后的执行记录');
  await expect(detail).not.toContainText('first 的检查摘要');
  release();
  holdDetail = false;
  await expect(tab('验收状态')).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.native-verification-card')).toContainText('second 的检查摘要');
  await expect(detail).not.toContainText('first 的检查摘要');
  changes[0].phase = 'build';
  await page.locator('.native-change-row').filter({ hasText: 'phase-first' }).click();
  await expect(tab('变更详情')).toHaveAttribute('aria-selected', 'true');
  await tab('当前阻塞').click();
  await page.locator('.native-change-row').filter({ hasText: 'phase-first' }).click();
  await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
});

test('retains Native scope statistics, bounded number motion and complete capability names', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const change = {
    ...source,
    name: 'scope-statistics',
    locator: 'local:scope-statistics',
    children: [],
    specs: {
      total: 1,
      create: 0,
      modify: 1,
      remove: 0,
      capabilities: [{ capability: 'dashboard', operation: 'modify' }],
      capabilitiesTruncated: false,
    },
  };
  await mockNativeDetail(page, change);
  const scope = page.locator('.native-scope-card');
  const values = scope.locator('.ant-statistic-content-value');
  await expect(values).toHaveText(['1', '0', '1', '0']);
  const capability = scope.locator('.native-capability-row');
  await capability.locator('summary').click();
  await expect(capability.locator('p')).toHaveText('dashboard');
  await capability.locator('summary').press('Enter');
  await expect(capability).toHaveJSProperty('open', false);
  await page.evaluate(() => {
    const audit = window as Window & { __scopeStatisticFrames?: number[] };
    audit.__scopeStatisticFrames = [];
    const value = document.querySelector('.native-scope-metrics .ant-statistic-content-value')!;
    new MutationObserver(() =>
      audit.__scopeStatisticFrames!.push(Number(value.textContent)),
    ).observe(value, { childList: true, subtree: true, characterData: true });
  });
  const capabilityName = '完整能力名称-'.repeat(30);
  change.specs = {
    total: 80,
    create: 40,
    modify: 20,
    remove: 20,
    capabilities: Array.from({ length: 80 }, (_, index) => ({
      capability: index === 79 ? capabilityName : `capability-${index + 1}`,
      operation: index < 40 ? 'create' : index < 60 ? 'modify' : 'remove',
    })),
    capabilitiesTruncated: false,
  };
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(values).toHaveText(['80', '40', '20', '20']);
  const frames = await page.evaluate(
    () => (window as Window & { __scopeStatisticFrames?: number[] }).__scopeStatisticFrames ?? [],
  );
  expect(frames.some((value) => value > 1 && value < 80)).toBe(true);
  expect(frames.every((value) => value >= 1 && value <= 80)).toBe(true);
  await scope.getByText('展开其余 77 项能力', { exact: true }).click();
  const remaining = scope.getByRole('region', { name: '其余能力', exact: true });
  await expect(remaining.locator('.native-capability-row')).toHaveCount(77);
  await remaining.focus();
  await remaining.press('End');
  const last = remaining.locator('.native-capability-row').last();
  await expect(last).toBeInViewport();
  await last.locator('summary').click();
  await expect(last.locator('p')).toHaveText(capabilityName);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  change.specs = {
    total: 0,
    create: 0,
    modify: 0,
    remove: 0,
    capabilities: [],
    capabilitiesTruncated: false,
  };
  await page.getByRole('button', { name: '立即刷新', exact: true }).click();
  await expect(values).toHaveText(['0', '0', '0', '0']);
  await expect(scope).toContainText('尚未声明 Spec 变更');
  for (const theme of ['light', 'dark']) {
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await page.getByRole('button', { name: /切换到.*色模式/ }).click();
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      for (const card of await scope.locator('.native-statistic-card').all()) {
        expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
    }
  }
});

async function hoverNativeScrollRegion(page: Page, region: Locator) {
  await region.evaluate((element) => {
    const top = scrollY + element.getBoundingClientRect().top;
    const max = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, Math.min(Math.max(60, top - 320), Math.max(0, max - 60)));
  });
  // 等浏览器结束上一段滚轮手势，避免程序定位与合成器中的滚动动画竞争。
  await page.waitForTimeout(350);
  const bounds = await region.boundingBox();
  if (!bounds) throw new Error('Native 滚动区域没有可测量的位置');
  const headerBottom = await page
    .locator('.comet-workbench-header')
    .evaluate((element) => element.getBoundingClientRect().bottom);
  const point = {
    x: bounds.x + bounds.width / 2,
    y: Math.min(bounds.y + bounds.height - 5, Math.max(bounds.y + 10, headerBottom + 15), 575),
  };
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(() =>
      region.evaluate(
        (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
        point,
      ),
    )
    .toBe(true);
}

async function expectNativeWheelPageScroll(page: Page, start: number, delta: number) {
  // 连续滚轮输入覆盖边界最后一小段距离；scrollHeight 与实际滚动位置可能相差不到 1px。
  for (let tick = 0; tick < 3; tick += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(350);
    const position = await page.evaluate(() => scrollY);
    if (delta > 0 ? position > start : position < start) return;
  }
  const position = await page.evaluate(() => scrollY);
  if (delta > 0) expect(position).toBeGreaterThan(start);
  else expect(position).toBeLessThan(start);
}

for (const width of [1600, 390]) {
  test(`Native content regions scroll internally and pass short content and boundaries to the page (${width}px)`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
    const changes = [
      {
        ...source,
        name: 'scroll-short',
        locator: 'scroll-short',
        children: [],
        blockers: [],
        loop: null,
        localExecution: null,
        builderHandoff: null,
      },
      {
        ...source,
        name: 'scroll-long',
        locator: 'scroll-long',
        children: [],
        builderHandoff: { iteration: 2, summary: { text: '完整交接说明。'.repeat(300) } },
        acceptance: { total: 24, passed: 0, pending: 24, failed: 0, blocked: 0 },
        acceptanceItems: Array.from({ length: 24 }, (_, index) => ({
          id: `A${index}`,
          text: '完整验收条件。'.repeat(30),
          result: 'pending',
        })),
        localExecution: {
          ...source.localExecution,
          reason: 'version-mismatch',
          stage: '长执行阶段文本。'.repeat(80),
        },
        blockers: Array.from({ length: 12 }, (_, index) => ({
          owner: 'verifier',
          reason: { text: '需要补充证据。'.repeat(30) },
          acceptanceIds: [`A${index}`],
          resolutionAction: '补充证据后验收',
        })),
      },
    ];
    await mockNativeDetail(page, changes);
    // 留出页面滚动空间，避免短页签已处于页尾时把正常边界误判为滚动被拦截。
    await page.addStyleTag({
      content: '.dashboard-content-shell { padding-bottom: 800px !important; }',
    });
    const detail = page.locator('.native-change-detail');
    const regions = [
      { name: '完整验收条目', tab: '验收状态' },
      { name: '执行与恢复内容', tab: '验收状态' },
      { name: '当前阻塞内容', tab: '当前阻塞' },
    ];
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
        await page.getByRole('button', { name: /切换到.*色模式/ }).click();
      }
      for (const mode of ['short', 'long']) {
        await page
          .locator('.native-change-row')
          .filter({ hasText: `scroll-${mode}` })
          .click();
        await expect(detail.locator('.dashboard-change-detail-title')).toContainText(
          `scroll-${mode}`,
        );
        for (const { name, tab } of regions) {
          await test.step(`${theme} ${mode} ${name}`, async () => {
            await detail.getByRole('tab', { name: new RegExp(`${tab}$`) }).click();
            if (width >= 1280) {
              await expect
                .poll(() =>
                  page.evaluate(() =>
                    Math.abs(
                      document.querySelector('.native-project-context')!.getBoundingClientRect()
                        .height -
                        document.querySelector('.native-change-shell')!.getBoundingClientRect()
                          .height,
                    ),
                  ),
                )
                .toBeLessThanOrEqual(1);
            }
            const region = page.getByRole('region', { name, exact: true });
            await expect(region).toHaveCSS('overflow-y', 'auto');
            await expect(region).toHaveCSS('scrollbar-width', 'none');
            await expect(region).toHaveAttribute('tabindex', '0');
            const max = await region.evaluate(
              (element) => element.scrollHeight - element.clientHeight,
            );
            if (mode === 'short') expect(max).toBe(0);
            else {
              expect(max).toBeGreaterThan(160);
              await region.evaluate((element) => {
                element.scrollTop = 0;
              });
              await hoverNativeScrollRegion(page, region);
              const pageBefore = await page.evaluate(() => scrollY);
              await page.mouse.wheel(0, 120);
              await expect
                .poll(() => region.evaluate((element) => element.scrollTop))
                .toBeGreaterThan(0);
              await page.waitForTimeout(350);
              const innerDown = await region.evaluate((element) => element.scrollTop);
              expect(await page.evaluate(() => scrollY)).toBe(pageBefore);
              await page.mouse.wheel(0, -60);
              await expect
                .poll(() => region.evaluate((element) => element.scrollTop))
                .toBeLessThan(innerDown);
              await page.waitForTimeout(350);
              expect(await page.evaluate(() => scrollY)).toBe(pageBefore);
              await region.focus();
              await region.press('End');
              await expect
                .poll(() =>
                  region.evaluate((element) =>
                    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
                  ),
                )
                .toBeLessThanOrEqual(1);
              await region.press('Home');
              await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0);
            }
            await region.evaluate((element) => {
              element.scrollTop = element.scrollHeight;
            });
            await hoverNativeScrollRegion(page, region);
            const bottomPage = await page.evaluate(() => scrollY);
            await expectNativeWheelPageScroll(page, bottomPage, 120);
            expect(
              await region.evaluate((element) =>
                Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
              ),
            ).toBeLessThanOrEqual(1);
            await region.evaluate((element) => {
              element.scrollTop = 0;
            });
            await hoverNativeScrollRegion(page, region);
            const topPage = await page.evaluate(() => scrollY);
            expect(topPage).toBeGreaterThan(0);
            await expectNativeWheelPageScroll(page, topPage, -120);
            expect(await region.evaluate((element) => element.scrollTop)).toBe(0);
          });
        }
      }
    }
    const trigger = detail.getByRole('button', { name: '展开完整下一步建议', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.ant-modal-body')).toHaveCSS('overscroll-behavior-y', 'contain');
    const lockedPage = await page.evaluate(() => scrollY);
    await page.mouse.move(5, 590);
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => scrollY)).toBe(lockedPage);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('prioritizes failures, marks the prior candidate and shows complete references and risks', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const change = {
    ...source,
    name: 'failed-candidate',
    locator: 'local:failed-candidate',
    children: [],
    phase: 'build',
    loop: {
      ...source.loop,
      iteration: 4,
      stage: 'repairing',
      nextAction: 'repair-failed-acceptance',
    },
    acceptance: { total: 2, passed: 0, failed: 2, blocked: 0, pending: 0 },
    acceptanceItems: [1, 2].map((i) => ({
      id: `A${i}`,
      text: `失败验收 ${i}`,
      result: 'failed',
      reason: { text: '需要修复' },
    })),
    verificationResult: 'fail',
    verification: {
      candidateId: 'real-failed-candidate-3',
      iteration: 3,
      attempt: 2,
      assurance: 'host-attested',
      summary: { text: '上一轮验证失败' },
      risks: [{ text: '风险内容'.repeat(80) }],
      risksTruncated: false,
    },
    builderHandoff: { iteration: 3, summary: { text: '完整交接内容'.repeat(200) } },
    checks: [
      {
        id: 'failed-check',
        name: { text: '长检查命令名称 '.repeat(50) },
        status: 'failed',
        durationMs: 2500,
        exitCode: 1,
      },
      {
        id: 'passed-check',
        name: { text: '通过检查' },
        status: 'passed',
        durationMs: 20,
        exitCode: 0,
      },
    ],
    specs: {
      total: 11,
      create: 10,
      modify: 0,
      remove: 1,
      capabilities: Array.from({ length: 11 }, (_, i) => ({
        capability: `capability-${i + 1}`,
        operation: i === 10 ? 'remove' : 'create',
      })),
      capabilitiesTruncated: false,
    },
    artifactReferences: Array.from({ length: 12 }, (_, i) => ({
      key: `artifact-${i + 1}`,
      label: `产物 ${i + 1}`,
      path: `specs/artifact-${i + 1}.md`,
    })),
    artifacts: Array.from({ length: 8 }, (_, i) => ({
      key: `artifact-${i + 1}`,
      label: `产物 ${i + 1}`,
      path: `specs/artifact-${i + 1}.md`,
      exists: true,
      content: '# 已预读文档',
      previewBytes: 48 * 1024,
    })),
    historyOverflow: {
      droppedEntries: 7,
      firstDroppedAt: '2026-08-01T00:00:00.000Z',
      lastDroppedAt: '2026-08-02T00:00:00.000Z',
    },
  };
  const requests: Array<[string, string | null]> = [];
  await mockNativeDetail(page, change, (method, key) => requests.push([method, key]));
  const detail = page.locator('.native-change-detail');
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await expect(detail.locator('h4')).toHaveText(['验收状态', '检查结果']);
  const acceptance = detail.locator('.native-acceptance-card');
  await expect(acceptance).toContainText('100% 已处理');
  await expect(acceptance.locator('.native-acceptance-items li')).toHaveCount(2);
  const bar = acceptance.locator('.native-acceptance-progress > span');
  await expect(bar).toHaveClass(/bg-danger/);
  await expect(bar).not.toHaveClass(/bg-success/);
  const verification = detail.locator('.native-verification-card');
  await expect(verification).toContainText('real-failed-candidate-3');
  await expect(verification).toContainText('验证轮次 / 尝试：3 / 2');
  await expect(verification).toContainText('上一轮候选结果 · 修复中');
  await expect(verification).toContainText('上一轮验证失败');
  await expect(verification).toContainText('已完成独立验证');
  await expect(verification).toContainText('验证失败');
  await expect(verification.getByText('展开 1 项验证风险', { exact: true })).toHaveCount(0);
  await expect(verification.locator('ul')).toContainText('风险内容'.repeat(80));
  const checks = detail.locator('.native-verification-card');
  await expect(checks).toContainText('exit 1');
  await expect(checks.getByText('通过检查', { exact: true }).first()).toBeVisible();
  await expect(checks.locator('.native-check-list > .native-disclosure')).toHaveCount(0);
  await detail.getByRole('tab', { name: '执行历史', exact: true }).click();
  const history = detail.locator('.native-history-card');
  await expect(history).toContainText('更早的 7 条历史已汇总');
  await expect(history.locator('ol')).toBeVisible();
  await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect(detail.locator('h4')).toHaveText(['关键产物', '变更范围', '仓库 Git']);
  await expect(detail.locator('.native-verification-card')).toHaveCount(0);
  const loopContent = page.getByRole('region', { name: '执行与恢复内容', exact: true });
  await expect(loopContent).toContainText('完整交接内容'.repeat(200));
  await loopContent.focus();
  await loopContent.press('End');
  await expect.poll(() => loopContent.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const scope = detail.locator('.native-scope-card');
  await scope.getByText('展开其余 8 项能力', { exact: true }).click();
  await expect(scope).toContainText('capability-11');
  await expect(scope.getByText('删除', { exact: true })).toHaveCount(2);
  const artifacts = detail.locator('.native-artifacts-card');
  await expect(artifacts).toContainText('12 项引用');
  await expect(artifacts.getByRole('button')).toHaveCount(12);
  await expect(artifacts.locator('details')).toHaveCount(0);
  expect(requests).toEqual([]);
  const trigger = artifacts.getByRole('button', { name: /artifact-12/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '产物预览：产物 12', exact: true });
  await expect(dialog).toContainText('按需读取产物');
  await expect(dialog).toContainText('仅预览前 48 KiB，未提供全文');
  await expect(dialog).not.toContainText('256KB');
  expect(requests).toEqual([['GET', 'artifact-12']]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('preserves Native preview focus through polling, fullscreen Escape and close', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  let detailReads = 0;
  await page.clock.install();
  await mockNativeDetail(
    page,
    {
      ...source,
      phase: 'build',
      children: [],
      artifactReferences: [{ key: 'brief', label: '需求简报', path: 'brief.md' }],
      artifacts: [
        { key: 'brief', label: '需求简报', path: 'brief.md', exists: true, content: '# Brief' },
      ],
    },
    undefined,
    async () => {
      detailReads += 1;
    },
  );
  const trigger = page.locator('.native-artifacts-card').getByRole('button', { name: /brief/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '产物预览：需求简报', exact: true });
  const copy = dialog.getByRole('button', { name: '复制文件路径', exact: true });
  await copy.focus();
  const beforePoll = detailReads;
  await page.clock.fastForward(30_001);
  await expect.poll(() => detailReads).toBeGreaterThan(beforePoll);
  await expect(copy).toBeFocused();
  await dialog.getByRole('button', { name: '全屏展示', exact: true }).click();
  await copy.focus();
  const beforeFullscreenPoll = detailReads;
  await page.clock.fastForward(30_001);
  await expect.poll(() => detailReads).toBeGreaterThan(beforeFullscreenPoll);
  await expect(copy).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '全屏展示', exact: true })).toBeVisible();
  await expect(copy).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

for (const count of [0, 1, 8]) {
  test(`shows every supplied check row without a list disclosure (${count})`, async ({ page }) => {
    const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
    const statuses = [
      'passed',
      'failed',
      'running',
      'planned',
      'failed',
      'passed',
      'failed',
      'running',
    ];
    const checks = Array.from({ length: count }, (_, index) => ({
      id: `C${index + 1}`,
      name: {
        text: `检查 ${index + 1}${index === 7 ? `：${'完整检查名称'.repeat(80)}` : ''}`,
        truncated: index === 7,
      },
      status: statuses[index],
      durationMs: 100 + index,
      exitCode: statuses[index] === 'passed' ? 0 : statuses[index] === 'failed' ? 1 : null,
    }));
    await mockNativeDetail(page, {
      ...source,
      name: 'complete-check-list',
      children: [],
      checks,
    });
    const detail = page.locator('.native-change-detail');
    await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
    const list = detail.locator('.native-check-list');
    const rows = list.locator('.native-check-row');
    await expect(rows).toHaveCount(count);
    await expect(list.locator('.native-disclosure, .native-expanded-list')).toHaveCount(0);
    await expect(list.getByText(/展开.*项检查/)).toHaveCount(0);
    // 保留原有顺序：先展示前三项未通过检查，再展示其余来源条目。
    const expectedChecks =
      count === 8 ? [checks[1], checks[2], checks[3], checks[0], ...checks.slice(4)] : checks;
    await expect(rows.locator('.native-check-name')).toHaveText(
      expectedChecks.map((check) => check.name.text),
    );
    for (const [index, check] of expectedChecks.entries()) {
      await expect(rows.nth(index).locator('summary')).toContainText(check.status);
      await expect(rows.nth(index).locator('summary')).toContainText(`${check.durationMs} ms`);
      if (check.exitCode !== null) {
        await expect(rows.nth(index).locator('summary')).toContainText(`exit ${check.exitCode}`);
      }
    }
    if (count === 0) await expect(list).toHaveText('尚无持久化检查摘要。');
    for (const theme of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
        await page.getByRole('button', { name: /切换到.*色模式/ }).click();
      }
      for (const width of [1600, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(list).toHaveCSS('max-height', 'none');
        expect(
          await list.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        ).toBe(true);
        if (count > 0) {
          const last = rows.last();
          await last.scrollIntoViewIfNeeded();
          await expect(last).toBeInViewport();
          await expect(last.locator('summary')).toBeVisible();
          if (count === 8) {
            await last.locator('summary').click();
            await expect(last.locator('p').first()).toBeVisible();
            await expect(last.locator('p').first()).toHaveText(checks[7].name.text);
            await expect(last).toContainText('检查名称已在来源中截断。');
            await last.locator('summary').click();
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      }
    }
  });
}

for (const count of [0, 8]) {
  test(`keeps zero and eight-item secondary lists accessible (${count})`, async ({ page }) => {
    const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
    const artifacts = Array.from({ length: count }, (_, i) => ({
      key: `artifact-${i + 1}`,
      label: `产物 ${i + 1}`,
      path: `artifact-${i + 1}.md`,
      exists: true,
      content: '# 文档',
    }));
    await mockNativeDetail(page, {
      ...source,
      name: 'secondary-lists',
      children: [],
      artifacts,
      verification: {
        risks: Array.from({ length: count }, (_, index) => ({
          text: `完整风险 ${index + 1}：${'风险原文'.repeat(80)}`,
          truncated: index === count - 1,
        })),
        risksTruncated: count > 0,
      },
      specs: {
        total: count,
        create: count,
        modify: 0,
        remove: 0,
        capabilities: artifacts.map((x) => ({ capability: x.key, operation: 'create' })),
        capabilitiesTruncated: false,
      },
    });
    const detail = page.locator('.native-change-detail');
    await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
    await expect(detail.locator('.native-verification-binding')).toHaveCount(0);
    await expect(detail.locator('.native-verification-card')).toContainText('尚无 Verifier 结论。');
    await expect(detail.locator('.native-verification-risks li')).toHaveCount(count);
    await expect(detail.locator('.native-verification-risks details')).toHaveCount(0);
    if (count > 0) {
      await expect(detail.locator('.native-verification-risks')).toContainText('（摘要已截断）');
      await expect(detail.locator('.native-verification-card')).toContainText(
        '风险列表已在来源中截断。',
      );
    }
    await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
    await expect(detail.locator('.native-scope-metrics .ant-statistic-title')).toHaveText([
      'capability 总数',
      '新增',
      '修改',
      '删除',
    ]);
    await expect(detail.locator('.native-scope-metrics .ant-statistic-content-value')).toHaveText([
      String(count),
      String(count),
      '0',
      '0',
    ]);
    if (count === 0) {
      await expect(detail).toContainText('暂无可预览产物');
      await expect(detail).toContainText('尚未声明 Spec 变更');
    } else {
      await detail
        .locator('.native-scope-card > div:last-child .native-disclosure > summary')
        .click();
      await expect(detail.locator('.native-artifact-row')).toHaveCount(8);
      await expect(detail.locator('.native-capability-row')).toHaveCount(8);
    }
    for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const boxes = await detail
        .locator('.native-detail-source > article')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({ x: n.getBoundingClientRect().x, y: n.getBoundingClientRect().y })),
        );
      if (width === 1600) expect(boxes[0].y).toBeCloseTo(boxes[1].y, 0);
      else expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      const lastArtifact = detail.locator('.native-artifact-row').last();
      if (count > 0) {
        await lastArtifact.scrollIntoViewIfNeeded();
        await expect(lastArtifact).toBeInViewport();
      }
      await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
      if (count > 0) {
        const risks = detail.locator('.native-verification-risks ul');
        await expect(risks).toHaveCSS('max-height', 'none');
        expect(
          await risks.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
        ).toBe(true);
        const lastRisk = risks.locator('li').last();
        await lastRisk.scrollIntoViewIfNeeded();
        await expect(lastRisk).toBeInViewport();
        await expect(lastRisk).toContainText('风险原文'.repeat(80));
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
    }
  });
}

test('keeps grouped tabs fresh, defaults all acceptance items open and cancels stale previews', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const refs = Array.from({ length: 12 }, (_, i) => ({
    key: `document-${i + 1}`,
    label: `文档 ${i + 1}`,
    path: `document-${i + 1}.md`,
  }));
  const changes = ['first', 'second'].map((name, index) => ({
    ...source,
    name: `tab-${name}`,
    locator: `local:tab-${name}`,
    children: [],
    acceptance: { total: 12, passed: 3, failed: 3, blocked: 3, pending: 3 },
    acceptanceItems: Array.from({ length: 12 }, (_, i) => ({
      id: `A${i + 1}`,
      text: `${name} 验收条目 ${i + 1}`,
      result: ['passed', 'failed', 'blocked', 'pending'][i % 4],
    })),
    builderHandoff: { iteration: index + 1, summary: { text: `${name} 交接详情` } },
    verification: {
      candidateId: `${name}-candidate`,
      iteration: index + 1,
      attempt: 1,
      assurance: 'host-attested',
      summary: { text: `${name} 验证结论` },
      risks: [],
    },
    history: Array.from({ length: 50 }, (_, i) => ({
      goalCycle: 1,
      iteration: i + 1,
      attempt: 1,
      outcome: 'recovery',
      summary: { text: `${name} 执行记录 ${i + 1}` },
      completedAt: '2026-08-09T00:00:00.000Z',
    })),
    artifactReferences: refs,
    artifacts: refs
      .slice(0, 8)
      .map((x) => ({ ...x, exists: true, content: `# ${name} 已预读文档` })),
  }));
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let artifactRequests = 0;
  let released = false;
  await mockNativeDetail(page, changes, async () => {
    artifactRequests += 1;
    await gate;
    released = true;
  });
  const detail = page.locator('.native-change-detail');
  const tab = (name: string) => detail.getByRole('tab', { name: new RegExp(`${name}$`) });
  await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
  await tab('验收状态').click();
  const acceptance = detail.locator('.native-acceptance-card');
  await expect(acceptance.locator('li')).toHaveCount(12);
  await expect(acceptance.locator('details')).toHaveCount(0);
  const acceptanceItems = acceptance.getByRole('region', { name: '完整验收条目', exact: true });
  await acceptanceItems.focus();
  await acceptanceItems.press('End');
  await expect(acceptanceItems.locator('li').last()).toBeInViewport();
  await tab('验收状态').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(tab('变更详情')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: '执行与恢复内容', exact: true })).toContainText(
    'first 交接详情',
  );
  await tab('变更详情').press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(tab('验收状态')).toHaveAttribute('aria-selected', 'true');
  await tab('验收状态').press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
  await expect(detail.getByRole('region', { name: '当前阻塞内容', exact: true })).toBeVisible();
  await tab('当前阻塞').press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(tab('执行历史')).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.native-history-card')).toContainText('first 执行记录');
  await expect(detail.locator('.native-history-card ol > li')).toHaveCount(50);
  await expect(detail.locator('.native-history-card details')).toHaveCount(0);
  await tab('变更详情').click();
  await page.locator('.native-change-row').filter({ hasText: 'tab-second' }).click();
  await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
  await tab('变更详情').click();
  await expect(page.getByRole('region', { name: '执行与恢复内容', exact: true })).toContainText(
    'second 交接详情',
  );
  await expect(detail).not.toContainText('first 交接详情');
  await tab('验收状态').click();
  await expect(acceptance.locator('li')).toHaveCount(12);
  await expect(acceptance).toContainText('second 验收条目 12');
  await expect(acceptance).not.toContainText('first 验收条目');
  await expect(detail.locator('.native-verification-binding')).toContainText('second-candidate');
  await tab('变更详情').click();
  await expect(detail.locator('.native-artifacts-card details')).toHaveCount(0);
  await expect(detail.locator('.native-artifact-row')).toHaveCount(12);
  await detail.getByRole('button', { name: /document-12/ }).click();
  await expect.poll(() => artifactRequests).toBe(1);
  await tab('执行历史').click();
  await expect(detail.locator('.native-history-card')).toContainText('second 执行记录');
  await expect(detail).not.toContainText('first 执行记录');
  await tab('变更详情').click();
  await page.locator('.native-change-row').filter({ hasText: 'tab-first' }).click();
  await expect(tab('当前阻塞')).toHaveAttribute('aria-selected', 'true');
  await tab('变更详情').click();
  await expect(
    detail.getByRole('heading', { name: '当前变更 · tab-first', exact: true }),
  ).toBeVisible();
  release();
  await expect.poll(() => released).toBe(true);
  await page.waitForTimeout(60);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await detail.getByRole('button', { name: /document-1\s/ }).click();
  const preview = page.getByRole('dialog', { name: '产物预览：文档 1', exact: true });
  await expect(preview).toContainText('first 已预读文档');
  await expect(preview).not.toContainText('second 已预读文档');
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  expect(artifactRequests).toBe(1);
  await tab('验收状态').click();
  await expect(acceptance.locator('li')).toHaveCount(12);
  await expect(acceptance).toContainText('first 验收条目 12');
  await expect(detail.locator('.native-verification-binding')).toContainText('first-candidate');
  await expect(detail.locator('.native-verification-binding')).not.toContainText(
    'second-candidate',
  );
  await expect(detail).not.toContainText('上一轮候选结果 · 修复中');
});

test('shows only provided verification fields without inferring a prior repair result', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const results = [
    { name: 'summary-only', verification: { summary: { text: '已有验证摘要' }, risks: [] } },
    {
      name: 'partial-round',
      verification: { iteration: 2, summary: { text: '仅提供验证轮次' }, risks: [] },
    },
    {
      name: 'current-result',
      verification: {
        candidateId: 'current-candidate',
        iteration: 3,
        attempt: 1,
        summary: { text: '当前轮次摘要' },
        risks: [],
      },
    },
    {
      name: 'older-result',
      verification: {
        candidateId: 'older-candidate',
        iteration: 1,
        attempt: 1,
        summary: { text: '更早轮次摘要' },
        risks: [],
      },
    },
  ];
  await mockNativeDetail(
    page,
    results.map((result) => ({
      ...source,
      ...result,
      locator: `local:${result.name}`,
      children: [],
      phase: 'build',
      loop: { ...source.loop, iteration: 3, stage: 'repairing' },
    })),
  );
  const detail = page.locator('.native-change-detail');
  const checks = detail.locator('.native-verification-card');
  for (const [index, result] of results.entries()) {
    if (index > 0) {
      await page.locator('.native-change-row').filter({ hasText: result.name }).click();
    }
    await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
    await expect(detail.locator('h4')).toHaveText(['验收状态', '检查结果']);
    await expect(checks).toContainText(result.verification.summary.text);
    await expect(checks).not.toContainText('未提供');
    await expect(checks).not.toContainText('上一轮候选结果 · 修复中');
    await expect(checks).not.toContainText('持久化验证结果，不代表');
    if (index === 0) {
      await expect(checks.locator('.native-verification-binding')).toHaveCount(0);
    } else if (index === 1) {
      await expect(checks.locator('.native-verification-binding')).toHaveText('验证轮次：2');
    } else {
      await expect(checks).toContainText(result.verification.candidateId!);
    }
  }
});

test('distinguishes unavailable acceptance from command failures and workflow blocker counts', async ({
  page,
}) => {
  const source = structuredClone(DEMO_SNAPSHOT.native.changes[0]);
  const changes = [
    {
      ...source,
      name: 'unknown-acceptance',
      locator: 'local:unknown-acceptance',
      children: [],
      acceptance: null,
      acceptanceItems: [],
      verification: null,
      verificationResult: 'pending',
      checks: [],
      builderHandoff: null,
      history: [],
      historyOverflow: { droppedEntries: 0 },
    },
    {
      ...source,
      name: 'counted-acceptance',
      locator: 'local:counted-acceptance',
      children: [],
      acceptance: { total: 4, passed: 0, failed: 1, blocked: 2, pending: 1 },
      checks: Array.from({ length: 5 }, (_, i) => ({
        id: `C${i}`,
        name: { text: `命令 ${i}` },
        status: 'failed',
        durationMs: 1,
        exitCode: 1,
      })),
      blockers: Array.from({ length: 3 }, (_, i) => ({
        owner: 'runtime',
        reason: { text: `工作流阻塞 ${i}` },
        acceptanceIds: [],
        resolutionAction: 'wait-external',
      })),
    },
  ];
  await mockNativeDetail(page, changes);
  const detail = page.locator('.native-change-detail');
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await expect(detail.locator('.native-acceptance-card .ant-statistic-content-value')).toHaveText([
    '—',
    '—',
    '—',
    '—',
  ]);
  await expect(detail).toContainText('无可移植验收数据');
  await expect(detail.locator('.native-verification-binding')).toHaveCount(0);
  await expect(detail.locator('.native-verification-card')).toContainText('尚无 Verifier 结论。');
  await expect(detail.locator('.native-verification-card')).toContainText('尚无持久化检查摘要。');
  await expect(detail).not.toContainText('持久化验证结果，不代表');
  await detail.getByRole('tab', { name: '变更详情', exact: true }).click();
  await expect(page.getByRole('region', { name: '执行与恢复内容', exact: true })).toContainText(
    '尚无 Builder 交接详情',
  );
  await detail.getByRole('tab', { name: '执行历史', exact: true }).click();
  await expect(detail).toContainText('尚无完成的循环记录');
  await page.locator('.native-change-row').filter({ hasText: 'counted-acceptance' }).click();
  await detail.getByRole('tab', { name: '验收状态', exact: true }).click();
  await expect(detail.locator('.native-acceptance-card')).toContainText('75% 已处理');
  await expect(detail.locator('.native-acceptance-card .ant-statistic-content-value')).toHaveText([
    '0',
    '1',
    '2',
    '1',
  ]);
});
