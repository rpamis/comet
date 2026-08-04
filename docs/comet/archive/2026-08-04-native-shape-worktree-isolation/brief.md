# Outcome

Comet Native 在创建 change、捕获 baseline 之前主动判断工作区隔离需求。用户不需要预先说明“并行”；Agent 根据仓库中的 active change、当前 change、已注册 worktree 和未归属改动识别并行风险，并在需要时为新 change 自动建立和进入独立 Git worktree，使 Shape 从第一步起就在隔离项目视图中运行。其他 change 的 Build 写入不会让当前 change 的 baseline 哈希漂移。

# Scope

- 在 Native Skill 的新 change 启动路径中保留 `current`、`branch`、`worktree` 三种工作区选项，并把一次性的选择与实际隔离都放在 `comet native new` 之前；推荐项由仓库事实决定，不要求用户先说“并行”。
- 启动新 change 时先只读检查当前工作目录、其他 active Native change、已注册 worktree 和当前 change，不以用户主动说出“并行”为前提。
- 检测到多 change 或并行写入风险时推荐 `worktree`；当前仓库干净且没有其他 active change 时默认 `current`，只需要独立提交历史时可选择 `branch`。需要展示选项时，推荐不得替代用户的一次性确认。
- worktree 模式下，后续 status、show、select、Shape 产物编辑和阶段推进都在目标 worktree 中完成，不要求用户手动执行 `cd`。
- 新会话在当前工作目录找不到明确目标时，可以通过已注册 Git worktree 定位用户点名的 Native change，并在实际 worktree 中恢复。
- worktree 创建时持久化 change 分支与最终目标分支；Archive 后根据用户确认执行合并回目标分支、推送/PR 或暂时保留，并在安全条件满足时清理 worktree。
- 升级前已经共享一个工作目录的旧 active changes 保持原状，不因升级自动生成 worktree、移动文件或改写 baseline；新隔离规则只约束升级后创建的 changes。
- 为中英文 Native Skill 增加一致的隔离协议和契约测试。

# Non-goals

- 不延后、放宽或绕过 Native change 创建时的 baseline、scope hash、Guard 或证据约束。
- 不承诺多个 Agent 在同一个工作目录中并发修改项目实现；`current` 和 `branch` 都不作为多会话并行隔离。
- 不改变 Classic 的隔离、状态机或多 change 行为。
- 不为升级前已经共享工作目录的旧 active changes 自动重排目录或补建 worktree。
- 不引入外部 Skill 依赖，也不要求新增 Native CLI 子命令。
- 不在用户确认收尾方式之前自动提交、合并、推送、创建 PR、删除分支或删除 worktree。

# Acceptance examples

- 已有会话正在 change A 的 Build 中写入项目文件；用户在另一会话只说“启动 change B”，没有提到并行。Native 从 active change、当前 change 或已注册 worktree 发现并行风险，在 B 的 `new` 之前创建独立 worktree。B 的 baseline 只绑定该 worktree 的项目视图；A 后续新增文件不会让 B 因哈希漂移无法离开 Shape。
- 当前工作区有未提交改动，用户选择 worktree。Agent 不移动或清理原改动，在新 worktree 中创建并选择 change，并直接从该目录继续 Shape。
- 用户在干净且没有其他 active change 的仓库启动第一个 Native change。Native 自动沿用 current，不额外询问隔离方式。
- 用户明确要求使用新分支但没有并行工作区需求。Native 在当前工作目录创建并切换到确认的分支后再创建 change，但不把 branch 描述为独立工作区。
- worktree 路径、分支、配置初始化或 change 创建失败时，Native 报告原始错误与已创建资源，不静默回退到 current，也不删除用户已有 worktree。
- 用户选择 worktree 后未指定名称或路径。Native 使用 `comet/<change-name>` 和 `.worktrees/<change-name>`，确保默认目录不会出现在 Git 状态中，并直接继续；若同名目标属于其他内容则停止要求改名，不静默添加后缀。
- 新会话从主工作目录点名恢复 worktree 中的 change 时，Agent通过 Git 注册信息定位唯一目标并在该 worktree 继续；存在重名、损坏或多个候选时停止并让用户选择。
- worktree change 完成 Archive 后，用户选择“合并回目标分支”。Agent 先确认 change 分支已形成可归因且完整的提交，再在干净的目标分支工作区执行合并；成功后验证合并结果并移除已无未提交内容的 worktree，其他 active change 的 worktree 保持不变。
- 用户选择推送并创建 PR时，只推送当前 change 分支并以持久化的目标分支作为 PR base；用户选择暂时保留时，不合并、不删除工作区，后续会话可恢复收尾。
- 多个 worktree change 完成后分别按自身目标分支逐个收尾；一个 change 的冲突或失败不得删除、重写或错误合并其他 change。
- 升级时发现当前工作目录已经包含多个旧 active changes。Native 不创建任何 worktree、不移动项目或 Comet 文件；这些 changes 仍由用户一次切换一个“当前 change”继续，只有某个旧 change 真实触发 baseline 或 scope 漂移时才停止并让用户处理该 change。

