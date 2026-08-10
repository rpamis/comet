// Demo snapshot for `?demo` mode — mirrors the DashboardSnapshot contract
// (domains/dashboard/types.ts) exactly. Used when a reviewer wants to see the
// dashboard populated without a real openspec/changes layout. Field names are
// stable; see types.ts before renaming anything.

function addCometArtifacts(change) {
  const dir = change.path;
  const phase = change.phase;
  const hasDesignDoc = phase !== 'open' && phase !== 'unknown';
  const superpowers = [];
  if (hasDesignDoc && !change.artifacts?.grouped?.some((a) => a.key === 'designDoc')) {
    superpowers.push({
      key: 'designDoc',
      label: '技术设计',
      source: 'superpowers',
      exists: true,
      path: `docs/superpowers/specs/${change.name}-design.md`,
    });
  }
  const comet = [
    {
      key: 'cometYaml',
      label: '.comet.yaml',
      source: 'comet',
      exists: change.artifacts?.cometYaml ?? true,
      path: `${dir}/.comet.yaml`,
    },
    {
      key: 'handoff',
      label: 'Handoff 上下文',
      source: 'comet',
      exists: false,
      path: `${dir}/.comet/handoff/design-context.json`,
    },
    {
      key: 'checkpoint',
      label: 'Checkpoint',
      source: 'comet',
      exists: false,
      path: `${dir}/.comet/checkpoint.json`,
    },
    {
      key: 'brainstorm',
      label: 'Brainstorm 摘要',
      source: 'comet',
      exists: false,
      path: `${dir}/.comet/handoff/brainstorm-summary.md`,
    },
    {
      key: 'subagentProgress',
      label: 'Subagent 进度',
      source: 'comet',
      exists: false,
      path: `${dir}/.comet/subagent-progress.md`,
    },
  ];
  if (change.artifacts?.grouped) {
    change.artifacts.grouped.push(...superpowers, ...comet);
  }
  return change;
}

