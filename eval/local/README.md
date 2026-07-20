# 本地评估套件

这个套件用于在本机运行 Comet 和任意本地 Skill 的 benchmark，并将日志与 Docker 验证结果保存到本地。
它不需要 LangSmith 凭证。

从 `eval/` 目录运行：

```bash
uv run pytest local/tests/tasks/test_tasks.py --task=comet-fix-median --treatment=COMET_FULL_040_BETA -v
uv run pytest local/tests/tasks/test_tasks.py --task=comet-full-workflow --treatment=CONTROL,COMET_FULL_040_BETA -v
uv run pytest local/tests/tasks/test_tasks.py -v
```

快速运行通用 smoke 任务：

```bash
uv run pytest local/tests/tasks/test_tasks.py --task=generic-skill-smoke --treatment=CONTROL -v
```

运行只安装 Comet Native、自包含且不注入 OpenSpec / Superpowers 的完整流程评估：

```bash
uv run pytest local/tests/tasks/test_tasks.py \
  --task=comet-native-workflow \
  --treatment=COMET_NATIVE_PHASE1 -v
```

将 Native 与 0.4.0 基线按相同的 16 个 canonical Comet 任务、每任务 3 次对齐运行：

```bash
uv run pytest local/tests/tasks/test_tasks.py::test_task_treatment \
  --treatment=COMET_NATIVE_PHASE1 --count=3 -n 4 \
  -k "not comet-native and not generic-skill-smoke and not authoring-skill-smoke and not workflow-route-conformance and not workflow-overlay-contract" -v
```

对齐评估保留每个任务原有的业务 validator，但会把 Classic/OpenSpec 专属流程检查替换为 Native 的 Skill 隔离、配置、终态 change、验证归档和安全 trajectory 检查。调用 `/comet` 或其他外部 Skill、留下活动 change、缺少完整规格/验证证据，都会作为真实 Native workflow failure 进入 pass@k，而不会被当成环境噪声排除。

运行生成 Skill 的 authoring smoke 任务：

```bash
uv run pytest local/tests/tasks/test_tasks.py \
  --task=authoring-skill-smoke \
  --eval-manifest=/path/to/generated-skill/comet/eval.yaml \
  --profile=authoring-skill -v
```

运行生成 Skill 的路由一致性验证：

```bash
uv run pytest local/tests/tasks/test_tasks.py \
  --task=workflow-route-conformance \
  --eval-manifest=/path/to/generated-skill/comet/eval.yaml \
  --profile=authoring-skill -v
```

当 `--eval-manifest` 指向 `/comet-any` 生成包时，runner 会先把入口 Skill 包和生成的内部 Node Skills 复制到隔离的 eval 工作区，再执行 Docker 验证。

`comet-workflow` profile 会把 `skills/benchmarks/dependency/claude-md/comet-workflow/CLAUDE.md` 注入到隔离工作区根目录，用项目级指令强制 agent 先触发 `/comet`。如果需要调整这段提示词，直接改这个资产文件，不需要改 Python runner。

Comet baseline 和它依赖的 OpenSpec / Superpowers Skill 都会按完整 Skill 包安装到 `.claude/skills/`，包括 `rules/`、`reference/`、`runtime/`、`scripts/` 以及其他随包文件。安装 canonical `comet` Skill 时，runner 会根据 baseline 自动配置 Claude Code `PreToolUse` hook：`COMET_FULL_039` 使用 `comet-hook-guard.sh`，`COMET_FULL_040_BETA` 使用 `comet-hook-guard.mjs`。

报告中的 `Skills invoked` 和 `skill_invocation` rubric 只统计 Claude Code 事件里真实观测到的 Skill 工具调用，不会根据产物反推。`comet-workflow` profile 会把嵌套 Comet 阶段 Skill、OpenSpec 依赖 Skill、Superpowers 依赖 Skill 都作为关键证据；如果只调用主 `comet` 但没有调用这些依赖，run 会被标记为工作流契约失败。rubric 会按 `full`、`hotfix`、`tweak` 三类 workflow 分别评分：`full` 要求深度设计和完整阶段证据，`hotfix` / `tweak` 使用预设路径的轻量产物和连续执行决策点口径。

