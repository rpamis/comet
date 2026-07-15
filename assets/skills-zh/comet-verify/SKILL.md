---
name: comet-verify
description: "仅在用户明确调用 /comet-verify，或由 Comet 根 Skill/runtime 路由到 verify 阶段时使用；验证 Comet change、记录证据并处理修复循环。"
---

# Comet 阶段 4：验证（Verify）

## 前置条件

- 代码已提交（阶段 3 完成）
- tasks.md 全部任务已完成

## 步骤

### 0a. 输出语言约束

验证报告必须使用 `comet state get <name> language` 读取到的 Comet 配置产物语言。

### 0b. 入口状态验证（Entry Check）

按 `comet/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <change-name> verify
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：verify 阶段所有检查可安全重复执行。如 `verify_result` 已为 `pass`，说明验证已完成并应进入 archive；`branch_status` 在归档提交和最终分支处理完成前保持 `pending`。如 `verify_result` 为 `pending`，从头开始验证。

### 1. 改动规模评估

执行规模评估：

```bash
comet state scale <change-name>
```

脚本自动统计任务数、增量规格数、变更文件数，判断使用 light 或 full 验证模式，并设置 verify_mode 字段。判定规则（满足任一即 full）：任务数 > 3、delta spec 能力数 > 1、变更文件数 > 8。

验证开始前，按 `comet/reference/dirty-worktree.md` 协议检查并处理未提交改动。verify 阶段的特殊处理：

1. 若 dirty diff 明确属于当前 change，它就是本次验证输入；继续验证，但不在 verify 阶段修改或提交实现、测试、tasks、delta spec 或 Design Doc
2. 若 dirty diff 只是 verify 本阶段产物（例如验证报告草稿），可继续在 verify 阶段完成并记录状态
3. 若 dirty diff 显示实现已存在但 tasks.md 未勾选，视为 build 状态滞后；这是只有一个合法下一步的自动处理，运行 `verify-fail` 返回 build 核对证据并更新任务状态，不得询问是否接受未完成任务
4. 若 dirty diff 无法归因或属于其他 change，按 dirty-worktree 协议报告停止条件；不要把归因失败伪装成“继续/忽略”决策

需要回到 build 修复或补齐状态时运行：

```bash
comet state transition <change-name> verify-fail
```

注意：如果 build 阶段每个任务都已提交，脚本基于工作区 diff 的文件数可能低估改动规模。此时必须读取 plan 文件头的 `base-ref` 并用提交区间复核：

```bash
comet state get <change-name> plan
git diff --stat <从 plan frontmatter 读取的 base-ref>...HEAD
```

第一条命令返回 plan 路径；使用当前平台的文件读取能力解析其 frontmatter 中唯一的 `base-ref`，确认它是有效提交后再代入第二条命令。不得依赖 POSIX 文本管道。

若提交区间显示改动超过轻量阈值（> 8 个文件、跨模块协调、或 delta spec 超过 1 个 capability），手动设置为完整验证：

```bash
comet state set <change-name> verify_mode full
```

**覆盖机制**：如 agent 或用户认为自动评估结果不合适，可随时通过 `comet state set <change-name> verify_mode <light|full>` 手动覆盖。

### 1b. 验证失败自动修复与例外决策

先运行 `comet state get <change-name> verify_failures` 读取已持久化的连续失败次数。前 3 次可修复失败自动回到 build：报告失败项后运行 `comet state transition <change-name> verify-fail`，再调用 `/comet-build` 修复，不需要用户确认。

报告必须列出：
- 失败项
- 是否属于 CRITICAL 或 IMPORTANT（构建失败、测试失败、安全问题、核心验收场景失败、简化代码审查发现的正确性/安全/边界问题）
- 推荐处理方式

**不确定性原则**：无法确定严重程度时使用较低级别。仅对构建失败、测试失败、安全问题使用 CRITICAL；明确影响核心验收或正确性的项使用 IMPORTANT；模糊或不确定的问题标为 WARNING 或 SUGGESTION。

按以下方式处理：
- **CRITICAL/IMPORTANT 或范围内可明确修复的问题**：未达到上限时自动回到 build 修复；不得创建“是否修复”的伪决策，也不允许接受偏差
- **WARNING/SUGGESTION 且修复会引入行为、范围或风险取舍**：按 `comet/reference/decision-point.md` 让用户选择修复或接受偏差；接受时必须在验证报告中记录原因和影响范围
- **WARNING/SUGGESTION 且修复安全、局部、无取舍**：未达到上限时自动修复，不因级别较低而强制停顿

只有接受 WARNING/SUGGESTION 偏差或第 4 次失败后的策略选择才是用户决策点。当前 `verify_failures >= 3` 时不得自动执行下一次 `verify-fail`；按协议只提供「继续修复」或「停止当前 workflow 并寻求外部决策」两个选项。用户选择继续后才记录下一次失败并回到 build。CRITICAL/IMPORTANT 始终不可豁免。

### 2. 产物上下文加载（Hash 按需读）

验证需要读取 OpenSpec 产物时，先检查产物是否自 design 阶段以来发生变化：

```bash
comet state get <change-name> handoff_hash
comet handoff <change-name> --hash-only
```

- 分别读取两条命令的标准输出；若记录值与当前值相等，且均非空、非 `null`：OpenSpec 产物未变化，**tasks.md 无需重新读取全文**（解析复选框确认无未完成项即可）。proposal.md、design.md、delta spec 仍需读取用于对照检查。
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
6. 代码审查策略：当 `review_mode: standard` 或 `thorough` 时，必须使用 Skill 工具加载 Superpowers `requesting-code-review` 技能，请求只检查正确性、安全、边界条件的轻量代码审查；当 `review_mode: off` 时跳过自动代码审查，并在验证报告中记录跳过原因

若项目没有可自动探测的验证命令，用户或 Agent 必须先自行运行真实验证命令，再单独记录验证证据：

```bash
comet state record-check <change-name> verify --command "<实际运行的验证命令>" --exit-code 0
```

`--command` 只记录命令文本，Comet **绝不会执行该文本**。verify 与 build 证据彼此独立，不能互相替代；即使兼容流程使用 `COMET_SKIP_BUILD=1`，也不能把该绕过标记视为可审计的验证或构建证据。

简化代码审查的输入应限定为本次改动 diff、tasks.md 和必要的测试结果；审查范围只覆盖实现正确性、安全风险和边界条件，不执行 spec 覆盖率、Design Doc 一致性或漂移检查。若审查发现 CRITICAL 或 IMPORTANT 问题，按 Step 1b 的自动修复/重试规则处理。`review_mode: off` 只跳过自动 code review，不跳过构建、测试、安全检查或异常调试协议。

**与 build 阶段审查的去重**：若 build 阶段（`executing-plans` 或 `subagent-driven-development`）已按 `review_mode` 对同一 diff 完成最终代码审查，verify 的这次轻量审查聚焦「实现是否符合 spec/tasks 的正确性」与「build 之后新增的改动」，不重复评审 build 已审过且未变化的 diff。

**通过标准**：6 项全部 OK，无 CRITICAL 或 IMPORTANT 问题。

**不通过时**：报告失败项并按 Step 1b 分类。未达到自动修复上限且问题必须或适合修复时，直接执行以下命令回到 build 阶段，然后调用 `/comet-build`：

```bash
comet state transition <change-name> verify-fail
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

