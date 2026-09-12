---
name: comet-classic
description: 'Comet Classic 工作流入口。当用户明确调用 /comet-classic、要求启动或恢复 Classic，或 resume-probe 返回 auto_resume、确认唯一可恢复的未归档 Classic change 时使用。'
---

# Comet Classic — OpenSpec + Superpowers

Classic 分为 Open → Design → Build → Verify → Archive 五个阶段。OpenSpec 管理需求规格与归档，Superpowers 提供设计方法，以及用户选定的规划、执行和审查方法。完整流程（full）必须经过 brainstorming 和设计确认；hotfix/tweak 使用各自的预设步骤。

## 1. 确定目标与工作区

开始或恢复前，按 `comet-classic/reference/classic-layout.md` 确定各产物目录对应的逻辑路径，并读取 `comet-classic/reference/scripts.md` 的“CLI 引导”章节。调用公开的 Comet CLI，通过 OpenSpec 适配器执行相关命令。所有参考按当前动作读取相关章节；已在上下文中且仍有效的规则不重复读取，也不因引用一个文件而通读其余章节。

- 未明确调用 Classic、需要判定是否恢复已有工作时：读取 `comet-classic/reference/context-recovery.md` 的 Ambient Resume，按 `comet resume-probe . --stdin --json` 结果处理；只有 `auto_resume` 自动进入，`ask_user` 等待选择，`out_of_scope`/`none` 不进入。
- 启动新需求或目标 change 尚不明确时：读取 `comet-classic/reference/intent-frame.md` 的最小示例与目标选择规则，获取未归档的 change 列表后填写 CometIntentFrame，运行 `comet classic intent route --stdin`。Agent 只负责按证据填写意图字段，路由由 Runtime 计算；以返回结果为准，不另写一套自然语言评分规则。
- 已明确目标 change 时：按下方绑定工作区；有多个未归档的 change 且尚未选定时，不提前绑定。

```bash
comet classic workspace resolve <change-name> --json
# 进入返回的 projectRoot 后选择 change
comet state select <change-name>
comet state next <name> --json
```

根据返回的 phase、configuration 和下一步路由继续。新 full change 交 `/comet-open`，由它准备工作区，并创建 OpenSpec 产物和 `.comet.yaml` 状态文件；已确认的 hotfix/tweak 分别交 `/comet-hotfix`、`/comet-tweak`，按各自预设完成初始化。不直接调用 `/opsx:new`。已有 change 缺少状态文件时，按 context-recovery.md 的“入口错误与恢复”核对 workflow 后恢复；文件格式异常时报告错误，不根据现有产物猜测阶段。

新 full change 必须先确定工作区，再在 Open 阶段创建产物。full workflow 的 `isolation` 可为 `current`、`branch` 或 `worktree`；用户明确要求并行工作时准备 Worktree，其他情况按 `comet-classic/reference/workspace.md` 选择。hotfix/tweak 按各自初始化步骤确认并绑定工作区。恢复时使用已经绑定的工作区；分支归属发生变化时，根据用户已确认的选择执行 rebind，缺少有效授权时才询问。

## 2. 载入当前阶段

执行同一组任务时，复用本次命令返回的状态信息和已读取的上下文；只有命令写入状态、切换工作区、恢复会话或发现外部变化时才重新查询。根据当前改动的风险选择检查范围，Verify 仍需完成一次覆盖最终实现的集成审查。

