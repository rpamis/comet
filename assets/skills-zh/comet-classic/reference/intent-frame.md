# CometIntentFrame 字段参考

启动新需求、目标 change 未明确，或需要了解路由字段时，读取本文件。已绑定 change 的正常阶段衔接直接按 Runtime 返回的 continuation 继续，不重新填写意图数据。

先运行 `comet classic openspec -- list --json` 获取未归档的 change 列表，再根据用户原话、列表和必要的仓库信息，填写下方示例中的字段。运行 `comet classic intent route --stdin` 后，由 Runtime 补齐省略字段，并计算最终 `route`。

**CometIntentFrame 最小示例**：

```json
{
  "schema_version": "comet.intent.v1",
  "utterance": "<用户原话>",
  "intent": { "name": "start_change", "confidence": 0.8 },
  "slots": {
    "requested_action": "start",
    "workflow_candidate": "full",
    "user_explicit_workflow": null,
    "change_id": null,
    "existing_behavior": null,
    "new_capability": null,
    "public_api_change": null,
    "schema_change": null,
    "cross_module_change": null
  },
  "context": {
    "active_changes_count": 0,
    "active_change_names": []
  },
  "evidence": [],
  "proposed_route": {
    "name": "ask_user",
    "confidence": 0.5
  }
}
```

**从用户请求中提取意图字段**：
通常按上方最小示例填写即可；字段含义见下文。以下规则用于提取信息，最终路由仍由 Runtime 计算。

- `fix_bug` 且 `existing_behavior: true`，没有新增能力、公共 API、schema 或跨模块变更 → 倾向 `hotfix`
- 用户明确说明这是一个可以在单一 OpenSpec change 内完成的轻量或中等变更，需要通过 OpenSpec apply 执行，但不需要完整 `/comet-classic` 的深度设计和实施计划 → 倾向 `tweak`
- 文案、配置、文档、提示词，或单一 OpenSpec change 内的轻量至中等修改 → 倾向 `tweak`
- 新增能力、公共 API 或 schema 变更、跨模块协调、架构调整 → 倾向 `full`
- 有多个未归档的 change，用户没有指定目标 → `ask_user`
- 置信度不足、缺少关键证据，或用户指定的 workflow 与实际风险不匹配 → `ask_user`

## 目标选择与路由

- `hotfix` / `tweak`：用户已明确选择，而且风险符合预设要求时，加载对应 Skill；由 Agent 推荐时，先按 decision-point.md 请用户确认，并保留 full 选项。
- `full`：按下表确定新建还是恢复；新建必须通过 `/comet-open` 同时创建 OpenSpec 产物与 `.comet.yaml` 状态文件。
- `resume`：目标明确后，返回入口绑定工作区；按 context-recovery.md 查询实际 phase 并恢复。
- `ask_user`：按 decision-point.md 等待目标或范围选择。
- `out_of_scope`：说明本次请求不涉及启动或恢复工作流，不初始化 change。

| 活跃 change | 用户输入                   | 行为                                                                    |
| ----------- | -------------------------- | ----------------------------------------------------------------------- |
| 无          | `full` 路由                | → 调用 `/comet-open`                                                    |
| 恰好 1 个   | `/comet-classic <描述>`    | → **询问**：继续该变更，还是创建新变更                                  |
| 多个        | `/comet-classic <描述>`    | → **询问**：继续现有变更，还是创建新变更；若选继续 → 列出清单让用户选择 |
| 恰好 1 个   | `/comet-classic`（无描述） | → 自动选中，返回入口绑定工作区并读取状态                                |
| 多个        | `/comet-classic`（无描述） | → 列出清单让用户选择                                                    |

## 顶层字段

| 字段             | 含义                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `schema_version` | 意图数据的版本，当前固定为 `comet.intent.v1`。                                                |
| `utterance`      | 触发 `/comet-classic` 的用户原话。                                                            |
| `intent`         | 用户希望执行的动作及判断置信度。置信度低于 Runtime 阈值时，路由到 `ask_user`。                |
| `slots`          | 从用户原话中提取并按统一格式填写的路由信息。                                                  |
| `context`        | 从仓库状态读取的上下文，不是用户原话抽取结果。                                                |
| `evidence`       | 支撑关键判断的证据。缺少关键证据时，Runtime 会倾向 `ask_user`。                               |
| `proposed_route` | Agent 提交的候选路由。最小输入只需 `name` 和 `confidence`，Runtime 会复核并输出最终 `route`。 |

