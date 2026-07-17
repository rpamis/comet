---
name: comet-open
description: "仅在用户明确调用 /comet-open，或由 Comet 根 Skill/runtime 路由到 open 阶段时使用；创建或恢复 OpenSpec change，并补齐 proposal/design/tasks/.comet.yaml。"
---

# Comet 阶段 1：开启（Open）

## 前置条件

- 无活跃 change，或用户希望创建新 change

## 步骤

### 0. 输出语言约束

传递给 OpenSpec 的所有提问和产物要求都必须包含解析后的 Comet 产物语言，并使用 `en`、`zh-CN` 这类规范化 ID。`.comet.yaml` 尚不存在时依次读取项目 `.comet/config.yaml` 和全局 `~/.comet/config.yaml` 的 `language`；change 初始化后使用 `comet state get <name> language` 读取。没有配置语言时才回退到当前用户请求语言。生成的 `proposal.md`、`design.md`、`tasks.md` 必须以该语言为主语言。

### 0a. 当前 change 绑定

恢复已有 change 时先检查 `openspec/changes/<change-name>/.comet.yaml`：

- 状态文件存在且可解析：第一项状态操作是选择 change
- 状态文件缺失但 change 目录有效：先运行 `comet state init <change-name> full`，再选择 change
- 状态文件格式异常：停止并报告解析错误；从版本控制、备份或可验证产物人工修复后再继续，不得用 `state set` 覆盖损坏文件

```bash
comet state select <change-name>
```

创建新 change 时，必须先完成 `.comet.yaml` 初始化，再立即运行同一命令；状态文件不存在前不得伪造选择。

### 0b. OpenSpec 兼容性检查

在任何 OpenSpec 状态或指令命令前运行：

```bash
openspec --version
```

本流程要求 **OpenSpec >= 1.5.0**。版本低于 1.5.0、无法解析版本、命令不可用或返回非零退出码时立即停止，并提示运行 `npm install -g @fission-ai/openspec@latest` 后重试；不得继续使用缺少 `applyRequires`、`artifactPaths`、`changeRoot` 或 `resolvedOutputPath` 契约的旧 CLI。

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

如推荐拆分，必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户选择。

用户选择必须包含：
- 「创建多个 OpenSpec changes」— 按候选拆分逐个创建独立 change
- 「保持为一个 change」— 继续单 change 流程，并在 proposal/design/tasks 中记录不拆分原因
- 「调整拆分方案后继续」— 用户说明调整方向后，重新输出候选拆分清单并再次确认

每个被接受的拆分项都必须通过 `/comet-open` 创建独立 change，不得直接调用 `/opsx:new`。`/comet-open` 负责同时创建 OpenSpec artifacts 和 `.comet.yaml`，确保每个 change 都进入 Comet 状态机。

不得在用户完成 PRD 拆分选择前创建 proposal.md、design.md 或 tasks.md。若用户选择创建多个 change，当前 `/comet-open` 调用只负责完成拆分确认与调度，随后按用户确认的顺序分别进入每个拆分项的 `/comet-open`。

用户确认创建多个 changes 后，必须立即把确认结果持久化到 `.comet/batches/<batch-id>.json`。`batch-id` 使用稳定的 kebab-case 标识；文件至少记录 `version`、原始目标摘要、创建时间、按顺序排列的 change 名称，以及每项的目标、范围、非目标、验收场景和 `pending|open-complete|selected` 状态。每创建或完成一个拆分项后原子更新该文件。它只是批量编排清单，不替代各 change 的 `.comet.yaml`。

批量拆分模式下，进入每个拆分项的 `/comet-open` 时必须明确标注「已确认拆分项」并携带该拆分项的目标、范围、非目标和验收场景。已确认拆分项默认跳过 PRD 拆分预检，除非该拆分项本身仍明显包含多个独立 capability。

批量拆分模式下，单个拆分项完成 open 阶段后不得自动流转到 `/comet-design`。

