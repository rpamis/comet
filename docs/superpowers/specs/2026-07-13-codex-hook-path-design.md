# Codex Hook 安装路径修复设计

## 背景

Comet 0.4.0-beta.4 将 Codex 的 Skill 安装目录从 `.codex/skills` 迁移到 Codex 当前识别的 `.agents/skills`，同时保留 `.codex` 作为 Codex 配置、规则和 Hook 的根目录。但 Codex 仍与 Claude Code 共用 `claude-code` Hook 配置路径，导致项目级和用户级安装都把 Hook 写入 `.codex/settings.local.json`。

Codex 实际从配置层旁的 `hooks.json` 或 `config.toml` 内联 Hook 表加载 Hook。对 Comet 当前的独立 JSON 配置方式，正确位置分别是：

- 项目级：`<repo>/.codex/hooks.json`
- 用户级：`~/.codex/hooks.json`

当前 Hook 的三层 JSON 结构（事件、matcher 组、command handler）与 Codex 支持的结构兼容，因此问题在于配置文件路径，而不是 Hook 内容结构。

## 目标

- 项目级和用户级 Codex 安装、更新及 Bundle 分发统一写入 `.codex/hooks.json`。
- 更新已有安装时，将 Comet 管理的 Hook 从错误的 `.codex/settings.local.json` 安全迁移到 `.codex/hooks.json`。
- 卸载时同时清理正确路径和历史错误路径中的 Comet Hook。
- 始终保留用户或第三方配置，不因迁移覆盖、删除或重写无关 Hook。
- Claude Code、Amazon Q 及其他平台的 Hook 行为保持不变。

## 非目标

- 不改变 Comet phase guard 脚本、matcher 或 Hook 输出协议。
- 不迁移用户自行配置的非 Comet Hook。
- 不自动修改 Codex 的 Hook 信任状态；新建或变更的非托管 Hook 仍由 Codex 自身要求用户审核。
- 不将 Codex Hook 改为 `config.toml` 内联格式。

## 方案选择

### 采用：路径与格式分离

在平台定义中分别表达 Hook 的内容格式、当前配置文件名和历史配置文件名：

- `hookFormat` 继续描述 JSON 内容结构。
- 新增当前 Hook 配置文件字段；未配置的平台保持现有默认路径。
- 新增历史 Hook 配置文件列表，仅用于迁移和卸载。
- Codex 使用 `hooks.json`，并把 `settings.local.json` 声明为历史错误路径。

这种设计避免复制一套与 Claude Code 基本相同的 JSON 合并逻辑，也避免在安装、卸载和 Bundle 分发中分别硬编码 `platform.id === 'codex'`。

### 未采用：新增 `codex` Hook 格式

优点是分支直观，但会把“文件路径不同”误建模成“内容格式不同”，造成重复实现和后续漂移。

### 未采用：按平台 ID 特判

改动最少，但路径规则会分散到安装、卸载和 Bundle 代码，难以确保所有入口持续一致。

## 组件设计

### 平台元数据

`platform/install/platforms.ts` 为 Hook 增加数据化路径信息。Codex 的配置根仍由 `configDir: '.codex'` 决定，Skill 根仍为 `.agents`；只有 Hook 配置文件名从默认的 `settings.local.json` 覆盖为 `hooks.json`。

历史路径使用相对于平台配置根的文件名列表，以便未来其他平台也能复用相同迁移机制。

### 安装与更新

`domains/skill/platform-install.ts` 按以下顺序处理 Codex Hook：

1. 读取 `.codex/hooks.json`；文件不存在时从空对象开始。
2. 删除其中旧的 Comet command handler，再按 matcher 合并当前 Comet handler。
3. 保留其他事件、matcher、handler 和顶层字段。
4. 成功写入 `.codex/hooks.json` 后，再处理历史 `.codex/settings.local.json`。
5. 从历史文件中只删除可通过 manifest 脚本路径识别出的 Comet handler。
6. 如果某个 matcher 组被清空，则删除该组；如果 `PreToolUse` 被清空，则删除该事件；如果 `hooks` 被清空，则删除 `hooks` 字段。保留文件内其余内容。

