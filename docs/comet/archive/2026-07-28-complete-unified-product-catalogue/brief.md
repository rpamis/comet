# Outcome

完成 Issue #173 最新技术方案的全部实现与验证，使最终分支真正具备统一的 `docs/comet/`、`docs/openspec/`、`docs/superpowers/` 产品目录，同时保留 Native 与 Classic 的独立所有权。修复首个 `unified-product-catalogue` change 在实现审查中暴露的安全、架构、迁移、Skill、Eval 和配置兼容缺口，并重新按完整规格而非局部补丁验收。

# Scope

- 保留已归档的 `unified-product-catalogue` change 与 canonical specs，不修改其历史证据；本 follow-up 以完整目标规格重新封闭实现缺口。
- 加固 Classic root move journal：只接受事务创建时推导出的项目内 source、target、staging、配置和事务身份，拒绝伪造路径、特殊对象、配置漂移和越界清理。
- 为 root move 增加完整 dry-run 报告、配置/树身份绑定、显式 continue/rollback 恢复，并让 doctor 输出和执行用户选择的恢复策略。
- 把跨 workflow 的项目配置类型、规范化和路径边界放回 `domains/workflow-contract/`；Classic、Native、Factory、Entry、Dashboard 与 Skill 安装不得各自重复解析或猜测路径。
- 让 Classic 所有读写入口在配置无效或 legacy/docs 双根冲突时失败关闭；只读 status/doctor 可以报告冲突，但不能静默回退 legacy。
- 修复 Factory 对 `native.artifact_root` 的未校验拼接、update 丢弃 `classic:` 未知字段、uninstall 跟随或删除特殊对象等兼容/安全问题。
- 将所有 Comet-owned 中英文 Skill、Rule 和 reference 中可复制的 OpenSpec 命令改为 `comet classic openspec -- ...`，固定物理路径改为 resolver 提供的逻辑根表达；不修改外部 OpenSpec / Superpowers 原始 Skill。
- 让当前 docs-layout Eval 真正执行 layout-aware 的完整 Classic 生命周期验证；保持冻结 baseline 逐字节不变。
- 补齐 Dashboard、Factory、Entry、state/guard、migration、uninstall、config merge 与 Skill 契约回归；同步 Classic / Entry 及受影响的 Native 生成 runtime。
- 保持版本为未发布的 `0.4.0-beta.10`，只维护最终用户可见的 Changelog 结果，不记录分支内修复过程。

# Non-goals

- 不重开、移动或手工修改已归档 change 的 phase、状态、trajectory、evidence 或 transaction。
- 不新增任意 OpenSpec / Superpowers 自定义路径；Classic 仍只支持 `legacy | docs`。
- 不使用 OpenSpec store registry，不修改外部 OpenSpec / Superpowers 原始 Skill。
- 不迁移 active Classic/OpenSpec change，不重写历史 handoff hash、Run、checkpoint、trajectory 或 archive evidence。
- 不合并 Native 与 Classic 的状态机、Guard、change schema 或 runtime。
- 不修改 `039-release`、`040-beta` 等冻结 Eval baseline。
- 不把已有 `website` 子模块脏状态纳入本 change。
- 不把 Issue #240 的 Native 验收机制增强混入本 change；统一目录提交并推送后再单独实现。

# Acceptance examples

