# Native 恢复参考

## 上下文恢复顺序

每次恢复都从磁盘事实开始：

1. 读取项目 `.comet/config.yaml`，确认唯一 artifact root 和 `native.clarification_mode`；该字段缺失时使用 `sequential`。若有 `pending_root_move`，先运行 doctor。
2. 运行只读的 `comet native status`；多个 active change 时读取项目级共享 `.comet/current-change.json`，确认 `workflow: native` 和目标 change，或让用户明确选择。
3. 对目标 change 运行只读的 `show` 和 `status <change-name> --details`，读取 `comet-state.yaml`、brief、拟议完整规格、verification、有界结构化 findings、`findingsTruncated` 标记和最新 checkpoint。若 findings 被截断，先处理已返回项，再重新读取 details；Verify/Archive 的验收 ID 则按 `acceptancePage.nextCursor` 独立分页取得，不依赖丢失的旧响应。
4. 目标确认后运行 `comet native select <change-name>` 建立共享 selection；没有单独的 `resume` 命令，且只读命令不会隐式选择 change。
5. 读取相关 canonical 规格、实现、规则、测试和当前工作区状态。
6. 根据 phase 执行 Shape、Build、Verify 或 Archive，不依赖聊天记录猜阶段。

状态、Run state、trajectory 或 transaction journal 畸形时停止写入并运行只读 doctor。不要通过手工改 phase 来绕过问题。

## 澄清轮次恢复

Shape 或 Build 存在 `[blocking]` 时，从 brief 的 Open questions 恢复当前未决事项，不依赖聊天记录重建答案。Sequential 模式恢复一个最上游问题；Batch 模式按已保存编号恢复本轮全部可回答问题。切换配置不会消除已有阻塞项：先把用户答案对应回已保存问题，再按当前 `clarification_mode` 计算下一轮。

能从仓库、工具或运行环境查明的事实继续由 Agent 调查。宿主支持并行工作时可以并行查证，但恢复不能依赖任何可选的并行能力；调查中的事实只延后依赖它的问题。

Batch 模式中，未回答的问题继续保持 `[blocking]`。全部问题解决后仍要恢复或建立最终共享理解确认；只有用户明确确认后，才能移除该阻塞项并进入 Build。该过程不增加新 phase、change 状态字段或独立决策树文件。

长任务在同一 phase 内中断前可写 checkpoint：

```text
comet native checkpoint <change-name> \
  --summary <已完成事实> \
  --next-action <下一动作> \
  [--artifact <项目相对路径>] \
  [--expect-revision <n>]
```

恢复时先检查 checkpoint 的 freshness。phase、revision 或 manifest 已变化时把它当历史提示，不把旧下一动作强行应用到新状态；Runtime 会在 details 中显式报告 stale 原因。

## 普通阶段推进

`next` 在 change 的 `runtime/transition.json` 先写入 prepared journal，再更新 Run state、`comet-state.yaml`、trajectory 和 checkpoint。全部完成后才删除 journal。

`status` 和 doctor 会报告未完成 transition。再次运行 `next` 或进入 Archive 时，runtime 会先确定性续做；也可以显式执行：

```text
comet native doctor <change-name> --repair --strategy continue
```

普通阶段推进没有 canonical 文件副作用，因此只支持 `continue`，不支持 `rollback`。journal 畸形时保留原文件并停止，不手工拼接状态。

## Baseline 缺失或不完整

`new` 要求 baseline 完整。Git 项目只评估 tracked 与未被 ignore 的 untracked 文件；ignored 缓存和嵌套仓库内容不会制造省略。

若 Runtime 返回 `baseline-snapshot-missing` 或 `baseline-snapshot-incomplete`，不要用当前文件重建 baseline，也不要把它当成 doctor 可自动修复的问题。这会丢失 change 创建以来的历史差异。

只能从可信备份恢复原 baseline，或保留用户编写的 brief、规格和实现事实后新建 change，重新建立完整 baseline。

