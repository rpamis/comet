# 自动衔接下一阶段协议

规范路径：`comet/reference/auto-transition.md`

本协议由所有 comet 子 skill 共享，定义阶段守卫推进后的自动衔接规则。

## 术语区分

「阶段守卫推进」由 guard `--apply` 完成，更新 `.comet.yaml` 的 `phase` 字段——这一步**始终发生**，与 `auto_transition` 无关。本协议的「自动衔接」只决定**是否自动调用下一个 skill**，由 `auto_transition` 控制。

## 执行方式

退出条件满足且阶段守卫推进 phase 后，运行：

```bash
node "$COMET_STATE" next <change-name>
```

脚本根据 `phase`、`workflow`、`auto_transition` 输出确定性的下一步：

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续

## 预设路由

`workflow: hotfix` 时，`phase: build` 返回 `comet-hotfix`；`workflow: tweak` 时返回 `comet-tweak`。其余 phase（`verify`、`archive`）按标准 Skill 名称返回（`comet-verify`、`comet-archive`），不受 workflow 类型影响。预设 Skill 内部的"连续执行模式"可能覆盖 `auto_transition` 行为——详见对应预设的 `<IMPORTANT>` 块。
