---
paths:
  - 'docs/**/*.md'
  - 'README.md'
  - 'README-zh.md'
  - 'CONTRIBUTING.md'
  - 'CONTRIBUTING-zh.md'
  - 'CHANGELOG.md'
  - 'test/repository/readme.test.ts'
---

# 文档

<!-- comet-development-rule:documentation -->

- 中文文档先完成并确认，再同步英文；两个语言版本保持事实、命令和功能边界一致。
- README 只保留用户首次了解项目所需的稳定入口和亮点，详细能力链接到 `docs/`。
- 中文避免生硬直译和抽象营销表达；`gate` 按语境写为协议、阶段、检查或阻塞点。
- 文档中的命令、路径、版本和平台数量必须从当前源码或配置核对，不能沿用历史记忆。
- 纯文档修改运行受影响文件的 Prettier 和相关仓库契约测试。
