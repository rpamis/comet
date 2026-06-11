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
"$COMET_BASH" "$COMET_STATE" check <name> build
```

验证通过后继续 Step 1。验证失败时脚本会输出具体失败原因。

**幂等性**：build 阶段所有操作可安全重复执行。读取 `.comet.yaml` 的 `phase` 字段确认仍在 build 阶段，读取 plan 文件头的 `base-ref`，再用 `grep -n '\- \[ \]' tasks.md | head -1` 找到第一个未勾选任务继续执行。已提交的任务不得重复提交。

### 1. 制定计划（Subagent Offload）

通过 subagent 创建实施计划，避免 planning skill 占用主 session 上下文。计划文件和执行反馈必须使用触发本次工作流的用户请求语言。

**Subagent 指令**：

你是实施计划专家。基于以下输入创建实施计划：

1. **立即执行：** 使用 Skill 工具加载 Superpowers `writing-plans` 技能。禁止跳过此步骤。技能加载后，ARGUMENTS 必须包含：`Language: 使用触发本次工作流的用户请求语言输出`
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
"$COMET_BASH" "$COMET_STATE" set <name> plan docs/superpowers/plans/YYYY-MM-DD-feature.md
```

无需手动更新 phase，阶段守卫（guard `--apply`）会在退出条件满足后推进 `phase` 字段。

计划写入后，立即提供一个新的用户决策点：

| 选项 | 行为 | 说明 |
|------|------|------|
| A | 继续执行 | 保持在当前模型中，进入 Step 3 选择工作区隔离和执行方式 |
| B | 暂停切换模型 | 记录 `build_pause: plan-ready`，本次 `/comet-build` 停止，用户稍后可从 `/comet` 或 `/comet-build` 恢复 |

这是用户决策点。**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确选择**，不得自动继续，也不得把暂停写入 `build_mode`。若当前平台没有结构化提问工具，则在对话中提出同等选项并停止流程，等待用户回复后才能继续。

用户选择继续时：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause null
```

用户选择暂停时：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause plan-ready
```

设置 `build_pause: plan-ready` 后，当前调用停止。不要选择 `isolation` 或 `build_mode`，不要加载执行技能。

### 3. 选择工作方式

如果恢复时检测到 `build_pause: plan-ready` 且 `plan` 文件存在，不要重新运行 `writing-plans`。先告知用户当前停在 plan-ready 暂停点；用户确认继续后，设置：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> build_pause null
```

然后继续本步骤选择工作区隔离和执行方式。

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
| A | Superpowers `subagent-driven-development` | 任务独立、复杂度高、需要双阶段审查 |
| B | Superpowers `executing-plans` | 任务简单、无子agent环境、轻量快速 |

**执行方式推荐规则**：
- 任务数 ≥ 3 → 推荐 A
- 任务数 ≤ 2 且无跨模块依赖 → 推荐 B
- 来自 hotfix 路径 → 推荐 B

这是用户决策点。**必须使用当前平台可用的用户输入/确认机制暂停并等待用户明确选择隔离方式、执行方式和 TDD 模式**，不得根据推荐规则自行选择 `branch` 或 `worktree`，也不得根据推荐规则自行选择执行方式或 TDD 模式。推荐规则只能用于说明建议，不能替代用户确认。若当前平台没有结构化提问工具，则在对话中提出同等选项并停止流程，等待用户回复后才能继续。

用户选择后，更新 `isolation`、执行方式和 TDD 模式相关字段：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> isolation <branch|worktree>
```

- 若用户选择 `executing-plans`：运行 `"$COMET_BASH" "$COMET_STATE" set <name> subagent_dispatch null`，再运行 `"$COMET_BASH" "$COMET_STATE" set <name> build_mode executing-plans`
- 若用户选择 `subagent-driven-development`：先确认当前平台存在可调用的真实后台 subagent / Task / multi-agent 调度能力；确认后先运行 `"$COMET_BASH" "$COMET_STATE" set <name> subagent_dispatch confirmed`，再运行 `"$COMET_BASH" "$COMET_STATE" set <name> build_mode subagent-driven-development`
- 若无法确认真实后台调度能力，不得写入 `build_mode: subagent-driven-development`；必须暂停等待用户改选 `executing-plans`

**TDD 模式**：

| 选项 | 含义 | 适用场景 |
|------|------|---------|
| `tdd` | 每个任务先写失败测试再写实现 | 推荐。变更涉及业务逻辑、新功能、API |
| `direct` | 直接实现，不强制 TDD 流程 | 变更不需要测试覆盖，或用户选择跳过测试直接写代码。hotfix/tweak preset 默认使用 `direct` |

