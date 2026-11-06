# WorkBuddy 到模型入口的修复与验证

来源：`report:2026-11-02-workbuddy-agent-native-package`。用户明确授权“修复 workbuddy 的问题，直到到达模型那里”。本轮只使用 WorkBuddy Code v1.0 的 `bug_fix-easy-a_crash_in_local`，模型保持 `glm-5.3-flash`，Agent 保持 Claude Code `2.1.306`；不运行 SkillsBench。修复构建和准备问题所需的尝试分别保留，观察到首个模型响应或明确 HTTP API 错误后停止，不执行完整题目评分。

## 已复现问题与修复

上一轮 Run `comet-eval-7c3fe101-bf1c-4a76-8692-ad7e38ec45a5` 的镜像安装日志显示：npm 的安装命令退出 0，postinstall 却报告缺少 `@anthropic-ai/claude-code-linux-x64`；最后由 `claude --version` 检查阻止继续。平台原生包属于可选依赖，下载或安装失败没有使包装器安装本身失败。

现由 `eval/scaffold/python/install_claude.py` 先读取指定版本的 npm 元数据，再将该版本声明的当前平台原生包作为顶层必装项，与解析出的固定包装器版本一起安装。保留 npm 完整性检查、安装脚本和安装后的二进制版本检查；不支持的平台在安装前明确失败。没有平台原生包声明的旧版 JavaScript 包保留原有安装路径。

网络请求时限由 120 秒改为 300 秒，重试仍为一次。Docker 使用 BuildKit 的独立 npm 缓存，失败重试可复用已完成下载，缓存不进入镜像层或 npm 分发包。安装器纳入控制器摘要，评分前也核对其字节；模型修改构建安装器时拒绝继续构建。

本轮首次构建还复现了 900 秒不足以完成全部评分依赖下载的问题。带 `.dataset-task.json` 标记的内置数据集现允许最多 1800 秒构建，普通任务保持 900 秒，超时仍保留诊断并失败。新增定向断言在旧时限下失败、调整后通过，覆盖数据集成功、普通任务限额和数据集超时诊断。

既有“安装进度和失败传播”测试名称、成功路径、安装失败、二进制检查失败及退出码断言均保留；原内联 shell 安装改为独立安装器后，测试通过注入进程执行器覆盖相同分支，并额外检查目标原生包为顶层依赖、实际版本固定、旧包兼容、错误平台拒绝和安装器篡改拒绝。日志级别由 HTTP 提升为 verbose，以显示 npm 对可选依赖的处理。

## 执行记录

比较基线：`052 / 07bd301bb4c4bf65a21b2b47727c577816b7b970`，叠加本次未提交接入与修复。修复前的 Docker 日志来自本次开发中的接入实现，不是已发布版本。

启动器位于 `.comet/eval/launches/2026-11-02-workbuddy-model-boundary/launch.py`。凭据只注入子进程环境，不写入文档；公开入口为 `node bin/comet.js eval --dataset workbuddy-code ... --count 1 --model glm-5.3-flash`，交互上限设为一轮。观察器只读取本 Run 标签下的执行容器，记录脱敏后的模型事件后调用 Eval 公开停止入口 `requestStopEvalRun`，核对进程与容器清理。

- 尝试 01：Run `comet-eval-6582a713-5ef1-4ec1-853a-b86ed2c9c156`，预期矩阵只有原定 WorkBuddy 题目、当前 Native 和 rep 1。Docker Build `7y86zpxkyvc5c258jp94hrxmd` 的 Agent 安装成功，用时 230.4 秒，版本检查返回 `2.1.306 (Claude Code)`。900 秒时仍在安装评分依赖，pytest 报错退出，没有调用模型。Windows Bash 后代清理未能确认，Docker 构建仍在继续；明确定位本次上下文后接管监督，保留原失败记录。构建最终用时 23 分 55 秒成功，固定 WorkBuddy 与 Harbor 0.18.0 真实安装成功；完成后只清理匹配该上下文的残留 Docker 客户端 PID 56472、73108，复查已无匹配进程。Windows 脱离 Bash 进程树后的超时自动清理尚未修复，不能将这次人工接管记为自动清理通过。
- 尝试 02：Run `comet-eval-95137a7d-faad-4cbe-8dbb-455abeaf36e0`，同一题目、模型和一轮上限。复用基础镜像 `skillbench:2eff56a1-cc2.1.306`，候选 CLI 覆盖层 Build `qy93h6p06ilne79k53tysxu0v` 用时 3.7 秒成功，5 项普通契约通过。北京时间 2026-11-02 22:40:44 收到真实 `assistant` 事件，`message.model=glm-5.3-flash`，任务内容已进入模型上下文；首次事件包含模型思考片段，不能据此认定最终答案或任务完成。
- 观察器在首次模型事件后调用 `requestStopEvalRun`。停止返回成功，22:40:55 确认 `execution-state.json=status: stopped`，`process-cleanup.json` 与 `owner-cleanup.json` 均为 `confirmed: true`，执行容器已清理。停止过程中已有“加载 Skill”进度事件，不能声称停止瞬间没有后续事件。没有继续执行完整题目、独立验收或原始评分；CLI 退出 1 来自主动停止，不记作评测通过。

直接证据位于 `.comet/eval/launches/2026-11-02-workbuddy-model-boundary/attempt-02/` 的 `model-boundary.json`、脱敏事件、`stop.log` 和 `result.json`。首次模型事件摘要为 `8ee2bb69450908c0dc1003f00353fafc09053793ae26b54b4eb1f3518f13abe8`。Run 目录保存上述停止和清理回执。

## 定向检查

初轮数据集模块 19 项测试通过；补充冷构建限额后的数据集及控制器摘要测试为 42 passed、1 skipped（Windows 文件符号链接不可用）。正式登记案例执行器运行引导回归文件，9 项通过。Ruff 格式和检查、Prettier、badcase 登记及基线保留检查、`git diff --check` 均通过；lint 为 0 错误、8 项既有警告，架构检查通过。

未执行仓库全量测试、真实平台 Hook、SkillsBench 重跑、完整 WorkBuddy 任务及原始评分。WorkBuddy 专用评分解释器的实际评分仍为 pending；安装成功和模型入口响应只证明准备链路已走通，不能记为 Native 能力通过。当前版本 0.5.4 高于 origin/master 的 0.5.3，沿用同一版本，并将最终安装及构建行为合并到既有数据集能力条目。
