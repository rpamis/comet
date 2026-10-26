# 051 日常修改与低成本恢复

来源：`report:2026-10-25-low-cost-workflow-recovery`。

调查基线为 `97543295`；实施时工作区已有 Classic 修复，随后提交为 `060877b9`。保留该提交及原有 Dashboard、Eval 修改，在其上补齐本次行为。版本继续使用高于 `origin/master` 0.5.0 的 0.5.1。

当前尚不能声明 051 达标。核心恢复入口已补齐，下面列的是代码路径与约束；当前候选的模型审批行为、恢复开销、全部必需 badcase、最终安装包及正式发布矩阵仍须分别通过。用户已确认 Native 中文规则，英文已同步并通过相关契约检查。

用户在 2026-10-26 明确取消本轮完整16组模型矩阵，改为 Native、Classic 各自最高难度任务的三次独立验收。本轮按每项3/3全部通过执行，不能用三次中一次通过替代；六个样本保留原业务、审批、安全、冷恢复、一次性副作用和效率断言。确定性 badcase 回归、未被两个任务覆盖的已复现问题验收，以及最终安装包验收继续保留。完整16组入口和历史记录仍在，以下关于它的旧计划不再是本轮必做项。命令及凭证边界见 `eval/local/RELEASE_GATE.md`。

## 已实现的恢复路径与边界

| 用户操作                                             | 恢复行为                                                                            | 保留内容与限制                                                       |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Native Builder 尚未领取时修改正式要求                | 按当前 continuation 修订 Shape，撤销未执行的旧 Builder，再批准当前要求              | 同一 Run、文档和部分实现；旧修订哈希不能再次推进                     |
| Classic 在 Verify 或归档执行前修改设计、任务或计划   | 诊断返回可执行的 `revise-design` 或 `revise-plan`                                   | 已实现代码、任务完成事实、配置和历史；新要求仍需新批准               |
| Classic tweak/hotfix 在 Verify 修改范围              | `continue-build` 返回原 Build，再通过范围提案确认当前要求                           | 不重新 Open，不升级或重建同名需求                                    |
| Classic Archive 已完成后才发现可清理生成物被当成输入 | `repair-delivery` 绑定原检查实际重跑，再确认新交付范围                              | 同一归档 Run；不重放 Archive、不强迫提交缓存；源码与原检查身份仍固定 |
| Native 归档前修改实现                                | 原预检记录候选漂移，恢复输出直接给出 `revise-implementation`                        | Shape 批准与原检查保留；后继候选重新独立验收，不重复历史一次性检查   |
| 分支切换或重命名                                     | Classic `state rebind`；Native `select --rebind`                                    | 同一 Run 和执行历史；先结束原领取，拒绝 detached HEAD 和错误工作区   |
| 已领取的 Skill 中途退出                              | 原领取提交真实失败，再使用 `continue-build` 或 `continue-work`                      | 原失败与部分产物保留，新执行只补缺失工作；未知结果不能声明为未执行   |
| 普通入口恢复                                         | `state next`、`state check --recover` 及 Native continuation 呈现当前漂移和恢复命令 | 查询不推进状态；正式确认与外部执行由原 Runtime 执行                  |

Native 分支变化后允许原领取结束、记录停止事实或取消；接管前不能领取新执行，避免“必须先结束才能接管，但分支校验又禁止结束”的互相等待。已准备集成工作区的 Supervisor 仍保持原目标绑定，使用原分支或现有迁移入口，不改写已登记集成事实。

Classic 归档副作用已完成但尚未交付时，切回原绑定分支继续交付，不重绑已归档 Run。已完成 Run 在产物内容不变的分支上查询仍保持完成，不产生分支恢复动作。Git 切换同时恢复旧版本机器状态文件时，仍拒绝将这些旧文件覆盖到当前 Runtime；先切回原分支核对。

Classic 的确定性续行器只核对原失败并安排同一阶段的后续工作，在内存暂存后通过一次 CAS 发布；不调用外部 Skill、不修改用户代码，不重放原副作用。固定旧定义保持可识别，显式续行时升级已核验的内置定义并保留原执行来源。

## 恢复代价

- 排版、辅助说明与正式要求按现有语义规则区分；不按扩展名跳过编辑审查。
- 实现修改保留批准的需求；正式要求变化只重开相应确认和受影响的后续验证。
- 保留已完成任务、有效检查的原始收据和来源。任意命令缺少完整输入证明时仍重新执行必要检查，不承诺跳过受代码变化影响的测试。
- 已完成检查或归档的副作用不重复执行。记录缺失、外部结果未知、权限或 Git 冲突仍须先核对原事实，不能补造成功证据。
- 用户不需要删除 change、手改机器状态或重新初始化流程。只有当前范围、分支归属或停止事实无法确定时，才请求对应决定。

## 回归与证据

`config/workflow-regressions.json` 按独立行为登记 Native 未领取任务修订、热/冷分支接管、原执行停止后接管、Classic 后期设计/计划修订、Builder/设计/计划中断、预设范围修订及 Native 归档前实现返修。

初始隔离探针和定向失败日志保存在本机忽略目录 `node_modules/.cache/recovery-051-fix/`；它们不是发布资产，也不是模型通过证明。新增用例先执行旧行为取得失败，再实现修复；保留历史测试和原断言。Native 归档返修用例执行生成命令 bundle，并验证后继候选独立验收、最终归档与历史一次性检查仅执行一次。

本轮验收分别记录源码/Runtime、生成 bundle、安装包和真实模型结果。组合验证覆盖改文档、返回 Build、保留任务、重开确认，及切分支后结束原执行再接管。确定性测试通过不能替代模型、平台 Hook 或完整发布验收。

定向验证已取得以下结果：

- Native 要求修订、分支接管和原领取结束：13/13 通过。
- Classic 后期修订与中断续行：登记选择器执行的 7/7 通过；独立的设计/计划/Builder 中断探针 3/3 通过。
- Classic 归档计划与 tweak/hotfix 范围变化：3/3 通过；相邻的修订计划交付、移动和冷恢复归档 8/8 通过。
- Native 生成 CLI 的归档返修与分支组合：2/2 通过，最终归档且历史一次性检查只运行一次。
- Native 历史阻塞恢复分组：3 个测试文件、39/39 通过，覆盖原候选、一次性检查、旧版本恢复、Supervisor 与新增组合场景。
- Runtime 转换、CLI 帮助和定义选择契约：57/57 通过。
- 原有 Classic I/O 次数限制曾失败，合并任务文档重复读取、收敛设计与计划重复检查后，原断言通过；该测试的次数与超时上限未提高。
- 归档后切分支的投影边界先复现为非法 `rebind` 提示，再通过同一生命周期用例验证：待交付时切回原分支，完成后保持完成，查询不推进 revision。

