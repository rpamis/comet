# Comet Runtime SDK

Comet Runtime SDK 为宿主 Agent 平台提供可恢复的 Skill 工作流编排。宿主继续负责模型请求、Skill/MCP/工具调用、Hook、Rules、沙箱和用户交互；SDK 负责将工作流定义固定到版本、生成可领取的 Action、保存执行结果和决定，并在进程重启后恢复同一 Run。

它不要求把平台原生 Agent loop 改写成 Runtime，也不在 Comet 中重复实现模型调用。把平台已经会做的事情接到一个显式执行适配器上即可。

首次接入先读 [SDK 快速接入](./sdk-getting-started.zh.md)。本文用于查询完整协议、扩展点和应用限制；简单宿主优先使用 `createRuntimeExecutor` 与 `runUntilBlocked`。

## 安装与入口

```bash
npm install @rpamis/comet
```

Runtime 是单独的 ESM 导出，TypeScript 类型随包发布：

```ts
import {
  approval,
  tool,
  createFileRuntimeStore,
  createRuntime,
  skill,
} from '@rpamis/comet/runtime';
```

旧版发布路径保持原样；新 SDK 使用 `@rpamis/comet/runtime`，不要依赖 `domains/engine` 源码路径。

## 完整的可运行示例

[runtime-sdk-example.mjs](../../scripts/lib/runtime-sdk-example.mjs) 用本地宿主适配器演示资料收集、持久化审批等待和报告写入，不依赖 Git、Native change、Comet 初始化、模型供应商或网络：

```bash
pnpm build
node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/runtime-example
node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/runtime-example --approve
```

第一次运行会执行资料收集并持久化等待项；第二次进程读取同一个 Run。只有显式传入 `--approve` 才会推进到写报告。示例输出位于 `./.tmp/runtime-example/published/report.md`。

## 定义工作流

```ts
const reportWorkflow = {
  id: 'report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: skill({ ref: 'research.collect' }),
    approve: approval({ proposalFrom: 'collect' }),
    publish: tool({ ref: 'reports.write' }),
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};
```

`skill`、`tool`、`approval`、`childWorkflow` 和 `evidence` 是定义步骤的便捷函数；也可以直接写对应的 `type`。工作流只保存步骤、输入绑定和转移关系，不嵌入模型客户端或平台运行时。支持分支、有界步骤激活次数、并行进入与显式 `join`、子工作流、同步 JSON Schema 校验和版本化业务验证器。

需要根据已验收的事件更新业务状态时，定义 `stateSchema` 和版本化 `transitionHandler`，并在 `createRuntime` 注册对应的 `transitionHandlers`。JSON Schema 不足以表达领域状态约束时，还可在 Workflow 中声明版本化 `stateValidator`，并注册同步、无副作用的 `RuntimeStateValidator`；启动、恢复读取和每次转移都会检查它。不随 Run 变化的初始状态可写在 Workflow 定义的 `initialState`；不同 change 共用同一 Workflow 定义时，改为在 `runtime.start({ initialState })` 提供。两处不能同时提供初始状态；有 `stateSchema` 却未提供初始状态时拒绝启动。处理器收到已接受的 Action Outcome、用户决定或证据收据，返回新的 `state` 与 `next` 步骤；SDK 校验状态与已声明的转移边，再与事件结果一起提交到同一 Run revision。缺少固定版本的处理器或验证器、状态不符合约束时拒绝推进。Run 会保存初始状态摘要，使重复启动不能悄悄更换初始状态。

`next` 中的字符串表示激活一次已声明步骤；`{ stepId, input }` 可以按不同 JSON 输入多次激活同一步骤。每次激活生成独立 Action，其 `input.activation` 保存对应输入，并参与 Action 输入摘要和 Run 持久化。完全重复的激活和未声明的转移会被拒绝；显式返回空数组表示此次事件不新增步骤，例如等待已派发的并行 Action。激活输入同样会持久化，不得包含凭据。Native Supervisor 已用这套机制完成双 Child 依赖场景的正常路径，包括父级独立验收、目标分支交付、Archive 和临时 worktree 清理；并行 Child 的集成和集成检查按 Run 顺序串行推进，公开 `native next` 返回全部 `pendingActions`。失败的集成检查可转为绑定原检查和提交的宿主修复 Action，成功修复后用新提交重新检查。清理步骤拒绝脏 worktree 或未合入的分支；清理完成或部分清理后宿主中断时，可在新进程核对并完成原 Action。交付前及部分清理后发现目标分支漂移时会拒绝继续；其他失败、结果未知和 Git 操作内部的并发漂移尚未完整验收，不能据此认为 Supervisor 流程已完整通过验收。

