---
name: comet-open
description: '创建 Classic change，整理需求并请用户确认。在用户调用 /comet-open，或 Classic 进入 Open、恢复初始化时使用。'
---

# Comet 阶段 1：开启（Open）

开始或恢复任务前，必须先读取并遵守 `comet-classic/reference/classic-layout.md`。本文件中的 OpenSpec CLI 调用必须通过适配器执行，文件路径必须基于该协议绑定的 `<classic-*>` 逻辑根目录。

## 前置条件

- 无活跃 change，或用户希望创建新 change

## 步骤

### 0. 设置输出语言

向 OpenSpec 传递提问和文档生成要求时，都必须明确指定 Comet 配置的产物语言，使用 `en`、`zh-CN` 这类规范化 ID。`.comet.yaml` 尚不存在时，依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `classic.language`；change 初始化后，使用 `comet state get <name> language` 读取。没有配置语言时，才采用当前用户请求的语言。生成的 `proposal.md`、`design.md`、`tasks.md` 必须以该语言为主。

### 0a. 当前 change 绑定

恢复已有 change 时先检查 `<classic-change-dir>/.comet.yaml`：

- 状态文件存在且可解析：先运行 `comet classic workspace resolve <change-name> --json`，进入返回的 `projectRoot` 后再选择 change
- 状态文件缺失但 change 目录有效：先使用所选隔离方式准备工作区，再进入返回的 `projectRoot` 运行 `comet state init <change-name> full --isolation <selected-isolation>`，最后选择 change
- 状态文件格式异常：停止并报告解析错误；根据版本控制、备份或能够核实的产物人工修复后再继续，不得用 `state set` 覆盖损坏文件

```bash
comet classic workspace resolve <change-name> --json
# 进入返回的 projectRoot
comet state select <change-name>
```

创建新 change 时，必须先初始化 `.comet.yaml`，再立即运行上述 select 命令；状态文件尚不存在时，不得手工写入 change 选择记录。

### 0b. Open 前工作区决策与准备

创建 Classic change 时，读取 `comet-classic/reference/workspace.md`。必须先确定工作区，再创建 OpenSpec 产物和 `.comet.yaml`，不能推迟到 Build：

- 用户明确要求并行工作时，直接使用 `worktree`；先准备好独立工作区，再创建 OpenSpec 产物和 state
- 用户未指定隔离方式时，按参考文档处理：需要用户选择时，展示可用的 `current`、`branch`、`worktree` 选项，推荐理由不能代替用户选择
- 用户选择 `current` 或 `branch` 时，仍应串行工作，不得将其描述为适合多个会话同时使用

新 change 在运行 OpenSpec `new` 前准备工作区：

```bash
comet classic workspace prepare <name> --isolation <current|branch|worktree> --json
# 进入返回的 projectRoot；后续 OpenSpec、state 和产物写入都必须在该目录执行
```

准备命令会复用已登记且分支匹配的 Worktree；分支仍在但已登记的 Worktree 被移除时，会重建 Worktree。只有分支已重命名、被用户用于其他工作，或无法确认归属时，才暂停，请用户明确确认 rebind。

### 0c. OpenSpec 兼容性检查

首次使用或上游安装发生变化时运行一次，记录用于排错的版本：

```bash
comet classic openspec -- --version
```

兼容性必须通过实际能力检查，不能只凭版本号判断。status 必须提供 `changeRoot`、`applyRequires`，以及每个产物的 `requires`、`outputPath`、`status`；instructions 必须提供可用的 `resolvedOutputPath`。当前适配已核对 OpenSpec 1.11.0/1.12.0 的状态接口要求，不保证兼容所有历史版本。命令不可用、返回非零或缺少必需能力时，停止并展示错误和升级建议，不自动升级用户环境。

创建 change 后，由 `comet state artifacts <name> --json` 校验路径、全部必需依赖和实际文件。该命令会展开 `applyRequires` 和 Classic 必需的 proposal/tasks 的所有依赖，形成完整依赖闭包。闭包要求生成 design 时，不能因为 instructions 称其“可选”就跳过；闭包不要求 design 时，不强制生成。

只有需求不涉及行为规格变更、`.openspec.yaml` 明确设置了 `skip_specs: true`，且没有冲突的规格文件时，才允许跳过 specs。当前支持 proposal/specs/design/tasks 角色；遇到不支持的必需角色或输出模式时，必须明确报告，不能自行猜测处理方式。

