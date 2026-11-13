# 053 CI 选择器修正

来源：report:2026-11-13-053-ci-review；PR：https://github.com/rpamis/comet/pull/554。

CI 43259784850 的 Windows badcase 分片发现三项历史回归没有运行。现有迁移使用首尾锚定的测试名，漏掉了 Vitest 的 describe 前缀，导致文件中的其他测试通过，但指定用例未被选中。

| 原案例 | 修正 |
| --- | --- |
| native-299-real-integration-parent-verify | 补齐 Native parent and child changes 前缀，执行原批准父任务的真实 Child 归档续行 |
| native-314-integration-target-fence | 补齐 Native Supervisor v2 state 前缀，执行真实 Git 合并和目标分支保护 |
| issue-487-workspace-binding-screenshot | 补齐 Classic workspace preparation and routing 前缀，执行复制变更的本地隔离与分支绑定 |

仅追加 supersededBy 节点。原案例字段、来源、旧迁移、用例正文和断言全部保留。registry.json 保存追加前的完整登记；tests.json 保存相关完整测试文件；mapping.json 和 tests.patch 记录选择器变更。摘要沿用现有迁移校验协议，用于校验冻结证据，没有新增产品指纹或预算。

本次同时迁移 CI 的开发期夹具：补齐当前 CLI 环境依赖，当前 Native/Classic 通过真实平台进程运行检查并向公开 CLI 提交报告；旧受管检查验证分支与反例保留。字节上限已移除，非法 JSON 仍拒绝且原文不变；符号链接仍拒绝，不再要求旧错误文案。Dashboard 浏览器检查沿当前“任务状态”侧栏验证原有布局。

这不是新一轮模型 Eval。未改变已有实验结果、评分或样本选择。
