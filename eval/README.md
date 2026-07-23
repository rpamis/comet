# Comet Skill 评估

基于 pytest 的 Skill 评估框架，用于量化衡量 Comet 工作流和任意本地 Skill 的执行质量。

## 目录结构

```text
eval/
├── scaffold/                  # 共享 Python 运行器、Docker 辅助、加载器、验证器
│   └── python/
│       ├── validation/
│       │   ├── generic_rubric.py      # 通用 rubric（7 维度 + LLM judge）
│       │   ├── rubric.py              # Comet 工作流 rubric（9 维度 + LLM judge）
│       │   ├── authoring_rubric.py    # /comet-any 生成包 rubric（11 维度）
│       │   └── core.py                # 验证器基础工具
│       ├── generic_llm_judge.py       # 通用 LLM-as-judge 模块
│       ├── llm_judge.py               # Comet LLM-as-judge 模块
│       ├── profiles.py                # 评估 profile 注册表
│       ├── tasks.py                   # 任务加载器（task.toml 解析）
│       └── treatments.py              # Treatment 加载器
├── local/                     # 本地评估套件
│   ├── tasks/                 # 任务定义（每个子目录是一个任务）
│   ├── treatments/            # Treatment 配置（注入哪些 Skill）
│   ├── tests/                 # pytest 测试入口
│   └── logs/                  # 评估结果日志
└── langsmith/                 # LangSmith 评估入口（可选）
```

## 环境配置

### 前置依赖

- Python 3.11+
- Docker
- Claude Code CLI（`claude` 命令可用）
- `uv`（推荐）或 pip

### 安装

```bash
cd eval
uv sync
```

### 环境变量

评估运行会先读取当前 shell 的环境变量，也会按需加载 `eval/.env`。录屏或演示时可以不创建 `.env`，或只创建一个完全空的 `.env`，把密钥放在系统环境变量里，避免文件内容出现在画面中。

如需本地文件配置，可复制 `.env.example` 为 `.env` 并填写：

```bash
cp .env.example .env
```

> 注意：如果你使用系统环境变量，不要把 `.env.example` 中的 `ANTHROPIC_API_KEY=` 这类空赋值原样保留到 `.env`；空赋值在部分加载路径中可能覆盖已经存在的系统环境变量。

| 变量                                                              | 必填 | 说明                                                                                                |
| ----------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                               | ✅\* | Anthropic API 密钥；也可以由系统环境变量提供                                                        |
| `BENCH_CC_MODEL`                                                  | ❌   | Claude 模型覆盖（默认用 CLI 配置）                                                                  |
| `BENCH_SIMULATOR_PROMPT_FILE`                                     | ❌   | 显式覆盖任务级用户模拟器提示词；任务未配置时回退到 `eval/simulator-instruction.md`                    |
| `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` | ❌   | 用 Anthropic 兼容代理时的认证与模型配置；设置 `ANTHROPIC_AUTH_TOKEN` 后可不设置 `ANTHROPIC_API_KEY` |
| `BENCH_LLM_JUDGE`                                                 | ❌   | 设为 `1` 启用 LLM-as-judge 评分                                                                     |
| `BENCH_JUDGE_MODEL`                                               | ❌   | Judge 模型；启用 `BENCH_LLM_JUDGE=1` 时必须显式设置，不能复用主模型                                  |
| `BENCH_JUDGE_AUTH_TOKEN` / `BENCH_JUDGE_BASE_URL`                 | ❌   | Judge 专用 Anthropic 兼容代理认证与 URL；两者都设置时优先通过 Anthropic Messages HTTP 直接调用 judge |
| `BENCH_JUDGE_API_KEY`                                             | ❌   | Judge 专用 Anthropic API key；如果设置 `BENCH_JUDGE_AUTH_TOKEN`，优先使用 auth token                 |
| `LANGSMITH_API_KEY`                                               | ❌   | 仅 LangSmith 套件需要                                                                               |
| `LANGSMITH_PROJECT` / `LANGSMITH_TRACING`                         | ❌   | LangSmith 套件项目名与追踪开关；Claude Code 插件变量会从这组配置自动派生                            |

`*` 本地 Claude eval 至少需要 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 之一存在于当前进程环境中。

## 快速开始

### 运行内置任务

