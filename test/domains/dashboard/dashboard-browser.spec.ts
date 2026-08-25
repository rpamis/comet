import { expect, test } from '@playwright/test';

test('shows Project Knowledge status and project pause transitions', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1600, height: 900 });
  let paused = false;
  let uninstalled = false;
  const queryTasks: string[] = [];
  const manualRecords: Array<Record<string, unknown>> = [];
  const baseRecord = {
    id: 'record-focused-tests',
    projectId: 'fixture-project',
    type: 'topology',
    state: 'proven',
    authority: 'automatic',
    title: 'Focused tests',
    summary: 'Prefer focused tests for small changes.',
    applicablePaths: ['domains/'],
    operations: ['verify'],
    conclusions: [
      {
        text: 'Run focused tests first.',
        sources: [{ source: 'docs/rule.md', anchor: 'rule' }],
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
        whyApplied: '当前路径与项目策略匹配',
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
    updatedAt: '2026-08-22T12:00:00.000Z',
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
          records: [baseRecord, ...manualRecords],
          manifestPreview: [
            {
              id: baseRecord.id,
              title: baseRecord.title,
              summary: baseRecord.summary,
              whyApplied: '当前任务与验证阶段匹配',
              delivery: 'manifest',
              appliedAt: '2026-08-23T08:00:00.000Z',
              outcome: 'used-successfully',
            },
          ],
          counts: {
            trial: manualRecords.filter((record) => record.state === 'trial').length,
            proven: 1 + manualRecords.filter((record) => record.state === 'proven').length,
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
          : [
              {
                source: 'docs/rule.md#rule',
                title: 'Focused tests',
                content: 'Run focused tests first.',
              },
            ];
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
      if (uninstalled) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ json: projectKnowledgePage() });
      return;
    }
    if (url.pathname.endsWith('/plugins')) {
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
  const projectManifest = page.getByRole('region', { name: '最近一次 Context Manifest' });
  await expect(projectManifest).toContainText('Focused tests');
  await expect(projectManifest).toContainText('当前任务与验证阶段匹配');
  await expect(projectManifest).toContainText('应用成功');
  await expect(page.getByLabel('项目规则状态与操作')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '项目知识视图' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '知识分类' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '记录详情' })).toBeVisible();
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

  await page.getByRole('button', { name: '数据来源' }).click();
  await expect(page.getByRole('heading', { name: '数据来源' })).toBeVisible();
  await expect(page.getByLabel('项目知识数据来源列表')).toContainText('docs/rule.md#rule');

  await page.getByRole('button', { name: '检索测试' }).click();
  await page.getByLabel('查询项目知识').fill('focused tests');
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect(page.getByLabel('项目知识查询结果')).toContainText('Run focused tests first.');
  await page.getByLabel('查询项目知识').fill('1231');
  await page.getByRole('button', { name: '测试检索' }).click();
  await expect.poll(() => queryTasks).toEqual(['focused tests', '1231']);
  await expect(page.getByLabel('项目知识查询结果')).toContainText(
    '检索已完成，没有找到与当前任务匹配的项目知识',
  );
  await page.getByRole('button', { name: '项目模型' }).click();

  await page.getByRole('button', { name: '新增项目知识' }).click();
  const createDialog = page.getByRole('dialog');
  await expect(createDialog).toContainText('新增项目知识');
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
  await page.getByRole('button', { name: '项目策略' }).click();
  await page.getByLabel('项目知识记录状态').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '强制执行' }).click();
  const manualRecordButton = page
    .getByLabel('项目知识记录列表')
    .getByRole('button', { name: /未文档化约定/u });
  await expect(manualRecordButton).toBeVisible();
  await manualRecordButton.click();
  await expect(page.getByText('用户手动添加', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: '记录详情' }).getByRole('status'),
  ).toContainText('缺少来源或验证记录');
  await page.getByRole('button', { name: '标记已替代' }).click();
  const archiveDialog = page.getByRole('dialog');
  await expect(archiveDialog).toContainText('将这条项目知识标记为已替代？');
  await archiveDialog.getByRole('button', { name: /标记已替代/u }).click();
  await expect(page.getByText('没有符合当前条件的项目知识')).toBeVisible();
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
  await expect(page.getByText('没有符合当前条件的项目知识')).toBeVisible();
  await page.getByLabel('项目知识记录状态').click();
  await page.locator('.ant-select-item-option').filter({ hasText: '强制执行' }).click();
  await expect(page.getByLabel('项目知识记录列表')).toContainText('未文档化约定');
  await expect(page.getByLabel('项目知识记录列表')).toContainText(
    '修改后先运行定向测试，并记录验证结果。',
  );

  await page.getByRole('button', { name: '设置' }).click();
  const settingsDialog = page.getByRole('dialog', { name: /Comet 设置/u });
  await expect(settingsDialog.getByLabel('项目规则设置')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider 与检索' })).toBeVisible();
  await expect(page.getByText('COMET_KNOWLEDGE_TOKEN')).toBeVisible();
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
  await expect(page.getByRole('menuitem', { name: '项目知识' })).toHaveCount(0);
});

