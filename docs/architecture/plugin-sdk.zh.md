# Comet 插件 SDK

插件 SDK 用于注册插件、管理启停状态、提供上下文、消费经验事件和调用插件能力。Workflow Runtime SDK 负责审批、Action、检查点和恢复；宿主应用组合这两套接口，继续负责 Agent loop、模型和工具调用。

个人记忆和项目知识已经是插件。公开插件接口不要求重写这两个插件，也不改变 Native 的 `comet-state.yaml`、Classic 的 `.comet.yaml` 或现有插件数据目录。

首次接入先读 [SDK 快速接入](./sdk-getting-started.zh.md)。具名能力优先用 `definePlugin`、`definePluginCapability` 和 `createPluginClient`；下文保留原始描述符接口，便于宿主实现高级适配。

## 安装和入口

公开入口的兼容策略和消费者验证范围见 [SDK 发行契约](./sdk-release-contract.zh.md)。

```bash
npm install @rpamis/comet
```

两个入口均为 ESM，随包提供 TypeScript 类型：

| 入口                          | 用途                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `@rpamis/comet/plugins`       | 通用插件 Runtime、定义、存储和事件契约；不装配内置个人记忆或项目知识 |
| `@rpamis/comet/plugins/comet` | Comet 默认集成，保留两个内置插件并允许追加宿主提供的插件             |
| `@rpamis/comet/runtime`       | 需要持久化审批和恢复的 Workflow；不会自动收集或注入插件上下文        |

已有深层导入保持可用，新应用使用上述公共入口。公共入口随 Comet 包版本维护；不要依赖其背后的源码文件布局。

## 可运行示例

[plugin-sdk-example.mjs](../../scripts/lib/plugin-sdk-example.mjs) 演示注册第三方插件、显式安装、项目存储、能力调用、上下文提供和禁用后的行为：

```bash
pnpm build
node scripts/lib/plugin-sdk-example.mjs
```

示例只使用内存存储，不读写真实用户配置，不调用模型或网络。退出后状态消失；它不演示跨进程恢复。发布包验证会在独立项目安装 npm tarball 后运行相同示例，并编译 TypeScript 消费者。

## 定义插件

`definePlugin` 的 `create` 返回 `capabilities` 映射及可选的上下文、事件、Dashboard、资源释放函数；每个能力用 `definePluginCapability({ parseInput, invoke })` 定义。Runtime 调用能力时先解析未知输入，再调用具备业务参数类型的函数。`createPluginClient(runtime, descriptor, scope?)` 推导名称、输入与返回类型，并固定使用 `throwOnError: true`；不自动安装或启用插件，不改变低层 `PluginRuntime.invoke` 的默认错误行为。

同一个描述符必须注册到客户端使用的 Runtime 中。推导基于可信实现的类型声明，不能验证宿主偷偷注册的另一实现，也不替插件校验输出。原始描述符和客户端可同时使用；插件启停、作用域、数据位置与学习日志协议不变。

能力的 `parseInput` 返回类型也是客户端的输入契约，解析器应接受这一形状的调用参数。需要从对象提取字段等改变输入形状时，在 `invoke` 内处理；不要把只能解析对象的能力声明为接收字符串。

```ts
import {
  MemoryPluginStateStore,
  PluginRuntime,
  type PluginDescriptor,
} from '@rpamis/comet/plugins';

const notesPlugin: PluginDescriptor = {
  id: 'example.notes',
  kind: 'third-party',
  version: '1.0.0',
  scopes: ['project'],
  compatible: (cometVersion) => cometVersion.startsWith('0.4.'),
  create: ({ storage }) => ({
    async invoke(capability, input) {
      if (capability === 'write') {
        await storage.write(input);
        return { saved: true };
      }
      if (capability === 'read') return storage.read();
      throw new Error(`Unsupported notes capability: ${capability}`);
    },
  }),
};

const plugins = new PluginRuntime({
  cometVersion: '0.5.0',
  store: new MemoryPluginStateStore(),
  descriptors: [notesPlugin],
});

// 宿主先取得用户的安装授权，再提交这个操作。
await plugins.install('example.notes', 'user');
await plugins.invoke(
  'example.notes',
  'write',
  { note: 'Keep changes scoped.' },
  { scope: 'project', projectId: 'project-a' },
  { throwOnError: true },
);
```

