# Native rc1 与 beta16 对比评测实施计划

> **For agentic workers:** This plan is executed inline in the current session. It produces a website article and a static report; no production runtime behavior is changed.

**Goal:** 使用相同的 16 个 canonical Comet 任务和每任务 3 次运行，重新评测 `0.4.0-rc.1` Native 与 `0.4.0-beta.16` Native，并发布中英文对比文章与同版式 HTML 报告。

**Architecture:** rc1 在当前 checkout 运行，beta16 在从 tag 创建的临时只读评测 checkout 运行；每侧使用自身 Native Skill、Runtime 和 validator。一个离线汇总步骤按 task/repetition 合并两侧结果，生成网站文章和单一 JSON/HTML 报告资源。

**Tech Stack:** Python `uv` 本地评测套件、pytest-xdist、Docker、当前仓库的 report parser、Mintlify MDX、静态 HTML/CSS。

## Global Constraints

- 运行范围固定为 16 个 canonical Comet 任务，每任务 3 次；两侧各 48 次，总计 96 次。
- beta16 必须来自 Git tag `0.4.0-beta.16`，rc1 必须来自当前 `040rc1` checkout。
- workflow validator 遵循版本真实契约；跨版本统计不得伪装成完全受控的同协议实验。
- 中文文章先完成，英文文章与 HTML 必须和中文使用同一批统计。
- 只暂存本次评测文章、报告资源、导航和必要的内部计划；保留既有 `.comet/config.yaml`、website 子模块现场和 `.tmp-supervisor-codex-e2e/`。

---

### Task 1: 准备两个版本的评测上下文

**Files:**
- Read: `eval/local/README.md`
- Read: `eval/local/treatments/comet/comet_native_phase1.yaml`
- Read: `eval/local/tasks/index.yaml`
- Create outside Git: temporary beta16 checkout and experiment output directories

**Interfaces:**
- Consumes: current `040rc1` checkout and tag `0.4.0-beta.16`.
- Produces: two clean, version-labelled eval roots and the exact 16-task selection.

- [ ] 确认当前 `package.json` 为 `0.4.0-rc.1`，确认 `0.4.0-beta.16` tag 指向 `07c5b64b`，并保存两侧 commit SHA。
- [ ] 从 beta16 tag 建立临时评测 checkout，不修改当前工作区及其已有未提交文件。
- [ ] 对两侧运行 collection-only/最小 smoke，确认 16 个任务 × 3 次参数矩阵，未把 Native 专属 wave、generic 或 Classic layout 任务混入。

### Task 2: 运行 rc1 与 beta16 基线

**Files:**
- Read: `eval/local/tests/tasks/test_tasks.py`
- Read: `eval/scaffold/python/native_eval.py`
- Read: `eval/scaffold/python/validation/native_workflow.py`
- Output outside Git: `eval/local/logs/experiments/<rc1-experiment>/`
- Output outside Git: beta16 checkout `eval/local/logs/experiments/<beta16-experiment>/`

**Interfaces:**
- Consumes: Task 1 的两个 eval roots、相同模型/agent/interaction 配置和 16-task matrix。
- Produces: 两个各含 48 次 raw run、expected matrix、per-run report、events 和 metadata 的实验目录。

- [ ] 在 rc1 root 运行 `test_tasks.py::test_task_treatment --treatment=COMET_NATIVE_PHASE1 --count=3 -n 4`，用明确的 canonical task 过滤器，记录完整实验 ID、模型、agent、运行日期和退出状态。
- [ ] 在 beta16 root 使用相同 task matrix、重复次数、模型/agent/interaction 参数和对应 `COMET_NATIVE_PHASE1` treatment 运行 48 次，并单独记录其旧 Native validator 身份。
- [ ] 对两侧检查 48 个期望样本的覆盖、原始 `result` duration、token/cost telemetry、最终业务/workflow 状态和失败原因；任何缺失样本都保留为 coverage 缺口。

### Task 3: 生成统一统计与 HTML 报告

**Files:**
- Read: `website/zh/eval/comet-native-vs-040-experiment.mdx`
- Read: `website/en/eval/comet-native-vs-040-experiment.mdx`
- Read: `website/assets/eval-reports/comet-native-vs-040-20260716/native-benchmark-report.json`
- Create: `website/assets/eval-reports/comet-native-vs-rc1-beta16-20260827/native-benchmark-report.json`
- Create: `website/assets/eval-reports/comet-native-vs-rc1-beta16-20260827/native-benchmark-report.html`
- Create: `website/assets/eval-reports/comet-native-vs-rc1-beta16-20260827/native-benchmark-report-en.html`
- Create: `website/zh/eval/comet-native-vs-rc1-beta16-experiment.mdx`
- Create: `website/en/eval/comet-native-vs-rc1-beta16-experiment.mdx`
- Modify: `website/docs.json`

**Interfaces:**
- Consumes: Task 2 的原始 experiment directories。
- Produces: 一份包含中英文 HTML 的 JSON，以及双语 MDX 页面和导航入口。

- [ ] 用离线汇总逻辑按 `task + repetition` 对齐样本，计算 strict pass@1、pass@3、pass^3、业务验证通过、模型启动/恢复、Agent 轮次、工具调用、累计耗时、token、成本和数据质量。
- [ ] 复制历史文章的结构和响应式视觉语言，替换所有数字、版本、日期、experiment ID、协议差异、任务矩阵和失败归因；不复制旧结论。
- [ ] 中文 MDX 先写完并核对数字，再生成英文 MDX 和双语 HTML；HTML 使用同一 JSON 资源并提供语言切换。
- [ ] 在中英文 `docs.json` 的 eval 导航中加入新 slug，位置靠近既有 Native/Classic 评测页面。

### Task 4: 验证、审阅与交付

**Files:**
- Test: `test/repository/*runtime-assets.test.ts` or the most specific website/report contract tests available
- Verify: all files under the new report asset directory and both MDX files

**Interfaces:**
- Consumes: Task 3 网站产物。
- Produces: 可提交的 website commit 和父仓库 gitlink commit。

- [ ] 检查 JSON 可解析、HTML 中英文 root/语言按钮/核心指标/矩阵数量一致，MDX 中没有旧文章的版本或实验 ID 残留。
- [ ] 对新增/修改的 MDX、JSON/HTML 相关源文件运行 Prettier；运行网站文档契约、`git diff --check` 和必要的 Mintlify validate。
- [ ] 复核父仓库和 website 子仓库 status/diff，只暂存本次文件，不带入 `.comet/config.yaml`、`.tmp-supervisor-codex-e2e/` 或其他已有改动。
- [ ] 在提交前请求一次只读代码/内容审阅，修正 Critical/Important 问题后再验证。
- [ ] 在 website `rc1` 分支提交 `docs: add rc1 and beta16 native evaluation` 并推送；在父仓库 `040rc1` 提交 `docs: link rc1 and beta16 native evaluation` 并推送，最后核对两个远端分支 HEAD 与本地提交一致。
