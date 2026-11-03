# 内置数据集完整 Native 流程修复与重跑

来源：`report:2026-11-02-native-benchmark-full-task-timeout`。用户要求先修复问题，让 SkillsBench 和 WorkBuddy 有足够时间完成整个 Native 任务，然后各重跑原题一次。模型仍为 `glm-5.3-flash`，Agent 为 Claude Code 2.1.306，关闭额外 LLM Judge。

比较基线为 `052 / 07bd301bb4c4bf65a21b2b47727c577816b7b970`，保留当前未提交的接入实现与无关修改；website 引用未变。上轮手工沿用连通性试跑的 900 秒覆盖不适合完整流程，两个 Run 在执行器的 960 秒阈值停止。本轮启动器移除该覆盖。

## 修复与确定性证据

1. 内置数据集的 Python 调度默认返回 `None`，不将原题 Agent 预算作为完整 Native 流程的截止时间；两种 Agent 循环均支持该值，显式正数预算仍有效。普通评估保留既有默认与正数校验。
2. Dashboard 数据集默认 `timeoutSeconds=0`，CLI 归属记录也保存数据集及 0 值；受管进程明确支持无截止时间，登记、手动停止、结束与清理不受影响。避免查看长任务时又被 Dashboard 的默认监管时限停止。数据集默认最多 40 次交互，与通用 Skill 预算一致，原先为 12 次。
3. 中文“请确认以上目标、范围、验收项与非目标是否准确”被旧决策识别器返回 1。增加明确中文请求语法后返回 0，已完成且无需确认的摘要返回 1；完整交互驱动通过真实确定性回复后在第二轮完成，没有用 continue 代替批准。
4. 旧 WorkBuddy 临时目录只有 tasks 和 shared，缺少根 dataset.toml。固定镜像中的上游库最小复现为 `VerifierContractError: could not find dataset.toml`。公开下载固定 HF revision `3e8ad839685c589d83a1dd60fe2d15eabb75f27a` 并核对归档 SHA-256 后，完整目录包含该文件。预览现在在模型前拒绝缺失配置，并将其 SHA-256 写入计划；Python 装配和评分前均核对，配置变化时不构建或评分。
5. 原来 `str(CalledProcessError)` 丢失评分 stdout/stderr。现在保留相关输出并先脱敏，错误仍保持失败、容器仍清理，不把异常当成 reward 0。对应旧断言找不到原始错误、修改后通过，凭据反例通过。

