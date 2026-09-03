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
  <a href="https://app.codecov.io/gh/rpamis/comet/tree/master"><img alt="codecov" src="https://img.shields.io/codecov/c/github/rpamis/comet/master?style=flat-square&label=coverage&color=%23E61A7A" /></a>
  <a href="https://deepwiki.com/rpamis/comet"><img alt="DeepWiki" src="https://img.shields.io/badge/DeepWiki-rpamis%2Fcomet-blue?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm version" src="https://img.shields.io/npm/v/@rpamis/comet?style=flat-square" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm total download count" src="https://img.shields.io/npm/dt/@rpamis/comet?style=flat-square&label=Downloads" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm monthly download count" src="https://img.shields.io/npm/dm/@rpamis/comet?style=flat-square&label=Downloads/mo" /></a>
  <a href="https://docs.comet.rpamis.com/"><img alt="Comet Docs" src="https://img.shields.io/badge/Docs-docs.comet.rpamis.com-FFD700?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://atomgit.com/rpamis/comet"><img alt="AtomGitStars" src="https://atomgit.com/rpamis/comet/star/badge.svg" /></a>
</p>

<p align="center">
<a href="https://trendshift.io/repositories/38989?utm_source=repository-badge&amp;utm_medium=badge&amp;utm_campaign=badge-repository-38989" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/repositories/38989" alt="rpamis%2Fcomet | Trendshift" width="250" height="55"/></a>
</p>

## 什么是Comet ?

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

**Comet 是一个面向Coding的可恢复长程任务工作流与 Skill 平台。**

它提供两套彼此独立的需求工作流：面向强模型、只依赖 Comet 原生 runtime 的 Native，以及保留 OpenSpec + Superpowers 完整阶段治理的 Classic；同时覆盖 Skill 创建、评估与发布。

让你可以用一个工具链处理需求到归档、中断后恢复，将任意Skill组合得像Comet一样，基于科学的**Rubric**、**Pass@k**、**Pass^k**评分演进你的Skill

