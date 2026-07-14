# Native 恢复参考

## 上下文恢复顺序

每次恢复都从磁盘事实开始：

1. 读取项目 `comet.config.yaml`，确认唯一 artifact root；若有 `pending_root_move`，先运行 doctor。
2. 运行 `comet native status`；多个 active change 时读取 Native selection 或让用户明确选择。
3. 对目标 change 运行 `show`，读取 `change.yaml`、brief、拟议完整规格与 verification。
4. 读取相关 canonical 规格、实现、规则、测试和当前工作区状态。
5. 根据 phase 执行 Shape、Build、Verify 或 Archive，不依赖聊天记录猜阶段。

状态、Run state、trajectory 或 transaction journal 畸形时停止写入并运行只读 doctor。不要通过手工改 phase 来绕过问题。

## Archive 事务

Archive 使用全局锁、staged specs、逐操作事件日志和备份。中断时 canonical 树可能处于事务中间状态，但 journal 会保留未完成事实。

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue`：从最后一个已完成操作继续，收敛到 committed archive。
- `rollback`：按逆序恢复 canonical 文件和 active change。
- finalization 已开始后只能 continue，避免产生“已完成证据但又恢复为 active”的矛盾状态。

先阅读 doctor 的路径、transaction id 和冲突信息。若 hash 与 journal 两端都不一致，保留所有树并停止自动修复。

## Artifact root 迁移

`root move` 依次经过 `copying`、`ready`、`switched`。配置中的 `pending_root_move` 是恢复事实源；存在时普通 Native 写命令会失败关闭。

- `copying`：旧 root 是当前根，目标 staging 可能不完整。
- `ready`：staging 已通过逐文件路径、大小和 SHA-256 校验，尚未切换配置。
- `switched`：配置已指向新 root，旧 root 只有在再次校验后才会删除。

使用 doctor 的显式 continue 或 rollback。若两棵树 hash 不一致，不删除任何一棵，并把报告中的两条路径交给用户处理。

## 锁与安全修复

doctor 区分活动锁、可证明陈旧的本机锁和无法判断的远端锁。只在 owner 进程确定不存在且没有未处理事务依赖时删除陈旧锁；不自动破坏活动或未知锁。

doctor 可以安全清理指向不存在 change 的 selection。它不会自动重写损坏的配置、change YAML、brief、规格或 verification；这些内容必须根据用户意图人工修正后重新检查。
