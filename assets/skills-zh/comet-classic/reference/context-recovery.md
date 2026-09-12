# 上下文压缩恢复协议

规范路径：`comet-classic/reference/context-recovery.md`

## 阶段入口与按需恢复

先按 scripts.md 确认公开 CLI 和所选工作区。普通阶段衔接优先消费成功结果的 `agent.continuation` 和入口观察；观察已有效时不重复 next、select 或 check。只有观察缺失或失效时运行一次入口检查：

```bash
comet state check <change-name> <phase> --json
```

普通及冷恢复入口都提供 layout、configuration、nextAction、taskState、coordination 和 delivery。taskState 为 `{authority, revision, total, completed, needsIds, next}`；coordination 为 `{path, stale, taskIds, stage, sessionId, reviewRounds, unresolved}`。按 classic-layout.md 绑定逻辑路径，按实际 phase 路由；已返回的摘要不逐字段重复查询。写入或工作区、需求变化后刷新受影响状态。

nextAction 为 `{kind, reason, taskId?}`。先阅读 reason，再按 kind 续做：reconcile-task 核对实际成果，review 补审查，checkoff 补勾，check 补检查，reconcile-plan 补旧计划映射/同步，plan 补有效计划，configure 补配置，workspace 修复工作区归属，delivery 处理授权交付。它不是跳过验收的许可；taskId 必须与权威任务对齐。

仅在冷启动、对话被压缩或恢复证据不足时使用：

```bash
comet state check <change-name> <phase> --recover --json
```

先用紧凑恢复包定位未完成动作。需要完整任务和检查点时，再显式加 `--details`，在 taskState 中增加 tasks，在 coordination 中增加 checkpoint：

```bash
comet state check <change-name> <phase> --recover --details --json
```

只读取当前动作缺少的正文。Runtime 将检查证据标为 `revalidated` 或 `rerun-required`；只有前者可复用，本地输入、环境、日志或一次性证据不满足条件时只重跑对应检查。恢复不清空计划、任务、审查或已用轮次。

## Ambient Resume

用户未明确调用 Classic，但仓库可能存在活跃 change 时，按 scripts.md 将当前请求通过 stdin 传给 `comet resume-probe . --stdin --json`；只有 auto_resume 自动恢复，ask_user 短问用户，out_of_scope/none 不进入流程。

## 入口错误与恢复

命令失败、依赖不可用、状态缺失或产物不完整时，保留原错误并按对应原因处理；只有当前输入足以验证的恢复动作才自动执行，恢复成功后重新运行受影响入口检查。

