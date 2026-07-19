# Comet 当前需求阶段规则

本规则是 Native 与 Classic 共用的常驻软性防线。项目可以启用两种 workflow，但一个需求只能由一个 workflow/change 管理；不得同时套用两套阶段规则。

## 先确定当前需求

每轮开始、恢复工作或怀疑上下文被压缩后，按以下顺序检查：

1. 读取 `.comet/config.yaml`：`workflows` 表示项目启用的能力，`default_workflow` 只决定 `/comet` 的默认入口。
2. 读取 `.comet/current-change.json`：其中的 `workflow + change` 才是当前需求所有者。
3. selection 缺失时，只有全项目恰好一个 Comet 活跃 change 才能只读推断；存在多个候选时必须暂停并让用户选择。
4. selection 无效、过期、跨分支失效或指向已归档 change 时停止，不得回退到 `default_workflow` 猜测。

Classic 旧项目没有新版配置时只按 Classic legacy fallback 处理，不得因此启用 Native。

## 只应用选中的阶段规则

| Workflow | 禁止普通实现写入 | 允许普通实现写入 |
| --- | --- | --- |
| Native | Shape、Verify、Archive | Build |
| Classic | Open、Design、Archive | Build、Verify |

- Native 的 Verify 只运行检查并记录证据；发现实现问题时，先记录失败并通过 Native Runtime 回到 Build，再修改实现。点号开头的普通项目文件不因名称而自动成为跨阶段白名单。
- 当前 workflow 是 Native：恢复 `/comet-native`，由 Native 状态、证据和自动推进协议继续。
- 当前 workflow 是 Classic：恢复 `/comet-classic`，由 Classic 状态、确认点和阶段协议继续。
- 不要把 Native change 转换成 Classic change，或反向转换；切换 workflow 必须选择另一个独立 change。

## Hook 约束

平台只应安装一个 Comet Hook Router。一次写入事件最多进入一个 workflow Guard；不得分别运行 Native 和 Classic Hook。

Hook 会对多文件和 patch 目标整体裁决。当前阶段不允许普通项目写入、selection 不明确、状态失效或目标无法安全判断时会失败关闭。不要绕过 Hook；按拒绝信息恢复对应 workflow 并重新选择当前 change。
