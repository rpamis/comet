# 使用内置数据集评测 Native

`comet eval` 可读取 WorkBuddy Code v1.0 和 SkillsBench v1.1，选择当前安装包中的 Comet Native 或 Claude Code 原生 Goal。不注入数据集附带的领域 Skills。

Dashboard 中打开“评估 Eval → 新建评估 → 内置数据集”，选择 WorkBuddy Bench · Code 或 SkillsBench。选择只显示版本、来源、体积和本地缓存状态，点击“下载数据集”后才联网下载。WorkBuddy 需先勾选许可；下载时显示阶段、已接收字节和可用的总进度，失败后可重试。已缓存且版本与归档摘要匹配时复用缓存。

下载完成后选择一个或多个任务及每题运行次数，再进入现有用例预览、执行配置和启动步骤。不兼容的任务不可选择。下载不会创建 Eval Run，也不会启动模型；正式启动仍是独立操作。

完整数据保存在当前项目的 `.comet/eval/cache/datasets/`，npm 安装包只分发元数据和适配代码。缓存不匹配时，点击重新下载会保留旧目录为 `*.previous-*`，再获取固定版本。

先查看固定来源，再下载数据。下载命令只使用 uv 和 Python 3.12 以上版本运行标准库脚本，不安装 Eval 虚拟环境，不运行容器或模型。SkillsBench 当前下载完整仓库归档，体积较大；两套归档均校验固定 SHA-256。

```powershell
comet eval --list-datasets
comet eval --dataset skillsbench --fetch-dataset --dataset-root ./.comet/eval/cache/datasets/skillsbench
comet eval --dataset workbuddy-code --fetch-dataset --dataset-root ./.comet/eval/cache/datasets/workbuddy-code --accept-dataset-license
```

