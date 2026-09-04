# 问题证据与验证结论

<!-- comet-development-rule:evidence-and-verification -->

- Issue、Review 意见、Project Knowledge、Memory 和历史记录只提供调查线索；可能变化的事实必须在当前分支重新核对。
- 行为缺陷先在最小临时项目、对应发布包或真实 Runtime 中复现，再修改实现。
- 单元测试、生成 Runtime、npm 打包产物、真实平台 Hook 和真实模型 Eval 是不同证据层级，前一层通过不能证明后一层通过。
- 完成报告列出实际执行的检查、真实结果、未执行项及原因。超时、依赖缺失和环境不可用均视为未完成。
- 验证范围与改动风险匹配：先运行最小相关检查，高风险或发布改动再运行完整检查。