验证不通过时：报告缺失项并按 Step 1b 分类。未达到自动修复上限且缺失项可在当前 change 内补齐时，直接执行以下命令回到 build 阶段，然后调用 `/comet-build`：

```bash
comet state transition <change-name> verify-fail
```

**Spec 漂移处理**（用户决策点）：
- 若检查项 6 发现矛盾（delta spec 有内容但 design doc 未体现），**必须使用当前平台可用的用户输入/确认机制以单选题形式暂停并等待用户选择处理方式**，不得自动选择。选项：
  - 选项 A：在 design doc 追加 "Implementation Divergence" 节记录偏差原因。选项 A 属于 verify 阶段允许产物；写入后不得因该 design doc 变更再次触发 Step 1b dirty-worktree 决策
  - 选项 B：用户选择 B 后，运行 `comet state transition <change-name> verify-fail`，然后调用 `/comet-build`；由 `/comet-build` 的 Spec 增量更新规则加载 Superpowers `brainstorming` 更新 Design Doc + delta spec
  - 选项 C：确认偏差可接受，继续验证（归档时 design doc 将标记为 `superseded-by-main-spec`）

### 3. 记录验证证据

验证报告必须落盘，并在 `.comet.yaml` 中记录。不要在 verify 阶段处理、合并或丢弃分支，也不要写入 `branch_status: handled`；归档会产生必须包含在最终提交中的 spec 和元数据改动，分支收尾统一由 `/comet-archive` 在归档提交后执行。不要手动设置 `verify_result: pass`，由阶段守卫 `--apply` 推进。

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
```

使用当前平台的文件能力创建 `docs/superpowers/reports/` 和报告文件，不依赖 POSIX 专用目录命令。

## 退出条件

- 验证报告通过
- `.comet.yaml` 中 `verification_report` 指向已存在的验证报告文件
- `.comet.yaml` 中 `branch_status` 仍为 `pending`
- **阶段守卫**：运行 `comet guard <change-name> verify --apply`，全部 PASS 后由守卫通过 `comet state transition verify-pass` 推进到 `phase: archive`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

验证证据完成后，运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
comet guard <change-name> verify --apply
```

状态文件自动更新为 `phase: archive`、`verify_result: pass`、`verified_at: YYYY-MM-DD`。

## 上下文压缩恢复

按 `comet/reference/context-recovery.md` 执行，phase 参数为 `verify`。

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续

注意：无论 `NEXT` 为 `auto` 还是 `manual`，`comet-archive` 进入后必须先执行归档前最终确认阻塞点，等待用户明确选择「确认归档」后才允许运行归档脚本。不得因为验证已通过就自动归档。
