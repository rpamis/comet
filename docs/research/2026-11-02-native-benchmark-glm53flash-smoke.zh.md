# Native 内置数据集 GLM 5.3 Flash 连通性试跑

日期：2026-11-02。用户明确授权：WorkBuddy 与 SkillsBench 各选一题、各运行一次，先验证能否连通。不得自动增加题目或重复运行。

## 固定范围

| 数据集              | 任务                            | 次数 | 执行方式          |
| ------------------- | ------------------------------- | ---- | ----------------- |
| WorkBuddy Code v1.0 | `bug_fix-easy-a_crash_in_local` | 1    | 当前 Comet Native |
| SkillsBench v1.1    | `dialogue-parser`               | 1    | 当前 Comet Native |

模型固定为 `glm-5.3-flash`，Agent 为 Claude Code `2.1.306`。主 Agent、模拟用户和独立 Verifier 统一使用该模型；不开启额外的 LLM Judge。凭据从用户当前 CC Switch 的智谱配置读取，只注入子进程环境，不写入仓库或运行清单，也不改变用户的全局配置。

比较基线：`052` / `07bd301bb4c4bf65a21b2b47727c577816b7b970`，叠加本次尚未提交的数据集与 Dashboard 接入代码。两题的静态收集均确认选中一个 Native 样本。Docker Linux Engine 可用。

## 启动记录

- SkillsBench：通过公开 `node bin/comet.js eval --dataset skillsbench ... --count 1 --model glm-5.3-flash` 创建 Run `comet-eval-436dbc6f-fb33-4e52-95de-ec0f1e161ba0`。预期矩阵仅有 `dialogue-parser / COMET_NATIVE_SDK_CURRENT / rep 1`。
- WorkBuddy：通过同一公开入口创建 Run `comet-eval-d3881ab6-9604-4ed5-8155-ee25ff807a3b`。预期矩阵仅有 `bug_fix-easy-a_crash_in_local / COMET_NATIVE_SDK_CURRENT / rep 1`；等待前一条构建锁释放后开始首次镜像构建。

## 实际结果

SkillsBench 未跑通，属于环境准备失败。Docker Build `45qo2r1pu8c6kax2bdtzhh3xd` 完成了原始依赖、系统依赖及 Node 22 安装，但 `npm install -g @anthropic-ai/claude-code@2.1.306` 长时间没有完成，触发预构建的 900 秒超时。超时后 Windows 的 Docker 子进程仍持有输出管道，手动清理该任务的两个构建进程后，CLI 以退出码 1 结束。构建记录最终为 Error，失败步骤为 CANCELED；未清理其他任务或容器。

pytest 显示的 6 个 setup error 来自同一个 session 预构建失败：包括 5 个普通契约测试及 1 个真实样本，不能理解为运行了 6 个模型样本。没有进入主 Agent、模拟用户、Native 验证或原始任务评分；没有模型输出或 reward，也没有生成完成的 HTML 报告。执行状态文件为 `interrupted`，进程清理记录为 `confirmed: true`。未自动重跑。

WorkBuddy 也未跑通，CLI 退出码为 1。Docker Build `mhlnae3lzdjyuufan9mq0q9pj` 已完成原始工作区及 Python 依赖安装，进入适配层后，`npm install -g node@22` 报 `EEXIST: file already exists /usr/local/bin/node`。原始 Dockerfile 已把 Node 20.18.1 解压到 `/usr/local`，与适配层的全局安装发生冲突。现有执行器在准备样本时再次尝试镜像构建（Build `qb1qpy9sz3n9i7auphatbegvj`），在同一步失败；这两次构建均未启动模型，也不是新增模型样本。主 Agent、模拟用户、Native 验证及原始评分均未执行，没有 reward 或完整 HTML 报告。

WorkBuddy 的 pytest 汇总为 3 failed、3 passed：真实样本在镜像准备时失败；另两个 manifest 契约测试受进程级 `COMET_EVAL_DATASET_PLAN` 影响，分别出现“选择数据集任务为空”及预期 `inline-task` 却取得 WorkBuddy 任务的错误。这是需要修复的测试隔离问题，不能把它解释为两次额外模型评测失败。