# Constraints and invariants

- 必须先建立实际隔离，再运行 `comet native new`；不得先在共享工作目录捕获 baseline 后再搬迁 change。
- 目标 worktree 继承项目 Native 配置，但不得复制源工作目录的 `.comet/current-change.json`；目标的当前 change 由目标中的 `new` / `select` 建立。
- worktree 必须来自当前仓库的明确提交基线，目标路径和分支必须在创建前检查冲突；相关未提交改动不能被静默遗漏或复制。
- worktree 模式必须把 change 分支和目标分支写入可跨会话恢复的正式元数据；不得只依赖聊天记录或从分支名猜测目标。
- worktree 创建成功后，Agent 必须把实际路径作为后续命令的项目根，而不是只输出一条让用户自行进入的提示。
- Native 仍只使用公开 `comet native <cmd>` CLI 管理 Native 状态；Git worktree 操作不得直接编辑 Runtime 管理文件。
- 保留 dirty worktree 中与当前 change 无关的用户改动。

# Decisions

- 并行能力通过“每个 change 从 Shape 前开始拥有独立 worktree”实现，不通过削弱 baseline 完整性实现。
- 不把用户说出“并行”作为隔离前提；并行风险由 Skill 从磁盘和 Git 事实主动判断。
- 用户体验保持为“每个会话正常启动 Comet”；自动 worktree 是 Native 的内部工作区决策，不作为常规启动问题。
- 保留 `current`、`branch`、`worktree` 三种显式选项；需要用户决定时，Native 在创建 change 前一次性展示并给出基于仓库事实的推荐，但不再单独询问“是否并行”。
- 首个 Native change 在仓库干净且没有其他 active change 时默认使用 `current` 并直接进入 Shape；只有已有其他 active change、当前工作目录有未提交工作、用户明确要求独立分支/工作区，或其他事实表明隔离方式影响安全性时，才展示一次三种选项。恢复已有 change 时使用已持久化选择，不重复询问。
- 产品继续展示 current、branch、worktree 三种模式，但可用性取决于当前工作目录的真实归属：没有其他 active Native change 绑定当前工作目录时三种模式均可用；其他 change 已在独立 worktree 中运行时不影响当前选择；一旦当前工作目录已绑定另一个 active change，current 与 branch 必须显示为不可选并说明 baseline 漂移风险，新 change 必须使用 worktree。
- 隔离选择属于新 change 的启动契约，早于 Shape 产物和 baseline 创建；这与 Classic 在 Build 选择隔离的时点不同。
- `worktree` 是多会话并行的唯一安全模式；`branch` 只提供版本线隔离，仍共享当前工作目录。
- Agent 负责创建、定位并在实际 worktree 续作，用户不负责手动切换目录。
- 除启动时一次性工作区选择外，只有 change 目标归属存在歧义、多个 active change 都可能匹配、相关未提交内容无法安全归属/带入新工作区，或收尾方式需要授权时才询问用户；不得询问“是否并行”。
- Native 需要持久化隔离方式、change 分支和目标分支，并在 Archive 后提供 Comet 自有的分支收尾；不依赖 Classic 的 Superpowers 技能。
- worktree 的目标分支默认绑定创建 worktree 时所在的起始分支；从 `master` 启动即合回 `master`，从 release/feature 分支启动则保持该分支线，不强制改绑仓库默认分支。
- Archive 收尾选择“合并回目标分支”时，一次选择授权完整本地闭环：精确暂存并提交当前 change 的可归因改动、合并到已绑定目标分支、运行合并后验证，并在成功后移除干净 worktree 与已合并的本地 change 分支。任一步失败都停止并保留现场；推送与 PR 不包含在该授权中。
- branch/worktree change 在 Runtime Archive 前进行一次联合确认，用户一次选择归档并本地合并、归档并推送、归档推送并创建 PR、归档但保留现场，或暂不归档并返回调整/重新验证；后续只执行该选择授权的动作。current 模式继续遵循现有 `archive_confirmation`。
- branch/worktree 的联合收尾选择由 Runtime 在最终 Archive preflight 前持久化到正式 workspace 元数据；归档或 Git 收尾中断后的会话恢复该决定，不依赖聊天记忆，也不重复例行询问。
- Classic 当前以推送绑定分支/创建 PR 完成交付，并不执行本地合并；Native 参考其“先确认、精确提交、失败不改写”的安全边界，但增加合并回目标分支的用户选项。
- Native 的并行单位是 change：每个 change 独占一个工作区、change 分支、当前 change 归属和 baseline，并可与其他 changes 独立推进 Shape、Build、Verify、Archive。单个 change 不允许由多个会话或多个工作区并发推进。
- 多个已完成 change 写入同一 target branch 时，只有 Git 更新目标分支的合并动作按顺序发生；这不构成 Native phase 串行，也不要求等待中的 change 因其他独立 change 推进 target 而重新进入自身 Build/Verify。
- 合并冲突只有在 Agent 能同时保持双方已确认契约时才可机械解决并运行合并后验证；若冲突要求改变任一 change 的用户可见行为或双方契约无法同时满足，则中止本次合并、保留 branch/worktree，并由用户决定是否创建新的集成 change。
- 不新增跨会话 session lease。Comet 通过单一绑定工作区/分支、当前 change 记录、Guard、revision 与 Runtime 命令级锁保护 change；Skill 明确同一 change 不支持多会话并发编码，用户负责不在多个窗口同时修改同一 change。
- worktree change 选择推送或推送并创建 PR且远端操作成功后，移除干净 worktree但保留本地和远端 change 分支；需要修改时从该分支重建 worktree，不自动监控 PR。选择保留则不清理。
- `comet native new` 必须在创建 change 和捕获 baseline 的同一 Runtime 变更锁内重新检查隔离前提。若系统默认的 current 因并发启动而失效，Runtime 不得在共享工作目录创建 change，Skill 自动改在 worktree 重试；若用户显式选择的模式在落盘前失效，则停止并重新确认，不静默改写用户选择。
- 用户侧统一使用“当前 change”描述一个工作目录正在处理的 change，不把内部术语 selection 暴露为使用前提。
- 升级前已共享一个工作目录的多个旧 active changes 不自动迁移、不生成 worktree、不移动文件或刷新 baseline，仍保留在原目录并一次推进一个当前 change。新隔离规则只约束升级后创建的 change；旧 change 若实际触发 baseline 或 scope 漂移，Runtime 按现有证据规则停止，再让用户决定重新创建或放弃该 change。
- branch 与 worktree 的默认 change 分支名为 `comet/<change-name>`，worktree 默认路径为仓库内已本地忽略的 `.worktrees/<change-name>`。用户可在同一次工作区选择中覆盖；已合法绑定同一 change 的目标可恢复使用，被其他内容占用时停止并要求改名，不静默添加后缀或接管目录。

# Open questions

- None. 用户已确认完整 Shape 契约并授权进入 Build、完成评审、提交与合并交付。

# Verification expectations

- 运行 Native Skill 与受影响 Runtime 相关测试，覆盖隔离时点、三种模式、分支/目标绑定、目标配置/当前 change 边界、失败不回退、跨会话恢复和 Archive 后收尾。
- 对修改的中英文 Skill Markdown 与测试文件运行 Prettier 检查。
- 检查 Native Runtime 生成资产无需变化；若实现中触及 Runtime 源码，则补运行对应 Native 测试并重新构建 Runtime 资产。
