# 平台插件

- `codex/` 与 `dsh/` 保存各自的入口、清单、界面包装、图标和说明。平台插件调用 `domains/`、`platform/` 的共享能力；共享层不依赖插件。
- Native、Classic 状态机及完整 Dashboard 仍由原领域维护。插件只负责平台接入，不复制业务规则。
- 构建脚本留在 `scripts/build/`，输出可安装包；不要直接修改本机安装缓存。版本、共享 Skills 与 Runtime 来自当前 Comet 构建。
- 调整平台入口或模板后运行对应打包测试；涉及 Dashboard 交互时补浏览器验证。Dashboard 的集成测试保留在 `test/domains/dashboard/`，构建测试保留在 `test/scripts/`。
