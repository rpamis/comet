# Eval

<!-- comet-development-rule:eval -->

- Python Eval 命令从 `eval/` 目录运行，使用锁定环境中的 `uv run pytest` 和 `uv run ruff`。
- Docker、shell 和凭据准备属于 host harness；容器内验证不得依赖宿主私有路径或真实用户配置。
- 静态 scaffold/validator 测试、Docker 场景和真实模型 Eval 分别报告，不能用收集成功或静态测试替代真实运行。
- 失败归因区分 harness、workflow、task 和 model；环境噪声可以标记，但真实低分和行为失败不能因结果不好被过滤。
- API token 只从环境变量读取，不写入 fixture、日志、报告或仓库文件。

## Native / Classic 行为覆盖

- 用户问题修复遵循根 `AGENTS.md` 的完成标准及 `docs/architecture/badcase-maintenance.zh.md`，按独立行为关联来源、回归案例与实际执行证据；不要仅增加描述或场景文件就宣布已沉淀可执行 badcase。
- Native 和 Classic 各自验证公开入口、合法推进、关键阻塞、批准/拒绝、候选失效、恢复与迁移等受影响行为；共享基础设施通过不能证明两个 workflow 都通过。当前版本的验收要求见 `eval/local/RELEASE_GATE.md`。
- 对每个场景分别定义期望产物/状态和禁止结果，包括越权推进、伪造或复用失效证据、跨 workflow 污染、恢复重复执行等相关反例。不能只断言最终文本、文件存在或退出码。
- 确定性 Runtime/公开 bundle 测试验证产品状态契约；真实模型 Eval 验证模型是否遵循协议；真实平台 Hook 与浏览器交互分别验证平台/UI 边界。静态 validator 或 mock adapter 通过不能替代后两类证据。
- 真实模型未运行、凭据/容器缺失、超时和失败均如实记录，不能按通过计入发布结论；保留失败场景、执行上下文和归因，不为提高通过率删除历史案例或降低断言。