### 1. 探索想法与需求澄清

**立即执行：** 使用 Skill 工具加载 `openspec-explore` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 加载后只采用其探索方法，不执行其中直接运行官方 CLI、切换到固定 cwd，或读写写死的 OpenSpec 目录的指令。所有 CLI 调用改用 `comet classic openspec -- <args...>`，所有文件路径改用本轮绑定的 `<classic-*>` 逻辑根目录。

技能加载后，先复用用户提供的 PRD、设计与已确认事实，围绕下列内容检查缺口并形成澄清摘要。只对会改变范围、方案或验收的未知项提问；信息已足够时可以不追加问答，不设置最低澄清轮数：

- 目标：用户真正要解决的问题和期望结果
- 非目标：本次明确不做的内容
- 范围边界：涉及/不涉及的模块、用户、平台或数据
- 关键未知项：仍不确定的假设、风险或依赖
- 验收场景草案：至少覆盖核心成功场景和关键边界场景

澄清摘要必须包含：目标、非目标、范围边界、关键未知项、验收场景草案。

需要向用户澄清时，必须先读取 `comet-classic/reference/decision-point.md`，以明确问题、推荐及理由、各选项影响的形式提问，并优先使用可用的 `AskUserQuestion`。只询问当前缺口；事实或素材无法提供真实选项时说明缺失内容后请求补充。外部探索 Skill 的提问也应用该协议，不能因加载了探索方法而省略选项或替用户选择。

引用完整 PRD 时，给出文件路径和相关章节，不复制全文。已确认的事实不重复征求同意；发现矛盾时，只澄清矛盾点。OpenSpec 技能仍是必需依赖，探索结束后必须返回 Comet，不能由外部 Skill 自行进入设计、实施或归档。探索中的确认不能代替 Open 最后的产物确认。

### 1a. 创建前确认是否拆分 PRD

用户提供大型 PRD、路线图或完整产品方案，或澄清摘要显示包含多个独立功能、模块、用户操作流程或里程碑时，必须先评估是否需要拆分为多个 change，再创建 OpenSpec 产物。

拆分预检必须基于已澄清的信息，输出候选拆分清单。每个候选拆分项必须包含：

- 建议 change 名称
- 目标与范围边界
- 明确非目标
- 依赖关系或推荐执行顺序
- 对应的核心验收场景

满足任一条件时，应推荐拆分：

- PRD 包含多个可以独立设计、构建、验证和归档的功能
- 涉及多个模块或用户路径，且其中一部分可独立交付
- 存在明显分阶段里程碑
- 多个 delta spec 对应可分别验收与交付的独立目标；文档或任务数量本身不决定拆分
- 任一部分失败或延期不应阻塞其他部分进入后续阶段

如推荐拆分，必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户选择。

用户选择必须包含：

- 「创建多个 OpenSpec changes」— 按候选拆分逐个创建独立 change
- 「保持为一个 change」— 继续单 change 流程，并在 proposal/design/tasks 中记录不拆分原因
- 「调整拆分方案后继续」— 用户说明调整方向后，重新输出候选拆分清单并再次确认

每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change，不得直接调用 `/opsx:new`。`/comet-open` 负责同时创建 OpenSpec 产物和 `.comet.yaml`，确保每个 change 都由 Comet 状态机管理。

不得在用户完成 PRD 拆分选择前创建 proposal.md、design.md 或 tasks.md。若用户选择创建多个 change，当前 `/comet-open` 调用只负责完成拆分确认与调度，随后按用户确认的顺序分别进入每个拆分项的 `/comet-open`。

用户确认创建多个 changes 后，必须立即把确认结果保存到 `.comet/batches/<batch-id>.json`。`batch-id` 使用固定的 kebab-case 标识。文件至少记录 `version`、原始目标摘要、创建时间、按顺序排列的 change 名称，以及每项的目标、范围、非目标、验收场景和 `pending|open-complete|selected` 状态。每创建或完成一个拆分项，都要原子更新该文件。这份清单用于记录批量创建顺序和进度，不替代各 change 的 `.comet.yaml`。

批量拆分模式下，进入每个拆分项的 `/comet-open` 时，必须明确标注「已确认拆分项」，并传入该项的目标、范围、非目标和验收场景。已确认的拆分项默认跳过 PRD 拆分预检，除非该项本身仍明显包含多个独立功能。

