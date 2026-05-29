---
name: comet
description: "Comet — OpenSpec + Superpowers 双星开发流程。用 /comet 启动，自动检测阶段并分发到子命令。五阶段：开启 → 深度设计 → 计划与构建 → 验证与收尾 → 归档。"

# Comet — OpenSpec + Superpowers 双星开发流程
OpenSpec 与 Superpowers 如双星系统围绕同一目标运转。
```
OpenSpec 负责 WHAT  — 大纲、提案、spec 生命周期、归档
Superpowers 负责 HOW — 技术设计、计划、执行、收尾
**核心原则：brainstorming 必不可跳过。每次变更都必须经过深度设计（hotfix 和 tweak preset 除外）。**
## Auto-Pilot 模式（v0.4+）
当 SessionStart Hook 注入 `comet-auto-resume` 上下文或用户手动调用 `/comet-auto` 时，进入自动模式。
### 自动模式判定
满足以下任一条件即进入自动模式：
1. 上下文包含 `<comet-auto-resume>` 标记
2. 用户手动调用 `/comet-auto` 或 `/comet-auto --dry-run`
3. `comet-auto.yaml` 中 `auto.enabled: true` 且手动 `/comet` 带 `--auto` 参数
### 自动模式行为
**与手动模式的核心差异**：
| 场景 | 手动模式 | 自动模式 |
|------|---------|---------|
| Step 0 多 change 选择 | 询问用户选择 | 按优先级自动选最紧迫的 |
| Step 0 单 change + 描述 | 询问继续还是新建 | 自动续接已有 change |
| design 确认 | 暂停等待用户 | 按 `confirm_design` 策略处理 |
| build 隔离/执行选择 | 询问用户 | 使用预配置 |
| 阶段流转 | 等待用户确认 | 自动流转到下一阶段 |
| 阻断条件 | 暂停 | 按重试策略重试，耗尽后暂停 |
### Auto-Config 加载
```bash
# 加载项目级配置
if [ -f comet-auto.yaml ]; then
  # 读取 auto 配置
fi
# change 级覆盖（.comet.yaml 内 auto: 字段）
if [ -f "openspec/changes/<name>/.comet.yaml" ]; then
  # 合并 change 级 auto 配置
配置优先级：change 级 `.comet.yaml` > 项目级 `comet-auto.yaml` > 全局默认。
### 与手动模式的兼容
用户随时可以手动输入 `/comet` 接管控制。自动模式在以下情况自动降级为提醒模式：
- `auto.enabled: false`
- 检测到 `preset_upgrade` 条件（hotfix/tweak 满足升级条件）
## 决策核心（Decision Core）
agent 做决策只需读本节，参考附录按需查阅。
**决策点是阻塞点**：只要到达下列任一节点，当前 `/comet` 调用必须停住，**使用 AskUserQuestion 工具等待用户选择**。用户明确选择后才能写入对应状态字段、执行对应操作，随后再继续自动流转。
需要用户参与的节点（仅在这些节点暂停）：
1. open 阶段 proposal/design/tasks 审视确认
2. brainstorming 确认设计方案
3. build 阶段选择工作方式（隔离方式 + 执行方式，一次交互完成）
4. verify 不通过时决定修复或接受偏差（含 Spec 漂移处理方式选择）
5. finishing-branch 选择分支处理方式
6. 遇到升级条件（hotfix/tweak → 完整流程）
7. build 阶段范围扩张需重新设计或拆分新 change

agent 不应跳过这些决策点；其他明确无歧义的阶段衔接必须自动继续推进，不得中途退出。到达决策点时，**禁止以文字输出代替工具等待——必须通过 AskUserQuestion 明确获取用户选择后才能继续**。

**红旗清单** — 以下想法出现时立即停止并检查：

