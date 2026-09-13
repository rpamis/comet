---
paths:
  - 'domains/comet-entry/**/*.ts'
  - 'assets/skills/comet/scripts/comet-entry-runtime.mjs'
  - 'assets/skills/comet/scripts/comet-hook-router.mjs'
  - 'test/domains/comet-entry/**/*.ts'
  - 'test/repository/comet-entry-runtime-assets.test.ts'
  - 'scripts/build/build-entry-runtime.mjs'
---

# Entry 与 Hook Router

<!-- comet-development-rule:entry-router -->

- selection 数据契约、基础读写和共享 Hook 决策类型位于 `domains/workflow-contract/`；原始输入与平台输出编码属于 `platform/process` 的平台 Hook 协议适配。
- `domains/comet-entry/` 组合平台适配、项目归属、歧义处理、恢复选择和 Router 策略；Native、Classic 与 `workflow-contract` 不反向依赖 Entry。
- Router 依据当前 selection 的 `workflow + change` 一次最多调用一个 Guard，不把 Native 与 Classic 状态机合并。
- 修改后运行 `pnpm build:entry-runtime`、Entry/Router 相关测试和 `pnpm check:generated`。
- 新增 Hook 平台时同时更新平台元数据、安装检查、共享平台 ID、生成 Router 和真实 Router 调用测试。
- Router 的项目归属不能依赖偶然的进程工作目录；显式项目根、linked worktree 和项目外事件必须分别验证。
