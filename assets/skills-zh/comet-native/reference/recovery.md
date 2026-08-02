# Native 恢复参考

只在 Runtime 报告中断、失效证据、repair stop、冲突、锁、迁移或损坏状态时读取本文件。

## 通用原则

先停止写入并运行只读诊断：

```text
comet native doctor [<change-name>]
```

只根据 doctor 或 continuation 返回的事实采取动作。不要手改状态、hash、证据、锁或事务文件；Runtime 无法证明自动修复安全时，保留现场并等待用户。

## 工作区提示

`workspace-root-changed` 与 `workspace-inspection-unavailable` 只用于解释当前 root 事实的来源，不单独阻止推进或 Archive。不要把任意 `workspace-*` finding 都当作提示：未知的 workspace 完整性 finding 仍是错误。Runtime 要求修复工作区身份时，先运行只读 doctor，再按报告执行显式 `doctor --repair`。

## 未完成的阶段推进

status 或 doctor 报告未完成 transition 时，优先按 continuation 重试原动作。需要显式修复时：

```text
comet native doctor <change-name> --repair --strategy continue
```

普通 Shape、Build、Verify transition 只支持 continue，不支持 rollback。

## Baseline 缺失或不完整

`baseline-snapshot-missing` 或 `baseline-snapshot-incomplete` 不能用当前文件重建，也不能通过手改 evidence 修复。

只能：

1. 从可信备份恢复原 baseline；或
2. 保留用户已写的 brief、规格和实现事实，重新创建 change。

## 证据失效

brief、规格、实现、报告或 receipt 改变后，旧 scope 或 Verify pass 可能失效。按 continuation 回到 Build，重新确认发生变化的用户行为、生成新 scope 并重新验证。不要复用旧 pass 或旧 preflight。

receipt 与 revision 绑定：每次状态写入（checkpoint、规格刷新、阶段推进）都会让 revision 递增，此前签发的 receipt 会因此绑定过期。`next --result` 报 `verification-receipt-binding-mismatch` 时，finding 会列出每个过期 receipt 及其不一致字段（如 `sourceRevision: expected 6, got 5`），并给出恢复命令。只有 manual evidence 仅发生 sourceRevision 不一致时，才可以不回到 Verify，运行 `comet native receipt refresh <change> --apply` 按当前 revision 重签并写回 verification.md；contract、scope、snapshot 或 artifact 不一致都必须重新验证。automated receipt 必须用 `receipt automated` 重新执行原命令，不能静默重签。

## Verify fail 与 repair stop

Verify fail 回到 Build 后：

1. 从 status details 读取 failed/missing acceptance 和 failed check；
2. 实际修复这些缺口；
3. 重新运行相关验证；
4. 再提交 Verify 结果。

相同缺口第三次出现时，Runtime 返回 `repair-stagnation-stop`。这不是用户决策：Agent 从 status 读取 signature，提出一个与上一轮不同且具体的新的修复假设，完成对应修改后，使用该 signature 和假设摘要执行一次 repair override。不要让用户提供 signature、hash 或 override 参数。

override 已耗尽或达到 `native.max_verify_failures` 时，continuation 返回 `await-user` 和 `repair-continuation-decision`。向用户说明当前失败和已尝试方案，只让用户选择：

1. 继续尝试：由 Agent 提高 `native.max_verify_failures` 后继续；
2. 调整已确认契约：回到 Shape 更新 brief 和完整目标规格，并重新确认；
3. 停止本次修复：保留 change 和当前现场，不继续推进或 Archive。

用户只做方向选择；Agent 负责修改配置或正式产物、读取 Runtime signature，并执行后续命令。

## Canonical spec 冲突

Archive 报告 canonical spec 已变化时：

1. 重读最新 canonical spec、brief 和拟议完整规格；
2. 按用户意图改写完整目标规格；
3. 运行：

```text
comet native spec rebase <change-name> --summary <摘要>
```

4. 按 Runtime 返回的 phase 重新实现、确认和验证。

不要手改 `base_hash` 或覆盖并发变化。

## Archive 中断

先运行 doctor，确认 transaction 和允许的恢复方向：

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue`：继续完成归档；
- `rollback`：恢复 active change；
- doctor 未提供 rollback 时，不要自行回退。

出现 journal 与实际文件不一致、路径冲突或无法证明安全时，保留所有相关目录并停止自动修复。

## Artifact root 迁移中断

存在 `pending_root_move` 时，普通 Native 写命令会停止。运行 doctor，并只执行报告允许的 continue 或 rollback。

如果旧 root 与新 root 不一致，不删除任何一棵目录；把 doctor 返回的两条路径交给用户处理。

## 锁、selection 或损坏产物

- 不手动删除锁。只在 doctor 明确判断可安全接管时使用 `--repair`。
- doctor 可以清理指向不存在 change 的 selection。
- 损坏的 config、change 状态、brief、规格或 verification 不会被自动猜测重写。
- doctor 无法确定 owner、事务或文件身份时，保留现场并停止。
