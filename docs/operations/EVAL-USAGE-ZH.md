# 使用 `comet eval` 评估一个 Skill

本文从用户视角说明新版本怎么评估一个 Skill。正常情况下，你不需要理解 pytest、task registry、profile、treatment 或 Docker 细节；用户主入口是 `comet eval`。

## 先理解 `comet eval` 在 Comet 里的位置

`/comet-any` 负责创建或优化 Skill，`comet eval` 负责评估这个 Skill 是否能被 eval harness 发现、运行并产出报告。
新版本的 `/comet-any` 还会把 eval 结果和项目级偏好证据一起放进 publish readiness：`preferenceHash`、组合方案、resolved Skill 证据和 eval evidence 必须都能对应当前 draft。

两者的关系可以这样理解：

```text
/comet-any 生成 Skill
  -> 产出 comet/eval.yaml
  -> comet eval --collect 做发现预检查
  -> comet eval --html 执行真实评估
  -> /comet-any 或 comet creator status/next 读取评估结果并进入 readiness / review / publish / distribute
```

`comet eval` 不负责发布。发布仍然由 `/comet-any` 背后的 Bundle 后端处理，对普通用户暴露为 `comet publish`。eval 的职责是提供发布前证据。
对普通用户，推荐链路仍是 `/comet-any -> comet eval -> comet creator status/next -> comet publish review/approve/run -> comet publish distribute --preview -> comet publish distribute`。
稳定组合 Skill Bundle 的 required capability set（必需能力集合）是 `skills/scripts/rules/hooks/references`；
其中 `scripts/rules/hooks` 是 required control plane，`hooks/*.yaml` 只有在 `comet publish distribute`
编译到目标平台后才会生效。

## 推荐路径：评估 `/comet-any` 生成的 Skill

当 `/comet-any` 生成了 Skill 后，优先找这个文件：

```text
generated-skill/
  comet/
    eval.yaml
```

然后按两步跑：

```bash
comet eval ./generated-skill/comet/eval.yaml --collect
comet eval ./generated-skill/comet/eval.yaml --html
```

第一步 `--collect` 只确认“能不能发现任务”。它适合刚生成完 Skill 后做低成本预检查。

第二步 `--html` 才执行真实评估，并生成可浏览报告。评估通过后，`/comet-any` 可以把这份结果作为发布前证据的一部分。

## eval 结果如何进入 publish readiness

`/comet-any` 或后端在记录 eval 结果后，会把它并入 publish readiness。用户需要知道的只有两点：

1. `comet eval` 产出的结果会成为 `Publish readiness:` 的证据来源。
2. 当前 hash 缺少 eval 证据时，`User next steps:` 必须先指向运行 `comet eval`，而不是继续发布。

通常顺序是：

```bash
comet eval ./generated-skill/comet/eval.yaml --collect
comet eval ./generated-skill/comet/eval.yaml --html
comet creator next <name> --json
comet publish review <name> --platform <reference-platform> --json
```

`comet creator next` 只输出当前推荐的一步用户命令；`comet publish review` 需要把 `Publish readiness:`、`User next steps:`、`Readiness:`、`Blockers:`、`Warnings:` 和 `Evidence:` 直接展示给用户。

## 为什么先 `collect`

`collect` 是用户最便宜的排错入口。它主要回答：

- `comet/eval.yaml` 路径是否正确
- eval harness 是否能读到这个 manifest
- manifest 里的推荐任务是否能被发现
- 当前仓库的 eval 依赖路径是否可用

它不应该先跑完整模型评估，也不应该先消耗长时间任务。失败时，通常先修 manifest、路径或任务发现问题。

## 选择 Local 或 LangSmith 套件

`comet eval` 默认使用 `local` 套件，适合日常开发和本地报告。需要把 run、rubric feedback、成本和 Claude Code 轨迹同步到 LangSmith 时，显式选择 `langsmith`：

```bash
comet eval ./generated-skill/comet/eval.yaml --suite langsmith --html
```

