# dsh 平台原生安装研究（Comet Issue #343）

- 研究日期：2026-08-20
- 研究范围：只读核查 dsh 的官方仓库、官方文档和官方源码，评估 Comet 对 dsh 平台安装面的后续兼容边界。
- 当前状态：仅研究记录；本次未修改 Comet 生产代码、未创建 beta20 worktree、未提交或推送任何代码。
- 资料基线：DeepSeek Harness 官方仓库当前 `master`。该项目仍标注为 developer preview，目录和 API 可能发生兼容性变化。

> 结论先行：dsh 的正式产品是 DeepSeek Harness，npm CLI 包名为 `@deepseek-ai/dsh`，命令为 `dsh`。它已经有明确的 Skill 和 Agent instruction 文件系统；Skill 的原生项目目录是 `<project>/.dsh/skills`，全局目录是 `$DSH_HOME/skills`（默认 `~/.dsh/skills`）。Agent instruction 的全局入口是 `$DSH_HOME/AGENTS.md`，项目级则沿目录树查找 `AGENTS.md`、`CLAUDE.md` 及对应的 `.local.md` overlay。当前官方资料没有定义可自动发现的通用 Rule 目录，也没有证明 `.dsh/hooks.json` 会被自动读取；Hook 目前通过显式 `configPath` 的 Claude Code/Codex bridge，或通过 dsh Profile/Cordis plugin API 接入。

## 1. Issue #343 需求摘要

