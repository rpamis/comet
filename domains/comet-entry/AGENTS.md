# Entry 与 Hook Router

<!-- comet-development-rule:entry-router -->

- 共享入口、workflow 归属和 Hook Router 逻辑位于 `domains/comet-entry/`；稳定跨 workflow 契约放在 `domains/workflow-contract/`。
- Router 依据当前 selection 的 `workflow + change` 一次最多调用一个 Guard，不把 Native 与 Classic 状态机合并。
- 修改后运行 `pnpm build:entry-runtime`、Entry/Router 相关测试和 `pnpm check:generated`。
- 新增 Hook 平台时同时更新平台元数据、安装检查、共享平台 ID、生成 Router 和真实 Router 调用测试。
- Router 的项目归属不能依赖偶然的进程工作目录；显式项目根、linked worktree 和项目外事件必须分别验证。
