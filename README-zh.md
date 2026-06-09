<p align="center">
  <a href="https://github.com/rpamis/comet/blob/master/img/title-log.png">
    <picture>
      <source srcset="https://github.com/rpamis/comet/blob/master/img/title-log.png">
      <img src="https://github.com/rpamis/comet/blob/master/img/title-log.png" alt="Comet logo">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/rpamis/comet/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/rpamis/comet/ci.yml?branch=master&style=flat-square&label=CI" /></a>
  <a href="https://deepwiki.com/rpamis/comet"><img alt="DeepWiki" src="https://img.shields.io/badge/DeepWiki-rpamis%2Fcomet-blue?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm version" src="https://img.shields.io/npm/v/@rpamis/comet?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm download count" src="https://img.shields.io/npm/dm/@rpamis/comet?style=flat-square&label=Downloads/mo" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm weekly download count" src="https://img.shields.io/npm/dw/@rpamis/comet?style=flat-square&label=Downloads/wk" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
</p>

# @rpamis/comet

```
 ██████╗ ██████╗ ███╗   ███╗███████╗████████╗
██╔════╝██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝
██║     ██║   ██║██╔████╔██║█████╗     ██║
██║     ██║   ██║██║╚██╔╝██║██╔══╝     ██║
╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗   ██║
 ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝
```

