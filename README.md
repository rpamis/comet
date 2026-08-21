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
> **0.4.0-beta.7** — A new **high-performance, native and recoverable** Native workflow has been added. Native and Classic work independently through unified configuration, status, Guard, Dashboard, and Eval entry points. Eval alignment of experiments (16 tasks × 48 runs, selecting 41 pairs of samples that both passed) shows that **total Token has decreased by 76.8%**, **Agent rounds have dropped by 57.4%**, **time consumption has shrunk by 47.4%**, **pass^3 reaches 87.5% (+12.5pp) and pass@3 is 100%**. For more details, please refer to [Native vs. 0.4.0 Classic Real Evaluation](https://docs.comet.rpamis.com/zh/eval/comet-native-vs-040-experiment).
> 
> **0.4.0-beta.1** — Upgrades Comet to a pure Node runtime without Bash/WSL and adds three core capabilities: compose **any** Skill through `/comet-any`, evaluate **any** Skill through `comet eval` with LangSmith integration, and visualize every change through `comet dashboard`.
>
> **0.3.9** — Review mode (`off|standard|thorough`) controls Build/Verify code review with project defaults; init/update now use optional dependency prompts, broader CLI i18n, stronger phase guards, and macOS executable bits.
>
> See the website [Changelog](https://docs.comet.rpamis.com/en/changelog) for details.

> Native and Classic are not lightweight and heavyweight tiers, and neither upgrades into the other. Native is for strong models that can plan and verify autonomously; Classic is for scenarios that benefit from a complete phased methodology and stronger constraints.

## Why Comet

- **Native workflow for strong models** — `/comet-native` uses a detailed brief, complete target specifications, phase checks, and recoverable archive to constrain outcomes while leaving planning, implementation, testing, and review methods to the model. It uses a configurable `comet/` artifact root and remains fully separate from Classic. See the [Native workflow guide](https://docs.comet.rpamis.com/en/native/quickstart).
- **The stable core for long-running tasks** — Comet's Classic Spec mode combines OpenSpec and Superpowers into a five-phase flow with a state machine, phase checks, and scripts. It suits work that needs an explicit method and strong constraints; its permanent entry point is `/comet-classic`.
- **A configuration-driven shared entry point** — `/comet` reads only the project's `.comet/config.yaml` and deterministically forwards to `/comet-native` or `/comet-classic`. It does not guess from task size or mix changes, state, or directories across workflows. `comet resume-probe` uses the same configuration to resume through the correct permanent entry point.
- **Skill platform** — Comet can author reusable Skill packages and use `/comet-any` to organize them into distributable
  Bundles, so Skills you create can be distributed to coding platforms with one command, much like `comet init`.
- **Eval platform** — Comet assesses your skills using scientific Rubric, Pass@k, and Pass^k scoring, ensuring skill evolution is based on scientific evidence rather than intuition. It supports integration with LangSmith assessments, bringing evaluation to real-world enterprise production environments. Its dual-agent architecture automates the assessment process in your production environment.

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

A single global initialization makes `/comet` available through the selected hosts in every project:

```bash
comet init --scope global
cd your-project
# Invoke /comet in the host
```

The first `/comet` invocation in an unconfigured project snapshots the defaults from `~/.comet/config.yaml` into the project's `.comet/config.yaml` and creates artifacts only inside that project. Later global-default changes do not rewrite activated projects. Hooks then recognize the project config and `.comet/current-change.json`; Hook events, `comet status`, and ordinary read-only resolution never initialize a project by themselves.

Run project initialization only when you want project-local copies of Skills, Rules, and Hooks, or explicit project overrides:

```bash
cd your-project
comet init
```

Interactive setup explains and offers Native, Classic, or both. Native is for strong models that can implement and verify autonomously; Classic is for tasks that need full Spec/TDD phase constraints; Both installs two independent entries while keeping `/comet` on Native by default. Non-interactive new projects default to Native, and project configuration is unified at `.comet/config.yaml`:

```bash
comet init --workflow classic
comet init --workflow both
```

Generated configuration comments follow the language selected during installation. Ambient Resume is a shared project setting for Native and Classic; disable the read-only probe with:

```yaml
# Enables the read-only Ambient Resume probe for both Native and Classic
ambient_resume: false
```

If an agent must write project-local shared rules or team notes during a non-coding phase, declare those directories in the same project configuration. Paths are project-relative; paths outside the project retain the existing scope behavior, and this setting cannot bypass `.comet` or workflow artifact directories:

```yaml
hook:
  allow_paths:
    - .agents/rules
    - docs/team-notes
```

Classic-specific defaults live under `classic:`. The next `comet init` or `comet update` migrates legacy top-level fields:

```yaml
classic:
  artifact_layout: docs
  language: en
  context_compression: off
  review_mode: standard
  auto_transition: true
```

Native stores user-readable artifacts under `docs/comet/` by default, while machine Runtime is fixed under the project-local `.comet/runtime/native/`. To use another project-relative artifact root, specify it explicitly; for example, this uses `artifacts/comet/`:

```bash
comet init --workflow native --root artifacts
```

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

## Commands

<details>
<summary><code>comet init [path]</code> — Initialize Comet workflow</summary>

Initializes Comet for selected AI coding platforms. Interactive setup selects Native, Classic, or both; new non-interactive projects default to self-contained Native, while projects with existing Classic state remain Classic. Pass `--platform` to initialize only that platform; unknown but valid platform ids are treated as project-scoped custom platforms installed under `.<platform>/` with the selected workflow's skills, scripts, rules, and hooks. The workflows keep independent entries, state, artifacts, and Guards. Each platform installs one `comet-workflow-guard` Rule, and platforms with Hook support install only `comet-hook-router.mjs`. The Router uses `.comet/current-change.json` to send each write to exactly one current Native or Classic Guard. Only Classic installs OpenSpec and Superpowers; Native depends on no external Skill.

| Option              | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `--yes`             | Non-interactive mode, auto-select detected platforms (or all if none detected) |
| `--scope <scope>`   | Install scope: `project` or `global`                                           |
| `--language <lang>` | Skill language: `en` or `zh` (skips interactive language prompt)               |
| `--platform <platform>` | Initialize only this platform; project scope accepts custom platform ids    |
| `--workflow <mode>` | Workflows to initialize: `native`, `classic`, or `both`                        |
| `--root <path>`     | Project-relative Native artifact root; global scope stores it as a project default |
| `--codegraph <action>` | Non-interactive project index action: explicitly choose `init` or `skip`    |
| `--skip-existing`   | Skip already installed components                                              |
| `--overwrite`       | Overwrite already installed components                                         |
| `--json`            | Output structured JSON                                                         |

When multiple existing components are found on the same platform, interactive init offers one bulk choice: overwrite
all, skip all, or choose per component.

</details>

<details>
<summary><code>comet status [path]</code> — Show active changes and next workflow command</summary>

Displays the configured default entry point and separate Native, Classic, and unmanaged OpenSpec sections. Native entries include phase, approval, verification, selection, and next-step data; Classic entries retain workflow, phase, runtime mode, current step, evidence, and recovery diagnostics.

| Option   | Description                                                               |
| -------- | ------------------------------------------------------------------------- |
| `--json` | Output active changes with `nextCommand`, `currentStep`, and runtime data |

</details>

<details>
<summary><code>comet resume-probe [path]</code> — Decide whether an active Comet workflow should resume</summary>

Read-only probe that resolves the configured default workflow and inspects only that side. It returns `auto_resume`, `ask_user`, `out_of_scope`, or `none`, and routes Native to `/comet-native` or Classic to `/comet-classic`. A malformed root configuration stops recovery instead of falling back or scanning the other workflow. `comet init/update` still merges a `<comet-ambient-resume>` managed block into `AGENTS.md` and `CLAUDE.md` while preserving user-authored rules.

</details>

<details>
<summary><code>comet dashboard [path]</code> — Launch local read-only dashboard server</summary>

Starts a local HTTP server that displays a visual dashboard with active changes, phase status, task progress, and archive history. Auto-opens in your browser by default.

<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/dashboard-light.png" alt="Comet Dashboard Light" width="800">
</p>
<p align="center">
  <img src="https://github.com/rpamis/comet/blob/master/img/dashboard-dark.png" alt="Comet Dashboard Dark" width="800">
</p>
<p align="center">Active change overview with phase indicators, task progress, and archive history</p>

| Option      | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `--port`    | Server port (default: auto-selects available port)                          |
| `--no-open` | Don't auto-open the dashboard in browser                                    |
| `--json`    | Collect single snapshot and print JSON to stdout (for scripting/inspection) |

</details>

<details>
<summary><code>comet doctor [path]</code> — Diagnose Comet installation health</summary>

Checks project/global installation health, working directories, installed skills, scripts, CodeGraph indexes, and active change
diagnostics. `comet doctor` reports diagnostic status for malformed `.comet.yaml` files, current step / runtime mode
for valid changes, and runtime evidence gaps that block safe resume. In a Git secondary worktree, it separately reports
the current worktree, primary worktree, and global fallback installation state. Ignored assets in the primary worktree
are inspected only for classification and are never executed across worktrees.

| Option            | Description                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `--json`          | Output structured diagnostics, including CodeGraph state and the effective runtime source    |
| `--scope <scope>` | Diagnose `auto`, `project`, or `global` scope (default: `auto`)                               |
| `--repair`        | Repair deterministic managed-install and state problems                                       |
| `--yes`           | Use with `--repair` to authorize potentially expensive CodeGraph initialization, rebuild, or sync |

</details>

<details>
<summary><code>comet update [path]</code> — Update Comet package and skills</summary>

Refreshes installed Comet skills in detected project/global targets. Pass `--platform` to refresh only that platform, including project-scoped custom platforms. A current-project refresh does not mutate any npm installation, whether global or project-local, by default; pass `--self-update` explicitly when the CLI should be upgraded too. Explicit `--scope global` deterministically uses the current-project asset scope, never opens the all-projects selector, and still does not update the npm package implicitly. Self-update compares full semver values, including prereleases, refuses downgrades, and validates the candidate package's version, Workflow command, and Native command in isolation before installation. A failed install attempts to restore the exact installed version.

| Option               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `--json`             | Output npm and skill update results as JSON      |
| `--language <lang>`  | Override detected skill language (`en`, `zh`)    |
| `--platform <platform>` | Refresh only this platform; project scope accepts custom platform ids |
| `--scope <scope>`    | Update only the `global` or `project` install scope |
| `--current-project`  | Refresh only the current project                 |
| `--all-projects`     | Refresh all registered project installations     |
| `--self-update`      | Explicitly update the Comet npm package first    |
| `--skip-self-update` | Explicitly skip Comet npm package self-update    |

</details>

<details>
<summary><code>comet uninstall [path]</code> — Remove Comet skills, rules, and hooks</summary>

Safely removes Comet-distributed skills, rules, and hooks from all detected platforms. Preserves user-defined hooks and non-Comet configuration.

| Option            | Description                                |
| ----------------- | ------------------------------------------ |
| `--force`         | Skip confirmation prompt                   |
| `--scope <scope>` | Uninstall only `global` or `project` scope |
| `--json`          | Output removal results as JSON             |

```bash
comet uninstall              # Interactive — shows targets, asks for confirmation
comet uninstall --force      # Non-interactive — removes everything immediately
comet uninstall --scope project  # Only remove project-level installations
```

</details>

<details>
<summary><code>comet eval [target]</code> — Evaluate Skills through the shared eval harness</summary>

`comet eval` answers a simple question: does this Skill actually work reliably on standard tasks?

The primary path is evaluating a local Skill that you already own. You do not need to run
`/comet-any` first or create `comet/eval.yaml`:

```bash
comet eval ./my-skill --collect
comet eval ./my-skill --html
comet eval ./my-skill --quick --html
```

`--collect` performs static discovery and configuration checks without starting an Agent, Docker, plugins,
credential checks, or network requests. A normal run generates and caches 2–4 tasks when the Skill has no
`comet/eval.yaml`; `--quick` uses the fixed `generic-skill-smoke` task. The report path is printed by the command
and is written under `.comet/eval/runs/<experiment-id>/` in the Skill or the project passed with `--project`.

If the Skill contains `comet/eval.yaml`, passing its directory discovers it automatically. You can also pass a
manifest or `SKILL.md` directly:

```bash
comet eval ./my-skill/comet/eval.yaml --collect
comet eval ./my-skill/SKILL.md --html
```

Configure the main Agent, model, and API URL directly. LLM-as-Judge has an independent Agent, model, API URL, and
credential boundary:

```yaml
execution:
  agent: codex
  model: subject-model
  baseUrl: https://subject.example/v1
judge:
  agent: claude-code
  model: judge-model
  baseUrl: https://judge.example/v1
```

`/comet-any` may still produce a compatible manifest, but it is an optional Skill producer, never a prerequisite
for `comet eval`.

### Reading Local Eval

Local eval is the normal path for day-to-day development and pre-release checks. In the HTML report, look first at:

- whether pass/fail and rubric scores match expectations
- whether failures are attributed to the Skill, workflow, task, model, or environment/harness
- whether expected artifacts are missing
- whether token use, cost, or duration look unusual
- whether the result is clean enough, or a specific task/treatment should be rerun

If the report says `Insufficient clean data` or `Inconclusive due to data quality`, check auth, rate limits,
Docker/container setup, network, and other environment issues before treating the run as a Skill-quality verdict.

### LangSmith Eval

Use the LangSmith suite when you want to sync eval results to LangSmith, or when your team wants to inspect runs, rubric
feedback, costs, and Claude Code trajectories together. It reuses the same tasks, treatments, rubric, and
`comet/eval.yaml`; the difference is that results are uploaded to LangSmith.

Prepare dependencies and environment variables once:

```bash
cd eval
uv sync --extra langsmith
```

```bash
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=comet-skill-eval
LANGSMITH_TRACING=true
```

Then select the LangSmith suite through the same `comet eval` entry point:

```bash
comet eval ./my-skill --suite langsmith --html
```

`--suite` defaults to `local`. With `langsmith`, the CLI starts the LangSmith runner, prints `Suite: langsmith` in its
launch details, and writes reports under the project's `.comet/eval/runs/`. In PowerShell, set
`$env:LANGSMITH_API_KEY`, `$env:LANGSMITH_PROJECT`, and `$env:LANGSMITH_TRACING`, or place them in `eval/.env`. See
[eval/langsmith/README.md](eval/langsmith/README.md) for plugin cache and trajectory tracing details.

### Which Path To Use

- Local Skill: run `comet eval ./my-skill --collect`, then `comet eval ./my-skill --html`
- Low-cost smoke: `comet eval ./my-skill --quick --html`
- `/comet-any` output: pass its directory for automatic manifest discovery, or pass `comet/eval.yaml` directly
- Team tracing and side-by-side comparison: `comet eval ./my-skill --suite langsmith --html`

For full task, treatment, report, and troubleshooting details, see the [Eval usage guide](docs/operations/EVAL-USAGE.md).

</details>

<details>
<summary><code>/comet-any</code> / <code>comet creator</code> / <code>comet publish</code> — Create, evaluate, and publish Skills</summary>

`/comet-any` is an optional Skill creation and composition path: Create or optimize a reusable Skill → validate it with `comet eval` → review and
distribute it, until it becomes a stable composed Skill. For resume and release, use `comet creator`,
`comet creator status` / `comet creator next`, `comet publish`, and `comet publish distribute --preview`. The README
does not expand the backend command list; see the [Skill creation guide](docs/operations/SKILL-CREATION.md) for Advanced Bundle backend and Advanced Engine Run details, including `comet skill run` / `comet skill continue`.

</details>

<details>
<summary><code>comet --help</code> / <code>comet --version</code> — Basic information</summary>

| Command           | Description  |
| ----------------- | ------------ |
| `comet --help`    | Show help    |
| `comet --version` | Show version |

</details>

## Supported Platforms

`comet init` supports 35 AI coding platforms:

<details>
<summary>View full platform list</summary>

| Platform           | Skills Dir    | Platform      | Skills Dir   |
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

## Skills

`comet init` installs skills for the selected workflow. Native depends only on Comet-owned skills; Classic additionally installs OpenSpec and Superpowers.

### Comet Skills

<details>
<summary>View Comet skills</summary>

| Skill            | Description                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `/comet`         | Shared entry — routes to the configured Native or Classic workflow from `.comet/config.yaml` |
| `/comet-native`  | Permanent Native entry — self-contained, recoverable Shape, Build, Verify, and Archive       |
| `/comet-classic` | Permanent Classic entry — the five-phase OpenSpec + Superpowers workflow                     |
| `/comet-review`  | Read-only manual review of the current Native or Classic change without advancing its phase  |
| `/comet-open`    | Classic phase 1: Open a change (proposal, design, task breakdown)                            |
| `/comet-design`  | Classic phase 2: Deep design (brainstorming, Design Doc)                                     |
| `/comet-build`   | Classic phase 3: Plan and build (implementation plan, code commits)                          |
| `/comet-verify`  | Classic phase 4: Verify and finish (testing, verification report)                            |
| `/comet-archive` | Classic phase 5: Archive (delta spec sync, status annotation)                                |
| `/comet-hotfix`  | Classic preset: Quick bug fix                                                                 |
| `/comet-tweak`   | Classic preset: OpenSpec-chained medium change                                                |
| `/comet-any`     | Comet Skill Creator — Create or optimize a reusable Skill                                    |

</details>

### Guard & Automation Scripts

<details>
<summary>View script list</summary>

| Script                    | Purpose                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `comet-env.mjs`           | Script discovery helper — prints the bundled scripts directory so skills can resolve sibling command paths |
| `comet-guard.mjs`         | Phase transition guard — validates exit conditions, `--apply` auto-updates `.comet.yaml`                   |
| `comet-handoff.mjs`       | Design handoff — generates deterministic context packages from OpenSpec artifacts with SHA256 tracing      |
| `comet-archive.mjs`       | One-command archive — validates state, syncs specs, moves to archive, updates status                       |
| `comet-yaml-validate.mjs` | Schema validator — validates `.comet.yaml` structure and field values                                      |
| `comet-state.mjs`         | Unified state management — init/set/get/check/scale, agents' exclusive YAML interface                      |
| `comet-hook-router.mjs`   | The platform's only Hook entry — routes by current ownership to one workflow Guard                         |
| `comet-hook-guard.mjs`    | Classic Guard launcher — calls Classic runtime when selected by the Router                                  |
| `comet-native-runtime.mjs` | Native state, checks, archive, and recovery runtime                                                      |
| `comet-native-hook-guard.mjs` | Native Guard launcher — calls Native runtime when selected by the Router                               |

Both Native and Classic runtimes are generated from TypeScript and run through `node` on every platform. Native does
not depend on OpenSpec, Superpowers, Bash, Git Bash, or WSL.

</details>

## Workflow

### Native Workflow

`/comet-native` uses Shape → Build → Verify → Archive. Shape owns clarification, the brief, complete target specs, and
user approval; the agent chooses its own planning and implementation methods. User-readable state, specifications, and
verification material live under `docs/comet/` by default; machine Runtime, locks, transactions, and recovery data live
under the project-local `.comet/runtime/native/`.

<details>
<summary>View the Native phase flow</summary>

```text
/comet-native (or /comet when default_workflow: native)
  Shape  ──confirm requirements──>  Build  ──Builder handoff──>  Verify  ──pass──>  Archive
                                      ^                              │
                                      └────────── fail ──────────────┘
```

| Phase   | Main work                                                                             | Required result                                                         |
| ------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Shape   | Inspect the environment, clarify in rounds, and write the brief plus complete target specs | No blocking questions; the user confirms the current outcome             |
| Build   | The agent plans, implements, self-tests, and submits a concise Builder handoff           | Every acceptance item is addressed; ordinary source writes occur in Build |
| Verify  | Runtime runs necessary checks and dispatches a fresh read-only Verifier                  | Pass advances to Archive; failure returns to Build with specific gaps     |
| Archive | Sync complete target specs and move the change without rerunning Build or Verify checks  | The recoverable archive transaction commits                              |

Shape supports `clarification_mode: sequential` and `clarification_mode: batch`. Sequential asks one upstream question per round; Batch asks every currently answerable question whose prerequisites are settled and is the default for new projects. In both modes, the agent investigates discoverable facts and writes user decisions back into the brief and complete target specs.

</details>

<details>
<summary>View Native state and artifacts</summary>

| File or directory                               | Purpose                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `.comet/config.yaml`                            | Select workflows, artifact root, language, clarification mode, and project-local Hook write allow paths |
| `.comet/current-change.json`                    | Shared Native/Classic ownership; each write routes to one workflow              |
| `docs/comet/changes/<name>/comet-state.yaml`    | Portable phase, Loop, acceptance results, blockers, and next action              |
| `docs/comet/changes/<name>/brief.md`            | Outcome, scope, non-goals, examples, constraints, decisions, and open questions  |
| `docs/comet/changes/<name>/specs/`              | Complete target behavior for each capability after archive                      |
| `docs/comet/changes/<name>/verification.md`     | Human-readable Runtime checks, acceptance results, risks, and conclusion         |
| `.comet/runtime/native/changes/<name>/`         | Local `state.json` execution overlay and on-demand logs; rebuildable from portable state |
| `.comet/runtime/native/locks/` / `transactions/` | Project-local locks and recoverable transactions                                |
| `docs/comet/specs/` / `archive/`               | Applied specs, archived changes, and user-readable verification material        |

Native can keep multiple active changes at the same time. `comet status` lists the candidates, while `.comet/current-change.json` selects ownership for the current request; it does not limit the project to one change. Missing, stale, or ambiguous selection stops resume and writes for an explicit choice instead of guessing another change or switching to Classic.

Runtime owns `comet-state.yaml` and machine state under `.comet/runtime/native/`. Requirement edits return the change to Shape; implementation edits return it to Build before a fresh Verifier reviews the candidate. Do not hand-edit state to skip a phase.

Repositories that require their own PR template or validation script can opt into a Native repository-command provider in `.comet/config.yaml`:

```yaml
native:
  finish:
    pull_request:
      provider: repository-command
      command: [pwsh, -NoProfile, -File, scripts/comet-create-pr.ps1]
      timeout_ms: 120000
```

After a `pull-request` Archive finish is selected, Comet still owns commit, push, existing-PR observation, base/head/head-SHA verification, idempotent recovery, and safe cleanup. The repository command owns only title/body/template policy and repository-specific remote validation. Its executable must be either a bare name resolved through PATH or a project-relative path. It runs from the project root, receives `comet.native.pull-request-finish-input.v1` JSON on stdin, and must return `comet.native.pull-request-finish-result.v1` JSON on stdout. GitHub CLI (`gh`) must still be installed and authenticated because Comet independently verifies remote state with `gh pr list` and `gh pr view`. Projects without this configuration keep the compatible `gh pr create --fill` behavior.

</details>

<details>
<summary>View Native reliability and recovery</summary>

1. **Clarification blocking** — Shape persists unresolved implementation decisions as blocking questions. Batch mode also requires explicit shared-understanding confirmation before Build.
2. **Builders cannot self-verify** — Build submits an implementation handoff. Runtime runs necessary checks and gives the brief, target specs, acceptance items, and results to a fresh read-only Verifier.
3. **Complete acceptance review** — The Verifier must return passed, failed, or blocked with a reason for every item. Missing, duplicate, and unknown items cannot pass.
4. **Bounded repair Loop** — Failure returns to Build. Repeated execution errors or no-progress results stop and return control to the user instead of looping indefinitely.
5. **Lightweight recovery** — `comet-state.yaml` keeps the stable phase, Loop, and next action. Interrupted local work reruns only necessary checks, not Shape, Build, or an already completed matching check.
6. **Protected state and transactions** — Runtime uses atomic state writes and short locks. Archive uses a recoverable transaction and does not rerun verification on the normal path.
7. **Unified guards without merged workflows** — Each platform installs one Rule and one Hook Router. The Router invokes Native Guard from current ownership; Native permits ordinary implementation writes only in Build and keeps its phases, schema, directories, and Guard independent from Classic.

</details>

### Classic Five-Phase Workflow

<details>
<summary>View the Classic five-phase flow</summary>

```
/comet-classic (or /comet when default_workflow: classic)
  ↓
/comet-open  -->  /comet-design  -->  /comet-build  -->  /comet-verify  -->  /comet-archive
(OpenSpec)         (Superpowers)       (Superpowers)       (Both)           (OpenSpec)

/comet-hotfix (preset path, skips brainstorming)
  open  -->  build  -->  verify  -->  archive

/comet-tweak (lightweight preset, chains OpenSpec)
  open  -->  build  -->  verify  -->  archive
```

#### Five Phases

| Phase              | Command          | Owner       | Artifacts                            |
| ------------------ | ---------------- | ----------- | ------------------------------------ |
| 1. Open            | `/comet-open`    | OpenSpec    | proposal.md, design.md, tasks.md     |
| 2. Deep Design     | `/comet-design`  | Superpowers | Design Doc, delta spec               |
| 3. Plan & Build    | `/comet-build`   | Superpowers | Implementation plan, code commits    |
| 4. Verify & Finish | `/comet-verify`  | Both        | Verification report, branch handling |
| 5. Archive         | `/comet-archive` | OpenSpec    | delta→main spec sync, archive        |

</details>

### Classic State Management

Classic uses a decoupled state architecture with separate files:

<details>
<summary>View Classic state management</summary>

| File                                      | Owner    | Purpose                                             |
| ----------------------------------------- | -------- | --------------------------------------------------- |
| `.openspec.yaml`                          | OpenSpec | Spec lifecycle, change metadata                     |
| `<classic-change-dir>/.comet.yaml`        | Comet    | Workflow phase, execution mode, verification status |
| `.comet/run-state.json`                   | Engine   | Run identity and execution state (machine-owned)    |
| `.comet/state-events.jsonl`               | Comet    | Append-only state transition audit log              |

Each change-level `.comet.yaml` stores Classic workflow state and only keeps `run_id` as the link to the Engine Run.
`<classic-change-dir>` is resolved from the project's `classic.artifact_layout`; use `comet classic root show` to inspect the current OpenSpec root.
Machine-owned Engine state lives in the change's `.comet/run-state.json` with camelCase fields such as `currentStep`,
`status`, and `iteration`. Legacy Run fields left in YAML are migrated after compatibility reads, and `skill` is no
longer a valid current `.comet.yaml` field. Project defaults live in `.comet/config.yaml`.

Phase progression is handled consistently by the TypeScript transition table, `comet-state transition`,
`comet-guard --apply`, and archive commands. Each successful progression appends an audit event to
`.comet/state-events.jsonl` with the source, before/after state, and actual field changes.

This keeps Skill text focused on guiding the agent while scripts own state writes, phase checks, auditability, and
breakpoint recovery. Agents can use Comet commands to know which phase the current Spec is in.

</details>

<details>
<summary>View key Classic change .comet.yaml fields</summary>

**Key Fields in change `.comet.yaml`:**

```yaml
workflow: full                                           # Workflow type: full | tweak | hotfix
phase: build                                             # Current phase: open | design | build | verify | archive
context_compression: off                                 # Context compression: off | beta
auto_transition: true                                    # Auto-invoke the next Skill after phase completion
base_ref: <git-sha-or-null>                              # Baseline commit captured at init; may be null
created_at: YYYY-MM-DD                                   # Creation date written by comet-state.mjs init
run_id: <uuid>                                           # Links to .comet/run-state.json only; Run details stay out of YAML
review_mode: standard                                    # Automatic review strength: off | standard | thorough
build_mode: subagent-driven-development                  # Build mode: subagent-driven-development | executing-plans | direct
build_pause: null                                        # `build_pause` records an internal build-phase pause point: null none, `plan-ready` means the plan has been generated
subagent_dispatch: null                                  # Dispatch confirmation; confirm before verify
tdd_mode: null                                           # Full-workflow build choice: tdd | direct
isolation: branch                                        # Isolation mode: current | branch | worktree
bound_branch: null                                       # Git branch bound by current/branch/worktree isolation; branch drift blocks progress
verify_mode: null                                        # Verification mode: light | full
design_doc: docs/superpowers/specs/<design-doc>.md       # Design doc path
plan: docs/superpowers/plans/YYYY-MM-DD-feature.md       # Implementation plan path
verify_result: pending                                   # Verification result: pending | pass | fail
verification_report: null                                # Verification report path; must exist before verify-pass
branch_status: pending                                   # Branch handling status: pending | handled
verified_at: null                                        # Verification timestamp; null before verification passes
archived: false                                          # Archived changes are blocked from further mutation
direct_override: null                                    # Must be true when a full workflow chooses direct build
handoff_context: null                                    # Design handoff context path written by comet-handoff.mjs
handoff_hash: null                                       # SHA256 for handoff_context; 64 hex chars when present
classic_profile: full                                    # Machine-maintained Classic profile
classic_migration: 1                                     # Machine-maintained migration version
```

Current change `.comet.yaml` no longer contains `skill`; legacy Run fields in YAML are migrated to `.comet/run-state.json`.

</details>

### Classic Reliability and Shared Guards

The first six items below describe Classic phase automation; the final item covers the Router/Rule boundary shared by
Native and Classic:

<details>
<summary>View Classic reliability and shared guards</summary>

1. **Entry Verification** — Each phase validates preconditions before execution
   - Checks file existence, state consistency, and phase transitions
   - Outputs `[HARD STOP]` with actionable suggestions if validation fails

2. **Automated State Transitions** — `comet-guard.mjs --apply` updates `.comet.yaml` automatically
   - All phase transitions (open → design/build → verify → archive) use `guard --apply`
   - No manual state editing required — eliminates write-verification errors
   - `comet-state.mjs` is the agents' exclusive interface for state operations
   - Guard and archive scripts use `comet-state.mjs` internally for state management

3. **Schema Validation** — `comet-yaml-validate.mjs` ensures data integrity
   - Validates required and optional fields
   - Validates enum values, including `direct_override`
   - Validates `design_doc`, `plan`, and `handoff_context` paths exist, plus `handoff_hash` format
   - Detects unknown/typos fields

4. **Build Decision Enforcement** — Guard and state transitions both block skipped build choices
   - `isolation` must be `current`, `branch`, or `worktree`
   - `isolation: current`, `branch`, and `worktree` bind the current Git branch, and later entry checks block accidental branch drift
   - `build_mode` must be selected before leaving build
   - `build_pause: plan-ready` is a recoverable pause after plan generation, not a `build_mode`
   - Full workflow `build_mode: direct` requires `direct_override: true`

5. **Verification Evidence** — Guard enforces proof before phase advance
   - `verify-pass` transition requires `verification_report` pointing to an existing report file
   - `branch_status` must be `handled` before verify can pass
   - Guard checks `verification_report exists` and `branch_status=handled` as hard prerequisites
   - Prevents false phase advances when verification or branch handling was skipped

6. **Archive Automation** — `comet-archive.mjs` handles the full archive flow in one command
   - Validates entry state, merges delta specs into main specs through OpenSpec
   - Annotates design doc and plan frontmatter
   - Moves change to archive directory and updates `archived: true`
   - Supports `--dry-run` for preview

7. **Anti-drift Phase Guards** — Phase awareness for long-context sessions
   - Rule layer: each platform installs one `comet-workflow-guard`, resolves enabled, default, and current ownership
     from `.comet/current-change.json`, and applies only one phase model
   - Hook layer: platforms with Hook support install only `comet-hook-router.mjs`; one write reaches at most one Guard,
     and ambiguous or stale selection fails closed
   - Guard layer: Native and Classic keep independent phases and allowed paths. Native permits ordinary implementation
     writes only in Build; Classic permits them in Build and Verify

</details>

## Project Structure

<details>
<summary>Native project structure (default <code>docs/comet/</code>)</summary>

```text
your-project/
├── .comet/
│   ├── config.yaml                    # Shared config and Native artifact_root
│   ├── current-change.json            # Optional current ownership shared by Native and Classic
│   └── runtime/native/                # Git-ignored Native machine Runtime
│       ├── changes/<name>/            # Local state.json and on-demand logs
│       ├── locks/                     # Project-local locks
│       └── transactions/              # Recoverable transactions
├── .claude/skills/                    # Claude Code shown as the platform example
│   ├── comet/SKILL.md                 # Configuration-driven shared entry
│   └── comet-native/
│       ├── SKILL.md                   # Permanent Native entry
│       ├── reference/                 # Artifact, command, and recovery contracts
│       └── scripts/                   # Native runtime and Guard launcher
└── docs/comet/                        # native.artifact_root: docs
    ├── specs/<capability>/spec.md     # Archived canonical specs
    ├── changes/<name>/
    │   ├── comet-state.yaml           # Native change state
    │   ├── brief.md                   # Outcome, scope, decisions, and acceptance
    │   ├── specs/<capability>/spec.md # Complete target specification
    │   ├── verification.md            # Verification report
    └── archive/YYYY-MM-DD-<name>/     # Archived changes
```

</details>

<details>
<summary>Classic project structure</summary>

```
your-project/
├── .comet/
│   └── config.yaml              # Shared project config (workflows, Ambient Resume, language, Classic defaults)
├── .claude/skills/              # Platform skills dir (Comet + OpenSpec + Superpowers)
│   ├── comet/SKILL.md
│   │   └── scripts/
│   │       ├── comet-guard.mjs       # Phase transition guard (--apply auto-updates state)
│   │       ├── comet-env.mjs         # Script discovery helper
│   │       ├── comet-handoff.mjs     # Design handoff (OpenSpec → Superpowers context tracing)
│   │       ├── comet-archive.mjs     # One-command archive automation
│   │       ├── comet-yaml-validate.mjs # Schema validator
│   │       ├── comet-hook-router.mjs  # The platform's only Hook entry (routes the current workflow Guard)
│   │       ├── comet-hook-guard.mjs   # Classic Guard (not installed as a separate platform Hook)
│   │       └── comet-state.mjs       # Unified state management (init/set/get/check/scale)
│   ├── comet-*/SKILL.md
│   ├── openspec-*/SKILL.md
│   └── brainstorming/SKILL.md
└── docs/
    ├── openspec/                    # OpenSpec — WHAT (classic.artifact_layout: docs)
    │   ├── config.yaml
    │   ├── specs/<capability>/spec.md # Main specs after archive
    │   └── changes/
    │       ├── archive/YYYY-MM-DD-<name>/ # Archived changes
    │       └── <name>/
    │           ├── .openspec.yaml       # OpenSpec state
    │           ├── .comet.yaml          # Comet workflow state (Classic fields + run_id link)
    │           ├── .comet/
    │           │   ├── run-state.json   # Engine Run state (machine-owned, auto-migrated)
    │           │   └── state-events.jsonl # State transition audit log (append-only)
    │           ├── proposal.md
    │           ├── design.md
    │           ├── specs/<capability>/spec.md
    │           └── tasks.md
    └── superpowers/                 # Superpowers — HOW
        ├── specs/                   # Design documents
        ├── plans/                   # Implementation plans
        └── reports/                 # Verification reports
```

New Classic and dual-workflow projects default to `classic.artifact_layout: docs`. Projects that retain the legacy layout keep the OpenSpec root at repository-level `openspec/`, while Superpowers artifacts remain under `docs/superpowers/`. Use `comet classic root show` to inspect the current layout. To migrate, run `comet classic root move docs --dry-run` first and then apply the returned plan with `--apply`; do not edit the configuration field by itself.

</details>

<details>
<summary>Classic Context Compression (Beta)</summary>

Comet supports context compression at the Design → Build handoff. When enabled, `comet-handoff.mjs` generates a compact
context package that reduces Build-phase input tokens by **25–30%** without affecting implementation correctness.

| Mode   | Behavior                                 | Token Savings |
| ------ | ---------------------------------------- | ------------- |
| `off`  | Full Spec excerpts in handoff context    | Baseline      |
| `beta` | Design Doc + SHA256 hash references only | ~25–30%       |

Key findings from benchmark testing:

- **Test pass rate**: 100% across all tiers (compression does not affect correctness)
- **Spec coverage**: 100% (off) vs 95% (beta) — minor edge-case detail loss
- **Scaling**: Larger tasks yield higher absolute savings (up to 15,000 tokens for large-tier tasks)

Enable `context_compression: beta` under the `classic:` block in `.comet/config.yaml`.

See [CONTEXT-COMPRESSION.md](docs/CONTEXT-COMPRESSION.md) for the full benchmark report, compression principles, and
reproduction steps.

</details>

<details>
<summary>Classic Auto Transition</summary>

`auto_transition` controls whether Comet automatically invokes the next skill after a phase completes, or pauses for
manual handoff. Phase advancement itself always happens — this setting only affects skill invocation.

| Value   | Behavior                                                      |
| ------- | ------------------------------------------------------------- |
| `true`  | Auto-invoke the next skill after each phase (default)         |
| `false` | Pause after each phase; user manually triggers the next skill |

Three-layer configuration with precedence: `COMET_AUTO_TRANSITION` env var > `classic.auto_transition` in
`.comet/config.yaml` (project) > change `.comet.yaml`.

See [AUTO-TRANSITION.md](docs/AUTO-TRANSITION.md) for configuration details, workflow mapping, and FAQ.

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
