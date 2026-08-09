# Native Ambient Resume

## Purpose

在不深读所有活动 change 的前提下，Ambient Resume 必须先解析唯一 Native 目标，再只根据该目标的 portable 状态和正式 Markdown 恢复下一动作。本机 Runtime 缺失不能使可同步的 active change 消失。

## Requirements

### Lightweight candidate discovery

- Ambient Resume MUST 使用已验证的 `native.artifact_root` 与 bounded、受路径保护的目录规则枚举 active Native changes。
- 候选发现 MUST 只读取每个 change 的 `comet-state.yaml`，不得读取候选的 brief、Spec、`verification.md`、本机 `state.json`、日志或其他深层产物。
- 可解析 YAML MUST 暴露 change name、phase、status 与稳定 Loop stage；不可读、schema 不兼容或路径无效的状态 MUST 显示为 `invalid`，不得使另一个显式目标失败。
- v4 候选即使没有 `.comet/runtime/native/changes/<name>` 也 MUST 保持可发现。只读发现不得为了探测健康而创建 overlay。
- Legacy active change MUST 显示 `migration-required`；候选发现不得在读取过程中迁移或删除旧数据。

### Target resolution

- 显式指定的 active change MUST 优先于项目 selection。
- 没有显式名称时，合法的 Native selection MUST 确定目标；没有有效 selection 时，仅在恰好一个 active change 时 MAY 推断目标。
- 多个 active changes 且没有显式目标或合法 selection 时 MUST 要求调用方选择，并且 MUST NOT 为选择而深读每个 change。
- 只读目标解析 MUST NOT 创建或修改 `.comet/current-change.json`。
- 当前 worktree 中找不到用户明确点名的 change 时，Runner MAY 使用 `git worktree list --porcelain` 定位唯一已绑定 worktree；重名、多个合理候选或无法证明归属时 MUST `await-user`。

### Target-only validation

- 目标确定后，Ambient Resume MUST 只为该目标读取完整 `comet-state.yaml`、正式 brief/Spec，以及按需读取与当前 YAML 版本匹配的本机 `state.json`。
- 非目标 change 的本机 Runtime、报告、Spec、blocker 或迁移状态 MUST NOT 被深读，也 MUST NOT 改变已解析目标的恢复结果。
- 目标自身的 schema、portable 路径、workspace 绑定或 active/archive 布局无效时 MUST fail closed，并返回该目标的具体 blocker。
- `verification.md` 只在需要展示或检查投影版本时读取；报告缺失或落后 MUST 从 YAML 重建，不得从 Markdown 正文恢复机器状态。

### Stable-boundary recovery

- `comet-state.yaml` MUST 决定从哪里继续；`state.json` 只补充当前机器的 in-flight operation，不得覆盖更新的 YAML。
- Shape 保持 Shape；Build/repairing 保持当前 iteration；Verify 中丢失的 execution 从相同 iteration 启动新的 attempt。
- Archive-ready 的 pass 在跨设备或本机 execution 上下文完全丢失时 MUST 原子回到 Verify、清除当前验收结果并重新验收同步后的实现；这属于恢复，不增加实现失败或停滞计数。
- active 路径中已写入 done 的 change MUST 只完成幂等目录移动与清理；archive 路径中的 done change MUST 只读展示且 MUST NOT 创建 per-change Runtime。
- `await-user` 和 `blocked` MUST 恢复原 blocker、允许动作和 next action，不得为了继续而静默清零。
- interrupted operation MUST NOT 被推断为成功。可重复检查 MAY 重跑；不可安全重复的动作 MUST 要求用户决定。

### Cross-device boundary

- 新 Agent MUST 能只依赖已同步的项目代码、portable YAML、brief 与目标 Spec 恢复，不依赖旧聊天、旧 subagent、trajectory 或独立 checkpoint。
- 非默认 artifact root 需要已同步的 `.comet/config.yaml` 或显式 root；Ambient Resume MUST NOT 扫描其他目录猜测。
- Runtime MUST 明确说明它不能恢复旧设备未同步的实现、正在运行的进程或同一个 execution。
- 跨设备恢复是串行 handoff；YAML 分叉、Git 冲突或 workspace/branch 不匹配 MUST `blocked` 或 `await-user`，不得合并两份并发状态。

### Compatibility and validation

- no-active、unrelated、explicit、selected、unique、ambiguous 与 cross-worktree 的输出 action MUST 保持稳定且可由 Runner 直接执行。
- 本能力 MUST NOT 放宽 Builder/Verifier execution 分离、完整验收覆盖、Archive 冲突检查或 Hook Guard 归属。
- 回归测试 MUST 覆盖大量候选下的 target-only 读取、本机 overlay 缺失、跨设备各稳定边界、legacy migration-required、非默认 root 与多个 worktree 的唯一定位。
