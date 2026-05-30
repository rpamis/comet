---
name: comet-build
description: "Comet 阶段 3：计划与构建。用 /comet-build 调用。制定计划并选择执行方式（subagent 或直接执行）实施。"
---

# Comet 阶段 3：计划与构建（Build）

## 前置条件

- Design Doc 已创建（阶段 2 完成）
- 活跃 change 存在

## 步骤

### 0. 入口状态验证（Entry Check）

执行入口验证：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
bash "$COMET_STATE" check <name> build
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

### 1. 制定计划（含 Phase Snapshot）

**创建任务快照**（用于 spec_drift 量化判定）：

```bash
mkdir -p openspec/changes/<name>/.comet/auto
# 记录当前 tasks.md 的初始任务总数作为 baseline
TOTAL_TASKS=$(grep -c '^\- \[ \]' openspec/changes/<name>/tasks.md || echo "0")
cat > openspec/changes/<name>/.comet/auto/phase-snapshot.yaml << EOF
phase: build
started_at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
base_ref: $(git rev-parse HEAD)
initial_task_count: $TOTAL_TASKS
EOF
```

**立即执行：** 使用 Skill 工具加载 `superpowers:writing-plans` 技能。禁止跳过此步骤。

技能加载后，按其指引制定计划。计划要求：
- 保存至 `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
- 引用设计文档，拆分为可执行任务
- **Plan 文件头必须包含关联元数据**：

```yaml
---
change: <openspec-change-name>
design-doc: docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
base-ref: <git rev-parse HEAD before implementation>
---
```

### 2. 更新计划状态

先记录 plan 路径：

```bash
bash "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

### 3. 选择工作方式

#### 手动模式

计划已写入当前分支。在开始执行前，**一次性询问用户**选择工作区隔离方式和执行方式：

**工作区隔离**：

| 选项 | 方式 | 说明 |
|------|------|------|
| A | 创建分支 | 在当前仓库创建新分支，简单快速 |
| B | 创建 Worktree | 隔离工作区，完全独立，适合并行开发 |

**推荐规则**：
- 变更涉及 ≤ 3 个文件 → 推荐 A
- 需要并行开发、当前分支有未提交工作 → 推荐 B

**执行方式**：

| 选项 | 技能 | 适用场景 |
|------|------|---------|
| A | `superpowers:subagent-driven-development` | 任务独立、复杂度高、需要双阶段审查 |
| B | `superpowers:executing-plans` | 任务简单、无子agent环境、轻量快速 |

这是用户决策点。必须暂停并等待用户明确选择隔离方式和执行方式，**不得根据推荐规则自行选择 `branch` 或 `worktree`**，也**不得根据推荐规则自行选择执行方式**。推荐规则只能用于说明建议，不能替代用户确认。

#### Auto-Pilot 模式

当 `auto_config` 已提供时，**跳过用户询问**，直接使用预配置：

```bash
bash "$COMET_STATE" set <name> isolation ${auto_config.isolation:-branch}
bash "$COMET_STATE" set <name> build_mode ${auto_config.build_mode:-subagent-driven-development}
```

输出标注 `[AUTO]` 并记录审计：

```bash
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"change\":\"<name>\",\"phase\":\"build\",\"decision\":\"skip_isolation_choice\",\"selected\":\"${auto_config.isolation:-branch}\"}" >> openspec/changes/<name>/.comet/auto/decisions.jsonl
echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"change\":\"<name>\",\"phase\":\"build\",\"decision\":\"skip_build_mode_choice\",\"selected\":\"${auto_config.build_mode:-subagent-driven-development}\"}" >> openspec/changes/<name>/.comet/auto/decisions.jsonl
```

用户选择后，更新 `isolation` 和 `build_mode` 字段：

```bash
bash "$COMET_STATE" set <name> isolation <branch|worktree>
bash "$COMET_STATE" set <name> build_mode <subagent-driven-development|executing-plans|direct>
```

**安全约束**（手动和自动均适用）：
- `build_mode: direct` 默认仅 hotfix/tweak preset 使用
- full workflow 使用 `direct` 需要 `direct_override: true`
- Auto-Pilot 模式下永不自选 `direct`（即使用户在配置中写了）

**执行隔离**：

- **branch**：执行 `git checkout -b <change-name>`，后续工作在新分支上进行
- **worktree**：必须使用 Skill 工具加载 `superpowers:using-git-worktrees` 技能创建隔离工作区

