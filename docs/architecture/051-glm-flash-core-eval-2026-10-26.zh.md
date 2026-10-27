# 0.5.1 Native 与 Classic full 核心验收

来源：`report:2026-10-26-051-glm-flash-core-eval`。本轮按用户要求修复原真实评估暴露的问题，再使用 CC Switch 的 `glm-5.3-flash[1M]` 各运行一个样本。Classic 只执行 full；保留并存需求隔离和归档后输出修复，不以删减原综合用例替代修复。

## 原始证据与根因

| 行为                          | 原始证据                                                                                                                           | 根因与修复                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native 一次性检查误拒         | `051_native_glm53flash_hard_20261026` 的业务与 Archive 已完成，SDK Run 为 completed；validator 报 `Unexpected one-shot executable` | 实际命令为 `/usr/bin/python3 recovery_once.py`，旧断言遗漏容器系统解释器。接受该精确路径，继续拒绝其他解释器、脚本、目录、重复标记和不匹配收据。                                                                                     |
| Classic full 交付二次校验误拒 | `051_classic_glm53flash_hard_20261026` 多次出现 `OUTCOME_REJECTED: Classic 归档目录与交付 HEAD 不一致`                             | 先提交 Archive、后批准修复范围时，合法 Runtime checkpoint 仍与 HEAD 不同。领取交付 Action 后二次校验只接受当前 Run 的精确快照，未接受已验证的不可变交付前 checkpoint。复用领域已有的 checkpoint 历史校验，其他状态和文档变动仍拒绝。 |

Classic 原样本先夹带 `.gitignore` 的提交被正确拒绝，不放宽提交范围检查。原模型后来完成了 full 的交付，但进入 tweak 后退出码为 137，最终验证同时报告 Docker 不可用；不能把该综合样本视为通过。

保存的评估报告会脱敏 claim token，因此不能从脱敏副本重新计算原始 outcome 摘要并据此判断证据被改写。原生验收继续在真实 Runtime 内核对原始证据。

## 回归与安全边界

- `native-recovery-system-python-eval-evidence`：旧 validator 上新增测试失败，修复后同一测试通过；保留原一次性检查的唯一身份、脚本摘要、计数与跨会话证据断言。
- `classic-full-delivery-runtime-checkpoint-after-repair-approval`：公开 CLI 的最小 full 流程在旧代码上稳定出现领取后的相同拒绝；修复后完成同一 Run 的交付，Archive 只执行一次，仍拒绝未批准交付和改写归档需求。
- 新用例 `comet-classic-full-recovery` 保留原综合恢复用例的共享验收函数；契约测试比较这些函数的 AST，防止两份自包含验收脚本漂移。原综合用例继续覆盖 full、tweak、hotfix。

## 本轮执行状态

| 检查                                                 | 实际结果与边界                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Classic 修复与原输出修复的定向回归                   | 2 项通过；新增案例的最终交付使用已重新生成的 `comet-state.mjs` 公开命令 bundle。                      |
| Classic 未批准路径、已归档 checkpoint 与中断交付边界 | 3 项通过。                                                                                            |
| 不可变交付 checkpoint 与 Native 解释器相关契约       | 19 项通过。                                                                                           |
| Python 恢复与相邻负控                                | 修正当前进程的 UTF-8 解码后 12 项通过，8 项未被本轮选择；新增 full-only 共享断言契约随后单独通过。    |
| 登记执行器                                           | Eval 组 51 项、Classic 历史组 11 项全部通过；执行器退出 0，共 2 组、62 项。                           |
| Build、生成物、ESLint 与架构                         | 全部通过；ESLint 有 8 条原有 Dashboard 未使用变量警告，0 错误。本轮 Ruff 缓存已从仓库根移到忽略目录。 |
| 格式、Ruff、登记与 Git 空白检查                      | 通过。                                                                                                |
| 当前真实模型重跑                                     | 两例各 1 项均通过，pytest 与 Agent 均退出 0，`checks_failed` 为空；Judge 均成功返回评分。             |

上述测试存在覆盖重叠，不累加成独立场景总数。

## 真实模型最终结果

