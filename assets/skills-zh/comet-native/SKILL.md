---
name: comet-native
description: 使用 Comet 自有 Native change、状态检查与自动推进，为强编码模型提供轻量但可恢复的需求到归档流程。
---

# Comet Native

先理解，再行动。Native 保存需求、完整目标规格、状态和证据；实现过程由模型自主判断，不照搬固定方法。它始终是一个轻入口：根据磁盘 phase 在同一个 Skill 内继续，不加载阶段 Skill，也不增加 Plan、TDD、Debug 或 Review 方法清单。

## 开始或恢复

`/comet-native` 是 Skill 入口，不是 shell 命令。通过宿主的 Skill 机制调用它；不要在 Bash 中执行 `/comet-native`。

先运行 Native `status` 和 `show`；恢复 Verify 或 Archive 时使用 `status <change-name> --details` 取得有预算的验收页、有界的详细 findings、`findingsTruncated` 标记和最新 checkpoint。若 findings 被截断，先处理已返回项，再重新读取 details；不能把未展示项当作不存在。若 `acceptancePage.nextCursor` 非空，继续按命令参考逐页取得剩余验收 ID。再读取 `comet.config.yaml`、`change.yaml`、brief、拟议完整规格、canonical 规格、仓库实现、项目规则和相关测试。磁盘与仓库事实优先于聊天记忆；能从环境得到的事实不要询问用户。

若 `status` 或 `show` 显示已有 active change，就继续该 change。用户回答澄清问题或补充约束后，重新读取它并更新原有 brief 与规格；不得为用户刚补充的答案创建第二个 change。只有磁盘事实证明没有 active change 时，才把用户目标归纳成 lowercase kebab-case 名称，再用 `comet native new <change-name> --language zh-CN` 创建 Native change。只使用配置指定的 `<artifact-root>/comet/`，不扫描或修改其他工作流目录。

命令与 runtime 定位见 [命令参考](reference/commands.md)，产物格式见 [产物参考](reference/artifacts.md)，中断与恢复见 [恢复参考](reference/recovery.md)。自带 runtime 位于 [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs)。

## 决策协议

维护“决策前沿”：只关注仍会显著改变范围、用户可见行为、兼容性、风险或不可逆性的未知决定。

在判定决策前沿为空前，主动检查主要分支、默认行为、边界条件、失败路径、兼容性约束和不可逆操作。对每个可能改变用户可见结果的分支，必须能从仓库事实、用户已给信息、明确非目标或已确认决定中得到唯一答案；不能得到唯一答案时，才把它视为用户决定并标记为 `[blocking]`。

先区分三类信息：

- **仓库事实**：代码现状、既有行为、项目规则、依赖约束和可运行的测试；先自行调查，不询问用户。
- **实现选择**：不同做法都满足同一用户可见结果时，由模型根据风险选择最简单可靠方案，不要求用户决定。
- **用户决定**：存在多个合理答案，且答案会显著改变范围、用户可见行为、兼容性、风险或不可逆结果；只有这类信息交给用户。

有这类决定时：

1. 一次只问最重要的一个问题，等待用户回答后再继续。
2. 同时给出推荐答案、简短理由，以及各选择会带来的实际影响。
3. 先问最上游、会影响后续问题是否成立的决定；回答后重新计算决策前沿，再决定是否需要询问下一个依赖问题。
4. 未得到必要决定前停在 Shape，不开始实现。

不存在高影响未知项时，不提确认题、通用偏好题或低价值问题，直接继续。brief 已经有文字不代表需求清楚；也不要为了覆盖检查清单而制造不存在的歧义。

## 推进契约

Shape、Build、Verify 的真实阶段 transition 会返回 `next: auto | manual`，并同时给出结构化 `continuation.disposition: continue | await-user | blocked | done`、所需输入和下一动作；这些字段共同构成机器可读 continuation 契约。`next: auto` 只表示当前状态已经成功推进，不代表宿主会在后台自动执行后续工作；Archive 不通过 `next` 推进，成功归档才返回 `disposition: done`。