两个套件复用同一套任务、treatment、rubric 和 manifest。`langsmith` 套件会读取 `LANGSMITH_API_KEY`、`LANGSMITH_PROJECT` 和 `LANGSMITH_TRACING`，准备 Claude Code 轨迹插件，并把报告写入 `eval/langsmith/logs/experiments/`。没有 `--suite langsmith` 时，即使环境里启用了 tracing，Local runner 也不会创建 LangSmith experiment。

## `--html` 会输出什么

运行时 CLI 会先打印一组执行信息：

- `Eval root`：实际从哪个 `eval/` 根目录启动
- `Mode`：`collect` 或 `run`
- `Suite`：`local` 或 `langsmith`
- `Target`：当前评估的是 manifest 还是本地 Skill 目录
- `Experiment`：本次实验 id
- `Profile`：本次评估使用的 profile
- `Task`：本次评估任务
- `Report path`：报告位置
- `Report config`：启用 `--html` 时使用的临时报告配置

`--html` 会要求报告同时产出 markdown 和 HTML。报告路径跟随所选套件：

```text
eval/<suite>/logs/experiments/<experiment-id>/summary.html
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

## `/comet-any` 如何使用 eval 结果

从用户视角，eval 结束后把结果交回 `/comet-any` 继续推进，或运行 `comet creator next <name>` 看唯一推荐下一步即可。`/comet-any` 会把 eval 证据纳入 readiness：

- 没有 eval 证据：不能 publish
- eval 失败：不能 publish
- eval 证据对应旧 hash：不能 publish
- `.comet/skill-preferences.yaml` 已变化且处于 strict 模式：不能 publish，必须重新确认或重新生成组合方案
- eval 通过且 hash 匹配：可以进入 review / publish 判断

用户不需要手工编辑 Bundle 状态，也不应该手工把报告路径写进内部 JSON。`/comet-any` 会通过 Bundle 后端记录结构化证据。

## 只有本地 Skill 目录时怎么评估

如果你还没有 `comet/eval.yaml`，只有一个本地 Skill 目录，可以先做 quick smoke：

```bash
comet eval ./my-skill --quick
```

这个路径适合早期验证：

- Skill 目录是否可读取
- eval harness 是否能把它当作动态 Skill 注入
- 通用 smoke task 是否能跑起来

当前 quick smoke 默认使用：

```text
generic-skill-smoke
```

这只是早期冒烟，不等于发布前完整证据。准备发布时，仍推荐通过 `/comet-any` 生成 `comet/eval.yaml`，再走 manifest 路径。

## manifest 路径和 skill-path 路径怎么选

优先级很简单：

- 有 `comet/eval.yaml`：直接把这个文件作为 target
- 只有本地目录、还在早期调试：把 Skill 目录作为 target 并加 `--quick`
- 是 `/comet-any` 生成物：直接传它的 `comet/eval.yaml`
- 要进入发布 readiness：直接传它的 `comet/eval.yaml`

不要把本地 Skill 的 `--quick` 冒烟当成最终发布评估。

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
eval/local/logs/experiments/
```

## `comet eval` 和 `comet skill check` 不一样

这两个命令用途不同。

`comet eval` 是共享 eval harness 的用户入口，用来评估一个 Skill 包或 `comet/eval.yaml`。

`comet skill check` 是本地 Engine Run 的完成度检查，用来判断某个 run / change 是否满足 `comet/checks.yaml` 里的 runtime checks。

如果你的问题是“这个 Skill 作为产品能力能不能通过评估”，用：

```bash
comet eval ./generated-skill/comet/eval.yaml --html
```

如果你的问题是“这个正在运行的 deterministic Skill Run 是否缺 artifact 或状态”，才用：

```bash
comet skill check --change ./changes/demo --scope completion
```

## 用户最少需要记什么

实际使用时只需要记三件事：

1. `/comet-any` 生成物优先用 `comet/eval.yaml`
2. 先 `--collect`，再 `--html`
3. eval 结果是 `/comet-any` 发布 readiness 的证据，不是发布动作本身

推荐命令：

```bash
comet eval ./generated-skill/comet/eval.yaml --collect
comet eval ./generated-skill/comet/eval.yaml --html
comet creator next <name> --json
```