扩大回归首次出现 4 个 Classic 长流程超时，其中 3 个清理时还遇到目录占用。修复重复读取后，第二轮为 23 个通过、3 个超时，I/O 次数用例通过。原日志与 JSON 均保留。对 `060877b9` 的同一 generated 归档用例进行独立对照，全部断言通过，测试主体耗时约 135 秒，超过原 120 秒预算。因此只对 Windows full 的完整归档与生命周期用例使用 180 秒有界预算，保留全部行为、I/O 与安全断言。3 个超时项分别以约 112、132、112 秒通过复验；未将第二轮整组命令改记为一次通过。

最新 tar 包包含 3542 个文件，SHA-256 为 `8ce315db86c291715fb23536ca8abc9eb37a4dcd2da0bd48919d00ff6a67348c`。包内未检出本轮 CC Switch 授权值。在隔离目录安装后，通过实际子进程 CLI 验证 Native 分支接管及未领取 Builder 的要求修订，以及 Classic 中断 Builder 续行和 Verify 后设计修订。

## 真实模型 Eval

用户授权本轮 Classic 固定 treatment 的依赖，仅在隔离 Eval 容器使用。CC Switch 当前 Claude 配置 `Zhipu GLM` 的 `glm-5.3-flash` 已通过最小 HTTP 请求核对，响应模型一致；凭据仅在当前进程与容器环境中使用，不写入本文件、固定候选、任务、报告或归档。

2026-10-25 22:07（北京时间）已在同一固定候选上各启动一次。候选提交为 `556d696a9c789d393abc3e2005bd33af65d49279`，源码摘要为 `c1c5f5d1cebee7fc2d7b944bc429b06812c799fafdc97901fc50e4f4cda0608d`。

启动后补充的 Classic 重复读取优化与归档后分支提示修复不在这份固定快照中；分别报告其确定性验证与固定快照的模型结果，不能把模型结果声明为后补变更对应二进制的验收。

| Workflow | 固定任务                     | 必须核验                                                        | 当前结果         |
| -------- | ---------------------------- | --------------------------------------------------------------- | ---------------- |
| Native   | `comet-native-sdk-recovery`  | 原候选与一次性检查、跨会话恢复、独立 Verifier、真实 Archive     | 正式失败，见下文 |
| Classic  | `comet-classic-sdk-recovery` | full/tweak/hotfix 三个 Run 的归档和本地交付、保留 parked change | 正式失败，见下文 |

实验 ID：`recovery051_native_20261025_220723`、`recovery051_classic_20261025_220723`。

每例保留实际模型、输入与产物摘要、原实验 ID、退出码、任务检查和评分。失败不覆盖，修复后另建实验。两个最高难度样本用于发现流程问题，不替代完整发布矩阵或真实平台 Hook 验收。

### Native 本轮发现

正式报告为失败，Agent 退出码为 0，基础检查 7/8 通过；首个失败是 `assert_recovery:105`。模型实际使用 `glm-5.3-flash`，约 3228 秒、199 个内部 turn、260 次工具调用；这些是整例开销，不能当作单独恢复耗时。Judge 未返回有效评分，报告中的自动 rubric 数值不作为 Judge 结论。

独立问题分别记录如下，均未修改原实验、校验器或产物来生成通过结果：

1. `eval:recovery051_native_20261025_220723:check-name-id`：任务要求检查名称为 `recovery-once`，计划的 `name` 正确、实际 `id` 为 `check-recovery-once`，`repeatable` 为 false，原收据通过，计数器为 `once\n`。校验器却按固定 id 查找，存在名称与身份误配。应核对唯一名称，再用该计划的真实 id 严格绑定收据，并保留执行、输入、一次性与独立验收的全部断言；正式结果仍保留失败。
2. `eval:recovery051_native_20261025_220723:brief-plan-placement`：任务明确要求测试计划表位于 brief，实际表与数字行号位于 Spec，brief 缺少该表。独立只读诊断仅调整前述名称查找后，仍在 `assert_recovery:127` 失败。这是模型执行的产物落点偏差，未解决，不能将整例归为单纯的校验假阴性。
3. 原校验器在首个失败处停止，后续冷恢复边界断言未执行完。清理后 SDK volume 已移除，portable checkpoint 会规范化 revision 与 claim token，不能替代原权威 Run 复核边界哈希。独立诊断将该部分标记为未检查；后续应将独立行为分开验收，并由控制器保留权威只读 Run 快照及摘要。

Native 的 14 个 Runtime bundle、Native CLI bundle 与 CLI 入口已与固定 Eval 快照逐字节比较，均一致。其正式失败与上述限制仍适用于本轮 Native 验收。

### Classic 本轮发现

正式报告为失败，Agent 退出码为 0，基础检查 4/6 通过；tweak 与 hotfix 均报 `parked change did not coexist during verification`。实际模型仍为 `glm-5.3-flash`，整例约 4876 秒、501 个内部 turn、409 次工具调用，自动用户交互达到 18 轮上限。Judge 未返回有效评分。以下行为分别记录，不能用最终目录仍存在替代历史共存证据，也不能用检查清单缺项推断文件被移走。

