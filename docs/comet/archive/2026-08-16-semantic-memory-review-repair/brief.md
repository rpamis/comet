# 目标

重新验证语义自进化记忆的自动路径和三 treatment Eval，确保生产 Runtime 不绕过语义评审直接持久化，并且用户只看到配置语言下的可读记忆内容。

# 范围

- 自动观察必须经过有界 `comet-memory` review、动作校验和 Personal Memory 应用。
- 命令、日志、测试和一次性 Change 摘要必须安全跳过；中文配置生成中文标题和原因。
- Eval 必须同时报告 no-memory、current observe 和 semantic review，并记录可追溯 provenance、独立评分证据及质量指标。
- 本子任务不新增用户可见能力，不修改 Skill 自进化机制，不改变 Classic/Native 状态机。

# 验收示例

- 生产自动路径与显式 observe 使用同一 review/validation/persistence 闭环。
- 自动生成的记忆和提示符合配置语言，并且无用内容不会增长状态或 Markdown。
- Eval 的三种 treatment、指标、阈值和评分证据可复现，失败可归因到具体质量类别。