Native 应用通过 `comet native archive <change> --recover` 向 CLI 宿主提供中断恢复。它只处理 Archive 阶段唯一的 `unknown` Supervisor 交付、归档或清理 Action，且要求宿主先确认原执行已停止。交付恢复核对目标分支是否仍精确指向已验证集成提交，再提交原 Action 的结果；未交付或分支漂移时拒绝，不重新执行快进。清理恢复核对工作区与分支后完成剩余安全操作；普通 `archive` 不会自动重发结果未知的动作。

用户接受验收结果后，一次 `comet native archive <change>` 会顺序完成当前可执行的归档准备、应用和收尾；Supervisor 已批准的交付及清理也沿原契约执行。每项 Action 仍独立持久化检查点、重验证据并以当前 revision 提交。遇到用户决定、证据等待、扩展步骤、失败或 running/unknown Action 时停止，并返回当前结果。中断后从原检查点继续，已完成归档可安全重复调用；`--dry-run` 只预览当前是否可执行，不推进 Action。

新 change 在原路径的 `comet-state.yaml` / `.comet.yaml` 中保留 `run_checkpoint`。将状态文件、正式文档和已经修改的代码一起转移到配置一致的新 checkout 后，普通 Native/Classic change 可在缺少本机 Run 记录时恢复同一 Run，保留已保存的阶段、Actions 和确认，不会回到 Shape/Open。检查点摘要、工件或工作区绑定不匹配时拒绝恢复；已领取但结果未知的外部动作保持 `unknown`，必须先停止原执行者、核对现场，再按 reconciliation 协议继续，不能自动重放。

Supervisor Child 的独立 worktree 和未提交代码不包含在父状态文件中。Child Builder 阶段可在确认原执行者停止后，通过 `comet native transfer export <change> --output <新目录> --confirmed-stopped` 和 `comet native transfer import --input <目录>` 显式转移。包内包含临时 Git 分支和非忽略的 worktree 修改，必须作为私有资料保存；忽略文件与外部依赖需要另行准备。只复制父状态文件不能接管已启动的 Child。旧状态文件没有检查点时，才需要用户显式确认后，从 Shape/Open 保留正式文档重建；旧确认和检查结果不能直接沿用。具体支持阶段和拒绝条件见 [Native/Classic 接入边界](./runtime-sdk-native-classic-integration.zh.md)。

不由 Action Outcome 直接产生的工件，可用 `await_evidence` 步骤声明证据种类与版本化验证器。宿主在 `evidenceValidators` 注册验证器，调用 `recordEvidence({ runId, evidenceId, kind, ref, contentHash, submissionId, expectedRevision })`。验证器会收到当前 Run 的隔离副本，可据此核对证据是否属于该 Run，再检查引用范围与当前内容摘要；SDK 只在验证通过且 revision 未变化时记录收据并推进。外部文件可能在验证后再次变化，后续依赖它的动作仍须按已记录摘要重新核对。若工作流为该等待项声明 `on: invalidated` 转移，宿主可在收据遭拒后调用 `invalidateEvidence`：SDK 会再次验证原收据，只有确认已失效才记录原因、结束该 Wait 并沿声明的转移继续；它不会重发此前成功的 Action。CLI 中对应 `invalidate-evidence` 操作。没有失效转移或收据仍有效时，Run 保持原等待状态。自定义 JSON Workflow 尚不能通过 CLI 注册处理器和验证器；CLI 的内置 Native/Classic 应用会注册自己的实现。

