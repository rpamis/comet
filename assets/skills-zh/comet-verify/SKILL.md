---
name: comet-verify
description: "Comet 阶段 4：验证与收尾。用 /comet-verify 调用。验证实现符合设计，处理开发分支。"
---

# Comet 阶段 4：验证与收尾（Verify）

> **⚠ Auto-Pilot 行为说明**: 当 `auto_config.archive: true` 时，Auto-Pilot 将**自动选择"保持分支（稍后处理）"**并继续（步骤 3 分支处理），不会自动创建 PR（创建 PR 需用户决策）。输出标注 `[AUTO]`。

## 前置条件

- 代码已提交（阶段 3 完成）
- tasks.md 全部任务已完成

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
bash "$COMET_STATE" check <change-name> verify
```

验证通过后继续。验证失败时脚本会输出具体失败原因。

### 0a. Auto-Pilot 失败计数检查（仅自动模式）

当 `auto_config` 存在时，检查跨 phase 连续失败计数：

```bash
CROSS_PHASE_FAILURES=$(grep -c '"decision":"retry_' openspec/changes/<name>/.comet/auto/decisions.jsonl 2>/dev/null || echo "0")
MAX_CONSECUTIVE=${auto_config.max_consecutive_failures:-5}

if [ "$CROSS_PHASE_FAILURES" -ge "$MAX_CONSECUTIVE" ]; then
  echo "[HARD STOP] 跨 phase 连续失败 ${CROSS_PHASE_FAILURES}/${MAX_CONSECUTIVE}，已达硬上限"
  echo "请手动检查并修复问题后重试。"
  exit 1
fi
```

### 1. 改动规模评估

执行规模评估：

```bash
bash "$COMET_STATE" scale <change-name>
```

脚本自动统计任务数、增量规格数、变更文件数，判断使用 light 或 full 验证模式。

验证开始前，按 `comet/reference/dirty-worktree.md` 协议检查并处理未提交改动。verify 阶段的特殊处理：

1. 若 dirty diff 属于当前 change 且涉及实现、测试、tasks、delta spec 或 design doc 变更，不在 verify 阶段直接修复或提交；报告失败项并进入 Step 1b 的验证失败决策阻塞点
2. 若 dirty diff 只是 verify 本阶段产物（例如验证报告草稿、分支处理记录），可继续在 verify 阶段完成并记录状态
3. 若 dirty diff 已实现但 tasks.md 未勾选，视为 build 状态滞后；报告失败项并进入 Step 1b，由用户决定回退修复或接受偏差

用户选择修复后，才允许回退到 build 阶段：

```bash
# 仅在用户确认修复后执行
bash "$COMET_STATE" transition <change-name> verify-fail
```

注意：如果 build 阶段每个任务都已提交，脚本基于工作区 diff 的文件数可能低估改动规模。此时必须读取 plan 文件头的 `base-ref` 并用提交区间复核：

```bash
PLAN=$(bash "$COMET_STATE" get <change-name> plan)
BASE_REF=$(grep '^base-ref:' "$PLAN" 2>/dev/null | head -1 | sed 's/^base-ref: *//')
git diff --stat "$BASE_REF"...HEAD
```

若提交区间显示改动超过轻量阈值（> 4 个文件、跨模块协调、或 delta spec 超过 1 个 capability），手动设置为完整验证：

```bash
bash "$COMET_STATE" set <change-name> verify_mode full
```

### 1b. 验证失败决策（阻塞点 / Auto-Pilot 重试）

验证不通过时**必须使用 AskUserQuestion 工具暂停并等待用户决定修复或接受偏差**。不得自动运行 `bash "$COMET_STATE" transition <change-name> verify-fail`，也不得自动调用 `/comet-build`。

暂停时必须列出：
- 失败项
- 是否属于 CRITICAL（构建失败、测试失败、安全问题、核心验收场景失败）
- 推荐处理方式

用户选择后按以下方式继续：
- **全部修复**：运行 `bash "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build` 修复
- **逐项处理**：CRITICAL 失败项必须修复；非 CRITICAL 失败项可选择接受偏差，但必须在验证报告中记录接受原因和影响范围。若存在任何 CRITICAL 失败项，不允许跳过修复直接全部接受

**Auto-Pilot 模式**：检查 `retry_on` 列表是否包含 `verify_fail`：