`descriptors` 注册可用实现，不等于安装。`create` 在启用插件首次用于对应作用域时调用，接收配置快照、存储和诊断回调。插件自己的 `version` 与宿主 `cometVersion` 是不同的版本；`compatible` 判断该实现能否在当前 Comet 版本工作。

`PluginModule` 的能力均为可选：

| 能力                                | 宿主获得的结果                                             |
| ----------------------------------- | ---------------------------------------------------------- |
| `provideContext` / `resolveContext` | 结构化上下文候选 / 指定候选的展开内容                      |
| `events` / `onEvent`                | 按经验事件类型订阅；事件通过 `dispatch` 提交               |
| `reflect` / `consolidate`           | 生成学习结果，再由插件负责幂等持久化                       |
| `invoke`                            | 插件自行定义的能力调用，输入输出为 `unknown`，插件负责校验 |
| `dashboard`                         | 页面贡献；由宿主 Dashboard 选择如何呈现                    |
| `dispose`                           | 禁用、卸载、更新或重新配置时释放该实例持有的资源           |

## 接入 Comet 默认应用

```ts
import { createDefaultCometPluginBridge } from '@rpamis/comet/plugins/comet';

const bridge = await createDefaultCometPluginBridge({
  projectRoot: '/absolute/project',
  projectId: 'stable-project-id',
  descriptors: [notesPlugin],
  config: { 'example.notes': { language: 'zh-CN' } },
});

const plugins = bridge.pluginRuntime;
const installed = await plugins.get('example.notes');
if (installed?.status === 'uninstalled') {
  // 在用户明确要求安装时执行；不要把这段逻辑用于自动恢复卸载的插件。
  await plugins.install('example.notes', 'user');
}

const context = await bridge.collectContext({
  task: '实现下一项需求',
  phase: 'build',
  charBudget: 6000,
});
// 将 context 的 text 放入宿主 Agent 的上下文；SDK 不替宿主调用模型。
```

本例沿用前一节的 `notesPlugin`；该插件只实现 `invoke`，因此不会额外提供上下文。完整示例中的插件实现了 `provideContext`。

默认集成保留 `comet.personal-memory`、`comet.project-knowledge`。额外描述符通过同一个 `PluginRuntime` 参与上下文、事件和能力调用；重复 ID 会拒绝创建，不能替换内置插件。插件返回的上下文候选会由 Runtime 绑定到其注册 ID；默认集成再通过 Context Director 进行匹配、预算选择和应用记录。已验证的项目规则可以直接进入正文，不一定出现在候选目录中。

`config` 是以插件 ID 为键的运行时配置，`configure` 更新当前 Runtime 的配置并释放旧实例；这些配置不会自动写成供应商设置。配置和 `invoke` 输入通过 JSON 克隆，应使用可 JSON 序列化的值；函数、连接和运行器应由描述符或宿主选项提供。宿主应在每次创建时重新提供配置，敏感信息不要写进状态文件。内置记忆和知识的供应商设置仍使用原有配置路径。

描述符也不自动写入磁盘或动态导入。新进程需要重新注册同一插件实现；仅复制启停状态不能恢复插件代码。这是 SDK 应用接入方式，不是给现有 CLI 增加 npm 插件发现、下载或安装命令。

## 生命周期和数据兼容

- 通用 Runtime 不自动安装插件。Comet 默认集成通过 `reconcileFirstParty` 初始化第一方插件；第三方插件不会被自动安装，`install` / `update` 的 `system` 来源会被拒绝。
- 禁用与卸载保留插件数据。第一方版本升级也尊重已经明确禁用、卸载的选择。
- 全局禁用用 `disable(id)`；项目暂停用 `disable(id, { scope: 'project', projectId })`。`enable` 用相同目标恢复；项目恢复不会绕过全局禁用。
- Comet 默认状态仍在 `~/.comet/plugins/state.json`，插件存储仍在 `~/.comet/plugins/storage/`，个人记忆和项目知识沿用原有位置。`homeDirectory`、`stateRoot` 等选项允许宿主隔离数据；它们不是新的用户必填项。
- `projectId` 由宿主提供，必须稳定且符合事件标识约束。不同项目使用不同 ID，避免共享项目存储或事件。追加插件与内置插件使用相同的作用域选择机制。

