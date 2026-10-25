# 051 Native / Classic 验收

来源：`report:2026-10-25-051-native-classic-acceptance`。验收当前 `051` 候选，使用 CC Switch 的 Claude Code GLM 配置。每个 workflow 的高、中、低难度各运行一个固定样本；失败保留原记录，修正后复测，不将超时、未归档或缺失评分计为通过。

## 固定矩阵

清单位于 `eval/local/acceptance-051.json`。低、中难度使用相同业务输入比较两个 workflow；高难度分别验证各自恢复与交付路径。

| Workflow | 难度 | 任务                             | 必须完成                                                                                  |
| -------- | ---- | -------------------------------- | ----------------------------------------------------------------------------------------- |
| Native   | 低   | `comet-small-cli-archive`        | Unicode 字符计数、保留词数和行数、独立验收、SDK Archive                                   |
| Native   | 中   | `comet-counter-refactor-archive` | 计数分派器重构、保留旧接口、完整回归、SDK Archive                                         |
| Native   | 高   | `comet-native-sdk-recovery`      | 辅助文档增量更新、blocked Verify 跨会话恢复、原候选与一次性检查保留、新 Verifier、Archive |
| Classic  | 低   | `comet-small-cli-archive`        | 同一字符计数任务、full SDK 流程、Archive、可核验的本地 Git 交付                           |
| Classic  | 中   | `comet-counter-refactor-archive` | 同一重构任务、full SDK 流程、Archive、可核验的本地 Git 交付                               |
| Classic  | 高   | `comet-classic-sdk-recovery`     | full、tweak、hotfix 分别归档交付，同时保留并存需求                                        |

每组 `count: 1`。主执行模型、子 Agent 模型、接口和其他模型映射沿用选中的 GLM 配置，凭据仅在进程或评测容器的临时环境中提供。Classic 的既有 Superpowers 依赖仅在获得本轮明确授权后使用，不修改其原始 Skill。

### Claude Code 工具兼容

