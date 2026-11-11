# Native所有权旧锁测试补充迁移

授权：report:2026-11-11-single-writer-workspaces。只改Runtime command第3条已实证的旧Native锁排他声明；产品源码不变，不修改先前Classic两项冻结四artifact。当前完整文件在tests.json独占冻结，包含先前已完成Classic迁移。更早withNativeMutationLock原始机制正文仍保留Root原root-single-writer备份。

实证：整文件一次52pass1fail4原平台skip，唯一fail正是旧Native锁声明（coverage/runtime-command-current-full-after-classic-lock-retirement.json），并非pre-existing Classic read owner声明，该条实际passed，未改。新Native目标精确单项1pass0fail56未选，见one-result.json。前52成功目标与本1目标合起来覆盖当前53可执行目标；这是两次结果组合，不宣称另有单次整文件53/0。

保留原业务：当前Native v4在已有串行mutation内创建原SDK owner；垃圾旧锁文件bytes不变。完全相同启动返回原Run，换task报RUN_CONFLICT。owner原文、Run/state、实际checkpoint文件bytes和正式状态文件存在性/bytes全部不变。真实未决WAL保护仍由生产withNativeMutation执行，不恢复排他锁。

当前及冻结历史有效selector均未引用旧声明，config/scripts检索无原名，因此CAS草案为空，不额外添加/改写无关caseID。四artifact只属于此补充。无build/Eval/模型/容器，未改其余测试声明或前两项证据。