> English version: [README.md](README.md)
> [Bilibili video](https://www.bilibili.com/video/BV1y4Gi6CEo1/?spm_id_from=333.1387.homepage.video_card.click&vd_source=d22726fe6b108647dbebf1c5d8817377)
> [抖音](https://www.douyin.com/search/comet?aid=cd8fcc82-498b-4d59-8860-617deb719412&modal_id=7646429015808936293&type=general)

**OpenSpec + Superpowers 双星开发工作流** — 从创意到归档，一条命令。

OpenSpec 处理 **WHAT**（大纲、提案、spec 生命周期、归档）。

Superpowers 处理 **HOW**（技术设计、规划、执行、收尾）。

Comet 将二者串联为五阶段自动化流水线。

> [!IMPORTANT]
> **0.3.7 亮点** — 一键接入 [CodeGraph](https://github.com/colbymchenry/codegraph) 语义代码索引（官方：成本 **↓16%**、工具调用 **↓58%**）；
>
> 新增 Beta 上下文压缩，Build 阶段输入 token 降低 **25–30%**； 新增主动上下文压缩机制，释放读取 Spec 和 brainstorming 消耗的上下文，为后续 Build 阶段保留窗口
> 新增 6 项 Token 工作流优化默认开启； 新增 `auto_transition` 配置，支持自动流转或手动推进阶段切换；
> 基于 Hook 和 Rule 的防漂移阶段守护； 可选 TDD 模式与子代理调度确认；
> 支持大型 PRD 拆分为多个 change； 归档前确认与回退、验证重试限制、系统化调试拦截和验证完成检查等流程加固。
>
> 详见 [NEWS.md](NEWS.md)。

## 为什么需要 Comet

OpenSpec 擅长管理需求、做提案、管理 Spec 生命周期和归档，但使用过程中 OpenSpec 的提案和 Task 没有像 Superpowers 头脑风暴那样细致。

Superpowers 在头脑风暴后会产出 Spec 文档，但这个文档通常没有进行状态化设计——做完需求之后 Spec 仅在文档上对 Task 打勾，甚至
Agent 还会忘记打勾，造成下一次断点开始时，Agent 需要重新查看文档和项目代码来核验，产生较多 Token 浪费。

**Comet 合并了两者的强项**，将核心流程整合为 5 个阶段

主入口 `/comet` 支持当前 Spec 状态检测，适用于长任务——中途关闭当前 AI 编码会话后，回来只需 `/comet`，Comet 会自动读取活跃的
Spec（多个则列出选择），动态识别当前执行到哪个阶段，继续往下执行。

同时，Comet具备Spec全生命周期管理能力，运行过程中能够将 OpenSpec 的 change/spec 制品与 Superpowers
的设计、计划文档进行关联，并自动完成交接、状态更新、校验和归档同步，把原本需要用户频繁提醒 Agent 维护文档同步和关联关系的操作自动化。

## 你能学到什么

现有的 Skill 市场中有很多优秀的 Skill 项目，但普遍存在偏好性问题——用户可能只喜欢部分功能。比如同时使用 OpenSpec 和
Superpowers 时，可能只用 OpenSpec 的 Spec 管理能力，而编码上更喜欢 Superpowers 的 TDD 驱动。

长期使用 Skill 的人都知道，这些能力是可以自由组合的，但具体怎么做依然需要真正的实践。Comet 项目可以作为参考：

- **如何稳定触发嵌套 Skill** — 不是让 Agent 依靠文档描述做了“看起来像触发了 Skill”的操作（比如根据 Skill 描述写了文件），而是真正触发
  Skill（核心特征：CC 上有 Skill 触发的打印）。Comet 中会触发大量来自 OpenSpec 和 Superpowers 的能力，这段 Prompt 是怎么写的？

- **如何让组合 Skill 多阶段自动流转** — 不是靠人工介入。Comet 的 5 阶段流程，除必要的用户选择项外，核心流程能够自动进行
  Skill 触发，同时状态机机制也能保障状态扭转的可靠性。

- **如何把 Spec 生命周期做成可恢复流程** — Comet 会把 OpenSpec 的 change/spec 制品与 Superpowers 的设计、计划文档关联起来，并通过
  `.comet.yaml` 记录阶段、执行模式、验证结果和归档状态，让 Agent 中断后能够继续，而不是重新翻文档猜进度。

- **如何把文档同步从“用户提醒”变成自动化** — Comet 将 handoff、状态更新、校验和归档同步放进脚本化流程，减少“记得更新 design
  doc”“记得同步 spec”“记得归档 change”这类反复提示。

- **如何设计 Agent 可执行的守护条件** — Comet 的阶段退出不是简单相信 Agent 说“完成了”，而是通过 `comet-guard.sh`、
  `comet-yaml-validate.sh`、`comet-state.sh` 等脚本检查任务、状态字段、验证证据和归档条件，满足条件后才允许推进。

- **如何做跨平台 Skill 分发和安装** — Comet 支持多种 AI 编码平台、项目级/全局安装、中文/英文 Skill 选择，以及平台差异化目录（例如
  Antigravity 的项目级和全局路径不同），可以作为 CLI 安装器和 Skill 打包结构的参考。

- **如何把 shell 脚本写成 Agent 工作流基础设施** — Comet 的脚本需要兼容 macOS、Linux、Windows Git Bash，处理 hash、YAML
  字段、状态机和归档流程。它展示了如何把原本容易写散在 Prompt 里的流程控制，沉淀成可测试、可复用的工具。

## 安装

前置要求：

- Node.js 20+
- npm/npx
- Git
- 可运行 bash 的 shell 环境（Windows 用户建议使用 Git Bash 或等价环境）

```bash
npm install -g @rpamis/comet
```

## 快速开始

```bash
cd your-project
comet init
```

`comet init` 会：

1. 提示你选择 AI 平台（自动检测已有配置）
2. 选择安装范围：项目级（当前目录）或全局（用户主目录）
3. 选择 Comet 技能语言：English 或 中文
4. 安装 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 技能
5. 安装 [Superpowers](https://github.com/obra/superpowers) 技能
6. 将 Comet 技能（你选择的语言）部署到所选平台
7. 在项目级安装时创建 `docs/superpowers/specs/` 和 `docs/superpowers/plans/` 工作目录

> [!TIP]
> 更新版本号
>
> 执行 `comet update` 或者 `npm install -g @rpamis/comet@latest` 即可更新到最新版本。

## 对OpenClaw和Hermes、或其他AI平台的支持

对于直接使用通用 `skills` CLI 的平台，可以用下面的方式安装 Comet skill 包：

```bash
npx skills add rpamis/comet
```

## 运行截图

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/runner.png" alt="runner">
</p>
<p align="center">自动安装 OpenSpec、Superpowers，一键配置开发环境</p>
<p align="center">多阶段 Skill 入口，自动识别当前 Spec 阶段，核心流程自动触发，关键节点人工审核</p>

## CLI命令

<details>
<summary><code>comet init [path]</code> — 初始化 Comet 工作流</summary>

为选定的 AI 编码平台初始化 OpenSpec、Superpowers 和 Comet 技能。

| 选项                | 描述                         |
|-------------------|----------------------------|
| `--yes`           | 非交互模式，自动选择已检测平台（未检测到则选择全部） |
| `--scope <scope>` | 安装范围：`project` 或 `global`  |
| `--skip-existing` | 跳过已安装的组件                   |
| `--overwrite`     | 覆盖已安装的组件                   |
| `--json`          | 输出结构化 JSON                 |

当同一平台检测到多个已安装组件时，交互式 init 会先提供一次批量选择：全部覆盖、全部跳过，或逐项选择。

</details>

<details>
<summary><code>comet status [path]</code> — 显示活跃更改和下一步命令</summary>

显示活跃更改、任务进度，以及推荐的下一步 Comet 工作流命令。

| 选项       | 描述                       |
|----------|--------------------------|
| `--json` | 输出活跃更改，并包含 `nextCommand` |

</details>

<details>
<summary><code>comet doctor [path]</code> — 诊断 Comet 安装健康状态</summary>

检查项目级/全局安装、工作目录、已安装技能、脚本和 Comet 状态文件。

| 选项                | 描述                                           |
|-------------------|----------------------------------------------|
| `--json`          | 输出结构化诊断结果                                    |
| `--scope <scope>` | 诊断 `auto`、`project` 或 `global` 范围（默认：`auto`） |

</details>

<details>
<summary><code>comet update [path]</code> — 更新 Comet 包和技能</summary>

更新 npm 包，并刷新已检测到的项目级/全局 Comet 技能。

| 选项                  | 描述                             |
|---------------------|--------------------------------|
| `--json`            | 以 JSON 输出 npm 和 skill 更新结果     |
| `--language <lang>` | 覆盖自动检测到的 skill 语言 (`en`, `zh`) |
| `--scope <scope>`   | 仅更新 `global` 或 `project` 范围    |

</details>

| 命令                | 描述   |
|-------------------|------|
| `comet --help`    | 显示帮助 |
| `comet --version` | 显示版本 |

## 支持平台

`comet init` 支持 28 个 AI 编码平台：

<details>
<summary>查看完整平台列表</summary>

| 平台                 | 技能目录         | 平台         | 技能目录          |
|--------------------|--------------|------------|---------------|
| Claude Code        | `.claude/`   | Cursor     | `.cursor/`    |
| Codex              | `.codex/`    | OpenCode   | `.opencode/`  |
| Windsurf           | `.windsurf/` | Cline      | `.cline/`     |
| RooCode            | `.roo/`      | Continue   | `.continue/`  |
| GitHub Copilot     | `.github/`   | Gemini CLI | `.gemini/`    |
| Amazon Q Developer | `.amazonq/`  | Qwen Code  | `.qwen/`      |
| Kilo Code          | `.kilocode/` | Auggie     | `.augment/`   |
| Kiro               | `.kiro/`     | Lingma     | `.lingma/`    |
| Junie              | `.junie/`    | CodeBuddy  | `.codebuddy/` |
| CoStrict           | `.cospec/`   | Crush      | `.crush/`     |
| Factory Droid      | `.factory/`  | iFlow      | `.iflow/`     |
| Pi                 | `.pi/`       | Qoder      | `.qoder/`     |
| Antigravity        | `.agents/`   | Bob Shell  | `.bob/`       |
| ForgeCode          | `.forge/`    | Trae       | `.trae/`      |

</details>

部分平台的项目级目录和全局目录不同。例如 OpenCode 全局安装使用 `.config/opencode`，Lingma 全局安装使用 `.lingma`
，Antigravity 全局安装使用 `.gemini/antigravity`。

## 技能

`comet init` 完成后，三组技能将被安装到所选平台的 `skills/` 目录：

### Comet 技能

<details>
<summary>查看 Comet 技能列表</summary>

| 技能               | 描述                                |
|------------------|-----------------------------------|
| `/comet`         | 主入口 — 自动检测阶段并分派到子命令               |
| `/comet-open`    | 阶段 1：打开变更（提案、设计、任务分解）             |
| `/comet-design`  | 阶段 2：深度设计（头脑风暴、设计文档）              |
| `/comet-build`   | 阶段 3：规划与构建（实现计划、代码提交）             |
| `/comet-verify`  | 阶段 4：验证与完成（测试、验证报告）               |
| `/comet-archive` | 阶段 5：归档（delta spec 同步、状态标注）       |
| `/comet-hotfix`  | 快捷路径：快速 bug 修复（跳过头脑风暴，不需要能力设计）    |
| `/comet-tweak`   | 快捷路径：小改动（文案调整、配置调整、文档或 Prompt 优化） |

</details>

### 守护与自动化脚本

<details>
<summary>查看脚本列表</summary>

| 脚本                       | 用途                                                                              |
|--------------------------|---------------------------------------------------------------------------------|
| `comet-env.sh`           | 脚本发现助手 — 导出 `COMET_GUARD`、`COMET_STATE`、`COMET_HANDOFF`、`COMET_ARCHIVE` 等内置脚本路径 |
| `comet-guard.sh`         | 阶段转换守护 — 验证退出条件，`--apply` 自动更新 `.comet.yaml`                                    |
| `comet-handoff.sh`       | 设计交接 — 从 OpenSpec 制品生成带 SHA256 追踪的确定性上下文包                                       |
| `comet-archive.sh`       | 一键归档 — 验证状态、同步 specs、移至归档、更新状态                                                  |
| `comet-yaml-validate.sh` | 模式校验器 — 校验 `.comet.yaml` 结构和字段值                                                 |
| `comet-state.sh`         | 统一状态管理 — init/set/get/check/scale，agent 的专属 YAML 接口                             |
| `comet-hook-guard.sh`    | 阶段写入守护 — PreToolUse hook，在 open/design/archive 阶段拦截文件写入                         |

</details>

### OpenSpec 技能

Spec 生命周期管理：propose、explore、sync、verify、archive 等。

### Superpowers 技能

开发方法论：brainstorming、TDD、subagent-driven development、code review、plan writing 等。

## 工作流

```
/comet
  ↓ auto-detect
/comet-open  -->  /comet-design  -->  /comet-build  -->  /comet-verify  -->  /comet-archive
(OpenSpec)         (Superpowers)       (Superpowers)       (Both)           (OpenSpec)

/comet-hotfix（快捷路径，跳过头脑风暴）
  open  -->  build  -->  verify  -->  archive

/comet-tweak（快捷路径，跳过头脑风暴和完整计划）
  open  -->  轻量构建  -->  轻量验证  -->  archive
```

### 五个阶段

| 阶段                 | 命令               | 归属          | 产出物                            |
|--------------------|------------------|-------------|--------------------------------|
| 1. Open            | `/comet-open`    | OpenSpec    | proposal.md、design.md、tasks.md |
| 2. Deep Design     | `/comet-design`  | Superpowers | Design Doc、delta spec          |
| 3. Plan & Build    | `/comet-build`   | Superpowers | 实现计划、代码提交                      |
| 4. Verify & Finish | `/comet-verify`  | Both        | 验证报告、分支处理                      |
| 5. Archive         | `/comet-archive` | OpenSpec    | delta→main spec 同步、归档          |

### 核心原则

- **头脑风暴不可跳过** — 每个变更必须经过深度设计（hotfix/tweak 除外）
- **Delta spec 是活文档** — 在阶段 3 中可自由编辑，归档时同步
- **保持 tasks.md 同步** — 每完成一个任务就勾选
- **频繁提交** — 每个任务一个 commit，message 体现设计意图
- **先验证再归档** — `/comet-verify` 必须通过才能执行 `/comet-archive`

### 状态管理

Comet 使用解耦状态架构，YAML 文件独立管理：

| 文件               | 归属       | 用途              |
|------------------|----------|-----------------|
| `.openspec.yaml` | OpenSpec | Spec 生命周期、变更元数据 |
| `.comet.yaml`    | Comet    | 工作流阶段、执行模式、验证状态 |

所有状态和运行阶段都通过脚本更新，并且会在每个阶段退出前校验任务是否真实完成。相比于将复杂状态管理写在 Skill
文本中，脚本化状态机能更稳定地保障阶段流转、YAML 正确性和断点恢复；Agent 只需要通过 Comet 内置命令读取状态，就能知道当前
Spec 处于哪个阶段。

<details>
<summary>查看 .comet.yaml 关键字段</summary>

**`.comet.yaml` 关键字段：**

```yaml
workflow: full
auto_transition: true
phase: build
build_mode: subagent-driven-development
build_pause: null
isolation: branch
verify_mode: null
design_doc: docs/superpowers/specs/YYYY-MM-DD-topic-design.md
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md
verify_result: pending
verification_report: null
branch_status: pending
verified_at: null
archived: false
direct_override: false
build_command: null
verify_command: null
handoff_context: openspec/changes/<name>/.comet/handoff/design-context.json
handoff_hash: <sha256>
tdd_mode: null
subagent_dispatch: null
```

full workflow 初始化时 `build_mode`、`build_pause`、`isolation`、`verify_mode`、`tdd_mode` 和 `subagent_dispatch` 可以暂时为
`null`；进入 `build → verify` 前必须完成 `build_mode` 与 `isolation` 决策并写入合法值。`auto_transition` 控制阶段完成后是否自动触发下一个 Skill — 详见 [AUTO-TRANSITION.md](docs/AUTO-TRANSITION.md)。`build_pause` 记录 build 阶段内部暂停点：
`null` 表示无暂停，`plan-ready` 表示 plan 已生成，用户在选择隔离方式和执行方式前暂停。它不是执行方式，不得写入 `build_mode`。
`verification_report` 在验证报告生成前保持 `null`，`verify-pass` 要求该报告文件存在且 `branch_status: handled`。示例中
`archived` 之后的字段是可选字段或脚本派生字段：`direct_override` 只在 full workflow 直接构建时需要，项目命令未配置时可以不存在，
`handoff_context` 和 `handoff_hash` 由 `comet-handoff.sh` 在离开 design 阶段前写入。项目可在 change 或仓库根配置中设置
`build_command` / `verify_command`，guard 会优先运行并打印失败输出。

</details>

### 可靠性特性

Comet 通过自动化状态转换确保 agent 执行可靠性：

<details>
<summary>查看可靠性特性</summary>

1. **入口验证** — 每个阶段在执行前验证前置条件
    - 检查文件存在、状态一致性、阶段转换
    - 验证失败时输出 `[HARD STOP]` 及可操作建议

2. **自动化状态转换** — `comet-guard.sh --apply` 自动更新 `.comet.yaml`
    - 所有阶段转换（open → design/build → verify → archive）使用 `guard --apply`
    - 无需手动状态编辑 — 消除写入验证错误
    - `comet-state.sh` 是 agent 对状态操作的专属接口
    - Guard 和 archive 脚本内部使用 `comet-state.sh` 进行状态管理

3. **模式校验** — `comet-yaml-validate.sh` 确保数据完整性
    - 校验必填字段和可选字段
    - 校验枚举值（包括 `direct_override`）
    - 校验 `design_doc`、`plan`、`handoff_context` 路径存在，并校验 `handoff_hash` 格式
    - 检测未知/拼写错误字段

4. **Build 决策强制** — Guard 和状态转换同时拦截跳过关键选择
    - `isolation` 必须是 `branch` 或 `worktree`
    - `build_mode` 必须已选择
    - `build_pause: plan-ready` 是 plan 生成后的可恢复暂停点，不是 `build_mode`
    - full workflow 的 `build_mode: direct` 必须有 `direct_override: true`

5. **验证证据强制** — Guard 在阶段流转前强制要求验证凭证
    - `verify-pass` 转换要求 `verification_report` 指向已存在的验证报告文件
    - `branch_status` 必须为 `handled` 才能通过验证
    - Guard 检查 `verification_report exists` 和 `branch_status=handled` 作为硬性前提
    - 防止验证或分支处理被跳过时产生虚假的阶段推进

6. **归档自动化** — `comet-archive.sh` 一键处理完整归档流程
    - 验证入口状态、通过 OpenSpec 将 delta specs 合并到 main specs
    - 标注设计文档和计划文档的 frontmatter
    - 将变更移至归档目录并更新 `archived: true`
    - 支持 `--dry-run` 预览

7. **防漂移阶段守护** — 长上下文会话中的阶段意识保障
    - Rule 层：`comet-phase-guard.md` 每轮注入阶段感知、Skill 调用规范和上下文恢复指令（所有平台通用）
    - Hook 层：`comet-hook-guard.sh` 在 open/design/archive 阶段硬拦截文件写入（Claude Code 等支持 hook 的平台）
    - 白名单路径：`openspec/*`、`docs/superpowers/*`、`.claude/*`、`.comet/*`

</details>

## 项目结构

```
your-project/
├── .comet/
│   └── config.yaml              # 项目级全局配置（context_compression、auto_transition 等）
├── .claude/skills/              # 平台技能目录（Comet + OpenSpec + Superpowers）
│   ├── comet/SKILL.md
│   │   └── scripts/
│   │       ├── comet-guard.sh       # 阶段转换守护（--apply 自动更新状态）
│   │       ├── comet-env.sh         # 脚本发现助手
│   │       ├── comet-handoff.sh     # 设计交接（OpenSpec → Superpowers 上下文追踪）
│   │       ├── comet-archive.sh     # 一键归档自动化
│   │       ├── comet-yaml-validate.sh # 模式校验器
│   │       ├── comet-hook-guard.sh    # 阶段写入守护（PreToolUse hook）
│   │       └── comet-state.sh       # 统一状态管理（init/set/get/check/scale）
│   ├── comet-*/SKILL.md
│   ├── openspec-*/SKILL.md
│   └── brainstorming/SKILL.md
├── openspec/                    # OpenSpec — WHAT
│   ├── config.yaml
│   └── changes/
│       └── <name>/
│           ├── .openspec.yaml       # OpenSpec 状态
│           ├── .comet.yaml          # Comet 工作流状态（解耦）
│           ├── proposal.md
│           ├── design.md
│           ├── specs/<capability>/spec.md
│           └── tasks.md
└── docs/superpowers/            # Superpowers — HOW
    ├── specs/                   # 设计文档
    └── plans/                   # 实现计划
```

<details>
<summary>上下文压缩（Beta）</summary>

Comet 支持在 Design → Build 阶段交接时进行上下文压缩。启用后，`comet-handoff.sh` 会生成精简的上下文包，在不影响实现正确性的前提下，将
Build 阶段的输入 token 降低 **25–30%**。

| 模式     | 行为                              | Token 节省 |
|--------|---------------------------------|----------|
| `off`  | handoff context 包含完整 Spec 摘录    | 基线       |
| `beta` | 仅保留 Design Doc + SHA256 hash 引用 | ~25–30%  |

Benchmark 核心结论：

- **测试通过率**：所有档位均为 100%（压缩不影响实现正确性）
- **Spec 覆盖率**：off 100% vs beta 95%（压缩可能丢失少量边缘需求细节）
- **规模效应**：任务越大，绝对节省量越高（large 档位节省可达 15,000 tokens）

启用方式：在 `.comet/config.yaml` 中设置 `context_compression: beta`

详见 [CONTEXT-COMPRESSION.md](docs/CONTEXT-COMPRESSION.md) 获取完整 Benchmark 报告、压缩原理和复现步骤。

</details>

<details>
<summary>自动流转（Auto Transition）</summary>

`auto_transition` 控制阶段完成后是否自动调用下一个 Skill，还是暂停等待用户手动触发。阶段推进本身始终执行，该配置仅影响 Skill 调用。

| 值 | 行为 |
|------|------|
| `true` | 阶段完成后自动调用下一个 Skill（默认） |
| `false` | 阶段完成后暂停，用户手动触发下一个 Skill |

三层配置与优先级：`COMET_AUTO_TRANSITION` 环境变量 > `.comet/config.yaml`（项目级）> `.comet.yaml`（change 级）。

详见 [AUTO-TRANSITION.md](docs/AUTO-TRANSITION.md) 获取配置详情、工作流映射和常见问题。

</details>

## 开发

贡献流程、提交规范、PR 流程、分支工作流，以及新增平台、Skill、脚本或 changelog
的说明见 [CONTRIBUTING-zh.md](CONTRIBUTING-zh.md) | [English](CONTRIBUTING.md)。

详见 [CHANGELOG.md](CHANGELOG.md) 了解版本历史与更新。

## 路线图

在 [Comet Roadmap](https://github.com/orgs/rpamis/projects/1) 查看开发进展与即将推出的功能。

## Star历史

[![Star History Chart](https://api.star-history.com/svg?repos=rpamis/comet&type=Date)](https://star-history.com/#rpamis/comet&Date)

## Contributors

<a href="https://github.com/rpamis/comet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rpamis/comet&max=999&columns=12&anon=1" />
</a>

## License

[MIT](LICENSE)

## 社区交流

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/douyin.png" width="120" height="120">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://github.com/rpamis/comet/blob/master/img/wechat.jpg" width="120" height="120">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://github.com/rpamis/comet/blob/master/img/qq.jpg" width="120" height="120">
</p>
<p align="center">
  <b>抖音群（推荐）</b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <b>微信群</b>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <b>QQ群</b>
</p>

## 友情链接

[LINUX DO - 新的理想型社区](https://linux.do/)
