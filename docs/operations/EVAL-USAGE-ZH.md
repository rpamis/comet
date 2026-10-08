# 使用 `comet eval` 评估一个 Skill

本文从用户视角说明新版本怎么评估一个 Skill。正常情况下，你不需要理解 pytest、task registry、profile、treatment 或 Docker 细节；用户主入口是 `comet eval`。

## 最短路径：评估你自己的本地 Skill

`comet eval` 首先是一个独立的 Skill 评估器。你不需要先运行 `/comet-any`，也不需要先写
`comet/eval.yaml`：

```bash
# POSIX
comet eval ./my-skill --collect
comet eval ./my-skill --html
comet eval ./my-skill --quick --html
```

```powershell
# Windows PowerShell
comet eval .\my-skill --collect
comet eval .\my-skill --html
comet eval .\my-skill --quick --html
```

- `--collect` 只做静态发现和配置检查，不启动 Agent、Docker、插件、凭据或网络请求。
- 普通运行在没有 manifest 时，会直接读取 Skill 并自动生成、冻结和缓存 2–4 个任务。
- `--quick` 使用固定的 `generic-skill-smoke` 任务，适合低成本冒烟。

报告和运行状态写入 Skill 目录，或 `--project` 指定项目目录下的：

```text
.comet/eval/
├── generated/   # 自动生成任务
├── cache/       # uv、插件等缓存
├── locks/       # 并发锁
└── runs/        # summary、events、raw、reports、artifacts
```

Skill 目录、直接 `SKILL.md`、直接 `comet/eval.yaml` 都可以作为 target。传入 Skill 目录时，Eval
会自动发现 `<skill-root>/comet/eval.yaml` 或 `.yml`；没有时只在内存中合成基础 manifest，不会改写你的 Skill：

```bash
comet eval ./my-skill/SKILL.md --html
comet eval ./my-skill/comet/eval.yaml --collect
```

## 主 Agent 与独立 LLM-as-Judge

主执行和 Judge 是两套独立配置。主 Agent、模型和 API 地址可以写在 manifest 中，也可以用 CLI 覆盖：

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

```powershell
comet eval .\my-skill `
  --agent codex --model subject-model --base-url https://subject.example/v1 `
  --judge-agent claude-code --judge-model judge-model `
  --judge-base-url https://judge.example/v1
```

```bash
comet eval ./my-skill \
  --agent codex --model subject-model --base-url https://subject.example/v1 \
  --judge-agent claude-code --judge-model judge-model \
  --judge-base-url https://judge.example/v1
```

CLI 优先于 manifest；如果只配置 `judge.model`，Judge Agent 继承主 Agent，但 Judge 模型、API 地址和凭据
仍然独立。Judge 凭据只使用 `BENCH_JUDGE_API_KEY` / `BENCH_JUDGE_AUTH_TOKEN`，不会继承主 Agent 凭据。
自定义 Agent 需要先安装用户目录下的显式适配器，再通过同一个 `--agent` / `--judge-agent` 选择；详情见
后文的高级扩展说明。

## 评估 `/comet-any` 生成的 SDK 应用

`/comet-any` 编译并验证应用后，会让用户选择是否评估。选择评估后由 Eval 自动生成并冻结 2–4 个用例，执行所选 Agent 和模型，检查实际 SDK Run 与业务产物，并保存当前内容的报告。选择跳过则继续安装预览；跳过、失败和未完成都有独立状态，不会写成通过。

也可以直接评估已有 SDK 应用：

```bash
comet eval ./application/application.json --project . --collect
comet eval ./application/application.json --project . --agent codex --model <model>
```

应用评估读取实际流程定义、固定 Skills 和执行模块，不只读取入口 `SKILL.md`。`--collect` 只预览，不生成用例或调用模型；应用评估不接受 `--quick` 或单任务替代。报告绑定当前应用内容、依赖、配置和用例集，列出失败和未覆盖的 SDK 步骤。重试复用原用例；Creator 修订后优先沿用原用例，而不是重新出题掩盖失败。

Eval 不负责发布。后续使用 `comet application distribute` 分发，预览会显示当前内容的评估状态和报告。未评估或失败仍允许用户明确选择安装；报告改变或缺失时显示证据失效。仅在一个 Agent 上评估通过，不代表其他安装平台、真实 Hook 或外部系统已经验收。

有外部副作用的 Skill 必须先提供固定的测试替身；没有隔离实现时报告保持未完成，不执行真实外部操作。超时或结果未知时，先核对原实验和容器，不能直接重复启动。

## 为什么先 `collect`

`collect` 是用户最便宜的排错入口。它主要回答：