| Agent 心理 | 实际风险 |
|-----------|---------|
| "用户应该会同意这个方案" | 不能替用户决策，用 AskUserQuestion |
| "这只是个小改动，不需要确认" | 决策点无大小之分，阻塞点必须等待 |
| "用户之前选过 A，这次也选 A" | 历史偏好不能替代当前确认 |
| "我已经解释了方案，用户没反对" | 没反对 ≠ 同意，必须用工具获取明确选择 |
| "流程走到这里应该没问题了" | 验证不通过 ≠ 通过，检查 verify_result |
### 阶段自动检测
**前置检查：Auto-Pilot 模式判定**
在进入 Step 0 之前，检测是否处于自动模式：
- 如上下文包含 `<comet-auto-resume>` 标记 → **直接加载 `comet-auto` Skill**，跳过手动决策核心
- 如用户手动调用 `/comet-auto` → **直接加载 `comet-auto` Skill**
- 否则 → 继续下方手动流程
**Step 0: 活跃 Change 发现与意图判定**
1. 先做 Preset 检测；命中 hotfix/tweak 时直接调用对应 preset skill，不进入普通 open 分支
2. 未命中 preset 时，运行 `openspec list --json` 获取所有活跃 change
**Preset 检测优先级最高**：
- 用户明确描述为 bug fix / 热修复 + 满足 hotfix 条件 → 直接 `/comet-hotfix`
- 用户明确描述为文案/配置/文档/prompt 小调整 + 满足 tweak 条件 → 直接 `/comet-tweak`
- 未命中 preset → 按下表处理
| 活跃 change | 用户输入 | 行为 |
|-------------|---------|------|
| 无 | 非 preset 输入 | → 调用 `/comet-open` |
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
- 若 `phase: build`，先检查 `build_mode` 和 `isolation` 是否已设置；若有未设置的字段，回到 `/comet-build` 对应步骤补充后再执行；若均已设置，读取 tasks.md 的下一个未勾选任务继续
- 若 `phase: verify` 且 `verify_result: fail`，进入验证失败决策阻塞点：暂停并询问用户修复或接受偏差；用户选择修复后才运行 `bash "$COMET_STATE" transition <name> verify-fail` 并调用 `/comet-build`
- 若 `phase: open` 但 proposal/design/tasks 已完整，先运行 `bash "$COMET_GUARD" <change-name> open --apply` 修正状态，再继续判定
- 若 `phase: archive`，只允许调用 `/comet-archive`；归档成功后 change 会移动到 archive 目录，不再对原活跃目录运行 guard
**Step 2: 阶段判定**（按顺序，命中即停）
1. `archived: true` 或 change 已移入 archive → 流程已完成
2. `verify_result: pass` 且 `archived` 不是 `true` → `/comet-archive`
3. `verify_result: fail` → 进入验证失败决策阻塞点（暂停询问修复或接受偏差；用户选择修复后才 `verify-fail` 并 `/comet-build`）
4. `phase: verify` 或 tasks.md 全部勾选 → `/comet-verify`
5. `phase: build` 或已有 Design Doc 但计划/执行未完成 → 优先按 workflow 路由：`hotfix` → `/comet-hotfix`，`tweak` → `/comet-tweak`，`full` → `/comet-build`
6. `phase: design` 或有 change 但无 Design Doc → `/comet-design`
7. `phase: open` 或有活跃 change 但 `.comet.yaml` 缺失 → `/comet-open`
8. 无活跃 change → `/comet-open`
如果元数据与文件状态冲突，以文件状态为准，修正 `.comet.yaml` 后继续。
### 预设升级条件
**hotfix → full**（满足任一即升级）：
- 改动涉及 **3+ 文件**
- 涉及架构变更（新模块、新接口、新依赖）
- 涉及数据库 schema 变更
- 修复引入新的 public API
- 修复范围超出单一函数/模块
**tweak → full**（满足任一即升级）：
- 改动涉及 **5+ 文件**
- 涉及多个模块的协调修改
- 需要新增测试用例 **5+**
- 涉及配置项的新增或删除（非值修改）
### 错误处理速查
| 场景 | 处理方式 |
|------|---------|
| `openspec list --json` 失败 | 检查 openspec 是否已安装，提示 `openspec init` |
| 子 skill 加载失败 | 输出具体错误并暂停，不降级为普通对话 |
| guard 脚本返回非零 | 阅读输出，修正后重试 |
| `.comet.yaml` 字段冲突 | 以文件系统为准，自动修正 |
| 预设升级条件触发 | 暂停并询问用户确认升级 |
## 参考附录
### .comet.yaml 状态机字段
必填字段：
| 字段 | 含义 |
|------|------|
| `phase` | 当前阶段：`open`、`design`、`build`、`verify` 或 `archive` |
| `workflow` | 工作流类型：`full`、`hotfix` 或 `tweak` |
| `design_doc` | Design Doc 路径，可为空 |
| `plan` | 实施计划路径，可为空 |
| `isolation` | 工作区隔离方式：`branch`、`worktree` 或 `null`；hotfix/tweak 默认 `branch` |
| `verify_mode` | `light` 或 `full`，可为空 |
| `verify_result` | `pending`、`pass` 或 `fail` |
| `verification_report` | 验证报告文件路径，verify 通过前必须指向已存在文件 |
| `branch_status` | `pending` 或 `handled`，分支处理完成后设为 `handled` |
| `created_at` | change 创建日期（init 时自动写入），格式 `YYYY-MM-DD` |
| `verified_at` | 验证通过时间，可为空 |
| `archived` | change 是否已归档 |
可选字段：
| `direct_override` | `true`/`false`。full workflow 如需使用 `build_mode: direct`，必须显式设为 `true` |
| `build_command` | 项目构建命令。guard 优先运行该命令，失败时打印命令输出 |
| `verify_command` | 项目验证命令。verify guard 优先运行该命令，未配置时回退到构建命令 |
| `auto` | Auto-Pilot 配置覆盖（change 级），结构同 `comet-auto.yaml` 的 `auto:` 字段 |
状态机硬约束：
- `build → verify` 前，`isolation` 必须是 `branch` 或 `worktree`
- `build → verify` 前，`build_mode` 必须已选择
- `build_mode: direct` 默认只允许 `hotfix` / `tweak`；full workflow 需要 `direct_override: true`
- 这些约束同时存在于 `comet-guard.sh build --apply` 和 `comet-state.sh transition <name> build-complete`
### 脚本定位
Comet 脚本随 skill 包分发在 `comet/scripts/` 下。**不硬编码路径** — 定位一次，缓存到环境变量：
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
. "$COMET_ENV"
# 脚本定位失败时停止流程
if [ -z "$COMET_GUARD" ] || [ -z "$COMET_STATE" ] || [ -z "$COMET_HANDOFF" ] || [ -z "$COMET_ARCHIVE" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  echo "Expected path pattern: */comet/scripts/comet-*.sh under project or platform skill directories" >&2
**自动状态更新**：guard 支持 `--apply` 参数，验证通过后自动更新 `.comet.yaml` 状态字段：
bash "$COMET_GUARD" <change-name> <phase> --apply
`--apply` 内部委托给 `comet-state transition`。需要直接表达状态事件时使用：
bash "$COMET_STATE" transition <change-name> open-complete
bash "$COMET_STATE" transition <change-name> design-complete
bash "$COMET_STATE" transition <change-name> build-complete
bash "$COMET_STATE" transition <change-name> verify-pass
bash "$COMET_STATE" transition <change-name> verify-fail
bash "$COMET_STATE" transition <archive-name> archived
**归档脚本**：一键完成归档全部步骤：
bash "$COMET_ARCHIVE" <change-name>
加载 comet 后，agent 应执行以上变量赋值一次，后续全程复用 `$COMET_GUARD`、`$COMET_STATE`、`$COMET_HANDOFF`、`$COMET_ARCHIVE`。
### 文件结构
openspec/                              # OpenSpec — WHAT
├── config.yaml
├── changes/
│   ├── <name>/                        # 活跃 change
│   │   ├── .openspec.yaml
│   │   ├── .comet.yaml
│   │   ├── proposal.md                # Why + What
│   │   ├── design.md                  # 高层架构决策
│   │   ├── specs/<capability>/spec.md # Delta 能力规格
│   │   ├── .comet/handoff/            # 脚本生成的阶段交接包
│   │   ├── .comet/auto/               # Auto-Pilot 运行时（auto_with_diff 审计、日志）
│   │   └── tasks.md                   # 任务清单
│   └── archive/YYYY-MM-DD-<name>/     # 已归档
└── specs/<capability>/spec.md         # 主 specs（归档时从 delta 覆盖）
docs/superpowers/                      # Superpowers — HOW
├── specs/YYYY-MM-DD-<topic>-design.md # 设计文档（技术 RFC，归档时标注状态）
└── plans/YYYY-MM-DD-<feature>.md      # 实施计划（文件头含 change 关联元数据）
comet-auto.yaml                        # Auto-Pilot 项目级配置（可选）
### 最佳实践
1. **brainstorming 不可跳过** — 每次变更必须经过深度设计（hotfix 和 tweak 除外）
2. **delta spec 是活文档** — 阶段 3 期间可自由修改，归档时同步
3. **交接包由脚本生成** — OpenSpec → Superpowers 的上下文必须通过 `comet-handoff.sh` 生成 compact 可追溯摘录（必要时 `--full`），并由 guard 校验 source/hash/mode
4. **保持 tasks.md 同步** — 完成一个勾一个
5. **频繁提交** — 每个任务一次提交，message 体现设计意图
6. **先验证再归档** — `/comet-verify` 通过后才执行 `/comet-archive`
7. **增量更新分级** — 小编辑、中重 brainstorming、大新 change
8. **Plan 必须关联 change** — 文件头包含 `change:` 和 `design-doc:` 元数据
9. **归档闭环** — design doc 和 plan 必须标注 `archived-with` 状态
10. **修改已有功能** — 直接 open 新 change 即可
11. **Preset 有上限** — hotfix/tweak 满足升级条件时及时切换到完整流程
12. **Auto-Pilot 模式** — 设置 `comet-auto.yaml` 后，SessionStart Hook 会自动续接未完成 change；手动 `/comet` 可随时接管