```bash
# 运行单个任务 + treatment
uv run pytest local/tests/tasks/test_tasks.py --task=generic-skill-smoke --treatment=CONTROL -v

# 运行 Comet 工作流任务
uv run pytest local/tests/tasks/test_tasks.py --task=comet-full-workflow --treatment=COMET_FULL_040_BETA -v

# 运行所有任务
uv run pytest local/tests/tasks/test_tasks.py -v
```

### 报告中的去噪口径

Eval 报告同时保留 raw set 和 analysis set。Raw set 包含所有 run，方便追查原始 stdout/stderr、events、reports 和 artifacts；analysis set 默认排除明确环境噪声，用于 headline 指标、pass@k/pass^k、成本统计、图表和 verdict。

- `included`：可解释实验信号，进入主统计。真实 workflow、model、task 或 validator 失败仍属于这一类。
- `flagged`：可疑 harness/task 噪声，进入主统计，但报告会提示它可能影响结论。
- `excluded`：明确环境或运行器噪声，不进入主统计，例如 API timeout、rate limit、认证/网络失败、Docker/container failure 或外层 runner timeout。

如果关键 treatment 的 clean data 不足，报告会输出 `Insufficient clean data` 或 `Inconclusive due to data quality`，而不是给出误导性的胜负结论。

### 评估任意 Skill

```bash
uv run pytest local/tests/tasks/test_tasks.py \
  --task=generic-skill-smoke \
  --skill-path=/path/to/my-skill \
  --skill-name=my-skill \
  --profile=generic -v
```

### 评估 /comet-any 生成的包

```bash
uv run pytest local/tests/tasks/test_tasks.py \
  --eval-manifest=/path/to/my-skill/comet/eval.yaml -v
```

## 容器中的 Claude 实验工作区

每次实验都会先在宿主机创建一个临时隔离目录，然后把它挂载到 Claude Code 容器的 `/workspace`。Claude 的当前工作目录就是 `/workspace`；双 agent 交互模式还会只读挂载 scaffold shell 到 `/opt/scaffold-shell`。

典型结构如下（以 `COMET_FULL_040_BETA` 为例，展示 0.4.0 beta 的 Comet Skill + 完整 dependency snapshot；实际任务产物会随 task/treatment 变化）：

