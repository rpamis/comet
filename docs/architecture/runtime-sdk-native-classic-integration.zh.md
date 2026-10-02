# Native 与 Classic 接入 Runtime SDK：设计与验收边界

状态：Native 与 Classic 新 change 的 SDK 接入、原状态文件投影和活跃 change 跨设备恢复已实现。当前接口以 [Runtime SDK 文档](./runtime-sdk.zh.md) 和源码为准；本文件后文保留设计目标与验收条件，真实平台与模型 Eval 仍需单独验收。

新建 Native change 和 Classic full/hotfix/tweak change 默认创建 SDK Run；旧 change 继续由原 Runtime 管理，不自动迁移。两套应用使用同一 SDK 内核的 Run、Action、Wait、命令、证据与恢复机制，各自保留领域状态机。Native 的公开 new/status/select/next/spec remove/Archive/Doctor 已按持久化归属路由；Classic 的公开 state、Guard、check、workspace、交付入口按 SDK 归属推进。新 change 仍在原位置保存 Native `comet-state.yaml` 或 Classic `.comet.yaml`，并随 change 归档；状态文件新增 Runtime 管理的 `run_checkpoint` 字段，保存跨设备恢复所需的 Run 事实，原有阶段字段和读取路径不变。复制状态文件、文档和代码到新设备后，普通 Native 与 Classic change 可从已保存的阶段、Action 和确认继续，本机执行记录会重新建立；结果未明的外部动作需要先核对，不会自动重放。Supervisor Child 的独立 worktree 与未提交代码不包含在父 change 状态文件中，不能仅凭该文件自动接管；可按下述步骤显式转移。旧状态文件若没有检查点，则无法精确恢复；显式确认后可保留正式文档并分别从 Shape 或 Open 重新开始。

跨设备转移进行中的 Supervisor Child Builder 时，先停止原设备上的 Supervisor 与 Child Agent，再在原项目执行 `comet native transfer export <change> --output <新目录> --confirmed-stopped`。将整个私有目录复制到目标设备；它包含父 change 文件、临时分支的 Git bundle、各 worktree 的已跟踪修改补丁与原始文件字节，以及非忽略的未跟踪文件，可能包含源代码或敏感内容。目标设备需有同一项目的 Git 检出、相同的项目配置，且目标分支仍指向导出时的提交。执行 `comet native transfer import --input <目录>` 后，Runtime 在目标检出中恢复 Child 与集成 worktree、父状态文件和 SDK Run，并记录原始与导入后的 checkpoint 哈希。原设备已领取但未提交结果的 Builder 在目标设备保持 `unknown`，需检查转移的代码并核对结果后再继续；导入不会把它视为完成，也不会自动重放。当前仅支持 Child Builder 阶段、尚未进入 Child 检查或集成的 Supervisor；忽略文件和外部依赖不在转移包内。目标项目若已有同名 change、目标分支漂移或包内容不匹配，导入会拒绝。只复制父状态文件仍会因缺少 Child worktree 而停止恢复。

本地自动化覆盖 Native 普通 change、Supervisor 双 Child，以及 Classic full/hotfix/tweak 的关键路径、失败/未知结果与跨 worktree 归属。全量测试、生成 Runtime、发布包 E2E、真实平台 Hook、宿主交接和模型 Eval 需要分别记录当前候选的结果，不能沿用旧候选的通过结论；正在运行、超时或证据缺失的项目仍未完成。新 change 默认创建 SDK Run，并在原路径保留状态文件；显式创建原 Runtime change 时使用 `--runtime compat`，未发布的 `--runtime legacy` 不保留。显式迁移旧 change 尚未实现；是否提供迁移命令应按真实需求单独决定，不是默认切换的前置条件。

当前跨设备恢复覆盖活跃 change，以及 Classic 已移动、结果未提交的 Archive 和待交付的归档 change。Classic 可在确认原执行者停止后使用 `comet archive <change> --recover` 核对原 Action、归档目录及工件要求；不会再次运行 OpenSpec Archive。Native 可从归档状态文件恢复已完成文件移动但结果未提交的 Archive Action；归档凭据随状态文件保存，恢复时还会核对验证报告与 canonical Specs。已启动的 Supervisor 协作仍需单独核对，未解决的外部执行保持结果待核对，不能用重建本机记录绕过。

## 目标与现状

Native 和 Classic 应成为两种完整的 Workflow Application：都通过公开 SDK 创建、推进、确认、恢复和结束 Run，分别展示自主的 Native 流程与依赖外部 Skill 的 Classic 流程。SDK 统一承担持久化编排机制；两套流程保留各自的阶段、验收和交互规则。