运行 `"$COMET_BASH" "$COMET_STATE" set <name> tdd_mode <tdd|direct>`

`isolation` 是脚本级硬约束。full workflow 初始化时可以为 `null`，但只允许存在到本步骤之前。若保持 `null`，`build → verify` 的 guard 和 `comet-state transition build-complete` 都会失败。

`subagent_dispatch` 是脚本级硬约束。`build_mode: subagent-driven-development` 离开 build 阶段前必须同时满足 `subagent_dispatch: confirmed`，否则 `comet-guard.sh build --apply` 和 `comet-state transition build-complete` 都会失败。

`tdd_mode` 是脚本级硬约束。full workflow 离开 build 阶段前 `tdd_mode` 必须已选择为 `tdd` 或 `direct`，否则 `comet-guard.sh build --apply` 和 `comet-state transition build-complete` 都会失败。

`build_mode` 默认仅 hotfix/tweak preset 使用 `direct`。full workflow 不得默认使用 `direct`。只有用户明确要求跳过计划执行技能，且你已记录显式 override 时，才允许：

```bash
"$COMET_BASH" "$COMET_STATE" set <name> direct_override true
"$COMET_BASH" "$COMET_STATE" set <name> build_mode direct
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

- `build_mode: executing-plans`：**立即执行：** 使用 Skill 工具加载 Superpowers `executing-plans` 技能。禁止跳过此步骤。若该技能不可用，停止流程并提示安装或启用对应技能，不要用普通对话替代该步骤。技能加载后，ARGUMENTS 必须包含与 Step 1 相同的 Language 约束：`Language: 使用触发本次工作流的用户请求语言输出`。按计划执行。
- `build_mode: subagent-driven-development`：主窗口只负责协调，不得把 `subagent-driven-development` 当作当前主窗口的执行技能直接运行；必须使用已确认的当前平台真实后台 subagent / Task / multi-agent 调度能力，把下一个未完成任务派发到后台 subagent。派发每个 subagent 时，必须在 prompt 中明确要求：技能加载后 ARGUMENTS 必须包含与 Step 1 相同的 Language 约束：`Language: 使用触发本次工作流的用户请求语言输出`；任务完成并通过验证后，立即勾选 `docs/superpowers/plans/<plan-file>.md` 中对应的计划任务；若该计划任务映射到 `openspec/changes/<name>/tasks.md` 中的任务，也同步将该 OpenSpec 任务从 `- [ ]` 改为 `- [x]`；若 plan 新增了 OpenSpec 中没有的一步，只勾选 plan 中对应任务即可。不得只更新内置 Todo 或对话内 checklist。后台 subagent 需要自行加载 Superpowers `subagent-driven-development` 相关执行流程，并按其指引完成实现、检查和提交。
- 如果当前平台没有真实后台 subagent / Task / multi-agent 调度能力，必须暂停并等待用户选择改用主窗口执行。用户选择改用主窗口执行后，必须先运行 `"$COMET_BASH" "$COMET_STATE" set <name> build_mode executing-plans`，再按 `build_mode: executing-plans` 分支加载 Superpowers `executing-plans` 技能。用户未明确选择前，不得继续执行任务。

执行开始后，按所选分支完成：
- 按计划执行任务
- 完成 Superpowers plan 对应任务勾选；若任务映射到 OpenSpec tasks.md，也勾选对应 OpenSpec 任务（`- [ ]` → `- [x]`）
- 每个任务完成后提交代码

**TDD 模式执行约束**：

若 `tdd_mode: tdd`：
- `build_mode: executing-plans`：加载执行技能后、执行第一个任务前，**立即执行：** 使用 Skill 工具加载 Superpowers `test-driven-development` 技能一次。禁止跳过此步骤。技能加载后，从第一个未勾选任务开始，对每个任务遵循已加载的 TDD Red-Green-Refactor 循环执行。不得跳过失败测试验证阶段。后续任务不再重新加载该技能，直接遵循已加载流程。若上下文压缩后恢复，重新运行本步骤加载 TDD 技能一次，然后从第一个未勾选任务继续。
- `build_mode: subagent-driven-development`：派发每个 subagent 时，必须在 prompt 中注入 TDD 硬约束：**"You MUST follow TDD: for each task, write a failing test first, watch it fail, then write minimal code to pass. No production code without a failing test first."**。同一个 prompt 还必须包含上述 OpenSpec tasks.md 与 Superpowers plan 持久化勾选要求。不得依赖 implementer-prompt.md 的条件触发，必须在派发 prompt 中显式写出。

若 `tdd_mode: direct`：按正常流程执行，不强制 TDD。

**`executing-plans` review gate**：

当 `build_mode` 为 `executing-plans` 时，在所有计划任务完成后、运行 build → verify 阶段守卫前，必须使用 Skill 工具加载 Superpowers `requesting-code-review` 技能并至少请求一次代码审查。

要求：
- `requesting-code-review` 技能必须在 `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply` 之前加载
- 若 `requesting-code-review` 技能不可用，跳过 review gate 但必须在 tasks.md 中记录 `<!-- review skipped: skill unavailable -->`，并继续 guard 流转
- CRITICAL review 发现（安全漏洞、数据丢失风险、构建/测试失败）必须先修复，不得带入 verify
- 非 CRITICAL review 发现如选择接受，必须在 tasks.md、commit body、验证报告草稿或其他持久产物中记录接受原因和影响范围

### 3b. 执行中异常调试（Debug Gate）

执行任务期间，只要运行程序、测试、构建或手动验证时出现崩溃、异常行为、测试失败或构建失败，必须使用 Skill 工具加载 Superpowers `systematic-debugging` 技能。在完成根因调查前，不得提出或实施源码修复。

按 `systematic-debugging` 的四阶段流程处理：
- 先复现并定位根因，读取完整错误、检查近期变更、追踪数据流
- 若根因指向源码 bug，先补充能复现该崩溃/异常的最小失败测试，再修改源码
- 修复后运行该失败测试、相关测试和项目构建/验证命令，确认全部通过
- 将测试、源码修复和 tasks.md 勾选保留在当前 change 内；不得通过另起一个“写测试用例”的 change 来替代当前 change 的验证闭环

### 4. Spec 增量更新

实施过程中发现初版 spec 不完整时，按变更规模分级处理：

| 规模 | 触发条件 | 做法 |
|------|---------|------|
| 小 | 遗漏验收场景、边界条件 | 直接编辑 delta spec + design.md，追加 tasks.md 任务 |
| 中 | 接口变更、新增组件、数据流变化 | **使用当前平台可用的用户输入/确认机制暂停并等待用户确认后**，必须使用 Skill 工具加载 Superpowers `brainstorming` 更新 Design Doc + delta spec |
| 大 | 全新 capability 需求 | **必须使用当前平台可用的用户输入/确认机制暂停并等待用户确认拆分**；用户确认后，通过 `/comet-open` 创建独立 change |

**50% 阈值判定**：以 tasks.md 初始任务总数为基准，若新增任务数超过该总数的一半，视为超出原计划范围，**必须使用当前平台可用的用户输入/确认机制暂停并等待用户决定是否拆分为新 change**。若当前平台没有结构化提问工具，则在对话中提出拆分选项并停止流程，等待用户回复后才能继续。

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

- **每完成一个 task**：立即勾选 Superpowers plan 中的对应任务；若任务映射到 OpenSpec tasks.md，也勾选对应 OpenSpec 任务；然后提交代码，确保 `.comet.yaml` 和文件状态持久化。用 `grep -c '\- \[ \]' tasks.md` 检查剩余未勾选数，无需重新读取整个文件
- **上下文压缩后恢复**：先运行 `"$COMET_BASH" "$COMET_STATE" check <change-name> build --recover`，脚本输出结构化恢复上下文（isolation/build_mode 状态、plan 路径、任务完成进度、恢复动作）。根据 Recovery action 决定下一步。
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
- 若 `build_mode` 为 `executing-plans`，已使用 Skill 工具加载 Superpowers `requesting-code-review` 技能并至少请求一次代码审查，且 CRITICAL review 发现已修复或非 CRITICAL review 发现已记录接受理由
- **阶段守卫**：运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply`，全部 PASS 后由守卫推进到 `phase: verify`（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

Guard 会优先读取项目配置中的命令：

```yaml
build_command: <build command>
verify_command: <verify command>
```

配置位置可为 change 的 `.comet.yaml`，也可为仓库根目录的 `.comet.yaml` / `comet.yaml` / `.comet.yml` / `comet.yml`。
未配置时才回退到 `npm run build`、Maven 或 Cargo 的默认探测。构建失败时 guard 会打印失败命令输出，作为排查证据。

退出前运行阶段守卫推进 phase（此步骤与 `auto_transition` 无关）：

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`。

## 自动衔接下一阶段

> **术语区分**：上面的「阶段守卫推进」由 guard `--apply` 完成，更新 `.comet.yaml` 的 `phase` 字段——这一步**始终发生**，与 `auto_transition` 无关。本节的「自动衔接」只决定**是否自动调用下一个 skill**，由 `auto_transition` 控制。

退出条件满足且阶段守卫推进 phase 后，运行：

```bash
"$COMET_BASH" "$COMET_STATE" next <change-name>
```

脚本根据 `phase`、`workflow`、`auto_transition` 输出确定性的下一步：
- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
