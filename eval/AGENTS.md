# Eval

<!-- comet-development-rule:eval -->

- Python Eval 命令从 `eval/` 目录运行，使用锁定环境中的 `uv run pytest` 和 `uv run ruff`。
- Docker、shell 和凭据准备属于 host harness；容器内验证不得依赖宿主私有路径或真实用户配置。
- 静态 scaffold/validator 测试、Docker 场景和真实模型 Eval 分别报告，不能用收集成功或静态测试替代真实运行。
- 失败归因区分 harness、workflow、task 和 model；环境噪声可以标记，但真实低分和行为失败不能因结果不好被过滤。
- API token 只从环境变量读取，不写入 fixture、日志、报告或仓库文件。
