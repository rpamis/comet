# 工作流生命周期记忆接线

## 需求：稳定检查点产生可追溯项目记忆

系统必须在 Native 和 Classic 的稳定成功检查点调用同一个公开的生命周期 Bridge，并向 Personal Memory 传递以下字段：

- `workflow`：`native`、`classic` 或其 `full`/`hotfix`/`tweak` 语义标识；
- `changeId`：当前 change 的稳定标识；
- `candidateKey`：当前候选或检查点的稳定关联键；
- `projectKey`：由稳定项目身份解析得到的当前项目键；
- `language`：当前 workflow 配置语言；
- 检查点名称、成功结果、短摘要和操作类别。

事件是检查点摘要，不得扩展为逐工具调用的观察日志。成功检查点只在主命令成功后发出；失败命令不产生 `success: true` 的生命周期记忆。

### 场景：Native 成功检查点

- **当** Native facade 成功执行 `next`、`handoff`、`check` 或 `archive`
- **那么** 通过 `recordCometWorkflowResult` 发出对应的 `task.completed`、`verification.completed` 或 `change.completed` 事件
- **并且** 事件保留 Native 的 workflow、changeId、candidateKey、projectKey 和配置语言

### 场景：Classic 成功检查点

- **当** Classic facade 成功执行 `state`、`guard`、`handoff`、`archive` 或现有工作区成功操作
- **那么** 通过同一个 Bridge 发出对应生命周期事件
- **并且** Classic 的状态机和归档语义不被 Native 接线改变

### 场景：hotfix 与 tweak

- **当** 当前 workflow 是 `full`、`hotfix` 或 `tweak`
- **那么** 事件中的 workflow 标识必须保留该值
- **并且** 不同候选的 `candidateKey` 不得相互覆盖或串联

## 需求：自动生命周期只写入一个作用域

工作流自动观察必须选择当前项目作用域并只 dispatch 一次 Personal Memory 观察。一次事件不得同时生成全局和项目两份记忆；跨项目的个人偏好只能由显式用户操作产生。

### 场景：成功事件去重

- **当** 一个成功检查点被 dispatch
- **那么** Personal Memory 最多接收一条对应项目观察
- **并且** 全局记忆数量不因该检查点增加

## 需求：语言和候选关联端到端保持

Bridge 必须把解析出的项目语言写入 lifecycle payload；Personal Memory 插件从 payload 构造 `MemoryObservation` 时必须保留语言和 `candidateKey`。中文配置下自动记录的类别和摘要必须通过中文语言约束，英文配置下通过英文语言约束。缺失配置回退 `zh-CN`。

### 场景：中文配置

- **当**项目默认 workflow 的语言是 `zh-CN` 且检查点成功
- **那么**自动观察使用 `zh-CN`，不因系统 locale 或宿主语言改变

### 场景：英文配置

- **当**项目默认 workflow 的语言是 `en` 且检查点成功
- **那么**自动观察使用 `en`

## 需求：失败隔离和可选宿主接线

Personal Memory Skill、宿主桥接、Git/远端同步和后台学习均为可选能力。能力不可用、超时、返回无效数据或抛出错误时，Bridge 必须吞掉该诊断并让 Native/Classic 保持原有状态、输出和退出码。不得用 catch 隐藏 workflow 主命令本身的失败。

### 场景：记忆接线失败

- **当** lifecycle dispatch 或 memory sync 失败
- **那么** workflow 命令仍按原逻辑返回
- **并且**可通过已有 diagnostics 发现降级原因

## 需求：review action-set 作用域一致

`validateMemoryReviewActions` 必须在逐条 action 校验完成后执行 action-set 级别校验：一个 action-set 不得同时包含 `global` 和 `project` 作用域动作。未显式声明 scope 的 `skip` 不参与作用域集合；同一作用域的合法 action-set 继续通过。

### 场景：拒绝混合作用域

- **当** action-set 同时包含全局动作和项目动作
- **那么** validator 必须拒绝整组动作
- **并且**不能部分执行其中任一动作

## 约束：公开能力和架构边界

- workflow facade 只能依赖 Entry/Plugin Bridge 的公开能力，不直接创建或调用 Personal Memory Service。
- Native 和 Classic 的状态文件、phase、目录、Guard 和 archive 协议保持独立。
- 不新增 scheduler、embedding、vector store 或逐工具调用日志。
