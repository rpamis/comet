import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'default' });

type Workflow = 'classic' | 'native';
type RepositoryGitFixture = {
  branch: string;
  head: string;
  dirtyFiles: number | null;
  dirtyFileList: string[];
  recentCommits: string[];
  recentCommitsHasMore?: boolean;
  dirtyFileListHasMore?: boolean;
};
type GitListKind = 'commits' | 'files';
type GitPageRequest = { kind: GitListKind; cursor: string | null; limit: string | null };
type GitFixtureOptions = {
  previewOnly?: boolean;
  failOnce?: { kind: GitListKind; cursor: string | null; status?: number };
};
type ClassicFixtureOptions = { empty?: boolean; holdDetail?: boolean };
type CopyFallbackFixture = {
  succeeds: boolean;
  writeAttempts: string[];
  calls: Array<{ command: string; text: string | null; inDialog: boolean }>;
};

const shortClassic = {
  command: 'pnpm test -- classic-short',
  reason: '验证当前变更。',
  description: '记录验证结果。',
};
const longClassic = {
  command: [
    'pnpm exec node scripts/check.mjs \\',
    '  --change classic-long \\',
    '  --format json',
  ].join('\n'),
  reason: Array.from(
    { length: 10 },
    (_, index) => `原因 ${index + 1}：保留原始换行，检查当前候选的验证证据与未完成事项。`,
  ).join('\n'),
  description: Array.from(
    { length: 24 },
    (_, index) =>
      `步骤 ${index + 1}：完成本组检查后记录命令、结果和失败原因，再继续下一组。${'无空格长说明'.repeat(10)}`,
  ).join('\n'),
};
const longNativeAction = [
  '先核对当前 YAML，再继续执行。',
  '',
  '需要保留完整的中文建议与执行条件'.repeat(70),
  'ContinueVerificationWithoutDroppingAnyUnbrokenEnglishInstruction'.repeat(55),
  '',
  '最后一步：记录真实检查结果。',
].join('\n');
const longMigration = [
  '迁移前先保存当前状态。',
  '',
  '迁移说明必须完整保留每一项条件与恢复依据'.repeat(70),
  'MigrationRequiresTheCompleteUnbrokenEnglishExplanation'.repeat(55),
  '',
  '迁移说明结束。',
].join('\n');
const shortClassicText = [
  `$ ${shortClassic.command}`,
  shortClassic.reason,
  shortClassic.description,
].join('\n');
const longClassicText = [
  `$ ${longClassic.command}`,
  longClassic.reason,
  longClassic.description,
].join('\n');
const defaultRepositoryGit: RepositoryGitFixture = {
  branch: 'fixture',
  head: 'abc1234',
  dirtyFiles: 0,
  dirtyFileList: [],
  recentCommits: [],
};
const longRepositoryGit: RepositoryGitFixture = {
  branch: `feature/dashboard-repository-context/${'LongUnbrokenBranchSegment'.repeat(12)}`,
  head: 'abcdef0123456789'.repeat(4),
  dirtyFiles: 6,
  dirtyFileList: [
    ...Array.from(
      { length: 5 },
      (_, index) =>
        ` M domains/dashboard/${'long-directory-with-complete-path/'.repeat(5)}file-${index + 1}-${'完整文件路径'.repeat(8)}.jsx`,
    ),
    '?? omitted-after-fifth.txt',
  ],
  recentCommits: Array.from(
    { length: 8 },
    (_, index) =>
      `commit-${String(index + 1).padStart(2, '0')} ${'保留提交消息条件'.repeat(7)}${'CompleteUnbrokenSubject'.repeat(3)}`,
  ),
};

function repositoryGitFixture(commits: number, files: number): RepositoryGitFixture {
  return {
    branch: 'feature/git-list-pagination',
    head: 'abcdef0123456789',
    dirtyFiles: files,
    recentCommits: Array.from(
      { length: commits },
      (_, index) =>
        `commit-${String(index + 1).padStart(2, '0')} 完整提交说明：${'保留提交条件和验证依据。'.repeat(5)}`,
    ),
    dirtyFileList: Array.from(
      { length: files },
      (_, index) =>
        ` M domains/dashboard/${'完整目录路径/'.repeat(6)}file-${String(index + 1).padStart(2, '0')}.jsx`,
    ),
  };
}

function classicChange(
  name: string,
  next: typeof shortClassic | null,
  risks: Array<Record<string, string>> = [],
) {
  return {
    id: name,
    locator: name,
    name,
    displayName: name,
    status: 'active',
    workflow: 'feature',
    phase: 'build',
    updatedAt: '2026-10-10T00:00:00.000Z',
    relativePath: `openspec/changes/${name}`,
    dir: `openspec/changes/${name}`,
    changesRelative: 'openspec/changes',
    tasks: { completed: 0, total: 1, incomplete: [], sections: [] },
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
    next,
    risks,
  };
}

