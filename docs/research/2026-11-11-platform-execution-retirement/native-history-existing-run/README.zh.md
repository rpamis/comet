# 同一已取消 Native Run 的 owner 恢复断言

授权来源：report:2026-11-10-agent-platform-execution。用户要求保留既有业务数据的显式恢复，撤下普通执行器、停止 proof 和专用导入框架。Root 已审阅本例：同一原 Run 与 portable 一致，仅缺 owner，应沿现有 Doctor 验证定义/root lineage 后恢复，不能一概视冲突。

本批仅改 test/domains/comet-native/native-sdk-history.test.ts 的 common recovery table 中 existing-run 分支；其他九个展开项的前置输入与成功/失败分类不改，整个文件仍 38 个展开项，没有 skip/drop。tests.json 冻结修改前完整正文；patch.patch 为该冻结到当前测试的独立差异。

## 真实原因

原夹具通过当前 runtime new→claim→cancel 得到原 Run，其中原 session=SIMULATED-original-agent、token=original-claim；复制 portable 文档到隔离目标。existing-run 行再用 rawStore.restoreCheckpoint 把同一 original Run 原封不动放入目标，没有注册 owner。该 fixture 没有任何不同本地 Run 冲突。

当前 resolveNativeChangeRuntimeOwner 读取该已存在 Run，并由 restoreNativeSdkRunOwner 验证已知 workflow definition 和 root lineage 后恢复原 owner。显式 Doctor 因此正常成功，原旧断言却要求所有 existing Run 都拒绝。此处没有发现产品回归，也不是锁文件或 shadow 目录问题。

## 现在的断言

保留原 Run 完整深等、原 Action 数组和 claim 深等及 original-claim token，原取消状态和 revision 不改；封存到 history 后 active owner 名字为空，history owner 的 workflow/application/change/runId 都正确；目标 checkpoint 在关闭前后字节一致。重复原 Doctor--repair--confirmed 成功，Run、checkpoint 和 history owner 字节不变。目标 portable 字节仍等于原输入，原来源 Run 保持完整深等，原来源 portable 与 closed checkpoint 字节不变。没有伪造执行或停止证明，也没有恢复旧 factory 或执行器。

相同记录的 owner 恢复不等于允许覆盖不同本地权威。原文件的 changed-source/newer-local/source authority 行全部保留且本批未修改、未执行；它们实际检查权威记录不被覆盖，不把“保原更新记录后续成功”冒称为一律拒绝不同来源。corrupt hash/unknown definition/Child lineage/fixed Application 拒绝由本批原十项实际通过继续证明。

## 验证层级

- existing-before.json：精确原 existing-run，0 passed / 1 failed，公共 CLI Doctor 实际成功但旧断言期待失败。
- guard-group-after.json：原同一 table 十项，10 passed / 0 failed，28 未选；已保全部原负例。
- existing-after.json：再增加原来源 portable/local checkpoint 字节保护后，精确 existing-run 1 passed / 0 failed，37 未选。
- 源测试 Prettier 检查通过。
- 未运行整个 38 项、整个 Native module、build、安装、真实 Hook、模型或容器 Eval。仅通过源码公共 CLI；不外推为发布包或真实模型验证。

## 登记追加

只有 native-cancelled-history-import-guards 的当前末端选中本声明。保留其全部十个 requiredNames，不改 ID/原字段/原 testMigration；cas-plan.json 提供完整 expected 原 record 与追加 supersededBy 后 next record。新段为 tests-moved，四 artifact 与 SHA256 位于 draft-case.json。其他 history IDs 和测试链接没有改动。
