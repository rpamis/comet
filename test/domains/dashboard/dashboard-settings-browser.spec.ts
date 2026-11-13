import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  const settings = page.getByRole('button', { name: /^(设置|Settings)$/u });
  if (!(await settings.isVisible())) {
    await page.getByRole('button', { name: /^(打开导航|Open navigation)$/u }).click();
  }
  await settings.click();
  const dialog = page.getByRole('dialog', { name: /Comet (设置|settings)/iu });
  await expect(dialog).toHaveCSS('transform', 'none');
  return dialog;
}

for (const language of ['zh', 'en'] as const) {
  test(`saves and reloads the change walkthrough switch in ${language}`, async ({
    page,
  }, testInfo) => {
    const { DEMO_PROJECT_CONFIG } = await import('../../../domains/dashboard/web/demo.js');
    let config = { ...DEMO_PROJECT_CONFIG, changeWalkthrough: true };
    const writes: boolean[] = [];
    const parallelLimits: number[] = [];
    await page.setViewportSize({ width: language === 'zh' ? 1280 : 390, height: 900 });
    await page.addInitScript(
      (language) => localStorage.setItem('comet-dashboard-language', language),
      language,
    );
    await page.route('**/api/dashboard/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith('/projects'))
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
      if (pathname.endsWith('/config')) {
        if (route.request().method() === 'POST') {
          const input = route.request().postDataJSON();
          expect(input.expectedRevision).toBe(config.revision);
          writes.push(input.config.changeWalkthrough);
          parallelLimits.push(input.config.native.maxParallelChildren);
          config = { ...config, ...input.config, revision: `revision-${writes.length}` };
        }
        return route.fulfill({ json: config });
      }
      return route.fulfill({ json: { items: [], total: 0 } });
    });
    const openConfig = async () => {
      const dialog = await openSettings(page);
      await dialog
        .getByRole('menuitem', {
          name: language === 'zh' ? /Comet 配置$/u : /Comet configuration$/u,
        })
        .click();
      return dialog;
    };
    await page.goto('/');
    let dialog = await openConfig();
    const switchName = language === 'zh' ? '切换变更说明' : 'Toggle change walkthrough';
    for (const enabled of [false, true]) {
      const control = dialog.getByRole('switch', { name: switchName, exact: true });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeChecked({ checked: !enabled });
      await control.click();
      await dialog
        .getByRole('button', {
          name: language === 'zh' ? '保存 Comet 配置' : 'Save Comet configuration',
          exact: true,
        })
        .click();
      await expect.poll(() => writes.at(-1)).toBe(enabled);
      await page.reload();
      dialog = await openConfig();
      await expect(dialog.getByRole('switch', { name: switchName, exact: true })).toBeChecked({
        checked: enabled,
      });
    }
    expect(writes).toEqual([false, true]);
    const limitName =
      language === 'zh'
        ? 'Native Supervisor 子任务并发上限'
        : 'Native Supervisor child concurrency limit';
    const saveName = language === 'zh' ? '保存 Comet 配置' : 'Save Comet configuration';
    await dialog.getByRole('textbox', { name: limitName, exact: true }).fill('4');
    await dialog.getByRole('button', { name: saveName, exact: true }).click();
    await expect.poll(() => parallelLimits.at(-1)).toBe(4);
    await page.reload();
    dialog = await openConfig();
    const limit = dialog.getByRole('textbox', { name: limitName, exact: true });
    await expect(limit).toHaveValue('4');
    await limit.fill('0');
    await dialog.getByRole('button', { name: saveName, exact: true }).click();
    await expect(
      dialog.getByText(
        language === 'zh'
          ? 'Supervisor 子任务并发上限必须是正整数。'
          : 'The Supervisor child concurrency limit must be a positive integer.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(parallelLimits).toEqual([2, 2, 4]);
    await limit.fill('4');
    await limit.evaluate((element) =>
      element.closest('.dashboard-memory-setting')?.scrollIntoView({ block: 'center' }),
    );
    await page.screenshot({ path: testInfo.outputPath(`supervisor-limit-${language}.png`) });
    await dialog.getByRole('switch', { name: switchName }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`walkthrough-${language}.png`) });
    expect(
      await dialog
        .locator('.dashboard-settings-main')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
  });
}

test('shows flat settings tabs and spaces Eval cards like other settings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo');
  const dialog = await openSettings(page);
  const navigation = dialog.locator('.dashboard-settings-navigation');
  await expect(navigation.getByRole('menuitem')).toHaveCount(5);
  await expect(navigation.getByText('个人偏好', { exact: true })).toHaveCount(0);
  await expect(navigation.getByText('项目能力', { exact: true })).toHaveCount(0);
  await expect(navigation.getByText('评估', { exact: true })).toHaveCount(0);

  const cardGaps = () =>
    dialog.locator('.dashboard-settings-panel').evaluateAll((elements) => {
      const boxes = elements.map((element) => element.getBoundingClientRect());
      return boxes.slice(1).map((box, index) => box.top - boxes[index].bottom);
    });
  await navigation.getByRole('menuitem', { name: /个人记忆$/u }).click();
  await expect(dialog.getByRole('heading', { name: '全局能力', exact: true })).toBeVisible();
  const referenceGap = (await cardGaps())[0];
  expect(referenceGap).toBeGreaterThan(0);

  await navigation.getByRole('menuitem', { name: /Eval$/u }).click();
  await expect(dialog.getByRole('heading', { name: '默认执行模型', exact: true })).toBeVisible();
  const evalGaps = await cardGaps();
  expect(evalGaps).toHaveLength(3);
  for (const gap of evalGaps) expect(gap).toBeCloseTo(referenceGap, 0);
});

