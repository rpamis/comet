# LangSmith 评估套件

这个套件复用 local 的任务集，并把每次 `(task, treatment)` 运行同步到 LangSmith：

- 每个任务是一个 dataset example（`inputs` = 任务/treatment，`reference_outputs` = 预期产物 / 必需 Skill / rubric 判据）。
- 每个 treatment 是一个 experiment；`CONTROL` 与注入 Skill 的 treatment 可在实验对比页并排看。
- 每个 run 记录 `outputs`（轮次、工具调用、耗时、token、成本、调用的 Skill）和 feedback（每个 rubric 维度分 + `checks_pass_rate`）。
- 可选：Claude Code 的完整轨迹（trajectory）通过官方 `langsmith-tracing` 插件嵌套在同一个 run 下。

默认复用：

- `../local/tasks`
- `../local/treatments`
- `../local/skills`

报告和产物写入：

```text
logs/experiments/
```

## 安装

```bash
cd eval
uv sync --extra langsmith
```

## 运行

结果上报（rubric + treatment 对比）只需要 `LANGSMITH_API_KEY`。推荐在 `eval/.env` 或 `eval/langsmith/.env` 中设置：

```bash
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=comet-skill-eval
LANGSMITH_TRACING=true
```

Comet 会从这组 `LANGSMITH_*` 配置自动派生 Claude Code 官方插件需要的 `TRACE_TO_LANGSMITH`、`CC_LANGSMITH_API_KEY` 和 `CC_LANGSMITH_PROJECT`。只有需要覆盖插件行为时，才需要显式设置这些 `CC_*` / `TRACE_TO_LANGSMITH` 变量。

从 `eval/` 目录运行：

```bash
# 一个 treatment = 一个 experiment；用 LANGSMITH_EXPERIMENT 命名便于对比
LANGSMITH_EXPERIMENT=COMET_FULL_040_BETA \
  uv run pytest langsmith/tests/tasks/test_tasks.py \
  --task=comet-fix-median --treatment=COMET_FULL_040_BETA -v

# 再跑 CONTROL 作为对照
LANGSMITH_EXPERIMENT=CONTROL \
  uv run pytest langsmith/tests/tasks/test_tasks.py \
  --task=comet-fix-median --treatment=CONTROL -v
```

生成 Skill manifest 示例：

```bash
uv run pytest langsmith/tests/tasks/test_tasks.py \
  --eval-manifest=/path/to/my-skill/comet/eval.yaml -v
```

## 轨迹追踪（可选，官方 Claude Code 插件）

轨迹追踪用官方 [`langsmith-tracing`](https://github.com/langchain-ai/langsmith-claude-code-plugins) 插件，容器内以 headless（`claude -p`）方式启用。默认情况下，LangSmith suite 会在首次运行时用 `node:20` 一次性构建插件到 `eval/.cache/langsmith-cc-plugin`，后续运行复用这个缓存目录并挂载到任务容器的 `/opt/langsmith-cc-plugin`。

因为 eval 在 Linux 容器里运行，不要在 Windows 宿主机直接 `pnpm build` 后挂载，避免跨平台 `node_modules` 失效。你通常只需要设置：

```bash
LANGSMITH_TRACING=true
```

如果要提前手动构建缓存，可以从 `eval/` 目录运行：

```bash
docker run --rm -v "$PWD/.cache:/out" node:20 sh -c \
  "cd /tmp && git clone https://github.com/langchain-ai/langsmith-claude-code-plugins && cd langsmith-claude-code-plugins && corepack enable && pnpm install && pnpm build && cp -r . /out/langsmith-cc-plugin"
```

PowerShell 中可用 `${PWD}`：

```powershell
docker run --rm -v "${PWD}\.cache:/out" node:20 sh -c "cd /tmp && git clone https://github.com/langchain-ai/langsmith-claude-code-plugins && cd langsmith-claude-code-plugins && corepack enable && pnpm install && pnpm build && cp -r . /out/langsmith-cc-plugin"
```

如果要覆盖默认缓存目录，可以把构建好的插件目录显式指给评估（宿主机路径）：

```bash
export CC_LANGSMITH_PLUGIN_DIR=/abs/path/to/comet/eval/.cache/langsmith-cc-plugin
```

- 设置后，插件目录会以 `/opt/langsmith-cc-plugin` 只读挂载进容器，`claude` 加 `--plugin-dir` 启用；轨迹通过自动派生的 Claude Code 插件配置和 `CC_LANGSMITH_PARENT_DOTTED_ORDER` 嵌套在对应 pytest run 下。
- 未设置时，轨迹追踪自动跳过（不报错），rubric 与 treatment 对比照常上报。
- 如果不希望 suite 自动构建插件，设置 `CC_LANGSMITH_PLUGIN_AUTO_BUILD=false`。