容器内 Claude 实验工作区的 ASCII 目录结构见 `../README.md` 的“容器中的 Claude 实验工作区”。

任务索引：

```text
tasks/index.yaml
```

报告和产物写入：

```text
logs/experiments/
```

报告默认只输出 Markdown（`summary.md`）。如需启用可浏览的 HTML，或关闭 Markdown 输出，传入 JSON/YAML 报告配置：

```json
{
  "report_outputs": {
    "markdown": true,
    "html": true
  }
}
```

```bash
uv run pytest local/tests/tasks/test_tasks.py --report-config report-config.json -v
uv run python local/scripts/compare_baselines.py --report-config report-config.json
```

Native 与 0.4.0 的 pass@3 来自两个独立 experiment 时，使用严格对齐模式：

```bash
uv run python local/scripts/compare_baselines.py \
  --candidate-experiment local/logs/experiments/experiment_NATIVE \
  --candidate-treatment COMET_NATIVE_PHASE1 \
  --baseline-experiment langsmith/logs/experiments/experiment_040_PASS3 \
  --baseline-treatment COMET_FULL_040_BETA \
  --ks 1,2,3
```

pytest 会在模型运行前把收集到的 `task + treatment + repetition` 写入 experiment 的
expected case matrix；严格比较按两侧目标 treatment 的矩阵检查 coverage，因此即使某个
样本在两侧都没有留下 report，也会被列为缺失，而不是从报告并集中无声消失。对 v2
报告，只有 `task + repetition + case_hash` 全部一致才会配对；`case_hash` 同时绑定任务、
验证器、runner/controller 源码、不可变 Docker image、Claude 工具版本以及 model /
interaction 配置。某个 task 缺少 repetition 时，报告会降低该 k 的 coverage 并列出
缺失项，不会把 pass@3 偷换成 pass@2。

历史耗时会从 raw stdout 按当前的累加 parser 重算；缺少 raw duration 的运行只计入
缺失 coverage，不会和已有耗时混合平均。没有 expected matrix 的旧 experiment 会明确
标为 observed-report fallback；v1 或缺失 case manifest 的运行最多只能按任务核心 hash
兼容比较，并明确标注无法证明当时的 runner、image、tool、model 或 interaction 身份，
不会把比较时一致误写成历史 checkout 与执行环境已被精确证明一致。

严格对齐报告还会从 raw stdout 重算成对效率指标，包括模型启动/恢复次数、Agent 轮次、
工具调用、累计耗时、输入/输出/cache token、总 token、模型成本和上下文压力。主要视图只
统计两侧都通过的同一 `task + repetition + case_hash`，避免把未完成任务的低消耗误当成
效率提升。多次恢复产生的顶层 `result` 按调用累加；流式 assistant 事件按 message id 去重。
上下文指标只有在两侧都保存逐消息 usage 时才可比较，coverage 过低时报告会明确提示，不能
据此宣传 workflow 间的上下文改进。

也可以设置 `COMET_EVAL_REPORT_CONFIG=/path/to/report-config.json`。

每次运行的报告都会包含 profile、Skill 来源元数据、run id、产物引用，以及结构化失败归因。归因桶包括 `harness`、`workflow`、`task` 和 `model`。

比较报告还会显示 `Data quality summary`。报告保留所有 raw runs 供审计，但 headline 指标、pass@k/pass^k、成本统计、图表和 verdict 默认使用 analysis set。`excluded` 表示明确的环境或运行器噪声（例如 API timeout、rate limit、Docker 启动失败），不会进入主统计；`flagged` 表示可疑 harness/task 噪声，仍进入主统计但会在报告中单独标出；真实 workflow/model/task 失败会保留为 `included`，不会因为分数低被过滤。
