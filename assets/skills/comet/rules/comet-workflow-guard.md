# Comet 当前需求阶段规则

本规则是 Native 与 Classic 共用的常驻软性防线。项目可以启用两种 workflow，但一个需求只能由一个 workflow/change 管理；不得同时套用两套阶段规则。

## 先确定当前需求

每轮开始、恢复工作或怀疑上下文被压缩后，按以下顺序检查：

1. 读取 `.comet/config.yaml`：`workflows` 表示项目启用的能力，`default_workflow` 只决定 `/comet` 的默认入口。
2. 读取 `.comet/current-change.json`：其中的 `workflow + change` 才是当前需求所有者。
3. selection 缺失，或 selection 指向的 change 已不存在/已归档时，重新枚举全项目的 Comet 活跃 change：零个表示当前没有 Comet 需求；恰好一个时只读推断；多个候选时暂停并让用户选择。
4. selection 文件不可读、格式或 schema 无效、workflow 未启用、跨分支失效或 change 状态不可安全读取时停止，不得回退到 `default_workflow` 猜测。

Classic 旧项目没有新版配置时只按 Classic legacy fallback 处理，不得因此启用 Native。

## 只应用选中的阶段规则

| Workflow | 禁止普通实现写入 | 允许普通实现写入 |
| --- | --- | --- |
| Native | Shape、Verify、Archive | Build |
| Classic | Open、Design、Verify、Archive | Build |

- Native 的 Verify 保持只读：Runtime 执行必要检查，新的 Verifier execution 独立验收全部条目；发现实现问题时，先记录失败并通过 Native Runtime 回到 Build，再修改实现。点号开头的普通项目文件不因名称而自动成为跨阶段白名单。
- Classic 的 Verify 只写验证报告和状态等阶段产物，不修改 tasks 或普通项目实现；需要更新任务状态或修复实现时，先执行 `verify-fail` 回到 Build。
- Native Build 的普通写入权限不覆盖 brief 中未解决的 `[blocking]` 用户决定；出现新决定时按 Native Skill 暂停实现并重新确认。
- Native 状态包含 `children` 时，Build 的普通写入权限只属于 Runtime `readyChildren` 中列出的子任务工作区；不得运行 Supervisor Change Builder，也不得在父级工作区实现子任务。
- Classic full workflow 只有在状态已记录 Design Doc 且实施计划存在并可用后，才允许在 Build 进行普通实现写入；hotfix 和 tweak 继续服从各自的 preset 阶段协议。
- 当前 workflow 是 Native：恢复 `/comet-native`，由可携带状态中的 Loop、blocker 和下一动作继续；本机 execution 缺失不代表 change 损坏。
- 当前 workflow 是 Classic：恢复 `/comet-classic`，由 Classic 状态、确认点和阶段协议继续。
- 不要把 Native change 转换成 Classic change，或反向转换；切换 workflow 必须选择另一个独立 change。

## Hook 约束

平台只应安装一个 Comet Hook Router。一次写入事件最多进入一个 workflow Guard；不得分别运行 Native 和 Classic Hook。

Hook 会对多文件和 patch 目标整体裁决。无法归因的事件和仅位于项目外的目标保持中立；一旦写入已归属于本项目，当前阶段不允许普通项目写入、存在多个所有权候选，或 selection、状态与目标范围无法安全读取时会失败关闭。不要绕过 Hook；按拒绝信息恢复对应 workflow，只有所有权不明确时才重新选择当前 change。

阶段表只约束普通实现写入。Classic Hook 在阶段判断前固定放行 `.comet` 配置、`.superpowers` 工作区、根目录 Markdown 和 `hook.allow_paths`；这些是显式控制或配置白名单，不扩大阶段权限，也不允许在 Verify 更新 tasks。

## 个人记忆和项目知识上下文

只有当前仓库存在 `.comet/config.yaml` 且用户正在使用 Comet 时，才执行以下投递；普通未启用 Comet 的仓库保持中立，不创建文件、不阻止工具调用：

- 任务开始或目标路径明确后运行 `comet task <project-root> --task "<task>" --phase "<phase>" --session "<本次任务稳定标识>" --json`。只使用返回的 `text`；Context Manifest（`manifest` / `<context_manifest>`）中的摘要不是完整规则，需要正文、来源或验证方式时用同一任务参数和 `--expand-context "<id>"` 展开。路径、操作或阶段变化时以同一 `--session` 重新选择，未变化内容不重复投递。
- `<active_policies>` 中的 `<verification command="...">` 必须加入当前 Verify 的实际检查并记录真实结果；未成功执行的命令不得把策略视为强制执行。
- 用户明确要求长期记住偏好或项目约定时使用 `comet memory remember`，使显式内容立即生效；只有隐式但可跨任务复用的稳定协作方式才使用 `comet memory observe`。不得把任务摘要、实现进展、命令输出或测试结果作为个人记忆。
- 实际使用某条上下文且结果明确后，以 JSON 的 `applications[].applicationId` 或 Hook 文本中的 `application_id` 运行 `comet task <project-root> --task "<task>" --application "<application-id>" --outcome used-successfully|ignored|overridden|corrected|contributed-to-failure --json`；不得为未使用条目回写成功。编译器、测试或 linter 失败时遵循工作流读取诊断并修复代码。
- 任务上下文命令不可用、项目未初始化或没有匹配片段时保持中立；插件失败不得伪装成项目检查失败。