收到 `next: auto` 且 continuation 为 `continue` 后，重新读取返回的 phase 和必要磁盘产物。没有用户决定或 Runtime 阻塞时持续推进，在同一个 `/comet-native` Skill 中执行下一阶段；不要结束工作等待用户再次触发，也不要把四个阶段拆成多个 Skill。若 continuation 为 `await-user`、`blocked` 或 `next: manual`，先根据磁盘事实和 blocking findings 修正；只有所需输入确实属于用户决定时才提问。只有显式的 `workspace-root-changed` 与 `workspace-inspection-unavailable` 是只读提示，不单独阻止继续或归档；未知 workspace finding、确定冲突、失效证据和修复停止仍必须处理。

长任务需要跨会话保留阶段内进度时，使用 `comet native checkpoint` 保存简短摘要、下一动作和真实产物引用。checkpoint 不推进 phase，也不替代 brief、规格或验证报告；不要创建额外的 resume、handoff 或任务清单。

## Shape

确认 Outcome、Scope、Non-goals、Acceptance examples、Constraints and invariants、Decisions、Open questions 和 Verification expectations。阻塞问题在 brief 中标记为 `- [blocking]`。

Shape 只有在满足冷启动可执行标准时才完成：另一个没有当前对话上下文的强模型，只读取 brief、完整目标规格、仓库事实和项目规则，就能在不猜测用户可见行为的情况下实现并验收。

理解达成一致后：

- 更新 `brief.md`，让它足以约束实现和验收；
- 用户明确给出的 lowercase kebab-case capability ID 必须原样保留，并用于 `specs/<capability>/spec.md`；若用户只给出自然语言显示名称，就在规格正文中原样保留显示名称，并稳定派生 lowercase kebab-case capability ID；不得悄悄替换用户明确给出的合法 ID；
- 若长期行为发生变化，在 `specs/<capability>/spec.md` 写完整目标规格，不写只描述增量的 patch；
- 删除长期 capability 时使用 `comet native spec remove <change-name> <capability>`；create/replace 和 canonical base hash 由 runtime 推断并冻结；
- 只有高影响决定刚由用户确认时才记录显式确认；仍未解决时保留 `[blocking]` 并停下。

随后提交可验证摘要并运行：

```text
comet native next <change-name> --summary <摘要>
```

如果摘要包含用户刚刚确认的高影响决定，追加 `--confirmed`。否则不加；`approval` 由 runtime 记录，不能手工修改。

## Build

选择满足 brief 与拟议规格的最简单可靠方案。实现方式、是否落盘计划、测试粒度、调试方法和审查强度都由模型根据风险自主决定。

不要为了遵守流程制造额外文档或步骤。若实现中发现需求或规格漂移，先更新 Native 产物。出现新的高影响用户决定时，把它标成 `[blocking]`，一次只问一个；用户回答后更新 Decisions、移除阻塞项，继续实现，并在离开 Build 时传 `--confirmed`。

完成后提供真实产物引用；没有代码变化时给出明确理由。然后运行：

```text
comet native next <change-name> --summary <摘要> --artifact <项目内路径> [--confirmed]
```

Runtime 会返回本次 implementation scope 和首个 `acceptancePage`。保留这些由 Runtime 派生的验收 ID；若响应丢失，进入 Verify 后用 `comet native status <change-name> --details` 重新取得。页内文字和 context 可能显式截断，但 ID 不会静默丢失；按 `nextCursor` 取完所有页，不自行计算 ID。

若 Runtime 无法证明 scope 完整，它会停在 Build 并返回 partial scope hash 与未归属项。先补充真实 artifact 或消除未归属变化；确实只能 partial 且用户需要接受该风险时，说明具体缺口并取得确认，再按命令参考使用同一个 scope hash、理由与 `--confirmed`。不能把 partial 静默写成 complete。

## Verify