**批量完成硬性检查（不得跳过）**：全部拆分项完成各自的 open 阶段后，对用户确认清单中的每个 `<name>` 逐个运行：

```bash
openspec status --change "<name>" --json
comet state check <name> design
```

解析 OpenSpec JSON 时必须同时确认：
- `changeRoot` 解析后必须等于仓库内 `openspec/changes/<name>`；不匹配时停止，Classic runtime 不支持仓库外 change root
- schema 必须包含核心 artifact ID `proposal`、`design`、`tasks`；允许存在额外 artifacts，但核心 ID 缺失时停止并报告不兼容 schema
- `applyRequires` 列出的每个 artifact 在 `artifacts` 中都必须为 `done`
- `artifactPaths.<artifact-id>.existingOutputPaths`（或 instructions 返回的 `resolvedOutputPath`）对应的实际输出必须存在且非空
- `isComplete` 仅作诊断信息；不能替代 `applyRequires` 的实现就绪判定，也不能要求非必需 artifact 阻塞阶段推进

任一拆分项未通过检查时，不得宣告拆分完成，也不得询问用户开始哪个 change；必须停止并从该 change 的第一个 `ready` 或 `blocked` artifact 恢复 `/comet-open`。OpenSpec 检查通过但 Comet state 检查失败时，必须先修复 `.comet.yaml` 初始化或 phase，再重新执行整批检查。

只有所有拆分项都通过两项 CLI 检查后，才暂停询问用户开始哪一个 change；用户选择后，把批量清单中的该项标记为 `selected`，只推进该 change 进入 `/comet-design`，其他 change 保持 active，稍后通过 `/comet` 恢复。

断点恢复时先读取 `.comet/batches/<batch-id>.json`，再对清单中已创建的 active changes 运行上述 CLI 检查；已完整通过的拆分项不得重复创建，未通过的拆分项从 OpenSpec 返回的第一个 `ready` artifact 继续。未创建项按持久清单继续创建。清单缺失或损坏时停止并请求用户重建/确认，不能从目录列表猜测原始批次边界。

### 1b. 需求与 Change 名称解析（默认不阻塞）

创建 OpenSpec artifacts 前，把 Step 1 的澄清结果整理为 resolved brief：目标、非目标、范围边界、关键未知项和验收场景草案，并基于它派生一个能准确表达范围的 kebab-case 英文 change 名称。

- **范围与命名都明确时直接继续**，不得仅为了让用户批准摘要或名称而创建停顿点；最终审视会统一确认 change 名称、范围和产物内容
- 用户已经提供名称时，规范化为 kebab-case 并在进度说明中回显；规范化不改变含义时无需再次确认
- 已确认批量拆分项直接复用批量清单中的摘要与名称；检测到范围漂移或清单信息缺失时，才重新澄清
- 只有仍存在会改变范围或目标 change 身份的互斥选择时，才按 `comet/reference/decision-point.md` 提出一个联合问题；命名偏好本身不是独立阻塞点

OpenSpec change 名称必须是 kebab-case 英文（小写字母、数字、单连字符）。若名称冲突但目标仍明确，派生一个不冲突且语义稳定的名称并继续；只有无法判断应复用现有 change 还是创建新 change 时才交给用户选择。

resolved brief 或 change 名称仍不明确时不得运行 `openspec new change`，也不得创建 proposal/design/tasks；继续澄清或处理真正的用户决策后再进入 Step 2。

### 2. 创建 Change 结构 + 初始化状态

**立即执行：** 使用 Skill 工具加载 `openspec-new-change` 技能。禁止跳过此步骤。

完整 `/comet` 流程默认不得使用 Skill 工具加载 `openspec-propose` 技能；只有用户明确要求一次性生成提案和 artifacts 时才允许加载。

技能加载后，按其指引创建 change 骨架；当 Step 1b 已形成范围明确的 resolved brief 时，覆盖其"STOP and wait for user direction"行为，避免重复询问。

