# Comet DeepSeek Harness 插件

Comet 是一个面向 Agent 的可恢复长程任务工作流与 Skill 平台，帮助你从需求推进到实现、
验收和归档。任务状态保存在项目中，换会话或中断后可以继续。

- **Native 与 Classic**：Native 让 Agent 自主选择计划、实现、测试和审查方法，由 Runtime 检查状态、验收和归档；Classic 保留 OpenSpec 与 Superpowers 的完整阶段流程。
- **Comet Any 与 SDK**：将 Skill、工具、用户确认和验收步骤组合成可运行、可恢复的工作流。
- **个人记忆与项目知识**：保留协作偏好、项目结构和经过验证的经验，减少重复交代与探索。
- **Comet Eval**：用 Rubric、Pass@k 和 Pass^k 记录评估证据，比较 Skill 与完整工作流的表现；仅在用户明确要求时启动。
- **Dashboard**：从 DSH 左侧的 Comet 入口查看当前项目、工作流进度、变更详情、产物和评估记录，也可在右侧栏打开面板。

插件包含 Comet Skill、工作流 Guard、本地 Dashboard 和配套 CLI。Comet Skill 注册到
DeepSeek Harness 的技能目录；左侧的 Comet 入口在主内容区打开当前会话工作区的 Dashboard。
从 npm 或私有包安装时，插件会一并安装匹配版本的 Comet CLI，并在当前 DSH 进程中提供
`comet` 命令；没有自带副本时使用 PATH 中已有的 CLI。启用时自动接入官方 Hook 桥接，
无需先手动运行 `comet init`。Classic 依赖沿用项目配置。

