---
name: comet
description: "用于用户明确调用 /comet、要求启动或恢复 Comet 托管工作流，或仓库中存在可无歧义恢复的 active Comet change；负责通过 intent runtime 和 .comet.yaml 路由阶段。"
---

# Comet — OpenSpec + Superpowers 双星开发流程

OpenSpec 与 Superpowers 如双星系统围绕同一目标运转。

```
OpenSpec 负责 WHAT  — 大纲、提案、spec 生命周期、归档
Superpowers 负责 HOW — 技术设计、计划、执行、收尾
```

**核心原则：brainstorming 必不可跳过。每次变更都必须经过深度设计（hotfix 和 tweak 预设除外）。**

---

## 决策核心（Decision Core）

agent 做决策只需读本节，参考附录按需查阅。

### 输出语言规则

所有 OpenSpec 和 Superpowers 产物都必须使用 Comet 配置的产物语言。配置值是规范化语言 ID，`en` 或 `zh-CN`。已有 change 优先通过 `comet state get <name> language` 读取 `openspec/changes/<name>/.comet.yaml` 中的 `language`；`.comet.yaml` 尚不存在时依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `language`；都不存在时才回退到当前用户请求语言。调用外部 OpenSpec/Superpowers skill 时，必须把解析后的语言显式写入 prompt 或 ARGUMENTS。

### 阶段自动检测

**Step 0: 活跃 Change 发现与意图判定**

1. 先按 `comet/reference/scripts.md` 完成脚本定位，确保 `$COMET_INTENT` 可用。
2. 运行 `openspec list --json` 获取所有活跃 change。
3. 根据用户请求、active change 列表和必要仓库状态填写 `CometIntentFrame`。
4. 优先用 `node "$COMET_INTENT" route --stdin` 传入 frame JSON，获取 runtime 规范化路由。`CometIntentFrame + runtime scorer` 是事实源；本节自然语言规则只用于意图识别槽位提取。
5. 按 runtime route 处理：
   - `hotfix` → 直接调用 `/comet-hotfix`
   - `tweak` → 直接调用 `/comet-tweak`
   - `full` → 按活跃 change 表决定 `/comet-open` 或用户确认
   - `resume` → 进入 Step 1 读取对应 change 的 `.comet.yaml`
   - `ask_user` → 按 `comet/reference/decision-point.md` 暂停并等待用户选择
   - `out_of_scope` → 说明本次输入不是 Comet workflow 启动/恢复请求，不初始化 change

当 runtime route、Ambient Resume 或用户选择已经解析出明确 change 后，进入对应阶段 Skill 前必须先绑定当前执行上下文：

```bash
comet state select <change-name>
```

多个 active change 且用户尚未明确选择时，不得提前绑定；继续按 `ask_user` 决策点等待选择。

### Comet Ambient Resume

当用户未显式输入 `/comet`，但当前仓库可能已有 active Comet change 时，开始处理需要改动或调查的任务前先运行只读探针：

```bash
node "$COMET_RESUME_PROBE" probe --stdin
```

探针只读仓库状态，不修改文件。按返回值处理：

- `auto_resume`：输出一行 `[COMET] 检测到 active change <name>，按 <nextCommand> 恢复。`，然后进入 `nextCommand`。
- `ask_user`：只问一个短问题并等待用户回复。
- `out_of_scope` 或 `none`：不要进入 Comet workflow。

原则：不把无关任务挂到 active Comet change，尤其不能只因为存在 `.comet.yaml` 就这样做。

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
字段完整含义见 `comet/reference/intent-frame.md`；正常路由只需按上方最小骨架填写。

- `fix_bug` + `existing_behavior: true` + 无新增 capability/public API/schema/cross-module 信号 → 倾向 `hotfix`
- 用户明确描述为可收敛为单一 OpenSpec change 的轻量/中等变更，需通过 OpenSpec apply 执行，且不需要完整 `/comet` 深度设计/plan → 倾向 `tweak`
- 文案、配置、文档、prompt 或单一 OpenSpec change 的轻中量修改 → 倾向 `tweak`
- 新增 capability、public API、schema 变更、跨模块协调或架构调整 → 倾向 `full`
- 多个 active change 且用户未明确 change → `ask_user`
- 置信度不足、关键 evidence 缺失或用户显式 workflow 与风险信号冲突 → `ask_user`

| 活跃 change | 用户输入 | 行为 |
|-------------|---------|------|
| 无 | `full` 路由 | → 调用 `/comet-open` |
| 恰好 1 个 | `/comet <描述>` | → **询问**：继续该变更 or 创建新变更 |
| 多个 | `/comet <描述>` | → **询问**：继续现有变更 or 创建新变更；若选继续 → 列出清单让用户选择 |
| 恰好 1 个 | `/comet`（无描述） | → 自动选中，进入 Step 1 |
| 多个 | `/comet`（无描述） | → 列出清单让用户选择 |

