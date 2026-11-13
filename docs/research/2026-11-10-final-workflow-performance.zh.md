# 053 最终流程减负实施记录

比较基线：`9acb00ff61220f1bbeea5bf46dd190438f3f9a77`。本轮完成已确认的 Classic 与 Native 删重，保留跨设备 Portable、原 Run/Action/批准和未知执行恢复。用户随后追加的本机已归档 change 修复见[恢复记录](2026-11-10-archived-native-recovery.zh.md)。

来源：`report:2026-11-10-final-workflow-performance`。用户要求 Native 与 Classic 减负，不能影响跨设备断点恢复，按 0.5.3 稳定版本要求交付。本轮不启动 Eval、不发布 npm 或 GitHub Release。

## 实施范围

| 项目                 | 删除的重复工作                                                                                         | 保留的检查                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| C1 OpenSpec 生成循环 | 每个产物之后额外的 `state artifacts`；闭包完成后再次查询 status                                        | 每个产物后刷新实时 status，最终同次调用检查完整依赖及实际文件；单独 artifacts 命令仍查询当前状态                        |
| C2 Design 材料       | 同一次准备与同一次提交内语义相同的两次 Open receipt                                                    | 准备和提交分别重新读取，两个已有证据字段保留                                                                            |
| C3 Design 成功响应   | 刚通过提交验证后，仅为响应再查一次 OpenSpec                                                            | 只复用刚返回的同一 Run 对象；下一条命令重新检查                                                                         |
| C4 Classic 入口      | owner 在查找、加载与诊断之间重复读取；不需要时的 Git 探测；配置读取前重复的物理路径检查                | 真实配置读取仍走受保护文件入口；分支绑定、未提交分支、跨工作树归属与后续命令重新读取保留                                |
| N1 Native Run        | 没有推进时重新 inspect；正常推进后丢弃已提交 Run 再读一次                                              | CAS、claim、outcome 仍分别持久化；特殊归档路径和异常路径没有观察时仍重新读取                                            |
| N2 Native 响应       | 同次推进已经生成的 TaskStatus 被丢弃，再生成一次                                                       | task 字段及结果模板使用最后提交的 Run；领取只改变执行身份，诊断和决定观察仅在本次命令内复用；details 仍生成完整当前状态 |
| N3 v4 旧计算         | Builder 历史 Runtime check plan 推导、v4 不使用的 alternatives 模板、非 v1 Supervisor 的旧恢复状态解析 | v1/v3 原协议保留；v4 实际检查报告和原执行恢复保留                                                                       |
| N4 Supervisor Git    | Child/Parent 验证不消费的目标分支 commit 查询；Parent 重复读取相同配置                                 | 准备和集成仍读取实时目标 commit；候选 HEAD、工作树和祖先关系验证保留                                                    |

不删除 Portable、revalidate、evidence Action、原事务、旧 PID 锁或外部副作用核对，不引入持久化缓存、schema 迁移或新摘要。配置跨函数复用未扩大成命令级缓存，避免在写入和外部命令后复用旧配置。

N2 采用一次操作内复用诊断观察的实现，调整了原清单“最后一次领取后再投影”的顺序。Engine `claimInternal` 只更新 Action 的领取身份，不触发领域状态转换；推进后再领取时，TaskStatus 中的决定、阻塞和 warning 仍适用。最终业务任务、结果模板与独立会话上下文取自 claim 返回的 Run，`--details` 重新投影完整状态。这样可以保留原领取条件，而不为省一次投影增加另一套判断。回归覆盖重复调用不推进、warning 保留、独立上下文与 details 一致及多 Child 实际领取；两轴 Review 已复核该取舍。

## 回归映射

- Classic 完成闭包：`classic-openspec-command.test.ts` 的同次完成校验与缺失文件反例；`classic-artifact-requirements.test.ts` 的实时图复用、独立调用重查、越界反例。
- Classic Design：`classic-workflow-performance.test.ts` 的准备/提交各一次查询，下一条命令发现文件缺失；同文件的 owner/Git 调用预算。
- Native：`native-agent-checks.test.ts` 的 Shape 读取预算、重复会话不推进、Builder 到 Verify 单次响应、v4 无旧计划推导；原有审批、独立会话、未知任务断点恢复反例保留。
- Supervisor：`native-agent-supervisor-business.test.ts` 源码及生成 bundle 的真实 Git 子任务、集成修复、验收及归档；源码额外验证 Child validator 不查询父级目标 commit，以及真实待集成 Action 在目标分支缺失或分叉时写前拒绝、恢复目标后正常完成。
- 跨设备：`native-cli-v4-surface.test.ts` 的 copied portable state 无本地 Run 历史恢复；Classic worktree 与投影恢复相关回归另列执行结果。

