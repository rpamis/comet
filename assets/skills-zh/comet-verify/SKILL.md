---
name: comet-verify
description: "Comet 阶段 4：验证与收尾。用 /comet-verify 调用。验证实现符合设计，处理开发分支。"
---

# Comet 阶段 4：验证与收尾（Verify）

## 前置条件

- 代码已提交（阶段 3 完成）
- tasks.md 全部任务已完成

## 步骤

### 0a. 输出语言约束

验证报告和分支处理说明必须使用触发本次工作流的用户请求语言。

### 0b. 入口状态验证（Entry Check）

执行入口验证：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
"$COMET_BASH" "$COMET_STATE" check <change-name> verify
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：verify 阶段所有检查可安全重复执行。如 `verify_result` 已为 `pass` 且 `branch_status` 已为 `handled`，说明验证已完成，直接执行 guard 流转。如 `verify_result` 为 `pending`，从头开始验证。

### 1. 改动规模评估

执行规模评估：

```bash
"$COMET_BASH" "$COMET_STATE" scale <change-name>
```

脚本自动统计任务数、增量规格数、变更文件数，判断使用 light 或 full 验证模式，并设置 verify_mode 字段。判定规则（满足任一即 full）：任务数 > 3、delta spec 能力数 > 1、变更文件数 > 4。

验证开始前，按 `comet/reference/dirty-worktree.md` 协议检查并处理未提交改动。verify 阶段的特殊处理：

1. 若 dirty diff 属于当前 change 且涉及实现、测试、tasks、delta spec 或 design doc 变更，不在 verify 阶段直接修复或提交；报告失败项并进入 Step 1b 的验证失败决策阻塞点
2. 若 dirty diff 只是 verify 本阶段产物（例如验证报告草稿、分支处理记录），可继续在 verify 阶段完成并记录状态
3. 若 dirty diff 已实现但 tasks.md 未勾选，视为 build 状态滞后；报告失败项并进入 Step 1b，由用户决定回退修复或接受偏差

用户选择修复后，才允许回退到 build 阶段：

```bash
# 仅在用户确认修复后执行
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

注意：verify-fail 回退到 build 时 `branch_status` 不会被重置。如果首次 verify 已完成分支处理，修复后再次进入 verify 时跳过已完成的分支处理步骤，直接使用 `"$COMET_BASH" "$COMET_STATE" set <change-name> branch_status handled` 保留原有分支处理结果。

注意：如果 build 阶段每个任务都已提交，脚本基于工作区 diff 的文件数可能低估改动规模。此时必须读取 plan 文件头的 `base-ref` 并用提交区间复核：

```bash
PLAN=$("$COMET_BASH" "$COMET_STATE" get <change-name> plan)
BASE_REF=$(grep '^base-ref:' "$PLAN" 2>/dev/null | head -1 | sed 's/^base-ref: *//')
git diff --stat "$BASE_REF"...HEAD
```

若提交区间显示改动超过轻量阈值（> 4 个文件、跨模块协调、或 delta spec 超过 1 个 capability），手动设置为完整验证：

```bash
"$COMET_BASH" "$COMET_STATE" set <change-name> verify_mode full
```

**覆盖机制**：如 agent 或用户认为自动评估结果不合适，可随时通过 `"$COMET_BASH" "$COMET_STATE" set <change-name> verify_mode <light|full>` 手动覆盖。

### 1b. 验证失败决策（阻塞点）

验证不通过时**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户决定修复或接受偏差**。不得自动运行 `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`，也不得自动调用 `/comet-build`。

暂停时必须列出：
- 失败项
- 是否属于 CRITICAL 或 IMPORTANT（构建失败、测试失败、安全问题、核心验收场景失败、简化代码审查发现的正确性/安全/边界问题）
- 推荐处理方式

**不确定性原则**：无法确定严重程度时，降级处理（SUGGESTION > WARNING > CRITICAL）。仅对构建失败、测试失败、安全问题使用 CRITICAL；模糊或不确定的问题标为 WARNING 或 SUGGESTION。

用户选择后按以下方式继续：
- **全部修复**：运行 `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build` 修复
- **逐项处理**：CRITICAL 或 IMPORTANT 失败项必须修复；WARNING/SUGGESTION 失败项可选择接受偏差，但必须在验证报告中记录接受原因和影响范围。若存在任何 CRITICAL 或 IMPORTANT 失败项，不允许跳过修复直接全部接受

### 2. 产物上下文加载（Hash 按需读）

验证需要读取 OpenSpec 产物时，先检查产物是否自 design 阶段以来发生变化：

```bash
RECORDED_HASH=$("$COMET_BASH" "$COMET_STATE" get <change-name> handoff_hash)
CURRENT_HASH=$("$COMET_BASH" "$COMET_HANDOFF" <change-name> --hash-only 2>/dev/null || echo "")
```

- 若 `RECORDED_HASH` = `CURRENT_HASH` 且均非空且均非 `null`：OpenSpec 产物未变化，**tasks.md 无需重新读取全文**（用 `grep -c '\- \[ \]' tasks.md` 确认完成数即可）。proposal.md、design.md、delta spec 仍需读取用于对照检查。
- 若 `RECORDED_HASH` 为空、为 `null`、或与 `CURRENT_HASH` 不一致：产物已变化或 hash 未记录，正常读取所有所需文件全文。

此优化仅跳过 tasks.md 的重复全文读取。proposal.md 和 design.md 包含验证检查项所需的完整上下文，不得因 hash 匹配而跳过。

**立即执行：** 使用 Skill 工具加载 Superpowers `verification-before-completion` 技能。禁止跳过此步骤。

技能加载后，按 verify_mode 分支执行：

### 2a. 轻量验证（小改动）

按以下 6 项进行检查：

1. tasks.md 全部任务已完成 `[x]`
2. 改动文件与 tasks.md 描述一致（`git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD` 对照 tasks 内容）
3. 编译通过（执行项目对应的构建命令，如 `npm run build`、`mvn compile`、`cargo build` 等）
4. 相关测试通过
5. 无明显安全问题（无硬编码密钥、无新增 unsafe 操作）
6. 简化代码审查通过：必须使用 Skill 工具加载 Superpowers `requesting-code-review` 技能，请求只检查正确性、安全、边界条件的轻量代码审查

简化代码审查的输入应限定为本次改动 diff、tasks.md 和必要的测试结果；审查范围只覆盖实现正确性、安全风险和边界条件，不执行 spec 覆盖率、Design Doc 一致性或漂移检查。若审查发现 CRITICAL 或 IMPORTANT 问题，按验证失败处理并进入 Step 1b。

**通过标准**：6 项全部 OK，无 CRITICAL 或 IMPORTANT 问题。

**不通过时**：报告失败项，进入 Step 1b 的验证失败决策阻塞点。用户选择修复后，才执行以下命令记录失败并回退到 build 阶段，然后调用 `/comet-build` 修复：

```bash
# 仅在用户确认修复后执行
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