```text
/workspace                                      # Claude Code 的当前工作目录；宿主机临时隔离目录挂载点
|-- Dockerfile                                  # 当前 task 的 Docker 构建文件，来自 task/environment/
|-- requirements.txt                            # Python 依赖文件；仅 task 提供时存在
|-- package.json                                # Node 依赖文件；仅 task 提供时存在
|-- package-lock.json                           # Node 锁文件；仅 task 提供时存在
|-- tsconfig.json                               # TypeScript 配置；仅 task 提供时存在
|-- CLAUDE.md                                   # 项目级指令；comet-workflow profile 会注入强制 /comet 指令
|-- .eval-task-prompt.txt                       # auto_user 模式下的任务提示词临时文件，运行后清理
|-- .eval-simulator-prompt.txt                  # auto_user 模式下的用户模拟器提示词临时文件，运行后清理
|-- .claude                                     # Claude Code 本地配置和 Skill 安装目录
|   |-- CLAUDE.md                               # Claude 专用项目指令副本
|   |-- settings.json                           # Claude Code settings；包含 Comet PreToolUse hook
|   `-- skills                                  # 当前 treatment 注入的完整 Skill 包
|       |-- comet                               # 040 beta 主 /comet Skill；039 baseline 也安装到这个 canonical 名称
|       |   |-- SKILL.md                        # 主 Skill 入口说明
|       |   |-- rules                           # Comet 软规则目录，完整复制自 benchmark snapshot
|       |   |   `-- comet-phase-guard.md        # phase guard 规则；040 beta 示例为中文规则文件
|       |   |-- reference                       # Comet reference 文档目录，供 Skill 运行时读取
|       |   |   |-- auto-transition.md            # 自动阶段推进协议
|       |   |   |-- comet-yaml-fields.md          # .comet.yaml 字段说明
|       |   |   |-- context-recovery.md            # 上下文恢复协议
|       |   |   |-- debug-gate.md                  # 异常调试协议
|       |   |   |-- decision-point.md              # 用户决策点协议
|       |   |   |-- dirty-worktree.md              # dirty worktree 处理协议
|       |   |   |-- file-structure.md              # Comet 产物目录约定
|       |   |   |-- intent-frame.md                # 040 beta intent routing 字段说明
|       |   |   |-- scripts.md                     # 运行脚本说明
|       |   |   `-- subagent-dispatch.md         # 子代理分发协议
|       |   |-- runtime                         # 040 beta runtime 元数据目录
|       |   |   `-- classic                     # classic runtime package metadata
|       |   |       |-- checks.yaml                  # comet skill check 的检查定义
|       |   |       |-- guardrails.yaml              # classic runtime guardrail 配置
|       |   |       `-- skill.yaml               # classic runtime Skill metadata
|       |   `-- scripts                         # 040 beta Node 脚本目录；完整复制自 benchmark snapshot
|       |       |-- comet-hook-guard.mjs          # 040 beta Claude Code PreToolUse hook 入口
|       |       |-- comet-archive.mjs             # archive 阶段脚本
|       |       |-- comet-env.mjs                 # runtime 环境解析脚本
|       |       |-- comet-guard.mjs               # phase guard 脚本
|       |       |-- comet-handoff.mjs             # handoff 写入脚本
|       |       |-- comet-intent.mjs              # intent routing 脚本
|       |       |-- comet-state.mjs               # .comet.yaml 状态机脚本
|       |       `-- comet-yaml-validate.mjs      # .comet.yaml schema 校验脚本
|       |-- comet-open                          # 040 beta /comet-open 阶段 Skill；完整包复制
|       |-- comet-design                        # 040 beta /comet-design 阶段 Skill；完整包复制
|       |-- comet-build                         # 040 beta /comet-build 阶段 Skill；完整包复制
|       |-- comet-verify                        # 040 beta /comet-verify 阶段 Skill；完整包复制
|       |-- comet-archive                       # 040 beta /comet-archive 阶段 Skill；完整包复制
|       |-- comet-hotfix                        # 040 beta /comet-hotfix 工作流 Skill；完整包复制
|       |-- comet-tweak                         # 040 beta /comet-tweak 工作流 Skill；完整包复制
|       |-- openspec-apply-change               # OpenSpec dependency Skill；完整包复制
|       |-- openspec-archive-change             # OpenSpec dependency Skill；完整包复制
|       |-- openspec-bulk-archive-change        # OpenSpec dependency Skill；完整包复制
|       |-- openspec-continue-change            # OpenSpec dependency Skill；完整包复制
|       |-- openspec-explore                    # OpenSpec dependency Skill；完整包复制
|       |-- openspec-ff-change                  # OpenSpec dependency Skill；完整包复制
|       |-- openspec-new-change                 # OpenSpec dependency Skill；完整包复制
|       |-- openspec-onboard                    # OpenSpec dependency Skill；完整包复制
|       |-- openspec-propose                    # OpenSpec dependency Skill；完整包复制
|       |-- openspec-sync-specs                 # OpenSpec dependency Skill；完整包复制
|       |-- openspec-verify-change              # OpenSpec dependency Skill；完整包复制
|       |-- brainstorming                       # Superpowers dependency Skill；带 visual companion 和 scripts
|       |   |-- SKILL.md                         # brainstorming Skill 入口
|       |   |-- scripts                          # brainstorming 辅助脚本目录
|       |   `-- visual-companion.md             # brainstorming visual companion 说明
|       |-- dispatching-parallel-agents         # Superpowers dependency Skill；完整包复制
|       |-- executing-plans                     # Superpowers dependency Skill；完整包复制
|       |-- finishing-a-development-branch      # Superpowers dependency Skill；完整包复制
|       |-- receiving-code-review               # Superpowers dependency Skill；完整包复制
|       |-- requesting-code-review              # Superpowers dependency Skill；完整包复制
|       |-- subagent-driven-development         # Superpowers dependency Skill；带 scripts 和 reviewer prompt
|       |   |-- SKILL.md                         # subagent-driven-development Skill 入口
|       |   |-- scripts                          # subagent workspace/review 辅助脚本目录
|       |   `-- task-reviewer-prompt.md         # task reviewer prompt 文件
|       |-- systematic-debugging                # Superpowers dependency Skill；完整包复制
|       |-- test-driven-development             # Superpowers dependency Skill；完整包复制
|       |-- using-git-worktrees                 # Superpowers dependency Skill；完整包复制
|       |-- verification-before-completion      # Superpowers dependency Skill；完整包复制
|       |-- writing-plans                       # Superpowers dependency Skill；完整包复制
|       `-- writing-skills                      # Superpowers dependency Skill；带 examples 等支持文件
|           |-- SKILL.md                         # writing-skills Skill 入口
|           `-- examples                         # writing-skills 示例目录
|-- .comet                                      # Comet 项目配置/运行状态目录，由 workflow 创建或更新
|   `-- config.yaml                             # Comet 项目配置；由 init/update 或 task 环境提供
|-- openspec                                    # OpenSpec 工作区目录，由 workflow 创建或更新
|   `-- changes                                 # OpenSpec change 产物目录
|-- docs                                        # repo 文档目录；workflow 可能写入设计/计划/证据
|   `-- superpowers                             # Superpowers 设计、计划、审查证据目录
|-- _test_results.json                          # validation 脚本输出的结构化结果
`-- <task files and agent artifacts>            # task 初始代码和 agent 运行中创建的产物