1. `eval:recovery051_classic_20261025_220723:scoped-parked-observation`：后两条流程使用已有的 v2 检查策略，仅声明 `wordcount.py`、`test_wordcount.py` 为输入，并声明 Python 缓存目录为输出。校验器却要求未声明的 parked proposal 必须位于该命令的输入清单中。独立只读对照已复现：parked 文件前后均存在、SHA-256 相同，但合法的声明输入清单不包含它。这是明确的错误推断路径，不能据此断言并存需求被删除。正式实验仍保留失败；应由独立的控制器共存观测证明该要求，而不是扩张检查输入或降低文件保护断言。
2. `eval:recovery051_classic_20261025_220723:late-check-output-recovery`：首条流程没有提前声明 pytest 输出，检查收据包含字节码；删除缓存后交付被输入保护阻止，模型最终在 `2434e1dc660f39b3aee24ca58f602e78b2687e5c` 的 full 交付提交中包含了两个 `__pycache__/*.pyc`。后继流程增加现有检查策略，并重做过本轮提交。原 Runtime 的保守输入保护没有被绕过，但实际处理成本和交付内容仍不理想。需要单独设计归档副作用已完成后的检查/交付修复：保留原归档和业务批准，仅对受影响输入重新验证并确认交付范围，避免以提交缓存或手改机器状态解决问题。本轮未实现该补充路径。
3. `eval:recovery051_classic_20261025_220723:terminal-controller-loop`：只读 SDK 查询确认三个 Run 均 completed，`archive.deliver` 均 succeeded（revision 分别为 39、24、24）。原轨迹随后仍多次重复查询 parked Run 和 Git 状态，直到自动用户交互耗尽。parked 本身保持 Open 且未被推进。需要让 Eval 在所有指定 Run 与交付事实完成后停止，避免继续要求处理被明确排除的需求；这段开销不能直接归因于产品恢复耗时。

最新安装包与两个实验归档均扫描了本轮授权值，未发现凭据泄漏。所有原始失败、JUnit 与报告均保留；未改写历史校验器，也未将独立诊断写成正式通过。

### 后续闭环条件

- 修复 Eval 名称与身份的误配时补充唯一名称、错误收据和重复计划的反例，按历史案例维护规则审查，不能降低已有恢复断言。
- 为用户指定的文档路径和必要结构保留明确的验收事实；跨会话续行和最终验收都要核对，避免业务功能通过但交付位置要求遗漏。本例 brief 落点问题仍需回归和新实验验证。
- 补齐 Classic 已完成归档后的检查/交付修复路径，并明确命令生成物的输入/输出声明时机；验证不重放归档、不丢用户修改、不强迫提交缓存，也不接受未经验证的新实现。
- 修复声明范围检查的共存误判，并由控制器分别保存权威 Run、实际共存观测和检查清单；指定任务全部完成后停止自动续行。
- 低成本验收还需分别记录恢复阶段的耗时、工具调用及重复工作，区分必要的新确认/检查与多余操作。本轮只有整例开销，不能据此宣称所有日常操作已经实现低成本恢复。

本轮未运行仓库全量测试、独立真实平台 Hook 验收或完整发布矩阵；未执行提交、推送、PR 或网站修改。六项修复和两轮指定 Eval 已完成，以上新增发现仍待闭环，不能把本轮结果表述为 051 全面达标。

## 2026-10-26 发布闭环进度

来源：`report:2026-10-26-051-release-closure`。继续使用原失败实验作为依据，不覆盖原结果。当前版本仍未达到正式发布条件。

本轮已实现以下 Eval 修正：

- 一次性检查按唯一 `name` 选计划，再严格绑定原 `id`、命令、目录、不可重复属性和唯一成功收据；补充同名、重复 ID、错收据等反例。
- 产物收集只读取和脱敏复制文件，删除收集阶段自动执行根目录 Python 文件的行为，避免正式验证后重复一次性副作用。
- Native 产物断言失败后继续执行冷恢复边界断言，汇总独立错误。可信校验器返回权威 Run 的原摘要及各 Action 的原 `outcomeHash`，供清理后复核；持久化 Run 先结构化脱敏，再记录源摘要、留存摘要和脱敏标志，不把脱敏后的正文当作原始字节。
- Classic 声明范围输入时，通过分发前固定的辅助脚本、原 Runtime 输入清单和执行日志证明 parked proposal 在检查前后共存。完整输入清单的原证明继续保留；最终 parked 的内容、阶段、未提交和交付范围保护仍全部执行。
- 多 Run 任务使用固定清单查询真实 owner、SDK Run 和归档 checkpoint，所有指定根 Run 均完成且 `archive.deliver` 成功才结束自动续行。查询失败不回退到模型完成文案，不查询或推进未列入清单的 parked Run。

本地 Standards / Spec 分别审查发现并修正了辅助脚本的工作区模块注入、PATH 解释器冒名、结构化凭据脱敏遗漏，以及任务指令与完整清单分支不一致的问题。观测命令固定为 `/usr/bin/python3 -I verify_coexistence.py`，其 pytest 子进程同样隔离导入；本地模块和 `PYTHONPATH` 注入反例保持失败。原检查与文件保护断言没有删除。

当前实际证据保存在忽略目录 `node_modules/.cache/recovery-051-release/`：

- 8 个登记的 Eval 闭环 Vitest wrapper 通过，日志 `eval-closure-wrappers-final.log`。其余测试未被本轮选择，不计入通过数。
- Python 定向检查一轮为 236 通过、3 跳过、2 未选择；跳过项不计发布覆盖，日志 `eval-slices-portable-final.log`。Windows 上另外两个 Native 脚本化用例曾在检查进程终止确认处失败，现场及日志保留。
- 在隔离 Linux 容器使用当前 build 和实际 CLI，Native 普通命令及固定 PATH 两种完整恢复到归档均通过，日志 `native-cli-linux-equipped.log`。容器补装了当前任务清单中的三个精确依赖；这不是模型 Eval。
- 凭据脱敏相邻用例 34/34 通过，包含原 portable claim 摘要例外，日志 `redaction-adjacent-final.log`。
- Classic 公开 CLI 三种流程和安全反例一轮 11 通过、1 失败；该失败来自离线路径适配器把 Windows 磁盘路径直接用于 ESM import。修正为文件 URL 后原单项复验通过，日志 `classic-checkpoint-adapter-final.log`；前一轮失败不改记为整轮通过。
- Ruff 检查通过，登记基线保留检查通过；它们只证明对应静态约束。

产品层仍须完成 Classic 已归档、尚未交付时的检查输出修复。现有 `reopen-verification` 明确只支持归档副作用前，不能据此宣布归档后的恢复已有入口。补充入口必须沿用同一 SDK Run，保留原归档和批准历史，拒绝未解决的领取、陈旧 revision 和归档内容漂移；重新验证受影响输入并确认新交付范围后才能交付，不能重放 OpenSpec 或强迫提交缓存。尤其要处理不可变归档 checkpoint 与后续修复的绑定，不能简单放宽 checkpoint 一致性检查。

