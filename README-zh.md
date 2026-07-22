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
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm download count" src="https://img.shields.io/npm/dm/@rpamis/comet?style=flat-square&label=Downloads/mo" /></a>
  <a href="https://www.npmjs.com/package/@rpamis/comet"><img alt="npm weekly download count" src="https://img.shields.io/npm/dw/@rpamis/comet?style=flat-square&label=Downloads/wk" /></a>
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
> **0.4.0-beta.7** — 新增面向强模型、原生且可恢复的 Native 工作流，并让 Native 与 Classic 通过统一配置、状态、Guard、Dashboard 和 Eval 入口保持独立协作。
>
> **0.4.0-beta.1** — Comet 升级为纯 Node runtime（不再依赖 Bash/WSL），并带来三大核心能力：用 `/comet-any` 把**任意** Skill 组合成自定义工作流、用 `comet eval` 评估**任意** Skill 并接入 LangSmith、用 `comet dashboard` 在浏览器里可视化每一个 change。
>
> **0.3.9** — `review_mode: off|standard|thorough` 控制 Build/Verify 自动代码审查并支持项目级默认；init/update 改为可选依赖安装，补齐 CLI 国际化、阶段守护加固和 macOS 可执行权限。
>
> 详见官网 [Changelog](https://docs.comet.rpamis.com/zh/changelog)。

> Native 与 Classic 不是轻重档位，也不会互相升级。Native 服务于能够自主规划和验证的强模型；Classic 服务于需要完整阶段方法与强约束的场景。

## 为什么需要 Comet

- **面向强模型的 Native 工作流** — `/comet-native` 用详细 brief、完整目标规格、状态检查和可恢复归档约束结果，同时把计划、实现、测试与审查方法交给模型自主判断；它使用可配置的 `comet/` 产物根目录，并与 Classic 完全分离。详见 [Native 工作流](website/zh/concepts/native-workflow.mdx)。
- **长程任务稳定的核心**— Comet 的 Classic Spec 模式结合 OpenSpec 和 Superpowers，用状态机、阶段检查与脚本串联五阶段流程，适合需要明确方法和强约束的任务；永久入口是 `/comet-classic`。
- **配置驱动的统一入口** — `/comet` 只读取项目的 `.comet/config.yaml`，确定性转发到 `/comet-native` 或 `/comet-classic`。它不按任务大小猜工作流，也不混用两边的 change、状态和目录。`comet resume-probe` 使用同一配置恢复正确的永久入口。
- **Skill 平台** — Comet能够编写可复用 Skill 包，并通过 `/comet-any` 把它们整理成可分发 Bundle，你制作的Skill可以像如comet init一样一键分发到所有Coding平台。
- **Eval 平台**— Comet基于科学的Rubric、Pass@k、Pass^k评分评估你的Skill，让Skill演进是基于科学依据，而不是依靠感觉，支持接入LangSmith评估，让评估真实走进企业级生产环境。基于双Agent架构自动化在你的生产环境完成评估工作

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

```bash
cd your-project
comet init
```

交互式初始化会介绍并提供 Native、Classic、两者三种选择。Native 面向能够自主实现和验证的强模型；Classic 面向需要完整 Spec/TDD 阶段约束的任务；两者模式会安装两套独立入口，并保持 `/comet` 默认使用 Native。非交互的新项目默认 Native，项目配置统一写入 `.comet/config.yaml`：

```bash
comet init --workflow classic
comet init --workflow both
```

生成的配置会按安装时选择的语言写入用途注释。环境感知恢复是 Native 与 Classic 共用的项目级开关；如需停用只读探针，可以修改：

```yaml
# 是否启用只读的环境感知恢复探针，同时作用于 Native 和 Classic
ambient_resume: false
```

Classic 专属默认值统一收纳在 `classic:` 块中；旧顶层字段会在下次 `comet init` / `comet update` 时迁移：

```yaml
classic:
  language: zh-CN
  context_compression: off
  review_mode: standard
  auto_transition: true
```

Native 默认把产物放在 `docs/comet/`。如需使用其他项目内根目录，可以显式指定；例如下面会改为 `artifacts/comet/`：

```bash
comet init --workflow native --root artifacts
```

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

## CLI命令

<details>
<summary><code>comet init [path]</code> — 初始化 Comet 工作流</summary>

为选定的 AI 编码平台初始化 Comet。交互模式可选择 Native、Classic 或两者；新的非交互项目默认使用自包含 Native，检测到既有 Classic 状态时保持 Classic。两套工作流拥有独立入口、状态、产物与 Guard；每个平台只安装一份 `comet-workflow-guard` Rule，支持 Hook 的平台只安装一个 `comet-hook-router.mjs`。Router 根据 `.comet/current-change.json`，一次只把写入路由给当前 Native 或 Classic Guard。只有 Classic 安装 OpenSpec 和 Superpowers，Native 不依赖外部 Skill。

| 选项                | 描述                                                 |
| ------------------- | ---------------------------------------------------- |
| `--yes`             | 非交互模式，自动选择已检测平台（未检测到则选择全部） |
| `--scope <scope>`   | 安装范围：`project` 或 `global`                      |
| `--language <lang>` | 技能语言：`en` 或 `zh`（跳过交互式语言选择）         |
| `--workflow <mode>` | 初始化工作流：`native`、`classic` 或 `both`          |
| `--root <path>`     | Native 的项目内产物根目录，例如 `docs`               |
| `--skip-existing`   | 跳过已安装的组件                                     |
| `--overwrite`       | 覆盖已安装的组件                                     |
| `--json`            | 输出结构化 JSON                                      |

当同一平台检测到多个已安装组件时，交互式 init 会先提供一次批量选择：全部覆盖、全部跳过，或逐项选择。

</details>

<details>
<summary><code>comet status [path]</code> — 显示活跃更改和下一步命令</summary>

分别显示默认入口、Native changes、Classic changes 和未托管 OpenSpec changes；两套状态保持独立，同时保留 Classic 的 runtime 诊断字段。

| 选项     | 描述                                                           |
| -------- | -------------------------------------------------------------- |
| `--json` | 输出活跃更改，并包含 `nextCommand`、`currentStep` 和运行时数据 |

</details>

<details>
<summary><code>comet resume-probe [path]</code> — 判断是否应恢复活跃 Comet workflow</summary>

只读解析项目默认工作流，再只检查该工作流的 active changes、当前阶段和用户请求，输出 `auto_resume`、`ask_user`、`out_of_scope` 或 `none`。Native 返回 `/comet-native`，Classic 返回 `/comet-classic`；配置损坏时不会回退或扫描另一套目录。
`comet init/update` 会把 `<comet-ambient-resume>` managed block 合并进 `AGENTS.md` 和 `CLAUDE.md`，保留用户已有规则。

</details>

<details>
<summary><code>comet dashboard [path]</code> — 启动本地只读仪表盘服务</summary>

启动本地 HTTP 服务器，展示包含活跃更改、阶段状态、任务进度和归档历史的可视化仪表盘。默认自动在浏览器中打开。

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/dashboard-light.png" alt="Comet 仪表盘-Light" width="800">
</p>
<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/dashboard-dark.png" alt="Comet 仪表盘-Dark" width="800">
</p>
<p align="center">活跃更改概览，包含阶段指示器、任务进度和归档历史</p>

| 选项        | 描述                                                          |
| ----------- | ------------------------------------------------------------- |
| `--port`    | 服务器端口（默认：自动选择可用端口）                          |
| `--no-open` | 不自动在浏览器中打开仪表盘                                    |
| `--json`    | 收集单次快照并以 JSON 格式输出到标准输出（用于脚本编写/检查） |

</details>

<details>
<summary><code>comet doctor [path]</code> — 诊断 Comet 安装健康状态</summary>

检查项目级/全局安装、工作目录、已安装技能、脚本，以及活跃 change 的诊断信息。`comet doctor` 会对畸形
`.comet.yaml` 报告 diagnostic 状态，对有效 change 报告 current step / runtime mode，并指出哪些运行时证据缺失导致无法安全恢复。

| 选项              | 描述                                                    |
| ----------------- | ------------------------------------------------------- |
| `--json`          | 输出结构化诊断结果                                      |
| `--scope <scope>` | 诊断 `auto`、`project` 或 `global` 范围（默认：`auto`） |

</details>

<details>
<summary><code>comet update [path]</code> — 更新 Comet 包和技能</summary>

刷新已检测到的项目级/全局 Comet 技能。仅刷新当前项目时默认不会修改任何 npm 安装（包括全局包和项目级包）；需要同时升级 CLI 时必须显式传入 `--self-update`。显式 `--scope global` 会确定性走 current-project 资产范围，不会进入 all-projects 选择，也不会隐式更新 npm 包。自更新会先比较完整 semver（包括预发布版本），拒绝降级，并在安装前隔离验证候选包的版本、Workflow 与 Native 命令；安装失败时尝试恢复精确的当前版本。

| 选项                 | 描述                                      |
| -------------------- | ----------------------------------------- |
| `--json`             | 以 JSON 输出 npm 和 skill 更新结果        |
| `--language <lang>`  | 覆盖自动检测到的 skill 语言 (`en`, `zh`)  |
| `--scope <scope>`    | 仅更新 `global` 或 `project` 安装范围     |
| `--current-project`  | 只刷新当前项目                            |
| `--all-projects`     | 刷新登记的所有项目级安装                  |
| `--self-update`      | 刷新资产前显式升级 Comet npm 包           |
| `--skip-self-update` | 显式跳过 Comet npm 包自更新                |

</details>

<details>
<summary><code>comet uninstall [path]</code> — 卸载 Comet 技能、规则和钩子</summary>

安全移除 Comet 分发的技能、规则和钩子，保留用户自定义的钩子和非 Comet 配置。

| 选项              | 描述                              |
| ----------------- | --------------------------------- |
| `--force`         | 跳过确认提示                      |
| `--scope <scope>` | 仅卸载 `global` 或 `project` 范围 |
| `--json`          | 以 JSON 输出卸载结果              |

```bash
comet uninstall              # 交互式 — 显示已安装目标，确认后卸载
comet uninstall --force      # 非交互式 — 直接移除所有内容
comet uninstall --scope project  # 仅移除项目级安装
```

</details>

<details>
<summary><code>comet eval [target]</code> — 通过共享 eval harness 运行 Skill Eval</summary>

`comet eval` 用来回答一个很朴素的问题：这个 Skill 真的能在标准任务里稳定工作吗？

最常见的是评估 `/comet-any` 生成的 Skill。生成物里通常会有 `comet/eval.yaml`，优先把这个文件交给
`comet eval`：

```bash
comet eval ./generated-skill/comet/eval.yaml --collect
comet eval ./generated-skill/comet/eval.yaml --html
```

第一条命令只做发现和预检查，用来确认 manifest、任务和依赖路径能被识别，不会先跑高成本评估。
第二条命令执行本地评估并生成可浏览报告，适合作为发布前证据。报告路径会在命令输出里显示，通常位于
`eval/local/logs/experiments/<experiment-id>/summary.html`。

如果你还没有 `comet/eval.yaml`，只有一个本地 Skill 目录，可以先跑低成本冒烟：

```bash
comet eval ./my-skill --quick --html
```

这个路径适合早期验证 Skill 目录能否被读取、能否注入到 eval harness，以及通用 smoke task 能否跑起来。
准备发布时，仍推荐通过 `/comet-any` 生成 `comet/eval.yaml`，再走 manifest 评估。

### Local 评估怎么看

本地评估适合日常开发和发布前自检。优先看 HTML 报告里的几件事：

- pass/fail 和 rubric 分数是否符合预期
- 失败归因是 Skill、workflow、task、model，还是环境/harness
- 是否缺少预期 artifact
- token、成本和耗时是否异常
- 当前结果是否足够干净，还是需要重跑某个 task/treatment

如果报告提示 `Insufficient clean data` 或 `Inconclusive due to data quality`，先检查认证、限额、Docker/容器和网络等环境问题，不要直接把这次结果当成 Skill 质量结论。

### LangSmith 评估怎么用

当你需要把评估结果同步到 LangSmith，或想在团队里查看 run、rubric feedback、成本和 Claude Code 轨迹时，再使用 LangSmith 套件。它复用同一套任务、treatment、rubric 和 `comet/eval.yaml`，只是把结果上报到 LangSmith。

先准备一次依赖和环境变量：

```bash
cd eval
uv sync --extra langsmith
```

```bash
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=comet-skill-eval
LANGSMITH_TRACING=true
```

然后通过同一个 `comet eval` 入口选择 LangSmith 套件：

```bash
comet eval ./generated-skill/comet/eval.yaml --suite langsmith --html
```

`--suite` 默认为 `local`。选择 `langsmith` 后，CLI 会启动 LangSmith runner，在启动信息中显示 `Suite: langsmith`，并把报告写入 `eval/langsmith/logs/experiments/`。PowerShell 中可以用 `$env:LANGSMITH_API_KEY`、`$env:LANGSMITH_PROJECT` 和 `$env:LANGSMITH_TRACING` 设置变量；也可以把它们放进 `eval/.env`。完整插件缓存和轨迹追踪说明见 [eval/langsmith/README.md](eval/langsmith/README.md)。

### 什么时候用哪个

- 日常开发：`comet eval ./my-skill --quick --html`
- `/comet-any` 生成物：`comet eval ./generated-skill/comet/eval.yaml --collect`，再跑 `--html`
- 发布前证据：优先使用 `comet/eval.yaml` 的本地 HTML 报告
- 团队追踪和横向对比：`comet eval ./generated-skill/comet/eval.yaml --suite langsmith --html`

更完整的任务、treatment、报告口径和排障说明见 [Eval 使用文档](docs/operations/EVAL-USAGE-ZH.md)。

</details>

<details>
<summary><code>/comet-any</code> / <code>comet creator</code> / <code>comet publish</code> — 创建、评估和发布 Skill</summary>

`/comet-any` 是普通用户主路径：创建或优化可复用 Skill → `comet eval` 验证 → 审核与分发，直到形成稳定组合 Skill。
需要恢复或发布时，使用 `comet creator`、`comet creator status` / `comet creator next`、`comet publish` 和
`comet publish distribute --preview`。README 不展开后端命令清单；高级 Bundle 后端和高级 Engine Run（例如
`comet skill run` / `comet skill continue`）见 [Skill 创建文档](docs/operations/SKILL-CREATION-ZH.md)。

</details>

<details>
<summary><code>comet --help</code> / <code>comet --version</code> — 基础信息</summary>

| 命令              | 描述     |
| ----------------- | -------- |
| `comet --help`    | 显示帮助 |
| `comet --version` | 显示版本 |

</details>

## 支持平台

`comet init` 支持 33 个 AI 编码平台：

<details>
<summary>查看完整平台列表</summary>

| 平台               | 技能目录      | 平台          | 技能目录     |
| ------------------ | ------------- | ------------- | ------------ |
| Claude Code        | `.claude/`    | Cursor        | `.cursor/`   |
| Codex              | `.codex/`     | OpenCode      | `.opencode/` |
| Windsurf           | `.windsurf/`  | Cline         | `.cline/`    |
| RooCode            | `.roo/`       | Continue      | `.continue/` |
| GitHub Copilot     | `.github/`    | Gemini CLI    | `.gemini/`   |
| Amazon Q Developer | `.amazonq/`   | Qwen Code     | `.qwen/`     |
| Kilo Code          | `.kilocode/`  | Auggie        | `.augment/`  |
| Kimi Code          | `.kimi-code/` | Kiro          | `.kiro/`     |
| Lingma             | `.lingma/`    | Junie         | `.junie/`    |
| CodeBuddy          | `.codebuddy/` | CoStrict      | `.cospec/`   |
| Crush              | `.crush/`     | Factory Droid | `.factory/`  |
| iFlow              | `.iflow/`     | Pi            | `.pi/`       |
| Qoder              | `.qoder/`     | Antigravity   | `.agents/`   |
| Antigravity 2.0    | `.agents/`    | Bob Shell     | `.bob/`      |
| ForgeCode          | `.forge/`     | Trae          | `.trae/`     |
| Trae CN            | `.trae-cn/`   | ZCode         | `.zcode/`    |
| MimoCode           | `.mimocode/`  |               |              |

</details>

## 技能

`comet init` 会按所选工作流安装技能：Native 只依赖 Comet 原生技能，Classic 会额外安装 OpenSpec 与 Superpowers。

### Comet 技能

<details>
<summary>查看 Comet 技能列表</summary>

| 技能             | 描述                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `/comet`         | 共享入口 — 根据 `.comet/config.yaml` 转发到项目配置的 Native 或 Classic       |
| `/comet-native`  | Native 永久入口 — Shape、Build、Verify、Archive，自包含且可恢复               |
| `/comet-classic` | Classic 永久入口 — OpenSpec + Superpowers 五阶段工作流                        |
| `/comet-open`    | Classic 阶段 1：打开变更（提案、设计、任务分解）                              |
| `/comet-design`  | Classic 阶段 2：深度设计（头脑风暴、设计文档）                                |
| `/comet-build`   | Classic 阶段 3：规划与构建（实现计划、代码提交）                              |
| `/comet-verify`  | Classic 阶段 4：验证与完成（测试、验证报告）                                  |
| `/comet-archive` | Classic 阶段 5：归档（delta spec 同步、状态标注）                             |
| `/comet-hotfix`  | Classic 快捷路径：快速 bug 修复                                                |
| `/comet-tweak`   | Classic 轻量路径：串联 OpenSpec 的中等改动                                     |
| `/comet-any`     | Comet Skill Creator：创建或优化可复用 Skill                                   |

</details>

### 守护与自动化脚本

<details>
<summary>查看脚本列表</summary>

| 脚本                      | 用途                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| `comet-env.mjs`           | 脚本发现助手 — 打印内置脚本所在目录，供 skill 解析同级命令脚本路径      |
| `comet-guard.mjs`         | 阶段转换守护 — 验证退出条件，`--apply` 自动更新 `.comet.yaml`           |
| `comet-handoff.mjs`       | 设计交接 — 从 OpenSpec 制品生成带 SHA256 追踪的确定性上下文包           |
| `comet-archive.mjs`       | 一键归档 — 验证状态、同步 specs、移至归档、更新状态                     |
| `comet-yaml-validate.mjs` | 模式校验器 — 校验 `.comet.yaml` 结构和字段值                            |
| `comet-state.mjs`         | 统一状态管理 — init/set/get/check/scale，agent 的专属 YAML 接口         |
| `comet-hook-router.mjs`   | 平台唯一 Hook 入口 — 按当前需求归属路由到一个 workflow Guard            |
| `comet-hook-guard.mjs`    | Classic Guard launcher — Router 选中 Classic 时调用 Classic runtime     |
| `comet-native-runtime.mjs` | Native 状态、检查、归档与恢复 runtime                                   |
| `comet-native-hook-guard.mjs` | Native Guard launcher — Router 选中 Native 时调用 Native runtime     |

Native 与 Classic runtime 都由 TypeScript 生成，通过 `node` 在所有平台运行；Native 不依赖 OpenSpec、Superpowers、Bash、Git Bash 或 WSL。

</details>

## 工作流

### Native 工作流

`/comet-native` 使用 Shape → Build → Verify → Archive 四个阶段。Shape 负责澄清、brief、完整目标规格与用户确认；其余规划和实现方法由 Agent 自主选择。状态、验证证据和恢复数据都由 Native runtime 管理，默认写入 `docs/comet/`。

<details>
<summary>查看 Native 阶段流程</summary>

```text
/comet-native（或 default_workflow: native 时的 /comet）
  Shape  ──确认需求契约──>  Build  ──记录实现范围──>  Verify  ──验证通过──>  Archive
                              ^                         │
                              └────── 验证失败 ─────────┘
```

| 阶段      | 主要工作                                                                       | 必要结果                                                      |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Shape     | 调查环境、逐轮澄清、编写 brief 和每个 capability 的完整目标规格               | 无阻塞问题，用户确认与当前 contract hash 绑定                 |
| Build     | Agent 自主选择规划、实现、测试与审查方式；长任务可记录阶段内 checkpoint        | 实现范围与基线差异可计算，普通源码写入只允许发生在 Build      |
| Verify    | 按验收 ID 检查行为，编写 `verification.md`，记录执行、跳过项、风险和证据       | 验证通过进入 Archive；验证失败返回 Build，并进入有界修复过程  |
| Archive   | 只读预检、确认 canonical spec 没有并发漂移，再同步规格并移动完整 change         | 用户确认的预检仍然有效，归档事务完整提交                      |

Shape 的 `clarification_mode` 可设为 `sequential` 或 `batch`。前者每轮询问一个最上游问题；后者一次询问当前所有前置条件已确定的问题。两种模式都要求 Agent 自己调查可查事实，并把用户决定写回 brief 与完整目标规格。

</details>

<details>
<summary>查看 Native 状态与产物</summary>

| 文件或目录                                      | 用途                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `.comet/config.yaml`                            | 选择启用/default workflow、artifact root、语言和澄清模式             |
| `.comet/current-change.json`                    | Native/Classic 共用的当前需求归属；一次写入只路由到一个 workflow     |
| `docs/comet/changes/<name>/comet-state.yaml`    | Native phase、revision、approval、spec operation 和证据引用           |
| `docs/comet/changes/<name>/brief.md`            | Outcome、范围、非目标、验收示例、约束、决定和未决问题                 |
| `docs/comet/changes/<name>/specs/`              | 每个 capability 归档后应具备的完整目标行为                           |
| `docs/comet/changes/<name>/verification.md`     | 验收证据、命令结果、跳过检查、规格一致性、风险和结论                 |
| `docs/comet/changes/<name>/runtime/`            | baseline、Run、trajectory、checkpoint、实现范围和验证 evidence        |
| `docs/comet/specs/` / `archive/` / `runtime/`   | canonical specs、已归档 changes，以及锁和可恢复事务                  |

Native 可以同时保留多个 active change；`comet status` 会分别列出候选，`.comet/current-change.json` 只选择当前请求归属，不代表只能存在一个 change。选择缺失、失效或存在歧义时，恢复和写入都会停止并要求明确选择，不会猜测另一个 change 或切换到 Classic。

`comet-state.yaml` 和 `runtime/` 中的 revision、hash、evidence 引用及事务状态由 Runtime 管理。需求改变时修改 brief 或拟议规格，再让命令重新计算 contract；不要手改 phase、hash 或 JSON 证据来绕过检查。

</details>

<details>
<summary>查看 Native 可靠性与恢复</summary>

1. **澄清阻塞点** — Shape 把仍影响实现的用户决定保存为 blocking question；Batch 模式还要求用户明确确认双方已形成共同理解，未确认前不能进入 Build。
2. **确认绑定需求** — approval 与 brief + 完整目标规格的 contract hash 绑定；需求变化会使旧确认失效，避免按过期目标继续实现。
3. **可审计实现范围** — change 创建时记录完整 baseline；离开 Build 时根据前后快照计算内容寻址的 implementation scope，不靠 Agent 自述改了什么。
4. **验收与验证证据** — Runtime 从 brief/spec 派生稳定验收 ID，验证报告把每项验收绑定到项目文件、跳过理由和可选只读检查 receipt；scope、contract 或报告变化会让旧证据失效。
5. **阶段内恢复与修复** — checkpoint 保存阶段内进度和产物 manifest；恢复时检查 freshness。连续无进展的验证失败进入有界 repair episode，真实实现进展会重置停滞判断。
6. **受保护文件与事务** — Run、trajectory、checkpoint 和 evidence 经过受保护 I/O；Archive 与 artifact-root move 使用可恢复事务、CAS 和锁，遇到中断时由 doctor 明确 continue 或 rollback。
7. **统一但不混合的守护** — 平台只安装一份 Rule 和一个 Hook Router；Router 根据当前归属调用 Native Guard。Native 只在 Build 允许普通实现写入，并与 Classic 的 phase、schema、目录和 Guard 保持独立。

</details>

### Classic 五阶段工作流

<details>
<summary>查看 Classic 五阶段流程</summary>

```
/comet-classic（或 default_workflow: classic 时的 /comet）
  ↓
/comet-open  -->  /comet-design  -->  /comet-build  -->  /comet-verify  -->  /comet-archive
(OpenSpec)         (Superpowers)       (Superpowers)       (Both)           (OpenSpec)

/comet-hotfix（快捷路径，跳过头脑风暴）
  open  -->  build  -->  verify  -->  archive

/comet-tweak（轻量预设路径，串联 OpenSpec）
  open  -->  build  -->  verify  -->  archive
```

#### 五个阶段

| 阶段               | 命令             | 归属        | 产出物                           |
| ------------------ | ---------------- | ----------- | -------------------------------- |
| 1. Open            | `/comet-open`    | OpenSpec    | proposal.md、design.md、tasks.md |
| 2. Deep Design     | `/comet-design`  | Superpowers | Design Doc、delta spec           |
| 3. Plan & Build    | `/comet-build`   | Superpowers | 实现计划、代码提交               |
| 4. Verify & Finish | `/comet-verify`  | Both        | 验证报告、分支处理               |
| 5. Archive         | `/comet-archive` | OpenSpec    | delta→main spec 同步、归档       |

</details>

### Classic 状态管理

Classic 使用解耦状态架构，文件独立管理：

<details>
<summary>查看 Classic 状态管理</summary>

| 文件                                      | 归属     | 用途                           |
| ----------------------------------------- | -------- | ------------------------------ |
| `.openspec.yaml`                          | OpenSpec | Spec 生命周期、变更元数据      |
| `openspec/changes/<name>/.comet.yaml`     | Comet    | 工作流阶段、执行模式、验证状态 |
| `.comet/run-state.json`                   | Engine   | Run 身份和执行状态（机器所有） |
| `.comet/state-events.jsonl`               | Comet    | 追加式状态转移审计日志         |

每个 change 目录下的 `.comet.yaml` 保存 Classic 工作流状态，只保留 `run_id` 指向 Engine Run。Engine 的机器状态放在
该 change 的 `.comet/run-state.json`，使用 `currentStep`、`status`、`iteration` 等 camelCase 字段；旧 YAML 中残留的 Run 字段会在兼容读取后迁移出去，`skill` 不再是当前 `.comet.yaml` 的合法字段。项目级默认配置只放在 `.comet/config.yaml`。

阶段推进由 TypeScript transition table、`comet-state transition`、`comet-guard --apply` 和归档命令统一处理。
每次成功推进都会向 `.comet/state-events.jsonl` 追加一条审计事件，记录来源、前后状态和实际字段变化。

这样 Skill 文本只负责指导 Agent，状态读写、阶段校验、审计和断点恢复都交给脚本；Agent 通过 Comet 命令即可知道当前 Spec 处于哪个阶段。

</details>

<details>
<summary>查看 Classic change .comet.yaml 关键字段</summary>

**change `.comet.yaml` 关键字段：**

```yaml
workflow: full                                           # 工作流类型：full | tweak | hotfix
phase: build                                             # 当前阶段：open | design | build | verify | archive
context_compression: off                                 # 上下文压缩：off | beta
auto_transition: true                                    # 阶段完成后是否自动触发下一个 Skill
base_ref: <git-sha-or-null>                              # 初始化时记录的基线提交；可为 null
created_at: YYYY-MM-DD                                   # comet-state.mjs init 写入的创建日期
run_id: <uuid>                                           # 仅链接到 .comet/run-state.json；Run 详情不写在 YAML
review_mode: standard                                    # 自动代码审查强度：off | standard | thorough
build_mode: subagent-driven-development                  # 构建方式：subagent-driven-development | executing-plans | direct
build_pause: null                                        # `build_pause` 记录 build 阶段内部暂停点：null 无暂停，`plan-ready` 表示 plan 已生成
subagent_dispatch: null                                  # subagent 分派确认；进入 verify 前需 confirmed
tdd_mode: null                                           # full workflow 的 build 选择：tdd | direct
isolation: branch                                        # 隔离方式：current | branch | worktree
bound_branch: null                                       # current/branch/worktree 模式绑定的 Git 分支；切换分支会触发阻塞
verify_mode: null                                        # 验证模式：light | full
design_doc: docs/superpowers/specs/<design-doc>.md       # 设计文档路径
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md       # 实现计划路径
verify_result: pending                                   # 验证结果：pending | pass | fail
verification_report: null                                # 验证报告路径；verify-pass 前必须存在
branch_status: pending                                   # 分支处理状态：pending | handled
verified_at: null                                        # 验证通过时间；验证前为 null
archived: false                                          # 是否已归档；归档后阻止继续修改
direct_override: null                                    # full workflow 选择 direct build 时必须显式 true
handoff_context: null                                    # comet-handoff.mjs 写入的设计交接上下文路径
handoff_hash: null                                       # handoff_context 对应 SHA256；存在时必须是 64 位 hex
classic_profile: full                                    # 脚本维护的 Classic profile（机器字段）
classic_migration: 1                                     # 脚本维护的迁移版本（机器字段）
```

</details>

### Classic 可靠性与共享守护

下面前六项是 Classic 的阶段自动化；最后一项是 Native 与 Classic 共用的 Router/Rule 边界：

<details>
<summary>查看 Classic 可靠性与共享守护</summary>

1. **入口验证** — 每个阶段在执行前验证前置条件
   - 检查文件存在、状态一致性、阶段转换
   - 验证失败时输出 `[HARD STOP]` 及可操作建议

2. **自动化状态转换** — `comet-guard.mjs --apply` 自动更新 `.comet.yaml`
   - 所有阶段转换（open → design/build → verify → archive）使用 `guard --apply`
   - 无需手动状态编辑 — 消除写入验证错误
   - `comet-state.mjs` 是 agent 对状态操作的专属接口
   - Guard 和 archive 脚本内部使用 `comet-state.mjs` 进行状态管理

3. **模式校验** — `comet-yaml-validate.mjs` 确保数据完整性
   - 校验必填字段和可选字段
   - 校验枚举值（包括 `direct_override`）
   - 校验 `design_doc`、`plan`、`handoff_context` 路径存在，并校验 `handoff_hash` 格式
   - 检测未知/拼写错误字段

4. **Build 决策强制** — Guard 和状态转换同时拦截跳过关键选择
   - `isolation` 必须是 `current`、`branch` 或 `worktree`
   - `isolation: current`、`branch`、`worktree` 都会绑定当前 Git 分支，后续入口检查会拦截意外切换分支
   - `build_mode` 必须已选择
   - `build_pause: plan-ready` 是 plan 生成后的可恢复暂停点，不是 `build_mode`
   - full workflow 的 `build_mode: direct` 必须有 `direct_override: true`

5. **验证证据强制** — Guard 在阶段流转前强制要求验证凭证
   - `verify-pass` 转换要求 `verification_report` 指向已存在的验证报告文件
   - `branch_status` 必须为 `handled` 才能通过验证
   - Guard 检查 `verification_report exists` 和 `branch_status=handled` 作为硬性前提
   - 防止验证或分支处理被跳过时产生虚假的阶段推进

6. **归档自动化** — `comet-archive.mjs` 一键处理完整归档流程
   - 验证入口状态、通过 OpenSpec 将 delta specs 合并到 main specs
   - 标注设计文档和计划文档的 frontmatter
   - 将变更移至归档目录并更新 `archived: true`
   - 支持 `--dry-run` 预览

7. **防漂移阶段守护** — 长上下文会话中的阶段意识保障
   - Rule 层：每个平台只安装一份 `comet-workflow-guard`，根据 enabled、default 与 `.comet/current-change.json` 中的 current 归属，只应用一套阶段模型
   - Hook 层：支持 Hook 的平台只安装一个 `comet-hook-router.mjs`；一次写入最多路由到一个 Guard，selection 不明确或失效时失败关闭
   - Guard 层：Native 与 Classic 各自保留独立阶段和允许路径；Native 仅在 Build 允许普通实现写入，Classic 在 Build、Verify 允许

</details>

## 项目结构

<details>
<summary>Native 项目结构（默认 <code>docs/comet/</code>）</summary>

```text
your-project/
├── .comet/
│   ├── config.yaml                    # 共享项目配置与 Native artifact_root
│   └── current-change.json            # 可选；当前需求归属（Native/Classic 共用）
├── .claude/skills/                    # 以 Claude Code 为例的平台技能目录
│   ├── comet/SKILL.md                 # 配置驱动的共享入口
│   └── comet-native/
│       ├── SKILL.md                   # Native 永久入口
│       ├── reference/                 # 产物、命令与恢复协议
│       └── scripts/                   # Native runtime 与 Guard launcher
└── docs/comet/                        # native.artifact_root: docs
    ├── specs/<capability>/spec.md     # 已归档的 canonical specs
    ├── changes/<name>/
    │   ├── comet-state.yaml           # Native change 状态
    │   ├── brief.md                   # 结果、范围、决策与验收预期
    │   ├── specs/<capability>/spec.md # 完整目标规格
    │   ├── verification.md            # 验证报告
    │   └── runtime/                   # checkpoint、证据与恢复状态
    ├── archive/YYYY-MM-DD-<name>/     # 已归档 change
    └── runtime/                       # locks 与可恢复 transactions
```

</details>

<details>
<summary>Classic 项目结构</summary>

```
your-project/
├── .comet/
│   └── config.yaml              # 共享项目配置（工作流、环境感知恢复、语言和 Classic 默认值）
├── .claude/skills/              # 平台技能目录（Comet + OpenSpec + Superpowers）
│   ├── comet/SKILL.md
│   │   └── scripts/
│   │       ├── comet-guard.mjs       # 阶段转换守护（--apply 自动更新状态）
│   │       ├── comet-env.mjs         # 脚本发现助手
│   │       ├── comet-handoff.mjs     # 设计交接（OpenSpec → Superpowers 上下文追踪）
│   │       ├── comet-archive.mjs     # 一键归档自动化
│   │       ├── comet-yaml-validate.mjs # 模式校验器
│   │       ├── comet-hook-router.mjs   # 平台唯一 Hook 入口（路由当前 workflow Guard）
│   │       ├── comet-hook-guard.mjs    # Classic Guard（不单独安装为平台 Hook）
│   │       └── comet-state.mjs       # 统一状态管理（init/set/get/check/scale）
│   ├── comet-*/SKILL.md
│   ├── openspec-*/SKILL.md
│   └── brainstorming/SKILL.md
├── openspec/                    # OpenSpec — WHAT
│   ├── config.yaml
│   └── changes/
│       └── <name>/
│           ├── .openspec.yaml       # OpenSpec 状态
│           ├── .comet.yaml          # Comet 工作流状态（Classic 字段 + run_id 关联）
│           ├── .comet/
│           │   ├── run-state.json   # Engine Run 状态（机器所有，自动迁移）
│           │   └── state-events.jsonl # 状态转移审计日志（追加式）
│           ├── proposal.md
│           ├── design.md
│           ├── specs/<capability>/spec.md
│           └── tasks.md
└── docs/superpowers/            # Superpowers — HOW
    ├── specs/                   # 设计文档
    └── plans/                   # 实现计划
```

</details>

<details>
<summary>Classic 上下文压缩（Beta）</summary>

Comet 支持在 Design → Build 阶段交接时进行上下文压缩。启用后，`comet-handoff.mjs` 会生成精简的上下文包，在不影响实现正确性的前提下，将
Build 阶段的输入 token 降低 **25–30%**。

| 模式   | 行为                                 | Token 节省 |
| ------ | ------------------------------------ | ---------- |
| `off`  | handoff context 包含完整 Spec 摘录   | 基线       |
| `beta` | 仅保留 Design Doc + SHA256 hash 引用 | ~25–30%    |

Benchmark 核心结论：

- **测试通过率**：所有档位均为 100%（压缩不影响实现正确性）
- **Spec 覆盖率**：off 100% vs beta 95%（压缩可能丢失少量边缘需求细节）
- **规模效应**：任务越大，绝对节省量越高（large 档位节省可达 15,000 tokens）

启用方式：在 `.comet/config.yaml` 的 `classic:` 块中设置 `context_compression: beta`。

详见 [CONTEXT-COMPRESSION.md](docs/CONTEXT-COMPRESSION.md) 获取完整 Benchmark 报告、压缩原理和复现步骤。

</details>

<details>
<summary>Classic 自动流转（Auto Transition）</summary>

`auto_transition` 控制阶段完成后是否自动调用下一个 Skill，还是暂停等待用户手动触发。阶段推进本身始终执行，该配置仅影响 Skill 调用。

| 值      | 行为                                     |
| ------- | ---------------------------------------- |
| `true`  | 阶段完成后自动调用下一个 Skill（默认）   |
| `false` | 阶段完成后暂停，用户手动触发下一个 Skill |

三层配置与优先级：`COMET_AUTO_TRANSITION` 环境变量 > `.comet/config.yaml` 的 `classic.auto_transition`（项目级）> change `.comet.yaml`。

详见 [AUTO-TRANSITION.md](docs/AUTO-TRANSITION.md) 获取配置详情、工作流映射和常见问题。

</details>

## 开发

贡献流程、提交规范、PR 流程、分支工作流，以及新增平台、Skill、脚本或 changelog
的说明见 [CONTRIBUTING-zh.md](CONTRIBUTING-zh.md) | [English](CONTRIBUTING.md)。

详见 [CHANGELOG.md](CHANGELOG.md) 了解版本历史与更新。

## 路线图

在 [Comet Roadmap](https://github.com/orgs/rpamis/projects/1) 查看开发进展与即将推出的功能。

## Star历史

[![Star History Chart](https://api.star-history.com/chart?repos=rpamis/comet&type=date&legend=top-left&sealed_token=vRfs1efclBxdyNz7q0GUHGe9kUU96aSUCa1eHI8CEWehNHvZoop01eCjM0jpVMgeYBjvnGBcd0OUHnhQBC8p6gXP2Drpmo3pLXl_r0prKSuNW6OTqddOBCgaPtSt_KDlRgXjHZhx94_zcXWkIg5HOJEjPq4Qp2TMEa6inFxm7TixQQRIdPgKw2Z00nie)](https://www.star-history.com/?repos=rpamis%2Fcomet&type=date&legend=top-left)

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