上游固定版本的[数据集布局说明](https://github.com/Tencent/workbuddy-bench/blob/625b2233093ae4f23e76be28c1f341d41cc70373/datasets/README.md)明确包含根 dataset.toml。没有伪造或补写上游评分规则，也没有更改原题内容。

重跑前在原任务基础镜像 `skillbench:2eff56a1-cc2.1.306` 中以 root、专用 Python `-I` 验证完整评分入口，退出 0，原未修改代码的 3 个测试均失败、reward 0.0，证明评分入口正常而不是题目已修好。日志为 `.comet/eval/launches/2026-11-02-native-benchmark-full-task-repair/scorer-preflight-root.log`。最初诊断遗漏 `--user root` 的探针因 `/logs` 权限失败；随后按实际评分调用纠正，单独保留日志，没有改评分权限策略。

WorkBuddy 原题内容仍为 `sha256:337b933858ad40e60d87948b3fc4ed9c5fd5ef7ec273dfe64808688e4263eab0`；根配置为 `sha256:9f129b518d994d417acad0440c6e8c0727a96c2e3491a11263cc81da41b3967f`。

## 已执行检查

- 新增时限解析、两种循环传播、中文请求、缺失评分配置、错误诊断，以及预览和真实受管子进程测试，取得修改前失败、修改后通过的记录。
- 6 个相关 Vitest 文件共 92 项通过；Python 数据集、决策识别与循环定向检查 57 项通过，最后数据集模块 26 项通过。
- 正式回归入口选中 4 个新 case，合并执行为 3 组、17 项通过。注册清单保留基线检查通过。
- Dashboard 桌面 1280 和窄屏 390 两项浏览器用例通过，预览请求实际携带 timeoutSeconds=0；下载仍仅由显式点击触发。
- `pnpm build` 成功，lint 为 0 错误、8 项既有警告，架构检查通过；Ruff 和受影响文件 Prettier 检查通过。
- 格式修整过程中一段临时格式化脚本按 Buffer 分段解码中文，造成登记文本的 5 处替换字符；已逐项恢复，保护性基线检查重新通过。没有改写历史行为或来源。

未运行全量测试或真实平台 Hook。沿用 0.5.4（origin/master 为 0.5.3），将最终能力合并到已有数据集 Changelog 条目，不另记开发过程中的修正。

## 当前重跑

| 数据集              | 原题                          | 次数 | Run                                             |
| ------------------- | ----------------------------- | ---- | ----------------------------------------------- |
| SkillsBench v1.1    | dialogue-parser               | 1    | comet-eval-c7e5249b-105d-44cc-89be-7bd109dd79b3 |
| WorkBuddy Code v1.0 | bug_fix-easy-a_crash_in_local | 1    | comet-eval-61dc6b34-0eb7-4d6e-a715-cad49ee5cb51 |

启动器：`.comet/eval/launches/2026-11-02-native-benchmark-full-task-repair/launch.py`。使用公开 `node bin/comet.js eval`，每个 expected-case-matrix 只有对应原题、当前 Native、rep 1。凭据只注入子进程环境；不在报告保存值。两个 Run 的受管记录均为 dataset + timeoutSeconds 0，均已进入真实模型执行。

本轮启动时 pytest 另有 14400 秒保护。模型运行结束后，内置数据集的真实任务条目改为 timeout(0)，普通任务和无关测试保持原标记。新断言修改前得到 14400、修改后得到 0；真实 `pytest --collect-only` 进一步确认对应条目有效标记为 0，日志为 `collection-deadline-probe.log`。这次 collection 没有调用模型或容器。没有宣称已实测连续运行四小时以上，也没有再次追加模型轮次。

## 执行中发现并修复的收尾问题

两个 Native 根 Run 都已 completed，领域状态为 Archive/done，但数据集没有固定模型自己选择的 change 名称，循环驱动退回了英文完成文案匹配。WorkBuddy 中文归档说明未被识别，日志持续记录 `no decision point and not complete; nudging to continue`，产生了不必要的后续交互。

新增完成探针：当前项目没有活动变更，所有 Native 根 Run、归档检查点、归属、actions 和 waits 均达到既有 SDK 完成约束后结束。不能只凭模型说“完成”，不能把子流程冒充根流程，探针不可用时不回退文案。中文完成的旧测试返回 1，新实现返回 0；未完成 SDK 即使给出英文完成声明也返回 1。SkillsBench 在真实容器中用空完成文案调用探针，返回 0。

此修复通过只读挂载的 sidecar 应用于正在运行的循环，在下一次模型调用自然结束后生效；没有强杀 Agent 或修改题目答案。修改前文件、摘要、过渡时间与最终源文件摘要保存在启动目录的 `harness-transition/` 以及两个 Run 的 `harness-transition.json`。**本轮含执行器中途变更，不是从头固定执行器版本的正式能力比较。** 自动报告的 included/valid_signal 不识别这个额外限制，需同时读取本记录。

## 正式模型运行结果

| 数据集      | Agent 退出码 | Native 完整流程                  | 原始报告分数      | 最终可解释的原题成绩                                   |
| ----------- | ------------ | -------------------------------- | ----------------- | ------------------------------------------------------ |
| SkillsBench | 0            | 状态、循环、隔离、归属检查均通过 | 0.0，评分路径错误 | 同产物修复评分后 **0.833（5/6 组；34/35 条测试通过）** |
| WorkBuddy   | 0            | 状态、循环、隔离、归属检查均通过 | 0.0，无评分器异常 | **0.0（0/3）**                                         |

WorkBuddy 北京时间 2026-11-02 23:36:27 至 2026-11-03 00:31:37，约 55 分钟；SkillsBench 至 00:33:09，约 57 分钟。两次均不再 runner_timeout，执行器自然结束；模拟交互分别为 7 和 5 次，上限 40。WorkBuddy 有 1 次真实确认识别及模拟回复。两个原始报告均为 15/16 检查通过、CLI 退出 1；唯一失败检查为 dataset_incomplete，不能把 94% 检查比例当作任务正确率。

WorkBuddy 原题评分真实执行 3 个测试，全部失败，诊断包括预期的 WeakSet 迭代次数为 1、实际为 0，以及应被清理的上下文属性仍然存在。没有因为 Native 验收通过而更改隐藏测试或将低分过滤。原报告还记录 safety_boundary 启发式评分为 0，该指标不等同于 SDK 验收，本轮未对其单独下安全结论。

2026-11-03 核对候选代码和失败断言：析构函数使用 `list(context_refs) if context_refs and attr_name else []`。三个测试通过替换 WeakSet 迭代器模拟清理期间的异常，但新建对象的 WeakSet 长度为 0，真假判断直接跳过了迭代器，导致预期迭代及清理均未发生。另外，先转为列表、再逐个清理的结构会在迭代中途异常时丢弃已取得的对象，无法保留已经可以完成的清理。流程验收通过没有覆盖这些原题边界。

两次 `execution-state.json` 均为 completed，`process-cleanup.json` 均 confirmed true，最终没有本轮 Eval 容器残留。HTML、原始事件、stderr 与原报告均保留。报告中的 token 计数含缓存量，CLI 价格估算不当作实际 GLM 账单。

## SkillsBench 同候选评分修正

原上游脚本是 `/verifier/test.sh`，内部执行 `/verifier/test_outputs.py`；适配器错误复制到 `/tests`，脚本在没有有效测试报告时写出 0 并退出 0，因此旧的 0 分不能代表模型完成质量。

修复后保持上游 `/verifier` 绝对目录，并保留正常评分的脱敏 stdout/stderr。新增回归在旧代码错误路径处失败、修改后通过，部分得分仍按原值返回。

未调用新模型，只复制已保存的 `solution.py`、`script.txt`、`dialogue.json`、`dialogue.dot`，记录四个 SHA-256 并将副本同时挂载到 `/workspace` 与原工作目录 `/app`。在固定基础镜像 `skillbench:a848d4ee-cc2.1.306` 执行修复后的原始评分脚本，退出 0，reward 0.833。原始产物和评分副本业务文件哈希均未变化。

2026-11-03 核对 `skillsbench-rescore/score.log`：pytest 实际收集 35 条参数化测试，34 条通过、1 条失败；此前“6 项通过 5 项”的表述不准确。上游固定的 [pytest-json-ctrf 0.3.6](https://pypi.org/project/pytest-json-ctrf/0.3.6/) 在 `Report.process_retries` 中去掉 node ID 的方括号参数部分，按函数名合并参数化测试，组内失败状态保留。因此报告统计为 6 组、5 组通过，原评分脚本读取该统计得到 `round(5/6, 3) = 0.833`；它不等于逐条测试通过率 `34/35 ≈ 97.1%`，也不能解读为整个 benchmark 的通过率。本次只读取日志和校验过包摘要的固定版本源码，没有重新执行评测或更改上游计分规则。

唯一失败为 `test_graph_logic[reachability]`：候选将 End 放入普通节点集合，但测试把 End 作为特殊终止标记、不将它加入遍历队列，于是断言报告 End 不可达。其余测试通过不代表整题完全正确。

重评分日志及结果位于启动目录 `skillsbench-rescore/`，原 Run 另存 `scoring-correction.json`。**没有覆盖原报告、伪造一次完整重跑或重新调用模型**；Dashboard 的旧 HTML 仍展示原始 0 分，必须结合补充评分结果阅读。WorkBuddy 没有重评分，保留原有效 0 分。

## 最终检查

后续补充的完成探针、外层预算和评分路径定向检查通过；真实 collection 确认外层时限取消。完整数据集模块为 29 项通过；合并控制器摘要检查为 51 passed、1 skipped（Windows 文件符号链接不可用）。最终正式回归入口选择 7 个新增 case，合并执行 3 组、20 项通过；Ruff 格式和检查、受影响文件 Prettier、badcase 基线保留与 `git diff --check` 均通过。此前构建成功，相关 6 个 Vitest 文件 92 项通过、桌面与窄屏浏览器 2 项通过、lint 为 0 错误 8 项既有警告，之后的新增改动限于 Python 调度、评分、完成探针及其定向测试和文档。

npm dry-run 约 18.95 MB，包含评分脚本，数据集缓存文件为 0；模型与重评分容器均已清理。website 引用保持不变。仓库全量测试、额外模型轮次和真实平台 Hook 未执行。修改未提交或推送。