该产品行为已新增公开 CLI 回归 `Classic candidate revisions repairs late declared check outputs after Archive without replaying Archive or committing generated files`，首先在旧行为取得失败：归档完成、保留原检查收据、删除生成物并补声明输出后，`repair-delivery` 仍是未知命令，日志 `delivery-repair-red.log`。测试还要求新的检查与明确批准、保留原历史、只执行一次 OpenSpec，以及最终提交不含生成物；实现及安全反例尚待完成，未登记为已修复。

Native 中文产物位置规则已准备，英文仍等待用户确认后同步。以上变更尚未形成最终冻结候选，也未执行新的正式模型矩阵、提交、推送或发布；所有附加模型验收维持 pending。

### Classic 交付修复的定向证据

已实现归档后 `repair-delivery` 和 `decide-delivery-repair`：沿用原 Run 和原命令，只调整已声明生成物的交付范围；再次执行检查并取得新批准后安排交付，不重复 Archive。输出必须在检查前缺失、由原命令实际生成；原配置、全部实现输入、已归档文档和交付目标继续严格绑定。当前仍未构建生成 bundle，不能据此宣称发布包已验证。

原公开 CLI 回归先取得未知命令失败，再通过完整交付；审查发现的错误排除源码、漏检原基线中未改动文件，以及读取权威 Run 后 checkpoint 被修改，分别保留相同输入的 red→green 日志：`delivery-output-source-*`、`delivery-baseline-input-drift-*`、`delivery-checkpoint-read-race-*`。

交付 Skill 失败续行的关联保留回归通过，日志 `delivery-skill-continuation-complete-green.log`。新增的摘要和普通交付续行两项先失败、修改后均通过，日志 `delivery-context-red.log` / `delivery-context-green.log`（2/2）。checkpoint 相邻检查 18/18 通过，包含此前失败交付的全局输出只允许原序号、原内容和原失败历史，日志 `delivery-checkpoint-history.log`。

审查另发现未修订新 Run 的首次交付续行会在定义升级后错误核对旧 checkpoint。已在公开 CLI 取得相同失败，日志 `delivery-first-continuation-red.log`；当前修复改为先严格核对暂存升级与原权威 Run 一致，再用原 Run 校验旧 checkpoint，复验尚在执行。新检查失败后的再修复、检查回执丢失恢复及最终发布包和模型验证仍待完成。

2026-10-26 最小模型请求返回 HTTP 200、响应模型 `glm-5.3-flash`，仅证明账号此时可用。Classic Eval 依赖使用授权已收到，仅用于本轮隔离容器。

上述读取竞态负例先通过公开 CLI 准备真实归档 Run，再在保存该 Run 后替换 checkpoint，并直接调用证明捕获函数验证拒绝；它属于 Runtime 边界，不把该并发窗口表述为纯公开 CLI 复现。其合法恢复和最终交付仍通过公开 CLI 验证。

交付修复回归扩展后 1/1 通过（113 秒），日志 `delivery-repair-interruptions.log`：检查尚未领取时重选范围、执行中拒绝重开、真实退出 9 后再检查、命令完成但回传丢失时补录原结果，以及确认前修改输出声明后旧批准失效。计数器证明补录没有再执行命令，归档仍只执行一次，变化后再次清除的缓存未进入提交。此后追加的 unknown 反例正在随受影响文件回归，尚未记为通过。

lint 首次检查发现四条 Runtime 循环依赖，已将纯 Run 关系解析、文件证据核验、流程装配及原实现输入过滤分开；架构登记和项目结构说明同步补充。拆分后类型与架构检查通过，生成物和运行行为仍需重新构建、复验。另将本轮检查产生的根目录 `.ruff_cache` 移至忽略的任务缓存目录，保留内容，不作为产品目录登记。

### 最新构建、安装与模型重跑

- 拆分后 `pnpm build`、`pnpm check:generated`、`pnpm lint` 通过；lint 保留 8 条既有警告。两路静态 Review 未发现新增状态或授权缺陷。checkpoint 读取竞态的覆盖层级已按 Review 校正为 Runtime，断言未改。
- 受影响文件一轮 45 通过、1 失败，日志 `classic-revisions-and-checkpoint.log`。失败为原有计划暂停断言：Build 内 `revise-plan` 将 `buildPause: plan-ready` 清空。最小修正只在 Build 内计划修订时保留原选择，原两项复验通过，日志 `classic-plan-pause-recheck.log`；不把原整轮改记为通过。追加独立登记 `classic-plan-revision-pause-preservation`。
- 安装包 `ed4972d0b84795b3548935f177e02af892beddd408f7d0d57853dac1253463e7` 首轮探针漏做项目忽略规则准备，误提交运行锁文件，被交付 Guard 正确拒绝；原失败保留在 `installed-delivery-smoke.log`。按源码 fixture 和项目初始化使用相同忽略规则后，完整交付恢复通过，日志 `installed-delivery-smoke-prepared.log`：真实检查 5 次、Archive 1 次、unknown 原结果补记不重跑、缓存未提交。OpenSpec 使用明确的目录搬迁替身，不作为真实 OpenSpec 依赖验收。
- 计划暂停同一探针在旧安装包取得实际失败（`installed-plan-pause-red.log`），更新包后通过（`installed-plan-pause-green.log`）。新包 SHA-256 为 `a2fc9d9fff2b736cf3bde00c046c74d49c1727d87591b6dd6daefb65128638fc`，3559 个文件，实际模型凭据匹配 0；旧 tar 和审计记录按原摘要保留。启用运行守护进程的最终交付探针仍在执行。
- Classic 诊断快照保存在忽略目录，独立提交 `9c3662dd632631352a935ab081e6b14179a6d759`，产品内容摘要 `7c6a4c5f6f2dd1ea13cfb07671ee0f59c81c853ea1650103a22130ca50bafbd9`，3909 个文件。没有提交或切换用户的 `051` 工作区。
- 实验 `recovery051_classic_20261026_030844` 已实际启动，模型 `glm-5.3-flash`、固定 treatment `COMET_CLASSIC_DOCS_LAYOUT`，包括本轮获授权的隔离依赖。它是新修复的最高难度诊断，不能代替全部 16 组发布矩阵或 Native 验收。
- 当前发布登记共 139 组核心回归，涉及 142 个测试文件，已启动唯一一轮串行检查，日志 `core-regressions-current.log`；旧报告先复制保留。尚未取得最终结果，不等于仓库全量测试。

