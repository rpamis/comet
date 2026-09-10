---
name: comet-verify
description: 'Comet Classic 阶段 4 —— 验证 change、记录证据并驱动修复循环。'
---

# Comet 阶段 4：验证（Verify）

入口返回 layout 后按 `comet-classic/reference/classic-layout.md` 绑定逻辑根；协议已在当前上下文时不重复加载。本文件的 OpenSpec CLI 使用 adapter，文件路径使用绑定的 `<classic-*>` 根，不先额外运行 root show。

## 前置条件

- 代码已提交（阶段 3 完成）
- tasks.md 全部任务已完成

## 步骤

### 0a. 输出语言约束

验证报告使用本轮入口 configuration.language，不额外逐字段查询。

### 0b. 入口状态验证（Entry Check）

按 `comet-classic/reference/scripts.md` 使用稳定 `comet` CLI，然后执行入口验证；从任意入口恢复时先按 `comet-classic/reference/context-recovery.md` 运行恢复检查：

```bash
comet state select <change-name>
comet state check <change-name> verify --json
```

使用入口 layout、configuration、nextAction、任务与协调摘要继续；已有有效检查和集成审查时仅补未完成动作，不重新执行整个阶段。冷恢复需要全量记录时使用 --recover --details --json。验证失败时处理具体原因。

若上述 `select` / `check` 输出 `BLOCKED`，且原因是 `bound_branch` 与当前分支不一致，立即按 `comet-classic/reference/decision-point.md` 暂停，让用户单选：切回绑定分支后重新运行入口验证，或在用户明确确认当前分支应接管该 change 后运行 `comet state rebind <change-name>` 并重新入口验证。不得自行切换分支，不得自行换绑。

**幂等性**：如 `verify_result` 已为 `pass`，应进入 archive；`branch_status` 在归档提交和最终分支处理完成前保持 `pending`。如为 `pending`，核对已有报告和证据，从未完成检查继续。冷恢复按 `evidence.scopes` 处理：`revalidated` 的本地证据可复用，`rerun-required` 的范围重新检查，不重复已完成且仍有效的需求分析与审查。外部检查不假定幂等或环境稳定。

### 1. 改动规模评估

执行规模评估：

```bash
comet state scale <change-name>
```

脚本统计任务数、增量规格数和变更文件数，只返回 light/full 建议，不修改 `verify_mode`。使用 `--json` 读取 `data.recommendation`、`data.selected` 和 `data.metrics`。保留已选验证深度；尚未选择时结合风险确定模式，再用 `comet state set <change-name> verify_mode <light|full>` 明确记录。规模建议为 full 的条件：任务数 > 3、delta spec 能力数 > 1、变更文件数 > 8。

`comet state scale` 会自行从 plan 的 `base-ref` 解析提交基线，并在 plan 不可用时回退到状态中的 `base_ref`；Verify 不再重复读取 plan frontmatter 或手工拼接第二套规模评估。

验证开始前，按 `comet-classic/reference/dirty-worktree.md` 协议检查并处理未提交改动。verify 阶段的特殊处理：

1. 若 dirty diff 明确属于当前 change，它就是本次验证输入；继续验证，但不在 verify 阶段修改或提交实现、测试、tasks、delta spec 或 Design Doc
2. 若 dirty diff 只是 verify 本阶段产物（例如验证报告草稿），可继续在 verify 阶段完成并记录状态
3. 若 dirty diff 显示实现已存在但 tasks.md 未勾选，视为 build 状态滞后；这是只有一个合法下一步的自动处理，运行 `verify-fail` 返回 build 核对证据并更新任务状态，不得询问是否接受未完成任务
4. 若 dirty diff 无法归因或属于其他 change，按 dirty-worktree 协议报告停止条件；不要把归因失败伪装成“继续/忽略”决策

需要回到 build 修复或补齐状态时运行：

```bash
comet state transition <change-name> verify-fail
```

**覆盖机制**：如 agent 或用户认为自动评估结果不合适，可随时通过 `comet state set <change-name> verify_mode <light|full>` 手动覆盖。

规模不是风险豁免：认证授权、数据迁移、并发、公共 API 或跨模块契约即使改动很小，也必须执行对应风险验收；覆盖不足时升级为 full。

### 1b. 验证失败自动修复与例外决策

发生失败时使用最新入口返回的连续失败次数和 nextAction；字段缺失时才查询 `comet state get <change-name> verify_failures`，不把缺失当作零。前 3 次可修复失败自动回到 build：报告失败项后运行 `comet state transition <change-name> verify-fail`，再调用 `/comet-build` 只补缺失实现、检查、审查或勾选，不重复已完成实施。

