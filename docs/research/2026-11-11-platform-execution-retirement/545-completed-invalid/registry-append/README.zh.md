# #545 真实 completed-invalid 续行增补

授权：report:2026-11-10-agent-platform-execution。只对原两 case ID 追加 supersededBy，不改原字段、来源、旧选择器和已冻结迁移节点。新增真实发布包 completed-invalid 公开 CLI 案例并保留 pending/claimed。业务与证据边界见上级 README.zh.md 和 behavior-map.json。旧停止握手已撤下，未称其修复。

原两 variant 测试完整正文保存在 tests.json，registry.json 保存追加前两条原登记完整内容，mapping.json 对应当前三 variant 精确选择器，tests.patch 是此次测试实际差异。真实发布包原实验和冻结 byte 见上级目录。实际 Temp 最终运行 3 pass/0 fail；主工作区正式回归待主 Agent 运行。
