# Native Runtime

<!-- comet-development-rule:native-runtime -->

- Native Runtime 源码和每命令 entry 位于 `domains/comet-native/`；不得直接在生成的 `.mjs` 中实现业务逻辑。
- 修改后运行 `pnpm build:native-runtime`、相关 Native 测试和 `pnpm check:generated`。
- Native 主流程与 Guard 必须由 Comet Runtime 自己执行，不依赖外部 Skill 才能完成状态推进或验证。
- change 根目录只保留用户可读文档；机器状态、锁、事务和执行记录写入规定的 `.comet/runtime` 位置。
- Build、Verify、Archive 和 Supervisor 的状态只能通过 Runtime 契约推进，不在测试或实现中手工伪造正常路径。
- 涉及 portable state、worktree、恢复或验收时，验证主工作区与 linked worktree 的身份、路径和状态隔离。
