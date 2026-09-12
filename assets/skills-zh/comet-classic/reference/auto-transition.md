# 自动衔接下一阶段协议

规范路径：`comet-classic/reference/auto-transition.md`

本协议由所有 comet 子 skill 共享，定义阶段守卫推进后的自动衔接规则。

## 术语区分

guard `--apply` 检查通过后，会更新 `.comet.yaml` 的 `phase` 字段，进入下一阶段。无论 `auto_transition` 如何设置，这一步**都会执行**。`auto_transition` 只决定更新阶段后，**是否自动调用下一个 Skill**。

## 执行方式

退出条件满足且阶段守卫更新 phase 后，优先按本次成功 JSON 结果中的 `agent.continuation` 继续：`automatic: true` 时调用 `skill` 指定的 Skill；false 时提示用户手动运行该 Skill，并结束本次调用。下一阶段可直接使用这里返回的状态信息，不重复 next、select 或 check。只有恢复会话、外部状态或工作区发生变化，或者旧结果没有这些信息时，才运行：

```bash
comet state next <change-name>
```

脚本根据 `phase`、`workflow`、`auto_transition` 确定并返回下一步：

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续

## 预设路由

`workflow: hotfix` 时，`phase: build` 返回 `comet-hotfix`；`workflow: tweak` 时返回 `comet-tweak`。其余 phase（`verify`、`archive`）按标准 Skill 名称返回（`comet-verify`、`comet-archive`），不受 workflow 类型影响。预设 Skill 内部的"连续执行模式"可能覆盖 `auto_transition` 行为——详见对应预设的 `<IMPORTANT>` 块。
