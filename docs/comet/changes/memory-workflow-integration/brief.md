# 目标

把 Native、Classic 以及两者的 hotfix/tweak 成功检查点接入 `comet-memory`，使工作流完成后自动产生一条可追溯、语言正确、项目归属明确的记忆观察结果。接线必须通过现有 Plugin Bridge 和公开的 Personal Memory 能力完成，记忆学习失败不能改变工作流命令的退出结果。

# 范围

- 在 Entry/Plugin Bridge 中统一构造生命周期观察事件，保留 `workflow`、`changeId`、`candidateKey`、项目身份和配置语言。
- 为 Native 的成功 `next`、`handoff`、`check`、`archive` 和 Classic 的成功 `state`、`guard`、`handoff`、`archive`/工作区操作接入稳定检查点；失败操作不生成成功记忆。
- 兼容 `full`、`hotfix`、`tweak` 的 workflow 标识，不改变 Native 与 Classic 各自的状态机、目录、Guard 或归档协议。
- 自动生命周期记忆只选择一个作用域（当前项目），禁止一次生命周期事件同时写入全局和项目两份记录；全局记忆仍由显式 Personal Memory 操作负责。
- 让中文配置产生中文的自动记忆文本/类别，英文配置产生英文文本/类别；语言从当前 workflow 配置传入 Bridge，并在事件解析时保留。
- 对 Skill/宿主桥接、同步或后台学习使用可选且非阻塞的调用边界：缺失、超时、无效返回或同步失败只记录诊断，不让主工作流失败。
- 在 review action-set 校验中拒绝同一批动作混用全局与项目作用域，防止一次审核跨越两个记忆边界。
- 补充 Entry、Bridge、插件事件解析和 review-contract 的最小回归测试，并保持现有 Project Rules 生命周期行为。

# 非目标

- 不修改 `comet-memory` Skill 的用户协议、提示词或双语言发布内容。
- 不重写 Personal Memory 的检索、合并、冲突或管理语义，不引入 embedding、向量数据库、后台调度器或逐工具调用观察。
- 不合并 Native/Classic 的状态机，不增加新的工作流命令，不改变公开 CLI 参数。
- 不把自动生命周期事件写入全局个人记忆，不在本 child 内做 Dashboard/CLI 体验改版。

# 验收示例

1. 中文配置下成功完成 Native `check`/`archive` 或 Classic `guard`/`archive` 后，项目记忆中有一条中文生命周期记录；记录含正确 workflow、changeId、candidateKey 和项目归属。
2. 同一次成功检查点只产生一条项目记忆；全局记忆数量不因该事件增加。
3. `full`、`hotfix`、`tweak` 的事件均保留原 workflow 标识，多个候选不会互相覆盖或串联。
4. 工作流失败、Memory Skill 不可用、返回无效数据、调用超时或 Git/远端同步失败时，工作流仍保持原退出码和主状态。
5. review action-set 中全局与项目动作混合时被拒绝；同一作用域且上下文合法的动作仍通过。
6. 现有 Plugin Integration/Project Rules 测试继续通过，且 Bridge 只使用公开插件 capability，不直接访问 Memory Service 私有实现。

# 约束与不变量

- 生命周期观察是稳定成功检查点的摘要，不是每次工具调用的日志。
- 每个自动事件只能选择一个 memory scope；当前 workflow 自动观察固定使用 `project` scope，并携带稳定 project key。
- `candidateKey` 必须在 Entry → Bridge payload → Plugin observation → review evidence/action 链路中保持不变。
- 事件语言必须来自当前项目配置；未知或缺失配置回退 `zh-CN`，不得凭机器环境语言猜测。
- Personal Memory 与 workflow 的故障隔离：所有可选学习/同步调用均 catch 并降级为诊断。
- Native/Classic 的生命周期名称和成功条件保持各自现有语义；共享的只是事件契约和 Bridge。

# 决策

- 自动生命周期事件采用当前项目作用域，避免同一证据同时污染全局和项目记忆；用户若要建立跨项目偏好，使用显式 `memory remember`。
- 使用现有 `CometPluginBridge.dispatchLifecycle` 作为唯一公开接入口；不新增第二套 workflow 监听器。
- 语言由 `createDefaultCometPluginBridge` 解析后注入 Bridge，在 payload 中显式传递，插件不得重新猜测语言。
- 对 review action-set 采用 action-set 级别的一致作用域检查，而不是只逐条校验。

# 待解决问题

- 确认各 workflow facade 的 event name 与 changeId 提取在现有 CLI 参数形式下均稳定。
- 确认 Skill/宿主桥接当前没有强制同步调用；若需要扩展，只能放在现有非阻塞边界内。

# 验证预期

- 先运行新增/受影响的 `comet-plugin`、`comet-memory` review-contract 测试，再运行相关 TypeScript、ESLint、Prettier 检查。
- Native child verifier 独立检查：候选关联、作用域去重、语言传递、Native/Classic 检查点、失败非阻塞、review action-set 作用域一致性。
