# Native CLI 操作与运行成本审核

审核日期：2026-09-10。源码基线：`1617fa06da8a9bfbf5dd424316a1ba35072a289a`，版本 `0.4.1`。

## 结论与证据边界

Native 已有状态驱动的下一步命令，但交给 Agent 的输入协议仍有几处不一致：有时模板是对象，有时是互斥对象数组；Supervisor 任务包缺少角色回报模板；参数错误只返回笼统错误，恢复时需要再次查询和读参考。它们足以造成实际操作纠正，不能据此证明用户反馈的“三分之一时间”占比。

本次通过发布目录中的生成 Runtime，在临时 Git 项目与临时 HOME 中执行了完整普通 change 的协议生命周期。正式 brief/Spec 使用测试夹具内容；Builder 复核标识、Verifier 验收结果是明确标注的协议夹具输入，用于检查 CLI 接受什么结构，**不代表真实模型、真实独立复核或产品验收已经通过**。另外调用了当前 `bin/comet.js` 的公开 Native status/help 路径。未修改产品代码、生成 bundle、测试、配置或 website，也未重建或运行全量测试。

## 当前正常调用链

Native 当前公开命令是 `init/root/new/spec/show/status/select/next/archive/doctor`；阶段名 Shape、Build、Verify 不是对应的独立 CLI 子命令。`check` 是遗留入口，对当前 v4 change 明确拒绝。来源：`domains/comet-native/native-cli-help.ts:19-34`、`domains/comet-native/native-check-command.ts:15-20`。

| 阶段            | 正确操作                                                 | Agent 必须携带或填写的内容                                                |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 发现/恢复       | `status <change> --json`；只有名称未知时枚举             | 读取 `data.workspace.projectRoot`，进入绑定工作区后 `select`              |
| 创建            | `new <change> --isolation … --json`                      | 进入 `data.preparation.projectRoot`，后续不能继续用创建前的 cwd           |
| Shape           | 编辑 brief/完整目标 Spec，再执行返回的 `next --summary`  | 先准备并持久化确认边界；用户确认后执行带 state-version/action 的备选命令  |
| Build           | 实现、开发检查、新的只读代码复核                         | `builder-handoff` 对象：验收 ID、检查备注、限制、复核状态和执行标识       |
| Verify dispatch | `next --runner-input <file>`                             | `dispatch-verifier` 对象和 Runtime 实际执行的检查计划                     |
| 语义验收        | Agent 启动新的只读 Verifier                              | 从 `verifierDispatch` 读取 scope、工作区/证据位置；补充检查或提交逐项结果 |
| 验收决策        | 最终通过后等待用户决定                                   | Skill 协调的结果需用户接受；降级验收需明确接受降级                        |
| Archive         | 返回的 `archive --dry-run`，ready 后执行返回的 confirmed | 隔离工作区先确定 finish；不得插入额外 status 或手工提交状态文件           |

已有初始化的项目，一个一次通过的普通 change 从创建到归档至少需要九次生命周期调用：new、准备 Shape、确认 Shape、handoff、dispatch、Verifier response、接受结果、Archive preview、Archive confirmed。它们之外还有任务上下文读取、状态/详情读取、Agent 执行和检查命令。多次模型启动与九次 Runtime 调用不能全部归为“CLI 操作错误”。

## 发现与最小调整

### P2：Verify 的“复制模板”指引会产生解析器必然拒绝的输入

`assets/skills-zh/comet-native/reference/commands.md:32` 要求将 `inputOptions.template` 复制到临时 JSON 文件，只替换需要填写的值。Build 和 dispatch 阶段确实返回单个对象；但等待 Verifier 时，`domains/comet-native/native-portable-continuation.ts:952-999` 把 request-checks、final-result、execution-error、unavailable 四种互斥操作放进一个数组。解析入口 `domains/comet-native/native-runner-input.ts:165-176,281-282` 不接受数组。

实际失败与纠正链：

1. 将 Runtime 返回的等待 Verifier 的整个 `inputOptions[0].template` 写入 JSON 文件。
2. 执行 `next sentence-counting --runner-input <file> --json`。
3. 退出码 `65`，仅返回 `Native Runner input must be an object`，无当前 continuation。
4. 从数组中选出 `kind=verifier-response`、`response.kind=final-result` 的单个对象，填写当前 A1/iteration/attempt 后重试，退出码 `0`，进入 `confirm-skill-coordinated-pass`。

最小修正：互斥操作分别成为有名称的 input alternative，每份 `template` 始终是可单独提交的对象，并说明选择条件。短期至少同步中英文命令参考，明确“选择其中一份，不提交整个数组”。不要取消逐项验收或任务绑定校验。

