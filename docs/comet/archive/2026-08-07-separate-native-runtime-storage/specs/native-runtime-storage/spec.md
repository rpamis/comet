# native-runtime-storage

## 目标

Comet Native 必须把用户可读的 change 事实与本地机器运行状态分离。Active change 与 archive 只保存状态、需求、完整规格和人类可读验证材料；所有机器 Runtime 统一存放到项目根 `.comet/runtime/native`，缺失时通过受控重建与重新验证恢复正确性。

## 用户文档布局

每个 active change 的持久布局必须是：

```text
<artifact-root>/comet/changes/<change-name>/
├── comet-state.yaml
├── brief.md
├── verification.md
├── evidence.md
└── specs/
```

文件尚未生成时可以暂时不存在，但 Runtime 不得在 change 内创建 `runtime/`、锁、事务、checkpoint、baseline、workspace 或机器 evidence。Archive 使用同一用户文档集合，并且不得包含机器 Runtime。

`evidence.md` 是由 Runtime 生成和覆盖的只读投影。它解释当前 implementation scope、验收矩阵、verification receipts 与结论，但不得作为 verification evidence 输入或代替内容寻址机器证据。

## 项目本地 Runtime 布局

Native Runtime 必须位于：

```text
<project>/.comet/runtime/native/
├── changes/<change-name>/
│   ├── baseline-manifest.json
│   ├── workspace.json
│   ├── run-state.json
│   ├── trajectory.jsonl
│   ├── pending-action.json
│   ├── context.md
│   ├── artifacts.json
│   ├── transition.json
│   ├── schema-migration.json
│   ├── checkpoint-journal.json
│   ├── checkpoints/
│   ├── skill-snapshots/
│   └── evidence/
├── locks/
└── transactions/
```

`.comet/` 的现有 Git ignore 契约同时覆盖这些文件。Runtime 不得执行强制 Git add、自动提交、Git ignore 反向例外或把机器文件复制回 artifact root。

所有 Native 调用方必须通过统一路径 resolver 获取 change Runtime、全局 Runtime、锁和事务路径。状态与证据中的 `runtime/...` 保持逻辑引用格式，由 resolver 绑定到目标 change 的项目本地 Runtime 根；不得存储绝对路径，也不得再把该引用直接拼接到 change 目录。

项目本地 Runtime 的 protected I/O 必须延续现有父链、realpath、文件身份、普通文件、原子提交、大小预算、TOCTOU 与边界逃逸校验。将 Runtime 移入 `.comet` 不得降低这些约束。

## Runtime 健康与只读发现

候选发现必须只读取 change 目录中的状态文档，不得为枚举候选而读取任何 per-change Runtime。

目标 change 的详细状态必须报告以下 Runtime 健康之一：

- `available`：目标 Runtime 根存在、布局唯一，并可在受保护边界内安全访问。
- `missing`：新 Runtime 与兼容旧 Runtime 都不存在。
- `invalid`：Runtime 根路径越界、类型错误、同时存在新旧布局或无法通过 protected I/O。根内机器文件缺失、损坏或不完整时，沿用现有结构化 finding 与 error 报告具体文件问题，不把它误报为整个 change 不存在。

`missing` 不得被描述为 change 不存在或状态文档损坏；`invalid` 必须保留明确的完整性错误。只读 status、show、list、Ambient Resume 与 doctor 不得仅因 Runtime 缺失而修改 `comet-state.yaml`、创建 Runtime 或清除历史字段。

已归档 change 不要求 Runtime 健康。只要其状态与用户文档有效，缺少 Runtime 不得使 archive 无法展示或被诊断为损坏。

## 受控 Runtime 重建

显式继续一个 Runtime 为 `missing` 的 active change 时，Runtime 必须在 mutation/transition lock 内：

1. 创建新的项目本地 change Runtime 根。
2. 捕获新的 baseline 和 workspace identity。
3. 创建新的 Run、trajectory 与 phase checkpoint。
4. 清除不能由新 Runtime 证明的 implementation scope、verification evidence、partial allowance 与旧 run binding。
5. 将 verification result 重置为 `pending`。
6. 记录可审计的重建与阶段回退事件。