function nativeChange(
  name: string,
  nextAction: string | null,
  migration = { status: 'none', message: null as string | null },
) {
  return {
    workflow: 'native',
    locator: name,
    name,
    status: 'active',
    phase: 'build',
    lifecycleStatus: 'active',
    stateVersion: 2,
    legacy: false,
    migration,
    loop: {
      stage: 'building',
      goalCycle: 1,
      iteration: 1,
      attempt: 1,
      actor: 'builder',
      nextAction,
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
      recoverableFromStage: null,
    },
    children: [],
    artifacts: [],
    specs: {
      total: 0,
      create: 0,
      modify: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [],
    builderHandoff: null,
    verification: null,
    checks: [],
    blockers: [] as Array<{
      owner: string;
      reason: { text: string };
      acceptanceIds: string[];
      resolutionAction: string;
    }>,
    history: [],
    historyOverflow: {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  };
}

async function installSuggestionFixture(
  page: Page,
  workflow: Workflow = 'classic',
  git: RepositoryGitFixture = defaultRepositoryGit,
  gitOptions: GitFixtureOptions = {},
  classicOptions: ClassicFixtureOptions = {},
) {
  const gitRequests: GitPageRequest[] = [];
  let overviewRequests = 0;
  let gitFailureDelivered = false;
  let releaseClassicDetail = () => {};
  const classicDetailGate = new Promise<void>((resolve) => {
    releaseClassicDetail = resolve;
  });
  const gitSnapshot = gitOptions.previewOnly
    ? {
        ...git,
        recentCommits: git.recentCommits.slice(0, 5),
        dirtyFileList: git.dirtyFileList.slice(0, 5),
        recentCommitsHasMore: git.recentCommits.length > 5,
        dirtyFileListHasMore: git.dirtyFileList.length > 5,
      }
    : git;
  const classic = [
    classicChange('classic-short', shortClassic),
    classicChange('classic-long', longClassic),
    classicChange('classic-fallback', null),
    classicChange(
      'classic-risks',
      shortClassic,
      Array.from({ length: 10 }, (_, index) => {
        const code = `risk-${String(index + 1).padStart(2, '0')}`;
        return {
          code,
          level: index % 2 === 0 ? 'warning' : 'error',
          message: [
            `风险 ${index + 1}：需要核对当前候选的完整说明，补齐检查证据后记录真实结果。`,
            `处理条件：${'保留完整风险原文与处理依据。'.repeat(3)}`,
            `结束标记：${code.toUpperCase()}`,
          ].join('\n'),
        };
      }),
    ),
  ];
  const native = [
    nativeChange('native-next-action', longNativeAction),
    nativeChange('native-migration', '这一条被迁移建议覆盖，不能显示为当前建议。', {
      status: 'required',
      message: longMigration,
    }),
    nativeChange('native-fallback', null),
    nativeChange('native-blockers', '先继续当前任务。'),
  ];
  classic[1].displayName = `classic-long-${'很长的变更标题'.repeat(24)}`;
  native[0].name = `native-next-action-${'LongUnbrokenChangeTitle'.repeat(24)}`;
  native[3].blockers = [
    {
      owner: 'builder',
      reason: { text: '阻塞一：缺少构建证据。' },
      acceptanceIds: ['A1'],
      resolutionAction: '补充证据',
    },
    {
      owner: 'verifier',
      reason: { text: `阻塞二：${'需要核对验收结果与处理说明'.repeat(16)}` },
      acceptanceIds: ['A1'],
      resolutionAction: '重新验证',
    },
  ];
  const classicPage = classicOptions.empty ? [] : classic;
  await page.route('**/api/dashboard/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/dashboard/projects') {
      await route.fulfill({
        json: {
          currentProjectId: 'suggestion-fixture',
          projects: [
            {
              id: 'suggestion-fixture',
              name: 'Suggestion fixture',
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
      overviewRequests += 1;
      await route.fulfill({
        json: {
          project: {
            name: 'Suggestion fixture',
            path: '/fixture',
            generatedAt: '2026-10-10T00:00:00.000Z',
          },
          summary: {
            activeChanges: classicPage.length,
            archivedChanges: 0,
            verifyFailed: 0,
            tasksIncomplete: classicPage.length > 0 ? 1 : 0,
            dirtyFiles: git.dirtyFiles,
          },
          initialChanges: {
            status: 'active',
            items: classicPage,
            total: classicPage.length,
            nextCursor: null,
          },
          native: {
            schema: 'comet.dashboard.native.v2',
            activeChangeCount: native.length,
            archivedChangeCount: 0,
            totalChangeCount: native.length,
            changes: [],
            visibleChangeCount: 0,
            omittedChangeCount: native.length,
            changesTruncated: true,
          },
          git: gitSnapshot,
          risks: [],
        },
      });
    } else if (/\/git\/(commits|files)$/.test(url.pathname)) {
      const kind: GitListKind = url.pathname.endsWith('/commits') ? 'commits' : 'files';
      const cursor = url.searchParams.get('cursor');
      const limit = url.searchParams.get('limit');
      gitRequests.push({ kind, cursor, limit });
      if (
        !gitFailureDelivered &&
        gitOptions.failOnce?.kind === kind &&
        gitOptions.failOnce.cursor === cursor
      ) {
        gitFailureDelivered = true;
        await route.fulfill({
          status: gitOptions.failOnce.status ?? 500,
          json: { error: 'fixture Git 第二批读取失败' },
        });
        return;
      }
      const items = kind === 'commits' ? git.recentCommits : git.dirtyFileList;
      const offset = cursor === null ? 0 : Number(cursor.replace(`${kind}:`, ''));
      if (
        limit !== '50' ||
        (cursor !== null && cursor !== `${kind}:${offset}`) ||
        !Number.isInteger(offset) ||
        offset < 0
      ) {
        await route.fulfill({ status: 400, json: { error: 'Invalid fixture Git page query' } });
        return;
      }
      const next = offset + 50;
      await route.fulfill({
        json: {
          items: items.slice(offset, next),
          nextCursor: next < items.length ? `${kind}:${next}` : null,
          total: kind === 'commits' ? null : items.length,
        },
      });
    } else if (url.pathname.endsWith('/native-changes') || url.pathname.endsWith('/changes')) {
      const items = url.pathname.endsWith('/native-changes') ? native : classicPage;
      await route.fulfill({
        json: { status: 'active', items, total: items.length, nextCursor: null },
      });
    } else if (url.pathname.endsWith('/native-change') || url.pathname.endsWith('/change')) {
      if (classicOptions.holdDetail && url.pathname.endsWith('/change')) {
        await classicDetailGate;
      }
      const items = url.pathname.endsWith('/native-change') ? native : classic;
      const key =
        url.searchParams.get('changeLocator') ??
        url.searchParams.get('changeId') ??
        url.searchParams.get('changeName');
      await route.fulfill({ json: items.find((item) => item.locator === key) ?? items[0] });
    } else if (url.pathname.endsWith('/plugins')) {
      await route.fulfill({ json: { pages: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  return {
    classic,
    native,
    git,
    gitRequests,
    releaseClassicDetail,
    overviewRequestCount: () => overviewRequests,
  };
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
    await page
      .getByRole('button', {
        name: theme === 'dark' ? '切换到暗色模式' : '切换到亮色模式',
        exact: true,
      })
      .click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function selectChange(page: Page, workflow: Workflow, name: string) {
  const row = page
    .locator(workflow === 'classic' ? '.dashboard-change-row' : '.native-change-row')
    .filter({ hasText: name });
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dashboard-change-detail-title')).toContainText(name);
  // Tooltip 初次测量会暂时移到视口外；先确认它已出现并完成定位。
  const tooltip = page.locator('.ant-tooltip:visible').filter({ hasText: name });
  await expect(tooltip).toBeVisible();
  await expect
    .poll(() =>
      tooltip.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
}

async function expectHeaderPreview(page: Page, long: boolean) {
  const suggestion = page.locator('.dashboard-change-suggestion');
  const preview = suggestion.locator('.dashboard-suggestion-preview');
  const expand = suggestion.getByRole('button', { name: '展开完整下一步建议', exact: true });
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toHaveAttribute('role', 'status');
  await expect(suggestion).toHaveAttribute('aria-label', '工作流建议');
  await expect(suggestion.getByRole('button')).toHaveCount(1);
  await expect(expand).toHaveClass('dashboard-suggestion-trigger');
  await expect(expand).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(expand.locator('svg, .anticon, [role="img"]')).toHaveCount(0);
  await expect(expand).toBeVisible();
  await page.mouse.move(0, 0);
  await page.getByPlaceholder('搜索变更、产物或文件…').focus();
  await expect(page.locator('.ant-tooltip:visible')).toHaveCount(0);
  const measure = () =>
    suggestion.evaluate((element) => {
      const detail = element.closest('.dashboard-change-detail')!;
      const head = detail.querySelector('.ant-card-head')!;
      const classicShell = detail.closest('.classic-change-shell');
      const heading = detail
        .querySelector('.dashboard-change-detail-heading')!
        .getBoundingClientRect();
      const title = detail.querySelector('.dashboard-change-detail-title')!.getBoundingClientRect();
      const container = detail.querySelector('.ant-card-head-title')!;
      const meta = detail.querySelector('.dashboard-change-detail-meta')!.getBoundingClientRect();
      const phase = detail.querySelector('.dashboard-phase-progress')!.getBoundingClientRect();
      const preview = element.querySelector<HTMLElement>('.dashboard-suggestion-preview')!;
      const button = element.querySelector<HTMLButtonElement>('.dashboard-suggestion-trigger')!;
      const buttonBox = button.getBoundingClientRect();
      const suggestionTitle = element.querySelector<HTMLElement>('.dashboard-suggestion-heading')!;
      const box = element.getBoundingClientRect();
      const previewBox = preview.getBoundingClientRect();
      return {
        classicHeaderAligned:
          !classicShell ||
          innerWidth <= 760 ||
          Math.abs(
            classicShell
              .querySelector('.classic-changes-explorer .ant-tabs-nav')!
              .getBoundingClientRect().bottom - head.getBoundingClientRect().bottom,
          ) <= 1,
        inline: container.getBoundingClientRect().width >= 680,
        besideHeading: box.left >= heading.right - 1,
        leftShare: heading.width / container.getBoundingClientRect().width,
        dividerWidth: getComputedStyle(detail.querySelector('.dashboard-change-detail-heading')!)
          .borderRightWidth,
        background: getComputedStyle(element).backgroundColor,
        radius: getComputedStyle(element).borderRadius,
        headingTopDifference: Math.abs(box.top - heading.top),
        headingHeight: heading.height,
        titleHeight: title.height,
        metaHeight: meta.height,
        suggestionHeight: box.height,
        headHeight: head.getBoundingClientRect().height,
        headPadding:
          Number.parseFloat(getComputedStyle(head).paddingTop) +
          Number.parseFloat(getComputedStyle(head).paddingBottom),
        afterMeta: box.top >= meta.bottom - 1,
        beforePhase: box.bottom <= phase.top + 1,
        previewHeight: previewBox.height,
        lineHeight: Number.parseFloat(getComputedStyle(preview).lineHeight),
        previewWhiteSpace: getComputedStyle(preview).whiteSpace,
        previewTextOverflow: getComputedStyle(preview).textOverflow,
        previewOverflowX: getComputedStyle(preview).overflowX,
        previewInsideButton:
          previewBox.left >= buttonBox.left - 1 && previewBox.right <= buttonBox.right + 1,
        previewHasLineBreak: /[\r\n]/.test(preview.textContent ?? ''),
        clipped: preview.scrollWidth > preview.clientWidth + 1,
        titleFontSize: getComputedStyle(suggestionTitle).fontSize,
        titleFontWeight: Number.parseInt(getComputedStyle(suggestionTitle).fontWeight, 10),
        buttonTag: button.tagName,
        buttonCursor: getComputedStyle(button).cursor,
        buttonInsets: [
          buttonBox.left - box.left,
          buttonBox.top - box.top,
          box.right - buttonBox.right,
          box.bottom - buttonBox.bottom,
        ],
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        overflowElements: Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 12)
          .map((node) => ({
            className: node.className,
            right: node.getBoundingClientRect().right,
            text: node.textContent?.slice(0, 60),
          })),
      };
    });
  let layout = await measure();
  await expect
    .poll(async () => {
      layout = await measure();
      return (
        !layout.pageOverflow &&
        layout.classicHeaderAligned &&
        layout.dividerWidth === (layout.inline ? '1px' : '0px') &&
        (layout.inline ? layout.besideHeading : layout.afterMeta)
      );
    })
    .toBe(true);
  if (layout.inline) {
    expect(layout.besideHeading).toBe(true);
    expect(layout.leftShare).toBeCloseTo(0.35, 2);
    expect(layout.dividerWidth).toBe('1px');
    expect(layout.headingTopDifference).toBeLessThanOrEqual(1);
    expect(layout.headingHeight).toBe(50);
    expect(layout.titleHeight).toBe(24);
    expect(layout.metaHeight).toBe(18);
    expect(layout.suggestionHeight).toBe(50);
    expect(layout.headHeight).toBe(layout.headPadding + 50 + 1);
  } else {
    expect(layout.afterMeta).toBe(true);
    expect(layout.dividerWidth).toBe('0px');
  }
  expect(layout.background).toBe('rgba(0, 0, 0, 0)');
  expect(layout.radius).toBe('0px');
  expect(layout.beforePhase).toBe(true);
  expect(layout.lineHeight).toBeGreaterThan(0);
  expect(layout.previewHeight).toBeLessThanOrEqual(layout.lineHeight + 1);
  expect(layout.previewWhiteSpace).toBe('nowrap');
  expect(layout.previewTextOverflow).toBe('ellipsis');
  expect(layout.previewOverflowX).toBe('hidden');
  expect(layout.previewInsideButton).toBe(true);
  expect(layout.previewHasLineBreak).toBe(false);
  expect(layout.titleFontSize).toBe('14px');
  expect(layout.titleFontWeight).toBeGreaterThanOrEqual(600);
  expect(layout.buttonTag).toBe('BUTTON');
  expect(layout.buttonCursor).toBe('pointer');
  expect(layout.pageOverflow, JSON.stringify(layout.overflowElements)).toBe(false);
  for (const inset of layout.buttonInsets) expect(Math.abs(inset)).toBeLessThanOrEqual(1);
  if (long) expect(layout.clipped).toBe(true);
  const paint = () =>
    expand.evaluate((element) => {
      const title = element.querySelector('.dashboard-suggestion-heading')!;
      const preview = element.querySelector('.dashboard-suggestion-preview')!;
      return [
        getComputedStyle(element).backgroundColor,
        getComputedStyle(title).color,
        getComputedStyle(preview).color,
        getComputedStyle(title).textDecorationLine,
        getComputedStyle(preview).textDecorationLine,
      ];
    });
  const restingPaint = await paint();
  await expand.hover();
  await expect.poll(paint).not.toEqual(restingPaint);
  expect(
    await expand.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [
        [2, 2],
        [box.width - 2, 2],
        [2, box.height - 2],
        [box.width - 2, box.height - 2],
        [box.width / 2, box.height / 2],
      ].every(([x, y]) => element.contains(document.elementFromPoint(box.left + x, box.top + y)));
    }),
  ).toBe(true);
  await page.mouse.move(0, 0);
  await page.getByPlaceholder('搜索变更、产物或文件…').focus();
  await page.keyboard.press('Tab');
  await expand.focus();
  await expect(expand).toBeFocused();
  const focus = await expand.evaluate((element) => ({
    visible: element.matches(':focus-visible'),
    width: Number.parseFloat(getComputedStyle(element).outlineWidth),
    style: getComputedStyle(element).outlineStyle,
  }));
  expect(focus.visible).toBe(true);
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.style).not.toBe('none');
  await expect(page.locator('.change-guidance .dashboard-change-suggestion')).toHaveCount(0);
  expect((await page.locator('.change-guidance').allTextContents()).join('')).not.toContain(
    '下一步建议',
  );
  return { preview, expand };
}

async function stableModalBody(dialog: Locator) {
  const body = dialog.locator('.ant-modal-body');
  await expect(dialog).not.toHaveClass(/(?:^|\s)ant-zoom-(?:appear|enter)(?:-\S+)?(?:\s|$)/);
  await expect
    .poll(() =>
      body.evaluate(async (element) => {
        const measure = () => {
          const box = element.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        };
        const boxes = [measure()];
        for (let frame = 0; frame < 2; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          boxes.push(measure());
        }
        const [x, y, width, height] = boxes[2];
        return {
          stable: boxes.every((box) =>
            box.every((value, index) => Math.abs(value - boxes[0][index]) <= 0.5),
          ),
          visible: width > 0 && height > 0,
          insideViewport:
            x >= -1 && y >= -1 && x + width <= innerWidth + 1 && y + height <= innerHeight + 1,
        };
      }),
    )
    .toEqual({ stable: true, visible: true, insideViewport: true });
  return body;
}

async function expectFullText(dialog: Locator, expectedText: string, scrolls: boolean) {
  await dialog.page().mouse.move(0, 0);
  await dialog.getByRole('button', { name: '复制完整建议', exact: true }).focus();
  await expect(dialog.page().locator('.ant-tooltip:visible')).toHaveCount(0);
  const full = dialog.locator('.dashboard-suggestion-full-text');
  await expect(full).toBeVisible();
  const text = await full.textContent();
  expect(text, '全文应完整保留字段顺序和原换行').toBe(expectedText);
  const layout = await full.evaluate((element) => {
    let scrollRoot: Element | null = element;
    const dialog = element.closest('[role=dialog]')!;
    let scrolls = false;
    while (scrollRoot && dialog.contains(scrollRoot)) {
      if (
        /^(auto|scroll)$/.test(getComputedStyle(scrollRoot).overflowY) &&
        scrollRoot.scrollHeight > scrollRoot.clientHeight + 1
      )
        scrolls = true;
      scrollRoot = scrollRoot.parentElement;
    }
    return {
      whiteSpace: getComputedStyle(element).whiteSpace,
      overflowX: element.scrollWidth > element.clientWidth + 1,
      scrolls,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(['pre-wrap', 'break-spaces']).toContain(layout.whiteSpace);
  expect(layout.overflowX).toBe(false);
  expect(layout.pageOverflow).toBe(false);
  if (scrolls) {
    expect(layout.scrolls).toBe(true);
    const body = await stableModalBody(dialog);
    await body.hover();
    await dialog.page().mouse.wheel(0, 240);
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  return text!;
}

async function openCopyAndClose(page: Page, expand: Locator, expectedText: string, long: boolean) {
  await expand.focus();
  await expect(expand).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
  await expect(dialog).toBeVisible();
  await expect(expand).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('button', { name: '全屏展示', exact: true })).toHaveCount(0);
  const fullText = await expectFullText(dialog, expectedText, long);
  const copy = dialog.getByRole('button', { name: '复制完整建议', exact: true });
  await copy.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(copy).toBeFocused();
  for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key);
    const focus = await dialog.evaluate((element) => ({
      contained: element.contains(document.activeElement),
      active: document.activeElement?.outerHTML.slice(0, 500),
      documentFocused: document.hasFocus(),
      wrapperPosition: getComputedStyle(element.closest('.ant-modal-wrap')!).position,
    }));
    expect(focus.contained, JSON.stringify({ key, ...focus })).toBe(true);
  }
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(fullText);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
}

async function expectClassicRiskScrolling(workspace: Locator, card: Locator, lastCode: string) {
  const content = card.getByRole('region', { name: '风险提示内容', exact: true });
  await expect(content).toHaveClass('classic-risk-content');
  await expect(content).toHaveAttribute('tabindex', '0');
  const capacity = await content.evaluate((element) => {
    const style = getComputedStyle(element);
    const scrollbar = getComputedStyle(element, '::-webkit-scrollbar');
    return {
      overflowY: style.overflowY,
      overflow: element.scrollHeight > element.clientHeight + 1,
      scrollbarWidth: style.scrollbarWidth,
      webkitScrollbar: {
        display: scrollbar.display,
        width: scrollbar.width,
        height: scrollbar.height,
      },
    };
  });
  expect(capacity).toEqual({
    overflowY: 'auto',
    overflow: true,
    scrollbarWidth: 'none',
    webkitScrollbar: { display: 'none', width: '0px', height: '0px' },
  });
  await card.scrollIntoViewIfNeeded();
  await content.focus();
  await expect(content).toBeFocused();
  await content.hover();
  const header = card.locator(':scope > div:first-child');
  await expect(header).toBeInViewport();
  const fixedLayout = () =>
    workspace.evaluate((element) => {
      const selectors = [
        '.classic-change-risks > article > div:first-child',
        '.dashboard-change-detail',
        '.dashboard-phase-progress',
        '.change-detail-panels',
      ];
      return {
        pageScrollY: window.scrollY,
        bounds: selectors.map((selector) => {
          const node = element.querySelector(selector);
          if (!node) throw new Error(`Missing fixed Classic layout element: ${selector}`);
          const box = node.getBoundingClientRect();
          return [box.x, box.y, box.width, box.height];
        }),
      };
    });
  const before = await fixedLayout();
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
  await workspace.page().mouse.wheel(0, 240);
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await fixedLayout()).toEqual(before);
  await content.press('Home');
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
  await content.press('PageDown');
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await fixedLayout()).toEqual(before);
  await content.press('End');
  await expect
    .poll(() =>
      content.evaluate(
        (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  const last = content.getByText(lastCode, { exact: true });
  await expect(last).toBeInViewport();
  expect(
    await last.evaluate((element) => {
      const content = element.closest('.classic-risk-content')!;
      const box = element.getBoundingClientRect();
      const clip = content.getBoundingClientRect();
      return (
        box.top >= clip.top - 1 &&
        box.bottom <= clip.bottom + 1 &&
        content.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
        )
      );
    }),
  ).toBe(true);
  expect(await fixedLayout()).toEqual(before);
}

async function expectClassicShellSurface(page: Page) {
  const shell = page.locator(
    '.classic-change-workspace > .classic-change-overview > .classic-change-shell.dashboard-master-detail',
  );
  await expect(shell).toHaveCount(1);
  await expect(shell.locator(':scope > .dashboard-workspace-left')).toHaveCount(1);
  await expect(shell.locator(':scope > .dashboard-workspace-center')).toHaveCount(1);
  await expect(shell.locator('.classic-change-shell')).toHaveCount(0);
  await expect
    .poll(() =>
      shell.evaluate((element) => {
        if (innerWidth <= 760) return true;
        const detail = element.querySelector('.dashboard-change-detail')!;
        const explorer = element.querySelector('.dashboard-changes-explorer')!;
        const expected = Math.max(
          Math.min(720, innerHeight * 0.75),
          Math.ceil(detail.getBoundingClientRect().height + 2),
        );
        return (
          Math.abs(element.getBoundingClientRect().height - expected) <= 1 &&
          Math.abs(explorer.getBoundingClientRect().height - (expected - 2)) <= 1 &&
          Math.abs(
            explorer.querySelector('.ant-tabs-nav')!.getBoundingClientRect().bottom -
              detail.querySelector(':scope > .ant-card-head')!.getBoundingClientRect().bottom,
          ) <= 1
        );
      }),
    )
    .toBe(true);
  const surface = await shell.evaluate((element) => {
    const required = (selector: string) => {
      const node = element.querySelector<HTMLElement>(selector);
      if (!node) throw new Error(`Missing shared Classic surface: ${selector}`);
      return node;
    };
    const border = (node: Element) => {
      const style = getComputedStyle(node);
      return [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ];
    };
    const left = required(':scope > .dashboard-workspace-left');
    const center = required(':scope > .dashboard-workspace-center');
    const explorer = required('.dashboard-changes-explorer');
    const detail = required('.dashboard-change-detail');
    return {
      shellBorder: border(element),
      shellRadius: getComputedStyle(element).borderRadius,
      leftBorder: border(left),
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      nestedSurfaces: [explorer, detail].map((node) => ({
        border: border(node),
        radius: getComputedStyle(node).borderRadius,
        background: getComputedStyle(node).backgroundColor,
        shadow: getComputedStyle(node).boxShadow,
      })),
      outerOverflow: [element, left, center].map((node) => ({
        x: getComputedStyle(node).overflowX,
        y: getComputedStyle(node).overflowY,
        scrollTop: node.scrollTop,
        scrollLeft: node.scrollLeft,
      })),
      shellFits:
        element.scrollHeight <= element.clientHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const stacked = page.viewportSize()!.width <= 760;
  expect(surface.shellBorder).toEqual(['1px', '1px', '1px', '1px']);
  expect(surface.shellRadius).toBe('12px');
  expect(surface.leftBorder).toEqual(
    stacked ? ['0px', '0px', '1px', '0px'] : ['0px', '1px', '0px', '0px'],
  );
  expect(surface.columns).toBe(stacked ? 1 : 2);
  expect(surface.nestedSurfaces).toEqual(
    Array.from({ length: 2 }, () => ({
      border: ['0px', '0px', '0px', '0px'],
      radius: '0px',
      background: 'rgba(0, 0, 0, 0)',
      shadow: 'none',
    })),
  );
  expect(surface.outerOverflow).toEqual([
    { x: 'hidden', y: 'hidden', scrollTop: 0, scrollLeft: 0 },
    { x: 'hidden', y: 'hidden', scrollTop: 0, scrollLeft: 0 },
    { x: 'visible', y: 'visible', scrollTop: 0, scrollLeft: 0 },
  ]);
  expect(surface.shellFits).toBe(true);
  expect(surface.pageOverflow).toBe(false);
  return shell;
}

async function expectClassicArtifactSlotsReachable(shell: Locator) {
  const artifacts = shell
    .getByRole('heading', { name: '关键产物', exact: true })
    .locator('xpath=ancestor::article[1]');
  const rows = artifacts.locator('.classic-artifact-row');
  const keys = [
    'proposal',
    'design',
    'tasks',
    'deltaSpec',
    'designDoc',
    'plan',
    'verifyReport',
    'cometYaml',
    'handoff',
    'checkpoint',
    'brainstorm',
    'subagentProgress',
  ];
  await expect(rows).toHaveCount(12);
  await expect(rows.locator(':scope > span:nth-child(2)')).toHaveText(keys);
  await expect(artifacts.locator(':scope > div:first-child')).toContainText('0/12');
  for (const [name, count] of [
    ['OpenSpec', 4],
    ['Superpowers', 3],
    ['Comet', 5],
  ] as const) {
    const group = artifacts.getByText(name, { exact: true }).locator('xpath=ancestor::div[2]');
    await expect(group.locator('.classic-artifact-row')).toHaveCount(count);
  }
  for (let index = 0; index < keys.length; index += 1) {
    const row = rows.nth(index);
    await expect(row).toBeDisabled();
    await expect(row).toContainText('未生成');
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeInViewport();
    expect(
      await row.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const shell = element.closest('.classic-change-shell')!.getBoundingClientRect();
        return (
          box.top >= shell.top + 1 &&
          box.bottom <= shell.bottom - 1 &&
          box.left >= shell.left + 1 &&
          box.right <= shell.right - 1 &&
          element.contains(
            document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
          )
        );
      }),
      keys[index],
    ).toBe(true);
  }
}

test('Classic header suggestions preview short and long commands and preserve the complete text through repeated keyboard dialogs', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await installSuggestionFixture(page);
  await page.goto('/');
  await setTheme(page, 'light');
  await selectChange(page, 'classic', 'classic-short');
  let controls = await expectHeaderPreview(page, false);
  await expect(controls.preview).toHaveText(shortClassicText.replace(/\s+/g, ' ').trim());
  await openCopyAndClose(page, controls.expand, shortClassicText, false);
  await controls.expand.focus();
  await page.keyboard.press('Space');
  let dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
  await expect(dialog).toBeVisible();
  await expect(controls.expand).toHaveAttribute('aria-expanded', 'true');
  await expectFullText(dialog, shortClassicText, false);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(controls.expand).toBeFocused();
  await expect(controls.expand).toHaveAttribute('aria-expanded', 'false');
  const area = (await controls.expand.boundingBox())!;
  await controls.expand.click({ position: { x: area.width - 2, y: area.height - 2 } });
  await expect(dialog).toBeVisible();
  await expectFullText(dialog, shortClassicText, false);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(controls.expand).toBeFocused();
  await selectChange(page, 'classic', 'classic-long');
  controls = await expectHeaderPreview(page, true);
  await expect(controls.preview).toHaveText(longClassicText.replace(/\s+/g, ' ').trim());
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'dark');
  await selectChange(page, 'classic', 'classic-long');
  controls = await expectHeaderPreview(page, true);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openCopyAndClose(page, controls.expand, longClassicText, true);
  }
  await selectChange(page, 'classic', 'classic-short');
  controls = await expectHeaderPreview(page, false);
  await controls.expand.click();
  dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
  await expectFullText(dialog, shortClassicText, false);
  await expect(dialog).not.toContainText(longClassic.reason);
  await page.keyboard.press('Escape');
});

test('long titles and suggestions switch between inline and stacked headers at the available-width boundary', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installSuggestionFixture(page);
  await page.goto('/');
  for (const workflow of ['classic', 'native'] as const) {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page
      .getByRole('tab', { name: workflow === 'classic' ? 'Classic 工作流' : 'Native 工作流' })
      .click();
    await setTheme(page, workflow === 'classic' ? 'light' : 'dark');
    await selectChange(
      page,
      workflow,
      workflow === 'classic' ? 'classic-long' : 'native-next-action',
    );
    for (const availableWidth of [679, 681, 679]) {
      const container = page.locator(
        '.dashboard-change-detail > .ant-card-head .ant-card-head-title',
      );
      const width = (await container.boundingBox())!.width;
      const viewport = page.viewportSize()!;
      await page.setViewportSize({
        ...viewport,
        width: Math.round(viewport.width + availableWidth - width),
      });
      expect(Math.abs((await container.boundingBox())!.width - availableWidth)).toBeLessThanOrEqual(
        1,
      );
      // 缩放时先将焦点移回顶栏，结束目录提示，再检查实际内容布局。
      await page.mouse.move(0, 0);
      await page.getByPlaceholder('搜索变更、产物或文件…').focus();
      await expect(page.locator('.ant-tooltip:visible')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await expectHeaderPreview(page, true);
      const afterMeta = await page.locator('.dashboard-change-suggestion').evaluate((element) => {
        const meta = element
          .closest('.dashboard-change-detail')!
          .querySelector('.dashboard-change-detail-meta')!;
        return element.getBoundingClientRect().top >= meta.getBoundingClientRect().bottom;
      });
      expect(afterMeta).toBe(availableWidth < 680);
    }
  }
});

test('Native header suggestions retain long unbroken next actions and migration messages across change switches and themes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await installSuggestionFixture(page, 'native');
  await page.goto('/');
  await setTheme(page, 'dark');
  await selectChange(page, 'native', 'native-next-action');
  let controls = await expectHeaderPreview(page, true);
  await expect(controls.preview).toHaveText(longNativeAction.replace(/\s+/g, ' ').trim());
  await openCopyAndClose(page, controls.expand, longNativeAction, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await setTheme(page, 'light');
  await selectChange(page, 'native', 'native-migration');
  controls = await expectHeaderPreview(page, true);
  await expect(controls.preview).toHaveText(longMigration.replace(/\s+/g, ' ').trim());
  await expect(controls.preview).not.toContainText('这一条被迁移建议覆盖');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await openCopyAndClose(page, controls.expand, longMigration, true);
  }
  await selectChange(page, 'native', 'native-next-action');
  controls = await expectHeaderPreview(page, true);
  await controls.expand.click();
  const dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
  await expectFullText(dialog, longNativeAction, true);
  await expect(dialog).not.toContainText('迁移说明结束');
  await page.keyboard.press('Escape');
});

test('both workflows expose their null-suggestion fallback in the same header preview and full-text dialog', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await installSuggestionFixture(page);
  await page.goto('/');
  for (const [workflow, name, fallback] of [
    ['classic', 'classic-fallback', '$ —\n暂无建议'],
    ['native', 'native-fallback', 'Runtime 将根据当前 YAML 状态继续执行。'],
  ] as const) {
    await page
      .getByRole('tab', {
        name: `${workflow === 'classic' ? 'Classic' : 'Native'} 工作流`,
        exact: true,
      })
      .click();
    await selectChange(page, workflow, name);
    const { preview, expand } = await expectHeaderPreview(page, false);
    await expect(preview).toHaveText(fallback.replace(/\s+/g, ' ').trim());
    await expand.click();
    const dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
    await expectFullText(dialog, fallback, false);
    await page.keyboard.press('Escape');
    await expect(expand).toBeFocused();
  }
});

test('suggestion copy falls back inside the dialog, restores focus, and reports a failed fallback without success feedback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state: CopyFallbackFixture = { succeeds: true, writeAttempts: [], calls: [] };
    (window as unknown as { suggestionCopyFixture: CopyFallbackFixture }).suggestionCopyFixture =
      state;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          state.writeAttempts.push(text);
          throw new Error('fixture clipboard unavailable');
        },
      },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (command: string) => {
        const input = document.querySelector<HTMLTextAreaElement>(
          '.dashboard-suggestion-modal textarea[readonly]',
        );
        state.calls.push({
          command,
          text: input?.value ?? null,
          inDialog: Boolean(input?.closest('[role="dialog"]')),
        });
        return state.succeeds;
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await installSuggestionFixture(page);
  await page.goto('/');
  await selectChange(page, 'classic', 'classic-long');
  const { expand } = await expectHeaderPreview(page, true);
  for (const succeeds of [true, false]) {
    await page.evaluate((succeeds) => {
      (
        window as unknown as { suggestionCopyFixture: CopyFallbackFixture }
      ).suggestionCopyFixture.succeeds = succeeds;
    }, succeeds);
    await expand.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: '完整下一步建议', exact: true });
    await expect(dialog).toBeVisible();
    const copy = dialog.getByRole('button', { name: '复制完整建议', exact: true });
    await copy.focus();
    await page.keyboard.press('Enter');
    if (succeeds) {
      await expect(copy).toHaveText('已复制');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
    } else {
      await expect(dialog.getByRole('alert')).toHaveText('复制失败，请选择全文手动复制。');
      await expect(copy).toHaveText('复制全文');
      await expect(dialog).not.toContainText('已复制');
    }
    await expect(copy).toBeFocused();
    await expect(dialog.locator('textarea')).toHaveCount(0);
    const attempts = await page.evaluate(
      () =>
        (window as unknown as { suggestionCopyFixture: CopyFallbackFixture }).suggestionCopyFixture,
    );
    expect(attempts.writeAttempts).toEqual(
      succeeds ? [longClassicText] : [longClassicText, longClassicText],
    );
    expect(attempts.calls).toEqual(
      Array.from({ length: succeeds ? 1 : 2 }, () => ({
        command: 'copy',
        text: longClassicText,
        inDialog: true,
      })),
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(expand).toBeFocused();
  }
});

test('Classic shared shell aligns with summary cards, separates Explorer and unboxed detail panels, and budgets context while Native blockers retain their full row', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await installSuggestionFixture(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  for (const [workflow, width, theme, columns] of [
    ['classic', 1600, 'light', 1],
    ['classic', 1280, 'dark', 1],
    ['classic', 1279, 'light', 1],
    ['classic', 1050, 'dark', 1],
    ['classic', 390, 'dark', 1],
    ['native', 1600, 'light', 2],
    ['native', 390, 'dark', 1],
  ] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setTheme(page, theme);
    const [populated, empty, heading, emptyText] =
      workflow === 'classic'
        ? ['classic-risks', 'classic-short', '风险提示', '当前未发现阻塞风险。']
        : ['native-blockers', 'native-fallback', '当前阻塞', '当前没有持久化阻塞项。'];
    await page
      .getByRole('tab', {
        name: `${workflow === 'classic' ? 'Classic' : 'Native'} 工作流`,
        exact: true,
      })
      .click();
    await selectChange(page, workflow, populated);
    if (workflow === 'native') {
      await page
        .locator('.native-change-detail')
        .getByRole('tab', { name: '当前阻塞', exact: true })
        .click();
    }
    await expectHeaderPreview(page, false);
    const card = page
      .getByRole('heading', { name: heading, exact: true })
      .locator('xpath=ancestor::article[1]');
    const items = card.locator('.dashboard-guidance-items > *');
    const itemCount =
      workflow === 'classic' ? fixture.classic[3].risks.length : fixture.native[3].blockers.length;
    await expect(items).toHaveCount(itemCount);
    for (let index = 0; index < itemCount; index += 1) {
      await expect(items.nth(index)).toContainText(
        workflow === 'classic'
          ? fixture.classic[3].risks[index].message
          : fixture.native[3].blockers[index].reason.text,
      );
    }
    const layout = await card.evaluate((element) => {
      const grid = element.querySelector('.dashboard-guidance-items')!;
      const children = Array.from(grid.children, (child) => child.getBoundingClientRect());
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        rows: new Set(children.map((child) => Math.round(child.y))).size,
        overflowX: element.scrollWidth > element.clientWidth + 1,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        itemOverflow: Array.from(grid.children).some(
          (child) => child.scrollWidth > child.clientWidth + 1,
        ),
      };
    });
    expect(layout.columns).toBe(columns);
    expect(layout.rows).toBe(columns === 2 ? 1 : itemCount);
    expect(layout.overflowX).toBe(false);
    expect(layout.itemOverflow).toBe(false);
    expect(layout.pageOverflow).toBe(false);
    let populatedClassicHeights: { risks: number; git: number } | undefined;
    if (workflow === 'classic') {
      const workspace = page.locator('.classic-change-workspace');
      const overview = workspace.locator(':scope > .classic-change-overview');
      const shell = await expectClassicShellSurface(page);
      const detail = shell.locator(
        ':scope > .dashboard-workspace-center > .dashboard-change-detail.change-detail',
      );
      const context = overview.locator(':scope > .classic-project-context');
      const risks = context.locator(':scope > .change-guidance.classic-change-risks');
      const git = context.locator(':scope > .dashboard-project-git.classic-project-git');
      const panels = detail.locator(':scope > .ant-card-body > .change-detail-panels');
      await expect(workspace).toHaveCount(1);
      await expect(overview).toHaveCount(1);
      await expect(detail).toHaveCount(1);
      await expect(context).toHaveCount(1);
      await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
      await expect(git.locator(':scope > article')).toHaveCount(1);
      await expect(risks.locator(':scope > article')).toHaveCount(1);
      await expect(detail.locator('.dashboard-change-detail-meta')).toHaveCount(1);
      await expect(detail.locator('.dashboard-change-suggestion')).toHaveCount(1);
      await expect(
        detail.getByRole('list', { name: 'Classic 生命周期阶段', exact: true }),
      ).toHaveCount(1);
      await expect(detail.getByRole('heading', { name: heading, exact: true })).toHaveCount(0);
      await expect(workspace.locator('.classic-change-panels')).toHaveCount(0);
      await expect(workspace.locator(':scope > .change-detail-panels')).toHaveCount(0);
      await expect(
        detail.locator(
          ':scope > .ant-card-body > .dashboard-phase-progress + .change-detail-panels',
        ),
      ).toHaveCount(1);
      await expect(panels).toHaveCount(1);
      await expect(panels.locator(':scope > article')).toHaveCount(2);
      if (width === 1600 || width === 390) await expectClassicArtifactSlotsReachable(shell);
      if (width > 760) {
        await expect
          .poll(() =>
            context.evaluate((element) => {
              const detail = element.parentElement!.querySelector('.dashboard-change-detail')!;
              const shell = element.parentElement!.querySelector('.classic-change-shell')!;
              const explorer = shell.querySelector('.dashboard-changes-explorer')!;
              const expected = Math.max(
                Math.min(720, innerHeight * 0.75),
                Math.ceil(detail.getBoundingClientRect().height + 2),
              );
              return (
                Math.abs(shell.getBoundingClientRect().height - expected) <= 1 &&
                (innerWidth < 1280 ||
                  Math.abs(element.getBoundingClientRect().height - expected) <= 1) &&
                Math.abs(explorer.getBoundingClientRect().height - (expected - 2)) <= 1
              );
            }),
          )
          .toBe(true);
      }
      const classicLayout = await workspace.evaluate((element) => {
        const required = (root: ParentNode, selector: string) => {
          const match = root.querySelector<HTMLElement>(selector);
          if (!match) throw new Error(`Missing Classic layout element: ${selector}`);
          return match;
        };
        const bounds = (node: Element) => {
          const box = node.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        };
        const overview = required(element, '.classic-change-overview');
        const shell = required(overview, '.classic-change-shell');
        const left = required(shell, ':scope > .dashboard-workspace-left');
        const center = required(shell, ':scope > .dashboard-workspace-center');
        const detail = required(center, '.dashboard-change-detail');
        const head = required(detail, '.ant-card-head');
        const body = required(detail, ':scope > .ant-card-body');
        const phase = required(body, '.dashboard-phase-progress');
        const context = required(overview, '.classic-project-context');
        const risks = required(context, '.classic-change-risks');
        const git = required(context, '.classic-project-git');
        const panels = required(body, '.change-detail-panels');
        const explorer = required(document, '.dashboard-changes-explorer');
        const summaryCards = document.querySelectorAll(
          '.dashboard-overview-summary-strip .dashboard-summary-card',
        );
        if (summaryCards.length !== 5) throw new Error('Expected all five summary cards');
        const bodyStyle = getComputedStyle(body);
        const detailStyle = getComputedStyle(detail);
        const riskCard = required(risks, 'article');
        const riskStyle = getComputedStyle(riskCard);
        const panelStyle = getComputedStyle(panels);
        const panelArticles = Array.from(panels.querySelectorAll<HTMLElement>(':scope > article'));
        return {
          workspace: bounds(element),
          shell: bounds(shell),
          left: bounds(left),
          center: bounds(center),
          overview: bounds(overview),
          detail: bounds(detail),
          head: bounds(head),
          phase: bounds(phase),
          risks: bounds(risks),
          context: bounds(context),
          git: bounds(git),
          gitCard: bounds(required(git, 'article')),
          riskCard: bounds(riskCard),
          panels: bounds(panels),
          explorer: bounds(explorer),
          first: bounds(summaryCards[0]),
          fourth: bounds(summaryCards[3]),
          fifth: bounds(summaryCards[4]),
          overviewColumns: getComputedStyle(overview).gridTemplateColumns.split(' ').length,
          overviewGap: Number.parseFloat(getComputedStyle(overview).columnGap),
          contextGap: Number.parseFloat(getComputedStyle(context).rowGap),
          detailBorder: [
            Number.parseFloat(detailStyle.borderLeftWidth),
            Number.parseFloat(detailStyle.borderRightWidth),
          ],
          bodyPadding: [
            Number.parseFloat(bodyStyle.paddingLeft),
            Number.parseFloat(bodyStyle.paddingRight),
          ],
          bodyGap: Number.parseFloat(bodyStyle.rowGap),
          panelBorderTop: panelStyle.borderTopWidth,
          panelPaddingTop: Number.parseFloat(panelStyle.paddingTop),
          panelContentWidth:
            body.clientWidth -
            Number.parseFloat(bodyStyle.paddingLeft) -
            Number.parseFloat(bodyStyle.paddingRight),
          panelColumns: panelStyle.gridTemplateColumns.split(' ').length,
          articles: panelArticles.map((article) => {
            const style = getComputedStyle(article);
            return {
              bounds: bounds(article),
              border: [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ],
              padding: [
                style.paddingTop,
                style.paddingRight,
                style.paddingBottom,
                style.paddingLeft,
              ],
              radius: style.borderRadius,
              background: style.backgroundColor,
              shadow: style.boxShadow,
            };
          }),
          riskPadding: [
            Number.parseFloat(riskStyle.paddingLeft),
            Number.parseFloat(riskStyle.paddingRight),
          ],
          riskBorder: [riskStyle.borderLeftWidth, riskStyle.borderRightWidth],
          phaseOverflow: phase.scrollWidth > phase.clientWidth + 1,
          overviewOverflow: overview.scrollWidth > overview.clientWidth + 1,
          panelsOverflow: panels.scrollWidth > panels.clientWidth + 1,
        };
      });
      const aligned = (first: number, second: number) =>
        expect(Math.abs(first - second)).toBeLessThanOrEqual(1);
      aligned(classicLayout.detail.left, classicLayout.center.left);
      aligned(classicLayout.overview.left, classicLayout.workspace.left);
      aligned(classicLayout.overview.right, classicLayout.workspace.right);
      aligned(classicLayout.shell.left, classicLayout.overview.left);
      aligned(classicLayout.center.right, classicLayout.shell.right - 1);
      aligned(classicLayout.detail.right, classicLayout.shell.right - 1);
      aligned(classicLayout.left.left, classicLayout.shell.left + 1);
      aligned(classicLayout.explorer.left, classicLayout.left.left);
      aligned(classicLayout.explorer.top, classicLayout.left.top);
      if (width > 760) {
        aligned(classicLayout.explorer.height, classicLayout.left.height);
        aligned(classicLayout.center.left, classicLayout.left.right);
        aligned(classicLayout.center.top, classicLayout.shell.top + 1);
        aligned(classicLayout.explorer.right, classicLayout.left.right - 1);
        aligned(
          classicLayout.shell.height,
          Math.max(
            Math.min(720, page.viewportSize()!.height * 0.75),
            Math.ceil(classicLayout.detail.height + 2),
          ),
        );
        aligned(classicLayout.explorer.height, classicLayout.shell.height - 2);
      } else {
        aligned(classicLayout.center.left, classicLayout.shell.left + 1);
        aligned(classicLayout.explorer.right, classicLayout.shell.right - 1);
        aligned(classicLayout.center.top, classicLayout.left.bottom);
        expect(classicLayout.left.height).toBe(281);
        expect(classicLayout.explorer.height).toBe(280);
        aligned(classicLayout.explorer.bottom, classicLayout.left.bottom - 1);
      }
      aligned(classicLayout.head.left, classicLayout.detail.left + classicLayout.detailBorder[0]);
      aligned(classicLayout.head.right, classicLayout.detail.right - classicLayout.detailBorder[1]);
      aligned(classicLayout.phase.left, classicLayout.head.left + classicLayout.bodyPadding[0]);
      aligned(classicLayout.phase.right, classicLayout.head.right - classicLayout.bodyPadding[1]);
      aligned(classicLayout.riskCard.left, classicLayout.risks.left);
      aligned(classicLayout.riskCard.right, classicLayout.risks.right);
      aligned(classicLayout.panels.left, classicLayout.phase.left);
      aligned(classicLayout.panels.right, classicLayout.phase.right);
      expect(classicLayout.bodyGap).toBe(24);
      aligned(classicLayout.panels.top - classicLayout.phase.bottom, classicLayout.bodyGap);
      expect(classicLayout.panelBorderTop).toBe('1px');
      expect(classicLayout.panelPaddingTop).toBe(24);
      aligned(classicLayout.articles[0].bounds.top, classicLayout.panels.top + 25);
      expect(classicLayout.articles[0].border).toEqual(['0px', '0px', '0px', '0px']);
      expect(classicLayout.articles[0].padding).toEqual(['0px', '0px', '0px', '0px']);
      const parallelPanels = classicLayout.panelContentWidth >= 700;
      expect(classicLayout.panelColumns).toBe(parallelPanels ? 2 : 1);
      expect(classicLayout.articles[1].border).toEqual(
        parallelPanels ? ['0px', '0px', '0px', '1px'] : ['1px', '0px', '0px', '0px'],
      );
      expect(classicLayout.articles[1].padding).toEqual(
        parallelPanels ? ['0px', '0px', '0px', '24px'] : ['24px', '0px', '0px', '0px'],
      );
      if (parallelPanels) {
        aligned(classicLayout.articles[1].bounds.top, classicLayout.articles[0].bounds.top);
        aligned(classicLayout.articles[1].bounds.left - classicLayout.articles[0].bounds.right, 24);
      } else {
        aligned(classicLayout.articles[1].bounds.top - classicLayout.articles[0].bounds.bottom, 24);
      }
      for (const article of classicLayout.articles) {
        expect(article.radius).toBe('0px');
        expect(article.background).toBe('rgba(0, 0, 0, 0)');
        expect(article.shadow).toBe('none');
      }
      aligned(classicLayout.riskCard.height, classicLayout.risks.height);
      aligned(classicLayout.gitCard.height, classicLayout.git.height);
      aligned(classicLayout.risks.left, classicLayout.context.left);
      aligned(classicLayout.risks.right, classicLayout.context.right);
      aligned(classicLayout.git.left, classicLayout.context.left);
      aligned(classicLayout.git.right, classicLayout.context.right);
      aligned(classicLayout.risks.top, classicLayout.context.top);
      aligned(classicLayout.git.bottom, classicLayout.context.bottom);
      expect(classicLayout.contextGap).toBe(16);
      aligned(classicLayout.git.top - classicLayout.risks.bottom, 16);
      populatedClassicHeights = {
        risks: classicLayout.risks.height,
        git: classicLayout.git.height,
      };
      expect(classicLayout.phaseOverflow).toBe(false);
      expect(classicLayout.overviewOverflow).toBe(false);
      expect(classicLayout.panelsOverflow).toBe(false);
      expect(classicLayout.overviewGap).toBe(16);
      const padding = width <= 760 ? 16 : 24;
      expect(classicLayout.bodyPadding).toEqual([padding, padding]);
      expect(classicLayout.detailBorder).toEqual([0, 0]);
      expect(classicLayout.riskPadding).toEqual([padding, padding]);
      expect(classicLayout.riskBorder).toEqual(['1px', '1px']);
      if (width >= 1280) {
        expect(classicLayout.overviewColumns).toBe(2);
        aligned(classicLayout.context.height, classicLayout.shell.height);
        aligned(classicLayout.explorer.height, classicLayout.shell.height - 2);
        const baseHeight = Math.min(720, page.viewportSize()!.height * 0.75);
        expect(classicLayout.context.height).toBeGreaterThanOrEqual(baseHeight - 1);
        expect(classicLayout.context.height).toBeGreaterThanOrEqual(
          Math.ceil(classicLayout.detail.height + 2) - 1,
        );
        aligned(
          classicLayout.context.height,
          Math.max(baseHeight, Math.ceil(classicLayout.detail.height + 2)),
        );
        const budget = classicLayout.context.height - 16;
        aligned(classicLayout.risks.height, budget * 0.55);
        aligned(classicLayout.git.height, budget * 0.45);
        expect(classicLayout.risks.height + classicLayout.git.height + 16).toBeLessThanOrEqual(
          classicLayout.shell.height + 1,
        );
        aligned(classicLayout.shell.left, classicLayout.first.left);
        aligned(classicLayout.shell.right, classicLayout.fourth.right);
        aligned(classicLayout.left.right, classicLayout.first.right);
        aligned(classicLayout.explorer.right, classicLayout.first.right - 1);
        aligned(classicLayout.risks.left, classicLayout.fifth.left);
        aligned(classicLayout.risks.right, classicLayout.fifth.right);
        aligned(classicLayout.risks.width, classicLayout.fifth.width);
        aligned(classicLayout.risks.top, classicLayout.shell.top);
        aligned(classicLayout.risks.left - classicLayout.shell.right, 16);
      } else {
        expect(classicLayout.overviewColumns).toBe(1);
        aligned(classicLayout.risks.height, Math.min(360, page.viewportSize()!.height * 0.5));
        aligned(classicLayout.git.height, Math.min(440, page.viewportSize()!.height * 0.6));
        aligned(
          classicLayout.context.height,
          classicLayout.risks.height + 16 + classicLayout.git.height,
        );
        aligned(classicLayout.shell.right, classicLayout.workspace.right);
        aligned(classicLayout.risks.left, classicLayout.workspace.left);
        aligned(classicLayout.risks.right, classicLayout.workspace.right);
        aligned(classicLayout.risks.top - classicLayout.shell.bottom, 24);
      }
      await expect(card.getByRole('region', { name: '风险提示内容', exact: true })).toHaveAttribute(
        'tabindex',
        '0',
      );
      if (width === 1600 || width === 390) {
        await expectClassicRiskScrolling(workspace, card, fixture.classic[3].risks.at(-1)!.code);
      }
    } else {
      await expect(page.locator('.classic-change-workspace')).toHaveCount(0);
      await expect(
        page
          .locator('.native-change-detail .native-blockers-card')
          .getByRole('heading', { name: heading, exact: true }),
      ).toHaveCount(1);
      const fullWidth = await card.evaluate((element) => {
        const detail = element.closest('.dashboard-change-detail')!;
        const phase = detail.querySelector('.dashboard-phase-progress')!.getBoundingClientRect();
        return Math.abs(element.getBoundingClientRect().width - phase.width);
      });
      expect(fullWidth).toBeLessThanOrEqual(1);
    }
    if (width === 1600 || width === 390) {
      await selectChange(page, workflow, empty);
      if (workflow === 'native') {
        await page.getByRole('tab', { name: '当前阻塞', exact: true }).click();
      }
      await expect(page.getByText(emptyText, { exact: true })).toBeVisible();
      const emptyCard = page
        .getByRole('heading', { name: heading, exact: true })
        .locator('xpath=ancestor::article[1]');
      await expect(emptyCard.locator('.dashboard-guidance-items > *')).toHaveCount(0);
      if (workflow === 'classic') {
        await expect(
          emptyCard.getByRole('region', { name: '风险提示内容', exact: true }),
        ).not.toHaveAttribute('tabindex', '0');
        const emptyLayout = await emptyCard.evaluate((element) => {
          const context = element.closest('.classic-project-context')!;
          const git = context.querySelector('.classic-project-git')!;
          const region = element.querySelector('.classic-risk-content')!;
          return {
            emptyContext: context.classList.contains('is-empty-risks'),
            contextHeight: context.getBoundingClientRect().height,
            detailHeight: context
              .parentElement!.querySelector('.dashboard-change-detail')!
              .getBoundingClientRect().height,
            shellHeight: context
              .parentElement!.querySelector('.classic-change-shell')!
              .getBoundingClientRect().height,
            explorerHeight: document
              .querySelector('.dashboard-changes-explorer')!
              .getBoundingClientRect().height,
            riskHeight: element.getBoundingClientRect().height,
            gitHeight: git.getBoundingClientRect().height,
            regionFits: region.scrollHeight <= region.clientHeight + 1,
          };
        });
        expect(emptyLayout.emptyContext).toBe(true);
        expect(emptyLayout.regionFits).toBe(true);
        expect(emptyLayout.riskHeight).toBeLessThan(populatedClassicHeights!.risks);
        if (width >= 1280) {
          expect(Math.abs(emptyLayout.contextHeight - emptyLayout.shellHeight)).toBeLessThanOrEqual(
            1,
          );
          expect(
            Math.abs(emptyLayout.explorerHeight - (emptyLayout.shellHeight - 2)),
          ).toBeLessThanOrEqual(1);
          expect(
            Math.abs(
              emptyLayout.contextHeight -
                Math.max(
                  Math.min(720, page.viewportSize()!.height * 0.75),
                  Math.ceil(emptyLayout.detailHeight + 2),
                ),
            ),
          ).toBeLessThanOrEqual(1);
          expect(emptyLayout.gitHeight).toBeGreaterThan(populatedClassicHeights!.git);
          expect(emptyLayout.riskHeight + emptyLayout.gitHeight + 16).toBeLessThanOrEqual(
            emptyLayout.shellHeight + 1,
          );
        } else {
          expect(
            Math.abs(emptyLayout.gitHeight - Math.min(440, page.viewportSize()!.height * 0.6)),
          ).toBeLessThanOrEqual(1);
        }
      }
      await expectHeaderPreview(page, false);
    }
  }
});

test('Classic shared shell retains Explorer and project Git while selected detail is pending or the list is empty', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const view of ['pending', 'empty'] as const) {
    await page.unroute('**/api/dashboard/**');
    const git = repositoryGitFixture(6, 6);
    const fixture = await installSuggestionFixture(
      page,
      'classic',
      git,
      {},
      {
        empty: view === 'empty',
        holdDetail: view === 'pending',
      },
    );
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto('/');
      for (const [width, theme] of [
        [1600, 'dark'],
        [390, 'light'],
      ] as const) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await setTheme(page, theme);
        const shell = await expectClassicShellSurface(page);
        const center = shell.locator(':scope > .dashboard-workspace-center');
        await expect(center.locator(':scope > .change-detail')).toHaveCount(1);
        await expect(
          shell.getByRole('heading', { name: 'Changes Explorer', exact: false }),
        ).toHaveCount(1);
        await expect(
          shell.locator('.dashboard-change-suggestion, .change-detail-panels'),
        ).toHaveCount(0);
        const projectContext = page.locator('.classic-project-context');
        await expect(projectContext).toHaveClass(/\bis-git-only\b/);
        await expect(projectContext.locator('.classic-change-risks')).toHaveCount(0);
        await expect(page.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(1);
        await expect(center.getByRole('region', { name: '仓库 Git', exact: true })).toHaveCount(0);
        await expect(
          projectContext.getByRole('region', { name: '仓库 Git内容', exact: true }),
        ).toContainText(git.branch);
        if (view === 'pending') {
          await expect(
            center.getByLabel('正在加载 Classic 变更详情', { exact: true }),
          ).toHaveAttribute('aria-busy', 'true');
          await expect(shell.locator('.dashboard-change-row')).toHaveCount(fixture.classic.length);
          await expect(center.locator('.dashboard-change-detail-meta')).toHaveCount(0);
        } else {
          await expect(
            center.getByRole('heading', { name: '当前没有 Classic change', exact: true }),
          ).toBeVisible();
          await expect(shell.locator('.dashboard-change-row')).toHaveCount(0);
        }
        await expect
          .poll(() =>
            shell.evaluate((element) => {
              const detail = element.querySelector('.change-detail')!.getBoundingClientRect();
              const left = element
                .querySelector('.dashboard-workspace-left')!
                .getBoundingClientRect();
              const explorer = element
                .querySelector('.dashboard-changes-explorer')!
                .getBoundingClientRect();
              const context = element
                .parentElement!.querySelector('.classic-project-context')!
                .getBoundingClientRect();
              const box = element.getBoundingClientRect();
              if (innerWidth > 760) {
                const expected = Math.max(
                  Math.min(720, innerHeight * 0.75),
                  Math.ceil(detail.height + 2),
                );
                return (
                  Math.abs(box.height - expected) <= 1 &&
                  Math.abs(explorer.height - (expected - 2)) <= 1 &&
                  Math.abs(context.height - box.height) <= 1 &&
                  Math.abs(context.left - box.right - 16) <= 1
                );
              }
              return (
                explorer.height === 280 &&
                left.height === 281 &&
                Math.abs(context.top - box.bottom - 24) <= 1 &&
                Math.abs(detail.top - left.bottom) <= 1
              );
            }),
          )
          .toBe(true);
        if (width === 1600) {
          await expectGitPreview(page, 'commits', git.recentCommits, true);
          const { dialog, trigger, list } = await openGitList(page, 'commits', 'Space');
          await expect(list.locator('li')).toHaveText(git.recentCommits);
          await closeGitList(dialog, trigger, true);
        }
      }
      expect(fixture.gitRequests).toEqual([{ kind: 'commits', cursor: null, limit: '50' }]);
    } finally {
      fixture.releaseClassicDetail();
      if (view === 'pending') {
        await expect(page.locator('.classic-change-title')).toHaveText(
          `当前变更 · ${fixture.classic[0].displayName}`,
        );
        await expect(page.locator('.classic-change-detail-skeleton')).toHaveCount(0);
      }
    }
  }
});

