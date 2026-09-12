# CometIntentFrame 字段参考

启动新需求、目标 change 未明确或需要解释路由字段时读取。已绑定 change 的普通阶段衔接直接使用 Runtime continuation，不重新填写 frame。

先运行 `comet classic openspec -- list --json` 获取活跃 change，根据用户原话、列表和必要仓库事实填写下方骨架，再运行 `comet classic intent route --stdin`；runtime 补齐省略字段并输出最终 `route`。

**CometIntentFrame 最小骨架**：

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

**意图识别槽位提取**：
正常路由按上方最小骨架填写；字段含义见下文。

- `fix_bug` + `existing_behavior: true` + 无新增 capability/public API/schema/cross-module 信号 → 倾向 `hotfix`
- 用户明确描述为可收敛为单一 OpenSpec change 的轻量/中等变更，需通过 OpenSpec apply 执行，且不需要完整 `/comet-classic` 深度设计/plan → 倾向 `tweak`
- 文案、配置、文档、prompt 或单一 OpenSpec change 的轻中量修改 → 倾向 `tweak`
- 新增 capability、public API、schema 变更、跨模块协调或架构调整 → 倾向 `full`
- 多个 active change 且用户未明确 change → `ask_user`
- 置信度不足、关键 evidence 缺失或用户显式 workflow 与风险信号冲突 → `ask_user`

## 目标选择与路由

- `hotfix` / `tweak`：用户已明确选择且风险匹配时加载对应 Skill；自动推荐先按 decision-point.md 确认，并保留 full 选项。
- `full`：按下表确定新建或恢复；新建必须通过 `/comet-open` 完成 OpenSpec artifacts 与 `.comet.yaml` 双初始化。
- `resume`：目标明确后返回入口绑定 workspace；按 context-recovery.md 恢复真实 phase。
- `ask_user`：按 decision-point.md 等待目标或范围选择。
- `out_of_scope`：说明输入不是 workflow 启动/恢复请求，不初始化 change。

| 活跃 change | 用户输入                   | 行为                                                                  |
| ----------- | -------------------------- | --------------------------------------------------------------------- |
| 无          | `full` 路由                | → 调用 `/comet-open`                                                  |
| 恰好 1 个   | `/comet-classic <描述>`    | → **询问**：继续该变更 or 创建新变更                                  |
| 多个        | `/comet-classic <描述>`    | → **询问**：继续现有变更 or 创建新变更；若选继续 → 列出清单让用户选择 |
| 恰好 1 个   | `/comet-classic`（无描述） | → 自动选中，进入 Step 1                                               |
| 多个        | `/comet-classic`（无描述） | → 列出清单让用户选择                                                  |

## 顶层字段

| 字段             | 含义                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `schema_version` | frame 版本，当前固定为 `comet.intent.v1`。                                                    |
| `utterance`      | 触发 `/comet-classic` 的用户原话。                                                            |
| `intent`         | 用户高层意图和置信度。低于 runtime 阈值时会路由到 `ask_user`。                                |
| `slots`          | 从用户原话归一化出来的路由槽位。                                                              |
| `context`        | 从仓库状态读取的上下文，不是用户原话抽取结果。                                                |
| `evidence`       | 支撑关键判断的证据。缺少关键 evidence 时 runtime 会倾向 `ask_user`。                          |
| `proposed_route` | Agent 提交的候选路由。最小输入只需 `name` 和 `confidence`，runtime 会复核并输出最终 `route`。 |

## `intent`

| 字段                | 含义                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `intent.name`       | 用户高层意图：启动、恢复、修 bug、小改、提问或未知。                                        |
| `intent.confidence` | Agent 对高层意图判断的置信度。它参与低置信度 fallback；`proposed_route.confidence` 不参与。 |

## `slots`

| 字段                     | 含义                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `requested_action`       | 用户想执行的动作，例如 `start`、`resume`、`continue`、`fix`、`modify`、`create`、`verify`、`archive`、`question`。                 |
| `workflow_candidate`     | Agent 推断的候选流程：`full`、`hotfix`、`tweak` 或 `null`。这是推断值，runtime 会复核。                                            |
| `user_explicit_workflow` | 用户是否明确指定流程。用户说“走 hotfix”时填 `hotfix`；没明确说时填 `null`。显式流程与风险信号冲突时仍会 `ask_user`。               |
| `change_id`              | 用户指定要恢复或操作的 active change 名。没有指定时填 `null`。                                                                     |
| `existing_behavior`      | 是否在修复已有行为或回归。`true` 且没有新增能力/API/schema/跨模块风险时倾向 `hotfix`。                                             |
| `new_capability`         | 是否新增能力。命中时通常倾向 `full`。                                                                                              |
| `public_api_change`      | 是否改变用户可见接口或契约，例如 CLI 参数、配置字段、输出 JSON、Skill 对外流程。命中时通常倾向 `full`。                            |
| `schema_change`          | 是否改变结构化数据格式，例如 `.comet.yaml`、`run-state.json`、eval manifest、bundle manifest、配置 schema。命中时通常倾向 `full`。 |
| `cross_module_change`    | 是否跨模块或跨 workflow 边界协作。命中时通常倾向 `full`。                                                                          |
| `target_area`            | 可选解释字段，表示用户提到的目标区域。最小骨架不需要填写。                                                                         |
| `scope`                  | 可选解释字段，表示粗略范围大小。当前 scorer 不让它单独主导路由，最小骨架不需要填写。                                               |

## `context`

| 字段                   | 含义                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `active_changes_count` | `comet classic openspec -- list --json` 得到的未归档 active change 数量。多个 active change 且用户未指定 `change_id` 时会 `ask_user`。 |
| `active_change_names`  | active change 名称列表。用户指定 `change_id` 时，runtime 用它检查 change 是否存在。                                                    |
| `dirty_worktree`       | 可选状态字段。入口路由最小骨架不需要填写；dirty worktree 由 `comet-classic/reference/dirty-worktree.md` 专门处理。                     |

## `evidence`

每条 evidence 包含：

| 字段     | 含义                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| `field`  | evidence 支撑的 frame 字段，例如 `intent.name` 或 `slots.workflow_candidate`。 |
| `quote`  | 来自用户原话、仓库状态或 `.comet.yaml` 的证据片段。                            |
| `source` | 证据来源：`user`、`repo` 或 `state`。                                          |

## `proposed_route`

| 字段                    | 含义                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `name`                  | Agent 候选路由：`full`、`hotfix`、`tweak`、`resume`、`ask_user` 或 `out_of_scope`。 |
| `confidence`            | Agent 对候选路由的置信度，只用于诊断，不参与低置信度 fallback。                     |
| `next_skill`            | 派生字段，runtime 会规范化；最小骨架不需要填写。                                    |
| `requires_confirmation` | 派生字段，runtime 会规范化；最小骨架不需要填写。                                    |
| `fallback_reason`       | 派生字段，runtime 会规范化；最小骨架不需要填写。                                    |

## 路由判断要点

- 修复已有异常、回归、错误行为，且没有新增能力/API/schema/跨模块风险：倾向 `hotfix`。
- 文案、配置、文档、prompt 或单一 OpenSpec change 的轻中量修改：倾向 `tweak`。
- 新增能力、public API、schema 变更、跨模块协调或架构调整：倾向 `full`。
- 多个 active change 且用户没指定 change：`ask_user`。
- 低置信度、关键 evidence 缺失、显式流程与风险信号冲突：`ask_user`。