Shape change 的重建本身不强制改变阶段；触发重建的同一次显式 `next` 随后继续执行普通 Shape transition，因此在确认材料满足时可以正常进入 Build。Build change 在重建后继续 Build。Verify 或尚未完成 Archive 的 change 必须受控回退到 Build，重新封存 scope 并重新 Verify；历史 `verification_result: pass` 不得授权 Archive。

重建 baseline 使用当前同步工作区作为新的可审计起点，保持 verification pending，并不得声称恢复了原设备的未同步内容。

`invalid` Runtime 不得自动重建覆盖；必须通过只读 doctor 定位，并仅在既有 Doctor repair 规则能够证明安全时修复。

## Verify 与 Archive

Verify 继续以项目本地 Runtime 中的当前 scope、snapshots、receipts 和 verification envelope 作为机器事实。每次 evidence-bearing transition 必须同步生成 change 根的 `evidence.md`，Verify 必须维护根级 `verification.md`。

Archive preflight 与 commit 必须在当前 Runtime `available` 且机器证据完整、新鲜时重新计算现有验证、冲突和恢复事实。Archive 提交顺序必须保证：

1. 最终 `verification.md` 与 `evidence.md` 已物化且可读。
2. 状态已由 Runtime 合法标记为 archived。
3. 纯用户文档 change 被移动到日期前缀 archive。
4. Archive 事务跨过不可逆完成边界。
5. 对应项目本地 per-change Runtime 才可被清理。

Runtime 清理失败只产生明确的本地清理警告或 Doctor repair 候选，不得回滚已提交 Archive、删除 archive 用户文档或把 Archive 伪报为未完成。Archive 后机器 Runtime 不属于持久审计契约，最终用户可读记录由状态、brief、完整规格、verification 和 evidence 构成。

## 旧布局兼容与迁移

新 change 只写项目本地 Runtime。读取旧 change 时，Runtime resolver 必须优先选择新位置；新位置不存在且 `<change>/runtime` 合法存在时，可以只读或按现有写协议继续使用旧位置，并在诊断中报告 `legacy-runtime-layout`。

普通 status、select、next、archive 或升级不得自动删除可能已被 Git 跟踪的旧 Runtime。现有 `comet native doctor --repair` 必须提供显式迁移：

1. 在 Native lock 内确认旧 Runtime 是受保护的真实目录，且新位置不存在。
2. 使用同一文件系统内的原子 rename 将旧 Runtime 移入项目本地目标位置，不覆盖已有目标。
3. 让后续 Doctor 检查按新位置重新读取并验证关键 Run、trajectory、baseline、workspace、checkpoint 与 evidence refs。

rename 前中断会保留完整旧目录，rename 后中断会留下完整新目录，因此无需额外迁移 journal。若底层文件系统不支持原子 rename，或新旧位置同时存在、路径为符号链接、Runtime 损坏、无法证明身份，则失败关闭并保持旧 Runtime，不猜测哪一侧正确。

## Root move 与工作区

`native.artifact_root` 继续只控制 `comet/specs`、`changes` 与 `archive` 的用户文档根。`root move` 必须移动和验证这些用户文档，但不得把项目本地 `.comet/runtime/native` 当作 artifact tree 的一部分复制或删除。

Root move 完成后，Runtime resolver 必须使用新 artifact root 查找状态和用户文档，同时继续使用同一项目根 `.comet/runtime/native`。Workspace identity 可以刷新新的 Native root 逻辑/物理绑定，但不能因为 Runtime 自身没有随 artifact root 移动而报告损坏。

## 验证要求

- 覆盖新 change 与 archive 的纯文档布局，以及 `.comet/runtime/native` 的所有机器文件类别。
- 覆盖逻辑 `runtime/...` ref 在新位置的读写、内容寻址和 protected I/O 边界。
- 覆盖 state-only discovery、`available/missing/invalid`、Shape 重建、Build 重建、Verify/Archive 回退和 archived 无 Runtime。
- 覆盖 Verify 根级 projection、Archive 最终物化、不可逆边界后的清理成功与失败。
- 覆盖旧布局优先级、兼容读取、Doctor 显式迁移、中断恢复和冲突失败关闭。
- 覆盖 artifact root move、多个 Git worktree、非目标 Runtime 不深读、Native/Classic Guard 路由不变。
- 同步中英文 Native Skill/reference，重建 Native Runtime 和命令 bundle，并通过架构、资产、格式、lint、相关测试和最终全量测试。
