# Personal Memory Project Policy Design

## Goal

让团队可以在项目的 `.comet/config.yaml` 中声明当前项目是否允许个人记忆自动学习和自动注入，同时保留每个用户自己的 Runtime 开关与插件卸载状态。

## Configuration

项目配置新增可选的顶层 `memory` 块：

```yaml
memory:
  learning: true
  retrieval: true
```

两个字段都只接受布尔值，缺失时默认为 `true`，以保持已有项目的行为不变。配置解析器返回规范化后的 `WorkflowMemoryProjectConfig`，并在配置生成和更新时保留未知扩展字段。

## Runtime semantics

项目策略是硬性上限，最终行为同时受以下条件约束：

1. Personal Memory 插件必须处于启用状态；
2. 项目配置中的对应策略必须为 `true`；
3. 用户级 Runtime 设置必须启用；
4. 当前项目不能被单独暂停。

`learning: false` 只阻止生命周期事件触发的自动观察和学习，不阻止用户主动 `remember`、`correct` 或管理已有记忆。`retrieval: false` 只阻止自动向 Agent 上下文注入记忆，不阻止用户主动查看或检索记忆。

插件卸载仍然是独立生命周期操作，不写入或修改 `.comet/config.yaml`，也不删除记忆数据。

## Integration and UX

Comet Plugin Bridge 在创建个人记忆插件时读取项目配置，并把规范化策略传给个人记忆插件。插件在自动事件处理和 `provideContext` 边界执行策略。Dashboard 页面返回项目策略，项目设置区显示“项目配置已禁止”并禁用无效的项目暂停操作，避免用户误以为个人开关可以绕过项目策略。

## Compatibility and errors

旧项目没有 `memory` 块时按两个字段均为 `true` 处理。`memory` 不是 mapping、字段不是布尔值时，项目配置按现有 fail-closed 规则拒绝加载，并报告明确的字段错误。

## Verification

覆盖配置默认值和错误输入、配置读写保留、自动学习阻断、自动注入阻断、旧配置兼容、Dashboard 策略投影和现有插件卸载行为；完成后运行受影响 Vitest、格式检查、lint，并在涉及 Runtime 生成物时运行对应 build。