旧代码证据：基线生成 bundle 的 Classic propose-design 实测为 5 次 OpenSpec status（单次样本 13.988 秒，其中子进程合计 12.086 秒）；Native Shape 初次 4 次/重复 2 次 checkpoint 读取，Builder 普通 next 两次 TaskStatus。新增的重复任务测试在修改 N2 前以“预期 1 次，实际 2 次”失败。时间收益须以实施后同样夹具测量为准。

## 性能测量

Windows、Node 22.20.0，对基线与生成 bundle 做三轮交替调用；每轮使用独立临时项目和数据目录，Open 批准仅属于测试夹具，不使用模型。计时包含进程启动与观察器开销，实际项目和 Agent 端到端收益仍需另外测量。期间存在其他定向检查负载，时间仅作本机参考，调用数量为主要确定性证据。

| 操作                                                 | 基线中位数       | 本轮中位数       | 确定性调用变化                                 |
| ---------------------------------------------------- | ---------------- | ---------------- | ---------------------------------------------- |
| Classic propose-design                               | 11,594 ms        | 5,568 ms         | OpenSpec status 5 → 2                          |
| Native 首次 Shape 领取                               | 670 ms           | 636 ms           | checkpoint 读取 4 → 3                          |
| Native 同会话再次 Shape next                         | 492 ms           | 461 ms           | checkpoint 读取 2 → 1                          |
| Native 重复 Builder next / Builder 回报后领取 Verify | 未做可靠时间对照 | 未做可靠时间对照 | TaskStatus 2 → 1，回归验证原 claim、会话和输出 |

三轮测量发生在最后的上下文共享与 OpenSpec 执行模块拆分之前。最终 Runtime 又以同样夹具做了一轮调用数量复查：Classic status 仍为 5 → 2，Native checkpoint 仍为 4 → 3、2 → 1；该轮 Native 重复调用计时为 540 → 569 ms，说明小型夹具的时间波动不能用来承诺 Native 端到端收益。原始计数和计时见[benchmark.json](2026-11-10-final-workflow-performance/benchmark.json)。

## 验证记录

- 主实施定向检查 5 文件 50 项通过；追加归档恢复后，Native 定义选择、状态恢复与任务流程 3 文件 51 项通过。
- 按登记的 11 个本轮 case ID 执行核心回归，合并为 4 组，共 20 项必过断言通过。包括源码/生成 bundle、真实 Git Supervisor、已归档冷恢复、活跃分支拒绝及独立会话。
- Native CLI copied portable state 无本地 Run 历史恢复 Build 的定向案例通过。
- Classic 分支绑定、布局与 Native/Classic 状态及停止恢复 6 文件初轮 145 项通过、2 项失败；其中一个是构建前缺少 dist 导致的夹具失败，构建后原选择器重跑通过。另一个文件符号链接案例在未修改基线上同样因 Windows EPERM 无法创建夹具，仍记为未完成，未删除或跳过该断言。
- 发布元数据、Runtime 资产、Skill 及发布检查器 8 文件 87 项通过、12 项按既有 Bash 可用性条件跳过；中英文同步后再运行相关契约，13 项通过、相同 12 项跳过。
- `pnpm build`、`pnpm lint`、`pnpm check:generated`、TypeScript、`pnpm format:check`、中英文 Skill 的显式 Prettier、SDK API/恢复快照、prepublish scan 均通过。lint 保留 9 条无关既有未使用变量警告。
- 完成 npm pack 与最终源码的 package E2E：0.5.3 在隔离 consumer 中安装、公开路由和 Codex Native 目标验证通过。脚本包含无模型 `eval --collect` 预览，并断言 `noModelsStarted`；没有启动模型或容器评估。一次与手动 pack 的 prepare 构建重叠造成的 dist 缺失已定位，待 pack 结束后单独重跑通过。
- 用 `verify:changed --base <基线> --plan --json` 核对影响范围；选择上述定向覆盖，没有执行 Native/Classic 整个 domain 或仓库全量测试。
- `origin/master` 已以远端 ref 核对仍为 `a61a2e5b4766e1ad62377dec598e402560a259b6` / 0.5.2，上一个发布 tag 为 0.5.2；当前 0.5.3 保持不变，Changelog 合并到同一版本条目。
- Standards 与 Spec 两轴 Review 修正后均无剩余发现；历史 badcase 来源和断言保留。

## 发布边界

仓库发布附加验收仍有历史 `eval-classic-hardest-includes-post-archive-repair` 待完成，`--require-acceptance` 按规定拒绝完整发布放行。没有 Eval 启动授权，因此未补跑模型或容器评估；没有执行真实平台 Hook 事件验收，也没有执行 npm publish、远端 push 或创建 Release。定向测试及包验证不替代这些证据。
