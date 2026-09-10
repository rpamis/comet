# Classic / Native CLI 正确操作与 Runtime 耗时审核

日期：2026-09-10。源码基线：`0.4.1`，`1617fa06da8a9bfbf5dd424316a1ba35072a289a`。

## 结论

当前代码确实存在会迫使 Agent 纠正操作的协议矛盾，不能全部归因为模型没有认真读说明。Classic 的绝对路径指引与相对路径校验冲突；Native 的 Verify 输入模板按命令参考整份复制，会被自己的解析器拒绝。除此之外，恢复入口、任务回报包和错误输出仍把本可由程序完成的机械工作交给了 Agent。

Runtime 的主要可见热点是重复 Git 子进程与无关工作区的完整发现。Windows 小项目实测中，Node 空进程约 58 ms，Native `next` 约 1 秒；查询同一个 change 的 `status` 从一个 worktree 时约 0.52 秒，随 30 个真实 worktree 增至约 8.23 秒。公开 Native CLI 与内部 bundle 的 `next` 耗时接近，绕过公开 CLI 不是有证据支持的提速方案。

**本轮不能验证“三分之一时间”的比例。** 缺少反馈用户的版本、平台及原始 trace；定向构造错误能证明可达性，不能证明自然发生频率。最新本地 Eval 目录也没有可用的当前模型执行轨迹。建议同时减少错误后的模型往返与单次 Runtime 开销，用同任务模型对照验证收益。

详细证据见：

- [Classic 操作审核](2026-09-10-classic-cli-operation-audit.md)：当前公开 CLI 的失败/纠正对照及正常阶段链。
- [Native 操作审核](2026-09-10-native-cli-operation-audit.md)：生成 Runtime 普通 change 生命周期、输入解析、Supervisor 协议边界。
- [Runtime 性能审核](2026-09-10-runtime-latency-audit.md)：隔离项目测量、Git 调用来源与 worktree 规模实验。

## 审核边界与方法

开始时工作区干净，`website` 引用与子模块 HEAD 都是 `82ad22bed5607651ed236abfc4261bb2cc905456`。本轮仅增加研究文档和系统 Temp 中的隔离实验，不修改产品、Skill、生成物、website 或版本，不做提交、推送、评论或 PR。

证据分四层：

1. 当前中文/英文产品 Skill、公开 CLI 门面、领域源码与生成 bundle 的静态对照。读取 Skill 作为审核对象，不执行 Classic 依赖的 Superpowers Skill。
2. 临时 Git 项目及临时 HOME 中的真实 CLI 调用，记录 argv、cwd、退出码与输出；合法步骤与定向错误输入作对照。没有修改真实项目的 Comet 状态，也没有手改 phase 绕过流程。
3. 新进程计时与单独的子进程追踪。主测量期间暂停本任务的其他 CLI/测试进程；这不能保证机器完全没有其他负载。预热文件系统缓存后重复执行，只纳入符合预期的成功路径。
4. 检查既有真实模型日志与 Eval 日志归一化代码，判断能否量化纠正成本。历史轨迹只作定性案例，不当作当前版本或反馈用户的实测。

普通 Native fixture 的 Builder/Verifier 输入、Classic 的本地检查均明确是协议夹具。跑通生命周期只证明输入、状态转换与回执链可执行，不证明真实独立验收、真实平台 Hook、npm 安装包或模型工作流已经通过。

## 当前 Agent 实际承担的流程

入口使用 `comet workflow resolve . --activate --json`，选择唯一工作流，再加载该 Skill。工作区与阶段确定后通过 `comet task ... --json` 读取渐进式上下文。当前入口已经要求 CLI 缺失时停止解释安装问题，并禁止扫描 Skill 目录寻找内部 bundle；不能把旧版本的 fallback 行为当作现状。来源：`assets/skills-zh/comet/SKILL.md:12-31`。

