import { expect, test, type Page } from '@playwright/test';

async function openSettings(page: Page) {
  const settings = page.getByRole('button', { name: /^(设置|Settings)$/u });
  if (!(await settings.isVisible())) {
    await page.getByRole('button', { name: /^(打开导航|Open navigation)$/u }).click();
  }
  await settings.click();
  return page.getByRole('dialog', { name: /Comet (设置|settings)/iu });
}

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
