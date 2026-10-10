import { expect, test, type Page } from '@playwright/test';

const searchPlaceholder = '搜索变更、产物或文件…';
// AntD 聚焦标签时会将序号播报并入可访问名称，仍需精确匹配对应工作流。
const workflowTabNames = {
  Classic: /^(?:Tab 1 of 2 )?Classic 工作流$/,
  Native: /^(?:Tab 2 of 2 )?Native 工作流$/,
};

async function openDemo(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto('/?demo');
  await expect(page.locator('.dashboard-change-detail')).toBeVisible();
}

async function settleHeader(page: Page) {
  await page.mouse.move(0, 0);
  await page.getByPlaceholder(searchPlaceholder).focus();
  await expect(page.locator('.ant-tooltip:visible')).toHaveCount(0);
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
  await settleHeader(page);
}

async function expectHeaderStructure(page: Page) {
  const header = page.locator('.comet-workbench-header');
  const workflow = header.locator('.dashboard-header-workflow-switch');
  await expect(header).toHaveCount(1);
  const logo = header.locator('.comet-header-brand > img');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute('src', '/favicon.png');
  await expect
    .poll(() =>
      logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await expect(logo).toHaveCSS('width', '28px');
  await expect(logo).toHaveCSS('height', '28px');
  await expect(workflow).toHaveCount(1);
  await expect(header.getByRole('combobox', { name: '选择项目', exact: true })).toBeVisible();
  await expect(header.getByPlaceholder(searchPlaceholder)).toBeVisible();
  for (const name of Object.values(workflowTabNames)) {
    await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(1);
    await expect(workflow.getByRole('tab', { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('.dashboard-content-shell .dashboard-workflow-tabs')).toHaveCount(0);
  expect(
    await workflow.evaluate((element) => {
      const project = document.querySelector('.comet-workbench-header .comet-project-select')!;
      return Boolean(project.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  return { header, workflow };
}

async function expectHeaderGeometry(page: Page, desktop: boolean) {
  await settleHeader(page);
  const { header } = await expectHeaderStructure(page);
  const layout = await header.evaluate((element) => {
    const required = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`Missing header control: ${selector}`);
      return target;
    };
    const header = element.getBoundingClientRect();
    const search = required('.comet-header-search').getBoundingClientRect();
    const project = required('.comet-project-select').getBoundingClientRect();
    const workflow = required('.dashboard-header-workflow-switch').getBoundingClientRect();
    const controls = Array.from(
      element.querySelectorAll(
        '.comet-header-brand, .comet-project-select, .comet-workflow-source, .dashboard-header-workflow-switch, .comet-header-search, .comet-header-actions',
      ),
      (control) => control.getBoundingClientRect(),
    ).filter((rect) => rect.width > 0 && rect.height > 0);
    const overlaps: string[] = [];
    for (let index = 0; index < controls.length; index += 1) {
      for (let other = index + 1; other < controls.length; other += 1) {
        const first = controls[index];
        const second = controls[other];
        if (
          Math.max(first.left, second.left) < Math.min(first.right, second.right) - 0.01 &&
          Math.max(first.top, second.top) < Math.min(first.bottom, second.bottom) - 0.01
        )
          overlaps.push(`${index}/${other}`);
      }
    }
    const style = getComputedStyle(element);
    const theme = document.documentElement.getAttribute('data-theme');
    const dividerDeclaration =
      theme === 'dark'
        ? 'var(--color-border-soft)'
        : 'color-mix(in srgb, var(--color-border) 80%, var(--color-muted))';
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.borderBottom = `1px solid ${dividerDeclaration}`;
    element.append(probe);
    const tokenColor = getComputedStyle(probe).borderBottomColor;
    probe.style.borderBottom = '1px solid var(--color-border-soft)';
    const softBorderColor = getComputedStyle(probe).borderBottomColor;
    probe.remove();
    const colorDifference = (first: string, second: string) => {
      const channels = (color: string) => {
        const scale = color.startsWith('color(srgb ') ? 255 : 1;
        return color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map((channel) => Number(channel) * scale);
      };
      const other = channels(second);
      return (
        channels(first).reduce(
          (total, channel, index) => total + Math.abs(channel - other[index]),
          0,
        ) / 3
      );
    };
    return {
      centerOffset: Math.abs(search.left + search.width / 2 - header.left - header.width / 2),
      workflowRightOfProject: workflow.left >= project.right,
      controlsInside: controls.every(
        (rect) =>
          rect.left >= header.left - 1 &&
          rect.right <= header.right + 1 &&
          rect.top >= header.top - 1 &&
          rect.bottom <= header.bottom + 1,
      ),
      overlaps,
      searchWidth: search.width,
      workflowWidth: workflow.width,
      dividerWidth: style.borderBottomWidth,
      dividerStyle: style.borderBottomStyle,
      dividerColor: style.borderBottomColor,
      theme,
      dividerDeclaration,
      tokenColor,
      surfaceColor: style.backgroundColor,
      dividerSurfaceDifference: colorDifference(style.borderBottomColor, style.backgroundColor),
      softBorderSurfaceDifference: colorDifference(softBorderColor, style.backgroundColor),
      position: style.position,
      top: style.top,
      headerOverflow: element.scrollWidth > element.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (desktop) {
    expect(layout.centerOffset).toBeLessThanOrEqual(1);
    expect(layout.workflowRightOfProject).toBe(true);
  }
  expect(layout.controlsInside).toBe(true);
  expect(layout.overlaps).toEqual([]);
  expect(layout.searchWidth).toBeGreaterThan(100);
  expect(layout.workflowWidth).toBeGreaterThan(0);
  expect(layout.dividerWidth).toBe('1px');
  expect(layout.dividerStyle).toBe('solid');
  expect(layout.dividerColor, `Header divider: ${layout.dividerDeclaration}`).toBe(
    layout.tokenColor,
  );
  expect(layout.dividerColor).not.toBe('rgba(0, 0, 0, 0)');
  if (layout.theme === 'light') {
    expect(layout.dividerColor).not.toBe(layout.surfaceColor);
    expect(layout.dividerSurfaceDifference).toBeGreaterThan(15);
    expect(layout.dividerSurfaceDifference).toBeGreaterThan(layout.softBorderSurfaceDifference);
  }
  expect(layout.position).toBe('sticky');
  expect(layout.top).toBe('0px');
  expect(layout.headerOverflow).toBe(false);
  expect(layout.pageOverflow).toBe(false);
  return layout;
}

test('centers desktop search in the whole sticky header and keeps a single workflow switch beside the project in both themes', async ({
  page,
}) => {
  await openDemo(page, 1600);
  await setTheme(page, 'light');
  const light = await expectHeaderGeometry(page, true);
  await page.getByRole('tab', { name: workflowTabNames.Native }).click();
  await expect(page.getByRole('list', { name: 'Native 生命周期阶段', exact: true })).toBeVisible();
  await setTheme(page, 'dark');
  const dark = await expectHeaderGeometry(page, true);
  expect(dark.dividerColor).not.toBe(light.dividerColor);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectHeaderGeometry(page, true);
  await setTheme(page, 'light');
  await expectHeaderGeometry(page, true);
});

test('keeps narrow-screen search and workflow switching reachable without overflow', async ({
  page,
}) => {
  await openDemo(page, 390);
  await setTheme(page, 'dark');
  await expectHeaderGeometry(page, false);
  const workflow = page.locator('.dashboard-header-workflow-switch');
  await workflow.getByRole('tab', { name: workflowTabNames.Native }).click();
  await expect(page.locator('.native-change-detail')).toBeVisible();
  const name = await page
    .locator('.native-change-row .dashboard-explorer-row-name')
    .first()
    .innerText();
  const search = page.getByPlaceholder(searchPlaceholder);
  await search.focus();
  await expect(search).toBeFocused();
  await search.fill(name);
  await expect(page.locator('.native-change-row')).toHaveCount(1);
  await expect(page.locator('.native-change-row .dashboard-explorer-row-name')).toHaveText(name);
  await search.fill('');
  const native = workflow.getByRole('tab', { name: workflowTabNames.Native });
  await native.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const classic = workflow.getByRole('tab', { name: workflowTabNames.Classic });
  await expect(classic).toBeFocused();
  await expect(classic).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: 'Classic 生命周期阶段', exact: true })).toBeVisible();
  await setTheme(page, 'light');
  await expectHeaderGeometry(page, false);
});

test('uses the original blue brand for selection, hover, keyboard focus and primary buttons in both themes', async ({
  page,
}) => {
  await openDemo(page, 1600);
  const search = page.getByPlaceholder(searchPlaceholder);
  const searchFrame = page.locator('.comet-header-search .ant-input-affix-wrapper');
  const projectFrame = page.locator('.comet-project-select');
  for (const theme of ['light', 'dark'] as const) {
    const accent = theme === 'dark' ? 'rgb(110, 159, 255)' : 'rgb(37, 94, 216)';
    await setTheme(page, theme);
    await expect(page.locator('.dashboard-workbench')).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(16, 20, 28)' : 'rgb(255, 255, 255)',
    );
    await expect(page.locator('.comet-workbench-header')).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(17, 24, 36)' : 'rgb(255, 255, 255)',
    );
    const logo = page.locator('.comet-header-brand > img');
    await expect(logo).toHaveCSS('opacity', '1');
    await expect(logo).toHaveCSS('filter', 'none');
    for (const workflow of ['Classic', 'Native'] as const) {
      await page.getByRole('tab', { name: workflowTabNames[workflow] }).click();
      await expect(page.locator('.dashboard-content-shell')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(16, 20, 28)' : 'rgb(255, 255, 255)',
      );
      await expect(page.locator('.dashboard-explorer-row.selected')).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(27, 45, 72)' : 'rgb(237, 244, 255)',
      );
      await expect(page.locator('.dashboard-summary-primary')).toHaveCSS(
        'background-image',
        theme === 'dark'
          ? 'linear-gradient(135deg, rgb(31, 111, 229) 0%, rgb(54, 127, 233) 100%)'
          : 'linear-gradient(135deg, rgb(31, 115, 237) 0%, rgb(60, 146, 250) 100%)',
      );
      await expect(page.locator('.dashboard-summary-primary .dashboard-summary-metric')).toHaveCSS(
        'color',
        'rgb(255, 255, 255)',
      );
      await expect(
        page.locator('.dashboard-summary-card:not(.dashboard-summary-primary)').first(),
      ).toHaveCSS('background-color', theme === 'dark' ? 'rgb(23, 30, 41)' : 'rgb(255, 255, 255)');
      const unselected = page.locator('.dashboard-summary-tone-2');
      await unselected.hover();
      await expect(unselected).toHaveCSS('border-color', accent);
      await expect(unselected).toHaveCSS(
        'background-color',
        theme === 'dark' ? 'rgb(23, 30, 41)' : 'rgb(255, 255, 255)',
      );
      await unselected.click();
      await expect(unselected).toHaveAttribute('aria-pressed', 'true');
      await expect(unselected).toHaveCSS(
        'background-image',
        theme === 'dark'
          ? 'linear-gradient(135deg, rgb(31, 111, 229) 0%, rgb(54, 127, 233) 100%)'
          : 'linear-gradient(135deg, rgb(31, 115, 237) 0%, rgb(60, 146, 250) 100%)',
      );
      await expect(unselected.locator('.dashboard-summary-metric')).toHaveCSS(
        'color',
        'rgb(255, 255, 255)',
      );
      await page.locator('.dashboard-summary-tone-1').click();
      await expect(page.locator('.dashboard-summary-tone-2 .dashboard-summary-metric')).toHaveCSS(
        'color',
        theme === 'dark' ? 'rgb(137, 221, 179)' : 'rgb(22, 163, 74)',
      );
    }
    await page.getByRole('tab', { name: workflowTabNames.Classic }).click();
    await searchFrame.hover();
    await expect(searchFrame).toHaveCSS('border-color', accent);
    await search.focus();
    await expect(search).toBeFocused();
    await expect(search).toHaveCSS('caret-color', accent);
    await expect(searchFrame).not.toHaveCSS('box-shadow', 'none');
    await projectFrame.hover();
    await expect(projectFrame).toHaveCSS('border-color', accent);
    await page.getByRole('combobox', { name: '选择项目', exact: true }).focus();
    await expect(projectFrame).not.toHaveCSS('box-shadow', 'none');
    const classic = page.getByRole('tab', { name: workflowTabNames.Classic });
    await page.keyboard.press('Tab');
    await expect(classic).toBeFocused();
    await expect(classic).toHaveCSS('outline-color', accent);
    await expect(classic).toHaveCSS('color', theme === 'dark' ? 'rgb(168, 196, 255)' : accent);
    const disabled = page.getByRole('button', { name: 'deltaSpec 未生成', exact: true });
    await expect(disabled).toBeDisabled();
    const disabledStyle = await disabled.evaluate((button) => {
      const style = getComputedStyle(button);
      return { color: style.color, background: style.backgroundColor };
    });
    await disabled.hover({ force: true });
    expect(
      await disabled.evaluate((button) => {
        const style = getComputedStyle(button);
        return { color: style.color, background: style.backgroundColor };
      }),
    ).toEqual(disabledStyle);
    await page.getByRole('button', { name: '展开完整下一步建议', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const primary = dialog.getByRole('button', { name: '关闭', exact: true });
    await expect(primary).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(primary).toHaveCSS('background-color', accent);
    const contrast = async () =>
      primary.evaluate((button) => {
        const style = getComputedStyle(button);
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          const normalized = channels.map((channel) => channel / 255);
          const linear = normalized.map((channel) =>
            channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
          );
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      });
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await primary.hover();
    await expect(primary).not.toHaveCSS('background-color', accent);
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await primary.focus();
    await expect(primary).toBeFocused();
    await primary.hover();
    await page.mouse.down();
    await expect(primary).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(91, 139, 232)' : 'rgb(24, 67, 153)',
    );
    expect(await contrast()).toBeGreaterThanOrEqual(4.5);
    await page.mouse.up();
    await expect(dialog).toBeHidden();
  }
});

test('keeps the top bar fixed while each workflow Explorer follows page scrolling', async ({
  page,
}) => {
  await openDemo(page, 1600);
  for (const workflow of ['Classic', 'Native'] as const) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('tab', { name: workflowTabNames[workflow] }).click();
    await expect(
      page.getByRole('list', { name: `${workflow} 生命周期阶段`, exact: true }),
    ).toBeVisible();
    await settleHeader(page);
    const header = page.locator('.comet-workbench-header');
    const explorer = page.locator('.dashboard-changes-explorer');
    const beforeHeader = (await header.boundingBox())!;
    const beforeExplorer = (await explorer.boundingBox())!;
    await page.evaluate(() => window.scrollTo(0, 180));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const scrollY = await page.evaluate(() => window.scrollY);
    const afterHeader = (await header.boundingBox())!;
    const afterExplorer = (await explorer.boundingBox())!;
    expect(afterHeader.y).toBeCloseTo(0, 0);
    expect(Math.abs(afterHeader.y - beforeHeader.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(beforeExplorer.y - afterExplorer.y - scrollY)).toBeLessThanOrEqual(1);
    expect(
      await header.evaluate((element) => {
        const search = element.querySelector('.comet-header-search')!.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(search.left + search.width / 2, search.top + search.height / 2),
        );
      }),
    ).toBe(true);
    expect(
      await explorer.evaluate(
        (element) => getComputedStyle(element.closest('.dashboard-workspace-left')!).position,
      ),
    ).toBe('static');
  }
});

test('preserves the project dropdown and keyboard workflow navigation and lets settings overlay the sticky header', async ({
  page,
}) => {
  await openDemo(page, 390);
  const { header, workflow } = await expectHeaderStructure(page);
  const project = header.getByRole('combobox', { name: '选择项目', exact: true });
  await project.focus();
  await page.keyboard.press('ArrowDown');
  const dropdown = page.locator('.comet-project-select-dropdown:visible');
  await expect(dropdown).toBeVisible();
  await expect(dropdown).not.toHaveClass(/ant-slide-up-(?:appear|enter)/);
  await expect
    .poll(() =>
      dropdown.evaluate(async (element) => {
        const ready = () => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.right <= innerWidth + 1 &&
            element.contains(
              document.elementFromPoint(
                rect.left + rect.width / 2,
                rect.top + Math.min(rect.height / 2, 20),
              ),
            )
          );
        };
        if (!ready()) return false;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!ready()) return false;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return ready();
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dropdown).toHaveCount(0);
  await expect(project).toBeFocused();
  const classic = workflow.getByRole('tab', { name: workflowTabNames.Classic });
  await classic.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const native = workflow.getByRole('tab', { name: workflowTabNames.Native });
  await expect(native).toBeFocused();
  await expect(native).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.native-change-detail')).toBeVisible();
  await settleHeader(page);
  const settings = header.getByRole('button', { name: '设置', exact: true });
  await settings.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(
    await header.evaluate((element) => {
      const search = element.querySelector('.comet-header-search')!.getBoundingClientRect();
      const hit = document.elementFromPoint(
        search.left + search.width / 2,
        search.top + search.height / 2,
      );
      return !element.contains(hit) && Boolean(hit?.closest('.ant-modal-root'));
    }),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await expectHeaderGeometry(page, false);
});