## 证据失效与受控回退

进入 Verify 后，若 brief、拟议规格或项目快照变化，status 会先把失效的 implementation scope 指向受控回退；运行返回的仅含摘要的 `next` 命令回到 Build，再为变化后的 contract 取得重新确认并生成新 scope。进入 Archive 后，implementation scope、verification report 或 check receipt 等任一绑定事实变化也会触发同一回退。不要删除 finding、沿用旧 pass 或手工替换 hash ref。

Archive 必须使用两步预演，不能把一次旧的 ready 判断当作提交授权：

```text
comet native archive <change-name> --dry-run
comet native archive <change-name> --expect-preflight <刚返回的-sha256>
```

第二步在锁内重算 contract、canonical base、scope、verification、当前 root 冲突与恢复状态；任何变化都会拒绝并要求重新预演。

## Verify fail 与修复停止

Verify fail 会诚实回到 Build。提交稳定、非敏感的 `--failure-category` 和 `--failed-check` 后，Runtime 先校验 token、数量与边界，再以 failure + contract + scope 形成签名：同签名第二次告警，第三次且 scope 无进展时 manual stop，单个 episode 累计到语义上限时 hard stop。

- implementation scope 真正变化：说明已有机械进展，普通 Build `next` 结束旧 episode 并自动开始新一轮；之前的 hard stop 不会锁死新实现。
- scope 未变化但有一个明确新假设：只能使用 status 返回的 signature 和非空摘要做一次 `--override-repair`。
- 同一签名已 override、或达到 hard stop：不能弱化验证或伪造 pass；保留现场并请用户决定范围、约束或是否停止。

一次 pass 会结束当前 repair episode；之后若旧 Archive 证据失效并重新出现相同 failure，它是新的 episode，但原 trajectory 仍保留审计事实。通用 Engine iteration budget 不参与这个产品语义。

## Canonical spec 冲突

若另一个 change 在当前 change 冻结 `base_hash` 后改变了同一 canonical spec，Archive 会停止。不要手改 hash：

1. 重读最新 canonical spec、brief 和拟议完整规格；
2. 按用户意图改写完整目标规格，必要时先解决一个用户决定；
3. 运行 `comet native spec rebase <change-name> --summary <摘要>`；
4. runtime 刷新 operation/hash，把 change 受控重开到 Build，并清除旧验证结论；
5. 重新实现、在需要时用 `--confirmed` 记录刚确认的决定、重新 Verify 和 Archive。

若 remove 的目标已经被并发 change 删除，rebase 会移除已满足的 remove 意图；其他 remove 会冻结最新 canonical hash 后重新验证。

## 当前工作区内的并行提示

status/Archive 会比较当前 Native root 中可见 change 的 capability、operation、base hash 和声明产物：确定冲突必须先解决；可能重叠也会在归档前阻塞。它不能看到未集成 worktree、远端分支或其他机器，因此不是分布式锁。

`workspace-root-changed` 和 `workspace-inspection-unavailable` 是显式 advisory，只用于解释当前 root 的事实来源，不单独阻止推进或归档。finding 会列出 `native-root-ref`、`project-root-path`、`native-root-path` 等具体漂移组件。Native 默认不读取 Git branch、HEAD 或 worktree changed paths。

不要把任意 `workspace-*` 都当成提示。未知 workspace 完整性 finding 仍按错误处理；Runtime 要求修复 workspace 身份时，先运行只读 doctor，再按报告执行显式 `doctor --repair`。

## Archive 事务

Archive 使用全局锁、staged specs、逐操作事件日志和备份。中断时 canonical 树可能处于事务中间状态，但 journal 会保留未完成事实。

Archive 的 stage、backup、apply 与 rollback copy 都通过受保护句柄读取：打开前后复核源文件、realpath、父目录身份、大小与预期 hash，目标在原子提交前再次检查。它不会因为事前路径包含检查通过，就信任后续路径仍指向同一文件。

