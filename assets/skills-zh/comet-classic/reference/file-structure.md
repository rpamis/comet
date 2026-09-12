# 文件结构参考

规范路径：`comet-classic/reference/file-structure.md`

本文件是 Comet 项目文件结构参考。按需查阅，不随 skill 一次性加载。

```text
<classic-open-spec-root>/              # OpenSpec 需求与规格目录；由 Classic 路径解析结果提供
├── config.yaml
├── changes/
│   ├── <name>/                        # 活跃 change
│   │   ├── .openspec.yaml
│   │   ├── .comet.yaml
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