<IMPORTANT>
当用户选择「创建新变更」时，**必须调用 `/comet-open`**（禁止直接调用 `/opsx:new`）。
`/comet-open` 负责完整双初始化：OpenSpec artifacts（由内部 `/opsx:new` 创建）+ `.comet.yaml` 状态文件。
直接调用 `/opsx:new` 会缺失 `.comet.yaml`，导致后续阶段判定失败。
</IMPORTANT>

**Step 1: 读取 `.comet.yaml` 状态元数据**

优先读取 `openspec/changes/<name>/.comet.yaml`。不存在时回退到 `openspec status --change "<name>" --json`、`tasks.md` 和 `docs/superpowers/` 文件检查。

**断点恢复规则**：
- 每次恢复上下文时，先重新执行 Step 0 和 Step 1，不依赖对话历史判断阶段
- 只要存在 active change 且工作区有未提交改动，必须按 `comet/reference/dirty-worktree.md` 协议处理。该协议定义了检查步骤、归因分类和禁令，本文件不重复
- 若 `phase: build`，先检查 `build_pause`、`plan`、`isolation`、`build_mode`、`tdd_mode` 和 `review_mode`（详见下方）：
  - 若 `build_pause: plan-ready` 但 `isolation`、`build_mode`、`tdd_mode` 和 `review_mode` 都已经设置，则视为 stale pause：先输出 `[COMET] 检测到 stale pause（build_pause=plan-ready 但 isolation/build_mode/tdd_mode/review_mode 已设置），自动清除并继续`，再运行 `comet state set <name> build_pause null`，然后读取 tasks.md 的下一个未勾选任务并按 `build_mode` 恢复执行
  - 若 `build_pause: plan-ready` 且 plan 文件存在，但 `isolation`、`build_mode`、`tdd_mode` 或 `review_mode` 尚未设置，回到 `/comet-build` 的 plan-ready 恢复点，提示用户继续补齐/确认工作区隔离、执行方式、TDD 模式和代码审查模式，不重新生成 plan
  - 若 `build_pause: plan-ready` 但 plan 文件缺失，回到 `/comet-build` 处理状态损坏或重新生成 plan
  - 若 `isolation`、`build_mode`、`tdd_mode` 或 `review_mode` 未设置，回到 `/comet-build` 对应步骤补充后再执行
  - 若均已设置，读取 tasks.md 的下一个未勾选任务，并按 `build_mode` 恢复执行：
    - 若 `build_mode: subagent-driven-development`，不得在主窗口直接执行任务；必须回到 `/comet-build` 的后台 subagent 调度规则，由主窗口只做协调
    - 其他执行方式按 `/comet-build` 的对应规则继续
- 若 `verify_result: fail`，读取 `verify_failures`：未超过 3 次时直接调用 `/comet-build` 继续已记录的修复循环，不重复询问；超过自动修复上限时回到 `/comet-verify` 的例外决策点。只有接受 WARNING/SUGGESTION 偏差或超限后的继续/停止策略需要用户选择
- 若 `phase: open` 但 OpenSpec `applyRequires` 已完整，先运行 `comet guard <change-name> open --apply` 修正状态，再继续判定
- 若 `phase: archive`，只允许调用 `/comet-archive`；归档前先等待最终确认，归档后精确提交归档改动，再处理分支并运行 archive guard

**Step 2: 阶段判定**（按顺序，命中即停）

1. `archived: true` 或 change 已移入 archive → 流程已完成
2. `verify_result: pass` 且 `archived` 不是 `true` → `/comet-archive`（先进行归档前最终确认）
3. `verify_result: fail` → 自动调用 `/comet-build` 继续修复；若 `verify_failures` 已超过自动修复上限，则进入 `/comet-verify` 的超限策略决策点
4. `phase: verify` 或 tasks.md 全部勾选 → `/comet-verify`
5. `phase: build` 或已有 Design Doc 但计划/执行未完成 → 优先按 workflow 路由：`hotfix` → `/comet-hotfix`，`tweak` → `/comet-tweak`，`full` → `/comet-build`
6. `phase: design` 或有 change 但无 Design Doc → `/comet-design`
7. `phase: open` 或有活跃 change 但 `.comet.yaml` 缺失 → `/comet-open`
8. 无活跃 change → `/comet-open`

如果元数据与文件状态冲突，以文件状态为准，修正 `.comet.yaml` 后继续。

### 预设升级判定

