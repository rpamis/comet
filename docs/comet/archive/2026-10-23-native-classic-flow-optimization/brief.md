# Outcome

优化 Comet Native 与 Classic 的使用流程：减少没有实际信息的文档要求，让配置选择和需求变化后的确认更容易理解，同时保留需求确认、独立验收、恢复与交付授权边界。

本 change 在用户指定的 051 分支使用 0.5.0 SDK Runtime 创建。用户已确定不增加 Classic 跨 change 配置复用；以下完整方案等待最终 Shape 确认。

# Scope

## 本轮方案

1. Native 的 brief 保留 Outcome、Scope、Non-goals、Acceptance examples 四个核心章节。目录结构仍写清实际改动位置和职责，但只需填写有内容的新建、修改、删除、明确不建类别；无内容类别可省略，已有完整格式继续接受。保留中英文标题与列表、目录树支持。Runtime 检查结构和有效正文，Agent 与 Verifier 核对语义及实际改动；不引入路径猜测或“小任务”分类器，不按文件数量减少验收要求。
2. Classic 展示当前 change 的执行方式、TDD 和审查配置，每项包含值、自然语言含义和确认状态。full 流程只询问缺失、无效或用户要求改变的字段，已有有效选择直接沿用，并保持逐 change 确认；hotfix/tweak 沿用已选择预设及既有确认步骤，不新增独立配置批准。默认值、推荐和历史偏好仅用于建议，不形成跨 change 授权。确认后的简短回显说明采用的配置，然后继续工作，不追加一次“是否继续”。
3. Native 与 Classic 重新确认需求时，先展示相对上次批准方案的行为变化、受影响验收、仍保留的成果和需要重做的步骤，再展示当前完整方案。通过 Skill 规范表达并沿用 Runtime 的现有提案、版本与批准绑定。缺少可信旧方案时明确说明无法可靠比较，不编造差异。实现遗漏沿原范围修复，无关请求不混入当前 change。

## 目录结构

### 新建

- 本 change 的 specs/native-document-constraints/spec.md — Native 正式文档约束的完整目标规格。
- 本 change 的 specs/native-shape-confirmation/spec.md — Native 确认、需求变化说明与恢复边界的完整目标规格。
- 本 change 的 specs/classic-efficiency/spec.md — Classic 效率、配置展示与重新确认说明的完整目标规格。

### 修改

- domains/comet-native/native-artifacts.ts、native-artifact-language.ts — 调整目录结构校验、初始模板和错误提示，保持内容有效性与既有 change 兼容。
- assets/skills-zh/comet-native/、assets/skills-zh/comet-classic/、assets/skills-zh/comet-build/、assets/skills-zh/comet-design/ — 中文范围说明、配置展示和重新确认表达；与 hotfix/tweak 共享的说明放在既有 Classic 参考文件，不修改外部 Skill 原文。
- assets/skills/ 下对应 Skill — 中文稿确认后同步英文。
- test/domains/comet-native/、test/domains/comet-classic/、相关 Skill 契约测试 — 覆盖精简结构、旧格式、配置边界与重新确认行为。
- 相应 Native 构建产物、CHANGELOG.md 与版本字段 — 根据源码变化重建并核对发布差异；不新增 Runtime 入口或放宽架构许可。Skill 中英文同步后再写用户可见 changelog，实施时复核 master、发布 tag 和现有版本条目。

### 删除

无。

### 明确不建

- 新的工作流阶段或通用语义差异引擎 — 首轮复用现有状态机和提案机制。
- 任何跨 change 执行策略、长期授权存储或配置管理入口 — 按用户 Q1 决定保持逐 change 确认。
- website 改动 — 本轮先完成主仓库流程优化。

# Non-goals

- 不开展 Comet Any、Eval 产品、个人记忆或项目知识架构优化。
- 不把单元测试或流程步骤减少当作优于原生 Agent 的证明；真实模型对照实验另行确认。
- 不移除独立 Verifier、用户对完整需求及最终结果的确认，不扩大 merge、push、PR 或工具权限。
- 不修改 Superpowers、OpenSpec 原始 Skill，也不批量改写已归档 change。

# Acceptance examples

- A1：一个只修改配置文件的 Native 需求，提供四个有效核心章节及目录结构中的一项“修改路径 — 职责”，可以完成 Shape 检查，无需为其余类别填写“无”；中英文、列表和目录树形式一致支持。
- A2：缺失核心章节、缺失目录结构、没有任何有效类别、只有空标题或模板占位、仍有真实未决问题时，不能完成 Shape 确认；错误说明具体位置与修复方式，补齐后同一 change 可继续。
- A3：旧的完整目录结构仍被接受；升级前已确认的 Build、Verify 或待归档 change，不因本轮模板变化被强制退回 Shape、重新审批或丢失进度。
- A4：Classic 配置展示包含执行方式、TDD、审查深度的值、含义和确认状态；full 流程只询问待补充或需修正的字段，同一 change 的有效选择继续复用，新 full change 仍需自己的明确确认。hotfix/tweak 沿用已选择预设与既有确认步骤，不新增独立配置批准。默认值或历史选择不成为授权，full autonomous 的审查要求、full direct 的明确选择和子代理派发约束保持原有语义。
- A5：Native 与 Classic 的需求或验收变化时，先说明行为变化、受影响验收、保留成果和重做范围，再展示完整当前方案；缺少可信旧方案时如实说明，普通实现遗漏不被误转成需求重新确认。
- A6：确认仍绑定完整当前提案及 Runtime 的有效版本、动作或提案哈希，过期批准不能覆盖新方案，旧验收不能覆盖新需求；恢复后仍等待必要的用户决定，配置确认不代替需求、交付或工具权限。
- A7：中文与英文 Skill、Runtime 模板、校验及提示保持一致；受影响契约回归、生成物检查和临时项目公开 CLI 验证通过，包括拒绝后修复继续；独立 Verifier 覆盖全部验收项，未执行的真实模型对照实验明确标注。

# Constraints and invariants

- 沿用用户指定的 051 分支和当前工作目录；保留两份已有 research 文件及其他无关工作。website 子模块内容和引用保持原状。
- 当前 change 使用 0.5.0 SDK Runtime；状态、Run、检查结果和验收报告仅由 Runtime 维护。
- 本轮按单个 change 依次推进。独立子 Agent 可用于事实调查；正式 Verify 使用新的独立只读 Verifier。
- 当前只编辑需求产物。产品实现与版本字段在完整 Shape 获得确认后修改；中文 Skill 稿完成并经用户确认后同步英文。

# Decisions

- Q1 已由用户明确选择：本轮不增加跨 change 复用，只优化配置展示和需求变化说明，继续逐 change 确认。
- Native 文档减负只省略空类别，保留目录结构章节与已有分类名称；不要求用户重新选择一套文档格式。
- 重新确认说明使用可读取的正式方案、历史提案和明确用户决定，不新增通用语义差异引擎或状态文件。
- 三项改动共同服务流程可读性，修改相关 Skill 参考和契约，按单个 change 依次实施，不拆分 Supervisor 子任务。

# Verification expectations

当前 Shape 用 Prettier、相关文档约束测试及 Runtime 提案校验验证正式产物。实施后先运行最小相关契约和 Native/Classic 回归，再构建 Native Runtime 并核对生成物；临时项目通过公开 CLI 验证精简结构、旧格式、状态绑定及拒绝后的恢复。涉及 Runtime 边界，在最终交付前安排一轮仓库全量验证，并由独立 Verifier 核对全部验收；真实平台 Hook 和真实模型 Eval 未执行时分别注明。本轮不能据此宣称优于原生 Agent。
