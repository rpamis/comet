# Native / Classic 核心行为审查

后续修复与 CI 测试精简记录见 [Runtime 审查修复](2026-11-09-runtime-review-repair.zh.md)。下方保留初次审查时的发现和验证状态，不能替代后续候选的实际结果。

来源：`report:2026-11-09-runtime-core-commit-review`。审查用户列出的 8 个提交，范围为 `5426c4cbb3569e749ce8050888517f93b8437f5d..2e7055cc`。工作开始时 `053` 和 website 子模块均干净。

审查结论：简化改变了检查、文档编辑和恢复的责任边界，并且出现了实际恢复与交付回归，不能仅凭此前定向测试通过就判定核心功能无影响。以下修复候选保存在独立分支 `codex/review-runtime-core`、工作区 `D:/Project/Comet-runtime-review-053`；未合入 `053`，未提交、推送、创建 PR 或发布。

此前研究记录用 `7f016b28` 对照了一批“旧基线也失败”的案例，但该提交本身就在本次审查的 8 个提交中。本次比较基线是 `5426c4cb`，因此不能用前述对照把它们直接排除出审查范围，更不能一概视为过时测试。

## Standards

独立规范审查确认以下恢复与读取问题。它们违反保留旧 Run 恢复、提供可执行恢复命令和只读查询的约定，与是否保留 PID 无关。

1. 旧 `.runtime-migration-recovery.lock` 会让 Native/Classic 在迁移前置步骤失败，即使已明确确认原操作停止。修复将已有确认传到元锁恢复，仍拒绝活动 SQLite 事务。最小旧记录在修改前失败、修改后通过。
2. Native `.recovery.lock` 会阻止新操作，却被 doctor 诊断列表排除。修复纳入只读诊断与精确 token 恢复；错误 token、未确认和活动事务仍拒绝。源码与生成 Runtime 的公开 doctor 均已实际验证，恢复后可以创建 change。
3. Classic 可选交付记录读取在 Runtime 根目录不存在时仍以它作为受保护根，导致首次授权写入后抛 `ENOENT`。修复仅在目录真实存在时采用该根，否则从卷根进行完整受保护读取；不为查询创建 Runtime。原身份、真实 Git 交付和远端证据断言保留。

## Spec

独立需求审查和定向复现确认下列仍须保留的行为被误删或遗漏。

| 行为                                               | 修改前结果                                   | 修复及证据边界                                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native 不完整轨迹尾行                              | status 继续给推进命令                        | 恢复轨迹结构检查，停止推进并给出真实错误；保留完整事件，doctor 只修复尾行                                                                          |
| Native 轨迹中间坏 JSON                             | doctor 报健康，实际推进却失败                | doctor 明确报告 `trajectory-invalid`，保留全部原始字节；状态不再给推进命令                                                                         |
| Classic 归档后 `repair-delivery`                   | 新 Run 与原不可变 checkpoint 不匹配          | 恢复既有 checkpoint 身份绑定，源码修复、真实重检与生成 CLI 的最终 Git 交付通过                                                                     |
| Classic 归档交付中断后 `continue-work`             | 同样被原 checkpoint 拒绝                     | 恢复原中断 Action 与 checkpoint 绑定；正常/中断两种流程到公开 CLI 完成，Archive 只执行一次                                                         |
| Classic 已跟踪迁移标记移动                         | 归档副本已提交，仍因活动路径删除未批准而拒绝 | 仅在归档副本已进入 HEAD 时同时允许原路径删除；两种目录的合法移动通过，缺副本的两个反例仍拒绝                                                       |
| Classic 历史 `deliveryInputs` 混入其他 change 草稿 | 要求提交停放的 Native 草稿                   | 只在旧字段兼容读取时排除其他 workflow/change 文档；不改变当前 `deliveryPaths`。已验证实际 v1 Run 的历史数据形状与兼容函数，未验证完整 0.5.0 包升级 |

修复没有恢复项目内容快照、自动内容失效或 PID 存活推断。checkpoint 摘要沿用共享 SDK 的既有身份协议，用于关联原 Run；不新增项目内容证明或配置预算。

审查中的两个候选已排除：旧 Compat 的非空检查仍沿原契约，并非本批新回归；二次 `repair-delivery` 的 checkpoint 自拒绝猜测经正常/中断两项实际公开 CLI 流程验证后不成立。它们不计入问题数量。

## 测试调整

