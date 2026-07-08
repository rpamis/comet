---
name: comet-build
description: "Use when full Comet change 已完成 design 阶段，需要创建/恢复实施计划、选择执行方式或继续 build 阶段任务。"
---

# Comet 阶段 3：计划与构建（Build）

## 前置条件

- Design Doc 已创建（阶段 2 完成）
- 活跃 change 存在

## 步骤

### 0. 入口状态验证（Entry Check）

按 `comet/reference/scripts.md` 定位脚本（定位 `comet-env.mjs`），然后执行入口验证；从任意入口恢复时先按 `comet/reference/context-recovery.md` 运行恢复检查：

```bash
node "$COMET_STATE" check <name> build
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：build 阶段所有操作可安全重复执行。读取 `.comet.yaml` 的 `phase` 字段确认仍在 build 阶段，读取 plan 文件头的 `base-ref`，再用 `grep -n '\- \[ \]' tasks.md | head -1` 找到第一个未勾选任务继续执行。已提交的任务不得重复提交。

### 1. 制定计划（Subagent Offload）

通过 subagent 创建实施计划，避免 planning skill 占用主 session 上下文。计划文件和执行反馈必须使用 `"$COMET_BASH" "$COMET_STATE" get <name> language` 读取到的 Comet 配置产物语言。

**Subagent 指令**：

你是实施计划专家。基于以下输入创建实施计划：

1. **立即执行：** 使用 Skill 工具加载 Superpowers `writing-plans` 技能。禁止跳过此步骤。技能加载后，ARGUMENTS 必须包含：`Language: 使用 "$COMET_BASH" "$COMET_STATE" get <name> language 读取到的 Comet 配置产物语言输出`
2. 读取 Design Doc（`docs/superpowers/specs/` 下的技术设计文档）
3. 读取 `openspec/changes/<name>/tasks.md`（任务边界）
4. 按技能指引创建计划

计划要求：
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

`base-ref` 用于验证阶段跨提交统计改动规模。创建计划时先记录当前提交：

```bash
git rev-parse HEAD
```

将计划写入文件后，返回文件路径。

**执行 subagent**：使用当前平台的 subagent 调度机制派发上述任务。

Subagent 完成后：
- 若返回有效文件路径且文件存在，记录为 plan
- 若 subagent 失败或返回路径无效，在主 session 内联加载 Superpowers `writing-plans` 技能创建计划（降级回退）

### 2. 更新计划状态并提供 plan-ready 暂停点

先记录 plan 路径：

```bash
node "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

无需手动更新 phase，阶段守卫（guard `--apply`）会在退出条件满足后推进 `phase` 字段。

计划写入后，立即提供一个新的用户决策点：

| 选项 | 行为 | 说明 |
|------|------|------|
| A | 继续执行 | 保持在当前模型中，进入 Step 3 选择工作区隔离、执行方式、TDD 模式和代码审查模式 |
| B | 暂停切换模型 | 记录 `build_pause: plan-ready`，本次 `/comet-build` 停止，用户稍后可从 `/comet` 或 `/comet-build` 恢复 |

这是用户决策点。**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择**，不得自动继续，也不得把暂停写入 `build_mode`。

用户选择继续时：

```bash
node "$COMET_STATE" set <name> build_pause null
```

用户选择暂停时：

```bash
node "$COMET_STATE" set <name> build_pause plan-ready
```

设置 `build_pause: plan-ready` 后，当前调用停止。不要选择 `isolation` 或 `build_mode`，不要加载执行技能。

### 3. 选择工作方式

如果恢复时检测到 `build_pause: plan-ready` 且 `plan` 文件存在，不要重新运行 `writing-plans`。先告知用户当前停在 plan-ready 暂停点；用户确认继续后，设置：

```bash
node "$COMET_STATE" set <name> build_pause null
```

然后继续本步骤选择工作区隔离、执行方式、TDD 模式和代码审查模式。

计划已写入当前分支。在开始执行前，**一次性询问用户**选择工作区隔离方式、执行方式、TDD 模式和代码审查模式：

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
| A | Superpowers `subagent-driven-development` | 任务独立、复杂度高；每个任务在隔离的 implementer subagent 中执行，审查由 `review_mode` 驱动 |
| B | Superpowers `executing-plans` | 任务简单、无子agent环境、轻量快速 |

**执行方式推荐规则**：
- 任务数 ≥ 3 → 推荐 A
- 任务数 ≤ 2 且无跨模块依赖 → 推荐 B
- 来自 hotfix 路径 → 推荐 B

