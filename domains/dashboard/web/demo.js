// Demo snapshot for `?demo` mode — mirrors the DashboardSnapshot contract
// (domains/dashboard/types.ts) exactly. Used when a reviewer wants to see the
// dashboard populated without a real docs/openspec/changes layout. Field names are
// stable; see types.ts before renaming anything.

const CLASSIC_DEMO_SCENARIOS = {
  'add-auth-rate-limiting': {
    title: '为认证接口增加分布式限流',
    background:
      '登录和令牌刷新接口在活动流量峰值期间出现突发请求，单实例内存计数无法在多副本之间共享，导致上游身份服务被重复请求拖慢。',
    outcome:
      '按租户、客户端和接口维度执行滑动窗口限流；命中上限时返回一致的 429 响应和剩余配额信息，同时保留开发环境的内存实现。',
    files: [
      'domains/auth/rate-limit-policy.ts',
      'platform/redis/sliding-window.ts',
      'test/domains/auth/rate-limit-policy.test.ts',
    ],
    decisions: [
      '使用 Redis Lua 脚本原子更新窗口，避免读写竞态。',
      '健康检查与内部回调不计入用户配额。',
      'Redis 不可用时登录接口 fail closed，令牌校验接口继续读取已有会话。',
    ],
    checks: [
      'npx vitest run test/domains/auth/rate-limit-policy.test.ts',
      'pnpm build',
      'node scripts/benchmark/rate-limit.mjs --qps 5000',
    ],
  },
  'dashboard-redesign': {
    title: '统一 Classic、Native 与插件中心工作台',
    background:
      '现有 Dashboard 的工作流面板、个人记忆和项目知识采用不同的间距与详情结构，用户切换区域时需要重新理解页面层级，移动端还会把内容整体缩成缩略图。',
    outcome:
      '复用同一套侧栏、工具栏、列表和检查器层级；桌面端保持高信息密度，窄屏通过固定画布和受控滚动保持正文可读。',
    files: [
      'domains/dashboard/web/src/main.jsx',
      'domains/dashboard/web/src/native-workflow-panel.jsx',
      'domains/dashboard/web/src/styles.css',
    ],
    decisions: [
      '列表选择与右侧检查器共享同一个 selected change 状态。',
      '文件预览限制在 Dashboard 容器内，并提供明确的关闭和全屏切换。',
      '官网工作台复用产品 UI，但使用独立只读入口和静态数据。',
    ],
    checks: [
      'npx vitest run test/domains/dashboard/web-source.test.ts',
      'pnpm build:dashboard',
      'pnpm test:dashboard-e2e -- --workers=1',
    ],
  },
  'fix-webhook-retries': {
    title: '修复 Webhook 超时后的重复投递',
    background:
      '接收方已经处理请求但响应超时时，发送端会立即重试，同一事件可能在一分钟内被重复投递多次，并且旧实现没有保存每次尝试的可审计结果。',
    outcome:
      '为每个事件生成稳定幂等键，采用带抖动的指数退避，并在达到上限后进入可人工重放的死信队列。',
    files: [
      'domains/webhook/retry-policy.ts',
      'domains/webhook/delivery-store.ts',
      'test/domains/webhook/retry-policy.test.ts',
    ],
    decisions: [
      '网络超时与 5xx 可重试，4xx 除 408/429 外直接终止。',
      '重试调度保存 nextAttemptAt，进程重启后可以恢复。',
      '幂等键由事件 ID、目标端点和 payload hash 共同组成。',
    ],
    checks: [
      'npx vitest run test/domains/webhook/retry-policy.test.ts',
      'node scripts/smoke/webhook-replay.mjs',
      'pnpm lint',
    ],
  },
  'migrate-config-to-yaml': {
    title: '将分散配置迁移到 .comet/config.yaml',
    background:
      '旧项目把 workflow、语言和产物目录配置分散在多个 JSON 文件中，升级时难以判断默认值、用户覆盖项和已经废弃的字段。',
    outcome:
      '提供可 dry-run 的幂等迁移命令，保留未知字段与用户注释，并在写入前输出逐字段差异和回滚备份。',
    files: [
      'domains/workflow-contract/project-config.ts',
      'app/commands/doctor.ts',
      'test/domains/workflow-contract/project-config.test.ts',
    ],
    decisions: [
      '解析、默认值合并和 schema 校验分成独立步骤。',
      '存在冲突时停止写入，不猜测 Classic 与 Native 的默认 workflow。',
      '迁移成功后保留一次带时间戳的原配置备份。',
    ],
    checks: [
      'npx vitest run test/domains/workflow-contract/project-config.test.ts',
      'node bin/comet.js doctor --repair --dry-run',
      'pnpm build',
    ],
  },
  'add-dark-mode': {
    title: '为 Dashboard 增加可持久化深色主题',
    background:
      '长时间查看任务与验证日志时，固定浅色界面在低光环境下过亮，而且系统主题变化后 Dashboard 不会同步。',
    outcome:
      '支持浅色、深色和跟随系统三种模式；主题在首次绘制前恢复，避免页面闪烁，并覆盖图表、弹层和 Markdown 预览。',
    files: ['domains/dashboard/web/src/main.jsx', 'domains/dashboard/web/src/styles.css'],
    decisions: [
      '主题 token 由 Ant Design ConfigProvider 统一提供。',
      '嵌入 Website 时强制浅色，避免与官网品牌背景冲突。',
      '用户选择存入 localStorage，系统模式仅在未显式选择时生效。',
    ],
    checks: ['pnpm build:dashboard', 'pnpm test:dashboard-e2e -- --grep "theme"'],
  },
  'refactor-collector': {
    title: '拆分 Dashboard 采集器并限制详情读取',
    background:
      '旧采集器在列表请求中读取每个 change 的所有产物，大型仓库打开 Dashboard 时会产生大量无关磁盘读取。',
    outcome:
      '概览、分页列表和单 change 详情使用独立采集路径；列表只返回轻量投影，用户选中后才加载产物正文。',
    files: ['domains/dashboard/collector.ts', 'domains/dashboard/native-collector.ts'],
    decisions: [
      '分页游标绑定 snapshot，状态变化时返回明确的 stale cursor。',
      '所有产物路径在读取前验证仍位于项目目录内。',
      '预览正文使用固定字节预算并报告 truncated 状态。',
    ],
    checks: ['npx vitest run test/domains/dashboard/collector.test.ts', 'pnpm lint'],
  },
  'init-openspec': {
    title: '初始化 Classic OpenSpec 工作区',
    background:
      '新项目启用 Classic 后缺少稳定目录、模板和状态文件，首次运行经常需要人工补齐 proposal、design 和 tasks 结构。',
    outcome:
      '初始化命令一次创建 docs 布局、OpenSpec 模板与 Comet 配置，并且重复运行不会覆盖已有用户文档。',
    files: ['app/commands/init.ts', 'domains/comet-classic/classic-state-command.ts'],
    decisions: [
      '新项目默认使用 docs/openspec 与 docs/superpowers 布局。',
      '已有项目缺少 layout 字段时保持 legacy 行为。',
      '初始化只创建缺失文件，不修改已有 change。',
    ],
    checks: ['npx vitest run test/app/init.test.ts', 'pnpm build:classic-runtime'],
  },
};

