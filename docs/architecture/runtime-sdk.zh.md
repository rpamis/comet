# Comet Runtime SDK

Comet Runtime SDK 为宿主 Agent 平台提供可恢复的 Skill 工作流编排。宿主继续负责模型请求、Skill/MCP/工具调用、Hook、Rules、沙箱和用户交互；SDK 负责将工作流定义固定到版本、生成可领取的 Action、保存执行结果和决定，并在进程重启后恢复同一 Run。

它不要求把平台原生 Agent loop 改写成 Runtime，也不在 Comet 中重复实现模型调用。把平台已经会做的事情接到一个显式执行适配器上即可。

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

`skill`、`tool`、`approval` 和 `childWorkflow` 是定义步骤的便捷函数；也可以直接写对应的 `type`。工作流只保存步骤、输入绑定和转移关系，不嵌入模型客户端或平台运行时。支持分支、有界步骤激活次数、并行进入与显式 `join`、子工作流、同步 JSON Schema 校验和版本化业务验证器。

每个 Run 固定根工作流和传递子工作流的内容摘要。恢复时必须注册相同的 workflow id/version 与内容；同版本内容变了会以 `WORKFLOW_CHANGED` 拒绝继续，不能悄悄用新定义解释旧状态。

## 宿主执行 Action

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
- `RuntimeValidator`: 在结果推进工作流前执行版本化的业务验收；Agent 返回成功不等于验收通过。并发 CAS 冲突可能重试验收器，因此验收器应保持无副作用或可重复。
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

## Comet 自身的接入方式

Native Verifier 和 Classic `comet check` 是 SDK Action 生命周期的两个应用案例。两者都用 Action 绑定执行输入、领取身份与回传结果；进程中断后，可依据已保存的尝试判断是否需要人工核对或重跑。Classic 在启动检查命令前将已领取的 Action 写入现有轨迹，执行结果写回同一 Action；复用另一作用域的检查结果时，也会为目标作用域生成独立的 Action。旧版没有 Action 的 Classic 轨迹仍可读取。

这两个接入点没有将整个 Native 或 Classic 工作流迁入 `createRuntime`。各自的阶段编排、用户确认、恢复规则和权威状态仍由原 Runtime 负责。SDK 的 `RuntimeStore`、`RuntimeExecutor` 和 Workflow 定义适合新宿主工作流；这些内置应用案例展示的是可单独采用的 Action 协议，不表示现有两套状态机已经统一。

## 保证范围

Runtime 是可复用的确定性编排内核，不是另一套 Agent 平台。它提供稳定的 Run/Action/Outcome/Wait 协议、工作流调度、持久化与恢复、确认和验收扩展点；宿主平台继续提供 Agent loop、system prompt、Skills、Hooks、Rules、MCP、沙箱、工具授权与模型上下文。平台在提示、Hook 或工具行为上的约束仍需由对应平台实施和验证。
