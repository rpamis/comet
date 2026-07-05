# Comet 阶段感知（防漂移规则）

> 此规则每轮注入，防止长上下文时遗忘 Comet 流程状态。
> Hook 平台额外执行 `comet-hook-guard.mjs` 进行硬性拦截；
> 此 Rule 是所有平台通用的软性防线。

## 全局规则

### 阶段感知（最高优先级）

有活跃 comet change 时（`openspec/changes/<name>/.comet.yaml` 存在），**每次开始执行操作前**必须读取 `phase` 字段确认当前阶段。

**阶段与允许操作：**

| 阶段 | 允许 | 禁止 |
|------|------|------|
| `open` | 创建 proposal/design/tasks, 运行 guard | 写源代码 |
| `design` | brainstorming, 创建 Design Doc, 运行 guard | 写源代码 |
| `build` | 写源代码、测试、执行计划 | 跳过用户确认点 |
| `verify` | 验证、branch handling | 跳过失败处理 |
| `archive` | 确认归档、运行归档脚本 | 写源代码 |

Hook 硬拦截白名单包括 `openspec/*`、`docs/superpowers/*`、`.superpowers/*`、`.claude/*` 和 `.comet/*` 等流程/平台工作区；这些路径可写不代表可以跳过当前阶段的产物和确认要求。

### 阶段进入自洽性校验（写源代码前必查）

仅看 `phase` 字段不够——还必须确认"是如何到达这个阶段的"。每次准备写源代码前，先用下表自检 `.comet.yaml` 是否处于**非法空跳**状态（绕过了前置阶段）。命中任一行，立即停止写源代码，按动作回到对应阶段补齐产物，不得信任 `phase` 字段直接续跑。

| 检测到 | 判定 | 动作 |
|--------|------|------|
| `phase: build` + `workflow: full` + `design_doc` 为空/null | 绕过 design 空跳 | 停止写源代码，运行 `/comet-design` 补 Design Doc 并过 guard |
| `phase: build` + proposal/design/tasks 任一缺失或为空 | 绕过 open 空跳 | 回 `/comet-open` 补齐三件套 |
| `phase: archive` + `verify_result` ≠ `pass` | 绕过 verify 空跳 | 回 `/comet-verify` 完成验证 |

> 说明：上表只覆盖 hook 硬门实际检测的范围（`design_doc` 空跳在 build 阶段；proposal/design/tasks 三件套完整性在 open→build 的 guard 退出时校验）。`verify` 阶段不在此写源码自洽门内——若 verify 发现产物缺失，按下方「Verify 阶段专项」的 verify-fail 回退处理。

预设例外：`workflow: hotfix/tweak` 本就跳过 design，`design_doc` 为空属正常，不算非法。

升级态说明：预设（hotfix/tweak）命中升级信号并经用户确认升级后，通过 `comet-state transition <name> preset-escalate` 合法地变为 `workflow: full` + `phase: design` + `design_doc: null`。此时 `phase: design` + `design_doc` 为空**属正常升级前置态**，不是非法空跳——agent 应进入 `/comet-design` 补 Design Doc。该终态不命中上表「绕过 design 空跳」行（该行仅检测 `phase: build`）。

### Skill 调用（不可用普通对话替代）

以下操作必须通过 Skill 工具加载，Skill 不可用时应停止流程并提示安装：

- **brainstorming** — design 阶段、build 阶段中等规模 spec 变更
- **writing-plans** — build 阶段创建实现计划
- **executing-plans** / **subagent-driven-development** — build 阶段执行
- **test-driven-development** — `executing-plans` 由主会话在第一个 task 前加载；`subagent-driven-development` 由每个后台 implementer 和修复 agent 加载
- **systematic-debugging** — 遇到崩溃/测试失败/构建失败时
- **verification-before-completion** — verify 阶段
- **using-git-worktrees** — build 阶段选择 worktree 隔离时

### 脚本执行（不可跳过）

- **阶段退出**: `comet-guard <name> <phase> --apply`（必须看到 ALL CHECKS PASSED）
- **压缩恢复**: `comet-state check <name> <phase> --recover`
- **状态更新**: 关键操作后通过 `comet-state set` 更新字段，禁止手工编辑 .comet.yaml
- **阶段推进只能经 guard/transition**: 禁止用 `comet-state set <name> phase <值>` 手动跳阶段（会绕过证据校验，脚本已硬拦截）；确需修复畸形状态时才用 `COMET_FORCE_PHASE=1` 逃生阀。预设（hotfix/tweak）升级到 full 必须用 `comet-state transition <name> preset-escalate`——这是唯一能合法回退 phase 到 design 并同步 workflow/classic_profile 的通道，直接 `set phase design` 和 `set classic_profile` 都会被硬拦截
- **handoff 生成**: `comet-handoff <name> design --write`（禁止手写摘要）

