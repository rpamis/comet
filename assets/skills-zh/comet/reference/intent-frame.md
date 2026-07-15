# CometIntentFrame 字段参考

本文件只在需要解释字段含义时读取。正常 `/comet-classic` 路由只需按主 Skill 的最小骨架填写；runtime 会补齐省略字段并输出最终 `route`。

## 顶层字段

| 字段 | 含义 |
|------|------|
| `schema_version` | frame 版本，当前固定为 `comet.intent.v1`。 |
| `utterance` | 触发 `/comet-classic` 的用户原话。 |
| `intent` | 用户高层意图和置信度。低于 runtime 阈值时会路由到 `ask_user`。 |
| `slots` | 从用户原话归一化出来的路由槽位。 |
| `context` | 从仓库状态读取的上下文，不是用户原话抽取结果。 |
| `evidence` | 支撑关键判断的证据。缺少关键 evidence 时 runtime 会倾向 `ask_user`。 |
| `proposed_route` | Agent 提交的候选路由。最小输入只需 `name` 和 `confidence`，runtime 会复核并输出最终 `route`。 |

## `intent`

| 字段 | 含义 |
|------|------|
| `intent.name` | 用户高层意图：启动、恢复、修 bug、小改、提问或未知。 |
| `intent.confidence` | Agent 对高层意图判断的置信度。它参与低置信度 fallback；`proposed_route.confidence` 不参与。 |

## `slots`

| 字段 | 含义 |
|------|------|
| `requested_action` | 用户想执行的动作，例如 `start`、`resume`、`continue`、`fix`、`modify`、`create`、`verify`、`archive`、`question`。 |
| `workflow_candidate` | Agent 推断的候选流程：`full`、`hotfix`、`tweak` 或 `null`。这是推断值，runtime 会复核。 |
| `user_explicit_workflow` | 用户是否明确指定流程。用户说“走 hotfix”时填 `hotfix`；没明确说时填 `null`。显式流程与风险信号冲突时仍会 `ask_user`。 |
| `change_id` | 用户指定要恢复或操作的 active change 名。没有指定时填 `null`。 |
| `existing_behavior` | 是否在修复已有行为或回归。`true` 且没有新增能力/API/schema/跨模块风险时倾向 `hotfix`。 |
| `new_capability` | 是否新增能力。命中时通常倾向 `full`。 |
| `public_api_change` | 是否改变用户可见接口或契约，例如 CLI 参数、配置字段、输出 JSON、Skill 对外流程。命中时通常倾向 `full`。 |
| `schema_change` | 是否改变结构化数据格式，例如 `.comet.yaml`、`run-state.json`、eval manifest、bundle manifest、配置 schema。命中时通常倾向 `full`。 |
| `cross_module_change` | 是否跨模块或跨 workflow 边界协作。命中时通常倾向 `full`。 |
| `target_area` | 可选解释字段，表示用户提到的目标区域。最小骨架不需要填写。 |
| `scope` | 可选解释字段，表示粗略范围大小。当前 scorer 不让它单独主导路由，最小骨架不需要填写。 |

## `context`

| 字段 | 含义 |
|------|------|
| `active_changes_count` | `openspec list --json` 得到的未归档 active change 数量。多个 active change 且用户未指定 `change_id` 时会 `ask_user`。 |
| `active_change_names` | active change 名称列表。用户指定 `change_id` 时，runtime 用它检查 change 是否存在。 |
| `dirty_worktree` | 可选状态字段。入口路由最小骨架不需要填写；dirty worktree 由 `comet/reference/dirty-worktree.md` 专门处理。 |

## `evidence`

每条 evidence 包含：

| 字段 | 含义 |
|------|------|
| `field` | evidence 支撑的 frame 字段，例如 `intent.name` 或 `slots.workflow_candidate`。 |
| `quote` | 来自用户原话、仓库状态或 `.comet.yaml` 的证据片段。 |
| `source` | 证据来源：`user`、`repo` 或 `state`。 |

## `proposed_route`

| 字段 | 含义 |
|------|------|
| `name` | Agent 候选路由：`full`、`hotfix`、`tweak`、`resume`、`ask_user` 或 `out_of_scope`。 |
| `confidence` | Agent 对候选路由的置信度，只用于诊断，不参与低置信度 fallback。 |
| `next_skill` | 派生字段，runtime 会规范化；最小骨架不需要填写。 |
| `requires_confirmation` | 派生字段，runtime 会规范化；最小骨架不需要填写。 |
| `fallback_reason` | 派生字段，runtime 会规范化；最小骨架不需要填写。 |

## 路由判断要点

- 修复已有异常、回归、错误行为，且没有新增能力/API/schema/跨模块风险：倾向 `hotfix`。
- 文案、配置、文档、prompt 或单一 OpenSpec change 的轻中量修改：倾向 `tweak`。
- 新增能力、public API、schema 变更、跨模块协调或架构调整：倾向 `full`。
- 多个 active change 且用户没指定 change：`ask_user`。
- 低置信度、关键 evidence 缺失、显式流程与风险信号冲突：`ask_user`。
