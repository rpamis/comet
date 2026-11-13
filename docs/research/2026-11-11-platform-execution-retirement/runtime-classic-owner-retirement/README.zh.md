# Classic所有权旧锁测试迁移

授权：report:2026-11-11-single-writer-workspaces。

只改runtime-command两个声明及无其余调用者的withRecoverableFileLock import，产品源码未改。独占tests.json完整冻结本轮修改前当前文件，没有覆盖root-single-writer/runtime-command.test.ts.txt。mapping.json保两原声明全文与逐业务目标；实际2pass0fail55未选。

旧进程排他锁/timeout条件退休，垃圾历史锁原文保留且不影响业务。SDK新增实际原owner/Run防重占：相同start保原数据幂等返回，不同input报RUN_CONFLICT；Compat保原初始化、重复拒绝和原owner/state bytes。未伪造批准或执行收据。初轮新SDKfixture错误期待幂等start拒绝而有1fail，依据已有startInternal合同修正，并加入不同input拒绝强反例；不把fixture失败称产品RED。

当前catalog与冻结历史effective selector均无这两旧target，旧链provenance也0，因此CAS草案为空数组，不无故更换ID/追加无关case。四artifact独占本目录。其余55项未在2项定向中执行；Root随后授权的整文件57单独报告。无build/Eval/模型/容器，未变Root其它并发改动。
