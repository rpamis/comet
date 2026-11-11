# Native / Classic Runtime 精简实施记录

## 范围与保留条件

比较基线为 `630ce380787f446e803f94b4b90cbbdbf8663364`，分支 `053`，版本 `0.5.3`。本任务依据用户“完成你说的优化吧，记得最终跑测试，保持测试本地全部通过”，以及后续“上下文太大……能否一起优化”实施。全量确定性测试已获授权；真实模型 Eval 未获授权，不启动。

保留用户选择的执行方式、TDD、Review 配置、稳定任务 ID、任务 CLI 打勾、Build 完成检查、用户批准和旧 Run 恢复。保留 Classic 状态投影与固定应用契约。网站、平台安装目录和本地 dogfood Skill 不在修改范围。

## 已实施的精简

1. Plugin Store / Classic 原 PID 锁统一采用现有 SQLite 事务锁。新锁不记录 PID、主机或进程创建身份；进程退出由系统释放事务。旧锁保留原内容，通过 `comet doctor --lock-file` 诊断，只有精确 token 与原执行已停止确认同时满足时才修复；活动事务仍拒绝覆盖。
2. Native / Classic / Entry 改用现有细分公开入口，减少聚合模块的加载。Native 错误类型移到不含运行时执行依赖的模块，原路径重新导出同一个类，保持 `instanceof` 与公开兼容性。没有增加一套缓存、后台服务或新配置。
3. 新内置 Native v4 合并 `shape.revalidate` 和 `verify.revalidate` 的纯内部转换，由批准处理器直接执行相同业务转换。旧 v4 通过原定义精确选择原处理器；v1–v3、固定应用不转换。Supervisor 的当前拆分合同仍绑定当前 Shape Action，不能读取上一轮的子任务。
4. Classic 相同 coordination 报告不再重复写 JSON 与阅读投影。投影缺失时只恢复阅读投影，状态变化时正常写入。任务与审批的权威来源不变。
5. Native 高层任务直接返回 Shape 等待中的批准与修订选择，保留完整参数、状态版本、用户确认和 Supervisor 推进方式；恢复与失败状态继续返回原 Runtime 的选择。高层长指令只在下一步中保留一份，简短状态摘要用于显示。
6. 插件 SessionStart 改为短入口与完整 Rule 的绝对路径，明确进入/恢复 Comet 前必须读取、已有有效上下文则复用、压缩后缺少则重读。完整 Rule 文件和 PreToolUse Guard 保留。不新增启动期状态枚举、依赖或持久化“已投递”缓存；中英文提示保持相同条件。
7. Classic 默认 `runtime dispatch` 不再展开完整 Run 后再附加紧凑投影。保留当前 Action、输入摘要、批准、配置和实际领取会话；程序 API、`inspect` 和 `--details` 仍返回完整 Run，存储历史不变。

## 上下文测量

用户随后确认原反馈来自 **0.5.2**，其余平台、workflow 和命令轨迹未知。原反馈来源为 `report:2026-11-10-comet-context-size`，频繁压缩的现场尚未复现。下列 v4 Shape 缺项与插件 SessionStart 属于调查 053 时另行发现的问题；0.5.2 tag 不含这套插件，不能把三次插件注入当作该用户的根因。旧版单独测量追加在上下文调查报告中。

原始测量见 [上下文体积调查](2026-11-10-context-output-audit.zh.md)。使用同一个公开 bundle 重放脚本和单条验收输入，Shape 领取从 2,372 B 降到 2,000 B；Shape 提交由 2,688 B 变为 3,052 B，增加了原先缺失的受保护选择。正常路径不再需要额外 9,496 B 的 Shape status，因此取得完整决定信息从 12,184 B 降到 3,052 B，约减少 75%。这是命令输出字节数，不是实测模型 token 或压缩次数。

同一脚本的 Build 状态查询、Verify 任务和旧协议详情没有截断。高层 Build 首次响应因暴露已有修订选择由 2,411 B 增到 3,031 B，重复领取仍为 2,411 B；完整 Verify 为 2,789 B。50 条验收的正文应完整传递，不通过减少验收范围减小输出。本轮不重写 Skill：中文确认与英文同步需要单独完成，尚无真实用户轨迹证明整份读取 59 KB 参考是频繁压缩的根因。

当前聊天真实 Hook 日志证明三次 SessionStart 输出了逐字节相同的 10,196 B 全 Rule。新入口的确定性输出在 Codex / DSH 隔离生成 Hook 上比较，并覆盖 startup、resume、compact；真实平台安装未变更。按需读取是否被真实模型正确执行、压缩次数是否减少仍缺少现场或 Eval 证据，不能把输出减少写成用户频繁压缩已彻底解决。对应增量案例保留 pending 附加验收，不能用于发布放行或关闭原反馈。

