---
name: comet-native
description: 当用户明确调用 /comet-native、要求启动或恢复 Native change，或入口路由到 Native 时使用；负责澄清需求、读取状态并推动 Shape → Build → Verify → Archive。
---

# Comet Native

Native 保存需求、完整目标规格、状态和证据。你负责理解、实现和验证；Runtime 负责状态、边界和恢复。

整个流程在本 Skill 内完成。不要加载阶段 Skill，也不要强制套用 Plan、TDD、Debug 或 Review 方法。

## 需求澄清协议

从 `.comet/config.yaml` 读取 `native.clarification_mode`。允许值为 `sequential` 和 `batch`；字段缺失时使用 `sequential`。该配置只决定用户问题的组织方式，不改变 Native 的阶段、状态、Guard、安全确认或调用方停点。

先识别会改变用户可见结果、但尚未定义的分支。“规范化”“直观”“标准”“预期”等词不是产品契约；只有用户原话、用户确认的答案，或明确适用于当前行为的公开契约可以关闭这类分支。

仓库现状、依赖默认值、相邻功能和行业惯例只能支持推荐，不能代替用户决定。“保持现有行为”只约束已经存在的结果，不自动定义新行为。

先判断分支是否只影响实现方式，而不改变任何用户可见结果。不能证明这一点时，按用户决定处理。即使用户要求“不要询问实现选择”，也不能把产品决定重新归类为实现选择。

能从仓库、工具或运行环境查明的事实由你负责调查，不交给用户回答。宿主支持并行工作时，可以并行调查相互独立的事实，但不能把并行能力作为流程前提。尚未查清的事实只阻塞依赖它的问题，不阻塞其他已经具备条件的问题。

只有共同定义同一个用户决定的多个细节才合并为一道策略问题。彼此独立的用户决定不能合并：Sequential 模式逐轮处理，Batch 模式为每项分别编号。不要为了增加问题数量制造歧义，也不要把实现选择放入用户问题清单。若一道问题仍未覆盖同一决定的某种合理解释，应拓宽这道问题，而不是另造一个依赖关系不清的问题。

### 提问载体

提问前先检查当前宿主的工具列表。当前工具列表提供 `AskUserQuestion` 时，Claude Code 下优先使用它展示结构化选项；其他宿主使用等价的用户输入工具。每个选项都要有简短标签和影响说明，推荐项在说明中标明，但不能自动代用户选中。

- Sequential 模式每轮提交一道结构化问题。选项互斥时使用单选；只有同一个用户决定本身允许同时选择多个彼此兼容的选项时，才使用多选。不能用一道多选题压缩多个独立的用户决定。
- Batch 模式在整组问题都能满足当前工具的问题数、选项数和字段限制时，把本轮整组问题放在同一次调用中。不能把同一轮拆成多次工具调用，让后面的问题在用户回答前无法同时展示。
- 当前宿主没有结构化提问工具，或 Batch 整轮无法在一次调用中完整表达时，整轮使用编号文本降级模式。文本必须保留相同的问题、选项、推荐和影响，然后停止并等待用户回复编号。
- 若第一次调用失败或宿主报错，判定本会话结构化提问不可用，当轮改用文本降级模式，本会话后续不再重试。工具调用成功后直接等待用户作答，不再同时输出一套重复的文本问题。

### Sequential 模式

发现用户决定后：

1. 在 brief 中记录一个 `[blocking]` 问题。
2. 一次只问最上游的一个问题。
3. 给出“问题 / 推荐 / 影响”，然后结束本轮。

没有用户决定时直接继续，不增加通用的最终确认。

### Batch 模式

把尚未确定的用户决定按前置关系组织起来。只需要维护可复核的未决事项、依赖摘要和正式产物，不保存隐藏推理或完整内部推演。

每轮计算“本轮可回答问题集”：其中每个问题的前置决定都已确定，所需环境事实也已查清，并且答案不依赖本轮其他问题。依赖仍未确定决定或调查中事实的问题留到后续轮次。

对本轮可回答问题集执行以下步骤：

1. 在 brief 的 Open questions 中使用 `- [blocking] Q1: <问题>`、`- [blocking] Q2: <问题>` 的固定格式分别保存各题；不要使用 Markdown 有序列表代替该前缀。
2. 一次提出整组问题，并为每题给出“问题 / 推荐 / 影响”。编号应允许用户用“1 按推荐，2 选择 B”这类方式回答。
3. 更新正式产物并提出问题后结束本轮，不进入 Build，也不调用 `next`。

使用以下格式：

```text
1. 问题：……
   推荐：……
   影响：……

2. 问题：……
   推荐：……
   影响：……
```