> [!IMPORTANT]
> **0.4.0-rc.1** — Native Supervisor Change 可以把复杂需求拆成**带依赖的子 Change**，让 Codex 多会话或 Claude Code Agent Teams 在**独立 worktree** 中实现、验证并回传结果，再由 Runtime **按依赖顺序集成**并完成父 Change 的**最终验收**。
>
> RC.1 同时带来可管理的**个人记忆**、**项目知识**与**渐进式上下文**，以及覆盖工作流、Git worktree、记忆、知识和插件设置的**三栏 Dashboard**。Native **Portable State**、**恢复路径**和 **Windows Hook** 体验也得到系统加固。
>
> **0.4.0-beta.7** — 新增**面向强模型、原生且可恢复**的 Native 工作流，Native 与 Classic 通过统一配置、状态、Guard、Dashboard 及 Eval 入口实现独立协作。Eval 对齐实验（16 任务 × 48 次运行，取双方均通过的 41 组配对样本）显示，**总 Token 锐减 76.8%**、**Agent 轮次降 57.4%**、**耗时缩 47.4%**，**pass^3 达 87.5%（+12.5pp）且 pass@3 均为 100%**。
>
> **0.4.0-beta.1** — Comet 升级为纯 Node runtime（不再依赖 Bash/WSL），并带来三大核心能力：用 `/comet-any` 把**任意** Skill 组合成自定义工作流、用 `comet eval` 评估**任意** Skill 并接入 LangSmith、用 `comet dashboard` 在浏览器中查看每一个 change。
>
> **0.3.9** — `review_mode: off|standard|thorough` 控制 Build/Verify 自动代码审查并支持项目级默认；init/update 改为可选依赖安装，补齐 CLI 国际化、阶段守护加固和 macOS 可执行权限。
>
> 详见官网 [Changelog](https://docs.comet.rpamis.com/zh/changelog)；Native 与 0.4.0 Classic 的真实评估见 [基线对比](https://docs.comet.rpamis.com/zh/eval/comet-native-vs-040-experiment)。

> Native 与 Classic 不是轻重档位，也不会互相升级。Native 服务于能够自主规划和验证的强模型；Classic 服务于需要完整阶段方法与强约束的场景。

## 为什么需要 Comet

- **面向强模型的 Native 工作流** — `/comet-native` 用详细 brief、完整目标规格、状态检查和可恢复归档约束结果，同时把计划、实现、测试与审查方法交给模型自主判断；用户可读产物默认位于 `docs/comet/`，并与 Classic 完全分离。详见 [Native 工作流](https://docs.comet.rpamis.com/zh/native/quickstart)。
- **单向可恢复的 Native 归档** — Archive 会先给出唯一的 dry-run 续接命令，隔离工作区的完成选项和阻塞路径会明确展示；用户继续流程即可由 Runtime 接管归档提交，无需重复查询状态或手工提交运行时文件。
- **复杂需求的 Supervisor Change** — Native 可以按真实交付边界拆分子 Change，用 DAG 管理依赖与就绪顺序，让多个 Agent 在 Runtime 创建的独立 worktree 中实现和验证，再统一集成并对父 Change 做最终验收。
- **长程任务稳定的核心**— Comet 的 Classic Spec 模式结合 OpenSpec 和 Superpowers，用状态机、阶段检查与脚本串联五阶段流程，适合需要明确方法和强约束的任务；永久入口是 `/comet-classic`。
- **配置驱动的统一入口** — `/comet` 只读取项目的 `.comet/config.yaml`，确定性转发到 `/comet-native` 或 `/comet-classic`。它不按任务大小猜工作流，也不混用两边的 change、状态和目录。`comet resume-probe` 使用同一配置恢复正确的永久入口。
- **Skill 平台** — Comet能够编写可复用 Skill 包，并通过 `/comet-any` 把它们整理成可分发 Bundle，你制作的Skill可以像如comet init一样一键分发到所有Coding平台。
- **Eval 平台**— Comet基于科学的Rubric、Pass@k、Pass^k评分评估你的Skill，让Skill演进是基于科学依据，而不是依靠感觉，支持接入LangSmith评估，让评估真实走进企业级生产环境。基于双Agent架构自动化在你的生产环境完成评估工作

## Supervisor Change：让多个 Agent 协同交付复杂目标

当一个需求包含多个可以独立实现和验证的交付项时，Supervisor Change 会先确认子 Change 与依赖关系，再让 Codex 独立会话或 Claude Code Agent Teams 并行推进。Runtime 始终负责 worktree、任务身份、验证、有序集成和父 Change 的最终 Verify。

`复杂目标 → 子 Change DAG → 独立 worktree → 分别实现与验证 → 按依赖集成 → 父 Change 最终 Verify`

**Codex 多会话执行**

https://github.com/user-attachments/assets/96114cb0-f542-4f58-aa27-256f32adc46e

**Claude Code Agent Teams 执行**

https://github.com/user-attachments/assets/41428669-a49a-46e3-a0ae-0775e4f4bb6f

## 极低的记忆门槛

使用Comet你只需要记忆2个Skill和1条命令，用极低的使用门槛覆盖Coding、创建与评估

- **用 `/comet` 进入项目配置的 Native 或 Classic 工作流**
- **用`/comet-any`组合任意Skill**
- **用comet eval评估任意Skill**

## Comet 0.4.0 基线对比

以下图表来自 16 个 Comet workflow 任务，每个 treatment 5 次样本，对比无 Comet、Comet 0.3.9 与 Comet 0.4.0。

核心观察了Pass@5、Pass^5以及Rubric评分的差异，无 Comet Skill的基线只验证业务行为

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/comet-eval-pass5.png" alt="Comet pass@5 与 pass^5 基线对比" width="920">
</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/comet-eval-rubric-core.png" alt="Comet 核心 rubric 与 LLM-as-judge 基线对比" width="920">
</p>

## 从业界前沿技术出发

Comet的许多能力都能够在海内外大厂实践中找到相似之处，想进一步了解Comet与业界实践的对照

> 详见 [Comet Docs](https://docs.comet.rpamis.com/zh/tech-blog/comet-vs-industry)

## 你能学到什么

- **如何稳定触发嵌套 Skill** — 不是让 Agent 依靠文档描述做了“看起来像触发了 Skill”的操作（比如根据 Skill 描述写了文件），而是真正触发 Skill（核心特征：Claude Code CLI 上有 Skill 触发的打印）。Comet 中会触发大量来自 OpenSpec 和 Superpowers 的能力，稳定触发的 Prompt 经过大规模实践打磨
- **如何让组合 Skill 多阶段自动流转** — 不是靠人工介入。Comet 的 5 阶段流程，除必要的用户选择项外，核心流程能够自动进行 Skill 触发，同时状态机机制也能保障状态扭转的可靠性。
- **如何把 Spec 生命周期做成可恢复流程** — Comet 会把 OpenSpec 的 change/spec 制品与 Superpowers 的设计、计划文档关联起来，并通过每个 change 的 `.comet.yaml` 记录阶段、执行模式、验证结果和归档状态，让 Agent 中断后能够继续，而不是重新翻文档猜进度。
- **如何把文档同步从“用户提醒”变成自动化** — Comet 将 handoff、状态更新、校验和归档同步放进脚本化流程，减少“记得更新 design doc”“记得同步 spec”“记得归档 change”这类反复提示。
- **如何设计 Agent 可执行的守护条件** — Comet 的阶段退出不是简单相信 Agent 说“完成了”，而是通过 `comet-guard.mjs`、`comet-yaml-validate.mjs`、`comet-state.mjs` 等脚本检查任务、状态字段、验证证据和归档条件，满足条件后才允许推进。
- **如何做跨平台 Skill 分发和安装** — Comet 支持多种 AI 编码平台、项目级/全局安装、中文/英文 Skill 选择，以及平台差异化目录（例如 Antigravity 的项目级和全局路径不同），可以作为 CLI 安装器和 Skill 打包结构的参考。
- **如何把脚本写成 Agent 工作流基础设施** — Comet 的脚本处理 hash、YAML 字段、状态机和归档流程。它展示了如何把原本容易写散在 Prompt 里的流程控制，沉淀成可测试、可复用的工具。
- **如何基于科学的评估驱动演进Skill**— Comet Eval支持Rubric结构化评分，并支持Pass@k、Pass^k指标，用最科学的方式演进Skill，而不是靠人工感觉和评估，支持Local和Langsmith评估，让Eval真正走进企业生产环境
- **如何智能的创建Comet一样的Skill**— /comet-any支持组合任意Skill，你只需要告诉Agent你的Skill偏好，其余所有稳定性相关的hook，rule，脚本，Skill引用文件全程都由Agent搞定，帮助你创建出Comet一样好用的Skill

## 安装

前置要求：

- Node.js 22+
- npm/npx
- Git

```bash
npm install -g @rpamis/comet
```

## 快速开始

在要使用 Comet 的项目内初始化：

```bash
cd your-project
comet init
# 在宿主中调用 /comet
```

交互式初始化会介绍并提供 Native、Classic、两者三种选择。Native 面向能够自主实现和验证的强模型；Classic 面向需要完整 Spec/TDD 阶段约束的任务；两者模式会安装两套独立入口，并保持 `/comet` 默认使用 Native。非交互的新项目默认 Native，项目配置统一写入 `.comet/config.yaml`：

```bash
comet init --workflow classic
comet init --workflow both
```

### 项目配置

`comet init` 会按所选语言生成带逐字段注释的 `.comet/config.yaml`；`comet update` 补齐新增默认值，同时保留用户取值和未知扩展。

<details>
<summary>查看同时启用 Native 与 Classic 时的精简配置骨架</summary>

```yaml
schema: comet.project.v1
default_workflow: native
workflows: [native, classic]
ambient_resume: true

memory:
  learning: true
  retrieval: true
knowledge:
  provider: local
hook:
  allow_paths: []

native:
  artifact_root: docs
  language: zh-CN
  clarification_mode: batch
  archive_confirmation: automatic
  max_verify_failures: 5

classic:
  artifact_layout: docs
  language: zh-CN
  context_compression: off
  review_mode: standard
  auto_transition: true
```

- `default_workflow` 决定 `/comet` 默认入口，且必须出现在 `workflows` 中；`ambient_resume`、`memory`、`knowledge` 和 `hook` 由两套工作流共享。
- `memory.learning` / `retrieval` 控制个人记忆学习与注入；`knowledge.local.include` 可追加项目相对 Markdown glob。`hook.allow_paths` 默认为空，仅在受保护阶段确需写入共享目录时添加项目相对路径，不能绕过 `.comet` 或工作流产物保护。
- Native 用户可读产物默认位于 `docs/comet/`，机器 Runtime 固定在 `.comet/runtime/native/`；可用 `comet init --workflow native --root artifacts` 改为 `artifacts/comet/`。Classic 专属默认值放在 `classic:`，旧顶层字段会由 `comet init` / `comet update` 迁移。

云端知识、私有化 PR 等高级配置详见 [Native 配置](https://docs.comet.rpamis.com/zh/native/configuration) 与 [Classic 配置](https://docs.comet.rpamis.com/zh/classic/configuration)。Native v4 不再把旧 `snapshot` 预算持久化到用户配置中。

</details>

## 对OpenClaw和Hermes、或其他AI平台的支持

对于直接使用通用 `skills` CLI 的平台，可以用下面的方式安装 Comet skill 包：

```bash
npx skills add rpamis/comet
```

## 运行截图

### 经典Spec Skill

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/runner.png" alt="runner">
</p>
<p align="center">自动安装 OpenSpec、Superpowers，一键配置开发环境</p>
<p align="center">多阶段 Skill 入口，自动识别当前 Spec 阶段，核心流程自动触发，关键节点人工审核</p>

### 与LangSmith/LangFuse的集成

Comet Eval的自动化双Agent架构能够在线上与LangSmith/LangFuse环境集成，让实验可追溯、Skill可演进

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-dataset.png" alt="runner">
</p>
<p align="center">在LangSmith中管理你的Skill基线，查看详细的评估指标，延迟及Token消耗</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-trace.png" alt="runner">
</p>
<p align="center">在LangSmith中追踪你的Claude Code全链路</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-baseline-detail.png" alt="runner">
</p>
<p align="center">在LangSmith通过Pytest跟踪自定义Rubric指标</p>

## 支持平台

`comet init` 支持 37 个 AI 编码平台：

<details>
<summary>查看完整平台列表</summary>

| 平台               | 技能目录      | 平台          | 技能目录     |
| ------------------ | ------------- | ------------- | ------------ |
| Claude Code        | `.claude/`    | Cursor        | `.cursor/`   |
| Codex              | `.codex/`     | OpenCode      | `.opencode/` |
| Devin Desktop（原 Windsurf） | `.devin/`     | Cline         | `.cline/`    |
| RooCode            | `.roo/`       | Continue      | `.continue/` |
| GitHub Copilot     | `.github/`    | Gemini CLI    | `.gemini/`   |
| Amazon Q Developer | `.amazonq/`   | Qwen Code     | `.qwen/`     |
| Kilo Code          | `.kilocode/`  | Auggie        | `.augment/`  |
| Kimi Code          | `.kimi-code/` | Kiro          | `.kiro/`     |
| Lingma             | `.lingma/`    | Junie         | `.junie/`    |
| CodeBuddy          | `.codebuddy/` | WorkBuddy     | `.workbuddy/` |
| Crush              | `.crush/`     | Factory Droid | `.factory/`  |
| iFlow              | `.iflow/`     | Pi            | `.pi/`       |
| Qoder              | `.qoder/`     | Antigravity   | `.agents/`   |
| Antigravity 2.0    | `.agents/`    | Bob Shell     | `.bob/`      |
| ForgeCode          | `.forge/`     | Trae          | `.trae/`     |
| Trae CN            | `.trae-cn/`   | ZCode         | `.zcode/`    |
| MimoCode           | `.mimocode/`  | CoStrict      | `.cospec/`   |
| Grok               | `.grok/`      |               |              |

</details>

## 开发

贡献流程、提交规范、PR 流程、分支工作流，以及新增平台、Skill、脚本或 changelog
的说明见 [CONTRIBUTING-zh.md](CONTRIBUTING-zh.md) | [English](CONTRIBUTING.md)。

详见 [CHANGELOG.md](CHANGELOG.md) 了解版本历史与更新。

## 路线图

在 [Comet Roadmap](https://github.com/orgs/rpamis/projects/1) 查看开发进展与即将推出的功能。

## Star历史

[![Star History Chart](https://api.star-history.com/chart?repos=rpamis/comet&type=date&legend=top-left&sealed_token=UMxkYc2GrflG4LawVBIB1HY-k5O2WqatK4llgyINHBnPZRAl9PdOtca_ciCdXoKWpzzOF_K2YLyQ0CQ1Lx1tJjeO53J5mgRo9yK0DanAT_ClPsf4O2XxBQ)](https://www.star-history.com/?repos=rpamis%2Fcomet&type=date&legend=top-left)

## Contributors

<a href="https://github.com/rpamis/comet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rpamis/comet&max=999&columns=12&anon=1" />
</a>

## License

[MIT](LICENSE)

## 社区交流

<table align="center">
  <tr>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/douyin.png" width="120" height="120"><br>
      <b>抖音群（推荐）</b>
    </td>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/wechat.png" width="120" height="120"><br>
      <b>微信群</b>
    </td>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/qq.jpg" width="120" height="120"><br>
      <b>QQ群</b>
    </td>
  </tr>
</table>

## 友情链接

[LINUX DO - 新的理想型社区](https://linux.do/)