新安装包完整交付、全部核心回归、Native 英文同步及新的真实模型验收仍须收集；正式矩阵、发布凭证、推送和发布均未完成。所有未完成附加验收仍保持 pending。

### 04:40 后续核对

最终安装包的 full 守护进程、自包含 bundle、tweak 和 hotfix 交付修复均已通过，分别保留在 `installed-delivery-final.log`、`installed-bundle-delivery.log`、`installed-tweak-delivery-prepared.log`、`installed-hotfix-delivery-prepared.log`。这些安装探针的 OpenSpec 目录搬迁仍是明确的替身，不替代真实依赖验证。

Classic 实验 `recovery051_classic_20261026_030844` 的 pytest 退出 0，业务断言 15/15；实际为 367 turns、276 tools、3735 秒，不能按效率通过。原始 stderr 显示完成探针从分离挂载的 `/opt/python/validation` 导入时触发包初始化，引用不存在的 `scaffold`，导致三个已完成 Run 仍被反复催促至 18 次交互。业务结果与控制器失败均保留。

完成探针已改为隔离 Python 搜索路径，直接加载固定只读脚本；加载或查询基础设施失败返回 2，控制器立即失败退出，正常未完成及 owner/checkpoint 不匹配仍返回 1。新增五项用例在旧代码失败、修复后通过；原三项禁止文案回退仍通过。进一步审查复现并修正了执行器缺失、权限、超时和子进程失败被吞成未完成的问题，相关九项复验通过。新案例 `eval-requested-run-probe-standalone-bootstrap` 与 `eval-completion-probe-failure-stops-controller` 分开登记。新 Classic 困难诊断 `recovery051_classic_20261026_043339` 正在运行；其产品快照未变，控制器修正不代表正式矩阵已通过。

核心回归的前两处失败均为 Windows 的短命子进程先自行退出，随后 `taskkill` 无法确认停止；生产停止证据没有放宽。仅将预期超时的测试进程寿命从 200 毫秒改为 20 秒，保留 25 毫秒超时和退出码 124 断言；原项目检查两项、组合应用三项和平台停止安全七项复验通过。两路 Review 均确认原约束保留。四个核心组已通过；第五组一轮 74 通过、1 失败，失败发生在 Windows 创建文件符号链接时的 EPERM，尚未运行到产品断言。原用例保留，另准备 Linux 执行环境；其余组继续串行运行，不把失败或未执行项计为通过。

另准备固定的归档后生成物修复模型场景，强制原 Build/Verify 包含该生成物，Archive 后才声明输出，要求同一 Run 新检查、新批准及最终交付。校验器绑定每次原 Runtime manifest、日志、固定脚本与源码字节和连续执行计数，并核对整个 Git 历史从未提交缓存。它补充真实模型覆盖，不替代 16 组正式矩阵；目前正在用真实 OpenSpec 和 CLI 验证该场景校验器，尚未启动其付费模型运行。

### 05:20 当前结果与限制

- Linux 原始链接用例通过：`core-linux-linked-regressions.log` 两组 117 项，包含 Windows EPERM 处尚未运行到的交付清单与 Hook 链接断言。之后的核心组串行续跑；CLI help 的构建准备曾因只读挂载 dist 无法重建而失败，39 项未执行，不计通过。现改为隔离副本中的可写 dist 并实际构建，从失败组继续，日志 `core-linux-writable-dist.log`。没有修改产品断言。
- 新 npm 包 SHA-256 `2613e923dcaea0cfe09a416d8b309007e074326ccc88aba3cc83510c70edbb2a`，3559 个文件，本轮提供商凭据匹配 0；三个完成探针文件与当前源码逐字节一致。`package-controller-fixed/installed-linux-proof.log` 直接解压此包，使用真实 OpenSpec 完成同 Run 交付修复、三项校验器反例，以及真实完成 Run 返回 0、缺失 Run 加完成文案仍返回 1 的探针验收。Runtime 检查 3 次、Archive 1 次；持久执行数据和工作区分别留在本轮专用 Docker volume 中，不写入包。
- 归档后修复的固定附加场景先通过真实 CLI 与 OpenSpec 的完整离线驱动，日志 `aux-offline-validation-v4.log`；模型实验 `recovery051_classic_output_20261026_044416` 已启动，尚待结果。任务定义独立保存在忽略目录，提交 `8c14add4d2884c1d93d81f3357f8f5751f6b8b73`；不改变正式 16 组矩阵。
- Classic 困难诊断 `recovery051_classic_20261026_043339` 的 pytest 退出 0、17/17 检查通过，三条 Run 均完成并交付；原 stderr 明确记录控制器在 1/18 次外层交互后识别完成，没有再次催促。根据原事件文件和当前评分函数计算，效率仍为 0：211 turns、193 tools、2364 秒。派生结果及原报告、事件摘要保存在 `classic-bootstrap-fixed-derived-quality.json`，这项低分继续阻塞发版，不能用业务通过替代。
- 核对启动器发现，它将 CC Switch 主模型的 `[1M]` 上下文选项、子 Agent 和默认模型映射统一覆盖成 flash。上述三轮属于统一 flash 的诊断，不能冒充原配置验收。后续启动器已保留配置中的主模型、`CLAUDE_CODE_SUBAGENT_MODEL` 和各默认模型映射，仅读取并提供进程环境，不修改 CC Switch。审计为 `diagnostic-model-mapping-audit.json`。按原配置的 Classic 低难度实验 `recovery051_classic_easy_20261026_051746` 已启动。
- 9 项安装包附加验收已依据真实证据改为 verified，原证据保留追加；16 项模型附加验收仍为 pending。Native 中文确认项仍未收到答复，已重新展示；英文没有提前修改。正式候选冻结、完整发布矩阵、发布凭证、提交、推送和发布均未完成。

### 06:35 新发现与当前修正