用户回答后，把已确认内容写入 Decisions 和完整目标规格，移除对应 `[blocking]`；没有回答或回答不明确的问题继续保持 `[blocking]`，不得按推荐项自行补全。随后根据新答案重新计算本轮可回答问题集，逐轮处理新出现的分支。

当本轮可回答问题集为空、相关事实已经查清且所有已识别用户决定均已处理时，执行一次完整性复核，重新检查是否仍有未处理或被静默假设的用户可见分支。向用户给出包含目标、范围、关键决定、验收标准和明确非目标的共享理解摘要，并在 brief 中使用 `- [blocking] CONFIRM: <确认内容>` 记录最终确认。用户明确确认前，不进入 Build，也不调用 `next`；用户补充或否定时，更新相应分支并继续下一轮。明确确认后，移除该阻塞项、记录确认，并按正常 transition 推进。

以文本“规范化”为例，一个完整问题应同时说明大小写折叠、外围标点、内部标点或撇号保留，并用反例展示不同选择的输出。

达成共享理解前，可以调查仓库事实、创建或恢复 Native change，并在 brief 中记录 `[blocking]`。不要进入 Build、修改项目实现或调用 `next`。

用户回答后，更新原有 change 的 brief 和完整目标规格，再重新检查是否还有用户决定。不要为补充答案创建第二个 change，也不要把未确认选项写成既定规格。

离开 Shape 时，只有本轮刚记录了用户对既有阻塞问题的确认，才给 `next` 传 `--confirmed`。Batch 模式的最终共享理解确认属于这类确认；用户最初提出需求不算。

若调用方要求在该 transition 后停下或切换会话，严格执行以下序列：更新正式产物 → 调用一次允许的 transition → transition 成功后不再调用工具 → 输出约定标记并结束本轮。即使 Runtime 返回 `continuation.disposition: continue`，也不能越过这个停点。

## 执行边界与状态快照

调用方指定停点时，只完成停点前允许的工作。下一会话重新调用 `/comet-native`，从磁盘读取 status、selection 和正式产物后继续，不依赖聊天记忆恢复进度。

调用方若要求保留某次状态变化前的 Runtime 返回快照，应在执行该状态变化之前，使用真实命令的机器可读模式，并通过重定向直接保存标准输出。快照确认完整后不得重建、刷新或覆盖；它只反映生成时的真实状态，不能根据最终结果补写。

## 开始或恢复

`/comet-native` 是 Skill 入口，不是 shell 命令。通过宿主的 Skill 机制调用；不要在 shell 中执行 `/comet-native`。

先运行 Native `status` 和 `show`。恢复 Verify 或 Archive 时，运行 `status <change-name> --details`，读取有预算的验收页、详细 findings、`findingsTruncated` 和最新 checkpoint。

- findings 被截断时，先处理已返回项，再重新读取 details。
- `acceptancePage.nextCursor` 非空时，按命令参考继续分页。
- 随后读取 `.comet/config.yaml`，确定 `native.clarification_mode`，再读取 `comet-state.yaml`、brief、拟议规格、canonical 规格、仓库实现、项目规则和相关测试。
- 磁盘与仓库事实优先于聊天记忆；能从环境取得的事实不要询问用户。

已有 active change 时，先只读确认哪个 change 对应当前目标。确认后显式运行：

```text
comet native select <change-name>
```

该命令建立项目级共享 selection。不要新增 `resume` 命令，也不要依赖 `status` 或 `show` 的读取副作用建立归属。

存在多个 active change，且 selection 不能唯一确定目标时，让用户选择。只有磁盘事实证明没有 active change 时，才把目标归纳为 lowercase kebab-case 名称并创建：

```text
comet native new <change-name> --language zh-CN
```

只使用配置指定的 `<artifact-root>/comet/`，不扫描或修改其他工作流目录。

命令与 Runtime 定位见[命令参考](reference/commands.md)，产物格式见[产物参考](reference/artifacts.md)，中断与恢复见[恢复参考](reference/recovery.md)。自带 Runtime 位于 [scripts/comet-native-runtime.mjs](scripts/comet-native-runtime.mjs)。

项目只安装一份 Comet 工作流 Rule；支持 Hook 的平台只安装一个 `comet-hook-router.mjs`。Rule 与 Router 根据 `.comet/config.yaml` 和 `.comet/current-change.json` 确定当前 workflow，一次写入最多路由给一个 Guard。

当前 change 属于 Native 时，只应用 Native 的 Shape、Build、Verify、Archive 边界。不要同时运行 Native 与 Classic Guard，也不要用默认 workflow 猜测当前 change 的归属。Native 主流程不依赖任何外部 Skill。

