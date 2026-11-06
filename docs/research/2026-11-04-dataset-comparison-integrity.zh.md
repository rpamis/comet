# 数据集对比中的身份取证和参考答案访问

来源：`report:2026-11-04-deepseek-dataset-comparison-integrity`。用户指出 DeepSeek 的 bugfree/普通 Native 结果不可靠，要求修复并准备重跑。

先完成确定性修复和重跑准备；用户随后明确要求重新启动 Eval，已完成 DeepSeek 两组各一次。原题内容、评分器、历史分数和失败记录保持原样。版本沿用 `0.5.2`。

## 已复现的行为

原运行基线为 `0c75bfaab8507c3931b9816ce2f59517613f033e`，题目为 WorkBuddy `reliability-hard-pipeline_reconnect`。

- bugfree Run：`comet-eval-b3abfe3a-b49c-42c9-bb30-293366a7ed67`，原题 11/14。
- 普通 Native Run：`comet-eval-f609d80c-834b-4cd1-bf52-7cde63584726`，原题 14/14，但主 Agent 于 `2026-11-04T13:25:07.825Z` 联网下载 WorkBuddy 数据集，随后读取 `gold.patch` 和评分脚本；独立审查也读取了这些材料。
- 两组均出现 `dataset_verify_mode_unavailable: SDK owner does not match this change and application`，却仍被标为 `include_in_analysis=true`。

根因分别是：评分副本无法解析绑定原 checkout 实例的 Runtime owner；执行端缺少基准答案访问限制；统计把模式身份核对失败当作提醒，并且没有审计参考答案访问。

初始定向检查出现 14 项失败，确认原取证调用没有读取原 checkout、没有答案访问规则、污染样本仍会纳入统计。随后增加的旧报告兼容检查也先出现 3 项失败，确认旧 `flagged` 元数据会绕过新排除规则。

## 修复后的边界

### 从原工作区取证

评分控制器先运行单独的只读取证命令：原候选挂载到 `/workspace:ro`，原 Runtime 数据卷挂载为只读，网络为 `none`。查询仍校验 SDK owner、真实 Run、根 Run 完成状态及归档 checkpoint；临时 inspect 请求写入容器临时目录。

评分进程随后使用候选副本，不能访问原 Runtime 数据卷。最终模式证据来自控制器的取证结果；评分脚本输出的同名字段不能覆盖它。取证失败保留原题评分，另行记录 unavailable，不把它写成已证明的模式不匹配。

公开 CLI 临时项目测试已确认：原工作区可查询真实 Run，查询前后候选文件和 Runtime 文件摘要不变；复制 checkout 后仍拒绝 owner 不匹配。Docker 挂载边界由后续授权重跑的真实结果单独验证，见下文。

### 限制和审计参考答案访问

所有内置数据集的执行提示都明确要求使用提供的题面、工作区、普通依赖文档和自写测试，禁止检索基准数据集、参考解、gold patch 和评分材料，并要求独立 Verifier 遵守相同约定。