test('Classic repository Git aligns single-line previews, preserves complete text access, and scrolls overflowing content independently', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await installSuggestionFixture(page, 'classic', longRepositoryGit);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  for (const [width, theme] of [
    [1600, 'dark'],
    [390, 'light'],
  ] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await setTheme(page, theme);
    for (const name of ['classic-short', 'classic-risks']) {
      await selectChange(page, 'classic', name);
      await expectHeaderPreview(page, false);
      await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
      const content = page.getByRole('region', { name: '仓库 Git内容', exact: true });
      const textLayout = await content.evaluate((element) => {
        const nodes = Array.from(
          element.querySelectorAll<HTMLElement>(
            ':scope > div.flex > span:last-child, :scope > .dashboard-git-list > ul > li',
          ),
        );
        return {
          text: nodes.map((node) => node.textContent),
          singleLineWithFullText: nodes.every((node) => {
            const style = getComputedStyle(node);
            return (
              style.whiteSpace === 'nowrap' &&
              style.overflowX === 'hidden' &&
              style.textOverflow === 'ellipsis' &&
              node.getBoundingClientRect().height <= parseFloat(style.lineHeight) + 1 &&
              node.title === node.textContent
            );
          }),
          truncated: nodes.every((node) => node.scrollWidth > node.clientWidth),
          leftEdges: Array.from(
            element.querySelectorAll<HTMLElement>(
              ':scope > div.flex > span:first-child, .dashboard-git-list-heading, .dashboard-git-preview-list > li',
            ),
          ).map((node) => node.getBoundingClientRect().left),
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(textLayout.text).toEqual([
        longRepositoryGit.branch,
        longRepositoryGit.head,
        ...longRepositoryGit.recentCommits.slice(0, 5),
        ...longRepositoryGit.dirtyFileList.slice(0, 5),
      ]);
      expect(textLayout.singleLineWithFullText).toBe(true);
      expect(textLayout.truncated).toBe(true);
      expect(Math.max(...textLayout.leftEdges) - Math.min(...textLayout.leftEdges)).toBeLessThan(1);
      expect(textLayout.pageOverflow).toBe(false);
      await expect(content).not.toContainText(longRepositoryGit.recentCommits[5]);
      await expect(content).not.toContainText(longRepositoryGit.dirtyFileList[5]);
    }
    const workspace = page.locator('.classic-change-workspace');
    const context = workspace.locator('.classic-project-context');
    const git = context.locator(':scope > .dashboard-project-git.classic-project-git');
    const card = git.locator(':scope > article');
    const content = card.getByRole('region', { name: '仓库 Git内容', exact: true });
    await expect(git).toHaveCount(1);
    await expect(content).toHaveClass('classic-git-content');
    await expect(content).toHaveAttribute('tabindex', '0');
    const capacity = await content.evaluate((element) => {
      const style = getComputedStyle(element);
      const scrollbar = getComputedStyle(element, '::-webkit-scrollbar');
      return {
        overflowY: style.overflowY,
        overflow: element.scrollHeight > element.clientHeight + 1,
        scrollbarWidth: style.scrollbarWidth,
        webkitScrollbar: {
          display: scrollbar.display,
          width: scrollbar.width,
          height: scrollbar.height,
        },
      };
    });
    expect(capacity).toEqual({
      overflowY: 'auto',
      overflow: width === 1600,
      scrollbarWidth: 'none',
      webkitScrollbar: { display: 'none', width: '0px', height: '0px' },
    });
    if (width === 390) {
      const heights = await context.evaluate((element) => ({
        risk: element.querySelector('.classic-change-risks')!.getBoundingClientRect().height,
        git: element.querySelector('.classic-project-git')!.getBoundingClientRect().height,
        explorer: document.querySelector('.dashboard-changes-explorer')!.getBoundingClientRect()
          .height,
      }));
      expect(heights.risk).toBe(Math.min(360, 844 * 0.5));
      expect(heights.git).toBe(Math.min(440, 844 * 0.6));
      expect(heights.risk).toBeGreaterThan(heights.explorer);
      expect(heights.git).toBeGreaterThan(heights.explorer);
    }
    const readableInRegion = (item: Locator) =>
      item.evaluate((element) => {
        const content = element.closest('.classic-git-content')!;
        const box = element.getBoundingClientRect();
        const clip = content.getBoundingClientRect();
        return (
          box.top >= clip.top - 1 &&
          box.bottom <= clip.bottom + 1 &&
          element.contains(
            document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
          )
        );
      });
    await card.scrollIntoViewIfNeeded();
    await content.focus();
    await expect(content).toBeFocused();
    await content.hover();
    await expect(card.locator(':scope > div:first-child')).toBeInViewport();
    const fixedLayout = () =>
      workspace.evaluate((element) => {
        const risk = element.querySelector('.classic-risk-content')!;
        return {
          pageScrollY: window.scrollY,
          riskScrollTop: risk.scrollTop,
          bounds: [
            '.classic-project-git > article > div:first-child',
            '.classic-change-risks',
            '.dashboard-change-detail',
            '.dashboard-phase-progress',
            '.change-detail-panels',
          ].map((selector) => {
            const node = element.querySelector(selector);
            if (!node) throw new Error(`Missing fixed repository layout element: ${selector}`);
            const box = node.getBoundingClientRect();
            return [box.x, box.y, box.width, box.height];
          }),
        };
      });
    await content.press('Home');
    await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
    await content.hover();
    const before = await fixedLayout();
    if (capacity.overflow) {
      await page.mouse.wheel(0, 240);
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await fixedLayout()).toEqual(before);
      await content.press('Home');
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
      await content.press('PageDown');
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await fixedLayout()).toEqual(before);
      await content.press('Home');
      await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBe(0);
      const lastCommit = content.getByText(longRepositoryGit.recentCommits[4], { exact: true });
      const delta = await lastCommit.evaluate((element) => {
        const content = element.closest('.classic-git-content')!;
        return (
          element.getBoundingClientRect().top -
          content.getBoundingClientRect().top +
          content.scrollTop -
          content.clientHeight / 4
        );
      });
      expect(delta).toBeGreaterThan(0);
      await page.mouse.wheel(0, delta);
      await expect.poll(() => readableInRegion(lastCommit)).toBe(true);
      expect(await fixedLayout()).toEqual(before);
      await content.press('End');
      await expect
        .poll(() =>
          content.evaluate(
            (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
          ),
        )
        .toBe(true);
      const fifthFile = content.getByText(longRepositoryGit.dirtyFileList[4], { exact: true });
      await expect.poll(() => readableInRegion(fifthFile)).toBe(true);
      expect(await fixedLayout()).toEqual(before);
    } else {
      for (const text of [
        ...longRepositoryGit.recentCommits.slice(0, 5),
        ...longRepositoryGit.dirtyFileList.slice(0, 5),
      ]) {
        await expect
          .poll(() => readableInRegion(content.getByText(text, { exact: true })))
          .toBe(true);
      }
      expect(await fixedLayout()).toEqual(before);
    }
    await selectChange(page, 'classic', 'classic-short');
    await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '仓库 Git内容', exact: true })).toContainText(
      longRepositoryGit.branch,
    );
  }
  await page.getByRole('tab', { name: 'Native 工作流', exact: true }).click();
  await selectChange(page, 'native', 'native-fallback');
  await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
  await expect(page.locator('.classic-project-context')).toHaveCount(0);
  const nativeGitBody = page.getByRole('region', { name: '仓库 Git内容', exact: true });
  await expect(page.locator('.native-detail-project-git > .dashboard-project-git')).toHaveCount(1);
  await expect(nativeGitBody.locator(':scope > div.flex')).toHaveCount(2);
  await expect(nativeGitBody.locator(':scope > .dashboard-git-list')).toHaveCount(2);
  await expect(nativeGitBody.locator('.is-commits .dashboard-git-preview-list > li')).toHaveCount(
    5,
  );
  await expect(nativeGitBody.locator('.is-files .dashboard-git-preview-list > li')).toHaveCount(5);
  await expect(nativeGitBody).not.toContainText(longRepositoryGit.recentCommits[5]);
  await expect(nativeGitBody).not.toContainText(longRepositoryGit.dirtyFileList[5]);
  expect(fixture.gitRequests).toEqual([]);
});

