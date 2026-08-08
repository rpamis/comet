# Outcome

Comet Native 的 change 与 archive 目录只保留用户可读、适合版本控制的状态和文档；所有 Native 机器运行文件统一存放在项目根 `.comet/runtime/native/` 下并沿用 `.comet/` 的本地忽略策略。Runtime 丢失时，change 仍可被发现和阅读，但必须重建执行上下文并重新验证，不能沿用缺少机器证据的历史通过结果。

# Scope

- Native active change 只保留 `comet-state.yaml`、`brief.md`、`verification.md`、根级只读 `evidence.md` 与 `specs/`。
- Native archive 只保留同一组用户可读文件，不携带机器 Runtime。
- per-change Runtime 移到 `<project>/.comet/runtime/native/changes/<change>/`；全局锁与事务移到 `<project>/.comet/runtime/native/{locks,transactions}/`。
- `runtime/...` 继续作为状态与证据中的逻辑引用，由统一 resolver 映射到新的项目本地 Runtime 根，禁止调用方继续拼接 `<change>/runtime`。
- 新 change 只写新布局；旧 `<change>/runtime` 继续兼容读取，并由现有 `comet native doctor --repair` 显式迁移，不新增 CLI 命令。
- `status` 和恢复探针先读取 change 状态，再报告目标 Runtime 为 `available`、`missing` 或 `invalid`；缺失 Runtime 不等同于 change 不存在或损坏。
- Runtime 缺失后的首次继续操作重建 baseline、workspace、Run 和 checkpoint，清除失效机器证据，将历史 Verify 结论重置为 pending，并从 Build 重新验证；Shape 的重建不强制回退，并在同一次继续操作中执行正常 Shape transition，已归档 change 不需要 Runtime。
- Verify 每次更新 change 根的 `verification.md` 与只读 `evidence.md`；Archive 在机器证据仍有效时物化最终文档，移动纯文档 change，成功提交后尽力清理本地 Runtime。
- 更新 Native 中英文 Skill/reference、Runtime 源码与生成资产、架构清单和受影响测试。

# Non-goals

- 不修改 Classic 的目录、状态机、Guard、Archive 或恢复行为。
- 不提交 `.comet/runtime`，不增加 portable capsule、远程状态后端、分布式锁或自动 Git 提交。
- 不承诺恢复未同步的源码、模型上下文、命令中间状态或原设备上的精确执行位置。
- 不通过扫描其他 artifact root 猜测 change，也不改变 `native.artifact_root` 的用户文档位置。
- 不自动迁移或删除旧仓库中可能已被 Git 跟踪的 Runtime；迁移必须由现有 Doctor repair 显式触发。

# Acceptance examples

- GIVEN 新建 Native change，WHEN 创建完成，THEN change 目录不含 `runtime/`，baseline、workspace 和 Run 文件位于 `.comet/runtime/native/changes/<change>/`。
- GIVEN 一个 active change 的 `.comet/runtime/native/changes/<change>` 被删除，WHEN 运行只读 status 或 Ambient Resume，THEN change 仍被发现，Runtime 显示为 `missing`，历史 Verify pass 不构成 Archive 授权。
- GIVEN Runtime 缺失的 Shape change，WHEN 用户继续该 change，THEN Runtime 被重建且仍处于 Shape。
- GIVEN Runtime 缺失的 Build、Verify 或待 Archive change，WHEN 用户继续该 change，THEN Runtime 被重建、验证证据失效、有效阶段回到 Build，并要求重新 Verify。
- GIVEN 已归档 change 没有 Runtime，WHEN 展示或读取 archive，THEN `comet-state.yaml`、brief、specs、verification 和 evidence 仍完整可读，不报告损坏。
- GIVEN Verify 产生机器 evidence，WHEN 投影更新，THEN用户可读投影位于 `<change>/evidence.md`，机器 JSON 仅位于 `.comet/runtime/native/.../evidence/`。
- GIVEN Archive preflight 与 commit 成功，WHEN change 被移动到 archive，THEN archive 中不含 Runtime；本地 Runtime 清理失败只产生可修复警告，不回滚已完成 Archive。
- GIVEN 旧 change 仍含 `<change>/runtime`，WHEN 普通读取发生，THEN Runtime 可兼容读取且 status 标识 legacy layout；WHEN 显式执行 Doctor repair，THEN Runtime 经校验迁移到 `.comet/runtime/native/changes/<change>/`，用户文档留在原 change。
- GIVEN Native artifact root 从 `docs` 移动到其他项目内路径，WHEN root move 完成，THEN用户文档随 artifact root 移动，而 `.comet/runtime/native` 保持项目本地位置且绑定仍可恢复。

# Constraints and invariants

- `comet-state.yaml` 继续位于 change 内，由 Runtime 独占管理 phase、revision、evidence refs、run_id 与 archived 字段。
- 所有新 Runtime 路径必须位于项目根 `.comet/runtime/native` 内，并继续使用 Native protected I/O、原子写入、路径身份与防逃逸校验。
- Runtime 缺失时只读命令不得修改状态；重建和验证降级只在显式写命令持锁执行。
- 状态中 `runtime/...` 引用保持逻辑格式和内容寻址校验，不改成绝对路径或设备路径。
- Archive 只有在当前机器 evidence 完整、新鲜且 preflight 一致时才能提交；最终文档不能反向充当机器验证凭据。
- Runtime 清理必须发生在 Archive 不可逆提交之后；清理失败不得伪造 Archive 失败或删除用户文档。
- 保留当前脏工作区中的无关修改，不把它们纳入本 change 的实现或提交范围。

# Decisions

- 采用单一简单模式：所有 Native Runtime 都是项目本地且默认不提交 Git，不增加 local/portable 配置分支。
- change 名称继续作为 per-change Runtime 目录键，不在本次引入新的 change ID、lineage 或远程并发协议。
- `evidence.md` 位于 change 根并由 Runtime覆盖生成；它只用于阅读，不可被 verification evidence 引用。
- Runtime 缺失后的正确性由“重建并重新 Verify”兜底，而不是尝试从用户文档伪造原机器状态。
- 旧布局采取兼容读取加 Doctor 显式迁移，避免升级后自动制造大批 Git 删除。
- 不新增 CLI 命令；现有 status、select、next、archive 与 doctor 承担全部行为。

# Open questions

无。目录、Git 持久化、Runtime 缺失、Archive 和旧布局迁移语义均已由用户确认。

# Verification expectations

- 覆盖新建布局、路径 resolver、状态-only discovery、Runtime `available/missing/invalid`、各阶段重建与 Verify 失效、根级 `evidence.md`、Archive 文档物化与清理、root move、旧布局兼容读取和 Doctor repair。
- 验证非目标 change 的 Runtime 不会被 Ambient Resume 深读，Classic 行为不变，路径逃逸/符号链接仍失败关闭。
- 运行受影响 Native 测试、Entry/架构/Runtime asset 契约测试、`pnpm build:native-runtime`、相关 Prettier/lint；由于涉及 Runtime、Archive、Doctor 与 root move，最终运行一次全量测试。
- 实现完成后以开始提交 `0da018d096903803b80cb4976c16b5158ae6d54d` 为固定基线，至少派发一次独立 Standards 与 Spec code review，并处理所有必须修发现。
