# Comet 当前需求阶段规则

本规则确定 Native、Classic 与 SDK Skill 应用的当前归属和写入约束。项目可以启用多种 workflow，但一个需求只能由一个 workflow/change 或应用 Run 管理；不得同时套用不同流程的规则。

## 先确定当前需求

当前 selection 的 `workflow` 为 `application` 时，使用它的 `applicationId` 与原 Run ID，恢复对应 SDK Skill 应用。读取平台 Skill 入口指向的固定包和应用 Rule；进度、批准、写入范围与恢复以同一 SDK Run 为准，不套用下方 Native/Classic 阶段表。先确认当前提案并领取 Action，再执行声明范围内的工作；SDK 状态、固定包和宿主配置由正式 Runtime/安装入口维护。平台 Rule、Hook 配置、实际 Hook 事件与业务验收分别核对；平台需要启用或信任 Hook 时按其要求处理。

开始任务、恢复上下文或切换仓库、分支、change 时执行以下轻量所有权读取；同一任务正常推进沿用当前响应：

1. 读取 `.comet/config.yaml`：`workflows` 表示项目启用的能力，`default_workflow` 只决定 `/comet` 的默认入口。
2. 读取 `.comet/current-change.json`：其中的 `workflow + change` 才是当前需求所有者。
   selection 仍然有效且继续指向同一 workflow/change 时，正常 continuation 直接沿用当前响应中的状态；这两次轻量读取不运行 `resume-probe`、不查询 `status`，也不枚举全部 change。
3. 只有 selection 缺失、失效、目标 change 已不存在或已归档，或所有权不明确时，才重新枚举全项目的 Comet 活跃 change：零个表示当前没有 Comet 需求；恰好一个时只读推断；多个候选时暂停并让用户选择。
4. selection 文件不可读、格式或 schema 无效、workflow 未启用、跨分支失效或 change 状态不可安全读取时停止，不得回退到 `default_workflow` 猜测。

Classic 旧项目没有新版配置时只按 Classic legacy fallback 处理，不得因此启用 Native。

## 只应用选中的阶段规则

| Workflow | 禁止普通实现写入              | 允许普通实现写入 |
| -------- | ----------------------------- | ---------------- |
| Native   | Shape、Verify、Archive        | Build            |
| Classic  | Open、Design、Verify、Archive | Build            |

- Native 的 Verify 保持只读：Runtime 执行缺失或已失效的检查，验收者覆盖全部条目。新 Run 由 Agent 按任务需要选择当前会话或独立只读会话；用户明确要求独立时保留 requireIndependentReview，使用真实的不同会话。旧 Run 按当前 sessionRequirements 执行；发现实现问题时，先记录失败并通过 Native Runtime 回到 Build，再修改实现。点号开头的普通项目文件不因名称而自动成为跨阶段白名单。
  Native 表中的写入限制用于验收执行者主动实现或修复。用户普通编辑按当前 native.document_writes 策略处理；允许保留编辑时，当前 Agent 在推进前判断真实影响，需求变化重新确认、实现变化修订候选、检查变化只补失效证据。采用 revert 策略时按 Hook 拒绝与恢复指引处理。

- Classic 的 Verify 只写验证报告和状态等阶段产物，不修改 tasks 或普通项目实现；需要更新任务状态或修复实现时，先执行 `verify-fail` 回到 Build。
- Native Build 的普通写入权限不覆盖 brief 中未解决的 `[blocking]` 用户决定；出现新决定时按 Native Skill 暂停实现并重新确认。
- Native 状态包含 `children` 时，Build 的普通写入权限只属于 Runtime `readyChildren` 中列出的子任务工作区；不得运行 Supervisor Change Builder，也不得在父级工作区实现子任务。
- Classic full workflow 只有在状态已记录 Design Doc 且实施计划存在并可用后，才允许在 Build 进行普通实现写入；hotfix 和 tweak 继续服从各自的 preset 阶段协议。
- 当前 workflow 是 Native：恢复 `/comet-native`。新普通 SDK 任务沿用返回的 `native next --session` 业务入口，提交结果后由 Runtime 连续处理已授权步骤。SDK 以本地 Run 为权威，Portable 在恢复边界保存检查点；旧 Run 和 Supervisor 使用各自返回的协议。
- 当前 workflow 是 Classic：恢复 `/comet-classic`，由 Classic 状态、确认点和阶段协议继续。
- 不要把 Native change 转换成 Classic change，或反向转换；切换 workflow 必须选择另一个独立 change。

## Hook 约束

平台只应安装一个 Comet Hook Router。它按当前 selection 路由 Native、Classic 或 SDK 应用，一次写入事件最多进入一个 Guard；不得分别安装或运行多套 Comet Hook。