function gitListTitle(kind: GitListKind) {
  return kind === 'commits' ? '最近提交' : '未提交文件';
}

async function expectGitPreview(
  page: Page,
  kind: GitListKind,
  items: string[],
  expandable: boolean,
) {
  const area = page.locator(`.dashboard-project-git .dashboard-git-list.is-${kind}`);
  const preview = area.locator('.dashboard-git-preview-list > li');
  await expect(area).toHaveCount(1);
  await expect(preview).toHaveCount(Math.min(5, items.length));
  expect(await preview.allTextContents()).toEqual(items.slice(0, 5));
  if (items.length > 5) await expect(area).not.toContainText(items[5]);
  await expect(area.locator('svg, .anticon, [role="img"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.getByPlaceholder('搜索变更、产物或文件…').focus();
  await expect(page.locator('.ant-tooltip:visible')).toHaveCount(0);
  const background = () => area.evaluate((element) => getComputedStyle(element).backgroundColor);
  const restingBackground = await background();
  const behavior = await area.evaluate((element) => ({
    tag: element.tagName,
    cursor: getComputedStyle(element).cursor,
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    previewLayout: Array.from(element.querySelectorAll('li')).every((item) => {
      const style = getComputedStyle(item);
      return element.closest('.classic-project-git')
        ? style.whiteSpace === 'nowrap' &&
            style.overflowX === 'hidden' &&
            style.textOverflow === 'ellipsis' &&
            item.getBoundingClientRect().height <= parseFloat(style.lineHeight) + 1 &&
            item.title === item.textContent
        : item.scrollWidth <= item.clientWidth + 1;
    }),
  }));
  expect(behavior.pageOverflow).toBe(false);
  expect(behavior.previewLayout).toBe(true);
  await area.hover();
  if (expandable) {
    expect(behavior.tag).toBe('BUTTON');
    expect(behavior.cursor).toBe('pointer');
    await expect(area).toHaveAccessibleName(`展开完整${gitListTitle(kind)}`);
    await expect(area).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(area).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(background).not.toBe(restingBackground);
    expect(
      await area.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
        );
      }),
    ).toBe(true);
  } else {
    expect(behavior.tag).toBe('DIV');
    expect(behavior.cursor).not.toBe('pointer');
    await expect(area).not.toHaveAttribute('tabindex', '0');
    await expect(area).not.toHaveAttribute('aria-haspopup', 'dialog');
    await expect(area.getByRole('button')).toHaveCount(0);
    expect(await background()).toBe(restingBackground);
    if (items.length === 0) await expect(area).toContainText(`暂无${gitListTitle(kind)}`);
  }
  return area;
}

