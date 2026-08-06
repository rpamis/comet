# Outcome

当用户在 Native change 的 Verify 或 Archive 阶段提出继续修改项目实现的请求时，Comet 必须提供一条可审计的返回 Build 路径。系统保留非 Build 阶段的项目写入保护，但不再让 Agent 只得到“计划外文件不可修改”的终止结果。

# Scope

- 为 `comet native next` 增加显式 `--return-to-build` 选项，用于用户确认后的 Verify/Archive → Build 返回。
- 返回 Build 时清理已经失效的 implementation scope、verification evidence、partial allowance 和 verification result，同时保留 change、baseline、workspace 与分支绑定。
- 区分当前 change 的范围扩展、实现层面的新增 artifact 和与当前 change 无关的新请求。
- 更新 Native Hook Guard 的恢复提示，使被阻止的项目写入能指向可执行的恢复动作。
- 同步中英文 Native Skill、命令参考、Runtime 源码、生成 bundle 和回归测试。

# Non-goals

- 不允许通过用户请求绕过 Verify/Archive 的 Hook Guard。
- 不为每个项目文件增加 Verify 阶段的逐文件放行规则。
- 不把无关请求静默混入当前 change，也不改变 Classic workflow 的状态机或 Guard。
- 不使用伪造的 Verify fail、手工编辑状态字段或手工重写证据引用来返回 Build。

# Acceptance examples

1. 当前 change 在 Verify，用户要求修改一个未列入原 artifact 的项目文件，Agent 先判断其是否属于当前目标，不直接执行项目写入；确认属于当前 change 后，通过 `--return-to-build` 返回 Build，修改文件并在 Build transition 中声明 artifact，随后重新 Verify。
2. 用户请求改变当前 change 的用户可见行为、验收标准或非目标时，系统先记录范围变化并要求重新确认；确认后返回 Build，contract hash 变化会要求新的 Build 确认。
3. 用户请求与当前 change 无关时，系统保留当前 change 和已有证据现场，不把新请求写入当前 change，并引导创建独立 Native change/worktree。
4. 当前 change 在 Build 时新增项目文件，Hook Guard 不因文件未出现在上一轮计划中而提前拒绝；离开 Build 时，未声明文件会形成未归属范围并阻止 Verify，补充 artifact 后才能形成完整 scope。
5. Verify pass 后已进入 Archive、但尚未完成归档时，用户要求继续实现，系统仍可通过显式返回 Build 清理旧验证结论并重新收敛。

# Constraints and invariants

- `--return-to-build` 只能作用于 Verify 或 Archive，且不能与 Verify 结果、报告、artifact 或 partial-scope 参数混用。
- Runtime 必须通过 mutation lock、revision/CAS、Run state 和 transition journal 完成返回，不允许 Skill 或 Agent 直接编辑受管状态。
- 返回 Build 不计入 Verify failure 或 repair failure；原有 Workspace、baseline 和 current selection 绑定必须保留。
- 如果 brief/spec 改变，Build 必须继续执行 contract hash 和共享理解确认约束。
- Native 主流程不依赖外部 Skill；生成 bundle 必须来自 Runtime 源码。

# Decisions

- 使用现有 `comet native next` 增加显式 `--return-to-build`，不新增独立 CLI 子命令。
- Verify/Archive 的普通项目写入仍然 fail closed；恢复动作由 Agent 先判断归属，再调用 Runtime 返回 Build。
- 同一目标的必要实现补充继续使用当前 change；无关需求使用独立 change/worktree；无法判断时由用户决定归属。
- 仅实现范围变化不自动要求新的用户可见确认；brief/spec 或验收契约变化时由 contract hash 强制重新确认。
- 中文 Skill 与中文产物先完成，英文 Skill 和命令参考随后同步相同语义。

# Open questions

无。用户已确认按上述方案实现。

# Verification expectations

- 覆盖 Verify/Archive 显式返回 Build、参数互斥、状态清理、revision/journal、workspace 保留和失败预算不变。
- 覆盖 Hook Guard 的阻止与恢复提示、Build 未归属 artifact 的范围阻断、补充 artifact 后重新 Verify。
- 覆盖中英文 Skill/命令参考契约、Native Runtime 生成资产和完整 Native 生命周期。
- 运行受影响 Native 测试、Native Runtime 构建、lint/build，并在交付前运行全量测试。