hotfix/tweak 的范围判定采用三层分工，避免「用纯文件数当硬性升级条件」误杀正常小改动：

1. **质变信号**（agent 语义识别，命中任一即暂停交用户二选一）：跨模块协调修改、需要新增 capability、数据库 schema 变更、引入新的 public API、触及深层架构问题（各预设沿用这套核心信号，并可追加自身语境的特有信号，如 tweak 的「需要拆分为多个 OpenSpec changes」）
2. **文件数 tripwire**（用户拍板，非自动升级）：改动文件数超提示阈值时，暂停交用户决定继续预设流程还是升级 full，不自动踢
3. **验证级别**（scale 脚本判定）：`comet state scale` 仅决定 `verify_mode`（验证轻重），不卡流程、不触发升级

**升级决策点（用户二选一）**：
- 继续预设轻量流程（用户确认范围可控）
- 升级为完整 `/comet`（使用 `comet state transition <name> preset-escalate` 合法回退到 design 阶段，同时清除预设专属的 build 配置；补 Design Doc 后重新联合选择完整工作方式）

详细判定规则见 `comet-hotfix` / `comet-tweak` 各自的「升级判定」章节。

### 错误处理速查

| 场景 | 处理方式 |
|------|---------|
| `openspec list --json` 失败 | 检查 openspec 是否已安装，提示 `openspec init` |
| 子 skill 不可用 | 停止流程，提示安装或启用对应 skill |
| `.comet.yaml` 缺失 | 进入对应 preset 的 `/comet-open` 初始化状态，再运行 `comet state select`；不得跳过初始化 |
| `.comet.yaml` 格式异常 | 停止并报告解析错误；从版本控制、备份或可验证产物人工修复，不能用 `comet state set` 覆盖损坏文件 |
| 构建/测试失败 | 返回 build 阶段修复，不进入 verify |
| change 目录结构不完整 | 按 `comet-open` 产物要求补齐 |

### 阶段衔接

<IMPORTANT>
单次 `/comet` 调用从检测到的阶段开始，退出条件满足后进入下一阶段。

流转链：open → design → build → verify → archive

**连续执行要求**：从检测到的阶段开始，agent 自动推进后续阶段。但**自动推进仅适用于没有用户决策的衔接点**。遇到用户决策点时，**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确回复**，不得用推荐规则、默认值或历史偏好代替用户确认，也不得仅输出文字提示后继续执行。

**阶段推进与自动衔接的区分**：每个子 skill 退出前都会运行阶段守卫 `--apply` 推进 `.comet.yaml` 的 `phase` 字段——这一步**始终发生**，与 `auto_transition` 无关。之后子 skill 运行 `comet state next <name>` 解析下一步：`auto_transition` 不为 `false` 时输出 `NEXT: auto`（自动调用下一 skill），为 `false` 时输出 `NEXT: manual`（不调用下一 skill，按 `HINT` 交还控制权）。`NEXT: manual` 不是用户决策点，不得再询问“是否继续”。因此 `auto_transition` **只控制是否自动调用下一个 skill，不影响 phase 推进**。无论 `auto_transition` 取何值，下方真正的用户决策点都必须阻塞等待。

**决策点是阻塞点**：只要到达下列任一节点，当前 `/comet` 调用必须停住，并按 `comet/reference/decision-point.md` 的协议获取用户明确选择。用户明确选择后才能写入对应状态字段、执行对应操作，随后再继续自动流转。

需要用户参与的节点（仅在这些节点暂停）：
1. workflow 目标选择：多个 active changes、继续现有 change/创建新 change、或批量拆分完成后选择先启动哪一个
2. open 阶段 proposal/design/tasks 最终审视确认（同时确认 change 名称与范围；清晰请求不做前置摘要/命名确认）
3. brainstorming 确认设计方案
4. build 阶段一次性联合选择 plan-ready 暂停或完整工作方式（可用的工作区隔离 + 执行方式 + TDD 模式 + 代码审查模式；选择 branch 时同时确认分支名）
5. verify 阶段接受 WARNING/SUGGESTION 偏差、处理 Spec 漂移，或第 4 次失败后选择继续修复/停止；前 3 次明确可修复失败自动闭环
6. archive 阶段执行归档脚本前的最终确认
7. 归档改动精确提交后选择 finishing-branch 分支处理方式
8. 遇到升级判定信号（hotfix/tweak → 用户二选一：继续预设流程 / 升级完整流程）
9. build 阶段范围扩张需重新设计或拆分新 change
10. open 阶段大型 PRD 是否拆分为多个 changes

agent 不应跳过这些决策点；其他明确无歧义的阶段衔接必须自动继续推进，不得中途退出。到达决策点时，**禁止跳过用户确认或自动选择——必须通过当前平台可用的用户输入/确认机制明确获取用户选择后才能继续**。