async function openGitList(page: Page, kind: GitListKind, key: 'Enter' | 'Space' = 'Enter') {
  const trigger = page.getByRole('button', { name: `展开完整${gitListTitle(kind)}`, exact: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press(key);
  const dialog = page.getByRole('dialog', { name: `完整${gitListTitle(kind)}`, exact: true });
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '全屏展示', exact: true })).toHaveCount(0);
  const list = dialog.getByRole('list', { name: `${gitListTitle(kind)}完整列表`, exact: true });
  await expect(list).toHaveClass(`dashboard-git-full-list is-${kind}`);
  await expect(
    dialog.locator(`.dashboard-git-full-list.is-${kind === 'commits' ? 'files' : 'commits'}`),
  ).toHaveCount(0);
  return { trigger, dialog, list };
}

async function closeGitList(dialog: Locator, trigger: Locator, escape: boolean) {
  if (escape) await dialog.press('Escape');
  else await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}

async function expectGitModalScrolling(dialog: Locator, lastText: string) {
  const body = await stableModalBody(dialog);
  const capacity = await body.evaluate((element) => {
    const dialog = element.closest('[role=dialog]')!;
    const first = element.querySelector('.dashboard-git-full-list > li')!;
    let current: Element | null = first;
    let scrollRoots = 0;
    while (current && dialog.contains(current)) {
      if (
        /^(auto|scroll)$/.test(getComputedStyle(current).overflowY) &&
        current.scrollHeight > current.clientHeight + 1
      )
        scrollRoots += 1;
      current = current.parentElement;
    }
    return {
      overflowY: getComputedStyle(element).overflowY,
      scrolls: element.scrollHeight > element.clientHeight + 1,
      scrollRoots,
      textFits: Array.from(element.querySelectorAll('li')).every(
        (item) => item.scrollWidth <= item.clientWidth + 1,
      ),
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(capacity).toEqual({
    overflowY: 'auto',
    scrolls: true,
    scrollRoots: 1,
    textFits: true,
    pageOverflow: false,
  });
  const fixedLayout = () =>
    dialog.evaluate((element) => ({
      pageScrollY: window.scrollY,
      bounds: ['.ant-modal-header', '.ant-modal-footer'].map((selector) => {
        const box = element.querySelector(selector)!.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      }),
    }));
  await body.focus();
  await expect(body).toBeFocused();
  await body.press('Home');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  await body.hover();
  const before = await fixedLayout();
  await dialog.page().mouse.wheel(0, 240);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await fixedLayout()).toEqual(before);
  await body.press('Home');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0);
  await body.press('PageDown');
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await fixedLayout()).toEqual(before);
  await body.press('End');
  await expect
    .poll(() =>
      body.evaluate(
        (element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      ),
    )
    .toBe(true);
  const last = dialog.getByText(lastText, { exact: true });
  await expect(last).toBeInViewport();
  await expect
    .poll(() =>
      last.evaluate((element) => {
        const clip = element.closest('.ant-modal-body')!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return (
          box.top >= clip.top - 1 &&
          box.bottom <= clip.bottom + 1 &&
          element.contains(
            document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2),
          )
        );
      }),
    )
    .toBe(true);
  expect(await fixedLayout()).toEqual(before);
}

