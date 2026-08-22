# Comet 个人记忆

Comet 的个人记忆用于跨会话保留真正值得复用的个人偏好、协作习惯和已验证经验。它不是工作日志，也不会把每次命令、测试结果或完整对话存下来。

## 你会看到什么

- 你明确说“记住”“以后都这样”“改成”或“忘掉”时，Comet 立即执行，并给出简短确认或错误。
- 工作流在稳定成功检查点进行一次有界的后台复盘。没有形成可保存的内容、跳过复盘或重复观察时默认不打扰你。
- 只有一条记忆第一次实际改变了后续处理方式，或出现需要你处理的冲突时，才会显示简短提示。
- 记忆内容以可读 Markdown 保存：全局偏好在 `profile.md`，项目经验默认使用项目名保存，例如 `projects/comet.md`。系统另存内部 project key 用于准确关联；同一仓库的主工作区和 worktree 会使用同一份项目记忆。你可以直接查看和编辑这些文件。
- Comet 会把稳定的用户事实、偏好和协作习惯单独展示为 **User Profile（用户档案）**，再在下面提供按当前任务匹配的项目记忆。两层都按字符容量控制，不按固定条目数裁剪。

## 什么值得记录

适合记录：

- 你长期偏好的输出形式、语言或协作方式；
- 在多个成功任务中反复验证的个人工作习惯；
- 与当前项目相关、以后仍可能复用的个人经验。

通常会跳过：

- 一次性命令、某次测试通过、提交/Issue/PR 摘要；
- 可以从仓库轻易重新找到的普通事实；
- 猜测、流水账、完整日志、完整 diff 和完整 transcript；
- secret、凭据、PII、提示注入，以及要求修改 Skill、Agent 指令或项目规范文件的内容。

## 语言和范围

当前项目 `.comet/config.yaml` 的 `language` 决定自动记忆的可读语言：

- `zh-CN`：自动生成的正文、标题、类别、标签和原因使用中文；
- `en`：对应内容使用英文；
- 你在 CLI 中直接输入的记忆正文保持原文，不会被静默翻译。

自动观察默认只写入当前项目范围。只有明确的跨项目个人偏好，或你明确选择全局范围时，才会进入全局记忆。当前项目检索会使用适用的全局记忆和项目记忆，但不会把一个项目的经验自动推广成所有项目的规则。

## 查看和管理

CLI 和 Dashboard 使用同一份权威记忆状态；通过任一入口修改后，另一入口都能看到相同结果。

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

`forget` 默认保留回滚能力；永久删除需要显式使用 `--permanent`。暂停项目记忆后，新的学习和/或检索会按暂停设置停止，恢复后才继续。检索只返回当前作用域内有可靠匹配、没有未解决冲突且未被暂停的记忆。

`--project` 接受内部 project key；对当前项目执行命令时通常可以省略它。

## Provider 设置

Personal Memory 默认使用 Local Provider。你可以在用户级 `~/.comet/config.yaml` 中选择 Remote Provider，并设置两层上下文容量；这不会改变项目策略：

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

token 的值只放在指定的环境变量中，配置和 Dashboard 只保存变量名。Dashboard 可以测试当前 Provider、保存选择并调整字符容量；重新加载个人记忆页面后即可使用保存的 Provider。Remote 请求使用版本化的 `comet.personal-memory.provider.v1` 协议。

## Markdown 和同步

Markdown 是用户可读的管理投影，用于查看和修改个人记忆；重复内容、历史、冲突和检索边界由系统自动处理，你不需要维护其他文件。手动修改或删除 Markdown 会在下一次管理/检索时被识别为用户意图，后台观察不会静默把已移除内容写回来。

当前版本只使用项目名文件，不读取或迁移尚未发布的 `projects/<project-key>.md` 格式；内部 project key 和项目文件的对应关系保存在个人记忆根目录 `.comet/runtime/memory-state.json` 的 `projectFiles` 中。不同仓库如果项目名相同，系统会自动使用带短标识的文件名避免混淆。

个人记忆可以使用专用 Git remote 同步。没有 remote 时，本地记录、查看和检索仍然正常；远端不可用、认证失败或同步冲突时，本地记忆仍可用，稍后可以重新执行 `comet memory sync`。冲突不会由最后一次写入静默覆盖，用户可以查看、纠正或回滚。

## Classic 和 Native

Classic、Native、Hotfix 和 Tweak 共用同一个固定的第一方 `comet-memory` Skill 和 Personal Memory 能力。工作流只提供少量、可信的检查点事实，记忆评审不会扫描完整仓库、读取完整对话或修改任何 Skill。记忆能力不可用或后台失败时，主工作流仍按原逻辑完成。

## 边界

个人记忆只帮助 Comet 更好地理解你的长期偏好和可复用经验；它不会自动变成团队规范，也不会修改 Skill、Agent 指令、代码、测试或构建配置。你始终可以查看、纠正、遗忘、回滚、暂停或同步自己的记忆。