用户在工作流进行中提出修改时，可以在定义中用 `commands: { revise: 'revise.step' }` 声明可外部激活的执行步骤，再调用 `dispatchCommand({ runId, expectedRevision, commandId, name: 'revise', input })`。需要限制当前阶段、输入或外部工件时，改用 `{ revise: { stepId: 'revise.step', validator: { id, version } } }`，并在 `createRuntime` 注册对应的 `commandValidators`；验证器在旧工作被取消前运行，拒绝时 Run 不变，恢复时也要求同一版本可用。SDK 在一次 CAS 提交中取消尚未领取的 Action 和待决定的 Wait，保存命令收据并创建新 Action；相同 `commandId` 和输入可幂等重放。已领取或结果未知的 Action 不能被命令打断，宿主须先核对其执行结果。命令本身不直接改写业务状态或外部文件；执行器完成副作用并提交合格 Outcome 后，版本化转移处理器才能更新 Run。JSON CLI 对应 `dispatch-command` 操作，要求显式传入 `expectedRevision`、`commandId`、`name` 和 `input`。

内置 Native 和 Classic 的新 change 默认使用各自的 SDK Workflow Application，旧 change 仍由创建它的 Runtime 管理。Native 的 `spec remove`、`spec disassociate`、`next --revise-requirements` 和 `archive` 按 SDK 所有权提交命令或推进现有 Action；`doctor <change>` 从同一 Run 诊断。`native check` 与 `spec sync` 是旧 Runtime 的专用入口：SDK change 的检查经 Run Action 执行，引用或验收要求变化时回到 Shape 修改并重新确认。`archive --dry-run` 在 SDK 路径只读展示 Run 的待处理 Action，不等同于旧 Runtime 的预检哈希。

每个 Run 固定根工作流和传递子工作流的内容摘要。恢复时必须注册相同的 workflow id/version 与内容；同版本内容变了会以 `WORKFLOW_CHANGED` 拒绝继续，不能悄悄用新定义解释旧状态。

## 宿主执行 Action

### 常用接入路径

`createRuntimeExecutor({ id, capabilities?, handlers })` 将步骤的 `ref` 与具名处理函数绑定；`defineRuntimeHandler({ type, parseInput, execute })` 核对步骤类型，解析 `{ input, outputs, activation? }` 后调用业务函数。`parseInput` 的返回值推导执行函数参数类型，执行函数返回 `{ status, output, artifacts?, summary?, event? }`。该助手不推导整张工作流的输入输出类型，跨步骤 JSON 仍需校验。

注册后调用 `runtime.runUntilBlocked({ runId, executorId, maxActions?, context? })`，返回 `{ reason, run, actionsExecuted }`。它按持久化顺序执行当前 Run 的待处理 Action，不要求宿主手写驱动循环；不自动选择执行器、不审批、不提交证据、不重试未知动作。`maxActions` 默认 100，限制本次执行尝试数，不是单个工具的耗时预算。`context.signal` 继续遵循原执行协议，不能保证终止宿主工具或撤回其副作用。

| reason                               | 宿主下一步                                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `completed` / `failed` / `cancelled` | 处理终态和实际结果                                                       |
| `approval-required`                  | 从 `run.waits` 读取当前提案，取得用户决定，再显式 `resolveWait`          |
| `evidence-required`                  | 核对并提交真实证据，不伪造收据                                           |
| `execution-unknown`                  | 停止或联系原执行者，核对现场，再回传原结果或提交未执行证据               |
| `action-in-flight`                   | 等待原执行者；子工作流由宿主按 `run.children` 调度，不隐式递归执行子 Run |
| `executor-required`                  | 当前第一个 Action 的类型、引用或能力不受支持，保持未领取，不跳过它       |
| `action-limit`                       | 已达到本次上限，宿主可按自身预算再次调用，不重发成功动作                 |
| `idle`                               | 当前没有可执行工作也没有已识别等待，读取 Run 和定义排查                  |

任何已有未知、正在执行或等待确认的分支都会停止本次调用，不继续执行其他并行 Action。子 Run 完成后再次推进父 Run，会接受其结果。执行结果被验证器拒绝、配置错误或并发冲突仍抛出已有 `RuntimeProtocolError`，保留 `recovery` 建议；不会把这些错误转换成成功。输入解析在领取后、调用业务函数前执行；解析失败不产生业务副作用，但沿原协议保守保留未知归属。

