---
paths:
  - 'app/**/*.{ts,js}'
  - 'domains/**/*.{ts,tsx,js,jsx}'
  - 'platform/**/*.{ts,js}'
  - 'scripts/**/*.{js,mjs}'
  - 'test/**/*.{ts,tsx,js}'
  - 'config/**/*.{json,yaml,yml}'
---

# 仓库架构

<!-- comet-development-rule:architecture -->

- `app/` 只负责编排和用户交互；领域规则放入对应 `domains/` 模块。
- 文件系统、进程、安装、版本和路径等环境差异放入 `platform/`。
- `scripts/` 只承载构建、发布、benchmark 和 lint 自动化，不成为产品 Runtime 入口。
- 测试跟随被测对象归属，不新增横向测试桶。
- 新增领域依赖或供其他领域使用的源码入口时，先核对职责，再显式更新 `config/repository-layout.json` 中的依赖和入口清单；不得自动放行当前差异。
- 纯模型只依赖纯计算能力；兼容门面保持声明式，内部实现不反向导入门面。
- 新增顶层目录、源码模块、测试根或 Runtime 入口时，同步 `config/repository-layout.json`、架构 linter 和相关仓库契约测试。
