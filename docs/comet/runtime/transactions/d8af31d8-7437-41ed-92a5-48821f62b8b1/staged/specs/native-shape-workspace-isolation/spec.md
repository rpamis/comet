# Native Shape 工作区隔离

## Purpose

让 Native change 在捕获 baseline 之前建立可选择的工作区边界，使多个 change 可以从 Shape 开始跨会话并行，同时保留 Native 对确认前项目写入、实现范围和证据完整性的强校验。

## Requirements

### 隔离决定时点

- 创建新 Native change 前，Skill MUST 在执行 `comet native new` 之前解析工作区模式。
- Native MUST 提供 `current`、`branch`、`worktree` 三种启动选项，并在创建 change 前完成一次性选择。
- Skill MUST NOT 依赖用户主动说出“并行”才检查隔离需求；创建新 change 前 MUST 使用仓库和 Git 的只读事实判断是否存在其他活动工作或共享工作目录写入风险。
- Skill MUST 根据磁盘事实为三种选项提供一个推荐：存在其他 active change、已隔离 change 或共享工作目录写入风险时推荐 worktree；仓库干净且没有其他 active change 时推荐 current；仅需要独立提交历史时可推荐 branch。
- 首个 Native change 在仓库干净且没有其他 active change 时 MUST 默认 current 并直接进入 Shape，不为固定三选一中断流程。
- 已有其他 active change、当前工作目录有未提交工作、用户明确要求独立分支/工作区，或其他事实证明隔离方式会影响安全性时，Skill MUST 展示一次 current、branch、worktree 选项及推荐；Skill MUST NOT 另外询问用户“是否并行”。
- Native MUST 始终呈现 current、branch、worktree 三种产品模式，但 MUST 根据当前工作目录的归属控制可用性：没有其他 active Native change 绑定当前工作目录时三种模式均可用；其他 active changes 已绑定独立 worktrees 时 MUST NOT 因其存在而禁用 current 或 branch；当前工作目录已绑定另一个 active change 时，current 与 branch MUST 显示为不可选并说明 baseline 漂移风险，新 change MUST 使用 worktree。
- worktree MUST 是多个 changes 跨会话并行时的推荐模式。

### 创建时原子重检

- `comet native new` MUST 在创建 change 与捕获 baseline 所使用的同一 Runtime 变更锁内重新检查当前工作目录的隔离前提，不能只信任 Skill 在加锁前完成的只读判断。
- 两个会话同时判断“没有其他 active change”时，后取得锁的会话若发现 current 已不可用，Runtime MUST NOT 在共享工作目录创建 change 或捕获 baseline。
- current 是系统根据初始事实自动选择的默认值时，Skill MUST 把上述拒绝作为 worktree-required 结果，在独立 worktree 中重新执行创建，不要求用户再次确认。
- 用户显式选择的 current、branch 或 worktree 在落盘前失效时，Skill MUST 停止并重新展示最新事实，不得静默替换用户选择。

### Shape 前 worktree

- worktree 模式 MUST 在目标 worktree 中运行 `comet native new`，使 baseline、workspace identity、change 状态和当前 change 记录从创建时就归属于目标项目视图。
- Skill MUST NOT 先在源工作目录创建 change，再复制或移动 Runtime 管理的 change 目录到 worktree。
- worktree MUST 基于明确的 Git 提交创建。源工作目录中与目标 change 相关的未提交内容无法进入该提交时，Skill MUST 停止并让用户决定如何保留；不得静默遗漏、提交或复制。
- 创建前 MUST 检查目标路径、目标分支和已注册 worktree 冲突。创建失败时 MUST 保留原始错误，不得静默回退到 current。
- branch 与 worktree 模式的默认 change 分支名 MUST 是 `comet/<change-name>`；worktree 默认路径 MUST 是仓库内的 `.worktrees/<change-name>`。
- Skill MUST 在同一次工作区选择中披露默认分支和路径并允许用户覆盖，不得为命名或路径另建一个例行确认点。
- 使用默认 `.worktrees/` 前，Skill MUST 证明该目录不会作为项目改动出现在 Git 状态或 Native baseline 中；仓库未忽略时 MUST 只使用仓库本地 Git exclude 建立本地忽略，不得修改项目跟踪的 `.gitignore`。
- 目标分支或路径已经合法绑定同一 change 时，Skill MAY 恢复使用；被其他分支、worktree、普通目录或无法归属的内容占用时 MUST 停止并要求改名，不得静默添加后缀、覆盖或接管。

### 项目本地配置与当前 change

- 目标 worktree MUST 获得与源项目一致且合法的 Native 项目配置，至少保留 artifact root、language、clarification、archive、verify 与 snapshot 语义。
- Skill MUST NOT 把源工作目录的 `.comet/current-change.json` 复制到目标；目标的当前 change MUST 由目标 worktree 中的 `comet native new` 或 `comet native select` 建立。
- 配置初始化、baseline 或 change 创建失败时，Skill MUST 报告目标路径、已创建资源和可恢复动作，并 MUST NOT 自动删除用户已有或无法证明由本次创建的 worktree。

