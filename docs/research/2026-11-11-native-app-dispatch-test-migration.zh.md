# Native App dispatch 最终测试迁移

授权来源：report:2026-11-10-agent-platform-execution。用户明确要求删除普通工作流受管检查执行器，并自动兼容原Run；本记录只迁移当前新建业务夹具及输出协议，不以当前v4冒充旧Run升级证据。

仅追加3个tests-moved：native-build-managed-check-reuse、native-v3-compact-builder-result、native-v3-report-view-nonblocking。每个原case字段、原tests与已有链完整保存；mixed case的平台静态断言保留原样。native-531-builder-batch-validation仍用原精确selector，无需迁移，原一次聚合业务不能退休。

原受管Build checks改测试Agent实际执行Node并将真实结果通过原receipt回报，保原候选、验收与独立选择。新当前v4夹具只用唯一resultRequest；报告阅读view失败不否定已接受Verifier结果、原批准Wait与重复提交幂等。

最终已合并仓库定向报告coverage/native-builder-aggregate-final-results.json：48通过、0失败，其中App17、原loop29、公开CLI structured readiness2。静态mixed targets的精确通过证据见coverage/native-retained-business-current-built-results.json（32通过、0失败）。此前单请求聚合RED及公开incomplete误判conflict的2项RED均保留原文件；最终原类身份、同claim纠正和业务错误一次聚合全部已恢复。

registry.json保存3个追加前完整case，tests.json保存所有原有效target的完整正文，tests.patch记录原App文件到当前最终文件的差异，mapping.json保存逐行为与原17声明、精确passed fullName对应关系。所用摘要仅为仓库既有迁移审计格式所需，不参与Runtime行为。

未执行全量、Eval、真实平台Hook、安装或发布；普通确定性公开CLI测试不替代这些边界。