## 决策协议

维护一份未决事项清单，按依赖顺序处理仍没有唯一答案的用户可见分支。重点检查：

- 输出与默认行为；
- 边界条件与失败结果；
- 范围、风险和不可逆操作；
- 明确适用于当前行为的已有约束。

把关键名词或动作改写成可区分解释的“输入 → 输出”或“触发 → 结果”示例。一个反例能区分两种合理解释，就说明仍需用户决定。

文本或 token 行为通常要检查大小写、首尾与内部标点、空白、Unicode、空输入、重复项、顺序和并列结果。CLI 或 API 行为通常要检查默认值和错误结果。不要为了覆盖清单制造不存在的歧义。

只有用户给出的信息、明确非目标、已确认决定，或当前能力的明确公开契约可以消除分支。发现阻塞后，按需求澄清协议为当前模式计算并提出一个问题或本轮可回答问题集；回答前不要调用 `next` 或修改项目实现。

当未决事项清单为空，且仅凭 brief、完整目标规格、仓库事实和项目规则就能实现并验收，Sequential 模式直接继续；Batch 模式先完成最终共享理解确认。

## 推进契约

Shape、Build、Verify 的 transition 会返回 `next: auto | manual`，以及 `continuation.disposition: continue | await-user | blocked | done`、所需输入和下一动作。Archive 不通过 `next` 推进；成功归档才返回 `done`。

这些字段组成机器可读的 continuation 契约。`next: auto` 只表示当前 transition 已成功，不代表宿主会在后台执行后续工作。

收到 `next: auto` 且 disposition 为 `continue` 后，重新读取返回的 phase 和必要产物。没有用户决定或 Runtime 阻塞时，在本 Skill 内持续推进下一阶段，不等待用户再次触发。

若 disposition 为 `await-user`、`blocked` 或 `next: manual`，先根据磁盘事实和 blocking findings 处理。只有缺少的输入确实属于用户决定时才提问。

Batch 模式中尚未回答的问题和最终共享理解确认都保持为 `[blocking]`。它们是需要等待用户输入的正常停点，不改变 continuation 契约，也不能通过自动推进绕过。

`workspace-root-changed` 与 `workspace-inspection-unavailable` 是只读提示，不单独阻止推进或归档。未知 workspace finding、确定冲突、失效证据和 repair stop 必须处理。

长任务需要保留阶段内进度时，使用 `comet native checkpoint` 保存简短摘要、下一动作和真实产物引用。checkpoint 不推进 phase，也不替代 brief、规格或验证报告；不要另建 resume、handoff 或任务清单。

## Shape

确认并写入：Outcome、Scope、Non-goals、Acceptance examples、Constraints and invariants、Decisions、Open questions、Verification expectations。阻塞问题在 brief 中标记为 `- [blocking]`；Batch 模式可以同时保存本轮全部可回答问题。

只有当 brief、完整目标规格、仓库事实和项目规则足以让后续执行者在不猜测用户可见行为的情况下实现并验收，Shape 才算完成。

- 更新 `brief.md`，使其能够约束实现与验收。
- 用户明确给出的 lowercase kebab-case capability ID 必须原样用于 `specs/<capability>/spec.md`。
- 用户只给出显示名称时，在正文保留原名，并稳定派生 lowercase kebab-case capability ID。
- 长期行为发生变化时，写归档后的完整目标规格，不写增量 patch。
- 删除 capability 时运行 `comet native spec remove <change-name> <capability>`；operation 和 canonical base hash 由 Runtime 推断并冻结。
- 仍有未决事项时保留 `[blocking]` 并停下。

准备完成后运行：

```text
comet native next <change-name> --summary <摘要>
```

仅在本轮刚记录用户对既有阻塞问题的确认时追加 `--confirmed`；Batch 模式必须先取得最终共享理解确认。Runtime 会把 approval 绑定到当时的 brief/spec contract hash；若 Build 中 contract 发生变化，先取得用户对当前 contract 的确认，再按 status 返回的命令重试。不要手工编辑 `approval` 或 `approved_contract_hash`。

## Build

选择满足 brief 与拟议规格的最简单可靠方案。实现方式、是否保存计划、测试粒度、调试方法和审查强度由你根据风险决定。

不要为流程制造额外文档。发现需求或规格漂移时，先更新 Native 产物；出现新的用户决定时标记 `[blocking]`，按当前配置的澄清协议处理。Batch 模式需要重新计算问题集，并在继续实现前取得更新后共享理解的最终确认。

完成后提供真实项目产物；没有代码变化时给出明确理由。然后运行：

```text
comet native next <change-name> --summary <摘要> --artifact <项目内路径> [--confirmed]
```