/** @type {import('./types.js').DashboardSnapshot} */
export const DEMO_SNAPSHOT = {
  project: {
    name: 'Comet',
    path: '~/projects/comet',
    generatedAt: '2026-06-25T14:32:00.000Z',
  },
  summary: {
    activeChanges: 4,
    archivedChanges: 3,
    verifyFailed: 1,
    tasksIncomplete: 15,
    dirtyFiles: 3,
  },
  git: {
    branch: 'feat/dashboard-redesign',
    head: '8f3a2c1',
    dirtyFiles: 3,
    dirtyFileList: [
      'domains/dashboard/web/index.html',
      'domains/dashboard/web/styles.css',
      'domains/dashboard/collector.ts',
    ],
    // recentCommits is a string[] in the contract; the frontend formats these.
    recentCommits: [
      '8f3a2c1 重构 dashboard 采集逻辑',
      '2bd9e0a 新增 phase stepper 组件',
      'c4f1a80 修复 verify 解析空指针',
      '9a02d7d 初始化 openspec/changes 目录',
    ],
  },
  risks: [
    {
      level: 'error',
      code: 'verify-failed',
      message: '1 个变更验证失败',
      suggestion: '打开 fix-webhook-retries 并重新运行 comet verify',
    },
    {
      level: 'warning',
      code: 'tasks-incomplete',
      message: '共 15 个未完成任务',
      suggestion: '完成任务后变更即可进入 Verify 阶段',
    },
    {
      level: 'warning',
      code: 'git-dirty',
      message: '3 个未提交文件阻塞 verify',
      suggestion: '提交或暂存 (stash) 后再运行验证',
    },
  ],
  changes: {
    active: [
      {
        id: 'add-auth-rate-limiting',
        name: 'add-auth-rate-limiting',
        displayName: 'add-auth-rate-limiting',
        status: 'active',
        path: 'openspec/changes/add-auth-rate-limiting',
        workflow: 'feature',
        phase: 'build',
        updatedAt: '2 小时前',
        tasks: {
          completed: 8,
          total: 12,
          incomplete: [
            '为滑动窗口补充单元测试',
            'Redis 适配器集成测试',
            '5000 QPS 压测场景',
            '补充 README 限流说明',
          ],
          sections: [
            { title: '限流策略', completed: 3, total: 3, status: 'done' },
            { title: '中间件实现', completed: 3, total: 4, status: 'active' },
            { title: '测试覆盖', completed: 2, total: 5, status: 'pending' },
          ],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: false,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/add-auth-rate-limiting/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/add-auth-rate-limiting/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/add-auth-rate-limiting/tasks.md',
            },
            {
              key: 'designDoc',
              label: '技术设计',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/specs/2026-06-20-rate-limiting-design.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2026-06-20-rate-limiting.md',
            },
          ],
        },
        verify: { result: 'pending', reportExists: false },
        next: {
          command: 'comet build',
          reason: '还有 4 个任务未完成',
          description: '优先推进「测试覆盖」分组，全部任务完成后即可进入 Verify 阶段。',
        },
        risks: [
          {
            level: 'warning',
            code: 'tasks-incomplete',
            message: '4 个任务未完成，将阻塞进入 Verify',
            suggestion: '完成「测试覆盖」分组后运行 comet verify',
          },
        ],
      },
      {
        id: 'dashboard-redesign',
        name: 'dashboard-redesign',
        displayName: 'dashboard-redesign',
        status: 'active',
        path: 'openspec/changes/dashboard-redesign',
        workflow: 'feature',
        phase: 'design',
        updatedAt: '昨天',
        tasks: {
          completed: 2,
          total: 9,
          incomplete: ['锁定视觉系统', '定义响应式断点', '交互原型'],
          sections: [
            { title: '信息架构', completed: 2, total: 3, status: 'active' },
            { title: '视觉系统', completed: 0, total: 3, status: 'pending' },
            { title: '交互原型', completed: 0, total: 3, status: 'pending' },
          ],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: false,
          verifyReport: false,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/dashboard-redesign/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/dashboard-redesign/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/dashboard-redesign/tasks.md',
            },
          ],
        },
        verify: { result: 'pending', reportExists: false },
        next: {
          command: 'comet design',
          reason: '设计阶段进行中',
          description: '完成视觉系统与交互原型分组后，产出 plan.md 并进入构建。',
        },
        risks: [
          {
            level: 'warning',
            code: 'tasks-incomplete',
            message: '7 个任务未完成',
            suggestion: '先锁定视觉系统，再展开交互原型',
          },
        ],
      },
      {
        id: 'fix-webhook-retries',
        name: 'fix-webhook-retries',
        displayName: 'fix-webhook-retries',
        status: 'active',
        path: 'openspec/changes/fix-webhook-retries',
        workflow: 'fix',
        phase: 'verify',
        updatedAt: '3 小时前',
        tasks: {
          completed: 11,
          total: 11,
          incomplete: [],
          sections: [
            { title: '重试逻辑', completed: 5, total: 5, status: 'done' },
            { title: '退避策略', completed: 3, total: 3, status: 'done' },
            { title: '测试', completed: 3, total: 3, status: 'done' },
          ],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: true,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/fix-webhook-retries/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/fix-webhook-retries/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/fix-webhook-retries/tasks.md',
            },
            {
              key: 'designDoc',
              label: '技术设计',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/specs/2026-06-22-webhook-retry-design.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2026-06-22-webhook-retry.md',
            },
            {
              key: 'verifyReport',
              label: '验证报告',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/reports/2026-06-23-webhook-verify.md',
            },
          ],
        },
        verify: {
          result: 'fail',
          reportExists: true,
          summary: '2 / 4 断言通过 — 重试上限与幂等性失败',
        },
        next: {
          command: 'comet verify',
          reason: '验证失败需修复',
          description: 'verify-result.md 显示 2 项断言失败，修复后重新运行 comet verify。',
        },
        risks: [
          {
            level: 'error',
            code: 'verify-failed',
            message: '验证未通过：2 项断言失败',
            suggestion: '检查 verify-result.md 中的失败用例并修复实现',
          },
        ],
      },
      {
        id: 'migrate-config-to-yaml',
        name: 'migrate-config-to-yaml',
        displayName: 'migrate-config-to-yaml',
        status: 'active',
        path: 'openspec/changes/migrate-config-to-yaml',
        workflow: 'refactor',
        phase: 'build',
        updatedAt: '2 天前',
        tasks: {
          completed: 6,
          total: 10,
          incomplete: ['完成迁移脚本 dry-run', '补充配置迁移文档'],
          sections: [
            { title: '配置映射', completed: 4, total: 4, status: 'done' },
            { title: '迁移脚本', completed: 2, total: 3, status: 'active' },
            { title: '文档更新', completed: 0, total: 3, status: 'pending' },
          ],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: false,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/migrate-config-to-yaml/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/migrate-config-to-yaml/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/migrate-config-to-yaml/tasks.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2026-06-26-config-yaml.md',
            },
          ],
        },
        verify: { result: 'pending', reportExists: false },
        next: {
          command: 'comet build',
          reason: '4 个任务未完成',
          description: '完成迁移脚本与文档更新分组后进入验证。',
        },
        risks: [
          {
            level: 'info',
            code: 'phase-stale',
            message: '该变更 2 天未更新',
            suggestion: '确认是否仍活跃，否则考虑归档',
          },
        ],
      },
    ],
    archived: [
      {
        id: 'archive/2025-11-02-add-dark-mode',
        name: '2025-11-02-add-dark-mode',
        displayName: 'add-dark-mode',
        status: 'archived',
        path: 'openspec/changes/archive/2025-11-02-add-dark-mode',
        workflow: 'feature',
        phase: 'archive',
        updatedAt: '2025-11-02',
        archive: {
          archiveName: '2025-11-02-add-dark-mode',
          originalName: 'add-dark-mode',
          archivedAt: '2025-11-02',
          archivePath: 'openspec/changes/archive/2025-11-02-add-dark-mode',
        },
        tasks: {
          completed: 14,
          total: 14,
          incomplete: [],
          sections: [
            { title: '主题切换', completed: 6, total: 6, status: 'done' },
            { title: '样式适配', completed: 8, total: 8, status: 'done' },
          ],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: true,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-11-02-add-dark-mode/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-11-02-add-dark-mode/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-11-02-add-dark-mode/tasks.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2025-11-01-dark-mode.md',
            },
            {
              key: 'verifyReport',
              label: '验证报告',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/reports/2025-11-02-dark-mode-verify.md',
            },
          ],
        },
        verify: { result: 'pass', reportExists: true, summary: '全部断言通过' },
      },
      {
        id: 'archive/2025-10-18-refactor-collector',
        name: '2025-10-18-refactor-collector',
        displayName: 'refactor-collector',
        status: 'archived',
        path: 'openspec/changes/archive/2025-10-18-refactor-collector',
        workflow: 'refactor',
        phase: 'archive',
        updatedAt: '2025-10-18',
        archive: {
          archiveName: '2025-10-18-refactor-collector',
          originalName: 'refactor-collector',
          archivedAt: '2025-10-18',
          archivePath: 'openspec/changes/archive/2025-10-18-refactor-collector',
        },
        tasks: {
          completed: 9,
          total: 9,
          incomplete: [],
          sections: [{ title: '重构', completed: 9, total: 9, status: 'done' }],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: true,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-10-18-refactor-collector/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-10-18-refactor-collector/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-10-18-refactor-collector/tasks.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2025-10-17-refactor-collector.md',
            },
            {
              key: 'verifyReport',
              label: '验证报告',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/reports/2025-10-18-collector-verify.md',
            },
          ],
        },
        verify: { result: 'pass', reportExists: true, summary: '全部断言通过' },
      },
      {
        id: 'archive/2025-09-30-init-openspec',
        name: '2025-09-30-init-openspec',
        displayName: 'init-openspec',
        status: 'archived',
        path: 'openspec/changes/archive/2025-09-30-init-openspec',
        workflow: 'chore',
        phase: 'archive',
        updatedAt: '2025-09-30',
        archive: {
          archiveName: '2025-09-30-init-openspec',
          originalName: 'init-openspec',
          archivedAt: '2025-09-30',
          archivePath: 'openspec/changes/archive/2025-09-30-init-openspec',
        },
        tasks: {
          completed: 6,
          total: 6,
          incomplete: [],
          sections: [{ title: '初始化', completed: 6, total: 6, status: 'done' }],
        },
        artifacts: {
          proposal: true,
          design: true,
          tasks: true,
          plan: true,
          verifyReport: true,
          cometYaml: true,
          grouped: [
            {
              key: 'proposal',
              label: '提案',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-09-30-init-openspec/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-09-30-init-openspec/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'openspec/changes/archive/2025-09-30-init-openspec/tasks.md',
            },
            {
              key: 'plan',
              label: '实施计划',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/plans/2025-09-29-init-openspec.md',
            },
            {
              key: 'verifyReport',
              label: '验证报告',
              source: 'superpowers',
              exists: true,
              path: 'docs/superpowers/reports/2025-09-30-openspec-verify.md',
            },
          ],
        },
        verify: { result: 'pass', reportExists: true, summary: '全部断言通过' },
      },
    ],
  },
};

