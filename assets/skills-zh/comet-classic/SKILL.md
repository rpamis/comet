---
name: comet-classic
description: 'Comet Classic 工作流入口。当用户明确调用 /comet-classic、要求启动或恢复 Classic，或 resume-probe 返回可无歧义恢复的 active Classic change 时使用。'
---

# Comet Classic — OpenSpec + Superpowers

Classic 保留 Open → Design → Build → Verify → Archive 五阶段：OpenSpec 管理需求规格与归档，Superpowers 提供设计和已选工程方法。full 必须经过 brainstorming 和设计确认；hotfix/tweak 保持各自预设。

## 1. 确定目标与工作区

开始或恢复前按 `comet-classic/reference/classic-layout.md` 绑定逻辑根，并读取 `comet-classic/reference/scripts.md` 的“CLI 引导”章节，使用公开 Comet CLI 与 OpenSpec adapter。所有参考按当前动作读取相关章节，已加载且有效的协议不重读；不因引用一个文件而通读其余章节。

- 未明确调用 Classic、需要判定是否恢复已有工作时：读取 `comet-classic/reference/context-recovery.md` 的 Ambient Resume，按 `comet resume-probe . --stdin --json` 结果处理；只有 `auto_resume` 自动进入，`ask_user` 等待选择，`out_of_scope`/`none` 不进入。
- 启动新需求或目标 change 尚不明确时：读取 `comet-classic/reference/intent-frame.md` 的最小骨架与目标选择规则，获取活跃 change 后填写 CometIntentFrame，运行 `comet classic intent route --stdin`。`CometIntentFrame + runtime scorer` 是事实源，不另写自然语言 scorer。
- 已明确目标 change 时：按下方绑定工作区；多个 active changes 尚未选定时不提前绑定。

```bash
comet classic workspace resolve <change-name> --json
# 进入返回的 projectRoot 后选择 change
comet state select <change-name>
comet state next <name> --json
```

使用返回的 phase、configuration 和下一步路由。新 full change 交 `/comet-open`，由它完成工作区准备、OpenSpec artifacts 和 `.comet.yaml` 双初始化；已确认的 hotfix/tweak 分别交 `/comet-hotfix`、`/comet-tweak` 完成预设初始化。不直接调用 `/opsx:new`。已有 change 状态缺失时按 context-recovery.md 的“入口错误与恢复”核对 workflow 后恢复，格式异常时报告错误，不以产物存在推断阶段。

新 full change 的工作区决策发生在 Open 创建产物之前。full workflow 的 `isolation` 可为 `current`、`branch` 或 `worktree`；用户明确表达并行时准备 Worktree，其他选择按 `comet-classic/reference/workspace.md` 执行。hotfix/tweak 按各自初始化步骤确认并绑定工作区。恢复时以绑定工作区为准，分支归属变化必须显式 rebind。

## 2. 载入当前阶段

同一工作包复用这次结构化响应和已加载上下文；只有命令写入状态、切换工作区、恢复会话或发现外部变化时重新查询。按当前改动风险执行相关检查，Verify 保留一次覆盖最终实现的集成审查。

