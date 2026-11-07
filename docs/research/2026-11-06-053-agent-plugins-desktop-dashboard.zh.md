# 0.5.3：三平台插件与桌面 Dashboard 集成调查

- 调查日期：2026-11-06。
- 目标平台：Claude Code、Codex、DeepSeek Harness（dsh）；用户已确认 DSH 的产品身份。
- Git 基线：执行 `git fetch origin --prune` 后，从 `origin/master` 的 `a61a2e5b4766e1ad62377dec598e402560a259b6` 创建并切换到本地 `053`；没有配置其跟踪 master，没有推送分支。
- 当前 Comet 与 master 均为 `0.5.2`，最近发布 tag 为 `0.5.2`。本次只新增研究文档，不升级版本或修改 Changelog；后续产品变更再按 master 基线确定 `0.5.3` 条目。
- 证据范围：官方在线文档与源码、当前 Comet 源码、本机 CLI 只读帮助。下文的建议和验证计划均未实现；未安装三个平台的测试插件，未执行真实桌面验证或模型 Eval。

## 1. 建议采用的方案

复用同一套 Comet CLI、Runtime 和 Dashboard，为三个平台分别构建插件包装。第一阶段让完整 Dashboard 在桌面端的浏览器面板中运行，同时提供平台原生的状态入口；需要在聊天旁直接交互时，再为有对应能力的平台补充原生面板或 MCP App。

用户补充提出采用 Codex、DSH 的插件创建模式。经核对，实施时可使用 Codex Plugin Creator 与 DSH Creator 生成平台包装和适配代码，并将产物纳入 `053` 的产品构建与版本管理。Codex Plugin Creator 的本地可用性需先检查；本次插件目录查询确认它可安装，但当前账户尚未安装。创建模式可以帮助实现插件，模板生成、运行时接入和真实桌面验收仍需分别完成，详见第 4、5 节。

这里需要区分三个完成条件：插件可以安装并加载 Skill；Comet Guard 在工具执行前实际工作；Dashboard 在桌面内可显示、刷新和操作。完成其中一项不能证明另外两项。

| 平台        | 插件分发                                                               | 完整 Dashboard 的优先路径                              | 原生 UI 扩展与限制                                                                                         |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Claude Code | 官方 plugin + marketplace，携带 Skills、Hooks、可选 MCP                | Desktop Code tab 的 Browser 预览本地服务               | Mods 可绘制原生 pane；未证明能直接挂载现有 React/AntD 页面                                                 |
| Codex       | portable `plugin.json` + marketplace；兼容 `.codex-plugin/plugin.json` | 使用桌面内置浏览器打开本地 Dashboard，验证具体打开流程 | MCP Apps 和 OpenAI UI extensions 可作为进一步方案；ChatGPT 的 UI 支持不能直接推定所有 Codex 客户端一致支持 |
| DSH         | npm/Cordis bundle + profile，增加 client plugin                        | 官方 Browser 右侧面板打开本地 Dashboard                | 已有 sidebar/main/right-pane 扩展入口，适合继续做原生 Comet 导航                                           |

