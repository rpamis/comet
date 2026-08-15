---
generated_from_state_version: 43
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 7
- Iteration: 2
- Verifier attempt: 1
- Completed: 2026-08-15T11:04:12.761Z
- Summary: 独立只读终审通过：A1-A333 全部通过；当前候选已删除仓库根目录 dashboard-installed-snapshot.json 并加入 Git 忽略，SQLite 索引仍位于用户缓存。父级 18 项 Runtime 检查全部通过，独立重跑的 19 个相关测试文件共 134 个测试和 clean HEAD 架构检查全部通过。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | 用户可以通过 Comet 安装、启用、停用和卸载一个第三方插件；同一插件机制也管理个人记忆与项目规则两个第一方插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A2 | passed | brief.md | 用户只停用个人记忆插件后，Comet workflow 和项目规则插件继续工作；停用项目规则插件也不会中断个人记忆或基础 workflow。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A3 | passed | brief.md | 用户说“记住：只暂存本次改动文件”，个人记忆立即生效，并保留明确来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A4 | passed | brief.md | Comet 只在一个 change 中观察到小范围暂存时只形成内部候选；第二个独立成功 change 再次出现一致行为后自动生效，第一次实际影响 Agent 做法时才简短提示。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A5 | passed | brief.md | “偏好中文回复”可以进入小型个人画像；“项目 A 使用 `pnpm build`”只在项目 A 的相关任务中按需加载。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A6 | passed | brief.md | 项目 A 的 `~/.comet/memory/projects/<project-key>.md` 可以显示“构建使用 `pnpm build`”；用户直接改为 `npm run build` 后，下一次项目 A 任务使用新命令，其他项目不受影响。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A7 | passed | brief.md | 项目记忆文件只出现在专用私有记忆仓库的 Git diff 中，不进入项目 A 的普通 Git diff；需要团队共享的内容进入项目规则，而不是个人项目记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A8 | passed | brief.md | 一个没有形成任何可复用记忆的新项目不会出现空的项目记忆文件；用户手动创建对应 `projects/<project-key>.md` 并写入项目命令后，内容立即作为显式项目记忆生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A9 | passed | brief.md | 当前要求与历史记忆冲突时，Agent 执行当前要求并提示被忽略的记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A10 | passed | brief.md | 用户关闭自动学习后仍可显式要求记住；关闭检索后记录继续保留但不进入 Agent 上下文。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A11 | passed | brief.md | 用户只暂停项目 A 的自动学习后，项目 B 继续正常学习；项目 A 恢复后继续使用暂停前的数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A12 | passed | brief.md | 用户直接编辑个人画像 Markdown 后，下一次相关任务使用纠正后的内容；文件中仍只保留当前画像，不展开详细历史和来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A13 | passed | brief.md | 用户在个人画像的“沟通偏好”列表中手动加入“使用中文回复”，该偏好立即生效；Comet 后续更新不会删除用户注释或无故重排文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A14 | passed | brief.md | 用户从个人画像中移除“偏好中文回复”后，该偏好立即停止生效，过去的任务观察不会自动把它加回来；用户仍可通过回滚恢复，或明确永久删除相关历史。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A15 | passed | brief.md | 用户曾显式保存“偏好中文回复”，后续多个独立成功 change 持续表现出新的稳定偏好时，Comet 自动更新画像，不要求用户先确认。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A16 | passed | brief.md | 项目 A 从 `pnpm` 改为 `npm` 后，当前仓库文件与旧构建记忆冲突，Comet 不再采用旧命令并提示该记忆已经不符合项目现状。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A17 | passed | brief.md | 用户在同一仓库的新 worktree 中继续工作时可以使用已有项目记忆；切换到该仓库的 fork 时默认不加载原项目记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A18 | passed | brief.md | 用户在 Codex 中形成的个人偏好，在另一会话、另一宿主或另一台已连接设备上通过 Comet 工作时继续生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A19 | passed | brief.md | 连续运行大量 change 并重复观察相同习惯后，个人画像和每轮注入量仍保持固定上限，详细记忆不产生重复项；当前偏好、必要来源和回滚能力仍然可用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A20 | passed | brief.md | Codex 与 Claude Code 同时写入两条不同记忆时两条都被保留；同时写入同一条记忆时只形成一条；用户并发手动移除偏好时，旧的后台观察不会把它写回来。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A21 | passed | brief.md | 长期记忆不会生成保存完整对话、工具调用、原始 diff 或完整命令输出的新 trajectory 文件；专用仓库中的项目记忆文件也不会被写成任务流水账。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A22 | passed | brief.md | 用户在设备 A 形成“偏好中文回复”后，记忆插件把记忆文件提交并同步到配置的 Git remote；设备 B 检出同一记忆仓库后，新 Comet 会话直接使用该偏好，不需要重新学习。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A23 | passed | brief.md | 专用私有记忆仓库包含 `profile.md` 和 `projects/` 下的项目记忆；同步不会在用户正在开发的项目仓库中产生个人记忆提交。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A24 | passed | brief.md | 用户只安装个人记忆插件时可以正常学习和检索记忆，但不会出现项目规则的自动发现、候选提示或上下文路由。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A25 | passed | brief.md | 用户说“把『domains 层不得直接访问文件系统』加入项目规则”，仓库已有架构 linter 时，Comet 生成对该 linter 配置或测试的改动，而不是创建 `.comet/rules`。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A26 | passed | brief.md | 用户说“数据库迁移必须同步更新回滚说明”，该要求需要 Agent 判断时，Comet 生成对最相关 Agent 指令文件的改动。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A27 | passed | brief.md | 用户手动创建 `.comet/rules/database.md`，用普通标题和列表写入多条数据库规则；Comet 后续盘点直接识别，不要求 frontmatter 或登记命令。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A28 | passed | brief.md | 用户直接修改 `AGENTS.md` 或 ESLint 配置后，Comet 后续盘点能够识别新的项目现状，不要求再次登记。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A29 | passed | brief.md | Comet 第一次从成功任务中发现某个代码模式时只生成内部候选；另一独立任务或仓库修订再次出现一致模式后形成非阻塞建议，但不自动修改规则文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A30 | passed | brief.md | 用户只通过 Comet Skill 工作时，稳定候选在任务结束点以简短消息出现；用户回复“加入”后，Comet 直接修改合适的规则来源或原生检查配置，不要求创建规则专用 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A31 | passed | brief.md | 用户在没有 active change 的普通 Comet Skill 任务中手动创建规则，和在 Native、Classic、Hotfix 或 Tweak 中创建规则的结果相同；规则的读取与执行不依赖这些 workflow 状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A32 | passed | brief.md | 已有 ESLint、Semgrep、测试或 CI 能执行某项要求时，Comet 复用原生能力，不复制自然语言规则和自定义执行协议。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A33 | passed | brief.md | Maven 项目通过 Checkstyle、SpotBugs 或其他插件把规则接入构建生命周期后，Comet 发现项目实际验证命令；Agent 修改代码后运行该命令，按插件诊断修复并重跑，不要求 Maven 插件实现 Comet 接口。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A34 | passed | brief.md | Maven 插件输出 warning 但验证命令成功时，Comet 不强制扩大当前改动；团队在 Maven 配置中把该问题设为构建失败后，Agent 才必须修复并重跑。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A35 | passed | brief.md | 行业基线与当前明确团队决定冲突时，Comet 显示冲突，不自动修改配置。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A36 | passed | brief.md | 没有 Hook 但支持宿主 Rule 的平台通过轻量规则加载器选择相关 Markdown 段落；Hook 和 Rule 都不可用时由 Comet Skill 完成同一动作。所有平台继续依靠仓库命令和 CI 执行可确定检查的规则，用户不需要打开 Dashboard 或手动运行 Comet CLI。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A37 | passed | brief.md | 用户只安装项目规则插件时仍可发现、读取和执行仓库规则，不要求安装个人记忆插件；停用该插件后不再自动发现或提供规则，但仓库文件和原生检查保持原样。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A38 | passed | brief.md | 同一条带来源观察同时与两个能力相关时，个人记忆和项目规则分别处理；个人偏好不会自动成为团队规则，项目规则也不会写入个人记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A39 | passed | brief.md | 用户说“记住：以后提交后都推送”时，Comet 可以记住操作偏好，但后续任务没有授权推送时仍不得执行推送。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A40 | passed | brief.md | 用户打开 Comet Dashboard 时，主侧边栏同时显示“个人记忆”和“项目规则”两个独立入口；切换入口会分别打开对应中心页面，而不是切换到某个 workflow 或 change 的子页面。 | 根目录快照已从当前 HEAD 删除并加入 .gitignore；clean HEAD 架构检查通过，符合索引保留在用户缓存目录的设计。 |
| A41 | passed | brief.md | 个人记忆中心页可以查看和纠正当前画像、项目记忆与本轮使用情况，暂停学习或检索，查看 Git 同步状态以及执行删除和回滚；这些操作立即反映到同一份记忆数据和用户可读文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A42 | passed | brief.md | 项目规则中心页可以初始化或重新扫描当前项目，查看规则来源、验证入口和候选，并执行加入、忽略或稍后；这些操作不创建 Comet change，也不产生 Dashboard 专属规则副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A43 | passed | brief.md | 用户停用个人记忆插件后，其中心页显示停用状态并允许重新启用，项目规则页仍可使用；卸载个人记忆插件后入口消失但记忆数据保留。项目规则插件遵循相同生命周期语义。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A44 | passed | specs/comet-plugin-runtime/spec.md | > 状态：Shape 正在澄清。本文记录已经确认的产品行为；具体包格式、命令名称和进程边界在 Design 中决定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A45 | passed | specs/comet-plugin-runtime/spec.md | Comet 提供公开、稳定的插件机制，让第一方和第三方能力以相同方式接入。自进化个人记忆与项目规则是首批第一方插件，不作为 Comet Core 中无法移除的特殊功能。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A46 | passed | specs/comet-plugin-runtime/spec.md | 两个第一方插件随 Comet 默认安装并启用；用户可以独立查看、启用、停用、更新和卸载它们，也可以明确安装第三方插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A47 | passed | specs/comet-plugin-runtime/spec.md | 这两个插件首次随新版 Comet 发布时，已有用户升级后自动安装并启用，不要求手动发现或安装新能力。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A48 | passed | specs/comet-plugin-runtime/spec.md | 用户之后明确停用或卸载任一第一方插件时，后续 Comet 更新保留该状态，不得自动重新启用或重新安装；用户仍可通过 Skill、CLI 或 Dashboard 主动恢复。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A49 | passed | specs/comet-plugin-runtime/spec.md | Comet Skill 是主要交互入口；用户可以直接说“安装、启用、停用或卸载某个插件”，不要求先打开 Dashboard 或手动使用 CLI。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A50 | passed | specs/comet-plugin-runtime/spec.md | CLI 与 Dashboard 可以提供同一能力，但不能维护另一套插件状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A51 | passed | specs/comet-plugin-runtime/spec.md | 公开插件接口提供 Dashboard 功能页接入点；已安装插件可以在 Comet Dashboard 主侧边栏贡献一个独立入口，并在统一页面外壳中展示自己的中心页面，第一方插件不使用私有接入方式。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A52 | passed | specs/comet-plugin-runtime/spec.md | 已安装但停用的插件入口继续显示，并呈现停用状态与重新启用操作；卸载插件后入口移除，保留的数据不因此删除。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A53 | passed | specs/comet-plugin-runtime/spec.md | 插件中心页调用与 Skill、CLI 相同的领域能力和存储，不建立 Dashboard 专属状态；一个插件页面加载或调用失败时只显示该插件诊断，不影响其他页面。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A54 | passed | specs/comet-plugin-runtime/spec.md | Dashboard 工作流页面继续只读；插件中心页只能执行该插件公开声明的管理操作，具体页面贡献格式与隔离方式在 Design 中确定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A55 | passed | specs/comet-plugin-runtime/spec.md | 安装和更新第三方插件必须是用户明确发起的操作，Comet 不根据项目内容静默下载或执行插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A56 | passed | specs/comet-plugin-runtime/spec.md | 停用插件立即停止其后续处理，但保留插件数据；卸载也不自动删除数据，永久删除必须由用户明确执行。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A57 | passed | specs/comet-plugin-runtime/spec.md | 第一方和第三方插件使用同一套公开接口完成发现、加载、生命周期、配置、诊断和能力调用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A58 | passed | specs/comet-plugin-runtime/spec.md | Comet Core 提供有来源的 workflow 生命周期事件、受控的上下文提供入口、插件隔离存储和必要的项目/用户作用域信息。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A59 | passed | specs/comet-plugin-runtime/spec.md | 插件只能通过公开接口贡献能力，不能直接修改 Native、Classic、Hotfix 或 Tweak 的内部状态机与 Guard。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A60 | passed | specs/comet-plugin-runtime/spec.md | 插件拥有独立名称、版本与兼容范围；不兼容插件在执行前被拒绝并给出可理解原因。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A61 | passed | specs/comet-plugin-runtime/spec.md | 公开接口的兼容变更遵循 Comet 版本策略；插件不需要读取 Comet 私有 Runtime 文件来判断兼容性。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A62 | passed | specs/comet-plugin-runtime/spec.md | 插件在用户作用域安装，并按声明的作用域生效：个人记忆插件服务当前用户的 Comet 任务，项目规则插件只在已启用 Comet 的项目中运行；用户可以全局或按项目暂停支持相应作用域的插件能力。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A63 | passed | specs/comet-plugin-runtime/spec.md | 一个插件缺失、停用、版本不兼容或运行失败时，其他插件和 Comet 基础 workflow 继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A64 | passed | specs/comet-plugin-runtime/spec.md | 插件的数据、配置和日志相互隔离；一个插件不能直接读写另一个插件的私有数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A65 | passed | specs/comet-plugin-runtime/spec.md | 插件失败通过统一诊断返回，不伪装成项目编译、linter、测试或 workflow 失败。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A66 | passed | specs/comet-plugin-runtime/spec.md | Comet Core 不保留只有第一方插件才能调用的隐式加载或生命周期路径。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A67 | passed | specs/comet-plugin-runtime/spec.md | 自进化个人记忆插件负责学习、同步、检索和管理个人偏好及项目记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A68 | passed | specs/comet-plugin-runtime/spec.md | 项目规则插件负责规则发现、候选交互、上下文选择和原生检查修复循环，并通过 `comet rules` 命名空间提供项目初始化、重新扫描和状态查看命令。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A69 | passed | specs/comet-plugin-runtime/spec.md | 两个插件可以消费同一批有来源事件，但各自判断、存储和生效；是否安装其中一个不影响另一个的可用性。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A70 | passed | specs/comet-plugin-runtime/spec.md | 两个插件的完整领域行为分别由各自规格定义，公开插件机制不把它们的专有数据模型塞入 Comet Core。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A71 | passed | specs/comet-plugin-runtime/spec.md | 用户只安装个人记忆插件时可以学习和检索记忆，不会启用项目规则；反向安装也成立。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A72 | passed | specs/comet-plugin-runtime/spec.md | 已有用户升级到首次包含这两个插件的 Comet 版本后可以直接使用它们；用户随后卸载项目规则插件，再次更新 Comet 时该插件不会被自动装回，个人记忆插件继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A73 | passed | specs/comet-plugin-runtime/spec.md | 用户停用个人记忆插件后，新任务不再学习或加载个人记忆，但项目规则和 Comet workflow 继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A74 | passed | specs/comet-plugin-runtime/spec.md | 用户卸载项目规则插件后，仓库已有规则与原生检查配置保留，个人记忆插件继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A75 | passed | specs/comet-plugin-runtime/spec.md | 一个使用公开接口编写的最小第三方插件可以完成安装、启用、接收一次受支持事件、提供结果、停用和卸载。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A76 | passed | specs/comet-plugin-runtime/spec.md | 一个通过公开接口提供 Dashboard 功能页的插件安装后出现在主侧边栏，停用后保留可重新启用的中心页，卸载后入口消失；第一方个人记忆和项目规则页面遵循同一接入方式。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A77 | passed | specs/comet-plugin-runtime/spec.md | 个人记忆页面加载失败时，项目规则、Classic 和 Native 页面仍能打开并正常工作，诊断只显示在个人记忆页面。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A78 | passed | specs/comet-plugin-runtime/spec.md | 插件声明的兼容范围不包含当前 Comet 版本时，Comet 拒绝加载并说明版本不兼容；其他插件仍可正常使用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A79 | passed | specs/comet-plugin-runtime/spec.md | 插件启动或执行失败时，Comet 隔离该失败并提供诊断，不让 Native、Classic、Hotfix、Tweak 或其他插件失效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A80 | passed | specs/personal-memory/spec.md | > 状态：Shape 已按“小型常驻画像 + 按需历史检索 + 稳定检查点后台复盘”重新收敛。本文只记录用户已经确认的产品行为。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A81 | passed | specs/personal-memory/spec.md | 该插件在用户正常使用 Comet workflow 时学习稳定的个人偏好、项目事实、常用操作和工作习惯。用户无需维护内部 schema；插件只把少量普遍适用的信息常驻提供给 Agent，详细内容在相关任务中按需检索，并通过 Git 同步记忆文件，让同一用户在不同会话与设备上继续使用记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A82 | passed | specs/personal-memory/spec.md | 自进化个人记忆作为随 Comet 默认安装并启用的第一方插件接入，但可以独立停用或卸载，不是 Comet Core 中不可移除的内置行为。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A83 | passed | specs/personal-memory/spec.md | 插件使用与第三方插件相同的公开 Comet 接口，不依赖第一方私有加载、事件或存储入口。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A84 | passed | specs/personal-memory/spec.md | 插件可以独立安装、启用、停用和卸载，不要求同时安装项目规则插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A85 | passed | specs/personal-memory/spec.md | 停用后立即停止学习和检索，但保留已有数据；卸载插件也不自动删除记忆，永久删除必须由用户明确执行。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A86 | passed | specs/personal-memory/spec.md | 插件缺失、停用或运行失败时，Comet 基础 workflow 继续工作，只是不学习或提供个人记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A87 | passed | specs/personal-memory/spec.md | 插件只通过 Comet 提供的有来源生命周期事件和受控上下文接口工作，不能扩大当前任务授权，也不能直接读写项目规则插件的内部状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A88 | passed | specs/personal-memory/spec.md | **全局个人画像**：专用私有记忆仓库中的 `profile.md` 保存少量跨项目且普遍适用的当前偏好，例如回复语言、沟通方式和提交范围习惯。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A89 | passed | specs/personal-memory/spec.md | **项目记忆**：专用私有记忆仓库的 `projects/` 下按项目保存事实、构建命令、路径相关习惯和常用操作，只在对应项目中使用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A90 | passed | specs/personal-memory/spec.md | **按需详情**：来源摘要和详细历史由用户级 Comet Runtime 管理，只在匹配项目与任务时读取。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A91 | passed | specs/personal-memory/spec.md | **历史任务**：完整会话和工具轨迹不进入个人记忆；需要追溯时由宿主或独立任务历史能力按需读取。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A92 | passed | specs/personal-memory/spec.md | 用户看到的是可读的记忆内容和来源，不需要理解候选状态、证据计数、索引或 Runtime 文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A93 | passed | specs/personal-memory/spec.md | 用户可读记忆文件只呈现当前生效内容，不展开详细历史、来源、索引或任务流水。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A94 | passed | specs/personal-memory/spec.md | 项目记忆只保存在专用私有记忆仓库的 `projects/<project-key>.md`，不在开发项目内创建第二份可写镜像，也不把个人记忆提交到团队项目仓库。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A95 | passed | specs/personal-memory/spec.md | 同一仓库的其他 worktree、目录移动和同一远端的重新克隆通过用户级记忆继续共享同一份项目内容。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A96 | passed | specs/personal-memory/spec.md | 安装 Comet 或首次进入项目时不创建空记忆文件；第一次形成对应作用域的记忆时再创建，用户也可以提前手动创建文件并直接写入内容。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A97 | passed | specs/personal-memory/spec.md | 用户可读记忆文件使用少量用户可理解的 Markdown 标题和列表，不要求 frontmatter、ID、状态或其他机器字段。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A98 | passed | specs/personal-memory/spec.md | 用户直接新增列表项视为该作用域内的显式记忆；Comet 更新文件时尽量保留用户的文字、注释和顺序，不把文件重写成机器配置。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A99 | passed | specs/personal-memory/spec.md | 详细记忆、来源、检索索引和轻量学习事件由用户级 Comet Runtime 按需管理，用户不需要通过两个 Markdown 文件维护内部数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A100 | passed | specs/personal-memory/spec.md | 自动学习默认开启，用户可以关闭。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A101 | passed | specs/personal-memory/spec.md | 用户明确说“记住”“以后都这样”或表达同等意图时，记忆立即生效，不等待后台复盘或重复观察。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A102 | passed | specs/personal-memory/spec.md | 当前用户要求始终高于历史记忆；发生冲突时执行当前要求，并说明哪条历史记忆被忽略。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A103 | passed | specs/personal-memory/spec.md | 显式纠正可以替换当前记忆，同时保留可回滚历史。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A104 | passed | specs/personal-memory/spec.md | 用户直接修改或移除专用仓库中的 `profile.md` 或 `projects/<project-key>.md` 时以用户编辑为准；修改只在对应作用域生效，移除的内容立即停止生效，过去的观察不能自动把它重新写回。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A105 | passed | specs/personal-memory/spec.md | 移除后产生的新观察仍可以按正常稳定条件重新学习该偏好，但不能复用移除前的旧观察凑足条件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A106 | passed | specs/personal-memory/spec.md | 被修改或移除内容的详细历史暂时保留以支持查看和回滚，只有用户明确永久删除时才清除。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A107 | passed | specs/personal-memory/spec.md | 记忆只能影响当前请求已经授权的操作方式。无论来自自动学习还是用户显式保存，都不能成为提交、推送、删除、发布、外部消息或其他有外部影响操作的长期授权。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A108 | passed | specs/personal-memory/spec.md | 普通执行期间只记录带来源的轻量事件，不在每轮对话后运行记忆提取，也不打断当前任务。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A109 | passed | specs/personal-memory/spec.md | 成功的 phase 转换、显式 checkpoint、任务完成和 Archive 等稳定检查点触发一次非阻塞后台复盘。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A110 | passed | specs/personal-memory/spec.md | 后台复盘只保留值得跨任务复用的偏好、事实、习惯或操作摘要；跳过临时路径、一次性要求、容易重新发现的公共知识、原始日志和大段 diff。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A111 | passed | specs/personal-memory/spec.md | 推断偏好第一次出现只形成内部候选；至少两个独立 Comet change 提供一致且无冲突的成功证据后才自动生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A112 | passed | specs/personal-memory/spec.md | 达到稳定条件后，自动学习自行新增、更新或替换记忆，不要求用户逐条确认；用户可以随时查看、纠正、移除或回滚。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A113 | passed | specs/personal-memory/spec.md | 后续稳定行为可以自动取代过去推断或显式保存的偏好；一次性要求、单个 change 和失败行为不能触发替换。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A114 | passed | specs/personal-memory/spec.md | 学习和更新过程默认保持安静；内部候选和重复计数不在普通使用中展示。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A115 | passed | specs/personal-memory/spec.md | 个人偏好不设置统一的时间期限，持续生效到用户纠正、移除或新的稳定行为取代。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A116 | passed | specs/personal-memory/spec.md | 长期使用中，后台复盘在稳定检查点自动合并重复记忆、压缩重复来源并整理已取代内容，不在每轮对话中额外运行整理。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A117 | passed | specs/personal-memory/spec.md | 自动整理保留当前记忆、必要来源摘要和可回滚历史；重复观察与过细来源可以合并压缩，避免详细记录随 change 数量线性增长。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A118 | passed | specs/personal-memory/spec.md | 自动整理不得改变当前生效偏好的含义、跨越项目作用域、丢失当前内容，或让用户已经移除的内容重新生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A119 | passed | specs/personal-memory/spec.md | 个人画像与每轮注入内容始终遵守固定上限；详细存储增长后，检索质量和正常任务的上下文占用不得持续恶化。具体整理阈值和保留量由 Design/Eval 确定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A120 | passed | specs/personal-memory/spec.md | 自动整理失败不得影响当前任务、阶段转换或原有记忆；原数据保持可用，并在后续稳定检查点继续处理。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A121 | passed | specs/personal-memory/spec.md | 同一用户的多个会话、Comet 宿主、进程或设备可以同时读写个人记忆，不要求用户关闭其他 Agent。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A122 | passed | specs/personal-memory/spec.md | 并发写入必须完整保留不同内容、合并等价内容，并避免文件损坏、更新丢失和重复记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A123 | passed | specs/personal-memory/spec.md | 用户手动编辑或移除个人画像内容时，该操作高于并发自动学习；相互冲突的自动更新不得静默覆盖当前画像，只作为后续稳定观察继续判断。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A124 | passed | specs/personal-memory/spec.md | 独立观察使用“项目身份 + workflow 家族 + change ID”去重，不使用宿主聊天、会话或工具调用次数。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A125 | passed | specs/personal-memory/spec.md | Native、Classic、Hotfix 和 Tweak 都以 change 为单位；Hotfix/Tweak 连续推进、恢复会话或原地升级为 full 不产生新的独立观察。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A126 | passed | specs/personal-memory/spec.md | 未归档 change 通过稳定成功检查点后可以贡献一次正向观察。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A127 | passed | specs/personal-memory/spec.md | 失败或取消的 change 可以形成候选、冲突或负向信号，但不能计作自动生效所需的正向观察；恢复成功后只升级同一 change 的证据状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A128 | passed | specs/personal-memory/spec.md | 用户在失败或取消过程中显式要求记住的内容仍立即生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A129 | passed | specs/personal-memory/spec.md | 个人偏好和通用操作习惯默认在同一用户的所有 Comet 项目、会话和已连接设备间共享。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A130 | passed | specs/personal-memory/spec.md | 项目事实、构建命令、路径相关习惯和项目内操作默认只在所属项目生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A131 | passed | specs/personal-memory/spec.md | 项目事实不按统一时间自动过期；使用前能够通过当前仓库核对时先核对，发现明确冲突就停止采用旧记忆并提示用户。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A132 | passed | specs/personal-memory/spec.md | 用户明确指定“全局适用”或“仅此项目”时，明确作用域高于默认分类。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A133 | passed | specs/personal-memory/spec.md | 同一 Git 仓库的 worktree、目录移动和同一远端的重新克隆默认共享项目记忆；fork 和不同仓库默认隔离。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A134 | passed | specs/personal-memory/spec.md | 用户可以手动拆分误共享的项目记忆，或合并本应属于同一项目的记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A135 | passed | specs/personal-memory/spec.md | 同一用户的个人记忆在所有 Comet 宿主与已连接设备间统一共享，不区分 Codex、Claude Code、Cursor 等宿主作用域。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A136 | passed | specs/personal-memory/spec.md | Comet 不引入账户、登录或用户中心；跨设备使用必须通过设备身份和同步介质建立同一记忆空间。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A137 | passed | specs/personal-memory/spec.md | 多个设备通过同一记忆 Git 仓库建立同一记忆空间，复用用户现有的 Git 身份和凭据；设备本地路径、宿主会话 ID 和进程状态不能作为跨设备身份。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A138 | passed | specs/personal-memory/spec.md | 跨设备使用必须提交并同步当前记忆、必要来源和冲突处理所需状态；完整对话、原始 diff、完整命令输出和凭据不得进入记忆仓库。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A139 | passed | specs/personal-memory/spec.md | `profile.md` 和 `projects/<project-key>.md` 是可读、可编辑的当前内容，并通过专用 Git 仓库成为跨设备的唯一可写来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A140 | passed | specs/personal-memory/spec.md | 个人记忆统一保存在一个专用私有 Git 仓库，默认位于 `~/.comet/memory/`；首次形成记忆时自动初始化本地仓库，不要求用户先配置 remote。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A141 | passed | specs/personal-memory/spec.md | 尚未配置 remote 时，自动学习、检索、用户编辑和本地历史都正常工作；首次形成本地记忆后只低打扰提示一次可配置 remote 获得跨设备同步，不阻塞当前或后续任务。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A142 | passed | specs/personal-memory/spec.md | 用户只需要配置一次记忆仓库 remote；插件复用已有 Git 凭据，不要求 Comet 账户、设备配对或中继服务。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A143 | passed | specs/personal-memory/spec.md | 用户稍后配置 remote 时，插件同步已有的 `profile.md`、`projects/` 和必要历史，不要求重新学习已经形成的记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A144 | passed | specs/personal-memory/spec.md | 稳定检查点完成记忆更新后，插件自动拉取远端变化、合并记忆、创建仅包含记忆仓库内容的提交并推送。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A145 | passed | specs/personal-memory/spec.md | 这项自动同步授权只适用于用户明确配置的记忆仓库，不能授权插件提交或推送当前开发项目仓库。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A146 | passed | specs/personal-memory/spec.md | remote 不可用或 Git 同步失败时，插件保留本地记忆和本地提交，当前任务继续完成；后续稳定检查点自动重试。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A147 | passed | specs/personal-memory/spec.md | 多设备产生不同记忆时全部保留；等价内容自动合并。无法安全自动合并的同一记忆不允许静默覆盖，先保留两侧内容并停止让冲突内容影响 Agent，等待后续明确证据或用户编辑解决。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A148 | passed | specs/personal-memory/spec.md | 后台复盘可以临时分析当前任务中 Agent 已获授权查看的用户消息、工具操作、Git diff、测试结果和 Review 反馈。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A149 | passed | specs/personal-memory/spec.md | 分析不授予新的文件、仓库、账户或项目权限。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A150 | passed | specs/personal-memory/spec.md | 长期只保存归纳后的记忆内容、作用域、来源类型、change 引用、时间和必要摘要，不保存完整对话、原始 diff 或完整命令输出。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A151 | passed | specs/personal-memory/spec.md | 轻量学习事件只指向完成复盘所需的 change、检查点和来源类型，不复制完整消息、工具日志、diff 或命令输出。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A152 | passed | specs/personal-memory/spec.md | 不新增保存完整任务过程的记忆 trajectory 文件；Native/Classic 已有 trajectory 继续只记录 workflow 机器状态，不作为原始记忆来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A153 | passed | specs/personal-memory/spec.md | 凭据、密钥、环境秘密、隐藏推理和项目范围外数据不得进入提取输入或长期记录。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A154 | passed | specs/personal-memory/spec.md | 个人记忆可以与项目规则消费同一批带来源观察，但必须独立判断、独立存储和独立生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A155 | passed | specs/personal-memory/spec.md | 个人记忆不能自动写入 Agent 指令、项目检查配置或团队共享规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A156 | passed | specs/personal-memory/spec.md | Comet 启动任务时只提供有固定上限的全局个人画像；进入项目后读取该项目当前记忆，并按路径、任务类型和操作检索必要详情。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A157 | passed | specs/personal-memory/spec.md | 候选、已拒绝、已过期、已取代和冲突未解决的记录不参与正常检索。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A158 | passed | specs/personal-memory/spec.md | MVP 使用结构化类别、作用域、项目、路径、任务类型、操作、规范化标签和关键词匹配，不依赖 embedding、向量数据库或模型自由相关性评分。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A159 | passed | specs/personal-memory/spec.md | 检索按“显式高于推断、项目匹配高于全局、结构化匹配更具体优先、最近确认优先、稳定 memory ID 打破平局”排序。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A160 | passed | specs/personal-memory/spec.md | 当前任务中的用户要求和仓库现行配置不属于可裁剪记忆，始终高于个人记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A161 | passed | specs/personal-memory/spec.md | 当前仓库与项目事实记忆明确冲突时，以仓库现状为准，旧记忆不参与本次操作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A162 | passed | specs/personal-memory/spec.md | Comet Skill 不能可靠知道所有宿主的上下文窗口和剩余 token，因此常驻画像与按需结果分别使用固定的保守条目数和大小上限；具体数值通过 Design/Eval 确定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A163 | passed | specs/personal-memory/spec.md | 超出上限时保留摘要和 memory ID，详情按需读取；没有可靠命中时不注入详细记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A164 | passed | specs/personal-memory/spec.md | 宿主没有动态注入能力时，Comet 入口仍可读取并提供有界的相关记忆，核心能力不依赖特定 UI 或 Hook。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A165 | passed | specs/personal-memory/spec.md | 普通常驻偏好和没有改变关键行为的加载默认安静，不在每轮重复播报。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A166 | passed | specs/personal-memory/spec.md | 只有新记忆第一次实际改变 Agent 的做法，或记忆与当前要求冲突时，Agent 才简短提示记忆内容、作用域和采用或忽略原因；提示不要求用户处理。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A167 | passed | specs/personal-memory/spec.md | Comet Dashboard 主侧边栏提供独立的“个人记忆”入口，打开个人记忆中心页；该页面属于当前用户，不嵌入 Classic、Native 或某个 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A168 | passed | specs/personal-memory/spec.md | 中心页以用户可读方式展示全局个人画像、当前项目记忆、本轮加载与采用情况、自动学习和检索状态、Git remote 与最近同步状态，不展示完整对话、原始 diff、内部候选计数或 Runtime 机器字段。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A169 | passed | specs/personal-memory/spec.md | 用户可以在中心页查看、纠正、删除和回滚记忆，暂停或恢复全局/当前项目的学习与检索，并配置或检查记忆仓库 remote；永久删除继续要求明确确认。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A170 | passed | specs/personal-memory/spec.md | 中心页的修改直接作用于与 Skill、CLI、`profile.md` 和 `projects/<project-key>.md` 相同的领域数据，不生成 Dashboard 专属记忆文件或副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A171 | passed | specs/personal-memory/spec.md | 已安装但停用的个人记忆插件仍显示入口和停用状态，并允许重新启用；卸载后入口消失但记忆仓库和 Runtime 数据保持不变。Dashboard 不可用时，自动学习、检索、Git 同步和 Skill 管理入口继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A172 | passed | specs/personal-memory/spec.md | CLI 和 Dashboard 提供同一套列出、查看、本轮使用情况、纠正、删除和回滚能力，并复用同一领域服务与数据模型。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A173 | passed | specs/personal-memory/spec.md | CLI、Dashboard、`profile.md` 和 `projects/<project-key>.md` 使用同一套记忆数据；用户直接编辑文件视为对应作用域的显式纠正，下一次相关任务立即生效，其他入口不得静默覆盖用户编辑。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A174 | passed | specs/personal-memory/spec.md | 通过 CLI、Dashboard 或用户可读记忆文件修改和移除内容时遵循相同语义：当前记忆立即更新，旧观察不会自动恢复已移除内容，历史保留到用户回滚或明确永久删除。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A175 | passed | specs/personal-memory/spec.md | 用户可以查询本轮实际加载、采用、忽略和因大小上限裁剪的记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A176 | passed | specs/personal-memory/spec.md | 自动学习、记忆检索和数据删除是独立控制；“关闭个人记忆”只暂停学习与检索并保留数据，删除必须单独确认。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A177 | passed | specs/personal-memory/spec.md | 自动学习和记忆检索同时提供全局与按项目控制；用户可以只暂停某个项目的学习或检索，不影响其他项目。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A178 | passed | specs/personal-memory/spec.md | 暂停不会删除已有数据，恢复后继续使用原有记忆，不要求重新学习。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A179 | passed | specs/personal-memory/spec.md | 关闭或删除个人记忆不得修改项目规则候选、Agent 指令、linter、测试、构建或 CI。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A180 | passed | specs/personal-memory/spec.md | 用户说“记住：只暂存本次改动文件”，该偏好立即生效，并记录明确来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A181 | passed | specs/personal-memory/spec.md | Comet 只在一个 change 中观察到小范围暂存时，只形成内部候选；第二个独立成功 change 再次出现一致行为后自动生效，第一次实际影响 Agent 做法时才简短提示。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A182 | passed | specs/personal-memory/spec.md | 同一个 Hotfix change 在两个聊天中恢复，或原地升级为 full，仍只算一次观察。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A183 | passed | specs/personal-memory/spec.md | “偏好中文回复”可以进入 `~/.comet/memory/profile.md`；“项目 A 使用 `pnpm build`”可以显示在 `~/.comet/memory/projects/<project-key>.md`，只在项目 A 的相关构建任务中加载。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A184 | passed | specs/personal-memory/spec.md | 当前用户要求与历史记忆冲突时，Agent 执行当前要求并提示被忽略的记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A185 | passed | specs/personal-memory/spec.md | 用户关闭自动学习后仍可显式要求记住；关闭检索后已有记录继续保留并可管理，但不进入 Agent 上下文。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A186 | passed | specs/personal-memory/spec.md | 用户只暂停项目 A 的自动学习后，项目 B 继续正常学习；项目 A 恢复后继续使用暂停前的数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A187 | passed | specs/personal-memory/spec.md | 用户直接修改个人画像 Markdown 中的偏好后，下一次相关任务使用纠正后的内容；详细历史和来源仍按需管理，不被批量写入画像文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A188 | passed | specs/personal-memory/spec.md | 用户把项目 A 对应的 `projects/<project-key>.md` 从“构建使用 `pnpm build`”改为“构建使用 `npm run build`”后，下一次项目 A 任务使用新命令，其他项目不受影响。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A189 | passed | specs/personal-memory/spec.md | 项目记忆文件不出现在项目 A 的普通 Git diff 中，也不要求团队提交；需要团队共享的内容进入项目规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A190 | passed | specs/personal-memory/spec.md | 一个没有形成任何可复用记忆的新项目不会出现空的项目记忆文件；用户手动创建对应 `projects/<project-key>.md` 并写入项目命令后，内容立即作为显式项目记忆生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A191 | passed | specs/personal-memory/spec.md | 用户在个人画像的“沟通偏好”列表中手动加入“使用中文回复”，该偏好立即生效；Comet 后续更新不会删除用户注释或无故重排文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A192 | passed | specs/personal-memory/spec.md | 用户从个人画像中移除“偏好中文回复”后，该偏好立即停止生效，过去的任务观察不会自动把它加回来；用户可以回滚恢复，也可以明确永久删除相关历史。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A193 | passed | specs/personal-memory/spec.md | 用户曾显式保存“偏好中文回复”，后续多个独立成功 change 持续表现出新的稳定偏好时，Comet 自动更新画像，不要求用户先确认。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A194 | passed | specs/personal-memory/spec.md | 项目从 `pnpm` 改为 `npm` 后，当前仓库文件与旧构建记忆冲突，Comet 不再采用旧命令并提示该记忆已经不符合项目现状。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A195 | passed | specs/personal-memory/spec.md | 用户在同一仓库的新 worktree 中继续工作时可以使用已有项目记忆；切换到该仓库的 fork 时默认不加载原项目记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A196 | passed | specs/personal-memory/spec.md | 用户在 Codex 中形成的个人偏好，在另一会话、另一宿主或另一台已连接设备上通过 Comet 工作时继续生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A197 | passed | specs/personal-memory/spec.md | 用户只安装个人记忆插件时可以正常学习、同步和检索记忆，不会因此启用项目规则能力。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A198 | passed | specs/personal-memory/spec.md | 用户在设备 A 形成并同步“偏好中文回复”后，在设备 B 的新会话中直接使用该偏好，不要求重新学习。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A199 | passed | specs/personal-memory/spec.md | 用户尚未配置记忆 remote 时，首次形成“偏好中文回复”后仍立即在本机后续任务中生效；Comet 只提示一次可以配置跨设备同步，用户稍后配置 remote 后同步已有记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A200 | passed | specs/personal-memory/spec.md | 两台设备同时写入不同记忆时两侧更新都被保留；同时修改同一记忆时不得由最后写入者静默覆盖另一侧，用户手动编辑仍保持最高优先级。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A201 | passed | specs/personal-memory/spec.md | 连续运行大量 change 并重复观察相同习惯后，个人画像和每轮注入量仍保持固定上限，详细记忆不产生重复项；当前偏好、必要来源和回滚能力仍然可用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A202 | passed | specs/personal-memory/spec.md | Codex 与 Claude Code 同时写入两条不同记忆时两条都被保留；同时写入同一条记忆时只形成一条；用户并发手动移除偏好时，旧的后台观察不会把它写回来。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A203 | passed | specs/personal-memory/spec.md | 没有宿主上下文容量信息时，Comet 仍按自身固定上限工作，不猜测剩余 token。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A204 | passed | specs/personal-memory/spec.md | 完成一个没有稳定偏好或可复用信息的任务时，不创建记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A205 | passed | specs/personal-memory/spec.md | 长期使用不会产生保存完整对话、工具调用、原始 diff 或完整命令输出的新 trajectory 文件，专用仓库中的项目记忆文件也不会变成 change 历史。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A206 | passed | specs/personal-memory/spec.md | 用户说“记住：以后提交后都推送”时，Comet 可以记住操作偏好，但后续任务没有授权推送时仍不得执行推送。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A207 | passed | specs/personal-memory/spec.md | 用户从 Dashboard 主侧边栏打开“个人记忆”后，可以在同一中心页查看全局画像、当前项目记忆、本轮实际使用和 Git 同步状态，不需要进入某个 workflow 或 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A208 | passed | specs/personal-memory/spec.md | 用户在个人记忆中心页把“偏好中文回复”改为“中英文均可”后，下一次相关任务使用新内容；专用记忆仓库中的同一内容同步更新，不产生 Dashboard 专属副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A209 | passed | specs/personal-memory/spec.md | 用户在中心页暂停项目 A 的自动学习后，项目 A 显示已暂停，项目 B 与全局记忆继续工作；重新启用后沿用原数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A210 | passed | specs/personal-memory/spec.md | 用户停用个人记忆插件时中心页保留并显示停用状态；卸载插件后侧边栏入口消失，但重新安装后仍可使用保留的记忆数据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A211 | passed | specs/project-rules/spec.md | > 状态：Shape 正在澄清。本文记录已经确认的产品行为；Runtime schema 和平台适配方式在 Design 中决定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A212 | passed | specs/project-rules/spec.md | 该插件在用户正常开发过程中发现项目规则，并帮助团队把它们沉淀到可选的 Markdown 规则文件、已经熟悉的 Agent 指令、compiler、formatter、linter、测试、构建或 CI 中。用户看到的能力统一称为“项目规则（Project Rules）”；内部用于发现、选择、投递和验证规则的执行机制称为 Project Rules Harness。插件负责学习、归纳和提出改动，不要求团队维护机器规则数据库。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A213 | passed | specs/project-rules/spec.md | 项目规则作为随 Comet 默认安装并启用的第一方插件接入，但可以独立停用或卸载，不是 Comet Core 中不可移除的内置行为。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A214 | passed | specs/project-rules/spec.md | 插件使用与第三方插件相同的公开 Comet 接口，不依赖第一方私有加载、事件或存储入口。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A215 | passed | specs/project-rules/spec.md | 插件可以独立安装、启用、停用和卸载，不要求同时安装个人记忆插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A216 | passed | specs/project-rules/spec.md | 停用或卸载后，插件停止自动发现、上下文选择和检查编排，但不得删除或停用仓库已有的规则文件、Agent 指令、linter、测试、构建或 CI 配置。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A217 | passed | specs/project-rules/spec.md | 插件缺失、停用或运行失败时，Comet 基础 workflow 继续工作；项目原生检查仍按项目自己的命令和 CI 正常执行。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A218 | passed | specs/project-rules/spec.md | 插件可以消费 Comet 提供的有来源生命周期事件，但不能读取个人记忆插件的内部数据，也不能把个人偏好自动提升为项目规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A219 | passed | specs/project-rules/spec.md | 项目规则属于 Comet 自身，与 `comet-any` 的节点、Skill Creator 和 Runtime 架构无关。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A220 | passed | specs/project-rules/spec.md | 项目规则属于仓库，不属于 Native、Classic、Hotfix、Tweak 或任何其他 Comet change；规则的读取、选择、执行和手动维护不要求存在 active change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A221 | passed | specs/project-rules/spec.md | 个人记忆、项目观察、Skill 和项目规则是不同对象；个人偏好不能自动成为团队规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A222 | passed | specs/project-rules/spec.md | 项目规则可以与个人记忆消费同一批带来源观察，但必须独立判断、独立存储和独立生效；项目规则内容不得写入个人记忆。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A223 | passed | specs/project-rules/spec.md | 普通 Comet Skill 任务、Native、Classic、Hotfix 和 Tweak 可以贡献项目证据，但这些 workflow 的 phase、state 和 Guard 不参与规则生命周期。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A224 | passed | specs/project-rules/spec.md | 项目规则属于明确仓库；个人记忆的系统用户身份和跨项目作用域不能改变团队共享内容。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A225 | passed | specs/project-rules/spec.md | 用户可以手动创建 `.comet/rules/*.md`。每个文件可以写多条自然语言规则，使用普通 Markdown，不要求 frontmatter、规则 ID、状态、严重级别或其他机器字段。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A226 | passed | specs/project-rules/spec.md | 规则文件按主题自由组织，例如 `.comet/rules/database.md`；不要求一条规则一个文件，也不要求项目创建规则文件后才能使用 Comet。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A227 | passed | specs/project-rules/spec.md | 每条规则可以在普通 Markdown 段落中写一行可选的 `适用范围：...`，例如 `适用范围：server/**`。它是给人阅读的范围说明，不要求固定位置或 YAML 结构；省略时由 Comet 根据文件主题、标题、任务和实际访问路径推断。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A228 | passed | specs/project-rules/spec.md | 项目规则继续保存在仓库已有的用户可读文件和原生检查配置中；Comet 不维护另一份需要团队同步的生效副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A229 | passed | specs/project-rules/spec.md | 需要 Agent 判断的指导优先进入已有 `AGENTS.md`、宿主指令文件或路径级指令文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A230 | passed | specs/project-rules/spec.md | 能够确定性检查的要求优先进入项目技术栈已有的 compiler、formatter、linter、静态分析、schema、测试、构建插件、构建生命周期或 CI 配置；包括但不限于 Maven Plugin、Gradle Plugin 和各语言生态的检查插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A231 | passed | specs/project-rules/spec.md | Comet 不按工具名或固定命令列表实现检查；它从项目 manifest、构建文件、脚本、文档和 CI 中发现当前项目实际采用的验证入口及其作用域。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A232 | passed | specs/project-rules/spec.md | 用户通过技术栈原生插件、脚本、测试、构建任务或 CI 扩展可确定检查的规则，不需要实现 Comet 专用插件接口。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A233 | passed | specs/project-rules/spec.md | 仓库没有合适载体时，Comet 提议创建技术栈原生检查配置、测试或主流 Agent 指令文件；只有用户选择规则文件时才创建或修改 `.comet/rules/*.md`。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A234 | passed | specs/project-rules/spec.md | Comet 把 `.comet/rules/*.md`、现有 Agent 指令和原生检查配置作为同一仓库中的不同规则来源，不要求迁移；同一条指导不复制到多个宿主文件，宿主适配不能制造相互漂移的副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A235 | passed | specs/project-rules/spec.md | 证据、候选、评估记录、索引和缓存属于 `.comet/runtime/` 机器数据，不要求团队阅读或维护。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A236 | passed | specs/project-rules/spec.md | 项目规则自动发现与非阻塞评估默认开启，用户可以关闭。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A237 | passed | specs/project-rules/spec.md | 已启用 Comet 的项目在首次使用时自动执行一次有边界的盘点，读取现有 Agent 指令、配置、目录结构、测试、构建和 CI；用户不需要先运行命令。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A238 | passed | specs/project-rules/spec.md | 用户也可以直接说“初始化项目规则”，或运行 `comet rules init`，显式初始化当前项目并执行同一份有边界盘点；重复执行保持幂等，不创建 Comet change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A239 | passed | specs/project-rules/spec.md | `comet rules init` 只建立当前项目的项目规则运行状态并记录盘点结果；它不自动创建 `.comet/rules/*.md`、改写 Agent 指令或检查配置、安装依赖，也不让自动候选直接生效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A240 | passed | specs/project-rules/spec.md | 用户可以直接说“重新扫描项目规则”，或运行 `comet rules scan`，按当前仓库重新盘点规则来源和验证入口；未初始化项目时先提示使用初始化入口，不隐式改变项目状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A241 | passed | specs/project-rules/spec.md | 用户可以直接说“查看项目规则状态”，或运行只读的 `comet rules status`，查看是否启用、上次盘点、已发现规则来源、验证入口和待处理候选的简短摘要。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A242 | passed | specs/project-rules/spec.md | 三个 CLI 命令与 Skill 中的自然语言操作调用同一领域能力；CLI 和 Dashboard 都不是正常使用项目规则的前置条件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A243 | passed | specs/project-rules/spec.md | 基线盘点和后续增量复盘会识别用户创建或修改的 `.comet/rules/*.md`，不要求通过专用命令登记。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A244 | passed | specs/project-rules/spec.md | 后续在任务成功结束以及可获得 Review、检查或 CI 结果时，按受影响范围增量复盘；用户也可以手动触发全量重扫。复盘不依赖某种 workflow 或 change 状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A245 | passed | specs/project-rules/spec.md | 同一任务的重复验证、跨会话恢复或重复 CI 结果只能更新同一来源，不能制造多份独立证据。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A246 | passed | specs/project-rules/spec.md | MVP 不常驻后台扫描，也不在每次工具调用、命令执行或文件写入后重复分析。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A247 | passed | specs/project-rules/spec.md | 自动发现只能在 Runtime 中创建或更新候选，不能直接修改仓库文件或启用新的阻塞检查。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A248 | passed | specs/project-rules/spec.md | 仅从代码模式推断项目规则时，第一次独立成功观察只保留内部候选；第二次来自另一任务或仓库修订的一致、无冲突观察后，才形成一份非阻塞建议。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A249 | passed | specs/project-rules/spec.md | 现有 Agent 指令、原生检查配置、已合并 Review 和用户显式添加不受重复观察限制；它们按各自已有来源直接识别或立即生成改动提案。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A250 | passed | specs/project-rules/spec.md | 用户可以在任何 Comet workflow 中直接说“把这条加入项目规则”或表达同等明确意图。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A251 | passed | specs/project-rules/spec.md | 显式添加不需要等待重复观察；Comet 应立即判断最合适的现有载体并生成一份可读的仓库改动提案。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A252 | passed | specs/project-rules/spec.md | 能用现有工具确定性检查的内容，提案修改对应的项目插件、linter、测试、构建任务或 CI；需要 Agent 判断的内容，提案修改最相关的 Agent 指令文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A253 | passed | specs/project-rules/spec.md | 用户明确指定目标文件或检查工具时，只要与仓库能力兼容，应优先遵循用户选择。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A254 | passed | specs/project-rules/spec.md | 用户也可以直接创建或编辑 `.comet/rules/*.md`、已有 Agent 指令、linter、测试、构建或 CI 文件；保存后立即成为当前工作区的项目现状，不要求通过专用命令登记。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A255 | passed | specs/project-rules/spec.md | 这些文件都是普通仓库改动；是否提交、Review 和合并由团队现有 Git 流程决定，规则系统不创建或要求 Comet change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A256 | passed | specs/project-rules/spec.md | 自动候选本身只保存在 Runtime；用户要求加入后，Comet 才修改最合适的规则源或原生检查配置，形成普通仓库 diff。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A257 | passed | specs/project-rules/spec.md | 稳定候选首先由当前 Comet Skill 在任务完成等稳定结束点发送一条简短、非阻塞通知；同一任务存在多个候选时合并为一条摘要，不连续逐条打断用户，也不要求用户打开 Dashboard 或运行 CLI。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A258 | passed | specs/project-rules/spec.md | 用户可以直接在 Skill 对话中说“全部加入、逐个查看、全部忽略、稍后处理”或表达同等意图；加入表示同意把选中的候选写入合适的规则源或原生检查配置，不创建独立 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A259 | passed | specs/project-rules/spec.md | “忽略”和“稍后”只出现在 Comet 于任务稳定结束点主动提出一条自动发现候选时：“忽略”处理这条尚未生效的候选，“稍后”保留候选供以后再次提示。它们不能停用已保存规则，也不能跳过 compiler、linter、测试、构建或 CI 失败。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A260 | passed | specs/project-rules/spec.md | 用户要修改、停用或删除已经生效的规则时，直接编辑对应 Markdown、Agent 指令或原生检查配置；这与处理自动候选是两条独立路径。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A261 | passed | specs/project-rules/spec.md | 用户忽略候选后，同一候选在证据和项目现状没有实质变化时不再提示；出现新的团队决定、规则来源、检查结果或不兼容代码模式后，可以重新评估并再次提出。普通重复观察不能解除忽略。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A262 | passed | specs/project-rules/spec.md | 未加入候选不得成为团队共享的阻塞要求，也不得静默改写 Agent 指令、CI、linter 或测试。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A263 | passed | specs/project-rules/spec.md | 工作区中的规则文件保存后立即供当前 Agent 使用；提交并合并后通过 Git 与团队共享。Comet 不再维护一个需要同步的生效副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A264 | passed | specs/project-rules/spec.md | `.comet/rules/*.md` 与其他仓库规则文件地位相同。规则文件中能够确定检查的要求可以继续迁移到原生检查配置，使执行不只依赖 Agent 判断。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A265 | passed | specs/project-rules/spec.md | 可确定检查的规则由原生检查工具报告和阻塞，沿用其现有严重级别、输出、例外和修复方式。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A266 | passed | specs/project-rules/spec.md | 原生验证入口成功时，其中的 warning 保持工具定义的非阻塞语义；只有工具、构建或 CI 判定失败时才要求 Agent 修复并重跑。团队需要更严格时，应在原生插件或检查配置中把对应 warning 升级为失败。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A267 | passed | specs/project-rules/spec.md | Comet 不维护覆盖项目工具的第二套严重级别，也不把所有 warning 擅自提升为阻塞错误。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A268 | passed | specs/project-rules/spec.md | Agent 在完成相关代码改动后、声明完成前运行项目自己的相关验证入口；检查失败且由当前改动引起时，Agent 读取原生诊断、在当前授权范围内修复并重新运行，直到通过或确认存在无法自行解决的阻塞。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A269 | passed | specs/project-rules/spec.md | 检查命令和调用方式由项目自身定义，例如 Maven 项目可能使用绑定插件的 `verify` 生命周期，其他技术栈可以使用完全不同的命令；Comet 不要求统一成专用命令。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A270 | passed | specs/project-rules/spec.md | 命令不可用、基础设施失败或失败与当前改动无关时，Agent 报告实际阻塞，不为了让检查变绿而修改无关代码或扩大当前任务范围。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A271 | passed | specs/project-rules/spec.md | 需要 Agent 判断的指导通过同一个上下文路由按需选择：任务开始按请求与项目粗选，目标路径明确后补充路径相关规则，验证前补充与检查、发布或高风险操作相关的规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A272 | passed | specs/project-rules/spec.md | 选择器先使用仓库、路径、技术栈和原生作用域做确定性过滤，再在候选内容中判断任务相关性；用户规则文件不需要因此增加机器字段。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A273 | passed | specs/project-rules/spec.md | 支持动态上下文的宿主由唯一 Comet Hook Router 及时投递；无 Hook 但支持宿主 Rule 的平台安装一条轻量项目级规则加载器，由 Agent 按任务和路径读取同一份 `.comet/rules`；Hook 和 Rule 都不可用时，Comet Skill 直接调用同一选择器。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A274 | passed | specs/project-rules/spec.md | 规则加载器只包含如何选择和读取相关规则的短指令，不复制整套项目规则；不同投递方式共享同一规则源、上下文上限和原生检查流程，用户无需打开 Dashboard 或运行 CLI。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A275 | passed | specs/project-rules/spec.md | 动态 Hook 只对已经启用 Comet 的项目生效。仅在系统中全局安装 Comet Skill、但当前项目没有 `.comet/config.yaml` 时，Router 必须安静跳过，不注入上下文、不阻止操作、也不创建文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A276 | passed | specs/project-rules/spec.md | 用户可以在尚未初始化 Comet 的仓库中手动创建 `.comet/rules/*.md`，并在显式使用 Comet Skill 后读取；项目未初始化意味着没有项目 Hook，因此不会自动影响普通 Agent 会话。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A277 | passed | specs/project-rules/spec.md | 同一会话不重复提供未变化的规则，选择结果使用固定保守上限；具体上限由 Design/Eval 用真实任务确定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A278 | passed | specs/project-rules/spec.md | 正常匹配、规则投递和检查通过默认保持安静；只有规则实际改变 Agent 的处理方式，或原生检查失败并触发修复时，才向用户简短说明相关规则和原因。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A279 | passed | specs/project-rules/spec.md | 回滚、修改和废弃通过普通仓库变更完成，历史由 Git 保留。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A280 | passed | specs/project-rules/spec.md | 自动发现按以下顺序解释项目证据，低层来源不能通过数量或模型评分覆盖高层来源： | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A281 | passed | specs/project-rules/spec.md | 当前明确团队决定和仓库已采用的 Agent 指令或检查配置； | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A282 | passed | specs/project-rules/spec.md | compiler、formatter、linter、schema、测试、构建与 CI 等实际执行结果； | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A283 | passed | specs/project-rules/spec.md | 已合并 Review 中可追溯的修正； | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A284 | passed | specs/project-rules/spec.md | 多个独立任务或仓库修订中稳定出现、且不与高层来源冲突的代码模式； | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A285 | passed | specs/project-rules/spec.md | 与项目技术栈和版本匹配的行业或框架基线。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A286 | passed | specs/project-rules/spec.md | 单次个人任务、失败轨迹、代码频率或模型自我评价不能单独证明团队意图。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A287 | passed | specs/project-rules/spec.md | 发生冲突时，Comet 不要求用户逐条处理，而是自动选择：实际生效的确定性检查结果高于自然语言指导；自然语言规则中，明确范围高于推断范围，更具体路径高于宽泛规则；仍然相同则使用仓库中更新较新的团队决定。选择依据只保存在 Runtime，不把内部优先级字段写进用户文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A288 | passed | specs/project-rules/spec.md | 项目证据只能来自当前任务已授权的仓库内容；不得把个人记忆或完整任务轨迹复制进仓库。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A289 | passed | specs/project-rules/spec.md | Comet 可以根据 manifest、lockfile 和框架配置识别技术栈与版本，并提出兼容的行业基线建议。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A290 | passed | specs/project-rules/spec.md | 建议必须展示上游来源、适用版本、检测依据和不确定性。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A291 | passed | specs/project-rules/spec.md | 基线可以进行非阻塞评估，但不得自动安装依赖、修改配置或启用阻塞检查。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A292 | passed | specs/project-rules/spec.md | 用户选择加入时，Comet 生成技术栈原生配置、测试或 Agent 指令的普通仓库改动，再按团队现有 Git 流程处理。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A293 | passed | specs/project-rules/spec.md | 用户正常开发即可获得自动发现，不需要先创建规则文件或学习 Comet schema。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A294 | passed | specs/project-rules/spec.md | 用户想主动补充规则时，可以直接用自然语言提出，可以手动创建普通 Markdown 规则文件，也可以编辑熟悉的仓库文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A295 | passed | specs/project-rules/spec.md | Comet Skill 是稳定候选的主要交互入口；用户无需离开当前对话即可查看、加入、忽略或稍后处理。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A296 | passed | specs/project-rules/spec.md | Comet Dashboard 主侧边栏提供独立的“项目规则”入口，打开当前项目的规则中心页；该页面不属于 Classic、Native 或某个 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A297 | passed | specs/project-rules/spec.md | 中心页展示项目规则是否初始化、上次盘点、已有规则来源、项目原生验证入口和待处理候选；默认只显示用户可理解的摘要，详细证据按需展开，不暴露内部 ID、评分或 Runtime 机器字段。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A298 | passed | specs/project-rules/spec.md | 用户可以在中心页初始化或重新扫描当前项目，查看规则来源和候选，并对候选执行加入、忽略或稍后；这些动作与 Skill 和 `comet rules` 使用同一领域能力，不创建 Comet change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A299 | passed | specs/project-rules/spec.md | 已生效规则仍以 `.comet/rules/*.md`、Agent 指令和原生检查配置为唯一仓库来源；中心页定位或修改对应来源，不保存 Dashboard 专属规则副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A300 | passed | specs/project-rules/spec.md | 已安装但停用的项目规则插件仍显示入口和停用状态，并允许重新启用；卸载后入口消失但仓库规则与原生检查保持原样。Dashboard 不可用时，自动发现、上下文选择、原生检查和 Skill/CLI 管理入口继续工作。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A301 | passed | specs/project-rules/spec.md | 项目规则与 change 无关：有无 active change、当前使用哪个 Comet workflow，都不改变规则文件的读取、选择和检查行为。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A302 | passed | specs/project-rules/spec.md | 候选详情和完整证据按需读取，不把待评审列表整体注入 Agent 上下文。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A303 | passed | specs/project-rules/spec.md | Dashboard 或 CLI 可以批量展示候选、证据来源和待评审改动，但只是可选管理入口，也不能成为另一套团队规则来源。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A304 | passed | specs/project-rules/spec.md | 普通运行不展示候选 ID、内部状态机、置信度计算或评估计数；只有提出建议、规则实际改变处理方式或检查失败时才显示必要信息。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A305 | passed | specs/project-rules/spec.md | 项目规则成功应用时不在任务结尾逐条列出规则；只有规则实际改变处理方式或检查失败时才提供必要说明。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A306 | passed | specs/project-rules/spec.md | 用户说“把『domains 层不得直接访问文件系统』加入项目规则”，仓库已有架构 linter 时，Comet 生成对该 linter 配置或测试的改动，而不是创建 `.comet/rules`。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A307 | passed | specs/project-rules/spec.md | 用户说“以后修改数据库迁移必须同步更新回滚说明”，该要求需要 Agent 判断时，Comet 生成对最相关 Agent 指令文件的改动。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A308 | passed | specs/project-rules/spec.md | 用户手动创建 `.comet/rules/database.md`，用普通标题和列表写入多条数据库规则；Comet 后续盘点直接识别，不要求 frontmatter、规则 ID 或登记命令。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A309 | passed | specs/project-rules/spec.md | 用户在某段规则下写 `适用范围：server/**/migration/**` 时，Comet 优先按该范围选择；未写范围的其他段落仍可根据标题、任务和实际路径自动匹配。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A310 | passed | specs/project-rules/spec.md | 用户直接修改 `AGENTS.md` 或 ESLint 配置后，Comet 后续盘点能够识别新的项目现状，不要求再次登记。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A311 | passed | specs/project-rules/spec.md | Comet 只在一个成功任务中观察到团队使用 `pnpm` 时，可以记录候选，但不能修改仓库或阻塞其他包管理器。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A312 | passed | specs/project-rules/spec.md | 同一模式在另一独立任务或仓库修订中再次出现后，Comet 仍只提出建议；用户明确要求加入后才生成普通仓库改动。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A313 | passed | specs/project-rules/spec.md | 用户只通过 Comet Skill 工作且同一任务形成多个稳定候选时，任务结束只出现一条摘要；用户可以一次全部加入、展开后选择部分候选、全部忽略或稍后处理，不会收到连续多条确认消息。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A314 | passed | specs/project-rules/spec.md | Comet 在任务结束点提示“发现项目多次使用统一的 DTO 命名方式，是否加入项目规则？”时，用户可以回复“忽略”处理这条尚未生效的候选；同一回复不能关闭已有命名规则或忽略 linter 失败。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A315 | passed | specs/project-rules/spec.md | 用户忽略 DTO 命名候选后，后续任务只重复同一种命名方式时不再收到提示；仓库新增明确的 DTO 规则或相关 linter 配置后，Comet 可以根据新的项目现状重新评估。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A316 | passed | specs/project-rules/spec.md | 用户在没有 active change 的普通 Comet Skill 任务中手动创建规则，和在 Native、Classic、Hotfix 或 Tweak 中创建规则的结果相同；保存后当前工作区立即可用。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A317 | passed | specs/project-rules/spec.md | 已有 ESLint、Semgrep、测试或 CI 能执行某项要求时，Comet 复用原生能力，不复制一份自然语言规则和自定义命令协议。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A318 | passed | specs/project-rules/spec.md | Maven 项目通过 Checkstyle、SpotBugs 或其他插件把规则接入构建生命周期后，Comet 发现项目实际验证命令；Agent 修改代码后运行该命令，按插件诊断修复并重跑，不要求 Maven 插件实现 Comet 接口。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A319 | passed | specs/project-rules/spec.md | Maven 插件输出 warning 但验证命令成功时，Comet 不强制扩大当前改动；团队在 Maven 配置中把该问题设为构建失败后，Agent 才必须修复并重跑。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A320 | passed | specs/project-rules/spec.md | “尽量做最小安全改动”无法确定性检查，应进入相关 Agent 指令，不生成依赖模型主观判断的 linter。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A321 | passed | specs/project-rules/spec.md | 行业基线与当前明确团队决定冲突时，Comet 自动使用团队决定并忽略该基线，不要求用户处理，也不自动修改配置。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A322 | passed | specs/project-rules/spec.md | `.comet/rules/database.md` 的项目级规则与 `server/AGENTS.md` 的数据库规则冲突时，修改 `server/**` 文件优先使用范围更具体的后者，不询问用户；如果两条规则范围相同，则使用仓库中更新较新的团队决定。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A323 | passed | specs/project-rules/spec.md | 没有 Hook 但支持宿主 Rule 的平台通过轻量规则加载器选择相关 Markdown 段落；Hook 和 Rule 都不可用时由 Comet Skill 完成同一动作。所有平台继续依靠仓库命令和 CI 执行可确定检查的规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A324 | passed | specs/project-rules/spec.md | 用户在无 Hook、但支持 Rule 的宿主中开启普通 Agent 会话时，Agent 从轻量加载器得知如何按任务和路径读取 `.comet/rules`，仓库不会出现项目规则的宿主副本。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A325 | passed | specs/project-rules/spec.md | 用户只在系统中全局安装了 Comet Skill，随后进入一个没有 `.comet/config.yaml` 的普通仓库时，Hook 不提供任何项目规则、不改变工具调用结果，也不在仓库中产生文件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A326 | passed | specs/project-rules/spec.md | 用户在未初始化项目中运行 `comet rules init` 后得到简短盘点摘要；仓库不会自动出现规则文件、检查配置改动或 Comet change，随后可以用 `comet rules status` 查看相同状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A327 | passed | specs/project-rules/spec.md | Agent 按相关项目规则完成任务且检查通过时，用户不会收到规则清单；如果数据库规则阻止修改已发布 migration，或原生检查失败后触发修复，Comet 才简短说明实际产生影响的规则。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A328 | passed | specs/project-rules/spec.md | 用户只安装项目规则插件时仍可发现、读取和执行仓库规则，不要求安装个人记忆插件。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A329 | passed | specs/project-rules/spec.md | 用户停用或卸载项目规则插件后，自动发现、候选提示和上下文选择停止，但 `.comet/rules/*.md`、Agent 指令、linter、测试、构建和 CI 配置保持原样。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A330 | passed | specs/project-rules/spec.md | 用户从 Dashboard 主侧边栏打开“项目规则”后，可以在同一中心页看到当前项目的初始化状态、规则来源、Maven/Gradle/linter 等实际验证入口和待处理候选，不需要进入某个 workflow 或 change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A331 | passed | specs/project-rules/spec.md | 尚未初始化的项目规则中心页显示初始化操作；用户执行后得到盘点摘要，但不会自动创建规则文件、修改检查配置、安装依赖或创建 Comet change。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A332 | passed | specs/project-rules/spec.md | 用户在中心页对 DTO 命名候选选择“加入”后，Comet 修改最合适的仓库规则来源或原生检查配置；选择“忽略”或“稍后”与 Skill 中的语义一致，不产生 Dashboard 专属状态。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |
| A333 | passed | specs/project-rules/spec.md | 用户停用项目规则插件时中心页保留并显示停用状态，个人记忆页继续工作；卸载后入口消失，但仓库已有规则和原生检查仍然有效。 | 对应 child 的独立验收证据与当前父级集成检查一致，未发现当前 beta20 HEAD 的回归。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| Supervisor integration and language tests | run test/domains/comet-plugin/plugin-runtime.test.ts test/domains/comet-plugin/plugin-integration.test.ts test/domains/comet-memory/personal-memory.test.ts test/domains/project-rules/project-rules.test.ts test/domains/project-rules/plugin.test.ts test/app/personal-memory-command.test.ts test/app/project-rules-command.test.ts test/domains/dashboard/default-plugin-host.test.ts test/domains/dashboard/plugin-host.test.ts test/domains/dashboard/plugin-server.test.ts test/domains/dashboard/server.test.ts test/domains/dashboard/web-state.test.ts test/domains/dashboard/dashboard-index-store.test.ts test/domains/dashboard/index-reconciler.test.ts test/domains/comet-entry/comet-entry-skill.test.ts test/domains/comet-native/native-artifact-language.test.ts test/domains/comet-native/native-skill.test.ts test/repository/comet-entry-runtime-assets.test.ts | . | passed | 0 | 23019 ms |
| TypeScript typecheck | --noEmit | . | passed | 0 | 6587 ms |
| Generated runtime assets | scripts/build/build-classic-runtime.mjs --check | . | passed | 0 | 317 ms |
| Generated Native runtime assets | scripts/build/build-native-runtime.mjs --check | . | passed | 0 | 620 ms |
| Generated Entry runtime assets | scripts/build/build-entry-runtime.mjs --check | . | passed | 0 | 199 ms |
| Affected source lint | app/ domains/ platform/ | . | passed | 0 | 7656 ms |
| Architecture layout check on clean HEAD snapshot | -e process.chdir('D:/Temp/comet-supervisor-architecture-check-20260815-v2'); await import('file:///D:/Project/Comet/scripts/lint/architecture.mjs'); | . | passed | 0 | 1405 ms |
| Dashboard production build | build --config domains/dashboard/web/vite.config.mjs | . | passed | 0 | 17948 ms |