function demoNativeText(text) {
  return { text, truncated: false };
}

function createNativeV2Seed(options) {
  const archived = options.status === 'archived';
  const acceptanceItems = options.acceptanceItems ?? [];
  const acceptance = {
    total: acceptanceItems.length,
    passed: acceptanceItems.filter((item) => item.result === 'passed').length,
    failed: acceptanceItems.filter((item) => item.result === 'failed').length,
    blocked: acceptanceItems.filter((item) => item.result === 'blocked').length,
    pending: acceptanceItems.filter((item) => item.result === 'pending').length,
  };
  const stateContent = [
    'schema: comet.native.v4',
    `state_version: ${options.stateVersion}`,
    `status: ${options.status === 'archived' ? 'done' : 'active'}`,
    `phase: ${options.phase}`,
    `loop_stage: ${options.stage}`,
    `acceptance_total: ${acceptance.total}`,
    `acceptance_passed: ${acceptance.passed}`,
    `acceptance_failed: ${acceptance.failed}`,
    `acceptance_blocked: ${acceptance.blocked}`,
    `acceptance_pending: ${acceptance.pending}`,
    '',
  ].join('\n');
  return {
    workflow: 'native',
    name: options.name,
    status: options.status,
    ...(options.archiveName ? { archiveName: options.archiveName } : {}),
    archivedAt: options.archivedAt ?? null,
    phase: options.phase,
    lifecycleStatus: archived ? 'done' : 'active',
    stateVersion: options.stateVersion,
    legacy: false,
    migration: { status: 'none', message: null },
    loop: {
      stage: options.stage,
      goalCycle: options.goalCycle ?? 1,
      iteration: options.iteration,
      attempt: options.attempt,
      nextAction: options.nextAction ?? null,
      actor: options.actor ?? null,
    },
    acceptance,
    verificationResult: options.verificationResult,
    localExecution: {
      status: options.localStatus ?? 'absent',
      reason: options.localReason,
      stage: options.localStage ?? null,
      actor: options.actor ?? null,
      startedAt: options.localStatus === 'running' ? '2026-08-09T14:20:00.000Z' : null,
      requestCheckRounds: options.requestCheckRounds ?? 0,
      checks: options.localChecks ?? [],
      recoverableFromStage: options.recoverableFromStage ?? null,
    },
    artifacts: [
      {
        key: 'comet-state.yaml',
        label: '工作流状态',
        path: 'comet-state.yaml',
        exists: true,
        content: stateContent,
        truncated: false,
        size: stateContent.length,
      },
      ...(options.artifacts ?? []),
    ],
    specs: options.specs ?? {
      total: 0,
      create: 0,
      modify: 0,
      remove: 0,
      capabilities: [],
      capabilitiesTruncated: false,
    },
    acceptanceItems,
    builderHandoff: options.builderHandoff ?? null,
    verification: options.verification ?? null,
    checks: options.checks ?? [],
    blockers: options.blockers ?? [],
    history: options.history ?? [],
    historyOverflow: options.historyOverflow ?? {
      droppedEntries: 0,
      firstDroppedAt: null,
      lastDroppedAt: null,
      outcomeCounts: { pass: 0, fail: 0, blocked: 0, 'execution-error': 0, recovery: 0 },
    },
  };
}

