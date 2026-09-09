# 上下文压缩恢复协议

规范路径：`comet-classic/reference/context-recovery.md`

本协议由所有可能触发上下文压缩的 comet 子 skill 共享。当 agent 怀疑发生上下文压缩（之前对话被摘要、找不到之前讨论的内容）时，按本协议恢复。

## 任意入口恢复原则

用户可能直接从 `/comet-open`、`/comet-design`、`/comet-build`、`/comet-verify`、`/comet-archive`、`/comet-hotfix` 或 `/comet-tweak` 回到流程。进入任意子 Skill 时，都先按 `comet-classic/reference/scripts.md` 运行公开 CLI 命令，再用当前子 Skill 对应 phase 运行入口检查或恢复检查。不得依赖对话历史判断阶段。

```bash
comet state check <change-name> <phase> --json
```

若检查结果显示实际 phase、workflow 或 evidence 应由其他 Skill 处理，按脚本输出和 `/comet-classic` 路由规则切换；不要在错误阶段继续补写状态。若存在未提交改动，先按 `comet-classic/reference/dirty-worktree.md` 归因。

## 未显式 `/comet-classic` 的恢复

如果用户没有提 `/comet-classic`，但本仓库可能有 active Classic change，开始处理需要改动或调查的任务前先运行 Ambient Resume 探针。按 `comet-classic/reference/scripts.md` 运行公开 CLI 命令，然后把当前用户请求从 stdin 传入：

```bash
comet resume-probe . --stdin --json
```

只有返回 `auto_resume` 才自动恢复；`ask_user` 必须短问用户；`out_of_scope` 和 `none` 不进入 workflow。

## 恢复步骤

```bash
comet state check <change-name> <phase> --recover --json
```

恢复包返回 change/workspace 身份、phase、configuration、taskState（权威 tasks.md 路径、revision、稳定任务 ID 与完成状态）、checkpoint、evidence.scopes 及必要文件路径。以实际 phase 路由，只读取当前恢复动作需要的文件；已返回的配置和检查点不再逐字段查询或重复读取。

仅在冷启动或上下文确实丢失时运行 `--recover`，普通阶段衔接用不带该参数的入口检查。Runtime 逐个复核 build/verify 证据：`revalidated` 表示可复用本地证据已通过当前输入、环境和日志校验；`rerun-required` 表示该范围需要重新执行检查。不可复用证据仍须重跑，不能由 Agent 自行宣布有效。恢复不清空任务、计划和审查记录，也不无条件重跑全部检查。

先核对真实文件、Git 提交、任务 ID 与未解决反馈。需求或实现变化后刷新入口并按新检查结果处理，不能沿用旧恢复包的结论；任务仅完成勾选不等于需求变化，也不能替代独立审查。

## build 阶段特殊恢复

若恢复脚本输出 `build_mode: subagent-driven-development`：

1. 使用 Skill 工具重新加载 Superpowers `subagent-driven-development` 技能
2. 重新阅读 `comet-classic/reference/subagent-dispatch.md` 获取 Comet 专属扩展
3. 读取 `<classic-change-dir>/.comet/subagent-progress.md`，恢复当前 task、原 implementer 会话标识、实现提交、RED/GREEN 证据、已通过审查、未解决反馈和审查-修复轮次；不恢复 Build final review
4. 禁止在主会话中直接执行 task
5. 按稳定任务 ID 对齐 taskState、检查点与 `.comet/rulings.md` 中的决定，恢复原 implementer 和精确审查阶段。检查点缺失或不匹配时先核对现有实现、提交和审查证据，重建最小检查点；不能仅因第一个 task 未勾选就重复派发实现。旧任务没有 ID 时先按 Build 的显式迁移规则处理，不按序号猜测对应关系。
6. task 按 `review_mode` 完成验收后，使用 task-complete 的 ID 与已核对 revision 记录完成；冲突时先重新核对任务语义，不盲目重试。不恢复旧的 Build final-review/final-fix 状态，最终集成审查归 Verify。正常任务衔接不询问是否继续。

## design 阶段特殊恢复

- 若用户尚未确认设计方案，回到 brainstorming 继续
- 若用户已确认，继续创建 Design Doc
- 恢复时重新加载 `brainstorm-summary.md` + handoff 上下文文件

## verify/archive 阶段恢复

- verify：脚本输出验证状态、分支状态和恢复动作
- archive：若 `archived: true` 且归档目录存在，归档已完成，无需再次执行