**报告格式**：简表列出 6 项检查结果 + PASS/FAIL。

**跳过项**（不在轻量验证中检查）：
- spec scenario 覆盖率
- design doc 一致性深度比对
- 不影响正确性、安全、边界条件的 code pattern consistency 建议
- delta spec 与 design doc 漂移检测

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

验证不通过时：报告缺失项，进入 Step 1b 的验证失败决策阻塞点。用户选择修复后，才执行以下命令记录失败并回退到 build 阶段，然后调用 `/comet-build` 补充：

```bash
# 仅在用户确认修复后执行
"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail
```

**Spec 漂移处理**（用户决策点）：
- 若检查项 6 发现矛盾（delta spec 有内容但 design doc 未体现），**必须使用当前平台可用的用户输入/确认机制以单选题形式暂停并等待用户选择处理方式**，不得自动选择。选项：
  - 选项 A：在 design doc 追加 "Implementation Divergence" 节记录偏差原因。选项 A 属于 verify 阶段允许产物；写入后不得因该 design doc 变更再次触发 Step 1b dirty-worktree 决策
  - 选项 B：用户选择 B 后，运行 `"$COMET_BASH" "$COMET_STATE" transition <change-name> verify-fail`，然后调用 `/comet-build`；由 `/comet-build` 的 Spec 增量更新规则加载 Superpowers `brainstorming` 更新 Design Doc + delta spec
  - 选项 C：确认偏差可接受，继续验证（归档时 design doc 将标记为 `superseded-by-main-spec`）

### 3. 收尾（Superpowers）

**立即执行：** 使用 Skill 工具加载 Superpowers `finishing-a-development-branch` 技能。禁止跳过此步骤。

如 Superpowers `finishing-a-development-branch` 技能不可用，停止流程并提示安装或启用 Superpowers 技能，不要用普通对话替代该步骤。

技能加载后，按其指引收尾。分支处理选项：
1. 本地合并到主分支
2. 推送并创建 PR
3. 保持分支（稍后处理）
4. 丢弃工作

这是用户决策点。**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户选择分支处理方式**，不得根据推荐、默认值或当前分支状态自行选择。只有在用户完成选择且对应操作完成后，才允许写入 `branch_status: handled`。

**确认项**：
- 全部测试通过
- 无硬编码密钥或安全问题

### 4. 记录验证证据

验证报告必须落盘，并在 `.comet.yaml` 中记录；分支处理完成后也必须写入状态字段。不要手动设置 `verify_result: pass`，由阶段守卫 `--apply` 推进。

```bash
mkdir -p docs/superpowers/reports
# 将本次验证结论写入报告文件，例如：
# docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md

"$COMET_BASH" "$COMET_STATE" set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
"$COMET_BASH" "$COMET_STATE" set <change-name> branch_status handled
```

## 退出条件

- 验证报告通过
- 分支已处理
- `.comet.yaml` 中 `verification_report` 指向已存在的验证报告文件
- `.comet.yaml` 中 `branch_status: handled`
- **阶段守卫**：运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply`，全部 PASS 后由守卫通过 `comet-state transition verify-pass` 推进到 `phase: archive`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

验证和分支处理均完成后，运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> verify --apply
```

状态文件自动更新为 `phase: archive`、`verify_result: pass`、`verified_at: YYYY-MM-DD`。

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `verify`。

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
"$COMET_BASH" "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续

注意：无论 `NEXT` 为 `auto` 还是 `manual`，`comet-archive` 进入后必须先执行归档前最终确认阻塞点，等待用户明确选择「确认归档」后才允许运行归档脚本。不得因为验证已通过就自动归档。
