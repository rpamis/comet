# 自动衔接下一阶段协议

规范路径：`comet-classic/reference/auto-transition.md`

本协议由所有 comet 子 skill 共享，定义阶段守卫推进后的自动衔接规则。

## 术语区分

guard `--apply` 检查通过后，会更新 `.comet.yaml` 的 `phase` 字段，进入下一阶段。无论 `auto_transition` 如何设置，这一步**都会执行**。`auto_transition` 只决定更新阶段后，**是否自动调用下一个 Skill**。

## 执行方式

SDK 响应带有 `agent.continuation.mode` 时，先按该字段处理：`execute` 执行返回的命令或加载明确指定的 Skill；`wait` 等待原任务，不重新领取；`ask` 展示当前提案并等待用户决定；`reconcile` 核对原执行结果或处理列出的阻塞；`done` 结束。`mode` 优先于兼容字段 `nextAction.kind`；例如旧 `kind: reconcile` 对应的新 `mode: wait` 仍应等待原任务。只有 `invoke_skill` 才加载 Skill，不能把工具的 `ref` 当成 Skill 名称；先完成 Skill 要求的真实工作，再按 `completion` 填写并执行提交命令。`currentRef` 指向同一响应中的当前工作，直接读取该字段，不额外调用命令。`inputSummary` 只保留当前工作的上下文，不替代原 Action 输入或 Runtime 证据；只有确需摘要未包含的内容时，才使用返回的详情命令。直接复用当前动作的输入、请求模板、Run 身份、revision 和工作目录；占位值填写真实输入，不能作为批准。写入后使用新响应，不因阶段切换重新查询。响应没有 `mode` 时沿用下方规则。

退出条件满足且阶段守卫更新 phase 后，优先按本次成功 JSON 结果中的 `agent.continuation` 继续：`automatic: true` 时调用 `skill` 指定的 Skill；false 时提示用户手动运行该 Skill，并结束本次调用。下一阶段可直接使用这里返回的状态信息，不重复 next、select 或 check。只有恢复会话、外部状态或工作区发生变化，或者旧结果没有这些信息时，才运行：

```bash
comet state next <change-name>
```

脚本根据 `phase`、`workflow`、`auto_transition` 确定并返回下一步：

- `NEXT: auto` → 调用 `SKILL` 指向的 skill 进入下一阶段
- `NEXT: manual` → 不要调用下一 skill，按 `HINT` 提示用户手动运行 `/<SKILL>`
- `NEXT: done` → 流程已完成，无需继续
- `NEXT: delivery` → change 已归档，按 delivery 摘要完成收尾，不再推进阶段

## 预设路由

`workflow: hotfix` 时，`phase: build` 返回 `comet-hotfix`；`workflow: tweak` 时返回 `comet-tweak`。其余 phase（`verify`、`archive`）按标准 Skill 名称返回（`comet-verify`、`comet-archive`），不受 workflow 类型影响。预设 Skill 内部的"连续执行模式"可能覆盖 `auto_transition` 行为——详见对应预设的 `<IMPORTANT>` 块。