| 项目           | Native                                                                        | Classic full                                                                                                  |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 实验           | `051_native_glm53flash_corefix_20261026`                                      | `051_classic_glm53flash_corefix_20261026`                                                                     |
| 任务硬检查     | 8/8，通过                                                                     | 5/5，通过                                                                                                     |
| SDK Run        | completed，Archive 执行与收尾均完成                                           | completed，本地交付完成                                                                                       |
| 原故障相关证据 | 同一候选和原检查跨会话保留；`verify.checks` 只执行一次，一次性脚本计数为 once | Archive 只执行一次；Build、Verify、交付修复检查均真实执行且未复用；新范围获得独立实际回复后批准               |
| 隔离与交付     | 无 Classic/OpenSpec 产物污染                                                  | parked-format 保持 Open 且未归档；交付 commit `83c543f3bba234373652802e0ac51055ea8fe91c` 与实际 Git HEAD 一致 |
| 主模型执行耗时 | 2281 秒                                                                       | 2235 秒                                                                                                       |
| 效率评分       | 0.00                                                                          | 0.00                                                                                                          |

两例绑定相同的已修复源码摘要 `1d034b91f81b222e98326f78824b3f5ca88ea4833b80760d0e0ce039ed90fe04`，CLI 快照摘要也相同。报告位于 `eval/local/logs/experiments/<实验ID>/summary.html`，包含对应原始报告和 SDK 验收证据。原 DeepSeek 和 GLM hard 实验继续保留，不混入本轮结果。

Native 新样本选用了 `python3`，没有再次选择绝对路径解释器；`/usr/bin/python3` 的分支由原真实样本及新增旧代码失败、新代码通过的定向回归覆盖。不能将新样本说成再次执行了绝对路径变体。

本轮验证的核心恢复、验收、归档和 Classic 本地交付均已走通，原报告的阻塞未在重跑中出现。但现有正式发布规则要求效率评分至少 0.33，两例实际评分均为 0.00，因此不能把本轮任务硬检查通过表述为正式发布验收全部通过，也不调整阈值或补造发布凭证。

另外，实际执行 `node scripts/lint/workflow-regressions.mjs --require-acceptance` 退出 1，仍报告原有案例 `eval-classic-hardest-includes-post-archive-repair` 的附加验收待完成。本轮只关闭新增两例，保留其他登记和其原始验收范围；该检查失败也是当前正式发布仍未放行的实际证据。

本轮只更新新增两例的附加验收状态和本文结果。验收元数据在模型结束后更新，不改写原报告绑定的候选或声称获得最终提交的发布凭证。本轮未执行仓库全量测试，未提交、推送或发布。

## 效率优化验收（2026-10-27）

**最新验收范围：** 用户随后确认“native 和 classic 正常过了就行”，因此本会话不再以效率分阻断核心验收，不再为了分数继续优化或重跑。下文 0.67 是先前优化目标，作为历史保留；评分代码和正式发布规则均未修改，不能据此宣称已取得正式发布凭证。继续要求真实核心检查、SDK 终态、批准、归档、交付及 Judge 均通过。

用户要求继续优化，直到效率评分高于底线。当前评分按三个固定预算计算：模型轮次不超过 80、工具调用不超过 150、执行耗时不超过 600 秒，每满足一项计三分之一。发布底线为 0.33，本轮目标为两例均至少 0.67，且任务硬检查和 Judge 仍真实通过；不调整评分、过滤调用或放宽验收。

原已修复模型样本中，Native 为 110 轮、167 次工具调用、2281 秒；Classic full 为 178 轮、167 次工具调用、2235 秒。轨迹中存在重复帮助、源码搜索、错误参数试探、逐个读取独立文件，以及 Run 完成后的可选记忆与知识学习。隔离容器的无模型微基准显示，预热后的 CLI 帮助和状态查询多在一秒以内；该测量只定位启动成本，不能证明真实模型效率通过，也不删除候选快照、独立验证或恢复证据来提速。

第一轮只调整两项任务及恢复会话的执行指引：给出已有公开入口，完整解析 CLI JSON，批量读取独立文件，在同一已授权阶段内顺序执行操作，遇到错误或新决定立即停止，并在真实 Run 和交付完成后停止任务范围以外的可选学习。Native 的独立 verifier、预设 blocked 与跨会话恢复、一次性检查，以及 Classic 的单独实际回复、新范围批准、一次 Archive、原检查唯一性和 parked-format 保护均保留。未修改产品 Skill 或评分代码。