test('adds global or project memory and explains why saved memories are applied', async ({
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
        files: [],
        pausedLearningProjects: [],
        pausedRetrievalProjects: [],
        profile: { usedChars: 18, maxChars: 2000 },
        provider: { provider: 'local', configured: true },
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
        },
      ],
    },
  };
  let rememberRequest: unknown;

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
          scope: string;
          memoryClass: string;
          category: string;
          text: string;
        };
      };
      rememberRequest = body;
      const targetRecords = body.input.scope === 'project' ? projectRecords : profileRecords;
      if (body.capability === 'remove') {
        const target = projectRecords.find((record) => record.id === body.input.id);
        if (target) target.status = 'superseded';
        await route.fulfill({ json: { result: null } });
        return;
      }
      const addedRecord = {
        id: 'new-profile-memory',
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
  const memoryManifest = page.getByRole('region', { name: '最近一次 Context Manifest' });
  await expect(memoryManifest).toContainText('默认使用中文回复');
  await expect(memoryManifest).toContainText('用户明确设置');
  await expect(memoryManifest).toContainText('应用成功');
  await expect(page.getByText('为什么应用：用户明确设置', { exact: true })).toBeVisible();
  await expect(page.getByLabel('记忆应用详情')).toContainText('应用成功');
  await expect(page.getByLabel('记忆应用详情')).toContainText('撰写发布说明');
  await expect(page.getByLabel('记忆应用详情')).toContainText('回答项目问题');
  await page.getByRole('button', { name: '新增偏好' }).click();

  const profileDialog = page.getByRole('dialog', { name: '新增偏好' });
  await expect(profileDialog.getByText('偏好内容', { exact: true })).toBeVisible();
  await expect(profileDialog.getByText('分类（可选）', { exact: true })).toBeVisible();
  const profileInput = profileDialog.getByLabel('偏好内容');
  await expect(profileInput).toBeFocused();
  await expect(profileDialog.getByRole('button', { name: /保\s*存/u })).toBeDisabled();

  await profileInput.fill('提交前先运行最小相关测试');
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
  const projectDialog = page.getByRole('dialog', { name: '新增项目记忆' });
  await expect(projectDialog.getByText('记忆内容', { exact: true })).toBeVisible();
  await expect(projectDialog.getByText('分类（可选）', { exact: true })).toBeVisible();
  const projectInput = projectDialog.getByLabel('记忆内容');
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
  const archivedProjectMemory = projectSection
    .locator('.dashboard-memory-table-row')
    .filter({ hasText: '这个项目优先使用最小相关测试' });
  await expect(archivedProjectMemory).toContainText('已替代');
  await expect(page.getByRole('button', { name: '协作策略 0' })).toBeVisible();
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
  await page.getByRole('menuitem', { name: '个人记忆' }).click();
  const projectMemory = page.getByRole('region', { name: '个人记忆列表' });
  const projectMemoryRow = projectMemory.locator('.dashboard-memory-table-row').first();
  await expect(projectMemoryRow.getByText(originalRecord.text, { exact: true })).toBeVisible();

  await projectMemoryRow.getByRole('button', { name: '纠正记忆', exact: true }).click();
  const correctionDialog = page.getByRole('dialog', { name: '纠正这条记忆' });
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
  const nativeCopyChangeName = page.getByRole('button', { name: '复制 Change 名称' });
  await expect(nativeCopyChangeName).toHaveCount(1);
  await nativeCopyChangeName.click();
  await expect(page.getByRole('button', { name: '已复制 Change 名称' })).toBeVisible();

  await page.getByRole('button', { name: '需求简报' }).click();
  await expect(page.getByRole('heading', { name: '需求简报' })).toBeVisible();
  await expect(page.getByText('Ship a fast, recoverable Native dashboard.')).toBeVisible();
  await page.getByRole('button', { name: '关闭产物预览' }).last().click();

  await page.getByRole('tab', { name: '已归档', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'document-native-resume' })).toBeVisible();
  await expect(page.getByLabel('Archive 已完成')).toHaveText('✓');
  await expect(page.getByText(/Build ↔ Verify Loop · 已完成/u)).toBeVisible();
  await expect(page.getByText('你已确认接受不完整验证结果', { exact: true })).toBeVisible();
  await expect(page.getByText('归档只读', { exact: true }).first()).toBeVisible();

  const classicWorkflow = page.getByRole('menuitem', { name: 'Classic 工作流' });
  await classicWorkflow.click();
  await expect(classicWorkflow).toHaveClass(/ant-menu-item-selected/);
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
  await page.goto('/?demo');

  const header = page.locator('.comet-workbench-header');
  await expect(header.getByText('当前项目', { exact: true })).toHaveCount(0);
  await expect(header.getByText('工作流', { exact: true })).toHaveCount(0);
  await expect(header.locator('.comet-header-sync')).toHaveCount(0);
  await expect(header).toHaveCSS('min-height', '68px');
  await expect(header.locator('.ant-segmented')).toHaveCount(0);
  const search = header.locator('.comet-header-search');
  await expect(search).toHaveCSS('position', 'absolute');
  await expect(search).toHaveCSS('width', '360px');
  await expect(page.locator('.comet-header-search .ant-input-affix-wrapper')).toHaveCSS(
    'min-height',
    '40px',
  );
  await expect(page.getByRole('button', { name: '立即刷新' })).toHaveText('');

  const [searchBox, workbenchBox] = await Promise.all([
    search.boundingBox(),
    page.locator('.dashboard-workbench').boundingBox(),
  ]);
  if (!searchBox || !workbenchBox) {
    throw new Error('Expected the search field and workbench to have measurable bounds');
  }
  expect(
    Math.abs(searchBox.x + searchBox.width / 2 - (workbenchBox.x + workbenchBox.width / 2)),
  ).toBeLessThanOrEqual(1);
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
  await expect(page.locator('.ant-steps-item-wait .ant-steps-item-title').first()).toHaveCSS(
    'color',
    'rgb(165, 180, 200)',
  );
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
  await expect(page.locator('.ant-steps-item-rail-wait').first()).toHaveCSS(
    'background-color',
    'rgb(58, 70, 88)',
  );

  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();
  const nativeSelectedItem = page.locator('.native-change-list-item.selected');
  await expect(nativeSelectedItem).toHaveCSS('background-color', 'rgb(27, 45, 72)');
  await expect(nativeSelectedItem).toHaveCSS('color', 'rgb(237, 242, 251)');

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
    page.locator('.ant-steps').boundingBox(),
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