**加载执行技能**：使用 Skill 工具加载对应技能。

技能加载后，按其指引执行：
- 按计划执行任务
- 完成 tasks.md 勾选（`- [ ]` → `- [x]`）
- 每个任务完成后提交代码

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

| 规模 | 触发条件 | 做法 |
|------|---------|------|
| 小 | 遗漏验收场景、边界条件 | 直接编辑 delta spec + design.md，追加 tasks.md 任务 |
| 中 | 接口变更、新增组件、数据流变化 | 使用 AskUserQuestion 工具暂停并等待用户确认后**，必须使用 Skill 工具加载 `superpowers:brainstorming` 更新 Design Doc + delta spec |
| 大 | 全新 capability 需求 | 必须暂停并等待用户确认拆分；用户确认后，通过 `/comet-open` 创建独立 change |

**50% 阈值判定**：以 tasks.md 初始任务总数为基准，若新增任务数超过该总数的一半，视为超出原计划范围，必须使用 AskUserQuestion 工具暂停并等待用户决定是否拆分为新 change。

创建独立 change 时必须调用 `/comet-open`，不得直接调用 `/opsx:new`。`/comet-open` 会同时创建 OpenSpec 产物和 `.comet.yaml`，避免新 change 脱离 Comet 状态机。

**Auto-Pilot 量化阈值**：自动模式下使用 `phase-snapshot.yaml` 记录的 `initial_task_count` 与当前任务数计算 drift 比例，超过 `thresholds.spec_drift_task_ratio` 时触发 `spec_drift_large` 阻断。

**原则**：
- delta spec 是活文档，本阶段期间随时可修改
- 每次更新应提交，commit message 说明变更原因
- 不提前同步到 main spec，归档时统一同步

### 5. 构建错误重试（Auto-Pilot 模式新增）
构建或测试失败时：

```
failure_count=0
max_retry=${auto_config.max_retry:-2}
consecutive_failures=${auto_config.max_consecutive_failures:-5}

while ! build_command; do
  failure_count=$((failure_count + 1))
  
  if [ $failure_count -gt $max_retry ]; then
    echo "[HARD STOP] 单 phase 重试耗尽（${max_retry}/${max_retry}）"
    break
  fi
  
  cross_phase_failures=$(grep -c '"decision":"retry_"' openspec/changes/<name>/.comet/auto/decisions.jsonl 2>/dev/null || echo "0")
  if [ $cross_phase_failures -ge $consecutive_failures ]; then
    echo "[HARD STOP] 跨 phase 连续失败硬上限（${consecutive_failures}）"
    break
  fi
  
  # 指数退避
  backoff=${auto_config.retry_backoff[$((failure_count - 1))]:-1}
  echo "[AUTO] 重试 ${failure_count}/${max_retry}，等待 ${backoff}s ..."
  sleep $backoff
  
  # 记录审计
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"change\":\"<name>\",\"phase\":\"build\",\"decision\":\"retry_build_error\",\"attempt\":$failure_count,\"backoff_s\":$backoff}" >> openspec/changes/<name>/.comet/auto/decisions.jsonl
done
```

**手动模式**：构建失败直接暂停询问用户。

### 6. 上下文管理

Build 是最长阶段，可能跨越大量任务。为支持上下文压缩后断点恢复：

- **每完成一个 task**：立即勾选 tasks.md 并提交代码
- **上下文压缩后恢复**：读取 `.comet.yaml` 的 `phase` 字段、`phase-snapshot.yaml`、tasks.md 找到下一个未勾选任务
- **用户手动修改恢复**：按 `comet/reference/dirty-worktree.md` 协议处理
- **长任务拆分**：单任务超过 200 行代码变更时拆分子任务

## 退出条件

- tasks.md 全部勾选
- 代码已提交
- 已显式运行项目对应的构建/测试命令并通过
- `isolation` 已写为 `branch` 或 `worktree`
- `build_mode` 已写为非空值
- **阶段守卫**：运行 `bash "$COMET_GUARD" <change-name> build --apply`，全部 PASS 后自动流转到 `phase: verify`

退出前运行 guard 自动流转：

```bash
bash "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动流转

退出条件满足后，直接执行下一阶段：

> **REQUIRED NEXT SKILL:** 调用 `comet-verify` skill 进入验证与收尾阶段。
