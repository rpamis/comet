# Native 多 Shape 与实施工作区

来源为 [功能 Issue #560](https://github.com/rpamis/comet/issues/560)。Native v4 内置 Run 支持同一分支、同一工作区内整理多个需求，由一个 Agent 切换编辑，各自保存 Shape 和批准记录。评审人可以同时阅读不同需求的材料。

## 创建与评审

```bash
comet native new feature-a --isolation current
comet native new feature-b --isolation current
comet native select feature-a
```

每个需求保留自己的 `brief.md`、`specs/`、Run 和用户决定。使用 `next` 返回的 Shape 确认命令批准当前材料。若批准后需要等待实施，在该命令后追加 `--defer-build`。此时保存批准，进入 Build 待执行状态，继续等待后续 `next`。单独使用 `--defer-build` 会被拒绝。

继续核对评审意见、需求和验收内容。需要改变已批准范围时沿原 Run 修订并重新确认。普通编辑按现有增量恢复协议由 Agent 判断影响。

## 开始实施

后续执行 `comet native next feature-a --session <实际会话标识> --json`。当同一工作区还有其他活跃需求时，Runtime 先准备 `comet/feature-a` 分支及 `.worktrees/feature-a`，交接该需求的原 Run、材料和批准，再领取 Builder。CLI 返回 `executionCwd`，后续开发和命令应在该目录执行。没有其他活跃需求时可直接在原工作区执行。

工作区使用当前分支的已提交代码。规划目录之外的已跟踪代码修改需要先整理并提交，再重试原命令。未跟踪代码不会自动进入新 worktree。需要这些代码时，由 Agent 在启动前明确整理实施基线。

主工作区保留材料用于查看，并记录需求的实施位置。后续对该需求调用 `native next` 会继续原交接或转到原实施工作区。运行时阻止主工作区继续领取这个 Run 或写入旧执行。选择其他 Shape 后可以继续规划。

交接中断时，保留目标 worktree，重试 `native next`。恢复先检查目标 Run，已完成交接时不会重新复制旧材料或创建第二个 Builder。交接不自动提交、推送或批准 Git 交付。

## 使用范围与验证

Compat 和固定 SDK 应用沿用各自的隔离规则。同一物理工作区仍由一个 Agent 写入，多 Agent 同时编写应使用各自 worktree。当前 selection 是工作区级选择，多人审批身份与指定评审人规则继续通过人工流程或 Git 平台处理。

公开 CLI 回归覆盖同分支两个 Shape、批准后等待、原 Run 与批准保留、交接中断重试、同会话 Builder 领取和重复调用不重复执行。Guard 和底层 SDK 领取入口阻止在共享规划工作区实施。

旧测试 `requires workspace isolation before creating a second current-workspace SDK change` 保留名称、退出码与禁止第二个 owner 的断言，前提更新为第一个需求已领取 Build。原先 Shape 即排他由本功能明确调整。产物缺失时占用工作区、Compat 排他及旧来源登记保留。此项是新功能的业务规则调整，未声称修复历史知识检索或真实模型遵循问题。

真实平台 Hook 和模型 Eval 需要对应环境验证，确定性 Guard 测试只验证 Runtime 决策。

## 2026-11-15 审核与恢复核对

审核对照 Issue #560 与 feat 前的 master，分别检查仓库规范和需求覆盖。目标 Compat owner、复用 worktree 未登记材料、最新目标 checkpoint、共享目录 Hook 目标分类、moved 只读状态和参数校验分别登记为 native-560 系列案例。

同一 checkpoint 恢复测试在 a699272f 临时检出为 1 failed / 1 passed，在当前修复代码为 2 passed。目标材料保护和打包 Router 目标分类的三项新增回归在修复前全部失败，修复后通过。source next 参数校验先于交接；完成材料复制后只从目标最新 checkpoint 恢复，原 Builder 会话和未知执行继续沿原恢复协议核对。

遇到目标既有 Runtime 归属或复用 worktree 同名材料时，在改写源状态前拒绝迁移，保留双方现场。只读状态跟随目标当前 Run，源工作区继续阻止实施和原 Action 写入。Hook 先分类目标，中立路径保持原规则，实现路径要求完成工作区交接；中英文 Rule 已同步这些行为。

本轮执行定向 CLI、Router、状态与恢复测试、生成资产和构建检查。真实 Agent 平台 Hook 和模型 Eval 未执行，确定性平台事件夹具不作为真实平台或模型证据。