/opt/scaffold-shell                             # 双 agent loop 模式下只读挂载的 runner shell 脚本目录
|-- run-claude-loop.sh                          # subject agent 和 simulator agent 的循环驱动脚本
|-- docker.sh                                   # Docker build/run 辅助脚本
|-- setup.sh                                    # workspace setup 辅助脚本
`-- common.sh                                   # shell 公共函数
```

说明：

- `Dockerfile`、依赖文件和任务初始代码来自当前 task 的 `environment/`，例如 `stats.py`、`test_stats.py`。
- `CLAUDE.md` 只在需要项目级指令时写入；`comet-workflow` profile 会写入强制先触发 `/comet` 的 benchmark 指令。
- `.eval-task-prompt.txt` 和 `.eval-simulator-prompt.txt` 只在 `auto_user` 双 agent 模式运行期间存在，运行结束后会清理。
- `.claude/settings.json` 会为 Comet baseline 配置 Claude Code `PreToolUse` hook。`COMET_FULL_040_BETA` 指向 `comet-hook-guard.mjs`；`COMET_FULL_039` 指向 `comet-hook-guard.sh`。
- `.claude/skills/*` 是完整 Skill 包复制，不只是 `SKILL.md`；OpenSpec 和 Superpowers 依赖的 `scripts/`、`examples/`、prompt 文件和其他随包文件都会保留。
- `COMET_FULL_039` 的目录形状与上面一致，但 `comet` 和 `comet-*` 来自 `039-release/*` 快照，主脚本是 `.sh`：`comet-hook-guard.sh`、`comet-state.sh`、`comet-guard.sh`、`comet-handoff.sh`、`comet-archive.sh`、`comet-yaml-validate.sh`。OpenSpec / Superpowers dependency snapshot 与 040 baseline 相同。
- `openspec/`、`.comet/`、`docs/superpowers/`、任务代码修改和其他产物由 agent 在运行过程中创建或更新。
- LangSmith 轨迹追踪由官方 `langsmith-tracing` Claude Code 插件负责（不再使用手写 Stop hook）；用户主要配置 `LANGSMITH_*`，`TRACE_TO_LANGSMITH` / `CC_LANGSMITH_*` 会自动派生。启用完整 Claude Code trajectory 时，插件预构建目录会以 `/opt/langsmith-cc-plugin` 只读挂载进容器，详见 `langsmith/README.md`。
- `/opt/scaffold-shell` 只在双 agent loop 运行时挂载，提供容器内调用 Claude 的循环驱动脚本。

## 定义自己的 Task

每个任务是 `local/tasks/` 下的一个目录，包含三个部分：

```text
local/tasks/my-task/
├── task.toml              # 任务配置
├── instruction.md         # 给 agent 的指令（支持 {run_id} 等模板变量）
├── environment/
│   └── Dockerfile         # 验证环境（提供运行时和测试依赖）
└── validation/
    └── test_my_task.py    # 验证脚本（在 Docker 内运行）
```

### 1. 编写 `task.toml`