依赖测量详见 [模块依赖调查](2026-11-10-runtime-dependency-implementation-notes.zh.md)。聚合入口拆分减少加载模块，但既有 bundle 已做 tree shaking，不能据此宣称显著冷启动加速。

## 历史 PID 锁测试迁移

原测试完整正文保存在 [基线测试归档](2026-11-10-plugin-store-pid-lock-tests.before.ts.txt)，来源是上述基线的 `test/platform/plugin-store.test.ts`，保留用于 Review 核对。

用户明确要求核对并完成 PID 机制退役；原测试中“PID 不存在、PID 复用或老空文件按年龄自动回收”属于本次明确删除的策略。缺少身份的活动 owner 与新鲜空文件原本就不允许抢占，这两项保护保留，并改为直接提示确认恢复。替代断言要求：无论 PID / 年龄如何，都保留未知旧锁；正确 token 加停止确认后才能清理；活动事务不能被清理；真实子进程退出后可重新获取新事务锁。不是把旧自动抢占策略失败改成跳过。

JSON Store 的正常并发串行化、异常释放、重复 nonce 保护、读取上限及原文件保存继续保留。平台条件跳过项仍按原平台条件保留，不能当作通过。原测试不在历史 badcase 清单中；新增行为登记到增量清单，Review 仍须核对迁移语义与归档。

## 验证记录

- Plugin Store、共享锁与 Classic state-config：36 通过，3 个原平台条件跳过。
- Native 定义选择与旧 v4 Shape 的 pending / unknown 恢复：20 通过。恢复保留 Run、原 Action、批准和已接受结果，下一步仍可领取 Builder。
- Source Supervisor 正常业务与双子任务中断集成：3 通过。新 v4 不再产生两种内部 Action。
- Classic 重复 coordination 与相邻任务 / 审查恢复：4 个定向测试通过；相同报告文件时间不变，缺失投影可恢复。
- TypeScript、架构检查、完整 build 已通过。构建同步 Classic、Native、Entry 发布 Runtime。
- 公开 Doctor 锁诊断 / 修复及 source + bundle 定向检查已补齐，结果见后续记录。
- 首轮全量未通过；失败分类及后续定向修正见下文。最终全量复验尚未完成，不能据此声明任务完成。

### 后续定向结果

- Doctor（source / 真实 CLI）、Native 错误类、Agent 检查和 Supervisor 业务入口：4 文件、28 项通过。
- 旧 v4 的 7 个兼容定义、Shape pending/unknown、高层 Shape source/bundle、Supervisor accepted-result pending/unknown：14 项通过。后两项复用真实双 Child 集成和 Parent 验收，在旧 Action 上恢复并完成一次真实 Git delivery；CRLF 差异按文件内容比较，保留两份实现的完整文字。
- `check:generated` 与受影响文件 Prettier 通过；lint 只有已有 Dashboard / DSH 警告，本任务新引入的无用类型 import 已清理。
- 锁迁移 Review 已写入依赖调查：原测试归档逐字节一致，读取边界原断言完整保留；一次独立探针的 16 个并发 Store 更新无丢失，异常后可重新获取锁。
- 插件 Hook 与集成定向验证：12 项通过。后续 Codex / DSH 打包、中英文短入口共 6 项选中测试通过；其余 14 项为该次名称筛选未选中，不代表新增平台跳过。生成 Hook 的完整 Rule 为 10,060 B，短入口为 1,067 B，约减少 89%；保留原 Rule 文件并继续拒绝跨 change 写入。
- 新增 6 个增量 case 的精确执行与必过名称核验：22 项通过，报告为 `coverage/runtime-cleanup-new-cases.json`，校验结果为 `coverage/runtime-cleanup-case-validation.log`。过滤未选中的测试不作为平台通过或失败计数。

### 其余锁测试迁移

构建夹具原文保存在 [构建测试归档](2026-11-10-cli-build-fixture-pid-lock-tests.before.ts.txt)。4 项旧 PID 模拟迁移到真实活动 SQLite 事务与明确停止确认；完整输出复用、缺少编译模块必须重建、成功但不完整必须拒绝的行为保留。原 `fs.open` 只读断言保留，并新增 SQLite 打开入口的 EROFS 拒绝与未调用断言，防止换锁实现后测试失去检出力。7 项通过。历史 `release-core-read-only-cli-build` 登记完全保留，其 CLI help 必过项另由全量验证覆盖，不能凭这 7 项宣称整个历史 case 通过。

