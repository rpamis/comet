---
paths:
  - 'domains/project-knowledge/**/*.ts'
  - 'app/commands/project-knowledge.ts'
  - 'test/domains/project-knowledge/**/*.ts'
  - 'test/app/project-knowledge-command.test.ts'
  - 'scripts/benchmark/project-knowledge-*.mjs'
---

# Project Knowledge

<!-- comet-development-rule:project-knowledge -->

- 当前源码、配置、测试和 Runtime 状态是项目事实直接来源；Project Knowledge 是带来源的可检索理解，不是第二套 Rule 系统。
- Project Model 只记录 topology、fact 和 dependency；Project Policy 记录 decision、pattern、procedure、constraint 和 failure-resolution。
- Project Memory 是 Agent 在任务结束时通过 `comet knowledge remember` 直接写入的文件层经验：`<知识缓存>/Comet/project-knowledge/<repositoryId>/memory/` 下 `MEMORY.md` 索引加单条 Markdown。索引随任务上下文全文投递，单条按 `project-memory:<slug>` 按需展开；该层独立于 Local/Remote Provider 选择，不受语义评审队列约束。
- repository identity 可跨 worktree 归组，workspace 相关索引和来源状态必须保持隔离并可重建。
- 查询或后台学习失败时不注入失败内容、不阻塞当前任务；Remote 失败不能静默切换 Local。
- 不把完整仓库、完整 diff、凭据、Personal Memory 或原始日志发送给 Remote Provider。
- 新增提取、召回或学习行为时验证来源、生命周期、纠正/取代关系和实际应用结果。