首轮使用 Claude Code 2.1.310 时，GLM 5.2 Verifier 只得到 ToolSearch 和少量延迟工具，搜索不到 Read、Bash 等基本工具。该表现与 [Claude Code 上游报告](https://github.com/anthropics/claude-code/issues/104309) 一致。独立小样本设置 `ENABLE_TOOL_SEARCH=false` 后，真实子 Agent 成功调用 Bash，并返回 `printf TOOL_COMPAT_OK` 的实际输出。四个当前验收任务的容器据此显式关闭工具搜索；控制器允许转发调用方的同名设置，未提供时不强制添加。CC Switch 的全局配置、模型和接口保持原值。

保留原始工具缺失实验，不能把模型自述或兼容性小样本当成工作流归档成功。最终六组使用同一兼容设置，重新核对真实 Action、独立验收和 Archive。

Judge 的 HTTP 传输还复现了 `glm-5.3[1M]` 返回模型不存在的 400 响应。`[1m]` 是 [Claude Code 的上下文后缀](https://code.claude.com/docs/en/model-config)，发送模型 ID 前应去除。修复只改变 HTTP 传输中的模型 ID，保留配置及报告中的原模型名称；同一配置的真实修复验证已返回 `OK`。评分器修复不改变 Comet 产品快照。若已完成的同候选实验需要重新评分，应引用原产物和报告摘要另存评分证据，保留原失败记录；Agent 超时仍算失败，不能仅补评分就改成通过。

评分输入还应跳过根级 `_eval_current_comet`、`_eval_target_skills`、`_eval_trusted_oracles` 三个控制器目录。它们是注入的安装与验证输入，不能先占满评分上下文而遗漏业务代码。普通下划线文件仍保留。目录污染问题已用相同预算下丢失 `wordcount.py` 的最小样例先复现，再验证修复。

## 候选与证据

先完成实现、定向检查和构建，再记录候选 commit/tree、发布资产与完整 dist 的摘要、任务及 validator 的摘要和实际模型映射。六组最终结果必须匹配同一产品候选的 `sourceHash`、`snapshotHash` 和 `assetsHash`。产品实现或资产改变后，不能把旧结果当作新候选的通过证据；任务或影响被测 Agent 执行、产物校验的 harness 改变后，重跑受影响的实验。仅评分传输、评分输入选择或结果文档改变时，核对产品文件未变，并按上面的规则另存同产物重评分证据。所有当前矩阵均使用 `COMET_NATIVE_SDK_CURRENT` 或 `COMET_CLASSIC_DOCS_LAYOUT`，不以冻结的 039/040 treatment 或 050 包作为被验收产品。

历史 badcase 可以保留旧状态和旧输入，以验证 051 的兼容与恢复；被执行的产品源码和生成命令必须是当前候选。执行 `pnpm test:core-regressions` 的全部分组，核对每项精确测试名称及断言，不仅检查登记文件。Windows 定向回归与 Linux 完整 badcase 执行分别保留平台上下文，跳过或缺失的必需案例不能计为通过。

归档检查读取真实 SDK owner、公开 CLI 返回的 Run 和产品校验过的归档 checkpoint。Native 必须有独立验收与最终归档 Action；Classic 必须有本地 delivery 收据并通过 `state delivery --verify`。手写 `archived: true`、仅创建归档目录、模型口头完成或沿用旧报告均不能通过。

本清单是用户要求的六组验收，不替代 `eval/local/RELEASE_GATE.md` 的完整正式发布矩阵，不生成一个伪装为完整发布批准的凭证。

## 结果保存

中途的 `sourceHash` 差异已逐文件定位到 `config/workflow-regressions.json`：该汇总也包含回归登记，而执行快照、Runtime 和安装资产没有改变。审计保存在 `eval/local/logs/acceptance-051-source-identity-audit.json`。最终矩阵改用固定的当前候选源目录，后续结果登记不修改该目录，六组均核对同一源码、执行快照和资产摘要；中途结果保留，不替代最终矩阵。

Native 独立 treatment 原先只复制 Native Skill，遗漏其入口引用的 `../comet/reference/host-check.md`。真实新会话只能自行检查能力。评估准备现从同一 CLI 快照补入这份文档，不安装额外 Skill 入口或脚本；快照缺少文档时启动失败。最小安装测试已先失败后通过，最终三组 Native 重新运行并检查原链接可读。

高难度后续实验已完成跨会话恢复及真实归档，但验证器只接受直接 `python3`，误拒绝任务要求的固定 PATH 命令。原失败 `experiment_20261025_045220` 保留。验证器现在同时识别直接 Python 与只设置绝对 PATH 的 `env` 包装，严格匹配原计划与收据；其他命令、额外参数和空或相对 PATH 仍拒绝。Linux 公开 CLI 完整恢复测试先在原断言失败，修复后直接命令和固定 PATH 均通过，包括原候选、检查记录、一次性计数、独立会话和 Archive 检查。实际模型验收仍需新实验通过。

高难度首轮已到达真实 blocked Verify 边界，但控制器直接执行 Python 校验器时，扁平 `/opt/python` 安装布局触发了包初始化，因找不到顶层 `scaffold` 包而退出。原实验 `experiment_20261025_042537` 保留为失败。独立脚本现从其自身目录加载标准库实现的兄弟校验模块，包内调用保持相对导入；边界状态、原 Action、候选和一次性检查校验没有跳过。隔离 Python 布局下先复现导入失败，再验证能进入正常的状态校验。

中难度首轮的业务、独立验收与真实 SDK Archive 均通过，Agent 却在 Run 已完成后继续处理临时项目的知识学习，最终超过 40 分钟执行期限。原实验 `experiment_20261025_034211` 保留为失败。该任务现明确临时 fixture 不产生持久学习，完成必须的验证、归档及 Classic 本地交付后给出结束响应；原业务和终态校验未放宽，另行重跑中难度。

Classic 高难度配置给 Agent 80 分钟，但原 pytest 外层只有 70 分钟，不能完整提供已配置的执行预算。实际 runner 的 timeout marker 与用例预算关系已先验证失败，再把外层期限设为 100 分钟，覆盖执行、验证、评分与清理。各任务自身的 Agent 期限保持原值。

保留全部失败与成功实验、原始脱敏记录、各例归档路径和同候选核对结果。最终报告分别列出六组状态、归档与交付证据、badcase 执行结果、已修复问题和未完成项。当前配置与历史调试实验只提供调查线索，不能预填为通过。

## 2026-10-25 中断记录

固定候选为本地 `051` 的 `7ec0d4bf`，源码摘要 `da20c4b2ec11305990ec97173a613e6928c3f3b72c43c1c756a3ebf0e1f013cb`，执行快照摘要仍为 `104d6848ff9342a8a13f1fbb02a0536e1395ce4387266bd33320bfad9621ebbb`。三个新实验都实际读取了补齐的共享能力检查文档，随后 CC Switch 的当前 GLM 接口返回 HTTP 429 / 1308：已达到 5 小时用量上限，服务端给出的重置时间为北京时间 2026-10-25 07:31:43。三组均以失败保留，没有归档，不能计为最终通过。

| Workflow | 难度 | 固定候选的当前结果                  |
| -------- | ---- | ----------------------------------- |
| Native   | 低   | GLM 额度中断，待同候选重跑          |
| Native   | 中   | GLM 额度中断，待同候选重跑          |
| Native   | 高   | GLM 额度中断，待同候选重跑          |
| Classic  | 低   | 等待本轮 Superpowers 依赖的明确授权 |
| Classic  | 中   | 等待本轮 Superpowers 依赖的明确授权 |
| Classic  | 高   | 等待本轮 Superpowers 依赖的明确授权 |

中途低、中难度各有一次 23/23 检查、正常退出及真实 SDK Archive 的结果；它们保留为产品行为证据，不替代补齐能力检查文档后的最终矩阵。高难度的中途实验完成真实恢复和 Archive，但固定 PATH 验证器及评分未通过，仍保留为失败。

全部登记的确定性 badcase 已在 Linux 通过：129 个分组、743 项已执行测试，必需案例没有缺失或跳过。Issue 500–505 的对应断言也逐项核对通过；这些结果不能替代尚未完成的六组模型验收。状态、原报告及审计位于 `eval/local/logs/acceptance-051-status.json`、`eval/local/logs/acceptance-051-final-matrix/` 与 `eval/local/logs/acceptance-051-badcases/`。

额度重置后使用相同固定源目录重新执行，另建运行轮次并保留这三次失败；Classic 只在获得本轮依赖授权后启动。六组真正完成之前，不生成发布通过凭证，也不发送任务完成通知。

## 授权恢复与场景修正

用户随后明确允许本轮所需依赖，当前 CC Switch GLM 接口已实测返回 HTTP 200。新轮次为 `authorized-20261025-0952`；仍使用原固定 051 产品快照。Classic 的 27 个所需 Skill 均已核对可加载，授权仅适用于本轮评测。

新轮次的 Native 高难度模型把 `Hello there. How are you? Great!` 的基线词数 6 写成验收值 8。Runtime 正确要求重新确认正式要求，保留实现并创建第二个 goal cycle 和 Builder；这已违反固定单候选场景，控制器保存现场并提前停止，原报告退出 137，不能按通过或产品故障计入。现场位于该轮 `native-hard/early-failure/`。

任务现给出五条固定业务验收示例，要求首次 Shape 确认前核对原词数和行数。回归测试实际执行未修改的基线 CLI 检查这些数值；单候选、一次性检查、独立新会话、原检查记录与 Archive 断言保持原样。受影响的高难度另建轮次复测，其余任务的输入和验证器没有改变。

Classic 首轮 full 已完成 Archive，但控制器注入的 `.claude`、`_eval_current_comet` 等工具未被 Git 排除，交付校验将其视为待提交的检查输入。原错误明确指出缺少 `.claude/CLAUDE.md`，补入后又指出缺少工作流 Rule。控制器保留错误和现场后停止该失败样本；不放宽产品交付检查来容纳工具污染。

当前 Classic 场景现由控制器标记，在模型启动前于容器中准备 Git，把固定工具路径登记到 `.git/info/exclude`。用户 `.gitignore` 及原排除规则保持不变，模型重写 `.gitignore` 也不会移除控制器规则。真实 Docker/Git 已验证幂等、工具排除，以及业务与 `parked-format` 文件仍可见；Native 与未标记场景不初始化 Git，不更改其输入。仅受影响的 Classic 场景重新运行。

Classic 中难度随后在模型启动前暴露了共享环境的 Native 校验器路由错误，低难度也受影响。控制器现仅在明确选择 Classic 且没有选择 Native 时跳过该专用快照；Native 来源缺失、不可用或混合选择仍拒绝。六组环境准备和三项拒绝检查已实际运行；这层只证明依赖、安装与校验器选择，真实模型、SDK Archive 和交付仍各自验收。

Classic 高难度的任务说明还在 parked proposal 的标题与正文间展示了空行，而原校验器按两行文本及其 Git 摘要严格校验。真实模型保留该空行后触发 `Parked proposal was changed`。任务现使用明确的 UTF-8 文本块，说明两行之间没有空行、末尾保留一个换行；测试将渲染后的文本与未修改的校验器常量逐字符比较。并存需求状态、未跟踪要求、交付输入隔离和原内容断言均保留，真实高难度需要另行复测。

## 授权恢复后的当前结果

以下结果更新至北京时间 2026-10-25 11:10。所有已启动的实验仍使用固定 051 产品快照，未改用历史包。当前目录和固定目录共比较 3889 个构建输入及输出文件，差异仅为回归登记文件；产品源码、构建脚本、Runtime、dist 和安装资产逐字节一致。每项实际报告的完整 `current_comet_build` 与固定候选一致。

| Workflow | 难度 | 当前结果                                                             | 实验                         |
| -------- | ---- | -------------------------------------------------------------------- | ---------------------------- |
| Native   | 低   | 通过；退出 0，23/23 检查、六项 Judge 评分及真实 SDK Archive 通过     | `experiment_20261025_101244` |
| Native   | 中   | 通过；退出 0，23/23 检查、六项 Judge 评分及真实 SDK Archive 通过     | `experiment_20261025_095206` |
| Native   | 高   | 跨会话恢复后被 GLM 额度中断，退出 1，未归档；不算通过                | `experiment_20261025_103310` |
| Classic  | 低   | 当前轮次结果见状态文件，仍需真实 Archive 及本地交付通过              | `experiment_20261025_110041` |
| Classic  | 中   | GLM 额度中断，退出 1，未归档；不算通过                               | `experiment_20261025_105209` |
| Classic  | 高   | GLM 额度中断，退出 1，未完成三项归档交付；另有上述精确文本问题待复测 | `experiment_20261025_104205` |

Native 中难度的首次独立验收发现临时 Python 检查脚本没有显式加入项目导入路径。Runtime 保留原 Shape 和已执行检查，把同一 Run 交回 Build；模型修复检查并补跑后完成独立验收和 Archive，最终为一个 goal cycle、两个实现迭代。此结果证明该实际恢复路径可推进，不代表已经测得 token 节省。

当前 GLM 接口再次返回 HTTP 429 / 1308，服务端指定下一次额度重置为北京时间 2026-10-25 14:44:28。恢复依赖授权仍然有效，不需要重新申请。保留所有中断报告和原始产物，在额度恢复后只补跑未通过的四项；高难度分别使用已修正的任务输入，不覆盖原实验。

最新确定性回归审计为 129 个分组、748 项已执行测试，所有登记的必需案例通过。它复用上一轮未变化分组的实际报告，仅补跑本轮改变的 Eval 分组；该组 14 项必需测试通过，另外 26 项未被本次精确选择。Python 当前分级场景契约 22 项通过，真实 Docker/Git 工具隔离证明保留。回归登记及基线保留检查通过；`--require-acceptance` 因真实模型附加验收仍待完成而拒绝发布，符合预期。未运行仓库全量测试、完整正式发布矩阵、真实平台 Hook 验收或 token 对比实验。

目前只有六项中的两项完成，不能宣称本轮评估完成、全部问题已验证或具备发布条件。状态、成功和失败报告、逐文件身份审计与回归报告均保存在 `eval/local/logs/`；全部完成前不发送任务完成通知。