| 数据集         | CLI 退出码 | 模型执行 | Native 流程 / 原始评分 | 结果                  |
| -------------- | ---------- | -------- | ---------------------- | --------------------- |
| SkillsBench    | 1          | 未开始   | 未执行 / 无 reward     | Agent 安装超过 900 秒 |
| WorkBuddy Code | 1          | 未开始   | 未执行 / 无 reward     | Node 全局安装路径冲突 |

两次授权运行均已结束，没有自动增加样本或重跑模型。当前证据只能确认两套数据集均可由公开 CLI 选择、收集单个 Native 样本并进入镜像准备；不能确认 GLM、Native 流程或原始评分已经连通。后续需先处理 Node 安装兼容、Agent 安装超时和 manifest 契约测试的环境隔离，再经用户明确要求启动新的 Eval。当前保留失败现场，不把未执行项记为通过。

启动与退出记录、镜像构建日志位于 `.comet/eval/launches/2026-11-02-glm53flash-connectivity/`，Run 状态和预期矩阵位于 `.comet/eval/runs/`。基础设施失败和未执行均不能记作通过。

## 后续修复与定向验证

来源：`report:2026-11-02-native-benchmark-bootstrap`。本节记录用户随后要求修复的代码与普通测试，不修改上述两次失败试跑的结果，也没有启动新的 Eval。

