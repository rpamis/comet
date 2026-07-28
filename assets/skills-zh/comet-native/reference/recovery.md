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

## Verify fail 与 repair stop

Verify fail 回到 Build 后：

1. 从 status details 读取 failed/missing acceptance 和 failed check；
2. 实际修复这些缺口；
3. 重新运行相关验证；
4. 再提交 Verify 结果。

相同缺口重复出现或达到 `max_verify_failures` 时，Runtime 会停止自动循环。只有 status 返回允许的 repair override，并且存在一个明确的新修复假设时，才能使用该 signature 和摘要重试一次；否则保留现场并让用户决定范围、约束或是否停止。

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