Hook 会对多文件和 patch 目标整体裁决。无法归因的事件和仅位于项目外的目标保持中立；一旦写入已归属于本项目，当前阶段不允许普通项目写入、存在多个所有权候选，或 selection、状态与目标范围无法安全读取时会失败关闭。不要绕过 Hook；按拒绝信息恢复对应 workflow，只有所有权不明确时才重新选择当前 change。

阶段表只约束普通实现写入。Classic Hook 在阶段判断前固定放行 `.comet` 配置、`.superpowers` 工作区、中性文档和 `hook.allow_paths`；中性文档指根目录与 `docs/`、`doc/`、`documentation/`、`.github/` 下的 Markdown/text 文档及 LICENSE 类文件（OpenSpec 与 Superpowers 流程产物除外）。这些是显式控制或配置白名单，不扩大阶段权限，也不允许在 Verify 更新 tasks。在 `.comet/config.yaml` 设置 `classic.document_evidence: strict` 时，白名单回退为仅根目录 Markdown。

Native 正式产物位于配置解析出的 `<artifact-root>/comet/changes/<change>/`。本机 Runtime 数据位于用户 Comet 数据目录，按 checkout 和 Git worktree 隔离，以命令返回的 `runtimeDir` 为准；项目 `.comet/runtime/native/` 是旧版本布局，不用它推断当前 Run 位置。仅凭文件名、`comet/changes/<name>` 片段或当前存在 active change 不能推断其他目录归属；普通同名 Markdown、非 Comet 工作和明确配置的用户 Hook 输出保持放行。需要写 Native 正式产物时先用 CLI 创建 change，并按拒绝信息给出的完整命令或正确绝对路径修正后重试，不手工改 Runtime 文件或迁移遗留文件。

拒绝信息中的诊断动作只用于查看状态，不能代替恢复命令。存在 Runtime 返回的恢复命令时，在指定工作目录执行后重试原操作；如果 `continuation.commandArgs` 已给出下一动作，直接按其参数执行。Native Archive 失败时处理当前响应列出的实际阻塞并执行返回命令。SDK 沿用原 Run 和已接受结果；Compat 仅在返回命令包含时使用 `--confirmed` 或 finish 参数，例如返回的 `comet native archive <change> --confirmed`；SDK 不套用该示例。

## 个人记忆和项目知识上下文

只有当前仓库存在 `.comet/config.yaml` 且用户正在使用 Comet 时，才执行以下投递；普通未启用 Comet 的仓库保持中立，不创建文件、不阻止工具调用：

- 领取响应已有 `contextDelivery` 时复用已交付上下文；缺少交付且当前任务需要上下文时运行 `comet task <project-root> --task "<task>" --phase "<phase>" --session "<本次任务稳定标识>" --json`。只使用返回的 `text`；Context Manifest（`manifest` / `<context_manifest>`）中的摘要不是完整规则，需要正文、来源或验证方式时用同一任务参数和 `--expand-context "<id>"` 展开。路径、操作或阶段变化时以同一 `--session` 重新选择，未变化内容不重复投递。
- `<active_policies>` 中的 `<verification command="...">` 必须加入当前 Verify 的实际检查并记录真实结果；未成功执行的命令不得把策略视为强制执行。
- 用户明确要求长期记住偏好或项目约定时使用 `comet memory remember`，使显式内容立即生效；只有隐式但可跨任务复用的稳定协作方式才使用 `comet memory observe`。不得把任务摘要、实现进展、命令输出或测试结果作为个人记忆。
- 任务结束前把本次验证过、后续可复用的项目经验写入项目记忆：`comet knowledge remember <project-root> --title "<简明标题>" --text "<现象、做法、验证结果>" --type <fact|decision|pattern|procedure|constraint|failure-resolution> --json`。同一标题默认更新同一条记忆，不重复建新条目；没有可复用经验时跳过，任务摘要、一次性命令输出和未验证的猜测不得写入。项目记忆索引会随任务上下文注入，需要某条完整内容时用同一任务参数追加 `--expand-context "project-memory:<slug>"` 展开。
- Native 仅在有用户明确纠正、记忆请求或已验证的可复用观察时提交学习；使用 `comet task --complete` 提交时按实际情况填写 `--learning-check submitted|no-observation|not-run`。普通完成跳过空学习检查、空队列查询及无关待评审处理。Classic 按其 Skill 的学习协议执行。观察结果以 JSON 的 `learning.result` 和 `status.learning.lastCheck` 为准；首次观察是 `trial` 候选，不能把一次任务成功直接当成长期偏好。
- 实际使用某条上下文且结果明确后，以 JSON 的 `applications[].applicationId` 或 Hook 文本中的 `application_id` 运行 `comet task <project-root> --task "<task>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`；不得为未使用条目回写成功。编译器、测试或 linter 失败时遵循工作流读取诊断并修复代码。
- 任务上下文命令不可用、项目未初始化或没有匹配片段时保持中立；插件失败不得伪装成项目检查失败。
