# 目标

在保留 Comet 0.4.2 流程行为的前提下，降低 Classic 和 Native 执行流程命令时的等待时间。用户继续使用既有 CLI 和 Skill，无需配置 MCP、新服务或新语言工具链。

本轮只准备任务、澄清并记录需求；完整 Shape 经用户确认后才实施。最终优化结果应说明哪些步骤变快、快多少、未改善的部分，以及用户完整流程的实际感知，不能用单个只读命令的结果代表全部流程。

澄清状态：用户明确选择 Q3：A、Q4：A、Q5：A。保留逐次 Node 启动，先基线后确认最低收益，Windows 性能实测与三平台兼容验证，均已写入本稿。下一步重新提交完整 Shape 摘要；旧摘要不再使用。

# 范围

## 全流程覆盖

- 清点 Classic、Native、共享入口、Hook Router 及其依赖的共享 Comet CLI；同时核对公开命令注册、Skill 正文/参考文件、Runtime continuation 和独立 bundle，不能只看顶层入口。
- 覆盖新建与恢复、需求确认、阶段推进、状态读取与写入、检查执行、结果交接与接受、错误恢复、归档和工作区收尾。Supervisor 的调度与集成也需要纳入覆盖清单。
- `comet task`、实际流程用到的 memory/knowledge 命令与外部 OpenSpec、Git、测试程序需要登记调用关系。测量 Comet 调度和准备成本，单列外部程序及网络耗时，不把这些程序全部改成常驻。
- 所有流程 CLI 都要有覆盖结论：已测量、被等价场景覆盖并说明依据，或不适用并说明原因。核心命令、关键故障与恢复路径必须有隔离场景或有依据的等价覆盖；环境缺失不能豁免必要验收。不要求每条命令都修改或都变快。Windows 提供完整前后性能对照，Windows/macOS/Linux 完成受影响的兼容验证；macOS/Linux 的性能对照、真实模型全程、未触及的真实远端服务和额外 Agent 宿主可作补充证据，未运行时明确报告，不将它们冒称为已验证。

## 初始命令族清单

| 范围               | 纳入的命令与场景                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享入口           | `workflow resolve --activate`、`status`、`resume-probe`：项目根定位、选择工作流、发现和恢复 change                                              |
| 上下文             | `task` 初次/分阶段检索、`--expand-context`、使用反馈、`--complete`；实际用到的 memory/knowledge 检索与记录，分别覆盖功能关闭和开启              |
| Classic 创建       | `intent route`、`workspace prepare/resolve`、`openspec` 的 list/new/status/instructions、`state init/select/current`；full/hotfix/tweak         |
| Classic 推进       | `state check/next/get/set/artifacts/scale`、`state complete-design`、`handoff --hash-only/--write`、`guard`/`guard --apply`、`state transition` |
| Classic 任务与恢复 | `state tasks` 及 ID 分配、`task-complete`、`sync-plan`、`checkpoint`、`state check --recover`、`rebind`、`check rerun`、验证失败和 preset 升级  |
| Classic 验证与交付 | `check run` 首次/复用/失效/重试，`archive` dry-run/执行、`state delivery` 读写及验证、Archive guard                                             |
| Native 创建与查询  | `new` 的 current/branch/worktree、`select`、`status` 列表/指定/详情/分页、`show`                                                                |
| Native Shape/Build | `next` 准备/确认 Shape、`spec disassociate/remove/sync`、`next --runner-input` 的 Builder 交接、候选冻结、检查计划执行和复用                    |
| Native Verify      | `next --runner-input` 的 Verifier 分派/启动/请求检查/回传/错误与不可用、检查重试、结果接受、实现修订、需求修订和解除阻塞                        |
| Native Supervisor  | 子任务分派与回传、supervisor checks、reconnect/cancel/integrate，控制/子任务/集成工作区之间的读写                                               |
| Native 恢复与归档  | `doctor` 与明确修复、`next` 恢复、`archive` dry-run/执行、keep/merge/push/pull-request 收尾、事务和 finish journal 恢复                         |
| Hook               | context/non-write/write/unknown 输入，无选择/单个/多个 change，跨工作区、项目外路径、allow_paths、正式产物写入及拒绝后恢复                      |
| 低频与兼容         | Classic `validate`、`root show/move`；Native `init`、`root show/move`、legacy `check`、doctor migration；与日常链路分开报告                     |

