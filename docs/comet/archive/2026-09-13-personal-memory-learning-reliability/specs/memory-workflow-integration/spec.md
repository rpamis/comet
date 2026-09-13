# 工作流生命周期记忆接线

## 需求：稳定检查点产生可追溯项目记忆

系统必须在 Native 和 Classic 的稳定成功检查点调用同一个公开的生命周期 Bridge，记录带来源的生命周期事件，并在存在合格偏好观察时向 Personal Memory 传递以下字段：

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

有合格信号的工作流自动观察必须选择当前项目作用域并只 dispatch 一次 Personal Memory 观察。普通完成摘要本身不构成合格偏好。一次事件不得同时生成全局和项目两份记忆；跨项目的个人偏好只能由显式用户操作产生。

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

## 工作流学习检查与提交证明

自动学习仅覆盖 Native、Classic、Hotfix、Tweak 已有工作流。Agent 在稳定成功检查点或任务结束检查当前用户纠正、偏好和协作习惯，有合格信号时通过公开 observe 接口提交最小证据。普通生命周期完成摘要本身不证明有个人偏好；无 change 的普通任务不新增自动观察。

完成记录关联稳定项目身份、workflow、change 及实际观察。submitted 必须能解析到该任务的持久化观察，并同时保留观察当前处理结果；待评审、跳过和候选不能被说成已晋级。没有对应观察时说明无法验证提交，主任务仍保持自身结果。no-observation 表达已经检查但没有合格观察；not-run 表达未检查，不从旧成功记录推断本任务已检查。

完整晋级沿用两个独立成功 change 的要求。同一 change 的跨会话恢复、检查点重放或 Hotfix/Tweak 升级不能增加独立计数，失败或取消不形成成功证据。

发布源码、生成 Runtime、中英文 Skill 和正常安装产物必须具备一致接线。支持 Hook 时遵循现有 Router 的唯一工作流路由；无 Hook 时由所选 Skill 调用同一公开接口。安装副本不作为产品源码手工修复。

### Scenario: 完成检查绑定当前观察

当前任务没有观察、只有其他 change 或项目的旧观察时，submitted 不能被标记为已验证。存在本任务已持久化观察时返回实际提交证明和候选、跳过或待评审状态。

### Scenario: 四类工作流有条件提交

分别运行 Native、Classic、Hotfix、Tweak，有合格偏好和可信成功结果时提交当前项目观察；只有普通任务摘要时不生成偏好；无 change 的普通任务不新增学习。

### Scenario: 安装后的真实 Agent 学习

通过正常安装的产物运行受控真实 Agent 任务。首次用户纠正由 Agent 自主提交为候选，独立成功 change 再次验证后晋级，后续任务检索并实际采用、回写真实 application outcome。无偏好对照任务不产生垃圾记录。分别记录真实宿主/model、Hook 和无 Hook 的验证证据，脚本直接提交不能替代 Agent 行为证据。