| 工作流  | 正常管理链                                                                                                             | 额外容易产生机械操作的地方                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Classic | Open → Design → Build → Verify → Archive                                                                               | OpenSpec artifact 指令与完成状态；路径登记；任务映射/完成；handoff；检查回执；Guard 转换；中断恢复 |
| Native  | new → Shape prepare/confirm → Builder handoff → checks dispatch → Verifier 回报 → 接受结果 → Archive preview/confirmed | 复制 JSON 模板；角色/工作区切换；回报轮次绑定；状态复读；Supervisor Child 回报与集成               |

已初始化项目的一次通过普通 Native change，至少有九次生命周期调用，尚未计入恢复、上下文、详情读取及真实检查。它们分布在实现、复核与用户确认边界两侧，不应简单合并成一个“自动通过”命令。Classic 的五阶段同样不能以命令数量直接计算浪费：实际开发检查和验收是有效工作，参数猜测、重复查询与无关发现才是本轮主要削减目标。

Classic 依赖的 OpenSpec 当前已通过 `comet classic openspec -- …` adapter 统一运行；双语 Skill 明确覆盖外部 Skill 中固定 cwd/物理路径和直接调用官方 CLI 的指令。产物按实际依赖图推进，不能继续把旧版固定顺序当作当前问题。仍有可见的重复读取：`comet-open/SKILL.md:176` 兼容性预检读取 status，`:187` 在没有产物写入前再次读取；结束时 `state artifacts` 及后续 Guard/handoff 还会重新查上游状态。第一处可复用最近观察，跨文件写入或阶段边界的重验则有必要，不能一概删除。

## 为什么 Agent 会反复纠正

### 1. 遵循 Skill 仍会失败的确定问题

| 问题                                          | 实际触发与结果                                                                                                                                                 | 应改哪里                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Classic 绝对路径与相对路径冲突                | Skill 从绝对 `changeDir` 构造 `design_doc`、`plan` 与任务 authority；状态 set 拒绝绝对路径，Build Guard 又拒绝绝对 authority。改为同一文件的仓库相对引用即成功 | 明确区分文件工具的绝对路径与状态/产物的仓库相对引用；Runtime 直接返回两种用途的值 |
| Classic 子目录错误解析                        | 同一合法 `design_doc`，根目录检查通过；从 `src` 运行 `state check … build` 或 Design transition 却报文件不存在                                                 | 两处 `path.resolve(designDoc)` 改用已有项目根路径辅助函数                         |
| Classic Design 恢复入口不一致                 | 设计已登记但尚未完成转换，普通 Design entry 要求路径为空而失败；`--recover` 和 Design Guard 能继续                                                             | 接受已有且有效的设计成果，返回尚待完成的动作，不提示清空有效状态                  |
| Classic 快捷入口与完整入口参数不同            | 同一项目 `state current --comet-task audit --json` exit 1；改为 `classic state current --comet-task audit --json` exit 0                                       | 快路径维持完整门面的参数契约；有集成参数时先走可正确处理的门面                    |
| OpenSpec 返回命令与 Comet 的 adapter 规则冲突 | adapter 在 `docs` 创建 change，上游输出却提示直接运行 `openspec status`；照提示在原项目根执行报找不到 change，使用 adapter 成功                                | 对 Agent 返回正确 cwd 和完整 Comet argv，不让它反复翻译上游下一步                 |
| Native Verify 模板不被解析器接受              | 当前 `inputOptions.template` 是四种互斥操作组成的数组；参考要求整份复制，解析器要求单个对象，exit 65。选择正确单个对象后通过                                   | 每种动作单独返回可提交对象，写清选择条件                                          |

Classic 来源：`classic-state-command.ts:173-180,734,1167-1186`、`classic-guard.ts:553-554`，以及子报告引用的双语布局/Design/Build Skill。Native 来源：`native-portable-continuation.ts:952-999`、`native-runner-input.ts:165-176,281-282`、`reference/commands.md:32`。以上都已通过临时 CLI 对照，不只是代码推测。