先写正确文件再清理历史文件，确保更新不会在新配置写入失败时先移除已有 Comet 配置。

若历史文件不是合法 JSON，迁移不会覆盖或删除该文件。正确的 `hooks.json` 仍可完成安装，避免一个 Codex 不加载的历史文件阻断 phase guard 修复。

### 卸载

`domains/skill/uninstall.ts` 对当前路径和所有历史路径执行相同的“只删除 Comet handler”过滤逻辑，并合并删除数与失败数：

- 当前路径：`.codex/hooks.json`
- 历史路径：`.codex/settings.local.json`

非 Comet Hook 和其他 JSON 字段保持不变。现有 CLI 继续通过 `hooksRemoved` 和 `hooksFailed` 报告结果。

### Bundle 分发

`domains/bundle/bundle-platform.ts` 使用同一平台元数据解析 Hook 目标文件。Codex Bundle 的 Hook 安装操作因此写入 `.codex/hooks.json`，JSON 合并语义保持不变。

## 数据流

项目级与用户级只在传入的 `baseDir` 不同，路径解析流程一致：

1. `getPlatformConfigDir()` 解析 Codex 配置根 `.codex`。
2. 平台 Hook 文件元数据解析当前目标 `hooks.json`。
3. `getPlatformSkillsDir()` 独立解析命令脚本所在的 `.agents/skills`。
4. Hook JSON 写入 `.codex/hooks.json`，handler command 继续指向 `.agents/skills/comet/scripts/comet-hook-guard.mjs`。

这保持了“配置根”和“Skill 发现根”两个路径概念的边界。

## 错误处理与数据安全

- 当前目标 JSON 无法解析时，不覆盖文件，并返回安装失败原因。
- 当前目标写入失败时，不清理历史文件。
- 历史文件无法解析时，不修改它；正确目标已写入的安装结果仍保留。
- 删除识别仅依据 manifest 中的 Comet 脚本路径，不能按 matcher 或事件名称批量删除。
- 不删除整个 `settings.local.json` 或 `hooks.json`，即使移除 Comet Hook 后只剩其他用户字段。

## 测试策略

遵循 TDD，先增加能够在当前实现上因错误路径而失败的回归测试，再修改生产代码。

覆盖范围：

- 平台定义：Codex 当前 Hook 文件为 `hooks.json`，历史文件为 `settings.local.json`。
- 项目级 init：生成 `.codex/hooks.json`，不生成新的 `.codex/settings.local.json`，command 指向 `.agents/skills`。
- 用户级安装：在用户根下生成 `.codex/hooks.json`。
- update 迁移：正确文件写入后，从历史文件删除 Comet Hook并保留第三方 Hook 与其他字段。
- 非法历史 JSON：不被覆盖或删除，正确文件仍生成。
- uninstall：同时清理新旧路径中的 Comet Hook，并保留无关配置。
- Bundle：Codex Hook destination 为 `.codex/hooks.json`。
- Claude Code 回归：仍使用 `.claude/settings.local.json`。

验证顺序：

1. 新增定向测试并确认 RED 原因是当前 Codex 路径为 `settings.local.json`。
2. 完成最小实现并运行定向测试至 GREEN。
3. 运行相关 init、update、uninstall、platform 和 Bundle 测试。
4. 运行格式、lint、build 和全量测试；如遇仓库已知的并行 `dist` 竞争，分别报告默认并行与串行验证证据。

## Changelog 与版本

当前 `package.json` 与 `origin/master` 均为 `0.4.0-beta.4`，且现有 Changelog 已有高于上一个正式版本的 `0.4.0-beta.4` 条目。本修复不会升级版本号，而是在该版本 `Fixed` 下追加一条英文、用户可感知的 Codex Hook 路径修复，说明项目级和用户级安装现在写入 Codex 实际加载的 `hooks.json`，并安全迁移历史错误配置。