```toml
[metadata]
name = "my-task"
description = "任务描述"
difficulty = "medium"           # easy / medium / hard
category = "generic"            # generic 或 comet
default_treatments = ["CONTROL"]

[environment]
description = "Docker 环境描述"
dockerfile = "environment/Dockerfile"
timeout_sec = 600               # Docker 执行超时（秒）

[validation]
test_scripts = ["test_my_task.py"]   # Docker 内运行的验证脚本
target_artifacts = ["result.md"]     # 预期产物（存在性检查）
timeout = 120                        # 验证脚本超时（秒）

[evaluation]
profile = "generic"                       # 评估 profile
expected_artifacts = ["result.md"]        # rubric 检查的产物
required_skills = ["my-skill"]            # 必须调用的 Skill
require_skill_invocation = true           # 未调用时产生硬失败

# 自定义 rubric 标准（传给 LLM judge，可选）
rubric_criteria = [
    "输出包含错误处理",
    "代码遵循项目命名规范",
]

[interaction]
mode = "none"                   # none（单轮）或 auto_user（多轮模拟）
max_turns = 12                  # 最大轮次
```

### 2. 编写 `instruction.md`

这是给 agent 的任务指令，支持 `{run_id}` 模板变量：

```markdown
在当前工作区创建一个文件 `result.md`。

要求：

- 包含标题 `# My Task Result`
- 描述你的实现思路
- 包含至少三个要点
```

### 3. 编写验证脚本

验证脚本在 Docker 内运行，结果写入 `_test_results.json`：

```python
from pathlib import Path
from scaffold.python.validation.core import write_test_results

def main():
    passed = []
    failed = []

    # 检查产物是否存在
    result = Path("result.md")
    if not result.exists():
        write_test_results({"passed": [], "failed": ["result.md missing"]})
        return

    text = result.read_text(encoding="utf-8")

    # 检查内容
    if "# My Task Result" in text:
        passed.append("heading present")
    else:
        failed.append("heading missing")

    write_test_results({"passed": passed, "failed": failed})

if __name__ == "__main__":
    main()
```

### 4. 注册任务

在 `local/tasks/index.yaml` 中添加：

```yaml
tasks:
  - name: my-task
    category: generic
    default_treatments:
      - CONTROL
    description: 我的自定义任务