### 手动派发与结果回传

宿主在另一个进程或平台执行 Action 时，继续使用底层 `claim` / `recordOutcome`：

```ts
const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: '.comet/runtime' }),
  workflows: [reportWorkflow],
});

let run = await runtime.start({
  runId: 'report-2026-09',
  workflow: { id: 'report', version: '1' },
  input: { topic: 'runtime design' },
});

const action = run.actions.find((item) => item.status === 'pending')!;
run = await runtime.claim({
  runId: run.runId,
  actionId: action.id,
  attempt: action.attempt,
  inputHash: action.inputHash,
  executorId: 'my-agent-platform',
});

// 这里调用平台已有的 Skill/工具能力；Comet 不代发 LLM 或 MCP 请求。
const claimedAction = run.actions.find((item) => item.id === action.id)!;
const platformResult = await invokePlatformSkill(claimedAction, run);
run = await runtime.recordOutcome({
  runId: run.runId,
  outcome: {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: run.actions.find((item) => item.id === action.id)!.claim!.token,
    outcomeId: platformResult.requestId,
    status: 'succeeded',
    output: platformResult.output,
  },
});
```

Action 的 `id`、`attempt`、`inputHash` 与领取 token 共同约束回传结果。重复的同一 Outcome 可安全重放；旧 attempt、不同内容复用同一结果标识、未领取结果和不完整结果会被拒绝。

也可以注册 `RuntimeExecutor` 并调用 `runtime.execute`。Executor 明确声明 id、能力、支持的 Action 和执行函数；`supports` 在提交领取前运行，应保持纯判断。真正的 `execute` 只会在领取提交后调用；若抛错或返回无法提交的结果，Runtime 会记录未知状态，不会自动重发。Runtime 只从宿主提供的适配器执行，不自行发现或调用平台工具。

## 等待、确认与恢复

旧状态文件没有 `run_checkpoint` 时，从文档重建新 Run 的路径不处理 Archive 阶段、未解决的外部执行或已启动的 Supervisor 协作；此时须找回原 Run 记录并核对原结果。这个限制不适用于前述携带有效检查点的普通 SDK change 恢复。

`ask_user` 会写入一个带 `proposalHash` 的持久化 Wait。宿主把提案呈现给用户后，用用户决定调用：

```ts
run = await runtime.resolveWait({
  runId: run.runId,
  waitId: wait.id,
  proposalHash: wait.proposalHash,
  decisionId: 'user-decision-001',
  choice: 'approved',
});
```

提案被编辑时用 `reviseWait` 提交新内容；旧 hash 的决定会被拒绝。`inspect` 会重新验证 Run 的结构、Action 归属、结果摘要、步骤序号和提案摘要；注册了工作流定义时还会核对所有固定定义的内容。未注册定义的只读 `inspect` 可用于查看状态，但不能据此判断 Run 已具备继续执行的条件。

JSON Schema 或业务验证器拒绝 Outcome 时，Runtime 将原始结果、结果标识和拒绝原因保存在同一 Run 快照中，然后返回 `OUTPUT_INVALID` 或 `OUTCOME_REJECTED`。Action 仍由原执行者领取，不会自动重发。相同标识重放同一内容会得到原拒绝；用相同标识改写内容会得到 `OUTCOME_CONFLICT`。宿主核对并修正结果后，须使用新的 `outcomeId` 和原 attempt、claim token 回传。已有结果的执行尝试不能再用“未执行”证据重试，即使之后被标为未知。

结果已绑定到 Action，但验证器抛错或工作流转移处理失败时，Runtime 同样会先保存原始 Outcome，并返回 `OUTCOME_PROCESSING_ERROR`；失败的推进不会留下部分输出或新步骤。宿主应先检查错误与外部副作用，再用新的 `outcomeId` 提交修正结果。若执行器返回的值本身无法序列化，Runtime 无法保存该值，会将 Action 标为结果未知，要求宿主核对。