快捷入口来源为 `bin/fast-runtime-router.js` 和 `app/commands/classic.ts:20-24,130-157`。静态调用链还显示它绕过了门面的插件结果记录；本轮未验证具体插件存储副作用。这个当前快路径的一致性问题应修复，但不能据此解释发生在它引入之前的用户反馈。

OpenSpec 的 adapter 在 `classic-openspec-command.ts:24-33,45-49` 切换子进程 cwd 并透传结果，本机 `1.7.0` 包的真实创建/status/instructions 验证了上述冲突。还复现了 Windows 字面参数中的 `%变量%` 被 `shell: true` 展开，说明平台 quoting 没有完整保留 argv。细节见 Classic 子报告；并未把某一上游版本直接判为不兼容。

### 2. 协议可用，但需要 Agent 自己补齐

- **Supervisor 回报包不完整。** task 有 child/runId/工作区/验收信息，却没有该角色的回报 argv、控制目录和可提交模板。现有 CLI help 与命令参考能提供正常路径，所以这不是必然功能阻塞；它增加了查阅与手工组装成本。应把正确回报契约放到任务包里。来源：`native-supervisor.ts:790-831`、`native-portable-continuation.ts:848-869`、`native-cli-help.ts:176-178`。
- **错误不够可操作。** Native 将 `known_limits` 写成 `knownLimits`，只报 `fields are invalid`；没有缺失字段、错误字段或输入路径。UTF-8 BOM 又只报 JSON 无效。Classic 的 `--json` 失败详情仍可能位于带 ANSI 的文本中，Guard 的嵌套诊断和外层退出码也需要分别解释。应该严格校验，同时明确指出怎样纠正。来源与真实输出见两份操作子报告。
- **动作上下文分散。** new 返回的工作区要求先切换 cwd，后续 argv 未独立携带完整执行上下文；new/status/next 的 phase、stateVersion 所在字段不同。Agent 不仅填写业务结论，还在翻译路径、拼命令和寻找状态。
- **成功后例行复读。** Native Skill 要求变更命令后通常再查 status，尽管多数 next 已返回最新状态和 continuation。已有 Archive 例外说明可以直接使用同一响应。来源：`assets/skills-zh/comet-native/SKILL.md:113`、`native-next-command.ts:293-300`。

一条参数错误消耗的不只是那次进程时间。后续常常还有“解释错误 → 读 help/源码 → 查状态 → 重写输入 → 重试”，并把这些输出留在会话中。协议 fixture 只能证实第一步和纠正路径；额外模型时间必须从真实轨迹测量，不能按失败命令数估算。

### 3. 安装、宿主和正确拒绝必须另算

旧 Eval 的 `native_rc1_20260828_0952/events/comet_api_cache_ttl_COMET_NATIVE_PHASE1_r1_rep1.json` 提供了一个真实定性案例：工具调用索引 1-3 中找不到 `comet`，之后扫描并读取内部脚本；索引 8 把 `--help` 传给不支持该参数的分命令 bundle；索引 28 又给聚合 bundle 多传了一层 `native`，索引 29 才纠正成功。该轨迹总计 95 次工具调用、80 turns、约 504 秒，但不含可直接归因的逐调用纠正耗时。

这说明 CLI 缺失和内部入口猜测会产生真实绕路；它属于旧 rc1 Eval 的安装/宿主边界，不能作为当前版本存在同一缺陷的证明。当前入口已禁止这类 fallback。最近的 `experiment_20260909_191707` 仅有计划矩阵，未发现对应 events/reports 可支撑当前比例分析。

同样，过期状态版本、错误工作区、旧 runId、验收 ID 不完整、候选提交不匹配、检查未通过或缺少用户授权的拒绝，应保留。减少误触的办法是返回完整且绑定当前状态的动作，而不是删除检查。Native 的 cwd 保护涉及同仓 worktree 绑定，本轮没有复现错误路由，不将其直接判定为缺陷。