这是用户决策点。**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户明确选择隔离方式、执行方式、TDD 模式和代码审查模式**，不得根据推荐规则自行选择 `branch` 或 `worktree`，也不得根据推荐规则自行选择执行方式、TDD 模式或代码审查模式。推荐规则只能用于说明建议，不能替代用户确认。

用户选择后，更新 `isolation`、执行方式、TDD 模式和代码审查模式相关字段：

```bash
node "$COMET_STATE" set <name> isolation <branch|worktree>
```

- 若用户选择 `executing-plans`：运行 `node "$COMET_STATE" set <name> subagent_dispatch null`，再运行 `node "$COMET_STATE" set <name> build_mode executing-plans`
- 若用户选择 `subagent-driven-development`：先确认当前平台存在可调用的真实后台 subagent / Task / multi-agent 调度能力；确认后先运行 `node "$COMET_STATE" set <name> subagent_dispatch confirmed`，再运行 `node "$COMET_STATE" set <name> build_mode subagent-driven-development`
- 若无法确认真实后台调度能力，不得写入 `build_mode: subagent-driven-development`；必须暂停等待用户改选 `executing-plans`

**TDD 模式**：

| 选项 | 含义 | 适用场景 |
|------|------|---------|
| `tdd` | 每个任务先写失败测试再写实现 | 推荐。变更涉及业务逻辑、新功能、API |
| `direct` | 直接实现，不强制 TDD 流程 | 变更不需要测试覆盖，或用户选择跳过测试直接写代码。hotfix/tweak 预设默认使用 `direct` |

运行 `node "$COMET_STATE" set <name> tdd_mode <tdd|direct>`

**代码审查模式**：

| 选项 | 含义 | 适用场景 |
|------|------|---------|
| `off` | 不自动派发代码审查 | 文档、配置、文案、小范围低风险任务 |
| `standard` | 默认不为每任务派发 reviewer，仅当任务命中风险信号时派发每任务 reviewer，外加一次最终轻量代码审查 | 默认推荐，适合大多数普通改动 |
| `thorough` | 为每个任务派发每任务 reviewer（spec + quality），外加一次最终完整审查 | 高风险、多模块、架构或安全相关改动 |

运行 `node "$COMET_STATE" set <name> review_mode <off|standard|thorough>`

`isolation` 是脚本级硬约束。full workflow 初始化时可以为 `null`，但只允许存在到本步骤之前。若保持 `null`，`build → verify` 的 guard 和 `comet-state transition build-complete` 都会失败。

`subagent_dispatch` 是脚本级硬约束。`build_mode: subagent-driven-development` 离开 build 阶段前必须同时满足 `subagent_dispatch: confirmed`，否则 `comet-guard.mjs build --apply` 和 `comet-state transition build-complete` 都会失败。