for (const workflow of ['classic', 'native'] as const) {
  test(`Repository Git shows an unreadable status as unknown in ${workflow}`, async ({ page }) => {
    await installSuggestionFixture(page, workflow, { ...defaultRepositoryGit, dirtyFiles: null });
    await page.goto('/');
    await selectChange(
      page,
      workflow,
      workflow === 'classic' ? 'classic-short' : 'native-fallback',
    );
    const git = page.locator('.dashboard-project-git');
    await expect(git).toContainText('未提交状态未知');
    await expect(git.getByRole('status')).toHaveText('Git 未提交状态未知，请刷新重试。');
    await expect(git).not.toContainText('暂无未提交文件');
    await expect(git).not.toContainText('0 个未提交');
    if (workflow === 'classic') {
      const metric = page.getByRole('button', {
        name: 'Git 未提交 — 工作区状态 未知',
        exact: true,
      });
      await expect(metric).toContainText('—');
      await expect(metric).not.toContainText('干净');
    }
  });
}

test('Repository Git keeps zero and five items passive and independently opens six-item lists with pointer and keyboard access', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [commitsCount, filesCount, workflow, width, theme] of [
    [0, 0, 'classic', 1600, 'light'],
    [5, 5, 'classic', 390, 'dark'],
    [6, 6, 'native', 390, 'light'],
    [6, 5, 'classic', 1600, 'dark'],
    [5, 6, 'native', 390, 'light'],
  ] as const) {
    const git = repositoryGitFixture(commitsCount, filesCount);
    const fixture = await installSuggestionFixture(page, workflow, git, {
      previewOnly: commitsCount > 5 || filesCount > 5,
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/');
    await setTheme(page, theme);
    await page
      .getByRole('tab', {
        name: `${workflow === 'classic' ? 'Classic' : 'Native'} 工作流`,
        exact: true,
      })
      .click();
    await selectChange(
      page,
      workflow,
      workflow === 'classic' ? 'classic-short' : 'native-fallback',
    );
    await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
    const commits = await expectGitPreview(page, 'commits', git.recentCommits, commitsCount > 5);
    const files = await expectGitPreview(page, 'files', git.dirtyFileList, filesCount > 5);
    expect(fixture.gitRequests).toEqual([]);
    if (workflow === 'native') {
      await expect(page.locator('.native-detail-project-git > .dashboard-project-git')).toHaveCount(
        1,
      );
    } else {
      await expect(page.locator('.classic-project-context > .classic-project-git')).toHaveCount(1);
    }
    const expectedRequests: GitPageRequest[] = [];
    for (const [kind, key, escape] of [
      ['commits', 'Enter', true],
      ['files', 'Space', false],
    ] as const) {
      const items = kind === 'commits' ? git.recentCommits : git.dirtyFileList;
      if (items.length <= 5) {
        await (kind === 'commits' ? commits : files).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(fixture.gitRequests).toEqual(expectedRequests);
        continue;
      }
      const { trigger, dialog, list } = await openGitList(page, kind, key);
      await expect(list.locator(':scope > li')).toHaveCount(6);
      expect(await list.locator(':scope > li').allTextContents()).toEqual(items);
      await stableModalBody(dialog);
      await expect(dialog.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
      const close = dialog.getByRole('button', { name: '关闭', exact: true });
      await close.focus();
      await close.press('Tab');
      const body = dialog.getByRole('region', {
        name: `${gitListTitle(kind)}完整列表内容`,
        exact: true,
      });
      await expect(body).toBeFocused();
      await body.press('Shift+Tab');
      await expect(close).toBeFocused();
      expectedRequests.push({ kind, cursor: null, limit: '50' });
      expect(fixture.gitRequests).toEqual(expectedRequests);
      await closeGitList(dialog, trigger, escape);
    }
    await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
  }
});

test('Repository Git fetches complete lists only on demand, pages commits and files independently, and retries the same failed file cursor', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  const git = repositoryGitFixture(55, 56);
  const fixture = await installSuggestionFixture(page, 'classic', git, {
    previewOnly: true,
    failOnce: { kind: 'files', cursor: 'files:50' },
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await setTheme(page, 'dark');
  await selectChange(page, 'classic', 'classic-risks');
  await expectGitPreview(page, 'commits', git.recentCommits, true);
  await expectGitPreview(page, 'files', git.dirtyFileList, true);
  expect(fixture.gitRequests).toEqual([]);
  const overviewRequests = fixture.overviewRequestCount();
  await page.clock.fastForward(31_000);
  await expect.poll(fixture.overviewRequestCount).toBeGreaterThan(overviewRequests);
  await expect(page.locator('.dashboard-change-detail-title')).toHaveText(
    '当前变更 · classic-risks',
  );
  expect(fixture.gitRequests).toEqual([]);

  const commits = await openGitList(page, 'commits');
  await expect(commits.list.locator(':scope > li')).toHaveCount(50);
  expect(await commits.list.locator(':scope > li').allTextContents()).toEqual(
    git.recentCommits.slice(0, 50),
  );
  await expect(commits.dialog.locator('.dashboard-tool-counter')).toHaveText('已加载 50 项');
  expect(fixture.gitRequests).toEqual([{ kind: 'commits', cursor: null, limit: '50' }]);
  await expectGitModalScrolling(commits.dialog, git.recentCommits[49]);
  expect(fixture.gitRequests).toHaveLength(1);
  await commits.dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(commits.list.locator(':scope > li')).toHaveCount(55);
  expect(await commits.list.locator(':scope > li').allTextContents()).toEqual(git.recentCommits);
  await expect(commits.dialog.locator('.dashboard-tool-counter')).toHaveText('已加载 55 项');
  await expect(commits.dialog.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(
    0,
  );
  expect(fixture.gitRequests).toEqual([
    { kind: 'commits', cursor: null, limit: '50' },
    { kind: 'commits', cursor: 'commits:50', limit: '50' },
  ]);
  await expectGitModalScrolling(commits.dialog, git.recentCommits[54]);
  await closeGitList(commits.dialog, commits.trigger, true);

  const files = await openGitList(page, 'files', 'Space');
  await expect(files.list.locator(':scope > li')).toHaveCount(50);
  expect(await files.list.locator(':scope > li').allTextContents()).toEqual(
    git.dirtyFileList.slice(0, 50),
  );
  await expect(files.dialog.locator('.dashboard-tool-counter')).toHaveText('56 项');
  await files.dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(files.dialog.getByRole('alert')).toHaveText(
    '未提交文件读取失败：fixture Git 第二批读取失败',
  );
  await expect(files.dialog).not.toContainText('暂无未提交文件');
  await expect(files.list.locator(':scope > li')).toHaveCount(50);
  expect(await files.list.locator(':scope > li').allTextContents()).toEqual(
    git.dirtyFileList.slice(0, 50),
  );
  await expect(files.dialog.getByRole('button', { name: /^重\s?试$/ })).toBeVisible();
  expect(fixture.gitRequests).toEqual([
    { kind: 'commits', cursor: null, limit: '50' },
    { kind: 'commits', cursor: 'commits:50', limit: '50' },
    { kind: 'files', cursor: null, limit: '50' },
    { kind: 'files', cursor: 'files:50', limit: '50' },
  ]);
  const failedRequests = fixture.gitRequests.length;
  await page.clock.fastForward(31_000);
  await expect(files.dialog.getByRole('alert')).toBeVisible();
  expect(fixture.gitRequests).toHaveLength(failedRequests);
  await files.dialog.getByRole('button', { name: /^重\s?试$/ }).click();
  await expect(files.dialog.getByRole('alert')).toHaveCount(0);
  await expect(files.list.locator(':scope > li')).toHaveCount(56);
  expect(await files.list.locator(':scope > li').allTextContents()).toEqual(git.dirtyFileList);
  await expect(files.dialog.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  expect(fixture.gitRequests.slice(-3)).toEqual([
    { kind: 'files', cursor: null, limit: '50' },
    { kind: 'files', cursor: 'files:50', limit: '50' },
    { kind: 'files', cursor: 'files:50', limit: '50' },
  ]);
  await expectGitModalScrolling(files.dialog, git.dirtyFileList[55]);
  await closeGitList(files.dialog, files.trigger, false);

  const requestCount = fixture.gitRequests.length;
  await selectChange(page, 'classic', 'classic-short');
  await expect(page.locator('.dashboard-project-git')).toHaveCount(1);
  await expectGitPreview(page, 'commits', git.recentCommits, true);
  await expectGitPreview(page, 'files', git.dirtyFileList, true);
  expect(fixture.gitRequests).toHaveLength(requestCount);
  const reopened = await openGitList(page, 'commits');
  await expect(reopened.list.locator(':scope > li')).toHaveCount(50);
  expect(await reopened.list.locator(':scope > li').allTextContents()).toEqual(
    git.recentCommits.slice(0, 50),
  );
  expect(fixture.gitRequests.at(-1)).toEqual({ kind: 'commits', cursor: null, limit: '50' });
  await closeGitList(reopened.dialog, reopened.trigger, true);
});

test('Repository Git restarts a changed file list from its first page without appending stale entries', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const git = repositoryGitFixture(5, 56);
  const fixture = await installSuggestionFixture(page, 'classic', git, {
    previewOnly: true,
    failOnce: { kind: 'files', cursor: 'files:50', status: 409 },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await setTheme(page, 'dark');
  await selectChange(page, 'classic', 'classic-short');
  const files = await openGitList(page, 'files', 'Space');
  await expect(files.list.locator(':scope > li')).toHaveCount(50);
  await files.dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(files.dialog.getByRole('alert')).toContainText('fixture Git 第二批读取失败');
  await expect(files.list.locator(':scope > li')).toHaveCount(50);
  await files.dialog.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(files.dialog.getByRole('alert')).toHaveCount(0);
  await expect(files.list.locator(':scope > li')).toHaveCount(50);
  expect(await files.list.locator(':scope > li').allTextContents()).toEqual(
    git.dirtyFileList.slice(0, 50),
  );
  await files.dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(files.list.locator(':scope > li')).toHaveCount(56);
  expect(await files.list.locator(':scope > li').allTextContents()).toEqual(git.dirtyFileList);
  expect(fixture.gitRequests).toEqual([
    { kind: 'files', cursor: null, limit: '50' },
    { kind: 'files', cursor: 'files:50', limit: '50' },
    { kind: 'files', cursor: null, limit: '50' },
    { kind: 'files', cursor: 'files:50', limit: '50' },
  ]);
  await closeGitList(files.dialog, files.trigger, true);
});