function classicDemoScenario(change) {
  const key = change.demoScenario ?? change.displayName;
  return (
    CLASSIC_DEMO_SCENARIOS[key] ?? {
      title: `交付 ${change.displayName}`,
      background: '该 change 完整记录了 Classic 工作流从提案到验证的产物链路。',
      outcome: '在保持现有行为兼容的前提下完成需求、验证关键路径并记录可追溯证据。',
      files: [
        'domains/dashboard/collector.ts',
        'domains/dashboard/web/src/main.jsx',
        'test/domains/dashboard/web-source.test.ts',
      ],
      decisions: ['保持变更范围最小。', '优先运行覆盖当前改动的相关测试。'],
      checks: ['npx vitest run test/domains/dashboard/web-source.test.ts', 'pnpm lint'],
    }
  );
}

function classicArtifactContent(change, artifact) {
  const scenario = classicDemoScenario(change);
  const taskSections = change.tasks?.sections ?? [];
  const completedLines = taskSections.map(
    (section) =>
      `- [${section.status === 'done' ? 'x' : ' '}] ${section.title}（${section.completed}/${section.total}）`,
  );
  const pendingLines = (change.tasks?.incomplete ?? []).map((task) => `- [ ] ${task}`);
  const files = scenario.files.map((file) => `- \`${file}\``).join('\n');
  const decisions = scenario.decisions.map((decision) => `- ${decision}`).join('\n');
  const checks = scenario.checks.map((command) => `- \`${command}\``).join('\n');
  const taskProgress = `${change.tasks?.completed ?? 0}/${change.tasks?.total ?? 0}`;
  const verifyLabel =
    change.verify?.result === 'pass'
      ? '通过'
      : change.verify?.result === 'fail'
        ? '失败'
        : '待验证';

  if (artifact.key === 'proposal') {
    return `# Proposal: ${scenario.title}

## 背景

${scenario.background}

## 目标

${scenario.outcome}

## 变更范围

${files}

## 非目标

- 不在本 change 中重写无关模块或调整公开 API 命名。
- 不用静态预览代替真实 Runtime、数据库或网络集成验证。
- 不自动扩大到未在 proposal 中确认的平台适配。

## 成功标准

- 用户可见行为与 proposal 描述一致，异常路径有明确反馈。
- 相关单元测试、构建和定向回归均留下可复查结果。
- 变更完成后没有未归属文件，归档材料可解释关键取舍。
`;
  }

  if (artifact.key === 'design') {
    return `# Design: ${scenario.title}

## 设计目标

${scenario.outcome}

## 数据流

1. 入口层解析用户操作，只负责参数与页面状态编排。
2. Domain 层执行规则判断并返回可序列化结果，不直接处理平台差异。
3. Platform 适配层完成文件、进程或外部服务访问，并把失败转换为明确诊断。
4. Dashboard 读取稳定投影，文件正文只在用户选中时按需加载。

## 关键决策

${decisions}

## 失败与恢复

- 输入不完整时保持原状态并返回可操作错误，不写入半成品文件。
- 构建或验证失败时停留在当前阶段，保存命令、退出码和失败摘要。
- 恢复执行前重新读取当前配置与产物，避免沿用过期内存状态。

## 验证策略

${checks}
`;
  }

  if (artifact.key === 'tasks') {
    return `# Tasks: ${scenario.title}

## 当前进度

已完成 ${taskProgress}，当前阶段为 **${change.phase}**。

${[...completedLines, ...pendingLines].join('\n')}

## 实施检查

- [x] 明确 change 边界、用户可见结果与非目标。
- [x] 将实现拆到现有 app/domain/platform 责任边界内。
- [ ] 对失败路径、恢复路径和空数据状态补充回归覆盖。
- [ ] 运行最小相关测试并记录实际命令输出。
- [ ] 核对最终 diff，只保留本 change 所属文件。

## 完成条件

- 所有任务均有对应实现或明确的取消理由。
- Verify 阶段能从 proposal、design 与测试证据逐项追溯。
- 用户文档只描述最终行为，不记录分支内反复修改过程。

## 审阅记录

- 实现前确认当前分支、工作区状态和配置基线。
- 实现后逐项核对任务勾选与实际 diff，不提前标记完成。
- 进入 Verify 前确认生成资产已经由源码重新构建。
`;
  }

  if (artifact.key === 'designDoc') {
    return `# Technical Design: ${scenario.title}

## 现状与约束

${scenario.background}

本实现沿用现有模块边界，不引入第二套状态源。所有展示层数据都来自稳定投影；用户可读产物与机器 Runtime 状态保持分离。

## 组件职责

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| 命令入口 | 参数解析、交互和流程编排 | 领域规则 |
| Domain | 状态转换、校验和结果模型 | 文件系统差异 |
| Platform | 文件、进程和外部依赖适配 | 产品决策 |
| Dashboard | 读取投影、按需预览产物 | 修改 workflow 状态 |

## 关键文件

${files}

## 技术决策

${decisions}

## 风险控制

- 所有路径在读取或写入前解析并确认仍位于项目边界内。
- 对大文件使用固定预览预算，完整原文仍保留在项目中。
- 运行失败不自动跳过阶段检查，恢复时重新验证当前证据。
`;
  }

  if (artifact.key === 'plan') {
    return `# Implementation Plan: ${scenario.title}

## Step 1：建立契约

更新类型、schema 与最小失败用例，确认现有行为在改动前能够稳定复现。

## Step 2：实现核心路径

按以下文件边界完成实现：

${files}

每个步骤完成后只运行覆盖该步骤的测试，避免在尚未收敛时反复执行全量套件。

## Step 3：补齐失败与恢复

- 覆盖无效输入、外部依赖不可用和状态过期。
- 确认失败不会留下半写入文件或错误阶段。
- 验证重新进入任务时能从磁盘产物恢复。

## Step 4：最终验证

${checks}

## 交付检查

- 比较最终 diff 与 proposal 范围。
- 记录未运行检查和仍存在的外部风险。
- 仅在用户可见发布行为变化时更新 Changelog。
`;
  }

  if (artifact.key === 'verifyReport') {
    const failed = change.verify?.result === 'fail';
    return `# Verification Report: ${scenario.title}

## 结论

**${verifyLabel}** — ${change.verify?.summary ?? `任务完成 ${taskProgress}，等待最终验证。`}

## 验收证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 需求范围 | ${failed ? '通过' : verifyLabel} | proposal 与最终 diff 范围一致 |
| 相关测试 | ${failed ? '失败' : verifyLabel} | 定向 Vitest 与浏览器回归日志 |
| 构建检查 | ${failed ? '通过' : verifyLabel} | 产物可由当前源码重新生成 |
| 工作区检查 | 通过 | 未修改无关用户文件 |

## ${failed ? '未通过项' : '已验证行为'}

${failed ? '- 重试上限场景仍产生一次重复投递。\n- 幂等键在 payload 顺序变化时不稳定。\n- 修复后必须重新运行完整 Verify。' : '- 主路径与异常路径均返回预期结果。\n- 产物来源、验证命令和最终状态可追溯。\n- 归档前确认没有遗留的未完成任务。'}

## 执行命令

${checks}
`;
  }

  if (artifact.key === 'cometYaml') {
    return `schema: comet.classic.v1
change: ${change.name}
workflow: ${change.workflow ?? 'feature'}
status: ${change.status}
phase: ${change.phase}
language: zh-CN
artifact_layout: docs
artifacts:
  proposal: ${change.artifacts?.proposal ?? false}
  design: ${change.artifacts?.design ?? false}
  tasks: ${change.artifacts?.tasks ?? false}
  plan: ${change.artifacts?.plan ?? false}
  verification: ${change.artifacts?.verifyReport ?? false}
tasks:
  completed: ${change.tasks?.completed ?? 0}
  total: ${change.tasks?.total ?? 0}
verification:
  result: ${change.verify?.result ?? 'pending'}
  report_exists: ${change.verify?.reportExists ?? false}
handoff:
  disposition: ${change.phase === 'archive' ? 'complete' : 'continue'}
  next_command: ${change.next?.command ?? 'none'}
workspace:
  relative_path: ${change.path}
  dirty_files_allowed: false
updated_at: 2026-08-29T12:30:00.000Z
`;
  }

  return `# ${artifact.label}: ${scenario.title}

## 说明

${scenario.outcome}

## 当前状态

- Change：${change.displayName}
- 阶段：${change.phase}
- 任务：${taskProgress}
- Verify：${verifyLabel}

## 相关文件

${files}

## 验证

${checks}
`;
}

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
    for (const artifact of change.artifacts.grouped) {
      if (!artifact.exists) continue;
      const content = classicArtifactContent(change, artifact);
      artifact.content = content;
      artifact.size = content.length;
      artifact.truncated = false;
      artifact.updatedAt = '2026-08-29T12:30:00.000Z';
    }
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
      '9a02d7d 初始化 docs/openspec/changes 目录',
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
        path: 'docs/openspec/changes/add-auth-rate-limiting',
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
              path: 'docs/openspec/changes/add-auth-rate-limiting/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/add-auth-rate-limiting/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/add-auth-rate-limiting/tasks.md',
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
        path: 'docs/openspec/changes/dashboard-redesign',
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
              path: 'docs/openspec/changes/dashboard-redesign/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/dashboard-redesign/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/dashboard-redesign/tasks.md',
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
        path: 'docs/openspec/changes/fix-webhook-retries',
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
              path: 'docs/openspec/changes/fix-webhook-retries/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/fix-webhook-retries/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/fix-webhook-retries/tasks.md',
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
        path: 'docs/openspec/changes/migrate-config-to-yaml',
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
              path: 'docs/openspec/changes/migrate-config-to-yaml/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/migrate-config-to-yaml/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/migrate-config-to-yaml/tasks.md',
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
        path: 'docs/openspec/changes/archive/2025-11-02-add-dark-mode',
        workflow: 'feature',
        phase: 'archive',
        updatedAt: '2025-11-02',
        archive: {
          archiveName: '2025-11-02-add-dark-mode',
          originalName: 'add-dark-mode',
          archivedAt: '2025-11-02',
          archivePath: 'docs/openspec/changes/archive/2025-11-02-add-dark-mode',
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
              path: 'docs/openspec/changes/archive/2025-11-02-add-dark-mode/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-11-02-add-dark-mode/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-11-02-add-dark-mode/tasks.md',
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
        path: 'docs/openspec/changes/archive/2025-10-18-refactor-collector',
        workflow: 'refactor',
        phase: 'archive',
        updatedAt: '2025-10-18',
        archive: {
          archiveName: '2025-10-18-refactor-collector',
          originalName: 'refactor-collector',
          archivedAt: '2025-10-18',
          archivePath: 'docs/openspec/changes/archive/2025-10-18-refactor-collector',
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
              path: 'docs/openspec/changes/archive/2025-10-18-refactor-collector/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-10-18-refactor-collector/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-10-18-refactor-collector/tasks.md',
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
        path: 'docs/openspec/changes/archive/2025-09-30-init-openspec',
        workflow: 'chore',
        phase: 'archive',
        updatedAt: '2025-09-30',
        archive: {
          archiveName: '2025-09-30-init-openspec',
          originalName: 'init-openspec',
          archivedAt: '2025-09-30',
          archivePath: 'docs/openspec/changes/archive/2025-09-30-init-openspec',
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
              path: 'docs/openspec/changes/archive/2025-09-30-init-openspec/proposal.md',
            },
            {
              key: 'design',
              label: '设计文档',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-09-30-init-openspec/design.md',
            },
            {
              key: 'tasks',
              label: '任务清单',
              source: 'openspec',
              exists: true,
              path: 'docs/openspec/changes/archive/2025-09-30-init-openspec/tasks.md',
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

const NATIVE_DEMO_SCENARIOS = {
  'ship-native-dashboard': {
    title: '交付可恢复的 Native Dashboard',
    background:
      'Native change 的 Loop、验收项、本地执行和父子任务已经存在于 Runtime 投影中，但旧页面只展示阶段标签，用户无法判断当前由谁执行、失败后从哪里恢复。',
    outcome:
      'Dashboard 同时展示 portable state、本地执行、验收矩阵和父子 change；刷新页面或切换设备后仍能从项目产物恢复当前进度。',
    scope: [
      'Native 列表展示 stage、iteration、actor 与验证结论。',
      '详情页展示验收项、checks、blockers、history 和产物预览。',
      '父 change 可查看子 change 的依赖、工作区和完成状态。',
    ],
    risks: ['大历史记录需要截断提示。', '本地 overlay 版本不匹配时必须以 portable state 为准。'],
  },
  'align-dashboard-copy': {
    title: '统一 Native Dashboard 状态文案',
    background:
      '同一状态在列表、详情和恢复提示中使用了不同术语，失败、阻塞与等待外部条件之间的差异不清楚，用户难以判断下一步应该由 Builder 还是外部人员处理。',
    outcome:
      '所有 Native 状态由同一映射生成，并把失败项、阻塞责任人、恢复动作和降级 assurance 清晰展示。',
    scope: [
      '统一 build、verify、repairing、blocked 与 done 的中文文案。',
      '失败项返回 Builder，外部阻塞保持等待且不消耗重试次数。',
      '版本不匹配的本地执行状态显示明确恢复说明。',
    ],
    risks: ['旧 snapshot 可能缺少 assurance。', '过度简化文案会隐藏责任人与恢复动作。'],
  },
  'document-native-resume': {
    title: '记录 Native 跨设备恢复流程',
    background:
      '用户在另一台设备或新会话继续 change 时，需要知道哪些状态来自 portable artifacts，哪些本地进程信息不可迁移，以及何时必须重新运行验证。',
    outcome:
      '用 brief、spec 和 verification 给出可操作的恢复契约，并在归档前证明 portable state 能独立重建工作流。',
    scope: [
      '从 comet-state.yaml 恢复 phase、Loop 与验收状态。',
      '忽略过期本地 PID、临时日志和设备专属路径。',
      '恢复后重新运行与当前源码和配置绑定的验证。',
    ],
    risks: ['旧设备未提交的代码不能由 portable state 自动恢复。', '配置漂移需要先修复再继续。'],
  },
  'prepare-parent-workspace': {
    title: '准备 Native 父 change 的独立工作区',
    background:
      '父子 change 并行执行前需要为子任务创建可定位的独立工作区，并确保它们都从同一基线开始。',
    outcome: '创建并验证子工作区，记录分支、基线与父 change 归属，完成后可安全归档。',
    scope: ['解析父 change 基线。', '创建子工作区与分支。', '写入可恢复的 workspace identity。'],
    risks: ['工作区已存在但指向错误分支。', '基线变化导致子 change 需要重新同步。'],
  },
  'render-parent-child-tree': {
    title: '展示 Native 父子 change 层级',
    background:
      '父 change 的子任务分散在独立工作区中，用户只能看到总状态，无法快速定位哪个子任务正在执行或被依赖阻塞。',
    outcome: '在同一 Explorer 中展示依赖顺序、工作区、验收覆盖范围和可选中的子 change 详情。',
    scope: ['渲染父子树。', '切换子 change 详情。', '显示依赖与验收覆盖。'],
    risks: ['循环依赖必须以诊断代替递归渲染。', '归档子 change 仍需保留可读定位。'],
  },
  'verify-parent-child-flow': {
    title: '验证 Native 子 change 依赖顺序',
    background:
      '验证任务不能在其实现依赖完成前启动，否则会把缺失实现误判为产品失败，并污染父 change 的验证记录。',
    outcome: '只有依赖全部通过并完成交付后才允许启动验证，等待状态在 Dashboard 中保持可见。',
    scope: ['读取 dependsOn。', '阻止提前验证。', '依赖完成后恢复执行。'],
    risks: ['依赖状态过期时必须重新读取 portable state。', '外部阻塞不能自动标记失败。'],
  },
};

function nativeDemoScenario(change) {
  const key = change.demoScenario ?? change.name;
  return (
    NATIVE_DEMO_SCENARIOS[key] ?? {
      title: `交付 Native change ${change.name}`,
      background: '该 change 记录了 Native workflow 的可恢复状态、验收证据和产物预览。',
      outcome: '完成声明范围内的实现，并用 portable artifacts 记录可跨会话恢复的验证结果。',
      scope: ['保持 brief 与 spec 一致。', '记录 Builder handoff。', '由 Verifier 独立复核。'],
      risks: ['本地执行状态可能过期。', '未声明文件会阻塞状态转换。'],
    }
  );
}

function nativeTextValue(value, fallback = '尚无补充说明。') {
  if (typeof value === 'string') return value;
  if (typeof value?.text === 'string') return value.text;
  return fallback;
}

function nativeArtifactContent(change, artifact) {
  const scenario = nativeDemoScenario(change);
  const acceptanceItems = change.acceptanceItems ?? [];
  const acceptanceLines = acceptanceItems.length
    ? acceptanceItems
        .map(
          (item) =>
            `- [${item.result === 'passed' ? 'x' : ' '}] **${item.id}** ${item.text}（${item.result}${item.reason ? `：${nativeTextValue(item.reason)}` : ''}）`,
        )
        .join('\n')
    : '- [ ] A1 完成 brief 中声明的用户可见结果。\n- [ ] A2 由 Verifier 独立确认验证证据。';
  const scopeLines = scenario.scope.map((item) => `- ${item}`).join('\n');
  const riskLines = scenario.risks.map((item) => `- ${item}`).join('\n');
  const checkLines = (change.checks ?? []).length
    ? change.checks
        .map(
          (check) =>
            `- ${nativeTextValue(check.name, check.id)}：${check.status}${check.exitCode == null ? '' : `（exit ${check.exitCode}）`}`,
        )
        .join('\n')
    : '- Dashboard focused tests：待执行\n- Portable artifact validation：待执行';

  if (artifact.key === 'comet-state.yaml') {
    return `schema: comet.native.v4
state_version: ${change.stateVersion}
change: ${change.name}
workflow: native
status: ${change.lifecycleStatus}
phase: ${change.phase}
loop:
  stage: ${change.loop?.stage ?? 'building'}
  goal_cycle: ${change.loop?.goalCycle ?? 1}
  iteration: ${change.loop?.iteration ?? 1}
  attempt: ${change.loop?.attempt ?? 1}
  actor: ${change.loop?.actor ?? 'none'}
  next_action: ${change.loop?.nextAction ?? 'none'}
acceptance:
  total: ${change.acceptance?.total ?? 0}
  passed: ${change.acceptance?.passed ?? 0}
  failed: ${change.acceptance?.failed ?? 0}
  blocked: ${change.acceptance?.blocked ?? 0}
  pending: ${change.acceptance?.pending ?? 0}
verification:
  result: ${change.verificationResult ?? 'pending'}
  assurance: ${change.verification?.assurance ?? 'pending'}
local_execution:
  status: ${change.localExecution?.status ?? 'absent'}
  reason: ${change.localExecution?.reason ?? 'missing'}
  recoverable_from_stage: ${change.localExecution?.recoverableFromStage ?? 'none'}
portable_artifacts:
  brief: brief.md
  specs_root: specs
  verification: ${change.verificationResult === 'pending' ? 'pending' : 'verification.md'}
integrity:
  contract_hash: sha256:4f1f6f819d8b17ec4a79
  scope_hash: sha256:a9d4ef00c12a8e764b35
updated_at: 2026-08-29T12:32:00.000Z
`;
  }

  if (artifact.key === 'brief') {
    return `# Brief: ${scenario.title}

## Outcome

${scenario.outcome}

## 背景

${scenario.background}

## 范围

${scopeLines}

## 非目标

- 不在本 change 中修改无关 workflow 或迁移其他项目数据。
- 不把本地 PID、临时日志和设备路径当作 portable state。
- 不在没有验证证据时自动进入 Archive。

## 验收标准

${acceptanceLines}

## 约束

- 所有实现文件必须属于声明的 implementation scope。
- Builder 只提交实现与检查结果，最终结论由 Verifier 独立给出。
- 失败后回到 Build 时保留验收 ID，修复证据必须能对应原失败项。

## 已知风险

${riskLines}
`;
  }

  if (artifact.key.startsWith('spec-')) {
    const capability = artifact.key.slice('spec-'.length);
    return `# ${scenario.title} Specification

## Capability: ${capability}

系统必须在不依赖当前会话内存的情况下，从 Native portable artifacts 重建该能力的当前状态与下一步动作。

### Requirement: 状态可见且可恢复

Dashboard 必须展示 change 的 phase、Loop stage、iteration、actor、验收统计和验证结论；刷新后这些信息保持一致。

### Scenario: 用户打开进行中的 change

- **Given** 项目中存在有效的 \`comet-state.yaml\`、\`brief.md\` 与 capability spec
- **When** 用户在 Dashboard 选择该 Native change
- **Then** 页面显示当前 Builder/Verifier、待处理验收项和下一步动作
- **And** 产物列表可预览完整正文，不只显示文件名

### Scenario: 本地执行状态已经过期

- **Given** portable state 的版本高于本地 overlay
- **When** Dashboard 载入详情
- **Then** portable state 作为事实来源
- **And** 页面提示可以恢复的 stage，不把旧进程标记为仍在运行

### Scenario: Verifier 返回失败

- **Given** 一个或多个验收项为 failed 或 blocked
- **When** Verifier 提交 verification
- **Then** failed 项返回 Builder
- **And** external blocker 保持等待并显示责任人

## 数据要求

${scopeLines}

## 风险

${riskLines}
`;
  }

  if (artifact.key === 'verification') {
    const failedItems = acceptanceItems.filter((item) => item.result !== 'passed');
    const failedLines = failedItems.length
      ? failedItems
          .map(
            (item) =>
              `- **${item.id} · ${item.result}**：${item.text}${item.reason ? `；${nativeTextValue(item.reason)}` : ''}`,
          )
          .join('\n')
      : '- 无。所有验收项均已通过。';
    return `# Verification: ${scenario.title}

## 结论

**${change.verificationResult === 'pass' ? 'PASS' : change.verificationResult === 'fail' ? 'FAIL' : 'PENDING'}** — ${nativeTextValue(change.verification?.summary, '等待 Verifier 完成独立验证。')}

## 验收矩阵

${acceptanceLines}

## 执行证据

${checkLines}

## 未通过项

${failedLines}

## 风险与限制

${riskLines}

## 证据完整性

- 验证记录绑定当前 brief、spec、源码范围与配置 hash。
- 本地进程状态不作为 portable 通过证据。
- 如果任一绑定内容变化，本结论自动失效并要求重新验证。

## 后续动作

${change.verificationResult === 'fail' ? '- 将 failed 验收项返回 Builder，保持原验收 ID。\n- 外部阻塞解除前不增加实现重试次数。\n- 修复完成后重新执行全部相关 checks。' : '- 确认源码、配置和 portable artifacts 的 hash 仍与本次验证一致。\n- 用户确认归档边界后写入 archive receipt。\n- 保留验证命令、退出码和风险说明供后续审计。'}
`;
  }

  return `# ${artifact.label}: ${scenario.title}

## 目标

${scenario.outcome}

## 当前 Native 状态

- Phase：${change.phase}
- Loop：${change.loop?.stage ?? 'unknown'} / iteration ${change.loop?.iteration ?? 1}
- Verification：${change.verificationResult ?? 'pending'}
- Acceptance：${change.acceptance?.passed ?? 0}/${change.acceptance?.total ?? 0} passed

## 范围

${scopeLines}

## 风险

${riskLines}

## 验收

${acceptanceLines}
`;
}

function enrichNativeDemoArtifacts(change) {
  change.artifacts = (change.artifacts ?? []).map((artifact) => {
    if (!artifact.exists) return artifact;
    const content = nativeArtifactContent(change, artifact);
    return {
      ...artifact,
      content,
      truncated: false,
      size: content.length,
      updatedAt: '2026-08-29T12:32:00.000Z',
    };
  });
  for (const child of change.children ?? []) enrichNativeDemoArtifacts(child);
  return change;
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
    summary: demoNativeText(`恢复检查记录 ${index + 1}`),
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

const CLASSIC_ACTIVE_PREVIEW_NAMES = [
  'harden-api-auth-boundary',
  'stream-dashboard-events',
  'add-project-knowledge-filters',
  'repair-native-resume-probe',
  'migrate-classic-docs-layout',
  'improve-artifact-preview',
  'cache-plugin-center-pages',
  'add-dashboard-search',
  'protect-worktree-cleanup',
  'document-release-evidence',
  'optimize-native-snapshot',
  'unify-project-settings',
];

const CLASSIC_ARCHIVED_PREVIEW_NAMES = [
  'add-dashboard-project-switcher',
  'stabilize-memory-provider',
  'index-project-knowledge',
  'add-native-parent-child-flow',
  'migrate-classic-artifacts',
  'improve-verify-report',
];

const NATIVE_PREVIEW_NAMES = [
  'stabilize-workspace-recovery',
  'add-evidence-pagination',
  'repair-archive-preflight',
  'improve-builder-handoff',
  'validate-runtime-artifacts',
  'add-parent-change-summary',
  'harden-project-discovery',
  'stream-verifier-progress',
  'reduce-snapshot-latency',
  'persist-acceptance-results',
  'repair-portable-state',
  'add-worktree-diagnostics',
  'improve-resume-guidance',
  'validate-child-dependencies',
  'index-native-artifacts',
  'add-verification-evidence',
  'protect-state-transitions',
  'improve-change-search',
  'repair-runtime-routing',
  'document-recovery-contract',
  'add-scope-drift-check',
  'improve-archive-summary',
  'stabilize-hook-router',
  'validate-workspace-identity',
];

function createClassicDemoChange(template, index, status) {
  const change = cloneDemoValue(template);
  const names =
    status === 'archived' ? CLASSIC_ARCHIVED_PREVIEW_NAMES : CLASSIC_ACTIVE_PREVIEW_NAMES;
  const originalName = names[(index - 1) % names.length];
  const date = `2026-07-${String(10 + (index % 20)).padStart(2, '0')}`;
  const sourcePath = template.path;
  change.demoScenario = template.demoScenario ?? template.displayName;

  if (status === 'archived') {
    const archiveName = `${date}-${originalName}`;
    change.id = `archive/${archiveName}`;
    change.name = archiveName;
    change.displayName = originalName;
    change.status = 'archived';
    change.phase = 'archive';
    change.path = `docs/openspec/changes/archive/${archiveName}`;
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
    change.path = `docs/openspec/changes/${originalName}`;
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
  const name = NATIVE_PREVIEW_NAMES[(index - 1) % NATIVE_PREVIEW_NAMES.length];

  change.name = name;
  change.demoScenario = template.demoScenario ?? template.name;
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
    code: `workspace-evidence-${String(index + 1).padStart(2, '0')}`,
    message: `工作区证据 ${index + 1}：需要补充对应的验证记录`,
    suggestion: '补齐对应产物后重新运行 comet verify',
  })),
);
DEMO_SNAPSHOT.git.recentCommits.push(
  ...Array.from(
    { length: 8 },
    (_, index) => `d4e0${String(index + 1).padStart(2, '0')} 更新 Dashboard 工作区投影`,
  ),
);

const nativeTemplates = DEMO_SNAPSHOT.native.changes.slice();
DEMO_SNAPSHOT.native.changes.push(
  ...Array.from({ length: 24 }, (_, index) =>
    createNativeDemoChange(nativeTemplates[index % nativeTemplates.length], index + 1),
  ),
);
const nativeSidebarDemoChange = DEMO_SNAPSHOT.native.changes[0];
nativeSidebarDemoChange.children = [
  {
    name: 'prepare-parent-workspace',
    dependsOn: [],
    covers: ['A1'],
    status: 'done',
    phase: 'archive',
    message: '工作区已准备并完成归档。',
    locator: 'demo-native-child-prepare',
    changeStatus: 'archived',
    archiveName: '2026-08-08-prepare-parent-workspace',
    workspace: {
      id: 'comet-worktree-prepare',
      label: 'native/prepare-parent-workspace',
      branch: 'native/prepare-parent-workspace',
      current: false,
    },
  },
  {
    name: 'render-parent-child-tree',
    dependsOn: ['prepare-parent-workspace'],
    covers: ['A2'],
    status: 'active',
    phase: 'build',
    message: '正在实现 Dashboard 父子层级展示。',
    locator: 'demo-native-child-render',
    changeStatus: 'active',
    workspace: {
      id: 'comet-worktree-render',
      label: 'native/render-parent-child-tree',
      branch: 'native/render-parent-child-tree',
      current: false,
    },
  },
  {
    name: 'verify-parent-child-flow',
    dependsOn: ['render-parent-child-tree'],
    covers: ['A3'],
    status: 'pending',
    phase: 'build',
    message: '等待前置子 change 完成后开始验证。',
    locator: 'demo-native-child-verify',
    changeStatus: 'active',
    workspace: {
      id: 'comet-worktree-verify',
      label: 'native/verify-parent-child-flow',
      branch: 'native/verify-parent-child-flow',
      current: false,
    },
  },
];

function nativeChildArtifact(key, label, content) {
  return {
    key,
    label,
    path: `${key}.md`,
    exists: true,
    content,
    truncated: false,
    size: content.length,
  };
}

function addNativeChildDemoDetail(child, options) {
  const detail = createNativeV2Seed({
    name: child.name,
    status: child.changeStatus,
    archiveName: child.archiveName,
    archivedAt: options.archivedAt,
    phase: child.phase,
    ...options,
  });
  return {
    ...detail,
    ...child,
    status: child.status,
    changeStatus: child.changeStatus,
  };
}

nativeSidebarDemoChange.children = [
  addNativeChildDemoDetail(nativeSidebarDemoChange.children[0], {
    stateVersion: 3,
    stage: 'done',
    iteration: 1,
    attempt: 1,
    actor: 'verifier',
    verificationResult: 'pass',
    localReason: 'archived',
    archivedAt: '2026-08-08',
    artifacts: [
      nativeChildArtifact('brief', '需求简报', '# Workspace\n\nPrepare the parent workspace.\n'),
      nativeChildArtifact(
        'spec-workspace',
        'workspace Spec',
        '# Workspace\n\nCreate the child worktree.\n',
      ),
      nativeChildArtifact(
        'verification',
        '验证报告',
        '# Conclusion\n\nWorkspace preparation passed.\n',
      ),
    ],
    specs: {
      total: 1,
      create: 1,
      modify: 0,
      remove: 0,
      capabilities: [{ capability: 'workspace', operation: 'create' }],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [
      {
        id: 'A1',
        source: 'brief.md',
        text: '准备父 change 所需的子工作区。',
        result: 'passed',
        reason: demoNativeText('准备工作区已完成并归档。'),
      },
    ],
    verification: {
      verdict: 'pass',
      assurance: 'user-confirmed-degraded',
      summary: demoNativeText('子工作区已准备完成。'),
      risks: [],
      risksTruncated: false,
      completedAt: '2026-08-08T16:00:00.000Z',
    },
    checks: [
      {
        id: 'workspace-check',
        name: demoNativeText('Workspace check'),
        status: 'passed',
        exitCode: 0,
        durationMs: 420,
      },
    ],
    history: [
      {
        goalCycle: 1,
        iteration: 1,
        attempt: 1,
        outcome: 'pass',
        unresolvedIds: [],
        summary: demoNativeText('工作区准备完成并通过验证。'),
        completedAt: '2026-08-08T16:00:00.000Z',
      },
    ],
  }),
  addNativeChildDemoDetail(nativeSidebarDemoChange.children[1], {
    stateVersion: 4,
    stage: 'building',
    iteration: 1,
    attempt: 1,
    actor: 'builder',
    nextAction: '完成父子列表后提交 handoff。',
    verificationResult: 'pending',
    localStatus: 'running',
    localReason: 'current',
    localStage: 'building',
    requestCheckRounds: 1,
    artifacts: [
      nativeChildArtifact('brief', '需求简报', '# Parent-child tree\n\nRender nested changes.\n'),
      nativeChildArtifact(
        'spec-dashboard-tree',
        'dashboard tree Spec',
        '# Dashboard tree\n\nShow child progress and selection.\n',
      ),
    ],
    specs: {
      total: 1,
      create: 0,
      modify: 1,
      remove: 0,
      capabilities: [{ capability: 'dashboard-tree', operation: 'modify' }],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [
      {
        id: 'A1',
        source: 'brief.md',
        text: '父 change 能展示子 change。',
        result: 'passed',
        reason: demoNativeText('列表层级已可见。'),
      },
      {
        id: 'A2',
        source: 'brief.md',
        text: '点击子 change 后展示详情。',
        result: 'pending',
        reason: null,
      },
    ],
  }),
  addNativeChildDemoDetail(nativeSidebarDemoChange.children[2], {
    stateVersion: 2,
    stage: 'building',
    iteration: 1,
    attempt: 1,
    nextAction: '等待前置子 change 完成。',
    verificationResult: 'pending',
    localReason: 'missing',
    recoverableFromStage: 'building',
    artifacts: [
      nativeChildArtifact(
        'brief',
        '需求简报',
        '# Parent-child flow\n\nVerify the child workflow.\n',
      ),
      nativeChildArtifact(
        'spec-verification',
        'verification Spec',
        '# Verification\n\nVerify dependency order.\n',
      ),
    ],
    specs: {
      total: 1,
      create: 0,
      modify: 1,
      remove: 0,
      capabilities: [{ capability: 'parent-child-flow', operation: 'modify' }],
      capabilitiesTruncated: false,
    },
    acceptanceItems: [
      {
        id: 'A1',
        source: 'brief.md',
        text: '依赖完成后才允许验证。',
        result: 'pending',
        reason: demoNativeText('等待 render-parent-child-tree 完成。'),
      },
    ],
  }),
];

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
DEMO_SNAPSHOT.native.changes.forEach(enrichNativeDemoArtifacts);
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

const demoMemoryRecords = [
  {
    id: 'demo-memory-language',
    memoryType: 'core-profile',
    category: '交付语言与结构',
    scope: 'global',
    status: 'proven',
    authority: 'explicit',
    text: '默认使用中文沟通。代码任务的最终回复先给结论，再列出关键改动、验证结果和未覆盖项；避免把实现过程写成流水账。',
    reason: '用户在多次实现与评审任务中明确确认了语言和交付结构。',
    taskTypes: ['代码实现', '问题诊断', '独立评审'],
    evidenceCount: 6,
    applicationCount: 18,
    successCount: 18,
    failureCount: 0,
    lastApplication: {
      applicationId: 'demo-memory-language-application',
      task: '调整官网 Dashboard 数据',
      whyApplied: '当前任务需要用中文说明内容变化与验证证据',
      delivery: 'manifest',
      appliedAt: '2026-08-29T11:42:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [
      {
        applicationId: 'demo-memory-language-history-1',
        task: '修复 Dashboard 手机端展示',
        whyApplied: '需要先给出可见结果，再说明响应式实现和验证范围',
        delivery: 'full',
        appliedAt: '2026-08-28T18:16:00.000Z',
        outcome: 'used-successfully',
      },
    ],
    updatedAt: '2026-08-29T11:42:00.000Z',
  },
  {
    id: 'demo-memory-dashboard-verification',
    memoryType: 'collaboration-policy',
    category: 'Dashboard 验收基线',
    scope: 'project',
    projectKey: 'comet',
    status: 'proven',
    authority: 'explicit',
    text: '桌面端按 1444 × 901 基准检查，移动端按 390 × 844 检查；交互式工作台保持固定桌面画布比例，窄屏允许横向浏览，不整体压缩成难以阅读的缩略图。',
    reason: '当前改动同时命中 Dashboard 画布、官网嵌入容器和手机端展示。',
    pathPatterns: ['domains/dashboard/web/**', 'website/**'],
    operations: ['界面实现', '交互回归'],
    phases: ['Build', 'Verify'],
    evidenceCount: 4,
    applicationCount: 9,
    successCount: 9,
    failureCount: 0,
    lastApplication: {
      applicationId: 'demo-memory-dashboard-verification-application',
      task: '调整首页工作台的手机端尺寸',
      whyApplied: '变更涉及固定画布缩放和窄屏可读性',
      delivery: 'expanded',
      appliedAt: '2026-08-29T10:58:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [],
    updatedAt: '2026-08-29T10:58:00.000Z',
  },
  {
    id: 'demo-memory-dashboard-style',
    memoryType: 'personal-episode',
    category: '官网工作台迭代',
    scope: 'project',
    projectKey: 'comet',
    status: 'trial',
    authority: 'inferred',
    text: '当首页工作台与真实 Dashboard 的视觉和交互偏差较大时，先复用现有 Dashboard 组件与数据结构，再为官网单独处理只读边界、弹层范围和响应式缩放。',
    reason: '当前任务同时修改 Website 嵌入入口和 Dashboard 展示数据。',
    taskTypes: ['官网展示', 'Dashboard 设计'],
    pathPatterns: ['website/**', 'domains/dashboard/web/**'],
    evidenceCount: 2,
    applicationCount: 4,
    successCount: 4,
    failureCount: 0,
    lastApplication: {
      applicationId: 'demo-memory-dashboard-style-application',
      task: '将首页截图替换为可交互 Dashboard',
      whyApplied: '需要保留真实中心 UI，同时避免官网预览获得写权限',
      delivery: 'manifest',
      appliedAt: '2026-08-29T10:36:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [],
    episode: {
      situation: '直接嵌入完整 Dashboard 后，移动端内容被缩成缩略图，文件预览也会占满页面。',
      actionSummary:
        '拆出 Website 专用入口，复用中心页 UI，把写操作设为只读，并将窄屏切换为固定画布横向浏览。',
      outcome: '桌面端和手机端都能读清核心区域，弹层交互保持在当前容器内。',
      lesson: '官网工作台应复用产品的信息架构，但需要独立的展示边界。',
    },
    updatedAt: '2026-08-29T10:36:00.000Z',
  },
  {
    id: 'demo-memory-legacy-layout',
    memoryType: 'collaboration-policy',
    category: '旧版首页展示方式',
    scope: 'project',
    projectKey: 'comet',
    status: 'superseded',
    authority: 'explicit',
    text: '首页只放置一张 Dashboard 截图，不提供工作流切换、中心页浏览或文件预览。',
    reason: '已由可交互、只读的官网 Dashboard 替代。',
    evidenceCount: 2,
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt: '2026-08-29T09:40:00.000Z',
  },
];

const demoProjectKnowledgeRecords = [
  {
    id: 'demo-knowledge-website-build-chain',
    projectId: 'comet',
    type: 'topology',
    state: 'proven',
    authority: 'repository',
    title: 'Dashboard 数据采集与详情读取链路',
    summary:
      'Dashboard Server 先通过 Collector 返回轻量工作区投影；变更列表使用分页数据，用户选中 change 后才按需读取产物正文和验证证据。',
    applicablePaths: [
      'domains/dashboard/collector.ts',
      'domains/dashboard/server.ts',
      'domains/dashboard/types.ts',
    ],
    operations: ['采集概览', '分页列表', '按需读取详情'],
    phases: ['Build', 'Verify'],
    conclusions: [
      {
        text: '概览与详情使用独立采集路径，列表请求不预读所有产物正文。',
        sources: [{ source: 'domains/dashboard/collector.ts', anchor: 'collectDashboardSnapshot' }],
      },
      {
        text: '分页游标绑定当前 snapshot，工作区状态变化后会要求重新加载。',
        sources: [
          { source: 'domains/dashboard/server.ts', anchor: 'snapshotVersion' },
          { source: 'domains/dashboard/types.ts', anchor: 'DashboardChangePage' },
        ],
      },
    ],
    relations: [],
    verification: [
      { command: 'npx vitest run test/domains/dashboard/collector.test.ts' },
      { command: 'pnpm build:dashboard' },
    ],
    applicationCount: 6,
    successCount: 6,
    failureCount: 0,
    lastApplication: {
      task: '优化 Dashboard 详情加载',
      whyApplied: '变更涉及概览投影、分页游标与产物按需读取',
      delivery: 'expanded',
      appliedAt: '2026-08-29T11:06:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [],
    updatedAt: '2026-08-29T11:06:00.000Z',
  },
  {
    id: 'demo-knowledge-dashboard-data-boundary',
    projectId: 'comet',
    type: 'constraint',
    state: 'proven',
    authority: 'repository',
    title: 'Dashboard 文件预览与写入边界',
    summary:
      '产物正文会在 Dashboard 容器内打开，路径读取会重新确认文件仍位于项目边界内；预览界面不直接改写 workflow 状态。',
    applicablePaths: [
      'domains/dashboard/web/src/main.jsx',
      'domains/dashboard/web/src/dashboard-modal.jsx',
      'domains/dashboard/web/src/markdown-preview.js',
    ],
    operations: ['查看', '文件预览', '中心页浏览'],
    phases: ['Build', 'Verify'],
    conclusions: [
      {
        text: '文件预览、设置和中心页共用 Dashboard 弹层容器，关闭、Esc 和全屏状态由同一层管理。',
        sources: [
          { source: 'domains/dashboard/web/src/dashboard-modal.jsx', anchor: 'DashboardModal' },
          { source: 'domains/dashboard/web/src/main.jsx', anchor: 'ArtifactPreview' },
        ],
      },
    ],
    relations: [],
    verification: [
      { command: 'npx vitest run test/domains/dashboard/web-source.test.ts' },
      { command: 'pnpm test:dashboard-e2e -- --grep "previews an artifact"' },
    ],
    applicationCount: 8,
    successCount: 8,
    failureCount: 0,
    lastApplication: {
      task: '修复产物预览无法退出全屏',
      whyApplied: '变更涉及预览容器、关闭行为和项目路径边界',
      delivery: 'manifest',
      appliedAt: '2026-08-29T11:18:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [],
    updatedAt: '2026-08-29T11:18:00.000Z',
  },
  {
    id: 'demo-knowledge-dashboard-regression',
    projectId: 'comet',
    type: 'dependency',
    state: 'proven',
    authority: 'repository',
    title: 'Dashboard 前端验证入口',
    summary:
      '静态数据先由 Vitest 校验结构，Dashboard 交互由 Playwright 覆盖；修改源码后分别构建产品 Dashboard 与官网专用静态资源，再按风险扩大验证范围。',
    applicablePaths: ['domains/dashboard/**', 'test/domains/dashboard/**'],
    operations: ['构建', '回归测试'],
    phases: ['Verify'],
    conclusions: [
      {
        text: '浏览器测试通过独立 Playwright 配置启动 Dashboard 预览服务。',
        sources: [
          { source: 'package.json', anchor: 'test:dashboard-e2e' },
          { source: 'test/domains/dashboard/playwright.config.ts', anchor: 'webServer' },
        ],
      },
    ],
    relations: [],
    verification: [
      { command: 'npx vitest run test/domains/dashboard/web-source.test.ts' },
      { command: 'pnpm build:dashboard' },
      { command: 'pnpm test:dashboard-e2e' },
    ],
    applicationCount: 11,
    successCount: 11,
    failureCount: 0,
    lastApplication: {
      task: '验证官网中心页和文件预览',
      whyApplied: '变更涉及静态数据、路由切换、弹层和移动端视口',
      delivery: 'manifest',
      appliedAt: '2026-08-29T11:24:00.000Z',
      outcome: 'used-successfully',
    },
    applicationHistory: [],
    updatedAt: '2026-08-29T11:24:00.000Z',
  },
];

export const DEMO_PLUGIN_PAGES = [
  {
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
        files: ['.comet/memory/profile.md', '.comet/memory/projects/comet.md'],
        pausedLearningProjects: [],
        pausedRetrievalProjects: [],
        profile: { usedChars: 62, maxChars: 2000 },
        provider: { provider: 'local', configured: true },
      },
      retrieval: { records: demoMemoryRecords, profileRecords: demoMemoryRecords.slice(0, 1) },
      management: { records: demoMemoryRecords, conflicts: [] },
      policy: { learning: true, retrieval: true },
      projectKey: 'comet',
      providerConfig: {
        provider: 'local',
        profileCharLimit: 2000,
        taskContextCharLimit: 6000,
      },
      notifications: [],
      manifestPreview: demoMemoryRecords.slice(0, 2).map((record) => ({
        id: record.id,
        memoryType: record.memoryType,
        title: record.category,
        summary: record.text,
        whyApplied: record.lastApplication?.whyApplied,
        delivery: record.lastApplication?.delivery,
        appliedAt: record.lastApplication?.appliedAt,
        outcome: record.lastApplication?.outcome,
        lastApplication: record.lastApplication,
      })),
    },
  },
  {
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
      retrieval: '当前页面使用预置的项目知识，便于查看 Agent 在任务中会获得的上下文。',
      local: {
        available: true,
        repositoryId: 'comet',
        workspaceId: 'comet-main',
        sourceCount: 5,
        sources: [
          {
            source: 'domains/dashboard/collector.ts',
            kind: 'source',
            updatedAt: '2026-08-29T11:06:00.000Z',
          },
          {
            source: 'domains/dashboard/server.ts',
            kind: 'source',
            updatedAt: '2026-08-29T11:24:00.000Z',
          },
          {
            source: 'domains/dashboard/web/src/main.jsx',
            kind: 'source',
            updatedAt: '2026-08-29T10:54:00.000Z',
          },
          {
            source: 'domains/dashboard/web/src/dashboard-modal.jsx',
            kind: 'source',
            updatedAt: '2026-08-29T11:24:00.000Z',
          },
          { source: 'AGENTS.md', kind: 'guide', updatedAt: '2026-08-29T09:00:00.000Z' },
        ],
        sectionCount: 9,
        updatedAt: '2026-08-29T11:24:00.000Z',
        channels: ['records', 'sections'],
      },
      records: demoProjectKnowledgeRecords,
      manifestPreview: demoProjectKnowledgeRecords.slice(0, 2).map((record) => ({
        id: record.id,
        memoryType:
          record.type === 'topology' || record.type === 'fact' || record.type === 'dependency'
            ? 'project-model'
            : 'project-policy',
        title: record.title,
        summary: record.summary,
        whyApplied: record.lastApplication?.whyApplied,
        delivery: record.lastApplication?.delivery,
        appliedAt: record.lastApplication?.appliedAt,
        outcome: record.lastApplication?.outcome,
        lastApplication: record.lastApplication,
      })),
      counts: {
        trial: 0,
        proven: demoProjectKnowledgeRecords.length,
        enforced: 0,
        superseded: 0,
      },
      diagnostics: [],
      sourcePreviews: [
        {
          source: 'domains/dashboard/collector.ts',
          format: 'markdown',
          content:
            '# Dashboard Collector\n\nCollector 把项目配置、Classic 变更、Git 状态和风险项组合成稳定投影。\n\n## 读取策略\n\n- 概览请求只返回轻量字段\n- 选中 change 后才读取产物正文\n- 每次读取都校验项目路径边界\n',
          modifiedAt: '2026-08-29T11:06:00.000Z',
        },
        {
          source: 'domains/dashboard/server.ts',
          format: 'markdown',
          content:
            '# Dashboard Server\n\nServer 提供项目列表、snapshot、change 详情和插件页面等稳定路由。\n\n分页游标与 snapshot 版本绑定；当工作区发生变化时，客户端会收到过期诊断并重新加载。\n',
          modifiedAt: '2026-08-29T11:24:00.000Z',
        },
        {
          source: 'domains/dashboard/web/src/main.jsx',
          format: 'markdown',
          content:
            '# Dashboard Web App\n\n主界面管理 Classic、Native、个人记忆、项目知识与设置中心的选中状态。\n\n文件预览在容器内打开，用户可以通过关闭按钮、背景或 Esc 退出。\n',
          modifiedAt: '2026-08-29T10:54:00.000Z',
        },
        {
          source: 'domains/dashboard/web/src/dashboard-modal.jsx',
          format: 'markdown',
          content:
            '# Dashboard Modal\n\n弹层统一处理标题、副标题、页脚和 portal 挂载位置。\n\n官网与产品界面复用同一套关闭行为，不会把用户困在全屏预览中。\n',
          modifiedAt: '2026-08-29T11:24:00.000Z',
        },
        {
          source: 'AGENTS.md',
          format: 'markdown',
          content:
            '# Dashboard 变更验证\n\n每轮先运行覆盖当前改动的最小相关测试；涉及前端构建和生成资产时再运行 build，最终按风险决定是否扩大到完整回归。\n',
          modifiedAt: '2026-08-29T09:00:00.000Z',
        },
      ],
      demoQueryResults: [
        {
          title: 'Dashboard 数据采集与详情读取链路',
          source: 'domains/dashboard/collector.ts',
          content: 'Collector 返回轻量工作区投影，用户选中 change 后才读取产物正文。',
        },
        {
          title: 'Dashboard 文件预览与写入边界',
          source: 'domains/dashboard/web/src/dashboard-modal.jsx',
          content:
            '产物在 Dashboard 容器内打开，读取路径会校验项目边界，预览界面不直接改写 workflow 状态。',
        },
      ],
    },
  },
];

export const DEMO_PROJECT_CONFIG = {
  path: '.comet/config.yaml',
  revision: '8f3a2c1',
  schema: 'comet.project.v1',
  defaultWorkflow: 'classic',
  workflows: ['classic', 'native'],
  ambientResume: true,
  hookAllowPaths: ['docs/generated', 'reports'],
  knowledge: {
    provider: 'local',
    localInclude: ['docs/architecture/**/*.md', 'packages/*/README.md'],
  },
  native: {
    artifactRoot: '.comet/native',
    language: 'zh-CN',
    clarificationMode: 'sequential',
    archiveConfirmation: 'required',
    maxVerifyFailures: 3,
  },
  classic: {
    artifactLayout: 'docs',
    language: 'zh-CN',
    contextCompression: 'beta',
    reviewMode: 'standard',
    autoTransition: false,
  },
};

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