test('opens Native on its active view without loading a list that the overview proves is empty', async ({
  page,
}) => {
  const nativePageRequests: string[] = [];
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
  await page.getByRole('tab', { name: '已归档' }).click();
  await page.getByRole('menuitem', { name: 'Native 工作流' }).click();

  await expect(page.getByRole('tab', { name: '活跃' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: '当前没有活跃的 Native change' })).toBeVisible();
  await expect(page.locator('.native-workspace-empty .ant-spin')).toHaveCount(0);
  await expect(page.locator('.dashboard-workspace-region')).toHaveCount(0);
  expect(nativePageRequests).toEqual([]);
});

test('pins the desktop workbench frame while rich content scrolls in the center pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?demo');

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
  await expect(page.locator('.native-workspace-empty')).toBeVisible();
  await expect(page.locator('.native-changes-explorer')).toHaveCount(0);
  await expect(page.locator('.dashboard-workspace-right')).toHaveCount(0);
  await page.getByRole('tab', { name: '已归档' }).click();

  await expect
    .poll(() => pageRequests.filter((request) => request.includes('status=archived')).length)
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.native-workspace-empty .ant-spin')).toBeVisible();
  releaseFirstPage();
  await expect.poll(() => pageRequests.length).toBeGreaterThanOrEqual(2);
  const list = page.locator('.native-change-list');
  await expect(page.locator('.native-changes-count')).toHaveText('8');
  await expect(list.locator('.native-change-row')).toHaveCount(8);
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
  const parent = nativeDetail('parent-change', 'parent-locator', parentWorkspace, [childSummary]);
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
  const childRow = page.locator('.native-child-change-row').filter({ hasText: 'child-a' });
  await expect(childRow).toBeVisible();
  await expect(childRow).toContainText('native/child-a');
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
      const nativeCount = nativeExplorer.locator('.native-changes-count');
      await expect(nativeCount).toHaveText(/^\d+$/);
      await expect(nativeCount).toHaveCSS('background-color', 'rgb(11, 24, 51)');
      await expect(nativeCount).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(nativeCount).toHaveCSS('min-width', '20px');
      await expect(nativeCount).toHaveCSS('padding', '0px 8px');
      await expect(nativeCount).toHaveCSS('font-weight', '400');
      await expect(nativeCount).toHaveCSS(
        'font-family',
        '"Segoe UI Variable", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
      );
      await expect(nativeCount).toHaveCSS('letter-spacing', '-0.182px');
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
      await expect(selectedNativeRow.locator('.truncate')).toHaveCSS('font-size', '14px');
      await expect(selectedNativeRow.getByText('◇', { exact: true })).toHaveCount(0);
      await expect(selectedNativeRow).toContainText('Build · 1/3 子变更待验证');
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