`tdd_mode` 是脚本级硬约束。full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`，否则 `comet-guard.mjs build --apply` 和 `comet-state transition build-complete` 都会失败。

`review_mode` 是脚本级硬约束。新建 full workflow 离开 build 阶段前 `review_mode` 必须已选择为 `off`、`standard` 或 `thorough`，否则 `comet-guard.mjs build --apply` 和 `comet-state transition build-complete` 都会失败。旧状态文件若没有该字段，按兼容路径继续，但恢复时应补写该字段。

`build_mode` 默认仅 hotfix/tweak 预设使用 `direct`。full workflow 不得默认使用 `direct`。只有用户明确要求跳过计划执行技能，且你已记录显式 override 时，才允许：

```bash
node "$COMET_STATE" set <name> direct_override true
node "$COMET_STATE" set <name> build_mode direct
```

没有 `direct_override: true` 时，full workflow 的 `build_mode=direct` 会被 guard 和状态转换同时拦截。

**执行隔离**：

- **branch**：根据 workflow 类型和当前日期推荐分支名，然后让用户确认或输入自定义名称。这是用户决策点——**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确确认或覆盖分支名**，不得跳过此步骤直接创建分支。

  分支命名规范：
  - 读取 `.comet.yaml` 的 `workflow` 字段确定前缀
  - `workflow: full` → 推荐 `feature/YYYYMMDD/<change-name>`
  - `workflow: hotfix` → 推荐 `hotfix/YYYYMMDD/<change-name>`
  - `workflow: tweak` → 推荐 `tweak/YYYYMMDD/<change-name>`
  - 日期取运行时 `date +%Y%m%d` 的结果

  示例：如果 change 名称为 `fix-login-bug`，今天是 2026-06-09，则推荐 `feature/20260609/fix-login-bug`

  用户确认或提供自定义分支名后，执行 `git checkout -b <branch-name>`，后续工作在新分支上进行。

- **worktree**：必须使用 Skill 工具加载 Superpowers `using-git-worktrees` 技能创建隔离工作区。禁止用普通 shell 命令或原生工具绕过该技能；如该技能不可用，停止流程并提示安装或启用 Superpowers 技能。

创建隔离后，确认计划文件可访问（分支方式天然可访问；worktree 方式需确认计划已提交）。若 worktree 模式下计划文件尚未提交，先提交计划文件再创建 worktree：

```bash
git add docs/superpowers/plans/YYYY-MM-DD-feature.md
git commit -m "chore: add implementation plan"
```

**执行计划**：必须按 `build_mode` 的真实运行位置处理。

- `build_mode: executing-plans`：**立即执行：** 使用 Skill 工具加载 Superpowers `executing-plans` 技能。禁止跳过此步骤。若该技能不可用，停止流程并提示安装或启用对应技能，不要用普通对话替代该步骤。技能加载后，ARGUMENTS 必须包含与 Step 1 相同的 Language 约束：`Language: 使用 "$COMET_BASH" "$COMET_STATE" get <name> language 读取到的 Comet 配置产物语言输出`。按计划执行。
- `build_mode: subagent-driven-development`：主会话只负责协调，禁止直接编写实现代码。**立即执行：** 使用 Skill 工具加载 Superpowers `subagent-driven-development` 技能。技能加载后，读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展（真实后台调度、任务隔离、勾选验证、TDD 约束、连续执行、上下文恢复），与技能工作流配合应用。若两者发生冲突，以更具体的 Comet 扩展为准。
- 如果当前平台没有真实后台 agent 调度能力，必须暂停并等待用户选择改用主窗口执行。用户选择改用主窗口执行后，必须先运行 `node "$COMET_STATE" set <name> build_mode executing-plans`，再按 `build_mode: executing-plans` 分支加载 Superpowers `executing-plans` 技能。用户未明确选择前，不得继续执行任务。

**TDD 模式执行约束**：

若 `tdd_mode: tdd`：
- `build_mode: executing-plans`：加载执行技能后、执行第一个任务前，**立即执行：** 使用 Skill 工具加载 Superpowers `test-driven-development` 技能一次。禁止跳过此步骤。技能加载后，从第一个未勾选任务开始，对每个任务遵循已加载的 TDD Red-Green-Refactor 循环执行。不得跳过失败测试验证阶段。后续任务不再重新加载该技能，直接遵循已加载流程。若上下文压缩后恢复，重新运行本步骤加载 TDD 技能一次，然后从第一个未勾选任务继续。
- `build_mode: subagent-driven-development`：主会话不加载 TDD skill；TDD 约束和证据门槛已在 `comet/reference/subagent-dispatch.md` 中定义，每个后台 implementer 和修复 agent 必须自行使用 Skill 工具加载 Superpowers `test-driven-development` 技能，并遵循 Comet 注入的 TDD 硬约束。

若 `tdd_mode: direct`：按正常流程执行，不强制 TDD。

**`executing-plans` review gate**：

在 `executing-plans` 下，主会话直接执行任务（没有隔离的 implementer subagent），因此不存在 `subagent-driven-development` 那样的每任务 reviewer。代码审查针对已完成的 diff 进行，并按 `review_mode` 分级：

- **`review_mode: off`**：不自动代码审查。不加载 `requesting-code-review`。在验证报告草稿或 tasks.md 中记录跳过原因。
- **`review_mode: standard`**：在所有计划任务完成后、运行 build → verify 阶段守卫前，使用 Skill 工具加载 Superpowers `requesting-code-review` 技能一次，请求一次轻量代码审查（正确性、安全、边界），范围覆盖整个 change。
- **`review_mode: thorough`**：除最终那次审查外，按任务分段每 3 个任务请求一次分段代码审查（范围限于该段的 diff）。若总任务数 ≤ 3，跳过执行中分段，只做最终审查。每次分段审查用 `requesting-code-review` 针对该段的提交区间进行。这是 `executing-plans` 下最接近 `subagent-driven-development` 每任务审查的等价物，因为它没有隔离的 implementer 可供逐任务审查。

要求（适用于 `standard` 和 `thorough`）：
- `requesting-code-review` 技能必须在 `node "$COMET_GUARD" <change-name> build --apply` 之前加载
- 若 `requesting-code-review` 技能不可用，跳过 review gate 但必须在 tasks.md 中记录 `<!-- review skipped: skill unavailable -->`，并继续 guard 流转
- CRITICAL review 发现（安全漏洞、数据丢失风险、构建/测试失败）必须先修复，不得带入 verify
- 非 CRITICAL review 发现如选择接受，必须在 tasks.md、commit body、验证报告草稿或其他持久产物中记录接受原因和影响范围

### 3b. 执行中异常调试（异常调试协议）

执行任务期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

具体调查、最小失败测试、修复验证和保持当前 change 验证闭环的要求，按 `comet/reference/debug-gate.md` 执行。

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

| 规模 | 触发条件 | 做法 |
|------|---------|------|
| 小 | 遗漏验收场景、边界条件 | 直接编辑 delta spec + design.md，追加 tasks.md 任务 |
| 中 | 接口变更、新增组件、数据流变化 | **使用当前平台可用的用户输入/确认机制暂停并等待用户确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming` 更新 Design Doc + delta spec |
| 大 | 全新 capability 需求 | **必须使用当前平台可用的用户输入/确认机制暂停并等待用户确认拆分**；用户确认后，通过 `/comet-open` 创建独立 change |