- 伪造 root move journal，将 `source`、`target` 或 `staging` 指向项目外时，`doctor --repair` 在任何 rename/remove 前失败关闭，项目外文件保持不变。
- dry-run 返回 source、target、文件/字节/hash 摘要、配置变化、配置 hash、冲突、阻塞 change、历史证据不改写清单和可审计 plan identity；apply 只接受同一事实集。
- migration 在配置切换前中断时支持显式 continue 或 rollback；切换后只在事务契约允许时继续清理。doctor 不替用户猜策略，并报告 transaction id、阶段与允许策略。
- 任意 Classic 写入口（包括 state、Hook Guard、handoff、archive、OpenSpec adapter）遇到 legacy/docs 双根时均拒绝；只读 Entry status、Dashboard 和 uninstall 遇到无效配置时报告不可用，不猜 legacy。
- Factory 读取 `native.artifact_root: ../outside` 或绝对/特殊路径时复用共享规范化边界并拒绝，不在项目外寻找 workflow 文件。
- `comet update` 更新托管 Classic 字段后，`classic:` 内未知自定义字段和完整 `native:`、顶层未知字段保持原样。
- uninstall 遇到 symlink、junction 或其他特殊对象时保留对象并报告，不跟随目标、不递归删除。
- 在 docs 布局下，所有 Comet-owned 可复制 OpenSpec 命令使用 `comet classic openspec -- ...`；所有 change/tasks/spec/handoff 路径都以 resolver/逻辑根表达，不再教 Agent 使用物理 root `openspec/...`。
- docs-layout treatment 的 live validator 在完整 Classic 生命周期中断言 `docs/openspec`；legacy treatment 断言 root `openspec`；两者不会通过仅加载 fixture 获得成功。
- 对 Issue #173 最新方案逐条建立实现与测试证据；安全 P0/P1、未覆盖 MUST 或失败/跳过的必要检查均阻止交付。

# Constraints and invariants

- 实现基线是 Issue #173 于 2026-07-27 的最新技术方案，以及 canonical `unified-product-catalogue`、`classic-config-block`、`native-init-workspace-defaults` 完整规格。
- 原归档事务已 `committed` 且越过 `archive-finalization-started`；它不可回滚为 active change。
- 所有路径输入先规范化、验证为项目内相对路径，再做文件系统操作；journal 中的路径必须与当前事务按固定规则重新推导的值逐项相等。
- 跨 workflow 的稳定项目配置契约归 `domains/workflow-contract/`；Classic/Native 的状态机与领域行为继续独立。
- 配置指定唯一布局；不得扫描两个根并选择可用者。配置读取失败不是 legacy fallback。
- 新项目默认 docs、旧项目缺字段按 legacy、update 不迁移、显式 root move 才切换布局的现有产品决定不变。
- 中文 Skill 先完成并通过契约检查；依据用户已授权的最优推荐，随后同步等价英文内容，再写最终 Changelog。
- 修改 runtime 源码后重新生成发布资产；生成物只由构建产生。
- 最终验证按跨 app/domain/integration/dashboard/runtime/Skill/Eval 的高风险范围执行。

# Decisions

- 用户要求继续完成统一目录剩余问题，并在完成后提交全部代码并推送。
- 已归档 change 保持不可变；采用新的 `complete-unified-product-catalogue` follow-up change。
- follow-up 虽只追踪剩余代码差异，但 Verify 必须重新覆盖 Issue #173 的完整最终方案。
- 安全与规格缺口均视为必须修复；先处理路径穿越和共享边界，再迁移/消费者，再 Skill/Eval。
- 用户授权中途需要确认时采用最优推荐；本 change 不引入新的用户可见产品分支，继续使用已确认的 #173 最终行为。
- Issue #240 在本 change 提交并推送后作为独立 Native change 处理，并在完成后至少执行一次独立 code review。

# Open questions

- 无。

# Verification expectations

- 每个缺口先有能在当前实现上失败的聚焦回归，再实施最小修复并看到测试通过。
- 对 journal 路径穿越、配置漂移、symlink/junction、双根冲突、显式 continue/rollback、未知字段保留和 Factory 越界做负向测试。
- 对所有 Comet-owned 中英文 Skill/Rule/reference 运行全量固定路径与裸 OpenSpec 命令扫描，并由契约测试证明零遗漏。
- 对当前 docs-layout Eval 运行实际 validator；冻结 fixture/hash 检查保持通过。
- 构建并校验 Classic、Entry 与受影响 Native runtime；运行相关模块测试、lint、build、全量 Vitest、目标 Prettier 和 `git diff --check`。
- 最终独立规格/代码审查逐条核对 Issue #173 最新方案；任何 P0/P1 或未覆盖 MUST 均需修复后重审。