write/remove 会先把 canonical 原对象身份和原内容绑定进事务，再原子改名到同目录隔离位并复验；write 使用事务私有 candidate 和无覆盖安装，rollback 也必须先隔离并验证 post 对象，再无覆盖恢复 original。即使并发替换后的内容 hash 恰好相同，只要它已经是另一个文件对象，Runtime 仍会拒绝覆盖并保留现场。

`events.jsonl` 读取有总字节、事件数量和单事件预算。崩溃若只留下最后一个 canonical JSON 事件的可证明前缀，Runtime 会在下一次 append 前按原始 bytes 的 hash/size 做 CAS，并原子重写到最后一个完整事件；中间坏行、完整但非法的尾行、非规范 JSON 尾部或并发改写一律 fail closed。完整但没有末尾换行的事件不会被误删，重复操作按 `type + operationId` 保持 exactly-once。

```text
comet native doctor <change-name>
comet native doctor <change-name> --repair --strategy continue
comet native doctor <change-name> --repair --strategy rollback
```

- `continue`：从最后一个已完成操作继续，收敛到 committed archive。
- `rollback`：按逆序恢复 canonical 文件和 active change。
- Runtime 会先验证已移动的 archive tree、最终 state、受保护 Run、trajectory 事件和完成决定，随后才写 `archive-finalization-started`。标记写入前仍可安全 rollback；标记写入后已经跨越不可回滚边界，只能 continue，避免产生“已完成证据但又恢复为 active”的矛盾状态。

先阅读 doctor 的路径、transaction id 和冲突信息。若 hash 与 journal 两端都不一致，保留所有树并停止自动修复。

## Artifact root 迁移

`root move` 依次经过 `copying`、`ready`、`switched`。配置中的 `pending_root_move` 是恢复事实源；存在时普通 Native 写命令会失败关闭。

- `copying`：旧 root 是当前根，目标 staging 可能不完整。
- `ready`：staging 已通过逐文件路径、大小和 SHA-256 校验，尚未切换配置。
- `switched`：配置已指向新 root，旧 root 只有在再次验证两棵树等价、父链与目录身份后，才会先改名到事务 ID 绑定的 sibling quarantine，再复核删除。中断时 continue/rollback 会识别该 quarantine 并确定性收口，不会按旧路径直接递归删除。

使用 doctor 的显式 continue 或 rollback。若两棵树 hash 不一致，不删除任何一棵，并把报告中的两条路径交给用户处理。

## 锁与安全修复

doctor 区分活动锁、可证明陈旧的本机锁和无法判断的远端锁。只在 owner 进程确定不存在且没有未处理事务依赖时删除陈旧锁；不自动破坏活动或未知锁。

锁同时绑定 owner 元数据、锁文件身份和进程内 FIFO。普通 mutation 不会因为看到“看似过期”的时间戳就自动恢复；只有显式 doctor repair 才能执行带身份复验的 takeover，避免旧 owner 在新 owner 获锁后删除新锁而形成 split-brain。

doctor 可以安全清理指向不存在 change 的 selection。它不会自动重写损坏的配置、change YAML、brief、规格或 verification；这些内容必须根据用户意图人工修正后重新检查。

Evidence retention 遵守显式修复边界。默认 doctor 只报告候选；`--repair` 仅删除至少 30 天、每种 evidence kind 最新 32 份之外，并且依赖闭包证明未引用的 active-change 派生 evidence/receipt。

删除按 dependents-before-dependencies 排序，并先改名到同目录唯一 `.gc` quarantine。若在最终删除前中断，后续只读 doctor 报告 `evidence-retention-recovery-required`；显式 repair 仅在原路径不存在、quarantine 内容与身份有效时无覆盖恢复。

出现原文件与 quarantine 冲突、多份 quarantine、归档证据、pending 恢复、缺失依赖、损坏文档、未知目录项、symlink 或其他特殊文件时，推迟清理并失败关闭。