## Runtime 时间花在哪里

测量环境为本机 Windows、Node 22.20.0、小型临时 Git 项目与隔离 HOME；主表每项一次预热、七个新进程。数值四舍五入，表示暖文件缓存下的新进程延迟，不是完全冷机启动或用户生产项目延迟。Git 累计时间来自另一次插桩调用，与未插桩中位数不能直接精确相减。

公开入口测量使用 `node bin/comet.js`，包括 Node 与内部子进程时间，不包括外层 shell、npm/npx shim 或 Agent 工具往返。快路径执行当前已提交 bundle；`--activate`、`task` 等回退路径执行本地现有 `dist/`，没有重新 build 或安装发布包，源码 HEAD 不自动证明全部 dist 新鲜。Native next 每次从合法 Shape state version 1 开始，计时前恢复实验项目原有 state/runtime 文件字节，再执行正常准备动作；复原时间不计入。这是性能控制变量，不属于从头跑七次模型工作流。

| 成功路径                                          | 中位耗时 | 追踪到的 Git 子进程 | 解释                                                    |
| ------------------------------------------------- | -------: | ------------------: | ------------------------------------------------------- |
| Node 空进程                                       |    58 ms |                   0 | 启动成本基线                                            |
| `comet workflow resolve . --json`                 |   110 ms |                   0 | 已有公开快速入口                                        |
| 实际 Skill 的 resolve，加 `--activate`            |   237 ms |                   0 | 走完整 CLI；不能拿上一行代替真实入口                    |
| `comet state next <change> --json`                |   144 ms |                   0 | Classic 基础管理查询较轻                                |
| `comet native show <change> --json`               |   131 ms |                   0 | 正文读取基线，不能替代 status 的校验语义                |
| `comet native status <change> --json`，1 worktree |   522 ms |                   5 | Git 累计约 373 ms                                       |
| `comet native next <change> --summary … --json`   | 1,045 ms |                   9 | Shape prepare，Git 累计约 659 ms                        |
| 同一 Native next，直接 bundle                     | 1,033 ms |                   9 | 与公开 CLI 接近，不支持绕过 CLI 的提速主张              |
| `comet task … --json`，无 origin、无召回内容      | 1,246 ms |                  12 | 六处分别解析身份，每处 remote 查询失败后再查 common-dir |

为检验无 origin 的影响，另外给临时仓库配置了 origin URL，不访问网络：五次补测 `comet task` 中位约 749 ms，仍有六次 `remote get-url`，返回仍为 `{ "context": [] }`。补测未申请其他进程静默窗口，只用于说明配置正常 remote 后仍存在重复身份解析，不能与主表做严格净收益对比。

同一次调用中，Bridge、项目名、Knowledge readiness、LocalStore、deterministic extractor 和 HostReview 路径各自解析仓库身份，造成上述重复。应解析一次后传递给本次调用内的模块，不改变仓库级身份算法，也不跨命令盲目信任旧数据。

### 命名 status 随无关 worktree 数量增长

每个 worktree 均通过正常 Git/Native 入口建立，各有一个合法活跃 change；始终查询同一个目标。规模组各一次预热、三次采样，因此尾部数值只是小样本观察，不作为可靠生产 p95。

| 真实 worktree 数 | 同名目标 status 中位 | Git 次数 | 插桩 Git 累计 | 同目标 show |
| ---------------: | -------------------: | -------: | ------------: | ----------: |
|                1 | 522 ms，主表七次基线 |        5 |        373 ms |      131 ms |
|               10 |             2,783 ms |       32 |      2,570 ms |      133 ms |
|               30 |             8,225 ms |       92 |      7,706 ms |      129 ms |

