# 上下文压缩恢复协议

规范路径：`comet-classic/reference/context-recovery.md`

## 阶段入口与按需恢复

先按 scripts.md 确认公开 CLI 和所选工作区。正常进入下一阶段时，优先按成功结果中的 `agent.continuation` 继续，并使用入口返回的状态信息；信息仍有效时不重复 next、select 或 check。只有这些信息缺失或失效时，才运行一次入口检查：

```bash
comet state check <change-name> <phase> --json
```

普通入口和恢复入口都会返回 layout、configuration、nextAction、taskState、coordination 和 delivery。taskState 为 `{authority, revision, total, completed, needsIds, next}`；coordination 为 `{path, stale, taskIds, stage, sessionId, reviewRounds, unresolved}`。按 classic-layout.md 确定各逻辑路径对应的目录，根据实际 phase 进入对应阶段。摘要中已有的字段不再逐个查询。状态写入，或工作区、需求发生变化后，重新读取受影响的状态。

nextAction 为 `{kind, reason, taskId?}`。先阅读 reason，再根据 kind 完成对应步骤：reconcile-task 表示核对实际成果，review 表示补充审查，checkoff 表示补记任务完成状态，check 表示补充检查，reconcile-plan 表示补齐旧计划与任务的对应关系或同步状态，plan 表示补充有效计划，configure 表示补齐配置，workspace 表示修复工作区归属，delivery 表示完成已授权的交付。nextAction 不允许跳过验收；其中的 taskId 必须对应 tasks.md 中的任务。

仅在新会话没有先前上下文、对话被压缩或恢复证据不足时使用：

```bash
comet state check <change-name> <phase> --recover --json
```

先用返回的恢复摘要确定未完成步骤。需要完整任务和检查点时，再加 `--details`；这会在 taskState 中增加 tasks，在 coordination 中增加 checkpoint：

```bash
comet state check <change-name> <phase> --recover --details --json
```

只读取当前步骤还缺少的正文。Runtime 会将检查证据标为 `revalidated` 或 `rerun-required`，只有前者可以复用。如果本地输入、环境、日志或仅适用于当次执行的证据不满足复用条件，只重新运行对应检查。恢复时保留计划、任务、审查记录和已用复查次数。

## Ambient Resume

用户未明确调用 Classic，但仓库可能存在未归档的 change 时，按 scripts.md 将当前请求通过 stdin 传给 `comet resume-probe . --stdin --json`。返回 auto_resume 才自动恢复；返回 ask_user 时向用户提出一个简短问题；返回 out_of_scope/none 时不进入流程。

## 入口错误与恢复

命令失败、依赖不可用、状态缺失或产物不完整时，保留原错误并按对应原因处理。只有能根据当前输入确认正确的恢复动作才自动执行；恢复成功后，重新运行受影响的入口检查。

| 遇到的问题                                             | 如何恢复，以及何时必须停止                                                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `comet classic openspec -- list --json` 失败           | 核对 OpenSpec 是否已安装，并查看命令的实际错误。产物根目录缺失或损坏时，说明 `comet update --scope project` / `comet init --scope project` 可用于修复；不把命令失败当作“没有未归档的 change”，不擅自升级或重新初始化用户环境。 |
| 当前阶段要求的 Comet/OpenSpec/Superpowers Skill 不可用 | 停止依赖该 Skill 的动作，说明缺少哪个 Skill，以及需要安装或启用什么。必须使用的 Skill 不能用普通对话代替，也不能擅自更换用户选定的执行方式。                                                                                   |
| `.comet.yaml` 缺失                                     | 先从本次明确选择和可验证产物核对 workflow；full 返回 `/comet-open`，hotfix/tweak 返回对应预设的初始化步骤，完成初始化后再 `comet state select`。workflow 无法确定时请求用户选择，不默认改成 full。                             |
| `.comet.yaml` 格式异常                                 | 报告解析错误，从版本控制、备份或可验证产物恢复；不能用 `comet state set` 覆盖损坏文件，也不能根据现有文件猜测 phase 后推进。                                                                                                   |
| change 目录或必需产物不完整                            | 按当前 workflow 的 Open 初始化规则，以及产物检查返回的依赖关系补齐文件。保留已有的有效产物；文件完整后仍需请用户最终检查并确认 Open 产物。                                                                                     |
| 工作区绑定冲突或路径越界                               | 按 workspace.md 核对绑定与实际路径；需要切回绑定分支或 rebind 时展示合法选项并等待明确选择，无法确认归属时停止写入。                                                                                                           |
| 构建、测试或手动验证失败                               | 保留当前 change 与失败证据，按 debug-gate.md 调查。Build 失败时不能通过完成 Guard 进入下一阶段；Verify 失败时按该阶段规则修复并重新验证，不能用以前的通过结果覆盖本次失败。                                                    |

## 任务核对与补勾

任务完成状态只以 `tasks.md` 为准，计划用于说明实施方法。任务未勾选不能直接作为重新实施的依据，已有勾选也不能替代当前验收证据。

1. 根据稳定的 task ID、需求 revision 和计划中的 base-ref，核对当前文件、Git diff/提交、检查结果、审查记录与未解决的反馈。未提交改动先按 dirty-worktree.md 核对来源和归属。
2. 实现、检查和所需审查均已满足：直接通过 task-complete 补勾，不重复实施。
3. 实现已完成但证据不足：仅补缺失检查或独立审查；已有部分实现时仅补剩余部分。TDD 历史 RED 缺失要如实记录，不能回退代码伪造证据或自行宣布满足 TDD。
4. 有效证据与当前输入不匹配时，只重新验证受影响部分；验收通过后再勾选。
5. 使用 `comet state task-complete <name> <task-id> --expect <revision> --json`。revision 冲突时，重新核对任务要求是否变化，不能只换成新 revision 就重试。

