# 归档材料来源

- Parent Run: workflow-experience
- Archive Action: workflow-experience:23
- Contract: workflow-experience:1
- Candidate: 9721494f6862ae82275c49202b10e92064722606
- Verifier: codex-collaboration:01a1f444-25f4-7640-91f1-294ed7dfa666:/root/verify_eval
- Integration Action: workflow-experience:22

- brief.md
- specs/workflow-experience/spec.md

## Parent 原始简报

# 目标

在 `056` 上完成 Classic、Native、Eval、Dashboard 的四项工作流改进。用一个 Native Supervisor Change 实施，按 Issue 拆成四个子变更，由父变更做独立集成验收后归档。

# 范围

- Classic 提供只读的上下文成本拆解，选择一条完整 Classic 流程消除可避免的重复交付，并用同一输入比较。
- Native 在 Build 交接、独立 Verify 和恢复时，按验收 ID 显示当前候选的证据和缺口。
- Eval 提供固定小套件和可复用的前后对比报告，复用现有公开入口、报告和基线能力。
- Dashboard 在当前项目显示需要注意的 Native 和 Classic 条目，直接打开原始 change 或 Supervisor 子变更，保留工作树与 Run 归属。

## Source coverage

覆盖本次创建的四个 Feature Request 的范围和验收。表中规格章节位于 `specs/workflow-experience/spec.md`。

| 来源 | 读取状态 | 需求 | 规格章节 | 验收 | 覆盖状态 |
| --- | --- | --- | --- | --- | --- |
| [#579](https://github.com/rpamis/comet/issues/579) 成本来源、估算与观测 | complete | 拆解来源，标明缺少追踪或用量数据 | Classic 上下文成本 | A1 | covered |
| #579 对比样例、确认和恢复兼容 | complete | 完整案例重复交付有可测下降，保留流程边界及双语语义 | Classic 上下文成本 | A2 | covered |
| [#580](https://github.com/rpamis/comet/issues/580) 候选证据、交接和恢复 | complete | 验收逐项呈现，绑定权威 Run 及候选，涵盖子变更 | Native 验收证据 | A3 | covered |
| #580 检查理由、失败状态、旧 Run | complete | 可解释的补跑及结果，历史证据按实际能力读取 | Native 验收证据 | A4 | covered |
| [#581](https://github.com/rpamis/comet/issues/581) 固定小套件及复用入口 | complete | 固定典型工作流回归场景，复用现有评估能力 | Eval 回归对比 | A5 | covered |
| #581 对比结果与实际观测字段 | complete | 匹配用例报告，缺数明确，使用确定性验证 | Eval 回归对比 | A6 | covered |
| [#582](https://github.com/rpamis/comet/issues/582) 当前项目待关注项 | complete | 合并 Native 和 Classic 的可读待关注状态 | Dashboard 待关注 | A7 | covered |
| #582 深链接、Supervisor 等待解释、权限 | complete | 按真实 Run 和工作树打开证据及子变更，保留原审批权限 | Dashboard 待关注 | A8 | covered |

## 目录结构

### 修改

- `domains/comet-classic/`、`domains/comet-native/`、`domains/eval/`、`domains/dashboard/` 和必要的 `app/` 入口，分别维护计量、验收证据、评估对比和只读视图。
- 对应 `test/` 测试、`assets/` 生成产物和 `CHANGELOG.md`，通过仓库已有构建与验证命令同步。

### 新建

- 在现有目录下按需要增加固定场景和可重现的测试样例。归档产出正式规格 `docs/comet/specs/workflow-experience/spec.md`。

# 非目标

- 普通聊天的上下文调用、Rule 默认强制裁剪、Native 重新调度检查、Dashboard 新增审批或恢复写入口。
- 执行真实模型、容器或批量 Eval。使用固定输入、报告夹具和确定性测试验证本次能力。
- 推送、创建 PR、发布版本和修改 `website` 子模块。

# 关键决定

- `classic-context` 和 `native-evidence` 可以先实施。`eval-comparison` 复用 Classic 的计量字段，`dashboard-attention` 接入 Native 的验收证据。父变更验证两条集成路径、生成产物和浏览器交互。
- 优先改进现有 Runtime 交付与公开只读入口。保留已确认设计、普通恢复和历史归档的兼容行为。仍需调整已发布 Skill 时，按仓库规则先确认中文版本，再同步英文。
- Dashboard 继续以 Ant Design React 组件和现有路由呈现。分类、原因和证据来自各工作流的公开只读状态。

# 验收示例

- Classic 在只读报告中将常驻 Rule、阶段 Skill 或引用、CLI 响应分别归因，可区分静态估算、真实追踪用量和缺失数据。普通聊天维持原行为。
- 使用同一个完整 Classic fixture 对比，至少一项可避免的上下文重复交付下降。报告给出可比口径和结果，同一工作区仍能完成批准、恢复及独立验收，双语流程语义一致。
- Native 在交接、独立 Verify 及冷恢复中为每条已确认验收呈现候选证据或缺口。普通变更和 Supervisor 子变更从同一权威 Run 读取，不复用错候选证据。
- Native Verifier 在现有报告留下新增或重跑检查的原因，旧 Run 可读，失败、未知和未执行仍按实际状态展示。当前候选独立验收继续覆盖全部验收项。
- Eval 通过现有入口和报告结构使用固定小套件，可用确定性用例检查中断恢复、独立 Verify、范围变化后重新确认，标明每个用例适用的工作流和配对身份。
- Eval 对匹配的用例报告 outcome 差异及可观测的工具往返、等待耗时和上下文量。缺数保持未知，确定性验证覆盖正常配对和不可比较样本。
- Dashboard 对同一项目的进行中 Native 和 Classic 条目呈现等待用户、可执行、结论未知或验收受阻。验证工作树身份、旧资料兼容和已完成历史条目的过滤。
- 浏览器验证从待关注项进入原始 change、Supervisor 子变更和证据详情。等待依赖、派发或集成的说明源自权威状态，缺少原因时明确显示未知，审批和恢复仍走现有入口。
- 父变更独立核对子变更合并后的端到端行为，包括计量输入与评估报告一致、验收证据与 Dashboard 跳转一致。运行范围内的测试、构建和生成物检查并记录实际结果，完整验收后归档。
