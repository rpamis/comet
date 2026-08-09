# native-runtime-storage

## 目标

Comet Native 必须把可随项目同步的稳定语义状态与单机正在执行的 operation 分离。一个 active change 只有一份可携带权威：`comet-state.yaml`；本机 `state.json` 只是 in-flight overlay，缺失、损坏或版本落后时从 portable 状态受控重建。

新 change 不再维护项目 snapshot、文件哈希、receipt/evidence、trajectory 或独立 checkpoint。路径安全、并发写入与 Archive 半完成恢复继续由受控路径、原子写入、mutation lock 和短生命周期事务保证。

## 用户产物布局

每个 active change 的持久布局必须是：

```text
<artifact-root>/comet/changes/<change-name>/
├── comet-state.yaml
├── brief.md
├── specs/
│   └── <capability>/spec.md
└── verification.md
```

- `brief.md` 必须存在；完整目标 Spec 按 change 需要存在；`verification.md` 在形成有效验收结果后生成，Archive 前必须存在。
- `verification.md` 是 Runtime 根据 portable verification 状态生成的用户可读投影，不由 Builder 手写，也不作为完成决定的权威输入。
- `verification.md` 的 frontmatter 必须记录 `generated_from_state_version`。YAML 已推进但报告缺失或落后时，只重建报告，不重新运行检查或 Verifier。
- Active 与 archive 使用同一用户文档集合。不得在 change 中创建 `runtime/`、锁、事务、本机日志或另一份恢复状态。
- 新 change 不生成 `evidence.md`、`repair.md`、`archive.md`、`checkpoint.md` 或 `implementation.md`。

## Portable 语义状态

`comet-state.yaml` 必须保存从无聊天上下文恢复所需的稳定事实，包括：

- phase、status 与单调递增的 `state_version`；
- 完整 Spec 操作、workspace isolation/branch/finish；
- Loop stage、goal cycle、iteration、attempt、失败和停滞计数、next action；
- 完整验收项、Builder handoff、blocker、最终检查摘要、Verifier 结果与 bounded history；
- verification result、报告引用与 archive 完成状态。

状态不得保存进程句柄、绝对路径、完整命令输出、日志路径、项目文件内容或文件内容摘要。Runtime-owned YAML 只能在 mutation lock 内原子替换；`state_version` 仅用于语义状态并发保护，不代表项目内容。

验收 ID、verdict、状态、计数、portable 路径和完整验收集合属于决策数据，不得截断。summary、reason、risk 等诊断文字可以保存明确标记为 truncated 的预览；显示预算不得改变候选或验收结果。

## 项目本地 Runtime 布局

Native 单机 Runtime 必须位于：

```text
<project>/.comet/runtime/native/
├── changes/<change-name>/
│   ├── state.json
│   └── logs/
│       └── checks/
├── locks/
└── transactions/
```

- `state.json` 只记录当前机器的项目/worktree 路径、当前 operation、actor、execution handle、检查状态、精确 argv 和日志引用。
- 子进程 stdout/stderr 必须流式写入 `.log`；Dashboard 可以只显示尾部，但显示截断不得改变退出状态。
- JSON 与 YAML 不做双向合并。`basedOnStateVersion` 与 YAML 不一致时丢弃或重建 JSON，JSON 不得反向覆盖更新的 YAML。
- 启动 Builder、Runtime check、Verifier 或 Archive operation 前，必须先原子写入 operation ID 与 running 状态。形成稳定结果时先推进 YAML，再清除或更新 JSON。
- 已完成 archive 不需要 per-change Runtime；Archive 成功后必须清理整个对应目录。
- locks 与 transactions 是项目级短生命周期设施，不是 change 的正式产物，也不是跨设备权威。

`.comet/` 默认必须继续被 Git 忽略，只能为 `.comet/config.yaml` 增加精确 allowlist。Runtime、selection、锁、事务和日志不得被该例外暴露，也不得被 Runtime 强制 Git add 或自动提交。

## Runtime 健康与只读发现

- 候选枚举只读取每个 change 的 `comet-state.yaml` 头部或完整 bounded YAML，不读取 brief、Spec、报告或 per-change Runtime。
- 目标详情可以报告本机 overlay 为 `available`、`missing`、`invalid`、`stale` 或 `not-expected`；该状态不能替代 portable change 的 phase/status。
- `missing` 或 `stale` 不表示 change 不存在或损坏。只读 status、show、list、Ambient Resume 和 doctor 不得仅因本机 overlay 缺失而修改 YAML 或创建 Runtime。
- 已归档 change 只要 portable 状态与用户文档可读，就不得因本机 Runtime 不存在而被诊断为损坏。
- 路径越界、符号链接逃逸、文件类型错误、状态 schema 无法解析或 active/archive 混合布局必须明确失败关闭。

## 本机中断恢复