清单核对来源：`app/cli/index.ts`、两个领域的 `*-cli.ts` 和 `*-cli-help.ts`、`assets/skills-zh/comet-classic/reference/scripts.md`、Classic 各阶段 Skill、`assets/skills-zh/comet-native/reference/commands.md`、`domains/comet-entry/hook-router.ts`、`app/commands/classic.ts` 和 `app/commands/native.ts`。实现前继续展开到实际命令分支并绑定测量/回归场景；以上不是逐命令测量已完成的声明。

特别注意：Native 当前验证主路径是 `next --runner-input`，`native check` 是兼容路径。Classic `guard` 即使没有 `--apply` 也可能执行构建、写日志或证据，不能当作纯查询重复采样。Dashboard、Eval、Bundle、Creator 等独立功能不因“全部流程 CLI”自动纳入本任务。

## 执行顺序及交付物

1. **命令与调用链清单**：记录命令族、调用阶段、调用来源、读写副作用、实际实现入口和对应测量/回归场景。
2. **0.4.2 性能基线**：建立可重复运行的隔离场景，记录原始样本、环境、输入规模、命令次数、实际子进程次数、Git 调用与必要的文件操作指标。
3. **开销拆分与排序**：区分 Node/包装器启动和模块加载、Git/worktree 探测、目录发现与状态解析、文件摘要、领域校验、外部命令和 Agent 往返；按累计成本及调用频率排序。
4. **最低收益确认（Q4：A）**：基于基线，向用户提交 Classic/Native 各自代表性链路的可达收益、最低目标、绝对减少的毫秒/秒数、测量噪声和回归容差；确认后将目标写入正式需求并按 Native 重新确认，再开始性能优化实现。此前只建立测量场景和必要计量，不修改产品行为或先行优化。
5. **Runtime 优化**：优先减少一次命令或一次受控操作中的重复 worktree/Git 查询、重复状态解析、重复扫描与重复摘要；只在依赖和有效期明确时复用结果。
6. **Skill 调用优化**：核对现有轻量响应、continuation 和恢复规则，删除仍然存在且有证据的冗余调用。外部变化、上下文丢失、工作区切换及错误后的必要重新读取必须保留。需要改 Skill 时先中文确认，再同步英文。
7. **回归与性能报告**：逐项对照行为基线，给出冷/热路径、单命令/完整阶段链路、主仓库/worktree 的前后结果和风险边界。对无显著收益的改动撤回或说明其他保留理由。

以上是同一任务的连续交付阶段，不是以“只完成基准工具”代替优化完成。具体热点和实现方法由测量决定；改变用户可见行为或扩大目标时回到 Shape。

## 当前证据与待验证假设

- 发布行为比较基线为 0.4.2 的 `c8db743f310254bc972a1e4594f665f606e3bfa1`。用户准备的开发分支为 `043`，本 change 创建时 HEAD 为 `1ef5d0200480db1ad7dbdb3898f9046bde342d87`；两者间仅有 `.gitignore` 和前期研究文档变化。本轮未重新查询远端。
- `bin/comet-daemon-router.js` 当前仅将部分 Classic `state current/next` 和 Native `status/show/root` 路由到 daemon，不能认为全流程已经常驻执行。
- `platform/paths/git-worktree.ts` 自己调用 Git；`platform/process/runtime-metrics.ts` 的共享计数不足以代表所有 Git 调用。现有 `scripts/benchmark/runtime-daemon-benchmark.mjs` 主要采样 Native status，不是全流程基准。
- `domains/comet-native/native-cli-shared.ts` 的工作区判断与 `native-status-discovery.ts` 的发现过程都有 worktree 读取，后续状态投影还涉及 portable runtime 读取。这些是候选重复开销，尚未证明每次调用都能安全消除，也未测得各自时间占比。
- Classic 已在 `classic-command-context.ts` 使用命令级上下文，并在部分产物检查中复用观察结果。优先核对和复用现有能力，不再造同类机制。
- 既往 Windows 单一路径 benchmark 只作调查线索，不作为本任务的当前基线或收益承诺。本轮尚未运行性能测量。

## 继承的已发布契约

- `workflow-cli-efficiency`、`node-runtime-performance` 和 `workflow-reliability` 继续成立；本次规格增加全流程测量与安全复用要求，不重写这些既有能力。
- 既有固定 fixture 的确定性预算继续回归：task 身份有 origin 最多一次 Git、无 origin 最多两次；指定场景 named status 最多五次、Shape prepare 最多七次。不得外推为所有命令的统一上限。
- 同名 change 必须完成归属、归档继承及必要 Git 祖先证明；内容指纹不能被 Git clean 或未变化的 porcelain 状态替代。正常 Hook 输入不新增逐请求子 Node 进程。
- 写入、确认和验证分派继续绕过只读 daemon，失败有界且不盲重放写操作；可选上下文和插件不能进入写入许可的阻塞关键路径。

