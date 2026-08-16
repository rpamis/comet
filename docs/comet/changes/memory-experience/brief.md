# 个人记忆用户体验与管理

## 目标

把 Personal Memory 的领域状态变成用户能理解、能控制、可恢复的体验：自动记忆保持安静，显式记忆有简短确认；CLI、Dashboard、用户可读 Markdown 和专用 Git 同步读取同一份权威状态。用户能看到当前有效记忆、候选/冲突、来源与最后确认时间，并能纠正、遗忘、回滚、暂停和同步，而不会接触 Runtime 文件、候选 ID、evidenceKeys 或完整来源内容。

## 范围

- 为 CLI 补齐稳定的查看、检索、记住、纠正、遗忘、回滚、状态、暂停、同步和 remote 管理入口；普通输出遵循当前配置语言，`--json` 输出稳定机器结构。
- 增加用户可读的管理投影：范围、项目、类别、标签、来源类型、证据数量、最后确认时间、active/inactive/conflict/tombstone 状态，以及可用的回滚信息。
- 让 Dashboard 通过公开 Personal Memory 插件能力加载同一份管理投影，并提供纠正、遗忘、回滚、暂停和同步操作；不把领域规则复制到 Dashboard。
- 保持 `profile.md` 与 `projects/<project-key>.md` 简洁、可读、可手工编辑；手工编辑、删除和 Git 同步后仍能确定性重建状态，不复活用户明确遗忘的内容。
- 保持语言边界：自动生成内容使用配置语言，直接 CLI 文本保留用户原文；普通用户消息不显示 Runtime、candidate ID、evidenceKeys 或证据计数。
- 为显式确认、首次实际采用、冲突提示、无命中 abstain、暂停和同步失败补充面向用户的契约测试。

## 非目标

- 不修改 `comet-memory` Skill 的判断规则，不实现 Skill 自进化。
- 不实现 Classic/Native/Hotfix/Tweak 生命周期触发、Entry/Plugin Bridge 接线或宿主后台调度；由 `memory-workflow-integration` child 负责。
- 不引入向量数据库、embedding、知识图谱、外部账户或新的托管同步服务。
- 不把个人记忆写入项目仓库、Skill、Agent 指令、Project Rules、Specs、测试、构建或 CI。

## 用户体验不变量

- 用户明确记住、纠正、遗忘后立即看到一次短确认；后台评审、候选形成、重复计数和同步默认静默。
- 只有记忆第一次实际改变处理方式，或与当前请求冲突时，才显示一句解释；不显示内部实现细节。
- 当前请求和仓库现状高于历史记忆；记忆不能授权提交、推送、删除、发布或其他外部副作用。
- 检索只注入 active、无冲突、未暂停且可靠匹配的有界记录；无可靠命中时返回空结果并 abstain，不注入泛化记忆。
- 所有用户入口使用同一 Personal Memory 权威状态；CLI、Dashboard、Markdown 和 Git 同步不能各自维护副本。

## 验收示例

- A1：中文配置下 CLI、Dashboard 和自动生成的 Markdown 标题/类别/标签为中文；英文配置下自动内容为英文；CLI 直接输入的正文保持原文。
- A2：`memory retrieve` 使用 scope/project/path/task/operation/category/tags/keyword 做确定性检索，结果有固定条目和字节上限、稳定排序和无命中 abstain。
- A3：`memory remember/correct/forget/rollback` 与 Dashboard 操作立即反映到检索和 Markdown；forget 产生最小 tombstone，旧同步不能复活。
- A4：管理投影展示来源类型、证据数量、最后确认时间和冲突状态，但不展示 candidate ID、evidenceKeys、原始 transcript、日志或 diff。
- A5：隐式候选、inactive、tombstoned、未解决 conflict 和暂停项目不进入普通检索；冲突可查看并通过纠正/删除处理。
- A6：Git 同步成功、无 remote、冲突和失败均有清晰的非阻塞状态；本地记忆在同步失败时仍可用。
- A7：`--json` 和公开插件能力使用版本稳定、可测试的管理结构；普通文本使用用户可读的短句而不是内部 JSON dump。
- A8：CLI 与 Dashboard 的纠正、遗忘、回滚、暂停和同步操作复用公开领域能力，不复制领域判断或直接操作 Runtime 文件。

## 验证预期

- 先运行现有 Personal Memory/domain、Plugin Bridge、CLI 测试，确认当前行为和缺口。
- 增加 domain 管理投影、冲突/候选过滤、语言和 Markdown/Git 同步一致性测试。
- 增加 CLI 文本/JSON、显式确认和错误降级测试；Dashboard 通过公开插件 descriptor 的 contract 测试。
- 对变更后的 `app/`、`domains/comet-memory/` 和对应测试运行最小相关测试；不运行无关的全量 Runtime 测试。
