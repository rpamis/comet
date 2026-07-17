# 上下文压缩恢复协议

规范路径：`comet/reference/context-recovery.md`

本协议由所有可能触发上下文压缩的 comet 子 skill 共享。当 agent 怀疑发生上下文压缩（之前对话被摘要、找不到之前讨论的内容）时，按本协议恢复。

## 任意入口恢复原则

用户可能直接从 `/comet-open`、`/comet-design`、`/comet-build`、`/comet-verify`、`/comet-archive`、`/comet-hotfix` 或 `/comet-tweak` 回到流程。进入任意子 Skill 时，都先按 `comet/reference/scripts.md` 定位脚本，再用当前子 Skill 对应 phase 运行入口检查或恢复检查。不得依赖对话历史判断阶段。

```bash
comet state check <change-name> <phase> --recover
```

若检查结果显示实际 phase、workflow 或 evidence 应由其他 Skill 处理，按脚本输出和 `/comet` 路由规则切换；不要在错误阶段继续补写状态。若存在未提交改动，先按 `comet/reference/dirty-worktree.md` 归因。

## 未显式 `/comet` 的恢复

如果用户没有提 `/comet`，但本仓库可能有 active change，开始处理需要改动或调查的任务前先运行 Ambient Resume 探针。先按 `comet/reference/scripts.md` 定位脚本并确保 `$COMET_RESUME_PROBE` 可用，然后把当前用户请求从 stdin 传入：

```bash
node "$COMET_RESUME_PROBE" probe --stdin
```

只有返回 `auto_resume` 才自动恢复；`ask_user` 必须短问用户；`out_of_scope` 和 `none` 不进入 workflow。

## 恢复步骤

```bash
comet state check <change-name> <phase> --recover
```

脚本输出结构化恢复上下文（phase、已完成字段、待完成字段、恢复动作）。按 **Recovery action** 决定下一步。

## build 阶段特殊恢复

若恢复脚本输出 `build_mode: subagent-driven-development`：

1. 使用 Skill 工具重新加载 Superpowers `subagent-driven-development` 技能
2. 重新阅读 `comet/reference/subagent-dispatch.md` 获取 Comet 专属扩展
3. 读取 `openspec/changes/<name>/.comet/subagent-progress.md`，恢复当前 task 或 final review、实现提交、RED/GREEN 证据、已通过审查、未解决反馈和审查-修复轮次
4. 禁止在主会话中直接执行 task
5. 按检查点记录的精确阶段恢复；检查点缺失或不匹配时才从第一个未勾选 task 的 implementer 派发开始
6. task 按 `review_mode` 完成验收并完成定向勾选验证后，立即继续下一个 task，不得总结或询问是否继续

## design 阶段特殊恢复

- 若用户尚未确认设计方案，回到 brainstorming 继续
- 若用户已确认，继续创建 Design Doc
- 恢复时重新加载 `brainstorm-summary.md` + handoff 上下文文件

## verify/archive 阶段恢复

- verify：脚本输出验证状态、分支状态和恢复动作
- archive：若 `archived: true` 且归档目录存在，归档已完成，无需再次执行