直接使用 Step 1b 的 resolved brief 填充产物内容。只有 brief 仍有会改变范围的歧义时，才回退到技能的提问流程。

change 骨架创建后立即初始化可恢复状态，不能等 artifacts 全部生成后再写 `.comet.yaml`：

```bash
comet state init <name> full
comet state select <name>
comet state check <name> open
```

任一命令失败都停止。随后运行一次 `openspec status --change "<name>" --json` 并执行兼容性预检：

- `changeRoot` 解析后必须等于当前仓库的 `openspec/changes/<name>`，`planningHome`（如存在）也必须位于当前仓库；不支持仓库外 artifact 路径
- `artifacts` 必须包含核心 ID `proposal`、`design`、`tasks`，额外 artifacts 允许存在
- `applyRequires` 必须是可解析的 artifact ID 列表，且每个 ID 都存在于 `artifacts`
- 载荷缺字段、路径越界或核心 ID 缺失时立即停止，不能回退为猜测的固定模板

预检通过后，按 OpenSpec CLI 返回的 schema 和依赖图生成实现所需 artifacts：

**OpenSpec 状态驱动产物循环**：

1. 运行 `openspec status --change "<name>" --json` 并解析完整 JSON。
2. 若 `applyRequires` 中每一项都已是 `done`，退出循环；`isComplete` 只记录为诊断信息，不作为阶段阻塞条件。
3. 从尚未完成且为 `status: "ready"` 的 artifacts 中，优先选择能够推进 `applyRequires` 依赖闭包的项，并按 CLI 返回顺序处理。不得硬编码生成顺序，也不得假设 schema 只有 proposal/design/tasks。
4. 对每个 ready 的 `<artifact-id>` 获取实时指令：

   ```bash
   openspec instructions <artifact-id> --change "<name>" --json
   ```

5. 对返回的 JSON 指令载荷，必须：
   - 读取 `dependencies` 中列出的每个已完成依赖产物
   - 以 `template` 作为产物结构
   - 遵循 `instruction` 的指引
   - 将 `context` 和 `rules` 作为约束条件应用，**不得复制到 artifact 内容中**
   - 写入 `resolvedOutputPath`；通配输出必须按 instruction 创建每个实际文件
   - 验证 CLI 返回的实际输出文件存在且非空
6. 每创建一个 artifact 后，重新运行 status，并再次校验 `changeRoot`、核心 ID 和 `applyRequires`。已经变为 `done` 的项不得重复生成；新变为 `ready` 的项进入下一轮。

**阻塞与失败处理**：`applyRequires` 尚未全部完成但没有任何可推进其依赖闭包的 ready artifact 时，必须报告相关 `blocked` artifact 的 `missingDeps` 并停止，不得猜测顺序或跳过依赖。如果 `openspec status` / `openspec instructions` 失败、返回无效 JSON、路径逃逸仓库、或未提供可用的 `resolvedOutputPath`，也必须立即停止并报告 OpenSpec 错误。不得回退为硬编码文档结构。

**命名与范围守卫**：change name 必须使用 Step 1b 解析出的 kebab-case 英文名，不得使用非 kebab-case（如中文）名称。变更范围必须与 resolved brief 和用户描述一致，不得自行扩大或缩小。

确认以下产物已创建：

```
openspec/changes/<name>/
├── .openspec.yaml
├── .comet.yaml
├── proposal.md       # Why + What：问题、目标、范围
├── design.md         # How（高层框架）：架构决策、方案选型（深度技术设计在 design 阶段 Design Doc 细化）
└── tasks.md          # 任务清单（勾选框）
```

### 3. 入口状态验证

验证状态机已正确初始化：

```bash
comet state check <name> open
```

验证通过后继续 Step 4。验证失败时脚本会输出具体失败原因。

**幂等恢复算法**：open 阶段所有操作可安全重复执行。恢复时按以下顺序处理：