```
retry_count=0
max_retry=${auto_config.max_retry:-2}

if [[ "${auto_config.retry_on}" == *"verify_fail"* ]]; then
  while verify_failed && [ $retry_count -lt $max_retry ]; do
    retry_count=$((retry_count + 1))
    backoff=${auto_config.retry_backoff[$((retry_count - 1))]:-1}
    sleep $backoff

    echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"change\":\"<name>\",\"phase\":\"verify\",\"decision\":\"retry_verify_fail\",\"attempt\":$retry_count}" >> openspec/changes/<name>/.comet/auto/decisions.jsonl

    bash "$COMET_STATE" transition <change-name> verify-fail
    # → 调用 /comet-build 修复 → 重新验证
  done
fi
```

重试耗尽后暂停，输出阻断原因。

### 2a. 轻量验证（小改动）

当规模评估结果为"小"时，跳过 `openspec-verify-change`，直接执行以下检查：

1. tasks.md 全部任务已完成 `[x]`
2. 改动文件与 tasks.md 描述一致
3. 编译通过
4. 相关测试通过
5. 无明显安全问题

**通过标准**：5 项全部 OK，无 CRITICAL 问题。

**不通过时**：报告失败项，进入 Step 1b 的验证失败决策阻塞点。

### 2b. 完整验证（大改动）

当规模评估结果为"大"时：

**立即执行：** 使用 Skill 工具加载 `openspec-verify-change` 技能。禁止跳过此步骤。

技能加载后，按其指引验证。检查项：
1. tasks.md 全部任务已完成（`[x]`）
2. 实现符合 `openspec/changes/<name>/design.md` 高层设计决策
3. 实现符合 Design Doc（`docs/superpowers/specs/` 下的技术设计文档）
4. 能力规格场景全部通过
5. proposal.md 目标已满足
6. delta spec 与 design doc 无矛盾（若 Build 阶段有增量修改 spec，检查 design doc 是否有对应记录）
7. `docs/superpowers/specs/` 关联的设计文档可定位（文件存在且与当前 change 相关）


**Spec 漂移处理**（用户决策点）：
- 若检查项 6 发现矛盾（delta spec 有内容但 design doc 未体现），**必须使用 AskUserQuestion 工具以单选题形式暂停并等待用户选择处理方式**，不得自动选择。选项：
  - 选项 A：在 design doc 追加 "Implementation Divergence" 节记录偏差原因。选项 A 属于 verify 阶段允许产物；写入后不得因该 design doc 变更再次触发 Step 1b dirty-worktree 决策
  - 选项 B：用户选择 B 后，运行 `bash "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build`；由 `/comet-build` 的 Spec 增量更新规则加载 `superpowers:brainstorming` 更新 Design Doc + delta spec
  - 选项 C：确认偏差可接受，继续验证（归档时 design doc 将标记为 `superseded-by-main-spec`）
### 3. 收尾（Superpowers）

**立即执行：** 使用 Skill 工具加载 `superpowers:finishing-a-development-branch` 技能。禁止跳过此步骤。

如 `superpowers:finishing-a-development-branch` 不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引收尾。分支处理选项：
1. 本地合并到主分支
2. 推送并创建 PR
3. 保持分支（稍后处理）
4. 丢弃工作

这是用户决策点。**必须使用 AskUserQuestion 工具暂停并等待用户选择分支处理方式**，不得根据推荐、默认值或当前分支状态自行选择。只有在用户完成选择且对应操作完成后，才允许写入 `branch_status: handled`。

**Auto-Pilot 模式**：当 `auto_config.archive: true` 时，自动选择 "保持分支（稍后处理）" 并继续，不创建 PR（创建 PR 涉及外部操作需用户决策）。输出标注 `[AUTO]`。

**确认项**：
- 全部测试通过
- 无硬编码密钥或安全问题

### 4. 记录验证证据

验证报告必须落盘，并在 `.comet.yaml` 中记录；分支处理完成后也必须写入状态字段。

```bash
mkdir -p docs/superpowers/reports
bash "$COMET_STATE" set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
bash "$COMET_STATE" set <change-name> branch_status handled
```

## 退出条件

- 验证报告通过
- 分支已处理
- `.comet.yaml` 中 `verification_report` 指向已存在的验证报告文件
- `.comet.yaml` 中 `branch_status: handled`
- **阶段守卫**：运行 `bash "$COMET_GUARD" <change-name> verify --apply`

```bash
bash "$COMET_GUARD" <change-name> verify --apply
```

## 自动流转

退出条件满足后，直接执行下一阶段：

> **REQUIRED NEXT SKILL:** 调用 `comet-archive` skill 进入归档阶段。