输出仍约 2 KB，`show` 基本不变，主要差异来自发现/检查流程而非 JSON 大小。`native-status-discovery.ts:543-546` 先发现并检查所有候选，再按指定 name 过滤。优化应先按名称缩小重检查范围，并共享本次调用的 worktree/Git 观察。仍需检查同名活跃/归档记录与创建身份，不能改成“找到第一个目录就返回”。

### 现有基准尚不能证明有效工作流已经变快

`scripts/benchmark/runtime-coldstart-benchmark.mjs` 的 `measureOne` 没有检查 `spawnSync` 的 status/error，也没有隔离 cwd/HOME。某些 target 只执行 help，某些在缺少 change/config 时会走错误路径。因此它可以提供启动趋势线索，但不能直接作为成功 Runtime 流程的性能验收。此次另建有效 fixture 并检查退出码，未改写旧基线。

## 建议按三个批次改

### 第一批：让 Runtime 给出的操作能直接执行

1. 修 Classic 的路径用途、两处 cwd 解析和 Design 恢复条件；让计划 authority 直接取 Runtime 返回值。
2. 修 Native Verify 互斥模板；Supervisor 的每个角色任务带完整回报命令、工作区和模板。
3. 输入错误返回具体 `missingFields/unknownFields`、字段路径、当前动作和可用纠正方式；接受文件开头的 UTF-8 BOM。严格 schema 与验收校验保留。
4. 对公开快捷入口和完整入口建立参数、输出及插件副作用一致性验证，避免加速时绕过原有公共契约。
5. 让 OpenSpec adapter 提供与实际规划目录一致的下一步；Windows 平台适配保证字面 argv 保真，覆盖空格、引号与百分号参数。

验收方式是实际执行 Runtime 返回的模板和 Skill 中的例子，包括错误后使用纠正提示。只检查文档含有某个字符串无法发现“模板本身不被 parser 接受”。覆盖中英文、根目录/子目录、Windows 路径、恢复中间状态、普通 change/Supervisor 分支。

### 第二批：让 Agent 只填业务内容，减少管理往返

在已有 continuation 上补齐执行包，不另造平行状态机：固定给出当前工作区、argv、已绑定版本/动作、互斥输入选项和下一步条件。已知 change、验收 ID、runId 等由 Runtime 填好；Agent 只填写实现摘要、检查计划、验收结论和真实限制。

成功动作返回统一的精简观察结果，Skill 直接消费。会话恢复、未知状态、并发失效、外部任务完成或工作区变化时再重新查询；需要正文时按需读取。不要在正常成功后机械添加 status/get/next 三轮读取。

Classic 可将同一授权边界内的“登记成果 → 写 handoff → 校验并推进”交给一个可恢复操作协调，保留前置校验与失败证据。不要让 Agent 用更多 shell 拼接实现所谓批处理，也不要把设计确认、实现、独立验收与归档授权跨阶段自动合并。

### 第三批：削减重复 Git 与无关检查