WorkBuddy 使用腾讯自定义许可，包含地域限制。下载或执行前阅读 [固定版本许可](https://github.com/Tencent/workbuddy-bench/blob/625b2233093ae4f23e76be28c1f341d41cc70373/LICENSE)，接受后传入 `--accept-dataset-license`。

静态预览不启动模型、Docker、任务生成或依赖安装。省略 `--task` 可查看整个任务目录；支持逗号分隔的任务 ID。

```powershell
comet eval --dataset skillsbench --dataset-root ./.comet/eval/cache/datasets/skillsbench --task dialogue-parser,offer-letter-generator --collect
comet eval --dataset workbuddy-code --dataset-root ./.comet/eval/cache/datasets/workbuddy-code --collect
```

预览包含原始任务、工作目录、内容身份和不支持的原因。手工导入的目录按本地快照记录；来源说明不会把修改过的任务变成已验证的官方版本。

在确认任务、Agent、模型和次数后执行：

```powershell
comet eval --dataset skillsbench --dataset-root ./.comet/eval/cache/datasets/skillsbench --task dialogue-parser --count 1 --agent claude-code --model <model-id> --project . --html
```

运行会构建任务镜像、安装 Agent 和当前 Comet 依赖，并调用模型；需要 uv、Docker 以及所选 Agent 的凭据。运行 WorkBuddy 时还需传 `--accept-dataset-license`。其评分依赖会安装固定 WorkBuddy 框架及 Harbor 库，任务仍由 Comet 编排。

两套内置数据集默认不限制整个 Native 流程的总时长，避免用原题的一次 Agent 预算中断 Shape、Build、Verify 和 Archive。Dashboard 的“评估总时限”默认是 `0`（不限时），可自行设置正数时限，也可随时停止评估。命令行高级用法通过 pytest 的 `--agent-timeout` 显式覆盖时限时仍会生效；不要沿用先前连通性试跑的 `PYTEST_ADDOPTS=--agent-timeout=900`。原题评分脚本自身的时限、镜像构建和单项准备命令的边界保持独立。

完成判定读取真实 Native SDK 根 Run、归档检查点和交付终态，不依赖模型用哪种语言表示完成。SkillsBench 保留原始 `/verifier` 目录，原题部分得分与脱敏评分输出会保存在结果中。

WorkBuddy 必须使用包含根目录 `dataset.toml`、`shared/` 和原任务的完整数据集。缺少根评分配置时，预览和装配会在模型启动前报错；根配置与任务内容一起绑定到评估身份，评分前会再次检查。先前只复制 `tasks/` 和 `shared/` 的临时目录需要重新下载。

Native 组使用真实 Native Skill、SDK Runtime、模拟用户和独立 Verifier；Goal 组使用 Claude Code 原生 Goal。模拟用户只处理原需求范围内的确认，身份记录在交互信息中。原始隐藏测试不提供给执行 Agent；业务评分在执行结束后的候选副本中进行，避免注入测试或 Git 操作改变候选。

报告沿用 `.comet/eval/runs/` 和现有 Dashboard 观测入口。任务原始数值成绩以 `dataset-score` 展示，完整成功要求原始 reward 为 1；部分得分、评分错误和流程失败分别保留。报告事件保存原始评分与数据集信息，运行元数据保存固定任务计划。两套数据集的成绩分别解释。

## 与 Goal 对比

Dashboard 的“内置数据集 → 数据集执行方式”可选 Comet Native 或 Claude Code Goal。CLI 对应 `--dataset-treatment native`（默认）和 `--dataset-treatment goal`。一次启动只执行选中的方式；两组需分别启动，使用同一数据集缓存、题目、运行次数、Claude Code 版本、模型、端点和预算。

```powershell
comet eval --dataset skillsbench --dataset-root ./.comet/eval/cache/datasets/skillsbench --task dialogue-parser --dataset-treatment goal --count 1 --agent claude-code --model glm-5.3-flash --project . --html
```

Goal 组通过官方非交互入口 `claude -p "/goal ..."` 执行。原题保存在文件中，短条件引用该文件，避免超过 Goal 条件长度限制；原题正文不裁剪。使用干净工作区，不安装 Comet CLI、Skill 或 Runtime，不注入 Native 调用要求。用户确认沿用原题范围内的模拟应答规则；Goal 自己决定续行，执行器不发送 Native 的阶段推进提示。运行记录必须包含原生 Goal 命令可用的证据，否则标记执行失败，不能降级成普通提示词后仍称为 Goal。

当前仅支持 Claude Code Goal，其他 Agent 会被拒绝。Goal 评估模型通过 `ANTHROPIC_DEFAULT_HAIKU_MODEL` 固定为主模型，并写入执行身份；没有可解析的模型时在调用前报错。Goal 评估只读会话证据，最终正确性仍由原题隐藏评分器检查。详见 [Claude Code Goal 文档](https://code.claude.com/docs/en/goal)。模型或代理服务是否完整支持 Goal，仍需另行授权真实评测确认。报告若没有单独提供 Goal 评估器的 token 或费用，不把缺失值算作零，也不据此声称总成本更低。

两组完成后，在 Dashboard 选择一组为默认参照，或在“与基线对比”中选择另一组。配对依据相同原题、重复编号、数据集内容与评分适配器摘要，允许 Native 和 Goal 的执行方式不同。比较表同时显示原题数值成绩及整题是否成功；部分得分的上升也会显示。模型、端点、Agent 或预算不一致时仅并列查看。Native 的状态、归档和 Skill 调用诊断保留在各自报告中，不要求 Goal 组通过 Native 专属检查。

这是 Native 与 Goal 两套执行方式的比较，Native 组没有额外开启 Goal；不能将差异全部解释为“保持 Goal 不变后，增加 Native 的纯增益”。旧的单题调通结果没有同条件 Goal 组，且存在执行器中途修改或补评分记录，不作为本次正式对照基线自动复用。

首期限制：

- 运行层使用 Debian/Ubuntu 兼容 Linux 镜像；工作区支持 `/workspace`、`/root`、`/app` 和 `/data`。任务实际工作目录映射到同一个持久候选目录，保留原绝对路径。
- WorkBuddy 的 4 个 `repo_understanding` 任务禁止额外修改，和 Native 元数据冲突，预览明确标为不支持。选中任一不支持任务时整次启动失败，不自动换题或跳过。
- SkillsBench 当前固定目录中有 7 个其他工作目录任务未适配。其余任务仅通过静态解析，不代表已经逐题通过运行兼容性验证。
- 原任务 Agent 时限保存在来源元数据中，不作为整个 Native 流程的默认截止时间；原题评分时限仍生效。容器运行资源和网络策略沿用当前 Comet Eval 配置，不能直接将结果视为官方榜单复现。
- Dashboard 支持数据集选择、下载和配置评测。失败样本的自动重试入口尚不支持该 JSON 任务计划；可通过新建评估或数据集命令显式选择任务，产生新的 Run。

当前已验证固定下载、静态收集、适配器定向测试、构建与 Dashboard 桌面及窄屏交互。两套原题已有 [Native 完整流程调通记录](../research/2026-11-02-native-benchmark-full-task-repair.zh.md)；WorkBuddy 单题另有 [Goal 完成及 1.0 原始评分证据](../research/2026-11-03-goal-workbuddy-smoke.zh.md)。这些单题记录不代表全部任务已验证兼容，也不构成统计比较。后续真实模型评测仍须按项目规则取得明确启动请求，各层结果分别记录。