```

## Rubric 评估体系

### 评估 Profile

框架通过 profile 决定使用哪套 rubric：

| Profile           | 用途              | 维度数 | LLM Judge                 |
| ----------------- | ----------------- | ------ | ------------------------- |
| `generic`         | 任意 Skill        | 7      | ✅（`BENCH_LLM_JUDGE=1`） |
| `comet-workflow`  | Comet 工作流      | 9      | ✅                        |
| `authoring-skill` | /comet-any 生成包 | 11     | 继承 generic              |

Comet 类任务（`category = "comet"` 或名称以 `comet-` 开头）自动推断为 `comet-workflow`。

### 通用 Rubric（7 维度）

用于评估任意 Skill 的执行质量：

| 维度                     | 权重 | 说明                                                   |
| ------------------------ | ---- | ------------------------------------------------------ |
| `completion`             | 2.0  | 验证脚本通过率                                         |
| `skill_invocation`       | 1.0  | 必须调用的 Skill 是否被调用（未配置时为 N/A）          |
| `artifact_presence`      | 1.0  | 预期产物是否存在（支持 glob，未配置时为 N/A）          |
| `instruction_following`  | 1.0  | 是否有约束违反                                         |
| `interaction_compliance` | 0.8  | 多轮交互是否在轮次限制内                               |
| `efficiency`             | 0.7  | 轮次 ≤ 80、工具调用 ≤ 150、时长 ≤ 600s                 |
| `safety_boundary`        | 1.2  | 无危险命令（`rm -rf`、`git reset --hard`、`curl\|sh`） |

**N/A 维度处理**：当 `required_skills` 或 `expected_artifacts` 未配置时，对应维度标记为 N/A，不参与加权计算，避免虚高的中间分。

### LLM-as-judge（可选）

设置 `BENCH_LLM_JUDGE=1` 启用 LLM 评审。Judge 读取 agent 的 workspace 产物进行定性评分，但必须使用独立裁判配置：至少设置 `BENCH_JUDGE_MODEL`，如需走不同代理或账号，再设置 `BENCH_JUDGE_BASE_URL`、`BENCH_JUDGE_AUTH_TOKEN` 或 `BENCH_JUDGE_API_KEY`。

当配置了 `BENCH_JUDGE_BASE_URL` 和 `BENCH_JUDGE_AUTH_TOKEN` / `BENCH_JUDGE_API_KEY` 时，judge 会优先直接调用 Anthropic Messages HTTP（`/v1/messages`）。没有专用 judge endpoint 时，才回退到宿主机 `claude` CLI，并在子进程里清除继承来的主 `ANTHROPIC_*` provider 设置，再把 `BENCH_JUDGE_*` 映射为自己的 `ANTHROPIC_*` 环境变量。这样可以避免同一个模型既当选手又当裁判，也避免严格代理不兼容 Claude CLI 的额外请求参数。若启用了 `BENCH_LLM_JUDGE=1` 但未设置 `BENCH_JUDGE_MODEL`，报告会输出 `[RUBRIC-JUDGE] status: skipped - BENCH_JUDGE_MODEL is required when BENCH_LLM_JUDGE=1`，不会调用 judge。

**通用 judge 的三个标准维度**：

| 维度                    | 评分标准                                                |
| ----------------------- | ------------------------------------------------------- |
| `task_completion`       | 1.0 = 全部完成；0.5 = 部分完成；0.0 = 未完成            |
| `output_quality`        | 1.0 = 结构化、完整、非平凡；0.5 = 浅层；0.0 = 空或 stub |
| `instruction_adherence` | 1.0 = 完全遵循；0.5 = 轻微偏差；0.0 = 严重违反          |

**自定义 rubric 标准**：在 `task.toml` 的 `[evaluation]` 中定义 `rubric_criteria`，这些标准会作为额外维度传给 LLM judge，输出为 `custom_0`、`custom_1` 等。

```toml
[evaluation]
rubric_criteria = [
    "函数处理了边界情况（空输入、单元素）",
    "错误信息用户友好且可操作",
]
```

### Comet Rubric（9 维度）

Comet 工作流专用，输出 9 个维度分数和一个 `weighted_score`。每个维度由若干二值检查组成，维度分数为 `通过检查数 / 总检查数`；最终 `weighted_score` 按下表权重加权平均。

| 维度                        | 权重 | 评分信号                                                                                                                                                 |
| --------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completion`                | 2.0  | 当前 task 的基础验证脚本通过率，例如功能修复、测试文件、工作流产物等 task-specific checks                                                                |
| `main_flow`                 | 1.5  | workflow 阶段证据是否齐全；`full` 检查 open → design → build → verify → archive，`hotfix` / `tweak` 检查 open → build → verify → archive                 |
| `gate_guard`                | 1.5  | 是否使用 Comet 阶段守卫和状态推进能力，包括 `comet-guard`、状态 transition、`--apply`                                                                    |
| `artifact_quality`          | 1.2  | OpenSpec / Superpowers / 测试产物是否有实质内容；`full` 要求 proposal、深度 design、足够 tasks 和测试断言，`hotfix` / `tweak` 使用预设路径的轻量产物口径 |
| `skill_invocation`          | 1.0  | 是否真实调用主 `comet`、嵌套 Comet 阶段 Skill、OpenSpec 依赖 Skill、Superpowers 依赖 Skill，并保持入口先于子 Skill                                       |
| `spec_drift`                | 1.0  | 如果写入 delta spec，是否在归档前通过 OpenSpec 同步/归档语义合并；未涉及 delta spec 时记为 N/A 式满分                                                    |
| `decision_point_compliance` | 1.0  | 到达阻塞决策点时是否先询问用户；`full` 会检查 build/verify 等状态决策，`hotfix` / `tweak` 只检查预设路径中的升级、验证失败、归档重开等阻塞决策           |
| `recovery_resilience`       | 1.0  | 是否保留可恢复状态，例如 `.comet/checkpoint.json`、`run-state.json`、`state-events.jsonl`、`trajectory.jsonl`、handoff/context、干净 pending 状态        |
| `efficiency`                | 0.8  | 运行成本是否在阈值内：turns ≤ 80、工具调用 ≤ 150、时长 ≤ 600s                                                                                            |

额外规则：

- `skills_invoked` 只来自 Claude Code 事件中的真实 Skill 工具调用和 Skill 文件加载，不根据产物反推。
- `opsx:*` 旧 OpenSpec Skill 名会归一化为 `openspec-*`，避免同一调用在报告中重复出现。
- 如果 `comet-workflow` 未调用主 `comet`，会产生硬失败；如果调用了主 `comet` 但没有调用嵌套 Comet / OpenSpec / Superpowers 依赖 Skill，也会产生 workflow contract failure。
- `weighted_score` 只聚合 9 个 Comet rubric 维度；LLM judge 启用后会额外输出 `[RUBRIC-JUDGE]` 信息，不替代规则分。