**红旗清单** — 以下想法出现时立即停止并检查：

| Agent 心理 | 实际风险 |
|-----------|---------|
| "用户应该会同意这个方案" | 不能替用户决策，必须等待用户明确选择 |
| "这只是个小改动，不需要确认" | 决策点无大小之分，阻塞点必须等待 |
| "用户之前选过 A，这次也选 A" | 历史偏好不能替代当前确认 |
| "我已经解释了方案，用户没反对" | 没反对 ≠ 同意，必须用工具获取明确选择 |
| "流程走到这里应该没问题了" | 验证不通过 ≠ 通过，检查 verify_result |
</IMPORTANT>

---

## 子命令速查

| 命令 | 阶段 | 归属 | 产物 |
|------|------|------|------|
| `/comet-open` | 1. 开启 | OpenSpec | proposal.md、design.md、tasks.md |
| `/comet-design` | 2. 深度设计 | Superpowers | Design Doc、delta spec |
| `/comet-build` | 3. 计划与构建 | Superpowers | 实施计划、代码提交 |
| `/comet-verify` | 4. 验证 | Both | 验证报告 |
| `/comet-archive` | 5. 归档与收尾 | OpenSpec | delta→main spec 同步、design doc 标注、归档提交、分支处理 |
| `/comet-hotfix` | 预设路径 | Both | 快速修复（跳过 brainstorming） |
| `/comet-tweak` | 预设路径 | Both | 串联 OpenSpec 的中等改动（delta spec 为一等公民，跳过 brainstorming 和完整 plan） |

```
/comet
  ↓ 自动检测
/comet-open ──→ /comet-design ──→ /comet-build ──→ /comet-verify ──→ /comet-archive
  (OpenSpec)      (Superpowers)     (Superpowers)     (Both)          (OpenSpec)

/comet-hotfix（预设路径，跳过 brainstorming）
  open ──→ build ──→ verify ──→ archive
    ↑ 命中升级判定信号 → 用户二选一（继续预设流程 / 升级 full）→ 升级则 transition preset-escalate → 补 Design Doc → 回到完整流程

/comet-tweak（轻量预设路径，串联 OpenSpec，delta spec 为一等公民）
  open ──→ build ──→ verify ──→ archive
    ↑ 命中升级判定信号 → 用户二选一（继续预设流程 / 升级 full）→ 升级则 transition preset-escalate → 补 Design Doc → 回到完整流程
```

---

## 参考附录（Reference Appendix）

> 字段说明、文件结构和自动衔接协议已提取为渐进式加载参考文档，按需查阅：
> - **`.comet.yaml` 完整字段表**：按 `comet/reference/comet-yaml-fields.md` 查阅（含必需字段、可选字段和完整示例）
> - **文件结构**：按 `comet/reference/file-structure.md` 查阅
> - **自动衔接协议**：按 `comet/reference/auto-transition.md` 查阅
> - **上下文压缩恢复**：按 `comet/reference/context-recovery.md` 查阅
> - **用户决策点协议**：按 `comet/reference/decision-point.md` 查阅
> - **异常调试协议**：按 `comet/reference/debug-gate.md` 查阅

### 状态机硬约束

- full workflow 的 `build → verify` 前，`isolation` 必须是 `branch` 或 `worktree`；hotfix/tweak 可如实使用 `current`
- `build → verify` 前，`build_mode` 必须已选择
- `build_mode: subagent-driven-development` 必须同时有 `subagent_dispatch: confirmed`
- full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`
- full workflow 离开 build 阶段前 `review_mode` 必须已选择为 `off`、`standard` 或 `thorough`
- `build_mode: direct` 默认只允许 `hotfix` / `tweak`；full workflow 需要 `direct_override: true`
- `build_pause` 不是执行方式，不得写入 `build_mode`
- 这些约束同时由 `comet guard <name> build --apply` 和 `comet state transition <name> build-complete` 执行

### 脚本定位

面向 workflow 的状态、守卫、handoff 和 archive 操作统一使用稳定 `comet` CLI；只有尚无公开子命令的 intent/resume probe 才按 `comet/reference/scripts.md` 定位内部 launcher。关键入口：

```bash
comet guard <change-name> <phase> --apply             # 阶段守卫 + 自动状态更新
comet state transition <change-name> <event>          # open-complete | design-complete | build-complete | verify-pass | verify-fail
comet state next <change-name>                        # NEXT: auto|manual|done + SKILL: <skill-name>
comet archive <change-name>                           # 一键完成归档
```

### 文件结构

按 `comet/reference/file-structure.md` 查阅完整目录结构。
