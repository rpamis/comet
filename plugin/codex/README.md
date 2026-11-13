# Comet Codex 插件

Comet 是一个面向 Agent 的可恢复长程任务工作流与 Skill 平台，帮助你从需求推进到实现、
验收和归档。任务状态保存在项目中，换会话或中断后可以继续。

- **Native 与 Classic**：Native 让 Agent 自主选择实现方法，由 Runtime 检查状态、验收和归档；Classic 保留 OpenSpec 与 Superpowers 的完整阶段流程。
- **Comet Any 与 SDK**：将 Skill、工具、用户确认和验收步骤组合成可运行、可恢复的工作流。
- **个人记忆与项目知识**：保留协作偏好、项目结构和经过验证的经验，减少重复交代与探索。
- **Comet Eval**：用 Rubric、Pass@k 和 Pass^k 记录评估证据，比较 Skill 与工作流表现；仅在用户明确要求时启动。
- **Dashboard**：从 Codex 侧栏或会话面板查看项目、工作流进度、变更详情、产物和评估记录。

项目地址：[rpamis/comet](https://github.com/rpamis/comet)。

插件包含 Comet Skill、工作流 Hook Router 和本地 Dashboard MCP App。
工作流通过本机的公开 `comet` CLI 推进；Dashboard 服务随插件分发。
启用插件时自动准备配套 CLI，并注册用户级 Hook。
打开面板时才启动 Dashboard。

## 准备执行环境

本地执行环境需要 Node.js 22.16 或更高版本及 npm。插件携带与自身版本一致的
`@rpamis/comet` npm 安装包；首次启用 MCP 时自动执行全局安装，补齐 npm 依赖。
已安装同版或更高版本且通过 CLI 版本检查时直接复用，不重复安装或自动降级。
此过程需要网络访问 npm 依赖及全局 npm 目录的写权限。

在执行 Comet 工作流前，可使用插件的 `setup_comet_cli` 工具等待安装完成；安装失败时
也可用它重试。MCP 启动完成后会在 `CODEX_HOME/hooks.json`（默认 `~/.codex/hooks.json`）
合并一个 `SessionStart` 和一个 `PreToolUse` Hook，保留用户的其他定义。
审阅并信任后，新会话会收到 Comet 工作流 Rule 和 CLI 的绝对入口；PATH 没有 `comet`
时，Agent 可通过 `node <入口>` 使用相同的公开 CLI。无需先手动运行 `comet init`。
插件不会自动信任 Hook；已有会话需要新开会话才能收到规则。

检查版本：

```text
comet --version
```

本分支插件与 Comet 均使用 `0.5.3`；构建命令输出 `cometVersion` 说明内置 Runtime 的版本。
工作流使用配套 CLI；不要把本机安装直接当作 WSL、
容器或远程执行环境中的安装。Classic 所需的 OpenSpec、Superpowers 等能力沿用现有
Comet 配置；插件不分发这些项目的原始 Skills，也不自动授权加载或执行它们。

打包前先运行 `pnpm build`。CLI npm 包由当前发布文件清单构建并绑定版本与 SHA-256，
不依赖同版已经发布到 npm；npm 上的旧版不会替代本分支的配套包。
托管环境可设置 `COMET_PLUGIN_SKIP_CLI_INSTALL=1` 关闭 MCP 启动时的自动安装，
自行预装合适版本；显式调用 `setup_comet_cli` 仍可准备 CLI。

## 本地安装

源码仓库中执行 `pnpm build:codex-plugin`。命令会输出插件目录、私有归档和 marketplace
根目录的绝对路径；默认生成在 `dist/codex-plugin/<插件版本>-zh/`。
需要重新构建时，通过 `--output-root <新目录>` 指定另一目录；已有插件目录不会被覆盖。

```text
codex plugin marketplace add <输出的marketplace根目录>
codex plugin add comet@comet-market
```

在桌面插件页面检查 Comet 已启用，再开始新会话。安装后从技能选择器加载 Comet；
显示名和命名空间以当前客户端为准。启用时会识别原有 Comet 文件式安装，并在 Codex
配置中按绝对路径停用已知版本的旧 Skill；原文件保留，其他 Agent 仍可使用。
不按名称整体停用，插件自己的同名 Skill 继续可用。新会话或重启客户端后加载更新的清单。

迁移覆盖 0.4.0 至 0.5.2 的已知发布版本与当前构建中内容未修改的 Skill。自定义内容、目录链接、
用户明确设置的 Skill 开关、无法解析的配置都会保留，并写明原因；不要求先卸载 CLI。
共享的 `AGENTS.md`、Runtime 和项目数据保留。旧 Rule 和 Hook 等受信任的新 Hook 实际
执行后再迁移，迁移前保存原文。备份及记录位于 `CODEX_HOME/comet-plugin/migration-backups/`
与 `migration-reports/`；`setup_comet_cli` 会返回记录路径。回退时先禁用插件，按备份记录
核对 `source` 与 `backup` 后恢复文件，并移除带 `comet-plugin-migration` 标记的路径停用项。
不要用整个旧配置覆盖后来添加的用户设置。

## Hook 信任与既有安装

插件使用 Codex 原生用户级 Hook，由现有 Router 选择当前 Native 或 Classic Guard。
包内 Hook 不再重复注册。在 Codex `/hooks` 中审阅并信任自动注册的定义；此操作由 Codex
原生安全机制要求，插件不绕过。更新改变规则或 Runtime 时会生成新的内容绑定命令，需要重新审阅。
未审阅、被禁用或客户端不支持的 Hook 不代表 Guard 已启用。

只有新 Hook 实际执行后，才移除当前 Git 项目里旧的 Comet Router/Guard 定义，保留其他
用户 Hook。当前会话已加载的旧定义可能再执行一次；新会话使用更新后的配置。
插件禁用时新 Hook 放行；插件缓存移除后，残留启动器会放行并清理只引用该安装的用户级定义。
工作流 Rule 随会话事件提供，不写入全局 `AGENTS.md` 或伪装为 Codex 命令策略规则。

## Dashboard

启用插件的 `comet-dashboard` MCP 服务后，开始新会话。
在支持 MCP App Extensions 的桌面应用中，从左侧「Comet Dashboard」入口打开完整页面，
也可从会话的面板入口打开。若入口尚未出现，检查插件/MCP 是否启用并刷新插件或重启客户端；
较旧桌面版本需先更新。此功能需要本地执行环境中的 Node.js，不能在云端直接访问本机项目。
本插件的 MCP 服务要求 Node.js 22 或更高版本。

打开面板会启动插件内置的 Dashboard，展示当前工作目录及已有项目索引。
项目切换、筛选、详情、设置和其他操作复用原页面；打开面板和读取记录不会启动 Eval。
Eval 开始、重跑与其他写操作仍需用户明确操作，并遵守原 Runtime 的授权要求。

面板直接加载插件内的 Dashboard 页面、样式和 Comet Logo，通过仅供界面使用的 MCP 工具
调用本地 Dashboard API，不嵌套本机 HTTP 页面，也不要求浏览器访问本机端口。
面板连接失败可点击「重新连接」。数据接口只接受 Dashboard API 路径，保留原接口校验，
未全局开放 CORS。

多个面板可以共用当前 MCP 进程的本地服务。关闭某一个面板不关闭其他面板使用的服务；
MCP 连接结束时会关闭本进程启动的服务，保留用户手动启动的其他 Dashboard。

需要普通浏览器入口时，仍可在项目中执行：

```text
comet dashboard <项目绝对路径> --no-open
```

在浏览器中打开命令实际输出的 `http://localhost:<端口>`；端口冲突时可能改变。
手动启动的服务在原终端按 Ctrl+C 停止。

## 更新与卸载

插件更新通过所选 marketplace/私有插件渠道进行；下次启用时检查并准备配套 CLI，
已安装且健康的更高版本保留。CLI 也可通过 npm 单独更新。
新会话中核对 Skill 与 CLI 版本，以及 Hook 是否需要重新信任。

本次侧栏包以本地 marketplace 分发并保持 `0.5.3`。账户中的同版本私有插件仍是首版；
Plugin Creator 会自动提升同版本更新的 patch，因此本次没有通过它覆盖账户版本。

```text
codex plugin remove comet@comet-market
```

卸载插件不会删除项目中的 Comet change、Run、Spec、知识或个人记忆，也不会停止用户手动
启动的 Dashboard；插件管理的服务在其 MCP 连接结束时关闭。公共插件目录对 Hook 插件
有限制，本归档用于本地或私有分发，不代表公共上架。
