# Comet 插件与 DSH 新版本的兼容性调查

2026-11-27 · [Comet #600](https://github.com/rpamis/comet/issues/600) · [用户反馈](https://github.com/rpamis/comet/issues/514#issuecomment-7207299899)

`058` 保留 `engines.dsh: >=0.2.2-rc.1`。Comet 插件直接监听 DSH 的 `agent/created` 和 `tools/pre-execute`，调用已随包发布的 Comet Hook 和 Router。插件清单移除了三个锁定 DSH `rc.1` 的依赖，避免市场预检随 DSH 升级再次收窄支持范围。 [插件入口](../../plugin/dsh/index.js) · [插件清单](../../plugin/dsh/package.json)

## 为什么超过最低版本仍然被拦

1. `comet-dsh-plugin@0.5.7` 的 npm 清单声明 `engines.dsh: >=0.2.2-rc.1`，同时将 `dsh-hooks-claude-code`、`dsh-hook-protocol` 和 `dsh-llm` 写成精确的 `0.2.2-rc.1` 普通依赖。`058` 修复前的模板有同样的声明。 [npm 发布清单](https://registry.npmjs.org/comet-dsh-plugin/0.5.7)
2. 截图来自第三方 `dshmarket` 的更新确认框。它在更新前读取目标包清单，把 `engines.dsh` 和命中 DSH 核心包清单的普通依赖一起判断。`dsh-llm` 在市场的内置清单中，市场会把 `>=0.2.2-rc.1` 与 `0.2.2-rc.1` 显示为交集。`rc.5` 满足第一项，第二项要求精确等于 `rc.1`。 [弹窗文案](https://github.com/dsh-market/dsh-market/blob/18004a19b1c5bca1cd3ea405e2171a5fb3c089ce/src/client/locales.ts#L422-L439) · [更新预检](https://github.com/dsh-market/dsh-market/blob/18004a19b1c5bca1cd3ea405e2171a5fb3c089ce/src/routes.ts#L3410-L3467) · [核心包清单](https://github.com/dsh-market/dsh-market/blob/18004a19b1c5bca1cd3ea405e2171a5fb3c089ce/src/check.ts#L353-L402) · [交集计算](https://github.com/dsh-market/dsh-market/blob/18004a19b1c5bca1cd3ea405e2171a5fb3c089ce/src/discovery-compatibility.ts#L239-L245) · [依赖判断](https://github.com/dsh-market/dsh-market/blob/18004a19b1c5bca1cd3ea405e2171a5fb3c089ce/src/discovery-compatibility.ts#L287-L344)
3. 官方 DSH 对 Comet 包自身优先检查 `engines.dsh`，该范围可以通过。官方安装器在 pnpm 完成后还会检查被当前安装修改的 profile 直接依赖及 bundle 新插入的插件行。Comet patch 只插入 Comet 自身，Hook 桥由 Comet 的插件代码动态挂载。这个边界无法证明旧桥能在新 DSH 正常运行。 [官方版本判定](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/boot/app-boot/src/plugin-compatibility.ts#L45-L71) · [官方安装后检查](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/boot/plugin-manager/src/operations.ts#L496-L548) · [Comet bundle patch](../../plugin/dsh/cordis.patch.yml) · [Comet 插件入口](../../plugin/dsh/index.js)
4. 官方桥接包把 `dsh-agent`、`dsh-llm`、`dsh-hook-protocol` 等 peer 绑定为与桥同一个 DSH 发布版本。Comet 只直接加载桥接包，`dsh-llm` 和 `dsh-hook-protocol` 是桥的 peer。单纯移动或删掉 `dsh-llm` 可以改变市场判定，但旧桥仍会解析 `rc.1` 的 peer。源码中的 `dsh-hooks-claude-code` 是 DSH CLI 的开发依赖，公开 npm CLI 未把它列为运行依赖，不能假定用户已从 DSH 安装获得桥。 [rc.1 桥接包](https://registry.npmjs.org/@deepseek-ai%2Fdsh-hooks-claude-code/0.2.2-rc.1) · [rc.5 桥接包](https://registry.npmjs.org/@deepseek-ai%2Fdsh-hooks-claude-code/0.2.2-rc.5) · [rc.5 CLI 包](https://registry.npmjs.org/@deepseek-ai%2Fdsh/0.2.2-rc.5)

## 方案比较

| 方案                                   | 适用性                                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 将三项官方依赖一起对齐到 `rc.5`        | 临时包复用了原有桥和 Router，并通过 `rc.5` 的市场预检。该做法会把有效版本范围移到 `rc.5`，无法覆盖用户要求保留的 `rc.1` 及其他版本。                                                                                                |
| 把锁版本的运行依赖改为宽范围或 peer    | 可以清除市场预检对普通依赖的限制，单靠范围无法让 pnpm 依据正在运行的 DSH 选中匹配桥。只有确认某个包由对应 DSH 发行渠道提供，且实际解析到同一份运行依赖，才适合使用 peer 或运行 API。                                                |
| 实现只接入 Comet 所需事件的 DSH 适配层 | `rc.1` 和 `rc.5` 上游桥使用相同的 `agent/created` 与 `tools/pre-execute` 扩展点。适配层可将会话和写入事件交给 Comet 现有入口，减少常驻依赖和重复升级工作。跨版本兼容仍须在真实 DSH 上验证会话注入、写入拦截、插件禁用和旧配置迁移。 |

`058` 采用原生事件适配。公共 Hook Router 继续判断 change 归属和写入权限，适配层使用会话自己的工作目录和工具参数。历史回归 `dsh-plugin-automatic-official-hook-bridge` 的测试选择器保持有效。打包测试现在经由 DSH 事件接口执行实际 Comet Hook，检查规则注入、合法写入放行、跨 change 写入拒绝、禁用后移除监听，以及激活时不创建项目或改写 profile。旧版私有桥接配置和 Router 协议的原有测试仍保留。 [rc.1 官方桥](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/hooks-claude-code/src/index.ts#L208-L249) · [rc.5 官方桥](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/packages/experimental/hooks-claude-code/src/index.ts#L208-L249) · [alpha.2 官方桥](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.3-alpha.2/packages/experimental/hooks-claude-code/src/index.ts#L211-L254)

## 验证与发布条件

- 使用上游原有判定器重放已发布 `0.5.7` 和 `058` 修复前的清单。输入 Windows npm DSH `0.2.2-rc.5` 的安装目录，市场复现 `>=0.2.2-rc.1 ∩ 0.2.2-rc.1`，这次实际命中的普通依赖只有 `dsh-llm`。官方判定器接受两个 Comet 清单的 `engines.dsh`。
- 在临时清单中同时将三项依赖和 `engines.dsh` 对齐到 `rc.5`，市场与官方判定器都接受 `rc.5`，拒绝 `rc.1` 与 `0.2.3-alpha.2`。仅将 `dsh-llm` 移到 peer 并放宽区间，两个判定器也能通过，但保留了旧桥的精确依赖。
- 在 Windows 上使用正式 npm DSH `0.2.2-rc.5` 和 Node `24.9.0`。分别在两个隔离的 `web` profile 中用官方 `dsh plugin --profile web add ... --ignore-scripts` 安装已发布 `0.5.7` 和对齐到 `rc.5` 的临时包，两次退出码均为 `0`，pnpm 均报告缺失 peer 警告。随后用 `dsh web --no-open --port 0` 启动，两个 profile 的 `/comet-plugin/status` 都返回 HTTP 200，报告自带 CLI `0.5.7`、运行时注册 13 个 Skills 和 `integration=ready`。该状态来自桥接挂载流程，截至本次检查尚未触发实际会话规则、Guard、Dashboard 或市场 UI 更新。 [状态实现](../../plugin/dsh/index.js)
- 发布前用实际分发包在隔离 profile 内覆盖 `rc.5` 全新安装和旧插件升级。分别检查 DSH 官方插件管理器、反馈中的第三方市场、重启后 Skills 与自带 CLI、Dashboard、会话规则注入，以及 Router 对禁止和允许写入的实际结果。验证低于最低版本时会收到准确提示，发布检查中同时记录准确的上游版本和失败阶段。 [官方 rc.5 发布](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5) · [现有打包测试](../../test/scripts/dsh-plugin-build.test.ts)

`058` 候选的验证结果：

- 使用同一份 `0.5.8` 构建清单运行市场和官方版本判定器。`0.2.2-rc.1` 至 `rc.5`、`0.2.3-alpha.1` 和 `alpha.2` 均通过，低于最低版本的 `0.2.1-rc.5` 被拒绝。
- 在 Windows 的正式 npm DSH `0.2.2-rc.1`、`0.2.2-rc.5` 和 `0.2.3-alpha.2` 隔离 Web profile 内安装同一个插件 npm 归档，另在已有 `0.5.7` 的 `rc.5` profile 中安装新版并重新启动。四组均注册 13 个 Skills，注入一份会话规则。通过 DSH 实际工具执行链运行临时测试工具，跨 change 写入被 Guard 拒绝且没有落盘，合法写入落盘。运行验证用 npm 已发布的 Comet CLI `0.5.7`，正式构建清单仍绑定 `0.5.8`。
- 第三方市场的完整 UI 更新、Dashboard 交互、其他操作系统和模型 Eval 未运行。