### 用户确认（不可自动跳过）

以下决策点必须暂停等待用户明确选择，不得根据推荐规则自动填写：

- **open**: 需求澄清完成确认、artifact 评审确认
- **design**: brainstorming 方案确认（确认前不得创建 Design Doc）
- **build**: plan-ready 暂停、`isolation` / `build_mode` / `tdd_mode` / `review_mode` 四项选择（工作区隔离、执行方式、TDD 模式、代码审查模式）、spec 大规模变更确认、预设（hotfix/tweak）升级判定二选一（命中质变信号或文件数 tripwire 时，交用户决定继续预设流程还是升级 full）
- **verify**: 验证失败处理策略、branch handling 选择
- **archive**: 归档前最终确认

## Design 阶段专项

1. 第一个脚本操作 = `comet-handoff <name> design --write`（未生成 handoff 禁止加载 brainstorming）
2. brainstorming in progress: incrementally update brainstorm-summary.md（每轮澄清或方案迭代后增量更新恢复检查点，未确认内容标注为待确认/候选）
3. brainstorming 完成后下一步 = brainstorm-summary.md 定稿 → Design Doc → guard
4. active compaction gate: brainstorm-summary.md 定稿后、创建 Design Doc 前，优先触发宿主平台原生上下文压缩；无法程序化触发时暂停提示用户手动压缩或确认继续
5. **绝对不能直接开始写实现代码** — 必须先创建 Design Doc 并通过 guard

## Build 阶段专项

1. plan 创建后必须询问用户选择继续或暂停（`build_pause` 机制）
2. 每个 task 验收后必须: tasks.md 打勾 → git commit（不得积攒）。`subagent-driven-development` 必须按当前 `review_mode` 完成验收，再由协调者按任务唯一文本定向勾选和验证；不得用未完成任务总表代替当前任务验证
3. 遇到失败必须加载 **systematic-debugging** skill，根因未定位前不得提出源码修复
4. spec 变更分级: 小改直接编辑 | 中改加载 brainstorming | 大改暂停等用户确认拆分

## Verify 阶段专项

1. 第一步运行 `comet-state scale <name>` 确定验证级别
2. 验证失败后列出失败项等用户选择，CRITICAL 必须修
3. 连续 3 次失败后必须让用户选择接受偏差或继续修
4. 用户选择修复时运行 `comet-state transition <name> verify-fail`：该转移会把 `phase` 回退到 `build`（不是停在 verify），随后进入 `/comet-build` 修复，修完重新过 build→verify guard

## 上下文压缩恢复

如果怀疑发生上下文压缩（之前对话被摘要、找不到之前讨论的内容），立即运行：

```bash
node "$COMET_STATE" check <name> <phase> --recover
```

按脚本输出的 **Recovery action** 决定下一步。

恢复后必须先用「阶段进入自洽性校验」表复查一遍：若发现 `phase` 与产物不自洽（design_doc/三件套/verify_result 任一不匹配），按非法空跳处理，回对应阶段补齐，不得信任 `phase` 字段直接续跑。

**特别注意 `build_mode`**：若恢复脚本输出 `build_mode: subagent-driven-development`，你是协调者，不是执行者。必须：
1. 使用 Skill 工具重新加载 Superpowers `subagent-driven-development` 技能 (Use the Skill tool to reload the Superpowers `subagent-driven-development` skill)
2. 读取 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展 (re-read `comet/reference/subagent-dispatch.md` for Comet-specific extensions)
3. 读取 `openspec/changes/<name>/.comet/subagent-progress.md` 恢复精确阶段、证据和审查-修复轮次 (Read `openspec/changes/<name>/.comet/subagent-progress.md` to recover the exact stage, evidence, and review-fix round)
4. 禁止在主会话中直接执行 task (Do not execute the pending task directly in the main window)
5. 按检查点恢复；缺失或不匹配时才从第一个未勾选 task 开始
6. 已提交但未按 `review_mode` 完成验收的 task 保持未勾选，继续对应的验证/审查/修复循环
7. task 按 `review_mode` 完成验收并通过定向勾选验证后立即继续下一个 task，不得总结或询问是否继续

## 阶段退出后自动过渡

guard `--apply` 成功后，不得在本规则中硬编码下一阶段 skill。必须先运行：

```bash
comet-state next <change-name>
```

若已通过 `comet-env.mjs` 定位脚本，等价运行：

```bash
node "$COMET_STATE" next <change-name>
```

按脚本输出决定下一步：

- `NEXT: auto` → 使用 Skill 工具加载 `SKILL` 指向的 skill
- `NEXT: manual` → 不加载下一 skill，按 `HINT` 提示用户手动继续
- `NEXT: done` → 流程已完成，无需继续