当前工作分支的新 change 已默认走 SDK；已存在的旧 change 仍由原 Runtime 管理。两套流程已有模型运行证据，但最终候选的完整验收仍须逐层核对。流程完成、业务检查、提示评分、执行效率和异常恢复是不同结论；报告的检查全部通过不代表所有质量维度满分。[实施计划](./runtime-sdk-plan.md)记录的是先前局部接入阶段，不能作为当前验收结果。

## 术语和职责

| 概念                           | 本设计中的含义                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Agent、Tool、Session           | 宿主平台拥有的推理循环、工具和会话；SDK 不实现第二套 Agent loop。               |
| Workflow Definition、Run、Step | 版本化流程、一次跨宿主会话的执行、流程图中的步骤。                              |
| Action、Attempt、Outcome       | 一项可领取的外部工作、它的一次尝试、执行者回报；Action 不等同于模型 Tool Call。 |
| Handoff                        | 宿主 Agent 之间的真实交接；普通 Skill 或 CLI 调用不使用此名称。                 |
| Wait、Approval、Checkpoint     | 持久等待、绑定提案的用户决定、从已提交边界恢复所需的事实。                      |

这些名称参照 [OpenAI Agents SDK 的 Agent 与 Runner](https://openai.github.io/openai-agents-python/agents/)和 [LangGraph 的状态、节点与检查点](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)，但保留 Comet 执行协议中有独立语义的 Action、Outcome 和 Wait。不把 Run 称为 Session，也不把所有外部执行称为 Tool Call。

## SDK 的外部接口

保留 `@rpamis/comet/runtime` 的 `createRuntime`、`defineWorkflow`、`RuntimeStore`、`RuntimeExecutor`、`RuntimeValidator`，以及现有 `start`、`inspect`、`next`、`claim`、`recordOutcome`、`resolveWait` 等操作。应用通过这些公开接口接入；Native 与 Classic 不再直接导入 `domains/engine/runtime-action.ts` 等内部文件。

原有静态 `steps/transitions` 可以表达顺序、分支和 join，却不能完整表达两套流程根据当前工件、验收证据和用户决定变化的状态。本轮接入增加了以下机制，实际接口以 SDK 文档和源码为准：

1. Run 持有经过 schema 校验的工作流业务状态和工件引用。SDK 拥有 revision、Action、Wait、当前步骤及状态提交；应用拥有字段含义与有效性规则。宿主凭据和模型上下文不进入 Run。
2. 工作流注册版本化的纯转移处理器，输入为当前 Run 与一个已验证事件，输出为业务状态更新和允许的下一步骤。SDK 检查定义中的合法转换、版本绑定与并发 revision，再一次提交结果；处理器不能执行工具、写文件或绕过领取与确认协议。
3. 对 `tasks.md` 更新、检查收据等不由 Action Outcome 直接产生的证据，增加受工作流定义声明、由版本化验证器检查的证据提交操作。提交的是证据引用与内容摘要，不是“任意修改 Run”的入口。重放、陈旧证据与旧提案必须被拒绝或幂等处理。

接口形态如下；`WorkflowEvent` 只能来自 SDK 已接受的 Outcome、用户决定或已验证证据，不能由应用随意构造后直接提交状态：

```ts
interface WorkflowTransitionHandler {
  id: string;
  version: string;
  apply(input: { run: Readonly<WorkflowRun>; event: Readonly<WorkflowEvent> }): {
    state: RuntimeValue;
    next: Array<string | { stepId: string; input: RuntimeValue }>;
  };
}

const runtime = createRuntime({
  store,
  workflows: [nativeWorkflow],
  transitionHandlers: [nativeTransitions],
  evidenceValidators: [nativeEvidence],
  executors: [nativeHostExecutor],
});

await runtime.recordEvidence({
  runId,
  evidenceId,
  kind: 'check-receipt',
  ref: 'runtime/evidence/checks/receipt.json',
  contentHash,
  submissionId,
  expectedRevision,
});
```

工作流定义声明允许的证据种类、验证器和转移处理器的 id/version；Run 固定这些版本。`recordEvidence` 从定义查找验证器，由宿主验证器核对引用范围与读取时的文件内容摘要，然后在同一次 CAS 提交中应用纯转移。缺少固定版本、验证时内容漂移或 revision 变化时拒绝提交。外部文件仍可能在验证后改变，因此后续依赖该文件的动作必须按记录的摘要重新核对；Run 的 CAS 不能提供外部文件的原子锁。

这是一处由 Native、Classic 两个真实实现共同证明的扩展接缝。若其中一种流程无需某项扩展，不为了接口对称而添加空实现。SDK 仍只调度已声明的工作，不发起模型请求，也不代替平台的 Hook、Rule、MCP 或沙箱。

## 唯一权威状态与兼容迁移

每个 change 在任一时刻只选择一种权威运行格式，不同时维护可独立推进的旧 Runtime 状态和 SDK Run。新建 change 使用 SDK Run；`comet-state.yaml`、`.comet.yaml` 和 CLI 输出保留原有路径及字段，流程决定从已提交的 SDK Run 派生。Classic 状态文件中的用户配置字段可同步回 Run，阶段等执行字段不能通过编辑 YAML 绕过状态机。状态文件滞后时须重建或拒绝读取，不能反向成为第二份可推进的流程状态。文档、源码和验证报告仍是外部工件，Run 记录其内容摘要与引用。

已有未归档 change 默认继续由创建它的旧 Runtime 处理，直到归档。入口依据持久化的格式标识路由，不能靠文件是否存在猜测。本轮不提供活动 change 迁移命令；将来若有真实需求，必须通过显式命令在安全检查点核对旧状态、待执行 Action、用户确认与证据，再以可恢复的迁移记录切换权威格式。存在未知外部副作用、待确认提案或无法证明一致性的状态时应拒绝迁移。不能静默升级，也不能通过双写维持兼容。

Native 现有锁、WAL 和 Archive 事务，Classic 现有状态文件及轨迹，仍可作为各自的持久化适配实现；它们不能绕过 SDK 的状态转移和领取协议。需要先用故障注入证明一次提交不会产生两份互相矛盾的流程决定，再确定物理文件布局。

Native Supervisor 的 SDK 路径沿用同一个父 change 的 Run。`children.yaml` 是需要在 Shape 确认前验证并绑定摘要的外部计划；它不保存执行状态。每个 Builder、独立 Verifier、检查和集成操作都对应可领取的 SDK Action，子任务名与合同摘要进入 Action 输入。只有集成 Action 的合格 Outcome 被提交到 Run 后，依赖该子任务的后续 Action 才可派发；并行上限还要扣除已派发且未结束的子任务。已领取但结果未知的 Action 不得因进程重启而重新派发。旧 `native-supervisor-state` 文件只服务旧 Runtime change，不能在 SDK 路径中成为第二份可推进状态。全部子任务集成后，父级检查、独立验收和 Archive 仍由同一个 Run 控制。

目前 SDK 已有带输入的动态步骤激活，以及依据已集成、进行中子任务和并行上限选择下一批子任务的纯调度函数。Native Supervisor 的 Shape 已能绑定 `children.yaml` 和推进方式；SDK Action 能准备集成与 Child worktree、派发 Builder、校验候选 Git 提交、运行 Child 检查、接收独立 Verifier 结果、合并提交并运行集成检查。两个 Child 可并行 Build 和 Verify，已通过独立验收的 Child 排队串行合并，每次合并的集成检查成功后才合并下一个。Child 检查失败或独立 Verifier 明确判定失败时，Run 会生成绑定原失败 Action 的同一 Child Builder 修复任务。集成检查明确失败时，Run 会生成绑定原检查和集成提交的宿主修复 Action；新提交必须是原提交的后继，且须通过新的可重复检查，修复期间其他 Child 不提前合并。合并冲突会保留为结果待核对的原集成 Action；宿主在原 Git 合并现场完成 merge commit 后，可在冷启动的新进程中提交原 Action 的结果。合并前集成分支的提交必须等于上次成功集成检查的提交，漂移时停止执行；若核对证明确未合并，才可用 reconciliation 重试。依赖 Child 在前置集成检查成功后从新的集成提交准备工作区。全部 Child 完成后，父级 Builder 候选及其真实检查、独立 Verifier、用户确认、目标分支快进交付和 Archive 已在临时 Git 项目验证正常路径。父级独立 Verifier 失败或用户拒绝验收时，Run 会回到父级 Builder；修复后的新集成提交须重新检查、独立验收和确认，交付只接受该提交。公开 `native next` 返回全部 `pendingActions`，保留第一项的 `pendingAction` 兼容字段。交付前目标分支若已漂移，Action 会保留为结果未知且不会快进；其他失败、结果未知及 Git 操作内部的并发漂移仍需验收，不能把正常路径测试当作完整 Supervisor 流程验收。

普通 Builder、Supervisor Child Builder 或父级 Builder 提交 `failed` 结果后，Run 会保留原失败 Action 和工作区内容，并创建 `build.resume`、`supervisor.child.resume` 或 `supervisor.parent.resume` Wait。宿主应先检查部分修改，再由用户显式决定是否继续；公开 `native next --json` 给出待决 Wait、提案摘要和 `--continue-builder` 命令参数。该决定创建新的 Builder Action，继承原工作区绑定并记录 `failedBuilderActionId`，不会把原 Action 改写成“未执行”或自动重发。SDK 的手工 `retry` 仍只适用于确实核对为未执行的原 Action。三类 Builder 的失败继续路径已在本地临时 Git 项目和公开 CLI 测试中覆盖；真实平台上的用户决策和宿主交接仍需验收。

本轮新增 Supervisor 专属的 `supervisor.cleanup` Action：Archive 完成后，先核对已交付的目标提交、Child 与集成 worktree 的身份、干净状态和分支祖先关系，再清理已登记的临时 worktree 与分支。脏 worktree 会在删除前阻止清理；清理已完成或只清理了部分 worktree 时，可从持久化 Run 在新进程完成原 Action。本地集成测试覆盖正常清理、脏 worktree 拒绝、目标分支漂移拒绝及部分清理后的冷恢复；部分清理后目标分支发生漂移时，恢复拒绝继续且保留剩余 worktree。若 Git 分支引用锁在 worktree 已移除后阻止删分支，原 Action 保留为结果未知，锁解除后可冷恢复完成清理。单次清理操作内部的并发漂移等异常仍需补充验证。

冷恢复由 Native 应用函数实现，公开 `native archive <change> --recover` 已能在确认原宿主停止后处理唯一的 `unknown` Supervisor 交付、归档或清理 Action。交付恢复只在目标分支仍精确指向已验证集成提交时提交原 Action 的结果；目标分支漂移或尚未交付时拒绝，绝不重新执行快进。若目标分支引用锁使快进未提交、但 Git 已暂存候选树，`--recover` 仍拒绝将其当作已交付。解除锁并核对原尝试未执行后，可按 SDK reconciliation 协议重试；只有索引精确匹配已验证集成提交且工作区没有额外改动时，Git 才继续快进，无关文件会阻止交付并保留现场。交付和部分清理后的 CLI 恢复已在临时 Git 项目的完整 Supervisor 路径验证；真实平台宿主是否正确判断原执行已停止，仍需平台层验收。

## 实施顺序与验收

1. 固定两套现有流程的行为基线：阶段推进、确认漂移、候选失效、检查收据、冷恢复、Archive，以及旧格式读取。写两套从公开 SDK 入口运行的契约测试，先暴露缺失的接口。
2. 深化 `domains/engine`：加入经验证的业务状态、版本化转移和证据提交；保持现有 SDK 消费者与 CLI 兼容。只通过公开接口测试这部分机制。
3. 先将 Classic 的新建 full/hotfix/tweak change 接入 SDK：保留 Skill 调用和用户可见命令，移除新路径对旧 Engine `RunState` 的权威推进依赖。
4. 再将 Native 的新建 change 接入同一 SDK：保留 Shape/Build/Verify/Archive、Verifier 收据与独立验收规则，移除新路径中平行的权威阶段推进。
5. 完成旧 change 路由、可选显式迁移与故障恢复；更新中英文 SDK 文档、打包示例和发布说明。中文文档先确认，再同步英文。

完成条件：Native 与 Classic 的新建 change 都能仅通过公开 SDK 接口完成一次真实工作流；进程重启后从同一 Run 恢复；确认与证据过期时关闭式失败；已领取但结果未知的外部动作不自动重发；旧 change 可继续恢复；生成 Runtime、发布包消费者、平台 Hook 与两套模型 Eval 分层验证。单元测试通过不能替代后面几层证据。

## 实施前需要确认的取舍

- **推荐：新旧格式按 change 分流，旧 change 默认不自动迁移。** 这降低进行中任务的升级风险，但在过渡期保留两套运行实现。
- **推荐：SDK Run 是新 change 的唯一逻辑权威。** 兼容状态文件只作视图；这需要改造两套流程的写入路径，范围明显大于目前的 Action 接入。
- **不推荐：把 Native/Classic 阶段硬编码进 SDK。** 两套流程应分别提供转移与验证实现；SDK 只负责通用提交、调度与恢复不变量。