批量拆分模式下，单个拆分项完成 open 阶段后，不得自动进入 `/comet-design`。拆分完成后，必须暂停，请用户选择从哪一个 change 开始。只将用户选中的 change 推进到 `/comet-design`；其他 change 保持未归档状态，稍后通过 `/comet-classic` 恢复。

**逐项检查批量创建结果（不得跳过）**：全部拆分项完成各自的 open 阶段后，对用户确认清单中的每个 `<name>` 逐个运行：

```bash
comet state check <name> design --json
```

该入口已检查 OpenSpec 的全部必需依赖、实际输出和 Comet 状态，不再额外重复查询 status。`isComplete` 仅用于诊断，非必需产物不会阻止流程继续。检查失败时，再查询 status，找出尚未生成的依赖，或处理已报告的路径错误、缺少必需能力等问题。

任一拆分项未通过检查时，不能宣告拆分完成，也不能询问用户开始哪个 change。应停止后续推进，从该 change 的第一个 `ready` 或 `blocked` 产物恢复 `/comet-open`。OpenSpec 检查通过、但 Comet state 检查失败时，必须先修复 `.comet.yaml` 初始化或 phase，再重新执行整批检查。

只有所有拆分项都通过入口检查后，才暂停，请用户选择从哪一个 change 开始。用户选择后，将批量清单中的该项标记为 `selected`，只推进该 change 进入 `/comet-design`；其他 change 保持未归档状态，稍后通过 `/comet-classic` 恢复。

中断后恢复时，先读取 `.comet/batches/<batch-id>.json`，再对清单中已创建且未归档的 changes 运行上述 CLI 检查。已完整通过的拆分项不得重复创建；未通过的拆分项，从 OpenSpec 返回的第一个 `ready` 产物继续。尚未创建的项，按已保存的清单继续创建。清单缺失或损坏时，停止并请用户重建或确认，不能从目录列表猜测原来这一批包含哪些 change。

### 1b. 整理需求并确定 Change 名称

创建 OpenSpec 产物前，把 Step 1 的澄清结果整理为需求摘要（resolved brief），包括目标、非目标、范围边界、关键未知项和验收场景草案。根据这份摘要，拟定一个能准确表达范围的 kebab-case 英文 change 名称。

- **范围与命名都明确时直接继续**，不得仅为了让用户批准摘要或名称而创建停顿点；最终审视会统一确认 change 名称、范围和产物内容
- 用户已经提供名称时，规范化为 kebab-case 并在进度说明中回显；规范化不改变含义时无需再次确认
- 已确认批量拆分项直接复用批量清单中的摘要与名称；检测到范围漂移或清单信息缺失时，才重新澄清
- 只有仍需在不同范围或不同目标 change 之间作出选择时，才按 `comet-classic/reference/decision-point.md` 将相关问题合并提问；不能仅因命名偏好而单独暂停

OpenSpec change 名称必须是 kebab-case 英文（小写字母、数字、单连字符）。名称冲突但目标仍明确时，拟定一个不冲突且含义一致的名称，然后继续。只有无法判断应复用现有 change 还是创建新 change 时，才交给用户选择。

resolved brief 或 change 名称仍不明确时不得运行 `comet classic openspec -- new change`，也不得创建 proposal/design/tasks；继续澄清或处理真正的用户决策后再进入 Step 2。

### 2. 创建 Change 结构 + 初始化状态

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 加载后只采用其创建 change 的方法，不执行其中直接运行官方 CLI、切换到固定 cwd，或把 change 写到固定 OpenSpec 根目录的指令。创建、status 与 instructions 全部改用 `comet classic openspec -- <args...>`，文件路径全部改用 `<classic-change-dir>` 等本轮逻辑根目录。

完整 `/comet-classic` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能；只有用户明确要求一次性生成提案和其他产物时，才允许加载。

<!-- external-openspec-skill-override -->

**外部 OpenSpec Skill 适配规则：** 使用 `openspec-propose` 时，同样不能直接运行官方 CLI、采用固定 cwd 或读写固定 OpenSpec 目录。命令必须通过适配器执行，产物必须写入路径解析器返回的 `<classic-*>` 逻辑根目录。

技能加载后，按其指引创建 change 的基础目录和文件。Step 1b 已形成范围明确的 resolved brief 时，不再执行其中的 "STOP and wait for user direction"，直接继续，避免重复询问。

