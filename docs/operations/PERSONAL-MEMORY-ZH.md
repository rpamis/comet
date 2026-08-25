# Comet 个人记忆

Comet 个人记忆用于跨任务保留真正可复用的用户偏好和协作经验。它不是聊天记录或工作日志，也不会保存完整对话、工具输出、diff、隐藏推理或容易从仓库重新找到的事实。

## 三层记忆

- **Core Profile（核心画像）**：语言、角色、技术背景、沟通和输出偏好等长期稳定信息。
- **Collaboration Policy（协作策略）**：按项目、路径、任务类型、操作或阶段生效的个人工作方式。
- **Personal Episode（个人经历）**：一次成功、纠正或失败的紧凑情景，包含 situation、action summary、outcome 和 lesson，供后台复盘或按需展开。

明确的“记住”“以后都这样”或纠正会立即写为 `proven`，下一任务即可生效。只针对“这次”或“当前任务”的要求不会持久化。系统从真实反馈中推断出的可复用经验先进入低优先级 `trial`；成功应用一次后可晋升为 `proven`，被否定、纠正或导致失败时会被改写或标记为 `superseded`。遗忘使用独立 tombstone，旧事件重放不会恢复已遗忘内容。

## 自动学习与使用方式

Classic、Native、Hotfix 和 Tweak 把结构化用户信号、任务结果、验证、Review 和 Archive 结果写入同一 Experience Journal。Journal 写入是快速路径；语义 Reflection 在后台分批处理，不因 Review Packet 大小拒绝有效内容，也不会阻塞主工作流。语义服务暂不可用时，明确用户信号仍能通过确定性路径立即保存。

任务开始时，Context Director 只常驻完整 Core Profile 和少量直接相关的 `proven` 协作策略。其他相关记忆进入 Context Manifest，每项包含稳定 ID、标题、摘要、来源类型和真实 `whyApplied`。Agent 需要正文、来源或验证方式时，再按 ID 展开：

```text
comet task . --task "实现新的 CLI 命令" --phase build --session <稳定会话标识> --json
comet task . --task "实现新的 CLI 命令" --phase build --session <同一标识> --expand-context <id> --json
```

当路径、操作或阶段改变时，同一 session 会重新选择上下文，但不会重复投递未变化内容。Agent 实际使用一条记忆后会记录应用结果；`used-successfully` 可以强化或晋升记忆，`ignored`、`overridden`、`corrected` 和 `contributed-to-failure` 会影响后续排序、改写或替代。

当前用户请求和系统约束始终高于个人记忆；Project Policy 也高于个人项目习惯。个人记忆不会授权提交、推送、删除或发布，也不会自动变成团队规则。

## Dashboard 体验

个人记忆中心直接提供核心画像、协作策略、个人经历及历史/遗忘视图，不重复显示与侧边栏相同的大标题。每条记录显示 `trial`、`proven` 或 `superseded`、作用范围、证据摘要、最近应用结果和“为什么应用”，并支持新增、纠正、遗忘、回滚和按需展开。当前 Context Manifest 可以直接预览，完整 application history 可以展开查看。

页面优先展示缓存快照，再在后台刷新；Reflection 不参与首屏阻塞。统一设置面板只配置 Provider、学习、检索、同步和单次注入预算，不把存储总量或 Review Packet 当成用户容量限制。

## 查看和管理

CLI、Dashboard、Skill 和 Hook 读写同一份权威状态：

```text
comet memory list .
comet memory retrieve . --task "实现新的 CLI 命令"
comet memory remember . --text "默认用中文回答" --scope global
comet memory correct . --id <记忆标识> --text "改为简洁的中文回答"
comet memory forget . --id <记忆标识>
comet memory rollback . --id <记忆标识>
comet memory pause . --project <project-key>
comet memory sync .
comet memory status .
```

`remember` 用于用户明确要求长期保存的偏好，立即生效；`observe` 只用于 Agent 发现的隐式、稳定、可跨任务复用的协作方式，不得保存任务摘要、进度、命令输出或测试结果。`forget` 默认保留回滚能力，永久删除需要显式使用 `--permanent`。

## 配置、Provider 与存储

项目 `.comet/config.yaml` 控制自动学习和自动检索：

```yaml
memory:
  learning: true
  retrieval: true
```

关闭学习不会删除已有记录；关闭检索不会影响 Dashboard 和显式管理命令。用户级 `~/.comet/config.yaml` 选择 Local/Remote Provider，并配置一次注入预算：

```yaml
personal_memory:
  provider: remote
  profile_char_limit: 2000
  task_context_char_limit: 6000
  remote:
    endpoint: https://memory.example.test/provider
    token_env: COMET_MEMORY_TOKEN
    profile: default
```

字符预算只决定一次 Agent Context 中常驻多少正文；超出预算的内容进入 Manifest，不会拒绝保存、截断权威记录或产生 byte budget 错误。Provider 不设置固定条目数或用户可见总容量。

Local Provider 保留可读的 `profile.md`、`projects/<project-key>.md`、用户级 Runtime 和可选私有 Git 同步。Markdown 是管理投影和可重建输入；主工作区与同一仓库的 worktree 共享稳定 project identity，不同仓库保持隔离。Remote 使用固定版本协议，token 值只存在环境变量中；Remote 失败不会静默切换到 Local。

显式新增、纠正、遗忘、回滚、展开或设置失败时会返回真实错误并保持原状态；后台 capture、Reflection、反馈或检索失败只记录诊断，当前工作流继续。
