# Native 053 与 040 历史对照执行记录

用户授权范围：使用 cc-switch 的 Claude Code / DeepSeek 配置，复用历史 16 题，每题 3 次，共 48 次；040 及旧 Native 使用历史结果，不追加模型轮次。实验清单与报告不保存凭据。第一轮 pytest 异常追踪曾将 provider 环境值写入本地控制台日志；保留日志已精确脱敏，后续控制台在落盘前替换凭据。

## 代码与普通验证

- 已合并远端 053 的 PR #549，并提交全部原有本地改动：`020fc7ed`。
- 当前 SDK 的旧任务环境适配与公共 CLI 清单：`5067c728`；共享 Node 22 工具层：`4234fcab`。
- 完整构建、lint / architecture、生成 Runtime 检查和 badcase 登记基线检查通过；lint 有 9 条既有 warning。
- 新增归档恢复 7 项通过；受合并影响的 Native SDK application 整文件 125 项通过，耗时 700.11 秒。
- 环境与相邻 SDK 验证器定向检查 86 通过、2 项原有跳过。共享工具层改动后的相关检查 30 项通过。
- 本任务没有重新执行仓库全量测试、完整安装验收或独立真实平台 Hook 验收。

## 第一轮实际失败

实验：`comet-eval-10f01cd3-40a7-4670-bd0c-2f7c0bdc4536`，受测提交 `4234fcab998aeca0e66ab4e78801725d66ba7cd0`。

公共 `comet eval` 调度了准确的 48 项与 4 个执行器；pytest 实际结果为 **48 setup errors**，耗时 632.89 秒，CLI 退出 1。全部错误发生在 `prebuild_docker_image` 会话夹具中，业务任务函数尚未进入；没有模型运行、业务评分或逐样本 report。不能把它写成模型 0/48 或 Native 准确率 0%。

原 Run、48 项 expected matrix、Dashboard 状态与完整控制台日志均保留。结束后观察到 Run 状态为 `interrupted`，没有该实验的活动容器。第一轮的脱敏控制台日志位于 `coverage/native-053-vs-040-20261111/attempt-1-console.txt`。

两个独立准备行为：

1. 会话预构建直接构建选中任务的原始旧环境，绕过后续 case 工作区中的 Native SDK 适配。原始镜像仍安装 OpenSpec 及写死的 `latest` Claude Code；日志实际下载到 2.1.322，Node 为 20.19.2，最终 npm 报 `ECONNRESET`。这是准备环境失败，网络中断的外部原因未确定。
2. 其他执行器等待 Windows 构建锁时仍使用固定 600 秒，而一次普通冷构建已经允许 900 秒。等待到期后抛出 `PermissionError: [Errno 13]`。该错误来自锁等待，不足以认定工作区文件权限配置错误。

## 准备路径修正与证据

当前 SDK treatment 跳过原始环境的会话预构建，改由既有 case 工作区准备路径安装所选 CLI 快照、适配 Node 22，再构建实际执行镜像。Classic 与其他 treatment 保留其预构建路径。

Docker 构建锁的等待预算与该次构建预算相同；普通构建仍为 900 秒，数据集继续读取既有 `buildTimeoutSeconds`。没有增加项目配置、模型预算或重试轮次，也没有修改业务验证断言。

新增快速回归直接驱动原会话夹具与构建包装器：修复前 2 项失败、1 项对照通过；修复后相关 4 项通过。`test_conftest_helpers.py`、当前 Native 适配、原 Native 对齐验证与数据集准备合组 **176 项通过**，耗时 13.67 秒；Ruff 通过。

独立无模型容器预检已成功构建当前共享工具层，实测 Claude Code `2.1.318`、Comet `0.5.3` 与 `comet native --help` 均退出 0。这只证明工具环境，不替代模型 Eval。首次旧结构预检超出预定等待后，控制进程已结束；底层 Docker 构建后来完成，镜像和日志保留，没有把它描述成已成功强制取消的构建。

这是本次维护者 benchmark 接入中的准备问题，没有用户 Issue 或线上行为修复关闭声明。原模型 Eval 失败保持原状；修正后的同一 48 组需要新的明确启动请求，不能以定向单测或镜像构建通过冒充已经重跑成功。

## 历史来源复算

- 040：`combined_comet_workflow_full_k3_20260705_v3_rerun_failed`，43/48 strict pass，16/16 pass@3，12/16 pass^3。
- 旧 Native：`experiment_20260716_104344`，46/48 strict pass，16/16 pass@3，14/16 pass^3。
- 两组原始轨迹中的模型为 `mimo-v2.5` / `mimo-v2.5-pro`，本轮所选模型为 `deepseek-flash[1M]`。不同模型和时段的结果只能作历史对照，不能把差异单独归因于 Native 精简。
- 旧 Native 的 `comet-observability-env-template / r3` 保存了有效 result，耗时 115.64 秒；当前解析器再次对完整 JSON 字符串脱敏时会丢掉该 result。离线报告改为先解析已经保存的 JSON，再提取结构化事件；没有修改历史文件或正在执行的 Eval。恢复后 Native 原报告的 48/48 耗时分母可复算，040 有 47 条可观测耗时。

## 第二轮与已授权补齐

用户明确授权第二轮沿用同一 48 项与 4 并发。实验 `comet-eval-e045fc18-7b27-4dc4-a4da-96b94d973d52` 使用提交 `054952b8`，最终为 **44 passed、4 failed**，耗时 4446.02 秒，CLI 退出 1；44 份实际模型评分全部严格通过。

