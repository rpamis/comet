# SDK 快速接入

Comet SDK 负责 Skill 工作流的执行记录、审批和中断恢复。你的 Agent 平台继续负责模型、Skill、MCP、工具和用户交互。接入时先实现一个宿主执行器，不需要改写平台的 Agent loop。

## 先跑通审批与恢复

SDK 使用 Node.js ESM，支持范围见[发行契约](./sdk-release-contract.zh.md)。发布包提供以下入口：

```bash
npm install @rpamis/comet
```

在 SDK 候选尚未发布时，用仓库构建出的 npm tarball 安装；不要假设 npm 上的旧版已包含这些入口。

下面是完整的最小宿主。保存为 `report.mjs`：

```js
import {
  approval,
  tool,
  skill,
  createFileRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
} from '@rpamis/comet/runtime';

const workflow = {
  id: 'report',
  version: '1',
  entry: 'draft',
  steps: {
    draft: skill({ ref: 'draft' }),
    approve: approval({ proposalFrom: 'draft' }),
    publish: tool({ ref: 'publish' }),
  },
  transitions: [
    { from: 'draft', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};

const host = createRuntimeExecutor({
  id: 'host',
  handlers: {
    draft: defineRuntimeHandler({
      type: 'invoke_skill',
      parseInput: ({ input }) => {
        if (typeof input !== 'string') throw new Error('Expected a topic');
        return input;
      },
      // 接入真实平台时，在这里调用已有 Skill，返回实际结果。
      execute: (topic) => ({ status: 'succeeded', output: `Report about ${topic}` }),
    }),
    publish: defineRuntimeHandler({
      type: 'call_tool',
      parseInput: ({ outputs }) => {
        if (typeof outputs.draft !== 'string') throw new Error('Expected a report');
        return outputs.draft;
      },
      execute: (report) => {
        console.log(report);
        return { status: 'succeeded', output: { published: true } };
      },
    }),
  },
});

const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: './report-state' }),
  workflows: [workflow],
  executors: [host],
});
await runtime.start({
  runId: 'report-1',
  workflow: { id: 'report', version: '1' },
  input: 'SDK integration',
});
const progress = await runtime.runUntilBlocked({ runId: 'report-1', executorId: 'host' });
console.log(progress.reason);
```

运行 `node report.mjs` 会停在 `approval-required`。再次运行仍停在同一审批，不重新执行 draft。要继续，在真正取得用户对当前提案的同意后，显式提交决定：

```js
const wait = progress.run.waits.find((item) => item.status === 'pending');
if (wait) {
  // 展示 wait.proposal，取得用户决定后执行；不要写成自动批准。
  await runtime.resolveWait({
    runId: progress.run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'user-decision-1',
    choice: 'approved',
  });
  const resumed = await runtime.runUntilBlocked({ runId: progress.run.runId, executorId: 'host' });
  console.log(resumed.reason); // completed
}
```

文件 Store 保存同一 Run；新进程重新注册相同工作流和执行器即可续跑。工作流定义改变时使用新版本，并保留活动 Run 需要的旧定义。

## 把这个执行器换成你的平台

- `handlers` 的键对应步骤的 `ref`，同时核对 `type`，不用在一个执行函数里反复判断名称。
- `parseInput` 接收 `{ input, outputs, activation? }`：当前步骤输入、该次激活的上游输出和可选激活输入。返回你校验过的业务对象；TypeScript 会推导 `execute` 的参数类型。
- `execute` 返回真实的成功或失败结果。已知工具失败返回 `{ status: 'failed', output }`；抛错、断连或不能提交结果会保守记录为未知，不能当作未执行。
- 访问令牌由宿主执行上下文注入，不放入 Workflow、Run 输入、输出或提案。

类型助手只推导处理函数内部类型，不承诺整张工作流的端到端类型推导。跨步骤的持久化结果仍是 JSON，需要输入解析、`outputSchema` 或版本化验证器。

## 接入一个插件能力

插件能力也可按名称注册，不需要手写 `invoke` 分支。完整 TypeScript 用法：

```ts
import {
  PluginRuntime,
  MemoryPluginStateStore,
  createPluginClient,
  definePlugin,
  definePluginCapability,
} from '@rpamis/comet/plugins';

const plugin = definePlugin({
  id: 'example.notes',
  kind: 'third-party',
  version: '1',
  scopes: ['user'],
  compatible: () => true,
  create: () => ({
    capabilities: {
      length: definePluginCapability({
        parseInput(value: unknown) {
          if (typeof value !== 'string') throw new Error('Expected text');
          return value;
        },
        invoke: (text) => text.length,
      }),
    },
  }),
});
const plugins = new PluginRuntime({
  cometVersion: '0.4.5',
  store: new MemoryPluginStateStore(),
  descriptors: [plugin],
});
// 宿主取得用户安装授权后执行；注册描述符不会自动安装。
await plugins.install(plugin.id, 'user');
const client = createPluginClient(plugins, plugin);
const length: number = await client.invoke('length', 'hello');
```

客户端推导能力名称、输入和返回类型，始终传播调用错误，尊重安装、禁用和作用域，不创建第二个插件实例。新进程仍需注册同一描述符；此例使用内存状态，不演示持久化插件。能力实现可信且由宿主注册，类型推导不代替输出校验或沙箱。

## 按需继续

| 要做的事                                | 入口                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件持久化、审批后跨进程续跑            | [报告示例](../../scripts/lib/runtime-sdk-example.mjs)：构建仓库后运行 `node scripts/lib/runtime-sdk-example.mjs --root-dir ./.tmp/report`，然后用同一命令加 `--approve` |
| 外部操作已完成，回传中断                | [核对恢复示例](../../scripts/lib/runtime-sdk-recovery-example.mjs)：运行一次后停在未知状态；确认原执行者已停止，再用同一命令加 `--reconcile --confirmed-stopped`        |
| 插件存储、上下文与禁用                  | [插件示例](../../scripts/lib/plugin-sdk-example.mjs)及[插件参考](./plugin-sdk.zh.md)                                                                                    |
| DAG、并行、子工作流、自定义状态和验证器 | [Runtime 参考](./runtime-sdk.zh.md)                                                                                                                                     |
| Native/Classic 完整应用                 | [接入边界](./runtime-sdk-native-classic-integration.zh.md)：保留各自阶段、状态文件和验收规则                                                                            |
| 错误码、升级和接口兼容                  | [发行契约](./sdk-release-contract.zh.md)                                                                                                                                |

核对恢复示例可以这样运行：

```bash
node scripts/lib/runtime-sdk-recovery-example.mjs --root-dir ./.tmp/recovery
node scripts/lib/runtime-sdk-recovery-example.mjs --root-dir ./.tmp/recovery --reconcile --confirmed-stopped
```

该示例默认目录为 `.comet/runtime-sdk-recovery-example`。它用本地文件模拟外部系统的可查询收据；真实应用须查询目标系统并核对原执行身份。`--confirmed-stopped` 是示例宿主的明确声明，不是 SDK 证明执行者已停止。已经执行的操作只回传原结果，不能用“未执行”证据重复发送。
