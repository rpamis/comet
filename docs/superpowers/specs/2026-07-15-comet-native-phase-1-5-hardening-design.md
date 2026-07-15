# Comet Native Phase 1.5 Hardening Design

> 状态：已确认
>
> 范围：在 Phase 1 独立 Native 系统上闭合强模型工作流的机械边界，不开始 Phase 2 入口路由。

## 1. 目标

Phase 1.5 只收紧已经存在的 Native 边界：

1. Shape 或 Build 中出现的高影响用户决定必须通过 Native 命令记录，模型不能手工改运行时状态。
2. 普通阶段推进必须能从任意跨文件写入中断点恢复，并在并发命令下保持单写者语义。
3. proposed spec 的 operation 与 canonical base hash 由运行时管理，冲突后有受控的 rebase 路径。
4. change state、Engine Run、trajectory 与 checkpoint 必须能被一致性诊断发现漂移。
5. eval 必须同时覆盖无需澄清、必须澄清、仓库事实调查和中断恢复，而不只覆盖单轮 happy path。

它不增加 phase、计划模式、TDD 模式、review 模式、外部 Skill、Native/Classic 转换或动态路由。

## 2. Shape / Build 的决策接口

模型只负责：

- 编辑 `brief.md`；
- 在 `specs/<capability>/spec.md` 写完整目标规格；
- 对删除长期 capability 使用显式 Native spec remove 命令；
- 在 Shape 或 Build 中发现高影响未知项时写入 `- [blocking]`；
- 在用户确实回答后更新 Decisions、移除 blocking 项，并为 `next` 传入 `--confirmed`。

`approval` 与 `spec_changes` 保留在 `change.yaml` 作为可审计投影，但只能由 runtime 写入。删除 `confirmation_required`：未回答的问题由 brief 中的 `- [blocking]` 持久阻塞；回答后写入 Decisions、移除 blocking 项，并以 `--confirmed` 记录确认事实。

```text
comet native next <change-name> --summary <text> [--confirmed]
comet native spec remove <change-name> <capability>
comet native spec rebase <change-name> --summary <text>
```

无 `--confirmed` 的成功 Shape 或 Build 推进记录 `approval: implicit`；带有该参数时记录 `approval: confirmed`。Verify 拒绝 `--confirmed`，任何确认方式都不能绕过 blocking 项。

## 3. Spec 元数据同步

每次 `next` 在内存中扫描 `changes/<name>/specs/*/spec.md`：

- canonical 不存在时推断为 `create`，base hash 为 `null`；
- canonical 存在时推断为 `replace`，首次发现时冻结当前 SHA-256；
- 已冻结的 create/replace 元数据在后续推进时保留，不能通过重新扫描悄悄接受并发 canonical 变化；
- proposed spec 被删除时，尚未进入 archive 的 create/replace 元数据从候选状态移除；
- remove 由 `spec remove` 创建，命令验证 canonical 存在并冻结 SHA-256；
- 同一 capability 同时存在 proposed spec 和 remove 意图时失败关闭。

守卫失败不写回同步结果。守卫成功时，候选 `spec_changes` 与 phase transition 在同一个可恢复推进中持久化。

Archive 发现 canonical hash 冲突后，模型必须重读最新 canonical spec 并改写完整目标 spec，再运行 `spec rebase`。该命令在锁内刷新 operation/base hash，通过 transition journal 把 change 受控重开到 Build，并清除旧 verification 结论；它不会自动合并语义，也不会让旧验证继续生效。

## 4. 可恢复阶段推进

每个 change 使用单个 `runtime/transition.json` 作为普通推进的 write-ahead journal。journal 保存：

- transition id 与 evidence hash；
- previous/next change state；
- previous/next Engine Run state；
- 待追加的 trajectory 事件数据；
- checkpoint 所需的信息。

推进顺序固定为：

1. 原子写 prepared journal；
2. 写 next Run state；
3. 写 next `change.yaml`；
4. 按 transition id 幂等追加 trajectory；
5. 写 checkpoint；
6. 删除 journal。

`next` 在处理新证据前自动继续未完成 journal。`archive` 在归档前也先完成 pending transition。`status/doctor` 报告未完成 journal；`doctor --repair --strategy continue` 可以显式续做。普通 phase transition 没有外部文件副作用，因此只支持确定性 continue，不提供 rollback。

所有会改变 Native root 或 change 的命令都使用同一锁协议：需要同时操作两者时固定按 root mutation lock → change lock 获取。journal 必须先于 `run_started` 和任何 next-state 写入落盘。只有不存在 pending root move、archive/transition transaction 时，doctor 才能清理可证明陈旧的锁；未知或未完成事务一律阻塞新的 mutation。

`status` 与 `doctor` 同时检查 change phase、Run phase、最后 trajectory transition 和 checkpoint 是否一致。任何一处漂移都 fail closed，不把聊天上下文当作恢复依据。

## 5. Eval

Phase 1.5 提供以下可静态验证的场景定义：

- `comet-native-workflow`：无歧义请求直接形成 change 并推进；
- `comet-native-clarification`：模型只提出一个最高价值问题，用户回答后写入 Decisions 并以 `--confirmed` 继续；
- `comet-native-repository-fact`：仓库可调查事实不得询问用户；
- `comet-native-interrupted-transition`：prepared journal 存在时恢复到一个一致 phase，且不重复 trajectory 事件。

这些任务的定义与静态 validator 属于 Phase 1.5；Phase 2 的默认入口工作仍要等真实模型运行证据，而不是把“任务文件存在”等同于效果已经成立。

## 6. 测试边界

- CLI 测试确认 `--confirmed`、`spec remove`、`spec rebase` 和错误参数。
- Domain 测试确认自动 create/replace、冻结 hash、remove 冲突、rebase 重开 Build、Build 再校验和守卫失败不落盘。
- Transition 测试在 journal prepared、Run write、change write 后分别注入中断，并从公开恢复接口验证一致状态和单一事件。
- Lock/path 测试确认统一锁顺序、事务阻塞、陈旧锁规则，以及 symlink/junction 不能逃逸 Native root。
- Doctor 测试确认只读报告、Run/trajectory/checkpoint 一致性诊断与显式 continue 修复。
- Skill 测试确认中英文不要求模型维护 hash 或直接修改 approval，并说明 Build 决策与 rebase 恢复。
- Eval scaffold 测试确认四类 Native 场景的交互模式、fixture 与预期行为。