Classic State 原文保存在 [状态锁测试归档](2026-11-10-classic-state-lock-tests.before.ts.txt)。原等待测试仍监听已经退役的 `fs.open(..., 'wx')`，无法收到信号而超时；现在观察真实 SQLite 锁入口。稳定读增加 0 次 writer-lock 断言，文件身份不可用时仍验证串行读；Run 已写、YAML 未提交时，reader 必须等待，释放 writer 后核对完整一致结果。测试名、实际写入、未完成等待和完整结果断言保留，31 项通过。Review 已确认三份归档逐字节一致、历史行为映射和增强断言。

构建锁的 SQLite 辅助文件会持久存在，`.gitignore` 仅增加 `.comet-test-build.lock*` 精确前缀；没有放宽架构白名单。生产 Classic 锁保存在用户级 Runtime 目录，不在真实 change 中新增 SQLite 文件。

### Windows 文件链接测试环境

首轮全量的 `classic-layout.test.ts` 在创建 `.comet/config.yaml` 文件符号链接时发生 `EPERM`，未运行到 `discoverClassicProject` 断言。定向原测试同样复现。沿用仓库已有 `requireFileSymlink` 能力探测，改用仓库已有的 `it.for` 注入 TestContext；原案例名称与拒绝悬空链接的断言保持不变，有能力的平台继续执行，本机明确报告跳过。目录 junction 反例继续执行。

该文件复验为 41 通过、1 跳过；不把跳过计为通过，也不声称已验证本机不具备的文件链接边界。没有修改系统权限或把链接替换成普通文件。其余文件的同类文件链接用例采用同一能力探测，原反例断言保留，目录 junction 测试继续执行。

真实模型 Eval、真实平台 Hook、npm 安装包认证未执行，本任务不将上述层级写成通过。频繁上下文压缩的用户现场尚无完整调用记录；CLI 与 Skill 的确定性重复内容可独立测量，优化效果不能代替模型现场证明。

## Classic 工具响应的发布包复现与修复

新增案例 `classic-compact-tool-response-history` 对应 `report:2026-11-10-comet-context-size`。隔离 HOME、所有 XDG/平台数据目录，公开 CLI 创建 full change，真实执行 Open、拒绝两份长 Design 提案，再提出当前提案。用户决定仅由此夹具模拟，不代表真实 change 的批准。

相同输入和断言在 npm `@rpamis/comet@0.5.2` 发布 tarball 上失败：默认 dispatch 仍含 `OLD_DESIGN_ONE`。当前分支通过：当前提案完整、批准身份一致、领取绑定实际接收会话、当前输入与完整 Action 对应；创建真实 Design Doc 后回报 succeeded，下一步进入 Design Evidence pending。程序 API、inspect、details 的完整 Run 均保留。

052 默认回复 208,201 B，当前回复 15,249 B，减少约 93%；测量按解析后的完整 JSON 再以同一 JSON.stringify 序列化计 UTF-8 字节，不含终端格式化空白，路径长度和版本定义造成少量差异。两份原始指标位于 `coverage/runtime-cleanup-052-compact-metrics.json` 与 `coverage/runtime-cleanup-053-compact-metrics.json`；旧失败报告 `runtime-cleanup-052-compact-red.json`，新公开续行报告 `runtime-cleanup-compact-continuation.json`，API 与 CLI 合并报告 `runtime-cleanup-compact-final.json` 为 54 通过、4 项原平台跳过。发布 tarball 只解压，没有运行安装脚本；其 node_modules junction 复用当前仓库依赖，因此不能当作 052 原生依赖安装认证。

这证明一条可复现的历史回灌缺陷，不证明原用户用了 Classic dispatch，也不证明已消除其全部压缩。没有实现全局输出截断、删除日志或新的上下文缓存。大检查日志继续落盘，失败原因和日志路径完整返回。

## 首轮全量失败与修正

首轮完整本地 Vitest：746 文件，723 通过、21 失败、2 跳过；9,354 项通过、52 失败、94 跳过，另有 2 个未处理错误，耗时 5,094 秒。报告 `coverage/runtime-cleanup-full.json` 保留，不以定向通过覆盖原失败。