test('changes the interface language in settings without leaving the panel and persists it after reload', async ({
  page,
}) => {
  await page.goto('/?demo');
  const dialog = await openSettings(page);
  await dialog.getByRole('menuitem', { name: '外观' }).click();
  const currentUrl = page.url();

  await dialog.getByRole('combobox', { name: '界面语言', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(dialog.getByRole('menuitem', { name: 'Appearance' })).toHaveClass(
    /ant-menu-item-selected/u,
  );
  await expect(page).toHaveURL(currentUrl);
  await expect(
    dialog.getByRole('combobox', { name: 'Interface language', exact: true }),
  ).toBeVisible();

  await page.reload();
  const restored = await openSettings(page);
  await restored.getByRole('menuitem', { name: 'Appearance' }).click();
  await expect(restored.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(restored.locator('.dashboard-language-select')).toContainText('English');
});

test('scales the type preview once with the font slider and restores its original hierarchy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?demo');
  const dialog = await openSettings(page);
  await dialog.getByRole('menuitem', { name: '外观' }).click();
  const preview = dialog.locator('.dashboard-type-preview');
  const sizes = () =>
    preview
      .locator('strong, p, code')
      .evaluateAll((elements) =>
        elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
      );
  await expect(preview).toBeVisible();
  const original = await sizes();
  expect(original).toEqual([20, 14, 13]);

  const slider = dialog.getByRole('slider', { name: '字体大小', exact: true });
  await slider.focus();
  for (let step = 0; step < 5; step += 1) await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '125');
  await expect.poll(sizes).toEqual(original.map((size) => size * 1.25));
  await expect(preview).toBeVisible();

  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await expect.poll(sizes).toEqual(original);
});

for (const language of ['zh', 'en'] as const) {
  test(`keeps every settings category reachable at 390px with ${language} and 125% type`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((language) => {
      localStorage.setItem('comet-dashboard-language', language);
      localStorage.setItem('comet-dashboard-font-scale', '125');
    }, language);
    await page.goto('/?demo');
    const dialog = await openSettings(page);
    const labels =
      language === 'zh'
        ? ['外观', '个人记忆', '项目知识', 'Comet 配置', 'Eval']
        : ['Appearance', 'Personal memory', 'Project knowledge', 'Comet configuration', 'Eval'];
    const titles =
      language === 'zh'
        ? ['外观', '个人记忆设置', '项目知识设置', 'Comet 配置']
        : [
            'Appearance',
            'Personal memory settings',
            'Project knowledge settings',
            'Comet configuration',
          ];

    for (const [index, label] of labels.entries()) {
      const item = dialog.getByRole('menuitem', { name: label, exact: true });
      await item.scrollIntoViewIfNeeded();
      await item.click();
      await expect(item).toHaveClass(/ant-menu-item-selected/u);
      if (index < titles.length) {
        await expect(
          dialog.getByRole('heading', { name: titles[index], exact: true }),
        ).toBeVisible();
      } else {
        await expect(
          dialog.getByRole('button', {
            name: language === 'zh' ? '保存 Eval 设置' : 'Save Eval settings',
            exact: true,
          }),
        ).toBeVisible();
      }
      const navigation = await dialog.locator('.dashboard-settings-navigation').boundingBox();
      const button = await item.boundingBox();
      expect(button!.x).toBeGreaterThanOrEqual(navigation!.x - 2);
      expect(button!.x + button!.width).toBeLessThanOrEqual(navigation!.x + navigation!.width + 2);
      const contentFits = await dialog
        .locator('.dashboard-settings-main')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
      if (!contentFits) {
        await testInfo.attach('overflow-elements', {
          contentType: 'application/json',
          body: JSON.stringify(
            await dialog.locator('.dashboard-settings-main').evaluate((element) => {
              const boundary = element.getBoundingClientRect().right;
              return [...element.querySelectorAll('*')]
                .filter((child) => child.getBoundingClientRect().right > boundary + 1)
                .map((child) => ({
                  tag: child.tagName,
                  className: child.className,
                  text: child.textContent?.slice(0, 80),
                  width: child.getBoundingClientRect().width,
                  right: child.getBoundingClientRect().right,
                }));
            }),
            null,
            2,
          ),
        });
      }
      expect(contentFits, `${label} should fit its reading column`).toBe(true);
    }

    await dialog.getByRole('menuitem', { name: labels[0], exact: true }).click();
    await dialog.getByRole('slider').scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('slider')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`settings-${language}-390.png`) });
    await dialog
      .getByRole('button', { name: language === 'zh' ? '完成' : 'Done', exact: true })
      .click();
    await expect(dialog).toBeHidden();
  });
}