直接使用 Step 1b 的 resolved brief 填充产物内容。只有 brief 仍有会改变范围的歧义时，才回退到技能的提问流程。

change 的基础目录和文件创建后，立即初始化状态，以便中断后恢复；不能等所有产物都生成后再写 `.comet.yaml`：

```bash
comet state init <name> full --isolation <selected-isolation>
comet state select <name>
comet state check <name> open
```

任一命令失败都停止。随后运行一次 `comet classic openspec --agent-json -- status --change "<name>" --json` 并执行兼容性预检：

- `changeRoot` 解析后必须等于路径解析器绑定的 `<classic-change-dir>`，`planningHome`（如存在）也必须位于当前仓库；不支持仓库外的产物路径
- `artifacts` 必须包含 Classic 必需 ID `proposal`、`tasks`，其他要求沿 `requires` 递归展开
- `applyRequires` 必须是可解析的产物 ID 列表；直接引用和间接依赖的产物都必须存在，且不能循环依赖
- 返回数据缺少字段、路径越界或必需 ID 缺失时，立即停止，不能改用猜测的固定模板

预检通过后，按 OpenSpec CLI 返回的 schema 和依赖图生成实施所需的产物：

Agent JSON 模式下，从 `data.upstream.data` 读取上游字段。下一步必须使用 `data.nextAction` 返回的完整 argv，并在其指定的 cwd 执行；上游原始 nextSteps 仅用于诊断。

**根据 OpenSpec 状态逐项生成产物**：

1. 首轮复用 Step 2 兼容性预检刚返回的 status；后续复用上一轮写入后刷新的 status。只有恢复或外部产物变化时重新运行 `comet classic openspec --agent-json -- status --change "<name>" --json`，从 `data.upstream.data` 读取完整上游 JSON。
2. 展开 `applyRequires` 加 proposal/tasks 的完整依赖闭包。闭包中每项都为 `done` 或合法 `skipped` 时运行 `comet state artifacts <name> --json`，仅校验通过才退出循环；顶层 tasks 已完成不能掩盖未完成依赖。`isComplete` 只作诊断。
3. 在尚未完成、状态为 `status: "ready"` 的产物中，优先处理 `applyRequires` 所需的依赖，并遵循 CLI 返回的顺序。不得写死生成顺序，也不能假设 schema 只有 proposal/design/tasks。
4. 对每个 ready 的 `<artifact-id>` 获取实时指令：

   ```bash
   comet classic openspec --agent-json -- instructions <artifact-id> --change "<name>" --json
   ```

5. 根据返回的 JSON 指令，必须完成以下操作：
   - 读取 `dependencies` 中列出的每个已完成依赖产物
   - 以 `template` 作为产物结构
   - 遵循 `instruction` 的指引
   - 遵守 `context` 和 `rules` 中的约束，**不得将这些内容复制到产物中**
   - 写入 `resolvedOutputPath`；通配输出必须按 instruction 创建每个实际文件
   - 验证 CLI 返回的实际输出文件存在且非空
6. 每创建一个产物后，刷新一次 status，将结果用于下一轮，并再次校验路径与完整依赖闭包。已经变为 `done` 的项不得重复生成；只处理闭包中新增的 ready 项，不额外生成无关的可选产物。

**阻塞与失败处理**：`applyRequires` 尚未全部完成、但其所需依赖中已没有 ready 产物时，必须报告相关 `blocked` 产物的 `missingDeps`，然后停止。不得猜测生成顺序或跳过依赖。适配器的 `status` / `instructions` 调用失败、返回无效 JSON、产物路径超出仓库，或未提供可用的 `resolvedOutputPath` 时，也必须立即停止并报告 OpenSpec 错误，不能改用写死的文档结构。

**核对名称和变更范围**：change name 必须使用 Step 1b 解析出的 kebab-case 英文名，不得使用非 kebab-case（如中文）名称。变更范围必须与 resolved brief 和用户描述一致，不得自行扩大或缩小。

确认以下产物已创建：

```
<classic-change-dir>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What：问题、目标、范围
├── design.md         # 仅在依赖要求或实际需要时创建，保存技术决策，不复制到第二份设计文档
└── tasks.md          # 任务清单（勾选框）
```

### 3. 入口状态验证

验证状态机已正确初始化：

```bash
comet state check <name> open
```