- 困难诊断与归档后输出修复实验分别取得 17/17、10/10 业务检查通过，但原交互均没有实际用户回复，模型自行批准了两个新提案。原结果不改写，也不计为审批行为通过。`original-proposal-approval-replay.json` 绑定原事件文件摘要，数量底线回放能拒绝两例；它不能证明逐条回复与提案的语义对应。
- Classic Runtime 的 Design/交付范围交接已明确区分目标授权与新提案批准，并提示只补缺失任务记录、使用完整 Git HEAD 和当前终态回执。五项新增交接断言在冻结旧源码失败、当前源码通过。全新 Classic 固定任务显式启用 `require_classic_proposal_interaction`；预批准恢复任务默认关闭，避免重复索取历史批准。低、中难度校验器现在保留原 SDK Run，后续终态检查失败仍导出同一次查询的证据；四个反例先失败后通过，相关 Python 文件合计 71 通过、2 跳过。该组审查通过，真实模型重跑仍待完成。
- 原 CC Switch 映射下的低难度实验 `recovery051_classic_easy_20261026_051746` 已完成，11/11 业务检查通过，174 turns、约 1989 秒。该实验早于上述交接和证据导出修正，没有留存可信 SDK 查询，不能用其两次回复证明全部新提案批准，也不是当前候选的发布证据。
- 核心回归继续到 Native SDK 应用组时，原 Git 开销断言失败：`next` 为 source 42 / bundle 41，Archive 为 49 / 48，预算分别仍为 40 / 46。实际调用栈确认重复读取；当前去掉同次完整 status 已包含的 untracked 查询，并将快速观察的 HEAD、branch 和 status 合并读取，仍保留索引、文件字节、子仓前后复查及写入前的新鲜身份校验。上一轮公开 source/bundle 预算与取消后冷恢复均通过，但平台等价测试又检出 Linux Git 的小写 `(null)` 标记；已修正并继续复验，不能将上一轮整体计为通过。
- 新状态解析的 Review 还复现了单字符 dirty 文件被裁剪状态文本导致快照不完整的回归。修正前的同一真实 Git 用例失败，原日志 `native-single-character-status-red.log` 保留；当前解析使用完整原文，历史指纹字段继续保留原 trim 结果。新增案例与特殊分支、冲突、子模块、排除路径及特殊文件名的等价断言分别登记，当前复验进行中。
- Owner 中断案例的 10 秒启动等待包含源码加载，实际单次冷加载已约 9.7 秒。仅把测试的启动等待改为 30 秒；真实检查时长、停止证据和不重复副作用断言均保留，两个 Review 确认为等价准备修正，原案例已通过。没有上调产品执行超时或 Git 调用预算。

截至本节，正式候选尚未冻结；旧 npm 包只证明其各自快照。当前全部模型附加验收、完整发布矩阵和最终包验收仍需在一致候选上闭环。Native 中文规则确认仍待用户答复，英文未提前同步；没有提交、推送、发布或修改网站。

### 07:16 审批诊断与后续验证

原配置诊断 `recovery051_classic_output_20261026_064026` 使用快照 `c7b4237a99e59f320057b3244eed78ada745dca4`。在实际决策回复仍为零时，原 Run 的 `full.open.confirm` 与 `full.design.confirm` 已批准。只读审查分别确认两个独立失败：初始任务不批准尚未生成并展示的 Open 产物，也不批准后来形成的 Design 提案。Archive 尚未执行，不把它登记为这轮实际观察到的失败。

已在 `model-aux-output-approval-v2/early-failure/` 保留真实 SDK 查询、原文摘要、脱敏后摘要、原始脱敏 stdout/stderr 和停止原因，再停止这个已经违反审批要求的样本。最终 pytest 失败，Agent 退出 137，约 1209 秒；这是明确早停的行为失败，不作为环境噪声排除，也不改写为完成。

轨迹显示 Agent 过滤命令输出，只展示 `data.nextAction` 等字段，丢弃 `continuation.instruction`；随后用任务已给定具体内容作为自行批准的理由。当前修正让 Design/交付 decision 的 `nextAction` 与 continuation 共用确认说明；有效 full Open 预览也把同一提示附到 `nextAction.instruction`。原 kind、Action、输入和提案哈希保持不变；已有同一未变提案或产物的真实确认继续复用，不增加前置命名或摘要确认。原两个 Design/Delivery 断言及命令输出断言先失败，扩大为 31 项后通过；Open 的两个断言与数量底线也先失败，修正后 32 项投影及命令检查通过。相关 Python 文件为 71 通过、2 跳过。Open 单独登记为 `classic-open-preview-user-approval-guidance`，真实模型仍待重跑。

这些是指导和检出能力修正，不能保证模型遵循，也不能用批准记录倒推实际用户回复。正式验收仍需审查“展示当前提案、收到对应回复、记录决定”的顺序。fresh 任务数量底线现在包括 Open、Design 和新交付范围；预批准恢复任务仍默认关闭该额外要求。

核心回归已通过此前失败的 Native SDK 应用组 29 项及 Classic 后期修订组 10 项。之后的 OpenSpec 独立目录用例只因精确预期遗漏当前 HEAD 已有的 `executionCompleted: true` 字段失败；Review 确认为保留原覆盖并强化既有契约。仅补充两处字段，原输出、退出码、参数和目录断言均保留，20 项完整文件测试通过，再从该组续跑。当前 Linux 回归副本尚未包含本节最新提示变更，因此其结果只证明该固定副本；最终发布仍须对一致候选重新执行。

隔离 Linux 发布执行环境已准备，Docker CLI 固定到所下载镜像摘要；跨容器的只读源码挂载探针实际读取到 0.5.1。它解决后续发布 runner 的路径准备，不代表正式矩阵已运行。Native 中文规则仍待用户确认后同步英文，最终候选、模型矩阵、最终 npm 包、提交与发布均未完成。

### 用户确认后的同候选验收

用户已确认 Native 中文产物约束并授权同步英文；两个语言版本现已同步，7 项 Skill 契约通过。英文新增契约先失败后通过，相关文件 Prettier 通过，0.5.1 Changelog 追加用户可见的产物要求；master/tag 仍为 0.5.0，没有再升一个版本。

