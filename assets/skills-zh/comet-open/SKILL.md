---
name: comet-open
description: "Comet 阶段 1：开启。用 /comet-open 调用。通过 OpenSpec 探索想法、确认需求澄清，再创建 change 结构（proposal + design + tasks）。"
---

# Comet 阶段 1：开启（Open）

## 前置条件

- 无活跃 change，或用户希望创建新 change

## 步骤

### 0. 输出语言约束

传递给 OpenSpec 的所有提问和产物要求都必须包含输出语言约束：使用触发本次工作流的用户请求语言。恢复已有 change 且产物已有明确主语言时，除非用户明确要求切换，否则保持该语言。

### 1. 探索想法与需求澄清

**立即执行：** 使用 Skill 工具加载 `openspec-explore` 技能。禁止跳过此步骤。

技能加载后，按其指引探索问题空间，但不得把一次问答视为足够澄清。必须围绕下列内容继续提问、对齐并形成澄清摘要：
- 目标：用户真正要解决的问题和期望结果
- 非目标：本次明确不做的内容
- 范围边界：涉及/不涉及的模块、用户、平台或数据
- 关键未知项：仍不确定的假设、风险或依赖
- 验收场景草案：至少覆盖核心成功场景和关键边界场景

澄清摘要必须包含：目标、非目标、范围边界、关键未知项、验收场景草案。

### 1a. PRD 拆分预检（阻塞点）

当用户输入是大型 PRD、路线图、完整产品方案，或澄清摘要显示包含多个独立能力、模块、用户路径或里程碑时，必须在创建 OpenSpec artifacts 前评估是否需要拆分为多个 change。

拆分预检必须基于已澄清的信息，输出候选拆分清单。每个候选拆分项必须包含：
- 建议 change 名称
- 目标与范围边界
- 明确非目标
- 依赖关系或推荐执行顺序
- 对应的核心验收场景

满足任一条件时，应推荐拆分：
- PRD 包含多个可独立设计、构建、验证、归档的 capability
- 涉及多个模块或用户路径，且其中一部分可独立交付
- 存在明显分阶段里程碑
- 预计会产生多个 delta spec 或超过 3 个大任务
- 任一部分失败或延期不应阻塞其他部分进入后续阶段

如推荐拆分，必须使用当前平台可用的用户输入/确认机制暂停并等待用户选择。若当前平台没有结构化提问工具，则在对话中提出同等单选问题并停止流程，等待用户回复后才能继续。

用户选择必须包含：
- 「创建多个 OpenSpec changes」— 按候选拆分逐个创建独立 change
- 「保持为一个 change」— 继续单 change 流程，并在 proposal/design/tasks 中记录不拆分原因
- 「调整拆分方案后继续」— 用户说明调整方向后，重新输出候选拆分清单并再次确认

每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change，不得直接调用 `/opsx:new`。`/comet-open` 负责同时创建 OpenSpec artifacts 和 `.comet.yaml`，确保每个 change 都进入 Comet 状态机。

不得在用户完成 PRD 拆分选择前创建 proposal.md、design.md 或 tasks.md。若用户选择创建多个 change，当前 `/comet-open` 调用只负责完成拆分确认与调度，随后按用户确认的顺序分别进入每个拆分项的 `/comet-open`。

批量拆分模式下，进入每个拆分项的 `/comet-open` 时必须明确标注「已确认拆分项」并携带该拆分项的目标、范围、非目标和验收场景。已确认拆分项默认跳过 PRD 拆分预检，除非该拆分项本身仍明显包含多个独立 capability。

批量拆分模式下，单个拆分项完成 open 阶段后不得自动流转到 `/comet-design`。拆分完毕后必须暂停询问用户开始哪一个 change；用户选择后，只推进该 change 进入 `/comet-design`，其他 change 保持 active，稍后通过 `/comet` 恢复。

最小断点恢复规则：不新增专用批量状态文件。若批量拆分过程中断，恢复时先检查已创建的 active changes；已存在且包含 `.comet.yaml` 的拆分项不得重复创建，未创建的拆分项按用户已确认的拆分清单继续通过 `/comet-open` 创建。若对话中已确认的拆分清单不可恢复，必须重新向用户确认拆分清单后再继续。

### 1b. 需求澄清完成确认（阻塞点）

创建 OpenSpec artifacts 前，必须使用当前平台可用的用户输入/确认机制暂停并等待用户确认需求澄清完成。若当前平台没有结构化提问工具，则在对话中展示澄清摘要并提出确认问题，停止流程，等待用户回复后才能继续。

暂停时必须展示澄清摘要：目标、非目标、范围边界、关键未知项、验收场景草案。