真实实验为 `051_native_glm53flash_efficiency1_20261027` 和 `051_classic_glm53flash_efficiency1_20261027`，均使用相同 CC Switch GLM 5.3 Flash 主模型和 Judge，各一个样本，Classic 只跑 full。启动状态与安全日志在 `.comet/eval/runs/051-glm53flash-efficiency-20261027/`。启动前定向 Python 契约 3 项通过（17 项未选），Ruff、受影响指引格式和 Git 空白检查通过；两项真实任务均收集为一个样本。后续失败与修复结果分别记录如下，既有实验全部保留。

Native 第一轮随后失败：模型把 `python3` 同时写入 `executable` 和 `argv`，第一次检查尝试打开不存在的脚本 `python3`，然后重新提交 Builder 并执行检查。模型最终报告 blocked，但恢复边界发现多份 Builder/检查记录，正确拒绝冷启动；Agent 退出 3，未生成终态 Archive，不能把中途 52 轮、66 次工具调用、811 秒的统计作为完整任务效率通过证据。原始失败报告和严格断言均保留。

针对该实测误用，任务指引补充 `executable: "python3"` 与 `argv: ["recovery_once.py"]` 分开填写的精确示例，明确失败后替换检查仍违反唯一性要求；未修改 Runtime 或验证器。仅 Native 启动第二轮 `051_native_glm53flash_efficiency2_20261027`，状态与安全日志在 `.comet/eval/runs/051-glm53flash-efficiency2-20261027/`，Classic 第一轮继续执行。

补充检查中，一次性收据契约 2 项通过。Windows 上的既有公开 CLI 恢复测试未通过：先遇到不可执行的 WindowsApps `python3` 别名，在忽略的 Eval 虚拟环境内给原解释器建立 `python3.exe` 硬链接后，仍停在“检查进程树的停止尚未确认”，保留执行登记，尚未证明该本机边界通过。尝试隔离 Linux 镜像补充执行时缺少 `jsonschema`，未完成收集。这些未通过项不计入真实模型验收，也不以放宽进程停止确认来绕过；实际容器内 Native 第二轮的最终结果见下文。

Classic 第一轮效率实验已结束：Agent 退出 0，SDK 与产物检查 5 项通过，但实际用户回复检查失败（proposals=1、decisions=0、replies=0、turns=3），整体失败；Judge 成功返回且指出审批证据缺失。完整统计为 119 轮、102 次工具调用、1992 秒，效率 0.33，仍未高于底线。实际模型先完整展示新范围并两次停下来等待，交互器却未识别 `💬 Q｜Approve ...? (single-select)` 这种问题格式，连续发送续行提示；模型随后将续行提示误当批准。两者都不能被重新标成合格的实际批准。

针对该真实问题格式添加最小识别和完整 mock CLI 交互回归时，旧识别器上 3 项失败、3 项通过，证明会漏发真实回复；同时覆盖历史交付摘要不得重新触发审批。当时 Native 第二轮仍使用绑定到共享脚本目录的执行器，因此等其完全结束后才修改 `decision-point.sh` 并验证、登记，避免中途改变样本的执行条件。上述失败不会因后续修复而回写为通过。

### 核心验收续行

Native 第二轮 `051_native_glm53flash_efficiency2_20261027` 已结束：pytest 和 Agent 均退出 0，8 项核心检查全部通过，`checks_failed` 为空，Judge 成功；真实 SDK Run 完成，同一候选、原检查与一次性脚本证据保留，Archive 正常完成。实际效率仍为 0.00（123 轮、217 次工具调用、2898.545 秒），如实保留但不按最新指示补跑 Native。

该轮独立 verifier 的临时输入漂移也已查明：它用 `python3 -I` 导入候选模块，`-I` 会忽略 `PYTHONDONTWRITEBYTECODE`，因此产生了新的 `__pycache__/wordcount.cpython-311.pyc`。Runtime 正确拒绝使用旧检查验收；verifier 删除自己新增的这一个缓存文件、恢复原输入后继续，未重跑原一次性检查，最终验证通过。不能把中途 `unknown` 或目录已经移动当作通过依据；本结论来自最终真实报告。

