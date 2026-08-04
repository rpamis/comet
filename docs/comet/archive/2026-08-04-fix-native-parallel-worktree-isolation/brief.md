# Outcome

Native 并行使用多个 change 或 worktree 时，Ambient Resume 只深度检查当前明确目标，不再因未选中的其他 change 重复扫描 Runtime 产物、消耗上下文或暴露无关错误。

# Scope

- 将 Native Ambient Resume 的候选发现与目标健康检查分离。
- 候选发现只读取有界的 change 名称和状态文档，不读取候选 change 的 Runtime、brief、spec、evidence 或 repair 产物。
- 根据用户明确提到的 change、项目 selection 或唯一活动 change 确定目标后，只对该目标执行完整恢复检查。
- 保持多个活动 change 时要求明确名称或 selection 的现有安全语义。

# Non-goals

- 不改变 Native implementation scope、Archive 冲突雷达或 canonical spec 冲突规则。
- 不把同一工作目录中的并发写入变成安全操作；真正并行的源码修改仍应使用独立 worktree。
- 不自动归档、提交或删除其他 change。
- 不从另一个 worktree 执行或复制项目级 Runtime 资产。

# Acceptance examples

- 同一 Native 根目录存在多个 change 且已选择 `login-flow` 时，普通恢复请求只完整检查 `login-flow`；其他 change 缺少或损坏的 Runtime 产物不会成为本次恢复错误。
- 同一 Native 根目录存在多个 change 且没有 selection 时，恢复请求返回需要选择 change，不先对所有 change 执行完整状态检查。
- 用户明确说“继续 cache-controls”时，只完整检查 `cache-controls`，即使另一个活动 change 处于不同阶段。
- 只有一个活动 change 时仍可自动识别，并在完整目标检查通过后进入 `/comet-native`。
- 目标 change 自身的状态、brief、spec 或 Runtime 产物无效时仍然失败关闭，并返回该目标的真实阻塞原因。

# Constraints and invariants

- 候选目录枚举继续遵守现有路径保护、数量上限和符号链接拒绝规则。
- selection 只用于确定目标，不因只读探针产生写入副作用。
- 不降低选中目标的完整状态与产物校验强度。
- Native 与 Classic 的恢复和 Guard 状态保持独立。

# Decisions

- 将“发现有哪些候选 change”视为轻量索引操作，将“该 change 是否可安全恢复”视为只针对目标的深度检查。
- 显式提到的 change 名优先于项目 selection；无显式名称时使用有效 selection；仅有一个活动 change 时才推断目标。
- 未选中的 change 即使状态文档不可解析，也只在候选中标记为 `invalid`，不污染已明确目标的恢复结论。

# Open questions

无。

# Verification expectations

- 增加 Ambient Resume 回归测试，证明多 change 场景不会读取未选中 change 的 Runtime 目录。
- 覆盖显式名称、有效 selection、无 selection 多 change、唯一 change 和目标自身无效。
- 运行受影响的 Entry/Native 定向测试、相关 lint 与 build；Runtime 生成物同步后验证资产一致性。
