# Native 命令参考

只在需要主 Skill 未列出的参数、receipt、partial scope、外部角色交接或恢复命令时读取本文件。

## 项目与 change

```text
comet native init [--root <artifact-root>] [--language en|zh-CN]
comet native root show
comet native root move <artifact-root>

comet native new <change-name> [--language en|zh-CN]
comet native list [--cursor <token>]
comet native show <change-name>
comet native status [--cursor <token>]
comet native status <change-name> [--details [--acceptance-cursor <token>]]
comet native select <change-name>
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
```

`artifact-root` 是项目内相对路径。`new` 在配置缺失时创建默认配置和 `<project>/docs/comet/`。已有配置需要迁移根目录时使用 `root move`，不要直接改配置。

`status` 和 `show` 是只读命令。`new` 和 `select` 会建立当前 Native selection。多个候选无法唯一判断时让用户选择。

`status <change-name> --details` 返回详细 findings 和 acceptance 页：

- `findingsTruncated` 为 true 时，先处理已返回项，再重新读取；
- `acceptancePage.nextCursor` 非空时，用 `--acceptance-cursor` 继续读取；
- change 集合的 `nextCursor` 非空时，用 `--cursor` 继续读取。

canonical 规格发生并发变化时，先重读并改写完整目标规格，再运行 `spec rebase`。不要手改 operation 或 hash。

## Checkpoint 与检查

```text
comet native checkpoint <change-name> \
  --summary <text> \
  --next-action <text> \
  [--artifact <project-relative-path>]... \
  [--expect-revision <n>]

comet native check <change-name>
comet native evidence format [--entries <path>]
```

checkpoint 只保存恢复摘要和真实产物引用，不改变 phase，也不能代替完成证据。

`check` 是 Native 内置检查，不替代项目测试。发现问题或证据失效时返回退出码 `1`。

`evidence format` 从 stdin 或 `--entries` 读取验收条目，输出可原样粘贴到 `verification.md` 的规范机器块。

## Acceptance receipt

自动验证：

```text
comet native receipt automated <change-name> \
  [--acceptance <id>]... \
  [--timeout-ms <milliseconds>] \
  -- <executable> [args...]
```

人工观察：

```text
comet native receipt manual <change-name> \
  --acceptance <id> \
  --responsible <text> \
  --step <text> \
  --observation <text> \
  --confirmed
```

只为真实执行的命令或人工观察生成 receipt。失败、跳过、阻塞或超时结果不能作为 pass。

## 外部审核交接

高风险 change 的 pass 可能要求 implementation attestation、independent review 或 waiver。当前 Agent 可以准备和最终导入交接产物，但不得执行外部角色的 approve/sign，也不得接收其私钥。

Implementation 交接：

```text
comet native receipt implement <change-name> prepare \
  --identity <implementation-identity> \
  --output <preparation.json>

comet native receipt implement <change-name> finalize \
  --preparation <preparation.json> \
  --attestation <owner-provided-attestation.json> \
  --confirmed
```

Independent review 交接：

```text
comet native receipt review <change-name> prepare \
  --implementation-receipt <ref> \
  --report <verification.md> \
  --required-receipt <ref> \
  --identity <reviewer-identity> \
  [--unified-io-receipt <ref> \
   --adversarial-paths-receipt <ref> \
   --generated-assets-receipt <ref> \
   --lifecycle-eval-receipt <ref>] \
  --output <preparation.json>

comet native receipt review <change-name> finalize \
  --preparation <preparation.json> \
  --approval <reviewer-provided-approval.json> \
  --attestation <reviewer-provided-attestation.json> \
  --confirmed
```

外部角色根据 preparation 完成审批或签名，并只把公开产物返回当前 Agent。Runtime 要求 waiver 时，也由外部 waiver signer 执行 continuation 指定的命令；当前 Agent 只提交返回的 waiver ref。

## 阶段推进

```text
comet native next <change-name> --summary <text> \
  [--confirmed] \
  [--artifact <project-relative-path>]... \
  [--no-code-reason <text>] \
  [--allow-partial-scope <sha256> --partial-reason <text> --confirmed] \
  [--result pass|fail] \
  [--report <change-relative-path>] \
  [--receipt <required-receipt-ref>] \
  [--evidence-receipt <acceptance-receipt-ref>]... \
  [--waiver <waiver-ref>]... \
  [--independent-review-receipt <review-receipt-ref>] \
  [--failure-category <token>]... \
  [--failed-check <token>]... \
  [--override-repair <sha256> --override-summary <text>]

comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <sha256> [--confirmed]
```

- Shape：只有用户确认最终共享理解后才传 `--confirmed`。
- Build：提供真实 `--artifact`；确实没有项目文件变化时使用 `--no-code-reason`。
- Partial scope：先向用户说明 Runtime 返回的具体缺口和风险。超出已返回明细预算的变化由 `scope-detail-overflow` 数量和内容 hash 汇总；只有用户接受后才使用完全匹配的 scope hash、理由和 `--confirmed`。
- Verify：提供 `--result` 和完整报告。标准报告路径提交为 `comet native next <change-name> --summary <摘要> --result pass|fail --report verification.md`；pass 需要 Runtime 要求的当前 receipts，fail 使用稳定、非敏感的失败分类和检查 ID。
- Repair override：只使用 status 返回的 signature，并且只在有一个明确新修复假设时执行。
- Archive：先 dry-run，再使用本次预演返回的精确 preflight hash；`required` 模式还需要用户明确确认。

## 诊断与恢复

```text
comet native doctor [<change-name>]
comet native doctor [<change-name>] --repair
comet native doctor [<change-name>] --repair [--strategy continue|rollback]
```

先运行只读 doctor。只有报告给出可修复动作时才使用 `--repair`。普通阶段 transition 只支持 `continue`；Archive 或 root move 是否允许 rollback 以 doctor 返回为准。

## 输出与退出码

所有命令支持 `--json`。JSON 模式返回一个包含 `command`、`exitCode`、`data`，以及失败时 `error` 的对象。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 内置检查发现问题或结果失效 |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或产物无效 |
| `73` | 锁、事务、并发或根目录冲突 |
| `75` | repair stagnation 或失败预算阻塞继续 |
| `70` | 未预期的内部失败 |
