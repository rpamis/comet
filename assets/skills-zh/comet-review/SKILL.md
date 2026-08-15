---
name: comet-review
description: "手动审查当前 Comet change 的实现差异，只报告正确性、安全和边界问题，不推进工作流。"
disable-model-invocation: true
---

# Comet 手动代码审查

对当前选中的 Comet change 执行一次按需、只读的代码审查。这个入口不属于任何阶段，也不替代 Build 或 Verify 的验证和审查。

本入口独立于 `review_mode`：`review_mode` 控制流程内的自动 review 策略，而 `/comet-review` 只代表用户手动触发的单次审查；调用本入口不得读取、修改或覆盖当前 change 的 `review_mode`。

## 不可变约束

本 Skill 的整个调用必须保持只读：

- 不修改、创建或删除文件；
- 不暂存、提交、切换分支、创建分支或创建 worktree；
- 不运行 `comet state select`、`comet native select`、`comet state set`、`comet state transition`、阶段守卫、`comet native next` 或归档命令；
- 不修复发现的问题，不推进 phase，不更新 tasks、状态、验证报告或审查记录；
- 不把本次结果称为 Verify 通过，也不把“没有发现”视为测试已经通过。

只允许执行读取文件、查询状态和查看 Git 差异所需的命令。任何可能运行项目代码、安装依赖或产生文件的检查都不属于本入口。

## 1. 定位项目与当前 change

1. 使用只读 Git 查询确定项目根目录；如果不是 Git 仓库，则使用当前 Comet 项目根目录。
2. 在项目根目录运行：

   ```bash
   comet status . --json
   ```

3. 读取 `.comet/current-change.json`，并按以下顺序确定审查对象：
   - 文件包含有效的 `comet.selection.v2` 时，使用其中的 `workflow` 和 `change`；
   - selection 缺失，且状态输出中只有一个未归档的 Comet change 时，只在本次审查内采用该 change，不写入 selection；
   - selection 缺失且存在多个 change 时，列出名称、workflow 和 phase，请用户指定一个后停止；
   - selection 指向缺失、已归档或状态无效的 change 时，报告 stale/invalid selection 后停止，不自行修复。

忽略不受 Comet 管理的普通 OpenSpec change。不得因为默认 workflow 与 selection 不同而改用默认 workflow。

## 2. 收集审查上下文

只读取当前 change 的必要上下文，并为每个事实保留来源路径或命令。

### Classic

1. 先读取并遵守 `comet-classic/reference/classic-layout.md`，解析当前项目的 Classic 逻辑根。
2. 读取当前 change 的 `proposal.md`、`design.md`、`tasks.md` 和 `specs/*/spec.md`；存在关联 Design Doc 时一并读取。
3. 使用以下只读状态查询获得 phase、基线和已有证据引用：

   ```bash
   comet state get <change-name> phase
   comet state get <change-name> base_ref
   comet state get <change-name> plan
   comet state get <change-name> verification_report
   ```

4. 读取存在的 plan、验证报告，以及 `comet status . --json` 返回的 build/verify command checks。缺失证据应标为“未提供”，不能推断为失败或通过。

### Native

运行以下只读命令：

```bash
comet native show <change-name> --json
comet native status <change-name> --details --json
```

读取返回的 brief、完整 proposed Specs、acceptance、Builder handoff、checks、verification、risks、blockers 和 verification report 引用。只使用当前 candidate/iteration 的证据；历史轮次仅用于解释残留风险，不得覆盖当前状态。

## 3. 确定实现差异

1. 先运行 `git status --short --untracked-files=all`，完整枚举已暂存、未暂存和未跟踪的工作树状态。
2. 结合当前 change 的需求、工作区绑定、Git 历史和工作树状态，确定最可信且与当前 change 相关的审查范围。对于 Classic，优先使用有效的 plan `base-ref`；不存在或无效时回退到状态中的 `base_ref`，不要求两者一致。只有两者均无效时，才将 Classic 基线视为缺失。对于 Native，将状态中的工作区关系和当前 candidate 的实现范围证据作为判断依据。
3. 查看从可信基线到当前工作树的完整差异，包括已提交、已暂存和未暂存修改。对属于当前 change 的所有未跟踪文件，包括源码、测试、文档、配置和元数据（例如 `SKILL.md` 与 `agents/openai.yaml`），直接读取内容并明确标注其未跟踪状态。
4. 排除明确归属于其他 change 或用户无关工作的差异。只有歧义会实质影响审查结论时才询问用户；否则基于现有证据继续审查，并在结果中说明范围判断和假设。

如果结合上述证据仍无法确定可信且可验证的基线，继续审查当前可见的工作树差异，并在结果中显著标注“审查范围不完整”。

## 4. 执行审查

根据需求、任务和当前差异进行一次聚焦审查，只检查：

- 实现正确性和明显逻辑错误；
- 安全风险、权限或路径边界问题；
- 错误处理、兼容性和重要边界条件；
- 任务遗漏、实现与当前 change 明确要求不一致；
- 测试是否覆盖本次行为变化，以及已有测试证据能否支撑相应结论。

不要把风格偏好、无关重构或没有具体影响的猜测列为 finding。每条 finding 必须能指向具体文件和行号，并说明可触发的行为或风险；证据不足时降低严重度或放入“开放问题”。

严重度仅使用：

- `CRITICAL`：安全破坏、数据丢失或核心流程不可用；
- `IMPORTANT`：明确的正确性错误、核心验收遗漏或高概率回归；
- `WARNING`：真实但非阻塞的边界风险或测试缺口；
- `SUGGESTION`：有明确收益但不影响当前正确性的改进。

## 5. 输出

先输出 findings，按严重度排序。每条使用以下格式：

```text
[IMPORTANT] 简短标题 — path/to/file.ts:123
影响：什么输入或场景会出现什么错误。
依据：与 diff、任务、规格或证据的具体对应关系。
```

随后输出：

- `审查范围`：workflow、change、phase、基线、纳入的差异和任何范围限制；
- `证据状态`：已读取的测试/构建/验证证据及其新鲜度，不重新执行测试；
- `开放问题`：只有确实阻碍判断的问题；
- `结论`：finding 数量汇总，或明确写“未发现具体问题”。

即使没有 finding，也必须说明残余风险和未执行的检查。结尾固定提醒：

> 这是只读的手动审查，不会推进 Comet phase，也不能替代 `/comet-verify` 或 Native Verify。

如果用户随后要求修复 finding，把修复视为新的写入任务，退出本 Skill，并按仓库当前工作流规则重新进入开发流程。
