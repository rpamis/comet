# Classic Runtime

<!-- comet-development-rule:classic-runtime -->

- Classic Runtime 源码和每命令 entry 位于 `domains/comet-classic/`；生成的 `.mjs` 不是业务逻辑编辑入口。
- 修改后运行 `pnpm build:classic-runtime`，并用 `pnpm check:generated` 验证所有生成物与源码一致。
- 命令 bundle 必须由对应 entry 构建为自包含产物，不恢复对聚合 Runtime 的运行时 import，也不新增 bash Runtime。
- `.comet.yaml` 字段变化同步 state `set` 白名单、validate schema/known keys 和 Classic 状态测试。
- `test/fixtures/classic-0.3.9/` 是冻结兼容参考，不能为了让当前实现测试通过而改写。
- `comet-hook-guard.mjs` 是 Guard 命令 bundle；平台直接安装的唯一 Hook 入口仍是 Entry Router。