### 自动续作

- worktree 创建成功后，当前会话的所有 Native CLI 调用、正式 Shape 产物编辑和后续项目修改 MUST 使用目标 worktree 作为实际项目根。
- Skill MUST NOT 把“请用户手动进入 worktree”作为成功结果；它 MUST 直接在目标工作区继续并向用户披露实际路径。
- 新会话在当前工作目录找不到用户点名的 active change 时，Skill MAY 读取 `git worktree list --porcelain` 定位已注册 worktree，并对候选执行只读 Native discovery。
- 跨 worktree 恢复只有在 change 名称和工作区唯一对应时 MAY 自动继续；重名、损坏、不可读或多个合理候选 MUST fail closed 并要求用户选择。

### 主动隔离判断

- 新 change 启动前，Skill MUST 至少检查当前工作目录的 active Native changes、当前 change、Git 工作区状态和已注册 worktrees，而不是只分析用户措辞。
- 检测结果 MUST 区分属于目标 change 的已有工作、其他 change 的工作以及无法归属的改动；不得仅凭“工作区非空”删除、移动或接管用户文件。
- 当前工作目录已绑定其他 active change，或其他事实证明该工作目录可能被另一个 change 写入时，Skill MUST 在新 change 创建前使用 worktree；仅存在已经绑定独立 worktree 的其他 active changes MUST NOT 使当前工作目录的 current 或 branch 自动失效。
- 当前工作目录的未提交内容可证明与新 change 无关时，Skill MUST 保留原内容并从明确提交基线创建 worktree；未提交内容可能属于新 change且无法安全带入时，Skill MUST 让用户决定如何保留。
- 当前仓库干净且没有其他 active change 时，Skill MAY 使用 current，不得为形式一致性强制创建 worktree。

### 用户交互边界

- 用户在每个会话中 MUST 能按普通 Comet 入口启动或恢复工作，而无需声明“并行”或理解 baseline。
- 需要用户选择隔离方式时 MUST 将 current、branch、worktree 合并为一个工作区决策点，并标出推荐项与实际影响；不得先问是否并行，再产生第二个隔离问题。
- 用户选择 worktree 后，创建和进入 MUST 由 Agent 执行；成功后只需披露目标路径和分支，不得再要求用户手动进入。
- 只有请求可能匹配已有 change 或新 change、多个 active change 都可能匹配，或相关未提交内容无法安全归属/迁移时，Skill MUST 请求用户决定。
- 恢复已有 change 时 MUST 使用已持久化的隔离方式，不得重复询问启动选项。

### 三种模式的语义

- `current` MUST 保持当前 Git 工作目录，不创建分支或 worktree；它只适用于当前工作目录没有绑定其他 active Native change 的会话。
- `branch` MUST 在当前工作目录切换到用户确认的分支后创建 change；它 MAY 隔离提交历史，但 MUST NOT 声称隔离工作目录或支持同一工作目录的并行项目写入，并且只在当前工作目录没有绑定其他 active Native change 时可用。
- `worktree` MUST 为 change 提供独立工作目录和分支，并 MUST 是 Native 内建引导中支持多会话并行的模式。

### Native 证据兼容性

- 本能力 MUST NOT 延后、重写、忽略或放宽 change 创建时的 baseline 捕获。
- 本能力 MUST NOT改变 Build scope sealing、Verify evidence、Archive conflict inspection、Hook Router 当前 change 路由或 Guard fail-closed 行为。
- 其他 worktree 或 change 的项目修改 MUST NOT 出现在当前 worktree 的 Git 工作目录中，因此 MUST NOT 单独造成当前 change 的 baseline 漂移。
- Native 主流程 MUST NOT 因工作区隔离而依赖 Superpowers、OpenSpec 或其他外部 Skill。

### 分支与目标绑定

- branch 或 worktree 模式创建 change 时，Native MUST 持久化 isolation、实际 change branch 和最终 target branch，使新会话无需聊天记录即可恢复。
- target branch MUST 是经过验证的本地分支名，且 MUST NOT 从 change branch 的命名格式反向猜测。
- worktree 的 target branch MUST 默认绑定创建 worktree 时所在的起始分支，而不是无条件绑定仓库默认分支；只有用户明确选择其他目标时才可改用其他分支。
- current 模式 MUST 如实记录当前分支；detached HEAD 无法建立可审计绑定时 MUST 停止。
- 当前分支与持久化 change branch 不一致时，Build、Verify、Archive 和分支收尾 MUST fail closed，除非用户明确授权重新绑定。

### Archive 后收尾