### P2：输入字段严格，但错误没有指出该改哪个字段

`domains/comet-native/native-runner-input.ts:172-176` 和 `domains/comet-native/native-verifier-protocol.ts:60-65` 使用 exactKeys，只报告 `fields are invalid`。输入同时存在 `addressed_acceptance_ids/known_limits/reviewer_execution_ref` 与 `stateVersion/verifierExecutionRef/runId/candidateCommit/cwdRef` 两种命名风格。Agent 很容易按相邻字段的风格填写。

实际复现：把有效 Builder 输入的 `known_limits` 改成 `knownLimits`，退出码 `65`，错误只有 `Native Runner Builder input fields are invalid`，没有 missing/unknown 字段、JSON pointer、模板或恢复命令。改回 `known_limits` 后同一候选被接受。

最小修正：继续严格拒绝未知/漏填字段，但返回 `missingFields`、`unknownFields`、准确输入路径和当前动作的唯一模板；不要让 Agent 通过多轮试错发现字段名。短期保留现有字段兼容性，新增标准 Agent 投影时统一命名，避免一次重命名扩大迁移范围。

### P2：Supervisor 任务包没有完整的角色回报契约

`domains/comet-native/native-supervisor.ts:790-831` 生成的任务包含 role、child、projectRoot、baseCommit、runId、acceptance、contractHash、verificationBoundary、checksReason，但不包含回报命令、控制目录或角色输入模板。`domains/comet-native/native-portable-continuation.ts:848-869` 在 ready/active Child 阶段仍返回父级 `next --summary`；只有 verified Child 的 integration 模板在 `:808-845` 中展开。

这与 Skill 的“正常按 continuation，输入被拒绝等情况才读命令参考”形成缺口：首次 Builder 回报、Verifier 检查和验收输入的完整结构，需要另查命令协议。`native-cli-help.ts:176-178` 已列出角色输入字段，`commands.md:37-38` 也有语义说明，熟悉协议或提前读 help 的 Agent 可以正确回报。因此这是任务包不完整和额外查阅成本，不是必然失败或不存在可用入口；Agent 仍需手工拼 `supervisor-builder-result`、`supervisor-checks`、`supervisor-verifier-result` 等对象。

最小修正：每个任务包返回 `controlProjectRoot` 与实现工作区，附该角色可用的互斥命令和可提交 JSON 模板，已知的 child/runId/验收 ID 直接填入。Builder 只填候选提交或失败原因，Verifier 只填检查计划/逐项结论，不再重新猜关联字段。Supervisor 运行本轮为静态契约审核，未完成真实多 Agent 的端到端执行。

### P2：成功命令后的强制性状态复读增加成本

`assets/skills-zh/comet-native/SKILL.md:113` 与英文对应行要求变更命令后“通常重新运行”紧凑 status。大部分 `next` 已返回 state summary、loop 和最新 continuation（`domains/comet-native/native-next-command.ts:293-300`）；再读一遍通常只增加进程、Git/文件读取和输出处理。Archive 已明确禁止这种复读，普通阶段尚未统一。

同时输出位置不同：new 的阶段在 `data.phase`、版本在 `data.state_version`；status 使用 `data.phase`、`data.stateVersion`；next 使用 `data.state.phase`、`data.state.state_version`。本次实际响应确认了这些差异。返回并非不可解析，但无法使用一个简单的固定字段读取所有动作。

最小修正：成功变更响应作为当前权威观察结果直接执行下一步；只有恢复会话、并发状态失效、外部任务完成、工作区变化或确需长字段时再查询。给 Agent 增加一个统一的精简观察投影，固定 phase/status/stateVersion/workspace/continuation 路径，保留旧 data 兼容。

### P3：Windows 常见 UTF-8 BOM 文件只被报成 JSON 无效

`domains/comet-native/native-runner-input.ts:438-452` 直接 `JSON.parse` 文件内容。实际在有效输入前加 UTF-8 BOM，退出码 `65`，错误为 `Native Runner input must be valid JSON`，没有提示编码问题；相同内容去掉 BOM 即成功。

这是编码容错问题，不是用户验收与状态校验。最小修正是剥离一个文件开头的 BOM，保留其他 JSON 严格校验；同时支持明确的 stdin 输入或提供安全的输入文件创建方式，减少临时文件/编码/路径拼接步骤。未测试实际 Windows PowerShell 5 的写文件命令，仅验证了 BOM 字节对应的输入行为。

### 工作区路由需要明确上下文，但不能直接删除现有防错逻辑