- 本机 overlay 缺失、过期或可安全丢弃时，Runtime 必须根据 YAML 的最近稳定边界重建新的 `state.json`。
- running operation 在进程失联后只能标记为 interrupted，不能推断成功。可重复的只读检查可以重跑；不可安全重复的动作必须进入 `await-user`。
- Verifier execution 失联时保留当前 iteration，分派新的 attempt；不得把基础设施中断计为实现失败。
- Shape 与 Build 从当前稳定 stage 继续。Verify 的未完成 execution 重新执行必要检查并启动新 Verifier；Archive-ready 的 pass 在本机执行上下文完全丢失时先原子回到 Verify 重新验收。
- YAML 已形成最终 done 但目录移动或 Runtime 清理未完成时，只幂等完成 Archive 事务，不重新 Verify。

## 跨设备与零上下文恢复

- 新设备必须能只根据同步后的项目代码、`comet-state.yaml`、brief 和目标 Spec 恢复；`verification.md` 缺失或落后时由 YAML 重建。
- 非默认 `artifact_root` 需要同步 `.comet/config.yaml` 或由用户显式提供 root；Runtime 不扫描其他目录猜测 change。
- 恢复时验证 portable workspace 的 isolation、change branch、target branch 与 finish action，再创建新的本机 overlay。无法匹配绑定时返回 `await-user`，不得静默重绑。
- 旧设备的进程、日志和 execution handle 一律视为不可用；恢复不尝试续接同一个 subagent 或未同步代码。
- Verify/Archive-ready 为避免复用旧设备无法证明仍适用的 pass，可以重新执行一次必要检查并分派新的 Verifier；Shape/Build 不重跑已完成阶段，也不扫描项目树。
- 同一 change 的跨设备推进是串行 handoff。YAML 分叉、Git 冲突或两个设备同时推进的事实无法安全归并时必须 `blocked`。

## Archive 事务

Archive 只在 `archive-ready + pass` 且 `verification.md` 与当前 `state_version` 对齐后开始，并按固定顺序：

1. 在项目级 transaction 中记录目标 change、完整 Spec 目标与当前步骤。
2. create/modify 使用完整目标内容原子替换；remove 在 canonical capability 边界内幂等删除。
3. 在 active change 中原子写入最终 done YAML。
4. 按最终版本重新生成并对齐 `verification.md`。
5. 原子移动 active change 到 archive。
6. 清理 per-change Runtime 与 transaction。

Archive 不重新运行必要检查或 Verifier。事务中断只从已记录步骤继续；transaction 丢失时只能根据 YAML 与 active/archive 的唯一位置幂等重放。active 与 archive 同时存在、位置和状态矛盾或目标不能唯一证明时必须 blocked，由 doctor 报告，不得猜测删除或覆盖。

两个 active changes 声明同一 capability 时，Archive 必须在全局 lock 内暂停为 `await-user`，由用户决定串行顺序。通过的 change 应用其完整目标 Spec，不保存 canonical base 内容摘要。

## Root move 与旧数据

- `native.artifact_root` 只控制 `comet/specs`、`changes` 与 `archive` 的用户产物；Root move 不复制或删除 `.comet/runtime/native`。
- Root move 后 resolver 使用新 artifact root 查找 portable 状态，同时继续使用同一项目根的本机 Runtime。不能因为 Runtime 没有随 artifact tree 移动而报告损坏。
- 新 change 只写 v4 用户布局和最小本机 Runtime。
- 旧 active change 的只读入口显示 `migration-required`；`doctor --repair` 或第一个持有 mutation lock 的写命令执行确定性迁移。
- 迁移只继承 legacy 状态、brief、完整 Spec 与可验证 workspace 绑定。旧验收链不得转换为新 pass；Verify/Archive 状态必须保守回到 Build 等待新候选。
- 新 YAML 成功提交后才能清理旧 per-change Runtime；迁移重复执行必须幂等，失败时保留原数据并报告恢复动作。
- 旧 archive 保持原样，由 legacy adapter 只读展示，不参与 v4 决策。

## 验证要求

- 覆盖纯用户产物布局、最小本机 Runtime、YAML/JSON 版本对齐和报告重建。
- 覆盖 state-only discovery、本机 overlay 的 available/missing/invalid/stale、各种稳定边界恢复及 archived 无 Runtime。
- 覆盖跨设备 Shape、Build、Verify、Archive-ready、await-user、blocked 与 done 恢复，且不依赖聊天历史。
- 覆盖 Archive 各步骤中断、transaction 丢失、active/archive 冲突、Runtime 清理成功与失败，并证明正常 Archive 不重复验收。
- 覆盖旧 active migration、旧 archive adapter、artifact root move、多个 Git worktree 和受控路径边界。
- 同步中英文 Native Skill/reference，重建 Native Runtime 和命令 bundle，并通过架构、资产、格式、lint、相关测试和最终全量测试。