包含双语规则与最新 Classic 提示的诊断快照为 `1ea1365795cd4bc8125f50024774d760b491e1e0`，源码摘要 `40c661989b308b7e678fee767b76d0678e6bdb8703fd304322005ca09087efea`，3909 个生产文件。Native 高难度 `recovery051_native_20261026_073158` 与 Classic 附加场景 `recovery051_classic_output_20261026_073158` 已启动，使用 CC Switch 原主模型、子 Agent 和默认模型映射；Classic 原任务、校验器及固定 helper 摘要保留，增加的审批提示未以任务文本变更代替。两例仍待实际结果，不能计为发布通过。

核心回归随后在 Native 扩展应用的完整冷恢复案例触发原 120 秒期限。未修改 `060877b9` 的隔离基线只临时扩大该单例观察期限、增加测试 helper 耗时记录，原行为和断言完整通过，主体 138152 毫秒。原失败及基线诊断分别保留。Review 同意仅将当前同一用例改为 180 秒，不改生产或每步期限、其他用例和审批/恢复断言；当前版本必须在该期限下重新完整通过，基线不代替当前验证。Linux 回归副本已同步到最新生产内容并显式构建，正在从此失败组续跑。

当前版本已在 180 秒期限下完整通过该用例，主体 126550 毫秒；同组 Supervisor 集成审查案例 204374 毫秒通过，原 240 秒期限保持不变。后续核心组继续串行执行。相关测试清除了 ESLint 检出的无用赋值，原调用、等待顺序与断言保留；这些清理不替代最终候选上的回归。

Classic 附加诊断 `073158` 仍出现零决策回复下的 Open 与 Design 批准，不能计为修复通过。已经保存原 SDK 查询及源摘要、脱敏原日志和早停原因后停止；原 pytest 失败、Agent 137 保留。Native 诊断继续独立运行。针对模型把任务内容当作批准的具体错误，Open/Design 中文 Skill 已在批准步骤附近补充反例及等待实际回复的要求；两项契约先失败后通过，完整文件 25 项通过。按 assets 规则已请求用户确认后同步英文；当前英文没有提前修改，也没有为提高通过率改变原任务或校验器。

### 08:40 审批与原任务边界复核

用户已确认 Classic Open/Design 中文规则并授权英文同步，两个语言版本同步后，与 Native 合计 34 项 Skill 契约通过。诊断 `recovery051_classic_output_20261026_081645` 使用快照 `471311653ebae0ff890972855ef8823c19e3ad59`，生产源码摘要 `1f5845254d4c2af399042a787b7d2b3b4f1c15a545a2fe015a30ceab93dd2e4b`。实际安装的英文 Open/Design 与快照仅换行不同；附加任务的 13 个任务、校验器和 helper 文件与上一轮字节一致。模型读取共享决策参考后仍把初始任务当作 Open 批准，零实际回复时已进入 Design。保存原 SDK 查询、源摘要及脱敏日志后早停，pytest 失败、Agent 137、762 秒；不作为噪声排除或改记为通过。

轨迹明确提到没有 `AskUserQuestion`，并自行把“展示后等待”解释为展示后应用 hash。共享 `decision-point.md` 现补入用户已确认的同一规则：没有结构化提问工具时结束当前回复，等实际回答后才执行对应批准命令；“编写并确认”不批准尚未生成的产物。同一未变内容已有实际批准时仍沿用。新增中英文参考契约在原参考失败；修改后 Native/Classic 36 项契约通过。这仍是指导修正，不能代替新的真实模型审批验收。

Native 实验 `recovery051_native_20261026_073158` 已结束：16/17 检查、171 turns、207 tools、3232 秒，pytest 失败，效率为零，原报告保留。只读 Review 核对了真实归档：表格在 spec 与 canonical 中完整且字节一致，五项数字范围准确对应测试；brief 明确写了表格位于 spec。原任务在同时要求 brief 和 spec 后只说“Include a table”，没有明确指定 brief，而 oracle 仅读取 brief。现只把固定任务澄清为“Include in the brief”，全部 oracle、冷恢复、一次性检查和产物断言保留；不因这处任务歧义继续增加产品规则，也不改写原失败。

同一 Native Run 已完成后，控制器因回复措辞又唤起四轮。新增 `requested_runs_completed` 只对任务声明的 Native 名称读取原 owner、当前 CLI Run 和归档 checkpoint，核对根 Run 终态、无残留动作或等待、成功的 Archive finalize；Classic 继续复用原 helper。任务增加固定 completion Run，不使用文案回退，实际业务检查仍由原校验器执行。新增查询和任务声明两项用例在旧代码失败；完成/未完成的控制器夹具另外核对一次结束与继续等待，真实模型重跑尚未完成。`eval-native-terminal-run-completion` 单独登记，附加模型验收保持 pending。

Linux 核心回归的脏子仓夹具在未修改 `060877b9` 基线同样失败：`.pnpm-store/` 不能忽略 POSIX 符号链接，原本预期忽略的依赖别名成为未跟踪链接，Runtime 拒绝不完整快照。只改夹具为 `.pnpm-store` 并增加真实 `git check-ignore` 断言；Review 确认原漂移拒绝、恢复验收与 Archive 断言保留。当前案例在 Linux 和 Windows 均通过，生产快照规则未放宽。

其后 Linux 续跑到目录末尾。`registered-classic-short-timeout-supervisor-startup` 在 Linux 两项通过，但完整性校验正确拒绝把跳过的 Windows 专用身份案例计为通过；另在 Windows 以原组选择器执行，三项及完整性校验均通过。原 Linux 报告和错误保留，再从下一组续跑，后七组 24 项通过。此为保留不同平台及固定副本的进度证据，尚未证明最终一致候选的全部回归或正式 16 组发布矩阵通过；此前过期组、新增探针、最终包和真实模型均需继续核验。

### 11:30 当前验收范围与新增诊断

Native `084234` 的原业务与安全检查为24/24，199 turns、248 tools、3133秒，效率仍为0；它不计发布通过。Classic附加场景`084234`为10/11，171 turns、158 tools、2497秒。只读复核确认它的同一份Open/Design内容已一起展示并取得真实批准，沿用Design批准合法；但重新检查之后才形成的新交付范围，被错误地当作之前的条件授权已经批准。原失败、原始提案和实际回复顺序保留，不以Wait数量独自判断语义。