Claude Code 的数据集循环加载相同的 `PreToolUse` Hook，拦截本次发现的公开基准下载地址和答案路径。规则位于只读 scaffold 中，通过调用参数加载，不修改真实用户设置；新会话和续行都携带该设置。普通任务测试、依赖文档、编写测试及给 Verifier 的禁止访问说明保持可用。Hook 使用官方支持的命令 Hook 阻断方式，参见 [Claude Code Hooks](https://code.claude.com/docs/en/hooks)。

判分后，控制器检查工具调用记录，并读取隔离候选 HOME 中的 Claude 主会话及子 Agent JSONL。只检查实际工具输入，不把讨论“不要读取答案”的文字当作访问行为。命中的材料位置及来源进入报告，原始命令或凭据不进入新增审计字段。

这里拦截的是已知地址和路径，不是通用网络沙箱。任意编码、其他镜像站或自建下载程序仍可能绕过文本规则；其他 Agent 当前只有提示约束和已有工具遥测审计，没有 Claude Code 的 Hook 保证。真实 Claude Code 对 Hook 的执行和继承行为仍需本轮准备后的真实 Eval 确认。

### 无效样本不进入对比

参考答案访问尝试、模式证据缺失、实际模式不匹配均标为 excluded，原题 reward、测试计数和失败归因保留。此规则优先于部分遥测提醒。读取历史报告时，这三类旧 `flagged` 标记也不能重新进入分析。

正常完成但原题低分的样本仍按原有规则参与统计，不因得分低而排除；部分评分失败与执行环境中断仍分别记录。不能把 11/14 改成满分，也不能把读过参考答案的 14/14 当作模式正确率证据。

## 回归登记

四个独立行为写入 `config/workflow-regressions.json`，历史案例全部保留：

| case ID                               | 行为                                                           | 自动验证边界                                                      |
| ------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| dataset-native-mode-original-checkout | 原 checkout 取证，副本不能冒用 owner，评分输出不能伪造模式证据 | 公开 CLI 临时项目和控制器调用测试；容器取证已由本轮授权 Eval 验证 |
| dataset-reference-tool-access         | 拦截已知答案获取，允许正常测试、文档和委派                     | Hook 输入/退出码和 CLI 参数夹具；真实模型 Hook 待验收             |
| dataset-reference-exclusion           | 主会话或独立子会话的答案访问排除出对比，保留分数               | 工具记录、子会话 JSONL、验证器及 sample quality                   |
| dataset-mode-quality-exclusion        | unavailable/mismatch 和旧包含标记均排除出对比                  | 质量规则和旧报告兼容                                              |

测试入口为 `test/domains/eval/builtin-dataset-bootstrap.test.ts` 中四个精确选择器。原有只读 Runtime 挂载测试改为检查独立取证容器，并增加评分容器不得挂载 Runtime 的断言；没有删除原保护或缩窄历史来源映射。

## 已执行及未执行

已通过：相关 Python 数据集、审计、sample quality 和归因测试；新增 Vitest 回归入口；公开 CLI 临时项目；Ruff；受影响文件格式及 diff 检查；badcase 基线保留检查。具体数量和静态收集结果写入本机重跑准备记录。

用户删除根目录 `.ruff_cache` 后，重新运行 `pnpm lint` 已通过，包括架构检查。ESLint 为 0 错误、8 项既有 Dashboard 提醒。

修复和静态准备阶段未执行容器或真实模型 Eval；后续经用户授权完成的两组实评见下文。仓库全量测试和非 Eval 的真实平台 Hook 仍未执行，不能由静态收集或 Hook 协议夹具代替。容器取证已取得实际证据；真实模型被 Hook 拒绝读取的负例仍为 pending，不作为已验证关闭的问题提交 PR 声明。本次修改不涉及产品 Runtime 源码或发布 bundle，因此没有重建 Runtime 生成资产。

## 重跑准备

沿用 CC Switch 的 Claude Code DeepSeek 配置，题目仍为 `reliability-hard-pipeline_reconnect`，bugfree 与 standard 各一次，关闭额外模型 Judge。使用新适配器和相同产品快照重新静态收集，避免沿用上一轮计划中的旧适配器摘要。

启动前冻结同一个提交/产品快照、模型映射、镜像与交互配置；两组都必须带相同答案访问规则。真实评分阶段必须获得原工作区模式证明。若任一组再次访问参考材料或缺少模式证明，记录原分数并排除该样本，不能自动补跑。

静态 `--collect` 不启动模型或 Docker。下面记录用户随后明确授权启动的结果。

## 授权重跑的实际结果

用户要求使用 `comet eval`。全局安装仍为 0.5.1，本次通过进程内命令映射调用冻结的仓库版 0.5.2，不修改全局安装。`uv` 只作为 Comet CLI 内部的 Python 环境和评估框架实现；修复阶段手工执行的 `uv run pytest` 是确定性回归测试，不计为真实模型样本。

冻结基线为 `3c40cd26235441549e00e265881d56fb49b72c62` 加本任务未提交修复，共 6,317 个文件，摘要为 `sha256:07c03931ed830bff0cd88cba55881b3d7b4370e98ee6a554fd733d5c197c72ee`。运行期间冻结代码未改变。两组产品构建、执行身份和比较身份完全相同，实际镜像均为 `sha256:1d9f52d232ddde422e197fb8686d53bec603ec54e368f8f2da19231b75bd7228`。

题目保持 `reliability-hard-pipeline_reconnect`，每组一次，没有补跑。沿用 CC Switch 的 Claude Code DeepSeek 配置，参数为 `deepseek-flash[1M]`，Claude Code 2.1.306；保存的主会话和独立审查会话实际模型均为 `deepseek-flash`。

| 指标                                  |                  bugfree |        普通 Native |
| ------------------------------------- | -----------------------: | -----------------: |
| 原题评分                              |                    10/14 |              10/14 |
| 模式证据                              |        matched / bugfree | matched / standard |
| 参考答案访问告警                      |                        0 |                  0 |
| 样本质量                              |                 included |           included |
| Verify 耗时                           |              19分44.62秒 |         3分04.25秒 |
| Verify 消息 Token，含缓存读取         |               13,267,258 |            731,201 |
| Verify 输入加输出 Token，不含缓存读取 |                  245,306 |             62,401 |
| 正式测试计划                          | 1项，恢复后重跑，共320ms |         1项，152ms |
| 独立 Verifier                         |          1个，原会话续审 |                1个 |
| 单案例墙钟时间                        |              36分51.46秒 |        17分44.95秒 |

两组均完成独立验收、评估内模拟确认和归档。Managed Run 均 completed，清理均 confirmed=true，结束时没有运行中的 Docker 容器。退出码均为 1，唯一失败检查是 `dataset_incomplete`，来自原题未满分，没有模式取证或参考材料访问告警。

bugfree Run 为 `comet-eval-95efa3d6-9e47-407b-97da-af74d577a82c`，普通 Run 为 `comet-eval-e633bf6a-b38e-43d6-9dcd-ed7414e3bbbe`。本机报告位于 `.comet/eval/launches/2026-11-04-native-deepseek-integrity/comparison.md`，正式报告位于该目录下 `source/.comet/eval/runs/<run-id>/`。

本轮没有体现 bugfree 的省时或省 Token 目标。其审查结果先被 Runtime 以“复核通过的编辑尚未应用”拒绝，相关 `edit-review prepare` 又出现空列表；主 Agent 恢复批准过的 brief，并通知原 Verifier 续审后才完成。两轮正式测试仅用 162ms 和 158ms，主要开销发生在状态查询、诊断、材料恢复和反复提交上。尚未为这段恢复关系取得最小复现，不能直接宣称某个新的恢复缺陷已修复。

两组相同的四个失败项涉及 WATCH 失效后仍重放，以及 INCR 断线的异常类型。两组均没有按原题评分约定抛出 WatchError；其中 `incr works without reconnect` 还检查后续断线分支，不能按名称误判成正常 INCR 完全不能工作。两组自写测试与独立审查均漏掉了这些原题约定，原分数完整保留。只有各一次，不能由同分推断一般正确率已经保持不变。

Verify 时间来自约十秒采样，覆盖首次观察到 Verify 至首次观察到 pass。Token 按 API 消息 ID 去重，包含主会话和独立审查，排除用户模拟会话；采样端点存在少量误差。正式报告的 `workflow_total_tokens` 仍为 null，CLI 顶层主执行统计不能当作完整流程总量，CLI 费用估算也不是 DeepSeek 账单。

原工作区容器取证已取得两组 matched 的真实证据，`dataset-native-mode-original-checkout` 的附加验收更新为 verified。两组实际进程都加载了相同答案访问 Hook，但没有发生真实的禁止读取尝试，因此不声称已经观察到真实模型被 Hook 拒绝；`dataset-reference-tool-access` 的该项验收继续 pending，不为补齐它增加样本。