new 返回的后续 `commandArgs` 不携带工作区，正确执行依赖 Agent 先进入 `preparation.projectRoot`。另一个容易混淆的点是 `domains/comet-native/native-cli-shared.ts:155-185`：当前进程已位于同仓 linked worktree 时，即使显式传入另一个 worktree 的 `--project-root`，也优先采用当前 cwd。这是为了防止宿主上下文误把 Child 写入主工作区而特意设置的保护。

不能仅凭这个覆盖就认定 status/details 错误：`native-status-discovery.ts:534-575` 会跨已登记 worktree 重新发现并选择绑定的 change。最小改善应是返回可执行动作的 cwd，并明确区分控制目录与实现目录；不应为了省一个 `cd` 直接取消同仓工作区保护。本轮不将未复现的同名 change 错误归责于该逻辑。

## 哪些拒绝应当保留

以下操作虽然可能让 Agent 重试，但主要属于正确安全边界，应通过更完整的执行协议减少误触，不应放宽校验：

- 未经过持久化 Shape 确认边界直接 `--confirmed`：实际退出 `64`，纠正为 prepare→用户确认→携带最新版本与动作的确认命令。
- Build 只用 `next --summary "Implementation complete"` 宣告完成：实际退出 `65`，同时返回 handoff continuation；需要真实复核和规定输入。
- 过期 state version、Verifier iteration/attempt、Supervisor runId：防止旧结果污染新候选。
- 少报、重复或凭空增加验收 ID，总 verdict 与逐项结果不一致，正式 Runtime 检查未通过却提交 pass。
- 把 Builder 的口头检查备注当正式回执，使用不对应候选提交的 receipt，或 Child 工作区未提交/不干净/分支错误。
- 在 Child 单独 Archive，或未集成完所有 Child 就验收父级。

源码边界分别见 `native-portable-runtime.ts:136-153`、`native-verifier-protocol.ts:181-240`、`native-runner-input.ts:460-487,819-859`。现有逐项验收覆盖错误已经能报告 duplicate/unknown/missing ID，是输入字段错误值得复用的诊断方式。

## 运行时间观察与优化顺序

隔离 fixture 仅有一个很小的实现文件和一个验收项，运行在本机 Windows/Node `v22.20.0`。以下是单次观察值，不是稳定基准，也不是用户真实项目耗时。主生命周期通过聚合生成 bundle 调用，公开 CLI 已另行核对；不要把聚合 bundle 数字当成当前快速分命令入口的精确成本。

| 操作                                        |           单次耗时 |
| ------------------------------------------- | -----------------: |
| new                                         |           1,094 ms |
| Shape prepare / confirm                     |   1,089 / 1,097 ms |
| Builder handoff                             |           1,251 ms |
| dispatch，空检查计划                        |           1,754 ms |
| Verifier final result / accept              |   1,161 / 1,221 ms |
| Archive dry-run / confirmed                 |   1,000 / 2,513 ms |
| active status 两次观察                      |       586 / 672 ms |
| archived status 三次观察                    | 315 / 358 / 325 ms |
| 公开 `bin/comet.js native status`，archived |             298 ms |

整份模板、字段命名、BOM 三种错误各耗费约 0.78–0.85 秒 Runtime 时间；更大的损失是错误后的模型分析、查 help、再次状态读取和创建输入文件。这些失败是人为定向构造的，不可用出现次数计算用户失败率。

建议顺序：

1. 先修模板互斥结构、Supervisor 任务回报模板、具体字段诊断与 cwd 传递。它们减少纠正轮次，不需要削弱状态机。
2. 取消已有完整成功响应后的例行 status；统一 Agent 观察结果。对于独立工作区，只查询当前目标，不重复枚举所有 change。
3. 记录每条调用的分类、退出码、动作前后、耗时、检查复用情况，区分模型等待、用户等待、检查执行、Runtime 自身开销；再用真实 trace 验证“三分之一”的分母和主要来源。
4. 测量并缓存单次调用内重复的配置/工作区/Git 身份读取；状态/验收只在相应边界执行必要的完整校验。不要缓存跨命令的工作树 hash 而不处理变更失效。
5. 将开发期可重复检查与正式 Runtime 检查通过同一候选和可信执行回执复用；不能直接信任 handoff 中的 passed 字符串。修复轮的已通过检查已有复用路径，应先确认实际命中率。
6. 将“实现后的独立代码复核”“新的语义 Verifier”“修复范围通过后的最终全量 Verifier”分别计时。这些是 Skill 当前要求的模型执行成本；是否合并第一种和第二种需要单独评估验收能力，不能把它伪装成 CLI 启动优化。

原始临时证据：`C:/Users/BENYM/AppData/Local/Temp/native-cli-audit-hM13e0/results.json`。该路径仅用于本机复核，不是项目产品数据或稳定发布文件。