- branch/worktree change MUST 在 Runtime Archive 前提供一个联合归档与收尾决定：归档并合并回 target branch、归档并推送 change branch、归档推送并创建 PR、归档但保留 branch/worktree，或暂不归档并返回调整/重新验证。
- current change MUST 继续遵循现有 `native.archive_confirmation`，且 MUST NOT 展示不适用的分支合并或 worktree 清理选项。
- 用户完成联合选择后，Skill MUST 只执行该选择授权的动作，不得在 Archive 后增加提交、合并、推送、PR或清理的第二轮例行确认。
- branch/worktree 的联合选择 MUST 在生成最终 Archive preflight 前由 Runtime 写入正式 workspace 元数据，并 MUST 参与本次 preflight；归档或外部 Git 收尾中断后，新会话 MUST 能恢复同一决定而不依赖聊天记忆。
- 用户选择合并选项时，该一次选择 MUST 授权完整本地闭环：先形成只包含当前 change 可归因路径的完整提交，再确认 target branch 工作区干净且没有未解决操作，执行非破坏性合并并运行与风险匹配的验证，最后移除已干净且确认属于当前 change 的 worktree 与已合并本地 change branch。
- 完整本地闭环 MUST NOT 授权推送 target branch 或创建 PR；远端操作仍需用户选择对应交付方式。
- 推送/PR选项 MUST 只操作当前 change branch，并 MUST 使用持久化 target branch 作为 PR base。未经用户明确选择不得评论、推送或创建 PR。
- worktree change 推送成功或成功创建 PR 后，Skill MUST 移除干净 worktree并保留本地与远端 change branch；后续修改从该分支重建 worktree。Skill MUST NOT 自动监控 PR 或等待合并后再清理。
- 保留选项 MUST 不合并、不删除分支或 worktree，并 MUST 让后续会话能从正式元数据恢复相同收尾决定。
- 任一提交、合并、验证、推送、PR或清理失败 MUST 保留当前分支和 worktree现场，不得自动变基、强制推送、删除或切换到其他 change。
- 多个 worktree changes MAY 独立完成 Archive 和收尾准备；只有合并到同一 target branch 的 Git ref 更新 MUST 逐个执行。一个 change 的失败 MUST NOT 改变其他 active change 的分支、当前 change 记录或工作区。

### Change 独立性

- Native 的并行单位 MUST 是 change；每个 branch/worktree change MUST 拥有一个独立工作区、change branch、当前 change 归属、baseline 和 Runtime 生命周期。
- 多个 changes MUST 能独立并行推进 Shape、Build、Verify 和 Archive；一个 change 的 phase 或完成状态 MUST NOT迫使另一个独立 change 暂停或重走 phase。
- 单个 change MUST 绑定一个执行工作区，并 MUST NOT 由多个会话或多个 worktrees 并发推进；恢复会话 MUST 回到该 change 已绑定的工作区。
- 多个已完成 changes 指向同一 target branch 时，只有修改同一 Git target ref 的本地合并动作 MUST 逐个执行；该 Git 边界 MUST NOT 被描述成 Native changes 的 Archive 串行限制。
- target branch 因另一个独立 change 成功合并而推进，MUST NOT 单独使已完成 change 回到 Build/Verify；后续合并 MUST 对组合结果运行风险匹配的合并后验证。
- Native MUST NOT 新增长期跨会话 session lease。单一绑定工作区/分支、当前 change 记录、Guard、revision 与 Runtime 命令级锁负责可验证边界；Skill MUST 声明同一 change 不支持多个聊天会话并发编码。

### 集成冲突

- 已完成 change 合并到 target branch 时，Agent MAY 解决不改变任何已确认用户可见行为、且能同时保持双方完整契约的机械冲突，并 MUST 对合并结果运行风险匹配的验证。
- 冲突解决需要改变任一 change 的用户可见行为、规格或验收结果，或者双方契约无法同时满足时，Agent MUST 中止本次合并并保留 change branch 与 worktree。
- 语义冲突 MUST 由用户决定是否创建新的集成 change；Agent MUST NOT 在 Git 冲突解决过程中静默改写已归档契约。

### 旧 change 兼容处理

- 升级前已经在同一工作目录共享存在的旧 active changes MUST 保持原目录布局；升级或只读发现 MUST NOT 自动为它们创建 worktree、移动项目文件或 Comet 管理目录、刷新 baseline，或改变用户分支。
- 这些旧 active changes MUST 继续保留，并 MUST 允许用户一次切换和推进一个当前 change；新隔离规则 MUST 只约束升级后创建的 changes。
- 旧 change 若因其他 change 的项目写入实际触发 baseline 或 scope 漂移，Runtime MUST 按现有证据规则 fail closed，并仅处理该 change；Skill MUST 在该问题实际发生时让用户决定重新创建或放弃，不得为了继续而重写 baseline。
- 旧 active change 已位于独立 Git worktree，但无法从正式事实证明原 target branch 时，Skill MUST 保留现场并只询问一次 target branch，然后持久化；不得从目录名或分支名猜测。
- workspace 或 branch 归属无法证明时 MUST fail closed 并请求用户决定。

### Classic 兼容性

- Classic 的 current/branch/worktree 决策时点、状态字段、branch binding 与执行流程 MUST 保持不变。
- 文档 MUST 明确：Classic 可以在进入 Build 前共享工作目录澄清，而 Native 因创建时绑定 baseline，需要在并行 change 的 Shape 前建立独立 worktree。