const nativeV2Building = createNativeV2Seed({
  name: 'ship-native-dashboard',
  status: 'active',
  phase: 'build',
  stateVersion: 8,
  stage: 'building',
  iteration: 2,
  attempt: 1,
  actor: 'builder',
  nextAction: 'Builder 完成本轮实现后提交 handoff。',
  verificationResult: 'pending',
  localStatus: 'running',
  localReason: 'current',
  localStage: 'building',
  requestCheckRounds: 1,
  localChecks: [
    {
      id: 'dashboard-focused-tests',
      status: 'running',
      startedAt: '2026-08-09T14:20:00.000Z',
      completedAt: null,
      logAvailable: true,
    },
  ],
  artifacts: [
    {
      key: 'brief',
      label: '需求简报',
      path: 'brief.md',
      exists: true,
      content: '# Outcome\n\nShip a fast, recoverable Native dashboard.\n',
      truncated: false,
      size: 58,
    },
    {
      key: 'spec-dashboard',
      label: 'dashboard Spec',
      path: 'specs/dashboard.md',
      exists: true,
      content: '# Dashboard\n\nShow Loop and acceptance state.\n',
      truncated: false,
      size: 48,
    },
  ],
  specs: {
    total: 1,
    create: 0,
    modify: 1,
    remove: 0,
    capabilities: [{ capability: 'dashboard', operation: 'modify' }],
    capabilitiesTruncated: false,
  },
  acceptanceItems: [
    {
      id: 'A1',
      source: 'brief.md',
      text: 'Dashboard 展示 Loop 轮次与执行者。',
      result: 'passed',
      reason: demoNativeText('列表与详情均已显示。'),
    },
    {
      id: 'A2',
      source: 'brief.md',
      text: '当前构建完成后由 Verifier 独立复核。',
      result: 'pending',
      reason: null,
    },
  ],
  builderHandoff: {
    iteration: 1,
    summary: demoNativeText('上一轮 Builder 已提交。'),
    addressedAcceptanceIds: ['A1'],
    checks: [{ name: demoNativeText('Dashboard tests'), result: 'passed', note: null }],
    checksTruncated: false,
    knownLimits: [],
    knownLimitsTruncated: false,
    submittedAt: '2026-08-09T13:00:00.000Z',
  },
  history: Array.from({ length: 9 }, (_, index) => ({
    goalCycle: 1,
    iteration: index + 1,
    attempt: 1,
    outcome: index % 3 === 0 ? 'recovery' : 'fail',
    unresolvedIds: ['A2'],
    summary: demoNativeText(`演示循环记录 ${index + 1}`),
    completedAt: `2026-08-09T${String(index + 4).padStart(2, '0')}:00:00.000Z`,
  })),
  historyOverflow: {
    droppedEntries: 3,
    firstDroppedAt: '2026-08-08T08:00:00.000Z',
    lastDroppedAt: '2026-08-08T10:00:00.000Z',
    outcomeCounts: { pass: 0, fail: 2, blocked: 0, 'execution-error': 0, recovery: 1 },
  },
});