不得在用户确认需求澄清完成前创建 proposal.md、design.md 或 tasks.md，也不得使用 Skill 工具加载 `openspec-propose` 技能一次性生成全部 artifacts。

### 2. 创建 Change 结构 + 初始化状态

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

完整 `/comet` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能；只有用户明确要求一次性生成提案和 artifacts 时才允许加载。

技能加载后，按其指引创建 change 骨架，但当 Step 1b 的已确认澄清摘要已存在于对话上下文时，覆盖其"STOP and wait for user direction"行为。具体如下：

1. 按技能指引执行 `openspec new change`、`openspec status`、`openspec instructions`
2. 如果用户已确认澄清摘要（Step 1b），直接使用该摘要起草 proposal.md —— 不得再要求用户重新描述变更内容
3. 如果不存在澄清摘要（边缘情况），回退到技能的默认行为，询问用户

然后逐个补齐 design.md、tasks.md；每个文档都必须基于已确认的澄清摘要。

**命名与范围守卫**：change name 必须使用用户指定或通过当前平台可用的用户输入/确认机制确认的名称，不得自动生成或推断。变更范围必须与用户描述一致，不得自行扩大或缩小。

确认以下产物已创建：

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What：问题、目标、范围
├── design.md         # How（高层）：架构决策、方案选型
└── tasks.md          # 任务清单（勾选框）
```

创建 `.comet.yaml` 状态文件：

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"

if [ -z "$COMET_STATE" ] || [ -z "$COMET_GUARD" ]; then
  echo "ERROR: Comet scripts not found. Ensure the comet skill is installed." >&2
  return 1
fi

"$COMET_BASH" "$COMET_STATE" init <name> full
```

### 3. 入口状态验证

验证状态机已正确初始化：

```bash
"$COMET_BASH" "$COMET_STATE" check <name> open
```

验证通过后继续 Step 4。验证失败时脚本会输出具体失败原因。

**幂等性**：open 阶段所有操作可安全重复执行。如 `.comet.yaml` 已处于 `phase: open` 且三个产物文件均已存在，跳过已完成步骤，从第一个缺失步骤继续。

### 4. 内容完整性检查

确认三个文档内容完整：
- **proposal.md**：问题背景、目标、范围、非目标
- **design.md**：高层架构决策、方案选型、数据流
- **tasks.md**：任务列表，每个任务有明确描述

**文件存在性验证**：逐个确认三个文件路径存在且非空。任一文件缺失或为空时，不得进入 Step 5 或执行阶段守卫，必须回到创建步骤补充。

### 5. 用户审视确认（阻塞点）

三个文档创建完成且内容完整性检查通过后，**必须使用当前平台可用的用户输入/确认机制暂停并等待用户确认**。不得在用户确认前执行阶段守卫或自动流转。若当前平台没有结构化提问工具，则在对话中提出同等单选问题并停止流程，等待用户回复后才能继续。

用户确认问题必须以单选题形式呈现，包含以下摘要和选项：

**摘要内容**：
- **proposal.md**：问题背景、目标、范围
- **design.md**：高层架构决策、方案选型
- **tasks.md**：任务数量和关键任务描述

**选项**：
- 「确认，继续下一阶段」— 产物符合预期，执行阶段守卫流转
- 「需要调整」— 附带调整说明，修改后重新请求确认

用户选择「确认」后继续执行退出条件。用户选择「需要调整」时，按其说明修改对应文件，然后重新请求确认。

## 退出条件

- proposal.md、design.md、tasks.md 均已创建且内容完整
- **用户已确认** proposal、design、tasks 内容符合预期
- **阶段守卫**：运行 `"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply`，全部 PASS 后由守卫推进到下一阶段（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

退出前必须使用 `--apply`，否则 `.comet.yaml` 仍停留在 `phase: open`，下一阶段入口检查会失败。

```bash
"$COMET_BASH" "$COMET_GUARD" <change-name> open --apply
```

完整流程会自动更新为 `phase: design`；hotfix/tweak preset 会自动更新为 `phase: build`。

## 自动衔接下一阶段

> **术语区分**：上面的「阶段守卫推进」由 guard `--apply` 完成，更新 `.comet.yaml` 的 `phase` 字段——这一步**始终发生**，与 `auto_transition` 无关。本节的「自动衔接」只决定**是否自动调用下一个 skill**，由 `auto_transition` 控制。

用户确认且阶段守卫推进 phase 后，运行：

```bash
"$COMET_BASH" "$COMET_STATE" next <change-name>
```

脚本根据 `phase`、`workflow`、`auto_transition` 输出确定性的下一步：
- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续

hotfix/tweak preset 由对应 preset skill 控制后续流转（phase 直接进入 build），其 `next` 会返回对应 preset skill。