报告必须列出：

- 失败项
- 是否属于 CRITICAL 或 IMPORTANT（构建失败、测试失败、安全问题、核心验收场景失败、简化代码审查发现的正确性/安全/边界问题）
- 推荐处理方式

**不确定性原则**：无法确定严重程度时使用较低级别。仅对构建失败、测试失败、安全问题使用 CRITICAL；明确影响核心验收或正确性的项使用 IMPORTANT；模糊或不确定的问题标为 WARNING 或 SUGGESTION。

按以下方式处理：

- **CRITICAL/IMPORTANT 或范围内可明确修复的问题**：未达到上限时自动回到 build 修复；不得创建“是否修复”的伪决策，也不允许接受偏差
- **WARNING/SUGGESTION 且修复会引入行为、范围或风险取舍**：按 `comet-classic/reference/decision-point.md` 让用户选择修复或接受偏差；接受时必须在验证报告中记录原因和影响范围
- **WARNING/SUGGESTION 且修复安全、局部、无取舍**：未达到上限时自动修复，不因级别较低而强制停顿

只有接受 WARNING/SUGGESTION 偏差或第 4 次失败后的策略选择才是用户决策点。当前 `verify_failures >= 3` 时不得自动执行下一次 `verify-fail`；按协议只提供「继续修复」或「停止当前 workflow 并寻求外部决策」两个选项。用户选择继续后才记录下一次失败并回到 build。CRITICAL/IMPORTANT 始终不可豁免。

### 2. 产物上下文加载（Hash 按需读）

验证需要读取 OpenSpec 产物时，使用入口已提供的 handoff 状态；入口未提供当前 hash 核对结果时才执行：

```bash
comet handoff <change-name> --hash-only
```

- 将当前 hash 与入口的记录值比较；记录值未提供时才运行 `comet state get <change-name> handoff_hash`。两者相等且均非空、非 null 时，仅在上下文仍保留该版本内容的前提下复用；按当前验收点补读缺失章节，tasks 仍须核对勾选。
- 若 `RECORDED_HASH` 为空、为 `null`、或与 `CURRENT_HASH` 不一致：产物已变化或 hash 未记录，正常读取所有所需文件全文。

hash 相等不代表 Agent 记得内容。冷恢复、摘要截断或缺少已加载记录时重新读取对应事实源；不得用 handoff 摘要替代未加载的验收条款。

autonomous 直接执行本 Skill 的真实检查与证据闭环，不强制加载外部验证 Skill；其他策略使用 Skill 工具加载 Superpowers `verification-before-completion`。任何策略都不能仅凭自评宣布验证通过。

Verify 负责整个 change 的唯一最终集成代码审查。Build 只保留任务级或分段审查；在按 `verify_mode` 分支执行前，先对包含 Build 审查修复在内的最终 diff 执行一次集成审查：

- `review_mode: off`：跳过自动代码审查，并在验证报告中记录原因
- `review_mode: standard|thorough`：派发独立 reviewer，范围覆盖整个 change，核对需求、真实 diff、检查及修复，聚焦正确性、安全和边界条件；autonomous 无需外部审查 Skill，其他策略加载 requesting-code-review 一次。已有覆盖当前最终 diff 的有效审查时复用；输入变化后仅补受影响部分，不无条件重复整轮。审查不可用则停止，不以 implementer 自评替代

集成审查发现 CRITICAL/IMPORTANT 问题时按 Step 1b 返回 Build；非 CRITICAL 偏差按 Step 1b 的取舍规则处理。然后按 `verify_mode` 分支执行：

### 2a. 轻量验证（小改动）

按以下 7 项进行检查：

1. tasks.md 全部任务已完成 `[x]`
2. 改动文件与 tasks.md 描述一致（`git diff --stat` / `git diff --cached --stat` / `git diff --stat <base-ref>...HEAD` 对照 tasks 内容）
3. 编译通过（复用 Runtime 判定仍有效的 Build 证据；失效时重跑）
4. 相关测试通过
5. 无明显安全问题（无硬编码密钥、无新增 unsafe 操作）
6. 最终集成代码审查已通过，或非 full autonomous 的 `review_mode: off` 跳过原因已记录；full autonomous 不允许跳过独立审查
7. 核心成功场景、关键失败/边界场景及命中的高风险契约通过；小改动也不可省略