- 35 项在本机创建文件 symlink 时 EPERM，未到产品断言；沿用已有能力探测，保留原测试及断言，有能力的平台继续执行。本机这部分明确跳过。8 文件定向为 180 通过、32 跳过，另有 Classic layout / project status / delivery 的对应复验。
- Project registry、Classic State、personal-memory 仍观察退役的独占文件/PID 锁。迁移到真实 SQLite 互斥、真实子进程退出与旧记录显式确认；保留原等待、完整结果、并发复核及拒绝覆盖断言。新的 SQLite 文件是持久锁协调文件，不推断历史进程。
- Memory 独立 Git 仓库因 SQLite 锁辅助文件出现未暂存变化；在本仓库自身 info/exclude 中追加两个精确锁前缀，保留原自定义规则和重复调用幂等。普通状态文件及无关文件不被忽略，不修改父仓库。
- Windows Native 超时时，若原 owner 长时间堵塞，命令仍可能在截止后继续执行。当前 supervisor 在截止时先停止自身仍持有的 command 子树，同时保持 supervisor 等待原 owner 确认，原进程停止与正常退出断言均保留。Native owner / termination 29 项通过。
- Classic composed cancellation 的 mock 仍指向聚合导出，而产品已用明确公开入口；仅改为观察真正调用入口，保留原阻塞、确认和取消断言。
- Native 完成历史恢复的旧断言与 HEAD 已有 closed 语义不一致；改为严格 closed，保留原 Run、完成结果、便携材料及恢复断言。Skill 两项契约改为现有同一 status 响应内的完整依赖、实际文件与无问题检查，同时保留逐文件更新检查；没有修改 Skill。
- 3 项 Supervisor revise 出现 dist 模块缺失，1 项隔离 CLI snapshot 超时。首轮期间我们继续编辑源码，CLI helper 因此重建共享 dist，干扰同轮测试。后续先完成 build，再冻结源码并复验。相同 Supervisor、隔离 snapshot 与契约定向已通过。

Project registry / Memory Git / cancellation 的最新相邻结果在 `runtime-cleanup-compact-and-locks.json`：两个相关文件全通过，新 CLI 测试当时因把对象 proposal 当字符串断言失败，随后改为同内容的 JSON 检查并补齐续行，全案已通过。snapshot / Skill 合并定向 14 项通过，名称筛选未选中项不计平台跳过。

最终检查：TypeScript 无错误；lint 无错误、9 个既有 Dashboard/DSH 警告；架构检查通过；badcase 登记与基线保留检查通过。最终全量复验待执行。所有来源和历史案例映射保留，新增 Case 必过名称另对真实执行报告逐项核对。

初期探索有 8 个仅属本任务临时项目的 Runtime namespace 写到真实用户数据根；正式版本对照已重做为完全隔离，未获取真实个人上下文正文。已用公开只读路径解析逐项重新证明临时项目与 namespace 的归属；清理命令被自动审批以 blocked by policy 拒绝，未执行删除，精确清单保存在 `coverage/runtime-cleanup-owned-audit-paths.json`。不触碰其他用户数据。

## 并发超时清理的实际回归与修正

首次全量之后的复验出现了新的可执行证据，而非理论并发边界：Native 原中断重试失败，Application 总超时提示“执行子进程尚未确认停止”，另一项清理/Stop用例等首次 unlink 到60秒。相同Application用例定向再次复现未确认停止。该轮已在已知失败后停止，保留 `runtime-cleanup-full-complete.log`，没有完整汇总；更早的复验因 personal-memory Git mock 未支持新增 --git-path 而停止，补齐mock后 Memory两文件85项通过。

真实临时进程对照共每种12次（3轮×4并发），立即清理7次unconfirmed；延后250ms仍1次，所以未采用延时碰运气。原始对照 `coverage/runtime-cleanup-timeout-comparison.json` 保留。新增正式并发回归在修正前也失败，`runtime-cleanup-concurrent-stop-red.json` 明确为 confirmed=false，原始timeout原因被“停止尚未确认”替代。

根因是 Windows supervisor 的 taskkill(command child /T) 与原调用方的 taskkill(supervisor /T)范围重叠，后者还会杀到前者新建的清理工具。当前实现只为实际自有监管器的 ChildProcess 对象登记准备回调：复用现有IPC，等待缓存的命令子树清理结束，再执行原来的整树确认。准备回执不是停止证明；整树taskkill仍须退出0，准备后再次检查原句柄是否退出。准备3秒、清理工具2秒界限保留故障收敛；普通ChildProcess与POSIX不进入该准备过程。不增加持久PID状态、公开参数、项目配置或Agent工具调用，不向业务领域散落新协议。

定向结果 `runtime-cleanup-stop-serialized.json`：46通过，覆盖新增并发回归、原owner堵塞截止时间、后代停止和未确认终止反例。`runtime-cleanup-stop-business-green.json`：原Native中断重试与Application两项业务用例共3项通过；81项是名称筛选未选中。独立只读Review确认准备有界、回执不代替停止证明、原断言保留，没有修改生产策略来按已退出PID推断成功。

新增 `owned-command-timeout-independent-deadline` 与 `owned-command-serialized-timeout-cleanup` 分别登记截止时间与停止确认两个独立行为。所有9个本任务新增case的29个精确选择器按3份真实已完成报告逐文件核对，未合成伪全量报告，结果为 `coverage/runtime-cleanup-case-validation-latest.log`。构建已重新完成；完整本地复验将以新的独立输出记录，并增加仅写失败详情的本地reporter，便于失败时立即取得原因，测试选择、并发数和断言不变。
