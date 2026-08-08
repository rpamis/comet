# Native 产物参考

只在编辑 brief、完整目标规格、verification 或验收证据时读取。

## 编辑边界

每个 active change 目录只保留用户可读、可随 Git 同步的正式产物：

```text
<artifact-root>/comet/changes/<change-name>/
  comet-state.yaml
  brief.md
  specs/<capability>/spec.md
  verification.md
  evidence.md
```

Agent 只编辑 brief、完整目标规格和 verification；`comet-state.yaml` 与 `evidence.md` 由 Runtime 管理。文件尚未生成时可以不存在。

机器 Runtime 固定保存在项目本地且被 Git 忽略的 `.comet/runtime/native/`：per-change baseline、workspace、Run、trajectory、scope、receipt 与 checkpoint 位于 `changes/<change-name>/`，全局锁与事务位于 `locks/` 和 `transactions/`。artifact root 只由 `.comet/config.yaml` 指定，不改变机器 Runtime 的位置。不要手工迁移或修复 Runtime 文件。

## 证据投影

每次写入 evidence 的推进（进入或离开 Build、Verify）后，Runtime 会在 change 根重新生成只读的人类可读投影：

```text
<artifact-root>/comet/changes/<change-name>/evidence.md
```

它把项目本地 Runtime 中 hash 命名的内容寻址证据翻译成可读文字——实现范围（改了哪些文件、字节变化）、验证结论（验收点 pass/fail、覆盖统计）、检查收据（命令、退出码、摘要）。调试或排查 change 时打开它即可，不必解析机器文件。

该投影是只读衍生品：Runtime 每次推进都会覆写，不可手改，也不能当作验证证据引用。状态中的机器引用继续使用稳定的 `runtime/...` 逻辑格式，与物理存储位置无关。

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

## 完整目标规格

每个 `specs/<capability>/spec.md` 描述归档后 capability 的完整行为，不是相对旧文本的增量 patch：

- 新 capability：写完整规格；
- 已有 capability：写替换后的完整规格；
- 删除 capability：使用 CLI 的 `spec remove`，不只删除文件。

canonical 冲突时重读最新规格，按用户意图改写完整目标，再使用 Runtime 返回的 rebase 动作。不要手改 operation、base hash 或状态。

## Verification

`verification.md` 使用以下非空一级标题：

```text
# Acceptance evidence
# Commands and results
# Skipped checks
# Spec consistency
# Known limitations and risks
# Conclusion
```

记录真实命令、结果和可复核事实。未运行检查放入 Skipped checks；失败、跳过、阻塞或超时不能写成 pass。

## Acceptance evidence

使用 Runtime 返回的 acceptance ID 和 receipt ref，不自行计算或跨 change 复用。准备 JSON 条目数组，再用 `evidence format` 生成机器块并原样放入 `# Acceptance evidence`。

基本条目：

```json
[
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "passed",
    "evidence_refs": ["runtime/evidence/receipts/<sha256>.json"]
  },
  {
    "acceptance_id": "acceptance-<sha256>",
    "status": "failed",
    "evidence_refs": [],
    "skipped_reason": "实际失败或未完成原因"
  }
]
```

不要手工排版机器块。receipt 必须对应真实执行或观察，并与当前 revision、contract、scope、snapshot 和 artifact 绑定。