- Node/npm：从 `node:22-bookworm-slim` 复制到 `/opt/comet-node`，Agent 安装到 `/opt/comet-agent`；保留原 Dockerfile 和 `/usr/local` 中的工具，避免再次全局安装 `node@22` 的文件冲突，同时不再依赖任务镜像的旧版系统 npm。
- Agent 安装：显示 HTTP 请求及前台安装脚本输出，设置单次请求 120 秒超时、一次请求重试，并执行 `claude --version`。安装失败或可执行性检查失败都会阻止后续准备。参数含义已核对 [npm 官方配置文档](https://docs.npmjs.com/cli/v10/using-npm/config/)。这些请求级限制不改变冷构建的 900 秒总预算，也不能证明实际网络下载已恢复。
- 预构建：失败时保留末尾的脱敏日志并抛出错误，避免继续准备样本后再次尝试构建；超时诊断保留安装进度，按本次执行环境脱敏凭据。
- 超时清理：显式管理本次 Bash 构建进程，Windows 终止其子进程树，其他平台终止独立进程组。清理失败或管道仍未关闭时明确报告无法确认退出，不把它记作成功。
- 任务选择：在 pytest 配置初始化时绑定数据集计划，后续 helper 使用所属配置。独立 manifest 配置不再读取另一个会话的进程环境变量；已有 authored-task 与 baseline-treatment 断言保持不变。

确定性证据：

- 修改前新增的 5 项定向测试全部失败，修改后全部通过。随后补充了清理无法确认、预构建失败与超时脱敏等反例；清理无法确认的案例也取得修改前失败、修改后通过的证据。
- 三个相关 Python 模块：255 passed、6 skipped。跳过的 6 项需要当前不存在的缓存镜像；不能计为容器验证通过。后续安装错误处理及清理反例修改经定向测试和登记入口再次覆盖。
- `pnpm test:core-regressions` 显式选择下面 4 个案例，汇总为 1 组、4 项 Vitest 测试通过、0 失败；其内部执行 7 项对应 Python 测试。Windows 真实 Bash/Python 子进程测试确认超时及时返回、后代退出、无关进程仍存活，并保留正常退出码及输出。该测试没有启动容器或模型。
- Ruff、`pnpm lint`、架构检查、badcase 登记及基线保留检查、受影响文件 Prettier、`git diff --check` 通过。lint 有 8 条既有警告，0 错误。
- npm dry-run：压缩大小 18,939,237 字节，展开大小 73,937,678 字节；包含修复后的数据集和进程执行模块，运行缓存文件为 0。npm 的 prepare 在禁用生命周期脚本时输出跳过提示，该提示与 JSON 混合导致最初两次检查脚本解析失败；修正解析后检查通过，没有发布 npm 包。

回归登记位于 `config/workflow-regressions.json`：

- `eval-dataset-isolated-node-tools`
- `eval-dataset-agent-install-diagnostics`
- `eval-dataset-session-selection-isolation`
- `eval-build-timeout-owned-descendants`

WorkBuddy 真实镜像构建和 SkillsBench 实际 Agent 下载仍登记为 `pending`；本轮“修复”请求不构成新的 Eval 启动授权。SkillsBench 上次卡住的具体网络原因仍未定位，不能据此宣称下载问题已经验证解决。后续由本任务继续执行者在用户明确要求启动新 Eval 后，使用相同两题核对安装进度、Native 流程、模型调用与原始评分。未运行仓库全量测试、完整构建、真实平台 Hook 或新的模型评测。

版本保持 `0.5.4`：当前 `origin/master` 为 `0.5.3`，已有高一个版本的变更条目。本次在该版本的 Native benchmark 最终能力描述中补充安装隔离与失败处理，没有为开发中的修复新增版本或单列已发布问题。未提交、推送或修改 `website` 子模块。

## 修复后首次重跑

用户明确要求“重跑吧”，沿用上一轮范围：`glm-5.3-flash`、Claude Code `2.1.306`、当前 Native，WorkBuddy `bug_fix-easy-a_crash_in_local` 与 SkillsBench `dialogue-parser` 各一题、各一次。不开启额外 LLM Judge，不扩展样本，不自动增加后续重跑。

本轮启动与日志目录：`.comet/eval/launches/2026-11-02-glm53flash-connectivity-rerun1/`。仍从已校验的数据集根读取，模型凭据仅注入子进程环境；原失败运行和启动防重记录保留。

- SkillsBench Run：`comet-eval-4f9f1b08-e417-495d-b460-97eabbcd1253`，预期矩阵确认只有 `dialogue-parser / COMET_NATIVE_SDK_CURRENT / rep 1`。
- WorkBuddy Run：`comet-eval-b0df0718-a06f-4b02-8803-bd6293beb5ab`，预期矩阵确认只有 `bug_fix-easy-a_crash_in_local / COMET_NATIVE_SDK_CURRENT / rep 1`。

SkillsBench 仍未跑通，但失败位置与上一轮不同。Build `xgqpw2dalg9n79zmy08hxkqh2` 已通过独立 Node/npm 装配和 Claude Code 安装；后者用时 63.9 秒，版本检查输出 `2.1.306 (Claude Code)`。随后 `npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts` 在 199.1 秒后报 `Cannot read properties of null (reading 'edgesOut')`，整次构建用时约 5 分钟。预构建保留错误并停止，CLI 退出码 1；没有进入模型、Native 流程或评分，没有 reward 或完整 HTML 报告。pytest 的 6 个 setup error 均由这个 session 预构建错误引起，不能当作 6 个模型样本。进程清理记录为 `confirmed: true`。

WorkBuddy 也未跑通。Build `ye9wkpj2pec624qlpuoy8cy11` 已越过原 Node 路径冲突的位置，Claude Code 安装用时 83.9 秒，版本检查同样输出 `2.1.306 (Claude Code)`。随后在安装 Comet 自身依赖时用时 204.6 秒，报出与 SkillsBench 相同的 `edgesOut` 异常。整次构建约 5 分 19 秒，CLI 退出码 1，pytest 为同一预构建原因产生的 6 个 setup error。没有进入模型、Native 流程或评分，没有 reward 或完整 HTML 报告；进程清理记录为 `confirmed: true`。本轮两个授权运行均已结束，未追加后续 Eval。

新错误来源记为 `report:2026-11-02-native-benchmark-runtime-dependencies`，归于 harness 的 Comet 依赖安装。调查时首先核对：装配复制了包含开发依赖的完整 `package.json`，npm 的 [`--omit` 文档](https://docs.npmjs.com/cli/v10/commands/npm-install/) 说明省略落盘的依赖仍参与解析，且 npm 上游存在相同错误的 [公开报告](https://github.com/npm/cli/issues/9787)。随后取得了下述本项目的普通依赖安装复现，根因判断以实际对照为依据。

### 重跑结束后的依赖装配修复

两次 Eval 结束后，使用隔离目录中的普通 npm 进程进行对照，没有启动 Docker、Agent 或模型。探针固定 npm `10.9.9`，Node 为本机 `22.20.0`，使用空 npm 配置、公开 registry 和本任务专用缓存。输入来自实际 `load_dataset_tasks` 生成的清单，未修改根 `package.json` 或根锁文件。

- 修改前清单：SHA-256 `9f818cf36e69011ebcb71bb822bd7445c1efd5f5cf18af8e263fcab514178501`。执行 `npm install --package-lock-only --omit=dev --ignore-scripts --audit=false --fund=false` 退出 1，`edgesOut=true`，没有生成锁文件；debug 日志的 `#loadPeerSet` 堆栈和未完成 timer 指向 `idealTree:node_modules/vitest`。
- 修改后清单：SHA-256 `cb540b0946725507f5c1e105c62caf9b8cc291bc26f6b319ef8cfd0f2b135105`。同一 npm 版本执行真实 `npm install --omit=dev --ignore-scripts --audit=false --fund=false`，退出 0，安装 223 个包；生成的锁中没有根开发依赖及 Vitest。后一条包含实际落盘安装，覆盖前一条失败的依赖解析步骤。

复现目录位于本轮启动目录的 `runtime-dependency-probe/before/` 和 `after/`；各自保存清单、`npm.log`、`result.json`，共享缓存下保留 npm debug 日志。探针脚本为 `probe_runtime_dependencies.py`，两种模式各只执行了一次。修复前后使用相同 npm 版本，没有通过 `--legacy-peer-deps`、更换依赖版本或关闭校验绕过错误。

修复内容：数据集适配层生成仅含包身份、运行时依赖、optional/peer 声明、安全 `overrides` 与 `engines` 的安装清单，省去仓库开发依赖和生命周期脚本；完整 Comet 源码快照仍保留原始项目清单。Comet 依赖安装也增加 HTTP 日志、请求等待与重试限制。新增 `eval-dataset-runtime-dependency-graph` 回归案例，生成清单测试取得修改前失败、修改后通过；同时断言运行时依赖与覆盖规则保持一致、根清单字节未被修改。

Agent 下载的附加验收已根据本轮两个构建日志更新为 `verified`；完整 WorkBuddy 镜像及本次新修复的容器准备仍为 `pending`。上述普通 npm 安装通过不能替代新镜像、GLM、Native 流程或原始判分证据。由于本轮两次授权运行已结束，修复后没有再启动 Eval，也没有把本轮失败结果改写为通过。

本轮修复验证：数据集 Python 模块 15 项测试通过；5 个登记案例通过正式回归入口执行，汇总 1 组、5 项 Vitest 测试、0 失败。Ruff、lint（0 错误、8 条既有警告）、架构检查、badcase 登记及基线保留、受影响文件 Prettier、`git diff --check` 通过。npm dry-run 压缩大小为 18,939,706 字节，包含更新的数据集适配模块，运行缓存文件数为 0。未执行全量测试、完整构建、真实平台 Hook 或第三次 Eval；没有发布、提交或推送，版本继续保持 `0.5.4`，`website` 未改动。

用户随后要求继续修复，补充了 WorkBuddy 评分库固定与独立 Python 环境，以及公开 CLI 和普通依赖安装检查；具体结果与未完成项见[后续修复记录](2026-11-02-native-benchmark-bootstrap-followup.zh.md)。原有 Eval 结果保持不变。

## 第二次重跑：修复后 Docker 验证

用户明确要求“试下”，再次沿用原范围：GLM `glm-5.3-flash`、Claude Code `2.1.306`，WorkBuddy 与 SkillsBench 原题各一次，不开启额外 LLM Judge，不自动追加重跑。入口仍为公开 `node bin/comet.js eval`。启动目录为 `.comet/eval/launches/2026-11-02-glm53flash-connectivity-rerun2/`，不覆盖前两轮日志。

- SkillsBench Run：`comet-eval-31cedb0e-07e1-4f5b-a3ec-bb6964b759d9`，预期矩阵只有 `dialogue-parser / COMET_NATIVE_SDK_CURRENT / rep 1`。
- WorkBuddy Run：`comet-eval-7c3fe101-bf1c-4a76-8692-ad7e38ec45a5`，预期矩阵只有 `bug_fix-easy-a_crash_in_local / COMET_NATIVE_SDK_CURRENT / rep 1`。

本轮以 Docker 构建日志判定依赖安装状态。此前额外 Windows 探针的摘要校验失败和 WSL 网络失败不能代替 Docker 的实际结果。

SkillsBench 已结束：基础镜像 Build `qipzx6806f2cmv1bbmoueyzd9` 构建成功，用时 4 分 31 秒；候选 CLI 覆盖层也构建成功。5 项普通契约测试全部通过，真实题目执行容器进入第 1/12 轮，Claude Code 的模型标识为 `glm-5.3-flash`。主 Agent 随后收到 API `429 / 1308`，明确提示达到 5 小时使用上限，重置时间为 `2026-11-02 22:16:26`。没有工具调用、Skill 调用或有效模型解答，不能据此判断 Native 的完成能力。

该题仍执行了原始评分，得到 reward `0`，但样本质量标记为 `excluded / rate_limited / include_in_analysis=false`，不能把无解答的 0 分当作正常模型成绩。最终 pytest 为 1 failed、5 passed，CLI 退出码 1，已生成 HTML 和 Markdown 报告；总运行用时约 10 分 14 秒。完整报告位于 `.comet/eval/runs/comet-eval-31cedb0e-07e1-4f5b-a3ec-bb6964b759d9/summary.html`。

WorkBuddy 已结束，仍是构建准备失败。Build `slyr2ac79fyo4yg9fzguxzsqo` 用时 9 分 49 秒，完成题目原有依赖和独立 Node 装配后，在 Claude Code 安装步骤失败。npm 执行了 postinstall，但提示 `Native package "@anthropic-ai/claude-code-linux-x64" not found`，只安装了一个包装包；随后 `claude --version` 返回 `claude native binary not installed`，构建按预期停止。原生包缺失的具体下载或安装原因尚未定位，不能用先前 Windows pip 的摘要错误解释本次 npm 结果。

此时尚未安装 Comet 自身依赖或 Python 评分库，也未启动 WorkBuddy 的模型与原始评分。pytest 为同一 session 预构建失败导致的 6 个 setup error，用时 9 分 53 秒，CLI 退出码 1，没有完整 HTML 报告。来源保留为 `report:2026-11-02-workbuddy-agent-native-package`，本轮没有声称该问题已修复。

本轮汇总：

| 数据集      | Docker 与执行状态                                                   | 结果                                                        |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| SkillsBench | 镜像、候选 CLI 覆盖层和执行容器成功，调用到 GLM API，原始评分可执行 | API 429/1308 配额限制；reward 0，样本排除，不能作为正常成绩 |
| WorkBuddy   | Agent 包装器安装后缺少原生二进制，构建停止                          | 未进入模型、Native 流程或原始评分                           |

两个 Run 均已结束，进程清理记录均为 `confirmed: true`，相关运行容器为 0；保留全部结果，没有自动等待配额重置后增加重跑。本轮有效模型样本为 0。报告中的 SkillsBench `11/18` 检查和加权分只属于失败样本的诊断，不能当作 Native 能力或本轮评测通过率。

根据 SkillsBench 的真实 Docker 证据，将 `eval-dataset-runtime-dependency-graph` 的容器准备附加验收更新为 `verified`，保留原待验证记录并追加证据。WorkBuddy 完整镜像、固定 Python 评分库安装及专用解释器仍为 `pending`。后续须分别处理 Agent 原生包缺失与账号配额条件，再由用户明确要求启动新的评测；不能关闭二进制检查来绕过构建失败。