`createFileRuntimeStore` 将每个 Run 写成不可变、有序的 revision 快照，并用原子排他发布及 CAS 避免并发写互相覆盖；`createMemoryRuntimeStore` 适合测试或单进程短任务。若文件系统不支持所需的硬链接原子发布，FileStore 明确报错，不能作为共享网络文件系统上的分布式锁使用。

Run 会持久化输入、Action 输入、Outcome 输出和提案内容；不要把访问令牌、API key 等凭据放进这些字段。由宿主的秘密管理机制在执行边界按需注入；`RuntimeInvocationContext` 不写入 Run 快照。

外部副作用与本地状态不能合成一个原子事务。`execute` 在调用宿主前先提交领取记录；如果执行器断连、抛错或进程中止，Action 保留为结果未知，Runtime 不会自动重发。宿主需要先查询外部系统，再通过 `retry` 提交明确的“未执行”核对证据。幂等键或 reconcile 能力应由宿主和目标系统共同定义；本地 CAS 不提供 exactly-once 副作用保证。

恢复时重新创建 Runtime，提供相同工作流定义和相同 FileStore，再 `inspect` 或调用 `next`。不改变定义内容地续跑；定义不可用或被改变时拒绝执行，需显式保留旧定义或迁移 Run。

## 扩展点

- `RuntimeStore`: 替换持久化介质；实现 `read` 与基于 revision 的 `compareAndSwap`。
- `RuntimeExecutor`: 将 Action 交给平台原有的 Skill、MCP、CLI 或 API 能力执行。
- `RuntimeValidator`: 在结果推进工作流前读取当前 Run、Action 和 Outcome，执行版本化的业务验收；Agent 返回成功不等于验收通过。并发 CAS 冲突可能重试验收器，因此验收器应保持无副作用或可重复。
- `RuntimeStateValidator`: 在初始状态、恢复读取和转移提交前检查领域状态；只执行同步、无副作用的检查。
- `WorkflowTransitionHandler`: 根据已接受的事件计算业务状态和后续步骤；保持纯计算，不能执行工具或直接写入 Run。
- `RuntimeEvidenceValidator`: 核对外部证据引用与内容摘要；并发重试时可能重复调用，不能依赖单次调用副作用。
- Workflow 定义: 组合步骤、转移、join、schema 和子工作流，不需要 fork Scheduler。

Store、Executor 与 Validator 都是显式依赖。SDK 当前不暴露可任意修改 Run 的 observer/hook；可观察性可以由宿主围绕命令调用记录，但不能绕过 CAS 和结果验证直接改变权威状态。

## JSON CLI

适合平台 Agent 只能运行命令、不便导入 JavaScript SDK 的场景：

```bash
comet runtime dispatch --request ./start.json --workflow ./report.workflow.json --root-dir ./.comet/runtime --json
```

`start.json` 示例：

```json
{
  "operation": "start",
  "requestId": "host-request-001",
  "runId": "report-2026-09",
  "workflow": { "id": "report", "version": "1" },
  "input": { "topic": "runtime design" }
}
```

每条命令只处理一个结构化请求，并返回包含 `protocolVersion`、`requestId` 和 Run 或机器可读错误的 JSON。`inspect` 可不提供工作流文件，在新进程只读查看 Run；要核对定义或推进状态，需提供已固定的工作流定义。领取后的外部执行失联时可用 `mark-unknown` 保留不确定事实；`retry` 只有收到 `reconciliation: { "resolution": "not-executed", "evidence": ... }` 才会创建新 attempt。相对 request/workflow/root 路径以 CLI 的调用目录解析；`--project-root` 作为显式宿主上下文传给执行器相关接口。

Native 应用的 CLI `claim` 和 `record-outcome` 默认返回 `data.schema: "comet.native.dispatch-result.v1"`：保留 Run 身份、revision、完整 `state`、当前完整 `action`（含输入、领取信息和结果收据）及 `continuation`，不重复输出其它 Action 历史。领取结果还提供 `outcomeRequest`，宿主必须填入真实执行状态、结果和唯一 outcome ID，再按原身份提交；模板不代表执行已成功。需要旧版完整 Run 的 CLI 调用方应加 `--details`；`inspect` 始终返回完整 Run，紧凑结果的 `inspection.request` 可直接用于查看。JavaScript SDK 与程序化 `runtimeDispatchCommand` 的 `response.data` 仍是完整 Run。