## `intent`

| 字段                | 含义                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `intent.name`       | 用户希望执行的动作：启动、恢复、修复缺陷、小幅修改、提问或未知。                                             |
| `intent.confidence` | Agent 对高层意图判断的置信度。置信度不足时，Runtime 会据此转为询问用户；`proposed_route.confidence` 不参与。 |

## `slots`

| 字段                     | 含义                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `requested_action`       | 用户想执行的动作，例如 `start`、`resume`、`continue`、`fix`、`modify`、`create`、`verify`、`archive`、`question`。                         |
| `workflow_candidate`     | Agent 推断的候选流程：`full`、`hotfix`、`tweak` 或 `null`。这是推断值，Runtime 会复核。                                                    |
| `user_explicit_workflow` | 用户是否明确指定流程。用户说“走 hotfix”时填 `hotfix`；没明确说时填 `null`。用户指定的流程与实际风险不匹配时，仍会 `ask_user`。             |
| `change_id`              | 用户指定要恢复或操作的未归档 change 名称。没有指定时填 `null`。                                                                            |
| `existing_behavior`      | 是否在修复已有行为或回归。`true` 且没有新增能力/API/schema/跨模块风险时倾向 `hotfix`。                                                     |
| `new_capability`         | 是否新增能力。存在这类变更时通常倾向 `full`。                                                                                              |
| `public_api_change`      | 是否改变用户可见接口或约定的行为，例如 CLI 参数、配置字段、输出 JSON、Skill 对外流程。存在这类变更时通常倾向 `full`。                      |
| `schema_change`          | 是否改变结构化数据格式，例如 `.comet.yaml`、`run-state.json`、eval manifest、bundle manifest、配置 schema。存在这类变更时通常倾向 `full`。 |
| `cross_module_change`    | 是否需要跨模块协作，或涉及多个 workflow。存在这类变更时通常倾向 `full`。                                                                   |
| `target_area`            | 可选解释字段，表示用户提到的目标区域。最小示例不需要填写。                                                                                 |
| `scope`                  | 可选解释字段，表示粗略范围大小。Runtime 不会只凭这个字段决定路由，最小示例不需要填写。                                                     |

## `context`

| 字段                   | 含义                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `active_changes_count` | `comet classic openspec -- list --json` 得到的未归档的 change 数量。存在多个未归档的 change，且用户未指定 `change_id` 时会 `ask_user`。 |
| `active_change_names`  | 未归档 change 的名称列表。用户指定 `change_id` 时，Runtime 用它检查 change 是否存在。                                                   |
| `dirty_worktree`       | 可选状态字段。入口路由的最小示例不需要填写；未提交改动的处理方式由 `comet-classic/reference/dirty-worktree.md` 专门处理。               |

## `evidence`

每条 evidence 证据记录包含：

| 字段     | 含义                                                                     |
| -------- | ------------------------------------------------------------------------ |
| `field`  | 该证据对应的意图字段，例如 `intent.name` 或 `slots.workflow_candidate`。 |
| `quote`  | 来自用户原话、仓库状态或 `.comet.yaml` 的证据片段。                      |
| `source` | 证据来源：`user`、`repo` 或 `state`。                                    |

## `proposed_route`

| 字段                    | 含义                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `name`                  | Agent 候选路由：`full`、`hotfix`、`tweak`、`resume`、`ask_user` 或 `out_of_scope`。 |
| `confidence`            | Agent 对候选路由的置信度，只用于诊断，不用于决定是否因置信度不足而询问用户。        |
| `next_skill`            | 派生字段，由 Runtime 统一计算；最小示例不需要填写。                                 |
| `requires_confirmation` | 派生字段，由 Runtime 统一计算；最小示例不需要填写。                                 |
| `fallback_reason`       | 派生字段，由 Runtime 统一计算；最小示例不需要填写。                                 |

## 路由判断要点

- 修复已有异常、回归或错误行为，且没有新增能力、API、schema 或跨模块风险：倾向 `hotfix`。
- 文案、配置、文档、提示词，或单一 OpenSpec change 内的轻量至中等修改：倾向 `tweak`。
- 新增能力、公共 API 或 schema 变更、跨模块协调、架构调整：倾向 `full`。
- 有多个未归档的 change，用户没有指定目标：`ask_user`。
- 置信度低、缺少关键证据，或用户指定的流程与实际风险不匹配：`ask_user`。
