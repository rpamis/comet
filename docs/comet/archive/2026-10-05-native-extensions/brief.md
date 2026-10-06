# native-extensions

子任务归档: comet-any-sdk

本归档仅覆盖以下已确认验收项。Spec 是 Parent 已确认内容的快照，不表示独立 Child Spec 变更或新增验收。

- A10: 普通 Native、Supervisor 父级、Child 和集成验收中的扩展均有效；跨会话继续仍保留要求，父级加载一次 Skill 不能代替 Child 的执行与验收。
- A6: Native 样板增加候选审查后，未通过审查不能进入后续验收；未配置扩展的 Native 不新增外部 Skill 依赖。
- A7: Builder 获得指定版本的指导和范围；产物违反可检查的指导要求时，即使已经加载 Skill 也不能通过对应验收。
- A8: 审查失败可回 Build 修复；新候选重做已失效的检查；额外审查通过不能直接跳过 Native 独立验收或取得交付授权。
- A9: 扩展引入需求变化会返回 Shape 重新确认；未改变确认范围的实现修复沿修复流程继续。

[Parent Spec](spec.md) · [来源与原始简报](archive-source.md) · [验收记录](verification.md)