Native 完全结束后才修改共享 `decision-point.sh`：识别 Markdown/对话图标前缀后的行首 Q 标签问句及单选说明，已答历史摘要不触发。新增识别与完整 mock CLI 交互回归先在旧代码上失败；修复后相邻定向测试 32 项通过（134 项未选），包括 C 与 UTF-8 正则环境、数字回复原用例和实际独立回复。Windows mock 执行环境显式采用 UTF-8，避免本地编码或 MSYS 参数转换代替容器行为。新案例登记为 `eval-labelled-delivery-question-actual-reply`，对应真实模型附加验收已按下文证据从 pending 单向更新为 verified，未降低原实际回复断言。

单个 Classic full 样本 `051_classic_glm53flash_replyfix_20261027` 已结束，主执行与 Judge 均为相同 GLM 5.3 Flash。启动状态和安全日志在 `.comet/eval/runs/051-glm53flash-classic-confirm-fix-20261027/`。新增三条精确 Vitest 包装均通过，实际覆盖 13 项新增 Python 断言；登记执行器退出 0，1 组 54 项通过，报告为 `coverage/core-regressions/registered-eval-recovery-single-requested-sample.json`。定向 ESLint、Ruff、格式及 `check:badcase-registration --base ca5ef2b716ea08bf6be2a9c3a1ad7d9de0de070c` 均通过。上述检查有覆盖重叠，不累加为独立场景数；不再追加效率优化提示或重跑已通过样本。

### 按最新范围的最终结论

| 项目           | Native 第二轮                                                                                                                 | Classic 交互修复后                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 真实报告       | `051_native_glm53flash_efficiency2_20261027`                                                                                  | `051_classic_glm53flash_replyfix_20261027`                                                                                           |
| 执行与核心检查 | pytest/Agent 均为 0；8 项硬检查通过；无失败                                                                                   | pytest/Agent 均为 0；5 项产物与 Runtime 检查通过，实际回复校验通过；无失败                                                           |
| Judge          | enabled_and_successful                                                                                                        | enabled_and_successful                                                                                                               |
| SDK 与交付     | completed；原 Builder 与 verify.checks 各一次，两个独立 verifier 分别完成 blocked 与恢复验收，Archive execute/finalize 各一次 | sentence-full completed；Archive execute 一次，三个检查各真实成功一次且 reused=false；修复后的新范围获单独实际回复批准，本地交付完成 |
| 隔离           | 未混入 Classic/OpenSpec 产物                                                                                                  | parked-format 仍在 Open，未归档；未追踪缓存                                                                                          |
| 效率观测       | 0.00；123 轮、217 次调用、2898.545 秒                                                                                         | 0.33；108 轮、94 次调用、2040.650 秒                                                                                                 |

Classic 的交互器记录了一次绑定 `full.delivery.confirm` 的独立回复，随后交付 commit `3e46fffc44f0d13f060de7f567de1ac0887c3497`，与保留工作区的实际 Git HEAD 相同。修复检查保留原 Verify 的 argv/cwd；Build、Verify 的 reusable=true 只是复用资格，本轮均 reused=false，交付修复检查 reusable=false，不能误写成三个检查都不具备复用资格。

本次模型使用“Reply with your choice”提出新范围批准，没有再次选择原失败的 Q 标签句式。Q 标签分支有旧代码失败、新代码通过的检测及完整 mock CLI 交互证据；新模型样本证明原待决提案绑定的真实回复与完整交付，不声称再次实测了同一文本变体。

两例使用同一份冻结 CLI 快照 `d2d7eb861b4d8300fd0b165902f583adb80b5cca48fd0b6aed8903d45ee8468d`。它们各自的源码上下文摘要不同，不能混称为同一个完整候选；后续验收元数据更新及运行期间工作区的其他并行 Runtime 改动也未纳入这些模型结果。仅本次核心验收范围已通过，效率按最新用户指示记录，不代表正式发布规则的全部检查或最新工作区全项通过。未运行仓库全量测试，未提交、推送或发布；Windows 本机补充边界与缺依赖检查的限制仍保留。