## Treatment 配置

Treatment 定义注入哪些 Skill。位于 `local/treatments/`：

```yaml
# local/treatments/common/control.yaml
CONTROL:
  description: '无 Skill 基线'
  skills: []

# local/treatments/comet/comet_full_040_beta.yaml
COMET_FULL_040_BETA:
  description: '完整 Comet 工作流'
  skills:
    - name: comet
      skill: 040-beta/comet
      variant: all
      base: benchmarks
    - name: comet-open
      skill: 040-beta/comet-open
      variant: all
      base: benchmarks
```

## 运行测试

```bash
# 仅运行 scaffold 单元测试（快速，不需要 Docker）
cd eval
uv run pytest local/tests/scaffold/ -v

# 运行完整任务测试（需要 Docker + Claude CLI）
uv run pytest local/tests/tasks/test_tasks.py -v

# 重复运行 N 次（统计通过率分布）
uv run pytest local/tests/tasks/test_tasks.py --count=3 -v

# 并行运行
uv run pytest local/tests/tasks/test_tasks.py -n 4 -v
```

## 核心指标

### pass@k — 能力上限

> 给定 k 次独立尝试，**至少有一次成功**的概率。

使用 HumanEval 的无偏估计器：

```
pass@k = 1 - C(n-c, k) / C(n, k)
```

其中 `n` = 总运行次数，`c` = 成功次数。当 `n - c < k` 时（不可能连续抽到 k 次失败），`pass@k = 1.0`。

**解读**：pass@k 衡量"agent 能不能做到"。pass@1 就是单次通过率；pass@5 接近 1.0 意味着多次尝试中几乎总能找到一个成功的。

### pass^k — 可靠性下限

> 给定 k 次独立尝试，**全部成功**的概率。

```
pass^k = 1.0  (if c == n, 即所有运行都通过)
pass^k = 0.0  (otherwise, 观测样本下限)
```

**解读**：pass^k 衡量"agent 每次都能做到吗"。只有当所有运行都通过时才为 1.0，否则为 0.0。这是可靠性的一致性下界。

### pass@k − pass^k — 不稳定性间隙

两者的差值量化了**不稳定性**：高 pass@k + 低 pass^k = "能做到，但不能指望每次都做到"。对于用户反复运行的工作流 Skill，这个间隙是关键质量信号。

### 示例

| Treatment           | pass@1 | pass@5 | pass^1 | pass^5 | pass/fail |
| ------------------- | ------ | ------ | ------ | ------ | --------- |
| CONTROL             | 0.40   | 0.90   | 0      | 0      | 2/5       |
| COMET_FULL_040_BETA | 0.80   | 1.00   | 0      | 0      | 4/5       |

- CONTROL：40% 单次通过率，5 次尝试有 90% 概率成功至少一次，但无法保证每次都成功
- COMET_FULL_040_BETA：80% 单次通过率，5 次尝试几乎必然成功，但仍有波动

### 运行多次获取 pass@k

```bash
# 重复运行 5 次以获得 pass@5 / pass^5
uv run pytest local/tests/tasks/test_tasks.py --count=5 -v
```

报告自动生成在 `comparison_report.md` 中，包含 pass@k / pass^k 表格。

## 查看结果

评估结果写入 `local/logs/experiments/`，包含：

- `summary.md` — 汇总表（各 treatment 的维度分数）
- `comparison_report.md` — 基线对比报告（含 pass@k / pass^k 指标）
- 每次运行的详细日志和产物

默认输出 Markdown，可通过 `--report-config` 或 `COMET_EVAL_REPORT_CONFIG` 启用 HTML：

```json
{
  "report_outputs": {
    "markdown": true,
    "html": true
  }
}
```

## CLI 参数速查

| 参数                     | 说明                           |
| ------------------------ | ------------------------------ |
| `--task=<name>`          | 指定任务                       |
| `--treatment=<name>`     | 指定 treatment（逗号分隔多个） |
| `--profile=<name>`       | 覆盖评估 profile               |
| `--skill-path=<path>`    | 注入本地 Skill 路径            |
| `--skill-name=<name>`    | 注入的 Skill 名称              |
| `--count=<n>`            | 重复运行次数                   |
| `--eval-manifest=<path>` | 使用生成的 eval.yaml           |
| `--report-config=<path>` | 报告输出配置                   |