# 非目标

- 本次不实现 MCP/RPC 接入，不引入 Rust 或其他原生 CLI，不新建全命令常驻服务，也不扩大现有 daemon 的写操作覆盖。
- 用户选择 Q3：A，允许保留每次 CLI 启动 Node；本轮不以消除全部冷启动作为完成条件，但必须验证 Classic/Native 代表性流程自身等待的改善，不能只报告个别热点。
- 不移除现有 daemon、CLI fallback 或已发布优化；保留现有启停、回退及可用性行为。
- 不合并 Classic/Native 状态机，不重写工作流，不改变公开 CLI 参数、默认输出、退出码、确认语义或现有 JSON 契约。
- 不引入跨请求共享的状态、授权或验证结果缓存；不通过关闭确认、锁、Hash、检查、Hook 或独立验收获得速度。
- 不优化用户项目的业务测试、模型推理或外部服务本身，不承诺这些外部耗时按相同比例下降。
- 不修改网站、无关的 `.gitignore` 改动或本地安装的 Skill 副本。当前阶段不提交、不推送、不发布、不归档。

# 验收示例

- 全流程命令清单能够追溯到实际调用位置，包含 Classic、Native、共享命令、Hook、写操作、恢复和归档；每项有测量或明确的覆盖/未覆盖说明，不把只读子集报告成全流程完成。
- Windows 同一环境和等价输入下，可重跑优化前后的命令及代表性阶段链路；报告样本量、原始耗时、P50/P95、进程及 Git 调用数，明确指标采集边界，不把 OS 文件 I/O 计数等同于全部文件 API 调用。
- 基线后先取得用户对最低收益目标的明确确认，再开始性能优化实现；Classic/Native 代表性链路均达到确认后的目标，热点有减少工作的确定性证据与超出基线波动的耗时收益。其余覆盖场景没有超出预先固定容差的性能退步；必要例外必须单列影响并取得用户接受，不能仅以“原因已解释”或小幅超噪声收益替代已确认目标。无法取得有效证据时不能宣称优化通过。
- Windows/macOS/Linux 的受影响兼容检查验证：同一输入在优化前后具有等价的命令结果、状态变化、文件副作用、退出码及后续动作。授权过期、候选/文件漂移和跨工作区冲突仍被识别，拒绝后的恢复路径仍可继续使用；必要平台检查缺失不能算通过。
- 命令之间或并发执行中的状态、文件、分支/worktree 变化不会被旧观察结果掩盖；写入和最终提交校验读取最新状态，作用域内复用不会泄漏到另一请求、项目或工作区。
- Skill 优化若发生，不省略有效确认和恢复步骤；Runtime 已给出充分当前响应时避免重复查询，新会话、上下文缺失和外部变化时仍重新获取必要状态。改动的中文/英文行为一致。
- 现有 daemon 开启、关闭、冷启动、热调用及不可用回退均有相应验证，Hook 保持独立可执行。长检查的外部执行时长与 Comet 自身成本分别报告。
- 最终报告分别列出各类命令及代表性完整链路的收益、用户减少的等待、执行过的验证和未执行项；不把 Runtime 局部加速外推成真实 Agent/模型全程加速。

# 约束与不变量

- 以发布版 0.4.2 行为为非回归基线；正式测量前核对发布 tag/包、Node/Git 版本、安装入口和测试候选，不能只比较不一致的本地构建。
- 命令级/操作级观察只在明确定义的有效期内复用。文件修改、Git 操作、状态写入、外部子进程及相关并发变化可能使结果失效；关键提交检查不能因为命中复用而跳过。
- 保留磁盘锁、事务、状态版本、工作区绑定、授权与验证指纹；失败保留现场和明确恢复动作，不增加写请求盲重试。
- 性能计量不能污染默认 stdout/JSON，不记录凭证、敏感环境变量或用户文件正文；仪表开销需要单独评估。
- 每个写操作样本使用独立或重置的临时 fixture，确保起始状态等价，不在用户真实 change 上重复归档、合并、推送或制造故障。
- 覆盖正常推进、失败/修复、恢复、较多历史 change、多 worktree 及并发访问等代表性场景；外部服务/模型场景无法运行时明确标为未验证。
- 不默认运行全仓测试。后续优先执行改动对应的测试、生成物和必要打包验证；本地未执行的 CI/真实宿主 Hook/模型 Eval 不冒称已通过。

# 决策

