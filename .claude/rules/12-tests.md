---
paths:
  - 'test/**/*.ts'
  - 'test/**/*.tsx'
  - 'vitest.config.ts'
---

# 测试

<!-- comet-development-rule:tests -->

- 测试目录跟随被测对象：`test/app/`、`test/domains/<domain>/`、`test/platform/`、`test/scripts/` 或 `test/repository/`。
- `test/fixtures/` 中的发布快照和兼容样本默认冻结；需要更新时先证明外部契约确实改变。
- 文件系统、安装、Hook 和用户配置测试必须使用临时目录，不读取或修改真实 HOME。
- 回归测试验证可观察行为或曾经复现的失败，不复制实现细节。
- 先运行受影响的最小测试；只有跨模块、Runtime、安装、发布或其他高风险改动才在最终交付前运行全量测试。