- update 的两处错误文案匹配允许 `symbolic link, junction ...`，保留外部文件与 OpenSpec 不受写入的断言。
- Native 并发转换仍要求互斥，只更新旧错误文本。
- 旧 transition 锁用例改为明确确认原操作已停止、按精确记录恢复；继续保留原 journal、轨迹和不重复推进断言，不再期待 PID 判死后自动删除另一把锁。
- 迁移 marker 测试使用当前路径清单字段，继续通过真实 Git 移动和公开 bundle 检查两侧路径及缺副本反例。
- 新增独立 checkpoint 续行用例。原混合旧内容证明的测试保留，未靠删整项测试掩盖后续失败。
- handoff 文件补齐 `vi` 导入；去掉其四个参数化场景中的“追加解释文字必须自动拒绝原批准”断言，保留缺少批准不能推进和完整 handoff / Build。原全文与本轮其余调整前的十二份文件均保存在 `2026-11-09-runtime-core-review/original-tests.json`。
- 旧受管归档恢复套件固定原 v1 工厂，继续执行未知结果和原 profile 恢复；CLI 新 Run 的版本期待更新为 v2。
- 自定义 SDK 产物契约的缺失文件匹配补充 `ENOENT`，后续非空、章节、真实摘要和固定配置保护断言均保留；审计测试显式使用 `feature-removed`，不再依赖清单首项的迁移类型。
- daemon 测试精确允许一次实际需要的新鲜 `git worktree list`，继续禁止重复的本地观察并验证 brief 没有缓存；贡献指南按提交前检查章节逐个核对目录，包含 `plugin/`。
- 注册设计的旧 frontmatter 文本不再用作机器所有权证明。替代断言保留原设计引用、只读状态字节和正文；没有更换 Run、工作区或物理文件路径。该退休范围经独立 Spec 审查认可。

其余全量失败仍需逐项核对。内容摘要字段、文件编辑自动失效、默认受管检查和旧 `continuation.request` 可能属于过时期待；批准、原 Action、未知结果、实际 Git 范围、恢复和单次副作用的断言仍有效，不能随它们一起删除。

本轮具体退休范围、四个 handoff 展开名称、保留断言与独立审查结论见 [测试调整记录](2026-11-09-runtime-core-review/test-adjustments.json)。handoff 修正后 20 项全部通过；这不表示已撤下的自动内容失效策略仍然通过。

已准备修复候选的行为为 Standards 3、Spec 6；各轴最严重的问题分别是恢复入口永久阻塞，以及合法归档续行或交付被拒绝。新增 9 个精确案例登记在 `config/workflow-regressions.json`，旧登记和历史映射保持不变。

## 尚未解决的明确缺口

**[P2] 新 Classic v2 的公开 `repair-delivery` 不可用。** 最小默认 v2 hotfix 项目实际运行 Node 生成 `generated/check-output.bin`，提交 passed 平台 `--checks` 报告，并声明该命令的 `outputs`。通过 Open、Build、Verify 和 Archive 批准并实际归档后删除生成物，`canRepairClassicDelivery` 返回 true；执行 `state repair-delivery --expected-revision 16` 却返回 70：`Original Verify command is incomplete`。原 Run 没有改变，OpenSpec 只执行一次。

`classicDeliveryRepairOriginals` 对 v2 选择 `archive.preflight`，而 `captureClassicDeliveryRepair` 仍要求原受管检查的 `argv`、`cwd`、`timeoutMs`。v2 的该步骤提供路径和平台报告，缺少这些字段。CLI 帮助未把命令限制为 v1；普通 v2 归档和直接交付主流程不因此阻塞，但这个公开恢复入口失效。

这项属于 Spec 轴新增发现，因此最终已确认问题为 Standards 3、Spec 7，其中上面的 9 条行为有修复候选，此项未修复。后续须沿 v2 平台检查报告补齐归档后恢复，并增加预期成功的公开 CLI 回归；不能虚构 argv 或把合法恢复期待改为拒绝。实际输入、输出和保持原 Run 的证据见 [v2 恢复命令记录](2026-11-09-runtime-core-review/v2-repair-evidence.json)。未将失败探针登记为已通过覆盖，也未宣称该问题已解决。

## 验证记录

过程记录位于独立工作区 `coverage/review-053/`。不同轮次有重叠，不相加冒充独立测试数。

标准 Vitest 扫描最终按两段覆盖 **748 个文件**：首段 649 个真实文件已输出完成记录，执行会话随后丢失、进程不在且没有最终 JSON；只补跑剩余 99 个文件。测试夹具模拟的 `test/scripts/example.test.ts` 输出不计入统计。分段诊断合计 **8,909 通过、643 失败、116 跳过**；文件为 618 通过、128 失败、2 跳过。收集失败文件的未知用例数不计入断言总数。