根据 brief 的 Acceptance examples、完整目标规格和风险运行适当验证。记录实际命令、结果、跳过项、规格一致性、已知限制和结论，不把未运行的检查写成通过。

在 `verification.md` 的固定 acceptance evidence 块中，逐项使用 Runtime 返回的 `acceptance_id`：每项只能记录项目相对 evidence refs，或记录一个诚实的 `skipped_reason`。用户不维护 ID，模型也不从文本猜 hash；具体格式见产物参考。

需要一份窄而可重建的文本卫生证据时，可以显式运行内置只读文本扫描：

```text
comet native check <change-name>
```

它不调用 Git、shell、项目脚本或任何外部进程，只扫描当前 implementation scope/current snapshot 中受限数量的项目内普通文本文件，检查 conflict marker、行尾空白和 space-before-tab；symlink、越界、TOCTOU、hash/size 不匹配或预算超限都会失败关闭。扫描不修改项目文件、phase、Run 或 trajectory，但会在 Native evidence 目录写入独立的内容寻址 receipt。它不是通用命令执行器，也不替代模型按风险选择的测试。若该 check receipt 与最终结论相关，在 `next` 中追加返回的 `--receipt <ref>`；pass 只能绑定 fresh passed receipt。

验证通过或失败都写入 `verification.md`，再运行：

```text
comet native next <change-name> --summary <摘要> --result pass|fail --report verification.md [--receipt <ref>]
```

失败会回到 Build；先修复证据指出的问题，再重新验证，并用 `--failure-category` 与 `--failed-check` 提交稳定、非敏感的失败分类。Runtime 会先校验这些 failure facts，再写任何证据或 transition。相同失败第二次出现会告警，第三次且 scope 没有进展会停止；真实 implementation scope 变化会结束旧 repair episode 并直接解除停止。没有 scope 进展但有一个明确的新假设时，可按 status 返回的 signature 使用一次 `--override-repair` 和摘要；同一 signature 不得重复 override。单个 repair episode 达到语义上限时停止并请用户决定，不弱化检查或伪造 pass；通用 Run iteration 计数不会把长期 change 永久锁死。

进入 Archive 后若 brief、规格、实现 scope、报告或 receipt 发生变化，旧证据会变为 stale。按 Runtime continuation 受控回到 Build，重新封印 scope 与验证；不要手改 evidence ref 或沿用旧 pass。

## Archive

只有状态进入 Archive 且 Verify 为 pass 时，先预演：

```text
comet native archive <change-name> --dry-run
```

检查预演中的 create/replace/remove、证据新鲜度、当前 Native root 内可见的 change 重叠和恢复状态。没有阻塞时，使用预演返回的精确 hash 提交：

```text
comet native archive <change-name> --expect-preflight <sha256>
```

归档会在锁内重新计算相同事实；任何漂移都会拒绝，不复用旧 hash。成功后更新 canonical 规格，并把 change 移到日期前缀的 archive 目录。遇到 canonical 冲突时先重读并改写完整目标规格，再用 `comet native spec rebase <change-name> --summary <摘要>` 刷新基线并受控回到 Build 重新实现、确认和验证；不覆盖并发变化。未完成事务按恢复参考处理。

## 不变规则

- 不直接编辑 `phase`、`approval`、`spec_changes`、Run state、trajectory、锁或 transaction journal。
- 不跳过阶段检查；Shape、Build、Verify 用 `comet native next` 推进，Archive 使用 `archive --dry-run` 与 `archive --expect-preflight` 两步协议。
- 不调用外部 Skill；Native 主流程只依赖 Comet 自带 runtime。
- 不记录隐藏推理过程，只保存摘要、产物引用、命令结果、hash、状态变化和时间戳。
- 不把 token、密码、私钥、连接串或其他凭据写入摘要、理由与报告；Runtime 会对持久化的简短文本再次执行凭据形态脱敏，但这不是保存秘密的许可。
- 没有需要用户决定的阻塞点时持续推进；有阻塞点时只问一个最高价值问题并等待回答。