4 个失败均在模型启动前发生：`agent-memory-routing`、`dependency-confusion`、`graph-execution-review`、`layered-streaming-fix` 的 r1。原始异常均为 `docker.sh execution-identity` 超出 300 秒；这个只读身份查询隐式触发了冷构建。Windows 杀掉外层 Bash 后，Docker 子进程仍持有输出管道，导致异常直到底层构建结束才返回。4 项没有模型原始轨迹或评分，不计作模型答错。

修复 `be8de941` 先通过已有构建入口准备镜像，再读取身份；身份查询沿用 300 秒，只管理自己的进程树。原代码下新增 2 项回归失败，修复后相邻检查 **283 通过、6 跳过**，耗时 160.32 秒；跳过项依赖未缓存的专用 Classic/Native 镜像。Ruff 检查与格式检查通过。真实无模型容器预检成功读取身份。修复在隔离工作树验证，第二轮结束后才合入并推送 `053`，没有改动正在执行的候选。

用户另行明确授权仅补上述 4 项 r1，各 1 次。补齐实验 `comet-eval-04c215f0-3983-451f-b718-801e71d81f0b` 使用 `be8de941`，结果 **4 passed**，耗时 343.80 秒，CLI 退出 0。原批次和原失败记录保留，没有覆盖已执行的模型样本。

合并得到准确的 **16 题 × 3 次、48 份真实模型评分**：strict pass@1、pass@3、pass^3 均为 100%，业务检查 48/48。累计模型耗时 48/48 可观测，均值 159.7765 秒、中位数 148.129 秒；这些数值不包含镜像准备。全部受测产品构建保持相同，只有补齐所用的 harness 修复不同。

主模型参数为 `deepseek-flash[1M]`。cc-switch 同时把快速模型和默认模型映射到 `deepseek-v4-flash` 系列；3 个 Native 样本的轨迹同时报告了 `deepseek-flash[1m]` 和 `deepseek-v4-flash`。报告保留实际模型标签，不把不同标签强行合并成单一模型证明。

原始评分、轨迹和控制台仍保存在各 Run 与 `coverage/native-053-vs-040-20261111/`；报告只导出计数、用量和评分，不导出工具命令或凭据。

## 已确认的新对照：Native 0.4.0-rc.1

用户进一步明确目标为 **0.4.0-rc.1 的 Native**。主对照改为 Native 0.5.3 与 Native 0.4.0-rc.1，两组使用相同 cc-switch DeepSeek 主模型、快速模型映射、Claude Code 2.1.318、16 题 × 3 次与 4 个执行器。053 的 48 份评分不再重跑；历史 MiMo 数据保留作参考。

控制器曾将“040”误读为旧 Classic，并做了无模型准备和一次静态收集。没有启动 Classic 模型评估，不能给它记任何新模型成绩。准备中的两个 npm 下载曾报 ECONNRESET，日志保留；6 个环境完成了工具版本验收。用户纠正后已结束准备控制进程，残留的底层构建随后自行完成；确认没有对应活动客户端或构建。Classic 专用实验清单和版本替换实现已撤回。

固定来源是 npm 的 `@rpamis/comet@0.4.0-rc.1` 已发布包，压缩包 7,064,048 字节，解包后 28,384,354 字节。Git tag 对应 `0c7f87ba`；发布包中的 Native 19 个文件与 tag 逐字节一致，没有修改原始 Skill、Runtime 或业务用例。

rc.1 的 Native 使用公开 `comet native` CLI。评估通过已有 `BENCH_COMET_SOURCE_ROOT` 读取已发布的 bin/dist/assets 快照，使用 `published-dist` 路径而不重新编译旧源码。镜像安装 rc.1 自己声明的依赖和 overrides，避免混用 053 的 commander 等依赖。Node 使用 22，Claude Code 固定 2.1.318；当前 053 CLI 不作为 rc.1 的执行入口。

`native-040-rc1.yaml` 选择原来的 16 题；`treatments/comet/native_040_rc1.yaml` 指向缓存中的冻结 Native Skill。通过已有 `BENCH_TREATMENTS_DIR` 加载实验 treatment。前置提示只约定版本和 Native 对应阶段，保留 rc.1 自身的批准、独立审查、Verify 与 Archive 协议，没有套用 053 的 SDK owner 或同会话验收规则。

新增两项快速回归在改动前失败，完成适配后相关检查 135 通过、1 跳过；跳过项是在当前 Windows 环境中不能创建文件符号链接的检查，未当作通过。Ruff 与 architecture 检查通过。16 个任务环境均完成实际无模型预检：Node 22.23.4、Claude Code 2.1.318、Comet 0.4.0-rc.1，native 命令帮助退出 0。rc.1 模型样本尚未启动。

复现时先把 `@rpamis/comet@0.4.0-rc.1` 解包至 `coverage/native-053-vs-040-20261111/native-040-rc1-package/package/`，再临时注入 cc-switch 的 DeepSeek 凭据和模型映射。凭据不写入命令行、配置文件或报告。普通准备与静态收集不等于模型运行；新的模型评估仍需用户明确请求。

```powershell
$env:BENCH_COMET_SOURCE_ROOT = (Resolve-Path 'coverage/native-053-vs-040-20261111/native-040-rc1-package/package').Path
$env:BENCH_TREATMENTS_DIR = (Resolve-Path 'docs/research/2026-11-11-native-053-vs-040/treatments').Path
$env:BENCH_CC_VERSION = '2.1.318'
$env:BENCH_LLM_JUDGE = '0'
$env:PYTEST_ADDOPTS = '--treatment=COMET_NATIVE_040_RC1 --count=3 -n 4 -k test_task_treatment'
node bin/comet.js eval --project . --manifest docs/research/2026-11-11-native-053-vs-040/native-040-rc1.yaml --agent claude-code --model 'deepseek-flash[1M]' --base-url https://api.deepseek.com/anthropic --html
```
