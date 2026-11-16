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

## 2026-11-16 PR #562 交接审核

来源为 [已删除材料恢复](https://github.com/rpamis/comet/pull/562#discussion_r4581585323) 和 [既有分支基线](https://github.com/rpamis/comet/pull/562#discussion_r4581585327)。在 `2df695243bb88f5093be22981ca39f5a6435d2ad` 的公开 Native next bundle 上新增两项精确回归，两项均失败：新 worktree 留下已在源目录删除的已提交 Spec；已有实施分支停留在旧提交时仍可领取 Builder。

首次交接在发布目标 Run 前替换该 change 的初始检出材料，使删除与当前材料一起交接。已完成复制的交接仍从目标最新 checkpoint 恢复，不重新复制。原有目标 owner、未登记材料及其他 Shape 的保护保持有效。

自动交接前核对既有 `comet/<change>` 分支与源工作区 HEAD 的提交。不同则保留双方分支和材料，拒绝创建 worktree 或推进原 Run，并提示先核对实施基线；不自动重置分支。基线明确对齐后，同一个已批准任务可继续。

案例为 `native-562-build-material-deletions` 与 `native-562-build-branch-baseline`，精确测试选择器见 `config/workflow-regressions.json`。使用公开 bundle 验证删除同步、旧基线拒绝、合法基线继续及原 Run/批准保留；相邻恢复测试继续核对目标最新 checkpoint 和原 Builder 身份。真实平台 Hook 与模型 Eval 不在本轮执行范围内。

CodeRabbit 与第二轮 Codex 审核继续复现了五项行为：干净 worktree 已创建但尚未记录交接时不能重试；同提交目标中的本地实现修改被直接沿用；源端相对结果路径被重定向到目标的另一份报告；失败 Builder 修订 Shape 后跳过隔离；源端 Run 历史丢失后，只读读取先恢复陈旧检查点而未跟随交接目标。对应 `native-562-*` 案例已追加登记。

复用目标只允许当前提交的干净检出及 Comet 准备的配置，保留既有 Runtime owner 与本地改动拒绝。相对结果路径在原工作区解析；源端只读读取先跟随已有交接记录。失败 Builder 不再代表已完成实施准备，部分实现仍由 Agent 明确整理并提交，Runtime 不自动提交。两份交接/恢复测试与 v4 公开 CLI 共 58 项通过，保留既有断言。

源工作区的未跟踪文件继续遵循已公开约定：不自动复制到基于已提交代码创建的新 worktree，启动前由 Agent 整理必要代码；未因审核建议新增全目录未跟踪文件阻塞。相关说明已在“开始实施”列出。

Windows SDK CI 的既有取消回归还发现：Run 已取消但 selection 清理失败时，旧便携状态仍可能是 Shape，不能因此把该 Run 当作可共享规划。`native-562-cancelling-shape-start` 复用原案例，保留清理失败时阻止 SDK/Compat 新建、原取消 Run 与 selection 不变、显式修复后允许新建的全部断言。`8e40d7b3` 定向复现失败；创建入口排除已取消 Run，取消完成后的任务仍由原发现入口正常移出活动集合。

CI 中旧 Run 的批准续行、后续合法归档和 Runtime 读取预算也先在本地复现失败。共享规划约束只适用于具有 Git 规划绑定、且本次 Shape 使用 v4 执行的内置 Run；旧 Shape 依据保留的执行来源继续原批准，固定应用和原本未绑定的 SDK 工作区沿用自身约定。领取、Hook 与高层 Build 准备使用同一判定，没有为归档另建状态或改写旧执行。现有升级案例补充核对原 Builder 的 Hook 合法写入。

交接查询复用 store 已绑定的 Runtime 根目录，但每次仍读取当前交接记录；只读请求不因后来的环境变量变化切换归属。三项原失败回归均通过，分别登记为 `native-562-legacy-shape-approval`、`native-562-legacy-archive-continuation`、`native-562-captured-runtime-namespace`。没有删除或缩窄历史断言。

后续 Review 又复现成功 Builder 的跨需求轮次问题、非 Git 项目误用共享规划，以及 Git Hook 环境下读错 worktree 索引。实施准备只检查最近一次 Shape 准备之后的动作；此前成功的 Builder 仍保留，但不阻止新轮次交接。创建入口与后续执行使用同一共享规划条件，无 Git 分支时只保留单 change。`cd7488f6` 的公开 new bundle 在隔离非 Git 项目中两次新建均成功，新代码拒绝第二次且保留原单任务的合法 Build。

同步 Git 命令复用已有 `independentGitEnvironment()`，清除仓库和索引局部变量，保留全局配置与认证。临时 linked worktree 的实际修改在旧代码中被源索引掩盖，新代码读取目标修改和分支。三项案例 `native-562-reapproved-succeeded-builder-isolation`、`native-562-nongit-shared-planning`、`git-562-inherited-worktree-environment` 均保留修复前失败和修复后执行证据；此前失败 Builder 的精确测试名称和断言不变。

最新两项 Review 分别指出默认实施名称与原规划区相撞，以及创建入口仍扫描旧轮次 Builder。来源为 [规划区名称占用](https://github.com/rpamis/comet/pull/562#discussion_r4581945001) 和 [重新批准后新建 Shape](https://github.com/rpamis/comet/pull/562#discussion_r4581945006)。在 `8e49f3bb` 的公开 CLI/bundle 上四项新增回归均失败；同一案例在重建后的修复代码全部通过。

原规划区已使用 `comet/<change>` 或默认 worktree 时，实施交接使用独立的 `-build` 名称，仍核对既有目标基线、owner 和本地修改，不覆盖其他工作区。新建与后续 Build 共用当前 Shape 轮次的动作查询，保留历史成功/失败记录，未领取新 Builder 时允许继续共享规划。案例 `native-562-source-workspace-name-collision` 和 `native-562-reapproved-shape-admission` 分别覆盖 branch/worktree 规划和成功/失败 Builder；同时断言原 Run、批准及其他 Shape 材料不变。真实平台 Hook 和模型 Eval 未执行。

[原规划分支绑定审核](https://github.com/rpamis/comet/pull/562#discussion_r4581965480) 的可复现条件是：批准 main 上的 Shape 后，切到另一分支并创建该分支的新 Shape，再从该分支推进原任务。普通同分支 peer 随切换一并退出活动集合，不触发交接；上述跨分支 peer 才会暴露原绑定被覆盖的问题。精确公开 CLI 回归在修复前失败；交接前检查原 change_branch，分支不匹配时沿原诊断返回，不发布交接。案例 `native-562-planning-branch-binding` 核对原 Run 不变、目标未创建，并核对切回 main 后可正常实施。

[中文材料路径审核](https://github.com/rpamis/comet/pull/562#discussion_r4583195979) 指出，Git 默认对中文文件名的按行输出添加引号及八进制转义，合法的正式材料因此被误判为未提交实现代码。`c8913fbf` 的公开 next bundle 在 `core.quotePath=true` 时返回 65；同一 Run 场景在 false 时通过。源码改用 Git 既有的 `-z` 路径输出，按 NUL 分隔，不依赖用户配置。

案例 `native-562-unquoted-material-paths` 覆盖两种 Git 引号设置，核对中文及空格文件名的当前材料、原 Run、批准和其他 Shape 保留；两种设置下未提交中文源码仍阻止交接，明确提交源码后才可继续。重建后交接恢复测试文件 17 个测试通过，Native/Entry 构建、lint 和生成物检查通过。该问题属于本分支新增共享交接能力的开发期修正，不另写为已发布版本修复；网站现有共享规划说明不需改变。没有启动真实平台 Hook 或模型 Eval。