绑定工作区并取得 phase 后，读取并执行 [任务上下文与产物语言](reference/scripts.md#任务上下文与产物语言)，运行 `comet task`，使用渐进式 Context Manifest 和配置产物语言；只展开当前动作缺少的内容，真实回写采用结果并在结束时记录检查点。

| Runtime 路由或阶段            | 入口与职责                                            |
| ----------------------------- | ----------------------------------------------------- |
| 新 full / open                | `/comet-open`：澄清范围、创建必需产物、最终审视确认   |
| design                        | `/comet-design`：完成技术取舍并确认正式设计           |
| build + full                  | `/comet-build`：恢复配置/计划，完成任务与所需审查     |
| hotfix / build + hotfix       | `/comet-hotfix`：已有异常的局部修复                   |
| tweak / build + tweak         | `/comet-tweak`：单 change 轻量调整                    |
| verify                        | `/comet-verify`：真实验收、修复闭环、唯一最终集成审查 |
| archive / verify_result: pass | `/comet-archive`：确认归档、精确提交、完成已选交付    |

轻量路径只是新需求的建议：风险匹配且用户已明确选择时直接进入；自动推荐时说明匹配依据，并展示 hotfix/tweak 与保留 full 的选项及各自影响，等待用户确认。不静默降级已有 full change。公共 API、数据迁移、安全、并发或跨模块设计按实际风险处理，文件少不能豁免。

运行 hotfix/tweak 时必须读取所选预设的“升级判定”：命中质变信号或该预设的文件数提示阈值时，展示继续预设或升级 full 的选择并等待答复；用户选择升级后才运行 `comet state transition <name> preset-escalate`。`verify_mode` 只决定验证级别，不能替代 workflow 选择或预设升级确认。

恢复会话、外部状态变化、计划/任务/审查或交付不一致时，读取 `comet-classic/reference/context-recovery.md`，由当前阶段入口的 nextAction 定位未完成动作。有效配置和成果沿用；未勾选不等于未实现，阶段恢复规则不在入口重复维护。

## 3. 继续到本次授权工作的完成边界

阶段退出检查通过后，按 `comet-classic/reference/auto-transition.md` 消费成功结果的 `agent.continuation`，只加载其指向的下一 Skill；没有有效观察、冷恢复或外部变化时才重新查询。`auto_transition: false` 只控制 Skill 衔接，不改变 Guard 已推进的 phase；`NEXT: manual` 按 HINT 交还控制权，不追加确认。

决策点是阻塞点。首次需要向用户澄清或确认时，必须先读取 `comet-classic/reference/decision-point.md`，按其中的选项式提问、推荐理由、每项影响和 `AskUserQuestion` 优先规则执行；已在当前上下文中时直接复用。以下节点不能因“只有一个推荐方案”或自动衔接而跳过：

- 目标 change、PRD 拆分与工作区隔离尚有真实选择时，合并相邻问题并等待选择。
- Open 产物完成后的名称、范围与产物最终审视，以及 Design 的正式设计确认：先提供可审视结果，再等待批准或调整意见。
- Build 写计划前缺失或需修改的执行/TDD/review 配置；用户主动要求 `plan-ready` 暂停后，等明确继续指令再恢复。
- Verify 接受偏差、Spec 漂移或达到自动修复上限后的策略；Archive 的归档与交付选择。
- 预设升级，或 Build 出现范围扩张、重新设计与拆分取舍。

用户明确选择前，不写入依赖该决定的状态，不执行对应分支操作，也不跨越阶段 Guard。已有仍有效的授权与配置直接复用；范围内明确可修复的问题、补齐可验证状态和其他唯一合法下一步自动继续，不制造“是否继续”的停顿。

归档与交付方式合并为同一个最终确认，由 `/comet-archive` 核对授权、真实 Git 与所选交付状态。验证通过不代表归档授权；归档目录存在也不代表提交、push 或 PR 已完成。

## 始终保留的约束

- Runtime phase、Guard 和当前工作区绑定是流程事实源；文件与对话是核对证据，不用于手改 phase 绕过确认或验证。
- proposal 保存目标范围，spec 保存行为验收，唯一 design_doc 保存技术决策，plan 保存实施方法，tasks.md 保存完成状态。
- 遵循已确认的执行方式、TDD 和 review 配置；autonomous 不免除 full 的设计、计划、真实证据与独立审查。配置缺失或用户要求更改时由 Build 确认，不按模型名称静默替换。
- 未提交改动先按 `comet-classic/reference/dirty-worktree.md` 归因；只处理当前 change，保护无关改动。状态拒绝、路径越界、依赖不可用或归属不明时，读取 `comet-classic/reference/context-recovery.md` 的“入口错误与恢复”，报告原错误并执行对应恢复规则。
- 当前阶段发生异常时读取 `comet-classic/reference/debug-gate.md`，先调查再修复；测试/构建声明不替代真实执行，历史通过仅在 Runtime 确认仍有效时复用。

需要状态字段含义时读 `comet-classic/reference/comet-yaml-fields.md`；需要产物目录说明时读 `comet-classic/reference/file-structure.md`。其余参考只在上方触发条件满足时读取。