上述路径分别来自 [Claude Desktop](https://code.claude.com/docs/en/desktop)、[OpenAI 插件打包](https://developers.openai.com/plugins/build/plugins)、[Windows 桌面能力](https://learn.chatgpt.com/docs/windows/windows-app) 和 [DSH Browser 插件](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-sidebar-browser/README.md)。它们证明的是扩展入口存在，具体 Comet 集成仍需实测。

## 2. 当前仓库已经具备什么

| 当前源码                                                                                               | 已有能力                                                                                              | 本次集成需要补充的内容                                                       |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [平台定义](../../platform/install/platforms.ts)                                                        | Claude、Codex、DSH 的文件式安装适配；Codex Skill 使用 `.agents/skills`，配置使用 `.codex`             | 平台插件包及其安装、更新、卸载渠道，兼容现有安装                             |
| [DSH 适配](../../domains/skill/dsh-adapter.ts)、[profile 枚举](../../platform/install/dsh-profiles.ts) | instruction 管理块、资源归属、Cordis patch 接入；现用 `dsh-hooks-claude-code` bridge                  | 对目标 DSH 版本重新验证 bridge，并评估原生 Cordis adapter                    |
| [Dashboard CLI](../../app/commands/dashboard.ts)                                                       | `comet dashboard <path> --no-open`，`--json` 输出一次快照                                             | 面向桌面集成的进程启动、复用、健康检查、实际 URL 发现和退出管理              |
| [Dashboard server](../../domains/dashboard/server.ts)                                                  | 本地 HTTP API、静态前端、已有业务服务；默认端口 4321，端口冲突最多向后寻找 50 个端口；支持 `--port 0` | 插件不能硬编码端口；需要取得实际监听 URL。新增启动协议时再核对命名与公开接口 |
| [Dashboard 前端](../../domains/dashboard/web/src/main.jsx)                                             | React/AntD 界面，数据请求使用相对 `/api/dashboard/...`                                                | 若换成原生面板或 MCP App，需要适配数据传输及资源路径                         |
| [官网 Demo 入口](../../domains/dashboard/web/src/website-demo-entry.jsx)                               | Shadow DOM 内嵌演示，使用 `forceDemo`                                                                 | 该入口不读取真实项目数据，不能当作已完成的桌面集成                           |
| [Comet plugin SDK](../../domains/comet-plugin/sdk.ts)                                                  | Comet 内部的记忆、知识等插件能力                                                                      | 本次平台插件应调用现有能力；不需要为打包平台扩展重新设计内部 plugin SDK      |

当前入口 Skill 已通过 PATH 中的公开 `comet` CLI 推进，见 [Comet](../../assets/skills-zh/comet/SKILL.md) 与 [Native](../../assets/skills-zh/comet-native/SKILL.md)。因此插件包只复制 Skill 目录仍不完整：还要明确 CLI 如何安装、如何校验版本、插件如何提示安装不完整。可先保留用户安装 npm CLI 的方式；若以后随插件提供 CLI，则需明确 runtime、依赖、跨平台启动和版本升级策略。

仓库目前没有可直接承担本次三平台集成的 Comet MCP server。可选的 MCP bridge 是后续新增工作，不能把内部 plugin SDK 当作已存在的 MCP 接口。

## 3. Claude Code：官方插件 + Mods + Browser

### 3.1 插件包装与生命周期

官方布局以 `.claude-plugin/plugin.json` 声明身份，Skill、Hook、MCP 配置和脚本放插件根目录对应位置。可通过自有 marketplace 分发，开发时用 `claude --plugin-dir <插件目录>` 加载。插件 Skill 有命名空间，例如 `/comet:comet`；需要在产品方案中明确它与现有 `/comet` 的关系，不能假定名称完全不变。[创建插件](https://code.claude.com/docs/en/plugins/create)、[manifest 参考](https://code.claude.com/docs/en/plugins-reference)

脚本位置使用 `${CLAUDE_PLUGIN_ROOT}`；跨版本保留的插件数据使用 `${CLAUDE_PLUGIN_DATA}`。不向插件缓存目录写项目状态。Desktop 本地 Code 会话可使用插件，但 WSL Desktop 会话存在插件限制，必须在兼容范围中单列。[插件安装](https://code.claude.com/docs/en/plugins/install)、[Mods 支持范围](https://code.claude.com/docs/en/plugins/mods/overview)

第三方 marketplace 的自动更新行为需要单独配置，不能默认安装后总会跟随最新版本。官方提供 `claude plugin update <plugin>@<marketplace>`；更新后需重新加载插件或开始新会话。[marketplace 指南](https://code.claude.com/docs/en/plugins/create-marketplace)、[插件管理](https://code.claude.com/docs/en/plugins/install)

Comet 包装建议：从产品 `assets/` 和构建产物生成 Skill、脚本与 Hook 配置；Guard 继续复用唯一 `comet-hook-router.mjs`。安装时发现已有 Comet Hook，应先确定保留哪一份，防止项目配置和插件同时执行两次。

### 3.2 Mods 可做原生状态面板

Claude 官方于 2026-10-01 发布 Mods：插件内 JavaScript/TypeScript 模块可以注册命令、订阅事件，用 `$.ui.open` 与 `ui.render` 绘制界面；支持 CLI、Desktop Code tab 和 VS Code。[官方发布说明](https://claude.com/resources/articles/claude-code-mods)、[Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)

适合首先展示当前项目、change、阶段、待处理动作、检查摘要，以及打开完整 Dashboard 的按钮。事件处理可通过平台提供的 HTTP/进程能力读取 Comet 结果，不在 Mods 中维护第二套工作流状态。

**不能据此承诺完整 Dashboard 原样嵌入 Mods。** 官方 UI 是受限的 `Box`、`Text`、`Button`、`Input`、`Select`、`Svg`、`Client` 等元素；`Client` 返回的仍是受限渲染元素，并非任意 DOM/WebView。官方类型声明还标记 EARLY ACCESS，实施时应以目标版本的 `/plugin-types` 输出为准，并执行 `claude plugin validate`。[UI 参考](https://code.claude.com/docs/en/plugins/mods/interface)、[官方类型声明](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)

### 3.3 完整页面先接 Desktop Browser

Desktop Browser 能启动和预览本地应用，`.claude/launch.json` 可描述 `runtimeExecutable`、`runtimeArgs`、`port`。建议先验证以公开 CLI 启动 `comet dashboard <项目绝对路径> --no-open`，再在 Browser 中打开实际 URL。该文件属于项目启动配置，不能将插件安装理解为已经获得任意持久面板的注册权。[Desktop 文档](https://code.claude.com/docs/en/desktop)

当前服务会输出 `http://localhost:<实际端口>`，与 Mods Desktop Link 的 localhost 规则一致。自动选端口与 Browser 启动配置的固定端口如何配合、插件如何触发 Browser 打开、关闭后的进程归属，均列入原型验证。[Desktop Link 规则](https://code.claude.com/docs/en/plugins/mods/interface#link-in-the-desktop-app-and-vs-code)

### 3.4 Claude Desktop Chat 是另一个集成面

Code tab 的插件、Mods 和 Browser 结论不能覆盖 Chat。若用户还希望在 Chat 中操作本地 Comet，可另行提供本地 MCP server，用 `.mcpb` desktop extension 分发，并通过 MCP Apps 返回 UI。`.mcpb` 解决 MCP 服务安装，不自动提供 Code 工作流的全部 Skills/Guard 能力。[本地 MCP 安装](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)、[Claude 交互工具](https://claude.com/resources/articles/interactive-tools-in-claude)、[插件组件边界](https://code.claude.com/docs/en/plugins/components)

## 4. Codex：插件包装可行，Guard 分发与 UI 需要分别验收

### 4.1 当前官方包格式与本机能力

新包优先使用根目录 `plugin.json` 和 `mcp.json`；`skills/` 放工作流。OpenAI 专属界面信息、Hook、onboarding 放在 `extensions.com.openai`；`.codex-plugin/plugin.json` 是兼容形式。两种 OpenAI 配置不是逐字段合并，不能双写后期待自动补齐。[官方包装规范](https://developers.openai.com/plugins/build/plugins#plugin-structure)

可以通过项目/个人 marketplace 或 Git marketplace 分发；本地 marketplace 文件位于 `.agents/plugins/marketplace.json`。`source.path` 相对 marketplace 根目录解析，需要与相对 `.agents/plugins/` 目录解析的误解区分。实际产品目录方案要先通过 Comet 架构规则评审，不能为放示例直接新增未登记的顶层目录。[marketplace 与路径规则](https://developers.openai.com/plugins/build/plugins)

本机只读检查结果：`codex-cli 0.163.0`；`codex plugin --help` 确认已有 `add/list/remove/marketplace`，`codex plugin add --help` 确认接受 `PLUGIN@MARKETPLACE`；`marketplace` 有 `add/list/upgrade/remove`。本次只查看帮助，没有注册、安装或修改用户配置。官方同时提供 CLI 的 `/plugins` 浏览器；插件在 IDE extension 的支持范围不同。[用户文档](https://learn.chatgpt.com/docs/plugins)

官方提供 Plugin Creator：可用时在 Codex 中调用 `$plugin-creator`，在 ChatGPT Work 中调用 `@plugin-creator`。它能生成 `.codex-plugin/plugin.json` 兼容 manifest、按需建立 Skill/MCP/脚本/资产目录，并可为已有插件生成本地 marketplace 条目。当前官方生成器使用兼容布局，生成后可先沿用受支持格式；如确需 portable 包，再按实际 schema 转换，不只重命名文件。[官方 Plugin Creator](https://developers.openai.com/plugins/build/plugins#package-with-plugin-creator)

**本机可用性核查（2026-11-06）**：当前会话技能清单及 `.codex/skills`、`.agents/skills`、`.codex/plugins/cache` 中均未找到 `plugin-creator`。随后通过账户插件目录查到官方 `Plugin Creator`，结果为 `installation_policy: AVAILABLE`、`installed: false`，确认尚未安装。已展示安装入口；需用户完成安装，再开始新会话验证技能可用，不能把目录可安装或已展示建议写成已安装。`$plugin-creator` 是技能调用写法，不能据此期待 PowerShell 中存在同名可执行命令。[插件安装与新会话要求](https://learn.chatgpt.com/docs/plugins)

需要明确生成范围：`.mcp.json`、`.app.json` 初始内容为空；选择 Hook 只会创建空 `hooks/` 目录，不自动实现 Hook 配置和脚本。因此可以用创建器完成 Comet 插件的初始包装，随后接入已有 Skill、CLI、唯一 Router、Dashboard 启动与可选 MCP UI，再进行真实安装与行为验收。使用创建器不改变公共目录和 Hook 的限制。本次只核对官方说明，未调用创建器。

### 4.2 Guard 决定第一阶段应使用哪个渠道

官方明确：带生命周期 Hook 的插件可以手动安装到 Codex desktop，**不能提交公共插件目录**；普通项目/用户 Hook 与插件 Hook 会共同加载。非管理 Hook 必须审阅并信任当前定义，修改后需重新信任。Comet 必须显示“Hook 已配置”和“Hook 已获信任并实际生效”的区别，不得自动绕过信任。[打包限制](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)、[Hook 信任规则](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)

因此建议第一阶段提供自有 marketplace/手动安装的完整版本，明确最低客户端与本地执行要求。若同时准备公共目录版本，需要另行定义不包含 Hook 时能提供的能力，不能把“已安装 Skill”描述为完整 Guard 已启用。官方本地 stdio MCP 的公共目录提交当前还需要 approved partner/组织 allowlist；这与本地开发、私下分发的可行性是不同条件。[Desktop-only 提交要求](https://developers.openai.com/plugins/deploy/desktop-only)

Codex 提供 `${PLUGIN_ROOT}` / `${PLUGIN_DATA}`，并兼容 Claude 同名环境变量。可共用脚本资源，但各平台的工具事件、阻断输出与 matcher 仍需分别测试。Windows 路径、空格和从子目录启动也应覆盖。[插件 Hook](https://learn.chatgpt.com/docs/hooks#plugin-bundled-hooks)

### 4.3 Dashboard：先浏览器，后验证 MCP UI

官方确认 Windows 桌面有内置浏览器、插件和文件预览。近期可先让 Skill/插件命令启动本地 Dashboard，由桌面浏览器打开。第三方插件是否拥有稳定公开的“自动打开固定面板”接口，当前调查未确认；不能把当前 Agent 能调用的内置 App 工具直接当作公开插件 API。[Windows 桌面](https://learn.chatgpt.com/docs/windows/windows-app)

OpenAI 官方还提供 MCP Apps UI 和 Sidebar/Conversation panel extensions：UI 注册 `ui://` 资源，用 `_meta.ui.resourceUri` 关联工具，通过 `postMessage` bridge 通信；全局/会话入口可声明为 `global` / `thread`。但这些 UI 指南主要明确描述 ChatGPT，不能直接推定所选 Codex 桌面版本具有相同注册权限与渲染行为。[MCP UI](https://developers.openai.com/plugins/build/chatgpt-ui)、[Extensions](https://developers.openai.com/plugins/build/extensions)

App Server 已暴露 `mcpAppUi`、`resourceUri` 与展示模式等字段，说明存在相应展示元数据；仅有协议字段仍不足以证明本地第三方插件已能在目标桌面完整呈现。下一步原型需实测本地 MCP 资源、面板入口、bridge 和刷新；未通过时保留浏览器路径。[App Server items](https://learn.chatgpt.com/docs/app-server#items)

## 5. DSH：优先原生 bundle，Browser 可直接承载完整页面

本次在线核对的官方 master 为 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，版本 `0.2.2-rc.1`。项目仍处于 developer preview，应固定目标发布版本验收，不能用持续变化的 master 代替安装包行为。[官方仓库](https://github.com/deepseek-ai/deepseek-harness)、[固定版本源码](https://github.com/deepseek-ai/deepseek-harness/tree/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159)

### 5.1 插件组成与原生 UI

**优先通过 DSH 自带的 Creator 模式创作。** Desktop/Web 的左侧 More、会话顶部 More conversation views、右侧 More tools 均可进入 `Create your plugin`。该操作会创建或复用 `cordis` Creator Session 并填入未发送草稿，提交消息后才调用模型。[官方创建入口](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-entry-customization/README.md)

Creator preset 提供文件/终端、运行时 API 查询和 Plugin Manager，并内置 `cordis-plugin-development`。其创作流程可生成后端、client UI、页面/面板和 MCP bundle；UI 模板含 `./client` 导出与 `dsh.client` 声明。因此可在该模式中实现 Comet CLI/Runtime adapter、Dashboard 启动管理和 Browser 打开入口。[Creator preset](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/bundle/web-app/presets/cordis.patch.yml)、[内置创作 Skill](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md)、[UI 创作参考](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md)

产物写入 workspace 中的独立包，通过 `plugin_manager` 的 `install_bundle` 动作和包的绝对目录安装到当前 profile，跨重启保留并影响该 profile 的所有 Session。应先在隔离 profile 验证，再接入用户实际使用的 Desktop profile。模板默认使用本地包身份和 `private: true`；正式分发前需补全包身份、版本、兼容范围并验证实际打包文件。安装结果的 `restart-required` 表示仍需重启后才能验证生效。[后端与分发参考](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md)

不要使用旧 `cordis_define`/`cordis_run` 动态定义来交付新插件：该路径保留历史/程序化用途，动态定义不能作为重启后仍有效的插件分发方式。当前 Creator 的持久产物应采用 Plugin Manager bundle。[Host runner 边界](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/extensions/cordis-host-runner/README.md)

DSH 使用 Cordis plugin/bundle 与 profile 装配。建议提供 Comet bundle，分别包含后端适配与 client plugin：后端调用公开 CLI/领域能力，client 注册导航和显示入口；不把 Markdown Rule 当作 Cordis 的执行约束。Desktop 使用 Web app 的 Electron 外壳，原生 client 扩展可在桌面中复用。[DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/architecture.md)、[Desktop](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/desktop/README.md)

已确认存在 `sidebar.panellist`、`main` keyed slot，以及 `ctx.sidebarRightTabs.register`、`sidebar.right.pane.tab`、`ctx.sidebarRight.openTab` 等原生面板机制。应使用官方 client plugin 的注册和销毁方式，避免修改 DSH 自身 Electron 源码。[左侧导航](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-sidebar/README.md)、[右侧面板](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-sidebar-right/README.md)

原生包的关键字段为 `dsh.manifestVersion: 1`、`dsh.bundle.patch`、`dsh.client.platform: "web"`，并导出 Node 入口和 `./client`。patch 将后端插件挂入 profile；Node 入口需要可加载的 `apply()`。服务依赖使用 Cordis 的 `inject`，不能把信息性包依赖 `dsh.client.inject` 当作服务注入。具体包名尚未决定；构建时按官方 client bundle 依赖约束处理 React 等资源。[manifest 类型](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/util/package-manifest/src/types.ts)、[官方 UI 包示例](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-schedule/package.json)

**Desktop profile 与 web profile 独立。** Desktop 使用 `$DSH_HOME/profiles/desktop`，依赖、启用状态及 lockfile 单独维护。优先让用户从 Desktop Plugins 页面安装；使用 CLI 管理时，需先让 Desktop 初始化 profile、完全退出，再用 Desktop 自带的 `dsh plugin --profile desktop add <包名>`。普通 npm 安装的 dsh 不能据此管理 Desktop profile；`--profile web` 安装成功也不能证明桌面已生效。更新、卸载和重新启动同样按目标 profile 操作。[Desktop 安装归属](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/desktop/README.md)、[CLI 参考](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/apps/cli/reference/README.md)

当前 Plugin Manager 有 bundle 更新、失败回滚和 HMR/`restart-required` 等机制，实施时复用这些生命周期接口。`engines.dsh` 应按当前 app-boot/manager 的实际检查锁定兼容版本；manifest 说明与负责执行的文档存在漂移时，以实现与目标安装包实测为准。[App boot](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/boot/app-boot/README.md)、[Plugin Manager](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/boot/plugin-manager/README.md)

完整 Dashboard 的最短路径是调用官方 Browser 入口：

```ts
ctx.sidebarRight.openTab('browser', {
  params: { url: dashboardUrl },
});
```

此处 `dashboardUrl` 由 Comet 启动结果提供，不固定为 4321。官方 Browser 支持 loopback；Desktop 使用受控 Electron webview，默认启用；Web 使用 iframe，默认禁用。页面没有 Node/Electron 权限，下载、权限申请和原生弹窗存在限制，关闭/重启后的恢复也不能假定等同于系统浏览器。[Browser 官方文档](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/ui-sidebar-browser/README.md)

这意味着可以先加载现有完整页面，再逐步加入 Comet 原生项目/change 入口。导出下载、外部链接、目录选择、键盘交互需针对桌面 Browser 单独验收。

DSH Desktop 的应用页面使用 `dsh-app://app/`，不要把它假定为普通 localhost 顶层页面。官方 plugin module carrier 负责 client bundle；`/plugins/.../assets/` 的资产能力也不等于通用 HTML/CSS/JS 静态托管。完整 Comet 页面应先保持自己的 HTTP 服务，在 Browser guest 中导航；若改为真正原生页面，需要按 DSH client plugin 方式构建。[Client modules](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/client/modules/README.md)、[Web client 架构](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/docs/subsystems/web-client.md)

### 5.2 Guard 不继续假定旧 bridge 总是可用

当前 Comet 依赖 `@deepseek-ai/dsh-hooks-claude-code`。本次核对发现，过去研究引用的 `packages/hooks/hooks-claude-code/README.md` 已不在当前官方 master 对应路径。这只构成迁移核查线索；本次没有证明已发布 bridge 包不可用，也没有复现当前 Comet 安装失败。

原生 DSH 已有 `tools/pre-execute(exec, next)` 与 `PreToolDecision` 的 `deny/allow/cancel/ask` 结果；可调用 Comet Guard，再返回确定性拒绝。`ctx.tools.guard` 是执行前更靠后的同步 deny-only 检查；若需要异步 Runtime 检查，应评估 `pre-execute` 并遵守取消信号。生命周期也要按目标版本核对：当前有 `agent/created`、`agent/disposed`、`agent/pre-step`、`agent/turn-stopping`，不直接复制旧文档的事件表。[工具事件](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/tools/src/events.ts)、[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/tools/src/contracts.ts)

建议先固定 DSH 版本验证现有 bridge；原生插件再决定继续复用还是替换为 Cordis adapter。迁移必须覆盖旧安装卸载、profile 切换、用户 patch 保留和单次执行，不能在后台静默改写用户 profile。

## 6. 共用架构与必要改动

建议的调用关系如下，均为后续方案：

```text
Claude plugin / Codex plugin / DSH bundle
  ├─ Skill → 公开 comet CLI → 原有 Native / Classic / SDK Run
  ├─ 平台工具事件 → 事件适配 → 唯一 Comet Hook Router / Guard
  └─ 桌面打开入口
       ├─ Browser → 现有本地 Dashboard HTTP 服务
       └─ 原生摘要 / 可选 MCP App → 只读服务适配 → 原有领域查询
```

第一阶段优先完成以下共用工作：

1. **生成式打包**：同一版本的 Skills、Runtime、脚本生成三平台包装；沿用产品源码及构建链，不编辑本地 `.agents/skills/comet*`、`.claude/skills/comet*` 副本。
2. **CLI 与插件版本配合**：先验证公开 CLI 是否存在、版本是否兼容；缺失时明确提示安装，不搜索旧 bundle 猜测执行路径。插件安装与项目初始化分别处理。
3. **Dashboard 进程归属**：启动器取得实际 URL、版本、启动状态及关闭能力；按规范化项目/worktree 身份复用，关闭一个面板不应误杀其他会话共用的服务。新增公开命令或输出 schema 时再做接口设计。
4. **安装渠道切换**：检测文件式安装与插件安装的重叠。只迁移 Comet 管理的 Skill、配置块和 Hook，保留用户内容；更新、禁用、卸载和回退均有明确归属。
5. **平台界面适配**：Claude Mods 只实现必要摘要；DSH 注册官方 Browser/导航入口；Codex 先验证浏览器和 UI 能力，避免根据未证实接口开发整套面板。

### HTTP 与 MCP 的边界

当前 Dashboard 服务只监听 `127.0.0.1`，但对请求的 Host、Origin 和 `Sec-Fetch-Site` 都有校验；写请求要求 JSON。将它直接放入跨来源 iframe，或者从平台页面 fetch 它，可能被拒绝。这个判断来自当前 [server 源码](../../domains/dashboard/server.ts)，不是已执行的浏览器复现。

Browser 面板导航到 Dashboard 自己的 URL，可以保持页面与其 API 同源；仍须实测平台实际发送的请求头及 webview 行为。原生 UI/MCP App 则优先让本地服务端调用已有领域入口，由 bridge 返回结构化结果，不为跨来源访问全局放开 CORS，也不开放任意路径/命令代理。

若新增 MCP bridge，先只暴露项目概览、change 列表、详情和检查摘要。后续写操作继续走现有 Runtime 授权，不让 MCP/前端代替 Shape 确认、接受结果或 Git 交付决定。Eval 的开始和重跑始终要求用户明确授权；打开面板、加载预览或自动刷新不能启动 Eval。MCP UI 的资源、CSP、主题、尺寸与 bridge 应按 [MCP Apps 标准](https://modelcontextprotocol.io/docs/extensions/apps) 适配。

## 7. 实施顺序与验收边界

| 阶段          | 可评审的交付                                            | 必须取得的证据                                                                |
| ------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 先验证扩展面  | 三个平台各一个最小插件，只加载一项 Skill/命令与状态入口 | 固定 CLI/桌面版本，真实安装与加载记录；区分 Windows/macOS、CLI/桌面、本地/WSL |
| 插件化安装    | 共用构建输出、三个包装与版本检查、安装迁移              | 干净临时项目安装/更新/卸载；既有用户配置保留；插件与旧安装混用时无重复 Guard  |
| Dashboard MVP | 启动/复用本地服务，三个桌面内打开完整页面               | 端口冲突、多项目/worktree、刷新、面板关闭和应用退出；实际页面截图/操作记录    |
| 平台原生体验  | Claude Mods 摘要、DSH 原生入口；Codex MCP UI 可行性结论 | 各自平台真实渲染和交互；不支持时明确浏览器回退                                |
| 发布准备      | 平台包说明、最低版本、渠道差异与回退方式                | 发布产物/安装包验证；公共目录资格与 Hook 限制分别核对                         |

Guard 验收要覆盖未批准写入被阻断、无关任务保持可执行、切换 Native/Classic 不串状态、恢复不重复副作用，以及合法流程可完成。普通单元测试不能替代平台真实 Hook；UI 构建成功不能替代桌面交互。

建议首先做 **DSH Browser + Claude 插件/Browser** 的最小贯通，再验证 Codex 的本地 marketplace/Hook 信任和 MCP UI。原因是 DSH 有直接打开本地 URL 的官方入口，Claude 有明确的插件与 Browser 路径；Codex 完整 Guard 的公共分发限制需先确定产品取舍。若用户优先使用某个平台，可调整顺序。

## 8. 尚未确认与本次检查

- Claude Mods 处于早期阶段；未确认现有 React/AntD Dashboard 可直接作为 Mods 内容运行。
- 未确认目标 Codex 桌面中，第三方本地插件能否注册与 ChatGPT 相同的 MCP App 侧栏/会话入口；内置浏览器自动打开方式也需原型验证。
- DSH 目标安装包、npm bundle/profile 的实际加载以及旧 bridge 与当前版本兼容性均未运行验证；本机未发现 `dsh` 命令。
- 三平台的最低支持版本不能只由本机 CLI 推导。本机 Claude Code 为 `2.1.318`，Codex CLI 为 `0.163.0`；桌面版本需后续另行记录。
- 本次未修改产品代码、Skill、配置、版本、Changelog 或 website 子模块；没有提交、推送、创建 PR 或评论 Issue。
- 已执行受影响文件的 Prettier 检查；10 个不同的仓库内链接目标均存在。`pnpm verify:changed --base a61a2e5b4766e1ad62377dec598e402560a259b6` 返回 `0 check(s)`：当前选择器没有为独立研究文档安排契约测试，这不表示已运行或通过产品测试。
- 本次不声明修复用户行为，因此没有新增 badcase 登记。未执行全量测试、build、真实平台 Hook、桌面浏览器验证和模型 Eval：本次交付是研究，尚未实现可验收插件；Eval 也未获启动授权。
- 创建模式补充调查只读取了官方文档与源码，未调用 Codex Plugin Creator 或 DSH Creator，未启动其模型任务或安装插件。

## 9. 后续实施：已创建 Codex 私有插件

用户安装 Plugin Creator 并明确要求创建后，本次已按其本地插件流程完成首版包装，
并通过 Plugin Creator 保存为个人私有插件。上文“尚未创建”的表述记录的是此前调查阶段。

- 插件：[Comet](https://chatgpt.com/plugins/plugins_6aedd53b6e048191ab83f835d847023c)，版本 `0.5.3`，个人范围，私有可见。
- 后续更新身份：`plugin_id: plugins_6aedd53b6e048191ab83f835d847023c`；当前 release 为 `pluginrel_6aedd53fd4788191be37579f0cc26b0f`。更新时先重新查询当前 release，不能据此覆盖后续版本。
- 源码：[插件模板](../../plugin/codex/plugin.json)、[使用说明](../../plugin/codex/README.md)、[打包脚本](../../scripts/build/build-codex-plugin.mjs)。`pnpm build:codex-plugin` 生成插件目录、独立归档和本地 marketplace。
- 最终本机归档：`dist/codex-plugin/0.5.3-zh-private/comet-codex-0.5.3-zh.tar.gz`，约 10.5 MiB。清单确认包含 **13 个 Skills**、现有 Runtime/Router 及内部 Classic 声明；没有打包 marketplace、用户配置、凭据或依赖目录。此前进度消息中的“14 个”是计数错误，以归档清单的 13 个为准。
- 插件沿用公开 CLI；需要在实际执行环境单独安装对应 Comet CLI。Dashboard 使用现有本地 URL；本次没有新增 MCP server、MCP App 或固定导航面板。
- 已回读账户插件文件：根 manifest、平台生成的兼容 manifest、13 个 Skills 和 Hook 文件均存在，Hook 引用与 Windows 专用命令保留。账户保存会按已验证身份规范化作者信息；未用本地作者字段覆盖它。
- 创建成功不等于实际用户环境已安装，也不等于 Hook 已获信任。用户安装后需开始新会话，并审阅 Hook；本次没有改写用户已有 Hook、注册实际用户的 marketplace 或自动信任 Hook。
- 已通过 4 个定向测试文件的 19 项测试；最终增加 Windows PowerShell 启动检查后，重新运行插件打包测试 2 项通过。覆盖异地/带空格路径打包和解压、Skill 清单、既有输出保护、合法写入及跨 change 写入拒绝。执行了 TypeScript 检查、受影响文件格式检查、Classic/Native/Entry Runtime 构建及生成物一致性检查；公开 CLI 版本输出为 `0.5.3`。
- `pnpm lint` 的 ESLint 阶段为 0 错误、8 条既有警告；架构阶段被已有顶层 `.ruff_cache` 阻塞，未清理无关目录。`verify:changed --plan` 只用于查看建议范围，实际采用上述定向检查，未执行整个脚本测试目录或全量测试。
- 本次无用户缺陷修复声明；没有新增 badcase。未进行真实 Codex 会话安装/Hook 信任验证、Dashboard 桌面交互、npm 发布安装或模型 Eval；没有创建 PR、提交、推送或公开发布。其他任务的 `.comet/config.yaml` 与 website 变更保留。
- 另用 Codex CLI `0.163.0` 的公开 `plugin marketplace add`、`plugin add comet@comet-local --json` 在隔离 HOME/CODEX_HOME 中完成安装烟测，返回安装版本 `0.5.3`；未加载模型或绕过 Hook 信任。CLI 因测试 HOME 位于临时目录而警告不创建 PATH aliases，两个安装命令均成功。此证据不代替桌面真实会话加载。
- 当前本机 `comet --version` 为 `0.5.2`，本仓库 `node bin/comet.js --version` 为 `0.5.3`。本次未替用户升级全局 CLI；使用配套开发版本的方法见插件说明。

## 10. 后续实施：已创建 DSH 插件

用户要求为 Comet 创建 DSH 插件后，本次按 DSH 原生 bundle 方式完成首版实现，并安装到
当前 `desktop` profile 做运行验证。

- 源码：[插件模板](../../plugin/dsh/)（`package.json`、`cordis.patch.yml`、Host
  `index.js`、Client `client.js`、locale、icon、README）与[打包脚本](../../scripts/build/build-dsh-plugin.mjs)。
  `pnpm build:dsh-plugin` 生成 `dist/dsh-plugin/<版本>-zh/comet-dsh-plugin/` 及同版本归档；
  登记在 `assets/manifest.json`、`config/repository-layout.json` 和 `package.json` 脚本中。
- Host 半通过 `ctx.skills.register()` 注册 13 个内置 Skills（`source: bundled`，
  `resourceBase` 指向包内技能目录），并注入 `agents`、`workingDirectory`、`subprocess`
  与 `webServer` 注册两个路由：只读 `GET /comet-plugin/status` 报告插件与技能状态，
  `POST /comet-plugin/dashboard` 接收 `sessionId`、解析工作区目录、启动或复用
  `comet dashboard <工作区> --no-open` 并返回实际 URL 与一个本机回环代理地址
  （`webUrl`）。Client 半在 `sidebar.panellist` 注册 Comet 入口（与「插件」「自动化任务」
  同一区域，图标使用 Comet 官方 logo），并在 `main` 注册面板：选中入口时解析当前会话、
  调用 Dashboard 路由，把 `webUrl` 作为 iframe 铺满主内容区；工具栏提供「刷新」与
  「在右侧栏打开」（走 `ctx.sidebarRight.openTab` 的已有路径）；不引入 Harness Client 包。
  反向代理替浏览器补齐 Dashboard 要求的 Host，并去掉 Origin 与 Sec-Fetch-*，因此没有
  放宽 Dashboard 自身的同源校验。
- CLI 同样随包分发：插件模板把 `@rpamis/comet` 声明为自身依赖（构建时写入与插件相同的
  版本，可用 `--cli-spec` 覆盖），从 registry 安装 bundle 时一起装上；运行时优先用自带
  副本（以 `process.execPath` 执行其 bin，Electron 下补 `ELECTRON_RUN_AS_NODE`），找不到
  再退回 PATH 中的 `comet`。自带 CLI 存在时，插件生成临时包装脚本并注册
  `ctx.shellEnv` 的 `DSH_COMET_CLI`，中文 Skills 已增加“存在该变量时用它代替 `comet`”的
  说明（英文 Skills 待用户确认后同步）。`pnpm` 的 `link:` 安装不会安装被链接包的依赖，
  因此本地开发安装仍走 PATH 回退，这不影响正式包安装。
- 插件页的描述与详情文档：`locale/zh.json`、`locale/en.json` 的 `meta.description` 用
  README 式简介概括 Skill、主内容区 Dashboard 与自带 CLI；`meta.detail` 分别指向
  `README.md` 与新增的 `README.en.md`，Plugins 页面据此渲染完整说明，文档内链接到
  [Comet GitHub](https://github.com/rpamis/comet)；`package.json` 的 `homepage` 与
  `repository` 也指向该仓库。
- 安装：`plugin_manager install_bundle` 以构建目录绝对路径安装
  `comet-dsh-plugin@0.5.3`，结果为 `application: applied`、无 warning。卸载后重新安装
  同一目录，新的 Host/Client 模块即时生效，无需重启。
- 已验证：bundle 行 `comet` 出现在 profile；状态接口返回 13 个技能且
  `provider = runtime`、`source = bundled`；`sidebar.panellist` 出现 `comet` 注册、
  `main` 出现 `comet` 键；用一个存活会话的完整 id（`session-<uuid>`）调用 Dashboard
  路由返回 `{"url":"http://localhost:4321","webUrl":"http://127.0.0.1:10158","started":true,"cwd":"D:\\Project\\Comet"}`；
  以浏览器式请求头访问 `webUrl`，页面返回 200 与 `Comet Dashboard` 标题，静态资源
  `/assets/index-*.js` 返回 200，`/api/dashboard/projects` 返回真实 JSON；换一个同工作区
  会话再次调用返回 `started:false`，复用同一进程与代理。插件打包、路由、代理与 CLI
  解析/包装脚本测试 4 项、Skills 契约测试 613 项、相邻仓库测试 33 项、TypeScript 检查与
  受影响文件 Prettier 检查通过。
- 未验证：主内容区 iframe 的实际渲染与左侧栏入口的选中交互（本会话没有可用浏览器控制，
  Orca 未运行，本次未启动它），以及 Desktop 渲染页是否允许该跨源 iframe（页面 CSP 未核对）；
  真实新会话中模型读取技能正文的内容级核对（运行时注册已由状态接口证明）。
- 边界：插件以 `link:` 指向仓库构建目录，清理该目录会使插件失效；`engines.dsh` 声明为
  `>=0.2.2-rc.1`，更新目标版本后需要重测；与文件式安装同名时项目级 Skills 优先；
  Dashboard 进程由插件按工作区启动并复用，插件卸载或停用会终止这些进程，Harness 重启后
  不认领旧进程，可能再启动一个新服务；Desktop profile 需要在桌面内管理，
  `--profile web` 成功不代表桌面已生效。
- 本次未执行模型 Eval、未提交、未推送、未创建 PR 或评论 Issue。

## 11. 后续实施：Codex Dashboard 侧栏与会话入口

用户要求实现侧栏入口后，本分支新增本地 stdio MCP App，复用完整 Dashboard。
上文对 Codex 扩展面的未确认项，以及首版插件“不含 MCP”的说明，记录的是此前阶段。

- 插件与内置 Runtime 均保持 `0.5.3`。最终归档为
  `dist/codex-plugin/0.5.3-zh-sidebar-final/comet-codex-0.5.3-zh.tar.gz`；
  同目录含可安装的本地 marketplace。根项目仍为 `0.5.3`，相对当前 `origin/master`
  的 `0.5.2` 只增加一个版本。
- [MCP 服务](../../plugin/codex/mcp-server.ts)分别注册 `open_dashboard`（global）
  和 `show_dashboard`（thread），接受空参数；静态 HTML 资源由 MCP Apps SDK 连接。
  入口声明和图标回退遵循 [OpenAI MCP Extensions 规范](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#mcp-app-entrypoints)。
  MCP server 明确提供内嵌 PNG 图标，与插件列表、Dashboard 使用同一份 Comet Logo。
- [打包脚本](../../scripts/build/build-dashboard-mcp.mjs)将 MCP 服务、客户端 SDK 与现有
  Dashboard 前端装入插件，运行不依赖源码仓库或外部 `node_modules`；本机需要 Node.js 22。
  工作流 CLI 仍单独安装，既有 13 个 Skills 与 Hook Router 保留。
- 打开入口时才启动随机本地端口；临时 256 位令牌只放入工具结果的 UI 元数据，不进入
  模型可见内容或可缓存 HTML。[HTTP 服务](../../domains/dashboard/server.ts)只允许精确令牌
  路径的跨来源 iframe 导航，API、写请求与其他资源保留同源检查，不全局开放 CORS。
  MCP 连接关闭时停止本进程管理的服务；连接失败可重试。面板可切换原有项目索引中的项目。
- 账户私有插件仍保留此前 `0.5.3` release，没有上传本轮包。Plugin Creator 更新接口会
  将同版本上传自动增加 patch；用户明确要求保留 `0.5.3`，因此本次交付本地包，未创建
  第二个账户插件或替换原身份。账户插件链接仍指向首版，不能当成本轮侧栏包的安装入口。
- 已执行定向 HTTP、MCP 协议、归档/真实 stdio、Dashboard 服务器及发布元数据测试；
  5 个文件共 25 项通过，1 项 Linux 专用文件描述符测试在 Windows 跳过。浏览器测试
  1 项通过，通过模拟 MCP App 平台桥接，读取隔离项目的公开 CLI
  创建结果，检查连接失败重试、详情加载、1600/1280/390 宽度、横向溢出和暗色设置；
  这些证据不代替真实 Codex 桌面入口加载。
- Codex CLI `0.163.0` 在临时 HOME/CODEX_HOME 中通过公开 marketplace/add 命令安装
  本轮 `0.5.3` 包；测试配置随后清理，没有注册用户真实 marketplace、信任 Hook 或启动模型。
  临时 HOME 下 PATH aliases 的提示不影响两个安装命令返回成功。
- TypeScript、受影响文件格式和生成物检查通过；完整 lint 的架构阶段仍被无关顶层
  `.ruff_cache` 阻塞。未运行全量测试、真实桌面点击、真实会话 Hook 或模型 Eval。
  未声明用户缺陷修复，不新增 badcase；未提交、推送或公开发布。

## 12. Codex 侧栏内容被屏蔽报告与修复

来源：`report:2026-11-06-codex-sidebar-blocked`。用户已安装并重启客户端，点击
Comet Dashboard 后仍显示“该内容被屏蔽了”。本节取代第 11 节的 HTTP iframe 接入方案。
插件、项目版本继续使用 `0.5.3`；当前 `origin/master` 为 `0.5.2`。

### 复现与原因

- Codex `26.1029.9216.0` 的本机日志在 `2026-11-06T14:35:55Z`、`14:37:06Z`
  记录 `ERR_BLOCKED_BY_CSP`、错误码 `-30`。资源读取和 MCP 沙箱创建已经成功，
  被拦截的是 `http://localhost:8761/` 的嵌套页面。
- 日志分别给出外层 `frame-src 'self' https: data: blob:` 和内层 `frame-src 'none'`。
  只读检查客户端资源中的 CSP 归一化代码确认：HTTP frame origin 不会进入允许列表。
  重启不能改变这个限制；不修改客户端安装文件或全局安全策略。
- 旧包 `dist/codex-plugin/0.5.3-zh-sidebar-final` 在禁止嵌套 iframe 的浏览器复现中
  无法显示隔离项目。旧浏览器测试手动允许本机 HTTP frame，漏掉了真实客户端限制。
  [官方 CSP 说明](https://developers.openai.com/plugins/build/chatgpt-ui#content-security-policy-csp)
  也要求明确声明嵌套 frame 来源；客户端实际接受哪些来源仍以当前版本为准。

### 最终实现与检查边界

- MCP 资源 `ui://comet/dashboard-native` 内联已有 Dashboard React/AntD 页面、样式和
  Comet Logo。资源 URI 更新以区分旧缓存，旧 `ui://comet/dashboard` 地址也返回当前页面，
  兼容已打开的侧栏入口，插件版本不变。页面不嵌套 iframe，
  `frameDomains`、`connectDomains` 均为空，仅允许内联图片资源。
- `dashboard_read`、`dashboard_write` 仅对界面公开，转发既有 Dashboard GET/POST API；
  拒绝外部 URL、反斜杠、跳出 API 前缀的路径和读取操作的正文。数据放入 UI 元数据，
  原有服务端接口校验保留。打开页面和读取记录均不启动 Eval。
- 打包器内联前端并压缩脚本，回归测试检查 MCP 资源 JSON 小于 SDK stdio 的 10 MiB
  单消息限制。服务、前端、13 个 Skills、Hook 和 Logo 仍随同一插件分发。
- 定向测试覆盖资源声明、真实 stdio 归档、接口成功读取与非法路径拒绝。浏览器使用
  `srcdoc`、`frame-src 'none'`、`connect-src 'none'`，检查真实隔离项目、变更详情、
  连接失败重试、1600/1280/390 宽度及暗色设置，最终要求没有 CSP 错误或浏览器 API 请求。
  2026-11-06 此浏览器检查通过；截图位于
  `coverage/playwright-mcp-results/mcp-dashboard-browser-rend-8ce30-rk-access-under-desktop-CSP/`。
- badcase `codex-dashboard-native-csp-rendering` 绑定包和接口测试，并分别登记浏览器验收
  与真实 Codex 侧栏验收；浏览器通过，真实客户端由用户重启后确认“显示正常了”。

### 本机验收与限制

真实客户端的原错误已有日志证据。2026-11-06 BENYM 完全重启 Codex 后确认“显示正常了”，
证明新版侧栏恢复显示；项目和变更详情的交互由上述浏览器验证覆盖，没有人工遍历全部操作。
第一次替换后用户仍报告被屏蔽；`2026-11-06T15:05:00Z` 的新日志确认客户端请求旧 URI，
随后收到 `Resource ui://comet/dashboard not found` 和 `Transport closed`。已新增旧地址兼容，
通过公开 CLI 重新安装 `dist/codex-plugin/0.5.3-zh-native-panel-compatible`，用户随后确认恢复正常。
安装核对比较了包与缓存中的 199 个文件，确认版本、Comet Logo、两个入口和数据接口，
非 Comet 配置与紧邻安装前备份一致；浏览器直接使用已安装目录验证旧地址也能显示新版。
配置比较按 TOML 语义进行，排除 Comet 自身配置和客户端重启后更新的
`mcp_servers.node_repl.env.SKY_CUA_NATIVE_PIPE_DIRECTORY` 会话管道目录，其他字段保持一致。
当前 computer-use 指南明确禁止自动操作 Codex 界面，因此没有用 GUI 自动化替代人工确认。
本次不信任 Hook、不运行模型 Eval、不升级全局 CLI，也不改动账户中的首版私有插件。

本轮验证结果：5 个定向 Vitest 文件共 26 项通过，1 项 Linux 专用文件描述符检查在
Windows 跳过；已安装包的严格 CSP 浏览器测试通过，真实 Codex 侧栏由用户确认正常。
TypeScript、受影响源码 ESLint、格式、生成物和 badcase 基线保留检查通过。
完整 lint 先前被已有顶层 `.ruff_cache` 阻塞，本轮未将它改成通过；未运行全量测试、
真实平台 Hook 或模型 Eval。代码尚未提交、推送或公开发布。

## 13. 插件展示信息与自动安装 CLI

来源：`report:2026-11-06-codex-plugin-listing`。用户报告插件详情显示回形针、网站不可用，
并要求介绍先说明 Comet 的用途，随后补充自动安装 CLI 和卸载重装的要求。
用户明确选择“保持 0.5.3，只更新本地版”。账户中的私有插件未上传更新，避免后台自动升到 0.5.4。

### 展示信息

- 本地清单补充 `extensions.com.openai.interface.websiteURL`，指向
  `https://github.com/rpamis/comet`。原先只有 `homepage`，不会自动填入详情页的网站字段。
  [官方字段说明](https://developers.openai.com/plugins/deploy/submission#listing-metadata)
  明确区分这两个字段。
- 介绍按 README 的产品定位重写，说明可恢复任务、Native、Classic、Comet Any 与 SDK、
  个人记忆和项目知识、Eval 与 Dashboard。依赖和自动安装行为放在末尾。
- 列表与输入框图标使用 `assets/comet-logo.png`，内容与已检查的 Comet PNG 完全一致。
  当前 Codex CLI 和桌面内置 `codex.exe` 的 `plugin/read` 均识别了新字段，
  `fs/readFile` 成功读出 139530 字节 PNG；这不等于界面已经显示它。
- 图标显示仍未解决。只读检查当前桌面 `26.1029.9216.0` 的 image loader：先将反斜杠
  归一化，再对绝对路径要求原输入以 `/` 开头，因此 Windows `C:\\...` 本地图标返回空值。
  同一客户端的 `61330` 路径工具模块和 `CBsD` 图像模块确认了这个判断。
  用户已报告更新后仍是回形针。没有修改 Codex 安装文件；图标问题保留为客户端验收待完成，
  不能用资源存在、接口可读或重装成功宣布它已修复。

### 自动准备 CLI

- 构建时按 npm 发布清单装配 `@rpamis/comet` 安装包，剔除 `dist/codex-plugin` 和
  `dist/dsh-plugin`，避免构建产物递归进入 CLI 包。记录版本和 SHA-256，插件与 CLI 均为 0.5.3。
  调查时 npm 的已发布最新版仍为 0.5.2；本地配套包不依赖同版先发布到 npm。
- 首次启用 MCP 即在后台执行全局 npm 安装；`setup_comet_cli` 等待或重试准备操作。
  受信任的 `SessionStart` Hook 执行相同检查，并给出不依赖 PATH 的 CLI 绝对入口。
  安装需 npm 依赖网络和全局目录写权限，不会初始化项目、安装第三方 Skills 或启动 Eval。
- 安装前检查 npm 全局目录中实际包身份及 CLI 输出，健康的同版或更高版本直接复用；
  进程间锁合并并发安装，包版本或摘要不符即停止。Windows npm 使用真实 JS 入口，
  不通过拼接 shell 命令安装。
- 普通定向测试使用临时 HOME 和 npm prefix，验证并发仅装一次、摘要损坏不安装、
  不降级健康新版本。额外的真实 MCP entry 测试在调用任何 setup 工具之前观察到安装产物，
  证明启用时会自动准备 CLI；测试使用无依赖的最小 npm 包，不代表完整 Comet 发行包。
- 已执行插件公开 `server/comet-cli-setup.mjs`，安装完整配套包，将本机全局 CLI 从
  0.5.2 升到 0.5.3，随后 `comet --version` 确认 0.5.3。没有运行真实模型 Eval。

### 本机交付与验证范围

项目 `build.js` 会清空 `dist`，因此将实际安装源移至持久目录
`C:/Users/BENYM/.codex/local-marketplaces/comet-0.5.3-final`。
已通过公开 CLI 卸载并重新安装启用 `comet@comet-local`；缓存与安装源的 203 个文件匹配，
非 Comet 配置保持一致，两个 Dashboard 入口、数据接口和 CLI setup 工具检查通过。

本轮定向 Vitest：打包 3 项、安装器 3 项、Node 命令适配 7 项、MCP 2 项、自动启动 1 项通过，
Node 命令适配中的 1 项平台检查在 Windows 跳过。严格 CSP Dashboard 浏览器测试通过。
编译和完整 build、受影响源码 ESLint、生成物检查通过；架构 lint 仍被已有顶层 `.ruff_cache`
阻塞。未运行全量测试、真实受信任 Hook 或模型 Eval。网站链接与介绍以客户端元数据读取为证据，
不代替真实详情页操作；Windows 图标显示保持未解决，负责人为 BENYM，后续需客户端修复后复核。

## 14. 插件源码目录整理（2026-11-07）

插件按平台集中到 `plugin/codex/` 和 `plugin/dsh/`。Codex 目录包含清单、图标、
Hook 模板、MCP 服务入口、CLI 准备入口和 Dashboard 界面包装；DSH 目录包含
Host/Client 入口、Cordis 配置、图标、语言文件与说明。

完整 Dashboard 和工作流状态机继续由 `domains/` 维护，CLI 安装与进程适配继续由
`platform/` 维护，构建器仍在 `scripts/build/`。插件可调用共享能力，共享层不反向依赖插件。
仓库布局登记、TypeScript、ESLint、格式检查、覆盖率和按差异验证均已覆盖 `plugin/`。
安装包输出结构不变，原有 Dashboard 集成测试及 badcase 选择器保留原路径。

本次是未发布功能的源码整理，不新增用户行为修复；版本继续使用 0.5.3（当前
`origin/master` 为 0.5.2），不另写内部重构的 Changelog 条目。

验证：8 个 Vitest 文件共 50 项通过，涵盖两平台打包、MCP、仓库布局、架构约束和
按差异验证；Codex 安装包在严格 CSP 下的 Dashboard 浏览器测试 1 项通过。
TypeScript、生成物检查、badcase 登记检查与受影响文件格式检查通过，源码 ESLint
无错误，DSH 原有未使用参数保留 1 条警告。实际架构检查仍只被已有 `.ruff_cache`
顶层目录阻塞。未运行全量测试、真实平台安装或模型 Eval；未更改本机已安装插件或发布插件。

## 15. 插件补充验收（2026-11-07）

来源：`report:2026-11-07-plugin-verification`。本轮补做真实 DSH 桌面、npm 安装和
Codex 原生接口验证；未公开发布或启动模型 Eval。

### DSH 安装与真实页面

原安装通过 `link:` 指向 `dist`，目录已被构建清理，进程仍缓存旧模块，并使用 PATH 中的
CLI。该页面能够显示，不代表当前配套 npm 包可以安装和运行。本轮改用持久目录中的 npm
包安装到 `desktop` profile，并保留原有其他依赖、bundle 顺序和用户 patch。

验证发现并修正三个独立行为：

1. `dsh-plugin-npm-includes-skills`：旧 npm 清单只有 10 个文件，漏掉全部 Skills。
   原始 tar 包完整不能证明 npm 包完整。新增 npm 发布清单回归先失败，加入 `skills`
   后通过；实际安装目录存在 13 个技能入口及 Runtime。
2. `dsh-plugin-bundled-cli-node-mode`：CLI 描述及生成的 shell 包装脚本明确保留
   `ELECTRON_RUN_AS_NODE=1`。用真实 DSH 可执行文件验证：无标志的调用不输出 Comet
   版本，有标志的调用输出 0.5.3；生成的 Windows 包装脚本实际执行也返回 0.5.3。
3. `cli-node-arguments-under-electron`：真实页面报 `unknown command`，后跟 `comet.js`
   路径。根因是 Commander 自动按打包后的 Electron 应用解析参数，将脚本路径当作命令。
   同一公开 CLI 回归在普通 Node 下通过、Electron 标识下失败；显式按 Node 参数布局解析
   并重新编译后，两种环境均通过。单测中的 Electron 标识模拟只证明参数分支，随后实际
   桌面页面复验用于证明完整安装链路。

最终本地安装包位于
`C:/Users/BENYM/.dsh/local-plugins/comet-0.5.3-final/`，CLI 配套包位于
`C:/Users/BENYM/.dsh/local-plugins/comet-cli-0.5.3-verified/`。二者版本均为 0.5.3。
这是本地验证用 `file:` 依赖，不代表同版已发布到 npm。DSH 自带 pnpm 会阻止依赖的
postinstall，使用本次命令的 `--ignore-scripts` 后安装成功；未更改全局脚本信任策略。
从旧 `link:` 切换时保留旧链接备份，并重新启用原有 Comet bundle。只安装 npm 依赖不能
代替桌面 bundle 启用，旧 Node 模块的缓存还可能需要重启桌面刷新。

真实桌面已点击左侧 Comet，在主内容区显示项目概览、52 个归档记录与 Native 工作区。
实际状态接口返回 `cli.source=bundled`、CLI 与插件版本 0.5.3、13 个技能；代理页面携带
跨源 iframe 请求头仍返回 HTTP 200，项目数据接口返回 JSON。已在隔离 HOME 和临时 Git
项目中用安装后的 CLI 完成 `native init`、`native new`，并用真实 DSH 可执行文件运行生成
的 shell 包装脚本。没有借用 PATH 中的旧 CLI 声明配套包通过。

随后点击「在右侧栏打开」，实际 Browser 面板成功显示同一项目的概览和归档数量；不是
上一次会话保留的页面占位。主内容区和右侧栏两条真实 UI 路径均已通过。

### Codex 尚未通过的边界

当前桌面为 `26.1103.4239.0`，内置 Codex 为 `0.167.0-alpha.3.2`。其公开 `plugin/read`
能读取 Comet、13 个技能和 `comet-dashboard`，但 `hooks` 返回空数组；`hooks/list` 也没有
Comet 插件 Hook。独立目录中的最小对照确认：保留当前 Agent Plugins `$schema` 时 MCP
可发现而 Hook 不可发现；去掉 `$schema` 时 Hook 可发现，但原 MCP 和展示信息失去发现。
另加旧 MCP 文件虽能恢复 MCP，展示信息仍不完整，因此没有把这种有损替换交付为修复。

该结果是当前客户端的兼容性失败，尚未完成真实 Hook 执行验收；没有自动信任 Hook、修改
客户端或覆盖账户插件。后续需保留 MCP、展示信息和信任规则的完整兼容方案，再做实际
事件验收。负责人为 BENYM。用户随后在当前桌面 `26.1103.4239.0` 的本地
`comet@comet-local` 详情页确认“Logo 和 GitHub 链接均正常”；两项真实界面验收据此更新
为通过，证据来源是用户确认。此前版本的图标失败记录保留为历史，不能据此推导当前版本
仍有同一问题，也不将当前结果归因于未经核实的客户端代码改动。

DSH 插件仍只提供 Skills、CLI 和 Dashboard；原生工具事件到 Comet Guard 的桥接未实现，
验证不能代替补齐该能力。英文 Skill 中的 CLI 路径说明也仍待中文确认后同步。

### 本轮检查与限制

8 个定向 Vitest 文件共 86 项通过；新增 npm 清单、Node 启动模式及公开 CLI Electron
参数案例均有旧代码失败、新代码通过记录。TypeScript 编译、受影响源码 ESLint、格式、
badcase 登记和差异空白检查通过。未运行全量测试、真实模型 Eval、npm 发布、提交或推送；
未变更 website。版本保持 0.5.3，master 同类 CLI 参数解析问题记入该版本 Fixed。

生成物一致性检查通过；当前真实架构检查仍仅被原有 `.ruff_cache` 顶层目录阻塞，未删除
该目录或添加豁免。DSH 安装完成后的检查确认其他依赖、bundle 顺序和用户 patch 的配置内容
保持一致；桌面保存改变了 patch 的格式，字节级比较不同，解析后的完整配置相同。

## 16. 复用 init 的平台接入（2026-11-07）

用户提出插件可复用 `comet init` 已安装的 Hook 和 Rule。核对当前源码并执行隔离公开 CLI
后，确认该方案成立。上文“DSH 原生 Guard 桥接未实现”表述不准确：仓库已有
`domains/skill/dsh-adapter.ts` 的官方桥接配置，缺少的是插件接入这条现有安装与激活链路，
不应据此另建一套工具事件桥接。

本轮在独立临时 HOME、DSH_HOME、CODEX_HOME 和 Git 项目中执行：
`comet init <项目> --platform codex|dsh --workflow native --scope project --language zh --yes --codegraph skip --json`。
两次均成功。Codex 生成 `.codex/hooks.json`、`.codex/rules/comet-workflow-guard.md` 和
`AGENTS.md`；DSH 生成 `.dsh/hooks.json`、引用 `@deepseek-ai/dsh-hooks-claude-code` 的
`.dsh/cordis.patch.yml` 和带托管规则的 `AGENTS.local.md`。这些结果只证明公开安装入口，
没有在本轮执行真实 Hook 事件或模型 Eval。

后续建议：插件继续提供 Skills、CLI 和 Dashboard；首次接入具体项目时复用安装器的
Hook、Rule、Runtime 资源及检查能力。已初始化项目核对已有配置即可；必须保持唯一 Router，
处理插件 Hook 与项目 Hook 的重复，保留用户配置，并遵守 Codex 信任和 DSH profile 激活。
直接复用完整 init 会复制插件已有的 Skills，集成时应复用其相关步骤，避免双份技能和升级漂移。
这仍是后续接入方案，本轮未改变插件行为。

Rule 文件存在不等于 Agent 已读取。Codex 的默认指令发现来自 `AGENTS.md` 等配置文件，
不能假定 `.codex/rules/*.md` 自动进入指令；仍需检查现有指令注入和规则引用是否覆盖 Guard
说明。[Codex 官方指令发现规则](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance)。

## 17. 插件启用时自动接入（2026-11-07）

用户否定首次使用时再手动初始化的方案，并明确要求实现。当前插件在启用阶段完成平台接入，
不对普通项目执行 `comet init`。版本保持 0.5.3，账户插件没有更新或发布。

### 实现

- Codex MCP 启动时准备 CLI，随后在 `CODEX_HOME/hooks.json` 合并 `SessionStart` 和
  `PreToolUse`。这两项使用原生用户级 Hook，绕过当前客户端不能发现便携包 Hook 的
  兼容性缺口；插件清单关闭重复包内注册。未改写 Hook 信任记录。
- `SessionStart` 提供随包的工作流 Rule 和 CLI 绝对入口，不向全局 `AGENTS.md` 写规则。
  规则仅约束已启动的 Comet 工作流；普通任务不会自动初始化或启动 Eval。
- Hook 启动器独立保存在平台配置目录中，命令绑定插件资源内容摘要。更新规则或 Runtime
  后需要重新审阅；资源内容改变时拒绝继续使用旧命令。Codex 禁用插件时放行，缓存删除后
  只清理引用该安装的定义。配置损坏、目录链接和并发启用分别有保留/拒绝/幂等测试。
- DSH 包声明官方 `@deepseek-ai/dsh-hooks-claude-code`、`dsh-hook-protocol` 与 `dsh-llm`
  0.2.2-rc.1 依赖。实际桌面并未自带完整的可解析桥接，不能只假定发行版提供；DSH 安装
  策略也未自动补齐这些运行时 peer，最终由 Comet 包明确携带。Host 用 Cordis 生命周期
  挂载桥接，配置位于独立的 `DSH_HOME/comet-plugin/`；停用/卸载时解除，不改用户 patch。
- 两个平台都复用原 Router 与 Guard。只有新 Hook 已经实际执行后，才移除当前 Git 项目中
  旧的 Comet 所有 Hook，保留其他用户定义；既有会话快照可能再执行一次旧检查。
  DSH 中 Router 启动失败或异常退出会编码为官方桥接可识别的拒绝，不当作放行。

源码分别位于 `domains/skill/plugin-integration.ts`、`plugin-hook-entry.ts`、
`plugin/codex/mcp-server-entry.ts` 和 `plugin/dsh/index.js`；构建脚本打包所需 Rule、启动器
和官方依赖清单，没有复制 Native/Classic 状态机。中文及英文 DSH README 已更新；本轮
未修改 Skill 正文，先前英文 Skill 的 CLI 说明同步仍待中文确认，不把它记为已完成。

### 验证与本地安装

最终 Codex marketplace 输出为 `C:/Users/BENYM/.codex/local-marketplaces/comet-0.5.3-ready/`，
DSH 包为 `C:/Users/BENYM/.dsh/local-plugins/comet-0.5.3-ready/`。通过各自 CLI 安装，未直接
编辑安装缓存。DSH 仍使用已验证的本地配套 CLI `file:` 包；不代表 npm 已发布 0.5.3。

Codex 更新过程中，旧 MCP 进程占用缓存导致 CLI 删除失败。识别并结束仅引用 Comet MCP
入口的两个 Node 进程后，支持的安装命令成功；未终止 Codex 主程序或其他插件。
原生桌面 `hooks/list` 能发现两项 Comet 用户 Hook，状态为 `untrusted`，现有用户 Hook
保持原样。用户需在 `/hooks` 中审阅并信任，然后开始新会话；负责人 BENYM。
当前未取得受信任后的真实 Codex 事件执行证据，不能把“发现成功”写成“Guard 已生效”。

实际 DSH desktop profile 已报告 `integration.status=ready`、配套 CLI 0.5.3 与 13 个 Skills。
另用安装后的官方桥接、真实打包命令和隔离临时项目运行离线事件：`SessionStart` 注入
一份规则上下文，未创建 `.comet`；`PreToolUse` 拒绝其他 change 的写入，放行普通源码
写入，并记录 `hook/invoked` 与 `hook/result`。事件上下文与 shell 适配器为测试夹具，
它证明官方桥接协议到打包 Router 的链路，不代替真实模型执行。

本轮 7 个相关 Vitest 文件共 24 项通过，覆盖 CLI 自动准备、用户级 Hook 合并、官方桥接
挂载/解除、npm 清单、Rule 注入、实际 Router、普通项目、跨 change 拒绝、停用/卸载、
旧定义迁移、内容改变与异常退出。两个插件构建、TypeScript 编译、受影响源码 ESLint、
格式、badcase 登记、差异空白及生成物一致性检查通过。新案例为
`codex-plugin-automatic-platform-integration` 与 `dsh-plugin-automatic-official-hook-bridge`。
Codex 配置的变化仅是本地 Comet marketplace 来源；DSH 其他依赖、bundle 顺序及用户
patch 配置保持一致。

未运行仓库全量测试、真实模型 Eval、npm 发布、提交或推送。真实架构检查仍仅被原有
`.ruff_cache` 顶层目录阻塞，未删除或添加豁免。未修改 website 内容或子模块引用。

最终包重新安装后，用户按 Escape 停止桌面操作，后续 UI 操作已停止。上面的 DSH
`ready` 来自前一个已补齐依赖的候选；最终包的安装和官方桥接离线事件通过，但最终桌面
重启尚未完成，需用户重启 DSH 后加载。Codex 最终包的两项原生 Hook 仍为 `untrusted`。

随后用户确认已在 Codex 审阅信任并新开会话。最终只读 `hooks/list` 核对两项均为
`trusted`、加载错误为空；这补齐原生信任状态确认，不把它当作真实跨 change 写入拦截的
事件证据。DSH 最终桌面重启仍未完成。

## 18. 已有文件式安装自动迁移（2026-11-07）

用户要求已有本地 Comet 的用户安装插件后自动迁移，保留 CLI 与项目数据。本轮增加
`domains/skill/plugin-migration.ts`；路径适配集中于
`platform/install/plugin-migration-paths.ts`，沿用现有平台元数据，不调用完整卸载流程。

### 迁移行为

- Codex 启用 MCP 时，在用户配置中追加 `[[skills.config]]`，按旧 `SKILL.md` 的绝对路径
  设置 `enabled=false`。旧文件保留给其他 Agent，插件自己的 Skill 不受影响；不按名称
  整体禁用。[官方路径停用配置](https://learn.chatgpt.com/docs/build-skills#enable-or-disable-local-codex-skills)。
- DSH 的新 Hook 执行时，备份已识别的旧 `SKILL.md` 后移出发现位置。只处理入口，Runtime、
  引用文件与其他平台安装均保留；官方桥接的离线 `SessionStart` 验证已覆盖实际触发迁移。
- 旧 Rule、Hook 等新 Hook 实际执行后再迁移。Hook 只移除可识别的 Comet 定义；DSH
  指令只移除内容匹配的 `COMET:DSH` 片段，用户前后文原样保留。共享 `AGENTS.md` 不动。
- 识别使用已发布 0.4.0 至 0.5.2 的 Git 内容摘要及当前构建中英文资产摘要，清单位于
  `config/plugin-migration-assets.json`，构建时进入插件 `rules/migration-assets.json`。
  自定义内容、未知版本、链接、明确的用户 Skill 开关和损坏配置保留，写明原因。
- 改动前将原文写入平台配置目录下的 `comet-plugin/migration-backups/`，校验成功后才改源文件。
  每份备份附带 `source`、`backup`、前后摘要和平台；`migration-reports/` 记录本次处理和保留项。
  并发执行使用与插件配置安装相同的锁，重复执行不重复添加路径项。输入无效时不迁移。
  回退须先禁用插件，再按记录合并恢复，不能用旧完整配置覆盖后来的用户设置。

### 验证结果

在隔离 HOME 的同条件旧/新 MCP 启动对照中，旧 `0.5.3-ready` 包保留了可发现的旧入口，
新包自动按路径停用且文件原文不变。新的测试先因缺少迁移模块失败，再通过。

实际已安装 CLI 的公开 `comet init` 在两个临时 Git 项目中生成 Native 安装后，最终插件包
分别迁移 Codex 7 项、DSH 7 项；重复迁移均为零变更。项目 `.comet/config.yaml` 和共享
`AGENTS.md` 字节一致。真实桌面内置 app-server 确认旧 `comet` 入口 `enabled=false`，
插件 13 个 Skill 均启用；没有模型调用。此接口验证不等于真实模型遵循指令。

最终 DSH 安装包的官方桥接收到离线事件后，`SessionStart` 迁移一个真实旧入口并注入 Rule，
`PreToolUse` 拒绝跨 change 写入、放行源码写入；事件上下文及 shell 适配器为测试夹具。
本轮没有操作桌面界面，最终 DSH profile 仍需用户重启后加载新包，再开始新会话。

六个定向 Vitest 文件共 28 项测试通过，按改动分轮执行；覆盖历史定义、配置保留、链接、
损坏配置、备份失败、并发/重复迁移、未有效触发不写入、CLI 自动准备、打包清单、桥接和
Router。TypeScript、受影响源码 ESLint、格式、badcase 登记、生成物及差异空白检查通过。
案例为 `codex-plugin-migrate-file-skills` 和 `dsh-plugin-migrate-file-skills`。
架构检查仍仅被本机既有 `.ruff_cache` 顶层目录阻塞，没有删除或放宽规则。

### 本机安装结果

本地最终包分别位于 `C:/Users/BENYM/.codex/local-marketplaces/comet-0.5.3-migration-final/`
和 `C:/Users/BENYM/.dsh/local-plugins/comet-0.5.3-migration-final/`，均通过平台 CLI 重新安装，
保持 0.5.3，没有直接编辑缓存、发布账户插件、提交或推送。website 未修改。

本机先处理 8 个入口，另有 9 个暂因摘要不符保留。进一步对照 Git blob 后，确认这 9 个
全部来自未修改的 0.4.x 发布版本，因此补齐发布清单后自动处理。最终原生技能接口确认：
17 个旧文件式入口停用，13 个插件入口启用，加载错误为零。原文件全部保留；配置原文和
备份路径保存在本机迁移记录中。未覆盖或删除第三方 Skills。

Hook 新增迁移逻辑后，Codex 原生信任状态为 `modified`，需要用户重新审阅两项 Hook 并新开
会话；没有改写信任记录。真实 Codex 新 Hook 事件及最终 DSH 桌面复验未完成；未运行全量
测试或真实模型 Eval。源 Skill 正文未改动，先前待确认的双语言 Skill 同步不算本轮完成项。

## 19. Codex marketplace 更名（2026-11-07）

按用户要求，将当前 marketplace 标识改为 `comet-market`，显示名为 `Comet Market`。
插件名称及版本保持 `comet`、0.5.3，当前安装 ID 为 `comet@comet-market`。构建脚本、
安装说明和当前测试夹具已同步；前文的 `comet-local` 保留为实际历史记录。

本机通过支持的 CLI 注册新市场并安装新插件后，移除旧插件及 `comet-local` 注册。
最终目录为 `C:/Users/BENYM/.codex/local-marketplaces/comet-0.5.3-comet-market/`。
已用完整配置比较确认：除市场和对应插件 ID 外，其他用户配置一致，17 个旧 Skill 的
路径停用设置保留，其他用户 Hook 不变。没有直接编辑安装缓存或信任记录。

三个相关测试文件共 12 项通过，打包、格式、受影响测试 ESLint 和差异空白检查通过。
真实桌面 app-server 确认新市场插件已安装启用、13 个 Skill 启用、旧市场不再出现。
两项 Hook 正确引用 `comet@comet-market`；缓存入口路径改变后仍为 `modified`，需原生
重新审阅信任，真实 Hook 事件未在本轮执行。未运行全量测试或 Eval，未修改 DSH、website，
未提交、推送或发布。

用户随后确认已重新审阅信任。只读原生 `hooks/list` 核对当前 `comet-market` 的
`SessionStart` 与 `PreToolUse` 均为 `trusted`，加载错误为空；其他 9 项 Hook 仍可发现。
本次确认信任状态，没有启动模型或额外执行跨 change 拦截场景。

## 20. 最终接入验证（2026-11-07）

本轮按用户要求完成发布以外的接入验证，版本保持 0.5.3，市场保持 `comet-market`。
远端 master 与本地 origin/master 均为 `a61a2e5b`，版本及上一发布 tag 均为 0.5.2。
没有修改账户插件、提交、推送或发布；website 的既有子模块状态保留。

### 双语言 CLI 入口

13 个英文 Skill 已同步中文的 `DSH_COMET_CLI` 说明：PowerShell 使用
`& $env:DSH_COMET_CLI ...`，bash 使用 `"$DSH_COMET_CLI" ...`，未提供变量时使用 PATH。
契约测试先在未同步的英文入口失败，修改后覆盖中英文全部 13 个公开入口并通过。
本机实际 DSH ShellEnv 注册了插件 CLI 变量；将 PATH 限制为 Windows System32 后，
通过该变量启动插件包装脚本，返回 0.5.3，证明此入口不依赖全局安装。

### 原生事件中发现的两个协议缺口

使用 Codex Desktop 26.1103.4239.0 内置 app-server、已信任的用户 Hook 和临时 Git 项目，
由本机回环 Responses 服务返回固定补丁调用，实际执行原生 `apply_patch`。没有调用真实模型。
旧候选确实写入了非当前 Classic change 的 `tasks.md`。先前只调用内部 Guard 的测试不能
覆盖这一失败。初步调整 matcher 未解决问题，最终确认以下两个独立原因：

1. 原生补丁位于 `tool_input.command`，适配器原先只读取其他补丁字段，得到空目标。
   现仅为 `apply_patch` 解释该字段；Bash 的 command 不视作文件补丁，并保留旧补丁字段。
2. 补齐目标解析后，Router 拒绝写入并返回 2，但 Windows PowerShell 的 `-Command`
   将原生进程退出码 2 转为 1。Codex 记录 `hook exited with code 1` 后继续执行工具。
   插件入口现将拒绝、进程失败、无效输入和包内容变化编码为退出 0 的原生 JSON deny。
   普通 Router 命令仍保留原有退出码协议；允许路径仍正常执行。

新增案例分别为 `codex-native-apply-patch-command`、
`codex-plugin-json-denial-on-powershell`，来源为
`report:2026-11-07-plugin-final-validation`。适配器的新断言及打包 JSON deny 断言均取得
旧代码失败、新代码通过的证据；打包测试还实际经过 PowerShell，核对 deny 原因，覆盖
包变化、Router 故障、无效事件不迁移和合法写入。Windows 专属测试补充了原生验证边界。

### DSH 原生服务验证

通过已安装 DSH 0.2.2-rc.1 的 Electron 与官方 Cordis 服务，在隔离 HOME 中加载实际
Comet 插件。使用真实 Agent factory、Session、WorkingDirectory、Shell、ShellEnv、
NativeToolExecutor 和官方 filesystem tools，没有模拟 Agent 或 shell 事件回调：

- Agent 创建后，真实 inbox 收到 Comet Rule；已知 0.5.2 文件式 Skill 自动备份迁移。
- 普通项目保持未初始化；准备临时 Classic selection 后，另一 change 的写入被拒绝且文件不存在。
- 同一真实工具执行链成功创建允许的源码文件。
- 解除插件 scope 后，同一路径的写入恢复正常，证明桥接随插件释放。
- 插件自带 CLI 在没有全局 CLI 的 PATH 中返回 0.5.3。

### 本机最终安装与验收状态

最终本地包位于 `C:/Users/BENYM/.codex/local-marketplaces/comet-0.5.3-json-hooks-1107/`
和 `C:/Users/BENYM/.dsh/local-plugins/comet-0.5.3-json-hooks-1107/`，通过各自平台 CLI 安装，
未直接编辑安装缓存。DSH 的 CLI 依赖指向本次完整构建的本地 npm archive；它只供本机
验证，不是公开分发规格。其他 DSH 依赖、bundle 顺序与 profile patch 原样保留。

用户已确认最终两项 Hook 重新信任，并重启 DSH。只读 `hooks/list` 确认两项均为 `trusted`，
其他 9 项 Hook 仍可发现。最终原生复验实际收到 22 条 Hook 通知：SessionStart 成功注入
规则；跨 change 补丁的 PreToolUse 状态为 `blocked`，目标文件没有创建；允许的补丁状态为
`completed`，文件内容与预期一致。工具实际调用而非模型遵循由固定的本机 Responses 响应
驱动，未调用真实模型。失败候选与最终候选的原生测试使用同一隔离项目结构和断言。

DSH 重启后本次监听端口变为 8663；使用其进程实际监听地址查询状态，确认指纹为
`ccd4d495d17dba18238ee125`，与最终安装包计算结果一致，`integration=ready`，
13 个插件 Skill 与自带 CLI 0.5.3 均已加载。用户已确认重启后 Dashboard 正常。
桌面操作曾被 Escape 中止，之后未再自动操作界面，最终界面由用户手动验证。

本机 app-server 为临时项目添加的项目记录在测试结束后按精确路径清理；保留用户手动
更新的两项 Hook 信任及其他设置。清理前后解析校验保证只移除本轮创建、已删除临时目录
对应的条目。Hook 发现、平台配置、真实执行和模型遵循分别记录，不互相替代。

本轮最终核对后，Codex 和 DSH 的其他用户设置均与先前备份相符。写入验收记录时曾触发
历史 `comet-any-sdk` 的投影诊断；公开 doctor 修复因其 045 分支绑定而未修复，具名
`--migrate-history` 保留该 Run 为 active，未封存任务。之后重试记录写入成功；未改绑历史
分支、取消任务或推进其流程，也未把这一检查声明为旧任务已修复。

实际普通检查包含受影响 Skill、插件打包、Hook 适配器、Router、TypeScript、ESLint、
格式和生成物一致性。一个 POSIX 符号链接入口测试按其既有条件在 Windows 跳过；
没有运行全量测试或真实模型 Eval。架构检查仍仅被既有 `.ruff_cache` 顶层目录阻塞，
没有删除该目录或放宽规则。本轮四项插件原生验收登记已通过定向完整性检查；全局
`--require-acceptance` 仍被无关的 `native-bugfree-formal-edit-preflight` 待验收项阻塞，
没有改写该案例。按用户要求未发布；没有启动 Eval。

## 21. 共享 Skill 去除平台提示（2026-11-07）

按用户要求，移除 13 个中文及 13 个英文 Skill 中重复的 DSH CLI 路径提示。
共享入口只使用 `comet` 命令，DSH 插件负责将自带 CLI 的临时入口加入本进程 PATH，
不修改系统或用户永久 PATH；停用时只移除自己的目录，保留其他运行中新增的 PATH 项。
不再向模型注入 `DSH_COMET_CLI` 变量，Codex 的 CLI 准备方式保持不变。

新的 Skill 契约先在旧提示存在时失败；裸 `comet` 调用的 PATH 断言也在旧 shim 上失败。
修改后两项通过。DSH 打包相关 7 项与 Skill 契约共 8 项通过；后续移除不再需要的环境
变量注册后，相关启停、命令及契约 3 项复验通过。真实 DSH Cordis 服务在隔离 HOME 中
通过原生 PowerShell ShellExecutor 执行 `comet --version`，PATH 不含全局 Comet 目录，
返回 0.5.3；规则注入、旧入口迁移、写入拒绝／放行及解除桥接一并验证。未调用模型。

本轮只更新源码和临时构建的验证包，没有重新安装桌面插件或修改 Hook 信任。
已安装桌面包的验证记录保留在第 20 节；下次更新插件时由平台重新加载新资源。
`CHANGELOG.md` 追加到既有 0.5.3 的最终能力描述，不新增版本或内部修复条目。

提交前对比发现历史 `comet-any-sdk` 归档的本机检查点已由 v1 迁移到 v2，正式文档状态
仍为 done，但检查点并非逐字段相同，因此保留本机数据，不把这份 Runtime 迁移作为插件
代码提交。先前已有的 website gitlink 差异同样保留在本地。
