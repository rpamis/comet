# Native Supervisor 子任务并发

在 Dashboard 的“设置 → Comet 配置 → Native 工作流”中修改“Supervisor 子任务并发上限”，或编辑项目的 `.comet/config.yaml`：

```yaml
native:
  max_parallel_children: 4
```

默认值为 `2`，只接受正整数。未包含此字段的旧项目继续使用默认值。它限制每个 Supervisor 已派发、尚未完成集成收尾的 Child Change 数量；Builder、Verifier、等待集成的子任务都占用名额。Runtime 完成子任务集成收尾后释放名额，用户不需要对子任务单独发起 Archive。子任务内部的工具调用或 Agent 数量由 Agent 平台管理。

选择 `single-session` 时始终按 `1` 派发。配置值仍保留，供多会话 Supervisor 使用。

## 调整与恢复

保存配置后，在下一轮派发时生效。提高上限时，Runtime 从依赖已完成集成的子任务中补足空位。降低上限不会取消已派发的子任务；在途数量低于新上限后再补充。

例如当前已有四个子任务，改为 `1` 后仍保留这四个任务。它们陆续完成集成收尾，直到没有在途子任务时，才派发下一个。

每轮实际采用的上限保存在原 SDK Action 结果中。恢复已发生的派发时沿用原记录，保留 Action、原批准、依赖和验收，不按当前配置重新派发。后续新一轮派发读取 Parent 项目的配置，Child worktree 的旧配置不会覆盖它。

## 全局默认与命令兼容

用户级 `~/.comet/config.yaml` 可保存同名字段作为初始化模板。新项目建立自己的配置后，以项目文件为准；修改全局默认值不会改变已经保存的项目配置。

SDK 和 Compat 的默认派发上限均来自该字段。旧 Compat 命令的 `--max-parallel <n>` 仍可显式覆盖当次上限；SDK 不接受这一旧参数，使用 Dashboard 或项目配置调整。

Dashboard 保存到同一份项目配置文件，沿用现有保存冲突检查和未知扩展字段保留规则。旧版 Dashboard 客户端未提交新字段时，保留项目已有值。