## Blockers

_None._

## Risks and skipped work

- 根目录 .review-worktrees 和 .ruff_cache 是预存工作区目录；架构结论基于干净 HEAD 快照，未将它们误判为产品文件。
- Dashboard 构建保留既有大 chunk warning，但构建成功且不影响本次验收。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-13T16:35:14.402Z |
| 2 | 1 | 0 | recovery | — | Native confirmed acceptance criteria changed | 2026-08-14T02:45:34.672Z |
| 3 | 1 | 1 | fail | A1, A2, A3, A4, A5, A6, A9, A10, A11, A15, A16, A17, A18, A22, A24, A25, A26, A30, A31, A32, A33, A34, A35, A36, A37, A38, A39, A41, A43, A46, A49, A50, A51, A62, A67, A68, A69, A71, A73, A76, A81, A82, A95, A101, A102, A107, A108, A109, A110, A126, A127, A128, A131, A133, A134, A135, A137, A138, A140, A142, A143, A144, A145, A146, A147, A148, A149, A151, A153, A154, A155, A156, A160, A161, A164, A166, A168, A169, A170, A171, A172, A175, A177, A178, A180, A181, A183, A184, A185, A186, A188, A193, A194, A195, A196, A197, A198, A199, A200, A206, A207, A208, A209, A210, A213, A215, A218, A222, A223, A224, A233, A236, A237, A242, A243, A244, A250, A251, A252, A256, A257, A258, A259, A264, A266, A268, A270, A271, A273, A274, A275, A276, A277, A278, A280, A281, A282, A283, A284, A285, A286, A287, A289, A290, A291, A292, A293, A294, A295, A300, A305, A306, A307, A311, A312, A313, A314, A316, A317, A318, A319, A320, A321, A322, A323, A324, A327, A328, A329 | 四个 child 已合入且各自局部测试通过，但父级 beta20 HEAD 仍缺正常 Comet workflow 的事件/上下文宿主、个人记忆 Git/稳定项目 identity/暂停与 CLI、项目规则 carrier/候选/Hook/Skill/验证闭环及公开 Dashboard contribution；因此整合验收失败。 | 2026-08-14T12:19:45.644Z |
| 3 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-14T12:59:16.819Z |
| 4 | 1 | 1 | pass | — | 五个 child 已全部归档并合入 beta20。父级最终接线的 targeted tests、TypeScript、生成物、源码 ESLint 和受影响文件格式检查通过；全量测试超时及 .ruff_cache 架构白名单风险已明确记录，未发现新的产品验收失败。 | 2026-08-14T16:00:38.546Z |
| 4 | 1 | 1 | recovery | — | 修复 Native 产物语言未跟随项目配置的问题，返回 Build 重新验证 | 2026-08-15T06:51:52.469Z |
| 4 | 2 | 1 | pass | — | Native 核心产物语言继承候选通过：配置默认语言与显式覆盖、中文/英文 brief 解析、verification/evidence 双语渲染、机器字段稳定性、生成 Runtime 资产同步均已核验；历史 language=en Supervisor 的状态和英文标题保持不变。 | 2026-08-15T07:04:35.998Z |
| 4 | 2 | 1 | recovery | — | 补充确认：Native Skill 的用户可读产物必须统一跟随项目 native.language 配置，不能由 Skill 安装语言决定；返回 Build 更新 Skill 规则、模板和回归测试。 | 2026-08-15T07:08:10.288Z |
| 4 | 3 | 1 | fail | A30 | 语言初始化、配置继承、显式覆盖、双语解析/渲染、机器字段、tsc、生成资产和 Prettier 均通过；但 Native Skill 常驻上下文 413 行超过 400 行硬上限，相关必跑测试失败，因此 iteration 3 验收失败并返回 Build。 | 2026-08-15T07:29:12.468Z |
| 4 | 4 | 0 | recovery | — | Native child declarations changed | 2026-08-15T07:32:17.569Z |
| 5 | 1 | 1 | fail | A273 | 333 项逐项核验：332 项通过，A273 未通过。所有 child 已归档，Plugin Runtime、个人记忆、项目规则、Dashboard 与宿主接线的现有实现和归档证据一致；本轮目标测试 17/18 通过、tsc 与 ESLint 通过。唯一真实缺口是发布的 comet-hook-router.mjs 过期。Windows pnpm 绝对路径失败属于检查执行计划问题，不能作为产品失败。 | 2026-08-15T10:22:06.472Z |
| 5 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-15T10:24:19.576Z |
| 6 | 1 | 1 | fail | A40 | Parent Verify found one concrete integration issue: the dashboard SQLite change committed a large user-visible dashboard-installed-snapshot.json at repository root, and the architecture check rejects it. The SQLite index must remain private under the platform cache; the tracked snapshot should be removed. | 2026-08-15T10:45:15.083Z |
| 6 | 2 | 0 | recovery | — | Native child declarations changed | 2026-08-15T10:45:43.198Z |
| 7 | 1 | 1 | recovery | — | 上轮 Verify 的架构检查执行命令本身在 Windows 解析失败，返回 Build 重新派发同一父级候选，产品代码不变。 | 2026-08-15T10:54:21.351Z |
| 7 | 2 | 1 | pass | — | 独立只读终审通过：A1-A333 全部通过；当前候选已删除仓库根目录 dashboard-installed-snapshot.json 并加入 Git 忽略，SQLite 索引仍位于用户缓存。父级 18 项 Runtime 检查全部通过，独立重跑的 19 个相关测试文件共 134 个测试和 clean HEAD 架构检查全部通过。 | 2026-08-15T11:04:12.761Z |

## Conclusion

独立只读终审通过：A1-A333 全部通过；当前候选已删除仓库根目录 dashboard-installed-snapshot.json 并加入 Git 忽略，SQLite 索引仍位于用户缓存。父级 18 项 Runtime 检查全部通过，独立重跑的 19 个相关测试文件共 134 个测试和 clean HEAD 架构检查全部通过。
