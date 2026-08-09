# Native 产物参考

只在编辑 brief、完整目标规格，或查看 Runtime 生成的验收报告时读取。

## 编辑边界

每个 active change 目录只保留用户可读、可随 Git 同步的正式产物：

```text
<artifact-root>/comet/changes/<change-name>/
  comet-state.yaml
  brief.md
  specs/<capability>/spec.md
  verification.md
```

Agent 只编辑 brief 和完整目标规格。`comet-state.yaml` 与 `verification.md` 由 Runtime 管理；报告在首次有效 Verify 前可以不存在。

本机 Runtime 固定保存在被 Git 忽略的 `.comet/runtime/native/`。每个 active change 只使用 `changes/<change-name>/state.json` 和 `logs/`；项目级锁与短生命周期事务位于同一 Runtime 根。不要手工创建、迁移或修复这些文件。

## 可携带状态与报告

`comet-state.yaml` 是稳定工作流边界的可携带语义权威，保存 phase、status、状态版本、Loop 计数、验收结果、Builder handoff、blocker、下一动作、检查摘要和精简历史。它不记录本机进程、绝对路径或完整命令输出，Agent 不得手改。

`verification.md` 是 Runtime 根据同一 YAML 状态版本生成的人类可读投影。报告缺失或落后时只需重建报告，不重新执行检查或 Verifier；Markdown 正文不能反向推进机器状态。

`.comet/config.yaml` 决定 workflow 和 artifact root。需要跨设备自动发现非默认根时同步该文件；其余 `.comet/*` 仍保持本机私有。

## Brief

`brief.md` 使用以下非空一级标题：

```text
# Outcome
# Scope
# Non-goals
# Acceptance examples
# Constraints and invariants
# Decisions
# Open questions
# Verification expectations
```

Open questions 中只有真实未解决的用户问题使用：

```text
- [blocking] <Sequential 当前问题>
- [blocking] Q1: <Batch 问题>
- [blocking] CONFIRM: <最终共享理解>
```

每个决定确认后立即写入 Decisions 和完整目标规格，再移除对应阻塞项。不要保存隐藏推理。

验收标准必须具体、可观察且互不重复。使用简单顺序 ID，例如 `A1`、`A2`、`A3`；ID 只用于结果映射，不从内容计算，也不代表文件身份。Runtime 在 Shape 确认时保存完整验收文字及其来源。

## 完整目标规格

每个 `specs/<capability>/spec.md` 描述归档后 capability 的完整行为，不是相对旧文本的增量 patch：

- 新 capability：写完整规格；
- 已有 capability：写修改后的完整规格；
- 删除 capability：使用 CLI 的 `spec remove`，不只删除文件。

canonical 冲突时重读最新规格，按用户意图改写完整目标，再使用 Runtime 返回的 rebase 动作。不要手改 operation 或状态。

## Verification

`verification.md` 由 Runtime 生成，建议结构如下：

```text
# Verification
## Current result
## Acceptance
## Checks
## Blockers
## Risks and skipped work
## Previous iterations
## Conclusion
```

报告展示每个验收项的结果和原因、真实检查的脱敏命令预览与状态、阻塞项、风险以及精简 Loop 历史。完整 stdout/stderr 只留在本机日志。

不要手写或修补报告来改变结论。失败、阻塞、未运行或超时不能显示成通过；只有 YAML 中当前候选的完整验收结论和成功必要检查可以形成最终 pass。