源码、文档与问题反馈：[https://github.com/rpamis/comet](https://github.com/rpamis/comet)

## 准备执行环境

从 npm 或私有包安装插件时，`@rpamis/comet` 会作为插件依赖一起安装，版本与插件一致，
不需要再全局安装 CLI：

```text
dsh plugin --profile <profile> add <插件包名或目录> --ignore-scripts
```

插件启动时会把自带 CLI 的临时入口加入当前 DSH 进程的 PATH。Skills 直接执行 `comet`，
无需改写命令；这不会修改系统或用户的永久 PATH。禁用插件时，只移除它自己的入口，
保留其他 PATH 项。启用前已存在的持久 Shell 需要新开会话或重启后继承环境。
没有自带副本时（例如用 `link:` 指向本地构建目录的开发安装，
pnpm 不会安装被链接包的依赖），继续使用 PATH 中的 `comet`：

```text
npm install -g @rpamis/comet
comet --version
```

CLI 版本必须与插件一致。若该版本尚未发布，先在对应源码分支运行 `pnpm build`，再执行
`npm install -g <源码仓库绝对路径>` 使用本地构建；不要把 npm 的旧版安装写成已匹配版本。

## 构建

源码仓库中执行：

```text
pnpm build:dsh-plugin
```

命令输出插件目录、归档和版本号；默认生成在 `dist/dsh-plugin/<版本>-zh/comet-dsh-plugin/`。
需要另一目录时使用 `--output-root <新目录>`；已有输出不会被覆盖。`--language en` 使用
英文 Skills。`--cli-spec <pnpm 规格>` 覆盖依赖里的 CLI 版本/来源，默认与插件版本相同；
本地验证时可以指向已发布版本或 `file:` 路径。

## 发布到 npm

`comet-dsh-plugin` 与 `@rpamis/comet` 是两个独立的 npm 包，需要分别发布。
先确认公共 npm 中已有匹配版本的 `@rpamis/comet`，再运行 `pnpm build:dsh-plugin`。
源码模板的 `private: true` 防止误发占位版本；正式构建包会移除此标记，并指定公共 npm。
在完成打包测试与发布文件检查后，从构建目录发布，不直接发布源码模板：

```text
npm publish dist/dsh-plugin/<版本>-zh/comet-dsh-plugin --access public --dry-run
npm publish dist/dsh-plugin/<版本>-zh/comet-dsh-plugin --access public
npm view comet-dsh-plugin@<版本> version --registry=https://registry.npmjs.org/
```

发布后使用 `npm pack comet-dsh-plugin@<版本>` 确认用户可以拉取。
同名同版本只能发布一次；本地或私有构建仍可使用前述目录安装方式。

## 安装与卸载

插件是 npm/Cordis bundle，安装后作为该 profile 的 bundle 生效，影响该 profile 的所有
会话。通过 DSH 的 Plugin Manager 安装插件目录的绝对路径；也可以使用 DSH CLI：

```text
dsh plugin --profile <profile> add comet-dsh-plugin --ignore-scripts
```

本地构建验证时，将包名替换为插件目录绝对路径。安装指定版本时使用
`comet-dsh-plugin@<版本>`；公开 npm 包默认包含中文 Skills。

桌面端有自己的 profile（默认 `desktop`）。用 Desktop 自带的 `dsh plugin` 管理该
profile，或从桌面 Plugins 页面安装；`--profile web` 安装成功不代表桌面已生效。
安装后在 Plugins 页面确认 Comet，并在一个已打开的会话中点击左侧栏的 Comet 入口。
若环境没有 HMR，可能需要重启后再验证。

CLI 命令安装 npm 依赖后，还需在 Plugins 页面确认 bundle 已启用。DSH 使用的 pnpm
可能因依赖的安装脚本而返回 `ERR_PNPM_IGNORED_BUILDS`；上面的 `--ignore-scripts`
只跳过本次安装的生命周期脚本，不更改全局信任设置。Comet 已包含构建产物，自己的
postinstall 只输出初始化提示；使用插件自带 CLI 不依赖这个脚本。不要将退出失败
或仅安装依赖视为桌面插件已经加载，须核对 Comet 入口与技能注册状态。

卸载只移除插件本身，不删除项目中的 Comet change、Run、Spec、知识或个人记忆：

```text
dsh plugin --profile <profile> remove comet-dsh-plugin
```

## Dashboard 的启动与归属

选中左侧栏的 Comet 入口时，Host 会用解析到的 Comet CLI（插件自带优先，否则 PATH）为当前
会话的工作区执行一次：

```text
comet dashboard <工作区绝对路径> --no-open
```

插件从命令输出读取实际监听地址（默认 `http://localhost:4321`，端口冲突时会变化），并在
本机回环地址上开一个只属于本插件的反向代理，再把主内容区设为这个代理地址的 iframe。
反代会替浏览器请求补齐 Dashboard 要求的 Host，并去掉浏览器带来的 Origin 与
Sec-Fetch-* 头，因此不需要放宽 Dashboard 自身的同源校验；Dashboard 的页面、静态资源和
`/api/dashboard/...` 请求都经同一代理转发。页面顶部的「刷新」重载当前 Dashboard，
「在右侧栏打开」改用 Harness 的右侧栏 Browser 标签（同一服务、同一 URL）。

同一个工作区在同一个 Harness 进程内复用已启动的服务和代理；不同工作区各自启动。插件
停止或卸载时，它会终止自己启动的这些 Dashboard 进程并关闭代理，因此再次打开会重新启动；
Harness 重启后不会认领旧进程，可能再启动一个新服务。右侧栏 Browser 标签的刷新、导航和
关闭由 Harness 的 Browser 面板负责，关闭标签不会停止服务。没有打开会话时，入口页会提示
先打开一个会话。

CLI 缺失、工作区不可用或 Dashboard 启动失败时，主内容区会显示原因，不会静默失败。
查看 Dashboard 不授权启动 Eval。

## 既有文件式安装

插件安装时一并安装官方 `@deepseek-ai/dsh-hooks-claude-code`，启用后为当前 profile
自动挂载 `SessionStart` 与 `PreToolUse`。规则通过新会话事件提供，写入交由原有 Router
检查；配置位于 `DSH_HOME/comet-plugin/`（默认 `~/.dsh/comet-plugin/`）的独立目录，
不向项目复制 Rule，也不改写用户的 profile patch。禁用或卸载插件会解除桥接。
`/comet-plugin/status` 的 `integration` 字段报告准备结果；失败会保留原因，不视为保护已生效。

新 Hook 实际执行后，会移除当前 Git 项目里旧的 Comet Router/Guard 定义，保留其他用户
Hook；已有会话快照可能再执行一次旧定义。新会话会收到最新规则。

`comet init` 会把 Skills 安装到项目的 `.dsh/skills` 或用户目录。插件注册的是运行时
Skills；按 DSH 的层级规则，项目目录中的同名 Skills 优先。新 Hook 执行时会识别旧安装，
将内容匹配 0.4.0 至 0.5.2 的已知发布版本或当前构建的旧 `SKILL.md` 备份后移出发现位置，由插件接管。
Runtime、引用文件、共享 Skills、项目数据和其他平台安装保留；自定义或未知版本入口保留，
并在会话规则中提示迁移记录。已识别的旧 Hook 只移除 Comet 定义，旧 Rule 只移除匹配的
`COMET:DSH` 片段，保留片段外的用户内容。迁移可重复执行，不要求卸载全局 CLI。

备份及记录位于 `DSH_HOME/comet-plugin/migration-backups/` 与 `migration-reports/`。
已有会话需要新开会话或重启后使用新清单。回退时先禁用插件，按记录中的 `source` 与
`backup` 核对并恢复原入口；混合配置须合并恢复 Comet 部分，避免覆盖后续用户设置。

## 更新

更新插件按当前安装渠道重新安装构建输出；自带 CLI 随插件版本一起更新，使用 PATH 中的
CLI 时按对应 npm 安装渠道单独更新。重新构建到新目录，再按原渠道安装新包；
若页面没有更新则重启 DSH。新会话中核对技能、CLI 版本和桥接状态。插件更新不会删除
文件式 Skills，也不改写用户的 profile patch。
