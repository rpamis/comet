# Native CLI 的需求修订审批请求

两个原标题均在当前源码实际失败，退出 64：拒绝结果后的需求修订，以及 Archive-ready 修订前的接受结果请求，都没有携带现在公共 Compat 边界要求的版本和动作。原完整测试、两个 RED 和当前全文已冻结。

修改仅在这两个测试请求：从原返回 continuation.commandAlternatives 中找到 revise-requirements 或 accept-result，验证其 expectedAction 及必需参数存在，随后执行原 commandArgs，仅替换原 summary 占位符。没有硬写新版本，没有省略或放宽产品审批校验。两个原标题不变，逐 AST 保留了文件全部原 expect；仅新增两个返回命令结构检查。完整声明和原文映射见 mapping.json。

原用户决定、goal_cycle 增加、新候选 ID、旧候选/验收与结果清理、延迟批准拒绝、旧 Archive 拒绝、重新 Shape 确认和新 Builder→Verifier 任务流程均保留。Helper 的 Builder/Verifier 属隔离测试输入，未声称真实模型验收。

临时同两项实际 2/0，另 43 项未选；随后仓库原文件按相同 selector 也实际通过 2/0，另 43 项未选，见 repository-two-green.json。有效登记见 registry.json，标题和 selector 都未改变，无需追加迁移链。产品源码未修改，没有退休业务断言，未运行 build、全量、Eval 或真实平台 Hook。