**50% 阈值判定**：以 tasks.md 初始任务总数为基准，若新增任务数超过该总数的一半，视为超出原计划范围，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户决定是否拆分为新 change**。

创建独立 change 时必须调用 `/comet-open`，不得直接调用 `/opsx:new`。`/comet-open` 会同时创建 OpenSpec 产物和 `.comet.yaml`，避免新 change 脱离 Comet 状态机。

**用户选择必须包含**：
- 「拆分为新 change」— 通过 `/comet-open` 创建独立 change
- 「继续在当前 change 内完成」— 记录范围扩展决策，更新 tasks.md 和 delta spec 后继续

**原则**：
- delta spec 是活文档，本阶段期间随时可修改
- 每次更新应提交，commit message 说明变更原因
- 不提前同步到 main spec，归档时统一同步
- 小规模增量直接改 delta spec 时，应在 commit message 中注明，便于归档时判断 design doc 漂移

### 5. 上下文管理

Build 是最长阶段，可能跨越大量任务。为支持上下文压缩后断点恢复：

- **每完成一个 task**：按当前执行分支和 `review_mode` 完成验收后再勾选对应任务并提交。`subagent-driven-development` 在 `off` 时不派发每任务 reviewer；`standard` 下仅当任务命中风险信号时派发；`thorough` 下每个任务都派发每任务 reviewer。所有模式都必须按任务唯一文本完成定向检查。可用 `grep -c '\- \[ \]' tasks.md` 检查剩余未勾选数，无需重新读取整个文件
- **上下文压缩后恢复**：按 `comet/reference/context-recovery.md` 执行，phase 参数为 `build`。
- **用户手动修改恢复**：按 `comet/reference/dirty-worktree.md` 协议处理未提交改动。该协议定义了检查步骤、归因分类和禁令。build 阶段的特殊处理：
  1. 归因后，若 diff 暗示计划或 spec 已变化，按 Step 4「Spec 增量更新」分级处理
- **长任务拆分**：单任务超过 200 行代码变更时，考虑拆分为多个子任务分别提交

## 退出条件

- tasks.md 全部勾选
- 代码已提交
- 已显式运行项目对应的构建/测试命令并通过（不要只依赖 guard 自动猜测）
- `isolation` 已写为 `branch` 或 `worktree`
- `build_mode` 已写为 `subagent-driven-development`、`executing-plans` 或带显式 override 的 `direct`；若为 `subagent-driven-development`，`subagent_dispatch` 必须为 `confirmed`
- `tdd_mode` 已写为 `tdd` 或 `direct`
- `review_mode` 已写为 `off`、`standard` 或 `thorough`
- 已按所选 `review_mode` 完成"执行计划"章节中 executing-plans review gate 规定的代码审查：`standard` 或 `thorough` 下已请求代码审查且 CRITICAL review 发现已修复、非 CRITICAL review 发现已记录接受理由；`review_mode: off` 下已在持久产物中记录跳过自动代码审查的原因
- **阶段守卫**：运行 `node "$COMET_GUARD" <change-name> build --apply`，全部 PASS 后由守卫推进到 `phase: verify`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

Guard 会运行自动探测到的项目构建检查（检测到时使用 `npm run build`、Maven 或 Cargo）。构建失败时 guard 会打印失败命令输出，作为排查证据。

退出前运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
node "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
node "$COMET_STATE" next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
