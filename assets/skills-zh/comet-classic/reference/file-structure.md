# 文件结构参考

规范路径：`comet-classic/reference/file-structure.md`

本文件是 Comet 项目文件结构参考。按需查阅，不随 skill 一次性加载。

```text
<classic-open-spec-root>/              # OpenSpec 需求与规格目录；由 Classic 路径解析结果提供
├── config.yaml
├── changes/
│   ├── <name>/                        # 活跃 change
│   │   ├── .openspec.yaml
│   │   ├── comet-state.yaml
│   │   ├── proposal.md                # 变更原因、目标与范围
│   │   ├── design.md                  # 高层架构决策
│   │   ├── specs/<capability>/spec.md # 本次变更对能力规格的增量修改（delta spec）
│   │   ├── .comet/handoff/            # 脚本生成的阶段交接包
│   │   └── tasks.md                   # 任务清单
│   └── archive/YYYY-MM-DD-<name>/     # 已归档
└── specs/<capability>/spec.md         # 主规格（归档时按 OpenSpec 规则合并 delta spec）

<classic-superpowers-root>/            # Superpowers 设计与计划目录；由 Classic 路径解析结果提供
├── specs/YYYY-MM-DD-<topic>-design.md # 设计文档（技术 RFC，归档时标注状态）
└── plans/YYYY-MM-DD-<feature>.md      # 实施计划（文件头含 change 关联元数据）

.comet/
└── config.yaml                        # Comet 项目配置（context_compression 默认 off，可设 beta）
```

Classic SDK 新 change 使用 `comet-state.yaml`；历史 `.comet.yaml` 原地兼容，compat 初始化继续使用旧名。两种文件不能同时存在，包括其中一个是失效符号链接的情况。

本机 Run、执行证据、锁和事务保存在用户 Comet 数据目录，按 checkout 和 Git worktree 隔离；默认数据根为 `~/.comet`，可用 `COMET_DATA_DIR` 指定工作区外的绝对路径。上面的项目目录保留配置和用户可读产物，不是本机 Run 存储位置。以 Runtime 返回的路径为准，不手工编辑或复制本机执行文件。