绑定工作区并取得 phase 后，读取并执行 [任务上下文与产物语言](reference/scripts.md#任务上下文与产物语言)，运行 `comet task`。按配置确定产物语言；根据 Context Manifest（上下文清单）中的摘要，只展开当前步骤还缺少的内容。实际使用某条内容后如实记录使用结果，任务结束时保存检查点。

| Runtime 路由或阶段            | 入口与职责                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------- |
| 新 full / open                | `/comet-open`：澄清范围、创建必需产物、请用户检查并确认                      |
| design                        | `/comet-design`：完成技术取舍并确认正式设计                                  |
| build + full                  | `/comet-build`：恢复配置/计划，完成任务与所需审查                            |
| hotfix / build + hotfix       | `/comet-hotfix`：已有异常的局部修复                                          |
| tweak / build + tweak         | `/comet-tweak`：单 change 轻量调整                                           |
| verify                        | `/comet-verify`：执行验收、修复后复验、完成唯一一次最终集成审查              |
| archive / verify_result: pass | `/comet-archive`：确认归档、只提交当前 change 的文件、完成用户选定的交付方式 |

只有新需求才考虑推荐轻量流程：风险符合预设要求且用户已明确选择时直接进入；由 Agent 推荐时，说明依据，并展示 hotfix/tweak 与保留 full 的选项及各自影响，等待用户确认。不得擅自把已有 full change 改成轻量流程。公共 API、数据迁移、安全、并发或跨模块设计应按实际风险处理，不能因为文件少就省略必要步骤。

运行 hotfix/tweak 时必须读取所选预设的“升级判定”：出现其中列出的升级条件，或改动文件数超过提示阈值时，展示继续预设或升级 full 的选择并等待答复；用户选择升级后才运行 `comet state transition <name> preset-escalate`。`verify_mode` 只决定验证级别，不能替代 workflow 选择或预设升级确认。

恢复会话、外部状态变化，或计划、任务、审查、交付记录与实际情况不一致时，读取 `comet-classic/reference/context-recovery.md`，根据当前阶段入口返回的 nextAction 确定还有哪些步骤未完成。沿用仍有效的配置和成果；任务未勾选不等于尚未实现。具体恢复步骤以该参考文件为准。

## 3. 继续完成本次获准执行的工作

阶段退出检查通过后，按 `comet-classic/reference/auto-transition.md` 读取成功结果中的 `agent.continuation`，只加载它指定的下一 Skill。没有可复用的状态信息、会话恢复时缺少上下文，或发生外部变化时，才重新查询。`auto_transition: false` 只控制是否调用下一 Skill，不改变 Guard 已更新的 phase；`NEXT: manual` 时按 HINT 提示用户并结束本次调用，不追加确认。

决策点是阻塞点：需要用户决定的步骤必须等到明确答复后再继续。首次需要向用户澄清或确认时，必须先读取 `comet-classic/reference/decision-point.md`，按其中的选项式提问、推荐理由、每项影响和 `AskUserQuestion` 优先规则执行；已在当前上下文中时直接复用。以下确认不能因“只有一个推荐方案”或自动衔接而跳过：

- 目标 change、PRD 拆分与工作区隔离仍需要用户选择时，把相关问题放在一起询问，并等待选择。
- Open 产物完成后，请用户最终确认名称、范围和产物；Design 形成方案后，请用户确认正式设计。两者都先提供可以检查的结果，再等待批准或调整意见。
- Build 写计划前，只有执行/TDD/review 配置缺失或用户要求更改时，才请用户补充或修改；用户主动要求 `plan-ready` 暂停后，等明确继续指令再恢复。
- Verify 中需要接受偏差、处理实现与 Spec 不一致的问题，或达到自动修复上限后决定如何继续；Archive 中需要选择归档与交付方式。
- 需要从预设升级为完整流程，或 Build 中需要扩大范围、重新设计、拆分 change。

用户明确选择前，不写入依赖该决定的状态，不执行对应分支操作，也不绕过阶段 Guard。已有仍有效的授权与配置直接复用；对于范围内原因明确且可以修复的问题、能根据证据补齐的状态，以及其他只有一种合法做法的步骤，自动继续，不额外询问“是否继续”。

归档与交付方式合并为同一个最终确认，由 `/comet-archive` 核对用户授权、Git 的实际状态，以及所选交付操作是否完成。验证通过不代表归档授权；归档目录存在也不代表提交、push 或 PR 已完成。

## 每个阶段都必须遵守的规则

- 流程状态以 Runtime 返回的 phase、Guard 检查结果和当前工作区绑定为准；文件与对话用于核对，不能据此手改 phase，绕过确认或验证。
- proposal 记录目标与范围，spec 规定行为和验收要求，design_doc 指向唯一一份正式技术设计，plan 说明实施方法，tasks.md 记录任务完成状态。
- 遵循已确认的执行方式、TDD 和 review 配置；autonomous 仍须完成 full 要求的设计、计划、实际验证和独立审查。配置缺失或用户要求更改时由 Build 确认，不能根据模型名称擅自替换。
- 未提交改动先按 `comet-classic/reference/dirty-worktree.md` 核对来源和归属；只处理当前 change，保护无关改动。状态更新被拒绝、路径越界、依赖不可用或归属不明时，读取 `comet-classic/reference/context-recovery.md` 的“入口错误与恢复”，报告原错误并执行对应恢复规则。
- 当前阶段发生异常时读取 `comet-classic/reference/debug-gate.md`，先调查再修复；只有实际运行过测试或构建，才能声称完成相应检查。以前通过的结果，只有在 Runtime 确认仍有效时才能复用。

需要状态字段含义时读 `comet-classic/reference/comet-yaml-fields.md`；需要产物目录说明时读 `comet-classic/reference/file-structure.md`。其余参考只在上方触发条件满足时读取。