这组数字包含修复前和环境相关失败，**不代表最终候选的统一整套结果**。全部真实文件状态及续跑错误见 [诊断结果](2026-11-09-runtime-core-review/diagnostic-results.json)。仍有大量失败未逐项迁移或解决，不能把 643 项都归为本批生产回归，也不能统称过时后删除。

最终构建后，登记器生成精确选择器，并用现有 `assertCoreRegressionResult` 核对必过文件和完整名称：**9 组全部通过，19 次测试执行通过**。见 [精确案例结果](2026-11-09-runtime-core-review/exact-results.json)。公开 `test:core-regressions --case ...` 曾连带选择旧历史整文件，已停止该扩展轮次；它的失败与中止记录保留，不计入这 9 组通过结果。

- 根工作区的首轮全量在出现明确失败后主动停止，不计完整通过；独立工作区进行上述分段诊断。
- 独立工作区的全量是诊断轮次。运行期间又发现并修复了问题，部分模块已被测试进程加载，因此该轮结果不代表最终候选全部模块处于同一修订。原始失败全部保留，最终修改以重新构建和受影响文件、精确案例的重新执行为依据，不能据此声称最终整套通过。
- 8 个元锁测试（含公开源码/bundle doctor）、两项轨迹恢复、169 项 Native transition / update 组合、两项 checkpoint 续行，以及 marker/旧输入的 5 项探针均已通过；以最后的精确登记执行结果为最终依据。
- 最终 `pnpm build`、`pnpm check:generated`、`pnpm lint` 均通过；lint 为 0 error、9 条既有 warning。本任务修改文件的 Prettier 检查和 badcase 基线保留检查通过。冻结原测试快照没有格式化。
- Classic progress 修复后完整文件 65 项通过；handoff 调整后 20 项通过；CLI 新 Run 的三种 profile 版本检查 3 项通过。
- 新工作区最初缺少 Python `pytest`，静态套件因此失败。离线执行 `uv sync --locked --offline --no-python-downloads` 后，94 项静态测试重新执行全部通过。这是确定性 pytest/收集测试，不是模型 Eval。
- Windows 文件符号链接测试有权限缺口。精确案例在 `fs.symlink(..., 'file')` 阶段返回 `EPERM`，尚未进入 Hook 判断；目录 junction 成功不能替代该边界。未删除、跳过或把这些失败记为通过。
- 未启动真实模型/容器 Eval，用户没有给予该授权；未验证真实 Agent 平台 Hook 或完整发布安装包。测试中直接调用生成 Guard/CLI 不代表真实平台 Hook 验收。
- 当前 package 为 0.5.3，`origin/master` 与上个 tag 为 0.5.2。本次修复是这批未发布简化中的遗漏，不增加版本或把内部迭代追加进 Changelog。

额外定向复验：Native 转换恢复 42/42、Classic progress 65/65、handoff 20/20、自定义产物与审计契约 23/23、daemon 与指南 3/3、现行 Agent 检查报告 14/14、CLI 文档与恢复契约 6/6。它们与上面的 19 次有交集，不相加计算整体覆盖。

确定性 Classic benchmark 仍失败：7 场景中 migrationSuccessRate 为 1，其他三项为 6/7。唯一失败的 `handoff-resume` 使用已移除的 `state set pending` 且未检查失败返回，还要求已退休的 hash/JSON 副本。当前合法 matching-pending 生成 bundle 恢复案例另跑 1 项通过。该 benchmark 脚本不在本批差异内，属于维护滞后；保留 7 场景、恢复一次和 rate=1 的目标，没有修改预期取绿。数据见 `2026-11-09-runtime-core-review/classic-benchmark-cases.json`。

未完成边界的后续负责人为接手该修复的维护者：在有文件符号链接权限的 Windows 或 Linux 环境执行相同安全案例；对原 0.5.0 发布包做实际升级交付验证；补齐 v2 平台报告的归档后修复；逐项分类剩余诊断失败。真实模型与候选平台 Hook 仍缺证据，未经用户明确授权不启动 Eval。

## 工作区与运行限制

原工作区的安装版 Hook 无法枚举历史 `comet-any-sdk`。按其提示执行正式 doctor 修复后，旧归档投影被改写，随后因原分支 `045` 与当前 `053` 不匹配失败。已从操作前备份逐字节恢复归档文件，主工作区无本任务实现修改；没有手工修改 Runtime 状态或继续修复无关旧 change。

首次子审查复现曾遗漏数据根隔离，留下临时项目专属目录 `C:/Users/BENYM/.comet/workspaces/4e0299eb4e6fd4d20f0fbcec73ef620a8e76397a847d7c8c3baba152df203da0`。其清理被自动批准审查拒绝（`blocked by policy`），未再绕过，目录保留。后续复现和所有 Vitest 文件均使用隔离数据根。