| 观察到的问题                                           | 可执行的恢复动作与停止边界                                                                                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comet classic openspec -- list --json` 失败           | 核对 OpenSpec 是否已安装与实际命令错误；artifact root 缺失或损坏时说明 `comet update --scope project` / `comet init --scope project` 的修复用途，不把命令失败当作“没有 active change”，不擅自升级或重新初始化用户环境。 |
| 当前阶段要求的 Comet/OpenSpec/Superpowers Skill 不可用 | 停止依赖该 Skill 的动作，指出缺失名称与安装/启用条件；不以普通对话替代强依赖，也不静默更换已选执行策略。                                                                                                                |
| `.comet.yaml` 缺失                                     | 先从本次明确选择和可验证产物核对 workflow；full 返回 `/comet-open`，hotfix/tweak 返回对应预设的初始化步骤，完成初始化后再 `comet state select`。workflow 无法确定时请求用户选择，不默认改成 full。                      |
| `.comet.yaml` 格式异常                                 | 报告解析错误，从版本控制、备份或可验证产物恢复；不能用 `comet state set` 覆盖损坏文件，也不能根据现有文件猜测 phase 后推进。                                                                                            |
| change 目录或必需产物不完整                            | 按当前 workflow 的 Open 初始化规则和 artifact 检查返回的依赖补齐；已有有效产物保留，Open 完整仍需最终审视确认。                                                                                                         |
| 工作区绑定冲突或路径越界                               | 按 workspace.md 核对绑定与实际路径；需要切回绑定分支或 rebind 时展示合法选项并等待明确选择，无法确认归属时停止写入。                                                                                                    |
| 构建、测试或手动验证失败                               | 保留当前 change 与失败证据，按 debug-gate.md 调查；Build 失败不得运行完成 Guard，Verify 失败按 Verify 修复循环续做，不以历史通过覆盖本次失败。                                                                          |

## 任务核对与补勾

`tasks.md` 是任务完成状态的唯一权威，计划描述实施方法。未勾选不能直接作为重新实施的依据，已有勾选也不能替代当前验收证据。

1. 按稳定 task ID、需求 revision 和 plan base-ref，核对当前文件、Git diff/提交、检查结果、审查与未解决反馈；未提交改动先按 dirty-worktree.md 归因。
2. 实现、检查和所需审查均已满足：直接通过 task-complete 补勾，不重复实施。
3. 实现已完成但证据不足：仅补缺失检查或独立审查；已有部分实现时仅补剩余部分。TDD 历史 RED 缺失要如实记录，不能回退代码伪造证据或自行宣布满足 TDD。
4. 有效证据与当前输入不匹配时，只重新验证受影响部分；验收通过后再勾选。
5. 使用 `comet state task-complete <name> <task-id> --expect <revision> --json`。revision 冲突时重新判断任务语义，不只是取新 revision 重试。

旧计划保留 checkbox 时，先建立明确的 comet-task ID 对应关系。task-complete 会自动从 tasks.md 同步已有映射的旧计划；需要单独刷新显示时运行：

```bash
comet state sync-plan <name>
```

返回 `planSync: mapping-required` 时，只补明确的 ID 映射再运行 sync-plan，不重做实现，也不重新判定已完成任务。计划是显示投影，不是第二份完成判据。没有 ID 的任务先由 tasks --assign-ids 分配稳定 ID；禁止按序号、位置或相似标题猜测。旧计划额外的真实任务先核对范围并纳入 tasks.md；无法确定对应关系时记录 unresolved 并澄清，不删除条目换取通过。计划勾选本身不能证明实现完成。

## Runtime 协调记录

`state checkpoint` 管理的协调记录存储为 `<classic-change-dir>/.comet/coordination.json`，人读投影仍为 `.comet/subagent-progress.md`。`.comet/checkpoint.json` 属于 Engine，不是协调记录；不得人工修改或覆盖，也不能将其作为 --file 的输出目标。

普通入口包的 coordination 摘要足够时不重复读取。需要完整记录或保存状态时：

```bash
comet state checkpoint <change-name>
comet state checkpoint <change-name> --file <json-path>
```

JSON 必须包含 `schemaVersion: 1`，其余字段为 taskIds/revision/stage/sessionId/evidence/unresolved/reviewRounds。以下示例中的任务 ID、revision 和会话标识必须替换为本次实际值：

```json
{
  "schemaVersion": 1,
  "taskIds": ["task-1"],
  "revision": "<task-revision>",
  "stage": "implementing",
  "sessionId": "<implementer-session-id>",
  "evidence": [],
  "unresolved": [],
  "reviewRounds": 0
}
```

evidence 保存实际提交、RED/GREEN 和审查证据引用；unresolved 保存未解决事项，不复制完整对话。stage 表示实际执行/审查/补勾步骤，reviewRounds 保留已用复查轮次。Runtime 验证并生成 Markdown；不手写 subagent-progress.md，不把协调记录当作任务完成清单。

读取结果为 `{checkpoint, stale}`。stale 为 true 时先核对 revision、任务范围和真实成果，不直接重放原动作；checkpoint 为空也不表示尚未实施。补齐记录后重新读取确认，不能绕过验证手写内部状态。

派发前持久化任务范围与协调会话；派发返回会话 ID 后立即保存 sessionId，再继续等待或处理回报。阶段交接、审查结果、验收和阻塞时保存新增证据与下一步；同一步骤的零碎消息可合并，不逐条复制对话。保存失败时停止后续派发和推进，保留现有文件供核对。

记录缺失、会话失效或 revision 不匹配时先检查真实成果，重建最小记录；不能把“无检查点”解释为“无实现”。保留尚有效的审查与轮次，不因新会话重置预算。

## 各阶段恢复

恢复先取得当前 phase、configuration 和 nextAction，再进入该阶段 Skill；元数据与文件冲突时处理入口报告，不从文件存在推断完成，也不手改 phase。

- Open：状态文件缺失按上方“入口错误与恢复”核对 workflow 并完成相应初始化；格式损坏先修复来源。产物完整仍需核对 Open 用户确认，不能只凭文件推进。
- Build 暂停：`build_pause: plan-ready` 表示用户要求计划后暂停。有效计划与配置沿用；只有用户明确要求继续才清除暂停。仅在配置缺失或用户明确要求更改时回到 Build 的写计划前联合决策，不因恢复暂停重问有效配置。计划缺失时核对文件与状态，修复后仍保留用户暂停意图。
- Build 工作区：旧 change 缺 isolation 或目录不匹配时按 workspace.md 恢复 Open 的 workspace resolve/prepare；不在 Build 首次决定或切换工作区。
- 已记录验证失败：`verify_result: fail` → 自动调用 `/comet-build` 继续修复已记录的失败，不重复写入同一次 verify-fail；达到自动修复上限或需接受偏差时由 `/comet-verify` 按真实失败次数处理例外决策。

- Build：有效计划和配置继续使用。autonomous 不加载外部执行 Skill；其他策略只在上下文缺少所需方法时加载。委派按 subagent-dispatch.md 恢复有界工作包和原 implementer；subagent-driven-development 主会话不接管实现。任务全完成即返回 Build 退出检查，不恢复旧 Build final-review/final-fix。
- Design：尚未确认的方案继续澄清；已确认则只补正式 Design Doc 或未完成的状态写入。按需读 brainstorm-summary.md 和一个 Markdown handoff，机器 JSON 默认由 Runtime 校验；不重新读取全部重复上下文。
- Verify：核对报告、实际 diff 和有效审查证据，只补缺失检查或受影响审查，不从规模评估重新启动整个阶段。
- Archive：普通入口和 delivery 读取不触网；使用 `comet state delivery <change-name> --verify` 只读核对 Git、远端/PR，从返回 `{delivery, verification}` 中确认授权与实际结果。归档存在不再次归档，提交存在不再次提交，远端已完成不重复 push/创建 PR。handled 不能推出授权或成功；缺记录或目标变化时按 Archive 规则确认。
