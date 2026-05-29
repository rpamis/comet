---
name: comet-tweak
description: "Comet 预设路径：非 bug 的小改动（tweak）。跳过 brainstorming 和完整 plan，直接 open → lightweight build → light verify → archive。适用于文案、配置、文档或 prompt 的局部优化。"
---

# Comet 预设路径：Tweak

Tweak 是 Comet 五阶段能力的预设工作流，不是独立的平行流程。它复用 open、build、verify、archive 能力，仅跳过 brainstorming 和完整 plan。

适用于非 bug 的小范围变更，例如文案调整、配置调整、文档或 prompt 的局部优化。

**适用条件**（必须全部满足）：
1. 不新增 capability
2. 不改变架构
3. 不涉及接口变化
4. 通常不超过 3 个 tasks、4 个文件

**不适用**：如变更过程中发现需要 capability、架构或接口调整，应升级为完整 `/comet` 流程。

---

## 流程（preset workflow，4 阶段）

执行链路：open → lightweight build → light verify → archive。Tweak 为每个阶段提供默认决策：精简开启、轻量构建、轻量验证、验证通过后归档。

开始前先定位 Comet 脚本：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

### 1. 快速开启（preset open）

复用 Comet open 能力创建 change，但使用 tweak 默认值：不执行 `openspec-explore` 长探索，直接进入精简 change 创建。

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

技能加载后，按其指引创建精简版产物：
  - `proposal.md` — 变更动机 + 目标 + 范围
  - `design.md` — 简短实现说明（无需方案对比）
  - `tasks.md` — 不超过 3 个任务
- **无需 delta spec**（除非变更改变了已有 spec 的验收场景；一旦需要 delta spec，升级为完整 `/comet`）

初始化 Comet 状态文件：

```bash
bash "$COMET_STATE" init <name> tweak
```

初始化后验证状态：

```bash
bash "$COMET_STATE" check <name> open
```

阶段守卫完成 open → build 过渡：

```bash
bash "$COMET_GUARD" <change-name> open --apply
```

### 2. 轻量构建（preset build）

使用 tweak 默认值：`build_mode: direct`。跳过 `superpowers:brainstorming` 和 `superpowers:writing-plans`。

继续或开始修改前，按 `comet/reference/dirty-worktree.md` 协议处理未提交改动。若归因后发现范围超出 tweak，按本文件“升级条件”处理。

**立即执行：** 按 tasks.md 逐个执行任务：

1. 读取 `openspec/changes/<name>/tasks.md`，获取未完成任务列表
2. 对每个未完成任务：
   - 根据任务描述修改目标文件
   - 运行项目格式化命令（如 `mvn spotless:apply`、`npm run format` 等）
   - 运行相关测试确认通过
   - 将 tasks.md 中对应 `- [ ]` 勾选为 `- [x]`
   - 提交代码，commit message 格式：`tweak: <简述变更>`
3. 全部任务完成后，显式运行项目相关测试和构建命令
4. 运行阶段守卫完成 build → verify 过渡：

```bash
bash "$COMET_GUARD" <change-name> build --apply
```

状态文件自动更新为 `phase: verify`、`verify_result: pending`，然后进入验证。

### 3. 轻量验证（preset verify）

复用 `/comet-verify`。Tweak 必须保持轻量验证条件：≤ 3 tasks、≤ 4 files、无 delta spec、无新 capability。

**立即执行：** 使用 Skill 工具加载 `comet-verify` 技能。禁止跳过此步骤。

如规模评估进入完整验证路径，停止 tweak，按升级条件阻塞确认处理。

验证通过后，按 `/comet-verify` 的规则将 `.comet.yaml` 的 `verify_result` 记录为 `pass`，归档前不得跳过该状态。

### 4. 归档（preset archive）

复用 `/comet-archive`。归档前必须满足 `.comet.yaml` 中 `verify_result: pass`。

**立即执行：** 使用 Skill 工具加载 `comet-archive` 技能进行归档。禁止跳过此步骤。

---

## 连续执行模式

<IMPORTANT>
Tweak 流程为 **一次性连续执行**。调用 `/comet-tweak` 后，agent 在 tweak 自有步骤间自动推进，不主动停顿。但以下情况必须暂停等待用户确认：

1. 遇到升级条件（见"升级条件"章节），**必须使用 AskUserQuestion 工具暂停并等待用户明确确认**升级为完整流程
2. 验证阶段（comet-verify）的验证失败决策和分支处理决策

执行顺序：快速开启 → 轻量构建 → 轻量验证 → 归档 → 完成

每个阶段完成后立即进入下一阶段。阶段内部仍必须按上文要求调用对应 Comet/OpenSpec/Superpowers skill，被调用的 skill 如有自己的用户决策点，按该 skill 规则执行。
</IMPORTANT>

---

## 升级条件

满足以下**任一**条件时，停止 tweak 流程，升级为完整 `/comet`：

| 条件 | 说明 |
|------|------|
| 改动涉及 **5+ 文件** | 超出小改动范围 |
| 多模块协调修改 | 需要跨组件协调 |
| 需要新增测试用例 **5+** | 变更复杂度上升 |
| 配置项新增或删除 | 非值修改的配置变更 |
| 需要新增 capability | 超出局部优化 |
| 需要 delta spec | 影响了已有规格 |

满足升级条件时**必须使用 AskUserQuestion 工具暂停并等待用户明确确认**升级为完整 `/comet` 流程。不得直接进入 `/comet-design`，不得自动补充 Design Doc。不得仅输出文字提示后继续执行。

用户确认升级后，**必须先更新 workflow 字段**再进入完整流程：

```bash
bash "$COMET_STATE" set <name> workflow full
```

然后在当前 change 基础上补充 Design Doc：**立即使用 Skill 工具加载 `comet-design` skill**，后续正常走完整流程。若用户不确认升级，停止 tweak 并报告当前变更已超出 tweak 适用范围。

---

## 退出条件

- 小改动已完成，测试通过
- change 已归档
- 未新增 capability、架构调整或接口变化
- **阶段守卫**：build → verify 前运行 `bash "$COMET_GUARD" <change-name> build --apply`，verify → archive 前按 `/comet-verify` 规则运行 `bash "$COMET_GUARD" <change-name> verify --apply`