- `comet/eval.yaml` 路径是否正确
- eval harness 是否能读到这个 manifest
- manifest 里的推荐任务是否能被发现
- 当前仓库的 eval 依赖路径是否可用

它不应该先跑完整模型评估，也不应该先消耗长时间任务。失败时，通常先修 manifest、路径或任务发现问题。

## 选择 Local、LangSmith 或 Langfuse 套件

`comet eval` 默认使用 `local` 套件，适合日常开发和本地报告。需要把 run、rubric feedback、成本和 Claude Code 轨迹同步到 LangSmith 时，显式选择 `langsmith`：

```bash
comet eval ./my-skill --suite langsmith --html
```

两个套件复用同一套任务、treatment、rubric 和 manifest。`langsmith` 套件会读取 `LANGSMITH_API_KEY`、`LANGSMITH_PROJECT` 和 `LANGSMITH_TRACING`，准备 Claude Code 轨迹插件，并把报告写入项目的 `.comet/eval/runs/`。没有 `--suite langsmith` 时，即使环境里启用了 tracing，Local runner 也不会创建 LangSmith experiment。

需要把核心 task/treatment 结果和 score 同步到 Langfuse 时，选择 `langfuse`：

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-... LANGFUSE_SECRET_KEY=sk-lf-... \
  comet eval ./my-skill --suite langfuse --html
```

`comet eval` 会自动选择 Langfuse optional extra。Langfuse 套件会在 Agent/Docker 运行前完成凭据与连接检查；核心 trace、score、summary 或 flush 上报失败会使本次套件失败。Claude Code 和 Codex 会使用隔离缓存中的固定版本官方 hook/plugin；Qoder、CodeBuddy 使用项目级 Stop hook 和 JSONL transcript 适配器，详细轨迹失败时只降级为 best-effort。`--collect --suite langfuse` 不初始化 SDK、不联网、不下载插件。

## 选择评估 Agent

评估默认使用 `claude-code`。可以用 CLI 选择 `claude-code`、`codex`、`qoder` 或 `codebuddy`：

```bash
comet eval ./my-skill --agent codex
comet eval ./my-skill --agent qoder
comet eval ./my-skill --agent codebuddy
```

也可以在 manifest 中设置默认值：

```yaml
execution:
  agent: codex
```

选择优先级是 CLI `--agent` > manifest `execution.agent` > `claude-code`。Local 和 LangSmith 套件共享同一选择规则；subject、auto_user simulator 和可选 Judge 都使用选定 Agent 的独立会话。`--collect` 只校验 Agent 与 manifest，不启动 Agent、Docker 或凭据检查。

## `--html` 会输出什么

运行时 CLI 会先打印一组执行信息：

- `Eval root`：实际从哪个 `eval/` 根目录启动
- `Mode`：`collect` 或 `run`
- `Suite`：`local`、`langsmith` 或 `langfuse`
- `Target`：当前评估的是 manifest 还是本地 Skill 目录
- `Experiment`：本次实验 id
- `Profile`：本次评估使用的 profile
- `Task`：本次评估任务
- `Report path`：报告位置
- `Report config`：启用 `--html` 时使用的临时报告配置

`--html` 会要求报告同时产出 markdown 和 HTML。报告路径跟随所选套件：

```text
.comet/eval/runs/<experiment-id>/summary.html
```

如果 CLI 输出里显示的是 `<experiment-id>` 占位符，用同一段输出里的 `Experiment` 值对应查找即可。

## 报告应该怎么看

用户不需要逐行读底层日志。优先看这几类信息：

- 评估是否通过
- 失败归因是 harness、workflow、task 还是 model
- 失败用例是否和 Skill 目标相关
- 是否缺少预期 artifact
- 是否是路径、manifest 或环境问题
- token / cost / duration 是否异常

`comet eval` 的输出会提示 failure attribution：报告会把失败归到 harness、workflow、task、model 等桶里。这个归因用于判断下一步应该修 Skill、修 eval 配置，还是重跑环境。

报告还会区分 raw set 和 analysis set。Raw set 保留所有运行记录；analysis set 是默认用于 headline、pass@k、成本、图表和 verdict 的去噪集合。`excluded` 通常表示 API timeout、rate limit、认证/网络失败、Docker/container failure 或外层 timeout，这类样本会保留在报告里但不进入主统计。`flagged` 表示 harness 或 task 假设可疑，仍进入主统计，但报告会提示风险。真实的 Skill、workflow、model 或 validator 失败不会被过滤，会作为 `included` 样本进入主统计。

如果报告显示 `Insufficient clean data` 或 `Inconclusive due to data quality`，优先重跑对应 task/treatment 或检查环境，不要把当前 verdict 当作最终质量结论。

## `/comet-any` 如何使用 Eval 结果

Creator 使用同一 SDK Run 继续推进。评估通过后进入安装预览；失败或未完成时提供 retry、revise 或明确 skip，跳过后仍保留实际失败状态。安装确认前重新核对当前包、用例和报告摘要。使用原 Run 运行 `comet creator next <name>`，不手工编辑 Runtime 状态或向内部 JSON 填入报告路径。

## 只有本地 Skill 目录时怎么评估

如果你只有一个本地 Skill 目录，直接把它作为 target 即可：

```bash
comet eval ./my-skill --collect
comet eval ./my-skill --html
```

如果只想做低成本冒烟：

```bash
comet eval ./my-skill --quick --html
```

这个路径适合验证：

- Skill 目录是否可读取
- eval harness 是否能把它当作动态 Skill 注入
- 通用 smoke task 是否能跑起来

当前 quick smoke 默认使用：

```text
generic-skill-smoke
```

这只是早期冒烟，不等于完整评估。普通 Skill 可以使用可选的 `comet/eval.yaml` 声明可复现任务；`/comet-any` 生成的 SDK 应用则直接使用 `application.json` 作为评估目标。

如果 `eval.yaml` 没有 `evaluation.tasks` 或 `recommendedTasks`，普通运行会对 Skill 做受限快照，自动生成 2–4 个确定性任务，并按快照、Agent、profile 和交互配置 hash 缓存到 `.comet/eval/generated/`。缓存 manifest 会保存生成元数据；`--collect` 只读取已有缓存，不会启动任务生成 Agent。需要跳过自动生成时显式使用 `--quick`。

项目也可以直接在 `evaluation.tasks` 中声明 inline task，或用 `source` 引用 Skill 包内带有 `task.toml` 和 `instruction.md` 的任务包：

```yaml
evaluation:
  tasks:
    - name: writes-summary
      prompt: Create summary.md.
      expect:
        files: [summary.md]
        contains:
          summary.md: ['# Summary']