- **已有方向**：保持 CLI + Skill；当前优先测量并减少真实重复工作。MCP 不是本任务前置条件，后续只有测量证明剩余瓶颈需要它时另行提案。
- **已有范围**：包含 Classic 和 Native 全流程使用的 CLI，不以高频只读路径作为最终交付范围。
- **Q1 已确定**：用户选择 B，并自行建立 `043` 分支。Runtime 已复用该分支创建 `workflow-cli-performance`，`isolation: branch`、目标分支 `master`、工作目录 `D:\Project\Comet`；未创建其他分支或 worktree。
- **Q2 已消除**：用户已处理原有未提交文件，创建前工作区干净。无需 stash；本 Agent 没有暂存、提交、清理或挪走那些文件。
- **Q3 已确定：A**：保持现有 CLI 调用方式，允许保留逐次 Node 启动；目标是两种流程代表性链路自身等待的实测下降，不扩成全命令常驻改造。
- **Q4 已确定：A**：先测基线，向用户提交可达收益和最低目标，确认后才开始性能优化实现。全局百分比不预先虚构，也不将任意小幅改善自动视为足够。
- **Q5 已确定：A**：Windows 为必须提供完整前后性能对照的平台；Windows/macOS/Linux 均完成受影响的兼容验证。macOS/Linux 性能对照属于补充证据，不能因此放宽它们的正确性验证。
- **会话恢复**：原始任务为“准备开始任务吧，先澄清要做的，把要做的都记录下来”；上下文 session 固定为 `workflow-cli-performance-20260921`，后续阶段沿用。
- **建议组织方式**：一个 Native change，内部按清单、基线、热点优化、回归顺序推进。暂不创建 Supervisor/子 change；这些阶段共享同一性能证据和安全边界，不能将尚未查明的热点提前当成独立子目标。
- **判定规则**：按 Q4：A，在基线采集后、优化实现前确认最低收益，固定重复采样规则、噪声区间和回归容差，并写入性能记录与正式需求；不能根据候选结果倒改标准。未达到目标时如实报告未完成。
- **来源与历史建议**：需求来自当前对话，Skill 路径只指定执行流程。前期调研是实现参考，其中“增加可选 MCP”及全命令长连接适配是早期候选，不属于本任务。本文和 `specs/workflow-cli-performance/spec.md` 保存正式需求，研究记录只保留索引。
- **当前授权边界**：只做准备和澄清。创建正式 change 后仍需完成 Shape 确认，不能据“准备开始任务”进入 Build。

# 待解决问题

本轮 Q1—Q5 均已解决，没有需要重复询问的范围或工作区决定。最低收益的具体数值须先取得基线，属于 Q4：A 已约定的下一检查点，不在当前猜测或承诺。完整 Shape 确认后先做基线；数值目标明确获准前不得进入性能优化实现。

# 验证预期

## 本轮准备工作的验证

- 已解析为 Native，复用用户的 `043` 分支创建正式 change；保留 `.gitignore`、既有研究文档和 website 子模块原有提交。
- 已核对全流程命令族、现有性能/可靠性规格，完成只读范围复核；这些不是性能测量结果或代码验收。
- 当前仅编辑正式 brief、完整 Spec 和前期记录索引。格式与 Native Shape 产物有效性由本轮实际检查报告，不手工填写通过状态。
- 本轮不运行 benchmark、运行时代码测试、build、全仓测试、真实宿主 Hook 或模型 Eval；这些不属于准备阶段的完成证明。

## 实现阶段的验收方法

- 基线与候选采用相同平台、Node/Git 版本、入口、fixture 和采样规则，交替或分组多轮采样以减少机器负载/文件缓存偏差；冷/热定义、样本数和离群样本处理在测量前记录。
- 用集成/契约用例核对 CLI 结果、状态与文件副作用，覆盖工作区切换、并发与失效、确认过期、失败恢复和 Archive 重试边界。
- 测量短只读、短写入、检查准备与结果绑定、阶段推进、恢复和归档；完整链路区分脚本重放与真实 Agent 使用，不能混称。
- Windows 必须提供完整前后性能对照；三平台受影响兼容检查必须完成，可使用候选对应的 CI 结果，不能用 CI 配置存在代替通过。macOS/Linux 未做性能测量时仅报告该性能证据缺口，不豁免必要兼容检查。
- 修改 Runtime 源码后同步对应生成资产并验证一致性；针对性测试、打包产物、真实宿主和模型验证分别列出证据。
- 正式验收由 Native Runtime 管理并交给独立只读 Verifier，不手工修改状态或写通过报告；有未完成必要验收时不宣告归档完成。