const nativeV2Repairing = createNativeV2Seed({
  name: 'align-dashboard-copy',
  status: 'active',
  phase: 'build',
  stateVersion: 12,
  stage: 'repairing',
  goalCycle: 2,
  iteration: 4,
  attempt: 2,
  nextAction: 'Builder 修复失败与阻塞的验收项。',
  verificationResult: 'fail',
  localReason: 'version-mismatch',
  recoverableFromStage: 'repairing',
  artifacts: [
    {
      key: 'brief',
      label: '需求简报',
      path: 'brief.md',
      exists: true,
      content: '# Outcome\n\nAlign Native dashboard copy.\n',
      truncated: false,
      size: 43,
    },
    {
      key: 'spec-dashboard-copy',
      label: 'dashboard-copy Spec',
      path: 'specs/dashboard-copy.md',
      exists: true,
      content: '# Dashboard copy\n\nUse clear Native workflow language.\n',
      truncated: false,
      size: 56,
    },
    {
      key: 'verification',
      label: '验证报告',
      path: 'verification.md',
      exists: true,
      content: '# Conclusion\n\nOne item failed and one is blocked.\n',
      truncated: false,
      size: 54,
    },
  ],
  specs: {
    total: 1,
    create: 0,
    modify: 1,
    remove: 0,
    capabilities: [{ capability: 'dashboard-copy', operation: 'modify' }],
    capabilitiesTruncated: false,
  },
  acceptanceItems: [
    { id: 'A1', source: 'brief.md', text: '展示通过项。', result: 'passed', reason: null },
    {
      id: 'A2',
      source: 'brief.md',
      text: '失败项返回 Builder。',
      result: 'failed',
      reason: demoNativeText('失败态文案仍不清楚。'),
    },
    {
      id: 'A3',
      source: 'brief.md',
      text: '外部依赖阻塞可见。',
      result: 'blocked',
      reason: demoNativeText('等待浏览器环境。'),
    },
    { id: 'A4', source: 'brief.md', text: '修复后重新验证。', result: 'pending', reason: null },
  ],
  verification: {
    verdict: 'fail',
    assurance: 'skill-coordinated',
    summary: demoNativeText('Verifier 发现一项失败和一项阻塞。'),
    risks: [demoNativeText('本机 overlay 已过期，将从 YAML 恢复。')],
    risksTruncated: false,
    completedAt: '2026-08-09T14:00:00.000Z',
  },
  checks: [
    {
      id: 'dashboard-copy-tests',
      name: demoNativeText('Dashboard copy tests'),
      status: 'failed',
      exitCode: 1,
      durationMs: 1320,
    },
  ],
  blockers: [
    {
      owner: 'builder',
      reason: demoNativeText('失败态文案仍不清楚。'),
      acceptanceIds: ['A2'],
      resolutionAction: 'return-build',
    },
    {
      owner: 'external',
      reason: demoNativeText('等待浏览器环境。'),
      acceptanceIds: ['A3'],
      resolutionAction: 'wait-external',
    },
  ],
  history: [
    {
      goalCycle: 2,
      iteration: 3,
      attempt: 2,
      outcome: 'fail',
      unresolvedIds: ['A2', 'A3'],
      summary: demoNativeText('Verifier 返回修复。'),
      completedAt: '2026-08-09T14:00:00.000Z',
    },
  ],
});

const nativeV2Archived = createNativeV2Seed({
  name: 'document-native-resume',
  status: 'archived',
  archiveName: '2026-08-08-document-native-resume',
  archivedAt: '2026-08-08',
  phase: 'archive',
  stateVersion: 16,
  stage: 'done',
  iteration: 3,
  attempt: 1,
  verificationResult: 'pass',
  localReason: 'archived',
  artifacts: [
    {
      key: 'brief',
      label: '需求简报',
      path: 'brief.md',
      exists: true,
      content: '# Resume\n',
      size: 9,
    },
    {
      key: 'spec-native-resume',
      label: 'native-resume Spec',
      path: 'specs/native-resume.md',
      exists: true,
      content: '# Native resume\n\nResume from portable state.\n',
      truncated: false,
      size: 48,
    },
    {
      key: 'verification',
      label: '验证报告',
      path: 'verification.md',
      exists: true,
      content: '# Conclusion\n\nPass.\n',
      size: 21,
    },
  ],
  specs: {
    total: 1,
    create: 0,
    modify: 1,
    remove: 0,
    capabilities: [{ capability: 'native-resume', operation: 'modify' }],
    capabilitiesTruncated: false,
  },
  acceptanceItems: [
    {
      id: 'A1',
      source: 'brief.md',
      text: '跨设备恢复后重新验证。',
      result: 'passed',
      reason: null,
    },
  ],
  verification: {
    verdict: 'pass',
    assurance: 'user-confirmed-degraded',
    summary: demoNativeText('归档前验证通过。'),
    risks: [],
    risksTruncated: false,
    completedAt: '2026-08-08T16:00:00.000Z',
  },
  checks: [
    {
      id: 'docs-check',
      name: demoNativeText('Documentation check'),
      status: 'passed',
      exitCode: 0,
      durationMs: 620,
    },
  ],
  history: [
    {
      goalCycle: 1,
      iteration: 3,
      attempt: 1,
      outcome: 'pass',
      unresolvedIds: [],
      summary: demoNativeText('验收通过并归档。'),
      completedAt: '2026-08-08T16:00:00.000Z',
    },
  ],
});

DEMO_SNAPSHOT.native = {
  schema: 'comet.dashboard.native.v2',
  generatedAt: '2026-08-09T14:32:00.000Z',
  totalChangeCount: 3,
  activeChangeCount: 2,
  archivedChangeCount: 1,
  visibleChangeCount: 3,
  omittedChangeCount: 0,
  changesTruncated: false,
  changes: [nativeV2Building, nativeV2Repairing, nativeV2Archived],
};

function cloneDemoValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function createClassicDemoChange(template, index, status) {
  const change = cloneDemoValue(template);
  const suffix = String(index).padStart(2, '0');
  const originalName = `demo-${status}-${suffix}`;
  const date = `2026-07-${String(10 + (index % 20)).padStart(2, '0')}`;
  const sourcePath = template.path;

  if (status === 'archived') {
    const archiveName = `${date}-${originalName}`;
    change.id = `archive/${archiveName}`;
    change.name = archiveName;
    change.displayName = originalName;
    change.status = 'archived';
    change.phase = 'archive';
    change.path = `openspec/changes/archive/${archiveName}`;
    change.updatedAt = date;
    change.archive = {
      ...change.archive,
      archiveName,
      originalName,
      archivedAt: date,
      archivePath: change.path,
    };
    change.tasks = {
      ...change.tasks,
      completed: change.tasks.total,
      incomplete: [],
    };
    change.verify = { result: 'pass', reportExists: true, summary: '全部断言通过' };
  } else {
    change.id = originalName;
    change.name = originalName;
    change.displayName = originalName;
    change.status = 'active';
    change.path = `openspec/changes/${originalName}`;
    change.updatedAt = `${index + 1} 小时前`;
  }

  if (change.artifacts?.grouped) {
    change.artifacts.grouped = change.artifacts.grouped.map((artifact) => ({
      ...artifact,
      path: artifact.path?.replace(sourcePath, change.path),
    }));
  }
  if (change.next?.command) {
    change.next.command = change.next.command.replace(template.name, change.name);
  }
  return change;
}

function createNativeDemoChange(template, index) {
  const change = cloneDemoValue(template);
  const name = `demo-native-${String(index).padStart(2, '0')}`;

  change.name = name;
  change.stateVersion += index;
  if (change.status === 'archived') {
    const archivedAt = `2026-08-${String(1 + (index % 8)).padStart(2, '0')}`;
    change.archivedAt = archivedAt;
    change.archiveName = `${archivedAt}-${name}`;
  }
  return change;
}

const classicActiveTemplates = DEMO_SNAPSHOT.changes.active.slice();
const classicArchivedTemplates = DEMO_SNAPSHOT.changes.archived.slice();
DEMO_SNAPSHOT.changes.active.push(
  ...Array.from({ length: 12 }, (_, index) =>
    createClassicDemoChange(
      classicActiveTemplates[index % classicActiveTemplates.length],
      index + 1,
      'active',
    ),
  ),
);
DEMO_SNAPSHOT.changes.archived.push(
  ...Array.from({ length: 6 }, (_, index) =>
    createClassicDemoChange(
      classicArchivedTemplates[index % classicArchivedTemplates.length],
      index + 1,
      'archived',
    ),
  ),
);

DEMO_SNAPSHOT.changes.active[0].risks.push(
  ...Array.from({ length: 9 }, (_, index) => ({
    level: index % 3 === 0 ? 'info' : 'warning',
    code: `demo-risk-${String(index + 1).padStart(2, '0')}`,
    message: `演示风险 ${index + 1}：需要补充工作区证据`,
    suggestion: '补齐对应产物后重新运行 comet verify',
  })),
);
DEMO_SNAPSHOT.git.recentCommits.push(
  ...Array.from(
    { length: 8 },
    (_, index) => `demo${String(index + 1).padStart(2, '0')} 补充 dashboard 演示数据`,
  ),
);

const nativeTemplates = DEMO_SNAPSHOT.native.changes.slice();
DEMO_SNAPSHOT.native.changes.push(
  ...Array.from({ length: 24 }, (_, index) =>
    createNativeDemoChange(nativeTemplates[index % nativeTemplates.length], index + 1),
  ),
);
const nativeSidebarDemoChange = DEMO_SNAPSHOT.native.changes[0];
nativeSidebarDemoChange.history.push(
  ...Array.from({ length: 9 }, (_, index) => ({
    goalCycle: 2,
    iteration: index + 10,
    attempt: 1,
    outcome: index % 2 === 0 ? 'recovery' : 'fail',
    unresolvedIds: ['A2'],
    summary: demoNativeText(`额外恢复记录 ${index + 1}`),
    completedAt: `2026-08-09T${String(index + 13).padStart(2, '0')}:00:00.000Z`,
  })),
);
DEMO_SNAPSHOT.summary.activeChanges = DEMO_SNAPSHOT.changes.active.length;
DEMO_SNAPSHOT.summary.archivedChanges = DEMO_SNAPSHOT.changes.archived.length;
DEMO_SNAPSHOT.summary.verifyFailed = DEMO_SNAPSHOT.changes.active.filter(
  (change) => change.verify?.result === 'fail',
).length;
DEMO_SNAPSHOT.summary.tasksIncomplete = DEMO_SNAPSHOT.changes.active.reduce(
  (total, change) => total + (change.tasks?.incomplete?.length ?? 0),
  0,
);
DEMO_SNAPSHOT.native.totalChangeCount = DEMO_SNAPSHOT.native.changes.length;
DEMO_SNAPSHOT.native.visibleChangeCount = DEMO_SNAPSHOT.native.changes.length;
DEMO_SNAPSHOT.native.activeChangeCount = DEMO_SNAPSHOT.native.changes.filter(
  (change) => change.status === 'active',
).length;
DEMO_SNAPSHOT.native.archivedChangeCount = DEMO_SNAPSHOT.native.changes.filter(
  (change) => change.status === 'archived',
).length;