旧计划中仍有任务复选框时，先明确每一项对应的 comet-task ID。task-complete 会根据 tasks.md 自动同步这些任务在旧计划中的状态；需要单独更新显示时运行：

```bash
comet state sync-plan <name>
```

返回 `planSync: mapping-required` 时，补齐明确的 ID 对应关系后再运行 sync-plan，不重做实现，也不重新判定已完成任务。计划中的完成状态只是用于显示的副本，不能作为另一套完成依据。没有 ID 的任务，先由 tasks --assign-ids 分配稳定 ID；禁止按序号、位置或相似标题猜测对应关系。旧计划中额外存在的实际任务，先核对范围并纳入 tasks.md；无法确定对应关系时，记录 unresolved 并向用户澄清，不删除条目来通过检查。计划勾选本身不能证明实现完成。

## Runtime 协调记录

`state checkpoint` 管理的协调记录保存在 `<classic-change-dir>/.comet/coordination.json`，供人阅读的 Markdown 文件为 `.comet/subagent-progress.md`。`.comet/checkpoint.json` 由 Engine 使用，不属于协调记录；不得人工修改或覆盖，也不能将其作为 --file 的输出目标。

入口返回的 coordination 摘要已经足够时，不再重复读取。需要完整记录或保存状态时运行：

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

evidence 保存实际提交、RED/GREEN 结果和审查证据的引用；unresolved 保存未解决事项，不复制完整对话。stage 记录当前处于执行、审查还是补记任务状态的步骤；reviewRounds 记录已经使用的复查次数。Runtime 检查数据后生成 Markdown；不手写 subagent-progress.md，也不把协调记录当作任务完成清单。

读取结果为 `{checkpoint, stale}`。stale 为 true 时，先核对 revision、任务范围和实际成果，不直接重新执行原步骤；checkpoint 为空也不表示尚未实施。补齐记录后重新读取确认，不能手写内部状态来绕过检查。

分配任务前，保存任务范围和协调会话信息；取得子代理会话 ID 后立即保存 sessionId，再继续等待或处理回复。在阶段交接、审查完成、验收或遇到阻塞时，保存新增证据和下一步安排。同一步骤的零碎消息可以合并，不逐条复制对话。保存失败时，停止继续分配任务和推进阶段，保留现有文件供核对。

记录缺失、会话失效或 revision 不匹配时，先检查实际成果，重建恢复所需的记录；不能把“无检查点”解释为“无实现”。保留仍有效的审查结果和已用复查次数，不能因为换了会话就重新计算次数。

## 各阶段恢复

恢复时先取得当前 phase、configuration 和 nextAction，再进入对应阶段 Skill。状态记录与文件不一致时，处理入口报告的具体问题；不根据文件存在就推断阶段已完成，也不手改 phase。

- Open：状态文件缺失按上方“入口错误与恢复”核对 workflow 并完成相应初始化；格式损坏先修复来源。产物完整仍需核对 Open 用户确认，不能只凭文件推进。
- Build 暂停：`build_pause: plan-ready` 表示用户要求计划后暂停。有效计划与配置沿用；只有用户明确要求继续才清除暂停。仅在配置缺失或用户明确要求更改时，回到 Build 的写计划前步骤，一次确认需要补充的配置。不能因为恢复暂停任务就重新询问有效配置。计划缺失时核对文件与状态，修复后仍按用户要求保持暂停。
- Build 工作区：旧 change 缺 isolation 或目录不匹配时按 workspace.md 恢复 Open 的 workspace resolve/prepare；不在 Build 首次决定或切换工作区。
- 已记录验证失败：`verify_result: fail` → 自动调用 `/comet-build` 继续修复已记录的失败，不重复写入同一次 verify-fail；达到自动修复上限或需要接受偏差时，由 `/comet-verify` 根据实际失败次数向用户询问下一步。

- Build：继续使用有效计划和配置。autonomous 不加载外部执行 Skill；其他策略只在上下文缺少所需方法时加载。委派任务按 subagent-dispatch.md 恢复原先分配的任务范围，以及负责实现的子代理会话；subagent-driven-development 模式下，主会话不接管实现。全部任务完成后，返回 Build 执行退出检查，不恢复旧的 Build final-review/final-fix 步骤。
- Design：尚未确认的方案继续澄清；已确认的方案只补正式 Design Doc 或未完成的状态写入。按需读取 brainstorm-summary.md 和一份 Markdown 交接文件；供程序使用的 JSON 默认由 Runtime 校验，不重复读取全部上下文。
- Verify：核对报告、实际 diff 和有效的审查证据，只补充缺失的检查或受影响的审查，不从规模评估重新开始整个阶段。
- Archive：普通入口和 delivery 读取不会访问网络。使用 `comet state delivery <change-name> --verify` 只读核对 Git、远端和 PR 状态，从返回的 `{delivery, verification}` 中确认授权与实际结果。已经归档的不再归档，已经提交的不再提交，远端已完成的操作不再重复 push 或创建 PR。不能根据 handled 推断已获得授权或交付成功；记录缺失或目标变化时，按 Archive 规则确认。
