# 内置 Eval 候选工作区构建预算

来源：`report:2026-11-12-builtin-dataset-workspace-build-timeout`。回归案例：`eval-dataset-workspace-build-budget`。

在修复前提交 `e4cfe675d52159555d3452f28d85ec1293d29501`，公开内置 Eval 的 Native Run `comet-eval-198fdf67-6fed-43f2-a3ee-4fe56af3428c` 和 `comet-eval-511d9480-de7f-43f5-a5c1-9291f22a4226` 各有两项工作区装配失败。BuildKit 在约 300 秒将冷构建记录为 canceled，而任务声明 `buildTimeoutSeconds: 1800`。两 Run 的模型原始输出目录为空，容器归属记录没有模型容器，尚未进入模型阶段。保留原始控制台记录和 Run，不把失败评分写成模型成绩。

会话级预构建已读取题目预算；`prepare_dataset_workspace` 调用的 `utils.build_docker_image` 仍固定使用 300 秒。本次仅让该 helper 读取既有 `.dataset-task.json` 的构建预算。非数据集任务继续使用 300 秒，不新增配置字段，不放宽模型或评分预算。

预期：声明 1800 秒的构建不因 300 秒固定上限被取消；显式较短预算保持生效；普通镜像仍限 300 秒。禁止：无条件延长普通任务、忽略短预算、吞掉真实模型低分或重跑已经进入模型的样本。

同一确定性回归模拟需要 301 秒的构建：旧代码为 2 failed / 1 passed，新代码为 3 passed。相关 Python 定向检查共 7 passed；Vitest 精确入口 `honors dataset workspace build budgets without extending ordinary image builds` 为 1 passed，内部运行 3 项 Python 参数化检查。Windows 首次普通测试退出时碰到此前管理员临时目录的 ACL；改用本任务独立临时目录后，取得了上述完整红绿结果，没有修改系统临时目录权限。

真实公开 Eval 恢复证据尚待完成；本记录不把普通测试等同于真实模型验证。未运行全仓测试，改动范围为一个 Python 构建 helper 及其回归测试、登记和说明。

## 用户要求取消固定构建总时限

后续来源 `report:2026-11-12-eval-no-build-deadline` 明确要求不要让固定时间限制卡住评估。增加进程环境选项 `COMET_EVAL_BUILD_TIMEOUT_SECONDS=0`，让候选工作区装配与会话预构建都使用 `timeout=None`。未设置选项时仍兼容原有显式数值预算；普通构建默认值不变。Windows 的构建锁同时支持不设等待总时限，并在取得后正常释放。原始任务文件与评分预算不改写。

相关 Python 检查共 10 passed，覆盖两种构建入口、原任务预算保留、Windows 锁等待与释放、原有数值预算及进程超时清理。真实公开 Eval 结果仍在执行中。