// Enrich all changes with comet intermediate artifacts
DEMO_SNAPSHOT.changes.active.forEach(addCometArtifacts);
DEMO_SNAPSHOT.changes.archived.forEach(addCometArtifacts);

// Demo-only data for sidebar visualizations that do not have a dashboard
// collector yet. Shapes are intentionally close to BundleAuthoringState and
// RepositoryEvalResult so real collection can replace this without redesigning UI.
export const DEMO_SKILL_VISUALS = {
  compose: {
    summary: {
      drafts: 3,
      evalPassed: 2,
      reviewApproved: 1,
      targetPlatforms: 3,
    },
    bundles: [
      {
        name: 'customize-comet-release-checks',
        status: 'review-approved',
        currentStep: 'publish',
        mode: 'optimize',
        goal: '定制 /comet：在验证前插入发布准备、README 同步和 Changelog 检查。',
        engineMode: 'deterministic',
        runnerMode: 'change',
        reusedSkills: [
          { skill: 'comet', status: 'available', sourceCount: 1 },
          { skill: 'verification-before-completion', status: 'available', sourceCount: 2 },
          { skill: 'finishing-a-development-branch', status: 'available', sourceCount: 2 },
        ],
        generatedControlPlane: [
          'SKILL.md',
          'reference/workflow-protocol.json',
          'reference/composition-report.md',
          'reference/skill-review.md',
          'comet/eval.yaml',
          'scripts/comet-check.mjs',
        ],
        requiredConfirmations: [
          { label: 'Skill Creator proposal confirmed', required: true, confirmed: true },
          { label: 'Eval result attached', required: true, confirmed: true },
          { label: 'Review approved', required: true, confirmed: true },
          { label: 'Executable disclosure reviewed', required: false, confirmed: false },
        ],
        callChain: [
          'comet-open',
          'comet-design',
          'release-readiness-check',
          'comet-build',
          'verification-before-completion',
          'comet-archive',
        ],
        distribution: {
          readiness: 'publishable',
          plannedFiles: 18,
          executables: 3,
          platforms: [
            { platform: 'Codex', status: 'previewed' },
            { platform: 'Claude Code', status: 'previewed' },
            { platform: 'Gemini', status: 'capability warning' },
          ],
        },
      },
      {
        name: 'create-skill-maker-review-flow',
        status: 'eval-passed',
        currentStep: 'review',
        mode: 'create',
        goal: '创建 Skill：把需求澄清、作者分工、审阅报告和安装预览串成可恢复流程。',
        engineMode: 'adaptive',
        runnerMode: 'standalone',
        reusedSkills: [
          { skill: 'brainstorming', status: 'available', sourceCount: 2 },
          { skill: 'writing-skills', status: 'available', sourceCount: 1 },
          { skill: 'skill-creator', status: 'available', sourceCount: 1 },
        ],
        generatedControlPlane: [
          'reference/authoring-lanes.json',
          'reference/resolved-skills.json',
          'reference/composition-report.md',
          'reference/decision-points.md',
          'scripts/comet-plan.mjs',
        ],
        requiredConfirmations: [
          { label: 'Resolved Skill choices', required: true, confirmed: true },
          { label: 'Authoring lanes complete', required: true, confirmed: true },
          { label: 'Run quick eval', required: true, confirmed: true },
        ],
        callChain: [
          'brainstorming',
          'writing-plans',
          'writing-skills',
          'skill-review',
          'install-preview',
        ],
        distribution: {
          readiness: 'needs review approval',
          plannedFiles: 16,
          executables: 2,
          platforms: [
            { platform: 'Codex', status: 'planned' },
            { platform: 'Claude Code', status: 'planned' },
          ],
        },
      },
      {
        name: 'upgrade-review-comments-skill',
        status: 'draft',
        currentStep: 'needs-eval',
        mode: 'optimize',
        goal: '升级现有 Skill：为 PR 评审意见处理加入“证据优先”和本地验证检查。',
        engineMode: 'deterministic',
        runnerMode: 'change',
        reusedSkills: [
          { skill: 'receiving-code-review', status: 'available', sourceCount: 2 },
          { skill: 'systematic-debugging', status: 'available', sourceCount: 2 },
          { skill: 'github', status: 'ambiguous', sourceCount: 3 },
        ],
        generatedControlPlane: [
          'bundle.yaml',
          'reference/resolved-skills.json',
          'comet/checks.yaml',
        ],
        requiredConfirmations: [
          { label: 'Resolve ambiguous GitHub Skill', required: true, confirmed: false },
          { label: 'Generate control plane', required: true, confirmed: false },
          { label: 'Run quick eval', required: true, confirmed: false },
        ],
        callChain: [
          'receiving-code-review',
          'systematic-debugging',
          'verification-before-completion',
        ],
        distribution: {
          readiness: 'blocked by candidate ambiguity',
          plannedFiles: 10,
          executables: 1,
          platforms: [{ platform: 'Codex', status: 'waiting' }],
        },
      },
    ],
  },
  eval: {
    summary: {
      totalResults: 3,
      passedResults: 2,
      entryPassRate: 0.91,
      tokenCount: 18640,
      durationMs: 258000,
    },
    results: [
      {
        name: 'customize-comet-release-checks',
        provider: 'comet-eval',
        level: 'full',
        draftHash: 'a'.repeat(64),
        evalManifestHash: 'b'.repeat(64),
        tasks: ['route-conformance', 'control-plane', 'publish-readiness'],
        treatments: ['customize-comet-release-checks'],
        passAtK: { 1: 1 },
        weightedScore: { overall: 0.93 },
        instabilityGap: { overall: 0.02 },
        failures: [],
        reports: ['eval-report.html'],
        passed: true,
        summary:
          'Generated package passed route conformance, control-plane validation, and publish readiness.',
        entries: [
          {
            id: 'route-conformance',
            passed: true,
            passRate: 0.96,
            evidence: ['workflow-protocol.json', 'route-conformance.json'],
          },
          {
            id: 'control-plane',
            passed: true,
            passRate: 0.92,
            evidence: ['comet/eval.yaml', 'scripts/comet-check.mjs'],
          },
          {
            id: 'publish-readiness',
            passed: true,
            passRate: 0.88,
            evidence: ['reference/skill-review.md', 'review-summary.json'],
          },
        ],
        bundle: {
          compilePassed: true,
          safetyPassed: true,
          evidence: ['compile.json', 'hook-disclosure.json'],
        },
        benchmark: {
          cases: 18,
          baselinePassRate: 0.61,
          withSkillPassRate: 0.89,
          variance: 0.04,
          tokenCount: 9400,
          durationMs: 142000,
        },
      },
      {
        name: 'create-skill-maker-review-flow',
        provider: 'comet-eval',
        level: 'quick',
        draftHash: 'c'.repeat(64),
        evalManifestHash: 'd'.repeat(64),
        tasks: ['authoring-lanes', 'entry-smoke', 'install-preview'],
        treatments: ['create-skill-maker-review-flow'],
        passAtK: { 1: 1 },
        weightedScore: { overall: 0.9 },
        instabilityGap: { overall: 0.03 },
        failures: [],
        reports: ['quick-eval-report.html'],
        passed: true,
        summary:
          'Quick eval passed authoring-lane coverage, entry smoke, and install-preview checks.',
        entries: [
          {
            id: 'authoring-lanes',
            passed: true,
            passRate: 0.9,
            evidence: ['authoring-lanes.json', 'skill-review.md'],
          },
          {
            id: 'install-preview',
            passed: true,
            passRate: 0.86,
            evidence: ['install-preview.json'],
          },
        ],
        bundle: {
          compilePassed: true,
          safetyPassed: true,
          evidence: ['compile.json', 'safety.json'],
        },
        benchmark: {
          cases: 10,
          baselinePassRate: 0.54,
          withSkillPassRate: 0.82,
          tokenCount: 5140,
          durationMs: 72000,
        },
      },
      {
        name: 'upgrade-review-comments-skill',
        provider: 'comet-eval',
        level: 'quick',
        draftHash: 'e'.repeat(64),
        evalManifestHash: 'f'.repeat(64),
        tasks: ['review-comment-intake', 'candidate-resolution', 'hook-disclosure'],
        treatments: ['upgrade-review-comments-skill'],
        passAtK: { 1: 0 },
        weightedScore: { overall: 0.58 },
        instabilityGap: { overall: 0.12 },
        failures: [
          {
            task: 'candidate-resolution',
            treatment: 'upgrade-review-comments-skill',
            reason: 'GitHub Skill candidate is still ambiguous.',
          },
          {
            task: 'hook-disclosure',
            treatment: 'upgrade-review-comments-skill',
            reason: 'Hook executable disclosure is missing.',
          },
        ],
        reports: ['quick-eval-report.html'],
        passed: false,
        summary:
          'Entry smoke found one unresolved GitHub Skill candidate and a missing hook disclosure.',
        entries: [
          {
            id: 'review-comment-intake',
            passed: true,
            passRate: 0.84,
            evidence: ['review-thread-smoke.json'],
          },
          {
            id: 'github-routing',
            passed: false,
            passRate: 0.58,
            evidence: ['ambiguous-target.json'],
          },
        ],
        bundle: {
          compilePassed: true,
          safetyPassed: false,
          evidence: ['compile.json', 'hook-review-needed.json'],
        },
        benchmark: {
          cases: 8,
          baselinePassRate: 0.5,
          withSkillPassRate: 0.63,
          tokenCount: 4100,
          durationMs: 44000,
        },
      },
    ],
  },
};
