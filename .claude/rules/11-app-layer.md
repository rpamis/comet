---
paths:
  - 'app/**/*.ts'
  - 'test/app/**/*.ts'
---

# App 层

<!-- comet-development-rule:app-layer -->

- `app/` 只组合 domain 和 platform 能力，不承载可复用领域规则或平台差异。
- CLI 参数解析、命令编排、用户提示和输出格式属于 app；状态机、策略与稳定业务契约属于 domain。
- 修改命令时运行对应 `test/app/` 测试；涉及安装、更新、卸载或 doctor 时使用临时项目与临时 HOME。
- JSON 模式保持可机器解析，不向 stdout 混入交互提示或诊断噪声。
