# ZCode 项目级 Router 迁移

来源 `report:2026-11-27-zcode-align-claude-hook-scope`。用户要求 Comet 的 ZCode Hook 作用域与 Claude Code 一致。`0.5.7` 由 Comet 安装用户级 Router。最初的 `0.5.8` 候选保留了该入口，导致用户在项目 Router 已启用且受信任时仍可以装入第二条可执行的用户级 Router。ZCode 会分别派发两个作用域中的匹配处理器。

本次改动将 Comet Router 的安装限定在项目级。项目安装或更新成功写入项目配置后，清理旧版 Comet 用户级条目。全局安装、更新和全局 Doctor 修复也清理旧条目。用户自己的 Hook、工作区和用户级总开关原值保留。项目 Router 初装显式关闭，同一条 Router 的手动启用状态在更新和修复时保留。

## 历史回归

| 原案例                                  | 撤下的行为                                                    | 继续验证的行为                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-438-zcode-hook`                  | 向用户级配置写入新的 Comet Router                             | 按 ZCode 的项目配置格式安装和卸载，保留用户设置。能从真实用户级配置路径清理旧条目，保留其他 Hook，仅含用户配置时文件保持原样。                                          |
| `issue-541-global-hook-diagnosis`       | 将用户级 Comet Router 视为有效，并修复为已启用的用户级 Router | 公开 Doctor 诊断已启用、关闭或重复的旧 Router。诊断保持文件原样，修复只删除旧 Router。全局安装仍提供 Skill。                                                            |
| `issue-541-project-preserves-user-hook` | 项目更新沿用旧用户级 Router，并跳过项目级安装                 | 公开更新迁移至默认关闭的项目 Router，保留自定义 Hook、YAML 注释和忽略规则。项目配置写入失败时保留旧 Router。Doctor 在项目 Hook 信任未核实时逐字节保留 Classic v1 选择。 |

历史 Doctor 在确认旧用户级 Router 就绪后会清理失效的工作流选择。项目 Router 初装时和两个开关都打开时，Comet 都无法核实 ZCode 信任。替代测试在这两种情况下都验证 Classic v1 选择原文和 Hook 开关。项目 `doctor --repair` 在 Router 写入成功后清理确认缺失或已归档的 v2 选择，并保留有效选择和显式无选择。该行为登记为 `zcode-doctor-clears-stale-project-selection`，公开 CLI 用例也验证只读检查和全局修复保留项目选择。

旧登记和受影响的完整测试用例归档自 `2e33ae49fcf9bcd490153987d2095a3c6c08bd42`。`case-migrations.json` 记录替代测试选择器，`tests.patch` 记录相对旧提交的测试差异。本次行为分别登记为 `zcode-router-project-scope-only` 和 `zcode-migrates-legacy-router-to-project`。

## 验证证据

- 用原 `0.5.8` 候选的公开 CLI 执行新案例，项目更新未移除旧用户级 Router，全局 Doctor 仍要求存在用户级 Router。
- Windows 下，用新 CLI 从临时 HOME 的旧用户级 Router 迁移。ZCode `a4b44451` 配置加载器和 `PreToolUse` 派发器确认旧 Router 消失，项目 Router 在初装和未信任时均未启动。临时信任授权并启用后，每个匹配事件只启动一个项目 Router 进程，普通写入请求放行，受保护的写入请求拒绝。测试注入工具事件，使用实际 Router 进程。
- 同一探针将项目搬迁，在旧位置另装 Comet，再运行公开 `update`。配置加载器只读取一条绑定新路径的 Router。信任前启动零次，临时信任后匹配的 Write 启动一次并以状态码 `0` 退出。
