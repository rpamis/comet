# 目标

当 Supervisor 的全部 Child 已完成可信集成时，由 Runtime 自动接回父级并推进到最终 Verify，避免父级静默停留在 Build、依赖用户再次发出“推进”指令。

# 范围

- Supervisor v2：最后一个 Child 从 `verified` 完成串行集成并变为 `integrated` 后，自动完成父级 Build 并进入最终 Verify。
- Supervisor v1 兼容：最后一个声明 Child 完成 Archive 且确实合入父级分支后，定位唯一父级并执行相同推进。
- 恢复路径：进程在 Child 完成与父级推进之间中断时，下一次恢复根据 Portable State、父子声明和 Git 事实幂等补做父级推进。
- Native Runtime 返回明确的父级推进结果和 continuation；Native Skill 自动切回父级并继续派发最终 Verifier。
- 用户可见输出明确告知父级已进入最终 Verify，并在 Verify 结束后继续遵循现有 Archive 确认和 workspace finish 策略。

# 非目标

- 不增加后台 daemon、文件 watcher 或常驻调度服务。
- 不因为 Child 完成而自动 Archive、合并、推送或创建 PR。
- 不放宽 Child `verified`、`integrated`、v1 Archive 合入事实或父级最终 Verify 的现有可信边界。
- 不把 Supervisor v1 的 `children.yaml` 或历史状态改写成 v2。
- 不自动解决父级歧义、分支不匹配、合并冲突或 repair blocker。

# 验收示例

- A1：Supervisor v2 最后一个 Child 成功集成后，同一次父级 Runtime 推进把父级从 `build` 转为 `verify`，返回自动推进结果和最终 Verifier continuation。
- A2：Supervisor v1 最后一个 Child 完成 `finish=merge` Archive 后，Runtime 只在唯一、已确认且分支匹配的父级全部 Child 均完成时自动进入 `verify`。
- A3：仍有 Child 处于 pending、ready、active、verified、blocked 或 needs-reverify 时，父级保持 `build`，不得提前进入最终 Verify。
- A4：进程在最后一个 Child 完成后、父级状态写入前中断，下一次恢复只补做一次父级推进，不重复集成、归档或创建候选。
- A5：父级已经处于 `verify`、`archive` 或 `done` 时，重复 Child 回报或重复恢复保持幂等，不创建第二个父级候选或 Verifier。
- A6：父级无法唯一解析、Child Archive 未合入父分支、绑定工作区不一致或存在 repair blocker 时，不猜测推进，并返回可见、可恢复的阻塞信息。
- A7：Native Skill 收到自动父级 continuation 后无需用户再次确认即切回父级并派发最终 Verifier；若宿主无法继续，父级至少已持久化为 `verify` 并显示明确下一步。
- A8：用户收到“全部 Child 已完成，Supervisor 父级正在进行最终验证”的明确通知；最终 Archive、merge、push 和 PR 行为仍遵循现有配置与用户授权。

# 约束与不变量

- Shape 的一次确认已经授权严格派生的 Child 和父级最终 Verify，因此自动接回不得新增用户确认点。
- 自动推进必须由 Runtime 基于 Portable State、`children.yaml`、Supervisor 状态和 Git 事实判定；Agent 摘要或完成消息不能单独触发。
- v1 父级解析优先使用分支绑定一致的权威工作区，忽略 detached 或 binding mismatch 的候选；无法得到唯一结果时阻塞。
- Child 完成与父级推进之间允许两个可恢复事务边界，但恢复后结果必须与一次连续执行一致。
- 父级最终 Verify 继续覆盖完整验收项，Child 局部检查不能替代父级检查。
- 中文 Skill 语义确认后同步英文 Skill，Native Runtime 源码修改后重建并检查生成资产。

# 决策

- 采用“Runtime 持久化推进 + Skill 自动消费 continuation”，不采用仅靠 Skill 提示词的弱保证。
- 同时覆盖 Supervisor v2 `integrated` 生命周期和 beta20 兼容读取的 active v1 独立 Archive 生命周期。
- 自动动作止于父级最终 Verify；Archive 和 workspace finish 不由 Child 完成事件触发。
- 采用单一 Native change，因为 v1/v2 入口最终共享同一个父级完成判定和状态转换，拆分会增加跨 Child 协调而没有独立交付价值。

# 待解决问题

无。用户已确认自动推进、同时覆盖 v1/v2，并保留最终 Archive 授权边界。

# 验证预期

- 为 v2 `supervisor-integrate`、v1 Child Archive finish、恢复与幂等路径增加 Runtime/CLI 回归测试。
- 覆盖部分 Child 未完成、父级歧义、未合入 Archive、binding mismatch、repair 和已进入后续阶段的拒绝或 no-op 行为。
- 更新中英文 Native Skill 契约测试，验证自动切回父级、通知和 Archive 边界一致。
- 运行受影响 Native 测试、Prettier、ESLint、TypeScript、Native runtime build/check；按跨 Runtime 风险在最终交付前运行全量测试。
