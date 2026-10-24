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

高难度首轮已到达真实 blocked Verify 边界，但控制器直接执行 Python 校验器时，扁平 `/opt/python` 安装布局触发了包初始化，因找不到顶层 `scaffold` 包而退出。原实验 `experiment_20261025_042537` 保留为失败。独立脚本现从其自身目录加载标准库实现的兄弟校验模块，包内调用保持相对导入；边界状态、原 Action、候选和一次性检查校验没有跳过。隔离 Python 布局下先复现导入失败，再验证能进入正常的状态校验。

中难度首轮的业务、独立验收与真实 SDK Archive 均通过，Agent 却在 Run 已完成后继续处理临时项目的知识学习，最终超过 40 分钟执行期限。原实验 `experiment_20261025_034211` 保留为失败。该任务现明确临时 fixture 不产生持久学习，完成必须的验证、归档及 Classic 本地交付后给出结束响应；原业务和终态校验未放宽，另行重跑中难度。

Classic 高难度配置给 Agent 80 分钟，但原 pytest 外层只有 70 分钟，不能完整提供已配置的执行预算。实际 runner 的 timeout marker 与用例预算关系已先验证失败，再把外层期限设为 100 分钟，覆盖执行、验证、评分与清理。各任务自身的 Agent 期限保持原值。

保留全部失败与成功实验、原始脱敏记录、各例归档路径和同候选核对结果。最终报告分别列出六组状态、归档与交付证据、badcase 执行结果、已修复问题和未完成项。当前配置与历史调试实验只提供调查线索，不能预填为通过。