## 存储、经验事件和调度

通用 Runtime 默认使用内存插件存储和内存经验日志，进程退出后不保留。宿主可注入 `PluginStateStore`、`PluginStorageStore` 和 `AgentExperienceJournal`；`JsonPluginStateStore` 接受实现读写和锁的 `PluginStateFile`。共享文件适配器必须提供跨进程锁，不能只用普通读写覆盖并发状态。

公开入口同时提供 `AgentExperienceJournal`、`MemoryAgentExperienceJournalStore`、`StorageAgentExperienceJournalStore` 及其存储类型。后者可复用插件存储适配器；跨进程学习需要持久化日志，不能只持久化插件启停状态。

```ts
import { AGENT_EXPERIENCE_SCHEMA } from '@rpamis/comet/plugins';

await plugins.dispatch({
  schema: AGENT_EXPERIENCE_SCHEMA,
  eventId: 'task-a:completed',
  episodeId: 'task-a',
  occurredAt: new Date().toISOString(),
  type: 'episode.completed',
  actor: 'agent',
  scope: 'project',
  projectId: 'stable-project-id',
  source: { kind: 'system', name: 'example-host' },
  context: { task: '实现下一项需求' },
  evidence: [],
});
```

事件 ID 用于去重。同一工作片段的事件归入同一 `episodeId`，事件订阅回调可能收到合并片段中的多条事件；插件的外部副作用应自行保持幂等，不应假设跨崩溃恰好执行一次。

默认学习调度是后台执行，`dispatch` 返回不代表后台学习已经完成。短生命周期宿主、测试或要求等待处理结果的应用可传入 `scheduleLearning: (task) => task()`；重启后可显式调用 `replayLearning()` 处理未完成日志。等待处理会增加调用耗时，宿主应按自己的响应预算选择。

普通 `collectContext` 默认先回放未完成学习，没有通用超时保证。低延迟宿主可设置 `replayPendingLearningOnContext: false` 并独立调度回放。Comet 默认集成的 `bestEffortContext: true` 不回放学习，也不持久化上下文应用记录或初始化插件状态；总调用预算由宿主控制。不要把只读上下文模式用于显式安装或持久化操作。

## 错误与执行权限

- 加载失败、不兼容、上下文错误会写入 `diagnostics()`；其他正常插件可以继续工作。这是异常隔离，不是安全沙箱。
- 显式 `invoke` 中，缺少插件或可调用能力会抛错。插件执行异常默认记录诊断并返回 `null`；关键操作设置 `{ throwOnError: true }`，不要把 `null` 当作成功。
- `collectContext` 返回结构化候选，不会自动注入模型；宿主也负责 Dashboard 渲染和用户交互。
- 插件与宿主在同一进程执行，可能访问文件系统、网络和环境变量。只注册可信实现；`source: 'user'` 是宿主提交的授权声明，不是 SDK 验证过的人类身份。这里没有插件下载、供应链审核或进程隔离。

## 何时接入 Workflow Runtime

上下文查询可以直接调用插件。需要用户审批、记录执行事实或恢复中断的插件操作，应由 Workflow 的 Action 调度，再由宿主 executor 调用 `plugins.invoke(..., { throwOnError: true })` 并提交实际执行结果。

插件状态、学习日志与 Workflow 检查点分别负责不同事实，不共享事务。宿主应在真实操作完成后提交执行结果和经验事件；无法确定外部操作是否完成时，使用 Runtime 的不确定结果与核对恢复机制，不能因为插件事件已提交就把 Action 判定为成功。

Native/Classic 的阶段、审批和状态文件保持各自的既有契约。公开插件接口不把记忆查询、知识检索和每个 Dashboard 页面都变成 Workflow。
