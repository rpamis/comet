---
issue: https://github.com/rpamis/comet/issues/49
role: technical-design
canonical_spec: github-issue
---

# Plan Ready Pause Design

## 背景

Issue #49 要解决的场景是：用户希望先用高级模型完成设计和计划，再自行切换到低级或其他模型继续执行。当前 `comet-build` 在 plan 生成后会直接进入隔离方式和执行方式选择，只支持继续走 Superpowers `subagent-driven-development` 或 `executing-plans`，没有一个稳定可恢复的暂停点。

这个能力不应把“暂停”建模成执行方式。执行方式仍然表示真正开始实现后的路径；暂停只是 build 阶段内部的一个用户切换点。

## 目标

- 在 plan 生成并写入 `.comet.yaml` 后，允许用户选择暂停。
- 用户从 `/comet`、`/comet-build` 或其他入口回来时，Comet 能识别当前 change 已经有 plan 且停在 plan-ready 暂停点。
- 恢复后继续提示用户选择工作区隔离方式和执行方式，沿用现有 branch/worktree 与 subagent/executing-plans 选择流程。
- 不引入外部模型执行管理。Comet 只负责暂停、恢复识别、继续原有 build 流程。

## 非目标

- 不记录外部模型名称、能力等级或供应商。
- 不自动把执行权交给外部模型。
- 不允许 full workflow 因为暂停而绕过 `build_mode` 和 `isolation` 的硬约束。
- 不改变 hotfix/tweak 的默认 direct 执行语义。

## 状态模型

新增可选字段：

```yaml
build_pause: null
```

允许值：

- `null`：没有 build 内部暂停。
- `plan-ready`：plan 已生成并记录，用户选择暂停，尚未选择后续执行方式。

`build_pause` 与 `build_mode` 分离：

- `build_pause` 表示 build 阶段的暂停位置。
- `build_mode` 表示真正执行任务时使用的方式。

推荐状态组合：

```yaml
phase: build
plan: docs/superpowers/plans/2026-06-02-feature.md
build_pause: plan-ready
build_mode: null
isolation: null
```

用户恢复并选择执行方式后：

```yaml
phase: build
plan: docs/superpowers/plans/2026-06-02-feature.md
build_pause: null
build_mode: executing-plans
isolation: branch
```

## Build 流程

在 `comet-build` Step 2 “更新计划状态”之后、现有 Step 3 “选择工作方式”之前插入新的阻塞点。

步骤：

1. 使用 `writing-plans` 创建 plan。
2. 写入 `plan` 字段。
3. 询问用户是否继续执行：
   - 继续：设置 `build_pause null`，进入现有工作区隔离与执行方式选择。
   - 暂停：设置 `build_pause plan-ready`，本次 build 调用停止。
4. 用户稍后回来时，恢复逻辑识别 `build_pause: plan-ready`，提示继续选择隔离方式和执行方式。
5. 一旦用户完成执行方式选择，设置 `build_pause null`。

暂停点必须使用 AskUserQuestion 工具。推荐规则只能用于说明建议，不能替代用户确认。

## 主入口恢复

`comet` 主路由在 build 阶段先检查 plan-ready 暂停点：

- `phase: build`
- `plan` 非空且文件存在
- `build_pause: plan-ready`
- `build_mode` 或 `isolation` 未选择

命中时路由到 `/comet-build` 的恢复流程，不重新生成 plan，不进入执行任务。恢复提示应明确说明：

> 计划已生成，当前停在切换模型暂停点。继续后需要选择工作区隔离方式和执行方式。

如果 `build_pause: plan-ready` 但 plan 文件缺失，应视为状态损坏，要求恢复或重新生成 plan。

如果 `build_pause: plan-ready` 但 `build_mode` 和 `isolation` 已经选择，说明暂停字段未清理。恢复时清理为 `null` 并继续读取 tasks.md 的下一个未完成任务。

## 脚本与校验

`comet-state.sh`：

- `cmd_init` 写入 `build_pause: null`。
- `cmd_set` 允许设置 `build_pause`。
- `build_pause` enum 允许 `null` 或 `plan-ready`。
- `cmd_recover` 的 build 输出增加 `build_pause` 状态。
- build recovery action 优先识别 plan-ready 暂停点。

`comet-yaml-validate.sh`：

- `KNOWN_KEYS` 增加 `build_pause`。
- 校验 `build_pause` 只能为空、`null` 或 `plan-ready`。

`comet-guard.sh`：

- build → verify 不需要要求 `build_pause` 必须为 `null`，因为 `build_mode`、`isolation`、tasks 和 build 通过已经足以证明暂停点已越过。
- 但错误提示应避免建议把暂停写进 `build_mode`。

## Skill 文档更新

先更新中文 skill：

- `assets/skills-zh/comet-build/SKILL.md`
- `assets/skills-zh/comet/SKILL.md`

用户确认中文版本后，再同步英文 skill：

- `assets/skills/comet-build/SKILL.md`
- `assets/skills/comet/SKILL.md`

中文文档需说明：

- plan-ready 是暂停点，不是执行方式。
- 从任意入口恢复时，应继续到原有 Step 3。
- 不要重新调用 `writing-plans`，除非 plan 文件缺失或用户明确要求重做计划。

## 测试策略

更新 `test/ts/comet-scripts.test.ts`：

- 新增 `.comet.yaml` 字符串中的 `build_pause: null`。
- 验证 schema 接受 `build_pause: plan-ready`。
- 验证非法值会失败。
- 验证 `comet-state set <change> build_pause plan-ready` 成功。
- 验证 recover 在 `phase: build + plan + build_pause: plan-ready` 时输出 plan-ready 恢复动作。
- 验证用户选择执行方式后可设置 `build_pause null`，并且 build guard 仍依赖现有 `build_mode`、`isolation`、tasks 和 build 结果。

## 风险与处理

最大风险是把暂停状态和执行状态混淆，导致 full workflow 可以绕过执行方式选择。设计上通过 `build_pause` 与 `build_mode` 分离规避这一点。

另一个风险是用户暂停后换模型修改了 plan 或 tasks。恢复时 Comet 不应假设计划未变；如果工作区有未提交改动，仍按现有 dirty worktree 协议归因。若 diff 暗示 plan 或 spec 变化，则进入 build 阶段的 Spec 增量更新规则。

## 验收标准

- plan 生成后，用户可以选择暂停，状态写入 `build_pause: plan-ready`。
- 从 `/comet` 回来能识别该暂停点，并提示继续选择隔离方式和执行方式。
- 从 `/comet-build` 回来也能通过 recover 输出识别该暂停点。
- 选择执行方式后，`build_pause` 清为 `null`。
- `build_mode` 仍只表示执行方式，不出现 `paused` 等伪执行模式。
- 现有 build → verify 硬约束保持不变。