1. `comet task` 在单次调用内共享已解析的 ProjectIdentity，避免各插件/存储模块重复查询同一 remote/common-dir。
2. Native named status 先筛选目标候选；共享 worktree 列表、Git 公共目录、分支等本次观察，再进行必要的绑定/归档冲突验证。
3. Native next 在状态、续行动作与检查上下文之间传递同一调用内的项目观察，减少重复子进程；跨会改变 Git 的操作边界主动刷新。
4. 测量实际高频入口，包括 `--activate` 与上下文路径，而不是只优化 `--version`、`--help`。维持公开 CLI 作为唯一入口。
5. 之后再评估解析/模块加载、compile cache 或持续进程。当前证据首先指向 Git 和调用次数，不足以支持新增常驻服务。Node 22 的 compile cache 只影响适用的模块编译，不会消除重复 Git 查询。[Node 官方文档](https://nodejs.org/download/release/v22.20.0/docs/api/module.html#module-compile-cache)

正式检查回执继续绑定候选、输入和环境。当前已有检查复用、一次性证据保护与恢复优化，先测实际命中率；不能用 Builder 的 `passed` 文本代替 Runtime 回执，也不能缓存一个跨命令不失效的工作树 hash。

写入前及锁内关键绑定校验仍保留。本命令没有执行 Git mutation，不代表其他进程不会改变工作区；不能以请求内缓存代替必要的外部并发变更检测。

## 怎样验证是否真的减少了“三分之一”

先补足观测，再用相同任务、模型、平台与隔离策略做前后配对。至少覆盖普通小任务、子目录启动、中断恢复、真实多 worktree、Supervisor、一次实现修复、一次无效字段输入。失败的运行同样报告，避免只在成功样本上看速度。

每次 CLI 记录可脱敏的版本、动作、cwd/工作区标识、开始/结束、退出码、结构化错误码、关联上一次尝试、输出字节数；需要定位性能时采样记录 Git 次数及累计耗时。不要持久化凭证或完整敏感命令参数。

至少区分六类：参数/JSON schema 错误、路径/工作区误用、过期状态、正确的业务阻塞、真实开发检查失败、安装/宿主环境失败。前两类及可归因的协议恢复才计入 CLI 操作纠正；真实测试失败不能一概当成 Comet 浪费。

| 指标                                     | 用途                                           |
| ---------------------------------------- | ---------------------------------------------- |
| 每个意图第一次提交成功率                 | 判断模板和命令接口是否更容易正确操作           |
| 每个 change 的无效调用数、纠正工具往返数 | 判断是否减少自我纠正                           |
| 从无效提交到同一意图被接受的修复区间     | 计入错误后的模型分析、查阅和重试；用户等待单列 |
| 成功命令 median/足量样本 p95、Git 次数   | 验证 Runtime 自身提速，并区分工作区规模        |
| 总工具数、模型轮次、输出/上下文字节      | 检查减少进程是否同时减少模型负担               |
| 任务成功、验收完整性与错误放行数         | 确保速度没有来自减少必要工作或削弱校验         |

并行场景按实际时间线处理重叠，不能把各 Agent 的墙钟耗时简单相加后除以总任务时间。先约定分母是用户等待总时长还是有效 Agent 执行时长，再报告纠正占比。

当前 `eval/scaffold/python/logging.py:268-277` 的 Codex 归一化事件只留 command/output，没有保留逐命令 exitCode 与耗时；`:318-355` 的 Claude 结果也主要保留 input/output；`:358` 汇总的是运行总时间。现有摘要不足以直接算上述指标，需要从平台原始事件补齐或增加轻量观测。Anthropic 的工具工程指南同样建议同时检查错误率、工具往返、调用耗时和原始轨迹；这里仅作为方法参考，Comet 的结论来自本地证据。[官方指南](https://www.anthropic.com/engineering/writing-tools-for-agents)

## 本轮验证记录

- 已执行：Classic 当前公开 CLI 的最小正常阶段链与路径/子目录/恢复/快捷入口错误对照，真实 OpenSpec 创建/status/instructions 与错误提示/参数保真对照；Native 生成 Runtime 普通生命周期及输入错误对照；公开 Native CLI 的 status/help；成功路径新进程基准、Git 插桩和真实 worktree 规模实验。
- 已完成：当前源码/双语 Skill/生成入口静态交叉复核，历史真实模型轨迹抽查，现有 Eval 与 benchmark 方法审核。
- 相关仓库契约检查：`classic-layout-documentation.test.ts`、`classic-runtime-assets.test.ts`、`native-skill.test.ts`，三文件共 24 项通过。这些契约通过不等于已覆盖本轮发现的输入与操作矛盾。
- 文档格式：四份新增报告已通过 Prettier 检查。
- 未执行：真实模型前后对照、用户 trace 回放、真实平台 Hook、Supervisor 完整多 Agent E2E、npm 包安装验证、远端 CI、产品 build/全量测试。前五项超出本轮已有证据；后续没有产品修改，按研究文档范围进行验证。上述未执行项均不作通过结论。