官方 Issue：[rpamis/comet#343](https://github.com/rpamis/comet/issues/343)。Issue 标题为“feat: 原生支持deepseek harness”，标签包含 `area:platform` 和 `enhancement`，目标里程碑为 `0.4.0-rc.1`。

Issue 当前描述的需求是：Comet 目前只能借助 Claude Code 和 Codex 环境间接兼容 dsh，尚未原生支持 `dsh init`；希望在 `comet init`、`comet update`、`comet uninstall` 中原生兼容 dsh，并覆盖 Skill、Rule、Hook、Script、Reference 等分发内容，同时复用现有 Comet CLI 逻辑，先查明 dsh 官方安装路径。

因此，本研究重点确认 dsh 的原生消费面，而不是把 Comet 已有目录名直接映射到 dsh。

## 2. dsh 的正式产品与仓库身份

| 项目       | 官方证据                                                                                                               | 结论                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 产品       | [DeepSeek Harness 官方 README](https://github.com/deepseek-ai/deepseek-harness)                                        | dsh 是 DeepSeek AI 开源的 agent harness，官方称为 DeepSeek Harness，命令简称为 `dsh`。   |
| 源码仓库   | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)                                        | 官方仓库组织是 `deepseek-ai`，不是一个独立的“dsh 平台目录仓库”。                         |
| npm CLI    | [`apps/cli/package.json`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/package.json) | 包名为 `@deepseek-ai/dsh`，bin 为 `dsh`；当前官方 `master` 的包版本显示为 `0.1.0-rc.8`。 |
| 发布成熟度 | [官方 README](https://github.com/deepseek-ai/deepseek-harness#readme)                                                  | README 标明 developer preview，明确提示可能存在 breaking changes。                       |

`master` 上的版本、目录和包依赖不能直接等同于 beta20 发布时的稳定契约；后续实现应锁定实际采用的 dsh 版本，并在对应版本上做安装、更新和卸载验证。

## 3. 官方路径与优先级

### 3.1 dsh Home

官方路径实现见 [`packages/util/home-paths/src/index.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/util/home-paths/src/index.ts)，官方说明见 [home-paths README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/README.md)。

解析优先级为：显式传入的 home 路径，其次环境变量 `DSH_HOME`，最后默认用户目录 `~/.dsh`。dsh 将其作为一个统一 home 根目录使用，而不是自动拆分成 XDG 风格的多个根目录。

下文的 `$DSH_HOME` 表示解析后的 dsh home；未设置时就是 `~/.dsh`。

### 3.2 Skill 目录

官方 Skill 规范：[docs/subsystems/skills.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)；文件系统实现：[skill-filesystem/src/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/skill/skill-filesystem/src/index.ts)。

官方扫描优先级如下，数字越小优先级越高：

| 优先级 | 类型                  | 原生目录                                           |
| -----: | --------------------- | -------------------------------------------------- |
|    100 | 项目级 dsh            | `<projectRoot>/.dsh/skills`                        |
|    200 | 项目级共享 Agent 目录 | `<projectRoot>/.agents/skills`                     |
|    300 | 自定义目录            | `Config.customSkillDirs` 配置的目录                |
|    400 | 用户级 dsh            | `$DSH_HOME/skills`，默认 `~/.dsh/skills`           |
|    500 | 用户级共享 Agent 目录 | `$DSH_AGENTS_HOME/skills`，默认 `~/.agents/skills` |
|    600 | Bundled Skill         | `Config.bundledSkillDir`，只有配置该目录时才参与   |

项目根目录默认通过向上查找最近的 `.git` 确定；找不到时使用当前工作目录。

Skill bundle 的直接入口必须位于上述目录下一层，典型形态为：

```text
<skill-root>/<skill-name>/SKILL.md
```

官方实现同时支持 `<skill-root>/<skill-name>.md` 这种扁平入口；不会把任意深层目录递归当作 Skill 入口。Skill 可以通过 `scripts/`、`references/`、`assets/` 等相对资源目录提供附属文件，官方 loader 会保留资源基路径。

Skill 文件使用 Markdown，可带 YAML frontmatter；官方文件系统 README 说明了 `name`、`description`、`disable-model-invocation`、`user-invocable`、`whenToUse` 等字段。官方 watcher 主要观察直接 Skill bundle 或直接入口文件；`references`、`scripts`、`assets` 下的深层资源变化不一定触发目录 catalog 失效。

对 Comet 的直接含义：若未来选择 dsh 原生 Skill 安装，项目级首选目标是 `.dsh/skills/<skill-name>/`，全局首选目标是 `$DSH_HOME/skills/<skill-name>/`。`.agents/skills` 是 dsh 支持的共享兼容入口，不应在没有明确兼容策略时与 `.dsh/skills` 同时写入同一份内容，否则会造成重复发现和优先级歧义。

### 3.3 Agent instruction 文件

官方配置默认值见 [`agent-instructions/src/config.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/src/config.ts)，查找逻辑见 [`agent-instructions/src/files.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/src/files.ts)。

| 层级           | 默认路径/候选                                       | 说明                                                 |
| -------------- | --------------------------------------------------- | ---------------------------------------------------- |
| 全局           | `$DSH_HOME/AGENTS.md`，默认 `~/.dsh/AGENTS.md`      | dsh 当前实现的固定全局 instruction 文件。            |
| 项目级         | 从项目根到当前目录逐层查找 `AGENTS.md`、`CLAUDE.md` | 默认候选文件名来自配置；根目录通过最近 `.git` 确定。 |
| 项目级 overlay | `AGENTS.local.md`、`CLAUDE.local.md`                | 与对应基础文件配套的本地覆盖文件。                   |

官方实现构造从项目根到当前工作目录的目录链，并收集链上存在的候选文件，因此子目录 instruction 可以叠加在项目根 instruction 之上。全局文件显示为 `$DSH_HOME/AGENTS.md`；当前源码没有把 `$DSH_HOME/CLAUDE.md` 定义为等价的全局入口。

这里的 instruction 是注入 agent 上下文的约束文本，不等同于具有阻断能力的 Hook 或 Rule engine。Comet 已有的 `AGENTS.md`/`CLAUDE.md` 项目说明在 dsh 中具备天然兼容性；但把全局 Comet 内容安装到 dsh 时，应优先使用 `$DSH_HOME/AGENTS.md`，并避免覆盖用户已有内容。

### 3.4 Agent preset：dsh 的“Agent 组成”目录

官方 preset 文档见 [packages/preset README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/README.md)，发现逻辑见 [`agent-presets/src/discovery.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/preset/agent-presets/src/discovery.ts)。

一个 dsh Agent preset 是一个目录，其中包含 `agent.cordis.yml`。用户 preset 的官方默认目录是：

```text
$DSH_HOME/.agent-presets/<preset-id>/agent.cordis.yml
```

当前 CLI 自带的 preset 位于仓库内 `apps/cli/config/agent-presets/`，不是用户项目的普通 Rule 目录。该机制用于定义 Agent 的 Cordis composition，不能把普通 Markdown Rule 文件直接放进去后期待 dsh 自动加载。

## 4. Hook 生命周期、配置路径与格式

### 4.1 dsh 原生扩展点

dsh 基于 Cordis。官方架构文档：[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)；Hook bridge 设计记录：[hook-bridges.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-06-30-hook-bridges.md)。官方列出的重要扩展点包括：

- `agent/session-start`
- `agent/pre-step`
- `agent/request`
- `llm/stream`
- `tools/pre-execute`
- `tools/execute`
- `tools/post-execute`
- `agent/turn-stopping`
- `subagent/start`、`subagent/end`

原生 Cordis Hook 是插件订阅这些事件的运行时代码，不是一个放入固定目录即可自动执行的脚本文件。

### 4.2 Claude Code Hook bridge

官方包文档：[`packages/hooks/hooks-claude-code/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hooks-claude-code/README.md)，官方包源码入口：[hooks-claude-code README raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/hooks-claude-code/README.md)。

该 bridge 兼容 Claude Code `hooks.json` 或 settings 文件中的 `hooks` 配置，但需要通过 dsh 的 Cordis plugin 显式传入 `configPath`。官方示例语义是：

```yaml
- dsh-hooks-claude-code:
    configPath: ./.claude/hooks.json
    pluginRoot: ./.claude/plugins/example
    projectDir: .
```

关键行为：

- `configPath` 必填；相对路径按进程启动工作目录解析。
- 配置在 plugin load 时读取一次；当前没有按 session 自动发现项目 Hook 配置的行为。
- 当前只支持 `type: command`；HTTP、MCP tool、prompt、agent 等类型会被跳过。
- command 在 session cwd 中运行；超时、stderr 摘要长度等可以配置，默认超时为 10 分钟。
- 生命周期映射大致为：`SessionStart` → `agent/session-start`，`UserPromptSubmit` → `agent/pre-step`，`PreToolUse` → `tools/pre-execute`，`PostToolUse` → `tools/post-execute`，`Stop` → `agent/turn-stopping`。
- bridge 是兼容层；官方文档明确把直接使用 dsh 原生 Cordis plugin 视为更强的扩展方式。

### 4.3 Codex Hook bridge

官方包文档：[`packages/hooks/hooks-codex/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hooks-codex/README.md)，官方包源码入口：[hooks-codex README raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/hooks-codex/README.md)。

Codex bridge 当前兼容五个 Hook 点：`PreToolUse`、`PostToolUse`、`SessionStart`、`UserPromptSubmit`、`Stop`。配置同样要求显式 `configPath`，官方示例使用 `./.codex/hooks.json`。

它的限制包括：只接受 regex matcher；payload 使用 snake_case；不提供插件环境变量注入或占位符替换；`PreToolUse` 不支持 allow/ask/rewrite，只能阻断；只同步执行 `type: command`；未支持的事件会被丢弃；配置按进程读取一次。

### 4.4 Hook command 协议

官方共享协议：[hook-protocol README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hook-protocol/README.md) 和 [protocol types](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/hook-protocol/src/types.ts)。

通用配置以 command 为核心，并可以包含 matcher、timeout 等字段。Hook command 通过 stdin 接收事件 payload；退出码和 stdout 共同决定结果。官方协议定义了 `exit 2` 作为阻断语义，并支持通过输出 additional context 反馈上下文。Hook invocation/result 还会形成可持久化的 session event；这与原生 Cordis plugin 直接订阅事件并不完全相同。

### 4.5 当前没有确认的自动发现路径

在当前官方源码和文档中，没有找到“把文件复制到 `$DSH_HOME/hooks.json` 或 `<project>/.dsh/hooks.json` 就会被 dsh 自动安装/加载”的正式契约。bridge 的 `configPath` 是显式配置项，而且官方实现记录仍提到按 session 发现 Hook 配置是后续工作。

因此，不能把 `.dsh/hooks.json` 当作已确认的平台原生目录。未来 Comet 若要兼容 Hook，需要采用以下两种明确路径之一：

1. 以 dsh profile/bundle 方式安装官方 bridge 或原生 Cordis plugin，并在 composition/patch 中显式声明。
2. 仅在用户已有 profile/plugin 能加载 bridge 的前提下，生成或维护项目 Hook 配置，并传入明确的 `configPath`。

## 5. dsh 的原生安装目录/API

### 5.1 文件型资源的原生目录

已确认可用于文件分发的官方目录：

| Comet 资源                      | 项目级 dsh 原生目标                                                | 全局 dsh 原生目标                | 可信度                                                                        |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| Skill、Script、Reference、Asset | `<project>/.dsh/skills/<skill-name>/`                              | `$DSH_HOME/skills/<skill-name>/` | 高：官方 Skill loader 和路径实现明确支持。                                    |
| Agent instruction               | 项目目录链上的 `AGENTS.md`/`CLAUDE.md` 及 `.local.md`              | `$DSH_HOME/AGENTS.md`            | 高：官方 instruction loader 明确定义。                                        |
| Agent preset                    | 项目/自定义 preset root；用户默认 `$DSH_HOME/.agent-presets/<id>/` | `$DSH_HOME/.agent-presets/<id>/` | 中高：用户 root 明确；项目 root 可通过配置参与，不应假定所有 profile 都启用。 |
| 通用 Rule Markdown              | 未发现官方目录                                                     | 未发现官方目录                   | 高：当前官方 Skill/instruction/preset 契约均未提供通用 Rule loader。          |
| Hook 配置文件                   | 无已确认的自动发现目标；bridge 要求显式 `configPath`               | 无已确认的自动发现目标           | 高：官方 bridge 文档明确要求 `configPath`，但未来版本可能变化。               |

### 5.2 Profile、Bundle 与 Plugin API

官方 CLI 参考：[apps/cli/reference/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)；启动实现说明：[packages/boot/app-boot/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md)。

dsh Profile 的用户级目录为：

```text
$DSH_HOME/profiles/<profile-name>/
├── package.json
├── dsh.profile
└── cordis.patch.yml
```

`dsh --profile <name>` 会从该 profile 启动。profile 可以声明 bundle；bundle npm 包可以在自身 `package.json` 的 `dsh.bundle.patch` 中声明 Cordis patch。dsh 还支持 `$DSH_HOME/cordis.patch.yml` 和命令行 `--patch` 层叠，profile patch 可以热加载，而 bundle 成员变化通常需要重启 profile。

官方 `dsh plugin --profile <name> add/remove/update ...` 会把包管理操作转发给 pnpm，并在成功后根据包 manifest 的 dsh bundle 声明维护 profile 的 bundle 列表。这是 dsh 当前最接近“平台原生插件安装 API”的入口；它面向 npm/Cordis bundle，不是面向普通 Skill、Rule 或 Hook Markdown 文件的统一安装 API。

### 5.3 官方 Hook 包的安装不确定性

官方仓库存在 [`@deepseek-ai/dsh-hooks-claude-code`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/hooks-claude-code/package.json) 和 [`@deepseek-ai/dsh-hooks-codex`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/hooks/hooks-codex/package.json) 包源码/manifest；但当前 `@deepseek-ai/dsh` CLI manifest 并没有把这些 bridge 列为 CLI 的直接依赖，且官方 bridge 包版本与 CLI `master` 版本存在 rc 版本差异。

这说明“官方提供 bridge”已经确认，但“任意 dsh 安装都已内置 bridge、Comet 只需复制配置即可使用”尚未确认。beta20 实现前必须针对实际发布包验证：包是否已发布、profile 是否能解析该 bundle、patch schema 是否匹配、启动后事件是否真正触发。

## 6. 对 Comet 后续 beta20 worktree 的研究建议

以下是基于官方契约的实现边界，不代表本次已实现：

1. **Skill 主路径**：项目安装写入 `<project>/.dsh/skills/<skill-name>/`，全局安装写入 `$DSH_HOME/skills/<skill-name>/`；完整保留 `SKILL.md`、`scripts`、`references`、`assets` 的 bundle 结构。
2. **Instruction**：项目级复用现有 `AGENTS.md`/`CLAUDE.md` 发现机制；全局 dsh 目标只能默认认定为 `$DSH_HOME/AGENTS.md`。已有用户文件应采用 Comet 管理块或安全合并策略，不能无条件覆盖。
3. **Rule**：不要把 Comet Rule 直接写到假定的 `.dsh/rules` 或 `$DSH_HOME/rules`；dsh 当前没有确认的通用 Rule loader。若 Rule 是用户可读指导，可经过明确的 instruction 集成策略进入 `AGENTS.md`；若需要确定性阻断，应转成 Cordis plugin/Hook，而不是 Markdown 文件。
4. **Hook**：不要只复制 `.dsh/hooks.json` 并宣称已安装。应把 Hook 分成“配置文件分发”和“bridge/plugin 可执行性”两个条件：只有 profile 中存在可加载的官方 bridge 或自有 Cordis plugin，并且 `configPath` 被显式接入，Hook 才算安装成功。
5. **Profile/plugin**：若 Comet 需要分发 dsh 原生 Hook、Script 或 enforcement 逻辑，应优先评估通过 `$DSH_HOME/profiles/<name>`、`dsh.profile`、`cordis.patch.yml` 和 `dsh plugin` 接口接入，而不是把运行时代码散落到 Skill 目录。
6. **init/update/uninstall 生命周期**：未来实现应为每个 dsh 目标记录 Comet ownership、来源和版本；`update` 只更新 Comet 自己管理的资源；`uninstall` 只移除 Comet 管理的文件/块/patch，不删除用户已有的 dsh Skill、instruction、profile 或 Hook。
7. **兼容性验证**：beta20 worktree 中至少需要用真实 dsh 版本验证项目/全局 Skill 加载、instruction 叠加、Hook bridge 触发与阻断、profile 重启/热加载、重复 init/update/uninstall 以及用户文件保护。

## 7. 不确定性清单

- **版本漂移**：官方仓库明确处于 developer preview；本记录引用的是当前 `master`，不是不可变的 beta20 版本。
- **项目根判定**：默认以最近 `.git` 为项目根；Comet 的 workspace、linked worktree、非 Git 目录行为应以实际 dsh 版本验证。
- **Rule 语义缺失**：未发现独立、通用、自动发现的 Rule 目录；“Rule”可能是 Issue 侧对 instruction 或 enforcement 的泛称，不能直接推导出目录名。
- **Hook 自动发现缺失**：官方 bridge 当前要求显式 `configPath`，没有确认 `.dsh/hooks.json` 或 `$DSH_HOME/hooks.json` 的自动发现契约。
- **Bridge 发布/依赖状态**：官方仓库有 bridge package，但当前 CLI manifest 未直接依赖它们，且 rc 版本可能不同；是否能被目标 dsh 版本直接安装需要 beta20 前实测。
- **Profile API 的用户可见稳定性**：`dsh plugin`、`dsh.profile`、`cordis.patch.yml` 是官方当前机制，但 profile 模板、patch 层级和 bundle 约束仍可能随 preview 版本改变。
- **Hook 语义差异**：Claude bridge 与 Codex bridge 支持的事件和阻断能力不同；不能把一个 bridge 的能力表复制给另一个平台。

## 8. 官方一手资料索引

- [Comet Issue #343](https://github.com/rpamis/comet/issues/343) — 原生支持 dsh 的需求来源。
- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness) — 产品身份、总体说明和开发预览状态。
- [`@deepseek-ai/dsh` CLI manifest](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/package.json) — npm 包名、bin、仓库元数据。
- [Home paths source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/util/home-paths/src/index.ts) — `$DSH_HOME` 和默认 `~/.dsh`。
- [Skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md) — Skill 优先级、目录和 registry。
- [Skill filesystem source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/skill/skill-filesystem/src/index.ts) — Skill 扫描、bundle 结构和配置项。
- [Agent instruction config](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/src/config.ts) — 默认 instruction 文件名和 home 配置。
- [Agent instruction loader](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/context/agent-instructions/src/files.ts) — 全局/项目 instruction 查找链。
- [Agent preset README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/README.md) — `agent.cordis.yml` preset 形态。
- [Agent preset discovery](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/preset/agent-presets/src/discovery.ts) — `$DSH_HOME/.agent-presets` 用户目录。
- [Claude Code Hook bridge](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hooks-claude-code/README.md) — `configPath`、支持事件和生命周期映射。
- [Codex Hook bridge](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hooks-codex/README.md) — Codex Hook 支持范围和限制。
- [Hook protocol](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/hook-protocol/README.md) — command stdin/stdout、退出码和结果协议。
- [dsh architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — Cordis 扩展点和 profile/bundle 架构。
- [CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md) — profile、`dsh plugin` 和命令行入口。
- [App boot README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.md) — profile 目录、patch 层级和加载方式。
