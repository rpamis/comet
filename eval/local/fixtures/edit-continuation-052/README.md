# 编辑续行固定模型场景

这些源码通过既有 `test_task_treatment` 验证 Native/Classic 的编辑判断、检查保留和授权边界。它们只在显式加载场景插件时执行，默认测试入口不启用这些插件。

| 场景 | 当前模型负责 | 预期与禁止结果 |
| --- | --- | --- |
| A3 | 读取普通说明和正式说明的原文、连续保存后的差异，判断影响并补检查 | 原 Run、批准、报告和无关检查保留；Native 两轮补 A，Classic 一轮补 A；新鲜度负控拒绝后恢复确切字节；一次性效果和归档不重放，不新增 Builder 或独立审查 Agent |
| A4 | 判断原授权内 A 的实际行为变化，完成修订与新 Builder | 只重跑受影响的 A，保留 B/once；同 Run 新候选经模拟独立 Verifier 和 User 确认后归档一次；原批准、来源和检查定义不变 |
| A5 | 判断正式材料新增的 JSON 导出功能是否已获授权，并请求对应决定 | 无新授权时保持阶段、已接受结果、原批准、检查、实现与一次性效果；公开预检阻止归档，不开始修订、Builder、检查或交付 |

历史 Agent/Verifier/User 由可信控制器通过真实公开 CLI 明确模拟。A4 的新 Verifier/User 也由控制器模拟；当前模型负责内容判断和 Builder。结果必须按这个范围报告，不能称为完整真实多模型生命周期。Classic 使用 legacy 产物布局和 OpenSpec CLI，执行策略为 direct、审查关闭；仅加载 Comet 自有 Skill。

## 装配与静态检查

从仓库 `eval/` 目录运行。`--cli-root` 指向实际构建或安装的包根，必须含 `bin/`、`dist/` 和 `assets/`。输出目录必须尚不存在；工具不覆盖旧实验，也不修改真实 change。

```powershell
uv run python local/fixtures/edit-continuation-052/prepare.py `
  --cli-root 'D:/path/to/built-comet' `
  --output '../.tmp/edit-continuation-run'

uv run python ../.tmp/edit-continuation-run/a3/static_check.py
uv run python ../.tmp/edit-continuation-run/a4/static_check.py
uv run python ../.tmp/edit-continuation-run/a5/static_check.py

uv run python local/fixtures/edit-continuation-052/run.py `
  --assembly '../.tmp/edit-continuation-run' --scenario a3 --workflow native --mode collect
```

装配保存源码、CLI、Skill 和控制器摘要。执行前重新核对输入；源码或包变化后需要新的输出目录。静态检查及 collect 不创建业务 Run、不运行 Docker 或模型，也不构成模型通过证据。

## 真实模型执行

Native 的确定性公开 CLI 复现还可直接运行 `a3/native/driver.mjs dryrun --cli-root <已构建或安装的包根> --root <新的空项目目录>`，并将 `COMET_DATA_DIR` 指向该项目外的新独立目录。该脚本明确模拟历史 Agent/User 和当前判断，模型调用为零：先故意遗漏正式材料的保留项，验证仅补 A 会在执行前拒绝，再由原判断者追加保留项，完成两轮、字节新鲜度负控及一次归档。旧包若错误执行未选 B，原计数和失败会被保存，不能视为通过。这是公开 Runtime 证据，不是模型证据。

使用现有 Eval 环境准备 Docker 与 Claude Code 的凭据。凭据只从进程环境读取；此入口不读取本机个人设置文件、不复制 token。代理地址须能从容器访问。每次显式选择模型并授予本次模型调用权限：

```powershell
uv run python local/fixtures/edit-continuation-052/run.py `
  --assembly '../.tmp/edit-continuation-run' --scenario a3 --workflow native `
  --mode model --authorize-model --model '<实际模型名称>'
```

将 `--scenario` 换为 `a3`、`a4`、`a5`，`--workflow` 换为 `native` 或 `classic`。每个场景只运行一个样本，A3/A4 模型阶段上限 45 分钟，A5 上限 30 分钟，首次镜像与依赖准备另计。性能采样应在这些任务结束后独占执行。

控制器的原命令、工具 ID 与真实结果必须对应。固定任务说明要求 Bash 的控制器调用使用 `timeout=600000`、`run_in_background=false`，等待原调用结束；这是为了完整取得 seed/角色证明，不代替模型判断。后台任务提示或截断输出不能冒充控制器完成结果。

Native A5 将完整公开预检结果保存在隔离项目 `.git/`，工具结果只返回必要状态、完整 JSON 内容摘要及输出字节摘要，避免大输出折叠。最终校验重新读取完整证据并核对，不能用简短文字代替原始预检。A4 按 Native 的 `passed`、Classic 的 `ok` 严格判断布尔成功，在最终断言前保存实际 Node 退出码、stdout/stderr 和解析结果，失败也保留这些证据。Native 归档报告分别绑定接受时的预检摘要与最终状态生成的归档内容，二者可以因 Runtime 正常渲染而具有不同字节。

日志在各组生成目录的 `logs/experiments/`。工作区使用每次唯一的具名 `workspaces/` 目录；现有 harness 会在正式校验后回收私有 Runtime 数据卷，因此权威终态必须在本轮 validator 内核验，不能在卷已回收后将新建的空卷当作原记录。失败、超时、缺证明和模型越权均保留原结果，另开实验前说明已修正的具体原因。

可信 oracle 挂载保持只读；原始 ToolUse/ToolResult、输入摘要、检查日志、实际计数、原审批与历史 Action 绑定分别核对。静态契约位于 `eval/local/tests/scaffold/test_edit_continuation_052.py`，不会调用付费模型。