复用构建时，用 Build 相同的 cwd、程序和参数再次调用 `comet check run <change-name> build --local -- <program> [args...]`；Runtime 返回 `reused=true` 才算复用，输入或环境已变化时会真正重跑。不得仅凭旧对话中的“构建通过”跳过检查。

light/full 均必须通过 Runtime 执行真实验证命令。先记录将要写入的报告路径，避免报告本身使输入指纹失效；测试和验收检查完成后再填写结果：

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
comet check run <change-name> verify --local -- <program> [args...]
```

仅确定性本地检查使用 `--local`。外部服务检查省略该参数，证据只用于一次成功的阶段转换；Guard 预览不消费证据，`--apply` 会重新核对并在成功转换时使其不可再次使用。冷恢复或输入、环境变化后仍按 Runtime 结果重跑。Windows 普通 npm/pnpm shim 由平台适配器处理，包含 shell 元字符的 batch 参数会被拒绝。多条必要命令通过项目已有验证入口统一执行并传播任一失败，不得用最后一条成功掩盖先前失败。手工 `record-check` 仅是声明，不能自动放行。verify 与 build 证据彼此独立，不能互相替代；`COMET_SKIP_BUILD=1` 不是可审计证据。日志按 `logRef` 按需读取。

集成代码审查的输入限定为本次改动 diff、tasks.md 和必要测试结果；它不替代 spec 覆盖率、Design Doc 一致性或漂移检查。`review_mode: off` 只跳过自动 code review，不跳过构建、测试、安全检查或异常调试协议。

**通过标准**：7 项全部 OK，无 CRITICAL 或 IMPORTANT 问题。

**不通过时**：报告失败项并按 Step 1b 分类。未达到自动修复上限且问题必须或适合修复时，直接执行以下命令回到 build 阶段，然后调用 `/comet-build`：

```bash
comet state transition <change-name> verify-fail
```

**报告格式**：简表列出 7 项检查结果、证据引用及 PASS/FAIL。

**跳过项**（不在轻量验证中检查）：

- 全部 spec scenario 的逐条覆盖率统计（核心和高风险场景仍必查）
- design doc 一致性深度比对
- 不影响正确性、安全、边界条件的 code pattern consistency 建议
- delta spec 与 design doc 漂移检测

### 2b. 完整验证（大改动）

当规模评估结果为"大"时：

**立即执行：** 使用 Skill 工具加载 `openspec-verify-change` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 覆写：** 加载后只采用其验证语义；其中任何直接官方 CLI、固定 cwd 或固定物理 OpenSpec 路径都必须替换为 `comet classic openspec -- <args...>` 与 resolver 返回的 `<classic-*>` 逻辑根。

技能加载后，按其指引验证。检查项：

1. tasks.md 全部任务已完成（`[x]`）
2. 实现符合 `<classic-change-dir>/design.md` 高层设计决策
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

- 若检查项 6 发现矛盾（delta spec 有内容但 design doc 未体现），**必须以单选题形式暂停、展示处理方式并等待用户选择**，不得自动选择。选项：
  - 选项 A：在 design doc 追加 "Implementation Divergence" 节记录偏差原因。选项 A 属于 verify 阶段允许产物；写入后不得因该 design doc 变更再次触发 Step 1b dirty-worktree 决策
  - 选项 B：用户选择 B 后，运行 `comet state transition <change-name> verify-fail`，然后调用 `/comet-build`；由 `/comet-build` 的 Spec 增量更新规则加载 Superpowers `brainstorming` 更新 Design Doc + delta spec
  - 选项 C：确认偏差可接受，继续验证（归档时 design doc 将标记为 `superseded-by-main-spec`）

### 3. 记录验证证据

验证报告必须落盘，并在 `.comet.yaml` 中记录。不要在 verify 阶段处理、合并或丢弃分支，也不要写入 `branch_status: handled`；归档会产生必须包含在最终提交中的 spec 和元数据改动，分支收尾统一由 `/comet-archive` 在归档提交后执行。不要手动设置 `verify_result: pass`，由阶段守卫 `--apply` 推进。

```bash
comet state set <change-name> verification_report docs/superpowers/reports/YYYY-MM-DD-<change-name>-verify.md
```

使用文件工具创建 `docs/superpowers/reports/` 和报告文件，不依赖 POSIX 专用目录命令。

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

按 `comet-classic/reference/context-recovery.md` 执行，phase 参数为 `verify`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 执行。关键命令：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续

注意：无论 NEXT 为 auto 还是 manual，归档必须有明确授权；首次归档按 comet-archive 确认，恢复时核对持久化 delivery，不重复询问有效选择。验证通过本身不代表归档授权。