没有代码变化时按命令参考使用 `--no-code-reason`。Runtime 会返回 implementation scope 和首个 `acceptancePage`；保存 Runtime 派生的验收 ID，并按 `nextCursor` 读取全部页面。不要自行计算 ID。

Git 快照只包含 tracked 和未被 ignore 的 untracked 文件，submodule/gitlink 作为原子条目。非 Git 项目使用有界物理树快照。

- `git-selection-changed`：等待 Git 写入稳定后重试，不能授权为 partial scope。
- `git-enumeration-limit`：先缩小或清理项目所有范围；只有 Runtime 返回可授权 scope，且用户接受未枚举尾部的具体风险时，才能使用 partial 协议。
- `physical-selection-changed` 或 `physical-enumeration-limit`：等待文件系统稳定或缩小项目树后重试，不能授权为 partial scope。

Runtime 无法证明 scope 完整时会停在 Build，返回 partial scope hash 和未归属项。先补充真实 artifact 或消除未归属变化。确实只能接受 partial 时，说明具体缺口并取得用户确认，再使用同一个 hash：

```text
--allow-partial-scope <sha256> --partial-reason <理由> --confirmed
```

不要手改 snapshot、evidence 或猜测未枚举路径，也不要把 partial 写成 complete。

## Verify

根据 Acceptance examples、完整目标规格和风险运行验证。记录实际命令、结果、跳过项、规格一致性、已知限制和结论；未运行的检查不能写成通过。

在 `verification.md` 的固定 acceptance evidence 块中逐项使用 Runtime 返回的 `acceptance_id`。每项只能记录项目相对 evidence refs，或记录诚实的 `skipped_reason`。格式见产物参考。

需要一份可重建的文本卫生证据时，可运行内置只读检查：

```text
comet native check <change-name>
```

该命令只扫描当前 implementation scope/current snapshot 中有界的项目内普通文本文件，不调用 Git、shell、项目脚本、外部进程或外部 Skill。它不会修改项目文件、phase、Run 或 trajectory；结果写入内容寻址 receipt。它不替代按风险选择的项目测试。

写完报告后运行：

```text
comet native next <change-name> --summary <摘要> --result pass|fail --report verification.md [--receipt <ref>]
```

fail 会回到 Build。修复后重新验证，并用 `--failure-category` 与 `--failed-check` 提交稳定、非敏感的失败事实。

同一失败第二次出现会告警；第三次且 scope 没有进展会停止。scope 发生真实变化会结束当前 repair episode。scope 未变化但有明确新假设时，可按 status 返回的 signature 使用一次 `--override-repair`；同一 signature 不得重复 override。达到停止条件后请用户决定，不要弱化检查或伪造 pass。

进入 Archive 后，brief、规格、implementation scope、报告或 receipt 发生变化会使证据失效。按 Runtime continuation 回到 Build，重新封印 scope 并验证；不要沿用失效的 pass。

## Archive

状态进入 Archive 且 Verify 为 pass 后，先预演：

```text
comet native archive <change-name> --dry-run
```

检查 create/replace/remove、证据新鲜度、当前 Native root 内的 change 重叠和恢复状态。没有阻塞时，用本次预演返回的精确 hash 提交：

```text
comet native archive <change-name> --expect-preflight <sha256>
```

调用方要求保存预演或提交 envelope 时，首次调用本身就使用机器可读模式并写入目标文件。提交使用已保存预演中的 hash；文件验证成功后保持不可变，不得在归档后重跑命令覆盖。

Runtime 会在锁内重新计算事实，发生漂移就拒绝提交。成功后更新 canonical 规格，并把 change 移入日期前缀的 archive 目录。

遇到 canonical 冲突时，重读并改写完整目标规格，再运行 `comet native spec rebase <change-name> --summary <摘要>`。该命令会受控回到 Build；随后重新实现、确认、验证和归档。未完成事务按恢复参考处理。

## 不变规则

- 不直接编辑 `phase`、`approval`、`spec_changes`、Run state、trajectory、锁或 transaction journal。
- 不跳过阶段检查。Shape、Build、Verify 使用 `comet native next`；Archive 使用两步预演与提交。
- 不调用外部 Skill。Native 主流程只依赖 Comet 自带 Runtime。
- 不保存隐藏推理，只保存摘要、产物引用、命令结果、hash、状态变化和时间戳。
- 不把 token、密码、私钥、连接串或其他凭据写入摘要、理由与报告。
- 没有用户决定或 Runtime 阻塞时持续推进；有用户决定时，Sequential 模式只问一个最上游问题，Batch 模式询问本轮全部可回答问题，随后等待回答。