1. 状态文件缺失时先运行 `comet state init <name> full`；格式异常时停止并修复，不得覆盖。随后选择 change 并运行 `comet state check <name> open`。
2. 运行 `openspec status --change "<name>" --json`，重新验证 `changeRoot`、核心 ID、`applyRequires`、`artifacts` 和 `missingDeps`。
3. `done`：该 artifact 已完成，保持原文件不变，不重复生成。
4. `ready`：依赖已经满足，可以生成。先运行该 artifact 的 `openspec instructions`，按返回内容写入；写完后立刻重新运行 status。
5. `blocked`：读取 `missingDeps`，先完成属于 `applyRequires` 依赖闭包的依赖 artifact；每完成一个依赖都重新运行 status，不能直接生成 blocked artifact。
6. 重复上述处理，直到 `applyRequires` 全部为 `done`。

如果必需依赖图无法推进，必须列出相关 blocked artifact 及其 `missingDeps` 后停止并报告。目录或固定三个文件存在不能替代 CLI 判定；反过来，非 `applyRequires` 的可选 artifact 也不能仅因 `isComplete: false` 阻塞进入实现阶段。

### 4. 内容完整性检查

再次运行 `openspec status --change "<name>" --json`，确认核心 ID 存在、`applyRequires` 每项均为 `done`，且这些必需 artifacts 的 `artifactPaths.<id>.existingOutputPaths` 返回的实际输出文件存在且非空。任一条件不满足时，不得进入 Step 5 或执行阶段守卫。

随后检查关键 artifact 内容：proposal 覆盖问题、目标、范围和非目标；design 覆盖高层决策与数据流；tasks 包含明确任务；schema 返回 specs 等其他 artifact 时，也必须按其 instructions 检查内容，不能因固定三件套存在而跳过。

### 5. 用户审视确认（阻塞点）

全部 OpenSpec artifacts 完成且内容完整性检查通过后，**必须按 `comet/reference/decision-point.md` 的协议暂停并等待用户确认**。不得在用户确认前执行阶段守卫或自动流转。

最终审视同时确认 change 名称、范围和产物内容；不得因 Step 1b 已完成解析而省略，也不得在此之前再增加一次常规摘要/命名确认。

用户确认问题必须以单选题形式呈现，包含以下摘要和选项：

**摘要内容**：
- **change 名称与 resolved brief**：最终名称、目标、非目标、范围边界和关键未知项
- **proposal.md**：问题背景、目标、范围
- **specs 等 schema artifacts**：能力、需求和关键验收场景
- **design.md**：高层架构决策、方案选型
- **tasks.md**：任务数量和关键任务描述

**选项**：
- 「确认，继续下一阶段」— 产物符合预期，执行阶段守卫流转
- 「需要调整」— 附带调整说明，修改后重新请求确认

用户选择「确认」后继续执行退出条件。用户选择「需要调整」时，按其说明修改对应文件，然后重新请求确认。

## 退出条件

- `openspec status --change "<name>" --json` 的兼容性预检通过，`applyRequires` 全部为 `done` 且必需输出非空
- **用户已确认** 全部 OpenSpec artifacts 内容符合预期
- **阶段守卫**：运行 `comet guard <change-name> open --apply`，全部 PASS 后由守卫推进到下一阶段（此步骤更新 `phase` 字段，与 `auto_transition` 无关）

退出前必须使用 `--apply`，否则 `.comet.yaml` 仍停留在 `phase: open`，下一阶段入口检查会失败。

```bash
comet guard <change-name> open --apply
```

完整流程会自动更新为 `phase: design`；hotfix/tweak 预设会自动更新为 `phase: build`。

## 自动衔接下一阶段

按 `comet/reference/auto-transition.md` 执行。关键命令：

```bash
comet state next <change-name>
```

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不调用下一 skill，按 `HINT` 交还控制权并结束当前调用；不再创建确认点
- `NEXT: done` → 流程已完成，无需继续

hotfix/tweak 预设由对应预设 Skill 控制后续流转（phase 直接进入 build），其 `next` 会返回对应预设 Skill。
