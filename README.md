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

## What is Comet ?

```
 ██████╗ ██████╗ ███╗   ███╗███████╗████████╗
██╔════╝██╔═══██╗████╗ ████║██╔════╝╚══██╔══╝
██║     ██║   ██║██╔████╔██║█████╗     ██║
██║     ██║   ██║██║╚██╔╝██║██╔══╝     ██║
╚██████╗╚██████╔╝██║ ╚═╝ ██║███████╗   ██║
 ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝   ╚═╝
```

> 中文版：[README-zh.md](README-zh.md)
> [Bilibili video](https://www.bilibili.com/video/BV1y4Gi6CEo1/?spm_id_from=333.1387.homepage.video_card.click&vd_source=d22726fe6b108647dbebf1c5d8817377)
> [DouYin](https://www.douyin.com/search/comet?aid=cd8fcc82-498b-4d59-8860-617deb719412&modal_id=7646429015808936293&type=general)

**Comet is a resumable long-running task workflow and Skill platform for coding.**

It provides two independent requirements workflows: Native for strong models, powered only by Comet's own runtime, and Classic, which preserves the full OpenSpec + Superpowers phase-governance model. Comet also covers Skill creation, evaluation, and release.

It allows you to use a toolchain to handle everything from requirements to archiving, combine any skill to make it like Comet, evolving your skills based on scientific **Rubric**, **Pass@k**, and **Pass^k** scoring.

> [!IMPORTANT]
> **0.4.0-rc.1** — Native Supervisor Changes can decompose a complex requirement into **dependency-aware child changes**, let independent Codex sessions or a Claude Code Agent Team implement and verify them in **isolated worktrees**, and then have the Runtime **integrate them in dependency order** before the parent change's **final acceptance**.
>
> RC.1 also adds manageable **Personal Memory**, **Project Knowledge**, and **progressive context**, plus a **three-pane Dashboard** for workflows, Git worktrees, memory, knowledge, and plugin settings. Native **Portable State**, **recovery paths**, and the **Windows Hook** experience are hardened throughout.
>
> **0.4.0-beta.7** — Added a **native, recoverable workflow for strong models**. Native and Classic operate independently through shared configuration, status, Guard, Dashboard, and Eval entry points. Aligned evaluation (16 tasks × 48 runs, using the 41 paired samples where both treatments passed) showed **76.8% fewer total tokens**, **57.4% fewer Agent rounds**, **47.4% less time**, **87.5% pass^3 (+12.5pp), and 100% pass@3**.
>
> **0.4.0-beta.1** — Upgraded Comet to a pure Node runtime without Bash/WSL and added three core capabilities: compose **any** Skill through `/comet-any`, evaluate **any** Skill through `comet eval` with LangSmith integration, and inspect every change through `comet dashboard`.
>
> **0.3.9** — Review mode (`off|standard|thorough`) controls Build/Verify code review with project defaults; init/update gained optional dependency prompts, broader CLI i18n, stronger phase guards, and macOS executable bits.
>
> See the website [Changelog](https://docs.comet.rpamis.com/en/changelog) for details and the [Native vs. 0.4.0 Classic baseline](https://docs.comet.rpamis.com/en/eval/comet-native-vs-040-experiment) for the evaluation results.

> Native and Classic are not lightweight and heavyweight tiers, and neither upgrades into the other. Native is for strong models that can plan and verify autonomously; Classic is for scenarios that benefit from a complete phased methodology and stronger constraints.

## Why Comet

- **Native workflow for strong models** — `/comet-native` uses a detailed brief, complete target specifications, phase checks, and recoverable archive to constrain outcomes while leaving planning, implementation, testing, and review methods to the model. User-readable artifacts live under `docs/comet/` by default, fully separate from Classic. See the [Native workflow guide](https://docs.comet.rpamis.com/en/native/quickstart).
- **Supervisor Changes for complex requirements** — Native can split work along real delivery boundaries, manage dependencies and readiness as a DAG, let multiple agents implement and verify in Runtime-created worktrees, and then integrate the results before the parent change's final acceptance.
- **The stable core for long-running tasks** — Comet's Classic Spec mode combines OpenSpec and Superpowers into a five-phase flow with a state machine, phase checks, and scripts. It suits work that needs an explicit method and strong constraints; its permanent entry point is `/comet-classic`.
- **A configuration-driven shared entry point** — `/comet` reads only the project's `.comet/config.yaml` and deterministically forwards to `/comet-native` or `/comet-classic`. It does not guess from task size or mix changes, state, or directories across workflows. `comet resume-probe` uses the same configuration to resume through the correct permanent entry point.
- **Skill platform** — Comet can author reusable Skill packages and use `/comet-any` to organize them into distributable
  Bundles, so Skills you create can be distributed to coding platforms with one command, much like `comet init`.
- **Eval platform** — Comet assesses your skills using scientific Rubric, Pass@k, and Pass^k scoring, ensuring skill evolution is based on scientific evidence rather than intuition. It supports integration with LangSmith assessments, bringing evaluation to real-world enterprise production environments. Its dual-agent architecture automates the assessment process in your production environment.

## Supervisor Change: coordinated delivery across multiple agents

When a requirement contains multiple deliverables that can be implemented and verified independently, a Supervisor Change confirms the child changes and their dependencies before coordinating independent Codex sessions or Claude Code Agent Teams. The Runtime remains responsible for worktrees, task identity, verification, ordered integration, and the parent change's final Verify.

`Complex goal → child-change DAG → isolated worktrees → independent implementation and verification → ordered integration → final parent Verify`

**Codex multi-session execution**

https://github.com/user-attachments/assets/96114cb0-f542-4f58-aa27-256f32adc46e

**Claude Code Agent Teams execution**

https://github.com/user-attachments/assets/41428669-a49a-46e3-a0ae-0775e4f4bb6f

## Extremely low memory threshold

With Comet, you only need to remember two skills and one command, covering coding, creation, and evaluation with an extremely low barrier to entry：

- Use `/comet` to enter the project's configured Native or Classic workflow
- Use `/comet-any` to compose any Skills
- Use `comet eval` to evaluate any Skill

## Comet 0.4.0 Baseline Comparison

The following charts are from 16 Comet workflow tasks, with 5 samples per treatment, comparing no Comet, Comet 0.3.9, and Comet 0.4.0.

The core observations were the differences in Pass@5, Pass^5, and Rubric scores. The baseline without Comet Skills only validated business behavior.

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/comet-eval-pass5.png" alt="Comet pass@5 and pass^5 baseline comparison" width="920">
</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/comet-eval-rubric-core.png" alt="Comet core rubric and LLM-as-judge baseline comparison" width="920">
</p>

## From Industry-Frontier Practice

Many Comet capabilities have parallels in current industry practice. 

> To compare Comet with those patterns, see [Comet Docs](https://docs.comet.rpamis.com/zh/tech-blog/comet-vs-industry).

## What You Can Learn

- **How to reliably trigger nested Skills** — not by making an agent perform something that merely looks like a Skill
  trigger, such as writing files based on a Skill description, but by actually triggering the Skill. Comet invokes many
  OpenSpec and Superpowers capabilities, with trigger prompts refined through broad real-world practice.
- **How to make composed Skills advance through multiple phases automatically** — not through manual intervention. Aside
  from necessary user choices, Comet's five-phase flow can trigger core Skills automatically while the state machine keeps
  transitions reliable.
- **How to make a Spec lifecycle resumable** — Comet links OpenSpec change/spec artifacts with Superpowers design and
  plan documents, then records phase, execution mode, verification result, and archive status in each change's
  `.comet.yaml`, so an agent can continue after interruption instead of rereading documents and guessing progress.
- **How to turn doc synchronization from reminders into automation** — Comet scripts handoff, state updates, validation,
  and archive sync, reducing repeated prompts such as "remember to update the design doc" or "remember to archive the
  change."
- **How to design guard conditions that agents can execute** — phase exits do not rely on an agent saying "done." Scripts
  such as `comet-guard.mjs`, `comet-yaml-validate.mjs`, and `comet-state.mjs` check tasks, state fields, verification
  evidence, and archive conditions before the workflow advances.
- **How to distribute and install Skills across platforms** — Comet supports many AI coding platforms, project/global
  install scopes, Chinese/English Skill variants, and platform-specific directories such as Antigravity's different
  project/global paths.
- **How to turn scripts into agent workflow infrastructure** — Comet scripts handle hashes, YAML fields, state machines,
  and archive flow, showing how workflow control that is easy to scatter across prompts can become testable, reusable
  tooling.
- **How to evolve Skills through scientific evaluation** — Comet Eval supports structured rubric scoring plus Pass@k and
  Pass^k metrics, with both local and LangSmith evaluation paths for production use.
- **How to create Comet-like Skills intelligently** — `/comet-any` composes arbitrary Skills. You describe your Skill
  preferences, and the agent handles stability-related hooks, rules, scripts, and referenced Skill files for you.

## Install

Requirements:

- Node.js 22+
- npm/npx
- Git

```bash
npm install -g @rpamis/comet
```

## Quick Start

Initialize Comet in the project where you want to use it:

```bash
cd your-project
comet init
# Invoke /comet in the host
```

Interactive setup explains and offers Native, Classic, or both. Native is for strong models that can implement and verify autonomously; Classic is for tasks that need full Spec/TDD phase constraints; Both installs two independent entries while keeping `/comet` on Native by default. Non-interactive new projects default to Native, and project configuration is unified at `.comet/config.yaml`:

```bash
comet init --workflow classic
comet init --workflow both
```

### Project configuration

`comet init` generates `.comet/config.yaml` with field-level comments in the selected language. `comet update` fills new managed defaults while preserving user values and unknown extensions.

<details>
<summary>View the compact config shape when Native and Classic are both enabled</summary>

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
  language: en
  clarification_mode: batch
  archive_confirmation: automatic
  max_verify_failures: 5

classic:
  artifact_layout: docs
  language: en
  context_compression: off
  review_mode: standard
  auto_transition: true
```

- `default_workflow` selects the default `/comet` entry and must be present in `workflows`. `ambient_resume`, `memory`, `knowledge`, and `hook` are shared by both workflows.
- `memory.learning` / `retrieval` control personal-memory learning and injection. `knowledge.local.include` can append project-relative Markdown globs. `hook.allow_paths` is empty by default; add project-relative directories only when guarded phases must write shared files. It cannot bypass protection for `.comet` or workflow artifacts.
- Native stores user-readable artifacts under `docs/comet/` and machine Runtime under `.comet/runtime/native/`. Use `comet init --workflow native --root artifacts` for `artifacts/comet/`. Classic-only defaults stay under `classic:`; `comet init` / `comet update` migrate legacy top-level fields.

Cloud Knowledge and self-hosted PR providers remain advanced settings; see [Native configuration](https://docs.comet.rpamis.com/en/native/configuration) and [Classic configuration](https://docs.comet.rpamis.com/en/classic/configuration). Native v4 no longer persists the legacy `snapshot` budgets in user configuration.

</details>

## Support for OpenClaw and Hermes, and other AI platforms

For platforms that use the generic `skills` CLI directly, you can install the Comet skill package with:

```bash
npx skills add rpamis/comet
```

## Screenshots

### Classic Spec Skill

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/runner.png" alt="runner">
</p>

<p align="center">Auto-install OpenSpec & Superpowers, one-click dev environment setup</p>
<p align="center">Multi-phase Skill entry, auto-detects current Spec stage, auto-triggers core flow, manual review at key nodes</p>

### Integration with LangSmith/LangFuse

Comet Eval's automated dual-agent architecture can integrate online with LangSmith/LangFuse environments, making experiments traceable and skills evolvable.

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-dataset.png" alt="runner">
</p>
<p align="center">Manage your Skill baseline in LangSmith and view detailed performance metrics, latency, and token consumption</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-trace.png" alt="runner">
</p>
<p align="center">Trace your Claude Code in LangSmith</p>

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/langsmith-baseline-detail.png" alt="runner">
</p>
<p align="center">Trace custom Rubric metrics with Pytest in LangSmith</p>

## Supported Platforms

`comet init` supports 37 AI coding platforms:

<details>
<summary>View full platform list</summary>

| Platform           | Skills Dir    | Platform      | Skills Dir   |
| ------------------ | ------------- | ------------- | ------------ |
| Claude Code        | `.claude/`    | Cursor        | `.cursor/`   |
| Codex              | `.codex/`     | OpenCode      | `.opencode/` |
| Devin Desktop (formerly Windsurf) | `.devin/`     | Cline         | `.cline/`    |
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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) | [中文版](CONTRIBUTING-zh.md) for development setup, commit
conventions, PR process, branch workflow, and guidance for adding platforms,
skills, scripts, or changelog entries.

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

## Roadmap

Track our development progress and upcoming features on the [Comet Roadmap](https://github.com/orgs/rpamis/projects/1).

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=rpamis/comet&type=date&legend=top-left&sealed_token=UMxkYc2GrflG4LawVBIB1HY-k5O2WqatK4llgyINHBnPZRAl9PdOtca_ciCdXoKWpzzOF_K2YLyQ0CQ1Lx1tJjeO53J5mgRo9yK0DanAT_ClPsf4O2XxBQ)](https://www.star-history.com/?repos=rpamis%2Fcomet&type=date&legend=top-left)

## Contributors

<a href="https://github.com/rpamis/comet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=rpamis/comet&columns=12&anon=1" />
</a>

## License

[MIT](LICENSE)

## Community

<table align="center">
  <tr>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/douyin.png" width="120" height="120"><br>
      <b>DouYin (Recommended)</b>
    </td>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/wechat.png" width="120" height="120"><br>
      <b>WeChat</b>
    </td>
    <td align="center" width="180">
      <img src="https://github.com/rpamis/comet/blob/master/img/qq.jpg" width="120" height="120"><br>
      <b>QQ</b>
    </td>
  </tr>
</table>

## Reference

[LINUX DO - 新的理想型社区](https://linux.do/)
