# Outcome

为 Comet Native 增加基于 acceptance gap 的最小完成循环：Agent 可以分批实现，Runtime 在 Verify 失败后把未满足项稳定回灌 Build，直到完整验收通过、需要用户决定或达到停止条件。

# Scope

- Build 的详细状态分页暴露完整 acceptance 集和上一轮失败/缺失状态。
- Verify 失败从已校验的 acceptance matrix/envelope 派生缺口，并通过 continuation 明确要求先修复这些缺口。
- 停滞判断使用 contract 与语义缺口，不把单纯代码变化当作进展。
- 复用现有 Build ↔ Verify、checkpoint、trajectory、repair、resume、#240 类型化证据与 #238 归档确认配置。
- 更新中英文 Native Skill、Runtime 生成资产、回归测试和真实生命周期 Eval。

# Non-goals

- 不新增第五个 phase、独立 Loop Engine、新 CLI 命令、Goal 状态文件或外部 Skill 依赖。
- 不让 checkpoint、Agent 自述或同一 Agent 的复核替代 Runtime acceptance matrix、类型化 receipt 或独立 review。
- 不在 Verify 失败的中间循环触发 Archive preview 或归档确认。
- 不让 Loop 覆盖或改写 `native.archive_confirmation`。

# Acceptance examples

- Build 中执行 `status <change> --details` 时，可以按现有 cursor 契约分页读取完整 acceptance 集。
- Verify 返回 failed/missing acceptance 后，change 回到 Build，continuation 指向修复缺口，而不是立即再次推进。
- 只修改实现但 failed acceptance IDs 和 failed check IDs 不变时，不重置停滞计数。
- 缺口减少、失败检查转绿或缺失证据变为有效证据时，Runtime 记录语义进展。
- 相同语义缺口第三次出现时停止，并保留一次受约束的显式 override。
- 最终 Verify pass 后才进入 Archive；`automatic` 自动归档，`required` 只在最终候选处产生一次 `await-user`。
- 归档等待不增加 Verify-fail 次数，也不消耗 repair/loop 预算。

# Constraints and invariants

- Runtime 是是否完成、缺口集合和停止条件的唯一权威；自由文本任务清单不能替代已校验 matrix/envelope。
- acceptance/status/continuation 输出必须有预算、可分页，并跨 Windows、macOS、Linux 保持稳定。
- 普通 implementation scope 变化不能重置同一 contract 的总失败预算；只有用户确认后的 contract 变化开始新目标周期。
- 同一 contract 最多允许 5 次 Verify fail；项目可通过 `.comet/config.yaml` 的 `native.max_verify_failures` 配置正整数覆盖值，字段缺失时默认 5。
- #240 signed-v2 证据、独立 review 和 Archive freshness fence 保持不变。
- #238 的 `native.archive_confirmation` 是归档交互策略的唯一来源。

# Decisions

- 复用现有四阶段状态机和 Build ↔ Verify resolver，不增加独立循环阶段或引擎。
- Agent 每轮只处理一小批相关 acceptance，并用现有 checkpoint 保存恢复信息；checkpoint 不构成完成证据。
- 重复失败签名由 `contractHash + failed acceptance IDs + failed check IDs` 构成。
- 相同缺口第二次 warning，第三次停止；scope 无进展时同一 signature 最多一次显式 override。
- contract 级 Verify-fail 上限默认为 5 次，并由 `native.max_verify_failures` 配置；达到上限即停止，且重复缺口的第三次停止条件可以更早生效。
- Loop 只在最终 Verify pass 后读取 #238 归档策略，中间失败轮次不进入 Archive。
- 不使用任何 Superpowers Skill、TDD Skill 或其他外部 Skill。
- 用户已确认按当前 brief 和完整目标规格实现 #242。

# Open questions

- 无。

# Verification expectations

- 覆盖 Build acceptance 分页、Verify 缺口回灌、语义进展/停滞、第三次停止、单次 override 和 contract 总预算。
- 覆盖“遗漏 spec → 回 Build 修复 → 再 Verify → Archive”的真实 Native 生命周期 Eval。
- 覆盖 `automatic` 无人值守归档与 `required` 最终单次 `await-user`，并证明中间循环不触发归档确认。
- 运行受影响 Native 测试、生成资产一致性检查、lint、build，并按跨 Runtime 风险执行全量测试。