```

`source`、`workspace` 和期望产物必须留在允许的包/工作区内；inline 的 `files`、`contains`、`json`、`commands` 检查会在 Docker 工作区执行。

## manifest 路径和 skill-path 路径怎么选

优先级很简单：

- 普通本地 Skill：直接传 Skill 目录，Eval 会自动发现可选 manifest
- 只有 `SKILL.md`：直接传 `SKILL.md`
- 有 `comet/eval.yaml`：可以传 Skill 目录自动发现，也可以直接传 manifest
- `/comet-any` 的 SDK 应用：传入包内的 `application.json`

`--quick` 只表示固定 smoke 任务，不会替代完整任务评估。

## 失败时怎么判断下一步

### collect 失败

优先检查：

- manifest 路径是否正确
- `comet/eval.yaml` 是否存在
- manifest 里推荐的 task 是否存在
- 当前是否在 Comet 仓库根目录或传了正确 `--project`

### run 失败

优先看报告里的 failure attribution：

- `harness`：多半是 eval harness、依赖、Docker、路径或环境问题
- `workflow`：多半是 Skill 执行流程没有达到预期
- `task`：多半是任务定义、验证条件或 fixture 问题
- `model`：多半是模型行为、工具使用或不稳定输出问题

### HTML 报告没找到

先看 CLI 输出的 `Experiment` 和 `Report path`。如果路径里有 `<experiment-id>`，用实际 experiment id 到下面目录查：

```text
.comet/eval/runs/
```

## `comet eval` 和 `comet skill check` 不一样

这两个命令用途不同。

`comet eval` 是共享 eval harness 的用户入口，用来评估一个 Skill 包或 `comet/eval.yaml`。

`comet skill check` 是本地 Engine Run 的完成度检查，用来判断某个 run / change 是否满足 `comet/checks.yaml` 里的 runtime checks。

如果你的问题是“这个 Skill 作为产品能力能不能通过评估”，用：

```bash
comet eval ./my-skill --html
```

如果你的问题是“这个正在运行的 deterministic Skill Run 是否缺 artifact 或状态”，才用：

```bash
comet skill check --change ./changes/demo --scope completion
```

## 用户最少需要记什么

实际使用时只需要记三件事：

1. 直接把自己的 Skill 交给 `comet eval`
2. 先 `--collect`，再按需要运行 `--quick` 或 `--html`
3. `/comet-any` 是可选的 SDK 应用创作入口；Eval 评估应用，分发仍由用户确认

推荐命令：

```bash
comet eval ./my-skill --collect
comet eval ./my-skill --html
comet creator next <name> --json
```