Native 和 Classic 的内置 Workflow Application 可以使用 `--application native|classic-full|classic-hotfix|classic-tweak` 注册。Run 固定写入项目的 `.comet/runtime/sdk-runs/native` 或 `.comet/runtime/sdk-runs/classic`；两个 workflow 可以使用相同的 change 名称，但不能指定另一处 `--root-dir`，也不能与 `--workflow` 混用。每次推进同一 Run 时都传入对应的 `--application`；除了上面的通用操作，还可用 `execute` 领取并执行应用已注册的 Executor，用 `record-evidence` 提交已声明的证据等待，用 `invalidate-evidence` 恢复经验证失效且声明了恢复转移的证据。宿主仍须提供真实的初始状态、工件和外部 Agent 执行结果。Native `new` 与 Classic `state init` 已默认创建 SDK Run，并在 change 原路径保留 `comet-state.yaml` 或 `.comet.yaml`；已有原 Runtime change 继续按 `compat` 路径恢复。

## Comet 自身的接入方式

Native Verifier 和 Classic `comet check` 已使用 SDK Action 生命周期。两者都用 Action 绑定执行输入、领取身份与回传结果；进程中断后，可依据已保存的尝试判断是否需要人工核对或重跑。Classic 在启动检查命令前将已领取的 Action 写入现有轨迹，执行结果写回同一 Action；复用另一作用域的检查结果时，也会为目标作用域生成独立的 Action。旧版没有 Action 的 Classic 轨迹仍可读取。

SDK 所有的 Classic full/hotfix/tweak change 可以用 `comet guard <change> build` 只读预检，再用 `--apply -- <program> [args...]` 完成 Build Action 和真实检查；仅有一个明确可推断的项目 build 命令时，`--apply` 可以省略程序参数。检查与收据进入同一 SDK Run，成功后才进入 Verify。已有失败检查、结果未明的 Action 或失效输入不会被自动推断绕过。

SDK 所有的 Classic change 也可以用 `comet guard <change> verify --report <ref>` 只读检查验证报告，再用 `--apply -- <program> [args...]` 提交报告证据、执行真实验证检查并提交收据；成功后进入 Archive。报告内容或语言不合格、已接受报告发生变化、检查失败或结果未明时不会进入 Archive。成功检查仅在收据提交中断时可用不带程序的 `--apply` 恢复，且不会重跑检查。

SDK 所有的 Classic change 进入 Archive 后，可用 `comet state propose-archive` 记录交付提案，再用绑定提案哈希的 `decide-archive` 提交用户决定。已批准时，`comet guard <change> archive --apply` 或 `comet archive <change>` 会重验分支和 Verify 证据，执行 OpenSpec 文件归档一次。Agent 仍负责按决定完成 Git 提交、推送或 PR；`comet state complete-delivery` 核验实际提交及相应远端结果后结束 Run。Archive 命令不会自行创建提交或扩大用户授权。

此外，Native 普通 change 与 Classic full/hotfix/tweak 已各自定义独立的 SDK Workflow Application，可通过 `comet runtime dispatch --application` 创建和推进 Run；它们保留各自的阶段与验收规则，SDK 负责通用调度和提交。新 change 的默认入口已选择 SDK，现有 `compat` change 仍按原 Runtime 继续；尚未覆盖的旧命令入口和真实平台执行不能由 SDK 单测代替验收。

## 保证范围

公开接口兼容策略、类型消费范围、声明检查及错误恢复建议见 [SDK 发行契约](./sdk-release-contract.zh.md)。

Runtime 是可复用的确定性编排内核，不是另一套 Agent 平台。它提供稳定的 Run/Action/Outcome/Wait 协议、工作流调度、持久化与恢复、确认和验收扩展点；宿主平台继续提供 Agent loop、system prompt、Skills、Hooks、Rules、MCP、沙箱、工具授权与模型上下文。平台在提示、Hook 或工具行为上的约束仍需由对应平台实施和验证。