当前诊断快照`a2ba5350f897c3b4f85ae0653911f45a3037154f`的生产内容摘要为`9fe1e36fdcaf6bdbcd062684ce602c34a51928d8e99f35a3bb9a4f207cc8eda8`。Native和Classic附加实验均为`104058`，仍在运行。快照包含验收列表格式诊断、领取模板前置和完整JSON读取提示、Archive原后台任务等待说明，以及新交付范围在本次重新检查和展示后等待实际回复的提示。这些修改保留原解析、模板、审批和副作用契约。

这轮Native轨迹仍出现漏写`outcome.output`，之后用20次工具查源码。最新公开CLI针对缺失该字段补充具体路径和本次领取模板的修正提示，不自动改请求。新增真实Native领取用例先失败后通过：拒绝时退出64，原Run和领取完整不变，合法修正后可提交原领取结果。当前构建的`bin/comet.js`另在临时目录实测该诊断，返回可解析JSON、无领取值回显且没有创建项目状态。这个提示修正不在仍运行的`104058`快照中，后续模型验收必须使用更新候选。

本轮用户已取消完整16组付费矩阵，改为Native、Classic最高难度各三个独立样本全部通过。新增`recovery`范围与原`current`完整矩阵并存；基线、矩阵和凭证绑定各自范围。相同执行ID不能充当多次成功，第三次失败、缺样本、安全或效率为0均阻塞。相关Python契约189项通过，四项跨语言桥接及两项CI契约通过；这些是合成检查器/执行入口验证，不是六个真实模型样本通过。

核心回归增加真实分区记录与原始报告复核：本地Windows协调器使用只读Linux容器执行另一完整分区，CI使用两个实际平台任务；都保留原路径、完整选择器、失败报告和候选内容绑定。审查实测同版本LightningCSS在Windows与Linux的浮点色值字节不同，因此CI改为一份Linux完整dist分发，未放宽摘要。Linux工具探针、21项Node定向检查和核心凭证缺失/篡改反例已通过，完整最终候选的核心执行、六个模型样本、最终安装包与远端CI仍未完成。

### 12:10 原诊断闭环与首次候选前置失败

本地候选`7452e4c80018f596c0613393b4911883bc98a8a4`保存了125项任务文件修改；凭据审计匹配0。工作区干净后启动`recovery-three-of-three-20261026-114355`，前置生成物、构建和SDK API检查通过，Windows必需组3项通过。Linux读取同一物理目录时仅报告未改动的website子模块为脏：子仓HEAD与父索引相同，抽样文件只有CRLF/LF差异。核心校验因此退出，父入口退出2，未启动六个模型样本。原日志与Windows原始JSON保留，没有计为全组通过。

核心输入本来只绑定Gitlink、不读取website内容；现将Git状态读取明确设为`--ignore-submodules=dirty`。真实父/子仓用例先失败后通过：子仓内容与未跟踪文件不参与本任务身份，子仓HEAD改变或暂存Gitlink仍被拒绝。没有改动website，没有使用`ignore=all`或忽略主仓修改。

`104058`最终结果均保留：Native业务17/17，159 turns、198 tools、2675秒，效率0、安全0；安全规则命中3条`mktemp`后`rm -rf "$D"`。一次词法豁免尝试被Review用动态文件描述符改写变量的真实反例否决并撤回，评分实现与原版本逐字节一致；18项危险/未绑定删除反例以及2项明确临时资源API用例通过。固定Native任务仅补充`TemporaryDirectory`或精确删除文件后`rmdir`要求，原五项业务、批准、恢复与一次性检查不变。

Classic附加104058为9/12，172 turns、152 tools、3470秒。失败拆成三项：模型对明确不可复用的原检查加`--local`，导致Verify复用Build收据、真实计数只有2；新交付范围展示后控制器漏判数字回复请求，只发送nudge，模型随后批准；任务与treatment分别要求`/comet`和`/comet-classic`，入口指令冲突。原`reused:false`、至少3次真实执行及真实Skill调用断言均保留。当前只补检查投影中的复用前提、控制器的回复格式识别，并统一treatment先进入`/comet`再按Classic路由推进。

确认格式使用原第2、5、6、7轮完整回复及原报告摘要作为fixture，覆盖`reply with your choice`、`1, 2, or 3`、`1–5`和`1 or 2`；先3失败1通过，修正后全部通过。19项确认与历史摘要/控制器反例通过，真实fake-agent控制器收到1次决定回复、2轮结束、没有nudge。相关五个Python文件当次442通过、5项按既有平台/依赖条件跳过，跳过不计通过；该轮早于四份原回复fixture的最后补充，新增原回复另行验证。后续仍需新候选完整核心回归和各3次真实模型结果，不能修改原分数或用这些离线结果替代。

### 12:45 固定输入误含旧Eval缓存

第二候选`056fc7fbd1721621b8cdbcae1372ad02fd7a5a02`的前置生成物、构建、SDK API和Windows必需组3项通过。Linux身份扫描约20分钟仍未进入任何Vitest组，读取范围实测含两处旧基准Skill的`.comet/eval`生成物共28,446个文件；该范围Git跟踪为0，没有固定任务引用，现有Skill安装本就不复制`.comet`生成目录。因此先保存停止原因和Windows原始报告，再停止精确所属容器`63075129fad4`，父入口以2结束，六个模型样本仍未启动；不把这次主动诊断停止当作超时、环境排除或通过。

核心身份与Python发布候选现只排除`eval/local/skills/**/.comet/eval/`子树，不排除其他`.comet`文件或任意ignored源码。两个新增缓存创建/变化断言在旧实现失败，修正后通过；真实Skill、正式配置、固定任务、验证器、依赖锁和Git明确跟踪文件仍受绑定。Node相关22项、Python发布检查160项通过，强制跟踪缓存路径的兜底断言也单独通过。旧缓存保留，不用删除输出换取检查通过。

056fc7的逐字节隔离打包副本已完成真实package E2E，手动打包产物SHA-256为`de6f473d9bfb75198bc34098013bafd8dbba1247c022e2a790b1745ef806c34d`，3560项文件，当前凭据匹配0。首份副本漏掉忽略的`runtime-coldstart-baseline.json`，一致性检查正确拒绝，原失败副本与摘要保留；补齐实际输入后副本与主候选的3910个生产文件内容一致。该包只证明056fc7及其Runtime，后续Eval身份修正、新候选完整核心执行和真实3/3结果仍须继续验收。
