# Native 命令参考

只在 Runtime 要求高级输入、receipt、partial scope 或诊断动作时读取。命令签名、选项、示例和输出以 CLI 为准：

```text
comet native --help
comet native <command> --help
comet native <group> <command> --help
```

不要从本文件复制旧参数；优先执行后续指令（`continuation`）的 `commandArgs`，并按 `inputOptions` 填入真实值。所有命令可使用 `--json` 和 `--project-root`。

## 结构化输出

JSON 外层包含 `command`、`exitCode`、`data`，失败时包含 `error`。常用动作字段：

- `continuation.disposition`（后续指令的处置）：`continue | await-user | blocked | done`；
- `commandArgs`：完整 executable 与 argv 模板；
- `inputOptions`：必需输入、flag、候选值、重复性和互斥备选；
- `workspace` / `preparation`：change 实际目录与本次创建结果；
- `nextPageArgs`：状态或 acceptance（验收项）的翻页参数；
- `findings`：`requiredAction`、`retryCommand`、`repairCommand` 和是否需要用户决定；
- `workspaceFinishResult`：归档后的 Git 收尾结果和恢复动作。

不要把包含尖括号的占位符原样执行，也不要在 `await-user` 时自动执行模板。

## 必须保留的语义

- Shape 或 Build 重新确认：只有用户确认共享理解后才使用 `--confirmed`。
- Build：真实文件用 artifact 输入；无代码只在事实成立时使用 no-code 备选。
- Verify/Archive 中途增加当前范围：先使用 `--return-to-build`，重新读取状态后再修改实现。
- Partial scope：只在用户接受 Runtime 报告的具体缺口后，使用完全匹配的 hash、理由和确认输入。
- Verify：报告直接引用真实 automated/manual receipt；不要伪造 required-check receipt。
- Receipt refresh：默认只读分类；仅 source revision 不一致的 manual receipt 可安全重签。automated receipt 必须重跑，contract/scope/snapshot/artifact 不一致必须重新验证。
- Repair override：只使用当前 status 返回的 signature，并对应一个新的具体修复假设。
- Archive：`--finish` 只用于持久化已确认的隔离 workspace 收尾选择；执行时使用同一次检查返回的 preflight。

## 诊断

先使用只读 `doctor`。仅当输出提供 repair 动作时才使用 `--repair` 和它允许的 strategy。不要手动删除锁、改 hash 或编辑事务。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 内置检查发现问题或结果失效 |
| `64` | 参数或用法错误 |
| `65` | 配置、状态或产物无效 |
| `70` | 未预期的内部失败 |
| `73` | 锁、事务、并发、workspace 或收尾冲突 |
| `75` | repair stagnation 或失败预算阻塞继续 |