验证通过后继续 Step 4。验证失败时脚本会输出具体失败原因。

**恢复未完成的创建步骤**：open 阶段的操作允许安全重试；恢复时按以下顺序识别已完成的部分，只补未完成的工作：

1. 状态文件缺失时先使用所选隔离方式准备工作区，再进入返回的 `projectRoot` 运行 `comet state init <name> full --isolation <selected-isolation>`；格式异常时停止并修复，不得覆盖。随后选择 change 并运行 `comet state check <name> open`。
2. 运行 `comet classic openspec --agent-json -- status --change "<name>" --json`，重新验证 `changeRoot`、核心 ID、`applyRequires`、`artifacts` 和 `missingDeps`。
3. `done`：该产物已完成，保持原文件不变，不重复生成。
4. `ready`：依赖已经满足，可以生成。先运行 `comet classic openspec --agent-json -- instructions <artifact-id> --change "<name>" --json`，按返回内容写入；写完后立刻重新运行 status。
5. `blocked`：读取 `missingDeps`，先完成属于 `applyRequires` 依赖闭包的依赖产物；每完成一个依赖都重新运行 status，不能直接生成 blocked 产物。
6. 重复上述处理，直到完整必需闭包为 done 或合法 skipped，且 `comet state artifacts <name> --json` 校验通过。

如果必需依赖仍无法完成，必须列出相关 blocked 产物及其 `missingDeps`，然后停止并报告。不能仅凭目录或三个固定文件存在，就替代 CLI 的检查结论；也不能因为 `isComplete: false`，就让不属于 `applyRequires` 的可选产物阻止流程进入实施阶段。

### 4. 内容完整性检查

使用最近一次 `comet state artifacts <name> --json` 的成功结果核对必需产物；文件或 schema 变化后必须重新运行。任一问题未解决时，不得进入 Step 5 或执行阶段守卫。

随后检查关键产物的内容：proposal 应说明问题、目标、范围和非目标；design 应说明高层决策与数据流；tasks 应列出明确任务。schema 返回 specs 等其他产物时，也必须按对应的 instructions 检查内容，不能因为 proposal、design、tasks 三个文件已经存在就跳过。

### 5. 请用户确认产物

全部 OpenSpec 产物完成且内容完整性检查通过后，**必须按 `comet-classic/reference/decision-point.md` 的协议暂停并等待用户确认**。不得在用户确认前执行阶段守卫或自动进入下一阶段。

最终审视同时确认 change 名称、范围和产物内容；不得因 Step 1b 已完成解析而省略，也不得在此之前再增加一次常规摘要/命名确认。

用户确认问题必须以单选题形式呈现，包含以下摘要和选项：

**摘要内容**：

- **change 名称与 resolved brief**：最终名称、目标、非目标、范围边界和关键未知项
- **proposal.md**：问题背景、目标、范围
- **schema 要求的 specs 等产物**：功能、需求和关键验收场景
- **design.md**：高层架构决策、方案选型
- **tasks.md**：任务数量和关键任务描述

**选项**：

- 「确认，继续下一阶段」— 产物符合预期，执行阶段守卫流转
- 「需要调整」— 附带调整说明，修改后重新请求确认

用户选择「确认」后继续执行退出条件。用户选择「需要调整」时，按其说明修改对应文件，然后重新请求确认。

## 退出条件

- `comet state artifacts <name> --json` 通过：完整必需闭包已完成或合法跳过，所需实际输出非空
- **用户已确认** 全部 OpenSpec 产物的内容符合预期
- **阶段守卫**：运行 `comet guard <change-name> open --apply`，全部 PASS 后由守卫推进到下一阶段（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

退出前必须使用 `--apply`，否则 `.comet.yaml` 仍停留在 `phase: open`，下一阶段入口检查会失败。

```bash
comet guard <change-name> open --apply
```

完整流程会自动更新为 `phase: design`；hotfix/tweak 预设会自动更新为 `phase: build`。

## 自动衔接下一阶段

按 `comet-classic/reference/auto-transition.md` 和成功结果中的 `agent.continuation` 继续。已有仍然有效的状态信息时，不重复 next、select 或 check。只有丢失上下文后恢复任务、外部状态变化，或旧结果未提供这些信息时，才运行：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续

hotfix/tweak 预设由对应预设 Skill 控制后续流转（phase 直接进入 build），其 `next` 会返回对应预设 Skill。
