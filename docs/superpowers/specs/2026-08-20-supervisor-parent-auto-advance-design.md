# Supervisor 父级自动接回设计

## 背景

beta20 已有 Supervisor v2 的 integration-first 生命周期，也兼容读取 active Supervisor v1。当前父级状态转换仍依赖一次额外的父级 `comet native next`：即使全部 Child 已归档或 integrated，父级 Portable State 也可能继续停在 `build`。Native Skill 虽要求在每个任务后重新读取 `readyChildren`，但宿主会话结束、工作区绑定漂移或 continuation 未被消费时，用户仍需要手工接管并说“推进”。

当前仓库存在真实复现：`semantic-self-evolving-memory` 的六个 v1 Child 全部显示 `done/archive`，父级仍为 `build`，状态查询落在 detached 的旧验证 worktree 并要求用户返回绑定工作区。这个状态没有破坏 Child 结果，但会让父级最终 Verify 和 Archive 被遗忘。

## 目标

最后一个可信 Child 完成后，Runtime 自动把唯一父级从 Build 推进到最终 Verify；Skill 自动消费父级 continuation 并通知用户。即使协调会话在边界处中断，父级状态也能在恢复时幂等补齐，不再静默遗留在 Build。

## 方案比较

### 方案一：只强化 Skill 指令

要求 Skill 在 Child 完成后继续调用父级 `native next`。改动最小，但 Runtime 状态仍依赖宿主正确执行提示词；会话中断或宿主未消费 continuation 时问题仍然存在。

### 方案二：只返回显式父级 continuation

Runtime 返回 `advance-parent`，但仍由宿主执行状态转换。可观测性更好，仍不能保证父级持久化推进。

### 方案三：Runtime 推进，Skill 继续协调

Runtime 在最后一个 Child 完成或恢复发现完成事实时，幂等完成父级 Build；Skill 只负责继续派发最终 Verifier和展示通知。该方案把正确性放在 Runtime，同时保留 Agent 协调边界，因此采用此方案。

## 生命周期

### Supervisor v2

`supervisor-integrate` 接受最后一个 verified Child、完成串行合入并通过最小集成检查后，Runtime 重新投影全部 Child。若全部状态为 `integrated`，父级在同一 CLI 操作返回前完成 Build，生成唯一的父级候选并进入 `verify`。返回值包含父级推进摘要和最终 Verifier continuation。

### Supervisor v1

Child Archive 必须先完成其既有事务和授权的 `finish=merge`。只有 workspace finish 明确证明 Child 已合入父级分支后，Runtime 才扫描 active、已确认的 v1 父级声明：

1. `children.yaml` 声明当前 Child；
2. 父级 `workspace.change_branch` 与 Child Archive 的 target branch 一致；
3. 权威父级工作区的 Git 分支绑定一致，不使用 detached 或 mismatch 候选；
4. 重新读取后全部声明 Child 都满足既有 `done` 判定。

只有唯一父级满足条件时才自动进入 Verify。没有父级、多个父级、Archive 未合入或分支不一致都不猜测状态。

### 中断恢复

Child 完成与父级推进允许是两个可恢复事务边界。若进程在两者之间终止，下一次父级恢复或相关 Supervisor 推进重新计算事实：父级仍为 active Build 且全部 Child 已完成时，只补做一次父级完成。父级已经在 Verify、Archive 或 done 时返回幂等 no-op，不创建第二个候选或 Verifier。

## Runtime 边界

实现提供一个共享的“尝试完成父级 Build”边界，输入是权威父级路径、Portable State 和已重算的 Child 投影。该边界复用 `completeNativePortableParentBuild` 的验收漂移、确认、repair 和 all-done 检查，不让 v1/v2 各复制状态转换。

v2 从 `native next --runner-input supervisor-integrate` 的成功路径调用；v1 从 Child Archive workspace finish 成功后的 post-finish 路径调用。Archive 本身已经完成时，后续父级推进失败不能回滚或伪装 Child Archive，而应返回结构化 `parentAdvance` blocker，供恢复继续。

只读 `status` 不修改状态。它可以返回明确的 `advance-parent` continuation；Native Skill 在恢复任务时必须自动消费。这样既保持查询只读，也能修复已经遗留的 active 父级。

## 用户感知与 Skill 行为

自动推进成功时，CLI/Skill 明确展示：

> 全部 Child 已完成，Supervisor `<parent>` 已进入最终 Verify。

Native Skill 无需再次询问范围确认，立即切回父级并按 continuation 派发最终 Verifier。如果当前宿主无法继续执行，父级已经持久化为 `verify`，输出必须保留准确下一步，而不是以 Child 完成消息结束任务。

父级 Verify 通过后的 Archive、workspace finish、merge、push 和 PR 继续遵循现有 `native.archive_confirmation`、Runtime continuation 和用户授权。本变更不让 Child 完成事件直接执行最终交付。

## 错误处理

- 存在未完成、blocked 或 needs-reverify Child：父级保持 Build。
- 父级处于 repair 循环：要求按现有协议增加 repair Child，不自动绕过失败。
- v1 父级解析为零个或多个：返回可恢复 blocker，不选择任意候选。
- 只有 detached/mismatch 工作区：返回绑定诊断，不在错误 worktree 写状态。
- 重复 Child 回报、重复 Archive 恢复或重复父级恢复：保持幂等。
- 自动推进写入失败：保留已完成 Child 和父级旧状态，下一次恢复重试。

## 测试

- v2：最后一个 Child 集成后同一命令进入父级 Verify，并返回最终 Verifier continuation。
- v1：最后一个 Child Archive merge 后定位唯一父级并进入 Verify。
- 恢复：Child 完成后模拟中断，下一次恢复补做一次父级推进。
- 安全：部分 Child 未完成、Archive 未 merge、父级歧义、binding mismatch、repair 状态均不推进。
- 幂等：父级已处于 Verify/Archive/done、重复回报和重复恢复不生成第二候选。
- 契约：中英文 Native Skill 都要求自动切回父级并明确通知，同时保留 Archive 授权边界。
- 发布：运行受影响 Runtime/CLI 测试、格式、lint、类型、Native bundle 生成检查和风险匹配的全量测试。

## 非目标

- 后台 daemon、文件 watcher、通用任务调度器。
- 自动解决 Git 冲突或工作区绑定歧义。
- 把 v1 数据迁移成 v2。
- 因 Child 完成而自动 Archive、合并、推送或创建 PR。
